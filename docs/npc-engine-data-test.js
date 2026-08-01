// Kiểm thử tầng dữ liệu của Công Cụ Nhân Vật: bậc NPC, lùi tầng, kho lưu trữ, độ gần vị trí, đếm hành trình.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = new Map();

global.window = global;
global.document = { getElementById: () => null };
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
global.WORLD_ENGINE_CORE = { getChatId: () => 'chat-test' };

function load(file) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}

load('npc-engine-settings.js');
load('npc-engine-data.js');

const settings = global.NPC_ENGINE_SETTINGS;
const data = global.NPC_ENGINE_DATA;

let failures = 0;
function check(label, condition) {
  if (condition) return;
  failures += 1;
  console.error('  ✗ ' + label);
}

// ===== Cấu hình =====
{
  const defaults = settings.getSettings(true);
  check('mặc định che vị trí là fog', defaults.locationFogMode === 'fog');
  check('mặc định chỉ ràng buộc tri thức cho NPC trong cảnh', defaults.knowledgeInjectScope === 'in-scene');

  settings.patchSettings({ locationFogMode: 'không-tồn-tại', npcCoreLimit: 999, offscreenAggressiveness: 5 });
  const fixed = settings.getSettings(true);
  check('chế độ che sai được đưa về mặc định', fixed.locationFogMode === 'fog');
  check('npcCoreLimit bị kẹp trần', fixed.npcCoreLimit === 100);
  check('offscreenAggressiveness bị kẹp về 1', fixed.offscreenAggressiveness === 1);

  settings.patchSettings({ npcCoreLimit: 12, offscreenAggressiveness: 0.5 });
}

// ===== Độ gần vị trí =====
{
  const P = data.PROXIMITY;
  const duongChau = ['Đại Chu', 'Giang Nam', 'Dương Châu', 'Túy Tiên lâu'];
  check('trùng hết đường dẫn là cùng một chỗ',
    data.proximity(duongChau, duongChau) === P.SAME_SPOT);
  check('cùng thành khác điểm',
    data.proximity(duongChau, ['Đại Chu', 'Giang Nam', 'Dương Châu', 'bến đò']) === P.SAME_CITY);
  check('cùng vùng khác thành',
    data.proximity(duongChau, ['Đại Chu', 'Giang Nam', 'Tô Châu', 'chợ']) === P.SAME_REGION);
  check('khác vùng là xa',
    data.proximity(duongChau, ['Đại Chu', 'Quan Trung', 'Trường An']) === P.FAR);
  check('khác quốc gia là xa',
    data.proximity(duongChau, ['Bắc Địch', 'Thảo Nguyên', 'Vương Đình']) === P.FAR);
  check('đường dẫn rỗng là xa', data.proximity([], duongChau) === P.FAR);
}

// ===== Thêm mới và tra cứu =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, {
    name: 'Lý Mộ Bạch', aliases: ['Lý đại hiệp'], tier: 'core', significance: 80, lastSeenLayer: 17
  });
  check('id được cấp tự động', npc.id === 'npc:1');
  check('tra theo tên', data.findNpc(state, 'Lý Mộ Bạch')?.id === 'npc:1');
  check('tra theo biệt danh', data.findNpc(state, 'lý đại hiệp')?.id === 'npc:1');
  check('tra tên không tồn tại trả null', data.findNpc(state, 'Không Có Ai') === null);

  data.upsertNpc(state, { name: 'Lý Mộ Bạch', significance: 90 });
  check('cập nhật không tạo bản trùng', state.npcs.length === 1);
  check('cập nhật giữ nguyên id', state.npcs[0].id === 'npc:1');
  check('cập nhật ghi đè giá trị', state.npcs[0].significance === 90);
}

// ===== Trần NPC trọng yếu =====
{
  const state = data.defaultState();
  for (let i = 1; i <= 5; i++) {
    data.upsertNpc(state, { name: 'NPC ' + i, tier: 'core', lastSeenLayer: i });
  }
  data.upsertNpc(state, { name: 'Người Được Ghim', tier: 'core', lastSeenLayer: 0, pinned: true });

  const demoted = data.enforceCoreLimit(state, 3);
  const core = state.npcs.filter(npc => npc.tier === 'core');
  check('hạ bậc đủ số để về đúng trần', core.length === 3);
  check('NPC được ghim không bị hạ bậc dù cũ nhất',
    core.some(npc => npc.name === 'Người Được Ghim'));
  check('hạ bậc người lâu không xuất hiện nhất trước', demoted.length === 3);
  check('người mới xuất hiện nhất được giữ',
    core.some(npc => npc.name === 'NPC 5'));
}

// ===== Kho lưu trữ =====
{
  const state = data.defaultState();
  data.upsertNpc(state, { name: 'Trương Tam', tier: 'core', lastSeenLayer: 4 });
  data.upsertNpc(state, { name: 'Lý Tứ', tier: 'core', lastSeenLayer: 5 });

  data.archiveNpc(state, 'Trương Tam', 'trúng độc mà chết');
  check('NPC chết rời danh sách hoạt động', state.npcs.length === 1);
  check('NPC chết vào kho', state.archive.length === 1);
  check('đánh dấu đã chết', state.archive[0].status.alive === false);
  check('ghi lại nguyên nhân', state.archive[0].status.condition === 'trúng độc mà chết');
  check('vẫn tra cứu được sau khi chết', data.findNpc(state, 'Trương Tam') !== null);

  // Người đã chết không được tính vào trần, nếu không thì kho đầy sẽ chặn hết NPC sống.
  data.upsertNpc(state, { name: 'Vương Ngũ', tier: 'core', lastSeenLayer: 6 });
  const demoted = data.enforceCoreLimit(state, 2);
  check('NPC trong kho không tính vào trần', demoted.length === 0);

  data.reviveNpc(state, 'Trương Tam');
  check('sống lại thì rời kho', state.archive.length === 0);
  check('sống lại thì về danh sách hoạt động', state.npcs.some(npc => npc.name === 'Trương Tam'));
}

// ===== Lùi tầng =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core' });
  npc.knowledge = [
    { fact: 'Biết từ sớm', source: 'chứng kiến', layer: 5 },
    { fact: 'Biết ở tầng bị xoá', source: 'nghe đồn', layer: 12 },
    { fact: 'Không đóng dấu tầng', source: 'suy đoán' }
  ];
  npc.offscreenLog = [
    { layer: 5, action: 'Rời Dương Châu' },
    { layer: 12, action: 'Tới Trường An' }
  ];
  npc.pendingIntent = { action: 'Tập kích kho lương', etaRounds: 2, layer: 12 };
  state.rumorQueue = [{ text: 'tin cũ', layer: 5 }, { text: 'tin mới', layer: 12 }];

  data.rollbackToLayer(state, 10);
  const after = data.findNpc(state, 'Lý Mộ Bạch');
  check('giữ tri thức trước tầng lùi', after.knowledge.some(item => item.fact === 'Biết từ sớm'));
  check('bỏ tri thức từ tầng lùi trở đi', !after.knowledge.some(item => item.fact === 'Biết ở tầng bị xoá'));
  check('giữ bản ghi không đóng dấu tầng', after.knowledge.some(item => item.fact === 'Không đóng dấu tầng'));
  check('lọc cả nhật ký hoạt động ngầm', after.offscreenLog.length === 1);
  check('huỷ dự định sinh ở tầng bị bỏ', after.pendingIntent === null);
  check('lọc cả hàng đợi tin đồn', state.rumorQueue.length === 1);
  check('cập nhật lại số tầng', state.chatLayer === 10);
  check('báo cáo số bản ghi đã bỏ', state.lastRollback.dropped.knowledge === 1);
}

// ===== Lùi tầng phải xoá cả nhân vật sinh ra ở tầng đó =====
// Lỗi người dùng báo: reroll hoặc xoá lượt xong, nhân vật của lần sinh đã bỏ vẫn nằm nguyên trong
// hồ sơ. Nguyên nhân là rollbackToLayer chỉ lọc các trường cộng dồn BÊN TRONG từng nhân vật,
// không hề đụng tới danh sách nhân vật.
{
  const state = data.defaultState();
  const old = data.upsertNpc(state, { name: 'Người Có Từ Trước', tier: 'core', firstSeenLayer: 5 });
  const born = data.upsertNpc(state, { name: 'Người Của Lượt Bị Bỏ', tier: 'core', firstSeenLayer: 12 });
  const manual = data.upsertNpc(state, { name: 'Người Nhập Tay', tier: 'core' }); // không có firstSeenLayer

  old.relations.npcs = [{ id: born.id, name: 'Người Của Lượt Bị Bỏ', type: 'đồng minh' }];
  state.scene = { layer: 12, location: [], presentIds: [old.id, born.id] };

  data.rollbackToLayer(state, 10);

  check('xoá nhân vật xuất hiện lần đầu ở tầng bị bỏ', data.findNpc(state, 'Người Của Lượt Bị Bỏ') === null);
  check('giữ nhân vật có từ trước', data.findNpc(state, 'Người Có Từ Trước') !== null);
  // Người nhập tay hoặc từ lorebook không thuộc tầng nào, lùi tầng không được đụng tới.
  check('giữ nhân vật nhập tay không có dấu tầng', data.findNpc(state, 'Người Nhập Tay') !== null);
  check('gỡ quan hệ trỏ tới người vừa bị xoá',
    data.findNpc(state, 'Người Có Từ Trước').relations.npcs.length === 0);
  check('gỡ khỏi danh sách người có mặt', !state.scene.presentIds.includes(born.id));
  check('báo cáo số nhân vật đã xoá', state.lastRollback.dropped.npcs === 1);
}

// ===== Lùi tầng phải huỷ cả cái chết xảy ra ở tầng đó =====
{
  const state = data.defaultState();
  data.upsertNpc(state, { name: 'Người Chết Oan', tier: 'core', firstSeenLayer: 3 });
  data.archiveNpc(state, 'Người Chết Oan', 'bị đâm', 12);

  check('vào kho thì đóng dấu tầng', state.archive[0].status.archivedLayer === 12);

  data.rollbackToLayer(state, 10);

  check('cái chết ở tầng bị bỏ được huỷ', state.archive.length === 0);
  check('nhân vật trở lại danh sách hoạt động', data.findNpc(state, 'Người Chết Oan') !== null);
  check('đánh dấu còn sống trở lại', data.findNpc(state, 'Người Chết Oan').status.alive === true);
  check('xoá dấu tầng vào kho', data.findNpc(state, 'Người Chết Oan').status.archivedLayer === null);
  check('báo cáo số người được kéo lại', state.lastRollback.dropped.revived === 1);

  // Cái chết xảy ra TRƯỚC tầng lùi thì vẫn giữ nguyên.
  const older = data.defaultState();
  data.upsertNpc(older, { name: 'Người Chết Thật', tier: 'core', firstSeenLayer: 1 });
  data.archiveNpc(older, 'Người Chết Thật', 'trúng độc', 4);
  data.rollbackToLayer(older, 10);
  check('cái chết trước tầng lùi thì giữ nguyên', older.archive.length === 1);
}

// ===== Đếm hành trình =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core' });
  npc.location.path = ['Đại Chu', 'Giang Nam', 'Dương Châu'];
  npc.location.movingTo = ['Đại Chu', 'Quan Trung', 'Trường An'];
  npc.location.etaRounds = 2;
  npc.location.travelMode = 'cưỡi ngựa';

  check('chưa tới thì chưa đổi vị trí', data.tickTravel(state).length === 0);
  check('trừ đúng một lượt', npc.location.etaRounds === 1);

  const arrived = data.tickTravel(state);
  check('hết lượt thì báo đã tới', arrived.includes(npc.id));
  check('vị trí được cập nhật thành đích', npc.location.path[2] === 'Trường An');
  check('xoá đích sau khi tới', npc.location.movingTo === null);
  check('đếm thêm lượt nữa không đổi gì', data.tickTravel(state).length === 0);
}

// ===== Dự định đang treo phải đếm ngược và hết hạn =====
// Lỗi người dùng báo: NPC rủ nhau đi ăn "ngay hôm nay", ba ngày sau truyện vẫn viết cảnh họ đang
// ăn. Nguyên nhân là pendingIntent chỉ được đặt vào và đưa vào prompt mỗi lượt, không bao giờ
// bị trừ hay hết hạn — mô hình đọc thấy dòng đó thì viết tiếp cảnh đó.
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'NPC A', tier: 'core' });
  npc.pendingIntent = { action: 'Đi ăn lòng nướng', etaRounds: 2, layer: 5, storyDay: 3 };

  data.tickIntents(state, 3);
  check('còn hạn thì trừ dần', npc.pendingIntent.etaRounds === 1);
  check('chưa tới hạn thì chưa đánh dấu', !npc.pendingIntent.due);

  data.tickIntents(state, 3);
  check('trừ tiếp về 0', npc.pendingIntent.etaRounds === 0);

  const due = data.tickIntents(state, 3);
  check('hết lượt thì đánh dấu đến hạn', npc.pendingIntent.due === true);
  check('báo cáo danh sách đến hạn', due.due.includes(npc.id));

  // Cho đúng một lượt ở trạng thái đến hạn để mô hình kết lại; không kết thì bỏ.
  const expired = data.tickIntents(state, 3);
  check('đến hạn mà không được kết thì bị bỏ', npc.pendingIntent === null);
  check('báo cáo danh sách quá hạn', expired.expired.includes(npc.id));
}

// ===== Nhảy thời gian làm dự định ngắn hạn lỗi thời =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'NPC A', tier: 'core' });
  // Dự định còn tận 5 lượt nữa mới tới hạn đếm, nhưng truyện đã sang ngày khác.
  npc.pendingIntent = { action: 'Rủ NPC B đi ăn ngay hôm nay', etaRounds: 5, layer: 5, storyDay: 3 };

  data.tickIntents(state, 6);
  check('nhảy ngày thì đánh dấu lỗi thời dù còn hạn đếm', npc.pendingIntent.staleByTime === true);
  check('lỗi thời cũng tính là đến hạn', npc.pendingIntent.due === true);

  // Cùng ngày thì không đụng tới.
  const same = data.defaultState();
  const other = data.upsertNpc(same, { name: 'NPC C', tier: 'core' });
  other.pendingIntent = { action: 'Việc trong ngày', etaRounds: 3, layer: 5, storyDay: 4 };
  data.tickIntents(same, 4);
  check('cùng ngày thì không đánh dấu lỗi thời', !other.pendingIntent.staleByTime);
  check('cùng ngày thì vẫn trừ bình thường', other.pendingIntent.etaRounds === 2);

  // Không parse được ngày truyện thì chỉ đếm theo lượt, không suy đoán bừa.
  const noDay = data.defaultState();
  const third = data.upsertNpc(noDay, { name: 'NPC D', tier: 'core' });
  third.pendingIntent = { action: 'Việc gì đó', etaRounds: 2, layer: 5, storyDay: 3 };
  data.tickIntents(noDay, null);
  check('không có ngày truyện thì không đánh dấu lỗi thời', !third.pendingIntent.staleByTime);
}

// ===== Bộ nhớ đệm hành trình =====
{
  const state = data.defaultState();
  check('chưa có thì trả null', data.getTravel(state, 'Dương Châu', 'Trường An') === null);
  data.setTravel(state, 'Dương Châu', 'Trường An', { etaRounds: 12, travelMode: 'cưỡi ngựa' });
  const cached = data.getTravel(state, 'Dương Châu', 'Trường An');
  check('đọc lại đúng số lượt', cached.etaRounds === 12);
  check('đọc lại đúng phương tiện', cached.travelMode === 'cưỡi ngựa');
  check('chiều ngược lại là mục riêng', data.getTravel(state, 'Trường An', 'Dương Châu') === null);
}

// ===== Lưu trữ và điểm lưu =====
{
  const state = data.defaultState();
  data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core', significance: 80 });
  data.saveState(state);

  const reloaded = data.loadState();
  check('trạng thái đọc lại nguyên vẹn', reloaded.npcs.length === 1);
  check('trường lồng nhau còn nguyên', reloaded.npcs[0].status.alive === true);

  data.saveCheckpoint(reloaded);
  reloaded.npcs[0].significance = 10;
  data.saveState(reloaded);
  const checkpoint = data.loadCheckpoint();
  check('điểm lưu giữ giá trị trước khi sửa', checkpoint.npcs[0].significance === 80);
  check('vùng làm việc mang giá trị mới', data.loadState().npcs[0].significance === 10);

  data.clearCheckpoint();
  check('xoá được điểm lưu', data.loadCheckpoint() === null);
}

// ===== Dữ liệu hỏng =====
{
  storage.set('npc_engine_state_chat-test', '{ không phải JSON');
  const recovered = data.loadState();
  check('JSON hỏng thì quay về mặc định', Array.isArray(recovered.npcs) && recovered.npcs.length === 0);

  storage.set('npc_engine_state_chat-test', JSON.stringify({ npcs: 'không phải mảng', travelCache: 42 }));
  const repaired = data.loadState();
  check('kiểu sai được sửa thành mảng', Array.isArray(repaired.npcs));
  check('kiểu sai được sửa thành đối tượng', typeof repaired.travelCache === 'object');
}

if (failures > 0) {
  console.error(`npc-engine data tests FAILED (${failures} lỗi)`);
  process.exit(1);
}
console.log('npc-engine data tests passed');
