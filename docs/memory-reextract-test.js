const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
const calls = [];
const uiStates = [];
const chat = [
  { is_user: false, name: 'Nhân vật', mes: 'Lời mở đầu' },
  { is_user: true, name: 'Người dùng', mes: 'Nội dung người dùng vòng 1' },
  { is_user: false, name: 'Nhân vật', mes: 'Nội dung nhân vật vòng 1' },
  { is_user: true, name: 'Người dùng', mes: 'Nội dung người dùng vòng phụ trợ' },
  { is_user: false, name: 'Nhân vật', mes: 'Nội dung nhân vật vòng phụ trợ' },
  { is_user: true, name: 'Người dùng', mes: 'Nội dung người dùng vòng mục tiêu' },
  { is_user: false, name: 'Nhân vật', mes: 'Nội dung nhân vật vòng mục tiêu' }
];
const settings = {
  engineEnabled: true,
  firstLayerIsAiOpening: true,
  referenceRawRounds: 1,
  referenceSmallSummaryCount: 2,
  referenceBigSummaryCount: 1,
  bigSummaryEveryX: 1,
  bigSummaryInjectLimit: 3,
  maxTokens: 2000,
  temperature: 0.2,
  apiAutoRetries: 0,
  worldbookEnabled: false,
  injectIntoPrompt: true,
  searchDepth: 5,
  maxPerCharacter: 20,
  filterRegex: ''
};

const refs = (start, end) => chat.slice(start, end + 1).map((message, offset) => ({
  chatId: 'reextract-test',
  messageId: `floor-${start + offset}`,
  layer: start + offset,
  role: message.is_user ? 'user' : 'assistant',
  hash: `hash-${start + offset}`
}));
const digestRefs = list => (list || []).map(item => item.messageId).join('|');
const hashText = text => `digest:${text}`;
const refsToConversation = list => (list || []).map(ref => {
  const message = chat[ref.layer];
  return `【${message.is_user ? 'Người dùng' : 'Nhân vật'}】${message.mes}`;
}).join('\n');

const sandbox = {
  window: null,
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return { chat, name1: 'Người dùng', name2: 'Nhân vật', setExtensionPrompt() {} }; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'reextract-test'; },
    getChatLayer() { return chat.length - 1; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {} }; } },
  WORLD_ENGINE_UI: {
    setMemoryEvolvingUI(active, label) {
      uiStates.push({ active, label, running: sandbox.MEMORY_ENGINE?.isRunning?.() || false });
    },
    refresh() {}
  },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...settings }; } },
  MEMORY_ENGINE_TIMELINE: {
    captureRange(start, end) { return refs(start, end); },
    auditRefs(list) { return { valid: true, refs: JSON.parse(JSON.stringify(list || [])), missing: [], changed: [] }; },
    digestRefs,
    refsToConversation,
    unionRefs(groups) { return groups.flat(); },
    hashText,
    syncHidden() { return Promise.resolve(); }
  },
  WORLD_ENGINE_API: { async callApi() { throw new Error('test API not configured'); } }
};
sandbox.window = sandbox;

for (const filename of [
  'memory-engine-data.js',
  'memory-engine-prompt.js',
  'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js',
  'memory-engine.js'
]) vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });

function seedState() {
  const state = sandbox.MEMORY_ENGINE_DATA.defaultState();
  const oldSmallRefs = refs(1, 2), targetRefs = refs(5, 6);
  state.event_memory.small_summaries = [
    {
      id: 'small_000001', startLayer: 1, endLayer: 2, content: 'Nội dung tóm tắt trước đó',
      sourceRefs: oldSmallRefs, sourceDigest: digestRefs(oldSmallRefs), originChatId: 'reextract-test', status: 'valid', revision: 1
    },
    {
      id: 'small_000002', startLayer: 5, endLayer: 6, content: 'Tóm tắt mục tiêu cũ',
      sourceRefs: targetRefs, sourceDigest: digestRefs(targetRefs), originChatId: 'reextract-test', status: 'valid', revision: 1
    }
  ];
  state.event_memory.small_summary_layer = 6;
  state.event_memory.big_summary_cursor = 1;
  state.event_memory.big_summaries = [{
    id: 'big_000001', startLayer: 1, endLayer: 2, content: 'Nội dung tổng thuật trước đó',
    childIds: ['small_000001'],
    childDigest: hashText(`small_000001:1:${digestRefs(oldSmallRefs)}`),
    sourceRefs: oldSmallRefs, originChatId: 'other-chat', status: 'valid', revision: 1
  }];
  state.timeline = {
    originChatId: 'reextract-test',
    root: {
      id: 'root:reextract-test', originChatId: 'reextract-test', createdAt: 1,
      base: { personal_memory: [], knowledge_index: {}, entity_memory: {}, entity_index: {}, round: 0, chatLayer: null }
    },
    nodes: [{
    id: 'memory_000001', kind: 'memory', originChatId: 'reextract-test', startLayer: 5, endLayer: 6,
    sourceRefs: targetRefs, sourceDigest: digestRefs(targetRefs),
    personal: [{ name: ['Nhân vật'], known_by: [], memory: 'Ký ức cũ', time: '' }], entities: {},
    status: 'valid', revision: 1, createdAt: 1, updatedAt: 1
    }]
  };
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
}

(async () => {
  seedState();
  let activeSignal;
  sandbox.WORLD_ENGINE_API.callApi = async (_prompt, _maxTokens, _temperature, signal) => {
    activeSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true }));
  };
  const pending = sandbox.MEMORY_ENGINE.manualReextract();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(sandbox.MEMORY_ENGINE.isRunning(), true, 'Sau khi bấm suy diễn lại phải lập tức chuyển sang trạng thái đang chạy');
  assert.ok(activeSignal, 'API suy diễn lại phải nhận được signal có thể hủy');
  sandbox.MEMORY_ENGINE.abort();
  await assert.rejects(pending, error => error?.name === 'AbortError');
  const rolledBack = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(rolledBack.timeline.nodes[0].status, 'valid', 'Sau khi hủy phải khôi phục node nhân vật/thực thể cũ');
  assert.strictEqual(rolledBack.event_memory.small_summaries[1].status, 'valid', 'Sau khi hủy phải khôi phục tóm tắt cũ');

  calls.length = 0;
  sandbox.WORLD_ENGINE_API.callApi = async (prompt, _maxTokens, _temperature, signal) => {
    calls.push({ prompt, signal });
    if (prompt.includes('"big_summary": ""')) return JSON.stringify({ big_summary: 'Tổng thuật được tạo lại' });
    return JSON.stringify({
      personal_memory: [{ name: ['Nhân vật'], known_by: [], memory: 'Ký ức được tạo lại', time: '' }],
      entity_updates: [],
      small_summary: 'Tóm tắt mục tiêu được tạo lại'
    });
  };
  const result = await sandbox.MEMORY_ENGINE.manualReextract();
  assert.strictEqual(calls.length, 2, 'Sau khi suy diễn lại, nếu đạt ngưỡng phải tiếp tục thực hiện suy diễn tổng thuật');
  assert.ok(calls[0].prompt.includes('Nội dung người dùng vòng mục tiêu') && calls[0].prompt.includes('Nội dung nhân vật vòng mục tiêu'), 'Phải làm lại nội dung mục tiêu vừa rồi');
  assert.ok(calls[0].prompt.includes('Nội dung người dùng vòng phụ trợ') && calls[0].prompt.includes('Nội dung nhân vật vòng phụ trợ'), 'Phải mang theo nội dung phụ trợ theo cấu hình X');
  assert.ok(calls[0].prompt.includes('Nội dung tóm tắt trước đó'), 'Phải mang theo tóm tắt trước đó theo cấu hình Y');
  assert.ok(calls[0].prompt.includes('Nội dung tổng thuật trước đó'), 'Phải mang theo tổng thuật trước đó theo cấu hình Z');
  assert.ok(calls.every(call => call.signal), 'Suy diễn lại và tổng thuật kế tiếp đều phải có thể hủy');
  assert.ok(result.added >= 3, 'Kết quả thành công phải trả về số lượng cập nhật thực tế của ký ức nhân vật, tóm tắt và tổng thuật');
  assert.strictEqual(result.updatedBig, 1);
  assert.ok(uiStates.some(item => item.active && item.running), 'Suy diễn lại phải lập tức làm mới hiệu ứng đang chạy');

  seedState();
  settings.apiAutoRetries = 3;
  let malformedCalls = 0;
  sandbox.WORLD_ENGINE_API.callApi = async () => {
    malformedCalls++;
    return 'Đây không phải JSON có thể phân tích';
  };
  await assert.rejects(sandbox.MEMORY_ENGINE.manualReextract(), /không chứa đối tượng hoặc mảng JSON hợp lệ/);
  assert.strictEqual(malformedCalls, 4, 'JSON không thể sửa được tính là lỗi (fault), phải retry thêm 3 lần theo cấu hình');
  console.log('memory reextract tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
