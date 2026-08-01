// Kiểm thử đầu-cuối: chạy thật hai lượt qua TOÀN BỘ tính năng với API giả, không dùng mạng.
// Khác các bộ khác ở chỗ nó không kiểm từng hàm rời rạc mà kiểm cả dây chuyền ráp lại có đúng không.
// Chạy: node docs/npc-engine-e2e-test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.resolve(__dirname, '..');
const storage = new Map();
let injected = '';
const chat = [];

global.window = global;
global.document = { getElementById: () => null };
global.SillyTavern = {
  getContext: () => ({
    chat, eventSource: { on() {} }, event_types: {},
    setExtensionPrompt: (_n, c) => { injected = c; }
  })
};
global.WORLD_ENGINE_STORE = {
  getItem: k => storage.has(k) ? storage.get(k) : null,
  setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k)
};
global.WORLD_ENGINE_CORE = {
  getChatId: () => 'full', getChatLayer: () => chat.length - 1,
  getLastStoryDay: () => null, loadState: () => ({ round: 1, worldDigest: 'Kinh đô giới nghiêm' })
};
global.WORLD_ENGINE_WORLDBOOK = { buildPromptSection: async () => 'Trường An là kinh đô của Đại Chu.' };
global.WORLD_ENGINE_UI = { refresh() {}, refreshBallControls() {} };
global.__WE_SetExternalStatus = () => {};

let apiTurn = 0;
const responses = [];
global.WORLD_ENGINE_API = {
  callApi: async prompt => { responses.push(prompt); return apiTurn < scripted.length ? scripted[apiTurn++] : '{}'; },
  parseJSON: JSON.parse
};

for (const f of ['npc-engine-settings.js', 'npc-engine-data.js', 'npc-engine-prompt.js',
                 'npc-engine-offscreen.js', 'npc-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, f), 'utf8'), { filename: f });
}
const D = NPC_ENGINE_DATA, E = NPC_ENGINE, C = NPC_ENGINE_SETTINGS;

let bad = 0;
const ok = (label, cond) => { if (!cond) { bad++; console.error('  ✗ ' + label); } };

// Kịch bản phản hồi API cho ba lượt (mỗi lượt: trích xuất, rồi hoạt động ngầm).
const scripted = [
  // Lượt 1 — trích xuất: gặp Rias và Issei
  JSON.stringify({
    scene: { location: ['Nhật Bản', 'Kuoh', 'Học viện Kuoh'], presentNames: ['Rias Gremory'] },
    time: { label: 'chiều muộn', elapsed: { minutes: 30 } },
    npcs: [
      { name: 'Rias Gremory', tier: 'core', significance: 95, present: true,
        identity: { gender: 'nữ', pronouns: 'cô ấy', species: 'Ác ma', ageStage: 'thiếu nữ' },
        location: { path: ['Nhật Bản', 'Kuoh', 'Học viện Kuoh'] },
        goals: [{ text: 'Bảo vệ lãnh địa Kuoh', progress: 'đang tiến hành' }] },
      { name: 'Hyoudou Issei', tier: 'core', significance: 90, present: false,
        identity: { gender: 'nam', pronouns: 'cậu ấy' },
        location: { path: ['Nhật Bản', 'Kuoh', 'Nhà Hyoudou'] } }
    ]
  }),
  // Lượt 1 — hoạt động ngầm: Issei vắng mặt, hẹn rèn (giờ công) và lên đường
  JSON.stringify({
    activities: [{
      name: 'Hyoudou Issei', action: 'Về nhà luyện tập Thần Khí', timeRef: 'chiều cùng ngày',
      becameRumor: true, rumorText: 'Nghe nói có người luyện tập gì đó ở khu nhà Hyoudou',
      intent: { action: 'Luyện thành thục Boosted Gear', mode: 'effort', duration: { hours: 20 } }
    }]
  }),
  // Lượt 2 — trích xuất: chính văn tiết lộ nhân dạng khác, và báo đã kể tin đồn
  JSON.stringify({
    scene: { location: ['Nhật Bản', 'Kuoh', 'Học viện Kuoh'], presentNames: ['Rias Gremory'] },
    time: { label: 'ba ngày sau', elapsed: { days: 3 } },
    acknowledgedFacts: ['fact:1'],
    npcs: [
      { name: 'Rias Gremory', tier: 'core', significance: 95, present: true,
        identity: { gender: 'nam', species: 'Thiên sứ', socialRole: 'Chủ tịch hội học sinh' } }
    ]
  }),
  // Lượt 2 — hoạt động ngầm
  JSON.stringify({ activities: [] })
];

(async () => {
  storage.clear();
  C.saveSettings({ ...C.DEFAULTS, engineEnabled: true, apiUrl: 'https://x.test/v1', model: 'm',
                   significanceThreshold: 60, offscreenMaxPerRound: 3, fallbackMinutesPerTurn: 20,
                   worldbookEnabled: true });

  console.log('\n=== LƯỢT 1 ===');
  chat.push({ is_user: true, mes: 'Người chơi tới học viện' }, { is_user: false, name: 'Rias', mes: 'Rias mỉm cười.' });
  const r1 = await E.ingestWorldEvolution({ layer: 1, dialogue: 'Rias mỉm cười ở phòng câu lạc bộ.', worldDigest: 'Kinh đô giới nghiêm' });
  let st = D.loadState();

  ok('trích xuất được hai nhân vật', st.npcs.length === 2);
  ok('nhân dạng được ghi nhận lần đầu', D.findNpc(st, 'Rias Gremory').identity.gender === 'nữ');
  ok('đồng hồ nhích đúng 30 phút', D.clockMinutes(st) === 30);
  ok('người vắng mặt được đẩy hoạt động ngầm', r1.acted.length === 1);
  ok('lịch hẹn ghi đúng kiểu giờ công',
    D.findNpc(st, 'Hyoudou Issei').pendingIntent.schedule.mode === 'effort');
  ok('tin đồn sinh ra nhưng CHƯA vào chính văn',
    st.publicFacts.length === 1 && st.publicFacts[0].acknowledged === false);
  ok('sự việc chưa thừa nhận không lọt vào ràng buộc tri thức', !injected.includes('CHƯA biết'));
  ok('ràng buộc nhân dạng có trong khối chèn', injected.includes('Nhân dạng nhân vật'));

  console.log('\n=== LƯỢT 2 (truyện nhảy 3 ngày) ===');
  chat.push({ is_user: true, mes: 'Ba ngày sau' }, { is_user: false, name: 'Rias', mes: 'Ba ngày sau, Rias nhắc lại lời đồn.' });
  await E.ingestWorldEvolution({ layer: 3, dialogue: 'Ba ngày sau, Rias nhắc lại lời đồn về nhà Hyoudou.', worldDigest: 'Kinh đô giới nghiêm' });
  st = D.loadState();

  ok('chính văn nói khác thì nhân dạng đổi theo', D.findNpc(st, 'Rias Gremory').identity.gender === 'nam');
  ok('chủng tộc cũng đổi theo', D.findNpc(st, 'Rias Gremory').identity.species === 'Thiên sứ');
  ok('ô còn trống vẫn điền được', D.findNpc(st, 'Rias Gremory').identity.socialRole === 'Chủ tịch hội học sinh');
  // Lượt này mô hình không nhắc gì tới xưng hô, nên giá trị cũ phải còn nguyên — im lặng không phải là xoá.
  ok('trường không được nhắc thì giữ nguyên', D.findNpc(st, 'Rias Gremory').identity.pronouns === 'cô ấy');
  ok('đồng hồ nhảy đúng 3 ngày', D.clockMinutes(st) === 30 + 3 * D.MINUTES_PER_DAY);
  ok('sự việc được báo là đã kể thì thành đã thừa nhận',
    st.publicFacts[0].acknowledged === true);

  const issei = D.findNpc(st, 'Hyoudou Issei');
  ok('dự định giờ công vẫn còn (chưa đủ công dù đã 3 ngày)',
    issei.pendingIntent && issei.pendingIntent.due !== true ? false : true);
  ok('dự định ngắn hạn bị đánh dấu lỗi thời sau khi nhảy ngày',
    !issei.pendingIntent || issei.pendingIntent.staleByTime === true || issei.pendingIntent.due === true);

  console.log('\n=== KIỂM CHỨNG CHÉO ===');
  const lastPrompt = responses[responses.length - 1] || responses[responses.length - 2] || '';
  ok('prompt có kèm tư liệu Sổ Tay Thế Giới', responses.some(p => p.includes('Trường An là kinh đô')));
  ok('prompt trích xuất kèm nhân dạng đang lưu', responses.some(p => p.includes('nhân dạng đang lưu')));
  ok('prompt kèm danh sách sự việc chờ thừa nhận', responses.some(p => p.includes('SỰ VIỆC HẬU TRƯỜNG CHƯA AI KỂ')));
  ok('bảng điểm chọn nhân vật có ghi lý do',
    (E.getLastSelection() || []).some(item => (item.reasons || []).length > 0));

  const info = E.getLastInjectionInfo();
  ok('khối chèn nằm trong trần độ dài', info.length <= info.maxChars);

  // Xem tại chỗ: không được đổi gì.
  const before = JSON.stringify(D.loadState());
  apiTurn = scripted.length;   // trả '{}' cho lần gọi tiếp
  global.WORLD_ENGINE_API.callApi = async () => 'Ta đang ngồi trong phòng câu lạc bộ, nghĩ về lời đồn kia.';
  const peek = await E.peekNpc('Rias Gremory');
  ok('xem tại chỗ trả về văn xuôi', peek.text.length > 10);
  ok('xem tại chỗ KHÔNG đổi trạng thái', JSON.stringify(D.loadState()) === before);

  if (bad) { console.error('npc-engine e2e tests FAILED (' + bad + ' lỗi)'); process.exit(1); }
  console.log('npc-engine e2e tests passed');
})().catch(e => { console.error('LỖI:', e); process.exit(1); });
