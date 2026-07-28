const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const world = fs.readFileSync(path.join(root, 'world-engine.js'), 'utf8');

assert.match(
  ui,
  /targetActive\s*=\s*Boolean\(callEngineFace\(target,\s*'isRunning'/,
  'Lối vào ở góc dưới bên phải phải đọc trạng thái hoạt động của engine còn lại'
);
assert.match(
  ui,
  /classList\.toggle\('we-sat-engine-running',\s*targetActive\)/,
  'Lối vào ở góc dưới bên phải phải chuyển đổi class hiệu ứng chạy theo trạng thái của engine còn lại'
);
assert.match(
  css,
  /we-sat-target-npc\.we-sat-engine-running::before/,
  'Lối vào NPC Engine phải có hiệu ứng chạy độc lập'
);
assert.match(
  css,
  /we-sat-target-world\.we-sat-engine-running::after/,
  'Lối vào World Engine phải có hiệu ứng chạy độc lập'
);

const worldComplete = world.indexOf("setStatus('Suy diễn thế giới hoàn tất')");
const worldUiStop = world.indexOf('ui.setEvolvingUI(false)', worldComplete);
const worldUiRefresh = world.indexOf('ui.refresh(true)', worldComplete);
const npcLinkStart = world.indexOf('await window.NPC_ENGINE?.ingestWorldEvolution?.');
assert.ok(worldComplete >= 0 && worldUiStop > worldComplete && worldUiRefresh > worldUiStop,
  'Sau khi API thế giới hoàn tất, phải dừng hiệu ứng thế giới rồi mới làm mới giao diện thế giới');
assert.ok(npcLinkStart > worldUiRefresh,
  'Liên kết nhân vật chỉ được bắt đầu sau khi hiệu ứng thế giới đã dừng và giao diện đã được làm mới');

console.log('engine switch animation tests passed');
