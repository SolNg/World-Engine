// world-engine.js — Điểm khởi đầu chính: tải module, gắn sự kiện, tiêm suy diễn
(function() {
  if (window.__WORLD_ENGINE_LOADED__) return;
  window.__WORLD_ENGINE_LOADED__ = true;

  // ST sẽ await hàm này trước khi ráp prompt chính thức; ở đây chỉ gỡ bỏ tóm tắt đã hết hiệu lực và khôi phục văn bản gốc, tuyệt đối không gọi API.
  // Việc sửa API cho ký ức lịch sử được dồn lại, thực hiện sau khi AI trả lời xong lượt này.
  window.worldEngineMemoryGenerateInterceptor = async function(_chat, _contextSize, _abort, _type) {
    try {
      await window.MEMORY_ENGINE?.prepareHistoryForGeneration?.();
    } catch (error) {
      // Gỡ bỏ tóm tắt cũ ở phía client thất bại không chặn việc chat bình thường; ở đây không có yêu cầu API nào chạy nền.
      console.error('[Công Cụ Ký Ức] Gỡ bỏ tóm tắt hết hiệu lực trước khi sinh thất bại', error);
    }
  };

  // Tất cả các công cụ dùng chung một ranh giới xử lý lỗi sự kiện: ngoại lệ đồng bộ lẫn rejection bất đồng bộ đều chỉ được ghi vào công cụ tương ứng.
  window.WORLD_ENGINE_GUARD_EVENT = function(engineLabel, eventLabel, handler) {
    return function(...args) {
      try {
        const result = handler(...args);
        if (result && typeof result.then === 'function') {
          return result.catch(error => {
            console.error(`[${engineLabel}] Xử lý sự kiện ${eventLabel} thất bại`, error);
          });
        }
        return result;
      } catch (error) {
        console.error(`[${engineLabel}] Xử lý sự kiện ${eventLabel} thất bại`, error);
      }
    };
  };

  const SHARED_MODULES = [
    'world-engine-store.js',
    'world-engine-core.js',
    'world-engine-api.js',
    'world-engine-worldbook.js',
    'world-engine-chatcache.js',
    'world-engine-inject-inspector.js'
  ];
  const SHARED_CONTRACTS = {
    WORLD_ENGINE_STORE: ['hydrate', 'getItem', 'setItem'],
    WORLD_ENGINE_CORE: ['getChatId', 'loadState'],
    WORLD_ENGINE_API: ['callApi'],
    WORLD_ENGINE_WORLDBOOK: ['buildPromptSection'],
    WORLD_ENGINE_CHATCACHE: ['init'],
    WORLD_ENGINE_INJECT_INSPECTOR: ['init']
  };

  // Các công cụ có vị thế ngang hàng, tải theo thứ tự đăng ký; Thế Giới chỉ có mức ưu tiên khởi động cao nhất khi cần phải chọn một.
  const ENGINE_MODULE_GROUPS = [
    {
      id: 'world', label: 'Công Cụ Thế Giới', modules: [
        'world-engine-preset.js',
        'world-engine-rules-loader.js',
        'world-engine-ledger.js',
        'world-engine-evolution.js',
        'world-engine-inject.js'
      ],
      contracts: {
        WORLD_ENGINE_PRESET: ['getActivePreset'],
        WORLD_ENGINE_RULES: ['loadRules'],
        WORLD_ENGINE_LEDGER: ['recordChanges'],
        WORLD_ENGINE_EVOLUTION: ['evolve', 'abort', 'isRunning'],
        WORLD_ENGINE_INJECT: ['buildContext']
      }
    },
    {
      id: 'memory', label: 'Công Cụ Ký Ức', modules: [
        'memory-engine-settings.js',
        'memory-engine-data.js',
        'memory-engine-timeline.js',
        'memory-engine-prompt.js',
        'memory-engine-small-summary-prompt.js',
        'memory-engine-big-summary-prompt.js',
        'memory-engine.js'
      ],
      contracts: {
        MEMORY_ENGINE_SETTINGS: ['getSettings', 'patchSettings'],
        MEMORY_ENGINE_DATA: ['loadState', 'saveState'],
        MEMORY_ENGINE_TIMELINE: ['captureRange', 'auditRefs', 'syncHidden'],
        MEMORY_ENGINE_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE_SMALL_SUMMARY_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE_BIG_SUMMARY_PROMPT: ['buildUserPrompt'],
        MEMORY_ENGINE: ['init', 'applyInjection', 'abort', 'isRunning']
      }
    }
  ];

  const SHARED_UI_MODULES = ['world-engine-diag.js', 'world-engine-ui.js'];
  const SHARED_UI_CONTRACTS = {
    WORLD_ENGINE_DIAG: ['collect', 'download'],
    WORLD_ENGINE_UI: ['buildPanel', 'buildInputButton', 'refresh']
  };

  function getBaseUrl() {
    const scripts = document.getElementsByTagName('script');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].src;
      if (src && src.includes('world-engine.js')) {
        return src.substring(0, src.lastIndexOf('/'));
      }
    }
    return './plugins/world-engine';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Tải thất bại: ' + src));
      document.head.appendChild(s);
    });
  }

  function validateContracts(label, contracts) {
    const missing = [];
    for (const [globalName, methods] of Object.entries(contracts || {})) {
      const api = window[globalName];
      if (!api) {
        missing.push(globalName);
        continue;
      }
      for (const method of methods) {
        if (typeof api[method] !== 'function') missing.push(`${globalName}.${method}()`);
      }
    }
    if (missing.length) throw new Error(`Hợp đồng giao diện ${label} không đầy đủ: ${missing.join(', ')}`);
  }

  async function loadEngineGroup(baseUrl, group) {
    try {
      for (const mod of group.modules) {
        await loadScript(baseUrl + '/' + mod);
        console.log(`[${group.label}] Đã tải:`, mod);
      }
      validateContracts(group.label, group.contracts);
      return true;
    } catch (error) {
      console.error(`[${group.label}] Tải module thất bại`, error);
      return false;
    }
  }

  async function loadRequiredModules(baseUrl, modules, label) {
    for (const mod of modules) {
      await loadScript(baseUrl + '/' + mod);
      console.log(`[${label}] Đã tải:`, mod);
    }
  }

  async function init() {
    const baseUrl = getBaseUrl();
    const loadedEngines = new Map();
    let sharedRuntimeReady = false;
    console.log('[Công Cụ Thế Giới] Đang tải...');

    try {
      await loadRequiredModules(baseUrl, SHARED_MODULES, 'Nền Tảng Dùng Chung');
      validateContracts('Nền Tảng Dùng Chung', SHARED_CONTRACTS);
      for (const group of ENGINE_MODULE_GROUPS) {
        loadedEngines.set(group.id, await loadEngineGroup(baseUrl, group));
      }
      await loadRequiredModules(baseUrl, SHARED_UI_MODULES, 'Giao Diện Dùng Chung');
      validateContracts('Giao Diện Dùng Chung', SHARED_UI_CONTRACTS);

      // Đọc số phiên bản mở rộng (từ manifest.json, nguồn chân lý duy nhất) để hiển thị trên UI; thất bại không chặn khởi động
      try {
        const resp = await fetch(baseUrl + '/manifest.json', { cache: 'no-cache' });
        if (resp && resp.ok) {
          const mf = await resp.json();
          if (mf && mf.version) window.WORLD_ENGINE_VERSION = String(mf.version);
        }
      } catch (e) { /* Không đọc được số phiên bản không ảnh hưởng chức năng, phía UI tự ẩn đi */ }

      // Nạp dữ liệu lưu trữ vào bản sao trong bộ nhớ trước (đồng thời di chuyển dữ liệu localStorage cũ), sau đó mọi thao tác đọc/ghi đồng bộ mới có dữ liệu
      if (window.WORLD_ENGINE_STORE) {
        await window.WORLD_ENGINE_STORE.hydrate();
      }

      // Bộ nhớ đệm của Tavern: thiết lập khe đồng bộ và khôi phục/hội tụ một lần cho cuộc trò chuyện hiện tại (phải làm trước lần tiêm nội dung đầu tiên, để việc tiêm dùng được trạng thái đã đồng bộ)
      if (window.WORLD_ENGINE_CHATCACHE) {
        window.WORLD_ENGINE_CHATCACHE.init();
      }
      sharedRuntimeReady = true;

      // Trình kiểm tra tiêm tự động: chỉ đăng ký lắng nghe (read-only) sự kiện prompt-ready của ST, đối chiếu xem trạng thái thế giới có thực sự vào được prompt cuối cùng hay không (tách rời, đăng ký thất bại không chặn khởi động)
      if (window.WORLD_ENGINE_INJECT_INSPECTOR) {
        try { window.WORLD_ENGINE_INJECT_INSPECTOR.init(); } catch (e) { console.warn('[Công Cụ Thế Giới] Khởi tạo tự kiểm tra tiêm thất bại (không nghiêm trọng)', e); }
      }

      const core = window.WORLD_ENGINE_CORE;
      const api = window.WORLD_ENGINE_API;
      const ledger = window.WORLD_ENGINE_LEDGER;
      const evolution = window.WORLD_ENGINE_EVOLUTION;
      const inject = window.WORLD_ENGINE_INJECT;
      const ui = window.WORLD_ENGINE_UI;
      const rulesLoader = window.WORLD_ENGINE_RULES;

      // Khi nhóm Thế Giới tự thất bại, nền tảng dùng chung và các công cụ khác đã tải vẫn có thể hoạt động độc lập.
      // Thế Giới xếp đầu tiên chỉ là do độ ưu tiên, không phải vì các công cụ khác phụ thuộc vào nó để chạy.
      if (!loadedEngines.get('world')) {
        console.error('[Công Cụ Thế Giới] Module công cụ không khả dụng; tiếp tục khởi động các công cụ khác đã tải');
        try {
          ui?.buildPanel?.();
          ui?.buildInputButton?.();
        } catch (e) { console.warn('[Giao Diện Dùng Chung] Khởi tạo thất bại', e); }
        return;
      }

      // Tải toàn bộ quy tắc của công cụ sống (quy tắc đã được tích hợp sẵn trong JS, không cần yêu cầu mạng)
      let rulesCount = 0;
      try {
        const result = await rulesLoader.loadRules();
        rulesCount = result.count || 0;
        console.log('[Công Cụ Thế Giới] 📜 Quy tắc công cụ sống đã sẵn sàng, tổng cộng', rulesCount, 'điều');
      } catch(e) {
        console.warn('[Công Cụ Thế Giới] Lỗi khi tải quy tắc (không nghiêm trọng):', e.message);
      }

      let isEvolving = false;
      let autoEvolveTimer = null;
      let lastProcessedMessageKey = '';
      const AUTO_EVOLVE_DELAY = 1500;

      // ========== Quản Lý Tiêm ==========
      const INJECTION_NAME = 'world-engine-world';

      // injection_position=1 nghĩa là In-Chat (chèn vào luồng trò chuyện), depth=1 là vị trí ngay trước tin nhắn của người dùng
      // tương ứng với injection_position:1 / injection_depth:1 trong JSON preset
      const INJ_POSITION = 1;
      const INJ_DEPTH = 1;

      function registerInjection(content) {
        try {
          const ctx = SillyTavern.getContext();
          if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(INJECTION_NAME, content, INJ_POSITION, INJ_DEPTH);
            return true;
          }
          if (typeof ctx.registerInjection === 'function') {
            if (typeof ctx.unregisterInjection === 'function') {
              ctx.unregisterInjection(INJECTION_NAME);
            }
            ctx.registerInjection(INJECTION_NAME, content, { position: INJ_POSITION, depth: INJ_DEPTH, role: 'system' });
            return true;
          }
          if (Array.isArray(ctx.extensionPrompts)) {
            ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
            ctx.extensionPrompts.push({
              name: INJECTION_NAME, content,
              role: 'system', position: INJ_POSITION, depth: INJ_DEPTH
            });
            return true;
          }
          console.warn('[Công Cụ Thế Giới] Không có phương thức tiêm nào khả dụng');
          return false;
        } catch(e) {
          console.error('[Công Cụ Thế Giới] Tiêm thất bại', e);
          return false;
        }
      }

      function unregisterInjection() {
        try {
          const ctx = SillyTavern.getContext();
          if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(INJECTION_NAME, '', INJ_POSITION, INJ_DEPTH); // Xóa nội dung tức là hủy tiêm
          } else if (typeof ctx.unregisterInjection === 'function') {
            ctx.unregisterInjection(INJECTION_NAME);
          } else if (Array.isArray(ctx.extensionPrompts)) {
            ctx.extensionPrompts = ctx.extensionPrompts.filter(p => p.name !== INJECTION_NAME);
          }
        } catch(e) {}
      }

      // ========== Tiêm Trạng Thái Thế Giới Vào Prompt Chính ==========
      // stateOverride: nếu được truyền vào thì dùng trạng thái đó (khi reroll dùng điểm lưu), nếu không thì dùng trạng thái hiện tại
      function applyInjection(stateOverride) {
        try {
          if (api.getSettings(true).injectIntoPrompt === false) {
            unregisterInjection();
            console.log('[Công Cụ Thế Giới] Tiêm nội dung chính đã bị tắt trong cài đặt');
            return;
          }
          const ctx = SillyTavern.getContext();
          if (!ctx) return;
          const state = stateOverride || core.loadState();
          const currentRound = state.round;

          const chatHistory = ctx.chat || [];
          const recentChat = chatHistory.slice(-5);
          const recent = recentChat.map(m => (m.mes || '')).join(' ');

          const tags = [];
          // Dò tên nhân vật kiểu "Tên Riêng + động từ nói năng" (vd "Trương Tam nói", "A Kiệt hỏi"); STOPWORDS lọc bỏ đại từ/liên từ viết hoa đầu câu dễ bị nhận nhầm.
          const namePattern = /(\p{Lu}[\p{L}\d]*(?:\s+\p{Lu}[\p{L}\d]*){0,3})\s+(?:nói|hỏi|đáp|bảo|gọi|quát|thì thầm|hét lên|thốt lên|thở dài|cười|nhắc|giục|than thở|rên rỉ)\b/gu;
          const STOPWORDS = ['Anh','Chị','Em','Cô','Chú','Bác','Ông','Bà','Nó','Hắn','Họ','Chúng','Tôi','Ta','Mình','Ai','Gì','Sao','Vậy','Rồi','Nhưng','Và','Khi','Lúc','Nếu','Dù'];
          let m;
          while ((m = namePattern.exec(recent)) !== null) {
            if (!STOPWORDS.includes(m[1])) {
              tags.push(m[1]);
            }
          }
          for (const ev of state.events || []) tags.push(ev.name);
          for (const f of state.factions || []) tags.push(f.name);

          const context = inject.buildContext(state, tags);

          // Chỉ ghi lại khi dùng trạng thái hiện tại (trạng thái điểm lưu không nên bị ghi đè)
          if (!stateOverride && core.hasState()) {
            state.lastInjection = { timestamp: Date.now(), round: currentRound, context, tagsUsed: tags };
            core.saveState(state);
          }

          registerInjection(context);
          console.log(`[Công Cụ Thế Giới] Tiêm hoàn tất (round ${currentRound}, ${context.length} chars)${stateOverride ? ' [Điểm Lưu]' : ''}`);
        } catch(e) {
          console.error('[Công Cụ Thế Giới] Xử lý tiêm thất bại', e);
        }
      }

      // Chọn trạng thái thế giới nào để tiêm trước khi ráp nội dung chính:
      //   Reroll (Tavern type=swipe/regenerate, do bên gọi truyền opts.isReroll) → tiêm điểm lưu (trạng thái trước khi tầng nội dung này được tạo ra);
      //   Xóa lùi về tầng cũ (chatLayer < state.chatLayer) → tiêm điểm lưu;
      //   Nếu không (sinh mới/lượt mới/viết tiếp) → tiêm trạng thái hiện tại.
      function applyInjectionForCurrentRound(opts) {
        if (api.getSettings(true).engineEnabled === false) {
          unregisterInjection();
          return;
        }
        const state = core.loadState();
        const chatLayer = core.getChatLayer();
        const isReroll = !!(opts && opts.isReroll);

        // [FIX v2.3.19] Tiêu chí xác định reroll đổi sang dùng type gốc của Tavern (swipe/regenerate), không còn dùng số chatLayer===state.chatLayer.
        //   Tiêu chí thuần số của v2.3.18 có hồi quy: GENERATION_STARTED được emit **trước khi** tầng của người dùng được push vào chat, nên khi gửi tin nhắn ở lượt mới
        //   chatLayer vẫn == state.chatLayer của lượt trước, bị hiểu nhầm là reroll và tiêm nhầm điểm lưu (người dùng "không reroll nhưng lại bị tiêm trạng thái cũ").
        //   Tín hiệu reroll thực sự đáng tin cậy là tham số type của GENERATION_STARTED bên Tavern (swipe/regenerate), xem onGenerationStarted.
        if (isReroll) {
          const checkpoint = core.restoreCheckpoint();
          if (checkpoint) {
            console.log('[Công Cụ Thế Giới] Xác định tiêm nội dung: reroll (type=swipe/regenerate), tiêm điểm lưu');
            applyInjection(checkpoint);
            if (ui && ui.setInjectedScope) ui.setInjectedScope('checkpoint');
          } else {
            console.log('[Công Cụ Thế Giới] Xác định tiêm nội dung: reroll (type=swipe/regenerate), không có điểm lưu, không tiêm');
            unregisterInjection();
          }
          if (ui && ui.refresh) ui.refresh(true);
          return;
        }

        const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
        let injectedScope = 'state';
        if (chatLayer < stateLayer) {
          const checkpoint = core.restoreCheckpoint();
          if (checkpoint) {
            injectedScope = 'checkpoint';
            console.log(`[Công Cụ Thế Giới] Xác định tiêm nội dung: số tầng hội thoại ${chatLayer} < số tầng trạng thái hiện tại ${stateLayer}, tiêm điểm lưu`);
            applyInjection(checkpoint);
          } else {
            console.warn(`[Công Cụ Thế Giới] Xác định tiêm nội dung: số tầng hội thoại ${chatLayer} < số tầng trạng thái hiện tại ${stateLayer}, nhưng không có điểm lưu, quay về dùng trạng thái hiện tại`);
            applyInjection();
          }
        } else {
          console.log(`[Công Cụ Thế Giới] Xác định tiêm nội dung: số tầng hội thoại ${chatLayer} >= số tầng trạng thái hiện tại ${stateLayer}, tiêm trạng thái hiện tại`);
          applyInjection();
        }
        // Sau khi tiêm nội dung, làm mới bảng điều khiển để "trạng thái hiện tại" khớp với phần thực sự đã tiêm:
        // Reroll / xóa lùi về tầng cũ → hiển thị điểm lưu; nếu không → hiển thị trạng thái hiện tại.
        if (ui && ui.setInjectedScope) ui.setInjectedScope(injectedScope);
        if (ui && ui.refresh) ui.refresh(true);
      }

      // ========== Sau Khi Nhận Được Phản Hồi Đầy Đủ: Suy Diễn Thế Giới + Ghi Sổ Cái ==========
      function getMessageKey(ctx, chat, message) {
        const messageId = message?.mesId ?? message?.message_id ?? message?.send_date ?? (chat.length - 1);
        const swipeId = message?.swipe_id ?? message?.swipeId ?? '';
        return [core.getChatId(), chat.length - 1, messageId, swipeId].join('|');
      }

      function clearAutoEvolveTimer() {
        if (autoEvolveTimer) {
          clearTimeout(autoEvolveTimer);
          autoEvolveTimer = null;
        }
      }

      function onMessageReceived() {
        clearAutoEvolveTimer();

        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        if (!ctx || chat.length <= 2 || !lastMsg || lastMsg.is_user || !aiMsg) return;

        const messageKey = getMessageKey(ctx, chat, lastMsg);
        autoEvolveTimer = setTimeout(
          () => runAutoEvolution(messageKey, aiMsg),
          AUTO_EVOLVE_DELAY
        );
      }

      async function runAutoEvolution(expectedKey, expectedText) {
        autoEvolveTimer = null;
        if (api.getSettings(true).engineEnabled === false) return;
        if (isEvolving || lastProcessedMessageKey === expectedKey) return;
        // Đã có suy diễn (ví dụ được kích hoạt thủ công) đang chạy: bỏ qua lần suy diễn tự động này, tránh việc evolve() trả về false do busy bị hiểu nhầm là "suy diễn thất bại"
        if (evolution.isRunning && evolution.isRunning()) return;

        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        if (!ctx || !lastMsg || lastMsg.is_user || !aiMsg) return;

        const currentKey = getMessageKey(ctx, chat, lastMsg);
        if (currentKey !== expectedKey) return;
        if (aiMsg !== expectedText) {
          onMessageReceived();
          return;
        }

        // ===== Chế Độ Suy Diễn Và Đếm Số: Quyết Định Tin Nhắn Này Có Tự Động Suy Diễn Hay Không =====
        const settings = api.getSettings(true);
        if (settings.evolveMode === 'manual') {
          // Chế độ thủ công: chỉ được kích hoạt bởi nút "Suy Diễn Thủ Công", ở đây không thực hiện bất kỳ suy diễn tự động nào
          lastProcessedMessageKey = currentKey;
          return;
        }
        const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);
        let timeStoryDay = null;   // Khác null = theo chế độ thời gian, sau khi suy diễn sẽ ghi vào state.time
        let timeReadRounds = null; // Chế độ thời gian: số lượt đọc lần này (min(số lượt đã qua, giới hạn trên X))

        if (settings.evolveMode === 'time') {
          // Điều kiện tiên quyết: cả state.time và checkpoint.time đều phải tồn tại
          const st = core.hasState() ? core.loadState() : null;
          const cp = core.restoreCheckpoint();
          if (!st || st.time == null || !cp || cp.time == null) {
            lastProcessedMessageKey = currentKey;
            setStatus('Thời gian điểm lưu và trạng thái hiện tại đang trống, vui lòng điền trong cài đặt', false);
            if (ui) ui.refresh(true);
            return;
          }
          const currentDay = core.parseStoryDay(aiMsg, settings);
          if (currentDay == null) {
            core.setLastStoryDay(null);
            lastProcessedMessageKey = currentKey;
            setStatus('Chưa lấy được thời gian', false);
            if (ui) ui.refresh(true);
            return;
          }
          core.setLastStoryDay(currentDay);
          const isNew = core.isNewRound();
          const base = isNew ? Number(st.time) : Number(cp.time);   // reroll → so với điểm lưu
          const threshold = Math.max(1, parseInt(settings.evolveTimeThreshold) || 1);
          const delta = currentDay - base;
          if (delta < threshold) {
            lastProcessedMessageKey = currentKey;
            setStatus(`Ngày ${Math.max(0, delta)}/${threshold}, chưa đến lúc suy diễn`);
            if (ui) ui.refresh(true);
            return;
          }
          timeStoryDay = currentDay;
          // Số lượt đã trôi qua kể từ lần suy diễn trước (mốc neo tầng: tầng điểm lưu → tầng trạng thái hiện tại → tầng hiện tại), lấy giá trị nhỏ hơn so với giới hạn trên X
          const Xmax = Math.max(1, parseInt(settings.evolveTimeMaxRounds) || 10);
          const Lnow = core.getChatLayer();
          let anchorL = (cp && cp.chatLayer != null) ? Number(cp.chatLayer)
                      : (st && st.chatLayer != null ? Number(st.chatLayer) : Lnow);
          if (!Number.isFinite(anchorL)) anchorL = Lnow;
          const since = Math.floor(Math.max(0, Lnow - anchorL) / 2);
          timeReadRounds = Math.max(1, Math.min(since, Xmax));
        } else {
          const L = core.getChatLayer();
          const cp = core.restoreCheckpoint();
          const storedState = core.hasState() ? core.loadState() : null;
          let anchor = null;
          if (cp && cp.chatLayer != null) {
            anchor = Number(cp.chatLayer);
          } else if (storedState && storedState.chatLayer != null && Number.isFinite(Number(storedState.chatLayer))) {
            anchor = Number(storedState.chatLayer);
          } else if (core.loadFingerprint() !== '') {
            anchor = Number(core.loadFingerprint());
          }
          // [FIX] Cả ba cấp dự phòng đều trống = cuộc trò chuyện này chưa từng được suy diễn (state rỗng + không có điểm lưu + không có fingerprint).
          //   Logic cũ mặc định anchor=L khiến c=0 bị deadlock vĩnh viễn (xem thay đổi tương ứng ở onChatLoaded không còn ghim chatLayer cho state rỗng);
          //   Đổi thành xác định là chưa từng suy diễn, anchor=-1 để c>0 kích hoạt lần suy diễn đầu tiên. Sau khi suy diễn thành công, evolution sẽ ghi fingerprint bình thường, các lượt sau đi theo mốc neo bình thường.
          if (!Number.isFinite(anchor)) anchor = -1;
          const c = Math.floor(Math.max(0, L - anchor) / 2);
          const doEvolve = c > 0 && c % everyX === 0;

          if (!doEvolve) {
            lastProcessedMessageKey = currentKey;
            const pos = c % everyX || (c === 0 ? 0 : everyX);
            setStatus(`Lượt ${pos}/${everyX}, chưa đến lúc suy diễn`);
            if (ui) ui.refresh(true);
            return;
          }
        }

        const ok = await performEvolution(aiMsg, chat, timeStoryDay, timeReadRounds);
        if (ok) lastProcessedMessageKey = currentKey;
      }

      function setStatus(text, isErr) {
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(text, !!isErr);
      }

      function getElapsedReadRounds(baseState, maxRounds) {
        const limit = Math.max(1, parseInt(maxRounds) || 1);
        const L = core.getChatLayer();
        let anchorL = baseState && baseState.chatLayer != null ? Number(baseState.chatLayer) : L;
        if (!Number.isFinite(anchorL)) anchorL = L;
        const since = Math.floor(Math.max(0, L - anchorL) / 2);
        return Math.max(1, Math.min(since, limit));
      }

      function buildDialogueText(chat, readRounds, settings) {
        const start = Math.max(settings.firstLayerIsAiOpening !== false ? 1 : 0, chat.length - readRounds * 2);
        return chat.slice(start)
          .map(m => (m.is_user ? 'Người dùng' : 'AI') + '：' + core.filterDialogue((m.mes || '').trim(), settings))
          .filter(line => line.length > 3)
          .join('\n');
      }

      // Thực hiện một lần suy diễn (dùng chung cho tự động theo lượt / theo thời gian / điền thời gian thủ công ở trang cài đặt).
      // storyDay khác null → sau khi suy diễn thành công sẽ ghi vào state.time (chế độ theo thời gian).
      async function performEvolution(aiMsg, chat, storyDay, readRoundsOverride, opts) {
        isEvolving = true;
        let worldUiPhaseFinished = false;
        opts = opts || {};
        try {
          const state = core.loadState();
          const isNewRound = core.isNewRound();
          setStatus('Đang suy diễn...');
          // Cơ sở hiển thị: nút thủ công truyền vào tường minh; đường tự động đi theo isNewRound.
          const displayScope = opts.displayScope || (isNewRound ? 'state' : 'checkpoint');
          if (ui && ui.setEvolvingUI) ui.setEvolvingUI(true, displayScope);
          if (ui && ui.refresh) ui.refresh(true);

          // Lấy hội thoại để đưa vào hậu trường; chế độ theo thời gian do bên gọi truyền vào số lượt đọc, chế độ theo lượt dùng a (giới hạn về X). start được bảo vệ khỏi số âm
          const settings = api.getSettings(true);
          let readRounds;
          if (readRoundsOverride != null) {
            readRounds = Math.max(1, parseInt(readRoundsOverride) || 1);
          } else {
            readRounds = Math.max(1, parseInt(settings.evolveReadRounds) || 1);
            if (settings.evolveMode === 'auto') {
              readRounds = Math.min(Math.max(1, parseInt(settings.evolveEveryX) || 1), readRounds);
            }
          }
          const dialogueText = buildDialogueText(chat, readRounds, settings);

          const evolveOpts = { dialogueText };
          if (opts.mode) evolveOpts.mode = opts.mode;
          const success = await evolution.evolve(state, opts.userMsg || '', aiMsg, evolveOpts);
          if (success) {
            ledger.recordChanges(state);
            if (storyDay != null) { state.time = Number(storyDay); core.saveState(state); }
            // API Thế Giới đã hoàn tất: lưu xuống DB, cập nhật tiêm và làm mới giao diện Thế Giới trước, rồi mới bắt đầu liên kết ký ức.
            // isEvolving tiếp tục đóng vai trò khóa loại trừ nội bộ, giữ giá trị true để ngăn suy diễn thế giới khởi động lại trong lúc liên kết đang chạy;
            // trạng thái chạy của UI thì kết thúc ở đây, để hoạt ảnh của hai công cụ hiển thị đúng theo trình tự trước sau.
            if (isNewRound || opts.forceApplyInjection) applyInjection();
            setStatus('Suy diễn thế giới hoàn tất');
            if (ui) { ui.setEvolvingUI(false); ui.refresh(true); }
            worldUiPhaseFinished = true;
            if (settings.memoryLinkEnabled === true) {
              try {
                await window.MEMORY_ENGINE?.ingestWorldEvolution?.({
                  layer: core.getChatLayer(),
                  worldRound: state.round,
                  worldDigest: state.worldDigest,
                  worldUpdate: state.lastEvolveResult,
                  replace: !isNewRound
                });
              } catch (linkError) {
                console.error('[Công Cụ Thế Giới] Liên kết Thế Giới→Ký Ức thất bại (kết quả suy diễn thế giới vẫn được giữ lại)', linkError);
                setStatus('Suy diễn thế giới hoàn tất, nhưng liên kết ký ức thất bại: ' + (linkError?.message || linkError), true);
              }
            }
            console.log('[Công Cụ Thế Giới] ✅ Suy diễn hoàn tất, hiện đang ở lượt thứ', state.round);
          } else {
            console.warn('[Công Cụ Thế Giới] ⚠️ Suy diễn thất bại hoặc đã bị hủy');
          }
          const reason = !success && evolution.getLastError ? evolution.getLastError() : '';
          if (!success) setStatus(reason ? 'Suy diễn thất bại: ' + reason : 'Suy diễn thất bại hoặc đã bị hủy', true);
          return success;
        } catch(e) {
          console.error('[Công Cụ Thế Giới] Xử lý thất bại', e);
          setStatus('Lỗi bất thường khi suy diễn: ' + e.message, true);
          return false;
        } finally {
          isEvolving = false;
          if (ui) {
            if (!worldUiPhaseFinished) ui.setEvolvingUI(false);
            ui.refresh(true);
          }
        }
      }

      async function manualEvolve(mode, scope) {
        if (api.getSettings(true).engineEnabled === false) { setStatus('Công Cụ Thế Giới đã tắt'); return false; }
        if (isEvolving) return false;
        if (evolution.isRunning && evolution.isRunning()) { setStatus('Đã có suy diễn đang thực hiện...'); return false; }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const userMsg = lastMsg?.is_user ? (lastMsg.mes || '') : '';
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        const settings = api.getSettings(true);
        const state = core.loadState();
        // forward chỉ lấy hội thoại gần nhất theo số lượt mới tăng thêm sau trạng thái hiện tại; redo thì tính lại từ điểm lưu.
        // Cả hai đường đều chịu giới hạn bởi manualReadRounds, buildDialogueText cuối cùng luôn lấy N lượt mới nhất ở cuối cuộc trò chuyện.
        const dialogueBase = mode === 'redo' ? core.restoreCheckpoint() : state;
        const readRounds = getElapsedReadRounds(dialogueBase, settings.manualReadRounds);
        return performEvolution(aiMsg, chat, null, readRounds, {
          mode,
          displayScope: scope,
          userMsg,
          forceApplyInjection: true
        });
      }

      async function manualMemoryLink() {
        if (isEvolving) { setStatus('Công Cụ Thế Giới hoặc tác vụ liên kết đang chạy...'); return false; }
        if (window.MEMORY_ENGINE?.isRunning?.()) { setStatus('Công Cụ Ký Ức đã có tác vụ đang chạy...'); return false; }
        const state = core.loadState();
        const digest = String(state?.worldDigest || '').trim();
        if (!digest) { setStatus('Hiện không có tóm tắt thế giới nào để liên kết', true); return false; }
        isEvolving = true;
        try {
          setStatus('Đang liên kết thủ công với Công Cụ Ký Ức...');
          const result = await window.MEMORY_ENGINE?.ingestWorldEvolution?.({
            layer: core.getChatLayer(),
            worldRound: state.round,
            worldDigest: digest,
            worldUpdate: state.lastEvolveResult || state,
            replace: true,
            force: true
          });
          if (!result || result.skipped) throw new Error('Công Cụ Ký Ức chưa thực hiện liên kết');
          setStatus('Liên kết thủ công hoàn tất, tóm tắt thế giới đã được thêm vào ký ức dưới dạng một bản ghi mới');
          if (ui?.refresh) ui.refresh(true);
          return true;
        } catch (error) {
          console.error('[Công Cụ Thế Giới] Liên kết thủ công với Công Cụ Ký Ức thất bại', error);
          setStatus('Liên kết thủ công thất bại: ' + (error?.message || error), true);
          return false;
        } finally {
          isEvolving = false;
        }
      }

      // Sau khi lưu giá trị điền tay "Thời Gian Hội Thoại Lượt Này" ở trang cài đặt: kiểm tra đã đủ thời gian chưa, đủ thì suy diễn.
      async function manualTimeEvolve(currentDay) {
        if (api.getSettings(true).engineEnabled === false) { setStatus('Công Cụ Thế Giới đã tắt'); return; }
        if (currentDay == null || isEvolving) return;
        if (evolution.isRunning && evolution.isRunning()) { setStatus('Đã có suy diễn đang thực hiện...'); return; }
        const settings = api.getSettings(true);
        const st = core.hasState() ? core.loadState() : null;
        const cp = core.restoreCheckpoint();
        if (!st || st.time == null || !cp || cp.time == null) {
          setStatus('Thời gian điểm lưu và trạng thái hiện tại đang trống, vui lòng điền trong cài đặt', false);
          return;
        }
        core.setLastStoryDay(currentDay);
        const isNew = core.isNewRound();
        const base = isNew ? Number(st.time) : Number(cp.time);
        const threshold = Math.max(1, parseInt(settings.evolveTimeThreshold) || 1);
        const delta = Number(currentDay) - base;
        if (delta < threshold) {
          setStatus(`Ngày ${Math.max(0, delta)}/${threshold}, chưa đến lúc suy diễn`);
          if (ui) ui.refresh(true);
          return;
        }
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const lastMsg = chat[chat.length - 1];
        const aiMsg = !lastMsg?.is_user ? (lastMsg?.mes || '').trim() : '';
        // Nhất quán với đường tự động: đọc min(số lượt đã qua, giới hạn trên X) lượt
        const readRounds = getElapsedReadRounds(cp || st, settings.evolveTimeMaxRounds);
        await performEvolution(aiMsg, chat, Number(currentDay), readRounds);
      }

      async function onChatLoaded() {
        clearAutoEvolveTimer();
        // Khi chuyển cuộc trò chuyện, nếu vẫn còn suy diễn/backfill hàng loạt đang chạy thì hủy ngay lập tức —
        // Backfill đang giữ tham chiếu đến mảng hội thoại của cuộc trò chuyện cũ, nếu tiếp tục chạy sẽ ghi nội dung cuộc trò chuyện cũ vào cuộc trò chuyện mới (gây nhiễm chéo giữa các cuộc trò chuyện + dữ liệu lưu cũ đã bị clearState mất).
        if (evolution && evolution.isRunning && evolution.isRunning()) {
          try { evolution.abort(); console.log('[Công Cụ Thế Giới] Chuyển cuộc trò chuyện, hủy suy diễn/backfill đang chạy'); } catch (e) { console.warn('[Công Cụ Thế Giới] Hủy suy diễn thất bại', e); }
        }
        // ChatCache dùng chung lắng nghe CHAT_LOADED độc lập, và hoàn tất khôi phục scope trước khi các callback của từng công cụ chạy.
        const ctx = SillyTavern.getContext();
        const chat = ctx?.chat || [];
        const currentLayer = core.getChatLayer();
        if (chat.length === 0) {
          core.clearState();
          core.clearCheckpoint();
          core.saveFingerprint(String(currentLayer));
        }
        let storedState = null;
        if (core.hasState()) {
          storedState = core.loadState();
          // [FIX] Chỉ bổ sung chatLayer cho state đã thực sự được suy diễn; state rỗng (round=0 và không có lastEvolveResult) giữ nguyên undefined,
          //   để anchor dự phòng của runAutoEvolution đi theo nhánh "chưa từng suy diễn" (anchor=-1), tránh việc ghim anchor cố định vào tầng hiện tại gây deadlock.
          if (!Number.isFinite(Number(storedState.chatLayer)) && (storedState.round > 0 || storedState.lastEvolveResult)) {
            storedState.chatLayer = currentLayer;
            core.saveState(storedState);
          }
        }
        const checkpoint = core.restoreCheckpoint();
        if (checkpoint && !Number.isFinite(Number(checkpoint.chatLayer))) {
          checkpoint.chatLayer = storedState && Number.isFinite(Number(storedState.chatLayer))
            ? Number(storedState.chatLayer)
            : currentLayer;
          core.saveCheckpoint(checkpoint);
        }
        // Di chuyển fingerprint phiên bản cũ (ý nghĩa cũ là chat.length) sang số tầng thống nhất (chat.length - 1).
        const savedFingerprint = Number(core.loadFingerprint());
        if (Number.isFinite(savedFingerprint) && savedFingerprint === currentLayer + 1 &&
            (!storedState || Number(storedState.chatLayer) === currentLayer)) {
          core.saveFingerprint(String(currentLayer));
        }
        // [FIX] Bổ sung fingerprint bằng tầng hiện tại = thiết lập mốc neo tại tầng này (cuộc trò chuyện đã từng suy diễn thiết lập ở đây, lần sau có tầng mới mới suy diễn tiếp).
        //   Nhưng state rỗng (round=0 và không có lastEvolveResult = chưa từng suy diễn) không được bổ sung thành tầng hiện tại — nếu không
        //   runAutoEvolution sẽ khớp vào cấp dự phòng thứ ba với anchor=L, c=0, deadlock vĩnh viễn. Chỉ state đã thực sự suy diễn mới được bổ sung;
        //   state rỗng giữ nguyên fingerprint trống, để nhánh auto đi theo dự phòng "chưa từng suy diễn" anchor=-1 kích hoạt lần suy diễn đầu tiên.
        //   Đồng cấu trúc với việc không ghim chatLayer cho state rỗng ở trên (đều phân biệt đã suy diễn hay chưa bằng round>0||lastEvolveResult).
        const reallyEvolved = storedState && (storedState.round > 0 || storedState.lastEvolveResult);
        if (chat.length > 0 && !core.restoreCheckpoint() && reallyEvolved && core.loadFingerprint() === '') {
          core.saveFingerprint(String(currentLayer));
        }
        applyInjectionForCurrentRound();
        console.log('[Công Cụ Thế Giới] Cuộc trò chuyện đã tải, tiêm đã được cập nhật');
      }

      function onMessageSwiped() {
        clearAutoEvolveTimer();
        // swipe (mũi tên trái/phải bên dưới tin nhắn): rõ ràng là reroll, tiêm điểm lưu.
        applyInjectionForCurrentRound({ isReroll: true });
      }

      // Mượn sự kiện bắt đầu sinh làm thời điểm ráp nội dung chính. Tiêu chí xác định reroll dùng type gốc của Tavern (swipe/regenerate),
      // không còn dùng giá trị chatLayer nữa — vì GENERATION_STARTED được emit trước khi tầng người dùng/AI được push vào chat,
      // khi gửi tin nhắn ở lượt mới chatLayer vẫn == state.chatLayer của lượt trước, tiêu chí thuần số sẽ hiểu nhầm lần sinh đầu của lượt mới là reroll (hồi quy v2.3.18).
      //   type==='swipe'|'regenerate' → reroll, tiêm điểm lưu (trạng thái thế giới trước khi tầng nội dung này được tạo ra).
      //   dryRun (khởi động trước/tính token của các plugin dạng database) → không đụng tới việc tiêm, tránh trường hợp "sinh xong lại tiêm thêm một lần nữa".
      function onGenerationStarted(type, _opts, dryRun) {
        if (dryRun) return; // Lượt khởi động trước không đánh giá lại việc tiêm
        const isReroll = (type === 'swipe' || type === 'regenerate');
        applyInjectionForCurrentRound({ isReroll });
      }

      // ========== Gắn Sự Kiện ==========
      const ctx = SillyTavern.getContext();
      if (ctx && ctx.eventSource) {
        const guard = window.WORLD_ENGINE_GUARD_EVENT;
        const autoEvolveEvent = ctx.event_types?.GENERATION_ENDED || ctx.event_types?.MESSAGE_RECEIVED || 'message_received';
        ctx.eventSource.on(autoEvolveEvent, guard('Công Cụ Thế Giới', 'Sinh Xong', onMessageReceived));
        ctx.eventSource.on(ctx.event_types?.CHAT_LOADED || 'chat_loaded', guard('Công Cụ Thế Giới', 'Tải Trò Chuyện', onChatLoaded));
        ctx.eventSource.on(ctx.event_types?.MESSAGE_SWIPED || 'message_swiped', guard('Công Cụ Thế Giới', 'Vuốt Tái Sinh', onMessageSwiped));
        ctx.eventSource.on(ctx.event_types?.GENERATION_STARTED || 'generation_started', guard('Công Cụ Thế Giới', 'Bắt Đầu Sinh', onGenerationStarted));
        console.log('[Công Cụ Thế Giới] Gắn sự kiện thành công, sự kiện suy diễn tự động:', autoEvolveEvent);
      } else {
        console.warn('[Công Cụ Thế Giới] Không thể gắn sự kiện');
      }

      // Khi khởi tạo, lập tức chọn trạng thái tiêm dựa theo số tầng hội thoại
      applyInjectionForCurrentRound();
      // Xuất điểm vào tiêm theo số tầng hội thoại để gọi thủ công
      window.WORLD_ENGINE = { applyInjection: applyInjectionForCurrentRound, manualEvolve, manualTimeEvolve, manualMemoryLink };

      // ========== Thêm Nút Vào Bảng Điều Khiển Vào Thanh Nhập Liệu Của Tavern ==========
      // Đã chuyển sang buildInputButton() trong world-engine-ui.js

      ui.buildPanel();
      ui.buildInputButton();
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => ui.buildInputButton());
      }

      // Cứ mỗi 30 giây tự động làm mới bảng điều khiển (nếu đang hiển thị)
      setInterval(() => { if (ui) ui.refresh(true); }, 30000);

      console.log('[Công Cụ Thế Giới] Khởi tạo hoàn tất ✅');

    } catch(err) {
      console.error('[Công Cụ Thế Giới] Khởi tạo thất bại', err);
    } finally {
      // Khởi tạo Ký Ức có ranh giới kết thúc độc lập: dù phần thân chạy của Thế Giới hay nửa sau của UI dùng chung báo lỗi,
      // cũng không được ngăn cản Công Cụ Ký Ức đã vượt qua kiểm tra hợp đồng giao diện khởi động.
      if (sharedRuntimeReady && loadedEngines.get('memory') && window.MEMORY_ENGINE) {
        try { window.MEMORY_ENGINE.init(); }
        catch (e) { console.warn('[Công Cụ Ký Ức] Khởi tạo thất bại (không nghiêm trọng)', e); }
      }
    }
  }

  init();
})();
