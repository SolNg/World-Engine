// Kiểm thử bố cục giao diện Công Cụ Nhân Vật: mặt engine, các view, cài đặt, và CSS đi kèm.
// Chạy: node docs/npc-engine-ui-test.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) return;
  failures += 1;
  console.error('  ✗ ' + label);
}

// ===== Mặt engine =====
check('có đăng ký mặt engine npc', /registerEngineFace\(\{\s*\n?\s*id: 'npc'/.test(ui));
check('mặt npc khai đủ hook render/bind',
  /id: 'npc'[\s\S]{0,900}render: \(\) => renderNpcView\(\)[\s\S]{0,200}bind: \(\) => bindNpcView\(\)/.test(ui));
check('mặt npc nối vào công tắc tổng của engine',
  /id: 'npc'[\s\S]{0,900}NPC_ENGINE_SETTINGS\?\.patchSettings\(\{ engineEnabled: enabled \}\)/.test(ui));
check('mặt npc báo trạng thái đang chạy',
  /id: 'npc'[\s\S]{0,900}NPC_ENGINE\?\.isRunning/.test(ui));

// Nút vệ tinh trên quả cầu là giao diện dùng chung; mặt nào thiếu hook thì nút của mặt đó
// bấm không ra gì cả — callEngineFaceAction trả về lặng lẽ, không báo lỗi, không toast.
// Mặt npc từng thiếu hẳn hook redo nên nút "Diễn Biến Lại" chết câm.
{
  // Cắt trọn khối khai báo của một mặt engine: từ dòng id tới dấu đóng registerEngineFace.
  // Cắt theo độ dài cố định là hụt, vì khối này dài ra mỗi lần thêm hook hoặc chú thích.
  const faceBlock = id => {
    const from = ui.indexOf(`id: '${id}'`);
    if (from < 0) return '';
    const to = ui.indexOf('\n    });', from);
    return to < 0 ? ui.slice(from) : ui.slice(from, to);
  };

  const face = faceBlock('npc');
  check('cắt được khối khai báo mặt npc', face.length > 200);
  for (const hook of ['render', 'bind', 'forward', 'redo', 'abort', 'setEnabled', 'getSettings']) {
    check(`mặt npc khai hook ${hook}`, new RegExp(`\\b${hook}:`).test(face));
  }
  check('forward và redo là hai chế độ khác nhau',
    /forward: \(\) => runNpcLink\('forward'\)/.test(face) && /redo: \(\) => runNpcLink\('redo'\)/.test(face));
  check('runNpcLink truyền chế độ xuống lối vào thủ công',
    /manualNpcLink\?\.\(mode\)/.test(ui));

  // Mọi hook mà mặt world khai và có nút tương ứng trên quả cầu thì mặt npc cũng phải khai,
  // nếu không nút đó bấm không ra gì mà cũng không báo lỗi.
  const worldFace = faceBlock('world');
  const ballHooks = ['forward', 'redo', 'abort'].filter(hook => new RegExp(`\\b${hook}:`).test(worldFace));
  const missing = ballHooks.filter(hook => !new RegExp(`\\b${hook}:`).test(face));
  check(`mặt npc không thiếu hook nút quả cầu nào (thiếu: ${missing.join(', ') || 'không'})`, missing.length === 0);
}

// Lối vào thủ công không được đòi hỏi Công Cụ Thế Giới đã chạy: trích xuất nhân vật chỉ cần hội thoại.
{
  const world = fs.readFileSync(path.join(root, 'world-engine.js'), 'utf8');
  const from = world.indexOf('async function manualNpcLink(');
  const block = from >= 0 ? world.slice(from, from + 2000) : '';
  check('manualNpcLink nhận tham số chế độ', /async function manualNpcLink\(mode\)/.test(world));
  check('chế độ redo thì ghi đè từ điểm lưu', /replace: redo/.test(block));
  check('không chặn khi chưa có tóm tắt thế giới', !/if \(!digest\)/.test(block));
  check('chặn khi chưa có hội thoại', /if \(!dialogue\.trim\(\)\)/.test(block));
  check('bỏ qua được báo là bỏ qua, không phải lỗi', /if \(result\.skipped\)/.test(block));
}

// ===== Các hàm dựng view =====
for (const fn of ['renderNpcView', 'renderNpcHomeView', 'renderNpcSubView', 'renderNpcSettingsView',
                  'renderNpcCard', 'bindNpcView']) {
  check(`có hàm ${fn}`, ui.includes(`function ${fn}(`));
}
check('view rẽ nhánh sang cài đặt trước',
  /function renderNpcView\(\)[\s\S]{0,200}_npcSettingsOpen[\s\S]{0,60}renderNpcSettingsView/.test(ui));

// ===== Bốn mục điều hướng =====
for (const view of ['core', 'peripheral', 'archive', 'rumors']) {
  check(`có mục điều hướng ${view}`, new RegExp(`${view}: \\{ title:`).test(ui));
}

// ===== Thẻ nhân vật hiển thị đủ mọi trường đang lưu =====
// Trình soạn có ô nào thì thẻ phải hiện trường đó. Thẻ hiện ít hơn trình soạn thì người xem không
// biết mình đang bỏ sót gì — mà cái bỏ sót lại chính là thứ engine gửi cho AI chính.
for (const key of ['Nhân dạng', 'Vị trí', 'Mục tiêu', 'Thế lực', 'Với người chơi',
                   'Với nhân vật khác', 'Biết', 'Trạng thái', 'Dự định']) {
  check(`thẻ nhân vật có trục ${key.toLocaleLowerCase()}`, ui.includes(`axis('${key}'`));
}
check('thẻ nhân vật hiện điểm tin cậy', ui.includes('we-npc-trust'));
// Cắt bớt danh sách thì phải nói còn bao nhiêu, đừng cắt im lặng.
check('thẻ nhân vật báo phần bị cắt', ui.includes('we-npc-more') && ui.includes('mở Sửa để xem hết'));
// ===== Sổ mâu thuẫn có mặt đầy đủ trong giao diện =====
check('có mục điều hướng sổ mâu thuẫn', ui.includes("conflicts: { title: 'Sổ Mâu Thuẫn'"));
check('sổ mâu thuẫn nằm trong danh sách điều hướng',
  /\['core', 'peripheral', 'archive', 'rumors', 'threads', 'conflicts'\]/.test(ui));
check('có nhánh dựng nội dung sổ mâu thuẫn', ui.includes("view === 'conflicts'"));
check('có nút xoá sổ và trình xử lý', ui.includes('we-npc-clear-conflicts') && ui.includes('clearConflicts('));
check('sổ mâu thuẫn nói rõ engine vẫn nghe theo chính văn', ui.includes('vẫn nghe theo chính văn'));

// Chép chẩn đoán phải nói rõ nó bỏ nguyên văn, còn tải file thì nói rõ nó GIỮ nguyên văn.
check('có nút chép chẩn đoán', ui.includes('we-npc-copy-diag') && ui.includes("diag.copy('npc')"));
check('nút chép nói rõ đã bỏ nguyên văn', ui.includes('bỏ nguyên văn truyện'));
check('nút tải file cảnh báo có chứa nguyên văn', ui.includes('có chứa nguyên văn truyện'));

// Dấu vết: bật tắt được như mọi khối chèn khác.
check('có công tắc dấu vết', ui.includes('we-npc-inject-trace') && ui.includes("'injectTrace'"));

// ===== Tuyến hệ quả =====
check('có mục điều hướng tuyến hệ quả', ui.includes("threads: { title: 'Tuyến Hệ Quả'"));
check('có nhánh dựng nội dung tuyến hệ quả', ui.includes("view === 'threads'"));
check('có nút cho nguội và bỏ hẳn',
  ui.includes('we-npc-thread-cool') && ui.includes('we-npc-thread-drop'));
check('có công tắc và trần tuyến hệ quả',
  ui.includes("'injectThreads'") && ui.includes("'threadLimit'") && ui.includes("'threadColdAfterMinutes'"));
// Mô tả phải nói rõ vì sao trần để thấp, nếu không người dùng sẽ nâng lên rồi ngập việc vặt.
check('mô tả trần giải thích lý do để thấp', ui.includes('danh sách việc vặt'));

// ===== Tóm tắt tình hình nhân vật lấp khoảng trống trang chủ =====
check('trang chủ gọi tóm tắt', ui.includes('getDigest'));
// Bản mô hình viết là văn xuôi, không có nhãn để cắt — giao diện phải phân biệt hai dạng.
check('phân biệt bản văn xuôi với bản danh sách',
  ui.includes('digest.prose') && ui.includes('we-npc-digest-prose'));
check('có nút viết lại tóm tắt',
  ui.includes('we-npc-digest-redo') && ui.includes('runDigest'));
check('có công tắc cho mô hình viết tóm tắt',
  ui.includes("'digestEnabled'") && ui.includes('một lượt gọi API mỗi lượt'));
check('có khung tóm tắt', ui.includes('we-npc-digest-box') && ui.includes('Tình Hình Nhân Vật'));
// Tóm tắt phải xuống dòng theo chủ đề, và trong một chủ đề thì mỗi người một dòng con.
// Đổ tất cả thành một cục thì không liếc ra được gì — mà liếc là mục đích duy nhất của khối này.
check('tóm tắt tách theo dòng', ui.includes('we-npc-digest-row') && ui.includes("text.split('\\n')"));
check('mỗi chủ đề có nhãn riêng', ui.includes('we-npc-digest-key'));
check('nhiều người thì tách mỗi người một dòng con',
  ui.includes('we-npc-digest-item') && ui.includes("split('; ')"));

// ===== Cắt khối theo nhãn =====
check('có ô cắt khối theo nhãn', ui.includes('we-npc-filter-tags') && ui.includes("'filterTags'"));
check('mô tả dặn đừng cắt đoạn tự sự POV khác', ui.includes('POV khác'));

// Tách vị trí thật khỏi chỗ người chơi tưởng là điểm mấu chốt của tính năng sương mù.
check('thẻ nhân vật hiển thị chỗ người chơi tưởng', ui.includes('Người chơi tưởng'));
check('thẻ nhân vật hiển thị nhật ký hoạt động ngầm', ui.includes('Hoạt động ngầm'));

// ===== Thao tác tay trên hồ sơ =====
for (const action of ['we-npc-pin', 'we-npc-tier', 'we-npc-archive', 'we-npc-revive']) {
  check(`có nút ${action}`, ui.includes(action));
  check(`nút ${action} được gắn sự kiện`, new RegExp(`querySelectorAll\\('\\.${action}'\\)`).test(ui));
}
check('sửa hồ sơ tay thì ghi lại trạng thái',
  /const mutate = [\s\S]{0,400}npcData\(\)\.saveState\(state\)/.test(ui));

// ===== Mục API — engine dùng API riêng, thiếu mục này là không cấu hình được =====
// Bản đầu tiên của trang cài đặt quên hẳn phần này: cấu hình có sẵn apiUrl/apiKey/model
// nhưng không có ô nhập nào, nên engine nạp được mà im lặng tuyệt đối.
{
  const apiBindings = [
    ['we-npc-api-url', 'apiUrl'],
    ['we-npc-api-key', 'apiKey'],
    ['we-npc-model', 'model'],
    ['we-npc-connection-mode', 'connectionMode'],
    ['we-npc-temperature', 'temperature'],
    ['we-npc-max-tokens', 'maxTokens'],
    ['we-npc-api-retries', 'apiAutoRetries'],
    ['we-npc-api-timeout', 'apiTimeoutMs']
  ];
  for (const [id, key] of apiBindings) {
    check(`mục API có ô nhập ${key}`, ui.includes(`'${id}'`));
    check(`ô nhập ${key} được gắn vào đúng khoá`, new RegExp(`'${id}', '${key}'`).test(ui));
  }
  check('API key dùng ô nhập kiểu password', /id="we-npc-api-key"[^>]*type="password"|type="password" id="we-npc-api-key"/.test(ui));
  check('có nút lấy danh sách mô hình', ui.includes('we-npc-fetch-models'));
  check('lấy danh sách dùng cấu hình của chính NPC Engine',
    /fetchModelList\?\.\(npcSettings\(\)\)/.test(ui));
  check('mục API nằm trong tab Thường Dùng',
    /common:\s*sec\('set-npc-api'/.test(ui));
}

// ===== Tab cài đặt =====
{
  for (const [key, label] of [['common', 'Thường Dùng'], ['link', 'Liên Kết'], ['advanced', 'Nâng Cao'],
                              ['archive', 'Lưu Trữ'], ['worldbook', 'Worldbook'],
                              ['debug', 'Gỡ Lỗi'], ['about', 'Giới Thiệu']]) {
    check(`có tab ${label}`, new RegExp(`key: '${key}',\\s*label: '${label}'`).test(ui));
  }
  // Dùng lại đúng lớp của trang cài đặt thế giới thì việc chuyển tab do bindEvents lo,
  // chỉ ẩn/hiện bằng CSS chứ không render lại — nếu đổi tên lớp, nội dung đang nhập sẽ mất khi chuyển tab.
  check('tab dùng lại lớp we-settings-tab có sẵn', /class="we-settings-tab'/.test(ui));
  check('panel dùng lại lớp we-settings-panel có sẵn', ui.includes('class="we-settings-panel"'));
  check('mặt npc khai hook onSettingsTab', /onSettingsTab: key => \{ _npcSettingsTab = key; \}/.test(ui));
  check('mặt npc khai hook refreshDebug', /refreshDebug: \(\) => refreshNpcDebugRender\(\)/.test(ui));
  check('có hàm renderNpcDebug', ui.includes('function renderNpcDebug('));
  // Thẻ tự kiểm tra chèn: hàm dùng chung vốn nhận tham số phạm vi, nhưng trước đây chỉ mặt Thế Giới
  // gọi tới nên mặt Nhân Vật không có chỗ nào soi được phần chèn của chính nó.
  check('tab Gỡ Lỗi của NPC có thẻ tự kiểm tra chèn', /renderInjectInspector\('npc'\)/.test(ui));
  check('thẻ nằm trong khung .we-prompt-debug để bấm thu gọn được',
    /injectCard[\s\S]{0,80}we-prompt-debug|we-prompt-debug'>' \+ injectCard/.test(ui));
  check('làm mới xong thì gắn lại nút thu gọn',
    /refreshNpcDebugRender[\s\S]{0,400}bindPromptSegToggle/.test(ui));
  check('có nút xuất gói chẩn đoán', ui.includes('we-npc-export-diag'));
  check('gói chẩn đoán xuất đúng phạm vi npc', /WORLD_ENGINE_DIAG\?\.download\?\.\('npc'\)/.test(ui));
}

// ===== Cài đặt =====
const settingsBindings = [
  ['we-npc-core-limit', 'npcCoreLimit'],
  ['we-npc-threshold', 'significanceThreshold'],
  ['we-npc-offscreen', 'offscreenEnabled'],
  ['we-npc-aggressiveness', 'offscreenAggressiveness'],
  ['we-npc-fog', 'locationFogMode'],
  ['we-npc-knowledge-scope', 'knowledgeInjectScope'],
  ['we-npc-world-scale', 'worldScale'],
  ['we-npc-link', 'npcLinkEnabled'],
  ['we-npc-to-world', 'injectIntoWorldEngine']
];
for (const [id, key] of settingsBindings) {
  check(`cài đặt ${key} có ô nhập`, ui.includes(`'${id}'`));
  check(`cài đặt ${key} được gắn vào đúng khoá`, new RegExp(`'${id}', '${key}'`).test(ui));
}
check('ba nấc che vị trí đều có trong ô chọn',
  /'off', 'Tắt[\s\S]{0,200}'fog', 'Sương mù[\s\S]{0,200}'strict', 'Nghiêm ngặt/.test(ui));

// ===== Trình soạn hồ sơ =====
// Bản đầu chỉ có 4 nút ghim/nâng-hạ/vào kho/ra kho: không có cách nào chữa khi mô hình chấm sai,
// thêm nhân vật bị bỏ sót, hay xoá người bị nhận nhầm.
{
  check('có hàm dựng trình soạn', ui.includes('function renderNpcEditor('));
  check('có hàm đọc ngược từ ô nhập', ui.includes('function readNpcEditor('));
  check('có nút Sửa trên thẻ nhân vật', ui.includes('we-npc-edit'));
  check('có nút Thêm Nhân Vật', ui.includes('we-npc-add'));
  check('có nút Xoá hẳn', ui.includes('we-npc-delete'));
  check('có nút xem tại chỗ', ui.includes('we-npc-peek'));
  // Kết quả xem chỉ nằm trong bộ nhớ phiên, không phải dữ liệu của cuộc trò chuyện.
  check('kết quả xem không lưu vào trạng thái chat', /let _npcPeek = \{\};/.test(ui));
  check('đổi chat thì quên kết quả xem cũ',
    /_npcExpandScope !== scope[\s\S]{0,260}_npcPeek = \{\}/.test(ui));
  check('tầng dữ liệu có hàm xoá', fs.readFileSync(path.join(root, 'npc-engine-data.js'), 'utf8').includes('function removeNpc('));

  // Sửa được đủ sáu trục, nếu không thì vẫn có trục chữa không nổi.
  for (const [truc, field] of [['vị trí', 'we-npc-f-path'], ['mục tiêu', 'we-npc-f-goals'],
                               ['thế lực', 'we-npc-f-faction'], ['quan hệ', 'we-npc-f-attitude'],
                               ['tri thức', 'we-npc-f-knowledge'], ['trạng thái', 'we-npc-f-condition']]) {
    check(`trình soạn sửa được trục ${truc}`, ui.includes(field));
  }
  check('sửa được cả chỗ người chơi tưởng', ui.includes('we-npc-f-believes'));
  check('sửa được bậc và điểm', ui.includes('we-npc-f-tier') && ui.includes('we-npc-f-significance'));
  check('ghim được ngay trong trình soạn', ui.includes('we-npc-f-pinned'));

  // Sửa tri thức mà mất dấu tầng thì phép lùi tầng và ràng buộc tri thức hỏng theo.
  check('giữ nguyên dấu tầng của tri thức cũ khi sửa',
    /npcTextToKnowledge[\s\S]{0,700}layer: old\?\.layer/.test(ui));
  check('giữ nguyên factId để ràng buộc tri thức còn khớp',
    /npcTextToKnowledge[\s\S]{0,700}factId: old\?\.factId/.test(ui));
  // Những trường trình soạn không đụng tới (nhật ký hoạt động ngầm, dự định đang treo, phương tiện
  // di chuyển, quan hệ với NPC khác) phải còn nguyên — nên đối tượng trả về phải trải base ra trước.
  {
    const from = ui.indexOf('function readNpcEditor(');
    const body = from >= 0 ? ui.slice(from, ui.indexOf('\n  }', from)) : '';
    check('cắt được thân hàm readNpcEditor', body.length > 200);
    check('giữ nguyên các trường không sửa tới', /return \{\s*\r?\n\s*\.\.\.base,/.test(body));
    check('giữ nguyên phần vị trí không sửa tới', /\.\.\.\(base\.location \|\| \{\}\)/.test(body));
  }

  check('xoá hẳn có hỏi xác nhận', /we-npc-delete[\s\S]{0,900}confirm\(/.test(ui));
  check('thêm mới chặn trùng tên', /const clash = npcData\(\)\.findNpc\(state, draft\.name\)/.test(ui));
  check('lưu xong thì chèn lại prompt', /_npcEditingId = null;[\s\S]{0,120}refresh\(\)/.test(ui));

  // Đổi chat phải quên trạng thái cũ, nếu không khoá của chat trước dồn lại mãi.
  check('đổi chat thì xoá trạng thái gập/mở', /_npcExpandScope !== scope[\s\S]{0,160}_npcExpanded\.clear\(\)/.test(ui));
  check('đổi chat thì đóng trình soạn đang mở', /_npcExpandScope !== scope[\s\S]{0,200}_npcEditingId = null/.test(ui));
}

// ===== Lưu / Đặt lại =====
{
  check('có nút Lưu Cài Đặt', ui.includes('we-npc-save-settings'));
  check('có nút Đặt Lại Cài Đặt', ui.includes('we-npc-reset-settings'));
  check('thanh lưu dùng lại lớp sticky có sẵn', /we-settings-save-actions we-settings-save-sticky/.test(ui));
  // Nút Lưu phải quét lại toàn bộ ô ở MỌI tab, không chỉ tab đang mở — các tab ẩn vẫn nằm trong DOM.
  check('có bảng ánh xạ ô nhập sang khoá cấu hình', ui.includes('NPC_FIELD_MAP'));
  check('có hàm quét toàn bộ ô nhập', ui.includes('const collectNpcSettings'));
  check('nút Lưu ghi một lần bằng kết quả quét được',
    ui.includes('patchSettings(collectNpcSettings())'));
  check('Đặt lại đọc từ DEFAULTS của module cấu hình', /NPC_ENGINE_SETTINGS\?\.DEFAULTS/.test(ui));
  // Neo vào chính khối xử lý nút của NPC: trang cài đặt thế giới cũng có biến tên resetBtn,
  // không neo thì phép kiểm bắt nhầm khối kia.
  {
    const from = ui.indexOf("getElementById('we-npc-reset-settings')");
    const block = from >= 0 ? ui.slice(from, from + 900) : '';
    check('Đặt lại có hỏi xác nhận trước', block.includes('confirm('));
    // Cấu hình và dữ liệu là hai thứ khác nhau: đặt lại cài đặt không được xoá hồ sơ nhân vật.
    check('Đặt lại ghi đè cấu hình bằng mặc định', block.includes('saveSettings({ ...defaults })'));
    check('Đặt lại không đụng tới hồ sơ nhân vật',
      !block.includes('clearState') && !block.includes('saveState'));
  }
}

// ===== Worldbook dùng chung, không tự dựng lại =====
{
  // Bản trước chỉ có hai công tắc bật/tắt, không đọc lorebook, nên tab Worldbook vô dụng.
  check('dùng lại khối Worldbook của trang cài đặt thế giới',
    /renderSettingsAfterCheckpoint\(\{ scope: 'npc' \}\)/.test(ui));
  check('tab worldbook lấy từ khối dùng chung', /worldbook: shared\.worldbook/.test(ui));
  check('không còn hai công tắc worldbook tự chế',
    !ui.includes('we-npc-worldbook-enabled') && !ui.includes('we-npc-worldbook-trigger'));

  // Phạm vi 'npc' phải được các module dùng chung chấp nhận, nếu không mở tab là ném lỗi.
  const worldbook = fs.readFileSync(path.join(root, 'world-engine-worldbook.js'), 'utf8');
  check('module worldbook chấp nhận phạm vi npc', /if \(scope === 'npc'\) return 'npc';/.test(worldbook));
  check('module worldbook có khoá lưu riêng cho npc', worldbook.includes('npc_engine_worldbook_selection_'));
  check('module worldbook không còn phạm vi memory', !/'memory'/.test(worldbook));
  check('công tắc kích hoạt từ khoá đọc cấu hình của NPC Engine',
    /normalizeScope\(scope\) === 'npc'[\s\S]{0,120}NPC_ENGINE_SETTINGS/.test(worldbook));

  // Chọn mục trong giao diện mà engine không đọc thì tab đó chỉ để trang trí.
  const engine = fs.readFileSync(path.join(root, 'npc-engine.js'), 'utf8');
  check('engine thật sự đọc Sổ Tay Thế Giới khi trích xuất',
    /WORLD_ENGINE_WORLDBOOK\?\.buildPromptSection\?\.\([\s\S]{0,160}'npc'\s*\)/.test(engine));
  check('việc đọc lorebook được cách ly lỗi',
    /buildPromptSection[\s\S]{0,300}catch \(error\)/.test(engine));
  check('có công tắc worldbookEnabled gác trước', /st\.worldbookEnabled === false/.test(engine));
  // Cả hai pha đều phải nhận tư liệu: pha hai là nơi nhân vật quyết định hành động,
  // thiếu tư liệu thì hoạt động ngầm sinh ra sẽ không ăn nhập với thế giới quan.
  check('pha trích xuất nhận tư liệu', /NPC_ENGINE_PROMPT\.buildPrompt\(\{[\s\S]{0,400}worldbook,/.test(engine));
  check('pha hoạt động ngầm nhận tư liệu',
    /NPC_ENGINE_OFFSCREEN\.buildPrompt\(\{[\s\S]{0,400}worldbook: await buildWorldbookSection\(/.test(engine));
  check('hai pha dùng văn bản quét khác nhau', engine.includes('function offscreenScanText('));
}

// ===== Bản lưu và nhập/xuất =====
// Phần backend chatcache phạm vi 'npc' đã có sẵn nhưng trước đây không giao diện nào chạm tới —
// code chạy được mà không ai gọi.
{
  check('có hàm lấy phạm vi bộ nhớ đệm của npc', /forScope\?\.\('npc'\)/.test(ui));
  check('có hàm dựng danh sách bản lưu', ui.includes('function renderNpcSnapshotRows('));
  check('có hàm làm mới danh sách bản lưu', ui.includes('function refreshNpcSnapshots('));
  for (const action of ['restore', 'rename', 'export', 'delete']) {
    check(`bản lưu có thao tác ${action}`, ui.includes(`data-npc-snap-action="${action}"`));
  }
  check('tạo được bản lưu mới', ui.includes('we-npc-snap-create'));
  check('nhập được bản lưu từ tệp', ui.includes('we-npc-snap-import'));
  check('khôi phục có hỏi xác nhận', /action === 'restore'[\s\S]{0,200}confirm\(/.test(ui));

  check('xuất được toàn bộ hồ sơ', ui.includes('we-npc-export-data'));
  check('nhập được toàn bộ hồ sơ', ui.includes('we-npc-import-data'));
  check('xuất kèm cả điểm lưu', /type: 'npc-engine-state'[\s\S]{0,400}checkpoint:/.test(ui));
  check('nhập có hỏi xác nhận vì sẽ ghi đè', /payload\.state[\s\S]{0,200}confirm\(/.test(ui));
  // Nhập nhầm tệp là mất sạch hồ sơ đang có, nên phải tự sao lưu trước.
  check('nhập thì tự sao lưu trước khi ghi đè',
    /confirm\('Nhập hồ sơ này[\s\S]{0,300}createSnapshot\?\.\('Tự động trước khi nhập'\)/.test(ui));
  check('tệp lạ bị từ chối', /!payload \|\| !payload\.state/.test(ui));

  // Xem được điểm lưu đang giữ gì.
  check('có mục xem điểm lưu', /sec\('set-npc-checkpoint'/.test(ui));
  check('điểm lưu nêu số nhân vật trọng yếu', /checkpoint\.npcs \|\| \[\]\)\.filter\(npc => npc\.tier === 'core'\)/.test(ui));
}

// ===== Điền lại hàng loạt, đối soát, vòng tiến độ =====
{
  const engine = fs.readFileSync(path.join(root, 'npc-engine.js'), 'utf8');
  check('engine có hàm điền lại', engine.includes('async function backfill('));
  check('engine có hàm dừng điền lại', engine.includes('function stopBackfill('));
  check('điền lại tính vào trạng thái đang chạy', /isRunning: \(\) => running \|\| backfillRunning/.test(engine));
  check('nút dừng dừng được cả điền lại', /function abort\(\)[\s\S]{0,160}backfillRunning = false/.test(engine));
  // Chuỗi này là thứ quả cầu nổi nhận ra để vẽ vòng tiến độ đợt/tổng.
  check('báo tiến độ đúng định dạng quả cầu hiểu', /Đang điền lại \$\{current\}\/\$\{total\}/.test(engine));
  check('tự sao lưu trước khi xoá sạch', /createSnapshot\?\.\('Tự động trước khi điền lại'\)/.test(engine));
  check('giữ lại bộ nhớ đệm tuyến đường khi dựng lại', /travelCache: original\.travelCache/.test(engine));

  check('có nút bắt đầu điền lại', ui.includes('we-npc-backfill-start'));
  check('có nút dừng', ui.includes('we-npc-backfill-stop'));
  check('bắt đầu có hỏi xác nhận vì sẽ xoá sạch', /backfillStart\.onclick[\s\S]{0,400}confirm\(/.test(ui));

  check('engine có hàm đối soát lịch sử', engine.includes('function reconcileHistory('));
  check('engine có hàm chữa dữ liệu', engine.includes('function repairState('));
  check('tự đối soát khi mở cuộc trò chuyện', /CHAT_LOADED[\s\S]{0,140}reconcileHistory\(\)/.test(engine));
  check('có nút đối soát tay', ui.includes('we-npc-repair'));

  check('trang chủ có vòng tiến độ', ui.includes('we-npc-ring'));
  check('vòng đổi màu khi gần đầy', /ratio >= 1 \? 'var\(--we-danger\)'/.test(ui));
  for (const cls of ['we-npc-ring', 'we-npc-ring-text', 'we-npc-ring-value', 'we-npc-ring-label']) {
    check(`style.css có lớp .${cls}`, css.includes('.' + cls));
  }
}

// ===== Nhật ký cập nhật riêng của engine =====
{
  check('có nhật ký cập nhật riêng', ui.includes('const NPC_CHANGELOG = ['));
  check('có hàm dựng trang giới thiệu', ui.includes('function renderNpcAbout('));
  check('cắm vào tab Giới Thiệu',
    /sec\('set-npc-changelog', 'Nhật Ký Cập Nhật', renderNpcAbout\(\)\)/.test(ui));
  check('hiện phiên bản hiện tại', ui.includes('Phiên bản hiện tại v'));
  check('có ô chọn phiên bản', ui.includes('we-npc-changelog-select'));
  check('chuyển phiên bản chỉ ẩn hiện, không dựng lại',
    /changelogSelect\.onchange[\s\S]{0,300}panel\.style\.display/.test(ui));
  // Hai engine đánh số riêng, nên nhật ký cũng phải tách khỏi CHANGELOG của Thế Giới.
  check('tách khỏi nhật ký của Công Cụ Thế Giới',
    ui.indexOf('const NPC_CHANGELOG') !== ui.indexOf('const CHANGELOG'));
  check('ghi công repo tham khảo', ui.includes('world-backstage'));
}

// ===== Công cụ bỏ ẩn =====
check('có nút bỏ ẩn toàn bộ', ui.includes('we-npc-unhide-all'));
check('nút bỏ ẩn gọi đúng hàm cứu hộ', ui.includes('window.WORLD_ENGINE?.unhideAllMessages?.()'));
check('có nút cập nhật hồ sơ ngay', ui.includes('we-npc-link-now'));
check('nút cập nhật gọi manualNpcLink', ui.includes('window.WORLD_ENGINE?.manualNpcLink?.()'));

// ===== Dùng lại lớp có sẵn, không bịa lớp không tồn tại =====
// Bản nháp đầu từng dùng we-subview-head/title/poem — ba lớp không hề có trong style.css.
for (const stale of ['we-subview-head', 'we-subview-title', 'we-subview-poem']) {
  check(`không còn dùng lớp không tồn tại ${stale}`, !ui.includes(stale));
}
check('dùng lại thanh đầu trang phụ có sẵn', ui.includes('we-sub-topbar'));

// ===== CSS =====
for (const cls of ['we-ball-npc-face', 'we-npc-card', 'we-npc-axis', 'we-npc-badge',
                   'we-npc-stat', 'we-npc-rumor', 'we-npc-log-layer', 'we-npc-actions']) {
  check(`style.css có lớp .${cls}`, css.includes('.' + cls));
}
// Ba lớp dùng chung này được thêm cùng lúc vì trước đó chưa hề tồn tại.
for (const cls of ['we-hint', 'we-btn-sm', 'we-switch-row']) {
  check(`style.css có lớp dùng chung .${cls}`, css.includes('.' + cls));
}
// Mọi lớp trình bày we-npc-* đều phải có kiểu dáng, nếu không thì hiển thị vỡ.
// Chỉ xét lớp thật sự nằm trong thuộc tính class=, bỏ qua id phần tử và các lớp chỉ dùng làm
// móc sự kiện (những nút đó đã lấy kiểu dáng từ .we-btn / .we-nav-row có sẵn).
{
  const HOOK_ONLY = new Set([
    'we-npc-pin', 'we-npc-tier', 'we-npc-archive', 'we-npc-revive',
    'we-npc-nav-row', 'we-npc-nav-list',
    // Nút của trình soạn: kiểu dáng lấy từ .we-btn, lớp riêng chỉ để gắn sự kiện.
    'we-npc-edit', 'we-npc-add', 'we-npc-save', 'we-npc-delete', 'we-npc-cancel-edit', 'we-npc-peek',
    'we-npc-clear-conflicts', 'we-npc-thread-cool', 'we-npc-thread-drop',
    // Nút biểu tượng: kiểu dáng lấy từ .we-icon-btn, lớp riêng chỉ để gắn sự kiện.
    'we-npc-digest-redo'
  ]);
  const used = new Set();
  for (const attribute of ui.match(/class="[^"]*"/g) || []) {
    for (const cls of attribute.match(/we-npc-[a-z-]+/g) || []) used.add(cls);
  }
  // we-npc-f-* là móc đọc giá trị từng ô nhập; kiểu dáng đã có qua .we-npc-editor input/select/textarea.
  const missing = [...used].filter(cls =>
    !HOOK_ONLY.has(cls) && !cls.startsWith('we-npc-f-') && !css.includes('.' + cls));
  check(`mọi lớp trình bày we-npc-* đều có CSS (thiếu: ${missing.join(', ') || 'không'})`, missing.length === 0);
  check('có xét được lớp nào đó (bộ trích không rỗng)', used.size >= 8);
}
// Lớp của cả bảng điều khiển phải có kiểu dáng riêng, nếu không mặt npc trông y hệt mặt khác.
check('style.css có lớp bảng .we-npc-face', css.includes('.we-npc-face'));
{
  const open = (css.match(/\{/g) || []).length;
  const close = (css.match(/\}/g) || []).length;
  check(`ngoặc CSS cân bằng (${open} mở / ${close} đóng)`, open === close);
}

if (failures > 0) {
  console.error(`npc-engine ui tests FAILED (${failures} lỗi)`);
  process.exit(1);
}
console.log('npc-engine ui tests passed');
