// world-engine-diag.js — Gói chẩn đoán (xuất trạng thái hoạt động bằng một cú nhấp để hỗ trợ gỡ lỗi)
// [FIX] Module chỉ đọc thuần túy: chỉ gọi các getter mà từng module đã public để tổng hợp trạng thái, không thay đổi bất kỳ logic hiện có nào, không ghi bộ nhớ, không đụng đến cấu trúc dữ liệu.
//   Xuất ra { collect, download }; khu vực gỡ lỗi trên UI chỉ cần một nút gọi download() là đủ.
//   Chi phí gỡ bỏ: xóa file này + xóa một dòng trong MODULES của world-engine.js + xóa nút và sự kiện UI.
window.WORLD_ENGINE_DIAG = (function() {

  // Thực thi an toàn: bất kỳ khối nào ném lỗi/module bị thiếu cũng không ảnh hưởng tổng thể, được ghi lại thành { error }
  function safe(fn) {
    try {
      const v = fn();
      return v === undefined ? null : v;
    } catch (e) {
      return { error: String(e && e.message || e) };
    }
  }

  // Ẩn thông tin nhạy cảm khi thiết lập: apiKey tuyệt đối không lộ ra ngoài; apiUrl chỉ báo đã điền hay chưa (không lộ host); phần còn lại giữ nguyên
  function sanitizeSettings(s) {
    if (!s || typeof s !== 'object') return s;
    const out = {};
    for (const k in s) {
      if (k === 'apiKey') {
        const v = s[k];
        out[k] = (v && String(v).length) ? ('***đã thiết lập(len=' + String(v).length + ')') : '(trống)';
      } else if (k === 'apiUrl') {
        out[k] = (s[k] && String(s[k]).length) ? '(đã điền)' : '(trống)';
      } else {
        out[k] = s[k];
      }
    }
    return out;
  }

  // Đếm số lượng tin nhắn user / ai trong đoạn chat
  function countChat(chat) {
    let user = 0, ai = 0;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      if (!m) continue;
      if (m.is_user) user++; else ai++;
    }
    return { total: chat.length, user, ai };
  }

  function collect(scope) {
    if (scope === 'npc') return collectNpc();
    if (scope != null && scope !== '' && scope !== 'world') throw new Error(`Scope chẩn đoán không xác định: ${scope}`);
    const core = window.WORLD_ENGINE_CORE;
    const api = window.WORLD_ENGINE_API;
    const store = window.WORLD_ENGINE_STORE;
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const chatcache = window.WORLD_ENGINE_CHATCACHE;
    const worldbook = window.WORLD_ENGINE_WORLDBOOK;
    const rules = window.WORLD_ENGINE_RULES;
    const preset = window.WORLD_ENGINE_PRESET;
    const inspector = window.WORLD_ENGINE_INJECT_INSPECTOR;

    const diag = {};

    // —— Thông tin meta ——
    diag.meta = safe(function () {
      return {
        extVersion: window.WORLD_ENGINE_VERSION || 'Không xác định (không đọc được phiên bản manifest)',
        collectedAt: new Date().toISOString(),
        userAgent: (typeof navigator !== 'undefined' && navigator.userAgent) || 'Không xác định'
      };
    });

    // —— Môi trường vận hành ——
    diag.env = safe(function () {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      return {
        chatId: (ctx && ctx.chatId) || null,
        chat: countChat(chat),
        name1: (ctx && ctx.name1) || null,
        name2: (ctx && ctx.name2) || null,
        characterId: (ctx && ctx.characterId != null) ? ctx.characterId : null,
        hasChatMetadata: !!(ctx && ctx.chatMetadata),
        tavernApi: {
          updateChatMetadata: !!(ctx && typeof ctx.updateChatMetadata === 'function'),
          saveMetadataDebounced: !!(ctx && typeof ctx.saveMetadataDebounced === 'function'),
          saveMetadata: !!(ctx && typeof ctx.saveMetadata === 'function'),
          saveChat: !!(ctx && typeof ctx.saveChat === 'function')
        }
      };
    });

    // —— Thiết lập (đã ẩn thông tin nhạy cảm) ——
    diag.settings = safe(function () {
      if (!api || !api.getSettings) return { error: 'Module api không khả dụng' };
      return sanitizeSettings(api.getSettings(true));
    });

    // —— Tóm tắt trạng thái thế giới ——
    diag.worldState = safe(function () {
      if (!core || !core.loadState) return { error: 'Module core không khả dụng' };
      const st = core.loadState() || {};
      const len = function (a) { return Array.isArray(a) ? a.length : 0; };
      return {
        round: st.round,
        chatLayer: st.chatLayer,
        worldDigestLen: (st.worldDigest || '').length,
        counts: {
          events: len(st.events),
          factions: len(st.factions),
          winds: len(st.winds),
          worldTrends: len(st.worldTrends),
          memories: len(st.memories),
          enemies: len(st.enemies),
          influenceChain: len(st.influenceChain),
          economySignals: len(st.economy && st.economy.signals),
          secretActions: len(st.blackbox && st.blackbox.secretActions),
          secretAssets: len(st.blackbox && st.blackbox.secretAssets)
        },
        regionalIncidentActive: !!(st.regionalIncident && st.regionalIncident.active),
        hasLastInjection: !!st.lastInjection,
        hasLastEvolveResult: !!st.lastEvolveResult,
        hasState: core.hasState ? core.hasState() : null
      };
    });

    // —— Điểm lưu (checkpoint) ——
    diag.checkpoint = safe(function () {
      if (!core || !core.restoreCheckpoint) return { error: 'Module core không khả dụng' };
      const cp = core.restoreCheckpoint();
      if (!cp) return { exists: false };
      return { exists: true, round: cp.round, chatLayer: cp.chatLayer };
    });

    // —— Fingerprint / Số tầng ——
    diag.fingerprint = safe(function () {
      if (!core) return { error: 'Module core không khả dụng' };
      return {
        fingerprint: core.loadFingerprint ? core.loadFingerprint() : null,
        chatLayer: core.getChatLayer ? core.getChatLayer() : null,
        isNewRound: core.isNewRound ? core.isNewRound() : null,
        lastStoryDay: core.getLastStoryDay ? core.getLastStoryDay() : null,
        anchorLayer: core.getAnchorLayer ? core.getAnchorLayer() : null
      };
    });

    // —— Trạng thái suy diễn (bao gồm prompt đầy đủ / kết quả gốc, người dùng đã đồng ý bao gồm nguyên văn hội thoại) ——
    diag.evolution = safe(function () {
      if (!evo) return { error: 'Module evolution không khả dụng' };
      const dbg = evo.getLastDebug ? evo.getLastDebug() : {};
      // [FIX] Bổ sung thu thập cấu trúc phân đoạn prompt của PR#12: chỉ lưu key/label/độ dài, không lưu lại toàn bộ văn bản
      //   (nội dung đầy đủ đã có trong lastPrompt; phân đoạn dùng để đối chiếu đoạn nào bị preset ghi đè, tỷ trọng từng đoạn).
      const segs = (dbg && Array.isArray(dbg.segments)) ? dbg.segments : [];
      return {
        isRunning: evo.isRunning ? evo.isRunning() : null,
        lastError: evo.getLastError ? evo.getLastError() : null,
        lastPrompt: (dbg && dbg.prompt) || '',
        lastRawResult: (dbg && dbg.rawResult) || '',
        lastPromptLen: ((dbg && dbg.prompt) || '').length,
        lastRawResultLen: ((dbg && dbg.rawResult) || '').length,
        segmentCount: segs.length,
        segments: segs.map(function (s) {
          return { key: (s && s.key) || null, label: (s && s.label) || null, contentLen: ((s && s.content) || '').length };
        })
      };
    });

    // —— Bộ nhớ đệm Tavern ——
    diag.chatcache = safe(function () {
      if (!chatcache || !chatcache.getStatus) return { error: 'Module chatcache không khả dụng' };
      const status = chatcache.getStatus();
      const snaps = chatcache.listSnapshots ? chatcache.listSnapshots() : [];
      return {
        status: status,
        snapshots: snaps.map(function (s) {
          return { id: s.id, name: s.name, auto: !!s.auto, round: s.round, createdAt: s.createdAt, v: s.v };
        })
      };
    });

    // —— Sách thế giới ——
    diag.worldbook = safe(function () {
      if (!worldbook) return { error: 'Module worldbook không khả dụng' };
      const ids = worldbook.getSelectedIds ? worldbook.getSelectedIds() : [];
      return {
        selectedCount: Array.isArray(ids) ? ids.length : 0,
        hasSelection: worldbook.hasSelection ? worldbook.hasSelection() : null,
        triggerEnabled: worldbook.triggerEnabled ? worldbook.triggerEnabled() : null
      };
    });

    // —— Khóa lưu trữ (chỉ liệt kê tên key, không xuất value: tránh rò rỉ và phình dung lượng) ——
    diag.store = safe(function () {
      if (!store || !store.keys) return { error: 'Module store không khả dụng' };
      const keys = store.keys();
      return { count: keys.length, keys: keys };
    });

    // —— Quy tắc ——
    diag.rules = safe(function () {
      if (!rules || !rules.getRuleCount) return { error: 'Module rules không khả dụng' };
      return { ruleCount: rules.getRuleCount() };
    });

    // —— Preset của engine (được đưa vào từ PR#13; gói chẩn đoán trước đây chưa thu thập mục này — khi gỡ lỗi không thấy được preset hiện tại và các đoạn bị ghi đè) ——
    diag.preset = safe(function () {
      if (!preset) return { error: 'Module preset không khả dụng' };
      const active = preset.getActivePreset ? preset.getActivePreset() : null;
      const overridden = preset.getOverriddenSegKeys ? preset.getOverriddenSegKeys() : [];
      const custom = preset.getCustomPresets ? preset.getCustomPresets() : [];
      const all = preset.getAllPresets ? preset.getAllPresets() : [];
      return {
        activeId: preset.getActivePresetId ? preset.getActivePresetId() : null,
        activeName: (active && (active.name || active.id)) || null,
        activeIsBuiltin: !!(active && active.builtin),
        overriddenSegKeys: Array.isArray(overridden) ? overridden.slice() : [],
        overriddenCount: Array.isArray(overridden) ? overridden.length : 0,
        presetCount: Array.isArray(all) ? all.length : 0,
        customPresetCount: Array.isArray(custom) ? custom.length : 0,
        // Chỉ liệt kê id+name+builtin, không xuất toàn bộ văn bản đoạn (tránh phình dung lượng và rò rỉ tiềm ẩn)
        customPresetList: Array.isArray(custom) ? custom.map(function (p) {
          return { id: (p && p.id) || null, name: (p && p.name) || null, builtin: !!(p && p.builtin) };
        }) : []
      };
    });

    // —— Snapshot tự kiểm tra việc chèn (module chỉ đọc, tách rời; khi gỡ lỗi có thể xem trực tiếp trạng thái thế giới vòng trước có thực sự vào được prompt cuối cùng hay không) ——
    //   Khi khách hàng báo "chèn thất bại", ở đây có thể phân biệt SUCCESS / MISSING (thất bại thật) / SKIPPED_* (bỏ qua theo thiết kế/tự tắt).
    diag.injectInspector = safe(function () {
      if (!inspector || !inspector.getLastSnapshot) return { error: 'Module inspector không khả dụng' };
      const snap = inspector.getLastSnapshot();
      if (!snap) return { hasSnapshot: false, status: 'NOT_YET' };
      const out = {
        hasSnapshot: true,
        status: snap.status,
        statusText: inspector.statusText ? inspector.statusText(snap.status) : null,
        apiType: snap.apiType,
        round: snap.round,
        ts: snap.ts,
        injectEnabled: snap.injectEnabled,
        registeredAtSend: snap.registeredAtSend,
        sameLayerReroll: snap.sameLayerReroll,
        landed: snap.landed
      };
      if (snap.apiType === 'chat') {
        out.messageCount = snap.messageCount;
        out.ourIndex = snap.ourIndex;
        out.ourContentLen = (snap.ourContent || '').length;
        // Chuỗi role chỉ báo role+độ dài+isOurs, không xuất nội dung chính (tránh phình dung lượng và lộ ngữ cảnh trò chuyện)
        out.roleChain = Array.isArray(snap.messages)
          ? snap.messages.map(function (m) { return { role: m.role, length: m.length, isOurs: !!m.isOurs }; })
          : [];
      } else {
        out.promptLength = snap.promptLength;
        out.ourExcerptLen = (snap.ourExcerpt || '').length;
      }
      return out;
    });

    // —— Chẩn đoán regex lọc (dùng lại core.validateFilterRegex: hỗ trợ cả hai cách viết /pat/flags và pattern thuần) ——
    //   Khi gỡ lỗi không cần đoán regex người dùng nhập có hoạt động hay không — ở đây báo từng dòng mục hợp lệ/không hợp lệ kèm lý do.
    diag.filterRegex = safe(function () {
      if (!core || !core.validateFilterRegex) return { error: 'core.validateFilterRegex không khả dụng' };
      const s = (api && api.getSettings) ? api.getSettings(true) : {};
      let raw = '';
      try { raw = s && s.evolveFilterRegex ? String(s.evolveFilterRegex) : ''; } catch (e) { raw = ''; }
      const v = core.validateFilterRegex(raw);
      return {
        rawTextLength: raw.length,
        rawLineCount: raw ? raw.split('\n').length : 0,
        nonEmptyCount: v.ok + v.bad.length,
        validCount: v.ok,
        invalidCount: v.bad.length,
        // Mục không hợp lệ báo nguyên lý do; raw đã bị cắt ngắn còn 60 ký tự bên trong validateFilterRegex
        invalidList: v.bad,
        // Mục hợp lệ chỉ báo line + flags (không lặp lại pattern, tránh phình dung lượng)
        validList: v.entries.map(function (e) { return { line: e.line, flags: e.flags }; }),
        // Bản xem trước raw cắt ngắn còn 200 ký tự, để dễ dàng nhìn ra ngay người dùng đã nhập gì
        rawPreview: raw.slice(0, 200)
      };
    });

    return diag;
  }

  function collectNpc() {
    const data = window.NPC_ENGINE_DATA;
    const engine = window.NPC_ENGINE;
    const debug = safe(function () { return engine?.getLastDebug?.() || {}; });
    const state = safe(function () { return data?.loadState?.() || {}; });
    const npcs = Array.isArray(state?.npcs) ? state.npcs : [];
    const archive = Array.isArray(state?.archive) ? state.archive : [];
    return {
      meta: safe(function () { return { engine: 'npc', extVersion: window.NPC_ENGINE_SETTINGS?.VERSION || '1.0.0', collectedAt: new Date().toISOString(), userAgent: navigator.userAgent }; }),
      env: safe(function () { const ctx = SillyTavern.getContext(); return { chatId: ctx?.chatId || null, chatCount: ctx?.chat?.length || 0, hasChatMetadata: !!ctx?.chatMetadata }; }),
      settings: safe(function () { return sanitizeSettings(window.NPC_ENGINE_SETTINGS?.getSettings?.(true) || {}); }),
      npcState: safe(function () {
        return {
          round: state?.round || 0,
          chatLayer: state?.chatLayer ?? null,
          coreCount: npcs.filter(function (npc) { return npc.tier === 'core'; }).length,
          peripheralCount: npcs.filter(function (npc) { return npc.tier !== 'core'; }).length,
          archivedCount: archive.length,
          movingCount: npcs.filter(function (npc) { return npc.location?.movingTo && npc.location.etaRounds > 0; }).length,
          knowledgeCount: npcs.reduce(function (total, npc) { return total + (Array.isArray(npc.knowledge) ? npc.knowledge.length : 0); }, 0),
          offscreenLogCount: npcs.reduce(function (total, npc) { return total + (Array.isArray(npc.offscreenLog) ? npc.offscreenLog.length : 0); }, 0),
          publicFactCount: Array.isArray(state?.publicFacts) ? state.publicFacts.length : 0,
          rumorCount: Array.isArray(state?.rumorQueue) ? state.rumorQueue.length : 0,
          traceCount: Array.isArray(state?.traceQueue) ? state.traceQueue.length : 0,
          travelRouteCount: Object.keys(state?.travelCache || {}).length,
          sceneLayer: state?.scene?.layer ?? null,
          scenePresentCount: Array.isArray(state?.scene?.presentIds) ? state.scene.presentIds.length : 0
        };
      }),
      // Sổ mâu thuẫn là thứ đáng giá nhất trong một báo cáo lỗi: nó nói thẳng engine đã ghi đè cái
      // gì bằng cái gì, thay vì bắt người đọc đoán từ ảnh chụp màn hình.
      conflicts: safe(function () {
        const list = Array.isArray(state?.conflicts) ? state.conflicts : [];
        const byKind = {};
        for (const item of list) byKind[item.kind || 'khác'] = (byKind[item.kind || 'khác'] || 0) + 1;
        return { total: list.length, byKind: byKind, recent: list.slice(-10) };
      }),
      checkpoint: safe(function () {
        const cp = data?.loadCheckpoint?.();
        return { exists: !!cp, npcCount: Array.isArray(cp?.npcs) ? cp.npcs.length : 0, round: cp?.round || 0 };
      }),
      extraction: safe(function () { return { isRunning: engine?.isRunning?.() ?? null, runningLabel: engine?.getRunningLabel?.() || '', lastError: debug?.error || null, lastPrompt: debug?.prompt || '', lastRawResult: debug?.apiResponse || '' }; }),
      injection: safe(function () { return { text: engine?.applyInjection ? (window.NPC_ENGINE?.buildInjectionText?.(state, window.NPC_ENGINE_SETTINGS?.getSettings?.(true) || {}, {}) || '') : '' }; }),
      filterRegex: safe(function () {
        const raw = window.NPC_ENGINE_SETTINGS?.getSettings?.().filterRegex || '';
        const result = window.WORLD_ENGINE_CORE?.validateFilterRegex?.(raw);
        return result ? { validCount: result.ok, invalidCount: result.bad.length, invalidList: result.bad, rawPreview: raw.slice(0, 200) } : { error: 'Bộ kiểm tra không khả dụng' };
      })
    };
  }

  // Tải gói chẩn đoán xuống dưới dạng file JSON
  function download(scope) {
    const diag = collect(scope);
    const content = JSON.stringify(diag, null, 2);
    let chatId = 'unknown';
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) chatId = String(ctx.chatId).replace(/[^\w.-]+/g, '_').slice(0, 40);
    } catch (e) {}
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (scope === 'npc' ? 'npc-engine-diag-' : 'world-engine-diag-') + chatId + '-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    return content;
  }

  // Những nhánh mang nguyên văn truyện. Gói tải xuống giữ lại vì đó là file của chính người dùng,
  // nhưng bản chép vào clipboard thì phải bỏ — nó sinh ra để dán vào issue công khai.
  const PROSE_PATHS = [
    ['extraction', 'lastPrompt'],
    ['extraction', 'lastRawResult'],
    ['injection', 'text'],
    ['evolution', 'lastPrompt'],
    ['evolution', 'lastRawResult']
  ];

  function redactProse(diag) {
    for (const [branch, field] of PROSE_PATHS) {
      const node = diag && diag[branch];
      if (!node || typeof node !== 'object' || typeof node[field] !== 'string') continue;
      // Giữ lại độ dài: biết prompt dài 12000 ký tự là manh mối thật, còn nội dung thì không cần.
      node[field] = `[đã lược bỏ — ${node[field].length} ký tự]`;
    }
    return diag;
  }

  // Chép gói chẩn đoán vào clipboard, ĐÃ bỏ khoá API và bỏ nguyên văn truyện. Dạng này để dán
  // thẳng vào báo lỗi; ai muốn đủ cả nguyên văn thì dùng nút tải file.
  async function copy(scope) {
    const content = JSON.stringify(redactProse(collect(scope)), null, 2);
    await navigator.clipboard.writeText(content);
    return content;
  }

  return { collect, download, copy, redactProse };
})();
