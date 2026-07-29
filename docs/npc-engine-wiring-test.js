// Kiểm thử hồi quy tĩnh cho việc cắm Công Cụ Nhân Vật vào bộ nạp và hai mối nối với Công Cụ Thế Giới.
// Tĩnh vì các hàm này nằm trong closure init() của world-engine.js, không xuất ra để gọi trực tiếp được.
// Chạy: node docs/npc-engine-wiring-test.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const world = fs.readFileSync(path.join(root, 'world-engine.js'), 'utf8');
const evolution = fs.readFileSync(path.join(root, 'world-engine-evolution.js'), 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) return;
  failures += 1;
  console.error('  ✗ ' + label);
}

// ===== Nhóm engine trong bộ nạp =====
check('có khai nhóm npc trong ENGINE_GROUPS', /id: 'npc'/.test(world));
for (const file of ['npc-engine-settings.js', 'npc-engine-data.js', 'npc-engine-prompt.js',
                    'npc-engine-offscreen.js', 'npc-engine.js']) {
  check(`nhóm npc khai module ${file}`, world.includes(`'${file}'`));
  check(`${file} tồn tại trên đĩa`, fs.existsSync(path.join(root, file)));
}
check('khai khế ước NPC_ENGINE', /NPC_ENGINE: \['init', 'applyInjection', 'abort', 'isRunning'\]/.test(world));
check('gọi NPC_ENGINE.init() khi khởi tạo', world.includes('window.NPC_ENGINE.init()'));
check('init của npc được bọc trong try/catch riêng',
  /loadedEngines\.get\('npc'\)[\s\S]{0,200}catch/.test(world));

// ===== Mối nối Thế Giới → Nhân Vật =====
check('gọi NPC_ENGINE.ingestWorldEvolution sau khi suy diễn',
  world.includes('window.NPC_ENGINE?.ingestWorldEvolution?.({'));
check('có công tắc npcLinkEnabled', world.includes('npcLinkEnabled'));
// Hoạt động ngầm phải phản ứng được với diễn biến thế giới của CHÍNH lượt này, nên phải truyền
// worldDigest vừa sinh ra chứ không phải bản của lượt trước.
check('truyền worldDigest của lượt hiện tại',
  /ingestWorldEvolution\?\.\(\{[\s\S]{0,300}worldDigest: state\.worldDigest/.test(world));
check('truyền hội thoại để trích xuất nhân vật',
  /ingestWorldEvolution\?\.\(\{[\s\S]{0,300}dialogue: dialogueText/.test(world));
check('reroll thì ghi đè thay vì nối thêm',
  /ingestWorldEvolution\?\.\(\{[\s\S]{0,300}replace: !isNewRound/.test(world));
check('lỗi liên kết không làm hỏng kết quả suy diễn thế giới',
  /ingestWorldEvolution[\s\S]{0,400}catch \(linkError\)/.test(world));

// ===== Mối nối Nhân Vật → Thế Giới =====
check('prompt suy diễn thế giới đọc ngữ cảnh từ NPC_ENGINE',
  evolution.includes('window.NPC_ENGINE?.buildWorldEngineContext?.(state)'));
check('không còn đọc ngữ cảnh từ MEMORY_ENGINE',
  !evolution.includes('window.MEMORY_ENGINE?.buildWorldEngineContext'));
check('ngữ cảnh xuyên engine được cách ly lỗi',
  /buildWorldEngineContext[\s\S]{0,200}catch \(error\)/.test(evolution));

// ===== Lối vào thủ công =====
// Nhận tham số chế độ: 'redo' thì ghi đè từ điểm lưu, còn lại thì nối thêm.
check('có hàm manualNpcLink', /async function manualNpcLink\(mode\)/.test(world));
check('manualNpcLink được xuất ra window.WORLD_ENGINE',
  /window\.WORLD_ENGINE = \{[\s\S]*?manualNpcLink[,\s}]/.test(world));
check('manualNpcLink chặn khi engine đang chạy',
  /manualNpcLink\(mode\)[\s\S]{0,300}NPC_ENGINE\?\.isRunning/.test(world));

// ===== Công cụ bỏ ẩn cứu hộ =====
check('có hàm unhideAllMessages', world.includes('async function unhideAllMessages()'));
check('unhideAllMessages được xuất ra window.WORLD_ENGINE',
  /window\.WORLD_ENGINE = \{[\s\S]*?unhideAllMessages[,\s}]/.test(world));
check('dùng đúng khoá cờ ẩn của Công Cụ Ký Ức',
  world.includes("'world_engine_memory_hidden'"));
// Điểm mấu chốt: công cụ cứu hộ phải sống sót sau khi 7 file ký ức bị xoá ở bước 4,
// nên tuyệt đối không được gọi vào bất kỳ module ký ức nào.
{
  const body = world.slice(world.indexOf('async function unhideAllMessages()'));
  const end = body.indexOf('\n      }');
  const fn = body.slice(0, end > 0 ? end : 3000);
  check('không phụ thuộc MEMORY_ENGINE', !fn.includes('MEMORY_ENGINE'));
  check('gỡ cả cờ extra lẫn is_system',
    fn.includes('delete message.extra[HIDDEN_KEY]') && fn.includes('message.is_system = false'));
  check('có đường lui khi không có lệnh gạch chéo', fn.includes("typeof exec === 'function'"));
}

// ===== Bộ Nhớ Ký Ức đã được gỡ hẳn =====
// Ký Ức từng là engine thứ hai của extension. Mọi dấu vết còn sót đều là mã chết, và tệ hơn là
// mã chết có thể được gọi lại do nhầm lẫn — nên chốt bằng kiểm định thay vì trông vào trí nhớ.
{
  for (const file of ['memory-engine.js', 'memory-engine-data.js', 'memory-engine-timeline.js',
                      'memory-engine-prompt.js', 'memory-engine-settings.js',
                      'memory-engine-small-summary-prompt.js', 'memory-engine-big-summary-prompt.js']) {
    check(`${file} đã bị xoá`, !fs.existsSync(path.join(root, file)));
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  // generate_interceptor từng trỏ tới hàm gỡ ẩn của Ký Ức; để lại thì SillyTavern gọi vào hư không.
  check('manifest không còn khai generate_interceptor', !('generate_interceptor' in manifest));
  check('manifest vẫn khai đúng điểm vào', manifest.js === 'world-engine.js');

  check('ENGINE_GROUPS không còn nhóm memory', !/id: 'memory'/.test(world));
  check('world-engine.js không còn gọi MEMORY_ENGINE', !/window\.MEMORY_ENGINE/.test(world));

  const runtimeFiles = ['world-engine-ui.js', 'world-engine-diag.js', 'world-engine-chatcache.js',
                        'world-engine-inject-inspector.js', 'world-engine-evolution.js'];
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    check(`${file} không còn gọi vào MEMORY_ENGINE`, !/window\.MEMORY_ENGINE/.test(source));
  }

  // style.css: lớp chết thì gỡ, nhưng không được gỡ nhầm lớp mà giao diện còn dùng.
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const uiSource = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
  check('style.css không còn quy tắc .we-memory-*', !/\.we-memory-/.test(css));
  {
    const used = new Set();
    for (const attribute of uiSource.match(/class="[^"]*"/g) || []) {
      for (const cls of attribute.match(/we-[a-z0-9-]+/g) || []) used.add(cls);
    }
    const styled = [...used].filter(cls => css.includes('.' + cls));
    check(`phần lớn lớp giao diện vẫn có kiểu dáng (${styled.length}/${used.size})`, styled.length >= used.size * 0.6);
  }
  {
    const open = (css.match(/\{/g) || []).length;
    const close = (css.match(/\}/g) || []).length;
    check(`ngoặc style.css cân bằng (${open}/${close})`, open === close);
  }

  // Bộ tự kiểm tra việc chèn phải soi đúng chuỗi mà NPC_ENGINE thật sự đặt vào prompt,
  // nếu không nó sẽ luôn báo "chưa chèn gì" dù thực tế đã chèn.
  const inspector = fs.readFileSync(path.join(root, 'world-engine-inject-inspector.js'), 'utf8');
  const npcEngine = fs.readFileSync(path.join(root, 'npc-engine.js'), 'utf8');
  check('bộ soi chèn dùng đúng tên khối chèn của NPC', inspector.includes("'npc_engine_context'"));
  check('tên khối chèn khớp với npc-engine.js', npcEngine.includes("INJECTION_NAME = 'npc_engine_context'"));
  check('bộ soi chèn dùng đúng chuỗi mốc', inspector.includes('【TRẠNG THÁI NHÂN VẬT NỀN】'));
  check('chuỗi mốc khớp với nội dung engine thật sự chèn', npcEngine.includes('【TRẠNG THÁI NHÂN VẬT NỀN】'));
}

if (failures > 0) {
  console.error(`npc-engine wiring tests FAILED (${failures} lỗi)`);
  process.exit(1);
}
console.log('npc-engine wiring tests passed');
