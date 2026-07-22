// Kiểm thử offline cho liên kết World → Memory và cơ chế tiêm theo xác suất mũ: node docs/memory-world-link-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const store = new Map();
let version = 'A';
const chat = [{ is_user: false, name: 'Nhân vật', mes: 'Kịch bản kiểm thử' }];
const memorySettings = {
  engineEnabled: true,
  bigSummaryEveryX: 1,
  injectIntoPrompt: false,
  maxTokens: 2000,
  temperature: 0.2,
  apiAutoRetries: 0,
  filterRegex: ''
};

const sandbox = {
  window: null,
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return { chat }; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'world-link-test'; },
    getChatLayer() { return 20; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {} }; } },
  WORLD_ENGINE_UI: { setMemoryEvolvingUI() {} },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...memorySettings }; } },
  WORLD_ENGINE_API: {
    getSettings() { return { memoryLinkEnabled: true }; },
    async callApi(prompt) {
      if (prompt.includes('"big_summary": ""')) {
        return JSON.stringify({ big_summary: `Tổng thuật-${version}` });
      }
      return JSON.stringify({
        personal_memory: [{ name: ['Giáp'], known_by: [], memory: `Giáp ghi nhớ phiên bản-${version} của thế giới.`, time: '' }],
        entity_updates: [{
          type: 'location', name: 'Cổng thành', description: `Trạng thái cổng thành-${version}`, event: `Cổng thành có biến động-${version}.`, time: ''
        }]
      });
    }
  }
};
sandbox.window = sandbox;

for (const file of [
  'memory-engine-data.js', 'memory-engine-prompt.js', 'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js', 'memory-engine.js'
]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}

(async () => {
  let ordinaryState = sandbox.MEMORY_ENGINE_DATA.loadState();
  ordinaryState.timeline.nodes.push({
    id: 'memory_ordinary', kind: 'memory', originChatId: 'world-link-test',
    startLayer: 19, endLayer: 20, status: 'valid', revision: 1,
    sourceRefs: [{
      chatId: 'world-link-test', messageId: 'ordinary:19-20', layer: 20,
      role: 'synthetic', swipeId: 0, hash: 'ordinary', synthetic: true
    }],
    sourceDigest: 'ordinary',
    personal: [{ name: ['ordinary-person'], known_by: [], memory: 'ordinary-memory', time: '' }],
    entities: {}, createdAt: Date.now(), updatedAt: Date.now()
  });
  sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE.replayTimeline(ordinaryState));
  await sandbox.MEMORY_ENGINE.ingestWorldEvolution({
    layer: 20, worldDigest: 'Tóm lược thế giới-A', worldUpdate: { world_digest: 'Tóm lược thế giới-A' }, replace: false
  });
  let state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.event_memory.small_summaries.length, 1);
  assert.strictEqual(state.event_memory.small_summaries[0].content, 'Tóm lược thế giới-A');
  assert.strictEqual(state.event_memory.small_summaries[0].source, 'world_engine');
  assert.strictEqual(state.event_memory.big_summaries[0].content, 'Tổng thuật-A');
  assert.ok(JSON.stringify(state).includes('phiên bản-A'));

  assert.strictEqual(state.event_memory.small_summaries[0].sourceKey, 'world-link-test:20');
  assert.ok(state.timeline.nodes.some(node =>
    node.kind === 'world_link' && node.sourceKey === 'world-link-test:20'
  ));
  state.event_memory.small_summaries.push({
    id: 'small_ordinary', startLayer: 19, endLayer: 20,
    content: 'ordinary-summary-19-20', status: 'valid', revision: 1
  });
  sandbox.MEMORY_ENGINE_DATA.saveState(state);

  assert.strictEqual(sandbox.MEMORY_ENGINE._test.rollbackLinkedLayer(20), true);
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.ok(JSON.stringify(state).includes('ordinary-summary-19-20'));
  assert.ok(JSON.stringify(state).includes('ordinary'));
  version = 'B';
  await sandbox.MEMORY_ENGINE.ingestWorldEvolution({
    layer: 20, worldDigest: 'Tóm lược thế giới-B', worldUpdate: { world_digest: 'Tóm lược thế giới-B' }, replace: true
  });
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  const serialized = JSON.stringify(state);
  assert.ok(!serialized.includes('Tóm lược thế giới-A') && !serialized.includes('phiên bản-A') && !serialized.includes('Tổng thuật-A'),
    'Sau khi reroll ở cùng tầng, không được sót lại nhân vật, thực thể, bản ghi nhớ hay tổng thuật cũ');
  assert.ok(serialized.includes('Tóm lược thế giới-B') && serialized.includes('phiên bản-B') && serialized.includes('Tổng thuật-B'));
  assert.ok(serialized.includes('ordinary-summary-19-20') && serialized.includes('ordinary'));
  assert.strictEqual(state.event_memory.small_summaries.length, 2, 'Reroll chỉ được thay thế bản ghi nhớ tóm lược thế giới');
  assert.strictEqual(state.event_memory.big_summaries.length, 1, 'Tổng thuật bị ảnh hưởng phải được tính lại thay vì nối thêm');

  const items = Array.from({ length: 5 }, (_, index) => `Ký ức${index}`); // cũ → mới
  const newest = sandbox.MEMORY_ENGINE._test.exponentialMemorySample(items, 1, () => 0.5, 10000);
  assert.deepStrictEqual(Array.from(newest), ['Ký ức4'], 'Ở cùng một giá trị xúc xắc, trọng số mũ phải ưu tiên chọn ký ức mới nhất');
  let rollIndex = 0;
  const oldestWins = sandbox.MEMORY_ENGINE._test.exponentialMemorySample(
    items, 1, () => (rollIndex++ === 0 ? 0.9999 : 0), 10000
  );
  assert.deepStrictEqual(Array.from(oldestWins), ['Ký ức0'], 'Ký ức cũ nhất vẫn phải giữ cơ hội trúng khác 0 nhờ 1d10000');

  console.log('memory world link tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
