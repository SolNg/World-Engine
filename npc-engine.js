// npc-engine.js — Điều phối Công Cụ Nhân Vật: trích xuất, hoạt động ngầm, chèn ràng buộc, bám sự kiện
window.NPC_ENGINE = (function() {
  const INJECTION_NAME = 'npc_engine_context';

  let running = false;
  let runningLabel = '';
  let abortController = null;
  let lastDebug = { prompt: '', apiResponse: '', parsed: null, error: '' };
  // Số liệu khối chèn lần gần nhất, để tab Gỡ Lỗi cho biết đang tốn bao nhiêu ký tự.
  let lastInjectionInfo = { length: 0, blocks: 0, dropped: 0, maxChars: 0 };
  // Bảng điểm chọn nhân vật lần gần nhất, để tab Gỡ Lỗi giải thích vì sao ai được đẩy.
  let lastSelection = [];

  // Chống chạy hai lần cho cùng một tin nhắn. Có hai đường dẫn tới cùng một luồng:
  // Công Cụ Thế Giới gọi sang sau khi suy diễn xong (đường chính), và bộ hẹn giờ riêng bên dưới
  // (đường dự phòng). Đường nào chạy trước thì ghi khoá tin nhắn vào đây, đường kia thấy trùng là bỏ qua.
  let lastProcessedKey = '';
  let autoTimer = null;
  let autoRetries = 0;
  const AUTO_DELAY_MS = 3000;      // đủ dài để Công Cụ Thế Giới (1500ms) khởi động trước
  const AUTO_RETRY_MS = 2500;
  const AUTO_MAX_RETRIES = 12;     // ~30 giây chờ Công Cụ Thế Giới gọi API xong

  const data = () => window.NPC_ENGINE_DATA;
  const settings = force => window.NPC_ENGINE_SETTINGS?.getSettings(force) || {};
  const core = () => window.WORLD_ENGINE_CORE;

  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const clean = value => String(value == null ? '' : value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();
  const asArray = value => Array.isArray(value) ? value : [];
  // Number(null) === 0 chứ không phải NaN, nên bản cũ biến "không có tầng" thành "tầng 0".
  const asLayer = value => (value === null || value === undefined || value === '')
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);

  function describePath(path) {
    const parts = asArray(path).map(clean).filter(Boolean);
    return parts.length ? parts.join(' › ') : 'chưa rõ';
  }

  // Báo trạng thái ra quả cầu nổi và thanh trên cùng, dùng chung đường của Công Cụ Thế Giới.
  // Không có phần này thì engine là hộp đen: người dùng không biết nó đang chạy, đã xong,
  // hay đã bỏ qua vì lý do gì — mọi trục trặc đều trông giống nhau là "không thấy gì cả".
  function setStatus(text, isError) {
    const message = '[Nhân Vật] ' + clean(text);
    try { window.__WE_SetExternalStatus?.(message, !!isError); } catch (error) { /* không có UI thì thôi */ }
    if (isError) console.warn('[Công Cụ Nhân Vật] ' + clean(text));
    else console.log('[Công Cụ Nhân Vật] ' + clean(text));
  }

  // Báo cho quả cầu nổi biết trạng thái chạy vừa đổi, để nó vẽ lại hoạt ảnh xoay và nút dừng.
  // Chỉ hiện thông báo chữ là không đủ: người dùng không nhìn banner sẽ tưởng engine chết.
  function notifyBusyChanged() {
    try { window.WORLD_ENGINE_UI?.refreshBallControls?.(); }
    catch (error) { /* giao diện chưa sẵn sàng thì bỏ qua */ }
  }

  const SKIP_REASONS = {
    disabled: 'Công Cụ Nhân Vật đang tắt',
    running: 'đã có tác vụ đang chạy, bỏ qua lượt này',
    manual: 'đang ở chế độ thủ công'
  };

  // ================= Sổ mâu thuẫn =================
  // Trích xuất chọi với thứ đang lưu thì ghi lại rồi VẪN nghe theo chính văn. Đây không phải cơ chế
  // chặn — nó chỉ khiến việc trôi hiện ra để người chơi còn thấy mà sửa tay. Bỏ khoá nhân dạng rồi
  // thì con mắt người chơi là lớp bảo vệ duy nhất còn lại, mà mắt thì cần có cái để nhìn.
  function noteConflicts(state, existing, incoming, patch, layer, result) {
    const note = entry => result.conflicts.push(data().recordConflict(state, {
      npcId: existing.id, npcName: existing.name,
      layer, atMinutes: data().clockMinutes(state), ...entry
    }));

    // Nhảy vị trí: đang ở một nơi cụ thể, lượt này ở nơi khác, mà không hề có chặng đường nào.
    // Đây là lớp lỗi khiến nhân vật "dịch chuyển tức thời" qua nửa bản đồ giữa hai lượt.
    const oldPath = describePath(asArray(existing.location?.path));
    const newPath = patch.location ? describePath(asArray(patch.location.path)) : '';
    if (oldPath && newPath && oldPath !== 'chưa rõ' && oldPath !== newPath && !existing.location?.movingTo) {
      note({ kind: data().CONFLICT_KINDS.TELEPORT, field: 'vị trí', from: oldPath, to: newPath,
             note: 'không có chặng đường nào giữa hai nơi' });
    }

    // Người chết trở lại: mô hình quên mất ai đã chết. Nếu chính văn thật sự hồi sinh họ thì đây là
    // ghi chú thừa, còn nếu không thì nó bắt được đúng lúc hồ sơ bắt đầu sai.
    if (existing.status?.alive === false && incoming.status && incoming.status.alive !== false) {
      note({ kind: data().CONFLICT_KINDS.RESURRECT, field: 'còn sống', from: 'đã chết', to: 'còn sống' });
    }
  }

  // ================= Gộp kết quả trích xuất =================
  // Tách riêng khỏi phần gọi API để kiểm thử được mà không cần mạng.

  function mergeExtraction(state, parsed, layer) {
    const result = { added: [], updated: [], deaths: [], facts: [], conflicts: [] };
    if (!parsed || typeof parsed !== 'object') return result;

    const st = settings();
    const currentLayer = asLayer(layer);
    const presentNames = new Set(asArray(parsed.scene?.presentNames).map(normalized));
    const presentIds = [];

    for (const incoming of asArray(parsed.npcs)) {
      const name = clean(incoming?.name);
      if (!name) continue;

      const existing = data().findNpc(state, name);
      const isNew = !existing;

      // Prompt dặn mô hình chỉ ghi phần THAY ĐỔI, nên nhân vật cũ thường về mà không kèm
      // significance hay tier. Trước đây chỗ này quy về 0 rồi ghi đè, khiến nhân vật chính bị
      // xoá điểm ngay lượt sau khi tái xuất hiện và tụt luôn xuống ngoại vi.
      // Nguyên tắc: KHÔNG có trong phản hồi thì GIỮ NGUYÊN, không phải đặt về mặc định.
      const rawSignificance = incoming.significance;
      const hasSignificance = rawSignificance !== undefined && rawSignificance !== null
        && rawSignificance !== '' && Number.isFinite(Number(rawSignificance));
      const significance = hasSignificance
        ? Math.min(100, Math.max(0, parseInt(rawSignificance)))
        : (parseInt(existing?.significance) || 0);

      // Bậc do mô hình đề xuất vẫn phải qua ngưỡng cấu hình — không phó mặc mô hình tự quyết,
      // vì tiêu chuẩn của nó trôi dần qua các lượt.
      const proposedTier = (incoming.tier === 'core' || incoming.tier === 'peripheral') ? incoming.tier : null;
      let tier;
      if (existing?.pinned) {
        tier = existing.tier;                                   // ghim tay thì mô hình không đụng tới được
      } else if (proposedTier === 'core') {
        tier = significance >= st.significanceThreshold ? 'core' : 'peripheral';
      } else if (proposedTier === 'peripheral') {
        tier = 'peripheral';
      } else {
        tier = existing?.tier || 'peripheral';                   // không nói gì thì giữ nguyên bậc cũ
      }

      const patch = {
        name,
        // Biệt danh cũng cộng dồn: lượt sau mô hình chỉ nêu biệt danh mới, ghi đè sẽ mất tên cũ.
        aliases: [...asArray(existing?.aliases), ...asArray(incoming.aliases)],
        significance,
        tier,
        lastSeenLayer: currentLayer,
        firstSeenLayer: existing?.firstSeenLayer ?? currentLayer
      };

      if (incoming.location?.path) {
        patch.location = {
          ...(existing?.location || {}),
          path: asArray(incoming.location.path).map(clean).filter(Boolean)
        };
        // Nhân vật xuất hiện trước mặt người chơi thì sương mù vị trí tan: hai giá trị khớp lại.
        if (incoming.present) {
          patch.location.userBelievesAt = describePath(patch.location.path);
          patch.location.fogSince = null;
          patch.location.movingTo = null;
          patch.location.etaRounds = 0;
        }
      }
      if (incoming.goals) patch.goals = asArray(incoming.goals);
      if (incoming.faction) patch.faction = incoming.faction;
      if (incoming.status) patch.status = { ...(existing?.status || {}), ...incoming.status };

      if (incoming.relations) {
        patch.relations = {
          user: incoming.relations.user
            ? {
                attitude: clean(incoming.relations.user.attitude),
                trust: parseInt(incoming.relations.user.trust) || 0,
                lastChangeReason: clean(incoming.relations.user.reason || incoming.relations.user.lastChangeReason)
              }
            : (existing?.relations?.user || { attitude: '', trust: 0, lastChangeReason: '' }),
          npcs: incoming.relations.npcs ? asArray(incoming.relations.npcs) : asArray(existing?.relations?.npcs)
        };
      }

      // Ghi sổ TRƯỚC khi upsert, vì sau đó giá trị cũ đã bị đè mất.
      if (existing) noteConflicts(state, existing, incoming, patch, currentLayer, result);

      const npc = data().upsertNpc(state, { ...patch, id: existing?.id });

      // Nhân dạng bám theo chính văn: có giá trị mới thì ghi đè, bỏ trống thì giữ nguyên cái cũ.
      for (const change of data().mergeIdentity(npc, incoming.identity)) {
        // Nhân vật mới chưa có gì để chọi; chỉ ô ĐANG CÓ giá trị mà bị đổi mới là mâu thuẫn.
        if (!change.from) continue;
        result.conflicts.push(data().recordConflict(state, {
          kind: data().CONFLICT_KINDS.IDENTITY,
          npcId: npc.id, npcName: npc.name,
          field: change.field, from: change.from, to: change.to,
          layer: currentLayer, atMinutes: data().clockMinutes(state)
        }));
      }

      // Tri thức là trường cộng dồn: nối thêm và đóng dấu tầng, không ghi đè.
      for (const item of asArray(incoming.knowledge)) {
        const fact = clean(item?.fact);
        if (!fact) continue;
        if (npc.knowledge.some(known => normalized(known.fact) === normalized(fact))) continue;
        npc.knowledge.push({
          fact,
          source: clean(item.source) || 'chứng kiến',
          certainty: clean(item.certainty) || 'chắc chắn',
          layer: currentLayer,
          factId: clean(item.factId) || null
        });
      }

      if (incoming.present || presentNames.has(normalized(name))) presentIds.push(npc.id);
      (isNew ? result.added : result.updated).push(npc.id);
    }

    // Cái chết là chuyện thiên hạ CÓ THỂ biết, nhưng chưa chắc đã biết — nên vừa lưu kho vừa
    // ghi thành một sự thật công khai để ràng buộc tri thức còn chỗ mà trừ.
    for (const death of asArray(parsed.deaths)) {
      const name = clean(death?.name);
      if (!name) continue;
      const npc = data().findNpc(state, name);
      if (!npc || npc.tier !== 'core') continue;
      data().archiveNpc(state, name, clean(death.reason), currentLayer);
      // Cái chết diễn ra trước mặt người chơi thì đã là chính văn rồi, thừa nhận ngay.
      const fact = addPublicFact(state, `${name} đã chết${death.reason ? ' (' + clean(death.reason) + ')' : ''}`,
        currentLayer, 'death', { acknowledged: true });
      result.deaths.push(npc.id);
      result.facts.push(fact.id);
      // Người chứng kiến cái chết thì đương nhiên đã biết.
      for (const witnessId of presentIds) {
        const witness = state.npcs.find(item => item.id === witnessId);
        if (witness) witness.knowledge.push({ fact: fact.text, source: 'chứng kiến', certainty: 'chắc chắn', layer: currentLayer, factId: fact.id });
      }
    }

    state.scene = {
      layer: currentLayer,
      location: asArray(parsed.scene?.location).map(clean).filter(Boolean),
      presentIds
    };

    data().enforceCoreLimit(state, st.npcCoreLimit);
    return result;
  }

  function nextFactId(state) {
    const used = asArray(state.publicFacts)
      .map(fact => parseInt(String(fact.id).replace(/^fact:/, '')))
      .filter(Number.isFinite);
    return 'fact:' + ((used.length ? Math.max(...used) : 0) + 1);
  }

  // Sự việc xảy ra ở hậu trường KHÁC với sự việc trong truyện đã biết.
  // Một chuyện engine suy diễn ra mà chưa từng được viết vào chính văn thì người chơi chưa đọc thấy,
  // nhân vật trong truyện cũng chưa có đường nào biết được. Nó chỉ trở thành "chuyện của thiên hạ"
  // khi AI chính thật sự kể ra, hoặc để lại dấu vết cảm nhận được.
  //
  // acknowledged = false: mới có ở hậu trường, dùng làm chất liệu cho AI viết.
  // acknowledged = true : đã vào chính văn, từ đây mới tính vào ràng buộc tri thức.
  function addPublicFact(state, text, layer, kind, options) {
    const existing = state.publicFacts.find(fact => normalized(fact.text) === normalized(text));
    if (existing) {
      if (options?.acknowledged === true) existing.acknowledged = true;
      return existing;
    }
    const fact = {
      id: nextFactId(state),
      text: clean(text),
      layer: asLayer(layer),
      kind: clean(kind) || 'sự kiện',
      // Chuyện diễn ra ngay trước mặt người chơi thì đã là chính văn rồi, thừa nhận luôn.
      acknowledged: options?.acknowledged === true
    };
    state.publicFacts.push(fact);
    return fact;
  }

  // Đánh dấu những sự việc hậu trường vừa được AI chính kể vào chính văn.
  // Danh sách id do pha trích xuất của lượt kế tiếp báo về.
  function acknowledgeFacts(state, ids) {
    const wanted = new Set(asArray(ids).map(clean).filter(Boolean));
    if (!wanted.size) return [];
    const done = [];
    for (const fact of asArray(state.publicFacts)) {
      if (!wanted.has(fact.id) || fact.acknowledged) continue;
      fact.acknowledged = true;
      done.push(fact.id);
    }
    // Tin đồn và nhật ký hoạt động ngầm gắn với sự việc đó cũng được thừa nhận theo.
    for (const rumor of asArray(state.rumorQueue)) {
      if (wanted.has(rumor.factId)) rumor.acknowledged = true;
    }
    for (const trace of asArray(state.traceQueue)) {
      if (wanted.has(trace.factId)) trace.acknowledged = true;
    }
    for (const npc of state.npcs) {
      for (const entry of asArray(npc.offscreenLog)) {
        if (wanted.has(entry.factId)) entry.acknowledged = true;
      }
    }
    return done;
  }

  // ================= Gộp kết quả hoạt động ngầm =================

  function applyOffscreen(state, parsed, layer) {
    const result = { acted: [], rumors: [], moves: [], traces: [] };
    if (!parsed || typeof parsed !== 'object') return result;

    const currentLayer = asLayer(layer);

    for (const activity of asArray(parsed.activities)) {
      const npc = data().findNpc(state, activity?.name);
      if (!npc || npc.status.archived || npc.status.alive === false) continue;

      const action = clean(activity.action);
      if (action) {
        npc.offscreenLog.push({
          layer: currentLayer,
          round: state.round,
          action,
          timeRef: clean(activity.timeRef),
          visibility: clean(activity.visibility) || 'kín đáo',
          becameRumor: activity.becameRumor === true
        });
        result.acted.push(npc.id);
      }

      const destination = asArray(activity.move?.to).map(clean).filter(Boolean);
      if (destination.length) {
        const travelMode = clean(activity.move.travelMode);
        // Ưu tiên thời lượng theo đồng hồ; etaRounds chỉ còn là đường lui cho phản hồi kiểu cũ.
        const travelMinutes = data().toMinutes(activity.move.duration);
        const eta = Math.max(0, parseInt(activity.move.etaRounds) || 0);
        if (travelMinutes !== null && travelMinutes > 0) {
          npc.location.movingTo = destination;
          npc.location.arriveAt = data().clockMinutes(state) + travelMinutes;
          npc.location.etaRounds = 0;
          npc.location.travelMode = travelMode;
          if (!npc.location.fogSince) npc.location.fogSince = currentLayer;
        } else if (eta > 0) {
          npc.location.movingTo = destination;
          npc.location.arriveAt = null;
          npc.location.etaRounds = eta;
          npc.location.travelMode = travelMode;
          // Người chơi không đi cùng thì không biết nhân vật đã rời đi — sương mù bắt đầu từ đây.
          if (!npc.location.fogSince) npc.location.fogSince = currentLayer;
        } else {
          npc.location.path = destination;
          npc.location.movingTo = null;
          npc.location.etaRounds = 0;
        }
        if (settings().travelCacheEnabled) {
          const from = describePath(npc.location.path);
          const to = describePath(destination);
          if (from !== to && !data().getTravel(state, from, to)) {
            data().setTravel(state, from, to, { etaRounds: eta, travelMode, updatedRound: state.round });
          }
        }
        result.moves.push(npc.id);
      }

      if (activity.intent?.action) {
        // Lịch hẹn theo đồng hồ thế giới, bốn kiểu tuỳ bản chất công việc.
        const now = data().clockMinutes(state);
        const need = data().toMinutes(activity.intent.duration);
        const mode = data().SCHEDULE_MODES.includes(activity.intent.mode) ? activity.intent.mode : 'natural';
        npc.pendingIntent = {
          action: clean(activity.intent.action),
          schedule: data().newSchedule({
            mode,
            dueAt: (mode === 'natural' || mode === 'scheduled') && need !== null ? now + need : null,
            needMinutes: mode === 'effort' ? (need || 0) : 0,
            condition: clean(activity.intent.condition)
          }),
          bornAt: now,
          layer: currentLayer
        };
      }

      for (const item of asArray(activity.knowledgeGained)) {
        const fact = clean(item?.fact);
        if (!fact) continue;
        if (npc.knowledge.some(known => normalized(known.fact) === normalized(fact))) continue;
        npc.knowledge.push({
          fact,
          source: clean(item.source) || 'suy đoán',
          certainty: clean(item.certainty) || 'mơ hồ',
          layer: currentLayer,
          factId: null
        });
      }

      // Dấu vết: tầng giữa tin đồn và bí mật. Không ai kể, nhưng người tới sau nhìn thấy được.
      // Thiếu tầng này thì mọi chuyện hậu trường chỉ có hai kết cục — thành lời đồn hoặc biến mất
      // hẳn — nên "không có gì xảy ra" lúc nào cũng nghĩa là thế giới đứng im.
      const trace = clean(activity.trace);
      if (trace) {
        const where = asArray(npc.location.path).map(clean).filter(Boolean);
        const fact = addPublicFact(state, trace, currentLayer, 'dấu vết');
        state.traceQueue.push({
          text: trace, layer: currentLayer, sourceId: npc.id, factId: fact.id,
          at: where, acknowledged: false
        });
        result.traces.push(trace);
      }

      if (activity.becameRumor === true) {
        const text = clean(activity.rumorText) || action;
        if (text) {
          const fact = addPublicFact(state, text, currentLayer, 'tin đồn');
          state.rumorQueue.push({ text, layer: currentLayer, sourceId: npc.id, factId: fact.id, acknowledged: false });
          // Gắn nhật ký với sự việc, để khi được thừa nhận thì cả hai cùng đổi trạng thái.
          const entry = npc.offscreenLog[npc.offscreenLog.length - 1];
          if (entry) entry.factId = fact.id;
          result.rumors.push(text);
        }
      }
    }

    return result;
  }

  // ================= Khối chèn vào prompt =================
  // Hàm thuần: (state, settings, ngữ cảnh) → chuỗi. Không đụng DOM, không gọi API — kiểm thử được trọn vẹn.

  function buildTimeAnchor(state, context) {
    const bits = [];
    const storyDay = context?.storyDay;
    if (Number.isFinite(Number(storyDay))) bits.push(`ngày truyện thứ ${Number(storyDay)}`);
    bits.push(`lượt thứ ${state.round}`);

    const recent = state.npcs
      .flatMap(npc => npc.offscreenLog.map(entry => ({ ...entry, name: npc.name })))
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
      .slice(0, 3)
      .map(entry => `${entry.name}: ${entry.action}`);

    let text = `【Neo thời gian】${bits.join(' · ')}`;
    if (recent.length) text += `\nDiễn biến nền gần đây: ${recent.join('; ')}`;
    return text;
  }

  function buildLocationBlock(state, st) {
    const mode = st.locationFogMode;
    const lines = [];

    for (const npc of state.npcs) {
      if (npc.tier !== 'core' || npc.status.archived) continue;

      const real = describePath(npc.location.path);
      const believed = clean(npc.location.userBelievesAt);
      const inTransit = npc.location.movingTo && npc.location.etaRounds > 0;

      if (mode === 'off') {
        let line = `${npc.name}: đang ở ${real}`;
        if (inTransit) {
          line += `, đang trên đường tới ${describePath(npc.location.movingTo)}, còn ${npc.location.etaRounds} lượt nữa mới tới`;
        }
        lines.push(line);
        continue;
      }

      // Che vị trí thật: chỉ nói chỗ người chơi tưởng, để mô hình không lỡ miệng tiết lộ thứ nó không nên biết.
      const shown = believed || real;
      const diverged = believed && believed !== real;

      if (mode === 'strict') {
        lines.push(`${npc.name}: lần cuối được biết là ở ${shown}`);
        continue;
      }

      let line = `${npc.name}: lần cuối được biết là ở ${shown}`;
      if (diverged || inTransit) {
        line += ' — có tin đồn nhân vật này không còn ở đó, nhưng chưa ai rõ hiện đang ở đâu';
      }
      lines.push(line);
    }

    if (!lines.length) return '';

    const constraints = state.npcs
      .filter(npc => npc.tier === 'core' && !npc.status.archived && npc.location.movingTo && npc.location.etaRounds > 0)
      .map(npc => `${npc.name} chưa thể có mặt ở ${describePath(npc.location.movingTo)} (còn ${npc.location.etaRounds} lượt)`);

    // Ràng buộc cứng đặt NGAY SAU tiêu đề, không phải cuối khối: khi bị cắt cho vừa trần độ dài,
    // phần cắt đi là từ dưới lên, nên thứ quan trọng nhất phải nằm trên cùng.
    const head = constraints.length ? `\nRàng buộc bắt buộc: ${constraints.join('; ')}` : '';
    return `【Vị trí nhân vật】${head}\n${lines.join('\n')}`;
  }

  // Nhân dạng của nhân vật đang có mặt: gửi cho AI chính để nó không viết sai giới tính, xưng hô,
  // chủng tộc hay độ tuổi. Rẻ về token mà chặn được loại lỗi người đọc nhận ra ngay.
  function buildIdentityBlock(state, st) {
    if (st.injectIdentity === false) return '';
    const scope = state.npcs.filter(npc => asArray(state.scene?.presentIds).includes(npc.id));
    const lines = scope.map(npc => {
      const text = data().describeIdentity(npc);
      return text ? `${npc.name}: ${text}` : '';
    }).filter(Boolean);
    if (!lines.length) return '';
    return `【Nhân dạng nhân vật】\n${lines.join('\n')}\nViết đúng giới tính, cách xưng hô và độ tuổi như trên. Truyện chưa nói khác thì đừng đổi.`;
  }

  function buildKnowledgeBlock(state, st) {
    if (st.knowledgeInjectScope === 'none') return '';

    const scope = st.knowledgeInjectScope === 'all'
      ? state.npcs.filter(npc => npc.tier === 'core' && !npc.status.archived)
      : state.npcs.filter(npc => asArray(state.scene.presentIds).includes(npc.id));

    // Chỉ những sự việc ĐÃ VÀO CHÍNH VĂN mới tính. Chuyện engine suy diễn ra ở hậu trường mà chưa
    // ai kể thì chưa tồn tại trong truyện — ràng buộc "nhân vật chưa biết" về nó là vô nghĩa, mà
    // còn tệ hơn: nó tiết lộ cho AI chính một tình tiết lẽ ra vẫn đang giấu.
    const known = state.publicFacts.filter(fact => fact.acknowledged === true);
    if (!scope.length || !known.length) return '';

    const limit = Math.max(0, parseInt(st.knowledgeInjectLimit) || 0);
    const lines = [];

    for (const npc of scope) {
      const knownFactIds = new Set(npc.knowledge.map(item => item.factId).filter(Boolean));
      const knownTexts = new Set(npc.knowledge.map(item => normalized(item.fact)));

      const unknown = known
        .filter(fact => !knownFactIds.has(fact.id) && !knownTexts.has(normalized(fact.text)))
        .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
        .slice(0, limit)
        .map(fact => fact.text);

      if (unknown.length) lines.push(`${npc.name} CHƯA biết: ${unknown.join('; ')}`);
    }

    if (!lines.length) return '';
    return `【Ràng buộc tri thức】\n${lines.join('\n')}\nCác nhân vật trên không được nhắc tới, ám chỉ, hay phản ứng với những điều họ chưa biết.`;
  }

  // Dấu vết chỉ có nghĩa khi người chơi ĐỨNG ĐÚNG CHỖ đó. Một vết bùn ở thành khác thì không ai
  // nhìn thấy, mà đưa vào prompt lại thành đường tiết lộ chuyện đang giấu — đúng cái lỗi mà tầng
  // "sự việc hậu trường" sinh ra để tránh. Nên lọc theo độ gần với cảnh hiện tại.
  function buildTraceBlock(state, st) {
    const scene = asArray(state.scene?.location).map(clean).filter(Boolean);
    if (!scene.length) return '';

    const limit = Math.max(1, parseInt(st.knowledgeInjectLimit) || 5);
    const here = asArray(state.traceQueue)
      .filter(item => item && !item.acknowledged && clean(item.text))
      .filter(item => data().proximity(asArray(item.at), scene) === data().PROXIMITY.SAME_SPOT)
      .sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0))
      .slice(0, limit);
    if (!here.length) return '';

    return `【Dấu vết tại chỗ này】\n${here.map(item => '· ' + clean(item.text)).join('\n')}\n`
      + 'Đây là những thứ nhìn thấy được ở nơi người chơi đang đứng, do chuyện đã xảy ra lúc họ vắng mặt. '
      + 'Dùng khi hợp cảnh để người chơi TỰ nhận ra, đừng giải thích hộ nguyên nhân.';
  }

  function buildRumorBlock(state, st) {
    const limit = Math.max(1, parseInt(st.knowledgeInjectLimit) || 5);
    const sorted = asArray(state.rumorQueue).sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0)).slice(0, limit);
    if (!sorted.length) return '';

    // Tách hai loại: chuyện chưa ai kể là CHẤT LIỆU để AI dùng nếu muốn; chuyện đã kể rồi là
    // sự thật đã có trong truyện. Gộp chung thì AI không phân biệt được cái nào nó đã viết ra.
    const fresh = sorted.filter(item => item.acknowledged !== true).map(item => clean(item.text)).filter(Boolean);
    const settled = sorted.filter(item => item.acknowledged === true).map(item => clean(item.text)).filter(Boolean);

    const parts = [];
    if (fresh.length) {
      parts.push(`Chưa ai kể ra (chất liệu, dùng khi hợp cảnh):\n${fresh.map(text => '· ' + text).join('\n')}`);
    }
    if (settled.length) {
      parts.push(`Đã thành chuyện trong truyện:\n${settled.map(text => '· ' + text).join('\n')}`);
    }
    return `【Tin đồn】\n${parts.join('\n')}`;
  }

  const INJECTION_HEADER = '【TRẠNG THÁI NHÂN VẬT NỀN】';
  const INJECTION_FOOTER = 'Hãy tuân thủ đúng các ràng buộc trên. Không tự ý đổi vị trí nhân vật, không cho nhân vật biết điều họ chưa được biết.';

  function buildInjectionText(state, st, context) {
    if (!state || st.injectIntoPrompt === false) return '';

    // Xếp theo mức thiết yếu giảm dần: hết ngân sách thì bỏ từ dưới lên. Ràng buộc vị trí là thứ
    // AI dễ vi phạm nhất nên đứng trên; tin đồn chỉ là chất liệu trang trí nên xuống cuối.
    const ordered = [
      st.timeAnchorEnabled !== false ? buildTimeAnchor(state, context) : '',
      // Nhân dạng đứng ngay sau neo thời gian: ngắn nhất mà sai thì người đọc nhận ra ngay lập tức.
      buildIdentityBlock(state, st),
      st.injectLocation !== false ? buildLocationBlock(state, st) : '',
      st.injectKnowledge !== false ? buildKnowledgeBlock(state, st) : '',
      // Dấu vết đứng trên tin đồn: nó gắn với đúng chỗ người chơi đang đứng, nên dùng được ngay,
      // còn tin đồn thì chỉ là chất liệu chung chung.
      st.injectTrace !== false ? buildTraceBlock(state, st) : '',
      st.injectRumor !== false ? buildRumorBlock(state, st) : ''
    ].filter(Boolean);

    if (!ordered.length) return '';

    // Không có trần thì khối này phình theo số nhân vật nhân số sự kiện, và SillyTavern sẽ báo
    // "Mandatory prompts exceed the context size" vì phần chèn của extension tính vào prompt bắt buộc.
    const maxChars = Math.max(0, parseInt(st.injectMaxChars) || 0);
    const overhead = INJECTION_HEADER.length + INJECTION_FOOTER.length + 6;
    const budget = maxChars > 0 ? Math.max(0, maxChars - overhead) : Infinity;

    // Cắt một khối cho vừa chỗ trống, cắt theo ranh giới dòng để không đứt câu giữa chừng.
    // Giữ nguyên dòng tiêu đề của khối, vì mất tiêu đề thì phần còn lại mất ngữ cảnh.
    const fitBlock = (block, room) => {
      const lines = block.split('\n');
      const out = [];
      let size = 0;
      for (const line of lines) {
        const cost = line.length + (out.length ? 1 : 0);
        if (size + cost > room) break;
        out.push(line);
        size += cost;
      }
      return out.length > 1 ? out.join('\n') : '';
    };

    const kept = [];
    let used = 0;
    let dropped = 0;
    for (let i = 0; i < ordered.length; i++) {
      const block = ordered[i];
      const gap = kept.length ? 2 : 0;
      if (used + block.length + gap <= budget) {
        kept.push(block);
        used += block.length + gap;
        continue;
      }
      // Không vừa: cắt bớt khối này rồi DỪNG HẲN. Không được nhảy sang khối sau, vì các khối
      // xếp theo mức thiết yếu giảm dần — để tin đồn lọt vào trong khi ràng buộc vị trí bị bỏ
      // là giữ phần trang trí mà mất phần quan trọng nhất.
      const trimmed = fitBlock(block, Math.max(0, budget - used - gap));
      if (trimmed) { kept.push(trimmed); used += trimmed.length + gap; }
      dropped += ordered.length - i - (trimmed ? 0 : 1);
      break;
    }

    // Ngân sách quá chặt tới mức không giữ nổi khối nào: giữ khối đầu và cắt cứng,
    // vì mất ràng buộc hoàn toàn còn tệ hơn ràng buộc bị cắt cụt.
    if (!kept.length) kept.push(ordered[0].slice(0, Math.max(0, budget)));

    let text = `${INJECTION_HEADER}\n${kept.join('\n\n')}\n\n${INJECTION_FOOTER}`;
    if (maxChars > 0 && text.length > maxChars) text = text.slice(0, maxChars);
    lastInjectionInfo = { length: text.length, blocks: kept.length, dropped, maxChars };
    return text;
  }

  // ================= Chèn =================

  function unregisterInjection() {
    const ctx = window.SillyTavern?.getContext?.();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, '', 1, 1);
  }

  function applyInjection(stateOverride) {
    const st = settings(true);
    if (st.engineEnabled === false || st.injectIntoPrompt === false) {
      unregisterInjection();
      return '';
    }
    const state = stateOverride || data().loadState();
    const content = buildInjectionText(state, st, { storyDay: core()?.getLastStoryDay?.() });
    const ctx = window.SillyTavern?.getContext?.();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, content, 1, 1);
    return content;
  }

  // ================= Nối ngược sang Công Cụ Thế Giới =================
  // Gọi từ world-engine-evolution.js khi ráp prompt suy diễn thế giới.

  function buildWorldEngineContext(worldState) {
    const st = settings();
    if (st.injectIntoWorldEngine === false) return '';

    const state = data().loadState();
    const limit = Math.max(0, parseInt(st.worldEngineNpcLimit) || 0);
    if (!limit) return '';

    const lines = state.npcs
      .filter(npc => npc.tier === 'core' && !npc.status.archived)
      .sort((a, b) => (b.significance || 0) - (a.significance || 0))
      .slice(0, limit)
      .map(npc => {
        const bits = [`${npc.name} (${describePath(npc.location.path)})`];
        if (npc.faction?.name) bits.push(`thuộc ${npc.faction.name}`);
        const goal = asArray(npc.goals)[0];
        if (goal?.text) bits.push(`đang: ${clean(goal.text)}`);
        if (npc.pendingIntent?.action) bits.push(`dự định: ${clean(npc.pendingIntent.action)}`);
        // Việc họ ĐÃ LÀM, không chỉ việc họ định làm. Thiếu vế này thì Công Cụ Thế Giới suy diễn
        // cục diện mà không biết nhân vật trọng yếu vừa động thủ — vĩ mô mù trước hệ quả của vi mô.
        const done = asArray(npc.offscreenLog).slice(-1)[0];
        if (done?.action) bits.push(`vừa làm: ${clean(done.action)}`);
        return '· ' + bits.join(' — ');
      });

    if (!lines.length) return '';
    return `【NHÂN VẬT TRỌNG YẾU VÀ DỰ ĐỊNH CỦA HỌ】\n${lines.join('\n')}\n`
      + 'Đây là kết quả suy diễn hậu trường của Công Cụ Nhân Vật ở lượt trước. Hãy tính tới nó khi '
      + 'suy diễn cục diện: việc nhân vật trọng yếu vừa làm có thể tác động tới thế lực và sự kiện.';
  }

  // ================= Gọi API =================

  // Tham số đầu của callApi phải là CHUỖI: bên trong nó tự bọc thành [{ role: 'user', content: prompt }].
  // Truyền mảng messages vào sẽ khiến content thành mảng object và API trả HTTP 400
  // ("at least one contents field is required").
  async function callModel(prompt, st) {
    if (typeof prompt !== 'string') {
      throw new Error('Prompt gửi cho API phải là chuỗi, nhận được: ' + typeof prompt);
    }
    const retries = Math.max(0, Number(st.apiAutoRetries) || 0);
    lastDebug = { prompt, apiResponse: '', parsed: null, error: '' };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await window.WORLD_ENGINE_API.callApi(
          prompt, st.maxTokens, st.temperature, abortController?.signal, st
        );
        lastDebug.apiResponse = raw;
        const parsed = window.WORLD_ENGINE_API.parseJSON(raw);
        lastDebug.parsed = clone(parsed);
        return parsed;
      } catch (error) {
        lastDebug.error = String(error?.message || error);
        if (abortController?.signal?.aborted || attempt >= retries) throw error;
      }
    }
    throw new Error('Yêu cầu API nhân vật thất bại');
  }

  // Đọc các mục Sổ Tay Thế Giới đã chọn, theo phạm vi riêng 'npc'.
  // Mục 🔵 thường trực thì luôn vào; mục 🟢 từ khoá chỉ vào khi văn bản quét có nhắc tới —
  // nên gọi hàm này với văn bản quét khác nhau ở mỗi pha sẽ ra tư liệu khác nhau, đúng như mong muốn.
  async function buildWorldbookSection(scanText, st) {
    if (st.worldbookEnabled === false) return '';
    try {
      return await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.(clean(scanText), 'npc') || '';
    } catch (error) {
      console.error('[Công Cụ Nhân Vật] Đọc Sổ Tay Thế Giới thất bại (đã cách ly)', error);
      return '';
    }
  }

  // Văn bản quét cho pha hoạt động ngầm. Hội thoại lượt này gần như vô dụng ở đây: NPC đang vắng mặt
  // nên tên họ, nơi họ ở và mục tiêu họ đuổi theo mới là thứ cần khớp từ khoá. Nhờ vậy nhân vật đang
  // trên đường tới Trường An sẽ kéo được mục lorebook về Trường An, dù cả lượt không ai nhắc tới nó.
  function offscreenScanText(absent, worldDigest) {
    const parts = [clean(worldDigest)];
    for (const npc of absent) {
      parts.push(clean(npc.name));
      parts.push(...asArray(npc.aliases).map(clean));
      parts.push(describePath(npc.location?.path));
      if (npc.location?.movingTo) parts.push(describePath(npc.location.movingTo));
      if (npc.faction?.name) parts.push(clean(npc.faction.name));
      for (const goal of asArray(npc.goals)) parts.push(clean(goal?.text));
      if (npc.pendingIntent?.action) parts.push(clean(npc.pendingIntent.action));
    }
    return parts.filter(Boolean).join('\n');
  }

  // ================= Luồng chính =================
  // Gọi từ world-engine.js sau khi suy diễn thế giới hoàn tất. Thứ tự: thế giới xong → nhân vật chạy,
  // nên hoạt động ngầm của lượt này phản ứng được với diễn biến thế giới vừa sinh ra trong chính lượt này.

  async function ingestWorldEvolution(payload) {
    const st = settings(true);
    if (st.engineEnabled === false) {
      setStatus(SKIP_REASONS.disabled);
      return { skipped: true, reason: 'disabled', message: SKIP_REASONS.disabled };
    }
    if (running) {
      // Bỏ qua chứ không phải thất bại: một tác vụ khác đang chạy và sẽ hoàn tất bình thường.
      return { skipped: true, reason: 'running', message: SKIP_REASONS.running };
    }

    const layer = asLayer(payload?.layer) ?? core()?.getChatLayer?.() ?? null;
    const replace = payload?.replace === true;
    // Lọc bằng regex RIÊNG của engine này, ngay tại cửa vào. Văn bản tới đây có thể đã qua bộ lọc
    // của Công Cụ Thế Giới, nhưng đó là bộ lọc khác với cấu hình khác — hai engine đọc cùng một
    // đoạn chat mà cần cắt bỏ hai thứ khác nhau là chuyện bình thường.
    const dialogue = filterDialogue(payload?.dialogue, st);

    running = true;
    runningLabel = 'Trích xuất nhân vật';
    abortController = new AbortController();
    notifyBusyChanged();
    setStatus('Đang trích xuất nhân vật...');

    try {
      // Reroll (replace=true) thì dựng lại từ điểm lưu, để lần sinh mới không chồng lên lần sinh cũ.
      const base = replace ? (data().loadCheckpoint() || data().loadState()) : data().loadState();
      if (!replace) data().saveCheckpoint(base);

      const state = clone(base);
      state.round = Math.max(0, (parseInt(state.round) || 0) + (replace ? 0 : 1));
      state.chatLayer = layer;
      state.worldLink = {
        lastWorldRound: parseInt(payload?.worldRound) || state.worldLink.lastWorldRound,
        lastDigest: clean(payload?.worldDigest)
      };

      const previousTime = state.storyTime || {};

      // Sổ Tay Thế Giới: các mục người dùng đã chọn ở tab Worldbook, phạm vi lưu riêng của engine này.
      // Mục kiểu từ khoá chỉ bật khi văn bản quét có nhắc tới, nên hai pha cần hai văn bản quét khác nhau
      // (xem buildWorldbookSection). Cách ly lỗi: lorebook hỏng thì hai pha vẫn phải chạy.
      const worldbook = await buildWorldbookSection(
        dialogue + '\n' + clean(payload?.worldDigest), st
      );

      // --- Pha 1: trích xuất nhân vật từ hội thoại ---
      const extraction = await callModel(window.NPC_ENGINE_PROMPT.buildPrompt({
        npcs: state.npcs,
        knownLimit: st.npcCoreLimit * 2,
        dialogue,
        worldDigest: clean(payload?.worldDigest),
        worldbook,
        tonePrompt: st.tonePrompt,
        nameBlacklist: st.nameBlacklist,
        previousTimeLabel: previousTime.label,
        pendingFacts: asArray(state.publicFacts).filter(fact => fact.acknowledged !== true).slice(-12),
        storyDay: asLayer(state.lastStoryDay)
      }), st);
      const merged = mergeExtraction(state, extraction, layer);

      // Sự việc hậu trường vừa được AI chính kể ra thì từ đây mới tính là chuyện trong truyện.
      const acknowledged = acknowledgeFacts(state, extraction?.acknowledgedFacts);

      // Đọc thời gian PHẢI làm sau trích xuất, vì chính mô hình là thứ đọc ra nó từ chính văn.
      // Đây cũng là chỗ duy nhất làm đồng hồ thế giới nhích lên.
      const time = readStoryTime(state, extraction, st);

      // Hành trình và lịch hẹn đều chạy theo đồng hồ, nên phải đếm SAU khi đồng hồ đã nhích.
      const arrived = data().tickTravel(state);
      const intents = data().tickIntents(state, time.elapsedMinutes,
        { fallbackMinutes: st.fallbackMinutesPerTurn });

      // --- Pha 2: hoạt động ngầm cho NPC trọng yếu đang vắng mặt ---
      let offscreen = { acted: [], rumors: [], moves: [], traces: [] };
      const absent = state.npcs.filter(npc =>
        npc.tier === 'core' &&
        !npc.status.archived &&
        npc.status.alive !== false &&
        !asArray(state.scene.presentIds).includes(npc.id));

      // Engine chọn sẵn ai được đẩy lượt này, thay vì gửi hết rồi để mô hình quyết.
      const selection = selectOffscreenNpcs(state, absent, {
        limit: st.offscreenMaxPerRound,
        dialogue,
        worldDigest: payload?.worldDigest
      });
      lastSelection = selection.scored;

      if (st.offscreenEnabled !== false && selection.chosen.length) {
        runningLabel = 'Suy diễn hoạt động ngầm';
        setStatus(`Đang suy diễn hoạt động ngầm cho ${selection.chosen.length}/${absent.length} nhân vật vắng mặt...`);
        const activities = await callModel(window.NPC_ENGINE_OFFSCREEN.buildPrompt({
          absentNpcs: selection.chosen,
          skippedCount: selection.skipped.length,
          worldDigest: clean(payload?.worldDigest),
          worldbook: await buildWorldbookSection(offscreenScanText(absent, payload?.worldDigest), st),
          sceneSummary: describePath(state.scene.location),
          travelCache: state.travelCache,
          worldScale: st.worldScale,
          elapsedDays: time.elapsed,
          elapsedMinutes: time.elapsedMinutes,
          clockLabel: data().formatClock(time.nowMinutes),
          nowMinutes: time.nowMinutes,
          timeLabel: time.label,
          previousTimeLabel: previousTime.label,
          dueIntentIds: intents.due,
          aggressiveness: st.offscreenAggressiveness,
          maxActivities: st.offscreenMaxPerRound,
          storyDay: time.day
        }), st);
        offscreen = applyOffscreen(state, activities, layer);
      }

      data().saveState(state);
      applyInjection(state);

      // Đánh dấu tin nhắn này đã xử lý, để đường chạy còn lại không làm lại lần nữa.
      {
        const ctx = window.SillyTavern?.getContext?.();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        if (ctx && lastMsg && !lastMsg.is_user) lastProcessedKey = messageKeyOf(ctx, chat, lastMsg);
      }
      clearAutoTimer();

      // Làm mới bảng điều khiển ngay, nếu không người dùng phải đóng rồi mở lại mới thấy kết quả.
      try { window.WORLD_ENGINE_UI?.refresh?.(true); }
      catch (error) { console.warn('[Công Cụ Nhân Vật] Làm mới giao diện thất bại (đã cách ly)', error); }

      const core_ = state.npcs.filter(npc => npc.tier === 'core').length;
      const summary = [
        `${merged.added.length} mới`,
        `${merged.updated.length} cập nhật`,
        `${core_} trọng yếu`,
        offscreen.acted.length ? `${offscreen.acted.length} hoạt động ngầm` : '',
        offscreen.rumors.length ? `${offscreen.rumors.length} tin đồn` : '',
        offscreen.traces.length ? `${offscreen.traces.length} dấu vết` : '',
        acknowledged.length ? `${acknowledged.length} chuyện vào truyện` : '',
        merged.deaths.length ? `${merged.deaths.length} qua đời` : '',
        // Báo ra ngoài luôn: sổ mâu thuẫn chỉ có tác dụng nếu người chơi biết là có gì mới trong đó.
        merged.conflicts.length ? `${merged.conflicts.length} mâu thuẫn` : ''
      ].filter(Boolean).join(' · ');
      setStatus('Hoàn tất — ' + summary);

      return {
        skipped: false,
        arrived,
        added: merged.added,
        updated: merged.updated,
        deaths: merged.deaths,
        acted: offscreen.acted,
        rumors: offscreen.rumors,
        message: summary
      };
    } catch (error) {
      setStatus('Thất bại: ' + (error?.message || error), true);
      throw error;
    } finally {
      running = false;
      runningLabel = '';
      abortController = null;
      notifyBusyChanged();
    }
  }

  // ================= Chạy tự động độc lập =================
  // Trước đây engine này không có lịch chạy riêng, chỉ bám vào performEvolution của Công Cụ Thế Giới.
  // Hệ quả: Thế Giới để chế độ thủ công, hoặc suy diễn cách quãng, hoặc bị tắt, hoặc lượt đó suy diễn
  // thất bại — thì hồ sơ nhân vật đứng im mà không báo gì. Nay có bộ hẹn giờ riêng làm đường dự phòng.

  function messageKeyOf(ctx, chat, message) {
    const messageId = message?.mesId ?? message?.message_id ?? message?.send_date ?? (chat.length - 1);
    const swipeId = message?.swipe_id ?? message?.swipeId ?? '';
    return [core()?.getChatId?.() || 'default', chat.length - 1, messageId, swipeId].join('|');
  }

  function clearAutoTimer() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }

  // Ghép hội thoại gần nhất để trích xuất. Lấy từ cuối chat ngược lên, bỏ tin nhắn rỗng.
  // Regex lọc nội dung của Công Cụ Nhân Vật. Trước đây ô cấu hình này có mặt trong giao diện, lưu
  // được, hiện cả trong gói chẩn đoán — nhưng KHÔNG chỗ nào đọc tới, nên người dùng gõ vào đó rồi
  // tưởng đã lọc mà thật ra chưa. Đây là chỗ nó thật sự có tác dụng.
  //
  // Quan trọng với ai dùng preset sinh khối trạng thái kẹp trong chính văn: khối đó do AI chính bịa
  // ra, không phải chuyện đã xảy ra. Không cắt bỏ thì engine đọc nó như sự thật rồi dựng hồ sơ theo.
  function filterDialogue(text, st) {
    const raw = clean(st?.filterRegex);
    if (!raw) return clean(text);
    // filterDialogue của core đọc khoá evolveFilterRegex — đó là khoá của Công Cụ Thế Giới, nên
    // phải nhét regex của engine này vào đúng tên khoá đó thay vì truyền cả bộ cài đặt.
    try { return clean(core()?.filterDialogue?.(clean(text), { evolveFilterRegex: raw }) ?? text); }
    catch (error) { console.warn('[Công Cụ Nhân Vật] Regex lọc lỗi, dùng nguyên văn', error); return clean(text); }
  }

  function buildDialogueText(chat, rounds) {
    const wanted = Math.max(1, parseInt(rounds) || 1) * 2;
    return asArray(chat).slice(-wanted)
      .map(message => `${message?.is_user ? 'Người chơi' : (clean(message?.name) || 'Nhân vật')}: ${clean(message?.mes)}`)
      .filter(line => line.split(': ').slice(1).join(': ').length > 0)
      .join('\n');
  }

  async function runAutoExtraction(expectedKey) {
    autoTimer = null;
    const st = settings(true);
    if (st.engineEnabled === false || st.evolveMode === 'manual') return;

    // Đang có tác vụ chạy (thường là đường Thế Giới gọi sang): hẹn lại chứ không bỏ cuộc.
    // Bỏ cuộc ở đây thì nếu tác vụ kia thất bại giữa chừng, lượt này mất luôn mà không ai biết.
    if (running) {
      if (autoRetries < AUTO_MAX_RETRIES) {
        autoRetries += 1;
        autoTimer = setTimeout(() => runAutoExtraction(expectedKey), AUTO_RETRY_MS);
      }
      return;
    }

    const ctx = window.SillyTavern?.getContext?.();
    const chat = ctx?.chat || [];
    const lastMsg = chat[chat.length - 1];
    if (!ctx || !lastMsg || lastMsg.is_user || !clean(lastMsg.mes)) return;
    if (messageKeyOf(ctx, chat, lastMsg) !== expectedKey) return;

    // Đường chính đã xử lý tin nhắn này rồi thì thôi.
    if (lastProcessedKey === expectedKey) return;

    // Công Cụ Thế Giới đang gọi API: chờ nó xong đã, vì hoạt động ngầm cần worldDigest của lượt này.
    // Hết số lần chờ mà nó vẫn chạy thì tự chạy luôn với tóm tắt cũ, còn hơn là đứng im.
    const worldBusy = window.WORLD_ENGINE_EVOLUTION?.isRunning?.() === true;
    if (worldBusy && autoRetries < AUTO_MAX_RETRIES) {
      autoRetries += 1;
      autoTimer = setTimeout(() => runAutoExtraction(expectedKey), AUTO_RETRY_MS);
      return;
    }
    autoRetries = 0;

    const worldState = core()?.loadState?.() || {};
    const layer = core()?.getChatLayer?.();

    // Reroll hoặc sửa rồi gửi lại: tầng này đã xử lý rồi, phải dựng lại từ điểm lưu chứ không nối
    // thêm — nếu không, nhân vật của lần sinh bị bỏ vẫn nằm nguyên trong hồ sơ.
    //
    // Ở đây so sánh số tầng là AN TOÀN, khác với trường hợp của Công Cụ Thế Giới: hàm này chạy sau
    // GENERATION_ENDED nên tin nhắn đã nằm trong chat rồi. Chỗ từng gây hồi quy ở v2.3.18 là
    // GENERATION_STARTED, phát ra TRƯỚC khi tầng được đẩy vào chat.
    const npcState = data().loadState();
    const stateLayer = asLayer(npcState.chatLayer);
    const replace = stateLayer !== null && asLayer(layer) !== null && Number(layer) <= stateLayer;

    try {
      await ingestWorldEvolution({
        layer,
        worldRound: worldState.round,
        worldDigest: worldState.worldDigest,
        worldUpdate: worldState.lastEvolveResult,
        dialogue: buildDialogueText(chat, st.evolveReadRounds),
        replace
      });
    } catch (error) {
      console.error('[Công Cụ Nhân Vật] Chạy tự động thất bại', error);
    }
  }

  function onMessageReceived() {
    clearAutoTimer();
    autoRetries = 0;
    const ctx = window.SillyTavern?.getContext?.();
    const chat = ctx?.chat || [];
    const lastMsg = chat[chat.length - 1];
    if (!ctx || !lastMsg || lastMsg.is_user || !clean(lastMsg.mes)) return;
    const key = messageKeyOf(ctx, chat, lastMsg);
    if (lastProcessedKey === key) return;
    autoTimer = setTimeout(() => runAutoExtraction(key), AUTO_DELAY_MS);
  }

  // ================= Điền lại hàng loạt =================
  // Cài extension giữa chừng một cuộc trò chuyện dài thì toàn bộ quá khứ nằm ngoài tầm với:
  // engine chỉ đi tới từ lúc bật. Hàm này quét ngược từ tầng đầu, chia đợt gọi API để dựng hồ sơ.
  // Chỉ chạy pha trích xuất, không sinh hoạt động ngầm — quá khứ đã có chính văn rồi, bịa thêm
  // diễn biến nền vào đó chỉ tạo mâu thuẫn với những gì thật sự đã xảy ra.

  let backfillRunning = false;
  let backfillStatus = { running: false, current: 0, total: 0, message: '' };

  function setBackfillStatus(current, total, message) {
    backfillStatus = { running: backfillRunning, current, total, message };
    // Chuỗi "Đang điền lại i/M" là thứ quả cầu nổi nhận ra để vẽ vòng tiến độ.
    setStatus(total ? `Đang điền lại ${current}/${total} · ${message}` : message);
  }

  function formatRange(chat, from, to) {
    return asArray(chat).slice(from, to + 1)
      .map(message => `${message?.is_user ? 'Người chơi' : (clean(message?.name) || 'Nhân vật')}: ${clean(message?.mes)}`)
      .filter(line => line.split(': ').slice(1).join(': ').length > 0)
      .join('\n');
  }

  function stopBackfill() {
    if (!backfillRunning) return false;
    backfillRunning = false;
    setStatus('Đã yêu cầu dừng điền lại');
    return true;
  }

  async function backfill() {
    const st = settings(true);
    if (st.engineEnabled === false) throw new Error('Công Cụ Nhân Vật đang tắt');
    if (backfillRunning || running) return { skipped: true, reason: 'running' };

    const chat = window.SillyTavern?.getContext?.()?.chat || [];
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(chat.length - 1, configuredEnd || chat.length - 1);
    const skipOpening = st.firstLayerIsAiOpening !== false;
    const aiLayers = chat
      .map((message, index) => (!message?.is_user && index <= end && !(skipOpening && index === 0) ? index : -1))
      .filter(index => index >= 0);

    const size = Math.max(1, parseInt(st.backfillBatchSize) || 5);
    const batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setBackfillStatus(0, 0, 'Không có tầng AI nào để điền lại'); return { skipped: true, reason: 'empty' }; }

    backfillRunning = true;
    notifyBusyChanged();
    abortController = new AbortController();

    // Sao lưu trước khi xoá: điền lại là thao tác ghi đè toàn bộ, không có đường lùi nào khác.
    try { window.WORLD_ENGINE_CHATCACHE?.forScope?.('npc')?.createSnapshot?.('Tự động trước khi điền lại'); }
    catch (error) { console.warn('[Công Cụ Nhân Vật] Không tạo được bản lưu trước khi điền lại', error); }

    const original = data().loadState();
    data().saveCheckpoint(original);
    // Giữ lại bộ nhớ đệm tuyến đường: đó là hiểu biết về địa lý thế giới, không phải trạng thái chat.
    data().saveState({
      ...data().defaultState(),
      travelCache: original.travelCache
    });

    try {
      const storyDay = core()?.getLastStoryDay?.();
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i];
        const from = Math.max(0, layers[0] - 1);
        const to = layers[layers.length - 1];
        setBackfillStatus(i + 1, batches.length, `tầng ${from}-${to}`);

        const state = data().loadState();
        // Điền lại cũng phải qua bộ lọc: quét lại quá khứ mà không cắt khối trạng thái của preset
        // thì hồ sơ dựng lên còn sai nhiều hơn lúc chạy trực tiếp, vì nó nuốt hàng chục lượt một lúc.
        const dialogue = filterDialogue(formatRange(chat, from, to), st);
        if (!dialogue) continue;

        const parsed = await callModel(window.NPC_ENGINE_PROMPT.buildPrompt({
          npcs: state.npcs,
          knownLimit: st.npcCoreLimit * 2,
          dialogue,
          worldbook: await buildWorldbookSection(dialogue, st),
          tonePrompt: st.tonePrompt,
          nameBlacklist: st.nameBlacklist,
          storyDay
        }), st);

        state.round += 1;
        state.chatLayer = to;
        mergeExtraction(state, parsed, to);
        data().saveState(state);
      }

      const finished = backfillRunning;
      setBackfillStatus(batches.length, batches.length, finished ? 'hoàn tất' : 'đã dừng');
      setStatus(finished ? 'Điền lại hoàn tất' : 'Điền lại đã dừng giữa chừng');
      return { skipped: false, batches: batches.length, finished };
    } catch (error) {
      setStatus('Điền lại thất bại: ' + (error?.message || error), true);
      throw error;
    } finally {
      backfillRunning = false;
      backfillStatus.running = false;
      abortController = null;
      applyInjection();
      notifyBusyChanged();
      try { window.WORLD_ENGINE_UI?.refresh?.(true); } catch (error) { /* không có UI thì thôi */ }
    }
  }

  // ================= Chọn nhân vật cho pha hoạt động ngầm =================
  // Gửi toàn bộ NPC vắng mặt rồi bảo mô hình tự chọn có hai cái dở: prompt phình theo số nhân vật,
  // và việc "ai đáng được đẩy lượt này" bị phó mặc cho mô hình — nó hay chọn theo thứ tự danh sách.
  //
  // Engine chấm điểm rồi chọn sẵn. Người không được chọn thì GIỮ NGUYÊN trạng thái, không bịa
  // hoạt động — đứng yên một lượt là hợp lý, còn bịa ra việc cho đủ người thì phá truyện.

  function scoreOffscreen(npc, context) {
    let score = 0;
    const reasons = [];

    // Dự định đến hạn phải được kết trong lượt này, nếu không nó treo tiếp — ưu tiên cao nhất.
    if (npc.pendingIntent?.due) { score += 100; reasons.push('dự định đến hạn'); }
    else if (npc.pendingIntent?.action) { score += 25; reasons.push('có dự định'); }

    // Đang đi đường thì cần đếm tiếp, nếu không hành trình đứng im.
    if (npc.location?.movingTo && npc.location.etaRounds > 0) { score += 40; reasons.push('đang đi đường'); }

    // Được nhắc tới trong chính văn lượt này: người chơi vừa nghĩ tới họ.
    if (context.mentioned.has(npc.id)) { score += 60; reasons.push('vừa được nhắc tới'); }

    // Ở gần cảnh của người chơi thì dễ giao cắt, đáng theo dõi hơn người ở tận đâu.
    const near = data().proximity(npc.location?.path, context.sceneLocation);
    if (near === data().PROXIMITY.SAME_CITY || near === data().PROXIMITY.SAME_SPOT) {
      score += 30; reasons.push('cùng thành với người chơi');
    } else if (near === data().PROXIMITY.SAME_REGION) {
      score += 15; reasons.push('cùng vùng');
    }

    // Mục tiêu còn dở thì còn chuyện để làm.
    if (asArray(npc.goals).some(goal => clean(goal?.text) && !/hoàn tất|thất bại/i.test(clean(goal?.progress)))) {
      score += 20; reasons.push('mục tiêu còn dở');
    }

    score += Math.round((parseInt(npc.significance) || 0) / 5);   // 0–20 theo mức thiết yếu

    // Công bằng: lâu không được đẩy thì cộng dần, để không phải lúc nào cũng đúng mấy người đó.
    const lastLog = asArray(npc.offscreenLog).at(-1);
    const lastRound = parseInt(lastLog?.round);
    const idle = Number.isFinite(lastRound) ? Math.max(0, context.round - lastRound) : 99;
    const idleBonus = Math.min(25, idle * 5);
    if (idleBonus > 0) { score += idleBonus; reasons.push(`lâu chưa có diễn biến (${idle === 99 ? 'chưa lần nào' : idle + ' lượt'})`); }

    return { score, reasons };
  }

  function selectOffscreenNpcs(state, absent, options) {
    const limit = Math.max(0, parseInt(options?.limit) || 0);
    if (!limit) return { chosen: [], skipped: absent.map(npc => npc.id), scored: [] };

    // Tên nào xuất hiện trong chính văn hoặc tóm tắt thế giới lượt này.
    const haystack = normalized(`${clean(options?.dialogue)}\n${clean(options?.worldDigest)}`);
    const mentioned = new Set(absent
      .filter(npc => [npc.name, ...asArray(npc.aliases)]
        .map(clean).filter(Boolean)
        .some(name => haystack.includes(normalized(name))))
      .map(npc => npc.id));

    const context = {
      mentioned,
      sceneLocation: asArray(state.scene?.location),
      round: Math.max(0, parseInt(state.round) || 0)
    };

    const scored = absent
      .map(npc => ({ npc, ...scoreOffscreen(npc, context) }))
      .sort((a, b) => b.score - a.score);

    return {
      chosen: scored.slice(0, limit).map(item => item.npc),
      skipped: scored.slice(limit).map(item => item.npc.id),
      scored: scored.map(item => ({ id: item.npc.id, name: item.npc.name, score: item.score, reasons: item.reasons }))
    };
  }

  // ================= Đọc thời gian truyện =================
  // Bắt người dùng cấu hình 6 ô regex mới đọc được thời gian là đòi hỏi vô lý, và phần lớn truyện
  // viết mốc thời gian bằng lời ("ba ngày sau", "sáng hôm sau") chứ không theo khuôn cố định.
  // Công Cụ Thế Giới giải quyết bằng cách bảo thẳng mô hình tự ước lượng từ chính văn; ở đây làm
  // giống vậy — engine đã gửi nguyên văn hội thoại đi rồi, hỏi luôn là xong.
  //
  // Thứ tự ưu tiên: bộ parse theo regex nếu người dùng có cấu hình (tất định), sau đó tới mô hình.
  function readStoryTime(state, extraction, st) {
    const parsedDay = core()?.getLastStoryDay?.();
    const reported = extraction?.time || {};
    const label = clean(reported.label);
    const previousDay = asLayer(state.lastStoryDay);

    // Mô hình báo ngày/giờ/phút; bản cũ chỉ có elapsedDays nên vẫn đọc được.
    let elapsedMinutes = data().toMinutes(reported.elapsed);
    if (elapsedMinutes === null && Number.isFinite(Number(reported.elapsedDays))) {
      elapsedMinutes = Math.max(0, Math.round(Number(reported.elapsedDays))) * data().MINUTES_PER_DAY;
    }

    let day = asLayer(parsedDay);
    let source = elapsedMinutes === null ? 'none' : 'model';

    // Bộ parse theo regex của Công Cụ Thế Giới tất định hơn, nên nó thắng khi có cấu hình.
    if (day !== null && previousDay !== null) {
      // Đồng hồ không bao giờ được kéo lùi: mọi lịch hẹn đều neo vào nó, lùi một cái là dự định
      // đã hoàn tất bỗng chưa tới hạn trở lại. Kẹp về 0 rồi ghi sổ, đừng nuốt im lặng.
      if (day < previousDay) {
        data().recordConflict(state, {
          kind: data().CONFLICT_KINDS.CLOCK, field: 'ngày truyện',
          from: `ngày ${previousDay}`, to: `ngày ${day}`,
          note: 'giữ nguyên đồng hồ, không kéo lùi',
          layer: asLayer(state.chatLayer), atMinutes: data().clockMinutes(state)
        });
      }
      elapsedMinutes = Math.max(0, day - previousDay) * data().MINUTES_PER_DAY;
      source = 'regex';
    } else if (day !== null) {
      source = 'regex';
    }

    // Không đọc được gì thì vẫn nhích một bước mặc định, thà ước lượng thô còn hơn đứng im
    // vĩnh viễn — mọi lịch hẹn đều treo nếu đồng hồ không bao giờ chạy.
    const fallback = Math.max(0, parseInt(st?.fallbackMinutesPerTurn) || 0);
    const advanced = elapsedMinutes === null ? fallback : elapsedMinutes;
    data().advanceClock(state, advanced);

    const nowMinutes = data().clockMinutes(state);
    if (day === null) day = Math.floor(nowMinutes / data().MINUTES_PER_DAY);
    state.lastStoryDay = day;
    state.storyTime = {
      label,
      day,
      elapsedDays: Math.floor(advanced / data().MINUTES_PER_DAY),
      elapsedMinutes: advanced,
      nowMinutes,
      clockLabel: data().formatClock(nowMinutes),
      source
    };
    return { day, elapsed: Math.floor(advanced / data().MINUTES_PER_DAY), elapsedMinutes: advanced, nowMinutes, label, source };
  }

  // ================= Xem tại chỗ =================
  // Nhìn trộm xem nhân vật đang làm gì lúc này. KHÔNG lưu trạng thái, KHÔNG tiến đồng hồ,
  // KHÔNG gửi vào chat — chỉ trả về văn xuôi cho người chơi đọc ở bảng điều khiển.
  async function peekNpc(idOrName) {
    const st = settings(true);
    if (st.engineEnabled === false) throw new Error('Công Cụ Nhân Vật đang tắt');
    if (running) throw new Error('Đang có tác vụ chạy, vui lòng đợi');

    const state = data().loadState();
    const npc = data().findNpc(state, idOrName);
    if (!npc) throw new Error('Không tìm thấy nhân vật này');

    const worldState = core()?.loadState?.() || {};
    const nowMinutes = data().clockMinutes(state);

    running = true;
    runningLabel = 'Quan sát nhân vật';
    abortController = new AbortController();
    notifyBusyChanged();
    setStatus(`Đang xem ${npc.name} làm gì...`);

    try {
      const raw = await window.WORLD_ENGINE_API.callApi(
        window.NPC_ENGINE_OFFSCREEN.buildPeekPrompt({
          npc,
          nowMinutes,
          clockLabel: data().formatClock(nowMinutes),
          worldDigest: clean(worldState.worldDigest)
        }),
        st.maxTokens, st.temperature, abortController?.signal, st
      );
      setStatus(`Đã xem ${npc.name}`);
      // Cố ý KHÔNG saveState: xem là xem, không phải một lượt diễn biến.
      return { name: npc.name, text: clean(raw) };
    } catch (error) {
      setStatus('Xem thất bại: ' + (error?.message || error), true);
      throw error;
    } finally {
      running = false;
      runningLabel = '';
      abortController = null;
      notifyBusyChanged();
    }
  }

  // ================= Chữa dữ liệu =================

  // Quét và sửa những chỗ không nhất quán tích tụ sau nhiều lượt: id trùng, tham chiếu tới nhân vật
  // không còn tồn tại, tri thức trỏ tới sự thật đã bị xoá, nhân vật trong kho còn nằm ở danh sách
  // hoạt động. Chỉ sửa, không xoá dữ liệu thật.
  function repairState(state) {
    const fixed = { duplicateIds: 0, danglingRelations: 0, danglingFacts: 0, misplacedArchive: 0, missingIds: 0 };
    const seen = new Set();

    for (const npc of [...state.npcs, ...state.archive]) {
      if (!clean(npc.id)) { npc.id = data().nextNpcId(state); fixed.missingIds += 1; }
      if (seen.has(npc.id)) { npc.id = data().nextNpcId(state); fixed.duplicateIds += 1; }
      seen.add(npc.id);
    }

    const names = new Set([...state.npcs, ...state.archive].map(npc => normalized(npc.name)));
    const factIds = new Set(asArray(state.publicFacts).map(fact => fact.id));

    for (const npc of [...state.npcs, ...state.archive]) {
      const relations = asArray(npc.relations?.npcs);
      const kept = relations.filter(link => !clean(link?.name) || names.has(normalized(link.name)));
      fixed.danglingRelations += relations.length - kept.length;
      npc.relations.npcs = kept;

      // factId trỏ tới sự thật đã biến mất thì gỡ liên kết, giữ lại nội dung tri thức.
      for (const item of asArray(npc.knowledge)) {
        if (item.factId && !factIds.has(item.factId)) { item.factId = null; fixed.danglingFacts += 1; }
      }
    }

    // Đánh dấu đã vào kho mà vẫn nằm ở danh sách hoạt động: chuyển về đúng chỗ.
    const misplaced = state.npcs.filter(npc => npc.status?.archived === true);
    for (const npc of misplaced) data().archiveNpc(state, npc.id, npc.status.condition);
    fixed.misplacedArchive = misplaced.length;

    state.scene.presentIds = asArray(state.scene?.presentIds).filter(id => seen.has(id));
    return fixed;
  }

  // Đối soát với lịch sử chat thật: tầng hiện tại ngắn hơn tầng đã ghi thì lùi về cho khớp.
  // Xoá lùi nhiều tầng một lúc thì điểm lưu một cấp không phủ hết, phải lọc theo dấu tầng.
  function reconcileHistory() {
    const layer = core()?.getChatLayer?.();
    if (!Number.isFinite(Number(layer))) return { changed: false, reason: 'no_layer' };
    const state = data().loadState();
    const stateLayer = asLayer(state.chatLayer);
    if (stateLayer === null || Number(layer) >= stateLayer) {
      const fixed = repairState(state);
      data().saveState(state);
      return { changed: false, repaired: fixed };
    }
    data().rollbackToLayer(state, Number(layer));
    const fixed = repairState(state);
    data().saveState(state);
    applyInjection(state);
    setStatus(`Đã đối soát về tầng ${layer}`);
    return { changed: true, layer: Number(layer), dropped: state.lastRollback?.dropped, repaired: fixed };
  }

  // ================= Sự kiện =================

  function onGenerationStarted(type, _opts, dryRun) {
    if (dryRun) return;
    // Nhận diện reroll bằng type gốc của Tavern. Tiêu chí thuần số (chatLayer === state.chatLayer) từng
    // gây hồi quy ở Công Cụ Thế Giới v2.3.18, vì GENERATION_STARTED phát ra trước khi tầng người dùng
    // được đẩy vào chat — lượt mới sẽ bị hiểu nhầm thành reroll.
    if (type === 'swipe' || type === 'regenerate') {
      const checkpoint = data().loadCheckpoint();
      if (checkpoint) applyInjection(checkpoint); else unregisterInjection();
      return;
    }
    applyInjection();
  }

  function onMessageSwiped() {
    const checkpoint = data().loadCheckpoint();
    if (checkpoint) applyInjection(checkpoint); else unregisterInjection();
  }

  function onMessageDeleted() {
    const layer = core()?.getChatLayer?.();
    if (!Number.isFinite(Number(layer))) return;
    const state = data().loadState();
    if (asLayer(state.chatLayer) === null || Number(layer) >= state.chatLayer) return;
    data().rollbackToLayer(state, Number(layer));
    data().saveState(state);
    applyInjection(state);
  }

  function init() {
    const ctx = window.SillyTavern?.getContext?.();
    if (!ctx?.eventSource) {
      console.warn('[Công Cụ Nhân Vật] Không gắn được sự kiện');
      return false;
    }
    const guard = window.WORLD_ENGINE_GUARD_EVENT || ((_label, _event, handler) => handler);
    const types = ctx.event_types || {};

    ctx.eventSource.on(types.GENERATION_STARTED || 'generation_started',
      guard('Công Cụ Nhân Vật', 'Bắt Đầu Sinh', onGenerationStarted));
    ctx.eventSource.on(types.MESSAGE_SWIPED || 'message_swiped',
      guard('Công Cụ Nhân Vật', 'Vuốt Tái Sinh', onMessageSwiped));
    ctx.eventSource.on(types.MESSAGE_DELETED || 'message_deleted',
      guard('Công Cụ Nhân Vật', 'Xóa Tin Nhắn', onMessageDeleted));
    ctx.eventSource.on(types.CHAT_LOADED || 'chat_loaded',
      guard('Công Cụ Nhân Vật', 'Tải Trò Chuyện', () => { reconcileHistory(); applyInjection(); }));
    // Lịch chạy riêng: không phụ thuộc việc Công Cụ Thế Giới có suy diễn lượt này hay không.
    ctx.eventSource.on(types.GENERATION_ENDED || types.MESSAGE_RECEIVED || 'message_received',
      guard('Công Cụ Nhân Vật', 'Sinh Xong', onMessageReceived));

    applyInjection();
    return true;
  }

  function abort() {
    if (abortController) abortController.abort();
    backfillRunning = false;
    running = false;
    runningLabel = '';
    setStatus('Đã gửi tín hiệu dừng');
    notifyBusyChanged();
  }

  return {
    init,
    applyInjection,
    abort,
    isRunning: () => running || backfillRunning,
    getRunningLabel: () => backfillRunning ? 'Điền lại hàng loạt' : runningLabel,
    getLastDebug: () => clone(lastDebug),
    getLastInjectionInfo: () => clone(lastInjectionInfo),
    getLastSelection: () => clone(lastSelection),
    selectOffscreenNpcs,
    ingestWorldEvolution,
    backfill,
    stopBackfill,
    getBackfillStatus: () => clone(backfillStatus),
    reconcileHistory,
    peekNpc,
    readStoryTime,
    repairState,
    buildWorldEngineContext,
    // Xuất ra để giao diện và kiểm thử dùng lại mà không phải gọi API.
    buildInjectionText,
    mergeExtraction,
    applyOffscreen,
    addPublicFact,
    acknowledgeFacts,
    INJECTION_NAME
  };
})();
