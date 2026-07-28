// world-engine-chatcache.js — Bộ nhớ đệm và lưu trữ trong Tavern (đồng bộ đa thiết bị + chống mất dữ liệu)
//
// Bối cảnh: world-engine-store.js đặt các bản lưu trong IndexedDB / localStorage, cách ly theo "thiết bị + trình duyệt".
// Khi đổi thiết bị hoặc trình duyệt, các bản lưu này sẽ không theo kịp. Trong khi đó chat_metadata của SillyTavern
// được tuần tự hóa vào tệp chat, lưu lên máy chủ Tavern, và đồng bộ đa thiết bị theo chính cuộc trò chuyện
// (xem script.js: khi mở chat, chat_metadata được nạp từ đầu tệp; khi saveChat lại ghi ngược vào đầu tệp).
// Module này ánh xạ bản lưu của "extension này, chat hiện tại" vào chat_metadata.world_engine,
// nhờ đó đạt được hai việc:
//   1) Đồng bộ thời gian thực (live): khi bật, trạng thái không gian làm việc liên tục được ánh xạ vào chat;
//      đổi thiết bị mở lại cùng chat là nối tiếp được tiến độ
//      (xung đột theo nguyên tắc "số hiệu chỉnh sửa mới hơn thắng" — bộ đếm Lamport, tránh phụ thuộc đồng hồ đa thiết bị).
//   2) Lưu trữ chat (snapshots): lưu thủ công có đặt tên + tự động sao lưu cuốn chiếu, có thể khôi phục / đổi tên /
//      xuất / xóa / nhập, chống mất dữ liệu.
//
// Ràng buộc then chốt:
//   - Tuyệt đối không ghi cài đặt toàn cục (world_engine_settings, chứa API Key) vào tệp chat; chỉ ánh xạ 5 khóa
//     "cách ly theo từng chat".
//   - Luôn dùng SillyTavern.getContext() để lấy tham chiếu mới nhất: chat_metadata bị thay thế toàn bộ khi đổi chat,
//     giữ tham chiếu cũ sẽ ghi nhầm sang chat khác.
//   - Khi ghi chat_metadata chỉ động vào đúng một khóa world_engine (updateChatMetadata hợp nhất nông ở cấp cao nhất),
//     giữ nguyên integrity và dữ liệu do extension khác (như ghi chú tác giả note) ghi vào, không bị ghi đè.
window.WORLD_ENGINE_CHATCACHE = (function() {
  const NS = 'world_engine';            // Khóa không gian tên dưới chat_metadata
  const SCHEMA_VERSION = 1;
  const MAX_AUTO_BACKUPS = 3;           // Số bản tự động sao lưu cuốn chiếu giữ lại (chống mất dữ liệu, kiểm soát dung lượng)
  const MAX_MANUAL_BACKUPS = 20;        // Giới hạn số bản lưu thủ công có đặt tên (kể cả bản nhập vào)
  const TICK_DELAY = 1500;              // Độ trễ chống dội khi ghi chat (mili giây), gộp nhiều lần setItem trong một lượt suy diễn
  const SIZE_WARN_BYTES = 1024 * 1024;  // Ngưỡng cảnh báo mềm về dung lượng không gian tên (khoảng 1MB)

  function core() { return window.WORLD_ENGINE_CORE; }
  function api() { return window.WORLD_ENGINE_API; }
  function store() { return window.WORLD_ENGINE_STORE; }

  function getCtx() {
    try { return SillyTavern.getContext(); } catch (e) { return null; }
  }

  // Hiện có đang ở trong một "chat thật" hay không (có chatId và không phải giá trị giữ chỗ default) —
  // chỉ khi đó ghi chat_metadata mới có ý nghĩa
  function chatUsable(ctx) {
    return !!(ctx && ctx.chatId && ctx.chatId !== 'default');
  }

  function settings() {
    const a = api();
    return a && a.getSettings ? a.getSettings() : {};
  }
  function syncEnabled() { return settings().syncToChat === true; }
  function autoBackupEnabled() { return settings().autoBackup === true; }

  // —— 5 khóa lưu trữ cách ly theo từng chat (tên phải khớp với core.js / worldbook.js; sửa ở đây trước
  //      tiên phải đối chiếu lại module gốc) ——
  //   state:       world_engine_<id>                      (core.js loadState/saveState)
  //   checkpoint:  world_engine_<id>_checkpoint           (core.js getCheckpointKey)
  //   fingerprint: world_engine_<id>_fingerprint          (core.js getFingerprintKey)
  //   anchorLayer: world_engine_<id>_anchorLayer          (core.js getAnchorLayerKey, di sản từ bản cũ)
  //   worldbook:   world_engine_worldbook_selection_<id>  (worldbook.js getSelectionKey)
  const SLOTS = {
    state:       id => `world_engine_${id}`,
    checkpoint:  id => `world_engine_${id}_checkpoint`,
    fingerprint: id => `world_engine_${id}_fingerprint`,
    anchorLayer: id => `world_engine_${id}_anchorLayer`,
    worldbook:   id => `world_engine_worldbook_selection_${id}`
  };
  const SLOT_NAMES = Object.keys(SLOTS);

  // Khóa số hiệu chỉnh sửa cục bộ: chỉ ghi sổ cục bộ trên thiết bị (bộ đếm Lamport), không thuộc slot,
  // không vào chat, không kích hoạt đồng bộ
  function revKey(id) { return `world_engine_${id}_syncrev`; }

  // Trong lúc cài đặt bản lưu, tạm ngưng slot đồng bộ để tránh hiệu ứng dội "ghi lại vào store →
  // lại bị coi là ghi mới rồi đẩy ngược vào chat"
  let _suspend = false;
  // Vòng gốc để tự động sao lưu: chỉ thêm một bản tự động sao lưu mới khi vòng tiến xa hơn mốc này
  // (lấy vòng hiện tại làm mốc khi mở chat)
  let _lastAutoRound = null;

  // ========== Đóng gói / cài đặt slot ==========

  // Xác định một store key có thuộc slot có thể đồng bộ của "chat hiện tại" hay không; không thuộc thì trả về null
  function slotOfKey(key, id) {
    for (const name of SLOT_NAMES) if (SLOTS[name](id) === key) return name;
    return null;
  }

  function hasAnyLocal(id) {
    for (const name of SLOT_NAMES) if (store().getItem(SLOTS[name](id)) != null) return true;
    return false;
  }

  // Loại bỏ các trường thuần gỡ lỗi trong state / checkpoint mà ensureArrays có thể dựng lại,
  // để giảm tải cho tệp chat
  function stripHeavy(rawJson) {
    try {
      const o = JSON.parse(rawJson);
      delete o.lastInjection;
      delete o.lastEvolveResult;
      return JSON.stringify(o);
    } catch (e) { return rawJson; }
  }

  // Đóng gói nguyên trạng các slot của chat hiện tại thành { slotName: rawString } (slot nào thiếu thì bỏ qua)
  function packChat(id) {
    const data = {};
    for (const name of SLOT_NAMES) {
      const raw = store().getItem(SLOTS[name](id));
      if (raw == null) continue;
      data[name] = (name === 'state' || name === 'checkpoint') ? stripHeavy(raw) : raw;
    }
    return data;
  }

  // So sánh từng slot giữa hai pack xem có giống nhau không. Giá trị slot đều là chuỗi, so bằng === trực tiếp,
  // tránh phải tuần tự hóa JSON.stringify hai chiều.
  // Dùng để khử trùng lặp nội dung live (không đổi thì không đẩy lên chat) và so sánh khử trùng lặp bản tự động sao lưu.
  function sameData(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (a[k] !== b[k]) return false;
    return true;
  }

  // Ước tính số byte sau khi tuần tự hóa namespace: data vốn đã là chuỗi, chỉ cần cộng dồn độ dài từng slot,
  // tránh việc mỗi lần writeNamespace phải JSON.stringify toàn bộ ns (tối đa ~24 bản trạng thái đầy đủ)
  // chỉ để lấy .length làm cảnh báo mềm.
  function nsSize(ns) {
    let n = 0;
    if (ns.live && ns.live.data) {
      const d = ns.live.data;
      for (const k in d) n += (d[k] || '').length;
      n += 64; // Chi phí siêu dữ liệu live (rev/updatedAt/chatId)
    }
    if (Array.isArray(ns.snapshots)) {
      for (const s of ns.snapshots) {
        const d = s && s.data;
        if (d) for (const k in d) n += (d[k] || '').length;
        n += 80; // Chi phí siêu dữ liệu snapshot
      }
    }
    return n;
  }

  // Cài đặt một pack trở lại store; exact=true thì xóa các slot không có trong pack (khôi phục chính xác)
  function installPack(data, id, exact) {
    data = data || {};
    _suspend = true;
    try {
      for (const name of SLOT_NAMES) {
        const key = SLOTS[name](id);
        if (Object.prototype.hasOwnProperty.call(data, name) && data[name] != null) {
          store().setItem(key, data[name]);
        } else if (exact) {
          // [FIX] checkpoint/fingerprint là mốc đếm neo của quá trình suy diễn tự động, thiếu chúng sẽ
          //   khiến anchor lùi về rỗng hoàn toàn, gây bế tắc (xem cơ chế dự phòng anchor trong
          //   runAutoEvolution của world-engine.js). Khi live.data trên mây thiếu hai khóa này, giữ nguyên
          //   giá trị cục bộ đã có, không xóa theo exact; các slot còn lại (state/worldbook/anchorLayer)
          //   vẫn xóa theo đúng ngữ nghĩa khôi phục chính xác.
          if (name === 'checkpoint' || name === 'fingerprint') continue;
          store().removeItem(key);
        }
      }
    } finally {
      _suspend = false;
    }
  }

  function currentRound(id) {
    try { return JSON.parse(store().getItem(SLOTS.state(id)) || '{}').round || 0; }
    catch (e) { return 0; }
  }

  // ========== Đọc/ghi không gian tên chat_metadata ==========

  function readNamespace() {
    const ctx = getCtx();
    const md = ctx && ctx.chatMetadata;
    const ns = md && md[NS];
    return (ns && typeof ns === 'object') ? ns : null;
  }

  function ensureNamespace() {
    const ns = readNamespace() || {};
    ns.v = SCHEMA_VERSION;
    if (!ns.live) ns.live = null;
    if (!Array.isArray(ns.snapshots)) ns.snapshots = [];
    pruneSnapshots(ns); // Sau nâng cấp số bản cũ có thể vượt limit hiện tại, thu gọn ngay
                         // (bịt lỗ hổng di trú "chỉ prune vào lần addSnapshot kế tiếp")
    return ns;
  }

  // Ghi toàn bộ không gian tên và lưu bền vào tệp chat. updateChatMetadata hợp nhất nông ở cấp cao nhất,
  // chỉ thay thế khóa world_engine.
  function writeNamespace(ns) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return false;
    try {
      const size = nsSize(ns);
      if (size > SIZE_WARN_BYTES) {
        console.warn(`[World Engine] Dung lượng bộ nhớ đệm Tavern hơi lớn (khoảng ${(size / 1024).toFixed(0)}KB), có thể làm chậm việc lưu chat, nên giảm bớt số bản lưu.`);
      }
      if (typeof ctx.updateChatMetadata === 'function') {
        ctx.updateChatMetadata({ [NS]: ns });
      } else if (ctx.chatMetadata) {
        ctx.chatMetadata[NS] = ns; // Phương án dự phòng: gắn trực tiếp vào chat_metadata hiện tại
      } else {
        return false;
      }
      // Lưu bền: ưu tiên dùng bản chống dội (an toàn với group, tự động bỏ lưu khi đổi chat)
      if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
      else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
      else if (typeof ctx.saveChat === 'function') ctx.saveChat();
      return true;
    } catch (e) {
      console.warn('[World Engine] Ghi chat_metadata thất bại', e);
      return false;
    }
  }

  // ========== Số hiệu chỉnh sửa Lamport ==========

  function localRev(id) {
    const v = parseInt(store().getItem(revKey(id)) || '0', 10);
    return Number.isFinite(v) ? v : 0;
  }
  function setLocalRev(id, rev) {
    _suspend = true; // Số hiệu chỉnh sửa không phải slot, nhưng vẫn đi qua store; tạm ngưng để tránh kích hoạt tick
    try { store().setItem(revKey(id), String(rev)); } finally { _suspend = false; }
  }

  // Đẩy không gian làm việc cục bộ lên chat làm live, số hiệu chỉnh sửa +1
  // (dùng khi: bật đồng bộ để gieo mầm, cục bộ mới hơn nên thu gọn, đặt lên đầu sau khi khôi phục)
  // force=true thì đẩy vô điều kiện (sau khi khôi phục bản lưu, dù nội dung giống nhau vẫn phải cho live
  // trỏ đến trạng thái vừa khôi phục); nếu không, khi nội dung đóng gói mới hoàn toàn trùng với ns.live.data,
  // trả về rev hiện tại, không +1, không ghi đĩa —
  // tránh việc ghi slot không đổi cũng kích hoạt một lần lưu toàn bộ tệp chat (nguyên nhân chính gây giật
  // liên tục sau nâng cấp).
  // Trả về: nếu có nsArg thì trả rev mới (hoặc null nghĩa là chưa đẩy); không có nsArg thì trả true/false.
  function pushLiveNow(nsArg, force) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return nsArg ? null : false;
    const id = ctx.chatId;
    const data = packChat(id);
    // Rào chắn an toàn: khi cục bộ không có bản lưu nào, tuyệt đối không dùng nội dung rỗng ghi đè lên
    // live đã có trong chat. Nếu không, "thiết bị đã mất dữ liệu cục bộ" hễ bật đồng bộ trước sẽ xóa sạch
    // bản lưu thật ở nơi khác (cài đặt exact sẽ xóa slot).
    if (Object.keys(data).length === 0) return nsArg ? null : false;
    const ns = nsArg || ensureNamespace();
    // Khử trùng lặp nội dung: không đổi thì không đẩy, không tăng rev (trừ khi force)
    if (!force && ns.live && ns.live.chatId === id && sameData(ns.live.data, data)) {
      const curRev = (ns.live && ns.live.rev) || localRev(id);
      return nsArg ? curRev : true;
    }
    const rev = Math.max(localRev(id), (ns.live && ns.live.rev) || 0) + 1;
    ns.live = { rev, updatedAt: Date.now(), chatId: id, data };
    if (nsArg) return rev; // Bên gọi chịu trách nhiệm writeNamespace + setLocalRev
    if (writeNamespace(ns)) { setLocalRev(id, rev); return true; }
    return false;
  }

  // ========== Callback slot đồng bộ + tick chống dội ==========

  let _tickTimer = null;
  function scheduleTick() {
    if (!syncEnabled() && !autoBackupEnabled()) return;
    if (_tickTimer) clearTimeout(_tickTimer);
    _tickTimer = setTimeout(() => { _tickTimer = null; runTick(); }, TICK_DELAY);
  }

  // Một tick gộp "đồng bộ live" và "tự động sao lưu" thành một lần ghi chat, giảm số lần lưu chat
  function runTick() {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    const id = ctx.chatId;
    if (!syncEnabled() && !autoBackupEnabled()) return;
    const ns = ensureNamespace();
    let changed = false;
    let revToSet = null;

    if (syncEnabled()) {
      const prevRev = (ns.live && ns.live.rev) || 0;
      const r = pushLiveNow(ns, false); // Khử trùng lặp nội dung: không đổi thì trả về rev hiện tại, không cập nhật ns.live
      if (r != null && r !== prevRev) { revToSet = r; changed = true; }
    }
    if (autoBackupEnabled() && addAutoBackupIfAdvanced(ns, id)) {
      changed = true;
    }
    if (changed && writeNamespace(ns) && revToSet != null) setLocalRev(id, revToSet);
  }

  function onStoreWrite(key, value) {
    try { npcScope.onStoreWrite(key); }
    catch (e) { console.warn('[Công Cụ Nhân Vật] Lên lịch ghi bộ nhớ đệm Tavern thất bại (đã cách ly)', e); }
    if (_suspend) return;
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    if (!slotOfKey(key, ctx.chatId)) return; // Chỉ quan tâm slot của chat hiện tại; khóa cài đặt, khóa chat khác đều bỏ qua
    scheduleTick();
  }
  function onStoreRemove(key) { onStoreWrite(key, null); }

  // ========== Nạp chat: khôi phục / thu gọn cho đồng bộ thời gian thực ==========

  function onChatLoaded() {
    try { npcScope.onChatLoaded(); }
    catch (e) { console.warn('[Công Cụ Nhân Vật] Khôi phục bộ nhớ đệm Tavern thất bại (đã cách ly)', e); }
    // Bỏ tick đang chờ còn sót lại từ chat trước, tránh nó vô tình ghi đĩa / sinh bản tự động sao lưu ở ngữ cảnh B
    if (_tickTimer) { clearTimeout(_tickTimer); _tickTimer = null; }
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return;
    const id = ctx.chatId;
    _lastAutoRound = currentRound(id); // Lấy vòng lúc mở làm mốc, chỉ tự động sao lưu khi tiến xa hơn mốc này
    if (!syncEnabled()) return;        // Khi tắt đồng bộ thời gian thực thì không tự đổi không gian làm việc cục bộ (lưu trữ là thuần thủ công)

    const ns = readNamespace();
    const lr = localRev(id);
    const remoteData = (ns && ns.live && ns.live.data) || {};
    const remoteRev = (ns && ns.live && ns.live.rev) || 0;
    // Chat chưa có live (hoặc nội dung live rỗng / hỏng): cục bộ có dữ liệu thì đẩy lên làm mầm giống
    if (!ns || !ns.live || Object.keys(remoteData).length === 0) {
      if (hasAnyLocal(id)) pushLiveNow();
      return;
    }
    if (remoteRev > lr) {
      installPack(remoteData, id, true); // Bản trên mây mới hơn → dùng bản đó
      setLocalRev(id, remoteRev);
      console.log(`[World Engine] Bộ nhớ đệm Tavern: dùng bản lưu mới hơn trên mây rev ${remoteRev} (cục bộ ${lr})`);
    } else if (remoteRev < lr) {
      pushLiveNow(); // Cục bộ mới hơn → đẩy lên để thu gọn
    }
    // remoteRev === lr: đã đồng bộ, không cần xử lý
  }

  // ========== Lưu trữ / sao lưu ==========

  function genId() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function addSnapshot(ns, snap, id) {
    snap.id = snap.id || genId();
    snap.createdAt = snap.createdAt || Date.now();
    snap.chatId = id;
    snap.v = SCHEMA_VERSION;
    ns.snapshots.unshift(snap); // Mới → cũ
    pruneSnapshots(ns);
    return snap;
  }

  // Tự động sao lưu cuốn chiếu giữ lại MAX_AUTO_BACKUPS bản; thủ công / nhập vào giữ lại MAX_MANUAL_BACKUPS bản;
  // giữ nguyên thứ tự mới → cũ ban đầu
  function pruneSnapshots(ns) {
    const keepAuto = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
    const keepManual = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
    ns.snapshots = ns.snapshots.filter(s => (s.auto ? keepAuto : keepManual).includes(s));
  }

  function addAutoBackupIfAdvanced(ns, id) {
    const round = currentRound(id);
    if (round <= 0) return false;
    if (_lastAutoRound != null && round <= _lastAutoRound) return false;
    const packed = packChat(id);
    const newestAuto = ns.snapshots.find(s => s.auto);
    if (newestAuto && sameData(newestAuto.data, packed)) {
      _lastAutoRound = round; // Nội dung giống bản tự động sao lưu mới nhất → bỏ qua, nhưng vẫn cập nhật mốc
      return false;
    }
    addSnapshot(ns, { name: `Tự động sao lưu · Vòng ${round}`, auto: true, round, data: packed }, id);
    _lastAutoRound = round;
    return true;
  }

  // —— Giao diện (UI) hướng ra ngoài ——

  function listSnapshots() {
    const ns = readNamespace();
    return ns && Array.isArray(ns.snapshots) ? ns.snapshots.slice() : [];
  }

  // Lưu trữ có đặt tên thủ công; trả về snapshot vừa tạo hoặc null
  function createSnapshot(name) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return null;
    const id = ctx.chatId;
    if (!hasAnyLocal(id)) return null;
    const ns = ensureNamespace();
    const round = currentRound(id);
    const snap = addSnapshot(ns, {
      name: String(name || `Lưu trữ · Vòng ${round}`).trim().slice(0, 60) || `Lưu trữ · Vòng ${round}`,
      auto: false, round, data: packChat(id)
    }, id);
    return writeNamespace(ns) ? snap : null;
  }

  // Khôi phục một bản lưu vào chat hiện tại (ghi đè không gian làm việc). Trước khi khôi phục sẽ tự động
  // sao lưu trạng thái hiện tại để có thể quay lại.
  function restoreSnapshot(snapId) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return false;
    const id = ctx.chatId;
    const ns = ensureNamespace();
    const snap = ns.snapshots.find(s => s.id === snapId);
    if (!snap) return false;
    if (hasAnyLocal(id)) {
      addSnapshot(ns, {
        name: `Tự động sao lưu trước khi khôi phục · Vòng ${currentRound(id)}`, auto: true, round: currentRound(id), data: packChat(id)
      }, id);
    }
    installPack(snap.data, id, true);
    normalizeAfterRestore(id); // Chuẩn hóa tầng/vân tay về số tầng hiện tại, tránh bị hiểu nhầm là roll lại (giống với "nhập dữ liệu")
    // Cập nhật live (trỏ đến trạng thái vừa khôi phục) trên cùng một ns, cuối cùng chỉ ghi đĩa một lần,
    // tránh hai lần writeNamespace ghi đè lẫn nhau
    let revToSet = null;
    if (syncEnabled()) revToSet = pushLiveNow(ns, true); // force: sau khi khôi phục dù nội dung giống nhau vẫn phải cho live trỏ đến trạng thái vừa khôi phục, tránh lần onChatLoaded sau bị giá trị cũ trên mây ghi đè
    if (writeNamespace(ns) && revToSet != null) setLocalRev(id, revToSet);
    return true;
  }

  // Sau khi khôi phục bản lưu cũ: căn chỉnh chatLayer, fingerprint của state/checkpoint về "số tầng hội thoại hiện tại".
  // Giống logic "nhập dữ liệu" trong ui.js, nếu không số tầng cũ sẽ khiến việc chèn chính văn/suy diễn hiểu nhầm vòng này là roll lại.
  function normalizeAfterRestore(id) {
    const layer = core().getChatLayer();
    _suspend = true;
    try {
      const stateRaw = store().getItem(SLOTS.state(id));
      if (stateRaw != null) {
        const st = JSON.parse(stateRaw); st.chatLayer = layer;
        store().setItem(SLOTS.state(id), JSON.stringify(st));
      }
      const cpRaw = store().getItem(SLOTS.checkpoint(id));
      if (cpRaw != null) {
        const cp = JSON.parse(cpRaw); cp.chatLayer = layer;
        store().setItem(SLOTS.checkpoint(id), JSON.stringify(cp));
      }
      store().setItem(SLOTS.fingerprint(id), String(layer));
    } catch (e) {
      console.warn('[World Engine] Chuẩn hóa sau khôi phục thất bại', e);
    } finally {
      _suspend = false;
    }
  }

  function renameSnapshot(snapId, name) {
    const ns = ensureNamespace();
    const snap = ns.snapshots.find(s => s.id === snapId);
    if (!snap) return false;
    snap.name = String(name || snap.name).trim().slice(0, 60) || snap.name;
    return writeNamespace(ns);
  }

  function deleteSnapshot(snapId) {
    const ns = ensureNamespace();
    const before = ns.snapshots.length;
    ns.snapshots = ns.snapshots.filter(s => s.id !== snapId);
    if (ns.snapshots.length === before) return false;
    return writeNamespace(ns);
  }

  // Xuất một bản lưu thành đối tượng có thể tải xuống (UI chịu trách nhiệm ghi thành tệp)
  function exportSnapshot(snapId) {
    const ns = readNamespace();
    const snap = ns && ns.snapshots.find(s => s.id === snapId);
    if (!snap) return null;
    return {
      type: 'world-engine-chat-snapshot', v: SCHEMA_VERSION,
      name: snap.name, round: snap.round, createdAt: snap.createdAt,
      exportedAt: Date.now(), data: snap.data
    };
  }

  // Nhập từ đối tượng đã xuất thành một bản lưu mới; trả về snapshot vừa tạo hoặc null
  function importSnapshot(obj) {
    const ctx = getCtx();
    if (!ctx || !chatUsable(ctx)) return null;
    if (!obj || obj.type !== 'world-engine-chat-snapshot' || !obj.data || typeof obj.data !== 'object') return null;
    const ns = ensureNamespace();
    const snap = addSnapshot(ns, {
      name: (String(obj.name || 'Bản lưu đã nhập').trim().slice(0, 52) || 'Bản lưu đã nhập') + ' (đã nhập)',
      auto: false, round: obj.round || 0, data: obj.data
    }, ctx.chatId);
    return writeNamespace(ns) ? snap : null;
  }

  // Dùng để hiển thị trạng thái trên bảng điều khiển
  function getStatus() {
    const ctx = getCtx();
    const usable = chatUsable(ctx);
    const ns = readNamespace();
    return {
      usable,
      chatId: usable ? ctx.chatId : null,
      apiAvailable: !!(ctx && typeof ctx.updateChatMetadata === 'function' && typeof ctx.saveMetadataDebounced === 'function'),
      syncEnabled: syncEnabled(),
      autoBackupEnabled: autoBackupEnabled(),
      liveRev: ns && ns.live ? ns.live.rev : 0,
      localRev: usable ? localRev(ctx.chatId) : 0,
      liveUpdatedAt: ns && ns.live ? ns.live.updatedAt : null,
      snapshotCount: ns && ns.snapshots ? ns.snapshots.length : 0
    };
  }

  // ========== Phạm vi (scope) Công Cụ Nhân Vật ==========
  // Dùng chung ngữ cảnh chat, việc ghi chat_metadata, tương tác lưu trữ và store sink của module này;
  // chỉ thay đổi cài đặt và slot.
  const npcScope = (function() {
    const NPC_NS = 'npc_engine';
    const MSLOTS = {
      state: id => `npc_engine_state_${id}`,
      checkpoint: id => `npc_engine_checkpoint_${id}`,
      worldbook: id => `npc_engine_worldbook_selection_${id}`
    };
    let suspend = false, tickTimer = null, lastAutoState = null;
    const msettings = () => window.NPC_ENGINE_SETTINGS?.getSettings?.() || {};
    const syncOn = () => msettings().syncToChat === true;
    const backupOn = () => msettings().autoBackup === true;
    const mrevKey = id => `npc_engine_${id}_syncrev`;
    const mrev = id => Math.max(0, parseInt(store().getItem(mrevKey(id)) || '0') || 0);
    function setMrev(id, rev) { suspend = true; try { store().setItem(mrevKey(id), String(rev)); } finally { suspend = false; } }
    function isSlot(key, id) { return Object.values(MSLOTS).some(make => make(id) === key); }
    function hasLocal(id) { return Object.values(MSLOTS).some(make => store().getItem(make(id)) != null); }
    function mpack(id) {
      const data = {};
      for (const name in MSLOTS) { const raw = store().getItem(MSLOTS[name](id)); if (raw != null) data[name] = raw; }
      return data;
    }
    function minstall(data, id, exact) {
      suspend = true;
      try {
        for (const name in MSLOTS) {
          if (Object.prototype.hasOwnProperty.call(data || {}, name)) store().setItem(MSLOTS[name](id), data[name]);
          else if (exact) store().removeItem(MSLOTS[name](id));
        }
      } finally { suspend = false; }
    }
    function meta(id) {
      try {
        const state = JSON.parse(store().getItem(MSLOTS.state(id)) || '{}');
        const entities = ['organization', 'object', 'ability', 'location']
        return {
          round: Number(state.round) || 0,
          characters: Array.isArray(state.npcs) ? state.npcs.length : 0,
          entities: Array.isArray(state.archive) ? state.archive.length : 0
        };
      } catch (e) { return { round: 0, characters: 0, entities: 0 }; }
    }
    function read() { const ns = getCtx()?.chatMetadata?.[NPC_NS]; return ns && typeof ns === 'object' ? ns : null; }
    function ensure() {
      const ns = read() || { v: SCHEMA_VERSION, live: null, snapshots: [] };
      ns.v = SCHEMA_VERSION; if (!Array.isArray(ns.snapshots)) ns.snapshots = [];
      const auto = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
      const manual = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
      ns.snapshots = ns.snapshots.filter(s => (s.auto ? auto : manual).includes(s));
      return ns;
    }
    function write(ns) {
      const ctx = getCtx(); if (!chatUsable(ctx)) return false;
      try {
        if (typeof ctx.updateChatMetadata === 'function') ctx.updateChatMetadata({ [NPC_NS]: ns });
        else if (ctx.chatMetadata) ctx.chatMetadata[NPC_NS] = ns; else return false;
        if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
        else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
        else if (typeof ctx.saveChat === 'function') ctx.saveChat();
        return true;
      } catch (e) { console.warn('[Công Cụ Nhân Vật] Ghi bộ nhớ đệm chat thất bại', e); return false; }
    }
    function add(ns, input, id) {
      const info = meta(id);
      const snap = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: input.name, auto: !!input.auto, round: input.round ?? info.round, characters: input.characters ?? info.characters, entities: input.entities ?? info.entities, createdAt: Date.now(), chatId: id, v: SCHEMA_VERSION, data: input.data };
      ns.snapshots.unshift(snap);
      const autos = ns.snapshots.filter(s => s.auto).slice(0, MAX_AUTO_BACKUPS);
      const manuals = ns.snapshots.filter(s => !s.auto).slice(0, MAX_MANUAL_BACKUPS);
      ns.snapshots = ns.snapshots.filter(s => (s.auto ? autos : manuals).includes(s));
      return snap;
    }
    function pushLiveNow(nsArg, force) {
      const ctx = getCtx(); if (!chatUsable(ctx) || !hasLocal(ctx.chatId)) return false;
      const ns = nsArg || ensure(), data = mpack(ctx.chatId);
      if (!force && ns.live?.data && sameData(ns.live.data, data)) return nsArg ? ns.live.rev : true;
      const rev = Math.max(mrev(ctx.chatId), Number(ns.live?.rev) || 0) + 1;
      ns.live = { rev, updatedAt: Date.now(), chatId: ctx.chatId, data };
      if (nsArg) return rev;
      if (write(ns)) { setMrev(ctx.chatId, rev); return true; }
      return false;
    }
    function runTick() {
      tickTimer = null;
      const ctx = getCtx(); if (!chatUsable(ctx)) return;
      const ns = ensure(); let changed = false, rev = null;
      if (syncOn()) { const old = Number(ns.live?.rev) || 0; rev = pushLiveNow(ns, false); if (rev !== old) changed = true; }
      const stateRaw = store().getItem(MSLOTS.state(ctx.chatId));
      if (backupOn() && stateRaw && stateRaw !== lastAutoState) {
        const data = mpack(ctx.chatId), newest = ns.snapshots.find(s => s.auto);
        if (!newest || !sameData(newest.data, data)) { const info = meta(ctx.chatId); add(ns, { name: `Tự động sao lưu · Vòng ${info.round}`, auto: true, data }, ctx.chatId); changed = true; }
        lastAutoState = stateRaw;
      }
      if (changed && write(ns) && rev != null) setMrev(ctx.chatId, rev);
    }
    function onStoreWrite(key) {
      const ctx = getCtx(); if (suspend || !chatUsable(ctx) || !isSlot(key, ctx.chatId) || (!syncOn() && !backupOn())) return;
      clearTimeout(tickTimer); tickTimer = setTimeout(runTick, TICK_DELAY);
    }
    function onChatLoaded() {
      clearTimeout(tickTimer); tickTimer = null;
      const ctx = getCtx(); if (!chatUsable(ctx)) return;
      lastAutoState = store().getItem(MSLOTS.state(ctx.chatId));
      if (!syncOn()) return;
      const ns = read(), remoteRev = Number(ns?.live?.rev) || 0, local = mrev(ctx.chatId);
      if (!ns?.live?.data || !Object.keys(ns.live.data).length) { if (hasLocal(ctx.chatId)) pushLiveNow(); }
      else if (remoteRev > local) { minstall(ns.live.data, ctx.chatId, true); setMrev(ctx.chatId, remoteRev); }
      else if (remoteRev < local) pushLiveNow();
    }
    function listSnapshots() { return (read()?.snapshots || []).slice(); }
    function createSnapshot(name) {
      const ctx = getCtx(); if (!chatUsable(ctx) || !hasLocal(ctx.chatId)) return null;
      const ns = ensure(), snap = add(ns, { name: String(name || 'Lưu trữ ký ức').slice(0, 60), auto: false, data: mpack(ctx.chatId) }, ctx.chatId);
      return write(ns) ? snap : null;
    }
    function restoreSnapshot(id) {
      const ctx = getCtx(); if (!chatUsable(ctx)) return false;
      const ns = ensure(), snap = ns.snapshots.find(s => s.id === id); if (!snap) return false;
      if (hasLocal(ctx.chatId)) add(ns, { name: 'Tự động sao lưu trước khi khôi phục', auto: true, data: mpack(ctx.chatId) }, ctx.chatId);
      minstall(snap.data, ctx.chatId, true);
      const rev = syncOn() ? pushLiveNow(ns, true) : null;
      if (!write(ns)) return false; if (rev != null) setMrev(ctx.chatId, rev); return true;
    }
    function renameSnapshot(id, name) { const ns = ensure(), snap = ns.snapshots.find(s => s.id === id); if (!snap) return false; snap.name = String(name || snap.name).slice(0, 60); return write(ns); }
    function deleteSnapshot(id) { const ns = ensure(), before = ns.snapshots.length; ns.snapshots = ns.snapshots.filter(s => s.id !== id); return ns.snapshots.length !== before && write(ns); }
    function exportSnapshot(id) { const s = listSnapshots().find(x => x.id === id); return s ? { type: 'npc-engine-chat-snapshot', v: SCHEMA_VERSION, name: s.name, round: s.round, characters: s.characters, entities: s.entities, createdAt: s.createdAt, data: s.data } : null; }
    function importSnapshot(obj) {
      const ctx = getCtx(); if (!chatUsable(ctx) || obj?.type !== 'npc-engine-chat-snapshot' || !obj.data) return null;
      const ns = ensure(), snap = add(ns, { name: String(obj.name || 'Bản lưu đã nhập') + ' (đã nhập)', auto: false, round: obj.round, characters: obj.characters, entities: obj.entities, data: obj.data }, ctx.chatId);
      return write(ns) ? snap : null;
    }
    function getStatus() { const ctx = getCtx(), ns = read(); return { usable: chatUsable(ctx), apiAvailable: !!(ctx && (typeof ctx.updateChatMetadata === 'function' || ctx.chatMetadata)), syncEnabled: syncOn(), autoBackupEnabled: backupOn(), localRev: chatUsable(ctx) ? mrev(ctx.chatId) : 0, liveRev: Number(ns?.live?.rev) || 0, snapshotCount: ns?.snapshots?.length || 0 }; }
    return { onStoreWrite, onChatLoaded, pushLiveNow, getStatus, listSnapshots, createSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot, exportSnapshot, importSnapshot };
  })();

  // ========== Khởi tạo ==========

  let _inited = false;
  function init() {
    if (_inited) return;
    _inited = true;
    store().setSyncSink({ onWrite: onStoreWrite, onRemove: onStoreRemove });
    // Bộ nhớ đệm chat thuộc nền tảng dùng chung, vòng đời không được gắn vào world hay bất kỳ engine nghiệp vụ nào.
    // Listener này đăng ký trước listener của các engine, khi đổi chat sẽ khôi phục mọi scope đã biết trước.
    const ctx = getCtx();
    if (ctx?.eventSource?.on) {
      const eventName = ctx.event_types?.CHAT_LOADED || 'chat_loaded';
      const guard = window.WORLD_ENGINE_GUARD_EVENT;
      const handler = typeof guard === 'function'
        ? guard('Bộ nhớ đệm dùng chung', 'Nạp chat', onChatLoaded)
        : function() { try { onChatLoaded(); } catch (e) { console.error('[Bộ nhớ đệm dùng chung] Xử lý sự kiện nạp chat thất bại', e); } };
      ctx.eventSource.on(eventName, handler);
    }
    // Khi extension nạp thì chat thường đã sẵn sàng (làm mới trang, extension bật giữa chừng):
    // thực hiện một lần khôi phục / thu gọn cho chat hiện tại
    try { onChatLoaded(); } catch (e) { console.warn('[World Engine] Khôi phục khởi tạo bộ nhớ đệm Tavern thất bại', e); }
  }

  function forScope(scope) {
    if (scope === 'npc') return npcScope;
    if (scope == null || scope === '' || scope === 'world') return null;
    throw new Error(`Scope bộ nhớ đệm chat không xác định: ${scope}`);
  }

  return {
    init, onChatLoaded, pushLiveNow, getStatus,
    listSnapshots, createSnapshot, restoreSnapshot, renameSnapshot, deleteSnapshot,
    exportSnapshot, importSnapshot,
    forScope
  };
})();
