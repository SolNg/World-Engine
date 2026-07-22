const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = path.resolve(__dirname, '..');
const storage = new Map();
let injection = '';
let apiResponse = '';
let apiCalls = 0;
const chat = [
  { is_user: true, name: 'Người chơi', mes: 'Rằm tháng Giêng năm Gia Ninh thứ 30, Thẩm Hạc Đình thay mặt Thính Triều Các rút Đoạn Triều Kiếm tại Hắc Tiêu Loan.' },
  { is_user: false, name: 'Nhân vật', mes: 'Đoạn Triều Kiếm bị gãy trong lúc giao chiến, Thẩm Hạc Đình tin rằng nó vẫn có thể tu bổ, và thức tỉnh năng lực Thính Triều tại đây.' }
];

global.window = global;
global.document = { getElementById: () => null };
global.SillyTavern = {
  getContext: () => ({
    chat,
    setExtensionPrompt: (_name, content) => { injection = content; }
  })
};
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};
global.WORLD_ENGINE_CORE = {
  getChatId: () => 'entity-test',
  filterDialogue: value => value
};
global.WORLD_ENGINE_API = { callApi: async () => { apiCalls++; return apiResponse; } };
global.WORLD_ENGINE_UI = { setMemoryEvolvingUI: () => {} };

for (const file of ['memory-engine-settings.js', 'memory-engine-data.js', 'memory-engine-prompt.js',
  'memory-engine-small-summary-prompt.js', 'memory-engine-big-summary-prompt.js', 'memory-engine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
}
WORLD_ENGINE_STORE.setItem('memory_engine_settings', JSON.stringify({ apiAutoRetries: 3, injectIntoWorldEngine: true }));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  storage.set('memory_engine_state_entity-test', JSON.stringify({
    personal_memory: [], knowledge_index: {},
    world_memory: { organization: [], item: [{ id: 'item_000001', name: 'Vật cũ', description: 'Cấu trúc cũ.', history: [] }], ability: [], location: [] },
    round: 0, chatLayer: null
  }));
  const migrated = MEMORY_ENGINE_DATA.loadState();
  assert(migrated.entity_memory.object[0].name === 'Vật cũ' && !migrated.world_memory, 'Cấu trúc thực thể cũ thời phát triển phải được di chuyển sang entity_memory.object');

  storage.set('memory_engine_state_entity-test', JSON.stringify({
    personal_memory: [], knowledge_index: {}, round: 0, chatLayer: null
  }));
  apiResponse = JSON.stringify({
    personal_memory: [{
      name: ['Thẩm Hạc Đình'], known_by: [], memory: 'Thẩm Hạc Đình tin rằng Đoạn Triều Kiếm vẫn có thể tu bổ.', time: 'Rằm tháng Giêng năm Gia Ninh thứ 30'
    }],
    entity_updates: [
      { type: 'organization', name: 'Thính Triều Các', description: 'Một tổ chức tình báo hoạt động ở vùng ven biển.', event: '', time: '' },
      { type: 'object', name: 'Đoạn Triều Kiếm', aliases: ['Đoạn Triều', 'Hải Văn Cựu Kiếm'], description: 'Một thanh kiếm cũ có hộ thủ khắc hoa văn sóng biển, hiện lưỡi kiếm đã bị gãy.', event: 'Đoạn Triều Kiếm bị gãy trong trận giao chiến tại Hắc Tiêu Loan.', time: 'Rằm tháng Giêng năm Gia Ninh thứ 30' },
      { type: 'ability', name: 'Thính Triều', description: 'Năng lực cảm nhận cho phép phân biệt động tĩnh từ xa qua tiếng sóng.', event: 'Thẩm Hạc Đình thức tỉnh Thính Triều tại Hắc Tiêu Loan.', time: 'Rằm tháng Giêng năm Gia Ninh thứ 30' },
      { type: 'location', name: 'Hắc Tiêu Loan', description: 'Một vịnh biển rải đầy đá ngầm đen.', event: 'Thẩm Hạc Đình đã rút Đoạn Triều Kiếm tại đây.', time: 'vừa nãy' }
    ],
    small_summary: 'Thẩm Hạc Đình giao chiến tại Hắc Tiêu Loan, Đoạn Triều Kiếm bị gãy, đồng thời thức tỉnh năng lực Thính Triều.'
  });

  const first = await MEMORY_ENGINE.manualExtract();
  assert(first.addedPersonal === 1, 'Phải ghi thêm một bản ghi nhớ nhân vật');
  let state = MEMORY_ENGINE_DATA.loadState();
  assert(state.entity_memory.object[0].id === 'obj_000001', 'ID vật phẩm phải do hệ thống local sinh ra');
  assert(JSON.stringify(state.entity_memory.object[0].aliases) === JSON.stringify(['Đoạn Triều', 'Hải Văn Cựu Kiếm']), 'Bí danh thực thể phải được lưu đầy đủ');
  assert(state.entity_index['object:đoạn triều'] === 'obj_000001', 'Bí danh thực thể phải được ghi vào chỉ mục tên');
  assert(state.entity_memory.organization[0].id === 'org_000001', 'ID tổ chức phải do hệ thống local sinh ra');
  assert(state.entity_memory.ability[0].id === 'ability_000001', 'ID năng lực phải do hệ thống local sinh ra');
  assert(state.entity_memory.location[0].id === 'location_000001', 'ID địa điểm phải do hệ thống local sinh ra');
  assert(state.entity_memory.location[0].history[0].time === '', 'Mốc thời gian tương đối không quy đổi được phải bị xóa trống');
  assert(state.entity_memory.organization[0].history.length === 0, 'Event rỗng không được ghi vào lịch sử local');
  assert(injection.includes('【Vật Phẩm: Đoạn Triều Kiếm】'), 'Sau khi trùng tên phải tiêm bản ghi nhớ vật phẩm');
  assert(injection.includes('【Địa Điểm: Hắc Tiêu Loan】'), 'Sau khi trùng tên phải tiêm bản ghi nhớ địa điểm');
  assert(injection.includes('【Tổ Chức: Thính Triều Các】'), 'Sau khi trùng tên phải tiêm bản ghi nhớ tổ chức');
  assert(injection.includes('【Năng Lực: Thính Triều】'), 'Sau khi trùng tên phải tiêm bản ghi nhớ năng lực');
  assert(MEMORY_ENGINE.buildWorldEngineContext({ current: 'Đoạn Triều' }).includes('【Vật Phẩm: Đoạn Triều Kiếm】'), 'Khi trạng thái thế giới trùng bí danh thực thể phải tiêm thực thể đó');

  chat.push(
    { is_user: true, name: 'Người chơi', mes: 'Ngày 16 tháng Giêng năm Gia Ninh thứ 30, Thẩm Hạc Đình dùng Huyền Thiết để tu bổ Đoạn Triều Kiếm.' },
    { is_user: false, name: 'Nhân vật', mes: 'Đoạn Triều Kiếm đã được tu bổ xong; cùng ngày Thính Triều Các tuyên bố giải tán.' }
  );
  apiResponse = JSON.stringify({
    personal_memory: [],
    entity_updates: [
      { type: 'object', name: 'Đoạn Triều Kiếm', description: 'Một thanh kiếm cũ có hộ thủ khắc hoa văn sóng biển, lưỡi kiếm đã được tu bổ bằng Huyền Thiết.', event: 'Đoạn Triều Kiếm bị gãy trong trận giao chiến tại Hắc Tiêu Loan.', time: 'Rằm tháng Giêng năm Gia Ninh thứ 30' },
      { type: 'object', name: 'Đoạn Triều', aliases: ['Triều Kiếm'], description: 'Một thanh kiếm cũ có hộ thủ khắc hoa văn sóng biển, lưỡi kiếm đã được tu bổ bằng Huyền Thiết.', event: 'Đoạn Triều Kiếm được tu bổ bằng Huyền Thiết.', time: 'Ngày 16 tháng Giêng năm Gia Ninh thứ 30' },
      { type: 'organization', name: 'Thính Triều Các', description: '', event: 'Thính Triều Các tuyên bố giải tán.', time: 'Ngày 16 tháng Giêng năm Gia Ninh thứ 30' }
    ],
    small_summary: 'Đoạn Triều Kiếm được tu bổ bằng Huyền Thiết, sau đó Thính Triều Các tuyên bố giải tán.'
  });
  await MEMORY_ENGINE.manualExtract();
  state = MEMORY_ENGINE_DATA.loadState();
  assert(state.entity_memory.object.length === 1, 'Thực thể cùng loại cùng tên phải được gộp lại');
  assert(state.entity_memory.object[0].aliases.includes('Triều Kiếm'), 'Khi API dùng bí danh thực thể phải gộp và bổ sung bí danh mới');
  assert(state.entity_memory.object[0].history.length === 2, 'Sự kiện trùng lặp phải được loại bỏ, sự kiện mới phải được thêm vào lịch sử local');
  assert(state.entity_memory.object[0].description.includes('tu bổ bằng Huyền Thiết'), 'Mô tả hiện tại do API trả về phải ghi đè trực tiếp lên mô tả local');
  assert(state.entity_memory.organization[0].description === 'Một tổ chức tình báo hoạt động ở vùng ven biển.', 'Khi API trả về mô tả rỗng phải giữ nguyên mô tả gốc ở local');
  assert(state.entity_memory.organization[0].history[0].event === 'Thính Triều Các tuyên bố giải tán.', 'Mô tả rỗng không được cản trở việc ghi event vào lịch sử local');

  chat.push(
    { is_user: true, name: 'Người chơi', mes: 'Hôm sau tiếp tục ghi lại sự kiện dài về Đoạn Triều Kiếm.' },
    { is_user: false, name: 'Nhân vật', mes: 'Đây là một sự kiện dài cần được giữ lại toàn vẹn.' }
  );
  apiResponse = JSON.stringify({
    personal_memory: [],
    entity_updates: [{ type: 'object', name: 'Đoạn Triều Kiếm', description: '', event: 'sự'.repeat(51), time: '' }],
    small_summary: 'Đoạn Triều Kiếm tạo ra một bản ghi sự kiện đầy đủ, vượt quá số chữ khuyến nghị của Prompt.'
  });
  const callsBeforeOverlong = apiCalls;
  await MEMORY_ENGINE.manualExtract();
  assert(apiCalls === callsBeforeOverlong + 1, 'Nội dung vượt quá số chữ khuyến nghị của Prompt vẫn tính là thành công, không được kích hoạt retry');
  state = MEMORY_ENGINE_DATA.loadState();
  assert(state.entity_memory.object[0].history.some(item => item.event === 'sự'.repeat(51)),
    'Event vượt quá số chữ khuyến nghị của Prompt vẫn phải được ghi đầy đủ vào state local');

  const legacy = MEMORY_ENGINE._test.parseResponse(
    JSON.stringify([{ name: ['Nhân vật kiểu cũ'], known_by: [], memory: 'Nhân vật kiểu cũ nhớ về bài kiểm thử này.', time: '' }]),
    { memory: true }
  );
  assert(legacy.personal.some(item => item.name.includes('Nhân vật kiểu cũ')), 'Phải tương thích với response dạng mảng nhân vật kiểu cũ');

  const beforeEdit = {
    personal_memory: [
      { id: 'char_000001', names: ['Người biết chuyện'], memory: {} },
      { id: 'char_000002', names: ['Chủ nhân ký ức'], memory: { 'Một ngày nọ': ['Chủ nhân ký ức nhớ về một chuyện.'] } }
    ],
    knowledge_index: {
      'Người biết chuyện': [{ ownerId: 'char_000002', time: 'Một ngày nọ', memory: 'Chủ nhân ký ức nhớ về một chuyện.' }],
      'Chủ nhân ký ức': [{ ownerId: 'char_000002', time: 'Một ngày nọ', memory: 'Chủ nhân ký ức nhớ về một chuyện.' }]
    },
    entity_memory: { organization: [{ id: 'org_000001', name: 'Tổ chức cũ', description: '', history: [] }], object: [], ability: [], location: [] },
    entity_index: { 'organization:Tổ chức cũ': 'org_000001' },
    event_memory: { small_summaries: [], big_summary: null, small_summary_layer: null, big_summary_cursor: 0 },
    round: 0, chatLayer: null
  };
  const afterEdit = JSON.parse(JSON.stringify(beforeEdit));
  afterEdit.personal_memory[0].names = ['Người biết chuyện mới'];
  afterEdit.entity_memory.organization[0].name = 'Tổ chức mới';
  MEMORY_ENGINE.repairStateIndexes(afterEdit, beforeEdit);
  assert(afterEdit.knowledge_index['người biết chuyện mới']?.some(record => record.ownerId === 'char_000002'), 'Sau khi đổi tên nhân vật phải giữ lại các ký ức của người khác mà nhân vật đó biết');
  assert(!afterEdit.knowledge_index['người biết chuyện'], 'Sau khi đổi tên nhân vật không được sót lại chỉ mục bí danh cũ');
  assert(afterEdit.entity_index['organization:tổ chức mới'] === 'org_000001', 'Sau khi đổi tên thực thể phải xây dựng lại chỉ mục tên và giữ nguyên ID ổn định');

  console.log('memory-engine entity tests passed');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
