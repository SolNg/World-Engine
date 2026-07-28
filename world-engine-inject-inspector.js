// world-engine-inject-inspector.js — Bộ xem tự kiểm tra việc chèn (tách rời / chỉ đọc thuần túy)
//
// Vì sao có module này: registerInjection() trả về true chỉ có nghĩa là "gọi ST setExtensionPrompt không ném lỗi",
//   chứ không hề chứng minh đoạn trạng thái thế giới đó đã thực sự đi vào prompt cuối cùng gửi cho model lớn. Khi khách hàng báo "chèn không thành công" thì không có cách nào phán đoán, và bản thân chúng ta cũng không phán đoán được.
//   Module này đăng ký lắng nghe hai "sự kiện vàng" của ST, đọc **chuỗi prompt mà ST thực sự ghép lại sau khi chúng ta đã chèn**, phân theo role,
//   rồi dùng ngôn ngữ dễ hiểu để phán đoán việc chèn của vòng này: ✅ thành công / ❌ đã đăng ký nhưng không vào được nội dung chính / ⏸ bỏ qua theo thiết kế (đã tắt hoặc reroll cùng tầng) / — chưa sinh ra.
//
// Nguyên tắc bất di bất dịch (tuyệt đối không được gây bug):
//   - Chỉ đọc thuần túy: chỉ đọc eventData của sự kiện, ctx.extensionPrompts, các getter của core/api; không ghi bất kỳ bộ nhớ nào, không thay đổi logic chèn, không đụng đến cấu trúc dữ liệu.
//   - Tuyệt đối không mutate eventData (không ghi .prompt / .chat).
//   - Không giữ tham chiếu live: lập tức sao chép thành đối tượng mô tả nhẹ + sao chép chuỗi.
//   - Toàn bộ handler được bọc try/catch chặt chẽ: kể cả khi ST đổi phiên bản làm hình dạng eventData thay đổi, throw cũng bị nuốt, tuyệt đối không ảnh hưởng đến việc sinh nội dung.
//   - Chỉ giữ lại snapshot cuối cùng, bộ nhớ có giới hạn.
//
// Chi phí gỡ bỏ: xóa file này + xóa một dòng trong MODULES của world-engine.js + xóa một dòng init (+ xóa thẻ trên cùng renderDebug của UI + đoạn diag).
window.WORLD_ENGINE_INJECT_INSPECTOR = (function() {
  'use strict';

  // Tương ứng với INJECTION_NAME của world-engine.js (key mà chúng ta dùng để đăng ký vào ST extension_prompts).
  const INJECTION_NAME = 'world-engine-world';
  const NPC_INJECTION_NAME = 'npc_engine_context';

  // Điểm neo hạ cánh: đầu ra của buildContext() luôn bắt đầu bằng "【世界信息】" (world-engine-inject.js),
  //   chuỗi con này không chứa bất kỳ macro {{...}} nào, không bị ST substituteParams viết lại → dùng nó để phán đoán "chèn có vào được prompt cuối cùng hay không" là ổn định nhất.
  //   (Lưu ý: nếu indexOf trên toàn bộ chuỗi chèn sẽ bị âm tính giả do các macro như {{user}} bị mở rộng, nên chỉ tin vào điểm neo không có macro này.)
  const SENTINEL = '【世界信息】';
  const NPC_SENTINEL = '【TRẠNG THÁI NHÂN VẬT NỀN】';

  // Tên sự kiện (nghĩa đen; lúc chạy ưu tiên dùng hằng số trong ctx.event_types, nếu không lấy được thì quay về nghĩa đen).
  const EV_TEXT = 'generate_after_combine_prompts';   // Text Completion / API cổ điển: eventData={prompt,dryRun}
  const EV_CHAT = 'chat_completion_prompt_ready';      // Chat Completion / dạng OpenAI: eventData={chat:[{role,content}],dryRun}

  let _subscribed = false;
  let _last = null;  // Chỉ giữ lại snapshot cuối cùng
  let _lastNpc = null;

  function getCtx() {
    try { return (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null; }
    catch (e) { return null; }
  }

  // —— Thu thập các trường môi trường chỉ đọc ngay tại thời điểm sự kiện xảy ra (lúc này extension_prompts vẫn đang giữ đăng ký của vòng này) ——
  function snapEnv(ctx, scope) {
    const npcScope = scope === 'npc';
    const api = window.WORLD_ENGINE_API;
    const core = window.WORLD_ENGINE_CORE;
    let injectEnabled = true, registeredAtSend = false, sameLayerReroll = false, round = null;

    try {
      const settings = npcScope ? window.NPC_ENGINE_SETTINGS?.getSettings?.(true) : (api && api.getSettings ? api.getSettings(true) : {});
      injectEnabled = settings?.injectIntoPrompt !== false;
    } catch (e) {}

    // Xác nhận độc lập "vòng này chúng ta có thực sự đăng ký hay không" — phân biệt "đã đăng ký nhưng không hạ cánh = bug thật" với "chúng ta tự không đăng ký = bỏ qua theo thiết kế".
    try {
      const ep = ctx && ctx.extensionPrompts;
      const entry = ep && ep[npcScope ? NPC_INJECTION_NAME : INJECTION_NAME];
      registeredAtSend = !!(entry && entry.value && String(entry.value).length);
    } catch (e) {}

    // Tiêu chí reroll cùng tầng (dùng cùng cách tính fingerprint như applyInjectionForCurrentRound trong world-engine.js).
    try {
      const fp = core && core.loadFingerprint ? core.loadFingerprint() : '';
      const fpLayer = (fp !== '' && Number.isFinite(Number(fp))) ? Number(fp) : null;
      const chatLayer = core && core.getChatLayer ? core.getChatLayer() : null;
      sameLayerReroll = (fpLayer != null && chatLayer != null && fpLayer === chatLayer);
    } catch (e) {}

    try { round = core && core.loadState ? core.loadState().round : null; } catch (e) {}

    return { injectEnabled, registeredAtSend, sameLayerReroll, round };
  }

  // —— Chat Completion: thu thập chuỗi role đã phân loại từ mảng chat cuối cùng thật sự (sao chép, không giữ tham chiếu live) ——
  //   Mỗi mục đều sao chép content đầy đủ để UI mở rộng chỉ đọc (người dùng cần đối chiếu nội dung thực tế của tất cả role, không chỉ mục chúng ta chèn).
  //   Chỉ giữ lại snapshot cuối cùng, bộ nhớ có giới hạn; phía xuất diag không mang content (quyền riêng tư: chứa nguyên văn thẻ nhân vật/sách thế giới/lịch sử chat).
  function snapChat(chat, env, scope) {
    const sentinel = scope === 'npc' ? NPC_SENTINEL : SENTINEL;
    const messages = [];
    let landed = false, ourContent = '', ourIndex = -1;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i] || {};
      const content = (m.content != null) ? String(m.content) : '';
      const isOurs = content.indexOf(sentinel) >= 0;
      messages.push({ role: m.role || '?', length: content.length, isOurs: isOurs, content: content });
      if (isOurs && !landed) {
        landed = true;
        ourIndex = i;
        ourContent = content; // Dữ liệu trạng thái thế giới của chính chúng ta, giữ nguyên đầy đủ
      }
    }
    return {
      apiType: 'chat',
      ts: nowTs(),
      round: env.round,
      injectEnabled: env.injectEnabled,
      registeredAtSend: env.registeredAtSend,
      sameLayerReroll: env.sameLayerReroll,
      landed: landed,
      messageCount: messages.length,
      messages: messages,
      ourIndex: ourIndex,
      ourContent: ourContent,
      status: deriveStatus(env, landed),
    };
  }

  // —— Text Completion: prompt đã được flatten thành một chuỗi duy nhất, chuỗi không thể phân theo role; chỉ lưu độ dài + có khớp điểm neo hay không + đoạn trích quanh điểm neo ——
  function snapText(prompt, env, scope) {
    const text = String(prompt || '');
    const idx = text.indexOf(scope === 'npc' ? NPC_SENTINEL : SENTINEL);
    const landed = idx >= 0;
    let excerpt = '';
    if (landed) {
      const a = Math.max(0, idx - 40);
      const b = Math.min(text.length, idx + 300);
      excerpt = (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '');
    }
    return {
      apiType: 'text',
      ts: nowTs(),
      round: env.round,
      injectEnabled: env.injectEnabled,
      registeredAtSend: env.registeredAtSend,
      sameLayerReroll: env.sameLayerReroll,
      landed: landed,
      promptLength: text.length,
      ourExcerpt: excerpt,
      status: deriveStatus(env, landed),
    };
  }

  // —— Máy trạng thái: suy ra thuần túy từ các trường chỉ đọc, trung thực không nói quá ——
  function deriveStatus(env, landed) {
    if (!env.injectEnabled) return 'SKIPPED_DISABLED';
    if (!env.registeredAtSend) return env.sameLayerReroll ? 'SKIPPED_REROLL' : 'SKIPPED_OTHER';
    return landed ? 'SUCCESS' : 'MISSING';
  }

  function nowTs() { try { return Date.now(); } catch (e) { return 0; } }

  // —— Xử lý sự kiện: dùng chung khung sườn, toàn bộ đều try/catch, dryRun luôn bỏ qua, tuyệt đối không thay đổi eventData ——
  function onChatPromptReady(eventData) {
    try {
      if (!eventData || eventData.dryRun) return;            // Bỏ qua vòng làm nóng để tính token
      if (!Array.isArray(eventData.chat)) return;            // Phòng thủ về hình dạng dữ liệu
      const ctx = getCtx();
      _last = snapChat(eventData.chat, snapEnv(ctx, 'world'), 'world');
      _lastNpc = snapChat(eventData.chat, snapEnv(ctx, 'npc'), 'npc');
    } catch (e) { /* Tự kiểm tra chỉ đọc tuyệt đối không ảnh hưởng đến việc sinh nội dung */ }
  }

  function onTextPromptReady(eventData) {
    try {
      if (!eventData || eventData.dryRun) return;
      if (typeof eventData.prompt !== 'string') return;
      const ctx = getCtx();
      _last = snapText(eventData.prompt, snapEnv(ctx, 'world'), 'world');
      _lastNpc = snapText(eventData.prompt, snapEnv(ctx, 'npc'), 'npc');
    } catch (e) {}
  }

  // —— Khởi tạo: đăng ký lắng nghe các sự kiện vàng (bảo vệ đăng ký đơn, được gọi tường minh từ điểm vào chính, tránh tranh chấp thời điểm tải) ——
  function init() {
    if (_subscribed) return;
    try {
      const ctx = getCtx();
      if (!ctx || !ctx.eventSource || typeof ctx.eventSource.on !== 'function') {
        console.warn('[World Engine] Tự kiểm tra việc chèn: eventSource không khả dụng, bỏ qua đăng ký');
        return;
      }
      const et = ctx.event_types || {};
      ctx.eventSource.on(et.CHAT_COMPLETION_PROMPT_READY || EV_CHAT, onChatPromptReady);
      ctx.eventSource.on(et.GENERATE_AFTER_COMBINE_PROMPTS || EV_TEXT, onTextPromptReady);
      _subscribed = true;
      console.log('[World Engine] Bộ xem tự kiểm tra việc chèn đã sẵn sàng (chỉ đọc, lắng nghe sự kiện prompt-ready)');
    } catch (e) {
      console.warn('[World Engine] Đăng ký tự kiểm tra việc chèn thất bại (không nghiêm trọng):', e && e.message);
    }
  }

  // Trả về snapshot cuối cùng (tham chiếu bản sao chỉ đọc; UI/diag chỉ đọc không ghi). Không có thì trả về null.
  function getLastSnapshot(scope) {
    if (scope === 'npc') return _lastNpc;
    if (scope == null || scope === '' || scope === 'world') return _last;
    throw new Error(`Scope kiểm tra chèn không xác định: ${scope}`);
  }

  // Mã trạng thái → ngôn ngữ dễ hiểu (UI và diag dùng chung, một nguồn chân lý duy nhất).
  const STATUS_TEXT = {
    NOT_YET: 'Chưa sinh nội dung, hiện chưa có bản ghi chèn',
    SKIPPED_DISABLED: 'Vòng này không chèn: chèn vào nội dung chính đã bị tắt (công tắc/thiết lập)',
    SKIPPED_REROLL: 'Vòng này không chèn theo thiết kế: reroll cùng tầng (swipe/tạo lại)',
    SKIPPED_OTHER: 'Vòng này không chèn: chưa kích hoạt suy diễn hoặc không có trạng thái thế giới',
    SUCCESS: '✅ Vòng này đã chèn thành công trạng thái thế giới vào nội dung chính',
    MISSING: '❌ Đã đăng ký nhưng không vào được prompt cuối cùng — đây mới là lỗi chèn thật sự (nghi bị extension khác xóa/vượt quá độ sâu)',
  };
  function statusText(status, scope) {
    const text = STATUS_TEXT[status] || STATUS_TEXT.NOT_YET;
    return scope === 'npc' ? text.replace(/trạng thái thế giới/g, 'thông tin nhân vật').replace(/không có trạng thái thế giới/g, 'không có thông tin nhân vật') : text;
  }

  return { init, getLastSnapshot, statusText, SENTINEL, NPC_SENTINEL };
})();
