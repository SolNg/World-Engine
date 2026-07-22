// world-engine-api.js — Gọi API độc lập (hỗ trợ API tương thích OpenAI tùy chỉnh)
window.WORLD_ENGINE_API = (function() {
  // Phần triển khai gọi API có thể dùng chung cho cả hai engine, nhưng settings ghi đè tuyệt đối không được bổ khuyết bằng cấu hình của World Engine.
  // Một khi bên gọi truyền settingsOverride tường minh, chỉ gộp thêm các giá trị mặc định không trạng thái (stateless).
  const REQUEST_DEFAULTS = Object.freeze({
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    temperature: 0.7,
    maxTokens: 65000,
    apiTimeoutMs: 120000
  });
  let cachedSettings = null;

  function getSettings(forceRefresh) {
    if (forceRefresh) cachedSettings = null;
    if (cachedSettings) return cachedSettings;
    const defaults = {
      apiUrl: '',
      apiKey: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 65000,
      apiAutoRetries: 0,
      engineEnabled: true,
      firstLayerIsAiOpening: true,
      // [FIX] Chế độ kết nối: 'direct' = trình duyệt kết nối trực tiếp (mặc định, hành vi cũ); 'proxy' = chuyển tiếp qua server của SillyTavern, để né giới hạn CORS của API bên thứ ba
      connectionMode: 'direct',
      injectIntoPrompt: true,
      injectMaxChars: 5000,
      // Lọc theo cấp độ khi chèn vào nội dung: false = chỉ chèn thông tin cấp cao (tương thích hành vi cũ), true = chuỗi sự kiện và tin đồn không lọc theo cấp độ
      injectAllLevels: false,
      // Sau khi World API thành công, liên kết thông tin thế giới của lượt này sang Memory Engine.
      memoryLinkEnabled: false,
      evolveMode: 'auto',
      // Bộ nhớ đệm SillyTavern: sao lưu gương (mirror) dữ liệu lưu theo từng cuộc trò chuyện vào chat_metadata, giúp đồng bộ đa thiết bị và chống mất dữ liệu (mặc định tắt)
      syncToChat: false,   // Đồng bộ thời gian thực: trạng thái workspace liên tục được mirror vào cuộc trò chuyện, đổi thiết bị mở lại cùng cuộc trò chuyện là tiếp tục được
      autoBackup: false,   // Tự động sao lưu luân phiên: mỗi khi lượt tiến triển, tự động lưu một bản vào cuộc trò chuyện (giữ lại vài bản gần nhất)
      worldbookTrigger: false, // Kích hoạt Đèn Xanh Dương - Xanh Lá cho World Info: 🔵 luôn thường trực chèn / 🟢 chỉ chèn khi khớp từ khóa (mặc định tắt = chèn tất cả mục đã chọn)
      // Suy diễn thế giới hàng loạt: suy diễn theo từng đợt từ tầng AI đầu tiên đến tầng chỉ định (xóa và làm lại)
      backfillBatchSize: 5,    // Số tầng AI mỗi đợt (cứ bao nhiêu tầng thì gọi suy diễn một lần)
      backfillRetries: 2,      // Số lần thử lại độc lập cho mỗi đợt (giới hạn thử lại khi suy diễn thất bại)
      backfillEndLayer: 0,     // Tầng AI kết thúc (0 = suy diễn đến tầng AI cuối cùng)
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,
      evolveFilterRegex: '',
      tonePrompt: '',
      // Chế độ suy diễn theo thời gian
      evolveTimeFront: 0,
      evolveTimeBack: 80,
      evolveTimeRe1: '', evolveTimeRe2: '', evolveTimeRe3: '',
      evolveTimeRe4: '', evolveTimeRe5: '', evolveTimeRe6: '',
      evolveTimeMul1: 360, evolveTimeMul2: 30, evolveTimeMul3: 1,
      evolveTimeThreshold: 1,
      evolveTimeMaxRounds: 10,
      // Local mechanism tuning. Defaults match the previous hard-coded behavior.
      localRegionalIncidentChancePercent: 3,
      localRegionalIncidentDuration: 5,
      localRegionalIncidentCooldown: 5,
      localDistantEventLedgerThreshold: 10,
      localDistantEventChancePercent: 20,
      localDistantEventCooldown: 5,
      localDistantEventEventPercent: 50,
      localNearEventChancePercent: 20,
      localNearEventCooldown: 5,
      localNearEventEventPercent: 50,
      localEventDiceModifier: 0,
      localEventSetbackRatioPercent: 40,
      localProgressFailBase: 2,
      localConflictFailBase: 6,
      localTerminalBaseKeepRounds: 2,
      localTerminalLevelKeepRounds: 2,
      localInfluenceKeepRounds: 8,
      localEnemyTerminalKeepRounds: 20,
      localLedgerKeepRounds: 20,
      localCapEvents: 16,
      localCapFactions: 15,
      localCapWinds: 12,
      localCapWorldTrends: 4,
      localCapInfluence: 12,
      localCapEnemies: 8,
      localCapEconomySignals: 8,
      localCapBlackbox: 12,
      localWindAnnouncementBase: 10,
      localWindAnnouncementGrace: 4,
      localWindAnnouncementLinear: 3,
      localWindAnnouncementQuadratic: 1,
      localWindReportBase: 20,
      localWindReportGrace: 2,
      localWindReportLinear: 4,
      localWindReportQuadratic: 2,
      localWindRumorBase: 25,
      localWindRumorGrace: 1,
      localWindRumorLinear: 5,
      localWindRumorQuadratic: 3,
      localWindSentimentBase: 8,
      localWindSentimentGrace: 5,
      localWindSentimentLinear: 2,
      localWindSentimentQuadratic: 1,
      // [FIX] Thời gian chờ tối đa cho request API (ms). 0 = không giới hạn thời gian (hành vi cũ). Mặc định 120s:
      //   Nếu request suy diễn rơi vào "hố đen" mạng (proxy không phản hồi / upstream không trả về cũng không báo lỗi), fetch sẽ treo vĩnh viễn,
      //   cờ _isRunning của evolve không bao giờ được reset, từ đó mọi lượt suy diễn tự động đều bị isRunning() chặn âm thầm,
      //   cho đến khi người dùng chuyển sang cuộc trò chuyện khác mới được mở khóa. Timeout giúp request bị treo được xử lý như thất bại, khối finally reset lại bình thường.
      apiTimeoutMs: 120000
    };
    const raw = window.WORLD_ENGINE_STORE.getItem('world_engine_settings');
    if (raw) {
      try {
        cachedSettings = { ...defaults, ...JSON.parse(raw) };
        if (parseInt(cachedSettings.maxTokens) === 4096) cachedSettings.maxTokens = 65000;
        return cachedSettings;
      } catch(e) {}
    }
    cachedSettings = defaults;
    return cachedSettings;
  }

  // [FIX] Chuẩn hóa URL chat/completions: chỉ bổ sung /chat/completions, không còn tự ý nhét tiền tố phiên bản /v1 thay người dùng.
  //   Các endpoint tương thích OpenAI như Volcano Ark dùng tiền tố phiên bản tùy chỉnh (/api/v3, /api/coding/v3), logic cũ sẽ nhét cứng
  //   /v1 khiến URL ghép thành .../v3/v1/chat/completions và tất cả đều 404. Tiền tố phiên bản do người dùng tự điền đầy đủ trong phần cài đặt,
  //   bên cạnh có gợi ý định dạng. Cả ba điểm gọi (getProxyBase / callApi / fetchModelList) đều hưởng lợi nhất quán từ thay đổi này.
  function normalizeUrl(url) {
    let u = url.trim().replace(/\/+$/, '');
    if (!u) return '';
    if (u.endsWith('/chat/completions')) return u;
    return u + '/chat/completions';
  }

  // [FIX] Dùng khi đi qua proxy của SillyTavern: khôi phục base (dạng https://host/v1) từ URL chat/completions đầy đủ,
  // giao cho backend của SillyTavern tự ghép /chat/completions và /models.
  function getProxyBase(settings) {
    return normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');
  }

  // [FIX] Gọi endpoint backend của chính SillyTavern cần kèm header CSRF/xác thực của nó; chỉ dùng được trong môi trường SillyTavern.
  function tavernHeaders() {
    try {
      const ctx = (typeof SillyTavern !== 'undefined' && SillyTavern.getContext) ? SillyTavern.getContext() : null;
      if (ctx && typeof ctx.getRequestHeaders === 'function') {
        const h = ctx.getRequestHeaders();
        if (h && !h['Content-Type'] && !h['content-type']) h['Content-Type'] = 'application/json';
        return h;
      }
    } catch (e) {}
    throw new Error('Cần chạy trong môi trường SillyTavern để dùng proxy của SillyTavern (không lấy được header request của SillyTavern)');
  }

  function timeoutError(timeoutMs) {
    return new Error('Yêu cầu API đã hết thời gian chờ (' + Math.max(1, Math.ceil(timeoutMs / 1000)) + 's không phản hồi), đã hủy yêu cầu này');
  }

  function timeoutSeconds(timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    return timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
  }

  function messageChars(messages) {
    return (messages || []).reduce((total, msg) => total + String(msg && msg.content || '').length, 0);
  }

  function logRequestParams(label, target, settings, body) {
    console.log('[World Engine] Tham số yêu cầu API:', {
      connectionMode: settings.connectionMode === 'proxy' ? 'proxy' : 'direct',
      transport: label,
      target,
      model: body.model,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      timeout_sec: timeoutSeconds(settings.apiTimeoutMs),
      message_count: Array.isArray(body.messages) ? body.messages.length : 0,
      prompt_chars: messageChars(body.messages),
      stream: false
    });
  }

  async function readResponseBody(resp) {
    const text = await resp.text();
    let data = null;
    let parseError = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { parseError = e; }
    }
    return { resp, data, text, parseError };
  }

  function responseDetail(result) {
    const data = result && result.data;
    const text = result && result.text;
    if (data && data.error && data.error.message) return data.error.message;
    if (data) return JSON.stringify(data);
    return text ? String(text).slice(0, 500) : '';
  }

  function requireJson(result, label) {
    if (result.parseError) {
      throw new Error((label || 'API') + ' trả về không phải JSON hợp lệ: ' + result.parseError.message);
    }
    return result.data || {};
  }

  // Timeout bao trùm toàn bộ vòng đời request: fetch resolve chỉ có nghĩa là header phản hồi đã đến, việc đọc phần thân vẫn có thể bị treo.
  async function fetchResponseWithTimeout(url, options, signal, timeoutMs) {
    timeoutMs = Number(timeoutMs) || 0;
    if (!(timeoutMs > 0)) {
      const resp = await fetch(url, { ...options, signal: signal || null });
      return readResponseBody(resp);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const onExternalAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      return await readResponseBody(resp);
    } catch (e) {
      if (timedOut) throw timeoutError(timeoutMs);
      throw e;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onExternalAbort);
    }
  }

  // [FIX] Lệnh gọi suy diễn chuyển tiếp qua backend SillyTavern: trình duyệt → backend SillyTavern cùng nguồn gốc (không CORS) → server chuyển tiếp đến API bên thứ ba.
  // Đi theo tuyến OpenAI source + reverse_proxy, nhờ vậy có thể truyền thẳng URL/KEY của chúng ta lên upstream.
  async function callApiViaProxy(settings, body, signal) {
    const base = getProxyBase(settings);
    if (!base) throw new Error('Chưa cấu hình API URL, vui lòng điền trong phần cài đặt');
    const payload = {
      chat_completion_source: 'openai',
      reverse_proxy: base,
      proxy_password: settings.apiKey || '',
      model: body.model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: body.max_tokens,
      stream: false
    };
    logRequestParams('tavern-proxy', base, settings, payload);
    const result = await fetchResponseWithTimeout('/api/backends/chat-completions/generate', {
      method: 'POST',
      headers: tavernHeaders(),
      body: JSON.stringify(payload)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseDetail(result)}`);
    }
    const data = requireJson(result, 'Proxy SillyTavern');
    if (data && data.error) {
      throw new Error('Proxy SillyTavern trả về lỗi: ' + (data.error.message || JSON.stringify(data.error)));
    }
    const choice = data.choices?.[0];
    if (!choice) throw new Error('API trả về thiếu choices[0]');
    if (choice.finish_reason === 'length') {
      console.warn('[World Engine] Đầu ra API đã đạt giới hạn độ dài, sẽ đọc phần đã trả về đầy đủ trước khi bị cắt');
    }
    return choice.message?.content || '';
  }

  /**
   * Gọi API độc lập (không phải API tích hợp sẵn của SillyTavern), định dạng tương thích OpenAI
   */
  async function callApi(prompt, maxTokens, temperature, signal, settingsOverride) {
    const settings = settingsOverride
      ? { ...REQUEST_DEFAULTS, ...settingsOverride }
      : getSettings();
    const selectedTemperature = temperature ?? settings.temperature;
    const configuredMaxTokens = Math.max(1, parseInt(maxTokens ?? settings.maxTokens) || 65000);
    // Tương thích cấu hình cũ: giới hạn đầu ra từng lưu là 4096 sẽ tự động nâng lên 65000.
    const selectedMaxTokens = configuredMaxTokens === 4096 ? 65000 : configuredMaxTokens;

    const body = {
      model: settings.model || 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      temperature: Number.isFinite(Number(selectedTemperature)) ? Math.max(0, Number(selectedTemperature)) : 0.7,
      max_tokens: selectedMaxTokens
    };

    // [FIX] Qua proxy SillyTavern: né giới hạn CORS của API bên thứ ba, do server Node của SillyTavern chuyển tiếp
    if (settings.connectionMode === 'proxy') {
      return callApiViaProxy(settings, body, signal);
    }

    const url = normalizeUrl(settings.apiUrl);
    if (!url) throw new Error('Chưa cấu hình API URL, vui lòng điền trong phần cài đặt');

    const headers = {
      'Content-Type': 'application/json'
    };
    if (settings.apiKey) {
      headers['Authorization'] = 'Bearer ' + settings.apiKey;
    }

    logRequestParams('direct', url, settings, body);

    const result = await fetchResponseWithTimeout(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }, signal, settings.apiTimeoutMs);
    const resp = result.resp;

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${responseDetail(result)}`);
    }

    const data = requireJson(result, 'API');
    const choice = data.choices?.[0];
    if (!choice) throw new Error('API trả về thiếu choices[0]');
    if (choice.finish_reason === 'length') {
      console.warn('[World Engine] Đầu ra API đã đạt giới hạn độ dài, sẽ đọc phần đã trả về đầy đủ trước khi bị cắt');
    }
    return choice.message?.content || '';
  }

  function repairTruncatedJSON(content) {
    const rootStart = content.indexOf('{');
    if (rootStart === -1) return null;

    const stack = [];
    const candidates = [];
    let inString = false;
    let escaped = false;

    for (let i = rootStart; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}' || char === ']') {
        stack.pop();
      } else if (char === ',' && stack.length > 0) {
        candidates.push({
          end: i,
          suffix: stack.slice().reverse().map(open => open === '{' ? '}' : ']').join('')
        });
      }
    }

    for (let i = candidates.length - 1; i >= 0; i--) {
      const candidate = content.slice(rootStart, candidates[i].end) + candidates[i].suffix;
      try {
        return JSON.parse(candidate);
      } catch(e) {}
    }
    return null;
  }

  /**
   * Phân tích JSON trả về từ API (có xử lý dung sai lỗi)
   */
  function parseJSON(text) {
    let content = String(text || '').trim();
    content = content.replace(/^```json\s*/i, '').replace(/\s*```\s*$/, '').trim();
    try {
      return JSON.parse(content);
    } catch(e) {}

    // Trích xuất JSON cấp cao nhất từ phần trả về có lẫn giải thích, văn bản suy nghĩ (reasoning) hoặc nhiều khối code;
    // câu trả lời cuối cùng của model thường nằm ở cuối, nên lấy đối tượng hợp lệ cuối cùng.
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    let result = null;
    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        if (depth === 0) start = i;
        depth++;
      } else if (char === '}' && depth > 0) {
        depth--;
        if (depth === 0 && start !== -1) {
          try {
            result = JSON.parse(content.slice(start, i + 1));
          } catch(e2) {}
          start = -1;
        }
      }
    }
    return result || repairTruncatedJSON(content);
  }

  /**
   * Lấy danh sách model (định dạng tương thích OpenAI)
   */
  async function fetchModelList(settingsOverride) {
    const settings = settingsOverride
      ? { ...REQUEST_DEFAULTS, ...settingsOverride }
      : getSettings();
    const baseUrl = normalizeUrl(settings.apiUrl).replace(/\/chat\/completions$/, '');

    // [FIX] Qua proxy SillyTavern: dùng endpoint /status của SillyTavern để lấy danh sách model, né CORS
    if (settings.connectionMode === 'proxy') {
      if (!baseUrl) throw new Error('Chưa cấu hình API URL, vui lòng điền trong phần cài đặt');
      const result = await fetchResponseWithTimeout('/api/backends/chat-completions/status', {
        method: 'POST',
        headers: tavernHeaders(),
        body: JSON.stringify({
          chat_completion_source: 'openai',
          reverse_proxy: baseUrl,
          proxy_password: settings.apiKey || ''
        })
      }, null, settings.apiTimeoutMs);
      if (!result.resp.ok) throw new Error(`HTTP ${result.resp.status}: ${responseDetail(result)}`);
      const data = requireJson(result, 'Proxy SillyTavern');
      if (data && data.error) throw new Error('Proxy SillyTavern lấy danh sách model thất bại (vui lòng kiểm tra URL/khóa API có chính xác không)');
      if (data.data && Array.isArray(data.data)) {
        return data.data.map(m => m.id);
      }
      throw new Error('Không thể phân tích danh sách model');
    }

    const url = baseUrl + '/models';
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) headers['Authorization'] = 'Bearer ' + settings.apiKey;

    const result = await fetchResponseWithTimeout(url, { headers }, null, settings.apiTimeoutMs);
    if (!result.resp.ok) throw new Error(`HTTP ${result.resp.status}: ${responseDetail(result)}`);
    const data = requireJson(result, 'API');
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(m => m.id);
    }
    throw new Error('Không thể phân tích danh sách model');
  }

  return { callApi, parseJSON, getSettings, fetchModelList };
})();
