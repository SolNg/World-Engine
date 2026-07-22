// Kiểm thử hồi quy tĩnh cho lối vào liên kết thủ công World → Memory: node docs/manual-memory-link-test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const world = fs.readFileSync(path.join(root, 'world-engine.js'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'world-engine-ui.js'), 'utf8');

assert.ok(world.includes('async function manualMemoryLink()'));
assert.ok(world.includes('window.MEMORY_ENGINE?.ingestWorldEvolution?.({'));
assert.ok(world.includes('replace: true'));
assert.ok(world.includes('force: true'));
assert.ok(world.includes('manualMemoryLink }'));
assert.ok(ui.includes('id="we-memory-link-now"'));
assert.ok(ui.includes('window.WORLD_ENGINE?.manualMemoryLink?.()'));

console.log('manual memory link tests passed');
