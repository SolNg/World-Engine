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
  // Number(null) === 0 chứ không phải NaN, nên bản cũ biến "không có tầng" thành "tầng 0".
  const asLayer = value => (value === null || value === undefined || value === '')
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);

  function parse(raw, fallback) {
    if (!raw) return clone(fallback);
    try { return JSON.parse(raw); } catch (error) { return clone(fallback); }
  }

  // ========== Khuôn dữ liệu ==========

  function emptyLocation() {
    // arriveAt: mốc phút truyện mà nhân vật tới nơi. etaRounds giữ lại cho dữ liệu cũ.
    return { path: [], movingTo: null, arriveAt: null, etaRounds: 0, travelMode: '', userBelievesAt: '', fogSince: null };
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

      // Neo nhân dạng: những thứ KHÔNG được trôi theo thời gian. Mô hình chỉ được điền vào ô còn
      // trống, không bao giờ được sửa ô đã có — nếu không, qua vài chục lượt nó sẽ lặng lẽ đổi
      // giới tính, tuổi hay chủng tộc của một nhân vật mà chẳng ai để ý. Muốn sửa thì sửa tay.
      identity: {
        gender: clean(source.identity && source.identity.gender),
        pronouns: clean(source.identity && source.identity.pronouns),
        species: clean(source.identity && source.identity.species),
        ageStage: clean(source.identity && source.identity.ageStage),
        appearance: clean(source.identity && source.identity.appearance),
        socialRole: clean(source.identity && source.identity.socialRole)
      },

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
        archived: (source.status && source.status.archived) === true,
        archivedLayer: asLayer(source.status && source.status.archivedLayer)
      },

      // Đề nghị đổi nhân dạng do mô hình nêu, CHỜ người chơi duyệt. Không tự áp dụng bao giờ.
      identityProposals: asArray(source.identityProposals),
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
      lastStoryDay: null,
      // Đồng hồ thế giới: trục thời gian duy nhất, tính bằng phút truyện kể từ đầu chat.
      clock: { minutes: 0 },
      storyTime: { label: '', day: null, elapsedDays: null, source: 'none' },
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
    target.lastStoryDay = asLayer(target.lastStoryDay);
    target.clock = { minutes: Math.max(0, parseInt(target.clock?.minutes) || 0) };
    const time = target.storyTime && typeof target.storyTime === 'object' ? target.storyTime : {};
    target.storyTime = { label: clean(time.label), day: asLayer(time.day), elapsedDays: asLayer(time.elapsedDays), source: clean(time.source) || 'none' };
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
    const dropped = { knowledge: 0, offscreen: 0, rumors: 0, npcs: 0, revived: 0 };

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

    // Nhân vật XUẤT HIỆN LẦN ĐẦU ở tầng bị bỏ thì phải biến mất theo. Trước đây chỗ này chỉ lọc
    // các trường cộng dồn bên trong từng nhân vật, nên reroll hay xoá lượt xong thì nhân vật của
    // lần sinh đã bỏ vẫn nằm nguyên trong hồ sơ — chỉ rỗng ruột.
    // Người có firstSeenLayer rỗng thì giữ: đó là người nhập tay hoặc từ lorebook, không thuộc tầng nào.
    const bornAtOrAfter = npc => {
      const born = asLayer(npc?.firstSeenLayer);
      return born !== null && born >= target;
    };
    const removedIds = new Set([...state.npcs, ...state.archive].filter(bornAtOrAfter).map(npc => npc.id));
    dropped.npcs = removedIds.size;

    state.npcs = state.npcs.filter(npc => !removedIds.has(npc.id)).map(stripNpc);
    state.archive = state.archive.filter(npc => !removedIds.has(npc.id)).map(stripNpc);

    // Người bị đưa vào kho ở tầng bị bỏ thì kéo trở lại: cái chết đó chưa từng xảy ra.
    const revived = state.archive.filter(npc => {
      const archivedAt = asLayer(npc?.status?.archivedLayer);
      return archivedAt !== null && archivedAt >= target;
    });
    for (const npc of revived) {
      npc.status.archived = false;
    npc.status.archivedLayer = null;
      npc.status.alive = true;
      npc.status.archivedLayer = null;
      state.archive = state.archive.filter(item => item.id !== npc.id);
      if (!state.npcs.some(item => item.id === npc.id)) state.npcs.push(npc);
    }
    dropped.revived = revived.length;

    // Gỡ luôn quan hệ trỏ tới những người vừa biến mất.
    for (const npc of [...state.npcs, ...state.archive]) {
      npc.relations.npcs = asArray(npc.relations?.npcs).filter(link => !removedIds.has(link?.id));
    }
    state.scene.presentIds = asArray(state.scene?.presentIds).filter(id => !removedIds.has(id));

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

  function archiveNpc(state, idOrName, reason, layer) {
    const npc = findNpc(state, idOrName);
    if (!npc) return null;
    npc.status.alive = false;
    npc.status.archived = true;
    npc.status.archivedLayer = asLayer(layer);
    if (clean(reason)) npc.status.condition = clean(reason);
    state.npcs = state.npcs.filter(item => item.id !== npc.id);
    if (!state.archive.some(item => item.id === npc.id)) state.archive.push(npc);
    return npc;
  }

  // Gộp neo nhân dạng theo nguyên tắc ĐIỀN MỘT LẦN: ô trống thì nhận giá trị mới, ô đã có thì giữ
  // nguyên. Đây chính là cơ chế chống trôi — mô hình không có đường nào ghi đè lên thứ đã chốt.
  // Trả về danh sách ô vừa được điền, để nơi gọi biết có gì thay đổi.
  const IDENTITY_FIELDS = ['gender', 'pronouns', 'species', 'ageStage', 'appearance', 'socialRole'];

  function mergeIdentity(npc, incoming) {
    const filled = [];
    if (!npc || !incoming || typeof incoming !== 'object') return filled;
    for (const field of IDENTITY_FIELDS) {
      const value = clean(incoming[field]);
      if (!value || clean(npc.identity[field])) continue;
      npc.identity[field] = value;
      filled.push(field);
    }
    return filled;
  }

  // Chính văn có thể tiết lộ nhân dạng khác thật: người cải trang bị lột mặt nạ, hoặc lần chốt đầu
  // sai vì cảnh mơ hồ. Nhưng cho mô hình tự sửa thì cơ chế chống trôi mất sạch ý nghĩa.
  //
  // Nên đề nghị được GHI LẠI chứ không áp dụng: hồ sơ giữ nguyên, giao diện hiện dấu chờ duyệt,
  // người chơi bấm đồng ý thì mới đổi. Không có gì đổi âm thầm sau lưng.
  function proposeIdentityChange(npc, change, layer) {
    if (!npc || !change || typeof change !== 'object') return null;
    const field = clean(change.field);
    const value = clean(change.value);
    const reason = clean(change.reason);
    if (!IDENTITY_FIELDS.includes(field) || !value || !reason) return null;

    const current = clean(npc.identity[field]);
    if (!current || normalized(current) === normalized(value)) return null;   // chưa chốt hoặc không đổi gì

    npc.identityProposals = asArray(npc.identityProposals).filter(item => item.field !== field);
    const proposal = { field, from: current, to: value, reason, layer: asLayer(layer) };
    npc.identityProposals.push(proposal);
    return proposal;
  }

  function applyIdentityProposal(npc, field) {
    const proposal = asArray(npc?.identityProposals).find(item => item.field === field);
    if (!proposal) return null;
    npc.identity[proposal.field] = proposal.to;
    npc.identityProposals = npc.identityProposals.filter(item => item.field !== field);
    return proposal;
  }

  function dismissIdentityProposal(npc, field) {
    const before = asArray(npc?.identityProposals).length;
    npc.identityProposals = asArray(npc?.identityProposals).filter(item => item.field !== field);
    return before !== npc.identityProposals.length;
  }

  // Mô tả nhân dạng thành một dòng, dùng cho prompt và cho ràng buộc gửi AI chính.
  function describeIdentity(npc) {
    const identity = npc?.identity || {};
    const parts = [
      clean(identity.gender),
      clean(identity.pronouns) ? `xưng hô: ${clean(identity.pronouns)}` : '',
      clean(identity.species),
      clean(identity.ageStage),
      clean(identity.socialRole),
      clean(identity.appearance)
    ].filter(Boolean);
    return parts.join(' · ');
  }

  // Xoá hẳn khỏi cả danh sách hoạt động lẫn kho. Dùng khi mô hình nhận nhầm một nhân vật không
  // có thật, hoặc gộp nhầm hai người thành một — khác với archiveNpc là "đã chết nhưng vẫn tính".
  function removeNpc(state, idOrName) {
    const npc = findNpc(state, idOrName);
    if (!npc) return null;
    state.npcs = state.npcs.filter(item => item.id !== npc.id);
    state.archive = state.archive.filter(item => item.id !== npc.id);
    state.scene.presentIds = asArray(state.scene?.presentIds).filter(id => id !== npc.id);
    // Gỡ luôn khỏi quan hệ của người khác, nếu không sẽ còn trỏ tới người không tồn tại.
    for (const other of [...state.npcs, ...state.archive]) {
      other.relations.npcs = asArray(other.relations?.npcs)
        .filter(link => normalized(link?.id) !== normalized(npc.id) && normalized(link?.name) !== normalized(npc.name));
    }
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

  // ========== Đồng hồ thế giới ==========
  // Trục thời gian duy nhất, tính bằng PHÚT truyện kể từ đầu cuộc trò chuyện. Một lượt hội thoại
  // không phải một đơn vị thời gian: nó chỉ là lúc quyết toán, còn đồng hồ nhích bao nhiêu là do
  // chính văn quyết định. Đây là chỗ khác căn bản so với bản cũ đếm bằng "còn N lượt".
  const MINUTES_PER_DAY = 24 * 60;

  function advanceClock(state, minutes) {
    const step = Math.max(0, Math.round(Number(minutes) || 0));
    state.clock = { minutes: Math.max(0, (parseInt(state.clock?.minutes) || 0) + step) };
    return state.clock.minutes;
  }

  function clockMinutes(state) {
    return Math.max(0, parseInt(state.clock?.minutes) || 0);
  }

  function formatClock(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const day = Math.floor(total / MINUTES_PER_DAY) + 1;
    const rest = total % MINUTES_PER_DAY;
    const hour = String(Math.floor(rest / 60)).padStart(2, '0');
    const minute = String(rest % 60).padStart(2, '0');
    return `Ngày ${day}, ${hour}:${minute}`;
  }

  // Quy khoảng thời gian ra phút. Nhận cả ba đơn vị để mô hình muốn báo kiểu nào cũng được.
  function toMinutes(elapsed) {
    if (!elapsed || typeof elapsed !== 'object') return null;
    const days = Number(elapsed.days);
    const hours = Number(elapsed.hours);
    const minutes = Number(elapsed.minutes);
    const parts = [days, hours, minutes].filter(Number.isFinite);
    if (!parts.length) return null;
    return Math.max(0, Math.round(
      (Number.isFinite(days) ? days : 0) * MINUTES_PER_DAY
      + (Number.isFinite(hours) ? hours : 0) * 60
      + (Number.isFinite(minutes) ? minutes : 0)
    ));
  }

  function describeDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 1) return 'gần như chưa nhích';
    if (total < 60) return `${total} phút`;
    if (total < MINUTES_PER_DAY) {
      const hours = Math.floor(total / 60);
      const rest = total % 60;
      return rest ? `${hours} giờ ${rest} phút` : `${hours} giờ`;
    }
    const days = Math.floor(total / MINUTES_PER_DAY);
    const hours = Math.floor((total % MINUTES_PER_DAY) / 60);
    return hours ? `${days} ngày ${hours} giờ` : `${days} ngày`;
  }

  // ========== Bốn kiểu hẹn ==========
  // Không phải việc gì cũng tiến theo cùng một cách. Rèn một thanh kiếm cần 20 giờ NGỒI RÈN, chứ
  // không phải 20 giờ trôi qua; một cuộc hẹn thì tới đúng giờ mới xảy ra; chờ hồi âm thì không có
  // hạn nào cả. Bản cũ quy tất cả về "còn N lượt" nên cái nào cũng sai theo kiểu riêng của nó.
  const SCHEDULE_MODES = ['natural', 'effort', 'scheduled', 'conditional'];

  function newSchedule(seed) {
    const source = seed || {};
    const mode = SCHEDULE_MODES.includes(source.mode) ? source.mode : 'natural';
    return {
      mode,
      dueAt: asLayer(source.dueAt),              // natural + scheduled: mốc phút truyện phải tới
      needMinutes: Math.max(0, parseInt(source.needMinutes) || 0),   // effort: tổng công cần bỏ ra
      doneMinutes: Math.max(0, parseInt(source.doneMinutes) || 0),   // effort: đã bỏ ra bao nhiêu
      condition: clean(source.condition)          // conditional: đợi điều gì
    };
  }

  // Một việc đã tới lúc phải kết chưa?
  function isScheduleDue(schedule, nowMinutes) {
    if (!schedule) return false;
    switch (schedule.mode) {
      case 'effort':
        return schedule.needMinutes > 0 && schedule.doneMinutes >= schedule.needMinutes;
      case 'conditional':
        return false;   // chỉ kết khi mô hình báo điều kiện đã xảy ra
      case 'scheduled':
      case 'natural':
      default:
        return schedule.dueAt !== null && nowMinutes >= schedule.dueAt;
    }
  }

  function describeSchedule(schedule, nowMinutes) {
    if (!schedule) return '';
    switch (schedule.mode) {
      case 'effort': {
        const left = Math.max(0, schedule.needMinutes - schedule.doneMinutes);
        // describeDuration(0) trả "gần như chưa nhích", đọc lạc nghĩa trong ngữ cảnh này.
        const done = schedule.doneMinutes > 0 ? describeDuration(schedule.doneMinutes) : 'chưa bắt đầu';
        return `cần bỏ công thêm ${describeDuration(left)} (đã làm ${done} / cần ${describeDuration(schedule.needMinutes)})`;
      }
      case 'scheduled':
        return schedule.dueAt === null ? 'hẹn giờ chưa rõ' : `hẹn lúc ${formatClock(schedule.dueAt)}`;
      case 'conditional':
        return schedule.condition ? `chờ điều kiện: ${schedule.condition}` : 'chờ điều kiện chưa rõ';
      case 'natural':
      default: {
        if (schedule.dueAt === null) return 'chưa rõ hạn';
        const left = schedule.dueAt - nowMinutes;
        return left <= 0 ? 'đã tới hạn' : `còn ${describeDuration(left)}`;
      }
    }
  }

  // ========== Dự định đang treo ==========
  // Dự định cũng phải đếm ngược như hành trình. Trước đây nó chỉ được đặt vào rồi đưa vào prompt
  // mỗi lượt mà không bao giờ trừ hay hết hạn, nên một dự định kiểu "đi ăn ngay hôm nay" vẫn được
  // nhắc lại nguyên văn sau khi truyện đã nhảy ba ngày — mô hình đọc thấy thì viết tiếp cảnh đó.
  //
  // Vòng đời: còn hạn → đến hạn (phải xử lý dứt điểm trong lượt này) → quá hạn thì bỏ.
  // Cho đúng một lượt ở trạng thái "đến hạn" để mô hình có cơ hội kết lại, không thì treo mãi.
  // Đếm theo ĐỒNG HỒ, không theo lượt. elapsedMinutes là thời gian truyện vừa trôi qua ở lượt này;
  // workedMinutes là phần trong đó nhân vật thực sự bỏ công (chỉ dùng cho kiểu 'effort').
  //
  // Đường lui: không đọc được thời gian thì elapsedMinutes null, lúc đó vẫn trừ một bước mặc định
  // để mọi thứ không đứng im vĩnh viễn — thà ước lượng thô còn hơn treo mãi.
  function tickIntents(state, elapsedMinutes, options) {
    const due = [], expired = [];
    const now = clockMinutes(state);
    // asLayer chứ không phải Number.isFinite(Number(v)): Number(null) === 0 nên bản viết thẳng sẽ
    // coi "không biết" thành "không trôi phút nào" và bước lui không bao giờ chạy.
    const reported = asLayer(elapsedMinutes);
    const elapsed = reported !== null
      ? Math.max(0, Math.round(reported))
      : Math.max(0, parseInt(options?.fallbackMinutes) || 0);

    for (const npc of state.npcs) {
      const intent = npc.pendingIntent;
      if (!intent || !clean(intent.action)) continue;
      intent.schedule = newSchedule(intent.schedule);

      // Kiểu 'effort' chỉ tiến khi nhân vật thực sự ngồi làm. Mặc định coi như họ có làm, trừ khi
      // đang đi đường — không ai vừa cưỡi ngựa vừa rèn kiếm được.
      if (intent.schedule.mode === 'effort') {
        const busyTravelling = npc.location?.movingTo && (npc.location.arriveAt ?? null) !== null;
        if (!busyTravelling) intent.schedule.doneMinutes += elapsed;
      }

      // Đã ở trạng thái đến hạn từ lượt trước mà vẫn còn đây: mô hình không kết, bỏ đi.
      if (intent.due === true) { npc.pendingIntent = null; expired.push(npc.id); continue; }

      if (isScheduleDue(intent.schedule, now)) {
        intent.due = true;
        due.push(npc.id);
        continue;
      }

      // Việc ngắn hạn mà thời gian đã trôi qua xa hơn hẳn thì lỗi thời, dù chưa tới mốc hẹn.
      // Ngưỡng một ngày: một dự định "hôm nay" mà đã sang ngày khác thì nó đã kết thúc rồi.
      const bornAt = asLayer(intent.bornAt);
      if (bornAt !== null && intent.schedule.mode !== 'conditional'
          && now - bornAt >= MINUTES_PER_DAY && !intent.due) {
        intent.due = true;
        intent.staleByTime = true;
        due.push(npc.id);
      }
    }

    return { due: unique(due), expired: unique(expired), elapsed };
  }

  // Trừ dần mỗi lượt. Engine chỉ đếm, không tự phán đoán địa lý — việc đó do AI làm một lần khi
  // hành trình bắt đầu (xem npc-engine-offscreen.js).
  // Hành trình cũng chạy theo đồng hồ: arriveAt là mốc phút truyện mà nhân vật tới nơi.
  // Giữ đường lui cho dữ liệu cũ còn dùng etaRounds — trừ dần một bước mỗi lượt như trước.
  function tickTravel(state) {
    const arrived = [];
    const now = clockMinutes(state);

    for (const npc of state.npcs) {
      const location = npc.location;
      if (!location.movingTo) continue;

      const arriveAt = asLayer(location.arriveAt);
      if (arriveAt !== null) {
        if (now < arriveAt) continue;
      } else {
        // Dữ liệu cũ: không có mốc thời gian, đếm lượt như bản trước.
        const eta = Math.max(0, parseInt(location.etaRounds) || 0);
        if (eta > 1) { location.etaRounds = eta - 1; continue; }
      }

      location.path = asArray(location.movingTo).length ? clone(location.movingTo) : location.path;
      location.movingTo = null;
      location.arriveAt = null;
      location.etaRounds = 0;
      location.travelMode = '';
      arrived.push(npc.id);
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
    removeNpc,
    mergeIdentity,
    describeIdentity,
    IDENTITY_FIELDS,
    proposeIdentityChange,
    applyIdentityProposal,
    dismissIdentityProposal,
    enforceCoreLimit,
    proximity,
    travelKey,
    getTravel,
    setTravel,
    tickTravel,
    tickIntents,
    MINUTES_PER_DAY,
    SCHEDULE_MODES,
    advanceClock,
    clockMinutes,
    formatClock,
    toMinutes,
    describeDuration,
    newSchedule,
    isScheduleDue,
    describeSchedule
  };
})();
