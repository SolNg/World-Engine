// Kiểm thử phần lõi của Công Cụ Nhân Vật: gộp trích xuất, hoạt động ngầm, và bốn khối chèn.
// Không chạm API — mọi hàm được kiểm ở đây đều thuần, nhận trạng thái trả trạng thái/chuỗi.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = new Map();
let injected = '';

global.window = global;
global.document = { getElementById: () => null };
global.SillyTavern = {
  getContext: () => ({
    chat: [],
    eventSource: { on() {} },
    event_types: {},
    setExtensionPrompt: (_name, content) => { injected = content; }
  })
};
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
global.WORLD_ENGINE_CORE = {
  getChatId: () => 'chat-logic',
  getChatLayer: () => 20,
  getLastStoryDay: () => 42
};
global.WORLD_ENGINE_API = { callApi: async () => '{}', parseJSON: raw => JSON.parse(raw) };

for (const file of ['npc-engine-settings.js', 'npc-engine-data.js', 'npc-engine-prompt.js',
                    'npc-engine-offscreen.js', 'npc-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

const data = global.NPC_ENGINE_DATA;
const engine = global.NPC_ENGINE;
const config = global.NPC_ENGINE_SETTINGS;

let failures = 0;
function check(label, condition) {
  if (condition) return;
  failures += 1;
  console.error('  ✗ ' + label);
}

const baseSettings = () => config.getSettings(true);

// ===== Bộ lọc 3 bậc khi trích xuất =====
{
  config.patchSettings({ significanceThreshold: 60, npcCoreLimit: 12 });
  const state = data.defaultState();

  engine.mergeExtraction(state, {
    scene: { location: ['Đại Chu', 'Giang Nam', 'Dương Châu'], presentNames: ['Lý Mộ Bạch'] },
    npcs: [
      { name: 'Lý Mộ Bạch', tier: 'core', significance: 85, present: true,
        location: { path: ['Đại Chu', 'Giang Nam', 'Dương Châu', 'Túy Tiên lâu'] },
        knowledge: [{ fact: 'Người chơi mang kiếm gãy', source: 'chứng kiến' }] },
      { name: 'Vương Nhị', tier: 'core', significance: 30, present: true },
      { name: 'Trần Tam', tier: 'peripheral', significance: 20, present: false }
    ]
  }, 20);

  check('nhận đủ ba nhân vật', state.npcs.length === 3);
  check('điểm cao thì lên trọng yếu', data.findNpc(state, 'Lý Mộ Bạch').tier === 'core');
  check('mô hình đòi core nhưng dưới ngưỡng thì bị hạ',
    data.findNpc(state, 'Vương Nhị').tier === 'peripheral');
  check('ghi nhận ai có mặt trong cảnh',
    state.scene.presentIds.includes(data.findNpc(state, 'Lý Mộ Bạch').id));
  check('người vắng mặt không vào danh sách có mặt',
    !state.scene.presentIds.includes(data.findNpc(state, 'Trần Tam').id));
  check('tri thức được đóng dấu tầng',
    data.findNpc(state, 'Lý Mộ Bạch').knowledge[0].layer === 20);

  // Cộng dồn, không ghi đè, và không nhân bản khi lặp lại cùng một điều.
  engine.mergeExtraction(state, {
    npcs: [{ name: 'Lý Mộ Bạch', tier: 'core', significance: 85, present: true,
      knowledge: [
        { fact: 'Người chơi mang kiếm gãy', source: 'chứng kiến' },
        { fact: 'Thính Triều Các đang chiêu binh', source: 'nghe đồn' }
      ] }]
  }, 21);
  const lyMoBach = data.findNpc(state, 'Lý Mộ Bạch');
  check('tri thức cộng dồn qua các lượt', lyMoBach.knowledge.length === 2);
  check('không nhân bản tri thức đã có',
    lyMoBach.knowledge.filter(item => item.fact === 'Người chơi mang kiếm gãy').length === 1);
}

// ===== Cái chết =====
{
  const state = data.defaultState();
  engine.mergeExtraction(state, {
    scene: { presentNames: ['Lý Mộ Bạch'] },
    npcs: [
      { name: 'Lý Mộ Bạch', tier: 'core', significance: 85, present: true },
      { name: 'Trương Tam', tier: 'core', significance: 70, present: true }
    ]
  }, 20);

  engine.mergeExtraction(state, {
    npcs: [{ name: 'Lý Mộ Bạch', tier: 'core', significance: 85, present: true }],
    deaths: [{ name: 'Trương Tam', reason: 'trúng độc' }]
  }, 21);

  check('người chết vào kho', state.archive.some(npc => npc.name === 'Trương Tam'));
  check('người chết rời danh sách hoạt động', !state.npcs.some(npc => npc.name === 'Trương Tam'));
  check('cái chết thành sự thật công khai',
    state.publicFacts.some(fact => fact.kind === 'death' && fact.text.includes('Trương Tam')));

  const witness = data.findNpc(state, 'Lý Mộ Bạch');
  check('người có mặt lúc đó thì biết',
    witness.knowledge.some(item => item.fact.includes('Trương Tam') && item.source === 'chứng kiến'));
}

// ===== Hoạt động ngầm =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  npc.location.path = ['Đại Chu', 'Giang Nam', 'Dương Châu'];
  npc.location.userBelievesAt = 'Đại Chu › Giang Nam › Dương Châu';

  engine.applyOffscreen(state, {
    activities: [{
      name: 'Lý Mộ Bạch',
      action: 'Rời Dương Châu, lên đường về Trường An',
      visibility: 'công khai',
      becameRumor: true,
      rumorText: 'Nghe nói Lý đại hiệp đã rời Dương Châu',
      move: { to: ['Đại Chu', 'Quan Trung', 'Trường An'], etaRounds: 12, travelMode: 'cưỡi ngựa' },
      intent: { action: 'Tập kích kho lương', etaRounds: 2 },
      knowledgeGained: [{ fact: 'Quan đạo bị phong toả', source: 'chứng kiến' }]
    }]
  }, 22);

  const after = data.findNpc(state, 'Lý Mộ Bạch');
  check('ghi nhật ký hoạt động ngầm', after.offscreenLog.length === 1);
  check('đặt đích đến', after.location.movingTo[2] === 'Trường An');
  check('đặt số lượt còn lại', after.location.etaRounds === 12);
  check('chưa tới thì vị trí chưa đổi', after.location.path[2] === 'Dương Châu');
  check('sương mù bắt đầu tính từ tầng này', after.location.fogSince === 22);
  check('lưu dự định đang treo', after.pendingIntent.action === 'Tập kích kho lương');
  check('tri thức thu được cũng cộng vào',
    after.knowledge.some(item => item.fact === 'Quan đạo bị phong toả'));
  check('sinh tin đồn', state.rumorQueue.length === 1);
  check('tin đồn thành sự thật công khai',
    state.publicFacts.some(fact => fact.kind === 'tin đồn'));
  check('tuyến đường được ghi vào bộ nhớ đệm',
    data.getTravel(state, 'Đại Chu › Giang Nam › Dương Châu', 'Đại Chu › Quan Trung › Trường An')?.etaRounds === 12);

  // Người đã vào kho thì không hành động nữa.
  data.archiveNpc(state, 'Lý Mộ Bạch', 'đã chết');
  const result = engine.applyOffscreen(state, {
    activities: [{ name: 'Lý Mộ Bạch', action: 'Đứng dậy đi lại' }]
  }, 23);
  check('người trong kho không sinh hành động', result.acted.length === 0);
}

// ===== Khối chèn: che vị trí =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  npc.location.path = ['Đại Chu', 'Quan Trung', 'Trường An'];
  npc.location.userBelievesAt = 'Đại Chu › Giang Nam › Dương Châu';
  npc.location.movingTo = ['Đại Chu', 'Quan Trung', 'Trường An'];
  npc.location.etaRounds = 3;

  const off = engine.buildInjectionText(state, { ...baseSettings(), locationFogMode: 'off' }, {});
  check('chế độ off lộ vị trí thật', off.includes('Trường An'));

  const fog = engine.buildInjectionText(state, { ...baseSettings(), locationFogMode: 'fog' }, {});
  check('chế độ fog nói chỗ người chơi tưởng', fog.includes('Dương Châu'));
  check('chế độ fog có gợi ý mơ hồ', fog.includes('có tin đồn'));

  const strict = engine.buildInjectionText(state, { ...baseSettings(), locationFogMode: 'strict' }, {});
  check('chế độ strict không gợi ý gì', !strict.includes('có tin đồn'));
  check('chế độ strict vẫn nói chỗ người chơi tưởng', strict.includes('Dương Châu'));

  check('ràng buộc thời gian di chuyển luôn được phát',
    fog.includes('chưa thể có mặt') && fog.includes('còn 3 lượt'));
}

// ===== Khối chèn: ràng buộc tri thức =====
{
  const state = data.defaultState();
  const present = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  const absent = data.upsertNpc(state, { name: 'Vương Ngũ', tier: 'core', significance: 80 });
  const fact = engine.addPublicFact(state, 'Người chơi đã giết Trương Tam', 20, 'death');
  state.scene = { layer: 20, location: [], presentIds: [present.id] };

  const inScene = engine.buildInjectionText(state, { ...baseSettings(), knowledgeInjectScope: 'in-scene' }, {});
  check('phát ràng buộc cho người có mặt', inScene.includes('Lý Mộ Bạch CHƯA biết'));
  check('không phát cho người vắng mặt', !inScene.includes('Vương Ngũ CHƯA biết'));

  const all = engine.buildInjectionText(state, { ...baseSettings(), knowledgeInjectScope: 'all' }, {});
  check('phạm vi all phát cho cả người vắng mặt', all.includes('Vương Ngũ CHƯA biết'));

  const none = engine.buildInjectionText(state, { ...baseSettings(), knowledgeInjectScope: 'none' }, {});
  check('phạm vi none tắt hẳn khối này', !none.includes('CHƯA biết'));

  // Đã biết rồi thì không còn nằm trong danh sách chưa biết.
  present.knowledge.push({ fact: fact.text, source: 'nghe đồn', certainty: 'ngờ vực', layer: 21, factId: fact.id });
  const afterLearning = engine.buildInjectionText(state, { ...baseSettings(), knowledgeInjectScope: 'in-scene' }, {});
  check('biết rồi thì thôi ràng buộc', !afterLearning.includes('Lý Mộ Bạch CHƯA biết'));
}

// ===== Khối chèn: neo thời gian và công tắc =====
{
  const state = data.defaultState();
  state.round = 17;
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  npc.offscreenLog.push({ layer: 16, action: 'Rời Dương Châu' });

  const withAnchor = engine.buildInjectionText(state, baseSettings(), { storyDay: 42 });
  check('neo thời gian có ngày truyện', withAnchor.includes('ngày truyện thứ 42'));
  check('neo thời gian có số lượt', withAnchor.includes('lượt thứ 17'));
  check('neo thời gian có diễn biến nền', withAnchor.includes('Rời Dương Châu'));

  const noAnchor = engine.buildInjectionText(state, { ...baseSettings(), timeAnchorEnabled: false }, { storyDay: 42 });
  check('tắt được neo thời gian', !noAnchor.includes('Neo thời gian'));

  const nothing = engine.buildInjectionText(state, { ...baseSettings(), injectIntoPrompt: false }, {});
  check('tắt chèn thì không ra gì cả', nothing === '');

  const empty = engine.buildInjectionText(data.defaultState(), { ...baseSettings(), timeAnchorEnabled: false }, {});
  check('trạng thái rỗng thì không chèn khung rỗng', empty === '');
}

// ===== Nối ngược sang Công Cụ Thế Giới =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  npc.location.path = ['Đại Chu', 'Giang Nam', 'Dương Châu'];
  npc.faction = { name: 'Thanh Long hội', role: 'đường chủ', standing: 'đang lên' };
  npc.pendingIntent = { action: 'Tập kích kho lương', etaRounds: 2, layer: 20 };
  data.upsertNpc(state, { name: 'Quần Chúng', tier: 'peripheral', significance: 10 });
  data.saveState(state);

  config.patchSettings({ injectIntoWorldEngine: true, worldEngineNpcLimit: 8 });
  const context = engine.buildWorldEngineContext(state);
  check('đưa NPC trọng yếu sang thế giới', context.includes('Lý Mộ Bạch'));
  check('kèm dự định', context.includes('Tập kích kho lương'));
  check('không đưa NPC ngoại vi', !context.includes('Quần Chúng'));

  config.patchSettings({ injectIntoWorldEngine: false });
  check('tắt được chiều nhân vật → thế giới', engine.buildWorldEngineContext(state) === '');
  config.patchSettings({ injectIntoWorldEngine: true });
}

// ===== Chèn thật qua setExtensionPrompt =====
{
  const state = data.defaultState();
  state.round = 5;
  data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });
  data.saveState(state);

  injected = '';
  config.patchSettings({ engineEnabled: true, injectIntoPrompt: true });
  engine.applyInjection();
  check('có chèn nội dung vào prompt', injected.includes('TRẠNG THÁI NHÂN VẬT NỀN'));

  config.patchSettings({ engineEnabled: false });
  engine.applyInjection();
  check('tắt engine thì gỡ nội dung đã chèn', injected === '');
  config.patchSettings({ engineEnabled: true });
}

// ===== Prompt dựng được và không rỗng =====
{
  const state = data.defaultState();
  data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 85 });

  const extract = global.NPC_ENGINE_PROMPT.buildMessages({
    npcs: state.npcs, dialogue: 'Lý Mộ Bạch rút kiếm.', storyDay: 42
  });
  check('prompt trích xuất có hai vai', extract.length === 2 && extract[0].role === 'system');
  check('prompt trích xuất kèm hồ sơ hiện có', extract[1].content.includes('Lý Mộ Bạch'));
  check('prompt trích xuất nêu rõ quy tắc lọc quần chúng',
    extract[0].content.includes('lão chủ quán'));

  const offscreen = global.NPC_ENGINE_OFFSCREEN.buildMessages({
    absentNpcs: state.npcs, aggressiveness: 0.5, worldScale: 'tu tiên'
  });
  check('prompt hoạt động ngầm nêu thế giới quan', offscreen[1].content.includes('tu tiên'));
  check('prompt hoạt động ngầm dịch mức chủ động thành lời',
    offscreen[1].content.includes('Vừa phải'));
  check('prompt hoạt động ngầm đòi ước lượng số lượt',
    offscreen[0].content.includes('etaRounds'));
}

if (failures > 0) {
  console.error(`npc-engine logic tests FAILED (${failures} lỗi)`);
  process.exit(1);
}
console.log('npc-engine logic tests passed');
