// Kiểm thử assertion offline sandbox v2.3.19: tiêu chí tiêm khi reroll đổi sang dùng type gốc của Tavern (swipe/regenerate) + bỏ qua khi dryRun.
// Mô phỏng lại tương đương onGenerationStarted(type,opts,dryRun) → applyInjectionForCurrentRound(opts) của world-engine.js
// và evolve() của evolution.js với ba nhánh nền tảng/vòng (nhánh sau đã được xác nhận ở v2.3.18, ở đây chạy lại để bảo vệ hồi quy).

const assert = require('assert');

// ───────── onGenerationStarted: dịch type/dryRun của Tavern thành isReroll / có bỏ qua hay không ─────────
// Mô phỏng lại từ onGenerationStarted của world-engine.js
function onGenStarted(type, dryRun) {
  if (dryRun) return { skipped: true };            // Vòng làm nóng không đánh giá lại việc tiêm
  const isReroll = (type === 'swipe' || type === 'regenerate');
  return { skipped: false, isReroll };
}

// ───────── applyInjectionForCurrentRound(opts): reroll dựa vào opts.isReroll, ngược lại dùng chatLayer làm phương án dự phòng ─────────
// Mô phỏng lại từ applyInjectionForCurrentRound của world-engine.js
function decideInjection(state, chatLayer, checkpoint, opts) {
  const isReroll = !!(opts && opts.isReroll);
  if (isReroll) {
    if (checkpoint) return { branch: 'reroll-cp', inject: 'checkpoint', cpRound: checkpoint.round };
    return { branch: 'reroll-none', inject: 'none' };
  }
  const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
  if (chatLayer < stateLayer) {
    if (checkpoint) return { branch: 'less-cp', inject: 'checkpoint', cpRound: checkpoint.round };
    return { branch: 'less-fallback', inject: 'state' };
  }
  return { branch: 'ge-current', inject: 'state' };
}

// Vòng 6 forward hoàn tất: state.round=6, state.chatLayer=20, cp=vòng 5
function makeState6() { return { round: 6, chatLayer: 20 }; }
function cp5() { return { round: 5, chatLayer: 18 }; }

// ═══════ G1-G5: dịch type của onGenerationStarted ═══════
{
  // G1 normal sinh mới → không phải reroll, không bỏ qua
  const r = onGenStarted('normal', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: false }, 'G1');
  console.log('✓ G1 type=normal → không phải reroll');
}
{
  // G2 swipe (mũi tên) → reroll
  const r = onGenStarted('swipe', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: true }, 'G2');
  console.log('✓ G2 type=swipe → reroll');
}
{
  // G3 regenerate (nút tạo lại ở dưới cùng) → reroll ★đây chính là đường người dùng thực tế hay dùng★
  const r = onGenStarted('regenerate', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: true }, 'G3');
  console.log('✓ G3 type=regenerate → reroll (★đường thực tế người dùng dùng★)');
}
{
  // G4 dryRun (plugin database làm nóng/tính token) → bỏ qua, không đánh giá lại việc tiêm
  const r = onGenStarted('normal', true);
  assert.deepStrictEqual(r, { skipped: true }, 'G4');
  console.log('✓ G4 dryRun → bỏ qua (không còn "sinh xong lại tiêm")');
}
{
  // G5 continue (viết tiếp) → không phải reroll (viết tiếp ngay trên tầng AI hiện tại, tiêm trạng thái hiện tại)
  const r = onGenStarted('continue', false);
  assert.deepStrictEqual(r, { skipped: false, isReroll: false }, 'G5');
  console.log('✓ G5 type=continue → không phải reroll (tiêm trạng thái hiện tại)');
}

// ═══════ I1-I6: phán định việc tiêm (khắc phục hiện trường hồi quy v2.3.18) ═══════
{
  // I1 ★hồi quy cốt lõi★: gửi tin nhắn vòng mới, lúc GEN_STARTED tầng người dùng chưa chốt nên chatLayer vẫn ==20==state.chatLayer,
  //   nhưng type=normal → isReroll=false → tiêm trạng thái hiện tại (không còn bị hiểu nhầm thành tiêm điểm lưu khi reroll)
  const r = decideInjection(makeState6(), 20, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I1 branch');
  assert.strictEqual(r.inject, 'state', 'I1 inject');
  console.log('✓ I1 ★vòng mới gửi tin nhắn chatLayer==state.chatLayer nhưng type=normal → tiêm trạng thái hiện tại (khắc phục hồi quy v2.3.18)★');
}
{
  // I2 reroll thật (regenerate) cùng tầng có cp → tiêm điểm lưu
  const r = decideInjection(makeState6(), 20, cp5(), { isReroll: true });
  assert.strictEqual(r.branch, 'reroll-cp', 'I2 branch');
  assert.strictEqual(r.cpRound, 5, 'I2 cpRound=5');
  console.log('✓ I2 reroll thật (regenerate) → tiêm điểm lưu vòng 5');
}
{
  // I3 reroll thật không có cp → không tiêm
  const r = decideInjection(makeState6(), 20, null, { isReroll: true });
  assert.strictEqual(r.branch, 'reroll-none', 'I3 branch');
  console.log('✓ I3 reroll thật không có cp → không tiêm');
}
{
  // I4 tầng AI của vòng mới đã chốt (chatLayer 22 > 20) type=normal → tiêm trạng thái hiện tại
  const r = decideInjection(makeState6(), 22, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I4 branch');
  console.log('✓ I4 tầng AI vòng mới đã chốt (22>20) type=normal → tiêm trạng thái hiện tại');
}
{
  // I5 xóa lùi về tầng cũ (chatLayer 15 < 20) không phải reroll → vẫn đi nhánh < để tiêm điểm lưu
  const r = decideInjection(makeState6(), 15, cp5(), { isReroll: false });
  assert.strictEqual(r.branch, 'less-cp', 'I5 branch');
  console.log('✓ I5 xóa lùi về tầng cũ (15<20) → tiêm điểm lưu (phương án dự phòng không đổi)');
}
{
  // I6 state rỗng trước lần suy diễn đầu tiên (chatLayer bất kỳ) không phải reroll → tiêm trạng thái hiện tại (mặc định)
  const r = decideInjection({ round: 0, chatLayer: undefined }, 4, null, { isReroll: false });
  assert.strictEqual(r.branch, 'ge-current', 'I6 branch');
  console.log('✓ I6 state rỗng trước lần suy diễn đầu → tiêm trạng thái hiện tại (mặc định)');
}

// ═══════ E1-E5: bảo vệ hồi quy ba nhánh nền tảng/vòng của evolution (logic v2.3.18 không đổi) ═══════
function isNewRoundSim(fp, chatLayerNow) {
  if (fp === '' || fp == null) return true;
  return fp !== String(chatLayerNow);
}
function evolveSim({ mode, state, cp, hadStoredState, chatLayerNow, fp }) {
  const isNew = mode === 'forward' ? true : mode === 'redo' ? false : isNewRoundSim(fp, chatLayerNow);
  const isForward = isNew;
  let restored = false, rejectedRedo = false, baseSource;
  if (isForward) baseSource = 'state';
  else if (mode === 'redo') {
    if (cp) { Object.assign(state, cp); restored = true; baseSource = 'checkpoint'; }
    else return { rejectedRedo: true, roundAfter: state.round };
  } else baseSource = 'state(autoroll)';
  const roundBefore = state.round;
  let savedCheckpoint = false, label;
  if (isForward) { state.round++; if (hadStoredState) savedCheckpoint = true; label = 'forward'; }
  else label = (mode === 'redo') ? 'redo' : 'autoroll';
  state.chatLayer = chatLayerNow;
  return { baseSource, restored, rejectedRedo, label, roundAfter: state.round, roundChanged: state.round !== roundBefore, savedCheckpoint };
}
{
  // E1 tự động reroll (regenerate): fp==chatLayer → isNewRound=false → autoroll → round không đổi
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 20, fp: '20' });
  assert.strictEqual(r.label, 'autoroll', 'E1 label');
  assert.strictEqual(r.roundAfter, 6, 'E1 round không đổi=6');
  assert.strictEqual(r.savedCheckpoint, false, 'E1 không lưu điểm lưu');
  console.log('✓ E1 tự động reroll → round giữ nguyên 6 + điểm lưu không đổi');
}
{
  // E2 vòng mới tự động: fp(20)!=chatLayer(22) → isNewRound=true → forward → round++
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: undefined, state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 22, fp: '20' });
  assert.strictEqual(r.label, 'forward', 'E2 label');
  assert.strictEqual(r.roundAfter, 7, 'E2 round 7');
  console.log('✓ E2 vòng mới tự động → round 6→7 + điểm lưu dịch chuyển tới');
}
{
  // E3 redo thủ công có cp → quay lại điểm lưu round=5
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: 'redo', state: s, cp: { round: 5, chatLayer: 18, memories:[], events:[], factions:[], worldTrends:[], winds:[], enemies:[], influenceChain:[] }, hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.label, 'redo', 'E3 label'); assert.strictEqual(r.restored, true, 'E3 restored'); assert.strictEqual(r.roundAfter, 5, 'E3 round 5');
  console.log('✓ E3 redo thủ công → quay lại điểm lưu round=5');
}
{
  // E4 redo thủ công không có cp → từ chối
  const s = { round: 6, chatLayer: 20 };
  const r = evolveSim({ mode: 'redo', state: s, cp: null, hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.rejectedRedo, true, 'E4 reject');
  console.log('✓ E4 redo thủ công không có cp → từ chối');
}
{
  // E5 forward thủ công → round++
  const s = { round: 5, chatLayer: 18 };
  const r = evolveSim({ mode: 'forward', state: s, cp: cp5(), hadStoredState: true, chatLayerNow: 20 });
  assert.strictEqual(r.label, 'forward', 'E5 label'); assert.strictEqual(r.roundAfter, 6, 'E5 round 6'); assert.strictEqual(r.savedCheckpoint, true, 'E5 cp');
  console.log('✓ E5 forward thủ công → round 5→6 + điểm lưu dịch chuyển tới');
}

console.log('\nTất cả 16 assertion đã thông qua ✅ (dịch type G5 + tiêm I6 + hồi quy suy diễn E5)');
