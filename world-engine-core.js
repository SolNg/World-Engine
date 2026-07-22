// world-engine-core.js — Cấu trúc dữ liệu cốt lõi và lưu trữ (cách ly theo ID cuộc trò chuyện)
window.WORLD_ENGINE_CORE = (function() {
  const STORAGE_PREFIX = 'world_engine_';
  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['Manh Nha', 'Âm Ỉ', 'Cận Kề'],
    progress: ['Chuẩn Bị', 'Thực Hiện', 'Then Chốt']
  };
  const EVENT_STAGE_MAP = {
    conflict: ['Manh Nha', 'Âm Ỉ', 'Cận Kề', 'Đã Bùng Phát', 'Đã Tan Biến'],
    progress: ['Chuẩn Bị', 'Thực Hiện', 'Then Chốt', 'Đã Hoàn Thành', 'Đã Thất Bại']
  };
  const EVENT_SUCCESS_STAGE = {
    conflict: 'Đã Bùng Phát',
    progress: 'Đã Hoàn Thành'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['Đã Bùng Phát', 'Đã Tan Biến'],
    progress: ['Đã Hoàn Thành', 'Đã Thất Bại']
  };

  function getSettings() {
    return window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
  }

  function capSetting(key, fallback) {
    const n = Number(getSettings()[key]);
    return Math.max(1, Math.round(Number.isFinite(n) ? n : fallback));
  }

  function getDefaultState() {
    return {
      round: 0,
      worldDigest: 'Thế giới đang thức tỉnh, mọi thứ vẫn còn là một ẩn số.',
      events: [],
      factions: [],
      winds: [],
      worldTrends: [],
      reputation: {
        authority: 'Vô Danh Tiểu Tốt',
        common: 'Vô Danh Tiểu Tốt',
        shadow: 'Vô Danh Tiểu Tốt',
        circuit: 'Vô Danh Tiểu Tốt',
        lastChange: ''
      },
      economy: {
        climate: 'Bình Ổn',
        signals: []
      },
      memories: [],
      enemies: [],
      influenceChain: [],
      regionalIncident: {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        cooldown: 0,
        _retry: false,
        _retryType: ''
      },
      distantEvent: {
        pending: false,
        cooldown: 0,
        sample: [],
        requestedRound: 0,
        requestedType: ''
      },
      nearEvent: {
        pending: false,
        cooldown: 0,
        requestedRound: 0,
        requestedType: ''
      },
      blackbox: {
        secretActions: [],
        secretAssets: []
      },
      worldNotes: [],
      lastEvolveResult: null,
      lastInjection: null,
      lastUpdated: {}
    };
  }

  /** Lấy tên nhân vật đang đóng vai hiện tại */
  function getUserName() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx?.name1) return ctx.name1;
      if (ctx?.name2) return ctx.name2;
      const character = ctx?.characters?.[ctx?.characterId];
      if (character?.name) return character.name;
    } catch(e) {}
    return 'Người Dùng';
  }

  /** Render UI: thay thế {{user}} trong văn bản bằng tên nhân vật hiện tại */
  function renderUserName(text) {
    if (!text || typeof text !== 'string') return text;
    const name = getUserName();
    return text.replace(/\{\{user\}\}/g, name);
  }

  function getChatId() {
    try {
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.chatId) return ctx.chatId;
    } catch(e) {}
    return 'default';
  }

  // Các thực thể bền vững dùng ID theo danh mục. ID chỉ duy nhất trong dòng thời gian của trạng thái hiện tại; sau khi reroll / khôi phục save,
  // số thứ tự tiếp theo sẽ tự nhiên tiếp nối từ giá trị lớn nhất của mảng sau khi khôi phục, không duy trì bộ đếm toàn cục không thể hoàn tác.
  const ENTITY_ID_PREFIXES = {
    events: 'event',
    factions: 'faction',
    worldTrends: 'trend',
    winds: 'wind',
    enemies: 'enemy'
  };
  const ENTITY_LEGACY_KEYS = {
    events: 'name',
    factions: 'name',
    worldTrends: 'name',
    winds: 'topic',
    enemies: 'name'
  };

  function entityIdNumber(id, prefix) {
    const m = String(id || '').match(new RegExp(`^${prefix}_([1-9]\\d*)$`));
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  function nextEntityId(items, prefix) {
    let max = 0;
    for (const item of (items || [])) {
      const n = item && entityIdNumber(item.id, prefix);
      if (n !== null && n > max) max = n;
    }
    return `${prefix}_${max + 1}`;
  }

  /**
   * Di chuyển save cũ và sửa lỗi hỏng dữ liệu:
   * - ID bị thiếu/không hợp lệ sẽ được đánh số bổ sung theo hiện trạng mảng;
   * - ID trùng lặp chỉ giữ lại đối tượng xuất hiện đầu tiên, các đối tượng sau nhận ID mới;
   * - ID hợp lệ không bị sắp xếp lại, đảm bảo việc tải save, nhập dữ liệu và khôi phục checkpoint ổn định.
   */
  function ensureEntityIds(items, prefix) {
    if (!Array.isArray(items)) return items;
    let max = 0;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const n = entityIdNumber(item.id, prefix);
      if (n !== null && n > max) max = n;
    }
    const seen = new Set();
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const n = entityIdNumber(item.id, prefix);
      if (n !== null && !seen.has(item.id)) {
        seen.add(item.id);
        continue;
      }
      do { max++; } while (seen.has(`${prefix}_${max}`));
      item.id = `${prefix}_${max}`;
      seen.add(item.id);
    }
    return items;
  }

  function findEntityIndex(items, incoming, prefix, legacyKey) {
    if (!Array.isArray(items) || !incoming || typeof incoming !== 'object') return -1;
    const explicitlyNew = Object.prototype.hasOwnProperty.call(incoming, 'id')
      && (incoming.id === null || incoming.id === '');
    if (explicitlyNew) return -1;
    if (entityIdNumber(incoming.id, prefix) !== null) {
      const byId = items.findIndex(item => item && item.id === incoming.id);
      if (byId !== -1) return byId;
    }
    // Tương thích preset cũ/model cũ: khi không trả về ID hoặc trả về ID không xác định, chỉ dùng mục trùng tên duy nhất để nhận lại ID cũ.
    const value = incoming[legacyKey];
    if (!value) return -1;
    const matches = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i] && items[i][legacyKey] === value) matches.push(i);
    }
    return matches.length === 1 ? matches[0] : -1;
  }

  function assignEntityId(items, item, prefix) {
    if (!item || typeof item !== 'object') return item;
    item.id = nextEntityId(items, prefix);
    return item;
  }

  // Khi nâng cấp save cũ lần đầu, checkpoint là trạng thái tổ tiên và là chuẩn tham chiếu định danh.
  // Trạng thái hiện tại trước tiên kế thừa ID checkpoint theo tên cũ duy nhất, sau đó mới tiếp tục đánh số cho các thực thể mới thêm trong lượt này.
  function inheritLegacyIds(targetState, referenceState) {
    if (!targetState || !referenceState) return targetState;
    for (const collection of Object.keys(ENTITY_ID_PREFIXES)) {
      const prefix = ENTITY_ID_PREFIXES[collection];
      const legacyKey = ENTITY_LEGACY_KEYS[collection];
      const targetItems = Array.isArray(targetState[collection]) ? targetState[collection] : [];
      const referenceItems = Array.isArray(referenceState[collection]) ? referenceState[collection] : [];
      ensureEntityIds(referenceItems, prefix);
      const used = new Set(targetItems
        .map(item => item && entityIdNumber(item.id, prefix) !== null ? item.id : null)
        .filter(Boolean));
      for (const item of targetItems) {
        if (!item || typeof item !== 'object' || entityIdNumber(item.id, prefix) !== null) continue;
        const matches = referenceItems.filter(ref => ref && ref[legacyKey] && ref[legacyKey] === item[legacyKey]);
        if (matches.length === 1 && !used.has(matches[0].id)) {
          item.id = matches[0].id;
          used.add(item.id);
        }
      }
    }
    return targetState;
  }

  function ensureArrays(state) {
    state.memories = state.memories || [];
    state.events = state.events || [];
    ensureEntityIds(state.events, ENTITY_ID_PREFIXES.events);
    if (state.events) {
      for (const ev of state.events) {
        if (ev.stageRound === undefined) ev.stageRound = 1;
        if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
        if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
        if (ev.stall === undefined) ev.stall = false;
        // Sửa lỗi stageRound>=9 không được thăng cấp
        const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
        const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
        if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
          const STAGES = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
          const idx = STAGES.indexOf(ev.stage);
          if (idx !== -1 && idx < STAGES.length - 1) {
            ev.stage = STAGES[idx + 1];
            ev.stageRound = ev.stageRound - 9 || 1;
          } else {
            ev.stage = successStage;
            ev.stageRound = 9;
          }
        }
        if (terminalStages.includes(ev.stage)) {
          ev.stageRound = 9;
          ev.stall = false;
        }
      }
    }
    state.factions = state.factions || [];
    ensureEntityIds(state.factions, ENTITY_ID_PREFIXES.factions);
    const FACTION_RELATIONS = ['Huyết Minh', 'Đồng Minh', 'Thân Thiện', 'Trung Lập', 'Lạnh Nhạt', 'Thù Địch', 'Thâm Thù'];
    const FACTION_STATUSES = ['Cực Thịnh', 'Ổn Định', 'Nội Đấu', 'Khốn Đốn', 'Suy Tàn', 'Tan Rã'];
    for (const f of state.factions) {
      f.status = FACTION_STATUSES.includes(f.status) ? f.status : 'Ổn Định';
      // Di chuyển từ thang 8 cấp sang 7 cấp: giá trị "Căng Thẳng" trong save cũ được gộp vào "Lạnh Nhạt"
      if (f.relation === 'Căng Thẳng') f.relation = 'Lạnh Nhạt';
      f.relation = FACTION_RELATIONS.includes(f.relation) ? f.relation : 'Trung Lập';
      f.scope = f.scope || '';
      if (!Array.isArray(f.powerPillars)) f.powerPillars = [];
      else f.powerPillars = f.powerPillars.map(p => {
        const name = typeof p === 'string' ? p : (p.name || '');
        return name.length > 24 ? name.slice(0, 24) : name;
      }).filter(Boolean);
      if (f.powerPillars.length > 3) f.powerPillars.length = 3;
    }
    state.worldTrends = state.worldTrends || [];
    ensureEntityIds(state.worldTrends, ENTITY_ID_PREFIXES.worldTrends);
    if (state.worldTrends.length > capSetting('localCapWorldTrends', 4)) state.worldTrends.length = capSetting('localCapWorldTrends', 4);
    state.winds = state.winds || [];
    ensureEntityIds(state.winds, ENTITY_ID_PREFIXES.winds);
    state.winds = state.winds.map((wind, index) => {
      wind.topic = wind.topic || wind.content || `Tin Đồn${index + 1}`;
      if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
      wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.content = wind.content || '';
      wind.scope = wind.scope || 'Nơi Bắt Nguồn';
      wind.source = wind.source || 'Không Rõ Nguồn Gốc';
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0);
      return wind;
    });
    state.reputation = state.reputation || { authority: 'Vô Danh Tiểu Tốt', common: 'Vô Danh Tiểu Tốt', shadow: 'Vô Danh Tiểu Tốt', circuit: 'Vô Danh Tiểu Tốt' };
    // Di chuyển từ thang 6 cấp sang 5 cấp: giá trị "Có Chút Tiếng Tăm" trong save cũ được gộp vào "Được Kính Trọng"
    for (const _dim of ['authority', 'common', 'shadow', 'circuit']) {
      if (state.reputation[_dim] === 'Có Chút Tiếng Tăm') state.reputation[_dim] = 'Được Kính Trọng';
    }
    if (!state.reputation.lastChange) state.reputation.lastChange = '';
    state.economy = state.economy || { climate: 'Bình Ổn', signals: [] };
    if (!state.economy.signals) state.economy.signals = [];
    state.enemies = state.enemies || [];
    ensureEntityIds(state.enemies, ENTITY_ID_PREFIXES.enemies);
    state.influenceChain = Array.isArray(state.influenceChain) ? state.influenceChain : [];
    for (const influence of state.influenceChain) {
      if (influence && typeof influence === 'object' && influence._createdRound === undefined) {
        influence._createdRound = Number(state.round) || 0;
      }
    }
    if (!state.regionalIncident) {
      state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: 0, _retry: false, _retryType: '' };
    }
    state.regionalIncident.active = state.regionalIncident.active === true || state.regionalIncident.active === 'true';
    if (state.regionalIncident.cooldown === undefined) state.regionalIncident.cooldown = 0;
    if (state.regionalIncident.duration === undefined) state.regionalIncident.duration = 0;
    if (state.regionalIncident._retry === undefined) state.regionalIncident._retry = false;
    if (state.regionalIncident._retryType === undefined) state.regionalIncident._retryType = '';
    if (!state.distantEvent || typeof state.distantEvent !== 'object') {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    state.distantEvent.pending = state.distantEvent.pending === true || state.distantEvent.pending === 'true';
    state.distantEvent.cooldown = Math.max(0, parseInt(state.distantEvent.cooldown) || 0);
    state.distantEvent.sample = Array.isArray(state.distantEvent.sample) ? state.distantEvent.sample : [];
    state.distantEvent.requestedRound = Math.max(0, parseInt(state.distantEvent.requestedRound) || 0);
    state.distantEvent.requestedType = ['event', 'wind'].includes(state.distantEvent.requestedType) ? state.distantEvent.requestedType : '';
    if (!state.nearEvent || typeof state.nearEvent !== 'object') {
      state.nearEvent = { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' };
    }
    state.nearEvent.pending = state.nearEvent.pending === true || state.nearEvent.pending === 'true';
    state.nearEvent.cooldown = Math.max(0, parseInt(state.nearEvent.cooldown) || 0);
    state.nearEvent.requestedRound = Math.max(0, parseInt(state.nearEvent.requestedRound) || 0);
    state.nearEvent.requestedType = ['event', 'wind'].includes(state.nearEvent.requestedType) ? state.nearEvent.requestedType : '';
    if (!state.blackbox) {
      state.blackbox = { secretActions: [], secretAssets: [] };
    } else {
      state.blackbox.secretActions = state.blackbox.secretActions || [];
      state.blackbox.secretAssets = state.blackbox.secretAssets || [];
    }
    state.worldNotes = Array.isArray(state.worldNotes) ? state.worldNotes : [];
    state.lastInjection = state.lastInjection || null;
    return state;
  }

  function loadState() {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        const def = getDefaultState();
        const merged = { ...def, ...saved };
        merged.memories = saved.memories || [];
        merged.lastInjection = saved.lastInjection || null;
        const checkpointRaw = window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + chatId + '_checkpoint');
        if (checkpointRaw) {
          try {
            const checkpoint = ensureArrays(JSON.parse(checkpointRaw));
            inheritLegacyIds(merged, checkpoint);
          } catch (e) {
            console.warn('[World Engine] Căn chỉnh ID trạng thái hiện tại cũ thất bại, sẽ đánh số bổ sung theo hiện trạng của trạng thái hiện tại', e);
          }
        }
        return ensureArrays(merged);
      } catch(e) { console.warn('[World Engine] Tải trạng thái thất bại', e); }
    }
    return ensureArrays(getDefaultState());
  }

  /** Có tồn tại trạng thái hiện tại đã thực sự được lưu xuống đĩa hay không; loadState() sẽ chỉ trả về trạng thái mặc định tạm thời khi không tồn tại. */
  function hasState() {
    return window.WORLD_ENGINE_STORE.getItem(STORAGE_PREFIX + getChatId()) !== null;
  }

  function saveState(state) {
    const chatId = getChatId();
    const key = STORAGE_PREFIX + chatId;
    ensureArrays(state);
    state.lastUpdated = { chatId, timestamp: Date.now() };
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(state));
  }

  function clearState() {
    window.WORLD_ENGINE_STORE.removeItem(STORAGE_PREFIX + getChatId());
  }

  /** Lưu trạng thái và ghi lại số tầng cuộc trò chuyện hiện tại (gọi sau khi evolve hoàn tất) */
  function saveStateWithLayer(state) {
    state.chatLayer = getChatLayer();
    saveState(state);
  }

  // ========== Hệ thống điểm lưu (checkpoint) (trạng thái kép a/b) ==========
  // a = điểm lưu (checkpoint), được sao chép từ b mỗi khi có lượt trò chuyện mới
  // b = vùng làm việc (workspace), UI hiển thị cái này

  function getCheckpointKey() {
    return STORAGE_PREFIX + getChatId() + '_checkpoint';
  }

  function getAnchorLayerKey() {
    return STORAGE_PREFIX + getChatId() + '_anchorLayer';
  }

  function getFingerprintKey() {
    return STORAGE_PREFIX + getChatId() + '_fingerprint';
  }

  /** Lưu điểm lưu a (sao chép toàn bộ state hiện tại) */
  function saveCheckpoint(state) {
    const key = getCheckpointKey();
    const cp = JSON.parse(JSON.stringify(state));
    ensureArrays(cp);
    window.WORLD_ENGINE_STORE.setItem(key, JSON.stringify(cp));
  }

  /** Khôi phục trạng thái từ điểm lưu a */
  function restoreCheckpoint() {
    const key = getCheckpointKey();
    const raw = window.WORLD_ENGINE_STORE.getItem(key);
    if (raw) {
      try {
        const cp = JSON.parse(raw);
        return ensureArrays(cp);
      } catch(e) { console.warn('[World Engine] Đọc điểm lưu thất bại', e); }
    }
    return null;
  }

  /** Xóa điểm lưu */
  function clearCheckpoint() {
    window.WORLD_ENGINE_STORE.removeItem(getCheckpointKey());
  }

  /** Giao diện neo (anchor) độc lập phiên bản cũ (ngữ nghĩa số tầng được thống nhất là chat.length - 1; bộ đếm hiện tại không dùng nó nữa). */
  function getAnchorLayer() {
    const saved = window.WORLD_ENGINE_STORE.getItem(getAnchorLayerKey());
    return saved !== null ? Number(saved) : null;
  }

  /** Thiết lập neo đếm */
  function setAnchorLayer(l) {
    window.WORLD_ENGINE_STORE.setItem(getAnchorLayerKey(), String(l));
  }

  /** Lấy số tầng cuộc trò chuyện hiện tại (đếm từ 0) */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return 0; }
  }

  /** Lấy vân tay (fingerprint) của cuộc trò chuyện hiện tại (số tầng cuộc trò chuyện, dùng để xác định có phải reroll hay không) */
  function getChatFingerprint() {
    return String(getChatLayer());
  }

  /** Lưu vân tay vào localStorage */
  function saveFingerprint(fp) {
    window.WORLD_ENGINE_STORE.setItem(getFingerprintKey(), fp);
  }

  /** Đọc vân tay đã lưu lần trước */
  function loadFingerprint() {
    return window.WORLD_ENGINE_STORE.getItem(getFingerprintKey()) || '';
  }

  /** Xác định có phải lượt trò chuyện mới hay không (vân tay thay đổi → lượt mới; không đổi → reroll) */
  function isNewRound() {
    const oldFp = loadFingerprint();
    const newFp = getChatFingerprint();
    if (!oldFp) return true;
    return oldFp !== newFp;
  }

  function addMemory(state, memory) {
    if (!state) return;
    state.memories.unshift(memory);
    if (state.memories.length > 200) state.memories.pop();
    saveState(state);
  }

  // Bộ lọc đầu vào/đầu ra: theo settings.evolveFilterRegex (mỗi dòng một regex) xóa bỏ nội dung khớp mẫu.
  // Dùng để làm sạch văn bản hội thoại trước khi đưa vào suy diễn nền (chain-of-thought, thanh trạng thái, HTML, v.v.).
  //
  // Mỗi dòng một regex, hỗ trợ hai cách viết:
  //   1. Pattern thuần (ví dụ `ゐ<details>[\s\S]*?</details>`) —— tự động thay thế toàn cục theo cờ g (tương thích ngược với cách viết cũ);
  //   2. Literal JS `/pattern/flags` (ví dụ `/<details>[\s\S]*?<\/details>/g`) —— tự động bóc dấu phân cách để lấy flags,
  //      nếu flags không có g thì tự bổ sung g (người dùng viết `/pat/` hay `/pat/i` đều thực thi theo ngữ nghĩa xóa toàn cục).
  // Bỏ qua dòng trống; một dòng không hợp lệ sẽ không ném lỗi (im lặng trên đường chạy production), chỉ khi bên gọi truyền onError mới gọi lại để báo cáo.

  // Bóc tách một dòng văn bản thành {pattern, flags}. Pattern thuần → flags mặc định 'g'; literal /pat/flags → lấy flags của nó và đảm bảo có g.
  function stripRegexLine(pat) {
    const m = /^\/(.+)\/([a-z]*)$/i.exec(pat);
    if (m) {
      let flags = m[2] || '';
      if (flags.indexOf('g') < 0) flags += 'g';
      return { pattern: m[1], flags: flags };
    }
    return { pattern: pat, flags: 'g' };
  }

  // Chỉ kiểm tra: phân tích raw theo từng dòng, trả về { ok, bad, entries }. Không gọi replace, không có side effect.
  //   ok      —— số lượng dòng hợp lệ
  //   bad     —— [{ line: số dòng (bắt đầu từ 1), raw: văn bản dòng gốc (cắt còn 60 ký tự), reason: thông báo lỗi }]
  //   entries —— [{ line, pattern, flags }] các mục hợp lệ (dùng lại cho nút test/chẩn đoán)
  function validateFilterRegex(raw) {
    const out = { ok: 0, bad: [], entries: [] };
    if (!raw) return out;
    const lines = String(raw).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const pat = lines[i].trim();
      if (!pat) continue;
      const lineNo = i + 1;
      const stripped = stripRegexLine(pat);
      try {
        new RegExp(stripped.pattern, stripped.flags);   // chỉ thử biên dịch, không replace
        out.ok++;
        out.entries.push({ line: lineNo, pattern: stripped.pattern, flags: stripped.flags });
      } catch (e) {
        out.bad.push({ line: lineNo, raw: pat.slice(0, 60), reason: String(e && e.message || e) });
      }
    }
    return out;
  }

  // Lọc văn bản hội thoại. Tham số thứ ba onError(lineNo, rawLine, reason) là tùy chọn — nếu truyền vào sẽ gọi lại khi một dòng không hợp lệ (dùng khi lưu/test),
  // không truyền thì im lặng (đường chạy suy diễn production, tuyệt đối không được ngắt quãng). Cả ba điểm gọi trong production đều không truyền tham số thứ ba, hành vi giống phiên bản cũ.
  function filterDialogue(text, settings, onError) {
    if (!text) return text || '';
    const raw = (settings && settings.evolveFilterRegex) || '';
    if (!raw.trim()) return text;
    const v = validateFilterRegex(raw);
    let out = text;
    for (let i = 0; i < v.entries.length; i++) {
      const e = v.entries[i];
      // validateFilterRegex đã thử biên dịch trước đó, ở đây chắc chắn thành công; giữ try chỉ để phòng thủ dự phòng
      try { out = out.replace(new RegExp(e.pattern, e.flags), ''); } catch (err) { /* sẽ không rơi vào đây */ }
    }
    if (typeof onError === 'function' && v.bad.length) {
      const lines = String(raw).split('\n');
      for (let i = 0; i < v.bad.length; i++) {
        const b = v.bad[i];
        onError(b.line, lines[b.line - 1] || '', b.reason);
      }
    }
    return out;
  }

  // ========== Phân tích thời gian trong truyện (dùng cho chế độ suy diễn theo thời gian) ==========
  // Số tiếng Trung → số Ả Rập (số Ả Rập trả về nguyên trạng, rỗng → 0)
  function cnToNum(s) {
    if (s == null) return 0;
    s = String(s).trim();
    if (s === '') return 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    const D = { 零:0, 〇:0, 一:1, 二:2, 两:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
    s = s.replace(/^初/, '');               // bỏ tiền tố "初" (ví dụ: 初九 → 九)
    // Có chứa "万" (vạn/10000): tách đệ quy thành hai phần cao-thấp (phần trước "万" nếu rỗng thì tính là 1, tức "万" = 10000)
    if (s.includes('万')) {
      const idx = s.indexOf('万');
      return cnToNum(s.slice(0, idx) || '一') * 10000 + cnToNum(s.slice(idx + 1));
    }
    // Viết tắt 廿/卅: 廿=20, 廿三=23, 廿十=20 (phần theo sau không phải hàng đơn vị thì bỏ qua)
    if (s.includes('廿')) return 20 + (D[s.replace('廿', '')] || 0);
    if (s.includes('卅')) return 30 + (D[s.replace('卅', '')] || 0);
    // Giá trị hàng nghìn/trăm/chục + hàng đơn vị (số 0 dùng làm chỗ trống thì bỏ qua): 一千二百=1200, 二十七=27, 十一=11
    let total = 0, num = 0;
    const UNIT = { 十:10, 百:100, 千:1000 };
    for (const ch of s) {
      if (ch === '零' || ch === '〇') continue;
      if (D[ch] != null) num = D[ch];
      else if (UNIT[ch] != null) { total += (num === 0 ? 1 : num) * UNIT[ch]; num = 0; }
    }
    total += num;
    // Nếu cả đoạn không parse ra được số tiếng Trung nào → dùng số Ả Rập làm phương án dự phòng
    if (total === 0 && !/[零〇一二两三四五六七八九十百千]/.test(s)) {
      const n = parseInt(s, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return total;
  }

  // Cấp module: số ngày trong truyện gần nhất được phân tích từ nội dung chính (để UI hiển thị lại "thời gian lượt trò chuyện này")
  let _lastStoryDay = null;
  function getLastStoryDay() { return _lastStoryDay; }
  function setLastStoryDay(v) { _lastStoryDay = (v == null ? null : Number(v)); }

  /**
   * Phân tích "tổng số ngày" của câu chuyện từ nội dung chính theo cấu hình cài đặt. Trả về null nếu không phân tích được.
   * Quy tắc: lấy cửa sổ văn bản (front ký tự đầu + back ký tự cuối, cả hai đều 0 thì lấy toàn văn) → ghép regex từ 6 ô
   * (ô lẻ không rỗng thì thành capture group, ô chẵn là literal) → lấy kết quả khớp cuối cùng → tính tổng cnToNum của từng capture group nhân với hệ số nhân tương ứng.
   */
  function parseStoryDay(text, settings) {
    if (!text || !settings) return null;
    const front = Math.max(0, parseInt(settings.evolveTimeFront) || 0);
    const back = Math.max(0, parseInt(settings.evolveTimeBack) || 0);
    let win;
    if (front === 0 && back === 0) win = text;
    else win = (front > 0 ? text.slice(0, front) : '') + '\n' + (back > 0 ? text.slice(-back) : '');

    const boxes = [1, 2, 3, 4, 5, 6].map(i => settings['evolveTimeRe' + i] || '');
    const muls = [
      parseFloat(settings.evolveTimeMul1),
      parseFloat(settings.evolveTimeMul2),
      parseFloat(settings.evolveTimeMul3)
    ];
    let pattern = '';
    const activeMuls = [];
    for (let i = 0; i < 6; i++) {
      const b = boxes[i];
      if (i % 2 === 0) {                      // Ô số 1/3/5
        if (b) { pattern += '(' + b + ')'; activeMuls.push(muls[i / 2]); }
      } else {                               // Ô đơn vị 2/4/6 (literal, có thể để trống)
        pattern += b;
      }
    }
    if (!pattern || activeMuls.length === 0) return null;

    let re;
    try { re = new RegExp(pattern, 'g'); } catch (e) { return null; }
    let m, last = null;
    while ((m = re.exec(win)) !== null) {
      last = m;
      if (m.index === re.lastIndex) re.lastIndex++;   // Tránh vòng lặp vô hạn do match độ rộng 0
    }
    if (!last) return null;

    let total = 0;
    for (let k = 0; k < activeMuls.length; k++) {
      const mul = Number.isFinite(activeMuls[k]) ? activeMuls[k] : 0;
      total += cnToNum(last[k + 1]) * mul;
    }
    return total;
  }

  function ensureEventFields(ev) {
    if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
    if (ev.stageRound === undefined) ev.stageRound = 1;
    if (ev.level === undefined) ev.level = 1;
    if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
    if (ev.stall === undefined) ev.stall = false;
    // Hằng số giai đoạn
    const STAGES = EVENT_STAGE_MAP[ev.type] || EVENT_STAGE_MAP.conflict;
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const successStage = EVENT_SUCCESS_STAGE[ev.type] || EVENT_SUCCESS_STAGE.conflict;
    const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;
    if (!ev.stage || !STAGES.includes(ev.stage)) ev.stage = STAGES[0];
    // stageRound >= 9 tự động thăng cấp
    if (ev.stageRound >= 9 && !terminalStages.includes(ev.stage)) {
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = ev.stageRound - 9 || 1;
      } else {
        ev.stage = successStage;
        ev.stageRound = 9;
      }
    }
    // Khóa giai đoạn kết thúc ở 9/9
    if (terminalStages.includes(ev.stage)) {
      ev.stageRound = 9;
      ev.stall = false;
    }
    return ev;
  }

  function addEvent(state, event) {
    if (!state.events) state.events = [];
    ensureEntityIds(state.events, ENTITY_ID_PREFIXES.events);
    ensureEventFields(event);
    const idx = findEntityIndex(state.events, event, ENTITY_ID_PREFIXES.events, 'name');
    if (idx !== -1) {
      event.id = state.events[idx].id;
      state.events[idx] = { ...state.events[idx], ...event };
      ensureEventFields(state.events[idx]);
    } else {
      assignEntityId(state.events, event, ENTITY_ID_PREFIXES.events);
      state.events.unshift(event);
    }
    if (state.events.length > capSetting('localCapEvents', 16)) state.events.length = capSetting('localCapEvents', 16);
    saveState(state);
  }

  function addFaction(state, faction) {
    if (!state.factions) state.factions = [];
    ensureEntityIds(state.factions, ENTITY_ID_PREFIXES.factions);
    const FACTION_RELATIONS = ['Huyết Minh', 'Đồng Minh', 'Thân Thiện', 'Trung Lập', 'Lạnh Nhạt', 'Thù Địch', 'Thâm Thù'];
    const FACTION_STATUSES = ['Cực Thịnh', 'Ổn Định', 'Nội Đấu', 'Khốn Đốn', 'Suy Tàn', 'Tan Rã'];
    if (!FACTION_STATUSES.includes(faction.status)) faction.status = 'Ổn Định';
    if (faction.relation === 'Căng Thẳng') faction.relation = 'Lạnh Nhạt';
    if (!FACTION_RELATIONS.includes(faction.relation)) faction.relation = 'Trung Lập';
    faction.scope = faction.scope || '';
    if (!Array.isArray(faction.powerPillars)) faction.powerPillars = [];
    else faction.powerPillars = faction.powerPillars.map(p => {
      const name = typeof p === 'string' ? p : (p.name || '');
      return name.length > 24 ? name.slice(0, 24) : name;
    }).filter(Boolean);
    if (faction.powerPillars.length > 3) faction.powerPillars.length = 3;
    const idx = findEntityIndex(state.factions, faction, ENTITY_ID_PREFIXES.factions, 'name');
    if (idx !== -1) {
      faction.id = state.factions[idx].id;
      state.factions[idx] = { ...state.factions[idx], ...faction };
    } else {
      assignEntityId(state.factions, faction, ENTITY_ID_PREFIXES.factions);
      state.factions.unshift(faction);
    }
    if (state.factions.length > capSetting('localCapFactions', 15)) state.factions.length = capSetting('localCapFactions', 15);
    saveState(state);
  }

  function addWorldTrend(state, trend) {
    if (!state.worldTrends) state.worldTrends = [];
    ensureEntityIds(state.worldTrends, ENTITY_ID_PREFIXES.worldTrends);
    if (!trend || !trend.name) return;
    trend.status = trend.status === 'Đã Kết Thúc' ? 'Đã Kết Thúc' : 'Đang Diễn Ra';
    trend.scope = trend.scope || 'Thiên Hạ';
    trend.description = trend.description || '';
    trend.source = trend.source || '';
    const idx = findEntityIndex(state.worldTrends, trend, ENTITY_ID_PREFIXES.worldTrends, 'name');
    if (idx !== -1) {
      trend.id = state.worldTrends[idx].id;
      if (state.worldTrends[idx].status === 'Đã Kết Thúc') trend.status = 'Đã Kết Thúc';
      state.worldTrends[idx] = { ...state.worldTrends[idx], ...trend };
    } else {
      assignEntityId(state.worldTrends, trend, ENTITY_ID_PREFIXES.worldTrends);
      state.worldTrends.unshift(trend);
      if (state.worldTrends.length > capSetting('localCapWorldTrends', 4)) state.worldTrends.length = capSetting('localCapWorldTrends', 4);
    }
    saveState(state);
  }

  function addWind(state, wind) {
    if (!state.winds) state.winds = [];
    ensureEntityIds(state.winds, ENTITY_ID_PREFIXES.winds);
    delete wind.quietRounds;
    wind.topic = wind.topic || wind.content || `Tin Đồn${Date.now()}`;
    if (!['announcement', 'report', 'rumor', 'sentiment'].includes(wind.type)) wind.type = 'rumor';
    wind.level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
    wind.scope = wind.scope || 'Nơi Bắt Nguồn';
    wind.source = wind.source || 'Không Rõ Nguồn Gốc';
    wind.quietRounds = 0;
    const idx = findEntityIndex(state.winds, wind, ENTITY_ID_PREFIXES.winds, 'topic');
    if (idx !== -1) {
      wind.id = state.winds[idx].id;
      state.winds[idx] = { ...state.winds[idx], ...wind };
    } else {
      assignEntityId(state.winds, wind, ENTITY_ID_PREFIXES.winds);
      state.winds.unshift(wind);
    }
    if (state.winds.length > capSetting('localCapWinds', 12)) state.winds.length = capSetting('localCapWinds', 12);
    saveState(state);
  }

  function addEnemy(state, enemy) {
    if (!state.enemies) state.enemies = [];
    ensureEntityIds(state.enemies, ENTITY_ID_PREFIXES.enemies);
    const idx = findEntityIndex(state.enemies, enemy, ENTITY_ID_PREFIXES.enemies, 'name');
    if (idx !== -1) {
      enemy.id = state.enemies[idx].id;
      state.enemies[idx] = { ...state.enemies[idx], ...enemy };
    } else {
      assignEntityId(state.enemies, enemy, ENTITY_ID_PREFIXES.enemies);
      state.enemies.unshift(enemy);
    }
    if (state.enemies.length > capSetting('localCapEnemies', 8)) state.enemies.length = capSetting('localCapEnemies', 8);
    return enemy.id;
  }

  // ========== Dọn Dẹp Khi Xuất/Nhập ==========

  /** Dữ liệu xuất ra sau khi dọn dẹp (bỏ các trường debug/nội bộ) */
  function getCleanExport(state) {
    const s = JSON.parse(JSON.stringify(state));

    // Bỏ các trường debug/nội bộ
    delete s.lastEvolveResult;
    delete s.lastInjection;
    delete s.lastUpdated;
    delete s._terminalEventsThisRound;

    // Sửa lỗi sự kiện stageRound>=9
    if (s.events) {
      for (const ev of s.events) {
        ensureEventFields(ev);
      }
    }

    return ensureArrays(s);
  }

  /** Gộp vào trạng thái hiện tại khi nhập dữ liệu */
  function importState(importedState) {
    const clean = JSON.parse(JSON.stringify(importedState));
    // Bỏ các trường nội bộ trong dữ liệu nhập vào
    delete clean.lastEvolveResult;
    delete clean.lastInjection;
    delete clean.lastUpdated;
    delete clean._terminalEventsThisRound;
    // Sửa lỗi sự kiện
    if (clean.events) {
      for (const ev of clean.events) ensureEventFields(ev);
    }
    // Đảm bảo các trường cần thiết
    clean.memories = clean.memories || [];
    clean.lastEvolveResult = null;
    clean.lastInjection = null;
    clean.chatLayer = getChatLayer();
    const chatId = getChatId();
    clean.lastUpdated = { chatId, timestamp: Date.now() };
    ensureArrays(clean);
    saveState(clean);
    return clean;
  }

  return {
    getDefaultState, getChatId, loadState, hasState, saveState, clearState, saveStateWithLayer,
    addMemory, addEvent, addFaction, addWorldTrend, addWind, addEnemy,
    ENTITY_ID_PREFIXES, entityIdNumber, nextEntityId, ensureEntityIds, findEntityIndex, assignEntityId,
    inheritLegacyIds,
    ensureEventFields, getUserName, renderUserName,
    saveCheckpoint, restoreCheckpoint, clearCheckpoint, getAnchorLayer, setAnchorLayer,
    getChatLayer, getChatFingerprint, saveFingerprint, loadFingerprint, isNewRound,
    getCleanExport, importState,
    cnToNum, parseStoryDay, getLastStoryDay, setLastStoryDay, filterDialogue,
    validateFilterRegex
  };
})();
