const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

assert.match(ui, /_memorySeenRecords = new Set\(\)/, 'Dữ liệu bộ nhớ cần ghi lại trạng thái đã hiển thị lần đầu');
assert.match(ui, /_memoryCollapsedRecords\.add\(key\)/, 'Dữ liệu bộ nhớ khi hiển thị lần đầu phải mặc định thu gọn');
assert.match(ui, /entity-category:\$\{type\}/, 'Thực thể phải tạo phân loại riêng theo từng loại');
for (const label of ['Tổ Chức', 'Vật Phẩm', 'Năng Lực', 'Địa Điểm']) assert.ok(ui.includes(label), `Thiếu phân loại thực thể: ${label}`);
assert.match(ui, /const cards = items\.map\(\(item, index\)/, 'Tóm tắt phải render toàn bộ dữ liệu');
assert.match(ui, /const cards = items\.map\(\(big, index\)/, 'Tổng thuật phải render toàn bộ dữ liệu');
assert.match(ui, /defaultCollapsed = index !== items\.length - 1/g, 'Tóm tắt và tổng thuật chỉ được mặc định mở rộng mục mới nhất');
assert.match(ui, /we-memory-record-head" data-memory-collapse-key=/, 'Thanh tiêu đề thẻ bộ nhớ phải hỗ trợ click vào toàn bộ khối');
assert.match(ui, /mặc định mở rộng mục mới nhất/, 'Tóm tắt và tổng thuật nên có gợi ý mặc định mở rộng dữ liệu mới nhất');
assert.match(css, /\.we-memory-entity-group > \.we-memory-record-body/, 'Phân loại thực thể cần kiểu bố cục riêng');

console.log('memory UI layout tests passed');
