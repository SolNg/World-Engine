// world-engine-store.js — Tầng trung gian lưu trữ
// Di chuyển toàn bộ dữ liệu lưu trữ của Thế Giới Dẫn Truyện từ localStorage chật hẹp (khoảng 5MB, dùng chung với Tavern)
// sang IndexedDB (dung lượng lớn hơn hàng chục lần).
// Cung cấp cho tầng trên cùng một giao diện đọc/ghi đồng bộ như localStorage: lúc khởi động sẽ nạp dữ liệu
// IndexedDB vào bản sao trong bộ nhớ (mirror); đọc lấy trực tiếp từ mirror (đồng bộ), ghi thì cập nhật mirror
// đồng bộ rồi đẩy bất đồng bộ vào IndexedDB. Khi IndexedDB không khả dụng sẽ tự động chuyển về localStorage.
window.WORLD_ENGINE_STORE = (function() {
  const DB_NAME = 'world_engine';
  const STORE_NAME = 'kv';
  const PREFIX = 'world_engine_';

  let db = null;
  let ready = false;
  const mirror = new Map(); // key -> string value (bản sao trong bộ nhớ, hỗ trợ đọc đồng bộ)

  // Callback khi ghi (sync sink): mỗi lần setItem/removeItem xong sẽ báo cho bên đăng ký.
  // Module cache của Tavern (world-engine-chatcache.js) dựa vào đây để chép bản sao lưu trữ
  // theo từng cuộc trò chuyện vào chat_metadata, phục vụ đồng bộ đa thiết bị; các module khác
  // không cần thay đổi gì. hydrate() ghi thẳng vào mirror, không đi qua đây, nên khi nạp dữ liệu
  // vào mirror sẽ không bị dội ngược lại.
  let syncSink = null;
  function setSyncSink(sink) { syncSink = sink; }
  function notifySink(method, key, value) {
    if (!syncSink || typeof syncSink[method] !== 'function') return;
    try { syncSink[method](key, value); } catch (e) { /* Đồng bộ thất bại không được ảnh hưởng đến việc ghi cục bộ */ }
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      const out = [];
      const cur = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) { out.push([c.key, c.value]); c.continue(); }
        else resolve(out);
      };
      cur.onerror = () => reject(cur.error);
    });
  }

  function idbPut(key, value) {
    if (!db) return;
    try { db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key); }
    catch (e) { console.warn('[World Engine] Ghi IndexedDB thất bại', e); }
  }

  function idbDel(key) {
    if (!db) return;
    try { db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key); }
    catch (e) {}
  }

  // Gọi một lần lúc khởi động: mở IndexedDB, nạp dữ liệu vào mirror, di chuyển và dọn dẹp
  // các dữ liệu lưu trữ cũ trong localStorage
  async function hydrate() {
    if (ready) return;
    try {
      db = await openDB();
      for (const [k, v] of await idbGetAll()) mirror.set(k, v);
    } catch (e) {
      console.warn('[World Engine] IndexedDB không khả dụng, chuyển về dùng localStorage', e);
      db = null;
    }
    // Chuyển các key world_engine_* còn sót lại trong localStorage sang IndexedDB, đồng thời giải phóng dung lượng localStorage
    try {
      const legacyKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) legacyKeys.push(k);
      }
      for (const k of legacyKeys) {
        const v = localStorage.getItem(k);
        if (v == null) continue;
        if (!mirror.has(k)) { mirror.set(k, v); idbPut(k, v); }
        if (db) localStorage.removeItem(k); // Chỉ xóa khi IDB khả dụng (đã ghi thành công) để tránh mất dữ liệu
      }
      if (db && legacyKeys.length) {
        console.log(`[World Engine] Đã di chuyển ${legacyKeys.length} mục dữ liệu lưu trữ sang IndexedDB`);
      }
    } catch (e) { console.warn('[World Engine] Di chuyển dữ liệu lưu trữ cũ thất bại (không nghiêm trọng)', e); }
    ready = true;
  }

  function getItem(key) {
    if (mirror.has(key)) return mirror.get(key);
    // Khi mirror không có dữ liệu (chưa hydrate hoặc IDB không khả dụng) thì chuyển về localStorage
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function setItem(key, value) {
    value = String(value);
    mirror.set(key, value);
    if (db) idbPut(key, value);
    else localStorage.setItem(key, value); // Khi IDB không khả dụng thì lùi về localStorage (có thể ném lỗi vượt hạn mức)
    notifySink('onWrite', key, value);
  }

  function removeItem(key) {
    mirror.delete(key);
    if (db) idbDel(key);
    else { try { localStorage.removeItem(key); } catch (e) {} }
    notifySink('onRemove', key, null);
  }

  // Trả về toàn bộ key trong mirror (thay thế cho localStorage.length / localStorage.key(i))
  function keys() {
    if (mirror.size || db) return [...mirror.keys()];
    const out = [];
    for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
    return out;
  }

  return { hydrate, getItem, setItem, removeItem, keys, setSyncSink };
})();
