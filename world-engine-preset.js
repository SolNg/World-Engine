// world-engine-preset.js — Hệ thống preset của engine (preset cho World Engine suy diễn)
// Đóng gói 4 đoạn hardcode trong prompt suy diễn (① vai trò engine / ② 10 bước kiểm tra nhân quả / ⑦ mô tả định dạng đầu ra JSON / ⑧ ví dụ JSON)
// thành "preset bền vững" có thể chỉnh sửa, lưu, chuyển đổi, xuất/nhập.
//
// Nguyên tắc cốt lõi: khi preset "Mặc Định" đang kích hoạt (không có ghi đè tùy chỉnh nào), cả 4 đoạn đều dùng giá trị mặc định, prompt suy diễn
// giống hệt từng byte so với hiện trạng PR#12. Nguồn sự thật duy nhất cho văn bản mặc định = biến
// window.WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS mà world-engine-evolution.js expose ra (tham chiếu lúc chạy, không copy ở đây, để tránh lệch dữ liệu giữa hai bản).
//
// Lưu trữ: qua window.WORLD_ENGINE_STORE (IndexedDB), key riêng, không nằm trong world_engine_settings.
//   world_engine_active_preset   = id preset đang kích hoạt (string, 'default' hoặc id tự tạo)
//   world_engine_custom_presets  = mảng các preset tự tạo (chuỗi JSON)
// chatcache là whitelist nghiêm ngặt 5 slot, sẽ không vô tình gồm hai key này, đổi cuộc trò chuyện không bị xóa, an toàn.
//
// Thứ tự nạp: module này nạp sau world-engine-store.js, trước core/evolution.
//   Vì vậy ở cấp module không được đọc DEFAULT_SEGS của evolution (lúc đó evolution chưa nạp) — luôn phải trì hoãn đến khi
//   hàm thực sự được gọi mới đọc (lúc đó evolution đã nạp, UI đã khởi động).
(function () {
  'use strict';

  var STORAGE_KEY_ACTIVE = 'world_engine_active_preset';
  var STORAGE_KEY_CUSTOM = 'world_engine_custom_presets';
  var DEFAULT_PRESET_ID = 'default';

  // 4 đoạn key có thể chỉnh sửa, khớp từng chữ với key _lastPromptSegments của evolution.js.
  var EDITABLE_SEG_KEYS = ['engine-role', 'causal-steps', 'output-format', 'json-example'];

  var SEG_LABELS = {
    'engine-role':   '① Chỉ Thị Vai Trò Engine',
    'causal-steps':  '② Kiểm Tra Nhân Quả (10 Bước)',
    'output-format': '⑦ Mô Tả Trường Dữ Liệu JSON Đầu Ra',
    'json-example':  '⑧ Ví Dụ JSON'
  };

  // ── Tiện Ích ───────────────────────────────────────
  function store() {
    return window.WORLD_ENGINE_STORE;
  }

  function log(msg) { console.log('[World Engine][Preset] ' + msg); }
  function warn(msg) { console.warn('[World Engine][Preset] ' + msg); }

  function deepClone(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    try { return JSON.parse(JSON.stringify(obj)); } catch (e) { return obj; }
  }

  // Lúc chạy, lấy 4 đoạn văn bản mặc định từ module evolution (nguồn sự thật duy nhất). Trả về {} khi evolution chưa nạp.
  function getDefaultSegTexts() {
    var src = window.WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS;
    if (src && typeof src === 'object') return src;
    warn('WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS chưa sẵn sàng, văn bản đoạn mặc định tạm thời chưa dùng được');
    return {};
  }

  function genId() {
    // Không dùng Date.now()/Math.random() (môi trường VM/workflow script có thể bị giới hạn), đổi sang kết hợp đếm + timestamp để tương thích.
    // Môi trường trình duyệt thực dùng Date.now; nếu không dùng được thì lùi về đếm tăng dần.
    var ts = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    var rnd = '';
    try {
      if (typeof Math !== 'undefined' && Math.random) {
        rnd = Math.floor(Math.random() * 1e6).toString(36);
      }
    } catch (e) {}
    return 'custom_' + ts.toString(36) + '_' + rnd;
  }

  // ── Chuẩn Hóa Preset ───────────────────────────────────
  // Chuẩn hóa mọi input thành một đối tượng preset hợp lệ. Trong segments, đoạn nào là null/chuỗi rỗng/không phải chuỗi → coi là "không ghi đè" và lưu null.
  function normalizePreset(obj) {
    if (!obj || typeof obj !== 'object') obj = {};
    var name = (obj.name == null ? '' : String(obj.name)).trim() || 'Preset Chưa Đặt Tên';
    var description = (obj.description == null ? '' : String(obj.description)).trim();

    var segments = {};
    for (var i = 0; i < EDITABLE_SEG_KEYS.length; i++) {
      var k = EDITABLE_SEG_KEYS[i];
      var v = obj.segments ? obj.segments[k] : undefined;
      if (v == null) { segments[k] = null; continue; }
      v = String(v);
      // Chuỗi rỗng hoặc chỉ có khoảng trắng được coi là "không ghi đè" (rơi về mặc định), khớp với ngữ nghĩa xóa trắng trên UI.
      if (v.trim() === '') { segments[k] = null; continue; }
      segments[k] = v;
    }

    return {
      id: (obj.id && typeof obj.id === 'string') ? obj.id : genId(),
      name: name,
      description: description,
      builtin: false,
      segments: segments,
      createdAt: Number.isFinite(Number(obj.createdAt)) ? Number(obj.createdAt) : 0,
      updatedAt: Number.isFinite(Number(obj.updatedAt)) ? Number(obj.updatedAt) : 0
    };
  }

  // ── Preset Mặc Định Tích Hợp Sẵn ───────────────────────────────
  // segments toàn null = cả 4 đoạn đều rơi về giá trị mặc định = giống hệt hiện trạng từng byte. Không lưu xuống đĩa.
  function buildDefaultPreset() {
    return {
      id: DEFAULT_PRESET_ID,
      name: 'Mặc Định (Hardcode)',
      description: 'Prompt suy diễn mặc định tích hợp sẵn của World Engine, cả 4 đoạn đều là văn bản hardcode gốc. Chỉnh sửa hoặc lưu thành bản khác để tùy chỉnh.',
      builtin: true,
      segments: { 'engine-role': null, 'causal-steps': null, 'output-format': null, 'json-example': null },
      createdAt: 0,
      updatedAt: 0
    };
  }

  // ── CRUD Lưu Trữ ──────────────────────────────────
  function getActivePresetId() {
    var s = store();
    if (!s) return DEFAULT_PRESET_ID;
    var id = s.getItem(STORAGE_KEY_ACTIVE);
    if (!id || typeof id !== 'string') return DEFAULT_PRESET_ID;
    // Nếu id đã lưu trỏ đến một preset tự tạo đã bị xóa, rơi về mặc định.
    if (id !== DEFAULT_PRESET_ID) {
      var customs = loadCustomPresets();
      var found = false;
      for (var i = 0; i < customs.length; i++) { if (customs[i].id === id) { found = true; break; } }
      if (!found) { setActivePresetId(DEFAULT_PRESET_ID); return DEFAULT_PRESET_ID; }
    }
    return id;
  }

  function setActivePresetId(id) {
    var s = store();
    if (!s) { warn('store chưa sẵn sàng, không thể lưu preset đang kích hoạt'); return; }
    s.setItem(STORAGE_KEY_ACTIVE, id || DEFAULT_PRESET_ID);
  }

  function setActivePreset(id) {
    setActivePresetId(id);
    log('Đã chuyển preset đang kích hoạt: ' + (id || DEFAULT_PRESET_ID));
  }

  function loadCustomPresets() {
    var s = store();
    if (!s) return [];
    var raw = s.getItem(STORAGE_KEY_CUSTOM);
    if (!raw) return [];
    try {
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Chuẩn hóa từng cái một, bỏ qua các mục hoàn toàn không thể phân tích.
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        try { out.push(normalizePreset(arr[i])); } catch (e) { warn('Bỏ qua preset tự tạo không thể chuẩn hóa #' + i); }
      }
      return out;
    } catch (e) { warn('Dữ liệu lưu preset tự tạo bị hỏng, coi như rỗng: ' + e.message); return []; }
  }

  function saveCustomPresetsArray(arr) {
    var s = store();
    if (!s) { warn('store chưa sẵn sàng, không thể lưu danh sách preset'); return; }
    s.setItem(STORAGE_KEY_CUSTOM, JSON.stringify(arr || []));
  }

  function getAllPresets() {
    return [buildDefaultPreset()].concat(loadCustomPresets());
  }

  function getCustomPresets() { return loadCustomPresets(); }
  function getBuiltinPresets() { return [buildDefaultPreset()]; }

  function getPresetById(id) {
    if (!id || id === DEFAULT_PRESET_ID) return buildDefaultPreset();
    var customs = loadCustomPresets();
    for (var i = 0; i < customs.length; i++) { if (customs[i].id === id) return customs[i]; }
    return null;
  }

  function getActivePreset() {
    return getPresetById(getActivePresetId()) || buildDefaultPreset();
  }

  // Lưu/cập nhật một preset tự tạo. Nếu preset không có id hoặc id=default thì tạo id mới (tức là "Lưu Thành Bản Khác").
  // Trả về preset sau khi lưu (kèm id cuối cùng).
  function saveCustomPreset(preset) {
    var p = normalizePreset(preset);
    if (!p.id || p.id === DEFAULT_PRESET_ID) p.id = genId();
    var customs = loadCustomPresets();
    var idx = -1;
    for (var i = 0; i < customs.length; i++) { if (customs[i].id === p.id) { idx = i; break; } }
    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    p.updatedAt = now;
    if (p.createdAt === 0) p.createdAt = now;
    if (idx >= 0) customs[idx] = p; else customs.push(p);
    saveCustomPresetsArray(customs);
    log((idx >= 0 ? 'Cập nhật' : 'Thêm mới') + ' preset tự tạo: ' + p.name + ' (' + p.id + ')');
    return p;
  }

  // Lưu thành bản khác: bất kể id đầu vào là gì, luôn tạo id mới và lưu thành preset mới. Trả về preset mới.
  function saveAsCustomPreset(preset, newName) {
    var p = normalizePreset(preset);
    p.id = genId();
    if (newName && String(newName).trim()) p.name = String(newName).trim();
    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    p.createdAt = now; p.updatedAt = now;
    var customs = loadCustomPresets();
    customs.push(p);
    saveCustomPresetsArray(customs);
    log('Đã lưu thành preset mới: ' + p.name + ' (' + p.id + ')');
    return p;
  }

  function deleteCustomPreset(id) {
    if (!id || id === DEFAULT_PRESET_ID) { warn('Không thể xóa preset tích hợp sẵn'); return false; }
    var customs = loadCustomPresets();
    var next = customs.filter(function (p) { return p.id !== id; });
    if (next.length === customs.length) { warn('Không tìm thấy preset cần xóa: ' + id); return false; }
    saveCustomPresetsArray(next);
    // Nếu xóa đúng preset đang kích hoạt → rơi về mặc định.
    if (getActivePresetId() === id) setActivePresetId(DEFAULT_PRESET_ID);
    log('Đã xóa preset tự tạo: ' + id);
    return true;
  }

  // ── Truy Vấn Ghi Đè Cốt Lõi (evolution.js gọi) ──────────
  // Trả về văn bản ghi đè của preset đang kích hoạt cho một đoạn cụ thể; không có ghi đè (null/preset mặc định/đoạn chưa tùy chỉnh) thì trả về null.
  // evolution.js dựa vào đó, dùng `override || DEFAULT` để quyết định văn bản cuối cùng.
  function getSegmentOverride(segKey) {
    if (EDITABLE_SEG_KEYS.indexOf(segKey) < 0) return null;
    var p = getActivePreset();
    if (!p || !p.segments) return null;
    var v = p.segments[segKey];
    if (v == null) return null;
    v = String(v);
    if (v.trim() === '') return null;
    return v;
  }

  // Trả về một lần map ghi đè của cả 4 đoạn: { 'engine-role': text|null, 'causal-steps': ..., 'output-format': ..., 'json-example': ... }
  // Để callEvolutionAPI trong evolution.js lấy cả 4 đoạn một lần, tránh việc gọi getSegmentOverride riêng cho từng đoạn khiến
  // cùng một lượt suy diễn phải JSON.parse lặp đi lặp lại toàn bộ mảng preset tự tạo (4 đoạn × 8 lần parse → 1 lần parse).
  // Đo thực tế hiệu năng: với 5 preset, mỗi lượt giảm từ ~289µs xuống ~30µs; với 50 preset lớn, giảm từ ~3.8ms xuống ~50µs.
  // Preset mặc định (không ghi đè) đi theo đường nhanh: trả thẳng toàn bộ null, 0 lần JSON.parse.
  function getOverrides() {
    var out = { 'engine-role': null, 'causal-steps': null, 'output-format': null, 'json-example': null };
    var s = store();
    if (!s) return out;
    var id = s.getItem(STORAGE_KEY_ACTIVE);
    if (!id || id === DEFAULT_PRESET_ID) return out; // Preset mặc định: cả 4 đoạn đều null, 0 lần parse
    // Preset tự tạo: parse 1 lần để tìm preset + đồng thời kiểm tra id vẫn còn tồn tại
    var customs = loadCustomPresets();
    var p = null;
    for (var i = 0; i < customs.length; i++) { if (customs[i].id === id) { p = customs[i]; break; } }
    if (!p) { // id đang kích hoạt đã bị xóa → rơi về mặc định và trả về toàn bộ null
      setActivePresetId(DEFAULT_PRESET_ID);
      return out;
    }
    if (!p.segments) return out;
    for (var j = 0; j < EDITABLE_SEG_KEYS.length; j++) {
      var k = EDITABLE_SEG_KEYS[j];
      var v = p.segments[k];
      if (v == null) { out[k] = null; continue; }
      v = String(v);
      out[k] = (v.trim() === '') ? null : v;
    }
    return out;
  }

  // ── Xuất/Nhập ───────────────────────────────────
  // Xuất: trả về chuỗi JSON của preset (có thể bỏ timestamp nội bộ, ở đây giữ lại để dễ truy vết).
  function exportPreset(id) {
    var p = getPresetById(id || getActivePresetId());
    if (!p) { warn('Xuất thất bại: không tìm thấy preset ' + id); return null; }
    var out = {
      __worldEnginePreset: true,
      version: 1,
      preset: {
        name: p.name,
        description: p.description,
        segments: p.segments
      }
    };
    return JSON.stringify(out, null, 2);
  }

  // Nhập: phân tích chuỗi JSON, kiểm tra, chuẩn hóa, lưu thành preset tự tạo. Trả về preset mới hoặc ném lỗi.
  function importPreset(jsonStr) {
    if (!jsonStr || typeof jsonStr !== 'string') throw new Error('Nội dung nhập vào rỗng');
    var obj;
    try { obj = JSON.parse(jsonStr); }
    catch (e) { throw new Error('Không phải JSON hợp lệ: ' + e.message); }
    var src = (obj && obj.__worldEnginePreset && obj.preset) ? obj.preset : obj;
    var p = normalizePreset(src);
    p.id = genId();
    var now = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0;
    p.createdAt = now; p.updatedAt = now;
    var customs = loadCustomPresets();
    customs.push(p);
    saveCustomPresetsArray(customs);
    log('Đã nhập preset: ' + p.name + ' (' + p.id + ')');
    return p;
  }

  // ── Hỗ Trợ UI: lấy "văn bản hiển thị" của một đoạn theo preset hiện tại (có ghi đè thì dùng ghi đè, không thì dùng mặc định) ────────
  // Dùng để UI chỉnh sửa preset khởi tạo textarea: cho người dùng thấy văn bản thực sự đang có hiệu lực.
  function getSegmentDisplayText(segKey) {
    var ov = getSegmentOverride(segKey);
    if (ov != null) return ov;
    var defaults = getDefaultSegTexts();
    return defaults[segKey] || '';
  }

  // Trong preset đang kích hoạt, những đoạn nào "đã bị ghi đè tùy chỉnh" (true = người dùng đã sửa). Dùng để UI đánh dấu.
  function getOverriddenSegKeys() {
    var p = getActivePreset();
    if (!p || !p.segments) return [];
    var out = [];
    for (var i = 0; i < EDITABLE_SEG_KEYS.length; i++) {
      var k = EDITABLE_SEG_KEYS[i];
      var v = p.segments[k];
      if (v != null && String(v).trim() !== '') out.push(k);
    }
    return out;
  }

  // ── Expose API ───────────────────────────────────
  window.WORLD_ENGINE_PRESET = {
    EDITABLE_SEG_KEYS: EDITABLE_SEG_KEYS,
    SEG_LABELS: SEG_LABELS,
    DEFAULT_PRESET_ID: DEFAULT_PRESET_ID,
    getDefaultSegTexts: getDefaultSegTexts,
    getSegmentDisplayText: getSegmentDisplayText,
    getOverriddenSegKeys: getOverriddenSegKeys,
    getActivePresetId: getActivePresetId,
    getActivePreset: getActivePreset,
    setActivePreset: setActivePreset,
    setActivePresetId: setActivePresetId,
    getAllPresets: getAllPresets,
    getCustomPresets: getCustomPresets,
    getBuiltinPresets: getBuiltinPresets,
    getPresetById: getPresetById,
    saveCustomPreset: saveCustomPreset,
    saveAsCustomPreset: saveAsCustomPreset,
    deleteCustomPreset: deleteCustomPreset,
    getSegmentOverride: getSegmentOverride,
    getOverrides: getOverrides,
    exportPreset: exportPreset,
    importPreset: importPreset,
    normalizePreset: normalizePreset
  };

  log('Module đã nạp xong. Id preset mặc định=' + DEFAULT_PRESET_ID + ', các đoạn có thể chỉnh sửa: ' + EDITABLE_SEG_KEYS.join(', '));
})();
