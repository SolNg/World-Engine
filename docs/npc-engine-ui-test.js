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

// ===== Thẻ nhân vật hiển thị đủ sáu trục =====
for (const [label, key] of [['vị trí', 'Vị trí'], ['mục tiêu', 'Mục tiêu'], ['thế lực', 'Thế lực'],
                            ['quan hệ', 'Với người chơi'], ['tri thức', 'Biết'], ['trạng thái', 'Trạng thái']]) {
  check(`thẻ nhân vật có trục ${label}`, ui.includes(`>${key}</span>`));
}
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
    'we-npc-nav-row', 'we-npc-nav-list'
  ]);
  const used = new Set();
  for (const attribute of ui.match(/class="[^"]*"/g) || []) {
    for (const cls of attribute.match(/we-npc-[a-z-]+/g) || []) used.add(cls);
  }
  const missing = [...used].filter(cls => !HOOK_ONLY.has(cls) && !css.includes('.' + cls));
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
