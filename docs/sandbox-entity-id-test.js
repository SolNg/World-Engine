// Kiểm thử hồi quy ID thực thể liên tục: node docs/sandbox-entity-id-test.js
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const storage = new Map();
global.window = global;
global.WORLD_ENGINE_STORE = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
};

const coreSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-core.js'), 'utf8');
vm.runInThisContext(coreSource, { filename: 'world-engine-core.js' });
const core = global.WORLD_ENGINE_CORE;
const ledgerSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-ledger.js'), 'utf8');
vm.runInThisContext(ledgerSource, { filename: 'world-engine-ledger.js' });
const ledger = global.WORLD_ENGINE_LEDGER;

function legacyState() {
  const state = core.getDefaultState();
  state.events = [{ name: 'Sự kiện cũ Giáp' }, { name: 'Sự kiện cũ Ất' }];
  state.factions = [{ name: 'Thế lực cũ' }];
  state.worldTrends = [{ name: 'Đại thế cũ' }];
  state.winds = [{ topic: 'Phong thanh cũ' }];
  state.enemies = [{ name: 'Kẻ thù cũ' }];
  return state;
}

// Điểm lưu cũ tự bổ sung số ổn định, tải lại nhiều lần không đổi số.
const migrated = legacyState();
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_1', 'event_2']);
assert.strictEqual(migrated.factions[0].id, 'faction_1');
assert.strictEqual(migrated.worldTrends[0].id, 'trend_1');
assert.strictEqual(migrated.winds[0].id, 'wind_1');
assert.strictEqual(migrated.enemies[0].id, 'enemy_1');
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_1', 'event_2']);

// Khi thứ tự current/checkpoint kiểu cũ khác nhau, lấy checkpoint làm gốc tổ tiên, current kế thừa ID từ đó.
storage.set('world_engine_default', JSON.stringify({
  ...core.getDefaultState(),
  events: [{ name: 'Mục mới hiện tại' }, { name: 'Sự kiện chung Giáp' }, { name: 'Sự kiện chung Ất' }]
}));
storage.set('world_engine_default_checkpoint', JSON.stringify({
  ...core.getDefaultState(),
  events: [{ name: 'Sự kiện chung Giáp' }, { name: 'Sự kiện chung Ất' }]
}));
const alignedCheckpoint = core.restoreCheckpoint();
assert.strictEqual(alignedCheckpoint.events.find(x => x.name === 'Sự kiện chung Giáp').id, 'event_1');
assert.strictEqual(alignedCheckpoint.events.find(x => x.name === 'Sự kiện chung Ất').id, 'event_2');
const alignedCurrent = core.loadState();
assert.strictEqual(alignedCurrent.events.find(x => x.name === 'Sự kiện chung Giáp').id, 'event_1');
assert.strictEqual(alignedCurrent.events.find(x => x.name === 'Sự kiện chung Ất').id, 'event_2');
assert.strictEqual(alignedCurrent.events.find(x => x.name === 'Mục mới hiện tại').id, 'event_3');

// Sửa ID trùng lặp/không hợp lệ, ID hợp lệ không bị sắp xếp lại.
migrated.events = [
  { id: 'event_7', name: 'Giáp' },
  { id: 'event_7', name: 'Ất' },
  { id: 'wrong_9', name: 'Bính' }
];
core.saveState(migrated);
assert.deepStrictEqual(migrated.events.map(x => x.id), ['event_7', 'event_8', 'event_9']);

// Cập nhật theo ID cho phép đổi tên; ID sai không được ghi đè danh tính local.
core.addEvent(migrated, { id: 'event_7', name: 'Giáp đổi tên', desc: 'Tiến triển' });
assert.strictEqual(migrated.events.find(x => x.id === 'event_7').name, 'Giáp đổi tên');
core.addEvent(migrated, { id: 'event_999', name: 'Giáp đổi tên', desc: 'Nhận diện tương thích' });
assert.strictEqual(migrated.events.find(x => x.name === 'Giáp đổi tên').id, 'event_7');

// id:null biểu thị rõ ràng đối tượng mới; dù trùng tên cũng không được ghi đè nhầm.
core.addEvent(migrated, { id: null, name: 'Giáp đổi tên', desc: 'Cùng tên nhưng khác sự kiện' });
assert.strictEqual(migrated.events.filter(x => x.name === 'Giáp đổi tên').length, 2);
assert.ok(migrated.events.some(x => x.id === 'event_10'));

// Sau khi xóa số lớn nhất hiện tại, tiếp tục theo giá trị lớn nhất của dòng thời gian hiện tại, cho phép tái sử dụng số sau khi reroll/khôi phục.
migrated.events = [{ id: 'event_1', name: 'Nền tảng' }, { id: 'event_2', name: 'Sẽ bị hủy bỏ' }];
core.saveCheckpoint(migrated);
core.addEvent(migrated, { id: null, name: 'Kết quả lần đầu' });
assert.ok(migrated.events.some(x => x.id === 'event_3'));
const restored = core.restoreCheckpoint();
core.addEvent(restored, { id: null, name: 'Kết quả sau khi reroll' });
assert.strictEqual(restored.events.find(x => x.name === 'Kết quả sau khi reroll').id, 'event_3');

// Cả năm loại thực thể đều tăng số độc lập theo tiền tố riêng của mình.
const typed = core.getDefaultState();
core.addFaction(typed, { id: null, name: 'Thế lực Giáp' });
core.addWorldTrend(typed, { id: null, name: 'Đại thế Giáp' });
core.addWind(typed, { id: null, topic: 'Phong thanh Giáp' });
core.addEnemy(typed, { id: null, name: 'Kẻ thù Giáp' });
assert.strictEqual(typed.factions[0].id, 'faction_1');
assert.strictEqual(typed.worldTrends[0].id, 'trend_1');
assert.strictEqual(typed.winds[0].id, 'wind_1');
assert.strictEqual(typed.enemies[0].id, 'enemy_1');

// Sổ cái nhận diện đổi tên theo ID: cùng một sự kiện đổi tên vẫn tính là tiến triển, cùng một tin đồn đổi topic không được tính là mục mới.
const before = core.getDefaultState();
before.round = 4;
before.events = [{ id: 'event_1', name: 'Tiêu đề cũ', type: 'conflict', level: 3, stage: 'Manh Nha', desc: 'Cũ' }];
before.winds = [{ id: 'wind_1', topic: 'Chủ đề cũ', level: 3, content: 'Cũ' }];
core.saveCheckpoint(before);
const after = JSON.parse(JSON.stringify(before));
after.round = 5;
after.events[0].name = 'Tiêu đề mới';
after.events[0].stage = 'Âm Ỉ';
after.winds[0].topic = 'Chủ đề mới';
ledger.recordChanges(after);
const ledgerChanges = after.memories[0].changes;
assert.strictEqual(ledgerChanges.filter(x => x.type === 'event_advance').length, 1);
assert.strictEqual(ledgerChanges.filter(x => x.type === 'wind_new').length, 0);

// evolution phải đặt giao thức danh tính vào trong prompt chính, nơi không thể bị preset tùy chỉnh ghi đè.
const evolutionSource = fs.readFileSync(path.join(__dirname, '..', 'world-engine-evolution.js'), 'utf8');
assert.match(evolutionSource, /ENTITY_ID_PROTOCOL/);
assert.match(evolutionSource, /id: e\.id/);
assert.match(evolutionSource, /id: f\.id/);

console.log('entity id tests passed');
