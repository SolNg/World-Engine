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

// ===== Cập nhật một phần không được xoá dữ liệu cũ =====
// Lỗi đã gặp thật: prompt dặn mô hình "chỉ ghi phần THAY ĐỔI", nên lượt sau nó trả về nhân vật cũ
// mà không kèm significance/tier. Mã gộp quy về 0 rồi ghi đè, khiến nhân vật chính bị xoá điểm và
// tụt xuống ngoại vi ngay lượt sau khi tái xuất hiện.
{
  config.patchSettings({ significanceThreshold: 60 });
  const state = data.defaultState();

  engine.mergeExtraction(state, {
    npcs: [{
      name: 'Rias Gremory', aliases: ['Chủ tịch'], tier: 'core', significance: 95, present: true,
      location: { path: ['Nhật Bản', 'Kuoh', 'Học viện Kuoh'] },
      faction: { name: 'Gremory', role: 'chủ nhân' }
    }]
  }, 10);

  const before = data.findNpc(state, 'Rias Gremory');
  check('lần đầu ghi đúng điểm', before.significance === 95);
  check('lần đầu lên trọng yếu', before.tier === 'core');

  // Lượt sau mô hình chỉ báo thay đổi, không kèm significance/tier/aliases.
  engine.mergeExtraction(state, {
    npcs: [{ name: 'Rias Gremory', present: true, status: { condition: 'bị thương' } }]
  }, 11);

  const after = data.findNpc(state, 'Rias Gremory');
  check('thiếu significance thì GIỮ NGUYÊN điểm cũ', after.significance === 95);
  check('thiếu tier thì GIỮ NGUYÊN bậc cũ', after.tier === 'core');
  check('biệt danh không bị xoá', after.aliases.includes('Chủ tịch'));
  check('thế lực không bị xoá', after.faction?.name === 'Gremory');
  check('vị trí không bị xoá', after.location.path[2] === 'Học viện Kuoh');
  check('phần thật sự thay đổi thì vẫn được ghi', after.status.condition === 'bị thương');

  // Mô hình chấm lại thấp hơn ngưỡng thì phải hạ bậc — đó là quyết định có chủ ý, khác với bỏ trống.
  engine.mergeExtraction(state, {
    npcs: [{ name: 'Rias Gremory', tier: 'peripheral', significance: 20, present: true }]
  }, 12);
  const demoted = data.findNpc(state, 'Rias Gremory');
  check('mô hình chấm lại thấp thì hạ bậc thật', demoted.tier === 'peripheral');
  check('điểm mới được ghi nhận', demoted.significance === 20);

  // Ghim tay thì mô hình không đụng tới bậc được nữa.
  demoted.pinned = true;
  demoted.tier = 'core';
  engine.mergeExtraction(state, {
    npcs: [{ name: 'Rias Gremory', tier: 'peripheral', significance: 10, present: true }]
  }, 13);
  check('nhân vật được ghim thì mô hình không hạ bậc được',
    data.findNpc(state, 'Rias Gremory').tier === 'core');
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

// ===== Trần độ dài khối chèn =====
// Phần chèn của extension tính vào "prompt bắt buộc" của SillyTavern. Không có trần thì khối này
// phình theo số nhân vật nhân số sự kiện, và Tavern báo "Mandatory prompts exceed the context size"
// — lúc đó KHÔNG gửi được lượt nào, không phải chỉ là chèn thiếu.
{
  const state = data.defaultState();
  state.round = 9;
  for (let i = 1; i <= 10; i++) {
    const npc = data.upsertNpc(state, { name: 'Nhân Vật Số ' + i, tier: 'core', significance: 90 });
    npc.location.path = ['Quốc Gia', 'Vùng Đất Rất Dài Tên', 'Thành Phố Số ' + i];
    npc.location.userBelievesAt = 'Một nơi khác hẳn số ' + i;
    npc.location.movingTo = ['Quốc Gia', 'Vùng Khác', 'Đích Đến Số ' + i];
    npc.location.etaRounds = 4;
    npc.offscreenLog.push({ layer: 9, action: 'Làm một việc dài dòng số ' + i });
  }
  state.scene = { layer: 9, location: [], presentIds: state.npcs.map(npc => npc.id) };
  for (let i = 1; i <= 12; i++) engine.addPublicFact(state, 'Một sự thật công khai khá dài số ' + i, 9, 'sự kiện');
  for (let i = 1; i <= 8; i++) state.rumorQueue.push({ text: 'Một tin đồn dài dòng số ' + i, layer: 9 });

  const unlimited = engine.buildInjectionText(state, { ...baseSettings(), injectMaxChars: 0 }, {});
  check('không giới hạn thì khối chèn rất dài', unlimited.length > 1500);

  const capped = engine.buildInjectionText(state, { ...baseSettings(), injectMaxChars: 600 }, {});
  check('có trần thì không vượt quá trần', capped.length <= 600);
  check('vẫn giữ được tiêu đề', capped.includes('TRẠNG THÁI NHÂN VẬT NỀN'));
  // Bỏ từ dưới lên: tin đồn là chất liệu trang trí, ràng buộc vị trí là thứ AI dễ vi phạm nhất.
  check('ưu tiên giữ ràng buộc vị trí hơn tin đồn',
    capped.includes('Vị trí nhân vật') || !capped.includes('Tin đồn đang lan'));

  // Cắt là cắt từ dưới lên, nên ràng buộc cứng phải nằm trên cùng khối vị trí mới sống sót.
  check('ràng buộc cứng sống sót qua phép cắt',
    !capped.includes('Vị trí nhân vật') || capped.includes('Ràng buộc bắt buộc'));
  check('cắt theo ranh giới dòng, không đứt giữa câu',
    capped.split('\n').every(line => !line.endsWith(' ')));

  const info = engine.getLastInjectionInfo();
  check('báo cáo độ dài thực tế', info.length === capped.length);
  check('báo cáo trần đang áp dụng', info.maxChars === 600);
  check('báo cáo số khối đã bỏ', info.dropped > 0);

  // Trần chặt tới mức không giữ nổi khối nào thì vẫn phải trả về thứ gì đó, không được trả rỗng:
  // mất ràng buộc hoàn toàn tệ hơn ràng buộc bị cắt cụt.
  const tiny = engine.buildInjectionText(state, { ...baseSettings(), injectMaxChars: 120 }, {});
  check('trần cực chặt vẫn không trả về rỗng', tiny.length > 0);
  check('trần cực chặt vẫn tôn trọng trần', tiny.length <= 120);
}

// ===== Đối soát và chữa dữ liệu =====
// Sau nhiều lượt, dữ liệu tích tụ những chỗ không nhất quán mà không thao tác nào tự dọn:
// quan hệ trỏ tới người đã xoá, tri thức trỏ tới sự thật không còn, id trùng nhau.
{
  const state = data.defaultState();
  const a = data.upsertNpc(state, { name: 'Người Còn', tier: 'core', significance: 80 });
  const b = data.upsertNpc(state, { name: 'Người Mất', tier: 'core', significance: 70 });
  const fact = engine.addPublicFact(state, 'Một sự thật', 5, 'sự kiện');

  a.relations.npcs = [
    { id: b.id, name: 'Người Mất', type: 'đồng minh' },
    { id: 'npc:999', name: 'Không Tồn Tại', type: 'thù địch' }
  ];
  a.knowledge = [
    { fact: 'Một sự thật', source: 'nghe đồn', layer: 5, factId: fact.id },
    { fact: 'Trỏ vào hư không', source: 'suy đoán', layer: 5, factId: 'fact:404' }
  ];
  // Đánh dấu đã vào kho nhưng vẫn nằm ở danh sách hoạt động.
  b.status.archived = true;
  b.status.alive = false;
  state.scene = { layer: 5, location: [], presentIds: [a.id, 'npc:không-có'] };

  const fixed = engine.repairState(state);

  check('gỡ quan hệ trỏ tới nhân vật không tồn tại', fixed.danglingRelations === 1);
  check('giữ lại quan hệ hợp lệ',
    data.findNpc(state, 'Người Còn').relations.npcs.some(link => link.name === 'Người Mất'));
  check('gỡ liên kết tới sự thật đã biến mất', fixed.danglingFacts === 1);
  // Gỡ liên kết chứ không xoá nội dung: điều nhân vật biết vẫn là điều họ biết.
  check('không xoá nội dung tri thức', data.findNpc(state, 'Người Còn').knowledge.length === 2);
  check('giữ nguyên liên kết còn hợp lệ',
    data.findNpc(state, 'Người Còn').knowledge[0].factId === fact.id);
  check('chuyển người đánh dấu vào kho về đúng chỗ', fixed.misplacedArchive === 1);
  check('người đó nay nằm trong kho', state.archive.some(npc => npc.name === 'Người Mất'));
  check('lọc id không tồn tại khỏi danh sách có mặt',
    state.scene.presentIds.length === 1 && state.scene.presentIds[0] === a.id);

  // Chạy lần hai trên dữ liệu đã sạch thì không sửa gì nữa.
  const again = engine.repairState(state);
  check('chạy lại trên dữ liệu sạch thì không sửa gì',
    Object.values(again).every(value => value === 0));
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

  // Lỗi người dùng báo: dự định "ngay hôm nay" bị viết tiếp sau khi truyện đã nhảy ba ngày.
  // Mô hình cần biết đã trôi qua bao lâu GIỮA HAI LƯỢT, không chỉ tổng số ngày từ đầu truyện.
  const jumped = global.NPC_ENGINE_OFFSCREEN.buildPrompt({
    absentNpcs: [{
      name: 'NPC A', location: { path: ['Kuoh'] }, goals: [],
      pendingIntent: { action: 'Rủ NPC B đi ăn ngay hôm nay', etaRounds: 0, due: true, staleByTime: true }
    }],
    storyDay: 8, elapsedDays: 3, aggressiveness: 0.5
  });
  check('prompt nêu thời gian trôi qua giữa hai lượt', jumped.includes('đã trôi qua 3 ngày'));
  check('prompt cảnh báo dự định ngắn hạn đã xong hoặc bị bỏ',
    jumped.includes('dự định ngắn hạn của ngày cũ đều đã xong hoặc đã bị bỏ'));
  check('prompt nêu bật dự định lỗi thời', jumped.includes('ĐÃ LỖI THỜI'));
  check('prompt cấm viết như đang diễn ra', jumped.includes('không được viết như đang diễn ra'));
  check('có quy tắc riêng cho dự định đang treo',
    jumped.includes('THỜI GIAN VÀ DỰ ĐỊNH ĐANG TREO'));

  const sameDay = global.NPC_ENGINE_OFFSCREEN.buildPrompt({
    absentNpcs: [{ name: 'NPC A', location: { path: [] }, goals: [] }],
    storyDay: 3, elapsedDays: 0, aggressiveness: 0.5
  });
  check('cùng ngày thì báo thời gian gần như chưa nhích',
    sameDay.includes('thời gian truyện gần như chưa nhích'));
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

  // ===== Lịch chạy độc lập =====
  // Lỗi đã gặp thật: engine không có bộ hẹn giờ riêng, chỉ bám vào performEvolution của Công Cụ
  // Thế Giới. Thế Giới để chế độ thủ công hoặc bị tắt là hồ sơ nhân vật đứng im mà không báo gì.
  {
    const source = fs.readFileSync(path.join(root, 'npc-engine.js'), 'utf8');
    check('có bộ hẹn giờ chạy tự động riêng', source.includes('function runAutoExtraction('));
    check('có bám sự kiện sinh xong của Tavern',
      /GENERATION_ENDED \|\| types\.MESSAGE_RECEIVED/.test(source));
    check('tôn trọng chế độ thủ công', /st\.evolveMode === 'manual'/.test(source));
    check('tự dựng được hội thoại khi chạy độc lập', source.includes('function buildDialogueText('));

    // Hai đường dẫn tới cùng một luồng, phải chống chạy hai lần cho cùng một tin nhắn.
    check('có khoá tin nhắn chống chạy trùng', source.includes('lastProcessedKey'));
    check('luồng chính ghi khoá sau khi chạy xong',
      /lastProcessedKey = messageKeyOf\(ctx, chat, lastMsg\)/.test(source));
    check('bộ hẹn giờ bỏ qua tin nhắn đã xử lý',
      /if \(lastProcessedKey === expectedKey\) return;/.test(source));
    // Hoạt động ngầm cần worldDigest của lượt này, nên phải chờ Thế Giới gọi API xong đã.
    check('chờ Công Cụ Thế Giới chạy xong trước khi tự chạy',
      /WORLD_ENGINE_EVOLUTION\?\.isRunning\?\.\(\) === true/.test(source));
    check('chờ có giới hạn, hết hạn thì vẫn chạy', /autoRetries < AUTO_MAX_RETRIES/.test(source));

    // Triệu chứng "phải đóng bảng đi mới thấy": chạy xong không làm mới giao diện.
    check('chạy xong thì làm mới bảng điều khiển',
      /WORLD_ENGINE_UI\?\.refresh\?\.\(true\)/.test(source));
    // Gặp tác vụ đang chạy thì hẹn lại, không bỏ cuộc: tác vụ kia có thể thất bại giữa chừng.
    check('gặp tác vụ đang chạy thì hẹn lại chứ không bỏ cuộc',
      /if \(running\) \{[\s\S]{0,240}setTimeout\(\(\) => runAutoExtraction\(expectedKey\)/.test(source));

    // Báo trạng thái: không có thì engine là hộp đen, mọi trục trặc trông giống nhau.
    check('có hàm báo trạng thái', source.includes('function setStatus('));
    check('báo qua đường trạng thái dùng chung', source.includes('window.__WE_SetExternalStatus'));
    check('báo lúc bắt đầu trích xuất', source.includes("setStatus('Đang trích xuất nhân vật...')"));
    check('báo lúc bắt đầu hoạt động ngầm', /setStatus\(`Đang suy diễn hoạt động ngầm/.test(source));
    check('báo lúc hoàn tất kèm số liệu', /setStatus\('Hoàn tất — ' \+ summary\)/.test(source));
    check('báo lỗi khi thất bại', /setStatus\('Thất bại: '[\s\S]{0,60}true\)/.test(source));
    check('có bảng lý do bỏ qua', source.includes('SKIP_REASONS'));

    // Reroll hoặc sửa rồi gửi lại qua đường chạy tự động: tầng này đã xử lý rồi nên phải dựng lại
    // từ điểm lưu. Trước đây đường này luôn truyền replace: false, nên nhân vật của lần sinh bị bỏ
    // vẫn nằm nguyên trong hồ sơ — đúng lỗi người dùng báo.
    check('đường tự động nhận ra tầng đã xử lý',
      /const replace = stateLayer !== null && asLayer\(layer\) !== null && Number\(layer\) <= stateLayer/.test(source));
    check('không còn truyền cứng replace: false', !/replace: false/.test(source));

    // Chữ chạy trên banner là chưa đủ: người dùng không nhìn banner sẽ tưởng engine chết.
    // Quả cầu phải xoay và nút dừng phải hiện ra, giống hệt khi Công Cụ Thế Giới chạy.
    check('có báo cho quả cầu khi trạng thái chạy đổi', source.includes('function notifyBusyChanged('));
    check('báo qua đường dùng chung của giao diện',
      /WORLD_ENGINE_UI\?\.refreshBallControls\?\.\(\)/.test(source));
    check('báo lúc bắt đầu chạy',
      /abortController = new AbortController\(\);[\s\S]{0,80}notifyBusyChanged\(\);/.test(source));
    check('báo lúc kết thúc, kể cả khi lỗi',
      /abortController = null;[\s\S]{0,40}notifyBusyChanged\(\);/.test(source));
    check('bấm dừng thì phản hồi ngay', /function abort\(\)[\s\S]{0,220}notifyBusyChanged\(\);/.test(source));

    // Mọi thông báo trạng thái đều đi qua setBallState, mà hàm đó xoá lớp xoay ở đầu.
    // Không dựng lại theo isRunning thì chính thông báo tiến độ lại dập tắt hoạt ảnh.
    const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
    check('giao diện xuất ra đường làm mới nút quả cầu',
      /refreshBallControls: \(\) => updateBallControls\(\)/.test(ui));
    check('setBallState dựng lại trạng thái chạy ở cuối hàm',
      /we-ball-counting', cur > 0 && cur < total\)[\s\S]{0,700}updateBallControls\(\);/.test(ui));
  }

  // ===== Chạy xong phải báo số liệu thật =====
  {
    global.WORLD_ENGINE_API.callApi = async () => JSON.stringify({
      scene: { presentNames: [] },
      npcs: [{ name: 'Nhân Vật Mới', tier: 'core', significance: 90, present: true }],
      activities: []
    });
    global.WORLD_ENGINE_WORLDBOOK = { buildPromptSection: async () => '' };
    storage.clear();
    config.patchSettings({ engineEnabled: true, offscreenEnabled: false });

    const result = await engine.ingestWorldEvolution({ layer: 40, dialogue: 'x', worldDigest: 'y' });
    check('kết quả kèm tóm tắt bằng lời', typeof result.message === 'string' && result.message.length > 0);
    check('tóm tắt nêu số nhân vật mới', result.message.includes('1 mới'));
    check('tóm tắt nêu số nhân vật trọng yếu', result.message.includes('1 trọng yếu'));

    // Gọi chồng lên nhau thì báo "bỏ qua" kèm lý do, không phải "thất bại".
    config.patchSettings({ engineEnabled: false });
    const skipped = await engine.ingestWorldEvolution({ layer: 41, dialogue: 'x' });
    check('bị tắt thì báo bỏ qua', skipped.skipped === true && skipped.reason === 'disabled');
    check('bỏ qua có kèm lý do bằng lời', typeof skipped.message === 'string' && skipped.message.length > 0);
    config.patchSettings({ engineEnabled: true });
  }

  // ===== Điền lại hàng loạt =====
  // Cài extension giữa chừng chat dài thì quá khứ nằm ngoài tầm với: engine chỉ đi tới từ lúc bật.
  {
    const chat = [];
    chat.push({ is_user: false, name: 'Nhân vật', mes: 'Lời mở đầu do thẻ nhân vật viết sẵn.' });
    for (let i = 1; i <= 6; i++) {
      chat.push({ is_user: true, name: 'Người chơi', mes: 'Người chơi nói câu số ' + i });
      chat.push({ is_user: false, name: 'Nhân vật', mes: 'Nhân vật đáp câu số ' + i });
    }
    global.SillyTavern = {
      getContext: () => ({ chat, eventSource: { on() {} }, event_types: {}, setExtensionPrompt(_n, c) { injected = c; } })
    };

    const prompts = [];
    global.WORLD_ENGINE_API.callApi = async prompt => {
      prompts.push(prompt);
      return JSON.stringify({
        scene: { presentNames: [] },
        npcs: [{ name: 'Nhân Vật Quá Khứ ' + prompts.length, tier: 'core', significance: 80, present: true }]
      });
    };
    global.WORLD_ENGINE_WORLDBOOK = { buildPromptSection: async () => '' };

    storage.clear();
    config.patchSettings({
      engineEnabled: true, backfillBatchSize: 2, backfillEndLayer: 0,
      firstLayerIsAiOpening: true, significanceThreshold: 60
    });

    // Có sẵn dữ liệu cũ để kiểm chứng việc dựng lại từ đầu.
    const before = data.defaultState();
    data.upsertNpc(before, { name: 'Nhân Vật Cũ', tier: 'core', significance: 90 });
    data.setTravel(before, 'A', 'B', { etaRounds: 7, travelMode: 'ngựa' });
    data.saveState(before);

    const result = await engine.backfill();
    check('điền lại chạy được', result && result.skipped !== true);
    check('điền lại chạy tới cùng', result.finished === true);
    // 6 tầng AI (bỏ tầng 0 vì là lời mở đầu), mỗi đợt 2 tầng → 3 đợt.
    check('chia đúng số đợt theo cấu hình', result.batches === 3);
    check('mỗi đợt một lượt gọi API', prompts.length === 3);

    const after = data.loadState();
    check('hồ sơ cũ bị xoá sạch trước khi dựng lại',
      data.findNpc(after, 'Nhân Vật Cũ') === null);
    check('dựng được nhân vật từ quá khứ', after.npcs.length === 3);
    // Bộ nhớ đệm tuyến đường là hiểu biết về địa lý, không phải trạng thái chat — phải giữ lại.
    check('giữ lại bộ nhớ đệm tuyến đường', data.getTravel(after, 'A', 'B')?.etaRounds === 7);
    check('lưu điểm lưu trước khi xoá',
      data.findNpc(data.loadCheckpoint(), 'Nhân Vật Cũ') !== null);

    const status = engine.getBackfillStatus();
    check('báo cáo tiến độ đầy đủ', status.current === 3 && status.total === 3);
    check('báo cáo đã dừng chạy', status.running === false);

    // Không có tầng AI nào thì báo rõ, không chạy suông.
    global.SillyTavern = {
      getContext: () => ({ chat: [{ is_user: true, mes: 'chỉ có người chơi' }], eventSource: { on() {} }, event_types: {}, setExtensionPrompt() {} })
    };
    const empty = await engine.backfill();
    check('không có tầng AI thì báo bỏ qua', empty.skipped === true && empty.reason === 'empty');
  }

  if (failures > 0) {
    console.error(`npc-engine logic tests FAILED (${failures} lỗi)`);
    process.exit(1);
  }
  console.log('npc-engine logic tests passed');
})().catch(error => {
  console.error('npc-engine logic tests FAILED:', error);
  process.exit(1);
});
