// Kiểm thử offline cho ký ức sự kiện: node docs/memory-event-summary-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const storeMap = new Map();
const calls = [];
const listeners = new Map();
const runningLabels = [];
const startSignals = [];
let memoryRefreshes = 0;
let injectionContent = '';
const settings = {
  engineEnabled: true,
  firstLayerIsAiOpening: true,
  evolveMode: 'auto',
  evolveEveryX: 2,
  evolveReadRounds: 2,
  manualReadRounds: 2,
  smallSummaryEveryX: 2,
  bigSummaryEveryX: 1,
  bigSummaryInjectLimit: 3,
  hideCoveredRawText: true,
  recentRawRounds: 3,
  referenceRawRounds: 0,
  referenceSmallSummaryCount: 4,
  referenceBigSummaryCount: 1,
  injectIntoWorldEngine: false,
  worldEngineMemoryLimit: 1,
  injectIntoPrompt: true,
  searchDepth: 5,
  maxPerCharacter: 20,
  maxTokens: 2000,
  temperature: 0.2,
  nameBlacklist: '',
  apiAutoRetries: 0,
  backfillBatchSize: 2,
  summaryBackfillSmallEveryX: 2,
  summaryBackfillBigEveryX: 1,
  backfillRetries: 0,
  backfillEndLayer: 0,
  filterRegex: ''
};
const chat = [
  { is_user: false, name: 'Nhân vật', mes: 'Đây là lời mở đầu của thẻ nhân vật, không được đưa vào tóm tắt hay điền lại hàng loạt.' },
  { is_user: true, name: 'Người dùng', mes: 'Tiến vào thị trấn.' },
  { is_user: false, name: 'Nhân vật', mes: 'Phát hiện cổng thành đã đóng.' },
  { is_user: true, name: 'Người dùng', mes: 'Hỏi lính canh.' },
  { is_user: false, name: 'Nhân vật', mes: 'Lính canh giải thích rằng phương Bắc đã xảy ra loạn.' }
];
const context = {
  chat,
  name1: 'Người dùng',
  name2: 'Nhân vật',
  setExtensionPrompt(_name, content) { injectionContent = content; },
  eventSource: { on(name, handler) { listeners.set(name, handler); } },
  event_types: { GENERATION_ENDED: 'generation_ended' }
};
const sandbox = {
  window: null,
  __WE_SetExternalStatus(text) { if (String(text).startsWith('Đang thực hiện')) startSignals.push('status'); },
  console,
  setTimeout,
  clearTimeout,
  AbortController,
  document: { getElementById() { return null; } },
  SillyTavern: { getContext() { return context; } },
  WORLD_ENGINE_STORE: {
    getItem(key) { return storeMap.has(key) ? storeMap.get(key) : null; },
    setItem(key, value) { storeMap.set(key, String(value)); },
    removeItem(key) { storeMap.delete(key); }
  },
  WORLD_ENGINE_CORE: {
    getChatId() { return 'summary-test'; },
    getChatLayer() { return chat.length - 1; },
    filterDialogue(value) { return value; }
  },
  WORLD_ENGINE_WORLDBOOK: { async buildPromptSection() { return ''; } },
  WORLD_ENGINE_CHATCACHE: { forScope() { return { afterEvolution() {}, createSnapshot() {} }; } },
  WORLD_ENGINE_UI: {
    setMemoryEvolvingUI(active, label) { if (active) { runningLabels.push(label); startSignals.push('ui'); } },
    refresh(auto) { if (auto === true) memoryRefreshes++; }
  },
  MEMORY_ENGINE_SETTINGS: { getSettings() { return { ...settings }; } },
  WORLD_ENGINE_API: {
    async callApi(prompt) {
      calls.push(prompt);
      const result = {};
      if (prompt.includes('"personal_memory": []')) {
        result.personal_memory = [{ name: ['Nhân vật'], known_by: [], memory: 'Nhân vật biết được rằng phương Bắc đã xảy ra loạn.', time: '' }];
        result.entity_updates = [];
      }
      if (prompt.includes('"small_summary": ""')) result.small_summary = 'Nhân vật phát hiện cổng thành đóng, và biết được từ lính canh rằng phương Bắc đã xảy ra loạn.';
      if (prompt.includes('"big_summary": ""')) result.big_summary = 'Sau khi đến thị trấn, nhân vật phát hiện cổng thành đóng, và biết được rằng loạn ở phương Bắc đang ảnh hưởng đến nơi này.';
      return JSON.stringify(result);
    }
  }
};
sandbox.window = sandbox;

for (const filename of [
  'memory-engine-data.js',
  'memory-engine-prompt.js',
  'memory-engine-small-summary-prompt.js',
  'memory-engine-big-summary-prompt.js',
  'memory-engine.js'
]) {
  vm.runInNewContext(fs.readFileSync(path.join(root, filename), 'utf8'), sandbox, { filename });
}

{
  const taskPrompt = sandbox.MEMORY_ENGINE_PROMPT.TASK_PROMPT;
  assert.ok(taskPrompt.includes('"memory": "Một ký ức chủ quan độc lập của nhân vật"'),
    'Tác vụ gộp nhân vật/thực thể phải giữ lại cấu trúc mục JSON không rỗng, không được chỉ trả về mảng rỗng');
  assert.ok(taskPrompt.includes('mỗi mục đều phải điền lại cùng giá trị time đó'),
    'Prompt gộp phải quy định rõ nhiều ký ức cùng thời điểm phải điền lại time cho từng mục');
  assert.ok(taskPrompt.includes('PersonalMemory chỉ được chứa name, known_by, memory, time.'));
  assert.ok(taskPrompt.includes('EntityUpdate chỉ được chứa type, name, aliases, description, event, time.'));
  assert.ok(taskPrompt.includes('Không được thêm trường cấp cao nhất ngoài mẫu xuất thống nhất'),
    'Prompt gộp phải giữ nguyên đầy đủ ràng buộc về trường và kiểu dữ liệu JSON');
  const sharedSummaryPrompt = sandbox.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.buildUserPrompt({
    startLayer: 3, endLayer: 4, conversation: 'Đoạn văn bản này không nên được đính kèm lại', reuseConversation: true
  });
  assert.ok(sharedSummaryPrompt.includes('Dùng lại 【Đoạn hội thoại cần trích xuất】'));
  assert.ok(!sharedSummaryPrompt.includes('Đoạn văn bản này không nên được đính kèm lại'),
    'Khi phạm vi nhân vật/thực thể và tóm tắt trùng nhau thì không được đính kèm lại nội dung cần xử lý');
  const engineSource = fs.readFileSync(path.join(root, 'memory-engine.js'), 'utf8');
  assert.ok(engineSource.includes('reuseConversation: sharesReference'),
    'Yêu cầu gộp phải truyền cờ tái sử dụng nội dung cùng phạm vi cho Prompt tóm tắt');
}

{
  const deletedTailState = sandbox.MEMORY_ENGINE_DATA.defaultState();
  deletedTailState.event_memory.small_summary_layer = 10;
  const changed = sandbox.MEMORY_ENGINE._test.rewindSummaryCursorForDeletedLayers(deletedTailState, {
    deletedLayers: new Set([7, 8, 9, 10])
  });
  assert.strictEqual(changed, true);
  assert.strictEqual(deletedTailState.event_memory.small_summary_layer, 6,
    'Sau khi xóa hai vòng bốn tầng, con trỏ tóm tắt phải lùi lại bốn tầng để vòng kế tiếp lập tức quay lại phạm vi chờ tổng hợp');
}

{
  const contextState = sandbox.MEMORY_ENGINE_DATA.defaultState();
  contextState.event_memory.small_summaries = Array.from({ length: 17 }, (_, index) => ({
    id: `small_${String(index + 1).padStart(6, '0')}`,
    startLayer: index * 2 + 1,
    endLayer: index * 2 + 2,
    content: `Tóm tắt ${index + 1}`,
    originChatId: 'summary-test',
    status: 'valid'
  }));
  contextState.event_memory.big_summaries = Array.from({ length: 3 }, (_, index) => ({
    id: `big_${String(index + 1).padStart(6, '0')}`,
    startLayer: index * 10 + 1,
    endLayer: index * 10 + 10,
    content: `Tổng thuật ${index + 1}`,
    childIds: contextState.event_memory.small_summaries
      .slice(index * 5, index * 5 + 5).map(item => item.id),
    originChatId: 'summary-test',
    status: 'valid'
  }));
  const history = sandbox.MEMORY_ENGINE._test.buildSmallHistoryContext(contextState, { startLayer: 35 });
  assert.deepStrictEqual(history.historyBigSummaries.map(item => item.content), ['Tổng thuật 2']);
  assert.deepStrictEqual(history.historySmallSummaries.map(item => item.content), ['Tóm tắt 14', 'Tóm tắt 15', 'Tóm tắt 16', 'Tóm tắt 17'],
    'Chuỗi tham khảo phải lấy theo thứ tự "tổng thuật trước đó → tóm tắt trước đó → vòng hiện tại", và phạm vi nội dung gốc giữa các tầng không được chồng lấn');
  const prompt = sandbox.MEMORY_ENGINE_SMALL_SUMMARY_PROMPT.buildUserPrompt({
    startLayer: 35,
    endLayer: 36,
    conversation: 'Nội dung người dùng vòng 18\nNội dung nhân vật vòng 18',
    ...history
  });
  assert.ok(prompt.includes('Tổng thuật 2') && prompt.includes('Tóm tắt 14') && prompt.includes('Tóm tắt 17'));
  assert.ok(prompt.includes('Nội dung người dùng vòng 18') && prompt.includes('Nội dung nhân vật vòng 18'),
    'Ngoài phần tham khảo lịch sử còn phải mang theo đầy đủ nội dung gốc của vòng hiện tại');

  const rawReference = sandbox.MEMORY_ENGINE._test.buildTaskReferenceContext(
    contextState,
    { startLayer: 3 },
    { ...settings, referenceRawRounds: 1, referenceSmallSummaryCount: 0, referenceBigSummaryCount: 0 }
  );
  assert.ok(rawReference.text.includes('Tiến vào thị trấn.') && rawReference.text.includes('Phát hiện cổng thành đã đóng.'),
    'Khi thêm một vòng tham khảo nội dung gốc phải mang theo cả input người dùng và phản hồi AI của vòng đó');
  assert.ok(!rawReference.text.includes('lời mở đầu của thẻ nhân vật'), 'Tham khảo nội dung gốc không được vô tình mang theo lời mở đầu AI đã bị bỏ qua');
}

{
  const longSmall = 'a'.repeat(201);
  const longBig = 'b'.repeat(2001);
  const lengthPrompt = sandbox.MEMORY_ENGINE_BIG_SUMMARY_PROMPT.buildUserPrompt({
    summaries: [{ content: 'c'.repeat(600) }, { content: 'd'.repeat(600) }]
  });
  assert.ok(lengthPrompt.includes('không quá 600 chữ'), 'Prompt tổng thuật phải ghi rõ giới hạn trên đã được tính toán cụ thể');
  assert.ok(!lengthPrompt.includes('tổng số chữ của toàn bộ nội dung các bản tóm tắt'), 'Prompt tổng thuật không nên để lộ tổng số chữ của các tóm tắt');
  assert.strictEqual(
    sandbox.MEMORY_ENGINE._test.parseResponse(JSON.stringify({ small_summary: longSmall }), { small: {} }).smallSummary,
    longSmall,
    'Khi tóm tắt vượt quá mục tiêu gợi ý của prompt vẫn phải được chấp nhận đầy đủ, không được cắt bớt hay từ chối'
  );
  assert.strictEqual(
    sandbox.MEMORY_ENGINE._test.parseResponse(JSON.stringify({ big_summary: longBig }), { big: {} }).bigSummary,
    longBig,
    'Khi tổng thuật vượt quá mục tiêu gợi ý của prompt vẫn phải được chấp nhận đầy đủ, không được cắt bớt hay từ chối'
  );
}

{
  settings.nameBlacklist = 'Nhân vật bị bỏ qua\nĐịa điểm bị cấm';
  const parsed = sandbox.MEMORY_ENGINE._test.parseResponse(JSON.stringify({
    personal_memory: [
      { name: ['Nhân vật bị bỏ qua', 'Biệt danh'], known_by: [], memory: 'Không nên được lưu.', time: '' },
      { name: ['Nhân vật được giữ lại'], known_by: [], memory: 'Nên được lưu.', time: '' }
    ],
    entity_updates: [
      { type: 'location', name: ' Địa điểm bị cấm ', description: 'Không nên được lưu.', event: '', time: '' },
      { type: 'object', name: 'Vật phẩm được giữ lại', description: 'Nên được lưu.', event: '', time: '' }
    ]
  }), { memory: {} });
  assert.strictEqual(JSON.stringify(parsed.personal.map(item => item.name)), JSON.stringify([['Nhân vật được giữ lại']]),
    'Khi bất kỳ tên nào của nhân vật trùng danh sách đen, chỉ được bỏ qua đúng bản ghi nhân vật đó');
  assert.strictEqual(parsed.entities.location.length, 0, 'Khi tên thực thể trùng danh sách đen, chỉ được bỏ qua đúng bản ghi thực thể đó');
  assert.strictEqual(JSON.stringify(parsed.entities.object.map(item => item.name)), JSON.stringify(['Vật phẩm được giữ lại']));
  settings.nameBlacklist = '';
}

{
  const messages = [
    { id: 'opening', is_user: false },
    { id: 'user-1', is_user: true }, { id: 'ai-1', is_user: false },
    { id: 'user-2', is_user: true }, { id: 'ai-2', is_user: false },
    { id: 'user-3', is_user: true }, { id: 'ai-3', is_user: false },
    { id: 'user-4', is_user: true }, { id: 'ai-4', is_user: false }
  ];
  const recent = sandbox.MEMORY_ENGINE._test.recentRawRoundMessageIds(
    messages,
    3,
    { firstLayerIsAiOpening: true },
    { ensureMessageId: message => message.id }
  );
  assert.deepStrictEqual([...recent], ['user-2', 'ai-2', 'user-3', 'ai-3', 'user-4', 'ai-4'],
    'Ba vòng gần nhất phải giữ lại cả input người dùng và phản hồi AI của từng vòng, chứ không chỉ giữ 3 tầng tin nhắn');
  const covered = messages.slice(1).map(message => ({
    chatId: 'summary-test', messageId: message.id
  }));
  covered.push({ chatId: 'other-chat', messageId: 'foreign-message' });
  const hidden = sandbox.MEMORY_ENGINE._test.selectHiddenMessageIds(
    covered,
    'summary-test',
    recent
  );
  assert.deepStrictEqual([...hidden], ['user-1', 'ai-1'],
    'Khi tóm tắt hợp lệ đã bao phủ nội dung, chỉ được ẩn các tin nhắn của cuộc trò chuyện hiện tại nằm ngoài ba vòng gần nhất');
  const recentOne = sandbox.MEMORY_ENGINE._test.recentRawRoundMessageIds(
    messages,
    1,
    { firstLayerIsAiOpening: true },
    { ensureMessageId: message => message.id }
  );
  assert.deepStrictEqual([...recentOne], ['user-4', 'ai-4'], 'Số vòng giữ lại nội dung gốc phải thay đổi linh hoạt theo giá trị cấu hình');
}

(async () => {
  {
    let hiddenWanted = null;
    sandbox.MEMORY_ENGINE_TIMELINE = {
      auditRefs(refs) {
        const changed = refs.some(ref => ref.hash !== 'edited');
        const updated = refs.map(ref => ({ ...ref, hash: 'edited' }));
        return {
          valid: !changed,
          changed: changed ? [{ before: refs[0], after: updated[0] }] : [],
          missing: [],
          refs: updated
        };
      },
      refsToConversation() { return '【Người dùng】Câu hỏi đã chỉnh sửa\n【Nhân vật】Câu trả lời đã chỉnh sửa'; },
      digestRefs() { return 'edited-digest'; },
      unionRefs(groups) { return groups.flat(); },
      syncHidden(ids) { hiddenWanted = [...ids]; return Promise.resolve(); }
    };
    const editedState = sandbox.MEMORY_ENGINE_DATA.defaultState();
    editedState.event_memory.small_summaries = [{
      id: 'small_000001', startLayer: 3, endLayer: 4, content: 'Tóm tắt trước khi chỉnh sửa', status: 'valid',
      sourceRefs: [
        { chatId: 'summary-test', messageId: 'floor-3', layer: 3, hash: 'old-3' },
        { chatId: 'summary-test', messageId: 'floor-4', layer: 4, hash: 'old-4' }
      ]
    }];
    sandbox.MEMORY_ENGINE_DATA.saveState(editedState);
    settings.hideCoveredRawText = false;
    sandbox.MEMORY_ENGINE.applyInjection();
    assert.deepStrictEqual(hiddenWanted, [], 'Sau khi tắt ẩn nội dung gốc phải khôi phục và giữ lại toàn bộ nội dung gốc');
    settings.hideCoveredRawText = true;
    calls.length = 0;
    await sandbox.MEMORY_ENGINE.prepareHistoryForGeneration();
    assert.strictEqual(calls.length, 0, 'Trước khi sinh chỉ được gỡ các tóm tắt không còn hiệu lực, không được gọi API nền');
    assert.strictEqual(
      sandbox.MEMORY_ENGINE_DATA.loadState().event_memory.small_summaries[0].status,
      'stale'
    );
    assert.deepStrictEqual(hiddenWanted, [], 'Trước khi sinh phải khôi phục nội dung gốc tầng 3, 4 vốn bị tóm tắt không còn hiệu lực che phủ');
    const animationStates = [];
    const originalSetMemoryEvolvingUI = sandbox.WORLD_ENGINE_UI.setMemoryEvolvingUI;
    sandbox.WORLD_ENGINE_UI.setMemoryEvolvingUI = (active, label) => {
      animationStates.push({ active, label, running: sandbox.MEMORY_ENGINE.isRunning() });
    };
    await sandbox.MEMORY_ENGINE.reconcileHistory();
    sandbox.WORLD_ENGINE_UI.setMemoryEvolvingUI = originalSetMemoryEvolvingUI;
    assert.strictEqual(calls.length, 1, 'Sau khi AI phản hồi, việc khắc phục lịch sử phải gọi một lần API khắc phục tóm tắt');
    assert.deepStrictEqual(animationStates, [
      { active: true, label: 'Đối soát ký ức lịch sử', running: true },
      { active: false, label: '', running: false }
    ], 'Trong lúc khắc phục lịch sử, isRunning phải luôn là true để quả cầu nổi tiếp tục hiển thị hiệu ứng đang chạy');
    calls.length = 0;
    sandbox.MEMORY_ENGINE_TIMELINE = undefined;
    sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE_DATA.defaultState());
  }

  const refreshesBeforeCombined = memoryRefreshes;
  const combined = await sandbox.MEMORY_ENGINE.manualSmallSummary();
  assert.strictEqual(calls.length, 2, 'Khi đạt ngưỡng phải tạo và lưu tóm tắt trước, sau đó mới yêu cầu tổng thuật độc lập');
  assert.ok(calls[0].includes('ghi chép sự kiện cho tiến trình thế giới'));
  assert.ok(!calls[0].includes('lời mở đầu của thẻ nhân vật'), 'Khi khởi tạo tóm tắt phải bỏ qua lời mở đầu AI ở tầng 0');
  assert.ok(calls[0].includes('phương Bắc đã xảy ra loạn'), 'Sau khi bỏ qua lời mở đầu vẫn phải đọc được phản hồi AI mới nhất trong cửa sổ');
  assert.ok(!calls[0].includes('biên soạn tổng thuật cho tiến trình thế giới'));
  assert.ok(!calls[0].includes('"personal_memory": []'), 'Khi chưa đến lượt tác vụ nhân vật/thực thể thì không được mang theo trường xuất nhân vật/thực thể');
  assert.ok(calls[1].includes('biên soạn tổng thuật cho tiến trình thế giới'));
  assert.ok(!calls[1].includes('tổng quan cốt truyện đã có'), 'Tổng thuật chỉ được đọc các tóm tắt của đợt này chưa được gộp');
  assert.ok(!calls[1].includes('ghi chép sự kiện cho tiến trình thế giới'));
  assert.ok(!calls[1].includes('【Đoạn Hội Thoại Mới Nhất】'), 'Tổng thuật lớn chỉ được đọc các tóm tắt đã lưu vào kho và các tổng thuật đã có từ trước');
  assert.deepStrictEqual(runningLabels.slice(0, 2), ['Tóm tắt', 'Tổng thuật']);
  assert.deepStrictEqual(startSignals.slice(0, 4), ['status', 'ui', 'status', 'ui'],
    'Thông báo ở đầu trang phải được cập nhật trước khi trạng thái chạy của quả cầu ký ức làm mới, nếu không sẽ xóa mất class hiệu ứng tự động');
  assert.strictEqual(combined.addedSmall, 1);
  assert.strictEqual(combined.updatedBig, 1);
  assert.strictEqual(memoryRefreshes, refreshesBeforeCombined + 2,
    'Sau khi tóm tắt và tổng thuật độc lập tiếp theo đều hoàn tất phân tích và lưu vào kho cục bộ, đều phải tự động làm mới bảng bộ nhớ');
  let state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.event_memory.small_summaries.length, 1);
  assert.strictEqual(state.event_memory.big_summary_cursor, 1);
  assert.strictEqual(state.event_memory.big_summaries.length, 1);
  const checkpointAfterCombined = sandbox.MEMORY_ENGINE_DATA.loadCheckpoint();
  assert.strictEqual(checkpointAfterCombined.event_memory.small_summaries.length, 0,
    'Tổng thuật theo chuỗi không được ghi đè checkpoint đã tạo trước yêu cầu tóm tắt');

  settings.firstLayerIsAiOpening = false;
  sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE_DATA.defaultState());
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.manualSmallSummary();
  assert.ok(calls[0].includes('lời mở đầu của thẻ nhân vật'), 'Sau khi tắt "tầng đầu là lời mở đầu AI", tầng 0 phải tham gia tóm tắt bình thường');
  settings.firstLayerIsAiOpening = true;

  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  state.personal_memory = [{ id: 'char_000001', names: ['Nhân vật được giữ lại'], memory: {}, }];
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
  calls.length = 0;
  runningLabels.length = 0;
  await sandbox.MEMORY_ENGINE.backfillSummaries();
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(state.personal_memory[0].names[0], 'Nhân vật được giữ lại', 'Việc điền lại tóm tắt/tổng thuật không được xóa nhân vật/thực thể');
  assert.ok(state.event_memory.small_summaries.length > 0);
  assert.strictEqual(state.event_memory.big_summaries.length, state.event_memory.small_summaries.length,
    'Khi mỗi đợt có một tóm tắt thì phải nối thêm tổng thuật theo từng đợt, không được cuộn ghi đè');

  const summaryBeforePersonBackfill = JSON.stringify(state.event_memory);
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.backfill();
  state = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(JSON.stringify(state.event_memory), summaryBeforePersonBackfill, 'Việc điền lại nhân vật/thực thể không được xóa tóm tắt/tổng thuật');
  assert.ok(state.personal_memory.some(item => item.names.includes('Nhân vật')));

  state.event_memory.big_summary_cursor = Math.max(0, state.event_memory.small_summaries.length - 1);
  sandbox.MEMORY_ENGINE_DATA.saveState(state);
  calls.length = 0;
  await sandbox.MEMORY_ENGINE.manualBigSummary();
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].includes('biên soạn tổng thuật cho tiến trình thế giới'));
  assert.ok(!calls[0].includes('ghi chép sự kiện cho tiến trình thế giới'), 'Tổng thuật thủ công chỉ nên mang theo Prompt tổng thuật');
  assert.ok(!calls[0].includes('"personal_memory": []'));

  const legacy = sandbox.MEMORY_ENGINE_DATA.defaultState();
  delete legacy.event_memory.big_summaries;
  legacy.event_memory.big_summary = { startLayer: 1, endLayer: 4, content: 'Tổng thuật cuộn kiểu cũ' };
  sandbox.MEMORY_ENGINE_DATA.saveState(legacy);
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadState().event_memory.big_summaries[0].content, 'Tổng thuật cuộn kiểu cũ',
    'Tổng thuật đơn kiểu cũ phải được tự động chuyển thành danh sách tổng thuật');

  const portable = sandbox.MEMORY_ENGINE_DATA.defaultState();
  portable.chatLayer = 99;
  portable.event_memory.small_summary_layer = 88;
  portable.event_memory.small_summaries = [
    { id: 'small_000001', startLayer: 1, endLayer: 2, content: 'Tóm tắt cũ 1' },
    { id: 'small_000002', startLayer: 3, endLayer: 4, content: 'Tóm tắt cũ 2' },
    { id: 'small_000003', startLayer: 5, endLayer: 6, content: 'Tóm tắt chưa được gộp' }
  ];
  const importedLongSummary = 'Người dùng gộp thủ công: ' + 'l'.repeat(700);
  portable.event_memory.big_summaries = [
    { id: 'big_000001', startLayer: 1, endLayer: 2, content: 'Tổng thuật cũ' },
    { id: 'big_000002', startLayer: 3, endLayer: 4, content: importedLongSummary }
  ];
  portable.event_memory.big_summary_cursor = 2;
  const imported = sandbox.MEMORY_ENGINE_DATA.importData({
    __memoryEngineData: true,
    chatId: 'another-chat',
    state: portable,
    checkpoint: portable
  });
  assert.strictEqual(imported.chatLayer, chat.length - 1, 'Tiến độ nhân vật/thực thể được import từ cuộc trò chuyện khác phải nối tiếp vào tầng cuối cùng hiện tại');
  assert.strictEqual(imported.event_memory.small_summary_layer, chat.length - 1, 'Tiến độ tóm tắt được import từ cuộc trò chuyện khác phải nối tiếp vào tầng cuối cùng hiện tại');
  assert.strictEqual(imported.event_memory.big_summary_cursor, 2, 'Con trỏ gộp tổng thuật phải tương ứng với tóm tắt được import, không được reset theo tầng chat');
  assert.strictEqual(imported.event_memory.big_summaries[1].content, importedLongSummary, 'Tổng thuật quá dài khi import JSON không được cắt bớt');
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadCheckpoint().chatLayer, chat.length - 1, 'Điểm lưu được import cũng phải được định vị lại theo cuộc trò chuyện hiện tại');

  settings.bigSummaryInjectLimit = 1;
  sandbox.MEMORY_ENGINE.applyInjection();
  assert.ok(injectionContent.includes(importedLongSummary), 'Phải tiêm đầy đủ tổng thuật mới nhất');
  assert.ok(!injectionContent.includes('Tổng thuật cũ'), 'Tổng thuật cũ vượt quá giới hạn không được tiêm');
  assert.ok(injectionContent.includes('Tóm tắt chưa được gộp'), 'Tóm tắt chưa được gộp không bị ảnh hưởng bởi giới hạn số lượng tổng thuật');
  settings.bigSummaryInjectLimit = 3;

  const latest = sandbox.MEMORY_ENGINE_DATA.defaultState();
  latest.personal_memory = [
    { id: 'char_000001', names: ['Giáp'], memory: { '': ['Giáp nắm giữ một bí mật.'] } },
    { id: 'char_000002', names: ['Ất'], memory: {} }
  ];
  const secretRecord = { ownerId: 'char_000001', time: '', memory: 'Giáp nắm giữ một bí mật.' };
  latest.knowledge_index = { 'giáp': [secretRecord], 'ất': [secretRecord] };
  latest.event_memory.small_summaries = Array.from({ length: 12 }, (_, index) => ({
    id: `small_${String(index + 1).padStart(6, '0')}`, startLayer: index * 2 + 1, endLayer: index * 2 + 2, content: `Tóm tắt ${index + 1}`
  }));
  latest.event_memory.big_summaries = [
    { id: 'big_000001', startLayer: 1, endLayer: 10, content: 'Tổng thuật một' },
    { id: 'big_000002', startLayer: 11, endLayer: 20, content: 'Tổng thuật hai' }
  ];
  latest.event_memory.big_summary_cursor = 10;
  latest.entity_memory.organization = [{
    id: 'org_000001', name: 'Thanh Thạch Minh', description: 'Kiểm soát các tuyến thương lộ của thành Thanh Thạch.',
    history: [{ time: 'hôm qua', event: 'Thanh Thạch Minh phong tỏa cổng Bắc.' }, { time: 'hôm nay', event: 'Thanh Thạch Minh bắt đầu kiểm tra người qua lại.' }]
  }];
  sandbox.MEMORY_ENGINE_DATA.saveState(latest);
  const oldCheckpoint = JSON.parse(JSON.stringify(latest));
  oldCheckpoint.event_memory.small_summaries = oldCheckpoint.event_memory.small_summaries.slice(0, 5);
  oldCheckpoint.event_memory.big_summaries = oldCheckpoint.event_memory.big_summaries.slice(0, 1);
  oldCheckpoint.event_memory.big_summary_cursor = 5;
  sandbox.MEMORY_ENGINE_DATA.saveCheckpoint(oldCheckpoint);
  const exported = sandbox.MEMORY_ENGINE_DATA.exportData();
  assert.strictEqual(exported.counts.state.minutes, 12, 'State trong JSON đầy đủ phải là tóm tắt hiện tại mới nhất');
  assert.strictEqual(exported.counts.state.overviews, 2, 'State trong JSON đầy đủ phải là tổng thuật hiện tại mới nhất');
  assert.strictEqual(exported.counts.checkpoint.minutes, 5, 'JSON đầy đủ phải đồng thời giữ lại và đánh dấu rõ số tóm tắt của checkpoint cũ');
  assert.strictEqual(exported.counts.checkpoint.overviews, 1, 'JSON đầy đủ phải đồng thời giữ lại và đánh dấu rõ số tổng thuật của checkpoint cũ');
  assert.strictEqual(JSON.stringify(exported.state.personal_memory[0].memories[0].known_by), JSON.stringify(['Ất']), 'Khi export trạng thái hiện tại phải khôi phục chỉ mục tri thức nội bộ thành known_by');
  assert.strictEqual(JSON.stringify(exported.checkpoint.personal_memory[0].memories[0].known_by), JSON.stringify(['Ất']), 'Khi export checkpoint cũng phải giữ lại known_by');
  const roundTripped = sandbox.MEMORY_ENGINE_DATA.importData(exported);
  assert.ok(roundTripped.knowledge_index['ất'].some(record => record.memory === 'Giáp nắm giữ một bí mật.'), 'Khi import JSON portable phải xây dựng lại knowledge_index');
  assert.strictEqual(sandbox.MEMORY_ENGINE_DATA.loadCheckpoint().event_memory.small_summaries.length, 5, 'Khi import JSON đầy đủ phải khôi phục checkpoint');
  sandbox.MEMORY_ENGINE.replaceKnownByRecords(roundTripped, 'char_000001', [
    { time: '', memory: 'Giáp nắm giữ một bí mật.', known_by: ['Bính'] }
  ]);
  assert.ok(!roundTripped.knowledge_index['ất'], 'Sau khi UI chỉnh sửa người biết chuyện phải xóa chỉ mục known_by cũ');
  assert.ok(roundTripped.knowledge_index['bính'].some(record => record.memory === 'Giáp nắm giữ một bí mật.'), 'Sau khi UI chỉnh sửa người biết chuyện phải tạo chỉ mục known_by mới');
  sandbox.MEMORY_ENGINE_DATA.saveState(roundTripped);
  settings.injectIntoWorldEngine = true;
  const worldMemory = sandbox.MEMORY_ENGINE.buildWorldEngineContext({
    factions: [{ name: 'Thanh Thạch Minh', core_person: 'Bính' }],
    world_digest: 'Thanh Thạch Minh đang truy lùng Bính.'
  });
  assert.ok(worldMemory.includes('Giáp nắm giữ một bí mật.'), 'Khi trạng thái thế giới trùng nhân vật, phải tiêm ký ức mà nhân vật đó biết');
  const injectedNewHistory = worldMemory.includes('Thanh Thạch Minh bắt đầu kiểm tra người qua lại.');
  const injectedOldHistory = worldMemory.includes('Thanh Thạch Minh phong tỏa cổng Bắc.');
  assert.ok(injectedNewHistory || injectedOldHistory, 'Khi trạng thái thế giới trùng thực thể, phải tiêm một mục lịch sử theo xác suất mũ');
  assert.notStrictEqual(injectedNewHistory, injectedOldHistory, 'Giới hạn xác suất tiêm cho mỗi mục khớp của World Engine phải có hiệu lực');
  assert.ok(!worldMemory.includes('Tóm tắt 1') && !worldMemory.includes('Tổng thuật một'), 'Khi tiêm vào World Engine không được mang theo tóm tắt hay tổng thuật');
  settings.injectIntoWorldEngine = false;
  assert.strictEqual(sandbox.MEMORY_ENGINE.buildWorldEngineContext({ factions: [{ name: 'Thanh Thạch Minh' }] }), '', 'Sau khi tắt tiêm chéo giữa các engine phải trả về nội dung rỗng');

  sandbox.MEMORY_ENGINE_DATA.saveState(sandbox.MEMORY_ENGINE_DATA.defaultState());
  calls.length = 0;
  runningLabels.length = 0;
  settings.evolveEveryX = 999;
  sandbox.MEMORY_ENGINE.init();
  let initializedState = sandbox.MEMORY_ENGINE_DATA.loadState();
  assert.strictEqual(initializedState.event_memory.small_summary_layer, chat.length - 1,
    'Khi lần đầu vào một cuộc trò chuyện đã có sẵn, chỉ được ghi nhận mốc tóm tắt hiện tại, không được coi hội thoại lịch sử là việc cần xử lý tự động');

  chat.push(
    { is_user: true, name: 'Người dùng', mes: 'Tiếp tục hỏi về tình hình trong thành.' },
    { is_user: false, name: 'Nhân vật', mes: 'Lính canh nói tạm thời không có thêm tin gì.' }
  );
  listeners.get('generation_ended')();
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.strictEqual(calls.length, 0, 'Sau khi vào cuộc trò chuyện đã có, nếu số vòng mới chưa đủ X thì không được tự động bổ sung tóm tắt lịch sử');

  chat.push(
    { is_user: true, name: 'Người dùng', mes: 'Chuẩn bị quay về quán trọ.' },
    { is_user: false, name: 'Nhân vật', mes: 'Nhân vật rời cổng thành và quay về quán trọ.' }
  );
  listeners.get('generation_ended')();
  await new Promise(resolve => setTimeout(resolve, 1600));
  assert.strictEqual(calls.length, 2, 'Chỉ khi đã đủ X vòng mới tính từ mốc vào cuộc trò chuyện thì mới tạo tóm tắt và tổng thuật độc lập');
  assert.ok(calls[0].includes('"small_summary": ""'));
  assert.ok(!calls[0].includes('"personal_memory": []'));
  assert.ok(!calls[0].includes('trình biên tập tổng thuật của ký ức sự kiện'));
  assert.ok(calls[1].includes('"big_summary": ""'));
  assert.ok(!calls[1].includes('"personal_memory": []'));
  assert.deepStrictEqual(runningLabels, ['Tóm tắt', 'Tổng thuật']);

  console.log('✓ Kiểm thử tóm tắt và tổng thuật của ký ức sự kiện đã thông qua');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
