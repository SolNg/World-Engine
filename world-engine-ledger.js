// world-engine-ledger.js — Sổ ghi sự kiện lớn (thuần cục bộ, thay thế module ghi nhớ cũ)
window.WORLD_ENGINE_LEDGER = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const MAX_LEDGER_ROUNDS = 20;

  function getMaxLedgerRounds() {
    const settings = window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
    const n = Number(settings.localLedgerKeepRounds);
    return Math.max(1, Math.round(Number.isFinite(n) ? n : MAX_LEDGER_ROUNDS));
  }

  const EVENT_TYPE_NAMES = { conflict: 'Xung Đột', progress: 'Tiến Triển' };
  const TERMINAL_STAGES = new Set(['Đã Hoàn Thành', 'Đã Thất Bại', 'Đã Tan Biến', 'Đã Bùng Phát']);

  /**
   * So sánh điểm lưu (trước khi suy diễn) với trạng thái hiện tại (sau khi suy diễn), ghi lại các thay đổi Lv3/4.
   * Tất cả thay đổi được gộp thành một mục, nhóm theo lượt.
   */
  function recordChanges(state) {
    const removedTerminalEvents = state._terminalEventsThisRound || [];
    delete state._terminalEventsThisRound;

    const cp = core.restoreCheckpoint();
    if (!cp) {
      core.saveState(state);
      return;
    }

    const changes = [];

    // —— Chuỗi sự kiện: thay đổi thường chỉ ghi Lv3/4, nhưng kết cục ở mọi cấp độ đều được ghi ——
    const cpEventMap = new Map((cp.events || []).map(e => [e.id || `legacy:${e.name}`, e]));
    const currentEvents = state.events || [];
    for (const ev of [...currentEvents, ...removedTerminalEvents]) {
      const isTerminal = TERMINAL_STAGES.has(ev.stage);
      if ((!ev.level || ev.level < 3) && !isTerminal) continue;
      const cpEv = cpEventMap.get(ev.id || `legacy:${ev.name}`);
      if (!cpEv) {
        changes.push({
          type: isTerminal ? 'event_terminal' : 'event_new',
          name: ev.name,
          eventType: ev.type || 'conflict',
          level: ev.level,
          stage: ev.stage || '?',
          desc: ev.desc || ''
        });
      } else if (cpEv.stage !== ev.stage) {
        changes.push({
          type: isTerminal ? 'event_terminal' : 'event_advance',
          name: ev.name,
          level: ev.level,
          fromStage: cpEv.stage || '?',
          toStage: ev.stage || '?',
          stage: ev.stage || '?',
          desc: ev.desc || ''
        });
      }
    }
    // —— Tin đồn: bổ sung Lv3/4 ——
    const cpWindIds = new Set((cp.winds || []).map(w => w.id || `legacy:${w.topic}`));
    for (const wind of (state.winds || [])) {
      if (!wind.level || wind.level < 3) continue;
      if (!cpWindIds.has(wind.id || `legacy:${wind.topic}`)) {
        changes.push({
          type: 'wind_new',
          topic: wind.topic,
          level: wind.level,
          content: wind.content || ''
        });
      }
    }

    if (changes.length === 0) {
      core.saveState(state);
      return;
    }

    // Dọn dẹp bộ nhớ định dạng cũ, xóa các bản ghi đã có trong cùng lượt (xử lý ghi đè khi reroll)
    state.memories = (state.memories || []).filter(m => {
      if (m.type !== 'ledger') return false;
      if (m.round === state.round) return false;
      return true;
    });

    state.memories.unshift({
      id: `ledger_${state.round}`,
      type: 'ledger',
      round: state.round,
      changes: changes
    });

    const maxLedgerRounds = getMaxLedgerRounds();
    if (state.memories.length > maxLedgerRounds) {
      state.memories.length = maxLedgerRounds;
    }

    core.saveState(state);
    console.log(`[World Engine] Sổ ghi chép: lượt thứ ${state.round} đã ghi ${changes.length} thay đổi`);
  }

  /** Xây dựng văn bản sổ ghi chép dùng để chèn (inject) vào ngữ cảnh */
  function buildLedgerText(state) {
    const entries = (state.memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return 'Hiện chưa có ghi chép sự kiện lớn nào';

    return entries.map(entry => {
      const lines = [`Lượt ${entry.round} (${entry.changes.length} thay đổi):`];
      for (const c of entry.changes) {
        if (c.type === 'event_new') {
          const tn = EVENT_TYPE_NAMES[c.eventType] || c.eventType;
          lines.push(`  [Chuỗi Sự Kiện Mới Lv${c.level} - Loại ${tn}] ${c.name} - ${c.stage} - ${c.desc}`);
        } else if (c.type === 'event_advance') {
          lines.push(`  [Chuỗi Sự Kiện Tiến Triển] ${c.name}(Lv${c.level}) ${c.fromStage}->${c.toStage} - ${c.desc}`);
        } else if (c.type === 'event_terminal') {
          lines.push(`  [Chuỗi Sự Kiện Kết Thúc] ${c.name}(Lv${c.level}) ${c.fromStage ? c.fromStage + '->' : ''}${c.stage || c.toStage} - ${c.desc}`);
        } else if (c.type === 'wind_new') {
          lines.push(`  [Tin Đồn Mới Lv${c.level}] ${c.topic} - ${c.content}`);
        }
      }
      return lines.join('\n');
    }).join('\n\n');
  }

  return { recordChanges, buildLedgerText };
})();
