// world-engine-worldbook.js — Đọc sách thế giới của đoạn chat hiện tại và lựa chọn cho suy diễn nền
window.WORLD_ENGINE_WORLDBOOK = (function() {
  const STORAGE_PREFIXES = {
    world: 'world_engine_worldbook_selection_',
    npc: 'npc_engine_worldbook_selection_'
  };
  let worldInfoModulePromise = null;

  function getChatId() {
    return window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
  }

  function normalizeScope(scope) {
    if (scope == null || scope === '' || scope === 'world') return 'world';
    if (scope === 'npc') return 'npc';
    throw new Error(`Scope sách thế giới không xác định: ${scope}`);
  }

  function getSelectionKey(scope) {
    return STORAGE_PREFIXES[normalizeScope(scope)] + getChatId();
  }

  // Các giá trị override hợp lệ của chế độ kích hoạt ('auto' là mặc định, không lưu xuống): buộc luôn thường trực / buộc theo từ khóa / tắt
  const OVERRIDE_VALUES = ['const', 'key', 'off'];
  function sanitizeOverrides(obj) {
    const out = {};
    if (obj && typeof obj === 'object') {
      for (const k in obj) {
        if (typeof k === 'string' && OVERRIDE_VALUES.indexOf(obj[k]) !== -1) out[k] = obj[k];
      }
    }
    return out;
  }

  // Phân tích giá trị đã lưu, tương thích định dạng cũ (mảng thuần) và định dạng mới ({ids, t, overrides})
  function parseStored(raw) {
    try {
      const data = JSON.parse(raw || '[]');
      if (Array.isArray(data)) return { ids: data.filter(id => typeof id === 'string'), t: 0, overrides: {} };
      if (data && Array.isArray(data.ids)) {
        return {
          ids: data.ids.filter(id => typeof id === 'string'),
          t: Number(data.t) || 0,
          overrides: sanitizeOverrides(data.overrides)
        };
      }
    } catch (e) {}
    return { ids: [], t: 0, overrides: {} };
  }

  function readStored(scope) {
    return parseStored(window.WORLD_ENGINE_STORE.getItem(getSelectionKey(scope)));
  }

  function getSelectedIds(scope) {
    return readStored(scope).ids;
  }

  // Ghi đè kích hoạt cho từng mục ({entryId: 'const'|'key'|'off'}); mặc định coi là 'auto' (theo cách của SillyTavern)
  function getOverrides(scope) {
    return readStored(scope).overrides;
  }

  // Phân biệt "chưa từng lưu" (key không tồn tại) và "đã lưu lựa chọn rỗng" (key tồn tại nhưng ids là [])
  function hasSelection(scope) {
    return window.WORLD_ENGINE_STORE.getItem(getSelectionKey(scope)) !== null;
  }

  // Tìm ra bản ghi lựa chọn cũ nhất của một đoạn chat khác (theo mốc thời gian lưu; định dạng cũ không có mốc thời gian coi là cũ nhất)
  function removeOldestOtherSelection(scope) {
    const prefix = STORAGE_PREFIXES[normalizeScope(scope)];
    const currentKey = getSelectionKey(scope);
    let oldestKey = null;
    let oldestT = Infinity;
    for (const key of window.WORLD_ENGINE_STORE.keys()) {
      if (!key || !key.startsWith(prefix) || key === currentKey) continue;
      const t = parseStored(window.WORLD_ENGINE_STORE.getItem(key)).t;
      if (t < oldestT) {
        oldestT = t;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      window.WORLD_ENGINE_STORE.removeItem(oldestKey);
      return true;
    }
    return false;
  }

  function persistSelection(ids, overrides, scope) {
    const uniqueIds = [...new Set(Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [])];
    // Chỉ giữ lại override của những mục vẫn đang được chọn, tránh sót lại và chồng chất vô hạn sau khi bỏ chọn
    const idSet = new Set(uniqueIds);
    const ov = sanitizeOverrides(overrides);
    const trimmed = {};
    for (const k in ov) if (idSet.has(k)) trimmed[k] = ov[k];
    const value = JSON.stringify({ ids: uniqueIds, t: Date.now(), overrides: trimmed });
    const currentKey = getSelectionKey(scope);
    // Sau khi chuyển sang IndexedDB thì hầu như không còn đầy nữa; nếu vẫn dùng localStorage và vượt hạn mức thì mỗi lần xóa bản cũ nhất rồi thử lại (FIFO dự phòng)
    while (true) {
      try {
        window.WORLD_ENGINE_STORE.setItem(currentKey, value);
        return;
      } catch (e) {
        if (!removeOldestOtherSelection(scope)) throw e;
      }
    }
  }

  // Tương thích lệnh gọi cũ: chỉ đổi lựa chọn, giữ nguyên override kích hoạt của từng mục đã lưu
  function saveSelectedIds(ids, scope) {
    persistSelection(ids, readStored(scope).overrides, scope);
  }

  // Lưu đồng thời lựa chọn và override kích hoạt của từng mục
  function saveSelection(ids, overrides, scope) {
    persistSelection(ids, overrides, scope);
  }

  function getEntryId(entry) {
    return `${entry.world || 'Sách thế giới không xác định'}::${entry.uid}`;
  }

  function getEntryTitle(entry) {
    const comment = String(entry.comment || '').trim();
    if (comment) return comment;
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean).join(', ') : '';
    if (keys) return keys;
    const content = String(entry.content || '').trim();
    return content ? content.substring(0, 40) : `Mục ${entry.uid}`;
  }

  async function getWorldInfoModule() {
    if (!worldInfoModulePromise) {
      worldInfoModulePromise = import('/scripts/world-info.js').catch(error => {
        worldInfoModulePromise = null;
        throw error;
      });
    }
    return worldInfoModulePromise;
  }

  async function loadCurrentEntries() {
    const module = await getWorldInfoModule();
    if (typeof module.getSortedEntries !== 'function') {
      throw new Error('Phiên bản SillyTavern hiện tại không hỗ trợ đọc mục sách thế giới');
    }
    const entries = await module.getSortedEntries();
    return (Array.isArray(entries) ? entries : [])
      .filter(entry => entry && entry.uid !== undefined && String(entry.content || '').trim())
      // Bỏ qua hoàn toàn các mục bắt đầu bằng TavernDB-ACU: không hiển thị, không thể chọn, không chèn
      .filter(entry => !getEntryTitle(entry).startsWith('TavernDB-ACU'))
      .map(entry => ({
        id: getEntryId(entry),
        uid: entry.uid,
        world: entry.world || 'Sách thế giới không xác định',
        title: getEntryTitle(entry),
        content: String(entry.content || '').trim(),
        disabled: entry.disable === true || entry.enabled === false,
        // —— Cấu hình kích hoạt gốc (dùng cho cơ chế Đèn Xanh Dương - Xanh Lá, theo đúng thiết lập sách thế giới của SillyTavern) ——
        constant: entry.constant === true,                  // 🔵 Thường trực
        vectorized: entry.vectorized === true,              // 🔗 Vector (extension này không thực hiện truy hồi vector, xử lý như không phải từ khóa)
        selective: entry.selective === true,                // Có bật logic từ khóa phụ hay không
        selectiveLogic: Number(entry.selectiveLogic) || 0,  // 0 AND_ANY / 1 NOT_ALL / 2 NOT_ANY / 3 AND_ALL
        keys: Array.isArray(entry.key) ? entry.key.filter(k => typeof k === 'string' && k.trim()) : [],
        secondaryKeys: Array.isArray(entry.keysecondary) ? entry.keysecondary.filter(k => typeof k === 'string' && k.trim()) : [],
        caseSensitive: entry.caseSensitive === true,
        matchWholeWords: entry.matchWholeWords === true
      }));
  }

  // ========== Cơ Chế Kích Hoạt Đèn Xanh Dương - Xanh Lá ==========
  // Sao chép lại quy tắc khớp từ khóa của sách thế giới SillyTavern, nhưng "kích hoạt cái gì" hoàn toàn do extension này tự quyết định:
  // chỉ quét ngữ cảnh mà extension này đưa vào suy diễn (hội thoại gần đây/trạng thái thế giới), không lắng nghe việc quét chat của SillyTavern, giữ tách rời.
  // world_info_logic của SillyTavern: AND_ANY=0 / NOT_ALL=1 / NOT_ANY=2 / AND_ALL=3.
  const LOGIC = { AND_ANY: 0, NOT_ALL: 1, NOT_ANY: 2, AND_ALL: 3 };

  function triggerEnabled(scope) {
    if (normalizeScope(scope) === 'npc') {
      return window.NPC_ENGINE_SETTINGS?.getSettings()?.worldbookTrigger === true;
    }
    const a = window.WORLD_ENGINE_API;
    const s = a && a.getSettings ? a.getSettings() : {};
    return s.worldbookTrigger === true;
  }

  // Từ khóa dạng /pattern/flags được xử lý như regex (giống SillyTavern)
  function parseRegexKey(str) {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(str);
    if (!m) return null;
    try { return new RegExp(m[1], m[2]); } catch (e) { return null; }
  }

  // Một từ khóa có khớp với văn bản quét hay không. Khớp nguyên từ chỉ có hiệu lực với từ ASCII;
  // tiếng Trung/tiếng Việt v.v. không có ranh giới từ (\b không dùng được), nên luôn quay về khớp chuỗi con —
  // đây cũng là mặc định hợp lý cho extension này (bối cảnh võ hiệp Trung văn).
  function matchKey(text, key, caseSensitive, matchWholeWords) {
    if (typeof key !== 'string' || !text) return false;
    const needle = key.trim();
    if (!needle) return false;
    const re = parseRegexKey(needle);
    if (re) { try { return re.test(text); } catch (e) { return false; } }
    if (matchWholeWords && /[A-Za-z0-9_]/.test(needle) && /^[\x00-\x7F]+$/.test(needle)) {
      const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try { return new RegExp('(?:^|\\W)(?:' + esc + ')(?:\\W|$)', caseSensitive ? '' : 'i').test(text); } catch (e) {}
    }
    return caseSensitive ? text.indexOf(needle) !== -1 : text.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
  }

  // Trả về {active, reason}: reason dùng để chẩn đoán trên console, giải thích vì sao mục này được chèn/bỏ qua.
  // mode: auto(theo SillyTavern) / const(buộc thường trực) / key(buộc theo từ khóa) / off(tắt).
  function activationOf(entry, scanText, mode) {
    const m = mode || 'auto';
    if (m === 'off') return { active: false, reason: 'Đã tắt (ghi đè)' };
    if (m === 'const') return { active: true, reason: 'Buộc thường trực (ghi đè)' };
    if (m === 'auto' && entry.constant) return { active: true, reason: '🔵 Thường trực' };
    // 🟢 Nhánh từ khóa (m==='key' buộc đi theo từ khóa; m==='auto' và mục không phải thường trực)
    const primary = entry.keys || [];
    if (!primary.length) return { active: false, reason: entry.vectorized ? '🔗 Mục vector (không kích hoạt)' : 'Không có từ khóa chính' };
    const cs = entry.caseSensitive, mw = entry.matchWholeWords;
    const hitKey = primary.find(k => matchKey(scanText, k, cs, mw));
    if (!hitKey) return { active: false, reason: '🟢 Không khớp' };
    const sec = entry.secondaryKeys || [];
    if (!entry.selective || !sec.length) return { active: true, reason: '🟢 Khớp "' + hitKey + '"' };
    const anySec = sec.some(k => matchKey(scanText, k, cs, mw));
    const allSec = sec.every(k => matchKey(scanText, k, cs, mw));
    let ok;
    switch (entry.selectiveLogic) {
      case LOGIC.AND_ALL: ok = allSec; break;
      case LOGIC.NOT_ALL: ok = !allSec; break;
      case LOGIC.NOT_ANY: ok = !anySec; break;
      default: ok = anySec; // AND_ANY
    }
    return { active: ok, reason: ok ? ('🟢 Khớp "' + hitKey + '" + từ khóa phụ') : '🟢 Khớp từ khóa chính nhưng logic từ khóa phụ không thỏa' };
  }

  function isEntryActive(entry, scanText, mode) {
    return activationOf(entry, scanText, mode).active;
  }

  // scanText: văn bản ngữ cảnh mà extension này đưa vào suy diễn (hội thoại gần đây, v.v.). Khi tắt kích hoạt thì bỏ qua, giữ nguyên hiện trạng "toàn bộ mục đã chọn đều được chèn".
  async function buildPromptSection(scanText, scope) {
    const normalizedScope = normalizeScope(scope);
    const stored = readStored(normalizedScope);
    const selectedIds = new Set(stored.ids);
    if (!selectedIds.size) return '';

    const triggerOn = triggerEnabled(normalizedScope);
    const overrides = stored.overrides || {};
    const text = String(scanText || '');

    try {
      const entries = await loadCurrentEntries();
      const pool = entries.filter(entry => selectedIds.has(entry.id) && !entry.disabled);
      if (!pool.length) return '';

      let selectedEntries;
      if (triggerOn) {
        const decided = pool.map(entry => {
          const r = activationOf(entry, text, overrides[entry.id]);
          return { entry, active: r.active, reason: r.reason };
        });
        selectedEntries = decided.filter(d => d.active).map(d => d.entry);
        // Chi tiết mục khớp trên console: mỗi vòng suy diễn in ra mục nào được chèn/bỏ qua và lý do (nhóm gấp lại, không tràn màn hình)
        try {
          console.groupCollapsed(`[World Engine] Đèn Xanh Dương - Xanh Lá của sách thế giới: ${selectedEntries.length}/${pool.length} được chèn${text ? '' : ' (văn bản quét rỗng, chỉ mục thường trực)'}`);
          decided.forEach(d => console.log(`${d.active ? '✓ Chèn' : '· Bỏ qua'} | ${d.reason} | ${d.entry.world} / ${d.entry.title}`));
          console.groupEnd();
        } catch (e) {}
      } else {
        selectedEntries = pool; // Tắt kích hoạt: giữ nguyên hiện trạng, chèn toàn bộ mục đã chọn
      }

      if (!selectedEntries.length) return '';

      const content = selectedEntries.map(entry =>
        `【${entry.world} / ${entry.title}】\n${entry.content}`
      ).join('\n\n');

      const instruction = normalizedScope === 'npc'
        ? 'Nội dung dưới đây là tư liệu nền để nhận diện nhân vật, biệt danh, thế lực và địa danh. Không được coi nó là sự việc vừa xảy ra, cũng không được coi là điều nhân vật đương nhiên biết — tri thức của nhân vật chỉ đến từ những gì họ chứng kiến hoặc nghe được trong truyện.'
        : 'Nội dung dưới đây là các sự thật và ràng buộc thế giới quan của đoạn chat hiện tại. Suy diễn nền phải tuân thủ; không được tự ý viết lại các thiết lập đã định.';

      return `========== Các mục sách thế giới đã chọn ==========
${instruction}

${content}`;
    } catch(error) {
      console.warn('[World Engine] Đọc sách thế giới đã chọn thất bại:', error);
      return '';
    }
  }

  return {
    getChatId,
    hasSelection,
    getSelectedIds,
    getOverrides,
    saveSelectedIds,
    saveSelection,
    loadCurrentEntries,
    buildPromptSection,
    triggerEnabled,
    isEntryActive,
    activationOf,
    matchKey
  };
})();
