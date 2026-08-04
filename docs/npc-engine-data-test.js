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

// ===== Nhân dạng bám theo chính văn =====
// Không khoá: chính văn tiết lộ khác thì hồ sơ đổi theo, như mọi trục khác. Cái KHÔNG được phép là
// im lặng biến thành xoá — prompt dặn mô hình chỉ ghi phần thay đổi, nên lượt nào nó không nhắc tới
// nhân dạng thì đó là "không có gì mới", không phải "xoá đi".
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Rias Gremory', tier: 'core' });

  let changed = data.mergeIdentity(npc, { gender: 'nữ', pronouns: 'cô ấy', species: 'Ác ma' });
  check('điền được vào ô trống', npc.identity.gender === 'nữ' && npc.identity.species === 'Ác ma');
  check('báo cáo đúng số ô vừa điền', changed.length === 3);

  // Chính văn nói khác thì ghi đè — người cải trang bị lột mặt nạ, nhân vật biến hình.
  changed = data.mergeIdentity(npc, { gender: 'nam', species: 'Thiên sứ', ageStage: 'thiếu niên' });
  check('chính văn nói khác thì đổi theo', npc.identity.gender === 'nam');
  check('đổi được cả chủng tộc', npc.identity.species === 'Thiên sứ');
  check('vẫn điền được ô còn trống', npc.identity.ageStage === 'thiếu niên');
  check('báo cáo đủ ba ô vừa đổi', changed.length === 3);

  // Gửi lại đúng giá trị cũ thì không tính là thay đổi.
  check('giá trị trùng thì không báo là đổi', data.mergeIdentity(npc, { gender: 'nam' }).length === 0);

  // Giá trị rỗng không xoá được thứ đã có.
  data.mergeIdentity(npc, { gender: '', pronouns: '   ' });
  check('chuỗi rỗng không xoá dữ liệu đã có', npc.identity.gender === 'nam' && npc.identity.pronouns === 'cô ấy');

  const described = data.describeIdentity(npc);
  check('mô tả nhân dạng gộp đủ các trường',
    described.includes('nam') && described.includes('cô ấy') && described.includes('Thiên sứ'));
  check('nhân vật chưa có nhân dạng thì mô tả rỗng',
    data.describeIdentity(data.upsertNpc(state, { name: 'Vô Danh' })) === '');

  // Lưu rồi đọc lại phải giữ nguyên.
  data.saveState(state);
  check('nhân dạng sống sót qua lưu/đọc',
    data.findNpc(data.loadState(), 'Rias Gremory').identity.species === 'Thiên sứ');
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

// ===== Đồng hồ thế giới =====
// Trục thời gian duy nhất, tính bằng phút truyện. Một lượt hội thoại không phải một đơn vị thời
// gian: nó chỉ là lúc quyết toán, còn đồng hồ nhích bao nhiêu là do chính văn quyết định.
{
  const state = data.defaultState();
  check('đồng hồ khởi đầu ở 0', data.clockMinutes(state) === 0);

  data.advanceClock(state, 90);
  check('nhích được theo phút', data.clockMinutes(state) === 90);
  data.advanceClock(state, 0);
  check('nhích 0 thì đứng yên', data.clockMinutes(state) === 90);
  data.advanceClock(state, -50);
  check('không lùi được về quá khứ', data.clockMinutes(state) === 90);

  check('hiển thị ngày giờ đọc được', data.formatClock(0) === 'Ngày 1, 00:00');
  check('đổi ngày đúng mốc', data.formatClock(data.MINUTES_PER_DAY) === 'Ngày 2, 00:00');
  check('hiển thị giờ phút đúng', data.formatClock(14 * 60 + 30) === 'Ngày 1, 14:30');

  // Quy đổi khoảng thời gian: nhận cả ba đơn vị để mô hình báo kiểu nào cũng được.
  check('quy đổi ngày', data.toMinutes({ days: 3 }) === 3 * data.MINUTES_PER_DAY);
  check('quy đổi giờ và phút', data.toMinutes({ hours: 2, minutes: 30 }) === 150);
  check('quy đổi hỗn hợp', data.toMinutes({ days: 1, hours: 1 }) === data.MINUTES_PER_DAY + 60);
  check('không có số liệu thì trả null', data.toMinutes({}) === null);
  check('không phải đối tượng thì trả null', data.toMinutes(null) === null);

  check('mô tả khoảng ngắn', data.describeDuration(25) === '25 phút');
  check('mô tả khoảng vài giờ', data.describeDuration(150) === '2 giờ 30 phút');
  check('mô tả khoảng nhiều ngày', data.describeDuration(3 * data.MINUTES_PER_DAY) === '3 ngày');
  check('mô tả khoảng gần như không nhích', data.describeDuration(0) === 'gần như chưa nhích');
}

// ===== Bốn kiểu hẹn =====
// Không phải việc gì cũng tiến theo cùng một cách. Rèn kiếm cần giờ NGỒI RÈN chứ không phải giờ
// trôi qua; cuộc hẹn thì tới đúng giờ mới xảy ra; chờ hồi âm thì không có hạn nào cả.
{
  const now = 1000;

  const natural = data.newSchedule({ mode: 'natural', dueAt: now + 120 });
  check('trôi tự nhiên: chưa tới hạn thì chưa đến', !data.isScheduleDue(natural, now));
  check('trôi tự nhiên: qua mốc thì đến hạn', data.isScheduleDue(natural, now + 120));

  const effort = data.newSchedule({ mode: 'effort', needMinutes: 300, doneMinutes: 100 });
  check('giờ công: chưa đủ công thì chưa xong', !data.isScheduleDue(effort, now + 99999));
  effort.doneMinutes = 300;
  check('giờ công: đủ công thì xong, bất kể đồng hồ', data.isScheduleDue(effort, 0));

  const scheduled = data.newSchedule({ mode: 'scheduled', dueAt: 5000 });
  check('hẹn giờ: chưa tới giờ thì chưa xảy ra', !data.isScheduleDue(scheduled, 4999));
  check('hẹn giờ: tới giờ thì xảy ra', data.isScheduleDue(scheduled, 5000));

  const conditional = data.newSchedule({ mode: 'conditional', condition: 'chờ hồi âm' });
  check('chờ điều kiện: không bao giờ tự đến hạn', !data.isScheduleDue(conditional, 999999));

  check('kiểu lạ thì quy về trôi tự nhiên', data.newSchedule({ mode: 'bịa' }).mode === 'natural');

  // Mô tả phải nói rõ còn thiếu gì, để nhìn vào hồ sơ là hiểu.
  check('mô tả giờ công nêu phần còn thiếu',
    data.describeSchedule(data.newSchedule({ mode: 'effort', needMinutes: 300, doneMinutes: 60 }), now)
      .includes('cần bỏ công thêm 4 giờ'));
  check('mô tả giờ công khi chưa bắt đầu thì nói rõ',
    data.describeSchedule(data.newSchedule({ mode: 'effort', needMinutes: 300 }), now).includes('chưa bắt đầu'));
  check('mô tả trôi tự nhiên nêu thời gian còn lại',
    data.describeSchedule(natural, now).includes('còn 2 giờ'));
  check('mô tả chờ điều kiện nêu điều kiện',
    data.describeSchedule(conditional, now).includes('chờ hồi âm'));
}

// ===== Dự định chạy theo đồng hồ, không theo lượt =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'NPC A', tier: 'core' });
  data.advanceClock(state, 600);   // 10 giờ truyện đã trôi

  npc.pendingIntent = {
    action: 'Đi ăn lòng nướng',
    schedule: data.newSchedule({ mode: 'natural', dueAt: 600 + 120 }),
    bornAt: 600
  };

  data.advanceClock(state, 60);
  let result = data.tickIntents(state, 60);
  check('chưa tới hạn thì chưa đánh dấu', !npc.pendingIntent.due && !result.due.length);

  data.advanceClock(state, 60);
  result = data.tickIntents(state, 60);
  check('tới hạn thì đánh dấu đến hạn', npc.pendingIntent.due === true);
  check('báo cáo danh sách đến hạn', result.due.includes(npc.id));

  // Cho đúng một lượt để mô hình kết lại; không kết thì bỏ.
  const expired = data.tickIntents(state, 30);
  check('đến hạn mà không được kết thì bị bỏ', npc.pendingIntent === null);
  check('báo cáo danh sách quá hạn', expired.expired.includes(npc.id));
}

// ===== Nhảy thời gian làm dự định ngắn hạn lỗi thời =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'NPC A', tier: 'core' });
  data.advanceClock(state, 500);

  // Hẹn tận một tuần nữa, nhưng đây là việc "hôm nay" — truyện nhảy qua ngày là nó hết ý nghĩa.
  npc.pendingIntent = {
    action: 'Rủ NPC B đi ăn ngay hôm nay',
    schedule: data.newSchedule({ mode: 'natural', dueAt: 500 + 7 * data.MINUTES_PER_DAY }),
    bornAt: 500
  };

  data.advanceClock(state, 3 * data.MINUTES_PER_DAY);
  data.tickIntents(state, 3 * data.MINUTES_PER_DAY);
  check('nhảy ngày thì đánh dấu lỗi thời dù chưa tới hạn hẹn', npc.pendingIntent.staleByTime === true);
  check('lỗi thời cũng tính là đến hạn', npc.pendingIntent.due === true);

  // Cùng ngày thì không đụng tới.
  const same = data.defaultState();
  const other = data.upsertNpc(same, { name: 'NPC C', tier: 'core' });
  data.advanceClock(same, 400);
  other.pendingIntent = {
    action: 'Việc trong ngày',
    schedule: data.newSchedule({ mode: 'natural', dueAt: 400 + 600 }),
    bornAt: 400
  };
  data.advanceClock(same, 120);
  data.tickIntents(same, 120);
  check('cùng ngày thì không đánh dấu lỗi thời', !other.pendingIntent.staleByTime);
  check('cùng ngày thì vẫn treo bình thường', other.pendingIntent.due !== true);
}

// ===== Giờ công chỉ tiến khi nhân vật thực sự làm =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Thợ Rèn', tier: 'core' });
  npc.pendingIntent = {
    action: 'Rèn Đoạn Triều Kiếm',
    schedule: data.newSchedule({ mode: 'effort', needMinutes: 600 }),
    bornAt: 0
  };

  data.tickIntents(state, 240);
  check('đang ở nhà thì công được cộng', npc.pendingIntent.schedule.doneMinutes === 240);

  // Lên đường thì không rèn được nữa.
  npc.location.movingTo = ['Đại Chu', 'Quan Trung', 'Trường An'];
  npc.location.arriveAt = 99999;
  data.tickIntents(state, 300);
  check('đang đi đường thì không cộng công', npc.pendingIntent.schedule.doneMinutes === 240);

  // Về tới nơi thì làm tiếp.
  npc.location.movingTo = null;
  npc.location.arriveAt = null;
  data.tickIntents(state, 400);
  check('về tới nơi thì làm tiếp', npc.pendingIntent.schedule.doneMinutes === 640);
  check('đủ công thì đến hạn', npc.pendingIntent.due === true);
}

// ===== Hành trình chạy theo đồng hồ =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core' });
  npc.location.path = ['Đại Chu', 'Giang Nam', 'Dương Châu'];
  npc.location.movingTo = ['Đại Chu', 'Quan Trung', 'Trường An'];
  npc.location.arriveAt = 12 * 60;    // 12 giờ đường

  data.advanceClock(state, 5 * 60);
  check('chưa tới giờ thì chưa tới nơi', data.tickTravel(state).length === 0);
  check('vị trí chưa đổi', npc.location.path[2] === 'Dương Châu');

  data.advanceClock(state, 7 * 60);
  check('đủ giờ thì tới nơi', data.tickTravel(state).includes(npc.id));
  check('vị trí cập nhật thành đích', npc.location.path[2] === 'Trường An');
  check('xoá mốc tới nơi', npc.location.arriveAt === null);

  // Dữ liệu cũ còn dùng etaRounds thì vẫn đếm lượt như trước.
  const legacy = data.defaultState();
  const old = data.upsertNpc(legacy, { name: 'Người Cũ', tier: 'core' });
  old.location.path = ['A'];
  old.location.movingTo = ['B'];
  old.location.etaRounds = 2;
  old.location.arriveAt = null;
  check('dữ liệu cũ: lượt đầu chưa tới', data.tickTravel(legacy).length === 0);
  check('dữ liệu cũ: trừ dần', old.location.etaRounds === 1);
  check('dữ liệu cũ: lượt sau thì tới', data.tickTravel(legacy).includes(old.id));
}

// ===== Đường lui khi không đọc được thời gian =====
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'NPC A', tier: 'core' });
  npc.pendingIntent = {
    action: 'Việc gì đó',
    schedule: data.newSchedule({ mode: 'effort', needMinutes: 100 }),
    bornAt: 0
  };
  // elapsedMinutes null: không có căn cứ nào từ chính văn.
  const result = data.tickIntents(state, null, { fallbackMinutes: 20 });
  check('không đọc được thời gian thì vẫn nhích một bước mặc định', result.elapsed === 20);
  check('công vẫn được cộng theo bước mặc định', npc.pendingIntent.schedule.doneMinutes === 20);
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

// ===== Sổ mâu thuẫn =====
// Bỏ khoá nhân dạng rồi thì con mắt người chơi là lớp bảo vệ duy nhất, mà mắt cần có cái để nhìn.
{
  const state = data.defaultState();
  check('trạng thái mới có sổ mâu thuẫn rỗng', Array.isArray(state.conflicts) && state.conflicts.length === 0);

  const record = data.recordConflict(state, {
    kind: data.CONFLICT_KINDS.IDENTITY, npcName: 'Liễu Như Yên',
    field: 'gender', from: 'nữ', to: 'nam', layer: 12, atMinutes: 480
  });
  check('ghi được mâu thuẫn', state.conflicts.length === 1);
  check('giữ cả giá trị cũ lẫn mới', record.from === 'nữ' && record.to === 'nam');
  check('giữ tầng và mốc đồng hồ', record.layer === 12 && record.atMinutes === 480);

  // Ghi vô hạn thì bản lưu phình ra mà chẳng ai đọc tới cuối.
  for (let i = 0; i < data.CONFLICT_LIMIT + 20; i++) {
    data.recordConflict(state, { kind: 'khác', field: 'x', from: String(i), to: String(i + 1) });
  }
  check('sổ có trần', state.conflicts.length === data.CONFLICT_LIMIT);
  check('bỏ mục cũ nhất, giữ mục mới nhất',
    state.conflicts[state.conflicts.length - 1].to === String(data.CONFLICT_LIMIT + 20));

  data.saveState(state);
  check('sổ sống sót qua lưu/đọc', data.loadState().conflicts.length === data.CONFLICT_LIMIT);
  // Đọc lại từ bản lưu cũ quá dài cũng phải bị cắt về đúng trần.
  storage.set('npc_engine_state_chat-test', JSON.stringify({ conflicts: new Array(500).fill({ kind: 'x' }) }));
  check('bản lưu cũ quá dài bị cắt về trần', data.loadState().conflicts.length === data.CONFLICT_LIMIT);

  const fresh = data.defaultState();
  data.recordConflict(fresh, { kind: 'khác' });
  data.clearConflicts(fresh);
  check('xoá được sổ', fresh.conflicts.length === 0);
}

// ===== mergeIdentity báo cả giá trị cũ =====
// Muốn ghi vào sổ mâu thuẫn thì phải biết nó vừa đè lên cái gì.
{
  const state = data.defaultState();
  const npc = data.upsertNpc(state, { name: 'Lý Mộ Bạch', tier: 'core' });
  const first = data.mergeIdentity(npc, { gender: 'nam' });
  check('lần điền đầu không có giá trị cũ', first[0].from === '' && first[0].to === 'nam');

  const second = data.mergeIdentity(npc, { gender: 'nữ' });
  check('lần đổi sau nêu đúng giá trị cũ', second[0].from === 'nam' && second[0].to === 'nữ');
  check('nêu đúng tên trường', second[0].field === 'gender');
}

// ===== Hàng chờ dấu vết =====
{
  const state = data.defaultState();
  check('trạng thái mới có hàng chờ dấu vết', Array.isArray(state.traceQueue));
  state.traceQueue.push({ text: 'Bùn ướt trên bậc thềm', layer: 4, at: ['Đại Chu', 'Dương Châu'], acknowledged: false });
  data.saveState(state);
  check('dấu vết sống sót qua lưu/đọc', data.loadState().traceQueue.length === 1);
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
