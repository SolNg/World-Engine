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

  const extract = global.NPC_ENGINE_PROMPT.buildPrompt({
    npcs: state.npcs, dialogue: 'Lý Mộ Bạch rút kiếm.', storyDay: 42
  });
  check('prompt trích xuất là chuỗi', typeof extract === 'string');
  check('prompt trích xuất kèm hồ sơ hiện có', extract.includes('Lý Mộ Bạch'));
  check('prompt trích xuất nêu rõ quy tắc lọc quần chúng', extract.includes('lão chủ quán'));
  check('prompt trích xuất kèm hội thoại', extract.includes('Lý Mộ Bạch rút kiếm.'));

  const offscreen = global.NPC_ENGINE_OFFSCREEN.buildPrompt({
    absentNpcs: state.npcs, aggressiveness: 0.5, worldScale: 'tu tiên'
  });
  check('prompt hoạt động ngầm là chuỗi', typeof offscreen === 'string');
  check('prompt hoạt động ngầm nêu thế giới quan', offscreen.includes('tu tiên'));
  check('prompt hoạt động ngầm dịch mức chủ động thành lời', offscreen.includes('Vừa phải'));
  check('prompt hoạt động ngầm đòi ước lượng số lượt', offscreen.includes('etaRounds'));
}

// ===== Thứ thật sự gửi cho API =====
// Lỗi đã gặp thật khi chạy: callApi() nhận MỘT CHUỖI rồi tự bọc thành
// [{ role: 'user', content: prompt }]. Truyền mảng messages vào khiến content thành mảng object,
// API trả HTTP 400 "at least one contents field is required". Kiểm tra tĩnh không thấy được vì
// mã hoàn toàn hợp lệ — phải chạy thật luồng chính với API giả mới lộ ra.
(async () => {
  const calls = [];
  global.WORLD_ENGINE_API.callApi = async (prompt, maxTokens, temperature, signal, st) => {
    calls.push({ prompt, maxTokens, temperature, st });
    return JSON.stringify({
      scene: { location: ['Đại Chu', 'Giang Nam', 'Dương Châu'], presentNames: ['Lý Mộ Bạch'] },
      npcs: [{ name: 'Lý Mộ Bạch', tier: 'core', significance: 85, present: true }],
      activities: []
    });
  };

  storage.clear();
  config.patchSettings({
    engineEnabled: true, offscreenEnabled: true,
    apiUrl: 'https://vi-du.test/v1', model: 'test-model'
  });

  const first = await engine.ingestWorldEvolution({
    layer: 20, worldRound: 3,
    worldDigest: 'Thành Dương Châu vừa đổi chủ',
    dialogue: 'Lý Mộ Bạch rút kiếm.'
  });

  check('luồng chính chạy được, không bị bỏ qua', first && first.skipped !== true);
  check('có gọi API ít nhất một lần', calls.length >= 1);
  for (const call of calls) {
    check('prompt gửi cho API là CHUỖI, không phải mảng messages', typeof call.prompt === 'string');
    check('prompt gửi đi không rỗng', typeof call.prompt === 'string' && call.prompt.length > 50);
  }
  check('prompt kèm hội thoại của lượt này', calls[0]?.prompt.includes('Lý Mộ Bạch rút kiếm.'));
  check('prompt kèm tóm tắt thế giới vừa sinh ra', calls[0]?.prompt.includes('Thành Dương Châu vừa đổi chủ'));
  check('truyền đúng cấu hình riêng của NPC Engine', calls[0]?.st?.apiUrl === 'https://vi-du.test/v1');
  check('nhân vật trích xuất được ghi vào trạng thái',
    data.findNpc(data.loadState(), 'Lý Mộ Bạch') !== null);

  // ===== Sổ Tay Thế Giới phải tới được CẢ HAI pha =====
  // Bản trước chỉ đưa vào pha trích xuất. Nhưng pha sinh hoạt động ngầm mới là nơi cần nó nhất:
  // nhân vật quyết định làm gì thì phải biết luật lệ, thế lực và địa lý của thế giới này.
  {
    const scans = [];
    global.WORLD_ENGINE_WORLDBOOK = {
      buildPromptSection: async (scanText, scope) => {
        scans.push({ scanText, scope });
        return 'Trường An là kinh đô của Đại Chu, do Thanh Long hội nắm phần ngầm.';
      }
    };

    const prompts = [];
    global.WORLD_ENGINE_API.callApi = async prompt => {
      prompts.push(prompt);
      return JSON.stringify(prompts.length === 1
        ? {
            scene: { location: ['Đại Chu', 'Giang Nam', 'Dương Châu'], presentNames: [] },
            npcs: [{
              name: 'Lý Mộ Bạch', tier: 'core', significance: 90, present: false,
              location: { path: ['Đại Chu', 'Quan Trung', 'Trường An'] },
              faction: { name: 'Thanh Long hội', role: 'đường chủ' },
              goals: [{ text: 'Chiêu mộ tử sĩ', progress: 'đang tiến hành' }]
            }]
          }
        : { activities: [] });
    };

    storage.clear();
    config.patchSettings({ worldbookEnabled: true, offscreenEnabled: true });

    await engine.ingestWorldEvolution({ layer: 30, worldDigest: 'Kinh đô giới nghiêm', dialogue: 'Người chơi rời quán trọ.' });

    check('đọc Sổ Tay Thế Giới hai lần, mỗi pha một lần', scans.length === 2);
    check('luôn dùng phạm vi npc', scans.every(scan => scan.scope === 'npc'));
    check('pha trích xuất quét theo hội thoại', scans[0]?.scanText.includes('Người chơi rời quán trọ.'));
    // Hội thoại gần như vô dụng cho pha hai vì nhân vật đang vắng mặt — phải quét theo hồ sơ của họ,
    // nếu không thì mục lorebook về nơi họ đang tới sẽ không bao giờ được kích hoạt.
    check('pha hoạt động ngầm quét theo tên nhân vật vắng mặt', scans[1]?.scanText.includes('Lý Mộ Bạch'));
    check('pha hoạt động ngầm quét theo nơi nhân vật đang ở', scans[1]?.scanText.includes('Trường An'));
    check('pha hoạt động ngầm quét theo thế lực', scans[1]?.scanText.includes('Thanh Long hội'));
    check('pha hoạt động ngầm quét theo mục tiêu', scans[1]?.scanText.includes('Chiêu mộ tử sĩ'));

    check('tư liệu vào được prompt trích xuất', prompts[0]?.includes('Trường An là kinh đô của Đại Chu'));
    check('tư liệu vào được prompt hoạt động ngầm', prompts[1]?.includes('Trường An là kinh đô của Đại Chu'));
    check('prompt hoạt động ngầm buộc hành động phải khớp tư liệu',
      prompts[1]?.includes('Không được mâu thuẫn với tư liệu đã cho'));

    // Tắt công tắc thì không đọc nữa.
    scans.length = 0;
    config.patchSettings({ worldbookEnabled: false });
    await engine.ingestWorldEvolution({ layer: 31, worldDigest: 'x', dialogue: 'y' });
    check('tắt worldbookEnabled thì không đọc lorebook', scans.length === 0);
    config.patchSettings({ worldbookEnabled: true });
  }

  // Chốt ở tầng dưới cùng: nơi gọi có sai kiểu thì phải ném lỗi rõ ràng ngay,
  // thay vì để API trả HTTP 400 khó lần ra nguyên nhân.
  let threw = '';
  global.WORLD_ENGINE_API.callApi = async () => '{}';
  try {
    await engine.ingestWorldEvolution({ layer: 21, dialogue: 'x' });
  } catch (error) { threw = String(error?.message || error); }
  check('luồng chính không ném lỗi khi prompt hợp lệ', threw === '');

  if (failures > 0) {
    console.error(`npc-engine logic tests FAILED (${failures} lỗi)`);
    process.exit(1);
  }
  console.log('npc-engine logic tests passed');
})().catch(error => {
  console.error('npc-engine logic tests FAILED:', error);
  process.exit(1);
});
