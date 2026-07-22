// Chuỗi vận hành của Memory Engine: tái sử dụng API, bộ lọc, world book, lưu trữ và cơ chế chèn (injection) của World Engine.
window.MEMORY_ENGINE = (function() {
  const INJECTION_NAME = 'memory-engine-memory';
  const SENTINEL = '【Thông Tin Ký Ức】';
  const DEFAULT_INJECTION_DICE_SIDES = 10000;
  const ENTITY_TYPES = ['organization', 'object', 'ability', 'location'];
  const ENTITY_LABELS = { organization: 'Tổ Chức', object: 'Vật Phẩm', ability: 'Năng Lực', location: 'Địa Điểm' };
  let initialized = false, running = false, backfillRunning = false, reconciling = false;
  let runningLabel = '';
  let abortController = null, autoTimer = null, lastEventKey = '';
  let hiddenSyncPromise = Promise.resolve();
  let lastDebug = { prompt: '', rawResult: '', parsed: null, error: '' };
  let backfillStatus = { running: false, current: 0, total: 0, message: '' };
  let summaryBackfillStatus = { running: false, current: 0, total: 0, message: '' };

  const clone = v => v == null ? v : JSON.parse(JSON.stringify(v));
  const clean = v => String(v == null ? '' : v).trim();
  const unique = list => Array.from(new Set((list || []).map(clean).filter(Boolean)));
  const normalized = v => clean(v).toLocaleLowerCase();
  const settings = () => window.MEMORY_ENGINE_SETTINGS?.getSettings(true) || {};
  const data = () => window.MEMORY_ENGINE_DATA;
  const timelineApi = () => window.MEMORY_ENGINE_TIMELINE;
  function setExternalStatus(text, isError) {
    window.__WE_SetExternalStatus?.(text, !!isError);
  }
  function refreshMemoryPanel() {
    window.WORLD_ENGINE_UI?.refresh?.(true);
  }
  function context() { try { return SillyTavern.getContext(); } catch (_) { return null; } }
  const chat = () => context()?.chat || [];
  const currentLayer = () => Math.max(0, chat().length - 1);
  const ignoreFirstLayer = st => st?.firstLayerIsAiOpening !== false;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

  function configuredNameBlacklist(st) {
    return new Set(clean(st?.nameBlacklist).split(/\r?\n/).map(normalized).filter(Boolean));
  }

  function nameIsBlacklisted(value, blacklist) {
    const names = Array.isArray(value) ? value : [value];
    return names.some(name => blacklist.has(normalized(name)));
  }

  function rollbackLinkedLayer(layer) {
    const state = data()?.loadState?.();
    if (!state) return false;
    const removed = removeLinkedLayerFromState(state, layer);
    if (!removed.removed) return false;
    data().saveState(replayTimeline(state));
    applyInjection();
    return true;
  }

  // Mỗi bản ghi ứng viên được tung một lần xúc xắc rời rạc, sau đó tính độ ưu tiên theo trọng số suy giảm dạng hàm mũ.
  // Bản ghi mới nhất có trọng số cao nhất; bản ghi cũ nhất có trọng số tối thiểu bằng 1 / số mặt xúc xắc, nên luôn còn cơ hội khác không.
  function exponentialMemorySample(items, limit, randomFn = Math.random, diceSides = DEFAULT_INJECTION_DICE_SIDES) {
    const source = Array.isArray(items) ? items : [];
    const take = Math.max(0, Math.min(source.length, parseInt(limit) || 0));
    if (!take || !source.length) return [];
    if (source.length <= take) return source.slice();
    const sides = Math.max(1000, Math.min(10000, parseInt(diceSides) || DEFAULT_INJECTION_DICE_SIDES));
    const scale = Math.max(1, take);
    return source.map((item, index) => {
      const age = source.length - 1 - index;
      const weight = Math.max(1 / sides, Math.exp(-age / scale));
      const roll = Math.max(1, Math.min(sides, Math.floor(Number(randomFn()) * sides) + 1));
      const unit = roll / (sides + 1);
      return { item, index, priority: -Math.log(unit) / weight };
    }).sort((a, b) => a.priority - b.priority)
      .slice(0, take)
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.item);
  }

  function formatMessages(messages, startLayer) {
    const ctx = context();
    return (messages || []).map((message, i) => {
      const fallback = message?.is_user ? (ctx?.name1 || 'Người dùng') : (ctx?.name2 || 'Nhân vật');
      return `[Tầng ${Number(startLayer || 0) + i}]【${clean(message?.name) || fallback}】\n${clean(message?.mes)}`;
    }).filter(Boolean).join('\n\n');
  }

  function recentConversation(rounds) {
    return recentConversationBatch(rounds).conversation;
  }

  function recentConversationBatch(rounds) {
    const all = chat(), count = Math.max(1, parseInt(rounds) || 1) * 2;
    const start = Math.max(ignoreFirstLayer(settings()) ? 1 : 0, all.length - count);
    const end = Math.max(start, all.length - 1);
    return {
      startLayer: start,
      endLayer: end,
      conversation: formatMessages(all.slice(start), start),
      sourceRefs: timelineApi()?.captureRange?.(start, end) || []
    };
  }

  function extractStoryTime(text) {
    const found = Array.from(String(text || '').matchAll(/『([^』]*(?:年|月|日|时|刻)[^』]*)』/g));
    return found.length ? clean(found.at(-1)[1].split('丨').slice(0, 3).join(' ')) : '';
  }

  function filterConversation(conversation, st) {
    return window.WORLD_ENGINE_CORE?.filterDialogue?.(
      conversation, { evolveFilterRegex: st.filterRegex || '' }
    ) || conversation;
  }

  function previousRawReference(task, roundCount, st) {
    const count = Math.max(0, parseInt(roundCount) || 0);
    const all = chat();
    const boundary = Number.isFinite(Number(task?.startLayer)) ? Number(task.startLayer) : all.length;
    if (!count || boundary <= 0) return { conversation: '', startLayer: boundary, endLayer: boundary - 1 };
    const aiLayers = all.map((message, index) => (
      index < boundary && !(ignoreFirstLayer(st || settings()) && index === 0) && message && !message.is_user ? index : -1
    )).filter(index => index >= 0).slice(-count);
    if (!aiLayers.length) return { conversation: '', startLayer: boundary, endLayer: boundary - 1 };
    const firstAi = aiLayers[0];
    let start = firstAi;
    for (let index = firstAi - 1; index >= 0; index--) {
      if (all[index] && !all[index].is_user) break;
      start = index;
    }
    const end = aiLayers.at(-1);
    return {
      conversation: formatMessages(all.slice(start, end + 1), start),
      startLayer: start,
      endLayer: end
    };
  }

  function buildTaskReferenceContext(state, task, st) {
    const eventMemory = ensureEventState(state);
    const rawCount = st?.referenceRawRounds === undefined ? 1 : Math.max(0, parseInt(st.referenceRawRounds) || 0);
    const raw = previousRawReference(task, rawCount, st);
    const rawBoundary = raw.conversation
      ? raw.startLayer
      : (Number.isFinite(Number(task?.startLayer)) ? Number(task.startLayer) : Infinity);
    const currentChatId = clean(data()?.getChatId?.());
    const valid = item => item?.status !== 'stale' && item?.status !== 'failed' && clean(item?.content);
    const beforeLayer = (item, layer) => {
      const originChatId = clean(item?.originChatId);
      if (originChatId && currentChatId && originChatId !== currentChatId) return true;
      return Number(item?.endLayer) < layer;
    };
    const smallCount = st?.referenceSmallSummaryCount === undefined
      ? 5 : Math.max(0, parseInt(st.referenceSmallSummaryCount) || 0);
    const bigCount = st?.referenceBigSummaryCount === undefined
      ? 1 : Math.max(0, parseInt(st.referenceBigSummaryCount) || 0);
    const eligibleSmall = eventMemory.small_summaries
      .filter(item => valid(item) && beforeLayer(item, rawBoundary));
    const historySmallSummaries = smallCount ? eligibleSmall.slice(-smallCount) : [];
    const currentChatSmall = historySmallSummaries.find(item => {
      const originChatId = clean(item?.originChatId);
      return !originChatId || !currentChatId || originChatId === currentChatId;
    });
    const bigBoundary = currentChatSmall ? Number(currentChatSmall.startLayer) : rawBoundary;
    const eligibleBig = eventMemory.big_summaries
      .filter(item => valid(item) && beforeLayer(item, bigBoundary));
    const historyBigSummaries = bigCount ? eligibleBig.slice(-bigCount) : [];
    const parts = [];
    if (historyBigSummaries.length) parts.push(`【Tổng Thuật Trước Đó】\n${historyBigSummaries.map((item, index) =>
      `${index + 1}. [Tầng ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
    ).join('\n')}`);
    if (historySmallSummaries.length) parts.push(`【Tóm Tắt Trước Đó】\n${historySmallSummaries.map((item, index) =>
      `${index + 1}. [Tầng ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
    ).join('\n')}`);
    if (raw.conversation) parts.push(`【Nội Dung Gần Đây】\n${filterConversation(raw.conversation, st)}`);
    return { historyBigSummaries, historySmallSummaries, raw, text: parts.join('\n\n') };
  }

  function buildSmallHistoryContext(state, task) {
    const st = settings();
    const context = buildTaskReferenceContext(state, task, st);
    return {
      historyBigSummaries: context.historyBigSummaries,
      historySmallSummaries: context.historySmallSummaries
    };
  }

  async function buildRequestPrompt(tasks, state, st) {
    const segments = [];
    const memoryReference = tasks.memory ? buildTaskReferenceContext(state, tasks.memory, st) : null;
    const sharesReference = Boolean(tasks.memory && tasks.small
      && Number(tasks.memory.startLayer) === Number(tasks.small.startLayer)
      && Number(tasks.memory.endLayer) === Number(tasks.small.endLayer));
    const smallReference = tasks.small && !sharesReference
      ? buildTaskReferenceContext(state, tasks.small, st) : null;
    if (tasks.memory) {
      const filtered = filterConversation(tasks.memory.conversation, st);
      let worldbook = '';
      if (st.worldbookEnabled && window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection) {
        worldbook = await window.WORLD_ENGINE_WORLDBOOK.buildPromptSection(filtered, 'memory');
      }
      const user = window.MEMORY_ENGINE_PROMPT.buildUserPrompt({
        currentStoryTime: extractStoryTime(filtered),
        knownPeople: (state.personal_memory || []).map(character => unique(character.names)),
        knownEntities: ENTITY_TYPES.flatMap(type => (state.entity_memory?.[type] || []).map(entity => ({
          type: ENTITY_LABELS[type], name: entity.name, aliases: unique(entity.aliases), description: entity.description
        }))),
        worldbook,
        referenceContext: memoryReference?.text || '',
        conversation: filtered
      });
      segments.push(`【Hướng Dẫn Tác Vụ】\n${window.MEMORY_ENGINE_PROMPT.TASK_PROMPT || window.MEMORY_ENGINE_PROMPT.SYSTEM_PROMPT}\n\n${user}`);
    }
    if (tasks.small) {
      segments.push(`【Hướng Dẫn Tác Vụ】\n${window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.SYSTEM_PROMPT}\n\n${window.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.buildUserPrompt({
        ...tasks.small,
        reuseConversation: sharesReference,
        referenceContext: sharesReference && memoryReference?.text
          ? 'Tiếp tục dùng phần 【Tham Khảo Hỗ Trợ Chỉ Đọc】 trong tác vụ nhân vật/thực thể ở phần trên của cùng yêu cầu này; không được viết nội dung cũ trong đó thành sự kiện mới của đoạn này.'
          : (smallReference?.text || ''),
        conversation: filterConversation(tasks.small.conversation, st)
      })}`);
    }
    if (tasks.big) {
      segments.push(`【Hướng Dẫn Tác Vụ】\n${window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT.SYSTEM_PROMPT}\n\n${window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT.buildUserPrompt({
        ...tasks.big
      })}`);
    }
    const fields = [];
    if (tasks.memory) fields.push(`"personal_memory": [
    {
      "name": ["Tên hoặc biệt danh nhân vật"],
      "known_by": ["Tên nhân vật khác biết chuyện"],
      "memory": "Một ký ức chủ quan độc lập của nhân vật",
      "time": "Thời gian tuyệt đối trong câu chuyện tương ứng với ký ức này, hoặc chuỗi rỗng"
    }
  ]`, `"entity_updates": [
    {
      "type": "Một trong bốn loại: organization, object, ability, location",
      "name": "Tên thực thể",
      "aliases": ["Biệt danh của thực thể"],
      "description": "Mô tả hiện tại hoặc chuỗi rỗng",
      "event": "Một sự kiện quan trọng độc lập mới phát sinh trong lượt này, hoặc chuỗi rỗng",
      "time": "Thời gian tuyệt đối trong câu chuyện tương ứng với sự kiện này, hoặc chuỗi rỗng"
    }
  ]`);
    if (tasks.small) fields.push('"small_summary": ""');
    if (tasks.big) fields.push('"big_summary": ""');
    const tone = clean(st.tonePrompt);
    const emptyMemory = tasks.memory
      ? '\n\nKhi không có nội dung tương ứng, dùng lần lượt "personal_memory": [] và "entity_updates": []; không được bỏ trường.'
      : '';
    return `${segments.join('\n\n=====\n\n')}\n\n【Yêu Cầu Xuất Kết Quả Thống Nhất】\nChỉ xuất ra một đối tượng JSON hợp lệ duy nhất, không xuất Markdown, rào code hay lời giải thích. Trả về nghiêm ngặt theo cấu trúc đầy đủ sau; thay thế phần chữ mẫu bằng nội dung thực tế:\n{\n  ${fields.join(',\n  ')}\n}${emptyMemory}${tone ? `\n\n【Yêu Cầu Bổ Sung】\n${tone}` : ''}`;
  }

  function parseResponse(raw, tasks) {
    const text = clean(raw).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    let value;
    try { value = JSON.parse(text); }
    catch (_) {
      const objectStart = text.indexOf('{'), objectEnd = text.lastIndexOf('}');
      const arrayStart = text.indexOf('['), arrayEnd = text.lastIndexOf(']');
      if (arrayStart >= 0 && arrayStart < objectStart && arrayEnd > arrayStart) value = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      else if (objectStart >= 0 && objectEnd > objectStart) value = JSON.parse(text.slice(objectStart, objectEnd + 1));
      else if (arrayStart >= 0 && arrayEnd > arrayStart) value = JSON.parse(text.slice(arrayStart, arrayEnd + 1));
      else throw new Error('Phản hồi API không chứa đối tượng hoặc mảng JSON hợp lệ');
    }
    const nameBlacklist = configuredNameBlacklist(settings());
    // Tương thích 0.1.x: API cũ chỉ trả về mảng ký ức nhân vật.
    const personalValue = tasks.memory ? (Array.isArray(value)
      ? value
      : (value?.personal_memory || value?.memories || value?.memory || value?.data || [])) : [];
    const personalSource = Array.isArray(personalValue)
      ? personalValue
      : (personalValue && typeof personalValue === 'object' ? [personalValue] : []);
    const counts = new Map(), personal = [];
    for (const item of personalSource) {
      if (!item || typeof item !== 'object') continue;
      if (nameIsBlacklisted(item.name, nameBlacklist)) continue;
      const names = unique(Array.isArray(item.name) ? item.name : [item.name]), memory = clean(item.memory);
      if (!names.length || !memory) continue;
      const holder = normalized(names[0]), count = counts.get(holder) || 0;
      if (count >= 3) continue;
      counts.set(holder, count + 1);
      let time = clean(item.time);
      if (/^(tối qua|hôm qua|ba ngày trước|vừa nãy|không lâu trước đây|sau bữa tiệc)$/i.test(time)) time = '';
      personal.push({
        name: names,
        known_by: unique(Array.isArray(item.known_by) ? item.known_by : [item.known_by])
          .filter(name => !names.some(holderName => normalized(holderName) === normalized(name))),
        memory,
        time
      });
      if (personal.length >= 8) break;
    }
    const entityValue = tasks.memory && !Array.isArray(value) ? value?.entity_updates : [];
    const entitySource = Array.isArray(entityValue)
      ? entityValue
      : (entityValue && typeof entityValue === 'object' ? [entityValue] : []);
    const entities = {};
    for (const type of ENTITY_TYPES) entities[type] = [];
    const perEntityCounts = new Map();
    let entityUpdateCount = 0;
    for (const item of entitySource) {
      if (entityUpdateCount >= 8) break;
      if (!item || typeof item !== 'object') continue;
      const aliases = unique(Array.isArray(item.aliases) ? item.aliases : [item.aliases]);
      if (nameIsBlacklisted([item.name, ...aliases], nameBlacklist)) continue;
      if (!ENTITY_TYPES.includes(item.type)) continue;
      const type = item.type, name = clean(item.name), description = clean(item.description), event = clean(item.event);
      if (!name) continue;
      const cleanAliases = aliases.filter(alias => normalized(alias) !== normalized(name));
      const key = `${type}:${normalized(name)}`, count = perEntityCounts.get(key) || 0;
      if (count >= 3) continue;
      perEntityCounts.set(key, count + 1);
      entities[type].push({ name, aliases: cleanAliases, description, event, time: event ? sanitizeTime(item.time) : '' });
      entityUpdateCount++;
    }
    let smallSummary = '';
    if (tasks.small) {
      smallSummary = Array.isArray(value) ? '' : clean(value?.small_summary);
    }
    let bigSummary = '';
    if (tasks.big) {
      bigSummary = Array.isArray(value) ? '' : clean(value?.big_summary);
    }
    return { personal, entities, smallSummary, bigSummary };
  }

  function sanitizeTime(value) {
    const time = clean(value);
    return /^(tối qua|hôm qua|ba ngày trước|vừa nãy|không lâu trước đây|sau bữa tiệc)$/i.test(time) ? '' : time;
  }

  function nextCharacterId(state) {
    const max = (state.personal_memory || []).reduce((n, character) => {
      const match = /^char_(\d+)$/.exec(clean(character.id));
      return Math.max(n, match ? Number(match[1]) : 0);
    }, 0);
    return `char_${String(max + 1).padStart(6, '0')}`;
  }

  function findCharacter(state, names) {
    const wanted = new Set(unique(names).map(normalized));
    return (state.personal_memory || []).find(character =>
      (character.names || []).some(name => wanted.has(normalized(name))));
  }

  function addKnowledge(index, names, record) {
    for (const name of unique(names)) {
      const key = normalized(name);
      if (!Array.isArray(index[key])) index[key] = [];
      if (!index[key].some(item => item.ownerId === record.ownerId && item.time === record.time && item.memory === record.memory)) {
        index[key].push(clone(record));
      }
    }
  }

  function rebuildKnowledgeIndex(state) {
    const index = {};
    for (const character of state.personal_memory || []) {
      for (const [time, memories] of Object.entries(character.memory || {})) {
        for (const memory of Array.isArray(memories) ? memories : []) {
          addKnowledge(index, character.names, { ownerId: character.id, time, memory });
        }
      }
    }
    state.knowledge_index = index;
  }

  function ensureEntityState(state) {
    if (!state.entity_memory || typeof state.entity_memory !== 'object' || Array.isArray(state.entity_memory)) state.entity_memory = {};
    for (const type of ENTITY_TYPES) {
      if (!Array.isArray(state.entity_memory[type])) state.entity_memory[type] = [];
      for (const entity of state.entity_memory[type]) {
        const name = clean(entity?.name);
        entity.aliases = unique(Array.isArray(entity?.aliases) ? entity.aliases : [entity?.aliases])
          .filter(alias => normalized(alias) !== normalized(name));
      }
    }
    if (!state.entity_index || typeof state.entity_index !== 'object' || Array.isArray(state.entity_index)) state.entity_index = {};
  }

  function nextEntityId(state, type) {
    ensureEntityState(state);
    const prefix = { organization: 'org', object: 'obj', ability: 'ability', location: 'location' }[type];
    const pattern = new RegExp(`^${prefix}_(\\d+)$`);
    const max = state.entity_memory[type].reduce((number, entity) => {
      const match = pattern.exec(clean(entity.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `${prefix}_${String(max + 1).padStart(6, '0')}`;
  }

  function rebuildEntityIndex(state) {
    ensureEntityState(state);
    const index = {};
    for (const type of ENTITY_TYPES) {
      for (const entity of state.entity_memory[type]) {
        if (!clean(entity.id)) entity.id = nextEntityId(state, type);
        const names = unique([entity.name, ...(entity.aliases || [])]);
        for (const name of names) index[`${type}:${normalized(name)}`] = entity.id;
      }
    }
    state.entity_index = index;
  }

  function repairStateIndexes(state, previousState) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) return state;
    const oldState = previousState && typeof previousState === 'object' ? previousState : state;
    const oldIndex = clone(oldState.knowledge_index || {});
    const aliasTargets = {};
    const removedAliases = new Set();
    for (const oldPerson of oldState.personal_memory || []) {
      const current = (state.personal_memory || []).find(person => person.id === oldPerson.id);
      if (!current) {
        for (const oldName of oldPerson.names || []) removedAliases.add(normalized(oldName));
        continue;
      }
      for (const oldName of oldPerson.names || []) aliasTargets[normalized(oldName)] = unique(current.names || []);
    }
    rebuildKnowledgeIndex(state);
    const validRecords = new Set();
    for (const person of state.personal_memory || []) {
      for (const [time, memories] of Object.entries(person.memory || {})) {
        for (const memory of Array.isArray(memories) ? memories : []) validRecords.add(`${person.id}\u0000${time}\u0000${memory}`);
      }
    }
    for (const [oldName, records] of Object.entries(oldIndex)) {
      if (removedAliases.has(normalized(oldName))) continue;
      const targets = aliasTargets[normalized(oldName)] || [oldName];
      for (const record of Array.isArray(records) ? records : []) {
        if (!validRecords.has(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`)) continue;
        addKnowledge(state.knowledge_index, targets, record);
      }
    }
    rebuildEntityIndex(state);
    return state;
  }

  function findEntity(state, type, name, aliases) {
    ensureEntityState(state);
    const names = unique([name, ...(aliases || [])]);
    let id = names.map(item => state.entity_index[`${type}:${normalized(item)}`]).find(Boolean);
    let entity = id && state.entity_memory[type].find(item => item.id === id);
    if (!entity) entity = state.entity_memory[type].find(item => {
      const existing = unique([item.name, ...(item.aliases || [])]).map(normalized);
      return names.some(candidate => existing.includes(normalized(candidate)));
    });
    if (entity) {
      if (!clean(entity.id)) entity.id = nextEntityId(state, type);
      for (const candidate of names) state.entity_index[`${type}:${normalized(candidate)}`] = entity.id;
    }
    return entity;
  }

  function mergeEntityMemories(state, groups) {
    ensureEntityState(state);
    if (!Object.keys(state.entity_index).length) rebuildEntityIndex(state);
    const result = { entities: 0, history: 0, descriptions: 0 };
    for (const type of ENTITY_TYPES) {
      for (const item of groups?.[type] || []) {
        let entity = findEntity(state, type, item.name, item.aliases);
        let isNew = false;
        if (!entity) {
          entity = { id: nextEntityId(state, type), name: item.name, aliases: unique(item.aliases), description: '', history: [] };
          state.entity_memory[type].push(entity);
          state.entity_index[`${type}:${normalized(item.name)}`] = entity.id;
          result.entities++;
          isNew = true;
        }
        entity.aliases = unique([...(entity.aliases || []), ...(item.aliases || []),
          normalized(entity.name) === normalized(item.name) ? '' : item.name])
          .filter(alias => normalized(alias) !== normalized(entity.name));
        for (const candidate of [entity.name, ...entity.aliases]) {
          state.entity_index[`${type}:${normalized(candidate)}`] = entity.id;
        }
        if (item.description && entity.description !== item.description) {
          entity.description = item.description;
          if (!isNew) result.descriptions++;
        }
        if (!Array.isArray(entity.history)) entity.history = [];
        if (item.event && !entity.history.some(old => clean(old.time) === clean(item.time) && clean(old.event) === clean(item.event))) {
          entity.history.push({ time: clean(item.time), event: clean(item.event) });
          result.history++;
        }
      }
    }
    return result;
  }

  function mergeMemories(state, items) {
    if (!state.knowledge_index || typeof state.knowledge_index !== 'object') rebuildKnowledgeIndex(state);
    let added = 0;
    for (const item of items) {
      let character = findCharacter(state, item.name);
      if (!character) {
        character = { id: nextCharacterId(state), names: [], memory: {} };
        state.personal_memory.push(character);
      }
      character.names = unique([...(character.names || []), ...item.name]);
      if (!character.memory || typeof character.memory !== 'object' || Array.isArray(character.memory)) character.memory = {};
      const time = item.time || '';
      if (!Array.isArray(character.memory[time])) character.memory[time] = [];
      const exists = Object.values(character.memory).some(list => Array.isArray(list) && list.includes(item.memory));
      if (!exists) { character.memory[time].push(item.memory); added++; }
      const record = { ownerId: character.id, time, memory: item.memory };
      addKnowledge(state.knowledge_index, character.names, record); // Người giữ ký ức được tự động bổ sung
      for (const knowerName of item.known_by) {
        let knower = findCharacter(state, [knowerName]);
        if (!knower) {
          knower = { id: nextCharacterId(state), names: [knowerName], memory: {} };
          state.personal_memory.push(knower);
        }
        addKnowledge(state.knowledge_index, knower.names, record);
      }
    }
    return added;
  }

  function replaceKnownByRecords(state, ownerId, records) {
    if (!state || typeof state !== 'object') return state;
    if (!state.knowledge_index || typeof state.knowledge_index !== 'object' || Array.isArray(state.knowledge_index)) state.knowledge_index = {};
    const owner = (state.personal_memory || []).find(character => character.id === ownerId);
    if (!owner) return state;
    for (const [name, indexed] of Object.entries(state.knowledge_index)) {
      state.knowledge_index[name] = (Array.isArray(indexed) ? indexed : []).filter(record => record.ownerId !== ownerId);
      if (!state.knowledge_index[name].length) delete state.knowledge_index[name];
    }
    for (const item of records || []) {
      const time = clean(item?.time), memory = clean(item?.memory ?? item?.content);
      if (!memory) continue;
      const record = { ownerId, time, memory };
      addKnowledge(state.knowledge_index, owner.names, record);
      for (const knowerName of unique(item?.known_by).filter(name => !(owner.names || []).some(alias => normalized(alias) === normalized(name)))) {
        let knower = findCharacter(state, [knowerName]);
        if (!knower) {
          knower = { id: nextCharacterId(state), names: [knowerName], memory: {} };
          state.personal_memory.push(knower);
        }
        addKnowledge(state.knowledge_index, knower.names, record);
      }
    }
    return state;
  }

  function ensureEventState(state) {
    if (!state.event_memory || typeof state.event_memory !== 'object' || Array.isArray(state.event_memory)) state.event_memory = {};
    if (!Array.isArray(state.event_memory.small_summaries)) state.event_memory.small_summaries = [];
    if (!Array.isArray(state.event_memory.big_summaries)) {
      state.event_memory.big_summaries = state.event_memory.big_summary?.content ? [state.event_memory.big_summary] : [];
    }
    delete state.event_memory.big_summary;
    if (!Number.isFinite(Number(state.event_memory.big_summary_cursor))) state.event_memory.big_summary_cursor = 0;
    state.event_memory.big_summary_cursor = Math.max(0, Math.min(
      state.event_memory.small_summaries.length, Number(state.event_memory.big_summary_cursor) || 0
    ));
    return state.event_memory;
  }

  function ensureTimelineState(state) {
    if (!state.timeline || typeof state.timeline !== 'object' || Array.isArray(state.timeline)) {
      // MEMORY_ENGINE_DATA.normalizeState normally creates this; the fallback protects tests and partial imports.
      const originChatId = data()?.getChatId?.() || 'default';
      state.timeline = {
        version: 1,
        originChatId,
        root: {
          id: `root:${originChatId}`,
          originChatId,
          createdAt: Date.now(),
          base: {
            personal_memory: clone(state.personal_memory || []),
            knowledge_index: clone(state.knowledge_index || {}),
            entity_memory: clone(state.entity_memory || {}),
            entity_index: clone(state.entity_index || {}),
            round: Math.max(0, Number(state.round) || 0),
            chatLayer: state.chatLayer ?? null
          }
        },
        nodes: []
      };
    }
    if (!Array.isArray(state.timeline.nodes)) state.timeline.nodes = [];
    return state.timeline;
  }

  function nextTimelineNodeId(timeline) {
    const max = (timeline.nodes || []).reduce((number, node) => {
      const match = /^memory_(\d+)$/.exec(clean(node?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `memory_${String(max + 1).padStart(6, '0')}`;
  }

  function sourceBounds(refs, fallbackLayer) {
    const layers = (refs || []).map(ref => Number(ref?.layer)).filter(Number.isFinite);
    const fallback = Number.isFinite(Number(fallbackLayer)) ? Number(fallbackLayer) : currentLayer();
    return {
      startLayer: layers.length ? Math.min(...layers) : fallback,
      endLayer: layers.length ? Math.max(...layers) : fallback
    };
  }

  function appendTimelineNode(state, extracted, task, options) {
    const timeline = ensureTimelineState(state), api = timelineApi();
    let refs = Array.isArray(task?.sourceRefs) ? clone(task.sourceRefs) : [];
    if (!refs.length && Number.isFinite(Number(task?.startLayer)) && Number.isFinite(Number(task?.endLayer))) {
      refs = api?.captureRange?.(Number(task.startLayer), Number(task.endLayer)) || [];
    }
    // Đầu vào tổng hợp như liên kết World Engine không có nội dung chat thực; dùng danh tính nguồn tổng hợp duy nhất giữa các cuộc chat để ghi nhận.
    if (!refs.length) {
      const originChatId = data()?.getChatId?.() || 'default';
      const layer = Number.isFinite(Number(options?.layer)) ? Number(options.layer) : currentLayer();
      const sourceText = clean(task?.conversation);
      refs = [{
        chatId: originChatId,
        messageId: clean(task?.sourceKey) || `synthetic:${originChatId}:${layer}:${api?.hashText?.(sourceText) || sourceText.length}`,
        layer,
        role: 'synthetic',
        swipeId: 0,
        hash: api?.hashText?.(sourceText) || String(sourceText.length),
        synthetic: true
      }];
    }
    const digest = api?.digestRefs?.(refs) || '';
    const existing = timeline.nodes.find(node => node.sourceDigest && node.sourceDigest === digest && node.status !== 'stale');
    if (existing) return existing;
    const bounds = sourceBounds(refs, options?.layer);
    const node = {
      id: nextTimelineNodeId(timeline),
      kind: task?.kind || 'memory',
      source: task?.kind === 'world_link' ? 'world_engine' : undefined,
      sourceKey: task?.kind === 'world_link' ? clean(task?.sourceKey) : undefined,
      originChatId: data()?.getChatId?.() || 'default',
      startLayer: bounds.startLayer,
      endLayer: bounds.endLayer,
      sourceRefs: refs,
      sourceDigest: digest,
      personal: clone(extracted?.personal || []),
      entities: clone(extracted?.entities || {}),
      status: 'valid',
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    timeline.nodes.push(node);
    return node;
  }

  // Liên kết thế giới là một giao dịch độc lập có gắn nhãn nguồn. Roll lại chỉ hoàn tác node liên kết của tầng hiện tại,
  // tóm tắt tổng hợp thế giới cùng các tổng thuật đã tiêu thụ những tóm tắt đó; ký ức hội thoại thông thường và tóm tắt thông thường luôn được giữ lại.
  function removeLinkedLayerFromState(state, layer) {
    const numericLayer = Number(layer);
    if (!Number.isFinite(numericLayer)) return { removed: false, sourceKey: '', removedSmallIds: [] };
    const sourceKey = `${data()?.getChatId?.() || 'default'}:${numericLayer}`;
    const timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    const matchesNode = node => {
      if (node?.kind !== 'world_link') return false;
      if (clean(node?.sourceKey) === sourceKey) return true;
      if ((node?.sourceRefs || []).some(ref => clean(ref?.messageId) === sourceKey)) return true;
      return !clean(node?.sourceKey) && Number(node?.startLayer) === numericLayer
        && Number(node?.endLayer) === numericLayer;
    };
    const matchesSmall = item => item?.source === 'world_engine' && (
      clean(item?.sourceKey) === sourceKey
      || (!clean(item?.sourceKey) && Number(item?.startLayer) === numericLayer && Number(item?.endLayer) === numericLayer)
    );

    const removedNodes = timeline.nodes.filter(matchesNode);
    const removedSmall = eventMemory.small_summaries.filter(matchesSmall);
    if (!removedNodes.length && !removedSmall.length) {
      return { removed: false, sourceKey, removedSmallIds: [] };
    }

    const removedSmallIds = new Set(removedSmall.map(item => clean(item?.id)).filter(Boolean));
    const affectedBig = eventMemory.big_summaries.filter(item =>
      (item?.childIds || []).some(id => removedSmallIds.has(clean(id)))
    );
    const affectedChildIds = new Set([
      ...removedSmallIds,
      ...affectedBig.flatMap(item => item?.childIds || []).map(clean).filter(Boolean)
    ]);
    const firstAffectedIndex = eventMemory.small_summaries.findIndex(item => affectedChildIds.has(clean(item?.id)));

    timeline.nodes = timeline.nodes.filter(node => !matchesNode(node));
    eventMemory.small_summaries = eventMemory.small_summaries.filter(item => !matchesSmall(item));
    eventMemory.big_summaries = eventMemory.big_summaries.filter(item => !affectedBig.includes(item));
    if (firstAffectedIndex >= 0) {
      eventMemory.big_summary_cursor = Math.min(eventMemory.big_summary_cursor, firstAffectedIndex);
    }
    eventMemory.big_summary_cursor = Math.max(0, Math.min(
      eventMemory.small_summaries.length, Number(eventMemory.big_summary_cursor) || 0
    ));
    return {
      removed: true,
      sourceKey,
      removedNodeIds: removedNodes.map(node => node.id),
      removedSmallIds: [...removedSmallIds],
      removedBigIds: affectedBig.map(item => item.id)
    };
  }

  function replayTimeline(state, stopBeforeId) {
    const timeline = ensureTimelineState(state), root = clone(timeline.root?.base || {});
    const derived = {
      personal_memory: clone(root.personal_memory || []),
      knowledge_index: clone(root.knowledge_index || {}),
      entity_memory: clone(root.entity_memory || {}),
      entity_index: clone(root.entity_index || {}),
      round: Math.max(0, Number(root.round) || 0),
      chatLayer: root.chatLayer ?? null,
      event_memory: clone(state.event_memory || {}),
      timeline: clone(timeline)
    };
    ensureEntityState(derived);
    for (const node of timeline.nodes) {
      if (stopBeforeId && node.id === stopBeforeId) break;
      if (node.status !== 'valid') continue;
      if (node.kind === 'manual_snapshot' && node.snapshot) {
        derived.personal_memory = clone(node.snapshot.personal_memory || []);
        derived.knowledge_index = clone(node.snapshot.knowledge_index || {});
        derived.entity_memory = clone(node.snapshot.entity_memory || {});
        derived.entity_index = clone(node.snapshot.entity_index || {});
        derived.round = Math.max(derived.round, Number(node.snapshot.round) || 0);
        derived.chatLayer = node.snapshot.chatLayer ?? derived.chatLayer;
        ensureEntityState(derived);
        continue;
      }
      mergeMemories(derived, clone(node.personal || []));
      mergeEntityMemories(derived, clone(node.entities || {}));
      derived.round += 1;
      if (Number.isFinite(Number(node.endLayer))) derived.chatLayer = Number(node.endLayer);
    }
    repairStateIndexes(derived, derived);
    return derived;
  }

  function commitManualState(nextState, previousState) {
    if (!nextState || !previousState) return nextState;
    const memoryView = state => JSON.stringify({
      personal_memory: state.personal_memory || [],
      knowledge_index: state.knowledge_index || {},
      entity_memory: state.entity_memory || {},
      entity_index: state.entity_index || {}
    });
    if (memoryView(nextState) === memoryView(previousState)) return nextState;
    const timeline = ensureTimelineState(previousState), api = timelineApi();
    const layer = currentLayer(), originChatId = data()?.getChatId?.() || 'default';
    const snapshot = {
      personal_memory: clone(nextState.personal_memory || []),
      knowledge_index: clone(nextState.knowledge_index || {}),
      entity_memory: clone(nextState.entity_memory || {}),
      entity_index: clone(nextState.entity_index || {}),
      round: Math.max(0, Number(nextState.round) || 0),
      chatLayer: nextState.chatLayer ?? layer
    };
    const hash = api?.hashText?.(memoryView(nextState)) || String(Date.now());
    timeline.nodes.push({
      id: nextTimelineNodeId(timeline),
      kind: 'manual_snapshot',
      originChatId,
      startLayer: layer,
      endLayer: layer,
      sourceRefs: [{ chatId: originChatId, messageId: `manual:${Date.now()}`, layer, role: 'synthetic', swipeId: 0, hash, synthetic: true }],
      sourceDigest: hash,
      personal: [],
      entities: {},
      snapshot,
      status: 'valid',
      revision: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    nextState.timeline = clone(timeline);
    return nextState;
  }

  // Tóm tắt tự động chỉ xử lý các đoạn hội thoại mới thêm vào sau khi vào cuộc chat hiện tại. Lần đầu gặp một cuộc chat chỉ
  // thiết lập mốc tầng hiện tại, không gọi API; việc dọn lại toàn bộ lịch sử từ đầu chỉ được kích hoạt rõ ràng bởi thao tác hồi cứu hàng loạt.
  function initializeSummaryBaseline() {
    const memoryData = data();
    if (!memoryData) return null;
    const state = memoryData.loadState();
    const eventMemory = ensureEventState(state);
    if (eventMemory.small_summary_layer !== null
      && eventMemory.small_summary_layer !== ''
      && Number.isFinite(Number(eventMemory.small_summary_layer))) return state;
    eventMemory.small_summary_layer = chat().length - 1;
    return memoryData.saveState(state);
  }

  function nextSmallSummaryId(eventMemory) {
    const max = (eventMemory.small_summaries || []).reduce((number, item) => {
      const match = /^small_(\d+)$/.exec(clean(item?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `small_${String(max + 1).padStart(6, '0')}`;
  }

  function nextBigSummaryId(eventMemory) {
    const max = (eventMemory.big_summaries || []).reduce((number, item) => {
      const match = /^big_(\d+)$/.exec(clean(item?.id));
      return Math.max(number, match ? Number(match[1]) : 0);
    }, 0);
    return `big_${String(max + 1).padStart(6, '0')}`;
  }

  async function requestTasks(tasks, options) {
    const st = settings(), state = options?.baseState ? clone(options.baseState) : data().loadState();
    const prompt = await buildRequestPrompt(tasks, state, st);
    lastDebug = { prompt, requestPrompt: prompt, rawResult: '', apiResponse: '', parsed: null, error: '' };
    const retries = Math.max(0, Number(options?.retries ?? st.apiAutoRetries) || 0);
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = await window.WORLD_ENGINE_API.callApi(
          prompt, st.maxTokens, st.temperature, abortController?.signal, st
        );
        lastDebug.rawResult = lastDebug.apiResponse = raw;
        const parsed = parseResponse(raw, tasks);
        lastDebug.parsed = clone(parsed);
        return parsed;
      } catch (error) {
        lastDebug.error = String(error?.message || error);
        if (abortController?.signal?.aborted || attempt >= retries) throw error;
      }
    }
    throw new Error('Yêu cầu API ký ức thất bại');
  }

  async function runTasks(tasks, options) {
    if (running && !options?.allowWhileBackfill) return { skipped: true, reason: 'running' };
    if (!tasks?.memory && !tasks?.small && !tasks?.big) return { skipped: true, reason: 'no_tasks' };
    if (tasks.small && tasks.big) throw new Error('Tổng thuật phải được chạy độc lập sau khi tóm tắt đã lưu vào kho dữ liệu');
    running = true;
    runningLabel = tasks.memory && tasks.small ? 'Nhân vật, thực thể và tóm tắt'
      : (tasks.memory ? 'Trích xuất nhân vật và thực thể' : (tasks.small ? 'Tóm tắt' : 'Tổng thuật'));
    const taskLabel = runningLabel;
    abortController = new AbortController();
    setExternalStatus(`Đang thực hiện ${taskLabel}…`);
    // Máy trạng thái ở trên cùng sẽ dọn dẹp class đang chạy của quả cầu nổi trước, do đó phải làm mới trạng thái hoạt ảnh theo panel của engine hiện tại ở bước cuối cùng.
    window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true, runningLabel);
    try {
      const before = options?.baseState ? clone(options.baseState) : data().loadState();
      const extracted = await requestTasks(tasks, { ...options, baseState: before });
      if (options?.saveCheckpoint !== false) data().saveCheckpoint(before);
      const next = clone(before);
      const memorySourceDigest = tasks.memory && Array.isArray(tasks.memory.sourceRefs) && tasks.memory.sourceRefs.length
        ? timelineApi()?.digestRefs?.(tasks.memory.sourceRefs) || '' : '';
      const memoryAlreadyStored = memorySourceDigest && ensureTimelineState(next).nodes.some(node =>
        node.kind === 'memory' && node.status === 'valid' && clean(node.sourceDigest) === memorySourceDigest
      );
      const applyMemory = Boolean(tasks.memory && !memoryAlreadyStored);
      const addedPersonal = applyMemory ? mergeMemories(next, extracted.personal) : 0;
      const entityChanges = applyMemory
        ? mergeEntityMemories(next, extracted.entities)
        : { entities: 0, history: 0, descriptions: 0 };
      if (applyMemory) appendTimelineNode(next, extracted, tasks.memory, options);
      const eventMemory = ensureEventState(next);
      let addedSmall = 0, updatedBig = 0;
      if (tasks.small && extracted.smallSummary) {
        const sourceRefs = clone(tasks.small.sourceRefs || timelineApi()?.captureRange?.(tasks.small.startLayer, tasks.small.endLayer) || []);
        const sourceDigest = timelineApi()?.digestRefs?.(sourceRefs) || '';
        const existingSummary = sourceDigest ? eventMemory.small_summaries.find(item =>
          item.status !== 'stale' && clean(item.sourceDigest) === sourceDigest
        ) : null;
        if (!existingSummary) {
          eventMemory.small_summaries.push({
            id: nextSmallSummaryId(eventMemory),
            startLayer: Number(tasks.small.startLayer) || 0,
            endLayer: Number(tasks.small.endLayer) || 0,
            content: extracted.smallSummary,
            sourceRefs,
            sourceDigest,
            originChatId: data()?.getChatId?.() || 'default',
            status: 'valid',
            revision: 1
          });
          addedSmall = 1;
        }
        eventMemory.small_summary_layer = Number(tasks.small.endLayer) || 0;
      }
      if (options?.worldDigestMinute?.content) {
        const linked = options.worldDigestMinute;
        eventMemory.small_summaries.push({
          id: nextSmallSummaryId(eventMemory),
          startLayer: Number(linked.layer) || 0,
          endLayer: Number(linked.layer) || 0,
          content: Array.from(clean(linked.content)).slice(0, 200).join(''),
          source: 'world_engine',
          sourceKey: clean(linked.sourceKey),
          status: 'valid',
          revision: 1
        });
        addedSmall += 1;
      }
      if (tasks.big && extracted.bigSummary) {
        eventMemory.big_summaries.push({
          id: nextBigSummaryId(eventMemory),
          startLayer: Number(tasks.big.startLayer) || 0,
          endLayer: Number(tasks.big.endLayer) || 0,
          content: extracted.bigSummary,
          childIds: clone(tasks.big.childIds || []),
          childDigest: clean(tasks.big.childDigest),
          sourceRefs: clone(tasks.big.sourceRefs || []),
          originChatId: data()?.getChatId?.() || 'default',
          status: 'valid',
          revision: 1
        });
        eventMemory.big_summary_cursor = Math.min(
          eventMemory.small_summaries.length,
          eventMemory.big_summary_cursor + Math.max(1, Number(tasks.big.consumeCount) || 1)
        );
        updatedBig = 1;
      }
      const added = addedPersonal + entityChanges.entities + entityChanges.history + entityChanges.descriptions;
      if (tasks.memory) {
        if (applyMemory) next.round = Math.max(0, Number(next.round) || 0) + 1;
        next.chatLayer = Number.isFinite(Number(options?.layer)) ? Number(options.layer) : currentLayer();
      }
      data().saveState(next);
      window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.afterEvolution?.();
      applyInjection();
      refreshMemoryPanel();
      setExternalStatus(`${taskLabel} đã hoàn tất`);
      return {
        added: added + addedSmall + updatedBig,
        extracted: extracted.personal.length + ENTITY_TYPES.reduce((sum, type) => sum + extracted.entities[type].length, 0),
        addedPersonal,
        entityChanges,
        addedSmall,
        updatedBig,
        state: next
      };
    } catch (error) {
      const stopped = abortController?.signal?.aborted || error?.name === 'AbortError';
      setExternalStatus(stopped ? `${taskLabel} đã dừng` : `${taskLabel} thất bại: ${error?.message || error}`, !stopped);
      throw error;
    } finally {
      running = false;
      runningLabel = '';
      abortController = null;
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false, '');
    }
  }

  async function extractConversation(conversation, options) {
    return runTasks({ memory: {
      conversation,
      sourceRefs: clone(options?.sourceRefs || []),
      startLayer: options?.startLayer,
      endLayer: options?.endLayer,
      sourceKey: options?.sourceKey
    } }, options);
  }

  function countAiSince(layer, st) {
    const anchor = layer !== null && layer !== '' && Number.isFinite(Number(layer)) ? Number(layer) : -1;
    const all = chat(), skipOpening = anchor < 0 && ignoreFirstLayer(st || settings());
    return all.reduce((count, message, index) => count + (
      index > anchor && !(skipOpening && index === 0) && message && !message.is_user ? 1 : 0
    ), 0);
  }

  function getAiBatchAfter(layer, maxAi, endLayer, settingsOverride) {
    const all = chat();
    const anchor = layer !== null && layer !== '' && Number.isFinite(Number(layer)) ? Number(layer) : -1;
    const skipOpening = anchor < 0 && ignoreFirstLayer(settingsOverride || settings());
    const end = endLayer !== undefined && Number.isFinite(Number(endLayer)) ? Number(endLayer) : all.length - 1;
    const aiLayers = all.map((message, index) => (index > anchor && index <= end && !(skipOpening && index === 0) && message && !message.is_user ? index : -1))
      .filter(index => index >= 0).slice(0, Math.max(1, parseInt(maxAi) || 1));
    if (!aiLayers.length) return null;
    const firstAi = aiLayers[0], finish = aiLayers.at(-1);
    const start = firstAi > 0 && all[firstAi - 1]?.is_user ? firstAi - 1 : firstAi;
    return {
      startLayer: start,
      endLayer: finish,
      aiCount: aiLayers.length,
      conversation: formatMessages(all.slice(start, finish + 1), start),
      sourceRefs: timelineApi()?.captureRange?.(start, finish) || []
    };
  }

  function buildBigTask(state, force, thresholdOverride) {
    const st = settings(), eventMemory = ensureEventState(state);
    const allPending = eventMemory.small_summaries.slice(eventMemory.big_summary_cursor);
    const threshold = Math.max(1, parseInt(thresholdOverride ?? st.bigSummaryEveryX) || 5);
    if (!force && allPending.length < threshold) return null;
    if (force && !allPending.length) return null;
    const pending = force ? allPending : allPending.slice(0, threshold);
    const childIds = pending.map(item => item.id);
    const sourceRefs = timelineApi()?.unionRefs?.(pending.map(item => item.sourceRefs || [])) || [];
    return {
      summaries: pending,
      consumeCount: pending.length,
      startLayer: Number(pending[0]?.startLayer) || 0,
      endLayer: Number(pending.at(-1)?.endLayer) || 0,
      childIds,
      childDigest: timelineApi()?.hashText?.(pending.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '',
      sourceRefs
    };
  }

  async function runTasksThenDueBig(tasks, options, bigThresholdOverride) {
    const primary = await runTasks(tasks, options);
    if (primary?.skipped) return primary;
    const after = data().loadState();
    const bigTask = buildBigTask(after, false, bigThresholdOverride);
    if (!bigTask) return primary;
    const bigResult = await runTasks({ big: bigTask }, {
      ...options,
      baseState: after,
      saveCheckpoint: false,
      // Tóm tắt tổng hợp thế giới chỉ được lưu vào kho dữ liệu một lần ở primary; ở đây chỉ tiêu thụ các tóm tắt đang chờ để tạo tổng thuật.
      worldDigestMinute: null
    });
    return {
      ...primary,
      added: Number(primary.added || 0) + Number(bigResult?.updatedBig || 0),
      updatedBig: Number(bigResult?.updatedBig || 0),
      state: bigResult?.state || primary.state
    };
  }

  // Dùng chung cho trích xuất thủ công về sau và suy diễn lại: số lượt đọc = min(giới hạn cấu hình, số lượt AI thực tế tính từ trạng thái nền tảng đến nay).
  function getElapsedReadRounds(baseState, maxRounds) {
    const limit = Math.max(1, parseInt(maxRounds) || 1);
    const anchor = baseState?.chatLayer !== null && baseState?.chatLayer !== '' && Number.isFinite(Number(baseState?.chatLayer))
      ? Number(baseState.chatLayer) : -1;
    return Math.max(1, Math.min(countAiSince(anchor), limit));
  }

  async function autoExtract() {
    const st = settings();
    if (st.engineEnabled === false || running || backfillRunning || reconciling) return;
    // Việc sửa nội dung lịch sử phải chờ phản hồi AI của lượt này hoàn tất mới được gọi API; chế độ trích xuất thủ công cũng sửa lịch sử như bình thường.
    await reconcileHistory();
    if (st.evolveMode !== 'auto') return;
    const state = data().loadState();
    const anchor = state.chatLayer !== null && state.chatLayer !== '' && Number.isFinite(Number(state.chatLayer))
      ? Number(state.chatLayer) : -1;
    const tasks = {};
    if (countAiSince(anchor) >= Math.max(1, parseInt(st.evolveEveryX) || 1)) {
      tasks.memory = recentConversationBatch(st.evolveReadRounds);
    }
    const eventMemory = ensureEventState(state);
    const smallEvery = Math.max(1, parseInt(st.smallSummaryEveryX) || 5);
    const smallBatch = countAiSince(eventMemory.small_summary_layer) >= smallEvery
      ? getAiBatchAfter(eventMemory.small_summary_layer, smallEvery) : null;
    if (smallBatch) tasks.small = smallBatch;
    const bigTask = buildBigTask(state, false);
    if (!tasks.memory && !tasks.small) {
      if (!bigTask) return;
      const result = await runTasks({ big: bigTask }, { baseState: state });
      if (buildBigTask(data().loadState(), false)) {
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[Memory Engine] Tự động bổ sung tiến độ tổng thuật thất bại', error)), 0);
      }
      return result;
    }
    const result = await runTasksThenDueBig(tasks, { layer: currentLayer(), baseState: state });
    const after = data().loadState(), afterEvent = ensureEventState(after);
    if (countAiSince(afterEvent.small_summary_layer) >= smallEvery || buildBigTask(after, false)) {
      clearTimeout(autoTimer);
      autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[Memory Engine] Tự động bổ sung tiến độ tóm tắt thất bại', error)), 0);
    }
    return result;
  }

  async function manualExtract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    const state = data().loadState();
    const timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    const memoryLayer = state.chatLayer !== null && state.chatLayer !== '' && Number.isFinite(Number(state.chatLayer))
      ? Number(state.chatLayer) : null;
    const summaryLayer = eventMemory.small_summary_layer !== null && eventMemory.small_summary_layer !== ''
      && Number.isFinite(Number(eventMemory.small_summary_layer)) ? Number(eventMemory.small_summary_layer) : null;
    const hasTrackedSummaries = eventMemory.small_summaries.some(summary =>
      Array.isArray(summary.sourceRefs) && summary.sourceRefs.length
    );
    // Khi cuộc chat mới lần đầu thiết lập mốc tóm tắt, con trỏ nhân vật vẫn còn trống; lúc này dùng theo mốc tóm tắt để tránh nhầm cả đoạn chat cũ thành chưa xử lý.
    // Nếu đã có tóm tắt kèm nguồn nội dung, tìm từ đầu lượt sớm nhất còn thiếu nhân vật/thực thể để bổ sung đầy đủ cả hai chuỗi.
    let anchor = memoryLayer === null ? (hasTrackedSummaries ? -1 : (summaryLayer ?? -1))
      : (summaryLayer === null ? memoryLayer : Math.min(memoryLayer, summaryLayer));
    let batch = null;
    while (true) {
      const candidate = getAiBatchAfter(anchor, 1);
      if (!candidate) break;
      const digest = timelineApi()?.digestRefs?.(candidate.sourceRefs || []) || '';
      const hasNode = digest && timeline.nodes.some(node =>
        node.kind === 'memory' && node.status === 'valid' && clean(node.sourceDigest) === digest
      );
      const hasSummary = digest && eventMemory.small_summaries.some(summary =>
        summary.status !== 'stale' && clean(summary.sourceDigest) === digest
      );
      if (hasNode && hasSummary) {
        anchor = candidate.endLayer;
        continue;
      }
      batch = candidate;
      break;
    }
    if (!batch) throw new Error('Hiện không có lượt hội thoại mới nào chưa được trích xuất');
    return runTasksThenDueBig({ memory: batch, small: batch }, {
      ...batch, layer: batch.endLayer, baseState: state
    });
  }

  async function manualReextract() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    if (running || backfillRunning || reconciling) throw new Error('Đã có tác vụ ký ức khác đang chạy');
    const current = data().loadState();
    const timeline = ensureTimelineState(current);
    const latestNode = timeline.nodes.slice().reverse().find(node => node.kind === 'memory' && node.status === 'valid');
    if (latestNode) {
      const eventMemory = ensureEventState(current);
      const sourceDigest = clean(latestNode.sourceDigest)
        || timelineApi()?.digestRefs?.(latestNode.sourceRefs || []) || '';
      const pairedSummary = sourceDigest ? eventMemory.small_summaries.find(summary => {
        const digest = clean(summary.sourceDigest)
          || timelineApi()?.digestRefs?.(summary.sourceRefs || []) || '';
        return summary.status === 'valid' && digest === sourceDigest;
      }) : null;
      const taskLabel = 'Suy diễn lại nhân vật, thực thể và tóm tắt';
      running = true;
      runningLabel = taskLabel;
      abortController = new AbortController();
      setExternalStatus(`Đang thực hiện ${taskLabel}…`);
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true, runningLabel);
      let repaired;
      try {
        latestNode.status = 'stale';
        if (pairedSummary) pairedSummary.status = 'stale';
        data().saveState(current);
        repaired = await repairMemoryAndSmall(latestNode.id, pairedSummary?.id);
        if (!repaired) throw new Error('Không thể suy diễn lại nhân vật, thực thể và tóm tắt của lượt gần nhất');
        setExternalStatus(`${taskLabel} đã hoàn tất`);
      } catch (error) {
        // Khi yêu cầu thất bại hoặc người dùng dừng lại, khôi phục node cũ; không được để một lần suy diễn lại chưa hoàn tất bị kẹt ở trạng thái stale.
        const rollback = data().loadState();
        const rollbackNode = ensureTimelineState(rollback).nodes.find(node => node.id === latestNode.id);
        const rollbackSummary = pairedSummary
          ? ensureEventState(rollback).small_summaries.find(summary => summary.id === pairedSummary.id)
          : null;
        if (rollbackNode?.status === 'stale') rollbackNode.status = 'valid';
        if (rollbackSummary?.status === 'stale') rollbackSummary.status = 'valid';
        data().saveState(rollback);
        applyInjection();
        const stopped = abortController?.signal?.aborted || error?.name === 'AbortError';
        setExternalStatus(stopped ? `${taskLabel} đã dừng` : `${taskLabel} thất bại: ${error?.message || error}`, !stopped);
        throw error;
      } finally {
        running = false;
        runningLabel = '';
        abortController = null;
        window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false, '');
      }

      // Giống hành động gốc: làm lại các tổng thuật hiện có bị ảnh hưởng bởi tóm tắt của lượt này, và tiếp tục tạo tổng thuật nếu vẫn đạt ngưỡng.
      const reconciliation = await reconcileHistory();
      const afterReconcile = data().loadState();
      const dueBigTask = buildBigTask(afterReconcile, false);
      const bigResult = dueBigTask
        ? await runTasks({ big: dueBigTask }, { baseState: afterReconcile, saveCheckpoint: false })
        : null;
      const updated = Math.max(1, Number(repaired?.updated || 0));
      return {
        added: updated + Number(reconciliation?.repairedCount || 0) + Number(bigResult?.updatedBig || 0),
        extracted: Number(repaired?.extracted || 0),
        updatedBig: Number(reconciliation?.updatedBig || 0) + Number(bigResult?.updatedBig || 0),
        replacedNodeId: latestNode.id,
        replacedSummaryId: pairedSummary?.id || null,
        state: bigResult?.state || data().loadState()
      };
    }
    // Khi dữ liệu cũ chưa tạo ra node dòng thời gian, giữ lại một lối dự phòng tương thích; sau khi có node mới sẽ không còn phụ thuộc vào checkpoint.
    const checkpoint = data().loadCheckpoint();
    if (!checkpoint) throw new Error('Không có điểm lưu ký ức nào để suy diễn lại');
    const readRounds = getElapsedReadRounds(checkpoint, st.manualReadRounds);
    const batch = recentConversationBatch(readRounds);
    return runTasksThenDueBig({ memory: batch, small: batch }, {
      ...batch, layer: currentLayer(), baseState: checkpoint
    });
  }

  async function manualSmallSummary() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    const state = data().loadState(), eventMemory = ensureEventState(state);
    const batch = getAiBatchAfter(eventMemory.small_summary_layer, Math.max(1, parseInt(st.smallSummaryEveryX) || 5));
    if (!batch) throw new Error('Không có hội thoại mới nào để tóm tắt sau trạng thái hiện tại');
    return runTasksThenDueBig({ small: batch }, { baseState: state });
  }

  async function manualBigSummary() {
    const st = settings();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    const state = data().loadState(), bigTask = buildBigTask(state, true);
    if (!bigTask) throw new Error('Hiện không có tóm tắt nào chưa được gộp vào tổng thuật');
    return runTasks({ big: bigTask }, { baseState: state });
  }

  function newHistoryAuditReport() {
    return { changedLayers: new Set(), deletedLayers: new Set() };
  }

  function collectHistoryAudit(report, audit) {
    if (!report || !audit) return;
    for (const item of audit.changed || []) {
      const layer = Number(item?.before?.layer ?? item?.after?.layer);
      if (Number.isFinite(layer)) report.changedLayers.add(layer);
    }
    for (const ref of audit.missing || []) {
      const layer = Number(ref?.layer);
      if (Number.isFinite(layer)) report.deletedLayers.add(layer);
    }
  }

  // Số thứ tự tầng sẽ dịch chuyển lên khi có tầng bị xóa. Tham chiếu nguồn có thể dùng ID tin nhắn ổn định để xác định
  // những tầng cũ nào đã biến mất, nhưng tiến độ tóm tắt vẫn là con trỏ số, nên phải trừ đồng bộ số tầng đã bị xóa trước con trỏ đó.
  // Nếu không, hội thoại mới sẽ phải "đuổi kịp" số tầng trước khi xóa, và trong lúc đó sẽ không tạo thêm tóm tắt nào.
  function rewindSummaryCursorForDeletedLayers(state, report) {
    const deleted = [...(report?.deletedLayers || [])].filter(Number.isFinite);
    if (!deleted.length) return false;
    const eventMemory = ensureEventState(state);
    if (eventMemory.small_summary_layer === null || eventMemory.small_summary_layer === ''
      || !Number.isFinite(Number(eventMemory.small_summary_layer))) return false;
    const anchor = Number(eventMemory.small_summary_layer);
    const removedBeforeCursor = deleted.filter(layer => layer <= anchor).length;
    if (!removedBeforeCursor) return false;
    eventMemory.small_summary_layer = Math.max(-1, anchor - removedBeforeCursor);
    return true;
  }

  function formatHistoryLayers(layers) {
    const values = [...(layers || [])].filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? `Tầng ${values.join(', ')}` : '';
  }

  function historyAuditMessage(report, phase, error) {
    const changed = formatHistoryLayers(report?.changedLayers);
    const deleted = formatHistoryLayers(report?.deletedLayers);
    const subjects = [changed ? `${changed} đã bị sửa nội dung` : '', deleted ? `${deleted} đã bị xóa` : ''].filter(Boolean);
    if (!subjects.length) {
      if (phase === 'failed') return `Sửa ký ức lịch sử thất bại: ký ức cũ đã ngừng chèn vào, lần này dùng nội dung gốc. Nguyên nhân: ${error?.message || error}`;
      return phase === 'success' ? 'Đối soát ký ức lịch sử đã hoàn tất' : 'Đang đối chiếu tầng lịch sử với chuỗi ký ức…';
    }
    const subject = subjects.join('; ');
    if (phase === 'detected') return `Phát hiện ${subject}, đang xây dựng lại ký ức, tóm tắt và tổng thuật liên quan…`;
    if (phase === 'success') return `${subject}: ký ức, tóm tắt và tổng thuật liên quan đã được cập nhật, lần chèn này dùng nội dung mới.`;
    return `${subject}: sửa ký ức lịch sử thất bại, ký ức cũ đã ngừng chèn vào, lần này dùng nội dung gốc. Nguyên nhân: ${error?.message || error}`;
  }

  function auditStoredSources(state, report) {
    const api = timelineApi(), timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    let changed = false;
    const refreshValidRefs = (record, audit) => {
      if (!audit?.valid || audit.inherited || audit.synthetic || !Array.isArray(audit.refs)) return;
      const oldLayers = (record.sourceRefs || []).map(ref => Number(ref.layer)).join(',');
      const newLayers = audit.refs.map(ref => Number(ref.layer)).join(',');
      if (oldLayers === newLayers) return;
      record.sourceRefs = clone(audit.refs);
      const bounds = sourceBounds(audit.refs, record.endLayer);
      record.startLayer = bounds.startLayer;
      record.endLayer = bounds.endLayer;
      changed = true;
    };
    for (const node of timeline.nodes) {
      if (!Array.isArray(node.sourceRefs) || !node.sourceRefs.length) continue;
      const audit = api?.auditRefs?.(node.sourceRefs);
      collectHistoryAudit(report, audit);
      refreshValidRefs(node, audit);
      const nextStatus = audit?.valid ? 'valid' : 'stale';
      if (node.status !== nextStatus) { node.status = nextStatus; changed = true; }
    }
    for (const summary of eventMemory.small_summaries) {
      if (!Array.isArray(summary.sourceRefs) || !summary.sourceRefs.length) continue; // Tóm tắt thủ công/di chuyển từ phiên bản cũ luôn giữ nguyên trạng thái phong ấn.
      const audit = api?.auditRefs?.(summary.sourceRefs);
      collectHistoryAudit(report, audit);
      refreshValidRefs(summary, audit);
      const nextStatus = audit?.valid ? 'valid' : 'stale';
      if (summary.status !== nextStatus) { summary.status = nextStatus; changed = true; }
    }
    for (const overview of eventMemory.big_summaries) {
      if (!Array.isArray(overview.childIds) || !overview.childIds.length) continue;
      const children = overview.childIds.map(id => eventMemory.small_summaries.find(item => item.id === id)).filter(Boolean);
      const digest = api?.hashText?.(children.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '';
      const valid = children.length === overview.childIds.length
        && children.every(item => item.status === 'valid')
        && digest === clean(overview.childDigest);
      const nextStatus = valid ? 'valid' : 'stale';
      if (overview.status !== nextStatus) { overview.status = nextStatus; changed = true; }
    }
    return changed;
  }

  async function repairMemoryNode(nodeId) {
    let state = data().loadState(), timeline = ensureTimelineState(state);
    let node = timeline.nodes.find(item => item.id === nodeId);
    if (!node || node.status !== 'stale') return false;
    const api = timelineApi(), audit = api?.auditRefs?.(node.sourceRefs);
    if (!audit?.refs?.length) {
      timeline.nodes = timeline.nodes.filter(item => item.id !== nodeId);
      data().saveState(replayTimeline(state));
      return true;
    }
    const base = replayTimeline(state, nodeId);
    const conversation = api?.refsToConversation?.(node.sourceRefs) || '';
    if (!conversation) return false;
    const repairBounds = sourceBounds(audit.refs, node.endLayer);
    const extracted = await requestTasks({ memory: {
      conversation,
      startLayer: repairBounds.startLayer,
      endLayer: repairBounds.endLayer
    } }, { baseState: base });

    state = data().loadState();
    timeline = ensureTimelineState(state);
    node = timeline.nodes.find(item => item.id === nodeId);
    if (!node) return false;
    const bounds = sourceBounds(audit.refs, node.endLayer);
    node.sourceRefs = clone(audit.refs);
    node.sourceDigest = api?.digestRefs?.(audit.refs) || '';
    node.startLayer = bounds.startLayer;
    node.endLayer = bounds.endLayer;
    node.personal = clone(extracted.personal || []);
    node.entities = clone(extracted.entities || {});
    node.status = 'valid';
    node.revision = Math.max(1, Number(node.revision) || 1) + 1;
    node.updatedAt = Date.now();
    data().saveState(replayTimeline(state));
    refreshMemoryPanel();
    return true;
  }

  // Sau khi trích xuất hằng ngày được cố định thành một lượt, node nhân vật/thực thể và tóm tắt của cùng lượt đó có chung nguồn.
  // Khi lịch sử thay đổi cũng gộp thành một yêu cầu, để việc thêm mới và sửa chữa dùng chung một đơn vị giao dịch nhỏ nhất.
  async function repairMemoryAndSmall(nodeId, summaryId) {
    let state = data().loadState(), timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
    let node = timeline.nodes.find(item => item.id === nodeId);
    let summary = summaryId ? eventMemory.small_summaries.find(item => item.id === summaryId) : null;
    if (!node || node.status !== 'stale' || (summaryId && (!summary || summary.status !== 'stale'))) return false;

    const api = timelineApi();
    const nodeAudit = api?.auditRefs?.(node.sourceRefs);
    const summaryAudit = summary ? api?.auditRefs?.(summary.sourceRefs) : nodeAudit;
    if (!nodeAudit?.refs?.length || !summaryAudit?.refs?.length) return false;
    const nodeDigest = api?.digestRefs?.(nodeAudit.refs) || '';
    const summaryDigest = api?.digestRefs?.(summaryAudit.refs) || '';
    if (!nodeDigest || nodeDigest !== summaryDigest) return false;

    const conversation = api?.refsToConversation?.(node.sourceRefs) || '';
    if (!conversation) return false;
    const bounds = sourceBounds(nodeAudit.refs, node.endLayer);
    const base = replayTimeline(state, nodeId);
    const extracted = await requestTasks({
      memory: {
        startLayer: bounds.startLayer,
        endLayer: bounds.endLayer,
        conversation
      },
      small: {
        startLayer: bounds.startLayer,
        endLayer: bounds.endLayer,
        conversation
      }
    }, { baseState: base });
    if (!clean(extracted.smallSummary)) {
      throw new Error('API không trả về tóm tắt, đã giữ nguyên bản ghi trước khi suy diễn lại');
    }

    state = data().loadState();
    timeline = ensureTimelineState(state);
    eventMemory = ensureEventState(state);
    node = timeline.nodes.find(item => item.id === nodeId);
    summary = summaryId ? eventMemory.small_summaries.find(item => item.id === summaryId) : null;
    if (!node || (summaryId && !summary)) return false;

    node.sourceRefs = clone(nodeAudit.refs);
    node.sourceDigest = nodeDigest;
    node.startLayer = bounds.startLayer;
    node.endLayer = bounds.endLayer;
    node.personal = clone(extracted.personal || []);
    node.entities = clone(extracted.entities || {});
    node.status = 'valid';
    node.revision = Math.max(1, Number(node.revision) || 1) + 1;
    node.updatedAt = Date.now();

    if (!summary) {
      summary = {
        id: nextSmallSummaryId(eventMemory),
        startLayer: bounds.startLayer,
        endLayer: bounds.endLayer,
        sourceRefs: clone(summaryAudit.refs),
        sourceDigest: summaryDigest,
        content: extracted.smallSummary,
        originChatId: data()?.getChatId?.() || 'default',
        status: 'valid',
        revision: 1
      };
      eventMemory.small_summaries.push(summary);
      eventMemory.small_summary_layer = Math.max(Number(eventMemory.small_summary_layer) || 0, bounds.endLayer);
    } else {
      summary.startLayer = bounds.startLayer;
      summary.endLayer = bounds.endLayer;
      summary.sourceRefs = clone(summaryAudit.refs);
      summary.sourceDigest = summaryDigest;
      summary.content = extracted.smallSummary;
      summary.status = 'valid';
      summary.revision = Math.max(1, Number(summary.revision) || 1) + 1;
    }
    data().saveState(replayTimeline(state));
    refreshMemoryPanel();
    const extractedCount = (extracted.personal || []).length
      + ENTITY_TYPES.reduce((sum, type) => sum + (extracted.entities?.[type] || []).length, 0);
    return { repaired: true, extracted: extractedCount, updated: extractedCount + 1 };
  }

  async function repairSmallSummary(summaryId) {
    let state = data().loadState(), eventMemory = ensureEventState(state);
    let summary = eventMemory.small_summaries.find(item => item.id === summaryId);
    if (!summary || summary.status !== 'stale') return false;
    const api = timelineApi(), audit = api?.auditRefs?.(summary.sourceRefs);
    if (!audit?.refs?.length) {
      const index = eventMemory.small_summaries.findIndex(item => item.id === summaryId);
      if (index >= 0) {
        eventMemory.small_summaries.splice(index, 1);
        if (index < eventMemory.big_summary_cursor) eventMemory.big_summary_cursor--;
      }
      data().saveState(state);
      return true;
    }
    const conversation = api?.refsToConversation?.(summary.sourceRefs) || '';
    if (!conversation) return false;
    const bounds = sourceBounds(audit.refs, summary.endLayer);
    const extracted = await requestTasks({ small: {
      startLayer: bounds.startLayer,
      endLayer: bounds.endLayer,
      conversation
    } }, { baseState: state });

    state = data().loadState();
    eventMemory = ensureEventState(state);
    summary = eventMemory.small_summaries.find(item => item.id === summaryId);
    if (!summary) return false;
    summary.startLayer = bounds.startLayer;
    summary.endLayer = bounds.endLayer;
    summary.sourceRefs = clone(audit.refs);
    summary.sourceDigest = api?.digestRefs?.(audit.refs) || '';
    summary.content = extracted.smallSummary;
    summary.status = 'valid';
    summary.revision = Math.max(1, Number(summary.revision) || 1) + 1;
    data().saveState(state);
    refreshMemoryPanel();
    return true;
  }

  async function repairBigSummary(overviewId) {
    let state = data().loadState(), eventMemory = ensureEventState(state);
    let overview = eventMemory.big_summaries.find(item => item.id === overviewId);
    if (!overview || overview.status !== 'stale') return false;
    const children = (overview.childIds || []).map(id => eventMemory.small_summaries.find(item => item.id === id)).filter(Boolean);
    if (!children.length) {
      eventMemory.big_summaries = eventMemory.big_summaries.filter(item => item.id !== overviewId);
      data().saveState(state);
      return true;
    }
    if (children.some(item => item.status !== 'valid')) return false;
    const api = timelineApi();
    const extracted = await requestTasks({ big: { summaries: children } }, { baseState: state });

    state = data().loadState();
    eventMemory = ensureEventState(state);
    overview = eventMemory.big_summaries.find(item => item.id === overviewId);
    if (!overview) return false;
    overview.content = extracted.bigSummary;
    overview.childIds = children.map(item => item.id);
    overview.startLayer = Number(children[0]?.startLayer) || 0;
    overview.endLayer = Number(children.at(-1)?.endLayer) || 0;
    overview.sourceRefs = api?.unionRefs?.(children.map(item => item.sourceRefs || [])) || [];
    overview.childDigest = api?.hashText?.(children.map(item => `${item.id}:${item.revision || 1}:${item.sourceDigest || ''}`).join('|')) || '';
    overview.status = 'valid';
    overview.revision = Math.max(1, Number(overview.revision) || 1) + 1;
    data().saveState(state);
    refreshMemoryPanel();
    return true;
  }

  async function reconcileHistory() {
    if (reconciling || running || backfillRunning || settings().engineEnabled === false) return { skipped: true };
    reconciling = true;
    let announced = false;
    let repairedCount = 0, updatedBig = 0;
    const auditReport = newHistoryAuditReport();
    try {
      let state = data().loadState();
      // Một khi nguồn không còn hợp lệ, lập tức phát lại từ Root và loại trừ node stale; kể cả khi việc sửa chữa
      // bằng API sau đó thất bại, đóng góp từ nhân vật/thực thể cũ cũng sẽ không tiếp tục được chèn vào nữa.
      const sourcesChanged = auditStoredSources(state, auditReport);
      const summaryCursorChanged = rewindSummaryCursorForDeletedLayers(state, auditReport);
      if (sourcesChanged || summaryCursorChanged) {
        state = replayTimeline(state);
        data().saveState(state);
      }
      const timeline = ensureTimelineState(state), eventMemory = ensureEventState(state);
      const needsRepair = timeline.nodes.some(node => node.status === 'stale')
        || eventMemory.small_summaries.some(item => item.status === 'stale')
        || eventMemory.big_summaries.some(item => item.status === 'stale');
      if (!needsRepair) {
        applyInjection();
        return { repaired: false };
      }
      runningLabel = 'Đối soát ký ức lịch sử';
      abortController = new AbortController();
      setExternalStatus(historyAuditMessage(auditReport, 'detected'));
      window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(true, runningLabel);
      announced = true;

      for (const node of ensureTimelineState(data().loadState()).nodes.slice()) {
        if (node.status !== 'stale') continue;
        const current = data().loadState();
        const currentEvent = ensureEventState(current);
        const nodeSourceDigest = clean(node.sourceDigest)
          || timelineApi()?.digestRefs?.(node.sourceRefs || []) || '';
        const pairedSummary = nodeSourceDigest ? currentEvent.small_summaries.find(summary => {
          if (summary.status !== 'stale') return false;
          const summaryDigest = clean(summary.sourceDigest)
            || timelineApi()?.digestRefs?.(summary.sourceRefs || []) || '';
          return summaryDigest === nodeSourceDigest;
        }) : null;
        const repairedTogether = pairedSummary
          ? await repairMemoryAndSmall(node.id, pairedSummary.id)
          : false;
        if (repairedTogether) repairedCount += Math.max(1, Number(repairedTogether.updated || 0));
        else if (await repairMemoryNode(node.id)) repairedCount += 1;
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      for (const summary of ensureEventState(data().loadState()).small_summaries.slice()) {
        if (summary.status === 'stale' && await repairSmallSummary(summary.id)) repairedCount += 1;
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      for (const overview of ensureEventState(data().loadState()).big_summaries.slice()) {
        if (overview.status === 'stale' && await repairBigSummary(overview.id)) {
          repairedCount += 1;
          updatedBig += 1;
        }
      }
      state = data().loadState();
      auditStoredSources(state);
      data().saveState(state);
      const finalTimeline = ensureTimelineState(state), finalEventMemory = ensureEventState(state);
      const unresolved = finalTimeline.nodes.some(node => node.status === 'stale')
        || finalEventMemory.small_summaries.some(item => item.status === 'stale')
        || finalEventMemory.big_summaries.some(item => item.status === 'stale');
      if (unresolved) throw new Error('Vẫn còn ký ức hoặc tóm tắt liên quan chưa xây dựng lại được');
      applyInjection();
      setExternalStatus(historyAuditMessage(auditReport, 'success'));
      return { repaired: true, repairedCount, updatedBig };
    } catch (error) {
      const state = data().loadState();
      auditStoredSources(state, auditReport);
      data().saveState(replayTimeline(state));
      applyInjection(); // Tóm tắt không còn hợp lệ sẽ không được chèn vào, nội dung gốc sẽ được khôi phục để tránh lỗ hổng thông tin.
      setExternalStatus(historyAuditMessage(auditReport, 'failed', error), true);
      throw error;
    } finally {
      reconciling = false;
      runningLabel = '';
      abortController = null;
      if (announced) window.WORLD_ENGINE_UI?.setMemoryEvolvingUI?.(false, '');
    }
  }

  function abort() {
    backfillRunning = false;
    abortController?.abort();
  }

  function clearInjection() {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, '', 1, 1);
    else if (typeof ctx?.unregisterInjection === 'function') ctx.unregisterInjection(INJECTION_NAME);
  }

  function registerInjection(content) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt === 'function') ctx.setExtensionPrompt(INJECTION_NAME, content, 1, 1);
    else if (typeof ctx?.registerInjection === 'function') {
      ctx.unregisterInjection?.(INJECTION_NAME);
      ctx.registerInjection(INJECTION_NAME, content, { position: 1, depth: 1, role: 'system' });
    }
  }

  async function prepareHistoryForGeneration() {
    if (settings().engineEnabled === false) return { invalidated: false };
    const auditReport = newHistoryAuditReport();
    let state = data().loadState();
    const sourcesChanged = auditStoredSources(state, auditReport);
    const summaryCursorChanged = rewindSummaryCursorForDeletedLayers(state, auditReport);
    if (sourcesChanged || summaryCursorChanged) {
      state = replayTimeline(state);
      data().saveState(state);
    }
    // Tóm tắt/tổng thuật ở trạng thái stale sẽ không còn được chèn vào; nội dung nguồn của chúng (ví dụ tầng 3, 4) sẽ được bỏ khỏi tập hợp ẩn.
    applyInjection();
    await hiddenSyncPromise;
    return { invalidated: sourcesChanged || summaryCursorChanged };
  }

  function selectHiddenMessageIds(coveredRefs, currentChatId, recentMessageIds) {
    const recent = recentMessageIds instanceof Set ? recentMessageIds : new Set(recentMessageIds || []);
    return new Set((coveredRefs || [])
      .filter(ref => clean(ref?.chatId) === clean(currentChatId))
      .map(ref => clean(ref?.messageId))
      .filter(messageId => messageId && !recent.has(messageId)));
  }

  function recentRawRoundMessageIds(messages, roundCount, st, api) {
    const source = Array.isArray(messages) ? messages : [];
    const take = Math.max(0, parseInt(roundCount) || 0);
    if (!source.length || !take) return new Set();
    const opening = ignoreFirstLayer(st);
    const aiLayers = source.map((message, index) => (
      !message?.is_user && !(opening && index === 0) ? index : -1
    )).filter(index => index >= 0);
    const start = aiLayers.length > take ? aiLayers[aiLayers.length - take - 1] + 1 : 0;
    return new Set(source.slice(start)
      .map(message => clean(api?.ensureMessageId?.(message)))
      .filter(Boolean));
  }

  function syncHiddenMessages(messageIds, label) {
    try {
      hiddenSyncPromise = Promise.resolve(timelineApi()?.syncHidden?.(messageIds))
        .catch(error => console.warn(`[Memory Engine] ${label}`, error));
    } catch (error) {
      console.warn(`[Memory Engine] ${label}`, error);
      hiddenSyncPromise = Promise.resolve();
    }
    return hiddenSyncPromise;
  }

  function applyInjection(options) {
    const st = settings();
    if (st.engineEnabled === false || st.injectIntoPrompt === false) {
      clearInjection();
      syncHiddenMessages(new Set(), 'Khôi phục nội dung gốc thất bại');
      return '';
    }
    const state = (options?.isReroll && data().loadCheckpoint()) || data().loadState();
    ensureEntityState(state);
    const eventMemory = ensureEventState(state);
    const hasPeople = Boolean(state?.personal_memory?.length);
    const hasEntities = ENTITY_TYPES.some(type => state.entity_memory[type].length);
    const hasEvents = Boolean(eventMemory.big_summaries.length || eventMemory.small_summaries.length);
    if (!hasPeople && !hasEntities && !hasEvents) {
      clearInjection();
      syncHiddenMessages(new Set(), 'Khôi phục nội dung gốc thất bại');
      return '';
    }
    if (!state.knowledge_index || !Object.keys(state.knowledge_index).length) rebuildKnowledgeIndex(state);
    const scan = chat().slice(-Math.max(1, parseInt(st.searchDepth) || 5)).map(message => clean(message?.mes)).join('\n');
    const appearsInScan = name => {
      if (!name) return false;
      return new RegExp(String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(scan);
    };
    const matched = (state.personal_memory || []).filter(character => (character.names || []).some(appearsInScan));
    const matchedEntities = ENTITY_TYPES.flatMap(type => state.entity_memory[type]
      .filter(entity => unique([entity.name, ...(entity.aliases || [])]).some(appearsInScan))
      .map(entity => ({ type, entity })));
    const sections = [], globalSeen = new Set(), limit = Math.max(1, parseInt(st.maxPerCharacter) || 20);
    const bigLimit = Math.max(1, parseInt(st.bigSummaryInjectLimit) || 3);
    const validBig = eventMemory.big_summaries.filter(item => item.status !== 'stale' && item.status !== 'failed');
    const recentBig = validBig.slice(-bigLimit);
    if (recentBig.length) {
      sections.push(`【Tổng Thuật Câu Chuyện】\n${recentBig.map(item =>
        `- [Tầng ${item.startLayer}-${item.endLayer}] ${item.content}`
      ).join('\n')}`);
    }
    const coveredChildIds = new Set(recentBig.flatMap(item => item.childIds || []));
    const hasStructuredOverview = eventMemory.big_summaries.some(item => Array.isArray(item.childIds) && item.childIds.length);
    const pendingSmall = eventMemory.small_summaries.filter((item, index) => {
      if (item.status === 'stale' || item.status === 'failed') return false;
      // Cấu trúc mới xét chính xác theo childIds; dữ liệu cũ không có childIds thì vẫn dùng con trỏ để tương thích.
      if (hasStructuredOverview) return !coveredChildIds.has(item.id);
      return index >= eventMemory.big_summary_cursor;
    });
    if (pendingSmall.length) {
      sections.push(`【Tóm Tắt Sự Kiện Gần Đây】\n${pendingSmall.map(item =>
        `- [Tầng ${item.startLayer}-${item.endLayer}] ${item.content}`
      ).join('\n')}`);
    }
    for (const character of matched) {
      const records = [];
      for (const name of character.names || []) records.push(...(state.knowledge_index[normalized(name)] || []));
      const candidates = records.filter(record => {
        const key = `${record.ownerId}\u0000${record.time}\u0000${record.memory}`;
        return !globalSeen.has(key);
      }).filter((record, index, list) => list.findIndex(other =>
        other.ownerId === record.ownerId && other.time === record.time && other.memory === record.memory
      ) === index);
      const selected = exponentialMemorySample(candidates, limit, Math.random, st.injectionDiceSides);
      selected.forEach(record => globalSeen.add(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`));
      if (selected.length) sections.push(`【${character.names?.[0] || character.id}】\n` +
        selected.map(record => `- [${record.time || 'Chưa rõ thời gian'}] ${record.memory}`).join('\n'));
    }
    if (matchedEntities.length) {
      const entitySections = matchedEntities.map(({ type, entity }) => {
        const lines = [`【${ENTITY_LABELS[type]}: ${entity.name}】`, entity.description];
        const history = exponentialMemorySample(
          Array.isArray(entity.history) ? entity.history : [], limit, Math.random, st.injectionDiceSides
        );
        if (history.length) lines.push(...history.map(entry => `- [${entry.time || 'Chưa rõ thời gian'}] ${entry.event}`));
        return lines.filter(Boolean).join('\n');
      });
      sections.push(`【Thực Thể Thế Giới Liên Quan】\n${entitySections.join('\n\n')}`);
    }
    const coveredRefs = timelineApi()?.unionRefs?.([
      ...recentBig.map(item => item.sourceRefs || []),
      ...pendingSmall.map(item => item.sourceRefs || [])
    ]) || [];
    const api = timelineApi();
    const coveredMessageIds = (() => {
      if (st.hideCoveredRawText === false) return new Set();
      const keepRawRounds = st.recentRawRounds === undefined
        ? 1 : Math.max(0, parseInt(st.recentRawRounds) || 0);
      const recentMessageIds = recentRawRoundMessageIds(chat(), keepRawRounds, st, api);
      return selectHiddenMessageIds(coveredRefs, data()?.getChatId?.(), recentMessageIds);
    })();
    syncHiddenMessages(coveredMessageIds, 'Đồng bộ phần nội dung bị che thất bại');
    if (!sections.length) { clearInjection(); return ''; }
    const content = `${SENTINEL}\nTóm tắt sự kiện ghi lại diễn biến cốt truyện đã xảy ra trong hội thoại; mục nhân vật là ký ức chủ quan mà nhân vật trong cảnh hiện tại đang giữ hoặc biết rõ, có thể mâu thuẫn với nhau; mục thực thể ghi lại mô tả hiện tại và lịch sử cục bộ của các tổ chức, vật phẩm, năng lực và địa điểm liên quan.\n\n${sections.join('\n\n')}`;
    registerInjection(content);
    return content;
  }

  function buildWorldEngineContext(worldState) {
    const st = settings();
    if (st.engineEnabled === false || st.injectIntoWorldEngine !== true || !worldState) return '';
    const state = data().loadState();
    ensureEntityState(state);
    if (!state.knowledge_index || !Object.keys(state.knowledge_index).length) rebuildKnowledgeIndex(state);
    const scan = JSON.stringify(worldState);
    const appears = name => name && scan.includes(String(name));
    const limit = Math.max(1, parseInt(st.worldEngineMemoryLimit) || 5);
    const sections = [], seenRecords = new Set();
    for (const character of state.personal_memory || []) {
      if (!(character.names || []).some(appears)) continue;
      const records = [];
      for (const name of character.names || []) records.push(...(state.knowledge_index[normalized(name)] || []));
      const candidates = records.filter(record => {
        const key = `${record.ownerId}\u0000${record.time}\u0000${record.memory}`;
        if (seenRecords.has(key)) return false;
        return true;
      }).filter((record, index, list) => list.findIndex(other =>
        other.ownerId === record.ownerId && other.time === record.time && other.memory === record.memory
      ) === index);
      const selected = exponentialMemorySample(candidates, limit, Math.random, st.injectionDiceSides);
      selected.forEach(record => seenRecords.add(`${record.ownerId}\u0000${record.time}\u0000${record.memory}`));
      if (selected.length) sections.push(`【Nhân Vật: ${character.names?.[0] || character.id}】\n` +
        selected.map(record => `- [${record.time || 'Chưa rõ thời gian'}] ${record.memory}`).join('\n'));
    }
    for (const type of ENTITY_TYPES) {
      for (const entity of state.entity_memory[type] || []) {
        if (!unique([entity.name, ...(entity.aliases || [])]).some(appears)) continue;
        const lines = [`【${ENTITY_LABELS[type]}: ${entity.name}】`];
        if (entity.description) lines.push(entity.description);
        lines.push(...exponentialMemorySample(
          Array.isArray(entity.history) ? entity.history : [], limit, Math.random, st.injectionDiceSides
        )
          .map(entry => `- [${entry.time || 'Chưa rõ thời gian'}] ${entry.event}`));
        sections.push(lines.join('\n'));
      }
    }
    if (!sections.length) return '';
    return `【Thông Tin Nhân Vật Và Thực Thể Liên Quan Do Memory Engine Cung Cấp】\nThông tin dưới đây chỉ dùng để hỗ trợ suy diễn thế giới; không bao gồm tóm tắt hay tổng thuật.\n\n${sections.join('\n\n')}`;
  }

  async function ingestWorldEvolution(payload) {
    const worldSettings = window.WORLD_ENGINE_API?.getSettings?.(true) || {};
    if (worldSettings.memoryLinkEnabled !== true && payload?.force !== true) return { skipped: true, reason: 'disabled' };
    const st = settings();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt, không thể thực hiện liên kết thế giới');
    if (backfillRunning) throw new Error('Memory Engine đang hồi cứu hàng loạt, tạm thời không thể thực hiện liên kết thế giới');
    const layer = Number.isFinite(Number(payload?.layer)) ? Number(payload.layer) : currentLayer();
    // Khi trích xuất ký ức thông thường bắt đầu trước, phải chờ nó lưu vào kho dữ liệu xong hoàn toàn; không được đọc đồng thời cùng một trạng thái nền rồi ghi đè lẫn nhau.
    const deadline = Date.now() + Math.max(10000, Number(st.apiTimeoutMs) || 120000);
    while (running && Date.now() < deadline) await delay(100);
    if (running) throw new Error('Chờ tác vụ ký ức hiện tại kết thúc đã quá thời gian cho phép');
    if (payload?.replace === true) rollbackLinkedLayer(layer);

    const digest = clean(payload?.worldDigest);
    if (!digest) return { skipped: true, reason: 'empty_digest' };
    const sourceKey = `${data().getChatId()}:${layer}`;
    const worldInfo = payload?.worldUpdate && typeof payload.worldUpdate === 'object'
      ? JSON.stringify(payload.worldUpdate, null, 2)
      : digest;
    const attemptBase = data().loadState();
    try {
      const result = await runTasksThenDueBig({
        memory: {
          conversation: `【Kết Quả Trả Về Từ World Engine Lượt Này】\n${worldInfo}\n\nTrên đây là thông tin thế giới khách quan. Chỉ cập nhật nhận thức nhân vật và thực thể thế giới mà nội dung này hỗ trợ rõ ràng, không được suy đoán rằng bất kỳ nhân vật nào biết thông tin chưa công khai.`,
          sourceKey,
          startLayer: layer,
          endLayer: layer,
          kind: 'world_link'
        }
      }, {
        layer,
        baseState: attemptBase,
        saveCheckpoint: false,
        worldDigestMinute: { layer, sourceKey, content: digest }
      });
      return result;
    } catch (error) {
      // Nếu liên kết thất bại chỉ hoàn tác lần thử liên kết này; việc trích xuất ký ức thông thường đã hoàn tất ở cùng tầng vẫn nên được giữ lại.
      data().saveState(attemptBase);
      applyInjection();
      throw error;
    }
  }

  function setBackfillStatus(current, total, message) {
    backfillStatus = { running: backfillRunning, current, total, message: message || '' };
    const element = document.getElementById('we-memory-person-backfill-status');
    if (element) element.textContent = backfillStatus.message;
  }

  function setSummaryBackfillStatus(current, total, message) {
    summaryBackfillStatus = { running: backfillRunning, current, total, message: message || '' };
    const element = document.getElementById('we-memory-summary-backfill-status');
    if (element) element.textContent = summaryBackfillStatus.message;
  }

  async function backfill() {
    if (backfillRunning || running) return;
    const st = settings(), all = chat();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(all.length - 1, configuredEnd || all.length - 1);
    const opening = ignoreFirstLayer(st);
    const aiLayers = all.map((message, index) => (!message?.is_user && index <= end && !(opening && index === 0) ? index : -1)).filter(i => i >= 0);
    const size = Math.max(1, parseInt(st.backfillBatchSize) || 5), batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setBackfillStatus(0, 0, 'Không có tầng AI nào để hồi cứu'); return; }
    backfillRunning = true;
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.createSnapshot?.('Tự động sao lưu trước khi hồi cứu ký ức');
    const original = data().loadState();
    data().saveCheckpoint(original);
    data().saveState({
      ...original,
      personal_memory: [],
      knowledge_index: {},
      entity_memory: { organization: [], object: [], ability: [], location: [] },
      entity_index: {},
      round: 0,
      chatLayer: null,
      timeline: null
    });
    try {
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i], start = Math.max(0, layers[0] - 1), finish = layers.at(-1);
        setBackfillStatus(i, batches.length, `Đang hồi cứu ${i + 1} / ${batches.length}`);
        await extractConversation(formatMessages(all.slice(start, finish + 1), start), {
          startLayer: start,
          endLayer: finish,
          sourceRefs: timelineApi()?.captureRange?.(start, finish) || [],
          layer: finish, retries: st.backfillRetries, saveCheckpoint: true, allowWhileBackfill: true
        });
      }
      setBackfillStatus(batches.length, batches.length, backfillRunning ? 'Hồi cứu ký ức đã hoàn tất' : 'Hồi cứu ký ức đã dừng');
    } catch (error) {
      setBackfillStatus(backfillStatus.current, batches.length, `Hồi cứu thất bại: ${error?.message || error}`);
      throw error;
    } finally { backfillRunning = false; backfillStatus.running = false; applyInjection(); }
  }

  async function backfillSummaries() {
    if (backfillRunning || running) return;
    const st = settings(), all = chat();
    if (st.engineEnabled === false) throw new Error('Memory Engine đã tắt');
    const configuredEnd = Math.max(0, parseInt(st.backfillEndLayer) || 0);
    const end = Math.min(all.length - 1, configuredEnd || all.length - 1);
    const opening = ignoreFirstLayer(st);
    const aiLayers = all.map((message, index) => (!message?.is_user && index <= end && !(opening && index === 0) ? index : -1)).filter(index => index >= 0);
    const size = Math.max(1, parseInt(st.summaryBackfillSmallEveryX) || 5), batches = [];
    for (let i = 0; i < aiLayers.length; i += size) batches.push(aiLayers.slice(i, i + size));
    if (!batches.length) { setSummaryBackfillStatus(0, 0, 'Không có tầng AI nào để hồi cứu'); return; }
    backfillRunning = true;
    window.WORLD_ENGINE_CHATCACHE?.forScope?.('memory')?.createSnapshot?.('Tự động sao lưu trước khi hồi cứu tóm tắt và tổng thuật');
    const original = data().loadState();
    data().saveCheckpoint(original);
    data().saveState({
      ...original,
      event_memory: { small_summaries: [], big_summaries: [], small_summary_layer: null, big_summary_cursor: 0 }
    });
    try {
      for (let i = 0; i < batches.length && backfillRunning; i++) {
        const layers = batches[i], firstAi = layers[0], finish = layers.at(-1);
        const start = firstAi > 0 && all[firstAi - 1]?.is_user ? firstAi - 1 : firstAi;
        const smallTask = {
          startLayer: start,
          endLayer: finish,
          conversation: formatMessages(all.slice(start, finish + 1), start),
          sourceRefs: timelineApi()?.captureRange?.(start, finish) || []
        };
        const state = data().loadState();
        setSummaryBackfillStatus(i, batches.length, `Đang hồi cứu tóm tắt và tổng thuật ${i + 1} / ${batches.length}`);
        await runTasksThenDueBig({ small: smallTask }, {
          baseState: state, retries: st.backfillRetries, saveCheckpoint: true, allowWhileBackfill: true
        }, st.summaryBackfillBigEveryX);
      }
      setSummaryBackfillStatus(batches.length, batches.length, backfillRunning ? 'Hồi cứu tóm tắt và tổng thuật đã hoàn tất' : 'Hồi cứu tóm tắt và tổng thuật đã dừng');
    } catch (error) {
      setSummaryBackfillStatus(summaryBackfillStatus.current, batches.length, `Hồi cứu tóm tắt và tổng thuật thất bại: ${error?.message || error}`);
      throw error;
    } finally { backfillRunning = false; summaryBackfillStatus.running = false; applyInjection(); }
  }

  function stopBackfill() {
    backfillRunning = false;
    abortController?.abort();
    setBackfillStatus(backfillStatus.current, backfillStatus.total, 'Đang dừng…');
    setSummaryBackfillStatus(summaryBackfillStatus.current, summaryBackfillStatus.total, 'Đang dừng…');
  }

  function onMessageReceived() {
    const key = `${currentLayer()}:${clean(chat().at(-1)?.mes).slice(-80)}`;
    if (key === lastEventKey) return;
    lastEventKey = key;
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => autoExtract().catch(error => console.error('[Memory Engine] Tự động trích xuất thất bại', error)), 1500);
  }

  function schedulePreparation(delayMs = 50) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => prepareHistoryForGeneration()
      .catch(error => console.error('[Memory Engine] Thu hồi tóm tắt lịch sử cũ thất bại', error)), delayMs);
  }

  function guardEvent(label, handler) {
    if (typeof window.WORLD_ENGINE_GUARD_EVENT === 'function') {
      return window.WORLD_ENGINE_GUARD_EVENT('Memory Engine', label, handler);
    }
    return function(...args) {
      try {
        const result = handler(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(error => console.error(`[Memory Engine] Xử lý sự kiện ${label} thất bại`, error));
        }
        return result;
      }
      catch (error) { console.error(`[Memory Engine] Xử lý sự kiện ${label} thất bại`, error); }
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;
    initializeSummaryBaseline();
    const ctx = context(), types = ctx?.event_types || {};
    if (ctx?.eventSource) {
      ctx.eventSource.on(types.GENERATION_ENDED || types.MESSAGE_RECEIVED || 'message_received', guardEvent('sinh nội dung hoàn tất', onMessageReceived));
      ctx.eventSource.on(types.CHAT_LOADED || 'chat_loaded', guardEvent('tải cuộc trò chuyện', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        lastEventKey = '';
        initializeSummaryBaseline();
        schedulePreparation(100);
      }));
      ctx.eventSource.on(types.MESSAGE_SWIPED || 'message_swiped', guardEvent('vuốt để tạo lại', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        if (!rollbackLinkedLayer(currentLayer())) applyInjection({ isReroll: true });
        schedulePreparation(50);
      }));
      ctx.eventSource.on(types.MESSAGE_DELETED || 'message_deleted', guardEvent('xóa tin nhắn', () => {
        clearTimeout(autoTimer);
        abortController?.abort();
        lastEventKey = '';
        schedulePreparation(50);
      }));
      ctx.eventSource.on(types.GENERATION_STARTED || 'generation_started', guardEvent('bắt đầu sinh nội dung', (type, _opts, dryRun) => {
        if (!dryRun) applyInjection({ isReroll: type === 'swipe' || type === 'regenerate' });
      }));
    }
    try { applyInjection(); }
    catch (error) { console.error('[Memory Engine] Chèn lần đầu thất bại', error); }
  }

  return {
    init, applyInjection, buildWorldEngineContext, ingestWorldEvolution, manualExtract, manualReextract, extractNow: manualExtract,
    reconcileHistory, prepareHistoryForGeneration, replayTimeline, commitManualState,
    manualSmallSummary, manualBigSummary,
    backfill, backfillSummaries, stopBackfill, abort,
    repairStateIndexes, replaceKnownByRecords,
    getLastDebug: () => clone(lastDebug), getBackfillStatus: () => clone(backfillStatus),
    getSummaryBackfillStatus: () => clone(summaryBackfillStatus),
    getRunningLabel: () => runningLabel,
    isRunning: () => running || backfillRunning || reconciling,
    _test: {
      exponentialMemorySample, rollbackLinkedLayer, removeLinkedLayerFromState, rewindSummaryCursorForDeletedLayers,
      buildSmallHistoryContext, buildTaskReferenceContext, previousRawReference,
      parseResponse, selectHiddenMessageIds, recentRawRoundMessageIds
    }
  };
})();
