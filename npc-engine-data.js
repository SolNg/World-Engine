// npc-engine-data.js — Trạng thái và điểm lưu của Công Cụ Nhân Vật, tách biệt theo từng cuộc trò chuyện
window.NPC_ENGINE_DATA = (function() {
  const STATE_PREFIX = 'npc_engine_state_';
  const CHECKPOINT_PREFIX = 'npc_engine_checkpoint_';
  const VERSION = '1.0.0';

  const TIERS = ['core', 'peripheral'];
  const KNOWLEDGE_SOURCES = ['chứng kiến', 'nghe đồn', 'suy đoán'];

  // Độ gần suy ra bằng so khớp tiền tố đường dẫn vị trí, không cần bảng khoảng cách.
  const PROXIMITY = Object.freeze({
    SAME_SPOT: 'same-spot',   // trùng hết đường dẫn
    SAME_CITY: 'same-city',   // trùng tới cấp thành, khác điểm
    SAME_REGION: 'same-region', // trùng tới cấp vùng, khác thành
    FAR: 'far'                // chỉ trùng quốc gia, hoặc không trùng gì
  });

  function getChatId() {
    return window.WORLD_ENGINE_CORE?.getChatId?.() || 'default';
  }

  function key(prefix) { return prefix + getChatId(); }
  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  const clean = value => String(value == null ? '' : value).trim();
  const normalized = value => clean(value).toLocaleLowerCase();
  const unique = values => Array.from(new Set((Array.isArray(values) ? values : [values]).map(clean).filter(Boolean)));
  const asArray = value => Array.isArray(value) ? value : [];
  const asLayer = value => Number.isFinite(Number(value)) ? Number(value) : null;

  function parse(raw, fallback) {
    if (!raw) return clone(fallback);
    try { return JSON.parse(raw); } catch (error) { return clone(fallback); }
  }

  // ========== Khuôn dữ liệu ==========

  function emptyLocation() {
    return { path: [], movingTo: null, etaRounds: 0, travelMode: '', userBelievesAt: '', fogSince: null };
  }

  function newNpc(seed) {
    const source = seed || {};
    return {
      id: clean(source.id),
      name: clean(source.name),
      aliases: unique(source.aliases).filter(alias => normalized(alias) !== normalized(source.name)),
      tier: TIERS.includes(source.tier) ? source.tier : 'peripheral',
      significance: Math.min(100, Math.max(0, parseInt(source.significance) || 0)),
      pinned: source.pinned === true,
      firstSeenLayer: asLayer(source.firstSeenLayer),
      lastSeenLayer: asLayer(source.lastSeenLayer),

      location: { ...emptyLocation(), ...(source.location || {}) },
      goals: asArray(source.goals),
      faction: source.faction || { name: '', role: '', standing: '' },
      relations: {
        user: (source.relations && source.relations.user) || { attitude: '', trust: 0, lastChangeReason: '' },
        npcs: asArray(source.relations && source.relations.npcs)
      },
      knowledge: asArray(source.knowledge),
      status: {
        condition: clean(source.status && source.status.condition) || 'khoẻ',
        resources: clean(source.status && source.status.resources),
        alive: (source.status && source.status.alive) !== false,
        archived: (source.status && source.status.archived) === true
      },

      offscreenLog: asArray(source.offscreenLog),
      pendingIntent: source.pendingIntent || null
    };
  }

  function defaultState() {
    return {
      version: VERSION,
      round: 0,
      chatLayer: null,
      npcs: [],
      archive: [],
      travelCache: {},
      rumorQueue: [],
      // Cảnh hiện tại: dùng để biết ai đang có mặt, từ đó chỉ phát ràng buộc tri thức cho đúng người.
      scene: { layer: null, location: [], presentIds: [] },
      // Những chuyện "thiên hạ có thể biết". Ràng buộc tri thức là phép trừ giữa danh sách này và
      // knowledge của từng NPC — không có nó thì không thể nói "nhân vật này CHƯA biết chuyện gì".
      publicFacts: [],
      worldLink: { lastWorldRound: 0, lastDigest: '' }
    };
  }

  // Bảo đảm mọi mảng/đối tượng đều tồn tại sau khi đọc từ dữ liệu lưu trữ cũ hoặc lỗi.
  function ensureShape(state) {
    const target = state && typeof state === 'object' ? state : {};
    const base = defaultState();
    target.version = target.version || base.version;
    target.round = Math.max(0, parseInt(target.round) || 0);
    target.chatLayer = asLayer(target.chatLayer);
    target.npcs = asArray(target.npcs).map(newNpc);
    target.archive = asArray(target.archive).map(newNpc);
    target.travelCache = (target.travelCache && typeof target.travelCache === 'object' && !Array.isArray(target.travelCache))
      ? target.travelCache : {};
    target.rumorQueue = asArray(target.rumorQueue);
    target.publicFacts = asArray(target.publicFacts);
    const scene = target.scene && typeof target.scene === 'object' && !Array.isArray(target.scene) ? target.scene : {};
    target.scene = {
      layer: asLayer(scene.layer),
      location: asArray(scene.location),
      presentIds: asArray(scene.presentIds)
    };
    target.worldLink = target.worldLink && typeof target.worldLink === 'object' ? target.worldLink : clone(base.worldLink);
    return target;
  }

  // ========== Đọc / ghi trạng thái ==========

  function loadState() {
    return ensureShape(parse(window.WORLD_ENGINE_STORE?.getItem(key(STATE_PREFIX)), defaultState()));
  }

  function saveState(state) {
    const payload = ensureShape(clone(state));
    window.WORLD_ENGINE_STORE?.setItem(key(STATE_PREFIX), JSON.stringify(payload));
    return payload;
  }

  function clearState() {
    window.WORLD_ENGINE_STORE?.removeItem(key(STATE_PREFIX));
  }

  // ========== Điểm lưu (sao nguyên cơ chế trạng thái kép a/b của Công Cụ Thế Giới) ==========
  // a = điểm lưu, sao chép toàn bộ trạng thái mỗi khi có lượt mới; b = vùng làm việc mà giao diện hiển thị.
  // Reroll (type=swipe/regenerate) thì chèn a, để lần sinh mới không nhìn thấy hệ quả của lần sinh cũ.

  function loadCheckpoint() {
    const raw = window.WORLD_ENGINE_STORE?.getItem(key(CHECKPOINT_PREFIX));
    return raw ? ensureShape(parse(raw, null)) : null;
  }

  function saveCheckpoint(state) {
    window.WORLD_ENGINE_STORE?.setItem(key(CHECKPOINT_PREFIX), JSON.stringify(ensureShape(clone(state))));
  }

  function clearCheckpoint() {
    window.WORLD_ENGINE_STORE?.removeItem(key(CHECKPOINT_PREFIX));
  }

  // ========== Lùi tầng ==========
  // Điểm lưu chỉ sâu một cấp nên không phủ được trường hợp xoá lùi nhiều tầng. Hai trường cộng dồn
  // (knowledge, offscreenLog) đóng dấu layer để lọc bỏ trực tiếp — lọc chứ không phát lại, vì đây là
  // các bản ghi độc lập, không có gộp/khử trùng như knowledge_index của Công Cụ Ký Ức cũ.
  function rollbackToLayer(state, layer) {
    const target = asLayer(layer);
    if (target === null) return state;
    const dropped = { knowledge: 0, offscreen: 0, rumors: 0 };

    const stripNpc = npc => {
      const knowledge = npc.knowledge.filter(item => {
        const itemLayer = asLayer(item?.layer);
        return itemLayer === null || itemLayer < target;
      });
      const offscreenLog = npc.offscreenLog.filter(item => {
        const itemLayer = asLayer(item?.layer);
        return itemLayer === null || itemLayer < target;
      });
      dropped.knowledge += npc.knowledge.length - knowledge.length;
      dropped.offscreen += npc.offscreenLog.length - offscreenLog.length;
      npc.knowledge = knowledge;
      npc.offscreenLog = offscreenLog;
      // Dự định chưa hoàn tất được sinh ra ở tầng bị bỏ thì cũng không còn hiệu lực.
      const intentLayer = asLayer(npc.pendingIntent?.layer);
      if (intentLayer !== null && intentLayer >= target) npc.pendingIntent = null;
      return npc;
    };

    state.npcs = state.npcs.map(stripNpc);
    state.archive = state.archive.map(stripNpc);

    const byLayer = list => asArray(list).filter(item => {
      const itemLayer = asLayer(item?.layer);
      return itemLayer === null || itemLayer < target;
    });

    const rumors = byLayer(state.rumorQueue);
    dropped.rumors = state.rumorQueue.length - rumors.length;
    state.rumorQueue = rumors;

    const facts = byLayer(state.publicFacts);
    dropped.facts = state.publicFacts.length - facts.length;
    state.publicFacts = facts;

    // Cảnh được ghi ở tầng bị bỏ thì không còn phản ánh đúng nội dung đang hiển thị.
    if (asLayer(state.scene.layer) !== null && state.scene.layer >= target) {
      state.scene = { layer: null, location: [], presentIds: [] };
    }

    state.chatLayer = target;
    state.lastRollback = { layer: target, dropped };
    return state;
  }

  // ========== Tra cứu NPC ==========

  function findNpc(state, idOrName) {
    const needle = normalized(idOrName);
    if (!needle) return null;
    const match = list => list.find(npc =>
      normalized(npc.id) === needle ||
      normalized(npc.name) === needle ||
      npc.aliases.some(alias => normalized(alias) === needle));
    return match(state.npcs) || match(state.archive) || null;
  }

  function nextNpcId(state) {
    const used = [...state.npcs, ...state.archive]
      .map(npc => parseInt(String(npc.id).replace(/^npc:/, '')))
      .filter(Number.isFinite);
    return 'npc:' + ((used.length ? Math.max(...used) : 0) + 1);
  }

  function upsertNpc(state, seed) {
    const existing = findNpc(state, seed?.id || seed?.name);
    if (!existing) {
      const created = newNpc({ ...seed, id: clean(seed?.id) || nextNpcId(state) });
      state.npcs.push(created);
      return created;
    }
    Object.assign(existing, newNpc({ ...existing, ...seed, id: existing.id }));
    return existing;
  }

  // ========== Kho lưu trữ (NPC chết) ==========
  // Chỉ áp dụng cho bậc trọng yếu — quần chúng vốn không được lưu nên không có gì để đánh dấu.
  // NPC trong kho không sinh hoạt động ngầm và không tính vào npcCoreLimit, nhưng vẫn tra cứu được
  // và ràng buộc tri thức vẫn còn hiệu lực: người khác chưa chắc đã biết là nhân vật này đã chết.

  function archiveNpc(state, idOrName, reason) {
    const npc = findNpc(state, idOrName);
    if (!npc) return null;
    npc.status.alive = false;
    npc.status.archived = true;
    if (clean(reason)) npc.status.condition = clean(reason);
    state.npcs = state.npcs.filter(item => item.id !== npc.id);
    if (!state.archive.some(item => item.id === npc.id)) state.archive.push(npc);
    return npc;
  }

  function reviveNpc(state, idOrName) {
    const npc = findNpc(state, idOrName);
    if (!npc) return null;
    npc.status.alive = true;
    npc.status.archived = false;
    state.archive = state.archive.filter(item => item.id !== npc.id);
    if (!state.npcs.some(item => item.id === npc.id)) state.npcs.push(npc);
    return npc;
  }

  // ========== Bộ lọc 3 bậc ==========
  // Vượt npcCoreLimit thì NPC trọng yếu lâu không xuất hiện nhất bị hạ bậc. NPC được ghim thì miễn.
  // Đây là van chặn duy nhất ngăn chi phí prompt phình ra khi truyện dài.
  function enforceCoreLimit(state, limit) {
    const max = Math.max(1, parseInt(limit) || 12);
    const core = state.npcs.filter(npc => npc.tier === 'core' && !npc.status.archived);
    if (core.length <= max) return [];

    const demotable = core.filter(npc => !npc.pinned)
      .sort((a, b) => (a.lastSeenLayer ?? -1) - (b.lastSeenLayer ?? -1));
    const overflow = core.length - max;
    const demoted = demotable.slice(0, Math.max(0, overflow));
    for (const npc of demoted) npc.tier = 'peripheral';
    return demoted.map(npc => npc.id);
  }

  // ========== Vị trí và di chuyển ==========

  function proximity(pathA, pathB) {
    const a = asArray(pathA).map(normalized).filter(Boolean);
    const b = asArray(pathB).map(normalized).filter(Boolean);
    if (!a.length || !b.length) return PROXIMITY.FAR;

    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;

    if (shared === a.length && shared === b.length) return PROXIMITY.SAME_SPOT;
    if (shared >= 3) return PROXIMITY.SAME_CITY;
    if (shared === 2) return PROXIMITY.SAME_REGION;
    return PROXIMITY.FAR;
  }

  const travelKey = (from, to) => `${clean(from)}→${clean(to)}`;

  function getTravel(state, from, to) {
    return state.travelCache[travelKey(from, to)] || null;
  }

  function setTravel(state, from, to, value) {
    const eta = Math.max(0, parseInt(value?.etaRounds) || 0);
    state.travelCache[travelKey(from, to)] = {
      etaRounds: eta,
      travelMode: clean(value?.travelMode),
      storyDays: Number.isFinite(Number(value?.storyDays)) ? Number(value.storyDays) : null,
      updatedRound: Math.max(0, parseInt(value?.updatedRound) || state.round || 0)
    };
    return state.travelCache[travelKey(from, to)];
  }

  // Trừ dần mỗi lượt. Engine chỉ đếm, không tự phán đoán địa lý — việc đó do AI làm một lần khi
  // hành trình bắt đầu (xem npc-engine-offscreen.js).
  function tickTravel(state) {
    const arrived = [];
    for (const npc of state.npcs) {
      const location = npc.location;
      if (!location.movingTo || location.etaRounds <= 0) continue;
      location.etaRounds -= 1;
      if (location.etaRounds <= 0) {
        location.path = asArray(location.movingTo).length ? clone(location.movingTo) : location.path;
        location.movingTo = null;
        location.etaRounds = 0;
        location.travelMode = '';
        arrived.push(npc.id);
      }
    }
    return arrived;
  }

  return {
    VERSION,
    TIERS,
    KNOWLEDGE_SOURCES,
    PROXIMITY,
    defaultState,
    ensureShape,
    newNpc,
    loadState,
    saveState,
    clearState,
    loadCheckpoint,
    saveCheckpoint,
    clearCheckpoint,
    rollbackToLayer,
    findNpc,
    nextNpcId,
    upsertNpc,
    archiveNpc,
    reviveNpc,
    enforceCoreLimit,
    proximity,
    travelKey,
    getTravel,
    setTravel,
    tickTravel
  };
})();
