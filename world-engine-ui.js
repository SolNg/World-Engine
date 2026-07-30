// world-engine-ui.js — Bảng Điều Khiển UI Đầy Đủ
window.WORLD_ENGINE_UI = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const evolution = window.WORLD_ENGINE_EVOLUTION;

  let panelElement = null;
  let panelBodyElement = null;
  let panelVisible = false;
  let _engineFace = 'world';
  const _engineFaceOrder = [];
  const _engineFaceRegistry = new Map();
  let _npcSettingsOpen = false;
  let _npcSettingsTab = 'common';
  let _npcView = 'home';
  let _npcSelectedNavView = null;
  const _npcExpanded = new Set();
  let _npcEditingId = null;      // id nhân vật đang mở trình soạn; chuỗi rỗng = đang thêm mới
  let _npcExpandScope = '';      // chat nào đang mở: đổi chat thì quên hết trạng thái gập/mở cũ
  let _panelFlipping = false;
  let isEvolving = false;
  let editingEvent = null;
  let editingFaction = null;
  let editingWind = null;
  let editingTrend = null;
  let editingDigest = null;
  let editingEnemy = null;
  let editingInfluence = null;
  let editingRI = null;
  let editingNote = null;
  // Trạng thái thống nhất của trình soạn bí mật: { scope, list:'action'|'asset', index, view:'action'|'asset' }
  //   list  = nhóm hiện tại chứa mục này; index = chỉ số trong nhóm đó
  //   view  = loại biểu mẫu đang hiển thị (đổi dropdown chỉ thay view, không đụng dữ liệu; việc chuyển đổi hoãn đến lúc lưu)
  let editingSecret = null;
  let listPagerCounter = 0;
  const listPageState = {};
  const sectionCollapsed = { 'checkpoint-section': true, 'set-filter': true };
  const expandedWorldbookGroups = new Set();
  // Bộ nhớ đệm Worldbook (cấp độ module, tồn tại xuyên suốt các lần refresh())
  let _wbCachedEntries = null;
  let _wbCachedSelectedIds = null;
  let _wbCachedOverrides = null;
  let _wbCachedChatId = null;
  let _wbCachedScope = null;
  let _wbScrollTop = 0;

  // Điểm mở rộng giao diện engine: engine mới sẽ vào vòng lặp "giao diện kế tiếp" theo thứ tự đăng ký.
  // Có thể cung cấp các hook như render/bind, theme/phiên bản, cài đặt, trạng thái chạy, class quả cầu và hành động nút vệ tinh.
  function registerEngineFace(definition) {
    const face = definition && typeof definition === 'object' ? definition : {};
    const id = String(face.id || '').trim();
    if (!id) throw new Error('Giao diện engine phải cung cấp id');
    const existed = _engineFaceRegistry.has(id);
    _engineFaceRegistry.set(id, { id, label: id, ...face });
    if (!existed) _engineFaceOrder.push(id);
    if (panelElement) updateEngineFaceChrome();
    return id;
  }

  function callEngineFace(face, hook, fallback, ...args) {
    try {
      return typeof face?.[hook] === 'function' ? face[hook](...args) : fallback;
    } catch (error) {
      console.error(`[${face?.label || face?.id || 'Engine'}] UI ${hook} thất bại (đã cách ly)`, error);
      return fallback;
    }
  }

  const ENGINE_ACTION_FAILED = Symbol('engine-action-failed');
  function callEngineFaceAction(face, hook, ...args) {
    const report = error => {
      console.error(`[${face?.label || face?.id || 'Engine'}] UI ${hook} thất bại (đã cách ly)`, error);
      showToast(`${face?.label || 'Engine'} thao tác thất bại: ${error?.message || error}`, true);
      return ENGINE_ACTION_FAILED;
    };
    try {
      if (typeof face?.[hook] !== 'function') return ENGINE_ACTION_FAILED;
      const result = face[hook](...args);
      return result && typeof result.then === 'function' ? result.catch(report) : result;
    } catch (error) {
      return report(error);
    }
  }

  function ensureBuiltinEngineFaces() {
    if (_engineFaceRegistry.has('world')) return;
    registerEngineFace({
      id: 'world', label: 'World Engine',
      getTheme: () => getStoredTheme(),
      getVersion: () => window.WORLD_ENGINE_VERSION,
      getSettings: () => window.WORLD_ENGINE_API?.getSettings(true) || {},
      setEnabled: enabled => {
        const api = window.WORLD_ENGINE_API;
        const current = api?.getSettings?.(true) || {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...current, engineEnabled: enabled }));
        api?.getSettings?.(true);
        window.WORLD_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(_evolving),
      showForward: true,
      forward: () => runManualEvolve('forward', 'state'),
      redo: () => runManualEvolve('redo', 'checkpoint'),
      abort: () => evolution.abort()
    });
    registerEngineFace({
      id: 'npc', label: 'NPC Engine', ballClass: 'we-ball-npc-face', panelClass: 'we-npc-face',
      getTheme: () => getStoredNpcTheme(),
      getVersion: () => window.NPC_ENGINE_SETTINGS?.VERSION,
      getSettings: () => window.NPC_ENGINE_SETTINGS?.getSettings(true) || {},
      setEnabled: enabled => {
        window.NPC_ENGINE_SETTINGS?.patchSettings({ engineEnabled: enabled });
        window.NPC_ENGINE?.applyInjection?.();
      },
      isRunning: () => Boolean(window.NPC_ENGINE?.isRunning?.()),
      getRunningLabel: () => window.NPC_ENGINE?.getRunningLabel?.() || '',
      render: () => renderNpcView(),
      bind: () => bindNpcView(),
      openSettings: () => { _npcSettingsOpen = !_npcSettingsOpen; },
      isSettingsOpen: () => _npcSettingsOpen,
      onSettingsTab: key => { _npcSettingsTab = key; },
      refreshDebug: () => refreshNpcDebugRender(),
      showForward: true,
      forwardTitle: 'Cập Nhật Hồ Sơ Nhân Vật Thủ Công',
      forward: () => runNpcLink('forward'),
      // Thiếu hook này thì nút "Diễn Biến Lại" trên quả cầu bấm không ra gì cả:
      // callEngineFaceAction trả về lặng lẽ khi hook không phải hàm, không báo lỗi.
      redo: () => runNpcLink('redo'),
      abort: () => window.NPC_ENGINE?.abort?.()
    });
  }

  function getEngineFace(id) {
    ensureBuiltinEngineFaces();
    return _engineFaceRegistry.get(id || _engineFace) || _engineFaceRegistry.get('world');
  }

  function getNextEngineFace() {
    ensureBuiltinEngineFaces();
    const index = Math.max(0, _engineFaceOrder.indexOf(_engineFace));
    return getEngineFace(_engineFaceOrder[(index + 1) % _engineFaceOrder.length]);
  }

  // Sáu bộ theme thuần biến CSS. Gắn trên <html>, bảng điều khiển, quả cầu nổi và thanh trạng thái trên cùng đổi màu đồng bộ.
  const WE_THEME_KEY = 'we-theme';
  const WE_THEMES = [
    { id: 'default', name: 'Mặc Ngọc · Mặc Định' },
    { id: 'night', name: 'Đêm Tàn · Cận Đen' },
    { id: 'deepsea', name: 'Biển Sâu · Xanh U Ám' },
    { id: 'plum', name: 'Dạ Hợp · Tím Thẫm' },
    { id: 'paper', name: 'Vân Bạch · Thanh Nhã' },
    { id: 'sakura', name: 'Anh Đào Sớm · Hồng Nhạt' }
  ];
  const MECHANICS_DEFAULT_FIELDS = {
    regional: {
      'we-local-ri-chance': 3,
      'we-local-ri-duration': 5,
      'we-local-ri-cooldown': 5
    },
    distant: {
      'we-local-distant-threshold': 10,
      'we-local-distant-chance': 20,
      'we-local-distant-cooldown': 5,
      'we-local-distant-event-percent': 50
    },
    near: {
      'we-local-near-chance': 20,
      'we-local-near-cooldown': 5,
      'we-local-near-event-percent': 50
    },
    dice: {
      'we-local-dice-mod': 0,
      'we-local-setback-ratio': 40,
      'we-local-progress-fail-base': 2,
      'we-local-conflict-fail-base': 6
    },
    winddecay: {
      'we-local-wind-rumor-base': 25,
      'we-local-wind-rumor-grace': 1,
      'we-local-wind-rumor-linear': 5,
      'we-local-wind-rumor-quadratic': 3,
      'we-local-wind-sentiment-base': 8,
      'we-local-wind-sentiment-grace': 5,
      'we-local-wind-sentiment-linear': 2,
      'we-local-wind-sentiment-quadratic': 1,
      'we-local-wind-report-base': 20,
      'we-local-wind-report-grace': 2,
      'we-local-wind-report-linear': 4,
      'we-local-wind-report-quadratic': 2,
      'we-local-wind-announcement-base': 10,
      'we-local-wind-announcement-grace': 4,
      'we-local-wind-announcement-linear': 3,
      'we-local-wind-announcement-quadratic': 1
    },
    retention: {
      'we-local-terminal-base': 2,
      'we-local-terminal-level': 2,
      'we-local-influence-keep': 8,
      'we-local-enemy-keep': 20,
      'we-local-ledger-keep': 20,
      'we-local-cap-events': 16,
      'we-local-cap-factions': 15,
      'we-local-cap-winds': 12,
      'we-local-cap-trends': 4,
      'we-local-cap-influence': 12,
      'we-local-cap-enemies': 8,
      'we-local-cap-econ': 8,
      'we-local-cap-blackbox': 12
    }
  };

  function normalizeTheme(id) {
    return WE_THEMES.some(theme => theme.id === id) ? id : 'default';
  }

  function getStoredTheme() {
    try { return normalizeTheme(localStorage.getItem(WE_THEME_KEY) || 'default'); }
    catch (e) { return 'default'; }
  }

  function applyTheme(id) {
    const theme = normalizeTheme(id);
    const root = document.documentElement;
    if (!root) return;
    if (theme === 'default') root.removeAttribute('data-we-theme');
    else root.setAttribute('data-we-theme', theme);
  }

  function setTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(WE_THEME_KEY, theme); } catch (e) {}
  }

  function setNpcTheme(id) {
    const theme = normalizeTheme(id);
    applyTheme(theme);
    try { localStorage.setItem(NPC_THEME_KEY, theme); } catch (e) {}
  }

  function applyEngineFaceTheme() {
    const face = getEngineFace();
    applyTheme(callEngineFace(face, 'getTheme', getStoredTheme()));
  }

  // Khôi phục theme ngay khi module tải, tránh bảng điều khiển và quả cầu nổi nháy màu mặc định trước.
  applyTheme(getStoredTheme());

  function h(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[m] || m));
  }

  /** Hiển thị văn bản người dùng thấy: thay {{user}} bằng tên nhân vật hiện tại, và escape HTML */
  function u(text) {
    return h(core.renderUserName(text));
  }

  function showToast(msg, isError, duration) {
    const id = 'we-toast';
    let el = document.getElementById(id);
    if (el) el.remove();
    el = document.createElement('div');
    el.id = id;
    el.className = 'we-toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    if (duration !== 0) setTimeout(() => el.remove(), duration || 3000);
  }

  // Câu cổ văn đi kèm tiêu đề nhỏ của mỗi trang (bỏ tiền tố cp- rồi tra bảng; trang cài đặt v.v. không có trong bảng thì bỏ trống)
  const SECTION_MOTTOS = {
    trends: 'Thế cuộc thiên hạ, dần dà mà thành',
    regional: 'Một phương báo động, bốn bề chấn động',
    ledger: 'Từng ly từng tí đều có căn nguyên',
    events: 'Động một sợi tóc, cả thân đều chuyển',
    winds: 'Gió nổi từ ngọn bèo xanh',
    influence: 'Kéo cành mà lay lá',
    reputation: 'Danh dự của người, như bóng theo hình',
    factions: 'Dưới gốc cây lớn, cỏ chẳng nhuốm sương',
    enemies: 'Kẻ thù hả hê, người thân đau xót',
    economy: 'Lương thực là gốc của dân, của cải là nguồn dùng của dân',
    blackbox: 'Tường có tai, giặc ẩn kề bên'
  };

  function sectionHeader(title, sectionId) {
    const collapsed = sectionCollapsed[sectionId] || false;
    const motto = SECTION_MOTTOS[sectionId.replace(/^cp-/, '')];
    const mottoHtml = motto ? `<span class="we-section-motto">— ${motto}</span>` : '';
    return `<span class="we-section-toggle" data-section="${sectionId}">
      <span class="we-section-arrow" id="we-section-arrow-${sectionId}">${collapsed ? '▶' : '▼'}</span>${title}${mottoHtml}
    </span>`;
  }

  function sectionBody(sectionId, content) {
    const collapsed = sectionCollapsed[sectionId] || false;
    return `<div class="we-section-body" id="we-section-body-${sectionId}" style="${collapsed ? 'display:none' : ''}">${content}</div>`;
  }

  function buildPanel() {
    if (document.getElementById('we-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'we-panel';
    panel.innerHTML = `
      <div class="we-panel-header">
        <div class="we-header-info">
          <div class="we-header-top">
            <button class="we-panel-title we-engine-face-toggle" type="button" title="Chuyển Sang Engine Kế Tiếp" aria-label="Chuyển Sang Engine Kế Tiếp">World Engine</button>
            <span class="we-panel-version" id="we-panel-version"></span><!-- [FIX] Số phiên bản -->
            <span class="we-header-round" id="we-header-round"></span>
          </div>
          <div class="we-header-mood" id="we-header-mood">
            <span class="we-header-dot"></span>
            <span class="we-header-mood-text"></span>
          </div>
        </div>
        <div class="we-panel-corner-actions">
          <button class="we-panel-close">✕</button>
          <button class="we-panel-settings" id="we-btn-settings-open" title="Cài Đặt"><i class="fa-solid fa-gear"></i></button>
        </div>
      </div>
      <div class="we-panel-body" id="we-panel-body">
        <div class="we-loading">Đang tải...</div>
      </div>
    `;
    document.body.appendChild(panel);
    panelElement = panel;
    panelBodyElement = panel.querySelector('#we-panel-body');

    // [FIX] Hiển thị số phiên bản mở rộng (lấy từ manifest.json, không đọc được thì ẩn đi)
    const verEl = panel.querySelector('#we-panel-version');
    if (verEl) {
      const v = window.WORLD_ENGINE_VERSION;
      if (v) verEl.textContent = 'v' + v;
      else verEl.style.display = 'none';
    }

    panel.querySelector('.we-panel-close').onclick = () => hidePanel();
    panel.querySelector('.we-engine-face-toggle').onclick = (event) => {
      event.stopPropagation();
      advanceEngineFace();
    };
    initDrag(panel, panel.querySelector('.we-panel-header'));

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && panelVisible) hidePanel();
    });
  }

  // View hiện tại: 'home' | 'situation' | 'events' | 'relations' | 'resources' | 'settings'
  let _currentView = 'home';

  function bindFilterControls(scope) {
    const npcScope = scope === 'npc';
    const id = suffix => npcScope ? 'we-npc-' + suffix : 'we-' + suffix;
    const textarea = document.getElementById(id('filter-regex'));
    if (!textarea) return;
    const tagsBox = document.getElementById(id('filter-tags'));
    const addInput = document.getElementById(id('filter-add-input'));
    const SIMPLE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN = /<([a-zA-Z_][\w-]*)/g;
    let tags = [];

    function parse(raw) {
      const selected = [], advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const match = line.match(SIMPLE);
        if (match) { if (!selected.includes(match[1])) selected.push(match[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { selected, advanced };
    }
    function syncTextarea() {
      const advanced = parse(textarea.value).advanced;
      const generated = tags.filter(item => item.checked).map(item => `<${item.name}>[\\s\\S]*?</${item.name}>\\n?`);
      textarea.value = generated.concat(advanced).join('\n');
    }
    function renderTags() {
      if (!tagsBox) return;
      tagsBox.innerHTML = '';
      for (const item of tags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.checked = item.checked;
        checkbox.onchange = () => { item.checked = checkbox.checked; syncTextarea(); };
        const name = document.createElement('span'); name.textContent = item.name;
        const remove = document.createElement('span');
        remove.textContent = '✕'; remove.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        remove.onclick = event => { event.preventDefault(); tags = tags.filter(entry => entry.name !== item.name); renderTags(); syncTextarea(); };
        chip.append(checkbox, name, remove); tagsBox.appendChild(chip);
      }
    }
    function syncTags() {
      const selected = parse(textarea.value).selected;
      const set = new Set(selected);
      tags.forEach(item => { item.checked = set.has(item.name); });
      selected.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags();
    }
    function addTag(name) {
      name = String(name || '').trim();
      if (!name) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(name)) { showToast('Tên thẻ không hợp lệ (chỉ cho phép chữ, số, gạch dưới và gạch nối)', true); return; }
      if (!tags.some(item => item.name === name)) tags.push({ name, checked: true });
      if (addInput) addInput.value = '';
      renderTags(); syncTextarea();
    }
    document.getElementById(id('btn-filter-add'))?.addEventListener('click', () => addTag(addInput?.value));
    addInput?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); addTag(addInput.value); } });
    document.getElementById(id('btn-filter-scan'))?.addEventListener('click', () => {
      let text = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && !chat[i].is_user && String(chat[i].mes || '').trim()) { text = String(chat[i].mes); break; }
      } catch (error) {}
      if (!text) { showToast('Không tìm thấy phản hồi AI', true); return; }
      const found = []; let match; SCAN.lastIndex = 0;
      while ((match = SCAN.exec(text)) !== null) if (!found.includes(match[1])) found.push(match[1]);
      if (!found.length) { showToast('Không phát hiện thẻ nào trong phản hồi AI mới nhất', true); return; }
      found.forEach(name => { if (!tags.some(item => item.name === name)) tags.push({ name, checked: true }); });
      renderTags(); syncTextarea(); showToast(`Đã quét được ${found.length} thẻ`);
    });
    document.getElementById(id('btn-filter-test'))?.addEventListener('click', () => {
      const core = window.WORLD_ENGINE_CORE;
      const status = document.getElementById(id('filter-status'));
      if (!textarea.value.trim()) { showToast('Chưa nhập biểu thức chính quy', true); if (status) status.textContent = '(Chưa nhập biểu thức chính quy)'; return; }
      const validated = core?.validateFilterRegex?.(textarea.value);
      if (!validated) { showToast('Module core không khả dụng', true); return; }
      if (validated.bad.length) {
        if (status) status.textContent = `Đã dừng kiểm tra——⚠️ ${validated.ok} dòng hợp lệ / ${validated.bad.length} dòng lỗi:\n` + validated.bad.map(item => `Dòng ${item.line} "${item.raw}" không hợp lệ: ${item.reason}`).join('\n');
        showToast(`Có ${validated.bad.length} biểu thức chính quy không hợp lệ, vui lòng sửa trước`, true); return;
      }
      let sample = '';
      try {
        const chat = SillyTavern.getContext()?.chat || [];
        for (let i = chat.length - 1; i >= 0; i--) if (String(chat[i]?.mes || '').trim()) { sample = String(chat[i].mes); break; }
      } catch (error) {}
      if (!sample) { showToast('Cuộc trò chuyện hiện tại không có văn bản để kiểm tra', true); return; }
      let work = sample, removed = 0;
      for (const entry of validated.entries) {
        const regex = new RegExp(entry.pattern, entry.flags); let match, count = 0;
        while ((match = regex.exec(work)) !== null) { count++; if (match.index === regex.lastIndex) regex.lastIndex++; }
        work = work.replace(regex, ''); removed += count;
      }
      if (status) status.textContent = `Đã xóa ${removed} chỗ.\nTrước: ${sample.slice(0, 60)}${sample.length > 60 ? '…' : ''}\nSau: ${work.slice(0, 60)}${work.length > 60 ? '…' : ''}`;
      showToast(`Đã xóa ${removed} chỗ`);
    });
    let timer;
    textarea.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(syncTags, 300); });
    syncTags();
  }

  function updateEngineFaceChrome() {
    if (!panelElement) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.panelClass) panelElement.classList.remove(registered.panelClass);
    }
    if (face.panelClass) panelElement.classList.add(face.panelClass);
    const title = panelElement.querySelector('.we-engine-face-toggle');
    if (title) {
      const next = getNextEngineFace();
      title.textContent = face.label;
      title.title = 'Chuyển Sang Giao Diện Kế Tiếp: ' + next.label;
      title.setAttribute('aria-label', title.title);
    }
    const settings = panelElement.querySelector('#we-btn-settings-open');
    if (settings) {
      settings.classList.toggle('is-active', Boolean(callEngineFace(face, 'isSettingsOpen', false)));
      settings.title = face.label + ' Cài Đặt';
    }
    const version = panelElement.querySelector('#we-panel-version');
    if (version) {
      const value = callEngineFace(face, 'getVersion', '');
      version.textContent = value ? 'v' + value : '';
      version.style.display = value ? '' : 'none';
    }
    syncBallFace();
  }

  function advanceEngineFace() {
    switchEngineFace(getNextEngineFace().id);
  }

  function switchEngineFace(targetId) {
    if (!panelElement || _panelFlipping) return;
    const target = getEngineFace(targetId);
    if (!target || target.id === _engineFace) return;
    _panelFlipping = true;
    panelElement.classList.add('we-panel-flip-out');
    window.setTimeout(() => {
      _engineFace = target.id;
      applyEngineFaceTheme();
      syncBallFace();
      panelElement.classList.remove('we-panel-flip-out');
      panelElement.classList.add('we-panel-flip-in');
      refresh();
      // Đặt mặt mới sang phía bên kia trước, rồi để trình duyệt hoàn tất nửa sau của cú lật.
      void panelElement.offsetWidth;
      panelElement.classList.remove('we-panel-flip-in');
      window.setTimeout(() => { _panelFlipping = false; }, 220);
    }, 180);
  }
  // Chế độ hiển thị: 'mask' = che (trang chủ + trang con) | 'expand' = mở rộng (toàn bộ section trải phẳng)
  function isExpandMode() {
    const s = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings()
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    return s.displayMode === 'expand';
  }
  // Điều hướng trang chủ: nhấn một lần để chọn dòng (nhấn lần nữa mới vào)
  let _selectedNavView = null;
  // Cờ đang diễn biến + nền hiển thị của lần diễn biến này:
  //   'checkpoint' = diễn biến lại (gửi điểm lưu trữ B, bảng hiển thị B)
  //   'state'      = diễn biến tiến (gửi trạng thái hiện tại A, bảng hiển thị A)
  // Trong lúc diễn biến kết quả mới chưa ghi lại, dựa vào hai biến này để quyết định bảng hiển thị bản nào, đợi ghi xong mới làm mới.
  let _evolving = false;
  let _evolvingScope = 'state';
  // Nhóm trạng thái thực sự được chèn vào nội dung lần gần nhất; làm mới thông thường phải theo nó, không được đoán lại theo tầng tức thời.
  let _injectedScope = null;

  /**
   * Tính toán trạng thái thế giới thực sự đang được chèn vào nội dung lúc này (dùng cùng
   * tiêu chí tầng với applyInjectionForCurrentRound của world-engine.js):
   *   Số tầng hội thoại < số tầng trạng thái hiện tại và có điểm lưu trữ → chèn/hiển thị điểm lưu trữ (roll lại lùi về)
   *   Ngược lại → chèn/hiển thị trạng thái hiện tại
   * scope trả về đồng thời quyết định ghi chỉnh sửa vào nhóm lưu trữ nào.
   */
  function getActiveInjected(state, checkpoint) {
    // Đang diễn biến: kết quả mới chưa ghi lại, hiển thị theo nền của lần diễn biến này——
    //   Diễn biến lại (_evolvingScope='checkpoint') → hiển thị điểm lưu trữ B;
    //   Diễn biến tiến (_evolvingScope='state')   → hiển thị trạng thái hiện tại A.
    if (_evolving) {
      if (_evolvingScope === 'checkpoint' && checkpoint) {
        return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
      }
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    if (_injectedScope === 'checkpoint' && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    if (_injectedScope === 'state') {
      return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
    }
    const chatLayer = core.getChatLayer();
    const stateLayer = Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : chatLayer;
    if (chatLayer < stateLayer && checkpoint) {
      return { state: checkpoint, scope: 'checkpoint', layer: getCheckpointLayer(checkpoint) };
    }
    return { state: state, scope: 'state', layer: Number.isFinite(Number(state.chatLayer)) ? Number(state.chatLayer) : getChatLayer() };
  }

  // Đọc/ghi theo nhóm lưu trữ đang hiển thị/chỉnh sửa hiện tại: scope==='checkpoint' đọc/ghi điểm lưu trữ, còn lại đọc/ghi trạng thái chính.
  // Bảng điều khiển có thể đang hiển thị điểm lưu trữ (roll lại lùi về) hoặc mục điểm lưu trữ ở trang cài đặt, lúc này mọi chỉnh sửa đều phải
  // ghi lại vào điểm lưu trữ chứ không phải trạng thái chính, nếu không sẽ "dữ liệu đổi mà giao diện không động / bấm không phản hồi" (lỗi cùng gốc với Tin Đồn).
  function loadScopedState(scope) {
    return scope === 'checkpoint' ? core.restoreCheckpoint() : core.loadState();
  }
  function saveScopedState(scope, scopedState) {
    if (scope === 'checkpoint') core.saveCheckpoint(scopedState);
    else core.saveState(scopedState);
  }

  function isEditingPanelContent() {
    if (editingEvent || editingFaction || editingWind || editingTrend || editingDigest ||
        editingEnemy || editingInfluence || editingRI || editingSecret) return true;

    // Một số ít nội dung như tín hiệu kinh tế dùng contentEditable để chỉnh sửa trực tiếp, không đi qua các biến trạng thái chỉnh sửa ở trên.
    const active = document.activeElement;
    return !!(active && panelBodyElement && panelBodyElement.contains(active) && active.isContentEditable);
  }

  function refresh(auto) {
    if (!panelElement || !panelVisible) return;
    updateEngineFaceChrome();
    const currentFace = getEngineFace();
    // Làm mới tự động nền sẽ dựng lại toàn bộ DOM. Trang cài đặt hoặc trạng thái chỉnh sửa của mọi engine đều phải được chặn trước
    // khi vào nhánh render riêng của mình; nếu không giao diện không phải world sẽ bỏ qua bảo vệ, vẽ lại mỗi 30 giây.
    // Lưu, hủy, v.v. chủ động gọi refresh() (auto=false) vẫn làm mới bình thường.
    const settingsOpen = currentFace.id === 'world'
      ? _currentView === 'settings'
      : Boolean(callEngineFace(currentFace, 'isSettingsOpen', false));
    if (auto && (settingsOpen || isEditingPanelContent())) return;
    if (currentFace.id !== 'world') {
      if (panelBodyElement) panelBodyElement.innerHTML = callEngineFace(
        currentFace,
        'render',
        '<div class="we-empty">Giao diện engine này tải thất bại hoặc chưa cung cấp bộ render; các engine khác không bị ảnh hưởng.</div>'
      );
      bindEvents(null);
      callEngineFace(currentFace, 'bind', undefined, panelBodyElement);
      return;
    }
    const body = panelBodyElement;
    if (!body) return;
    listPagerCounter = 0;

    const state = core.loadState();
    const checkpoint = core.restoreCheckpoint();
    const cpLayer = getCheckpointLayer(checkpoint);
    const active = getActiveInjected(state, checkpoint);
    const s = active.state;

    const _wbListEl = document.getElementById('we-worldbook-list');
    if (_wbListEl) _wbScrollTop = _wbListEl.scrollTop;

    if (_currentView === 'home') {
      body.innerHTML = isExpandMode()
        ? renderHomeViewExpanded(s, active.layer, active.scope)
        : renderHomeView(s, active.layer, active.scope);
    } else if (_currentView === 'settings') {
      body.innerHTML = renderSettingsView(checkpoint, cpLayer);
    } else {
      body.innerHTML = renderSubView(_currentView, s, active.layer, active.scope);
    }

    updatePanelHeader(s, active.layer);
    bindEvents(state);
  }

  /**
   * Độ ổn định thế giới (tính toán thuần UI theo thời gian thực, chỉ đọc, không ghi lưu trữ/không vào prompt/không trả API)
   * Độ ổn định = clamp(100 - áp lực thế giới, 0, 100)
   */
  function localSettingNumber(key, fallback, min, max) {
    const settings = window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings ? window.WORLD_ENGINE_API.getSettings() : {};
    const n = Number(settings[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function localTerminalKeepRounds(event) {
    const base = Math.round(localSettingNumber('localTerminalBaseKeepRounds', 2, 0));
    const perLevel = Math.round(localSettingNumber('localTerminalLevelKeepRounds', 2, 0));
    return Math.max(1, base + (Number(event && event.level) || 1) * perLevel);
  }

  function localEventMaxFails(event) {
    const level = Number(event && event.level) || 1;
    const progressBase = Math.round(localSettingNumber('localProgressFailBase', 2, 0));
    const conflictBase = Math.round(localSettingNumber('localConflictFailBase', 6, 1));
    return event && event.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

  function computeWorldStability(state) {
    state = state || {};
    const round = Number(state.round) || 0;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Chuỗi sự kiện: chỉ tính Lv3/4, mỗi mục tối đa 60
    const CONFLICT_BASE = { 'Manh Nha':0, 'Âm Ỉ':1, 'Cận Kề':2, 'Đã Bùng Phát':4, 'Đã Tan Biến':0 };
    const PROGRESS_BASE = { 'Chuẩn Bị':0, 'Thực Hiện':1, 'Then Chốt':2, 'Đã Hoàn Thành':-2, 'Đã Thất Bại':0 };
    let eventP = 0;
    for (const e of (state.events || [])) {
      const level = Number(e.level) || 1;
      if (level < 3) continue;
      const isProgress = e.type === 'progress';
      const base = isProgress ? PROGRESS_BASE : CONFLICT_BASE;
      const keepTotal = localTerminalKeepRounds(e);
      const remainFactor = () => {
        if (e._terminalSince === undefined) return 1;
        return clamp((keepTotal - (round - e._terminalSince)) / keepTotal, 0, 1);
      };
      let p;
      if (e.stage === 'Đã Bùng Phát') p = 4 * level * 0.5 * remainFactor();
      else if (e.stage === 'Đã Hoàn Thành') p = -2 * remainFactor();        // không nhân level
      else if (e.stage === 'Đã Tan Biến' || e.stage === 'Đã Thất Bại') p = 0;
      else p = (base[e.stage] || 0) * level * 0.5;
      if (e.stall) p *= 0.65;
      eventP += clamp(p, -60, 60);
    }

    // Tin Đồn: chỉ tính Lv3/4, tổng tối đa 25
    const WIND_BASE = { rumor:0.5, announcement:1, report:1.5, sentiment:2 };
    let windP = 0;
    for (const w of (state.winds || [])) {
      const level = Number(w.level) || 1;
      if (level < 3) continue;
      windP += (WIND_BASE[w.type] || 0) * level;
    }
    windP = Math.min(windP, 25);

    // Đại thế thiên hạ: mỗi mục đang tiếp diễn +6, tổng tối đa 20
    let trendP = 0;
    for (const t of (state.worldTrends || [])) if (t.status !== 'Đã Kết Thúc') trendP += 6;
    trendP = Math.min(trendP, 20);

    // Thế lực: giá trị quan hệ × hệ số trạng thái, tổng tối đa 35
    const REL = { 'Huyết Minh':-1.5, 'Đồng Minh':-1, 'Thân Thiện':-0.5, 'Trung Lập':0, 'Lạnh Nhạt':0.5, 'Thù Địch':1, 'Thâm Thù':1.5 };
    const STAT = { 'Cực Thịnh':1.25, 'Ổn Định':1, 'Nội Đấu':0.75, 'Khốn Đốn':0.5, 'Suy Tàn':0.25, 'Tan Rã':0 };
    let factionP = 0;
    for (const f of (state.factions || [])) {
      const rel = REL[f.relation] !== undefined ? REL[f.relation] : 0;
      const st = STAT[f.status] !== undefined ? STAT[f.status] : 1;
      factionP += rel * st;
    }
    factionP = clamp(factionP, -35, 35);

    // Kinh tế: chỉ xét climate
    const CLIMATE = { 'Phồn Vinh':-2, 'Bình Ổn':0, 'Suy Thoái':1, 'Biến Động':2 };
    const econP = CLIMATE[(state.economy || {}).climate] || 0;

    // Biến cố khu vực: đang kích hoạt +5
    const regionP = (state.regionalIncident && state.regionalIncident.active) ? 5 : 0;

    // Kẻ thù, hộp đen: theo thiết kế không tính vào độ ổn định thế giới

    const pressure = eventP + windP + trendP + factionP + econP + regionP;
    const stability = Number(clamp(100 - pressure, 0, 100).toFixed(1));
    const tier =
      stability >= 90 ? 'Thiên Hạ Thái Bình' :
      stability >= 70 ? 'Sóng Ngầm Trỗi Dậy' :
      stability >= 45 ? 'Cục Diện Căng Thẳng' :
      stability >= 20 ? 'Loạn Lạc Mất Trật Tự' : 'Bên Bờ Sụp Đổ';

    const r1 = v => Number(v.toFixed(1));
    return {
      stability, tier, pressure: r1(pressure),
      breakdown: {
        'Sự Kiện': r1(eventP), 'Tin Đồn': r1(windP), 'Đại Thế': r1(trendP), 'Thế Lực': r1(factionP),
        'Kinh Tế': r1(econP), 'Khu Vực': r1(regionP)
      }
    };
  }

  const STABILITY_TIER_COLOR = {
    'Thiên Hạ Thái Bình': '#69b68e', 'Sóng Ngầm Trỗi Dậy': '#58b8a9', 'Cục Diện Căng Thẳng': '#d0aa58',
    'Loạn Lạc Mất Trật Tự': '#d98a3d', 'Bên Bờ Sụp Đổ': '#ff0000'
  };

  // Cấp độ ổn định → chữ nhỏ ở đầu trang (câu thơ)
  const STABILITY_TIER_MOOD = {
    'Thiên Hạ Thái Bình': 'Biển lặng không gợn sóng', 'Sóng Ngầm Trỗi Dậy': 'Nước ngầm cuốn hoa trôi', 'Cục Diện Căng Thẳng': 'Mây gấp gió càng dữ',
    'Loạn Lạc Mất Trật Tự': 'Càn khôn đầy thương tích', 'Bên Bờ Sụp Đổ': 'Trục đất nghiêng sắp gãy'
  };

  /** Làm mới "Vòng X + chữ nhỏ độ ổn định" ở đầu trang */
  function updatePanelHeader(state, layer) {
    const roundEl = document.getElementById('we-header-round');
    if (roundEl) {
      const layerText = (layer !== undefined && layer !== null && layer !== '-') ? ' · Tầng ' + layer : '';
      roundEl.textContent = 'Vòng ' + ((state && state.round) || 0) + layerText;
    }
    const moodEl = document.getElementById('we-header-mood');
    if (moodEl) {
      const stab = computeWorldStability(state || {});
      const color = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
      const text = STABILITY_TIER_MOOD[stab.tier] || '';
      const dot = moodEl.querySelector('.we-header-dot');
      const txt = moodEl.querySelector('.we-header-mood-text');
      if (dot) { dot.style.background = color; dot.style.boxShadow = '0 0 6px ' + color; }
      if (txt) { txt.textContent = text; txt.style.color = color; }
    }
  }

  const VIEW_TITLES = {
    situation: 'Tình Hình', events: 'Sự Kiện', relations: 'Quan Hệ', resources: 'Tài Nguyên', worldNotes: 'Chú Thích TG', settings: 'Cài Đặt'
  };

  function renderSection(title, id, content) {
    return '<div class="we-section" id="we-sec-' + id + '"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' + sectionBody(id, content) + '</div>';
  }

  function renderWorldDigest(s, scope) {
    const isEditing = editingDigest?.scope === scope;
    const editor = isEditing
      ? '<div class="we-event-editor we-digest-editor" data-digest-scope="' + h(scope) + '">'
        + '<button class="we-event-editor-close we-digest-editor-close" title="Hủy">✕</button>'
        + '<textarea class="we-digest-edit-text" rows="6">' + h(s.worldDigest || '') + '</textarea>'
        + '<div class="we-event-editor-footer"><button class="we-btn we-btn-primary we-digest-editor-save">Lưu</button></div>'
        + '</div>'
      : '<div class="we-digest">' + u(s.worldDigest) + '</div>';

    return '<div class="we-section we-digest-card" id="we-sec-digest">'
      + '<div class="we-section-title">Tóm Tắt Thế Giới</div>'
      + editor
      + '<div class="we-event-actions">'
      + '<button class="we-icon-btn we-digest-edit" data-digest-scope="' + h(scope) + '" title="Chỉnh Sửa"><i class="fa-solid fa-pen"></i></button>'
      + '</div></div>';
  }

  function renderHomeView(s, layer, scope) {
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';

    const rows = [
      { view: 'situation', label: 'Tình Hình', sub: 'Đại thế thiên hạ · Biến cố khu vực · Sổ sách', poem: 'Thiên hạ tụ hội hưởng ứng' },
      { view: 'events',    label: 'Sự Kiện', sub: 'Chuỗi sự kiện · Tin Đồn · Chuỗi ảnh hưởng',     poem: 'Việc đến ắt có ứng' },
      { view: 'relations', label: 'Quan Hệ', sub: 'Danh tiếng · Thế lực · Sổ ân oán',       poem: 'Đồng thanh tương ứng, đồng khí tương cầu' },
      { view: 'resources', label: 'Tài Nguyên', sub: 'Kinh tế · Bí mật',               poem: 'Đất chứa kho vô tận' },
      { view: 'worldNotes', label: 'Chú Thích TG', sub: 'Bách khoa thế giới · Ghi chú lượt gần nhất', poem: 'Biết người biết ta, trăm trận trăm thắng' },
    ];

    const navRows = rows.map((r, i) => {
      const topLine = i === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const botLine = i === rows.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const sel = _selectedNavView === r.view ? ' we-nav-row--selected' : '';
      return '<div class="we-nav-row' + sel + '" data-view="' + r.view + '">'
        + '<div class="we-nav-label">' + r.label + '</div>'
        + '<div class="we-nav-track">' + topLine + '<div class="we-nav-dot"></div>' + botLine + '</div>'
        + '<div class="we-nav-content"><span class="we-nav-sub">' + r.sub + '</span><span class="we-nav-poem">' + r.poem + '</span></div>'
        + '<i class="fa-solid fa-chevron-right we-nav-arrow"></i>'
        + '</div>';
    }).join('');

    return renderWorldCore(s)
      + '<div class="we-nav-list" style="--we-tier-color:' + tierColor + ';">' + navRows + '</div>'
      + renderWorldDigest(s, scope);
  }

  /** Trang chủ chế độ mở rộng: lõi thế giới + tóm tắt thế giới + tất cả section trải phẳng (như điểm lưu trữ) */
  function renderHomeViewExpanded(s, layer, scope) {
    return renderWorldCore(s)
      + renderWorldDigest(s, scope)
      + renderSection('Đại Thế Thiên Hạ', 'trends', renderWorldTrends(s.worldTrends, scope))
      + renderSection('Biến Cố Khu Vực', 'regional', renderRegionalIncident(s.regionalIncident, scope))
      + renderSection('Chuỗi Sự Kiện', 'events', renderEventList(s.events, scope))
      + renderSection('Tin Đồn', 'winds', renderWindList(s.winds, scope))
      + renderSection('Chuỗi Ảnh Hưởng', 'influence', renderInfluenceChain(s.influenceChain, scope))
      + renderSection('Danh Tiếng', 'reputation', renderReputation(s.reputation, scope))
      + renderSection('Thế Lực', 'factions', renderFactionList(s.factions, scope))
      + renderSection('Sổ Ân Oán', 'enemies', renderEnemies(s.enemies, scope))
      + renderSection('Kinh Tế', 'economy', renderEconomy(s.economy, scope))
      + renderSection('Bí Mật', 'blackbox', renderBlackbox(s.blackbox, scope))
      + renderSection('Sổ Sách Sự Kiện', 'ledger', renderLedger(s.memories))
      + renderSection('Chú Thích Thế Giới', 'worldnotes', renderWorldNotes(s.worldNotes));
  }

  function renderSubView(viewKey, s, layer, scope) {
    let content = '';
    if (viewKey === 'situation') {
      content = renderSection('Đại Thế Thiên Hạ', 'trends', renderWorldTrends(s.worldTrends, scope))
        + renderSection('Biến Cố Khu Vực', 'regional', renderRegionalIncident(s.regionalIncident, scope))
        + renderSection('Sổ Sách Sự Kiện', 'ledger', renderLedger(s.memories));
    } else if (viewKey === 'events') {
      content = renderSection('Chuỗi Sự Kiện', 'events', renderEventList(s.events, scope))
        + renderSection('Tin Đồn', 'winds', renderWindList(s.winds, scope))
        + renderSection('Chuỗi Ảnh Hưởng', 'influence', renderInfluenceChain(s.influenceChain, scope));
    } else if (viewKey === 'relations') {
      content = renderSection('Danh Tiếng', 'reputation', renderReputation(s.reputation, scope))
        + renderSection('Thế Lực', 'factions', renderFactionList(s.factions, scope))
        + renderSection('Sổ Ân Oán', 'enemies', renderEnemies(s.enemies, scope));
    } else if (viewKey === 'resources') {
      content = renderSection('Kinh Tế', 'economy', renderEconomy(s.economy, scope))
        + renderSection('Bí Mật', 'blackbox', renderBlackbox(s.blackbox, scope));
    } else if (viewKey === 'worldNotes') {
      content = renderSection('Chú Thích Thế Giới', 'worldnotes', renderWorldNotes(s.worldNotes));
    }
    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="Quay Lại"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">' + (VIEW_TITLES[viewKey] || viewKey) + '</span>'
      + '</div>' + content;
  }

  /** Tiêu đề nhỏ của điểm lưu trữ: chữ nhỏ màu xanh mặc định + "- Vòng N - Tầng M" */
  function checkpointTitle(checkpoint, cpLayer) {
    if (!checkpoint) return 'Điểm Lưu Trữ';
    const round = checkpoint.round || 0;
    const layer = (cpLayer === undefined || cpLayer === null) ? '-' : cpLayer;
    return 'Điểm Lưu Trữ - Vòng ' + round + ' - Tầng ' + layer;
  }

  // Nhật ký cập nhật (dữ liệu thuần; tách rời khỏi phần hiển thị. Khi phát hành phiên bản mới chỉ cần thêm một mục vào đầu mảng).
  //   version —— chữ trên nút thanh chọn phiên bản + khớp làm nổi bật với phiên bản hiện tại của manifest;
  //   date    —— tùy chọn, ngày không chắc chắn thì để tháng/năm;
  //   items   —— các mục thay đổi của phiên bản đó (mỗi mục một dòng, khi hiển thị sẽ qua h() để escape).
  const CHANGELOG = [
    { version: '3.0.2', date: '2026-07-19', items: ['Nới lỏng điều kiện tạo sớm cho chuỗi sự kiện: khi đã có dấu hiệu cụ thể của việc lên kế hoạch, dò xét, bắt đầu điều tra hoặc mâu thuẫn manh nha, có thể vào chuỗi sự kiện để theo dõi liên tục dù chưa chín muồi.', 'Nới lỏng điểm khởi phát của Tin Đồn: một khi chủ đề thông tin rõ ràng bắt đầu công bố, được người khác nghe thấy hoặc thuật lại, truyền qua kênh nào đó hoặc hình thành bàn tán phạm vi nhỏ, là có thể tạo, không còn yêu cầu đã ảnh hưởng đến trạng thái bền vững khác.', 'Giữ nguyên quy tắc gộp, khử trùng lặp và ranh giới lan truyền hợp lệ của sự kiện và Tin Đồn, tránh sau khi nới lỏng điều kiện vào lại sinh ra mục trùng lặp hoặc rò rỉ thông tin riêng tư.'] },
    { version: '3.0.1', date: '2026-07-16', items: ['Sửa lỗi tiêu đề chuỗi sự kiện và chữ cấp độ Lv.2 gần trùng màu nền, khó đọc ở theme sáng Vân Bạch và Anh Đào Sớm.', 'Cấp độ, loại, giai đoạn sự kiện, kết quả diễn biến, dấu chốt cuối và đếm ngược đổi sang tự thích ứng độ tương phản cho theme sáng; theme tối giữ nguyên bảng màu cũ.'] },
    { version: '3.0.0', date: '2026-07-14', items: ['World Engine bước vào phiên bản chính thức 3.0: tiếp tục lấy diễn biến trạng thái thế giới độc lập, chèn theo tầng, cơ chế sự kiện cục bộ, bảng điều khiển có thể chỉnh sửa và lưu trữ theo cấp cuộc trò chuyện làm cốt lõi.', 'Memory Engine 1.0 chính thức tích hợp: nhân vật, thực thể, lược ghi và tổng thuật giữ dữ liệu và ranh giới lỗi độc lập, có thể cung cấp cho diễn biến thế giới ký ức nhân vật và thực thể mới nhất được khớp khi cần.', 'Lược ghi tự động tính vòng mới bắt đầu từ tầng hiện tại lúc lần đầu vào cuộc trò chuyện; việc xử lý hội thoại lịch sử chỉ thực hiện qua điền lại hàng loạt lược ghi và tổng thuật.'] },
    { version: '2.5.4', date: '2026-07-14', items: ['Tác vụ Memory Engine gắn thông báo vận hành ở đầu trang: nhân vật/thực thể, lược ghi, tổng thuật khi chạy tự động hoặc thủ công đều hiển thị trạng thái bắt đầu, hoàn thành, thất bại hoặc dừng.'] },
    { version: '2.5.3', date: '2026-07-14', items: ['Thêm con trỏ xử lý dưới tiêu đề Memory Engine: tầng xử lý nhân vật/thực thể, tầng xử lý lược ghi và số lược ghi đã gộp vào tổng thuật; chưa xử lý thì hiển thị thống nhất là 0, không thêm trường lưu trữ mới.'] },
    { version: '2.5.2', date: '2026-07-14', items: ['Cài đặt World và Memory thêm "Tầng Đầu Là Lời Mở Đầu Của AI", mặc định bật; khi bật thì tự động tổng kết và điền lại hàng loạt bỏ qua tầng 0, khi tắt thì tầng đầu được xử lý như hội thoại thông thường.', 'Trình chỉnh sửa dữ liệu ký ức thống nhất dùng ô nhập màu tối và chữ trắng, cải thiện khả năng đọc khi chỉnh sửa ở mọi theme.'] },
    { version: '2.5.1', date: '2026-07-13', items: ['Thêm cơ chế cục bộ "Sự Kiện Ngẫu Nhiên Cận": theo xác suất tạo ra một chuỗi sự kiện hoặc Tin Đồn có quan hệ nhân quả rõ ràng với hội thoại hiện tại, nhân vật chính, khu vực hoặc việc đang phát triển, kết quả tự động chuyển thành đối tượng event/wind chính thức.', 'Diễn biến cận hỗ trợ điều chỉnh xác suất kích hoạt, thời gian hồi sau khi thành công và tỷ lệ chuỗi sự kiện/Tin Đồn; loại được chọn trước cục bộ, khi kết quả trả về không hợp lệ hoặc API lỗi vẫn giữ nguyên loại cũ và buộc tạo tiếp, thời gian hồi tối thiểu là 1. Sự kiện cận, xa và khu vực có thể hoàn thành riêng trong cùng một vòng.', 'Tinh giản và nới lỏng quy tắc tạo và gộp chuỗi sự kiện: xóa các điều kiện quá khắt khe như "ít nhất hai hướng đi tương lai", nhận diện cùng một sự việc chính qua mục tiêu cốt lõi, đối tượng chính và quá trình thực hiện liên tục; các bước, trở ngại, kết quả cục bộ và hậu xử lý của sự việc đã có vẫn dùng id cũ, chỉ sự việc mới có thể phát triển độc lập qua nhiều vòng mới tạo chuỗi sự kiện riêng.'] },
    { version: '2.5.0', date: '2026-07-12', items: ['Thêm cơ chế cục bộ "Sự Kiện Ngẫu Nhiên Xa": khi sổ sách sự kiện đạt ngưỡng có thể điều chỉnh sẽ kích hoạt theo xác suất, rút một phần tư sổ sách mới nhất và bổ sung ngẫu nhiên từ bản ghi cũ cho đủ một nửa, yêu cầu API diễn biến tạo ra một chuỗi sự kiện xa hoặc Tin Đồn không liên quan trực tiếp đến nhân vật chính và sổ sách hiện có.', 'Diễn biến xa được chọn trước cục bộ theo tỷ lệ có thể điều chỉnh giữa chuỗi sự kiện hoặc Tin Đồn (mặc định mỗi loại 50%), dùng nhãn tạm để xác nhận tạo thành công rồi mới gán ID chính thức; khi kết quả trả về không hợp lệ hoặc API lỗi vẫn giữ cùng loại và mẫu sổ sách để buộc tạo tiếp, thành công thì vào thời gian hồi có thể điều chỉnh.', 'Chèn nội dung thêm tùy chọn "Chèn Toàn Bộ Cấp Độ": khi bật thì Lv1–Lv4 của chuỗi sự kiện và Tin Đồn đều được chèn; khi tắt vẫn giữ lọc cấp độ cao, và vẫn chèn khi sự kiện cấp thấp đã bùng phát/đã hoàn thành.', 'Mô tả loại biến cố khu vực đổi sang cách diễn đạt trung tính, đa thể loại hơn, bỏ các từ ràng buộc phong cách cổ trang như quan đạo, tiệm muối, hương binh, và yêu cầu biểu hiện cụ thể phù hợp với thế giới quan, thời đại, công nghệ, địa lý và chế độ xã hội hiện tại.', 'Sửa lỗi bất thường khi cấu hình thời gian hồi bằng 0: thời gian hồi sự kiện xa, thời gian hồi sau khi biến cố khu vực tan biến và số vòng kéo dài của biến cố khu vực thống nhất giới hạn tối thiểu là 1.'] },
    { version: '2.4.2', date: '2026-07-12', items: ['Quy tắc chèn trạng thái thế giới và hành vi nội dung đổi sang cách diễn đạt trung tính, đa thể loại hơn, và đồng bộ với cơ chế World Engine hiện tại.', 'Thêm 6 bộ màu giao diện, bảng điều khiển, thanh trạng thái trên cùng và quả cầu nổi đổi màu đồng bộ; bốn khối trong cơ chế cục bộ thêm nút khôi phục mặc định riêng.', 'Cài đặt nâng cao thêm số lần tự động thử lại khi API lỗi: hỗ trợ thử lại khi trả về rỗng, lỗi ký tự, phân tích thất bại, lỗi HTTP, hết thời gian chờ và lỗi mạng, mặc định tắt.'] },
    { version: '2.4.1', date: '2026-07-11', items: ['Thêm cài đặt "Cơ Chế Cục Bộ": biến cố khu vực, xúc xắc sự kiện, Tin Đồn tan biến, giới hạn giữ lại tách thành bốn khối có thể thu gọn, công thức quan trọng viết thẳng trong cài đặt, có thể điều chỉnh các tham số như bùng phát sự kiện, tiến triển/thất bại, tan biến và số vòng giữ lại.', 'Cài đặt chèn thêm số ký tự chèn tối đa, có thể kiểm soát độ dài chèn trạng thái thế giới theo ngữ cảnh mô hình và cấu hình SillyTavern, tránh prompt bị trạng thái quá dài chiếm hết chỗ.'] },
    { version: '2.4.0', date: '2026-07-10', items: ['Nhánh chính hợp nhất tăng cường trạng thái thế giới từ nhánh test: thực thể liên tục thêm id ổn định, các đối tượng như sự kiện, thế lực, đại thế thiên hạ, Tin Đồn, kẻ thù ít bị gộp nhầm hoặc nhiễm trùng lặp hơn khi đổi tên, roll lại, khôi phục lưu trữ và sao chép.', 'Tối ưu điều kiện vào và quy tắc prompt diễn biến của các module trạng thái thế giới: thắt chặt điều kiện tạo/cập nhật của các module như danh tiếng, kinh tế, kẻ thù, hộp đen thông tin, biến cố khu vực, ranh giới biết chuyện, giảm cập nhật vô căn cứ, rò rỉ trên bảng điều khiển và lưu dữ liệu quá mức.'] },
    { version: '2.3.22', date: '2026-07-10', items: ['Console thêm log có cấu trúc "Tham Số Yêu Cầu API": mỗi lần diễn biến sẽ in ra phương thức kết nối, địa chỉ đích, mô hình, temperature, max_tokens, số giây timeout, số lượng tin nhắn và số ký tự prompt, tiện đối chiếu tham số yêu cầu thực tế; log không xuất API Key, cũng không hiển thị toàn văn prompt.'] },
    { version: '2.3.21', date: '2026-07-10', items: ['Trang cài đặt API thêm ba tùy chọn: nhiệt độ, token đầu ra tối đa, thời gian chờ yêu cầu (giây); yêu cầu diễn biến không còn hardcode 0.7 / 8000 mà đọc theo cài đặt người dùng.', 'Tăng cường bảo vệ khi API không phản hồi: timeout bao trùm toàn bộ quá trình đọc header và nội dung phản hồi, tránh trường hợp server phản hồi nửa chừng hoặc nội dung bị kẹt khiến mãi ở trạng thái "đang diễn biến"; lấy danh sách mô hình cũng bị hủy theo cùng timeout đó.'] },
    { version: '2.3.20', date: '2026-07-09', items: ['Thanh quay lại và tiêu đề phân cấp của trang cấp hai đổi sang dính ở đầu trang, danh sách dài cuộn đến bất kỳ đâu cũng quay lại được ngay.', 'Tóm tắt thế giới thêm lối vào chỉnh sửa trực tiếp: nhấn vào thẻ tóm tắt sẽ hiện nút chỉnh sửa, có thể sửa và lưu; không cung cấp thao tác sao chép hay xóa.', 'Sửa lỗi nội dung bật lại liên tục khi chỉnh sửa thông tin sự kiện, thế lực, Tin Đồn, đại thế, tóm tắt thế giới, v.v.: tạm dừng làm mới tự động nền trong lúc chỉnh sửa, tránh việc dựng lại bảng điều khiển ghi đè nội dung chưa lưu; sau khi lưu hoặc hủy vẫn làm mới bình thường.'] },
    { version: '2.3.19', date: '2026-06-29', items: ['Sửa lỗi "không roll lại nhưng vẫn chèn điểm lưu trữ (trạng thái thế giới vòng cũ)": v2.3.18 dùng so sánh số thuần state.chatLayer===chatLayer để xác định roll lại, nhưng GENERATION_STARTED của SillyTavern phát ra **trước khi** tầng của người dùng được đẩy vào chat — khi gửi tin nhắn vòng mới, chatLayer vẫn == state.chatLayer của vòng trước, bị hiểu nhầm là roll lại và chèn điểm lưu trữ của vòng trước (luôn xảy ra khi chồng với các plugin sinh đôi như "database"-type). Nay tiêu chí roll lại đổi sang dùng type gốc của SillyTavern (chỉ type=swipe/regenerate của GENERATION_STARTED mới là roll lại thật), không còn suy đoán qua số tầng; dryRun (làm nóng/tính token của plugin dạng database) luôn bị bỏ qua, chặn đứng việc "sinh xong nội dung lại chèn thêm một lần nữa".', 'Tăng cường trình xem tự kiểm tra chèn (chỉ đọc): "chuỗi tin nhắn thực sự gửi đi" giờ mỗi tin (system/user/assistant đều có) đều bấm mở rộng xem toàn văn được, không chỉ hiện số chữ; tiện đối chiếu prompt đầy đủ gửi cho mô hình lớn. Gói chẩn đoán vẫn chỉ xuất role+độ dài (không có nội dung, tránh phình kích thước và rò rỉ ngữ cảnh trò chuyện).'] },
    { version: '2.3.18', date: '2026-06-29', items: ['Sửa lỗi lùi vòng diễn biến khi roll lại (tách rời roll lại và redo): diễn biến tự động lẫn lộn "roll lại (swipe tạo lại cùng tầng)" với redo (khôi phục nền từ điểm lưu trữ rồi diễn biến lại) → sau khi roll lại, vòng diễn biến bị kẹt ở vòng của điểm lưu trữ thay vì vòng hiện tại. Nay việc chọn nền diễn biến chia ba — forward (vòng mới/diễn biến từ hiện tại) / redo (nút vệ tinh thủ công quay về điểm lưu trữ) / roll lại tự động (không truyền mode và không phải vòng mới → không khôi phục điểm lưu trữ, diễn biến thẳng trên state hiện tại, vòng giữ nguyên).', 'Sửa lỗi chèn sai nhánh khi roll lại (tách rời tiêu chí chèn và trình tự sự kiện): cổng _pendingReroll của v2.3.17 phụ thuộc trình tự sự kiện swipe của SillyTavern, dễ bị GENERATION_ENDED xóa sớm / va chạm cửa sổ với plugin sinh đôi → khi roll lại lại chèn trạng thái vòng hiện tại thay vì điểm lưu trữ. (Ghi chú: tiêu chí số thuần đổi ở v2.3.18 có hồi quy mới, đã được tiêu chí type của v2.3.19 sửa triệt để.)', 'Gỡ bỏ cổng _pendingReroll (đưa vào từ v2.3.17, nay hoàn toàn không cần nữa), code gọn hơn'] },
    { version: '2.3.17', date: '2026-06-28', items: ['Sửa lỗi chèn trạng thái thế giới "lúc được lúc không" khi chồng với các plugin kiểu "gây nhiễu tầng/sinh đôi" (như script trợ lý dạng database của SillyTavern): nguyên nhân gốc là tiêu chí bảo vệ "roll lại cùng tầng thì không chèn" fingerprint==chatLayer của v2.3.14 quá gắt gao — fingerprint bị chốt vào tầng hiện tại ngay lúc diễn biến, khi lần sinh đầu tiên của vòng mới (lần thực sự tạo ra nội dung cốt truyện) vừa bắt đầu, tầng người dùng mới chưa kịp ổn định thì chatLayer vẫn == fingerprint, bị hiểu nhầm là roll lại nên hủy chèn, khiến nội dung thật không nhận được trạng thái thế giới. Nay thêm "cổng swipe thật" cho bảo vệ: chỉ khi thực sự nhận được sự kiện gốc MESSAGE_SWIPED của SillyTavern (_pendingReroll=true) thì bảo vệ mới có quyền kích hoạt, sinh mới bình thường không có sự kiện swipe nên vẫn chèn trạng thái hiện tại như thường; và khi kích hoạt sẽ đổi sang chèn điểm lưu trữ (trạng thái thế giới trước khi nội dung tầng này sinh ra) thay vì không chèn hoàn toàn, sát với ý định ban đầu "roll lại thì chèn điểm lưu trữ" hơn (không có điểm lưu trữ mới lùi về không chèn). Tiêu chí là sự kiện gốc của SillyTavern, áp dụng chung cho mọi plugin, không có xử lý riêng cho plugin nào'] },
    { version: '2.3.16', date: '2026-06-28', items: ['Thêm "Tự Kiểm Tra Chèn" (đầu thẻ gỡ lỗi, chỉ đọc): nhiều người dùng phản hồi "chèn không thành công" nhưng không có cách xác định — nguyên nhân gốc là thành công của registerInjection chỉ có nghĩa "gọi API SillyTavern không báo lỗi", không hề chứng minh trạng thái thế giới đã thực sự vào nội dung gửi cho mô hình lớn. Nay đăng ký sự kiện hoàn tất ghép prompt của SillyTavern (chat_completion_prompt_ready cho hoàn thiện hội thoại / generate_after_combine_prompts cho hoàn thiện văn bản), đọc chuỗi prompt SillyTavern thực sự ghép sau khi chèn và hiển thị phân theo role, dùng ngôn ngữ dễ hiểu để xác định vòng này: ✅ đã vào nội dung / ❌ đã đăng ký nhưng không vào nội dung (thất bại thật) / ⏸ bỏ qua theo thiết kế (đã tắt chèn hoặc roll lại cùng tầng) / — chưa sinh; hoàn toàn chỉ đọc, tách rời thành module độc lập, không đổi logic chèn, không đụng eventData, bỏ qua vòng làm nóng tính token, không ảnh hưởng gì đến diễn biến; gói chẩn đoán cũng thu thập thêm ảnh chụp này'] },
    { version: '2.3.15', date: '2026-06-25', items: ['Sửa lỗi diễn biến tự động tê liệt âm thầm: yêu cầu API diễn biến không có timeout, nếu rơi vào hố đen mạng (proxy không phản hồi/upstream không trả về cũng không báo lỗi) thì fetch sẽ treo vĩnh viễn, _isRunning của evolution không bao giờ được reset, sau đó mọi diễn biến tự động do GENERATION_ENDED kích hoạt đều bị bảo vệ isRunning() âm thầm bỏ qua, đến khi người dùng đổi cuộc trò chuyện một lần mới mở khóa; nay thêm apiTimeoutMs (mặc định 120s, 0=không giới hạn), hết thời gian chờ thì xử lý như diễn biến thất bại để finally reset bình thường và báo rõ nguyên nhân timeout ở thanh trạng thái (người dùng chủ động hủy/đổi trò chuyện vẫn hiển thị "đã hủy" theo AbortError gốc)'] },
    { version: '2.3.14', date: '2026-06-23', items: ['Sửa lỗi tăng vòng ảo khi redo: khi bấm nút vệ tinh "Diễn Biến Lại", round luôn +1 vô điều kiện (trước khi xét isNew) khiến redo cũng tăng vòng, không khớp với chú thích "vòng redo không đổi"; nay round++ chuyển vào trong if(isNew), chỉ forward / vòng mới tự động mới tăng', 'Sửa lỗi redo thoái hóa âm thầm khi không có điểm lưu trữ: sau lần diễn biến đầu tiên chưa có checkpoint, bấm redo bản cũ bỏ qua toàn bộ → thoái hóa âm thầm thành redo giả kiểu "diễn biến trên state hiện tại" + round++ (tăng vòng khống không báo); nay khi mode==="redo" mà không có cp thì trả về false và báo lỗi "chưa có điểm lưu trữ, không thể diễn biến lại (redo); vui lòng \'diễn biến tiến\' ít nhất một vòng trước", không còn giả làm forward', 'Sửa lỗi chèn trạng thái thế giới cũ khi roll lại cùng tầng: roll lại cùng tầng (chatLayer==stateLayer) bản cũ đi vào nhánh else chèn "trạng thái hiện tại được diễn biến dựa trên nội dung cũ", gây nhiễu nội dung mới đang được viết lại; nay applyInjectionForCurrentRound thêm nhánh "cùng tầng đã diễn biến → không chèn", tiêu chí dùng fingerprint (chỉ cập nhật khi thực sự là vòng mới, đáng tin hơn chatLayer) để trúng unregisterInjection, tránh nội dung mới bị trạng thái thế giới cũ dẫn sai hướng', 'Thêm công tắc tổng "phích cắm" ở vệ tinh thứ tư bên trái quả cầu nổi: một chạm tắt/bật diễn biến và chèn (liên động hai trường cài đặt sẵn có evolveMode + injectIntoPrompt, không thêm trường mới; tắt = chuyển diễn biến thủ công + tắt chèn, bật = chuyển diễn biến tự động + bật chèn; chế độ manual tự có chặn autoEvolveTimer đang chờ, không cần chú thích công tắc tổng riêng)'] },
    { version: '2.3.13', date: '2026-06-22', items: ['Sửa lỗi deadlock diễn biến tự động: cuộc trò chuyện rỗng (chưa từng diễn biến) có bật syncToChat, sau tầng AI đầu tiên dòng trạng thái kẹt ở "vòng 0/1" mãi không tự diễn biến', 'Sửa lỗi API không lấy được mô hình với tiền tố phiên bản tùy chỉnh kiểu Volcano Ark (/api/v3, /api/coding/v3): việc chuẩn hóa URL không còn ép cứng /v1, tiền tố phiên bản do người dùng điền đầy đủ, thêm gợi ý định dạng bên cạnh ô URL', 'Rào chắn đồng bộ chatcache đa thiết bị: khi cloud thiếu checkpoint/fingerprint sẽ không xóa mỏ neo cục bộ theo kiểu exact, tránh rơi vào deadlock lần nữa'] },
    { version: '2.3.12', date: '2026-06-22', items: ['Thêm tab "Giới Thiệu": tích hợp nhật ký cập nhật, có thể chọn từ dropdown để xem các thay đổi qua từng phiên bản', 'Chế độ đơn giản cho bộ lọc biểu thức chính quy: chọn thẻ tự động tạo biểu thức chính quy xóa bỏ'] },
    { version: '2.3.11', date: '2026-06-22', items: ['Bộ lọc biểu thức chính quy hỗ trợ cú pháp /pattern/flags, kiểm tra khi lưu, thêm nút kiểm tra'] },
    { version: '2.3.10', date: '2026-06-21', items: ['Sửa lỗi rà soát code hệ thống preset của engine (hiệu năng và giật lag)', 'Gói chẩn đoán thu thập thêm hệ thống preset và phân đoạn prompt'] },
    { version: '2.3.9',  date: '2026-06',    items: ['Hệ thống preset của engine: đoạn prompt diễn biến hardcode có thể chỉnh sửa, lưu, chuyển đổi'] },
    { version: '2.3.8',  date: '2026-06',    items: ['Hiển thị phân đoạn Prompt diễn biến hoàn toàn minh bạch (chỉ đọc)'] },
    { version: '2.3.7',  date: '2026-06',    items: ['Thêm phương thức kết nối "qua proxy SillyTavern", vượt qua CORS của API bên thứ ba'] },
    { version: '2.3.6',  date: '2026-06',    items: ['Chia tab cho trang cài đặt'] },
    { version: '2.3.5',  date: '2026-06',    items: ['Xuất gói chẩn đoán bằng một chạm'] },
    { version: '2.3.4',  date: '2026-06',    items: ['Hiển thị số phiên bản mở rộng bên cạnh tiêu đề bảng điều khiển'] },
    { version: '2.2.0',  date: '2026',       items: ['Bộ nhớ đệm và lưu trữ SillyTavern: đồng bộ đa thiết bị + lưu trữ chống mất dữ liệu'] }
  ];

  // [FIX] Định nghĩa tab: label + gồm những đoạn nào. Chỉ phân loại lại section hiện có, không thêm/bớt chức năng.
  const SETTINGS_TABS = [
    { key: 'common',    label: 'Thường Dùng' },
    { key: 'link',      label: 'Liên Kết' },
    { key: 'advanced',  label: 'Nâng Cao' },
    { key: 'mechanics', label: 'Cơ Chế Cục Bộ' },
    { key: 'archive',   label: 'Lưu Trữ' },
    { key: 'worldbook', label: 'Worldbook' },
    { key: 'debug',     label: 'Gỡ Lỗi' },
    { key: 'about',     label: 'Giới Thiệu' }
  ];
  let _settingsTab = 'common';

  function renderSettingsView(checkpoint, cpLayer) {
    const cpContent = checkpoint
      ? renderCheckpointSections(checkpoint, cpLayer)
      : '<div class="we-empty">Chưa có điểm lưu trữ</div>';
    const form = renderSettingsForm();              // {api,evolve,backfill,filter,display,chatcache,inject}
    const extra = renderSettingsAfterCheckpoint();  // {worldbook,data,tone}

    // Section điểm lưu trữ (giữ nguyên, chuyển vào thẻ "Lưu Trữ")
    const checkpointSection = '<div class="we-section" style="margin-top:16px;"><div class="we-section-title">'
      + sectionHeader(checkpointTitle(checkpoint, cpLayer), 'checkpoint-section') + '</div>'
      + sectionBody('checkpoint-section', cpContent) + '</div>';

    // Section gỡ lỗi (giữ nguyên, gồm nút gói chẩn đoán + renderDebug, chuyển vào thẻ "Gỡ Lỗi")
    const debugSection = '<div class="we-section we-debug-section">'
      + '<div class="we-section-title"><span class="we-debug-toggle" title="Mở rộng hoặc thu gọn thông tin gỡ lỗi"><span class="we-toggle-arrow">▶</span>Gỡ Lỗi</span></div>'
      + '<div id="we-debug-body" style="display:none;">'
      + '<button class="we-btn" id="we-export-diag" style="width:100%;margin-bottom:8px;">Xuất Gói Chẩn Đoán</button><!-- [FIX] Gói chẩn đoán: không liên quan đến việc đã diễn biến hay chưa, luôn xuất được -->'
      + '<div id="we-debug-render">' + renderDebug() + '</div>'
      // [MAP] Quản lý preset engine: cùng thẻ gỡ lỗi với hiển thị phân đoạn chỉ đọc của PR#12, nâng cấp 4 đoạn hardcode thành có thể chỉnh sửa + preset hóa.
      // Neo độc lập #we-preset-manage, làm mới cục bộ; lưu qua storage key riêng, không vào we-save-settings.
      + '<div class="we-preset-section">'
      + '<div class="we-section-title">Preset Engine (Đoạn Prompt Diễn Biến Có Thể Chỉnh Sửa)</div>'
      + '<div id="we-preset-manage">' + renderPresetManage() + '</div>'
      + '</div>'
      + '</div></div>';

    // Các đoạn nội dung chứa trong từng tab (mỗi section chỉ xuất hiện đúng một lần, không trùng lặp)
    const panelContent = {
      common:    form.api + form.evolve + form.inject,
      link:      form.link,
      advanced:  form.retry + form.backfill + form.filter + form.display + extra.tone,
      mechanics: form.mechanics,
      archive:   form.chatcache + extra.data + checkpointSection,
      worldbook: extra.worldbook,
      debug:     debugSection,
      about:     renderAbout()
    };

    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="Cuộn Sang Trái"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + SETTINGS_TABS.map(t =>
          '<button class="we-settings-tab' + (t.key === _settingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + t.key + '">' + t.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="Cuộn Sang Phải"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';

    const panels = SETTINGS_TABS.map(t =>
      '<div class="we-settings-panel" data-tab="' + t.key + '"'
      + (t.key === _settingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[t.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-btn-back" title="Quay Lại"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">Cài Đặt</span>'
      + '</div>'
      + tabBar
      + panels
      // Lưu/Đặt lại: cố định ở dưới cùng (sticky), mọi tab đều có thể lưu toàn bộ cài đặt bằng một chạm
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-save-settings">Lưu Cài Đặt</button>'
      + '<button class="we-btn we-btn-danger" id="we-reset-world">Đặt Lại Thế Giới</button>'
      + '</div>';
  }

  // Tab "Giới Thiệu": huy hiệu phiên bản hiện tại + nhật ký cập nhật (chọn phiên bản từ dropdown + mỗi phiên bản một bảng riêng, chuyển ẩn/hiện thuần CSS).
  //   Dữ liệu lấy từ hằng số CHANGELOG (tách rời khỏi hiển thị); dropdown phiên bản dùng lại khuôn mẫu #we-preset-select ——
  //   nhấn vào hiện danh sách cuộn gốc, phiên bản có nhiều đến đâu cũng không phá bố cục. Mặc định chọn mục đầu tiên (bản mới nhất).
  function renderAbout() {
    if (!CHANGELOG.length) return '<div class="we-empty">Chưa có nhật ký cập nhật</div>';
    const cur = window.WORLD_ENGINE_VERSION;
    const curBadge = cur ? '<span class="we-changelog-cur">Phiên bản hiện tại v' + h(cur) + '</span>' : '';

    const optHtml = CHANGELOG.map(function (c, i) {
      const label = 'v' + c.version + (c.date ? ' (' + c.date + ')' : '');
      return '<option value="' + h(c.version) + '"' + (i === 0 ? ' selected' : '') + '>' + h(label) + '</option>';
    }).join('');
    const verBar = '<div class="we-changelog-row">'
      + '<label class="we-changelog-row-label">Xem Phiên Bản</label>'
      + '<select id="we-changelog-select" class="we-changelog-select">' + optHtml + '</select>'
      + '</div>';

    const panels = CHANGELOG.map(function (c, i) {
      const head = '<div class="we-changelog-head">v' + h(c.version)
        + (c.date ? ' <span class="we-changelog-date">' + h(c.date) + '</span>' : '') + '</div>';
      const items = '<ul class="we-changelog-items">'
        + (c.items || []).map(function (it) { return '<li>' + h(it) + '</li>'; }).join('')
        + '</ul>';
      return '<div class="we-changelog-panel" data-ver="' + h(c.version) + '"'
        + (i === 0 ? '' : ' style="display:none;"') + '>' + head + items + '</div>';
    }).join('');

    return '<div class="we-section">'
      + '<div class="we-changelog-top">' + curBadge + '</div>'
      + verBar
      + panels
      + '</div>';
  }

  function renderCheckpointSections(s, layer) {
    return renderSection('Đại Thế Thiên Hạ', 'cp-trends', renderWorldTrends(s.worldTrends, 'checkpoint'))
      + renderSection('Chuỗi Sự Kiện', 'cp-events', renderEventList(s.events, 'checkpoint'))
      + renderSection('Thế Lực', 'cp-factions', renderFactionList(s.factions, 'checkpoint'))
      + renderSection('Tin Đồn', 'cp-winds', renderWindList(s.winds, 'checkpoint'))
      + renderSection('Danh Tiếng', 'cp-reputation', renderReputation(s.reputation, 'checkpoint'))
      + renderSection('Kinh Tế', 'cp-economy', renderEconomy(s.economy, 'checkpoint'))
      + renderSection('Sổ Ân Oán', 'cp-enemies', renderEnemies(s.enemies, 'checkpoint'))
      + renderSection('Chuỗi Ảnh Hưởng', 'cp-influence', renderInfluenceChain(s.influenceChain, 'checkpoint'))
      + renderSection('Biến Cố Khu Vực', 'cp-regional', renderRegionalIncident(s.regionalIncident, 'checkpoint'))
      + renderSection('Bí Mật', 'cp-blackbox', renderBlackbox(s.blackbox, 'checkpoint'))
      + renderSection('Sổ Sách Sự Kiện', 'cp-ledger', renderLedger(s.memories));
  }

  /** Lõi thế giới: đồng hồ độ ổn định hình vòng + bốn ô đếm chính */
  function renderWorldCore(s) {
    const stab = computeWorldStability(s);
    const tierColor = STABILITY_TIER_COLOR[stab.tier] || '#58b8a9';
    const detail = Object.entries(stab.breakdown)
      .filter(([, v]) => v !== 0)
      .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`).join('　') || 'Không có nguồn áp lực';

    const R = 66, C = 2 * Math.PI * R;
    const pct = Math.max(0, Math.min(1, stab.stability / 100));
    const dash = (pct * C).toFixed(1);
    const theta = (pct * 360 - 90) * Math.PI / 180;       // Bắt đầu từ đỉnh, theo chiều kim đồng hồ
    const dotX = (80 + R * Math.cos(theta)).toFixed(1);
    const dotY = (80 + R * Math.sin(theta)).toFixed(1);
    const dashNum = Number(dash);

    function arcPoint(angleDeg) {
      const rad = angleDeg * Math.PI / 180;
      return {
        x: 80 + R * Math.cos(rad),
        y: 80 + R * Math.sin(rad)
      };
    }

    function arcPath(startDeg, endDeg) {
      const a = arcPoint(startDeg);
      const b = arcPoint(endDeg);
      const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
      return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
    }

    const tailDeg = Math.min(36, pct * 360);
    const tailSegs = 36;
    let tailGlow = '';

    for (let i = 0; i < tailSegs; i++) {
      const t1 = i / tailSegs;
      const t2 = (i + 1) / tailSegs;

      const startDeg = -90 + pct * 360 - tailDeg + t1 * tailDeg;
      const endDeg = -90 + pct * 360 - tailDeg + t2 * tailDeg;

      const alpha = Math.pow(t2, 2.2) * 0.72;

      tailGlow += `
        <path d="${arcPath(startDeg, endDeg)}"
          fill="none"
          stroke="#ffffff"
          stroke-width="6"
          stroke-linecap="butt"
          opacity="${alpha.toFixed(3)}"/>
      `;
    }

    const stats = [
      ['Sự Kiện', (s.events || []).length],
      ['Thế Lực', (s.factions || []).length],
      ['Tin Đồn', (s.winds || []).length],
      ['Đại Thế', (s.worldTrends || []).length],
    ].map(([k, v]) => `<div class="we-core-stat"><div class="we-core-stat-k">${k}</div><div class="we-core-stat-v">${v}</div></div>`).join('');

    return `
      <div class="we-section we-core-section">
        <div class="we-core" title="Áp lực theo từng nguồn (chỉ tính Lv3/4): ${detail}　|　Áp lực ${stab.pressure}">
          <div class="we-core-ring">
            <svg viewBox="0 0 160 160" width="160" height="160">
              <defs>
                <filter id="weCoreDotGlow" x="-80%" y="-80%" width="260%" height="260%">
                  <feGaussianBlur stdDeviation="3.2"/>
                </filter>
              </defs>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="6"/>

              <circle cx="80" cy="80" r="${R}" fill="none" stroke="${tierColor}" stroke-width="6"
                stroke-linecap="round"
                stroke-dasharray="${dash} ${(C - pct * C).toFixed(1)}"
                transform="rotate(-90 80 80)"/>

              ${tailGlow}

              <circle class="we-core-dot-glow" cx="${dotX}" cy="${dotY}" r="8" fill="#ffffff" opacity="0.14" filter="url(#weCoreDotGlow)"/>
              <circle cx="${dotX}" cy="${dotY}" r="4.6" fill="#e8fffb" opacity="0.70"/>
              <circle class="we-core-dot-core" cx="${dotX}" cy="${dotY}" r="2.5" fill="#ffffff" opacity="0.95"/>
            </svg>
            <div class="we-core-center">
              <div class="we-core-title">Lõi Thế Giới</div>
              <div class="we-core-sub">Độ Ổn Định</div>
              <div class="we-core-pct" style="color:${tierColor};">${stab.stability.toFixed(1)}<span>%</span></div>
              <div class="we-core-tier" style="color:${tierColor};">${stab.tier}</div>
            </div>
          </div>
          <div class="we-core-stats">${stats}</div>
        </div>
      </div>`;
  }

  /** Lấy số tầng hội thoại của điểm lưu trữ */
  function getCheckpointLayer(cp) {
    if (!cp) return '-';
    return Number.isFinite(Number(cp.chatLayer)) ? Number(cp.chatLayer) : '-';
  }

  function renderPagedList(items, key, renderItem, perPage = 4) {
    const rid = `we-list-${key}-${++listPagerCounter}`;
    const totalPages = Math.ceil(items.length / perPage);
    const currentPage = Math.min(totalPages, Math.max(1, listPageState[rid] || 1));
    listPageState[rid] = currentPage;
    const pager = totalPages > 1
      ? `<div class="we-list-pager">
          <span class="we-list-arrow" data-rid="${rid}" data-dir="-1">◀</span>
          <span class="we-list-page"><span class="we-list-cur">${currentPage}</span>/${totalPages}</span>
          <span class="we-list-arrow" data-rid="${rid}" data-dir="1">▶</span>
        </div>`
      : '';
    return pager + `<div class="we-paged-list" data-rid="${rid}">` + items.map((item, index) => {
      const page = Math.floor(index / perPage) + 1;
      return `<div class="we-page-item" data-page="${page}" style="${page !== currentPage ? 'display:none;' : ''}">${renderItem(item, index)}</div>`;
    }).join('') + '</div>';
  }

  function renderEventList(events, scope) {
    if (!events || !events.length) return '<div class="we-empty">Chưa có chuỗi sự kiện</div>';
    const curRound = (core.loadState() || {}).round || 0;
    return renderPagedList(events, 'events-' + scope, (e, eventIndex) => {
      const stageColors = {
        'Manh Nha':'#d6b85a',
        'Âm Ỉ':'#d98a3d',
        'Cận Kề':'#cf5f3f',
        'Đã Bùng Phát':'#b93f3f',
        'Đã Tan Biến':'#888888',
        'Chuẩn Bị':'#7de9d9',
        'Thực Hiện':'#58e8b3',
        'Then Chốt':'#2a8a5d',
        'Đã Hoàn Thành':'#1b5e3b',
        'Đã Thất Bại':'#888888',
        'Trì Trệ':'#6688aa'
      };
      const levelColors = {
        1: '#c0c0c0',
        2: '#f2f2f2',
        3: '#c9a45c',
        4: '#df7cff'
      };
      const color = stageColors[e.stage] || '#888';
      const levelColor = levelColors[e.level] || '#9aa6b2';
      let extras = '';
      const terminalStages = e.type === 'progress' ? ['Đã Hoàn Thành', 'Đã Thất Bại'] : ['Đã Bùng Phát', 'Đã Tan Biến'];
      const isTerminal = terminalStages.includes(e.stage);
      if (e.consecutiveFails > 0 && !isTerminal) {
        const maxFails = localEventMaxFails(e);
        extras += ` <span class="we-badge" style="background:#6662;color:#888;">${e.consecutiveFails}/${maxFails}</span>`;
      }
      if (e.stall && !isTerminal) {
        extras += ' <span class="we-badge" style="background:#6688aa22;color:#6688aa;">Trì Trệ</span>';
      }
      let metaExtra = '';
      if (e.evolveResult && !isTerminal) {
        const resultColors = { 'Thành Công':'#7a9a7a', 'Giữ Nguyên':'#b8a070', 'Gặp Trở Ngại':'#c46a6a' };
        const color = resultColors[e.evolveResult] || '#888';
        metaExtra = ` <span class="we-badge we-event-result-badge" style="--event-result:${color};">${e.evolveResult}</span>`;
      }
      // Thanh tiến độ giai đoạn
      let progressHtml = '';
      if (!isTerminal) {
        const pct = Math.round((e.stageRound / 9) * 100);

        const progressMotionClass = {
          'Thành Công': 'we-event-progress-success',
          'Giữ Nguyên': 'we-event-progress-hold',
          'Gặp Trở Ngại': 'we-event-progress-fail'
        }[e.evolveResult] || '';

        progressHtml = `<div class="we-event-progress ${progressMotionClass}">
          <div style="width:${pct}%;background:${color};"></div>
        </div>`;
      }
      const typeName = e.type === 'progress' ? 'Tiến Triển' : 'Xung Đột';
      const typeColor = e.type === 'progress' ? '#57b7a8' : '#cf5f3f';
      // Huy hiệu đếm ngược khi kết thúc tích cực (Đã Bùng Phát/Đã Hoàn Thành, tự động dọn sau 2+level*2 vòng)
      let countdownHtml = '';
      const POSITIVE_TERMINALS = ['Đã Bùng Phát', 'Đã Hoàn Thành'];
      if (POSITIVE_TERMINALS.includes(e.stage) && e._terminalSince !== undefined) {
        const keepRounds = localTerminalKeepRounds(e);
        const left = keepRounds - (curRound - e._terminalSince) + 1;
        if (left >= 1) {
          const cdColor = e.stage === 'Đã Hoàn Thành' ? '#58e8b3' : '#e07465';
          countdownHtml = ` <span class="we-badge we-event-countdown" style="--event-countdown:${cdColor};" title="Sự kiện này sẽ tự động dọn sau ${left} vòng nữa"><i class="fa-regular fa-clock"></i>Còn ${left} vòng</span>`;
        }
      }
      const terminalStamp = {
        'Đã Hoàn Thành': { text: 'Hoàn Thành', color: '#58e8b3' },
        'Đã Bùng Phát': { text: 'Bùng Phát', color: '#e07465' },
        'Đã Tan Biến': { text: 'Tan Biến', color: '#a6a6ad' },
        'Đã Thất Bại': { text: 'Thất Bại', color: '#c08aaa' }
      }[e.stage];
      const isEditing = editingEvent?.scope === scope && editingEvent?.index === eventIndex;
      // Màu được truyền xuống dưới dạng biến CSS, viền/nền/hiệu ứng sáng đều giao cho lớp style xử lý (không còn dải màu bên trái nội tuyến)
      const itemStyle = `--event-accent:${color};--event-type:${typeColor};--event-level:${levelColor};`;
      const stageClassMap = {
        'Manh Nha': 'we-stage-sprout', 'Âm Ỉ': 'we-stage-ferment', 'Cận Kề': 'we-stage-loom',
        'Đã Bùng Phát': 'we-stage-erupt', 'Đã Tan Biến': 'we-stage-fade',
        'Đã Hoàn Thành': 'we-stage-done', 'Đã Thất Bại': 'we-stage-failed',
      };
      const stageClass = stageClassMap[e.stage] || '';
      const itemClass = (isTerminal ? 'we-event-item we-event-item-terminal' : 'we-event-item') + (stageClass ? ' ' + stageClass : '');
      const metaStyle = isTerminal
        ? 'style="color:var(--we-text2);"'
        : '';
      const stageBadge = isTerminal ? '' : ` <span class="we-badge we-event-stage-badge">${e.stage}</span>`;
      const metaText = isTerminal
        ? (e.desc ? u(e.desc) : '')
        : `${e.stageRound||1}/9 ${e.desc ? '— '+u(e.desc) : ''}${metaExtra}`;
      const stampHtml = isTerminal && terminalStamp
        ? `<div class="we-event-stamp" style="--event-stamp:${terminalStamp.color};">${terminalStamp.text}</div>`
        : '';
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-event-delete" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Xóa Sự Kiện"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-event-copy" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Sao Chép Sự Kiện"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-event-edit" data-event-scope="${scope}" data-event-index="${eventIndex}" title="Sửa Sự Kiện"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEventEditor(e, scope, eventIndex) : '';
      return `<div class="${itemClass}" style="${itemStyle}">
        ${stampHtml}
        <div class="we-event-name"><span class="we-event-title">${u(e.name)}</span> <span class="we-badge we-event-level-badge">Lv.${e.level||'?'}</span> <span class="we-badge we-event-type-badge">${typeName}</span>${countdownHtml}${stageBadge}${extras}</div>
        ${metaText ? `<div class="we-event-meta" ${metaStyle}>${metaText}</div>` : ''}
        ${editHtml}
        ${actionHtml}
        ${progressHtml}
      </div>`;
    });
  }

  function renderEventEditor(event, scope, eventIndex) {
    const stages = event.type === 'progress'
      ? ['Chuẩn Bị', 'Thực Hiện', 'Then Chốt', 'Đã Hoàn Thành', 'Đã Thất Bại']
      : ['Manh Nha', 'Âm Ỉ', 'Cận Kề', 'Đã Bùng Phát', 'Đã Tan Biến'];
    const levelOptions = [1, 2, 3, 4].map(level =>
      `<option value="${level}" ${Number(event.level) === level ? 'selected' : ''}>Lv.${level}</option>`
    ).join('');
    const typeOptions = [
      ['conflict', 'Xung Đột'],
      ['progress', 'Tiến Triển']
    ].map(([type, label]) =>
      `<option value="${type}" ${event.type === type ? 'selected' : ''}>${label}</option>`
    ).join('');
    const stageOptions = stages.map(stage =>
      `<option value="${stage}" ${event.stage === stage ? 'selected' : ''}>${stage}</option>`
    ).join('');

    // Đếm ngược kết thúc tích cực: giá trị mặc định lấy số vòng còn lại hiện tại, sự kiện chưa kết thúc để trống
    const POSITIVE_TERMINALS = ['Đã Bùng Phát', 'Đã Hoàn Thành'];
    const keepRounds = localTerminalKeepRounds(event);
    let leftValue = '';
    if (POSITIVE_TERMINALS.includes(event.stage)) {
      const curRound = (core.loadState() || {}).round || 0;
      const left = event._terminalSince !== undefined
        ? keepRounds - (curRound - event._terminalSince) + 1
        : keepRounds;
      leftValue = Math.min(keepRounds, Math.max(1, left));
    }

    return `
      <div class="we-event-editor" data-event-scope="${scope}" data-event-index="${eventIndex}">
        <button class="we-event-editor-close" title="Hủy Sửa"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Tên Sự Kiện<input class="we-event-edit-name" type="text" value="${u(event.name || '')}"></label>
          <label>Cấp Độ<select class="we-event-edit-level">${levelOptions}</select></label>
          <label>Loại<select class="we-event-edit-type">${typeOptions}</select></label>
          <label>Giai Đoạn<select class="we-event-edit-stage">${stageOptions}</select></label>
          <label>Tiến Độ Giai Đoạn<input class="we-event-edit-round" type="number" min="1" max="9" value="${event.stageRound || 1}"></label>
          <label title="Chỉ áp dụng khi kết thúc tích cực (Đã Bùng Phát/Đã Hoàn Thành), tự động dọn khi hết hạn; sự kiện chưa kết thúc để trống">Số Vòng Còn Lại<input class="we-event-edit-left" type="number" min="1" placeholder="Chỉ dùng khi kết thúc" value="${leftValue}"></label>
          <label class="we-event-editor-wide">Mô Tả<textarea class="we-event-edit-desc" rows="3">${u(event.desc || '')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-event-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderFactionList(factions, scope) {
    if (!factions || !factions.length) return '<div class="we-empty">Chưa có thế lực</div>';
    return renderPagedList(factions, 'factions', (f, factionIndex) => {
      const relationColors = {
        'Huyết Minh':'#2563eb', 'Đồng Minh':'#0ea5e9', 'Thân Thiện':'#06b6d4', 'Trung Lập':'#94a3b8',
        'Lạnh Nhạt':'#f59e0b', 'Căng Thẳng':'#f59e0b', 'Thù Địch':'#ef4444', 'Thâm Thù':'#991b1b'
      };
      const statusColors = { 'Cực Thịnh':'#d0aa58', 'Ổn Định':'#69b68e', 'Nội Đấu':'#cf5f3f', 'Khốn Đốn':'#70a8d2', 'Suy Tàn':'#a6a6ad', 'Tan Rã':'#888888' };
      const relColor = relationColors[f.relation] || '#888';
      const stColor = statusColors[f.status] || '#888';

      const isEditing = editingFaction && editingFaction.scope === scope && editingFaction.index === factionIndex;

      let pillarsHtml = '';
      if (f.powerPillars && f.powerPillars.length) {
        pillarsHtml = '<div class="we-faction-meta">Trụ cột quyền lực: ' + f.powerPillars.map(p => '<span class="we-pillar-tag">' + u(p) + '</span>').join('') + '</div>';
      }

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-faction-delete" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Xóa Thế Lực"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-faction-copy" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Sao Chép Thế Lực"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-faction-edit" data-faction-scope="${scope}" data-faction-index="${factionIndex}" title="Sửa Thế Lực"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderFactionEditor(f, factionIndex, scope) : '';

      return `<div class="we-faction-item">
        <div class="we-faction-name">${u(f.name)}</div>
        <div class="we-faction-tags">
          <span class="we-tag" style="border-color:${stColor};color:${stColor};">${f.status||'Ổn Định'}</span>
          <span class="we-tag" style="border-color:${relColor};color:${relColor};">${f.relation||'Trung Lập'}</span>
          ${f.scope ? '<span class="we-tag">' + u(f.scope) + '</span>' : ''}
        </div>
        ${f.currentGoal ? `<div class="we-faction-goal">${u(f.currentGoal)}</div>` : ''}
        ${f.core_person ? `<div class="we-faction-meta">Nhân vật cốt lõi: ${u(f.core_person)}</div>` : ''}
        ${pillarsHtml}
        ${actionHtml}
        ${editHtml}
      </div>`;
    });
  }

  function renderFactionEditor(f, index, scope) {
    const statusOptions = ['Cực Thịnh','Ổn Định','Nội Đấu','Khốn Đốn','Suy Tàn','Tan Rã'].map(s =>
      `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s}</option>`).join('');
    const relationOptions = ['Huyết Minh','Đồng Minh','Thân Thiện','Trung Lập','Lạnh Nhạt','Thù Địch','Thâm Thù'].map(r =>
      `<option value="${r}" ${f.relation === r ? 'selected' : ''}>${r}</option>`).join('');
    const pillars = [];
    for (let i = 0; i < 3; i++) pillars.push(f.powerPillars?.[i] || '');

    return `
      <div class="we-event-editor" data-faction-scope="${scope}" data-faction-index="${index}">
        <button class="we-event-editor-close we-faction-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Tên Thế Lực<input class="we-faction-edit-name" type="text" value="${u(f.name||'')}"></label>
          <label>Vận Thế<select class="we-faction-edit-status">${statusOptions}</select></label>
          <label>Quan Hệ<select class="we-faction-edit-relation">${relationOptions}</select></label>
          <label>Phạm Vi<input class="we-faction-edit-scope" type="text" value="${u(f.scope||'')}"></label>
          <label>Mục Tiêu<input class="we-faction-edit-goal" type="text" value="${u(f.currentGoal||'')}"></label>
          <label>Nhân Vật Cốt Lõi<input class="we-faction-edit-core" type="text" value="${u(f.core_person||'')}"></label>
          ${[0,1,2].map(i => `<label>Trụ Cột Quyền Lực ${i+1}<input class="we-faction-edit-pillar" data-pillar-idx="${i}" type="text" value="${u(pillars[i])}" maxlength="24" placeholder="Tối đa 24 ký tự"></label>`).join('')}
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-faction-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderWorldTrends(trends, scope) {
    if (!trends || !trends.length) return '<div class="we-empty">Chưa có đại thế thiên hạ</div>';
    return renderPagedList(trends, 'world-trends', (trend, trendIndex) => {
      const ended = trend.status === 'Đã Kết Thúc';
      const color = ended ? '#888888' : '#c9a45c';
      const isEditing = editingTrend?.scope === scope && editingTrend?.index === trendIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-trend-delete" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Xóa Đại Thế Thiên Hạ"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-trend-copy" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Sao Chép Đại Thế Thiên Hạ"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-trend-edit" data-trend-scope="${scope}" data-trend-index="${trendIndex}" title="Sửa Đại Thế Thiên Hạ"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderTrendEditor(trend, scope, trendIndex) : '';
      return `<div class="we-trend-item${ended ? ' we-trend-ended' : ''}" style="border-left-color:${color};">
        ${actionHtml}
        <div class="we-trend-header">
          <span class="we-trend-name">${u(trend.name)}</span>
          <span class="we-badge" style="background:${color}22;color:${color};">${u(trend.status || 'Đang Diễn Ra')}</span>
        </div>
        <div class="we-trend-scope">${u(trend.scope || 'Thiên Hạ')}</div>
        <div class="we-trend-description">${u(trend.description || '?')}</div>
        <div class="we-trend-source"><span>Nguồn gốc</span>${u(trend.source || '?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderTrendEditor(trend, scope, index) {
    const statusOptions = ['Đang Diễn Ra', 'Đã Kết Thúc'].map(s =>
      `<option value="${s}" ${trend.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-trend-scope="${scope}" data-trend-index="${index}">
        <button class="we-event-editor-close we-trend-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Tên Đại Thế<input class="we-trend-edit-name" type="text" value="${u(trend.name||'')}"></label>
          <label>Trạng Thái<select class="we-trend-edit-status">${statusOptions}</select></label>
          <label>Phạm Vi<input class="we-trend-edit-scope" type="text" value="${u(trend.scope||'')}"></label>
          <label>Nguồn Gốc<input class="we-trend-edit-source" type="text" value="${u(trend.source||'')}"></label>
          <label class="we-event-editor-wide">Mô Tả<textarea class="we-trend-edit-desc" rows="3">${u(trend.description||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-trend-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderWindList(winds, scope) {
    if (!winds || !winds.length) return '<div class="we-empty">Chưa có Tin Đồn</div>';
    const typeNames = { announcement:'Thông Báo', report:'Tin Điện', rumor:'Lời Đồn', sentiment:'Dư Luận' };
    const typeColors = { announcement:'#c94b4b', report:'#4a8ab5', rumor:'#9178a0', sentiment:'#c17a35' };
    return renderPagedList(winds, 'winds', (w, windIndex) => {
      const typeColor = typeColors[w.type] || '#888';
      // Huy hiệu cấp độ: Lv1/2 màu xám trung tính, Lv3/4 lấy màu gốc của loại (thống nhất bảng màu bốn trạng thái của Tin Đồn)
      const levelColor = (w.level >= 3) ? typeColor : (w.level === 2 ? '#7a828c' : '#5a6270');
      const isEditing = editingWind && editingWind.scope === scope && editingWind.index === windIndex;

      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-wind-delete" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Xóa Tin Đồn"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-wind-copy" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Sao Chép Tin Đồn"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-wind-edit" data-wind-scope="${scope}" data-wind-index="${windIndex}" title="Sửa Tin Đồn"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderWindEditor(w, windIndex, scope) : '';

      const windTypeClass = { announcement:'we-wind-announcement', report:'we-wind-report', rumor:'we-wind-rumor', sentiment:'we-wind-sentiment' }[w.type] || '';
      const windLvClass = 'we-wind-lv' + (w.level || 1);
      let html = '<div class="we-wind-item ' + windTypeClass + ' ' + windLvClass + '" style="--wind-accent:' + typeColor + ';--wind-level-color:' + levelColor + ';">';
      // Yếu tố trang trí riêng cho Lv4: công báo hai vòng xung kích / đồn đại hai tiêu điểm nhiều vòng gợn sóng
      if (w.level === 4) {
        if (w.type === 'announcement') {
          html += '<span class="we-wind-ring"></span><span class="we-wind-ring we-wind-ring2"></span>';
        } else if (w.type === 'rumor') {
          html += '<span class="we-wind-rp we-rp-a1"></span><span class="we-wind-rp we-rp-a2"></span><span class="we-wind-rp we-rp-a3"></span><span class="we-wind-rp we-rp-b1"></span><span class="we-wind-rp we-rp-b2"></span>';
        }
      }
      html += '<div class="we-wind-header">';
      html += '<span class="we-wind-topic">' + u(w.topic || 'Chưa Đặt Tên') + '</span>';
      html += '<span class="we-badge" style="background:' + typeColor + '22;color:' + typeColor + ';">' + (typeNames[w.type] || 'Tin Đồn') + '</span>';
      html += '<span class="we-badge" style="background:' + levelColor + '22;color:' + levelColor + ';">Lv.' + (w.level || 1) + '</span>';
      html += '</div>';
      html += '<div class="we-wind-field we-wind-content"><span class="we-wind-label">Nội dung</span><span>' + u(w.content || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">Phạm vi</span><span>' + u(w.scope || '?') + '</span></div>';
      html += '<div class="we-wind-field"><span class="we-wind-label">Nguồn gốc</span><span>' + u(w.source || '?') + '</span></div>';
      html += editHtml;
      html += actionHtml;
      html += '</div>';
      return html;
    });
  }

  function renderWindEditor(w, index, scope) {
    const typeOptions = [['announcement','Thông Báo'],['report','Tin Điện'],['rumor','Lời Đồn'],['sentiment','Dư Luận']].map(([v,label]) =>
      `<option value="${v}" ${w.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const levelOptions = [1,2,3,4].map(l =>
      `<option value="${l}" ${w.level === l ? 'selected' : ''}>Lv.${l}</option>`).join('');

    return `
      <div class="we-event-editor" data-wind-index="${index}" data-wind-scope="${scope}">
        <button class="we-event-editor-close we-wind-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Chủ Đề<input class="we-wind-edit-topic" type="text" value="${u(w.topic||'')}"></label>
          <label>Loại<select class="we-wind-edit-type">${typeOptions}</select></label>
          <label>Cấp Độ<select class="we-wind-edit-level">${levelOptions}</select></label>
          <label>Phạm Vi<input class="we-wind-edit-scope" type="text" value="${u(w.scope||'')}"></label>
          <label>Nguồn Gốc<input class="we-wind-edit-source" type="text" value="${u(w.source||'')}"></label>
          <label class="we-event-editor-wide">Nội Dung<textarea class="we-wind-edit-content" rows="3">${u(w.content||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-wind-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderReputation(rep, scope) {
    if (!rep) return '<div class="we-empty">Chưa có dữ liệu danh tiếng</div>';
    const levels = ['Thiên Nộ Nhân Oán','Tai Tiếng Lẫy Lừng','Vô Danh Tiểu Tốt','Được Kính Trọng','Vạn Người Ngưỡng Mộ'];
    const levelColors = { 'Thiên Nộ Nhân Oán':'#e05555', 'Tai Tiếng Lẫy Lừng':'#d97a5a', 'Vô Danh Tiểu Tốt':'#7a8a9a', 'Được Kính Trọng':'#6cae8e', 'Vạn Người Ngưỡng Mộ':'#c9a45c' };
    const legacyMap = { 'Có Chút Tiếng Tăm':'Được Kính Trọng' };
    const dimLabels = { authority:'Triều Đình', common:'Thị Tỉnh', shadow:'Giang Hồ', circuit:'Đồng Đạo' };
    // Câu cổ văn đi kèm mỗi chiều × mỗi cấp độ (nguồn gốc lược bỏ)
    const quotes = {
      authority: { 'Thiên Nộ Nhân Oán':'Trên dưới căm ghét như thù địch', 'Tai Tiếng Lẫy Lừng':'Người tại vị đều nói điều xấu', 'Vô Danh Tiểu Tốt':'Chìm nơi hạ liêu không ai biết', 'Được Kính Trọng':'Quần thần không ai không kính sợ', 'Vạn Người Ngưỡng Mộ':'Thiên hạ mong ngóng phong thái' },
      common:    { 'Thiên Nộ Nhân Oán':'Người qua đường chỉ trỏ răn nhau', 'Tai Tiếng Lẫy Lừng':'Kẻ vô lại trong làng cũng thấy nhục', 'Vô Danh Tiểu Tốt':'Ra vào chợ búa không ai nhận ra', 'Được Kính Trọng':'Xóm làng gọi là bậc trưởng giả', 'Vạn Người Ngưỡng Mộ':'Trẻ con phu phen đều biết tên' },
      shadow:    { 'Thiên Nộ Nhân Oán':'Lục lâm cũng chẳng chịu dung nạp', 'Tai Tiếng Lẫy Lừng':'Hào kiệt nghe đến đều khinh miệt', 'Vô Danh Tiểu Tốt':'Lẫn giữa ngư tiều không ai hỏi han', 'Được Kính Trọng':'Hào kiệt giang hồ phần nhiều quy phục', 'Vạn Người Ngưỡng Mộ':'Bốn bể đều gọi là bậc hiệp nghĩa' },
      circuit:   { 'Thiên Nộ Nhân Oán':'Đồng bối hổ thẹn không muốn kề vai', 'Tai Tiếng Lẫy Lừng':'Bạn bè thẳng mặt chê trách', 'Vô Danh Tiểu Tốt':'Đi một mình không ai trò chuyện', 'Được Kính Trọng':'Đồng môn tôn làm lãnh tụ', 'Vạn Người Ngưỡng Mộ':'Bọn ta ngưỡng vọng như núi Thái Sơn' }
    };
    return '<div class="we-rep-grid">' + Object.entries(rep).filter(([k]) => k !== 'lastChange').map(([key, rawVal]) => {
      const val = legacyMap[rawVal] || rawVal;
      const cn = dimLabels[key] || key;
      const idx = levels.indexOf(val);
      const color = levelColors[val] || '#888';
      const quote = (quotes[key] && quotes[key][val]) || '';
      const dotsHtml = levels.map((l, i) => {
        const active = i <= idx ? ' we-rep-dot-active' : '';
        const dotColor = i <= idx ? color : '#444';
        return `<span class="we-rep-dot${active}" style="background:${dotColor};" data-rep-scope="${scope || 'state'}" data-dim="${key}" data-level="${l}" title="${l}"></span>`;
      }).join('');
      return `<div class="we-rep-row">
        <span class="we-rep-dim">${cn}</span>
        <div class="we-rep-dots">${dotsHtml}</div>
        <span class="we-rep-quote" style="color:${color}">${quote}</span>
      </div>`;
    }).join('') + '</div>';
  }

  function renderEconomy(econ, scope) {
    if (!econ) return '<div class="we-empty">Chưa có dữ liệu kinh tế</div>';
    const sc = scope || 'state';
    const climates = ['Phồn Vinh','Bình Ổn','Suy Thoái','Biến Động'];
    const climateColors = { 'Phồn Vinh': '#3ecf8e', 'Bình Ổn': '#7a8a9a', 'Suy Thoái': '#d9a34a', 'Biến Động': '#e05555' };
    const climateBg = { 'Phồn Vinh': 'rgba(62,207,142,0.08)', 'Bình Ổn': 'rgba(122,138,154,0.06)', 'Suy Thoái': 'rgba(217,163,74,0.08)', 'Biến Động': 'rgba(224,85,85,0.08)' };
    const climate = econ.climate || 'Bình Ổn';
    const cColor = climateColors[climate] || '#7a8a9a';
    let html = '<div class="we-climate-bar" style="background:' + (climateBg[climate]||'rgba(122,138,154,0.06)') + ';">';
    html += '<span class="we-climate-dot" style="background:' + cColor + ';box-shadow:0 0 8px ' + cColor + '88;"></span>';
    html += '<span class="we-climate-label" style="color:' + cColor + '">' + climate + '</span>';
    html += '<div class="we-climate-btns">';
    for (const c of climates) {
      html += '<span class="we-climate-btn' + (c === climate ? ' we-climate-btn-on' : '') + '" style="' + (c === climate ? ('color:'+(climateColors[c]||'#7a8a9a')+';border-color:'+(climateColors[c]||'#7a8a9a')) : '') + '" data-climate-scope="' + sc + '" data-climate="' + c + '">' + c + '</span>';
    }
    html += '</div></div>';
    if (econ.signals?.length) {
      html += renderPagedList(econ.signals, 'economy-signals', (s, i) =>
        '<div class="we-signal-item" data-sig-scope="' + sc + '">' +
        '<span class="we-signal-summary">' + u(s.summary||s) + '</span>' +
        '<span class="we-signal-scope">' + u(s.scope||'?') + '</span>' +
        '<span class="we-signal-del" data-sig-scope="' + sc + '" data-sigidx="' + i + '" title="Xóa Tín Hiệu">✕</span>' +
        '</div>'
      );
    } else {
      html += '<div class="we-empty" style="margin-top:4px;">Chưa có tín hiệu thị trường</div>';
    }
    html += '<div class="we-signal-add" data-sig-scope="' + sc + '"><i class="fa-solid fa-plus"></i> Thêm Tín Hiệu</div>';
    return html;
  }

  function renderEnemies(enemiesList, scope) {
    if (!enemiesList || !enemiesList.length) return '<div class="we-empty">Chưa có kẻ thù</div>';
    return renderPagedList(enemiesList, 'enemies', (en, enemyIndex) => {
      const isEditing = editingEnemy?.scope === scope && editingEnemy?.index === enemyIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-enemy-delete" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Xóa Kẻ Thù"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-enemy-copy" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Sao Chép Kẻ Thù"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-enemy-edit" data-enemy-scope="${scope}" data-enemy-index="${enemyIndex}" title="Sửa Kẻ Thù"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderEnemyEditor(en, enemyIndex, scope) : '';
      return `<div class="we-blood-item">
        ${actionHtml}
        <div class="we-blood-title">${u(en.name)} <span class="we-badge we-badge-danger">${en.status||'Đang Truy Tìm'}</span><span class="we-badge" style="background:var(--we-purple);font-size:10px;">${en.type==='blood'?'Huyết Cừu':'Ân Oán'}</span></div>
        <div class="we-blood-meta">Nguyên nhân: ${u(en.reason||'?')}</div>
        ${editHtml}
      </div>`;
    });
  }

  function renderEnemyEditor(en, index, scope) {
    const typeOptions = [['blood','Huyết Cừu'],['grudge','Ân Oán']].map(([v,label]) =>
      `<option value="${v}" ${en.type === v ? 'selected' : ''}>${label}</option>`).join('');
    const statusOptions = ['Đang Truy Tìm','Đang Lên Kế Hoạch','Đang Hành Động','Đã Chấm Dứt'].map(s =>
      `<option value="${s}" ${en.status === s ? 'selected' : ''}>${s}</option>`).join('');
    return `
      <div class="we-event-editor" data-enemy-scope="${scope}" data-enemy-index="${index}">
        <button class="we-event-editor-close we-enemy-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Tên Kẻ Thù<input class="we-enemy-edit-name" type="text" value="${u(en.name||'')}"></label>
          <label>Loại<select class="we-enemy-edit-type">${typeOptions}</select></label>
          <label>Trạng Thái<select class="we-enemy-edit-status">${statusOptions}</select></label>
          <label class="we-event-editor-wide">Nguyên Nhân<textarea class="we-enemy-edit-reason" rows="2">${u(en.reason||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-enemy-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderInfluenceChain(chain, scope) {
    if (!chain || !chain.length) return '<div class="we-empty">Chưa có chuỗi ảnh hưởng</div>';
    return renderPagedList(chain, 'influence', (item, infIndex) => {
      const isEditing = editingInfluence?.scope === scope && editingInfluence?.index === infIndex;
      const actionHtml = isEditing ? '' : `
        <div class="we-event-actions">
          <button class="we-icon-btn we-influence-delete" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Xóa Chuỗi Ảnh Hưởng"><i class="fa-solid fa-trash-can"></i></button>
          <button class="we-icon-btn we-influence-copy" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Sao Chép Chuỗi Ảnh Hưởng"><i class="fa-solid fa-copy"></i></button>
          <button class="we-icon-btn we-influence-edit" data-influence-scope="${scope}" data-influence-index="${infIndex}" title="Sửa Chuỗi Ảnh Hưởng"><i class="fa-solid fa-pen"></i></button>
        </div>`;
      const editHtml = isEditing ? renderInfluenceEditor(item, infIndex, scope) : '';
      return `<div class="we-influence-item">
        ${actionHtml}
        <div class="we-influence-step we-influence-trigger">
          <span class="we-influence-label">Nguồn Kích Hoạt</span>
          <span class="we-influence-text">${u(item.trigger)}</span>
        </div>
        <div class="we-influence-step we-influence-impact">
          <span class="we-influence-label">Ảnh Hưởng Trực Tiếp</span>
          <span class="we-influence-text">${u(item.impact)}</span>
        </div>
        ${item.fallout ? `<div class="we-influence-step we-influence-fallout">
          <span class="we-influence-label">Dư Chấn Về Sau</span>
          <span class="we-influence-text">${u(item.fallout)}</span>
        </div>` : ''}
        ${editHtml}
      </div>`;
    });
  }

  function renderInfluenceEditor(item, index, scope) {
    return `
      <div class="we-event-editor" data-influence-index="${index}" data-influence-scope="${scope}">
        <button class="we-event-editor-close we-influence-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label class="we-event-editor-wide">Nguồn Kích Hoạt<textarea class="we-influence-edit-trigger" rows="2">${u(item.trigger||'')}</textarea></label>
          <label class="we-event-editor-wide">Ảnh Hưởng Trực Tiếp<textarea class="we-influence-edit-impact" rows="2">${u(item.impact||'')}</textarea></label>
          <label class="we-event-editor-wide">Dư Chấn Về Sau<textarea class="we-influence-edit-fallout" rows="2">${u(item.fallout||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-influence-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function getRegionalIncidentTypeLabel(type) {
    const labels = {
      banditry: 'Thổ Phỉ Cướp Bóc',
      fire: 'Hỏa Hoạn',
      massacre: 'Án Mạng Nghiêm Trọng',
      flood: 'Lũ Lụt',
      infrastructure: 'Đường Sá Thủy Lợi Sụp Đổ',
      plague: 'Dịch Bệnh',
      famine: 'Nạn Đói Mất Mùa',
      riot: 'Bạo Loạn',
      rebellion: 'Nổi Dậy Phản Loạn',
      military: 'Biến Cố Quân Sự',
      earthquake: 'Động Đất Lở Núi',
      storm: 'Bão Tuyết',
      other: 'Khác'
    };
    return labels[type] || 'Khác';
  }

  function renderRegionalIncident(ri, scope) {
    if (!ri) return '<div class="we-empty">Chưa phán định biến cố khu vực</div>';
    const isEditing = editingRI?.active === true && editingRI?.scope === scope;
    const actionHtml = isEditing ? '' : `
      <div class="we-event-actions">
        <button class="we-icon-btn we-ri-delete" data-ri-scope="${scope}" title="Xóa Biến Cố Khu Vực"><i class="fa-solid fa-trash-can"></i></button>
        <button class="we-icon-btn we-ri-copy" data-ri-scope="${scope}" title="Sao Chép Biến Cố Khu Vực"><i class="fa-solid fa-copy"></i></button>
        <button class="we-icon-btn we-ri-edit" data-ri-scope="${scope}" title="Sửa Biến Cố Khu Vực"><i class="fa-solid fa-pen"></i></button>
      </div>`;
    const editHtml = isEditing ? renderRIEditor(ri, scope) : '';

    if (ri.active) {
      return `<div class="we-accident-item we-regional-incident-item we-accident-triggered">
        ${actionHtml}
        ${u(ri.title)}<br>
        <span style="font-size:11px;color:var(--we-text3);">Loại: ${u(getRegionalIncidentTypeLabel(ri.type))} | Phạm vi: ${u(ri.scope||'?')} | Còn lại: ${ri.duration||0} vòng</span><br>
        <span style="font-size:11px;color:var(--we-text2);">${u(ri.impact||'')}</span>
        ${editHtml}
      </div>`;
    }
    if (ri.title && ri.title.includes('thử lại')) {
      return `<div class="we-accident-item we-regional-incident-item" style="border-left:3px solid var(--we-gold);">
        ${actionHtml}
        ${u(ri.title)} (Loại: ${u(getRegionalIncidentTypeLabel(ri.type))})
        ${editHtml}
      </div>`;
    }
    if (ri.cooldown > 0) {
      return `<div class="we-accident-item we-regional-incident-item">${actionHtml}Vòng này không có biến cố khu vực (còn hồi ${ri.cooldown} vòng)${editHtml}</div>`;
    }
    return `<div class="we-accident-item we-regional-incident-item">${actionHtml}Vòng này không có biến cố khu vực${editHtml}</div>`;
  }

  function renderRIEditor(ri, scope) {
    const types = ['banditry','fire','massacre','flood','infrastructure','plague','famine','riot','rebellion','military','earthquake','storm'];
    if (ri.type && !types.includes(ri.type)) types.push(ri.type);
    const typeOptions = types.map(t =>
      `<option value="${t}" ${ri.type === t ? 'selected' : ''}>${u(getRegionalIncidentTypeLabel(t))}</option>`).join('');
    return `
      <div class="we-event-editor" data-ri-edit="1" data-ri-scope="${scope}">
        <button class="we-event-editor-close we-ri-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">
          <label>Trạng Thái<select class="we-ri-edit-active">
            <option value="true" ${ri.active ? 'selected' : ''}>Kích Hoạt Và Hiển Thị Sự Kiện</option>
            <option value="false" ${!ri.active ? 'selected' : ''}>Chưa Kích Hoạt</option>
          </select></label>
          <label class="we-event-editor-wide">Tiêu Đề<input class="we-ri-edit-title" type="text" value="${u(ri.title||'')}"></label>
          <label>Loại<select class="we-ri-edit-type">${typeOptions}</select></label>
          <label>Phạm Vi<input class="we-ri-edit-scope" type="text" value="${u(ri.scope||'')}"></label>
          <label>Số Vòng Còn Lại<input class="we-ri-edit-duration" type="number" min="0" max="99" value="${ri.duration||0}"></label>
          <label>Thời Gian Hồi<input class="we-ri-edit-cooldown" type="number" min="0" max="99" value="${ri.cooldown||0}"></label>
          <label class="we-event-editor-wide">Ảnh Hưởng<textarea class="we-ri-edit-impact" rows="3">${u(ri.impact||'')}</textarea></label>
        </div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-ri-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  const SECRET_STATUS_COLOR = { 'Còn Hiệu Lực': 'var(--we-green)', 'Đã Hết Hạn': 'var(--we-text3)', 'Đã Bị Lộ': 'var(--we-red)', 'Mất Hiệu Lực': 'var(--we-text3)' };

  function isEditingSecret(scope, list, index) {
    return editingSecret && editingSecret.scope === scope && editingSecret.list === list && editingSecret.index === index;
  }

  function renderBlackbox(blackbox, scope) {
    if (!blackbox) return '<div class="we-empty">Chưa có thông tin hộp đen</div>';
    let html = '';
    const actions = blackbox.secretActions || [];
    const assets = blackbox.secretAssets || [];

    if (actions.length) {
      html += '<div class="we-secret-group-label we-secret-action">Hành Vi Bí Mật</div>';
      html += renderPagedList(actions, 'secret-actions', (raw, idx) => {
        const a = (typeof raw === 'string') ? { action: raw } : raw;
        if (isEditingSecret(scope, 'action', idx)) return renderSecretEditor(a, 'action', idx, scope);
        return `<div class="we-secret-card we-secret-action">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Sửa"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Sao Chép"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="action" data-secret-index="${idx}" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.action || 'Hành Vi Chưa Đặt Tên')}</div>
            <div class="we-secret-meta">Người biết chuyện · ${u(a.witnesses || 'Không có')}</div>
          </div>
        </div>`;
      });
    }

    if (assets.length) {
      html += '<div class="we-secret-group-label we-secret-asset">Tài Sản Bí Mật</div>';
      html += renderPagedList(assets, 'secret-assets', (raw, idx) => {
        const a = (typeof raw === 'string') ? { name: raw } : raw;
        if (isEditingSecret(scope, 'asset', idx)) return renderSecretEditor(a, 'asset', idx, scope);
        const expo = Math.min(100, Math.max(0, Number(a.exposure) || 0));
        const status = a.status || 'Còn Hiệu Lực';
        const stColor = SECRET_STATUS_COLOR[status] || 'var(--we-text3)';
        return `<div class="we-secret-card we-secret-asset">
          <div class="we-secret-ops">
            <button class="we-icon-btn we-secret-edit" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Sửa"><i class="fa-solid fa-pen"></i></button>
            <button class="we-icon-btn we-secret-copy" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Sao Chép"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-secret-del" data-secret-scope="${scope}" data-secret-list="asset" data-secret-index="${idx}" title="Xóa"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="we-secret-body">
            <div class="we-secret-title">${u(a.name || 'Tài Sản Chưa Đặt Tên')}<span class="we-secret-status" style="color:${stColor};border-color:${stColor};">${u(status)}</span></div>
            <div class="we-secret-expo">
              <div class="we-secret-expo-track"><div class="we-secret-expo-fill" style="width:${expo}%;"></div></div>
              <span class="we-secret-expo-num">Lộ ${expo}%</span>
            </div>
          </div>
        </div>`;
      });
    }

    if (!html) html = '<div class="we-empty">Không có thông tin mặt tối</div>';
    return html;
  }

  /** Trình soạn bí mật thống nhất: dropdown "Loại" ở đầu chỉ chuyển biểu mẫu (view), việc chuyển đổi hoãn đến lúc lưu mới ghi dữ liệu */
  function renderSecretEditor(a, list, index, scope, view) {
    view = view || (editingSecret && editingSecret.view) || list;
    const typeSelect = `<label>Loại<select class="we-secret-type">
        <option value="action" ${view === 'action' ? 'selected' : ''}>Hành Vi Bí Mật</option>
        <option value="asset" ${view === 'asset' ? 'selected' : ''}>Tài Sản Bí Mật</option>
      </select></label>`;
    // Điền trước xuyên loại: trường tiêu đề của hành vi ↔ tài sản dùng chung (action.action ↔ asset.name)
    const titleText = u(a.action || a.name || '');
    let fields;
    if (view === 'action') {
      fields = `${typeSelect}
        <label class="we-event-editor-wide">Mô Tả Hành Vi<textarea class="we-secret-f-action" rows="2">${titleText}</textarea></label>
        <label class="we-event-editor-wide">Người Chứng Kiến<input class="we-secret-f-witnesses" type="text" value="${u(a.witnesses || 'Không có')}"></label>`;
    } else {
      const statusOptions = ['Còn Hiệu Lực','Đã Hết Hạn','Đã Bị Lộ','Mất Hiệu Lực'].map(s =>
        `<option value="${s}" ${a.status === s ? 'selected' : ''}>${s}</option>`).join('');
      fields = `${typeSelect}
        <label class="we-event-editor-wide">Tên Tài Sản<input class="we-secret-f-name" type="text" value="${titleText}"></label>
        <label>Mức Độ Lộ<input class="we-secret-f-exposure" type="number" min="0" max="100" value="${Number(a.exposure) || 0}"></label>
        <label>Trạng Thái<select class="we-secret-f-status">${statusOptions}</select></label>`;
    }
    return `
      <div class="we-event-editor we-secret-editor" data-secret-scope="${scope}" data-secret-list="${list}" data-secret-index="${index}" data-secret-view="${view}">
        <button class="we-event-editor-close we-secret-editor-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="we-event-editor-grid">${fields}</div>
        <div class="we-event-editor-footer">
          <button class="we-btn we-btn-primary we-secret-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
        </div>
      </div>`;
  }

  function renderLedger(memories) {
    const entries = (memories || []).filter(m => m.type === 'ledger').reverse();
    if (!entries.length) return '<div class="we-empty">Chưa có ghi chép sự kiện lớn</div>';
    return renderPagedList(entries, 'ledger', entry => {
      const lines = [];
      for (const c of (entry.changes || [])) {
        if (c.type === 'event_new') {
          const tn = { conflict: 'Xung Đột', progress: 'Tiến Triển' }[c.eventType] || c.eventType;
          lines.push(`[Thêm Lv${c.level}${tn}] ${u(c.name)} - ${u(c.stage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_advance') {
          lines.push(`[Tiến Triển] ${u(c.name)}(Lv${c.level}) ${u(c.fromStage)}->${u(c.toStage)} - ${u(c.desc||'')}`);
        } else if (c.type === 'event_terminal') {
          const transition = c.fromStage ? `${u(c.fromStage)}->${u(c.stage||c.toStage)}` : u(c.stage||c.toStage);
          lines.push(`[Kết Thúc] ${u(c.name)}(Lv${c.level}) ${transition} - ${u(c.desc||'')}`);
        } else if (c.type === 'wind_new') {
          lines.push(`[Thêm Lv${c.level} Tin Đồn] ${u(c.topic)} - ${u(c.content||'')}`);
        }
      }
      return `<div class="we-ledger-item">
        <span class="we-ledger-round">Vòng ${entry.round}</span>
        <div class="we-ledger-changes">${lines.map(l => `<div class="we-ledger-line">${l}</div>`).join('')}</div>
      </div>`;
    });
  }

  const NOTE_TYPE_COLORS = {
    'Nhắc Nhở Nhập Vai': '#9b59b6',
    'Nhân Vật':          '#e67e22',
    'Phong Tục':         '#e91e63',
    'Nghề Nghiệp':       '#3498db',
    'Kinh Tế':           '#f39c12',
    'Địa Lý':            '#27ae60',
    'Lịch Sử':           '#795548',
    'Chế Độ':            '#e74c3c',
    'Công Nghệ':         '#00bcd4',
    'Ngôn Ngữ':          '#9c27b0',
  };

  function parseTipEntries(raw) {
    const entries = [];
    const re = /\[([^\|\]]+)\|([^\]]+)\]/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
      entries.push({ type: m[1].trim(), content: m[2].trim() });
    }
    return entries;
  }

  function serializeTipEntries(entries) {
    return entries.map(e => '[' + e.type + '|' + e.content + ']').join('\n');
  }

  function renderWorldNotes(worldNotes) {
    if (!worldNotes || !worldNotes.length) {
      return '<div class="we-empty">Chưa có chú thích thế giới. AI sẽ tạo <code>&lt;tips&gt;</code> sau mỗi lượt phản hồi.</div>';
    }
    let html = '';
    worldNotes.forEach((note, noteIndex) => {
      const entries = parseTipEntries(note.raw || '');
      entries.forEach((entry, entryIdx) => {
        const color = NOTE_TYPE_COLORS[entry.type] || '#58b8a9';
        const isEditing = editingNote?.noteIndex === noteIndex && editingNote?.entryIndex === entryIdx;
        const typeOptions = Object.keys(NOTE_TYPE_COLORS).map(t =>
          `<option value="${t}" ${t === entry.type ? 'selected' : ''}>${t}</option>`
        ).join('');
        const editHtml = isEditing ? `
          <div class="we-event-editor we-note-editor" data-note-index="${noteIndex}" data-entry-index="${entryIdx}">
            <button class="we-event-editor-close we-note-editor-close" title="Hủy"><i class="fa-solid fa-xmark"></i></button>
            <div class="we-event-editor-grid">
              <label>Loại<select class="we-note-edit-type">${typeOptions}</select></label>
              <label class="we-event-editor-wide">Nội Dung<textarea class="we-note-edit-content" rows="4">${u(entry.content)}</textarea></label>
            </div>
            <div class="we-event-editor-footer">
              <button class="we-btn we-btn-primary we-note-editor-save"><i class="fa-solid fa-floppy-disk"></i> Lưu</button>
            </div>
          </div>` : '';
        html += `<div class="we-note-item" style="--note-color:${color};">
          <div class="we-note-header">
            <span class="we-badge" style="background:${color}22;color:${color};border:1px solid ${color}44;">${u(entry.type)}</span>
            <span class="we-note-round">Vòng ${note.round}</span>
          </div>
          <div class="we-note-content">${u(entry.content)}</div>
          ${editHtml}
          <div class="we-event-actions">
            <button class="we-icon-btn we-note-delete" data-note-index="${noteIndex}" data-entry-index="${entryIdx}" title="Xóa Chú Thích"><i class="fa-solid fa-trash-can"></i></button>
            <button class="we-icon-btn we-note-copy" data-note-index="${noteIndex}" data-entry-index="${entryIdx}" title="Sao Chép Nội Dung"><i class="fa-solid fa-copy"></i></button>
            <button class="we-icon-btn we-note-edit" data-note-index="${noteIndex}" data-entry-index="${entryIdx}" title="Sửa Chú Thích"><i class="fa-solid fa-pen"></i></button>
          </div>
        </div>`;
      });
    });
    return html || '<div class="we-empty">Không có chú thích hợp lệ.</div>';
  }

  // [FIX] Gắn sự kiện thu gọn cho thẻ phân đoạn prompt diễn biến (cấp module, dùng chung cho dựng trang + làm mới cục bộ). Ủy quyền sự kiện.
  function bindPromptSegToggle(root) {
    if (!root) return;
    root.addEventListener('click', function(e) {
      const head = e.target.closest('[data-we-seg-toggle]');
      if (!head) return;
      const card = head.parentElement;
      const body = card && card.querySelector('.we-prompt-seg-body');
      const arrow = head.querySelector('.we-prompt-seg-arrow');
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
    });
  }

  // [FIX] Làm mới cục bộ phần renderDebug của thẻ gỡ lỗi: chỉ thay nội dung #we-debug-render và gắn lại sự kiện thu gọn đoạn,
  // không đụng DOM của các tab khác (bảo vệ input chưa lưu của người dùng ở tab khác). Gọi khi chuyển sang tab gỡ lỗi.
  function refreshDebugRender() {
    const box = document.getElementById('we-debug-render');
    if (!box) return;
    box.innerHTML = renderDebug();
    bindPromptSegToggle(box.querySelector('.we-prompt-debug'));
    // Nút xuất nằm trong đầu ra của renderDebug, gắn lại sự kiện
    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('Không có Prompt để xuất', true); return; }
        const blob = new Blob([dbg.prompt], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'prompt-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
        showToast('Đã xuất Prompt');
      };
    }
    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('Không có phản hồi API để xuất', true); return; }
        const blob = new Blob([dbg.rawResult], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'api-raw-' + Date.now() + '.txt'; a.click();
        URL.revokeObjectURL(url);
        showToast('Đã xuất phản hồi API');
      };
    }
  }

  function getPresetMod() {
    return (window.WORLD_ENGINE_PRESET && typeof window.WORLD_ENGINE_PRESET.getAllPresets === 'function')
      ? window.WORLD_ENGINE_PRESET : null;
  }

  // Tạo HTML quản lý preset (bộ chọn + nút thao tác + 4 thẻ thu gọn có thể chỉnh sửa + gợi ý).
  // Giá trị khởi tạo của mỗi textarea = văn bản đang hiệu lực (có ghi đè thì dùng ghi đè, không thì dùng nguyên văn hardcode mặc định).
  function renderPresetManage() {
    const P = getPresetMod();
    if (!P) return '<div class="we-empty">Hệ thống preset chưa tải</div>';

    const all = P.getAllPresets();
    const activeId = P.getActivePresetId();
    const active = P.getActivePreset();
    const overridden = P.getOverriddenSegKeys();
    const keys = P.EDITABLE_SEG_KEYS;
    const labels = P.SEG_LABELS;

    const optHtml = all.map(p =>
      '<option value="' + h(p.id) + '"' + (p.id === activeId ? ' selected' : '') + '>'
      + h(p.name) + (p.builtin ? ' (Tích Hợp Sẵn)' : '') + '</option>').join('');

    const segCards = keys.map(k => {
      const text = P.getSegmentDisplayText(k) || '';
      const isOver = overridden.indexOf(k) >= 0;
      const meta = isOver ? 'Đã Tùy Chỉnh' : 'Mặc Định (Chưa Đổi)';
      return '<div class="we-prompt-seg-card we-preset-seg-card' + (isOver ? ' we-preset-seg-card-over' : '') + '">'
        + '<div class="we-prompt-seg-head" data-we-preset-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + h(labels[k] || k) + '</span>'
        + '<span class="we-prompt-seg-meta">' + meta + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body we-preset-seg-body" style="display:none;">'
        + '<textarea class="we-preset-textarea" data-we-preset-seg="' + h(k) + '" rows="14" spellcheck="false" placeholder="Để trống sẽ dùng nguyên văn hardcode mặc định">'
        + h(text) + '</textarea>'
        + '<div class="we-preset-seg-hint">Để trống rồi lưu sẽ quay lại nguyên văn mặc định. Sửa ⑦⑧ có thể khiến diễn biến phân tích thất bại, tự chịu trách nhiệm. Có thể giữ {{user}}.</div>'
        + '</div>'
        + '</div>';
    }).join('');

    const builtinActive = !!(active && active.builtin);

    return '<div class="we-preset-manage">'
      + '<div class="we-preset-row">'
      + '<label class="we-preset-select-label">Preset Hiện Tại</label>'
      + '<select id="we-preset-select" class="we-preset-select">' + optHtml + '</select>'
      + '</div>'
      + '<div class="we-preset-active-desc">' + h(active && active.description || '') + '</div>'
      + '<div class="we-preset-actions">'
      + '<button class="we-btn we-btn-primary" id="we-preset-save">Lưu</button>'
      + '<button class="we-btn" id="we-preset-saveas">Lưu Thành</button>'
      + (builtinActive ? '' : '<button class="we-btn we-btn-danger" id="we-preset-delete">Xóa</button>')
      + '<button class="we-btn" id="we-preset-export">Xuất</button>'
      + '<button class="we-btn" id="we-preset-import">Nhập</button>'
      + '<input type="file" id="we-preset-import-file" accept=".json,application/json" style="display:none;">'
      + '</div>'
      + '<div class="we-preset-hint">'
      + 'Nơi đây chỉnh sửa đoạn hardcode của prompt mà "World Engine" gửi cho AI diễn biến. Sửa đổi sẽ làm thay đổi hành vi diễn biến, '
      + 'tự chịu trách nhiệm. Preset "Mặc Định" tích hợp sẵn không thể xóa, sửa preset tích hợp sẵn rồi bấm "Lưu" sẽ gợi ý lưu thành bản sao.'
      + '</div>'
      + '<div class="we-prompt-seg-list">' + segCards + '</div>'
      + '</div>';
  }

  // [FIX] Làm mới cục bộ phần quản lý preset: chỉ thay nội dung #we-preset-manage và gắn lại sự kiện, không đụng input của tab khác.
  function refreshPresetManage() {
    const box = document.getElementById('we-preset-manage');
    if (!box) return;
    box.innerHTML = renderPresetManage();
    bindPresetEvents(box);
  }

  // Thu thập văn bản hiện tại của 4 textarea → đối tượng segments (chuỗi rỗng → null nghĩa là quay lại mặc định).
  function collectPresetSegmentsFromDOM() {
    const P = getPresetMod();
    if (!P) return {};
    const out = {};
    P.EDITABLE_SEG_KEYS.forEach(k => {
      const ta = document.querySelector('.we-preset-textarea[data-we-preset-seg="' + cssEscape(k) + '"]');
      if (!ta) { out[k] = null; return; }
      const v = ta.value;
      out[k] = (v == null || v.trim() === '') ? null : v;
    });
    return out;
  }

  // Escape giá trị thuộc tính đơn giản (dùng để ghép seg key vào bộ chọn querySelector; key đều là chữ thường cố định có gạch nối, chỉ để phòng hờ).
  function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
  }

  // Gắn sự kiện quản lý preset (chuyển đổi bộ chọn + lưu/lưu thành/xóa/nhập/xuất + ủy quyền thu gọn đoạn).
  function bindPresetEvents(root) {
    const P = getPresetMod();
    if (!P) return;
    root = root || document.getElementById('we-preset-manage');
    if (!root) return;

    // Thu gọn đoạn (ủy quyền sự kiện, data-attr độc lập, không xung đột với data-we-seg-toggle của bindPromptSegToggle).
    // [FIX] Ủy quyền chỉ cần gắn một lần: refreshPresetManage mỗi lần chỉ thay root.innerHTML (node con hoàn toàn mới),
    // bản thân node root không đổi, ủy quyền dựa vào bubbling nên luôn có hiệu lực. Dùng cờ bảo vệ để tránh mỗi lần làm mới lại addEventListener khiến
    // listener chồng chất (bấm lưu 10 lần sẽ chồng 10 lớp click trên cùng root, bấm đầu thu gọn một lần kích hoạt 10 lần).
    if (!root.__wePresetDelegated) {
      root.__wePresetDelegated = true;
      root.addEventListener('click', function (e) {
        const head = e.target.closest('[data-we-preset-toggle]');
        if (!head) return;
        const card = head.parentElement;
        const body = card && card.querySelector('.we-preset-seg-body');
        const arrow = head.querySelector('.we-prompt-seg-arrow');
        if (!body) return;
        const isHidden = body.style.display === 'none';
        body.style.display = isHidden ? 'block' : 'none';
        if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
      });
    }

    // Chuyển đổi preset
    const sel = root.querySelector('#we-preset-select');
    if (sel) {
      sel.onchange = () => {
        const id = sel.value;
        P.setActivePreset(id);
        showToast('Đã chuyển preset');
        refreshPresetManage();
      };
    }

    // Lưu: preset tích hợp sẵn → gợi ý lưu thành bản sao; tùy chỉnh → cập nhật hiện tại.
    const saveBtn = root.querySelector('#we-preset-save');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        if (active && active.builtin) {
          // Preset tích hợp sẵn không thể ghi đè: chuyển sang quy trình lưu thành bản sao
          const name = prompt('Đây là preset tích hợp sẵn, lưu sẽ tạo thành bản sao preset mới. Vui lòng nhập tên preset mới:', active.name + ' Bản Sao');
          if (name == null) return;
          const np = P.saveAsCustomPreset({ name: name || (active.name + ' Bản Sao'), description: active.description, segments: segs });
          P.setActivePreset(np.id);
          showToast('Đã lưu thành preset mới: ' + np.name);
          refreshPresetManage();
          return;
        }
        P.saveCustomPreset({ id: activeId, name: active.name, description: active.description, segments: segs });
        showToast('Đã lưu preset');
        refreshPresetManage();
      };
    }

    // Lưu thành: buộc phải tạo id mới
    const saveAsBtn = root.querySelector('#we-preset-saveas');
    if (saveAsBtn) {
      saveAsBtn.onclick = () => {
        const active = P.getActivePreset();
        const segs = collectPresetSegmentsFromDOM();
        const name = prompt('Vui lòng nhập tên preset mới:', active.name + ' Bản Sao');
        if (name == null) return;
        const np = P.saveAsCustomPreset({ name: name || (active.name + ' Bản Sao'), description: active.description, segments: segs });
        P.setActivePreset(np.id);
        showToast('Đã lưu thành preset mới: ' + np.name);
        refreshPresetManage();
      };
    }

    // Xóa: chỉ áp dụng cho preset tùy chỉnh
    const delBtn = root.querySelector('#we-preset-delete');
    if (delBtn) {
      delBtn.onclick = () => {
        const activeId = P.getActivePresetId();
        const active = P.getActivePreset();
        if (!active || active.builtin) { showToast('Không thể xóa preset tích hợp sẵn', true); return; }
        if (!confirm('Xác nhận xóa preset "' + active.name + '"? Thao tác này không thể hoàn tác.')) return;
        P.deleteCustomPreset(activeId);
        showToast('Đã xóa preset');
        refreshPresetManage();
      };
    }

    // Xuất preset hiện tại
    const expBtn = root.querySelector('#we-preset-export');
    if (expBtn) {
      expBtn.onclick = () => {
        const json = P.exportPreset(P.getActivePresetId());
        if (!json) { showToast('Không có preset để xuất', true); return; }
        const name = (P.getActivePreset().name || 'preset').replace(/[\\/:*?"<>|]/g, '_');
        setupDownload(json, 'world-engine-preset-' + name + '-' + Date.now() + '.json');
        showToast('Đã xuất preset');
      };
    }

    // Nhập: kích hoạt chọn file
    const impBtn = root.querySelector('#we-preset-import');
    const impFile = root.querySelector('#we-preset-import-file');
    if (impBtn && impFile) {
      impBtn.onclick = () => impFile.click();
      impFile.onchange = () => {
        const f = impFile.files && impFile.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const np = P.importPreset(String(reader.result || ''));
            showToast('Đã nhập preset: ' + np.name);
            refreshPresetManage();
          } catch (e) {
            showToast('Nhập thất bại: ' + (e && e.message || e), true);
          }
        };
        reader.onerror = () => showToast('Đọc file thất bại', true);
        reader.readAsText(f, 'utf-8');
        // Xóa value để có thể chọn lại cùng một file
        impFile.value = '';
      };
    }
  }


  // ── Thẻ tự kiểm tra chèn (chỉ đọc): đọc snapshot cuối cùng của WORLD_ENGINE_INJECT_INSPECTOR,
  //    dùng ngôn ngữ dễ hiểu + chuỗi tin nhắn phân theo role để trả lời "trạng thái thế giới có thực sự vào prompt gửi cho mô hình lớn hay không".
  //    Dữ liệu hoàn toàn lấy từ snapshot chỉ đọc của inspector; hàm này chỉ ghép HTML thuần, không gây tác dụng phụ nào.
  //    Trả về là đoạn con bên trong .we-prompt-debug (đầu thu gọn dùng chung data-we-seg-toggle, do bindPromptSegToggle tiếp quản thống nhất).
  function renderInjectInspector(scope) {
    const npcScope = scope === 'npc';
    const engine = window.NPC_ENGINE;
    const insp = window.WORLD_ENGINE_INJECT_INSPECTOR;
    const snap = insp?.getLastSnapshot?.(npcScope ? 'npc' : 'world')
      || (npcScope ? engine?.getLastInjectionDebug?.() : null)
      || (npcScope ? engine?.getLastDebug?.()?.injection : null)
      || null;
    const status = snap ? snap.status : 'NOT_YET';
    const fallbackText = npcScope ? {
      NOT_YET: 'Chưa sinh, chưa có bản ghi chèn ký ức',
      SKIPPED_DISABLED: 'Vòng này không chèn: chèn ký ức đã tắt',
      SKIPPED_REROLL: 'Vòng này theo thiết kế không chèn: roll lại cùng tầng',
      SKIPPED_OTHER: 'Vòng này không chèn: không khớp được ký ức liên quan',
      SUCCESS: '✅ Thông tin ký ức vòng này đã vào nội dung',
      MISSING: '❌ Đã đăng ký nhưng không vào prompt cuối cùng'
    } : {};
    const text = insp?.statusText ? insp.statusText(status, npcScope ? 'npc' : 'world') : (fallbackText[status] || fallbackText.NOT_YET || '');
    const subject = npcScope ? 'Hồ sơ nhân vật' : 'Trạng thái thế giới';

    const palette = {
      SUCCESS:          { icon: '✅', color: '#3fb950', bg: 'rgba(63,185,80,0.10)' },
      MISSING:          { icon: '❌', color: '#f85149', bg: 'rgba(248,81,73,0.10)' },
      SKIPPED_DISABLED: { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_REROLL:   { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      SKIPPED_OTHER:    { icon: '⏸', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
      NOT_YET:          { icon: '—', color: 'var(--we-text3)', bg: 'rgba(128,128,128,0.08)' },
    };
    const p = palette[status] || palette.NOT_YET;

    let html = '<div class="we-inject-inspector" style="border:1px solid var(--we-border);border-radius:8px;padding:10px;margin-bottom:12px;background:' + p.bg + ';">';
    html += '<div style="font-weight:600;color:' + p.color + ';margin-bottom:4px;">' + p.icon + ' Tự Kiểm Tra Chèn · ' + h(text) + '</div>';

    if (!snap) {
      html += '<div style="font-size:11px;color:var(--we-text3);">Sau khi gửi một tin nhắn kích hoạt sinh nội dung, ở đây sẽ hiển thị "' + subject + '" có thực sự vào nội dung prompt gửi cho mô hình lớn hay không.</div>';
      return html + '</div>';
    }

    // Dòng meta thông tin
    const apiLabel = snap.apiType === 'chat' ? 'Hoàn thiện hội thoại' : 'Hoàn thiện văn bản';
    let when = '';
    try { when = snap.ts ? new Date(snap.ts).toLocaleTimeString() : ''; } catch (e) {}
    html += '<div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">'
      + 'API: ' + apiLabel + ' · Vòng: ' + (snap.round != null ? h(String(snap.round)) : '?')
      + ' · Đã đăng ký: ' + (snap.registeredAtSend ? 'Có' : 'Không')
      + ' · Vào nội dung: ' + (snap.landed ? 'Có' : 'Không')
      + (when ? ' · ' + h(when) : '')
      + '</div>';

    // Huy hiệu role
    const roleColor = { system: '#a371f7', user: '#58a6ff', assistant: '#3fb950', tool: '#d29922' };
    const roleBadge = (role) => {
      const c = roleColor[role] || 'var(--we-text3)';
      return '<span style="display:inline-block;min-width:62px;text-align:center;font-size:10px;padding:1px 6px;border-radius:4px;border:1px solid ' + c + ';color:' + c + ';">' + h(role || '?') + '</span>';
    };

    if (snap.apiType === 'chat' && Array.isArray(snap.messages)) {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">Chuỗi tin nhắn thực sự gửi đi (tổng ' + h(String(snap.messageCount)) + ' tin, phân theo role; bấm vào bất kỳ tin nào để mở rộng xem toàn văn):</div>';
      html += snap.messages.map((m) => {
        const meta = (m.length != null ? m.length + ' chữ' : '');
        const hasBody = (m.content != null && m.content.length > 0);
        if (m.isOurs) {
          // Tin có chứa nội dung chèn của extension này: có thể thu gọn, mở rộng xem toàn bộ nội dung chèn.
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content || snap.ourContent || '') + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ Có chứa nội dung chèn của extension này</span>'
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // Tin khác: cũng có thể thu gọn mở rộng xem toàn văn (chỉ đọc, không ghi bất kỳ lưu trữ nào)
        if (hasBody) {
          const body = '<pre class="we-prompt-seg-pre">' + u(m.content) + '</pre>';
          return '<div class="we-prompt-seg-card" style="margin:3px 0;">'
            + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
            + '<span class="we-prompt-seg-arrow">▶</span>'
            + roleBadge(m.role)
            + '<span class="we-prompt-seg-meta">' + meta + '</span>'
            + '</div>'
            + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
            + '</div>';
        }
        // Nội dung rỗng: một dòng chỉ đọc
        return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0;font-size:11px;color:var(--we-text3);">'
          + roleBadge(m.role)
          + '<span>' + meta + '</span>'
          + '</div>';
      }).join('');
    } else if (snap.apiType === 'text') {
      html += '<div style="font-size:11px;color:var(--we-text2);margin-bottom:4px;">Prompt hoàn thiện văn bản tổng ' + h(String(snap.promptLength || 0)) + ' chữ (đã flatten thành một chuỗi, không phân role):</div>';
      if (snap.landed && snap.ourExcerpt) {
        const body = '<pre class="we-prompt-seg-pre">' + u(snap.ourExcerpt) + '</pre>';
        html += '<div class="we-prompt-seg-card" style="margin:3px 0;">'
          + '<div class="we-prompt-seg-head" data-we-seg-toggle style="display:flex;align-items:center;gap:6px;">'
          + '<span class="we-prompt-seg-arrow">▶</span>'
          + '<span class="we-prompt-seg-label" style="color:#3fb950;">✅ Trích đoạn tại vị trí điểm đánh dấu khớp</span>'
          + '</div>'
          + '<div class="we-prompt-seg-body" style="display:none;">' + body + '</div>'
          + '</div>';
      }
    }

    return html + '</div>';
  }

  // [FIX] renderDebug: hiển thị phân đoạn prompt diễn biến hoàn toàn minh bạch (chỉ đọc, không cho sửa).
  // Tách toàn bộ prompt mà API diễn biến nhận được thành 10 đoạn hiển thị thu gọn + tô sáng JSON AI trả về, chỉ xem vòng mới nhất.
  // Nguồn dữ liệu evo.getLastDebug().segments (bản sao phía ghép của evolution.js, khớp từng byte với prompt thực sự gửi đi).
  function renderDebug() {
    // Thẻ tự kiểm tra chèn độc lập với dữ liệu diễn biến: mỗi lần sinh đều cập nhật, nên dù chưa diễn biến cũng phải hiển thị trước.
    //   Toàn bộ vẫn bọc trong .we-prompt-debug, dùng chung ủy quyền duy nhất của bindPromptSegToggle để tiếp quản thu gọn.
    const injectCard = renderInjectInspector();
    const evo = window.WORLD_ENGINE_EVOLUTION;
    const wrap = (inner) => '<div class="we-prompt-debug">' + injectCard + inner + '</div>';
    if (!evo || !evo.getLastDebug) return wrap('<div class="we-empty">Dữ liệu gỡ lỗi không khả dụng</div>');
    const dbg = evo.getLastDebug();
    if (!dbg || !dbg.prompt) return wrap('<div class="we-empty">Chưa diễn biến, chưa có dữ liệu gỡ lỗi</div>');

    const segments = Array.isArray(dbg.segments) ? dbg.segments : [];
    const totalLen = dbg.prompt.length || 0;
    // Thanh tỷ lệ đoạn: chiều rộng mỗi đoạn theo tỷ lệ số chữ
    const barHtml = segments.length
      ? '<div class="we-prompt-seg-bar">' + segments.map(seg => {
          const len = (seg.content || '').length;
          const pct = totalLen ? (len / totalLen * 100) : 0;
          return '<span class="we-prompt-seg-bar-cell" style="width:' + pct.toFixed(2) + '%" title="' + u(seg.label) + ' ' + len + ' chữ"></span>';
        }).join('') + '</div>'
      : '';

    // Thử pretty-print đối tượng JSON đầu tiên trong content (dùng để tô sáng đoạn trạng thái/đoạn ví dụ)
    const tryPrettyJson = (text) => {
      if (!text) return null;
      const api = window.WORLD_ENGINE_API;
      // JSON.parse trực tiếp thất bại thì dùng api.parseJSON để dung sai
      let obj = null;
      try { obj = JSON.parse(text); } catch (e) {
        if (api && api.parseJSON) { try { obj = api.parseJSON(text); } catch (e2) {} }
      }
      if (obj === null || typeof obj !== 'object') return null;
      try { return JSON.stringify(obj, null, 2); } catch (e) { return null; }
    };

    // Thẻ thu gọn từng đoạn
    const segCard = (idx, seg) => {
      const content = seg.content || '';
      const len = content.length;
      const pct = totalLen ? (len / totalLen * 100).toFixed(1) : '0.0';
      const isEmpty = len === 0;
      // Đoạn trạng thái/đoạn ví dụ thử tô sáng JSON
      let bodyHtml;
      if (isEmpty) {
        bodyHtml = '<div class="we-prompt-seg-empty">Vòng này không kích hoạt</div>';
      } else {
        const pretty = tryPrettyJson(content);
        const shown = pretty !== null ? pretty : content;
        bodyHtml = '<pre class="we-prompt-seg-pre' + (pretty !== null ? ' we-prompt-seg-pre-json' : '') + '">' + u(shown) + '</pre>';
      }
      return '<div class="we-prompt-seg-card" data-we-seg-key="' + u(seg.key) + '">'
        + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
        + '<span class="we-prompt-seg-arrow">▶</span>'
        + '<span class="we-prompt-seg-label">' + u(seg.label) + '</span>'
        + '<span class="we-prompt-seg-meta">' + (isEmpty ? 'Trống' : (len + ' chữ · ' + pct + '%')) + '</span>'
        + '</div>'
        + '<div class="we-prompt-seg-body" style="display:none;">' + bodyHtml + '</div>'
        + '</div>';
    };

    // Thẻ phản hồi AI
    const rawResult = dbg.rawResult || '';
    const rawLen = rawResult.length;
    const parsedJson = tryPrettyJson(rawResult);
    const rawBodyHtml = rawLen
      ? (parsedJson !== null
          ? '<pre class="we-prompt-seg-pre we-prompt-seg-pre-json">' + u(parsedJson) + '</pre>'
          : '<pre class="we-prompt-seg-pre">' + u(rawResult) + '</pre>')
      : '<div class="we-prompt-seg-empty">Không có phản hồi API</div>';
    const rawCard = '<div class="we-prompt-seg-card we-prompt-seg-card-raw">'
      + '<div class="we-prompt-seg-head" data-we-seg-toggle>'
      + '<span class="we-prompt-seg-arrow">▶</span>'
      + '<span class="we-prompt-seg-label">Phản Hồi AI (Kết Quả Gốc Của API Diễn Biến)</span>'
      + '<span class="we-prompt-seg-meta">' + (rawLen ? (rawLen + ' chữ' + (parsedJson !== null ? ' · Đã phân tích JSON' : ' · Không phân tích được thành JSON')) : 'Trống') + '</span>'
      + '</div>'
      + '<div class="we-prompt-seg-body" style="display:none;">' + rawBodyHtml + '</div>'
      + '</div>';

    return ''
      + '<div class="we-prompt-debug">'
      + injectCard
      + '<div class="we-prompt-debug-summary">Prompt gửi đến API diễn biến tổng ' + totalLen + ' chữ, chia ' + segments.length + ' đoạn (hiển thị chỉ đọc, khớp từng byte với nội dung thực sự gửi đi)</div>'
      + barHtml
      + '<div class="we-prompt-seg-list">' + segments.map((seg, i) => segCard(i, seg)).join('') + '</div>'
      + rawCard
      + '<div style="display:flex;gap:6px;margin-top:8px;">'
      + '<button class="we-btn" id="we-export-prompt" style="flex:1;">Xuất Prompt Đầy Đủ</button>'
      + '<button class="we-btn" id="we-export-raw-result" style="flex:1;">Xuất Phản Hồi API</button>'
      + '</div>'
      + '</div>';
  }

  function renderSettingsForm() {
    const settings = window.WORLD_ENGINE_API
      ? window.WORLD_ENGINE_API.getSettings(true)
      : JSON.parse(window.WORLD_ENGINE_STORE.getItem('world_engine_settings') || '{}');
    const mode = (settings.evolveMode === 'manual' || settings.evolveMode === 'time') ? settings.evolveMode : 'auto';
    const everyX = Math.max(1, parseInt(settings.evolveEveryX) || 1);
    const readRounds = Math.min(everyX, Math.max(1, parseInt(settings.evolveReadRounds) || 1));
    const manualReadRounds = Math.max(1, parseInt(settings.manualReadRounds) || 1);
    // Giá trị hiện tại của chế độ theo thời gian
    const _stForTime = core.hasState() ? core.loadState() : null;
    const _cpForTime = core.restoreCheckpoint();
    const stTimeVal = (_stForTime && _stForTime.time != null) ? _stForTime.time : '';
    const cpTimeVal = (_cpForTime && _cpForTime.time != null) ? _cpForTime.time : '';
    const lastDayVal = (core.getLastStoryDay && core.getLastStoryDay() != null) ? core.getLastStoryDay() : '';
    const tv = (k, d) => (settings[k] != null && settings[k] !== '') ? settings[k] : d;
    const apiTemperature = Number.isFinite(Number(settings.temperature)) ? Math.max(0, Number(settings.temperature)) : 0.7;
    const apiMaxTokens = Math.max(1, parseInt(settings.maxTokens) || 65000);
    const apiTimeoutMs = Number.isFinite(Number(settings.apiTimeoutMs)) ? Number(settings.apiTimeoutMs) : 120000;
    const apiTimeoutSec = Math.max(0, Math.round(apiTimeoutMs / 1000));
    const injectMaxChars = Number.isFinite(Number(settings.injectMaxChars)) ? Math.max(0, Math.floor(Number(settings.injectMaxChars))) : 5000;

    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';

    const apiBody = `
      <div class="we-input-group">
        <label>Phương Thức Kết Nối</label>
        <select id="we-connection-mode" style="width:100%;">
          <option value="direct" ${settings.connectionMode !== 'proxy' ? 'selected' : ''}>Kết Nối Trực Tiếp (Mặc Định)</option>
          <option value="proxy" ${settings.connectionMode === 'proxy' ? 'selected' : ''}>Qua Proxy Của SillyTavern (Khắc Phục CORS)</option>
        </select>
        <div style="font-size:11px;color:#888;margin-top:3px;">Khi không kết nối được / console báo lỗi CORS, hãy chuyển sang "Qua Proxy Của SillyTavern" để server SillyTavern chuyển tiếp giúp.</div>
      </div>
      <div class="we-input-group">
        <label>URL API (Tương Thích OpenAI)</label>
        <input type="text" id="we-api-url" value="${u(settings.apiUrl||'')}" placeholder="https://api.openai.com/v1">
        <div style="font-size:11px;color:#888;margin-top:3px;">Chỉ cần điền đến cấp "tiền tố phiên bản", /chat/completions có thể thêm hoặc không (sẽ tự động bổ sung). Ví dụ: OpenAI <span style="color:#aaa;">https://api.openai.com/v1</span>; Volcano Ark <span style="color:#aaa;">https://ark.cn-beijing.volces.com/api/v3</span> (hoặc <span style="color:#aaa;">.../api/coding/v3</span>). Nhất định phải kèm tiền tố phiên bản của riêng bạn.</div>
      </div>
      <div class="we-input-group">
        <label>API Key</label>
        <input type="password" id="we-api-key" value="${u(settings.apiKey||'')}">
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>Mô Hình</label>
          <input type="text" id="we-model" value="${u(settings.model||'gpt-3.5-turbo')}" placeholder="Tên mô hình" style="width:100%;">
        </div>
        <button class="we-btn" id="we-fetch-models" style="white-space:nowrap;flex-shrink:0;">Lấy Danh Sách</button>
      </div>
      <div class="we-input-group">
        <select id="we-model-list" style="display:none;width:100%;margin-top:4px;">
          <option value="">-- Chọn Mô Hình --</option>
        </select>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">
          <label>Nhiệt Độ</label>
          <input type="number" id="we-temperature" min="0" step="0.1" value="${apiTemperature}" style="width:100%;">
        </div>
        <div style="flex:1;">
          <label>Token Đầu Ra Tối Đa</label>
          <input type="number" id="we-max-tokens" min="1" step="1" value="${apiMaxTokens}" style="width:100%;">
        </div>
      </div>
      <div class="we-input-group">
        <label>Thời Gian Chờ Yêu Cầu (Giây)</label>
        <input type="number" id="we-api-timeout-sec" min="0" step="1" value="${apiTimeoutSec}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Quá thời gian này mà vẫn chưa nhận được phản hồi đầy đủ sẽ tự động hủy và gỡ trạng thái "đang diễn biến". 0 = không giới hạn.</div>
      </div>`;

    const evolveBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-world-engine-enabled" ${settings.engineEnabled !== false ? 'checked' : ''}>
          Bật World Engine
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Sau khi tắt sẽ dừng diễn biến thế giới và chèn trạng thái thế giới, không ảnh hưởng đến Công Cụ Nhân Vật.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-first-layer-ai-opening" ${settings.firstLayerIsAiOpening !== false ? 'checked' : ''}>
          Tầng Đầu Là Lời Mở Đầu Của AI
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Mặc định chọn: điền lại hàng loạt bỏ qua tầng 0; bỏ chọn thì tầng 0 được điền lại như hội thoại thông thường.</div>
      </div>
      <div class="we-input-group">
        <label>Chế Độ Diễn Biến</label>
        <select id="we-evolve-mode" style="width:100%;">
          <option value="auto" ${mode === 'auto' ? 'selected' : ''}>Tự Động · Theo Vòng (Diễn Biến Mỗi X Vòng)</option>
          <option value="time" ${mode === 'time' ? 'selected' : ''}>Tự Động · Theo Thời Gian (Chênh Lệch Ngày Đủ N Ngày)</option>
          <option value="manual" ${mode === 'manual' ? 'selected' : ''}>Thủ Công (Chỉ Kích Hoạt Khi Bấm "Diễn Biến Thủ Công")</option>
        </select>
      </div>
      <div class="we-input-group" id="we-evolve-everyx-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>Diễn Biến Mỗi Bao Nhiêu Vòng (X)</label>
        <input type="number" id="we-evolve-everyx" min="1" step="1" value="${everyX}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Điền 1 = diễn biến mỗi vòng; điền 3 = diễn biến mỗi khi tiến 3 vòng. Roll lại không tính vào số vòng.</div>
      </div>
      <div class="we-input-group" id="we-evolve-readrounds-group" style="${mode === 'auto' ? '' : 'display:none;'}">
        <label>Mỗi Lần Diễn Biến Đọc Bao Nhiêu Vòng Hội Thoại Gần Nhất (a)</label>
        <input type="number" id="we-evolve-readrounds" min="1" max="${everyX}" step="1" value="${readRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Từ tầng hiện tại lùi về lấy a vòng "đầu vào người dùng + đầu ra AI" gửi cho diễn biến nền. Tối thiểu 1, tối đa không vượt quá X (số vòng mỗi lần diễn biến). Mặc định 1 = chỉ đọc vòng mới nhất.</div>
      </div>
      <div class="we-input-group" id="we-manual-readrounds-group" style="${mode === 'manual' ? '' : 'display:none;'}">
        <label>Diễn Biến Thủ Công Đọc Bao Nhiêu Vòng Hội Thoại Gần Nhất</label>
        <input type="number" id="we-manual-readrounds" min="1" step="1" value="${manualReadRounds}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Khi bấm "Diễn Biến Tiến" hoặc "Diễn Biến Lại", từ tầng hiện tại lùi về lấy số vòng này gồm "đầu vào người dùng + đầu ra AI" gửi cho diễn biến nền. Mặc định 1 = chỉ đọc vòng mới nhất.</div>
      </div>
      <div id="we-evolve-time-group" style="${mode === 'time' ? '' : 'display:none;'}">
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>Lấy N Chữ Trước Nội Dung</label><input type="number" id="we-time-front" min="0" step="1" value="${tv('evolveTimeFront', 0)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Lấy N Chữ Sau Nội Dung</label><input type="number" id="we-time-back" min="0" step="1" value="${tv('evolveTimeBack', 80)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>Biểu Thức Chính Quy Ngày Tháng (6 Ô: 1/3/5 Bắt Số → Nhóm Bắt, 2/4/6 Đơn Vị)</label>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <input type="text" id="we-time-re1" value="${u(tv('evolveTimeRe1',''))}" placeholder="Ô1 như \\d+ hoặc [一二三...]+" style="flex:1 1 30%;">
            <input type="text" id="we-time-re2" value="${u(tv('evolveTimeRe2',''))}" placeholder="Ô2 đơn vị như 年 (năm)" style="flex:1 1 18%;">
            <input type="text" id="we-time-re3" value="${u(tv('evolveTimeRe3',''))}" placeholder="Ô3" style="flex:1 1 30%;">
            <input type="text" id="we-time-re4" value="${u(tv('evolveTimeRe4',''))}" placeholder="Ô4 như 月 (tháng)" style="flex:1 1 18%;">
            <input type="text" id="we-time-re5" value="${u(tv('evolveTimeRe5',''))}" placeholder="Ô5" style="flex:1 1 30%;">
            <input type="text" id="we-time-re6" value="${u(tv('evolveTimeRe6',''))}" placeholder="Ô6 như 日/号 (ngày)" style="flex:1 1 18%;">
          </div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Để trống ô nào thì bỏ qua ô đó. Số Hán tự tự động quy đổi, nhiều ngày tháng thì lấy cái cuối cùng.</div>
        </div>
        <div class="we-input-group" style="display:flex;gap:6px;">
          <div style="flex:1;"><label>Hệ Số Nhân A (Ô1)</label><input type="number" id="we-time-mul1" step="any" value="${tv('evolveTimeMul1',360)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Hệ Số Nhân B (Ô3)</label><input type="number" id="we-time-mul2" step="any" value="${tv('evolveTimeMul2',30)}" style="width:100%;"></div>
          <div style="flex:1;"><label>Hệ Số Nhân C (Ô5)</label><input type="number" id="we-time-mul3" step="any" value="${tv('evolveTimeMul3',1)}" style="width:100%;"></div>
        </div>
        <div class="we-input-group">
          <label>Đủ N Ngày Thì Diễn Biến Một Lần</label>
          <input type="number" id="we-time-threshold" min="1" step="1" value="${tv('evolveTimeThreshold',1)}" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>Tối Đa Đọc X Vòng Hội Thoại Gần Nhất</label>
          <input type="number" id="we-time-maxrounds" min="1" step="1" value="${tv('evolveTimeMaxRounds',10)}" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Từ lần diễn biến trước đến nay trải qua bao nhiêu vòng thì đọc bấy nhiêu, vượt quá X thì chỉ đọc X vòng gần nhất, giới hạn để tránh prompt quá dài.</div>
        </div>
        <div class="we-input-group" style="border-top:1px solid var(--we-border,#3a3a3a);padding-top:8px;">
          <label>Thời Gian Trạng Thái Hiện Tại (Tổng Số Ngày)</label>
          <input type="number" id="we-time-state" step="any" value="${stTimeVal}" placeholder="state.time, để trống thì không ghi" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>Thời Gian Điểm Lưu Trữ (Tổng Số Ngày)</label>
          <input type="number" id="we-time-checkpoint" step="any" value="${cpTimeVal}" placeholder="checkpoint.time, để trống thì không ghi" style="width:100%;">
        </div>
        <div class="we-input-group">
          <label>Thời Gian Hội Thoại Vòng Này (Tổng Số Ngày)</label>
          <input type="number" id="we-time-current" step="any" value="${lastDayVal}" placeholder="Lưu là tự phán định có diễn biến hay không" style="width:100%;">
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Sau khi lưu: trừ đi thời gian mốc, đủ N ngày thì lập tức diễn biến. Ba ô thời gian chỉ ghi khi có giá trị, điền sai có thể tắt extension mở lại điền lại.</div>
        </div>
      </div>`;

    const filterBody = `
      <div class="we-input-group">
        <label>Mỗi dòng một biểu thức chính quy, nội dung khớp sẽ bị xóa trước khi gửi cho diễn biến nền</label>
        <div style="margin-bottom:8px;border:1px solid var(--we-border,#3a3a3a);border-radius:4px;padding:6px;">
          <div style="font-size:12px;color:var(--we-text2);margin-bottom:4px;">Chế độ đơn giản: chọn thẻ tự động tạo biểu thức chính quy xóa bỏ</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:4px;">
            <button class="we-btn" id="we-btn-filter-scan" type="button">🔍 Quét Thẻ Trong Cuộc Trò Chuyện Này</button>
            <input type="text" id="we-filter-add-input" placeholder="Thêm tên thẻ thủ công (ví dụ tucao)" style="flex:1;min-width:140px;">
            <button class="we-btn" id="we-btn-filter-add" type="button">+ Thêm</button>
          </div>
          <div id="we-filter-tags" style="display:flex;flex-wrap:wrap;gap:4px;min-height:4px;"></div>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Biểu thức chính quy tự động tạo không chắc luôn hiệu lực — thẻ có thuộc tính (như &lt;wlog time&gt;), có ~ (như &lt;konatan_planning~&gt;), lồng nhau hoặc thẻ đóng bất thường có thể khớp thất bại. Nếu không hiệu lực, hãy chỉnh sửa trực tiếp ô văn bản bên dưới. Thẻ chưa chọn sẽ không được lưu.</div>
        </div>
        <textarea id="we-filter-regex" rows="4" style="width:100%;resize:vertical;" placeholder="Mỗi dòng một mục; hỗ trợ pattern thuần hoặc dạng /pattern/flags. Ví dụ:\n<details>[\\s\\S]*?</details>\\n?\n/&lt;think&gt;[\\s\\S]*?&lt;\\/think&gt;/g">${u(tv('evolveFilterRegex',''))}</textarea>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px;">
          <button class="we-btn" id="we-btn-filter-test" type="button">▶ Kiểm Tra Biểu Thức Chính Quy</button>
        </div>
        <div class="we-hint" id="we-filter-status" style="margin:0 0 4px;white-space:pre-wrap;"></div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Mỗi dòng một mục; hỗ trợ pattern thuần (mặc định toàn cục g) hoặc dạng /pattern/flags (như /.../gi); dòng trống bị bỏ qua. Chỉ ảnh hưởng đến văn bản gửi cho diễn biến nền, không ảnh hưởng đến nội dung cuộc trò chuyện và việc bắt ngày tháng. Khi lưu sẽ tự động kiểm tra từng mục, nút kiểm tra có thể chạy thử trên đoạn hội thoại gần nhất.</div>
      </div>`;

    const injectBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-into-prompt" ${settings.injectIntoPrompt !== false ? 'checked' : ''}>
          Chèn Vào Nội Dung
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Sau khi tắt sẽ không chèn trạng thái hiện tại hoặc điểm lưu trữ vào nội dung cuộc trò chuyện.</div>
      </div>
      <div class="we-input-group">
        <label>Số Ký Tự Chèn Tối Đa Vào Nội Dung</label>
        <input type="number" id="we-inject-max-chars" min="0" step="100" value="${injectMaxChars}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Giới hạn độ dài trạng thái thế giới chèn vào prompt nội dung. Mặc định 5000; 0 = không giới hạn.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-inject-all-levels" ${settings.injectAllLevels === true ? 'checked' : ''}>
          Chèn Toàn Bộ Cấp Độ
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Khi bật, Lv1–Lv4 của chuỗi sự kiện và Tin Đồn đều được chèn vào nội dung; khi tắt, Tin Đồn chỉ chèn Lv3/4, chuỗi sự kiện chèn Lv3/4 cùng các sự kiện Lv1/2 đã bùng phát hoặc đã hoàn thành.</div>
      </div>`;

    const npcLinkSettings = window.NPC_ENGINE_SETTINGS?.getSettings?.(true) || {};
    const linkBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-npc-link-enabled" ${npcLinkSettings.npcLinkEnabled !== false ? 'checked' : ''}>
          Liên Kết Với Công Cụ Nhân Vật Sau Khi Diễn Biến Thế Giới Hoàn Tất
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Khi bật, xong vòng suy diễn thế giới là chạy tiếp phần trích xuất nhân vật và hoạt động ngầm, ngay trong cùng lượt. Tắt thì Công Cụ Nhân Vật ngừng cập nhật theo lượt, chỉ còn chạy khi bấm tay.</div>
        <button class="we-btn we-btn-primary" id="we-npc-link-now" type="button" style="width:100%;margin-top:8px;"><i class="fa-solid fa-link"></i> Cập Nhật Hồ Sơ Nhân Vật Ngay</button>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Đẩy tóm tắt thế giới hiện tại sang Công Cụ Nhân Vật mà không đợi lượt kế tiếp. Chạy lại ở cùng tầng sẽ ghi đè kết quả lần trước.</div>
      </div>`;

    const displayMode = settings.displayMode === 'expand' ? 'expand' : 'mask';
    const currentTheme = getStoredTheme();
    const themeOptions = WE_THEMES.map(theme =>
      `<option value="${theme.id}" ${theme.id === currentTheme ? 'selected' : ''}>${theme.name}</option>`
    ).join('');
    const displayBody = `
      <div class="we-input-group">
        <label>Bảng Màu Theme</label>
        <select id="we-theme-select" style="width:100%;">${themeOptions}</select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Áp dụng ngay lập tức và tự động ghi nhớ. Tối: Mặc Ngọc, Đêm Tàn, Biển Sâu, Dạ Hợp; Sáng: Vân Bạch, Anh Đào Sớm.</div>
      </div>
      <div class="we-input-group">
        <label>Chế Độ Hiển Thị Trang Chủ</label>
        <select id="we-display-mode" style="width:100%;">
          <option value="mask" ${displayMode === 'mask' ? 'selected' : ''}>Chế Độ Che (Trang Chủ + Vào Từng Trang Con)</option>
          <option value="expand" ${displayMode === 'expand' ? 'selected' : ''}>Chế Độ Mở Rộng (Trải Phẳng Toàn Bộ Nội Dung)</option>
        </select>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Ở chế độ mở rộng, dưới tóm tắt thế giới sẽ trải phẳng trực tiếp toàn bộ section, không cần vào trang con.</div>
      </div>`;

    // Bộ nhớ đệm và lưu trữ SillyTavern: lưu vào chat_metadata của cuộc trò chuyện hiện tại (lưu cùng file trò chuyện lên server SillyTavern, đồng bộ đa thiết bị).
    // Danh sách và trạng thái được điền động trong bindEvents → setupChatcacheSection().
    const chatcacheBody = `
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-sync-to-chat" ${settings.syncToChat === true ? 'checked' : ''}>
          Đồng Bộ Thời Gian Thực Đa Thiết Bị (Lưu Vào Cuộc Trò Chuyện Hiện Tại)
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Khi bật, trạng thái thế giới của cuộc trò chuyện này sẽ liên tục ghi vào file trò chuyện của SillyTavern và đồng bộ đa thiết bị theo đó; đổi thiết bị mở lại cùng cuộc trò chuyện là tiếp tục được tiến độ (khi xung đột, bản mới hơn thắng). <b>Sẽ không</b> đồng bộ các cài đặt toàn cục như API Key.</div>
      </div>
      <div class="we-input-group">
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
          <input type="checkbox" id="we-auto-backup" ${settings.autoBackup === true ? 'checked' : ''}>
          Tự Động Sao Lưu Luân Phiên (Lưu Một Bản Mỗi Khi Tiến Vòng, Giữ ${'3'} Bản Gần Nhất)
        </label>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Phòng ngừa xóa/sửa nhầm. Cả sao lưu tự động và bản lưu đặt tên đều được lưu trong cuộc trò chuyện này, có thể thấy trên mọi thiết bị.</div>
      </div>
      <div class="we-hint" id="we-chatcache-status" style="margin:4px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-chatcache-save">Tạo Bản Lưu Đặt Tên Mới</button>
        <button class="we-btn" id="we-chatcache-import">Nhập Bản Lưu</button>
        <input type="file" id="we-chatcache-import-file" accept=".json" style="display:none;">
      </div>
      <div class="we-chatcache-list" id="we-chatcache-snapshots"><div class="we-empty">Chưa có bản lưu</div></div>`;

    // Điền lại hàng loạt diễn biến thế giới: từ tầng AI đầu tiên chia đợt diễn biến đến tầng chỉ định (xóa sạch làm lại).
    const bf = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const apiAutoRetries = Math.max(0, parseInt(settings.apiAutoRetries) || 0);
    const backfillBody = `
      <div style="font-size:11px;color:var(--we-text3);margin-bottom:6px;">Từ tầng AI đầu tiên, <b>chia đợt</b> diễn biến lại trạng thái thế giới đến tầng chỉ định. Mỗi đợt chỉ gửi hội thoại của đợt tầng đó, nhưng trạng thái thế giới tích lũy theo từng đợt, giữ mạch liên tục. <b>Sẽ xóa sạch trạng thái thế giới hiện tại và làm lại từ đầu</b> (tự động lưu một bản sao lưu trước khi bắt đầu).</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Số Tầng AI Mỗi Đợt</label>
          <input type="number" id="we-backfill-batch" min="1" step="1" value="${bf('backfillBatchSize', 5)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Tầng Kết Thúc (0 = Tất Cả)</label>
          <input type="number" id="we-backfill-end" min="0" step="1" value="${bf('backfillEndLayer', 0)}"></div>
        <div class="we-input-group" style="flex:1;min-width:90px;margin-bottom:0;"><label>Số Lần Thử Lại Mỗi Đợt Khi Lỗi</label>
          <input type="number" id="we-backfill-retries" min="0" step="1" value="${bf('backfillRetries', 2)}"></div>
      </div>
      <div class="we-hint" id="we-backfill-status" style="margin:6px 0;"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0;">
        <button class="we-btn we-btn-primary" id="we-backfill-start">▶ Bắt Đầu Điền Lại Diễn Biến Thế Giới</button>
        <button class="we-btn" id="we-backfill-stop">■ Dừng</button>
      </div>`;

    // [FIX] Chia tab: trả về từ điển các đoạn đã phân theo section, để renderSettingsView xếp vào từng tab.
    //   Mỗi lời gọi sec(...), nội dung body, id trường giữ nguyên như cũ, chỉ là không còn ghép trực tiếp thành một chuỗi.
    const mech = (k, d) => { const v = settings[k]; return (v === undefined || v === null || v === '') ? d : v; };
    const numInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1;min-width:112px;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const compactNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="flex:1 1 0;min-width:0;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const wideNumInput = (id, key, label, d, min, step) =>
      '<div class="we-input-group" style="width:100%;margin-bottom:0;"><label>' + label + '</label>'
      + '<input type="number" id="' + id + '" min="' + min + '" step="' + step + '" value="' + mech(key, d) + '"></div>';
    const mechanicsResetButton = (group) =>
      '<div style="display:flex;justify-content:flex-end;margin-bottom:8px;">'
      + '<button class="we-btn" type="button" data-we-mechanics-reset="' + group + '"><i class="fa-solid fa-arrow-rotate-left"></i> Khôi Phục Mặc Định</button>'
      + '</div>';
    const regionalBody = `
      ${mechanicsResetButton('regional')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Biến cố khu vực là xúc xắc thuần cục bộ: trước tiên cục bộ phán định có xảy ra hay không, rồi giao loại sự kiện và ràng buộc cho mô hình diễn biến viết thành biến chuyển thế giới.
        Xác suất càng cao, các biến động nền như thiên tai xa, sự cố an ninh, giao thông gián đoạn càng thường xuyên.
      </div>
      <div class="we-input-group">
        <label>Tham Số Biến Cố Khu Vực</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-ri-chance', 'localRegionalIncidentChancePercent', 'Xác Suất Kích Hoạt %', 3, 0, '0.1')}
          ${numInput('we-local-ri-duration', 'localRegionalIncidentDuration', 'Số Vòng Kéo Dài', 5, 1, '1')}
          ${numInput('we-local-ri-cooldown', 'localRegionalIncidentCooldown', 'Hồi Sau Khi Tan Biến', 5, 1, '1')}
        </div>
      </div>`;

    const distantBody = `
      ${mechanicsResetButton('distant')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Tạo một chuỗi sự kiện xa hoặc Tin Đồn (Lv2/Lv3) không liên quan trực tiếp đến nhân vật chính và sổ sách hiện có.<br>
        Ngưỡng sổ sách: tích lũy tối thiểu bao nhiêu vòng sổ sách mới kích hoạt; xác suất kích hoạt: xác suất trúng mỗi vòng có thể kích hoạt; hồi sau khi thành công: số vòng tạm dừng đổ xúc xắc sau khi tạo thành công; tỷ lệ chuỗi sự kiện: xác suất tạo chuỗi sự kiện khi trúng, phần còn lại tạo Tin Đồn.
      </div>
      <div class="we-input-group">
        <label>Tham Số Sự Kiện Ngẫu Nhiên Xa</label>
        <div style="display:flex;gap:6px;flex-wrap:nowrap;">
          ${compactNumInput('we-local-distant-threshold', 'localDistantEventLedgerThreshold', 'Ngưỡng Sổ Sách', 10, 1, '1')}
          ${compactNumInput('we-local-distant-chance', 'localDistantEventChancePercent', 'Xác Suất Kích Hoạt %', 20, 0, '0.1')}
          ${compactNumInput('we-local-distant-cooldown', 'localDistantEventCooldown', 'Hồi Sau Khi Thành Công', 5, 1, '1')}
          ${compactNumInput('we-local-distant-event-percent', 'localDistantEventEventPercent', 'Tỷ Lệ Chuỗi Sự Kiện %', 50, 0, '0.1')}
        </div>
      </div>`;

    const nearBody = `
      ${mechanicsResetButton('near')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.6;margin-bottom:10px;">
        Tạo một chuỗi sự kiện cận hoặc Tin Đồn (Lv2/Lv3) có quan hệ nhân quả rõ ràng với hội thoại hiện tại, nhân vật chính hoặc khu vực đang ở.<br>
        Xác suất kích hoạt: xác suất trúng mỗi vòng có thể kích hoạt; hồi sau khi thành công: số vòng tạm dừng đổ xúc xắc sau khi tạo thành công; tỷ lệ chuỗi sự kiện: xác suất tạo chuỗi sự kiện khi trúng, phần còn lại tạo Tin Đồn.
      </div>
      <div class="we-input-group">
        <label>Tham Số Sự Kiện Ngẫu Nhiên Cận</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-near-chance', 'localNearEventChancePercent', 'Xác Suất Kích Hoạt %', 20, 0, '0.1')}
          ${numInput('we-local-near-cooldown', 'localNearEventCooldown', 'Hồi Sau Khi Thành Công', 5, 1, '1')}
          ${numInput('we-local-near-event-percent', 'localNearEventEventPercent', 'Tỷ Lệ Chuỗi Sự Kiện %', 50, 0, '0.1')}
        </div>
      </div>`;

    const retryBody = `
      <div class="we-input-group">
        <label>Số Lần Tự Động Thử Lại Khi API Lỗi (X)</label>
        <input type="number" id="we-api-auto-retries" min="0" step="1" value="${apiAutoRetries}" style="width:100%;">
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Chỉ thử lại khi gặp lỗi kết nối, HTTP, hết thời gian chờ, trả về rỗng hoặc JSON không thể sửa; nội dung vượt quá số chữ hoặc số mục của Prompt không tính là lỗi.</div>
      </div>`;

    const diceBody = `
      ${mechanicsResetButton('dice')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        Mỗi chuỗi sự kiện mỗi vòng đổ 1d100. Đặt số ô giai đoạn r = số ô hiện tại / 9.<br>
        Giá trị mục tiêu T = giá trị cơ bản giai đoạn - 200 × r × (1 - r) + hiệu chỉnh Lv - hiệu chỉnh tiến triển toàn cục.<br>
        Nếu giá trị xúc xắc &gt; T: tiến một ô; nếu giá trị xúc xắc &lt; T × hệ số thất bại: lùi một ô; ngược lại giữ nguyên.<br>
        Hiệu chỉnh Lv của Xung Đột = -(Lv - 1) × 10, Lv càng cao càng dễ bùng phát. Hiệu chỉnh Lv của Tiến Triển = +(Lv - 1) × 10, Lv càng cao càng khó hoàn thành.
      </div>
      <div class="we-input-group">
        <label>Tham Số Công Thức Xúc Xắc Sự Kiện</label>
        <div style="margin-bottom:6px;">
          ${wideNumInput('we-local-dice-mod', 'localEventDiceModifier', 'Hiệu Chỉnh Tiến Triển Toàn Cục', 0, -100, '1')}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-setback-ratio', 'localEventSetbackRatioPercent', 'Hệ Số Thất Bại %', 40, 0, '1')}
          ${numInput('we-local-progress-fail-base', 'localProgressFailBase', 'Bảo Hiểm Tiến Triển A', 2, 0, '1')}
          ${numInput('we-local-conflict-fail-base', 'localConflictFailBase', 'Bảo Hiểm Xung Đột B', 6, 1, '1')}
        </div>
        <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">
          Công thức bảo hiểm: giới hạn thất bại liên tiếp của Tiến Triển = A + Lv; giới hạn thất bại liên tiếp của Xung Đột = max(1, B - Lv). Đạt giới hạn thì buộc tiến một ô.
        </div>
      </div>`;

    const winddecayBody = `
      ${mechanicsResetButton('winddecay')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        Khi Tin Đồn không được cập nhật cùng ID trong vòng này, số vòng im lặng +1. Số vòng im lặng ≤ grace thì không kiểm tra tan biến.<br>
        Sau khi vượt grace: n = số vòng im lặng - grace - 1.<br>
        Tỷ lệ tan biến P = clamp(base + linear × n + quadratic × n² - (Lv - 1) × 10, 5, 95).<br>
        Đổ 1d100, nếu giá trị xúc xắc ≤ P thì Tin Đồn đó tan biến. Lv càng cao càng khó tan biến.
      </div>
      <div class="we-input-group">
        <label>Tham Số Công Thức Tan Biến Của Tin Đồn</label>
        ${['Rumor:Lời Đồn:25:1:5:3','Sentiment:Dư Luận:8:5:2:1','Report:Tin Điện:20:2:4:2','Announcement:Thông Báo:10:4:3:1'].map(row => {
          const p = row.split(':');
          return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">'
            + '<div style="width:42px;color:var(--we-text2);font-size:12px;align-self:center;">' + p[1] + '</div>'
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-base', 'localWind' + p[0] + 'Base', 'base', p[2], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-grace', 'localWind' + p[0] + 'Grace', 'grace', p[3], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-linear', 'localWind' + p[0] + 'Linear', 'linear', p[4], 0, '1')
            + numInput('we-local-wind-' + p[0].toLowerCase() + '-quadratic', 'localWind' + p[0] + 'Quadratic', 'quadratic', p[5], 0, '1')
            + '</div>';
        }).join('')}
      </div>`;

    const retentionBody = `
      ${mechanicsResetButton('retention')}
      <div style="font-size:12px;color:var(--we-text2);line-height:1.65;margin-bottom:10px;">
        Ở đây kiểm soát "mọi thứ lưu lại trên bảng bao lâu" và "mỗi loại lưu tối đa bao nhiêu".<br>
        Số vòng giữ lại của sự kiện kết thúc tích cực (Đã Bùng Phát / Đã Hoàn Thành) = giữ cơ bản + Lv × giữ thêm mỗi cấp.<br>
        Sự kiện kết thúc tiêu cực (Đã Tan Biến / Đã Thất Bại) bị dọn ở vòng kế tiếp; chuỗi ảnh hưởng, kẻ thù đã kết thúc, sổ sách lần lượt bị dọn theo số vòng lưu riêng của từng loại.
      </div>
      <div class="we-input-group">
        <label>Số Vòng Giữ Lại</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-terminal-base', 'localTerminalBaseKeepRounds', 'Giữ Cơ Bản Khi Kết Thúc', 2, 0, '1')}
          ${numInput('we-local-terminal-level', 'localTerminalLevelKeepRounds', 'Giữ Thêm Mỗi Cấp', 2, 0, '1')}
          ${numInput('we-local-influence-keep', 'localInfluenceKeepRounds', 'Giữ Chuỗi Ảnh Hưởng', 8, 1, '1')}
          ${numInput('we-local-enemy-keep', 'localEnemyTerminalKeepRounds', 'Giữ Kẻ Thù Đã Kết Thúc', 20, 1, '1')}
          ${numInput('we-local-ledger-keep', 'localLedgerKeepRounds', 'Số Vòng Lưu Sổ Sách', 20, 1, '1')}
        </div>
      </div>
      <div class="we-input-group">
        <label>Giới Hạn Dung Lượng</label>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${numInput('we-local-cap-events', 'localCapEvents', 'Giới Hạn Sự Kiện', 16, 1, '1')}
          ${numInput('we-local-cap-factions', 'localCapFactions', 'Giới Hạn Thế Lực', 15, 1, '1')}
          ${numInput('we-local-cap-winds', 'localCapWinds', 'Giới Hạn Tin Đồn', 12, 1, '1')}
          ${numInput('we-local-cap-trends', 'localCapWorldTrends', 'Giới Hạn Đại Thế', 4, 1, '1')}
          ${numInput('we-local-cap-influence', 'localCapInfluence', 'Giới Hạn Chuỗi Ảnh Hưởng', 12, 1, '1')}
          ${numInput('we-local-cap-enemies', 'localCapEnemies', 'Giới Hạn Kẻ Thù', 8, 1, '1')}
          ${numInput('we-local-cap-econ', 'localCapEconomySignals', 'Giới Hạn Tín Hiệu Kinh Tế', 8, 1, '1')}
          ${numInput('we-local-cap-blackbox', 'localCapBlackbox', 'Giới Hạn Tổng Hộp Đen', 12, 1, '1')}
        </div>
      </div>`;

    return {
      api: sec('set-api', 'Cấu Hình API', apiBody),
      evolve: sec('set-evolve', 'Chế Độ Diễn Biến', evolveBody),
      backfill: sec('set-backfill', 'Điền Lại Diễn Biến Thế Giới Hàng Loạt', backfillBody),
      retry: sec('set-api-retry', 'Tự Động Thử Lại API', retryBody),
      mechanics: sec('set-regional', 'Biến Cố Khu Vực', regionalBody)
        + sec('set-near', 'Sự Kiện Ngẫu Nhiên Cận', nearBody)
        + sec('set-distant', 'Sự Kiện Ngẫu Nhiên Xa', distantBody)
        + sec('set-dice', 'Xúc Xắc Sự Kiện', diceBody)
        + sec('set-winddecay', 'Tan Biến Tin Đồn', winddecayBody)
        + sec('set-retention', 'Giới Hạn Giữ Lại', retentionBody),
      filter: sec('set-filter', 'Bộ Lọc Đầu Vào/Đầu Ra', filterBody),
      display: sec('set-display', 'Hiển Thị Giao Diện', displayBody),
      chatcache: sec('set-chatcache', 'Bộ Nhớ Đệm Và Lưu Trữ SillyTavern', chatcacheBody),
      inject: sec('set-inject', 'Chèn Vào Nội Dung', injectBody),
      link: sec('set-world-npc-link', 'Thế Giới → Nhân Vật', linkBody)
    };
  }

  function renderSettingsAfterCheckpoint(options) {
    const npcScope = options?.scope === 'npc';
    const settings = npcScope
      ? (window.NPC_ENGINE_SETTINGS?.getSettings() || {})
      : ((window.WORLD_ENGINE_API && window.WORLD_ENGINE_API.getSettings) ? window.WORLD_ENGINE_API.getSettings() : {});
    const sec = (id, title, body) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>' +
      sectionBody(id, body) + '</div>';
    const worldbookBody = `
      <div class="we-worldbook-settings">
        <div class="we-input-group">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="we-worldbook-trigger" ${settings.worldbookTrigger === true ? 'checked' : ''}>
            Bật Kích Hoạt Đèn Xanh-Lam (Theo Worldbook Của SillyTavern)
          </label>
          <div style="font-size:11px;color:var(--we-text3);margin-top:3px;">Khi tắt: toàn bộ mục đã chọn đều Chèn Diễn Biến (hiện trạng). Khi bật: mục 🔵 thường trực luôn được chèn, mục 🟢 từ khóa chỉ chèn khi hội thoại gần đây khớp từ khóa của nó; mỗi mục có thể ghi đè riêng. Việc quét từ khóa do extension này tự thực hiện, tách biệt với SillyTavern.</div>
        </div>
        <div class="we-worldbook-header">
          <div><div class="we-worldbook-summary" id="we-worldbook-summary">Đang đọc Worldbook của cuộc trò chuyện hiện tại...</div></div>
          <button class="we-icon-btn" id="we-worldbook-reload" title="Đọc lại Worldbook của cuộc trò chuyện hiện tại"><i class="fa-solid fa-rotate"></i></button>
        </div>
        <div class="we-worldbook-toolbar">
          <button class="we-btn" id="we-worldbook-select-all">Chọn Tất Cả</button>
          <button class="we-btn" id="we-worldbook-clear-all">Bỏ Chọn Tất Cả</button>
          <button class="we-btn we-btn-primary" id="we-worldbook-save">Lưu Lựa Chọn Worldbook</button>
        </div>
        <div class="we-worldbook-list" id="we-worldbook-list"><div class="we-empty">Đang đọc...</div></div>
      </div>`;
    const dataBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-export-data">Xuất JSON</button>
        <button class="we-btn" id="we-import-data">Nhập JSON</button>
        <input type="file" id="we-import-file" accept=".json" style="display:none;">
      </div>`;
    const toneBody = `
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="we-btn" id="we-tone-import">Nhập</button>
        <button class="we-btn" id="we-tone-export">Xuất</button>
        <button class="we-btn" id="we-tone-clear">Xóa</button>
        <input type="file" id="we-tone-file" accept=".txt" style="display:none;">
      </div>
      <div class="we-hint" id="we-tone-status" style="margin-top:6px;"></div>`;
    // [FIX] Chia tab: cũng trả về từ điển các đoạn
    return {
      worldbook: sec('set-worldbook', npcScope ? 'Worldbook Diễn Biến Nhân Vật' : 'Worldbook Diễn Biến Nền', worldbookBody),
      data: sec('set-data', 'Nhập/Xuất Dữ Liệu', dataBody),
      tone: sec('set-tone', 'Prompt Bổ Sung', toneBody)
    };
  }

  function bindEvents(state) {
    const themeSelect = document.getElementById('we-theme-select');
    if (themeSelect) themeSelect.onchange = () => setTheme(themeSelect.value);
    const npcThemeSelect = document.getElementById('we-npc-theme-select');
    if (npcThemeSelect) npcThemeSelect.onchange = () => setNpcTheme(npcThemeSelect.value);

    document.querySelectorAll('[data-we-mechanics-reset]').forEach(button => {
      button.onclick = () => {
        const group = button.dataset.weMechanicsReset;
        const defaults = MECHANICS_DEFAULT_FIELDS[group];
        if (!defaults) return;
        for (const [id, value] of Object.entries(defaults)) {
          const input = document.getElementById(id);
          if (input) value === null ? input.value = '' : input.value = String(value);
        }
        showToast('Đã khôi phục giá trị mặc định của khu vực này, có hiệu lực sau khi bấm "Lưu Cài Đặt"');
      };
    });

    document.querySelectorAll('.we-event-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event || !confirm(`Xóa sự kiện "${event.name}"?`)) return;
        scopedState.events.splice(index, 1);
        editingEvent = null;
        saveScopedState(scope, scopedState);
        showToast('Đã xóa sự kiện');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.eventScope;
        const index = Number(button.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;
        const copy = JSON.parse(JSON.stringify(event));
        delete copy.id;
        delete copy.evolveResult;
        core.ensureEventFields(copy);
        core.assignEntityId(scopedState.events, copy, core.ENTITY_ID_PREFIXES.events);
        scopedState.events.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Đã sao chép sự kiện vào cuối danh sách');
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit').forEach(button => {
      button.onclick = () => {
        editingEvent = {
          scope: button.dataset.eventScope,
          index: Number(button.dataset.eventIndex)
        };
        refresh();
      };
    });

    document.querySelectorAll('.we-event-editor-close').forEach(button => {
      button.onclick = () => {
        editingEvent = null;
        refresh();
      };
    });

    document.querySelectorAll('.we-event-edit-type').forEach(select => {
      select.onchange = () => {
        const stageSelect = select.closest('.we-event-editor').querySelector('.we-event-edit-stage');
        const stages = select.value === 'progress'
          ? ['Chuẩn Bị', 'Thực Hiện', 'Then Chốt', 'Đã Hoàn Thành', 'Đã Thất Bại']
          : ['Manh Nha', 'Âm Ỉ', 'Cận Kề', 'Đã Bùng Phát', 'Đã Tan Biến'];
        stageSelect.innerHTML = stages.map(stage => `<option value="${stage}">${stage}</option>`).join('');
      };
    });

    document.querySelectorAll('.we-event-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.eventScope;
        const index = Number(editor.dataset.eventIndex);
        const scopedState = loadScopedState(scope);
        const event = scopedState?.events?.[index];
        if (!event) return;

        const name = editor.querySelector('.we-event-edit-name').value.trim();
        if (!name) {
          showToast('Tên sự kiện không được để trống', true);
          return;
        }
        event.name = name;
        event.level = Number(editor.querySelector('.we-event-edit-level').value);
        event.type = editor.querySelector('.we-event-edit-type').value;
        event.stage = editor.querySelector('.we-event-edit-stage').value;
        event.stageRound = Math.min(9, Math.max(1, Number(editor.querySelector('.we-event-edit-round').value) || 1));
        event.desc = editor.querySelector('.we-event-edit-desc').value.trim();
        event.consecutiveFails = 0;
        delete event.evolveResult;

        // Số vòng còn lại → suy ngược _terminalSince (chỉ áp dụng khi kết thúc tích cực)
        const POSITIVE_TERMINALS = ['Đã Bùng Phát', 'Đã Hoàn Thành'];
        if (POSITIVE_TERMINALS.includes(event.stage)) {
          const K = localTerminalKeepRounds(event);
          const curRound = scopedState.round || 0;
          let left = Number(editor.querySelector('.we-event-edit-left').value);
          left = Number.isFinite(left) && left >= 1 ? Math.min(K, left) : K;
          event._terminalSince = curRound - K + left - 1;
        } else {
          delete event._terminalSince;
        }
        core.ensureEventFields(event);
        saveScopedState(scope, scopedState);
        editingEvent = null;
        showToast('Đã lưu chỉnh sửa sự kiện');
        refresh();
      };
    });

    // Sự kiện trình soạn thế lực
    document.querySelectorAll('.we-faction-edit').forEach(button => {
      button.onclick = () => {
        editingFaction = { scope: button.dataset.factionScope, index: Number(button.dataset.factionIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-editor-close').forEach(button => {
      button.onclick = () => { editingFaction = null; refresh(); };
    });
    document.querySelectorAll('.we-faction-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.factionScope;
        const index = Number(editor.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const name = editor.querySelector('.we-faction-edit-name').value.trim();
        if (!name) { showToast('Tên thế lực không được để trống', true); return; }
        faction.name = name;
        faction.status = editor.querySelector('.we-faction-edit-status').value;
        faction.relation = editor.querySelector('.we-faction-edit-relation').value;
        faction.scope = editor.querySelector('.we-faction-edit-scope').value.trim();
        faction.currentGoal = editor.querySelector('.we-faction-edit-goal').value.trim();
        faction.core_person = editor.querySelector('.we-faction-edit-core').value.trim();
        const pillars = [];
        editor.querySelectorAll('.we-faction-edit-pillar').forEach(input => {
          const v = input.value.trim().slice(0, 24);
          if (v) pillars.push(v);
        });
        faction.powerPillars = pillars;
        saveScopedState(scope, state);
        editingFaction = null;
        showToast('Đã lưu chỉnh sửa thế lực');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction || !confirm(`Xóa thế lực "${faction.name}"?`)) return;
        state.factions.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Đã xóa thế lực');
        refresh();
      };
    });
    document.querySelectorAll('.we-faction-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.factionScope;
        const index = Number(button.dataset.factionIndex);
        const state = loadScopedState(scope);
        const faction = state.factions?.[index];
        if (!faction) return;
        const copy = JSON.parse(JSON.stringify(faction));
        delete copy.id;
        core.assignEntityId(state.factions, copy, core.ENTITY_ID_PREFIXES.factions);
        state.factions.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('Đã sao chép thế lực');
        refresh();
      };
    });

    // Sự kiện trình soạn Tin Đồn
    document.querySelectorAll('.we-wind-edit').forEach(button => {
      button.onclick = () => {
        editingWind = { scope: button.dataset.windScope, index: Number(button.dataset.windIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-editor-close').forEach(button => {
      button.onclick = () => { editingWind = null; refresh(); };
    });
    document.querySelectorAll('.we-wind-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.windScope;
        const index = Number(editor.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const topic = editor.querySelector('.we-wind-edit-topic').value.trim();
        if (!topic) { showToast('Chủ đề Tin Đồn không được để trống', true); return; }
        wind.topic = topic;
        wind.type = editor.querySelector('.we-wind-edit-type').value;
        wind.level = Number(editor.querySelector('.we-wind-edit-level').value);
        wind.scope = editor.querySelector('.we-wind-edit-scope').value.trim();
        wind.source = editor.querySelector('.we-wind-edit-source').value.trim();
        wind.content = editor.querySelector('.we-wind-edit-content').value.trim();
        wind.quietRounds = 0;
        saveScopedState(scope, scopedState);
        editingWind = null;
        showToast('Đã lưu chỉnh sửa Tin Đồn');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind || !confirm(`Xóa Tin Đồn "${wind.topic}"?`)) return;
        scopedState.winds.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('Đã xóa Tin Đồn');
        refresh();
      };
    });
    document.querySelectorAll('.we-wind-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.windScope;
        const index = Number(button.dataset.windIndex);
        const scopedState = loadScopedState(scope);
        const wind = scopedState.winds?.[index];
        if (!wind) return;
        const copy = JSON.parse(JSON.stringify(wind));
        delete copy.id;
        copy.quietRounds = 0;
        core.assignEntityId(scopedState.winds, copy, core.ENTITY_ID_PREFIXES.winds);
        scopedState.winds.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Đã sao chép Tin Đồn');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn đại thế thiên hạ =====
    document.querySelectorAll('.we-trend-edit').forEach(button => {
      button.onclick = () => {
        editingTrend = { scope: button.dataset.trendScope, index: Number(button.dataset.trendIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-editor-close').forEach(button => {
      button.onclick = () => { editingTrend = null; refresh(); };
    });
    document.querySelectorAll('.we-trend-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.trendScope;
        const index = Number(editor.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const name = editor.querySelector('.we-trend-edit-name').value.trim();
        if (!name) { showToast('Tên đại thế không được để trống', true); return; }
        trend.name = name;
        trend.status = editor.querySelector('.we-trend-edit-status').value;
        trend.scope = editor.querySelector('.we-trend-edit-scope').value.trim();
        trend.source = editor.querySelector('.we-trend-edit-source').value.trim();
        trend.description = editor.querySelector('.we-trend-edit-desc').value.trim();
        saveScopedState(scope, scopedState);
        editingTrend = null;
        showToast('Đã lưu chỉnh sửa đại thế thiên hạ');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend || !confirm(`Xóa đại thế "${trend.name}"?`)) return;
        scopedState.worldTrends.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('Đã xóa đại thế thiên hạ');
        refresh();
      };
    });
    document.querySelectorAll('.we-trend-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.trendScope;
        const index = Number(button.dataset.trendIndex);
        const scopedState = loadScopedState(scope);
        const trend = scopedState?.worldTrends?.[index];
        if (!trend) return;
        const copy = JSON.parse(JSON.stringify(trend));
        delete copy.id;
        core.assignEntityId(scopedState.worldTrends, copy, core.ENTITY_ID_PREFIXES.worldTrends);
        scopedState.worldTrends.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Đã sao chép đại thế thiên hạ');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn kẻ thù =====
    document.querySelectorAll('.we-enemy-edit').forEach(button => {
      button.onclick = () => {
        editingEnemy = { scope: button.dataset.enemyScope, index: Number(button.dataset.enemyIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-editor-close').forEach(button => {
      button.onclick = () => { editingEnemy = null; refresh(); };
    });
    document.querySelectorAll('.we-enemy-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.enemyScope;
        const index = Number(editor.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const name = editor.querySelector('.we-enemy-edit-name').value.trim();
        if (!name) { showToast('Tên kẻ thù không được để trống', true); return; }
        enemy.name = name;
        enemy.type = editor.querySelector('.we-enemy-edit-type').value;
        enemy.status = editor.querySelector('.we-enemy-edit-status').value;
        enemy.reason = editor.querySelector('.we-enemy-edit-reason').value.trim();
        saveScopedState(scope, state);
        editingEnemy = null;
        showToast('Đã lưu chỉnh sửa kẻ thù');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy || !confirm(`Xóa kẻ thù "${enemy.name}"?`)) return;
        state.enemies.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Đã xóa kẻ thù');
        refresh();
      };
    });
    document.querySelectorAll('.we-enemy-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.enemyScope;
        const index = Number(button.dataset.enemyIndex);
        const state = loadScopedState(scope);
        const enemy = state.enemies?.[index];
        if (!enemy) return;
        const copy = JSON.parse(JSON.stringify(enemy));
        delete copy.id;
        core.assignEntityId(state.enemies, copy, core.ENTITY_ID_PREFIXES.enemies);
        state.enemies.splice(index + 1, 0, copy);
        saveScopedState(scope, state);
        showToast('Đã sao chép kẻ thù');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn chuỗi ảnh hưởng =====
    document.querySelectorAll('.we-influence-edit').forEach(button => {
      button.onclick = () => {
        editingInfluence = { scope: button.dataset.influenceScope, index: Number(button.dataset.influenceIndex) };
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-editor-close').forEach(button => {
      button.onclick = () => { editingInfluence = null; refresh(); };
    });
    document.querySelectorAll('.we-influence-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.influenceScope;
        const index = Number(editor.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const trigger = editor.querySelector('.we-influence-edit-trigger').value.trim();
        const impact = editor.querySelector('.we-influence-edit-impact').value.trim();
        if (!trigger || !impact) { showToast('Nguồn kích hoạt và ảnh hưởng trực tiếp không được để trống', true); return; }
        inf.trigger = trigger;
        inf.impact = impact;
        inf.fallout = editor.querySelector('.we-influence-edit-fallout').value.trim();
        saveScopedState(scope, scopedState);
        editingInfluence = null;
        showToast('Đã lưu chỉnh sửa chuỗi ảnh hưởng');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf || !confirm(`Xóa chuỗi ảnh hưởng "${inf.trigger}"?`)) return;
        scopedState.influenceChain.splice(index, 1);
        saveScopedState(scope, scopedState);
        showToast('Đã xóa chuỗi ảnh hưởng');
        refresh();
      };
    });
    document.querySelectorAll('.we-influence-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.influenceScope;
        const index = Number(button.dataset.influenceIndex);
        const scopedState = loadScopedState(scope);
        const inf = scopedState.influenceChain?.[index];
        if (!inf) return;
        const copy = JSON.parse(JSON.stringify(inf));
        copy._createdRound = Number(scopedState.round) || 0;
        scopedState.influenceChain.push(copy);
        saveScopedState(scope, scopedState);
        showToast('Đã sao chép chuỗi ảnh hưởng');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn biến cố khu vực =====
    document.querySelectorAll('.we-ri-edit').forEach(button => {
      button.onclick = () => {
        editingRI = { active: true, scope: button.dataset.riScope };
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-editor-close').forEach(button => {
      button.onclick = () => { editingRI = null; refresh(); };
    });
    document.querySelectorAll('.we-ri-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-event-editor');
        const scope = editor.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) {
          state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', duration: 0, cooldown: 0, _retry: false, _retryType: '' };
        }
        const ri = state.regionalIncident;
        ri.active = editor.querySelector('.we-ri-edit-active').value === 'true';
        ri.title = editor.querySelector('.we-ri-edit-title').value.trim();
        ri.type = editor.querySelector('.we-ri-edit-type').value;
        ri.scope = editor.querySelector('.we-ri-edit-scope').value.trim();
        ri.duration = Math.max(0, Number(editor.querySelector('.we-ri-edit-duration').value) || 0);
        ri.cooldown = Math.max(0, Number(editor.querySelector('.we-ri-edit-cooldown').value) || 0);
        ri.impact = editor.querySelector('.we-ri-edit-impact').value.trim();
        saveScopedState(scope, state);
        editingRI = null;
        showToast('Đã lưu chỉnh sửa biến cố khu vực');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-delete').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        if (!confirm('Xóa biến cố khu vực?')) return;
        state.regionalIncident = { active: false, title: '', type: '', scope: '', impact: '', cooldown: state.regionalIncident.cooldown || 0, _retry: false, _retryType: '' };
        saveScopedState(scope, state);
        showToast('Đã xóa biến cố khu vực');
        refresh();
      };
    });
    document.querySelectorAll('.we-ri-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.riScope;
        const state = loadScopedState(scope);
        if (!state.regionalIncident) return;
        const copy = JSON.parse(JSON.stringify(state.regionalIncident));
        copy._retry = false;
        copy._retryType = '';
        copy.cooldown = 0;
        state.regionalIncident = copy;
        saveScopedState(scope, state);
        showToast('Đã sao chép biến cố khu vực (đã đặt lại thời gian hồi)');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn thống nhất bí mật (hành vi/tài sản bí mật) =====
    const SECRET_ARR = { action: 'secretActions', asset: 'secretAssets' };

    document.querySelectorAll('.we-secret-edit').forEach(button => {
      button.onclick = () => {
        const list = button.dataset.secretList;
        editingSecret = { scope: button.dataset.secretScope, list, index: Number(button.dataset.secretIndex), view: list };
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-editor-close').forEach(button => {
      button.onclick = () => { editingSecret = null; refresh(); };
    });
    // Dropdown loại: chỉ chuyển đổi biểu mẫu hiển thị (view), không đụng dữ liệu, không lưu
    document.querySelectorAll('.we-secret-type').forEach(select => {
      select.onchange = () => {
        if (editingSecret) { editingSecret.view = select.value; refresh(); }
      };
    });
    document.querySelectorAll('.we-secret-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-secret-editor');
        const scope = editor.dataset.secretScope;
        const list = editor.dataset.secretList;            // Nhóm hiện tại chứa mục này
        const index = Number(editor.dataset.secretIndex);
        const view = editor.dataset.secretView;            // Loại đích (có thể khác với list)
        const state = loadScopedState(scope);
        state.blackbox = state.blackbox || {};
        const srcArr = state.blackbox[SECRET_ARR[list]];
        if (!srcArr || srcArr[index] === undefined) return;

        // Đọc biểu mẫu theo view, ghép thành mục đích
        let item, okMsg;
        if (view === 'action') {
          const action = editor.querySelector('.we-secret-f-action').value.trim();
          if (!action) { showToast('Mô tả hành vi không được để trống', true); return; }
          item = { action, witnesses: editor.querySelector('.we-secret-f-witnesses').value.trim() || 'Không có' };
        } else {
          const name = editor.querySelector('.we-secret-f-name').value.trim();
          if (!name) { showToast('Tên tài sản không được để trống', true); return; }
          item = {
            name,
            exposure: Math.min(100, Math.max(0, Number(editor.querySelector('.we-secret-f-exposure').value) || 0)),
            status: editor.querySelector('.we-secret-f-status').value
          };
        }

        if (view === list) {
          srcArr[index] = item;                            // Cập nhật tại chỗ
          okMsg = view === 'action' ? 'Đã lưu hành vi bí mật' : 'Đã lưu tài sản bí mật';
        } else {
          srcArr.splice(index, 1);                         // Xóa khỏi nhóm cũ
          const arrKey = SECRET_ARR[view];
          if (!Array.isArray(state.blackbox[arrKey])) state.blackbox[arrKey] = [];
          state.blackbox[arrKey].push(item);               // Vào nhóm mới = chuyển đổi loại thực sự
          okMsg = view === 'action' ? 'Đã chuyển thành hành vi bí mật' : 'Đã chuyển thành tài sản bí mật';
        }
        saveScopedState(scope, state);
        editingSecret = null;
        showToast(okMsg);
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-del').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        if (!confirm(list === 'action' ? 'Xóa hành vi bí mật?' : 'Xóa tài sản bí mật?')) return;
        arr.splice(index, 1);
        saveScopedState(scope, state);
        showToast('Đã xóa');
        refresh();
      };
    });
    document.querySelectorAll('.we-secret-copy').forEach(button => {
      button.onclick = () => {
        const scope = button.dataset.secretScope;
        const list = button.dataset.secretList;
        const index = Number(button.dataset.secretIndex);
        const state = loadScopedState(scope);
        const arr = state.blackbox?.[SECRET_ARR[list]];
        if (!arr || arr[index] === undefined) return;
        arr.splice(index + 1, 0, JSON.parse(JSON.stringify(arr[index])));  // Chèn ngay bên cạnh
        saveScopedState(scope, state);
        showToast('Đã sao chép');
        refresh();
      };
    });

    // ===== Sự kiện trình soạn tóm tắt thế giới (chỉ chỉnh sửa, không cung cấp sao chép hoặc xóa) =====
    document.querySelectorAll('.we-digest-edit').forEach(button => {
      button.onclick = () => {
        editingDigest = { scope: button.dataset.digestScope || 'state' };
        refresh();
      };
    });
    document.querySelectorAll('.we-digest-editor-close').forEach(button => {
      button.onclick = () => { editingDigest = null; refresh(); };
    });
    document.querySelectorAll('.we-digest-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-digest-editor');
        if (!editor) return;
        const scope = editor.dataset.digestScope || 'state';
        const scopedState = loadScopedState(scope);
        const value = editor.querySelector('.we-digest-edit-text')?.value.trim() || '';
        scopedState.worldDigest = value;
        saveScopedState(scope, scopedState);
        editingDigest = null;
        showToast('Đã lưu tóm tắt thế giới');
        refresh();
      };
    });

    // ===== Sự kiện điều hướng =====
    const backBtn = document.getElementById('we-btn-back');
    if (backBtn) backBtn.onclick = () => { _currentView = 'home'; refresh(); };

    const settingsOpenBtn = document.getElementById('we-btn-settings-open');
    if (settingsOpenBtn) settingsOpenBtn.onclick = () => {
      const face = getEngineFace();
      if (typeof face.openSettings === 'function') face.openSettings();
      else if (face.id === 'world') _currentView = 'settings';
      refresh();
    };

    document.querySelectorAll('.we-nav-row[data-view]').forEach(row => {
      row.onclick = () => {
        if (_selectedNavView === row.dataset.view) {
          // Nhấn lần thứ hai: vào trang con
          _selectedNavView = null;
          _currentView = row.dataset.view;
          refresh();
        } else {
          // Nhấn lần đầu: chọn dòng này
          _selectedNavView = row.dataset.view;
          refresh();
        }
      };
    });

    // Nhấn vào chỗ khác ngoài danh sách điều hướng để bỏ chọn
    const panelBody = panelBodyElement;
    if (panelBody) {
      panelBody.onclick = (e) => {
        if (_currentView === 'home' && _selectedNavView && !e.target.closest('.we-nav-row')) {
          _selectedNavView = null;
          refresh();
        }
      };
    }

    // ===== Sự kiện thu gọn/mở rộng khối =====
    document.querySelectorAll('.we-section-toggle').forEach(toggle => {
      toggle.onclick = () => {
        const sectionId = toggle.dataset.section;
        sectionCollapsed[sectionId] = !sectionCollapsed[sectionId];
        const body = document.getElementById('we-section-body-' + sectionId);
        const arrow = document.getElementById('we-section-arrow-' + sectionId);
        if (body) body.style.display = sectionCollapsed[sectionId] ? 'none' : '';
        if (arrow) arrow.textContent = sectionCollapsed[sectionId] ? '▶' : '▼';
      };
    });

    // [FIX] Chuyển tab trang cài đặt: chỉ ẩn/hiện thuần CSS, không render lại (bảo vệ nội dung nhập + trường luôn trong DOM đảm bảo lưu không mất)
    document.querySelectorAll('.we-settings-tab').forEach(tab => {
      tab.onclick = () => {
        const key = tab.dataset.tab;
        const face = getEngineFace();
        if (typeof face.onSettingsTab === 'function') face.onSettingsTab(key);
        else _settingsTab = key;
        document.querySelectorAll('.we-settings-tab').forEach(t =>
          t.classList.toggle('we-settings-tab--active', t.dataset.tab === key));
        document.querySelectorAll('.we-settings-panel').forEach(p =>
          p.style.display = (p.dataset.tab === key) ? '' : 'none');
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        // [FIX] Khi chuyển sang tab gỡ lỗi, làm mới cục bộ renderDebug để lấy dữ liệu diễn biến vòng mới nhất (không đụng input của tab khác)
        if (key === 'debug') {
          if (typeof face.refreshDebug === 'function') face.refreshDebug();
          else { refreshDebugRender(); refreshPresetManage(); }
        }
      };
    });

    // Chuyển đổi dropdown phiên bản trong thẻ "Giới Thiệu": dùng lại khuôn mẫu #we-preset-select (nhấn vào hiện danh sách cuộn gốc).
    //   Chỉ ẩn/hiện thuần CSS, không render lại, không đụng tab khác.
    const settingsTabs = document.getElementById('we-settings-tabs');
    const updateSettingsTabScroll = () => {
      if (!settingsTabs) return;
      const shell = settingsTabs.closest('.we-settings-tabs-shell');
      if (!shell) return;
      const max = Math.max(0, settingsTabs.scrollWidth - settingsTabs.clientWidth);
      shell.classList.toggle('is-left-shadow', settingsTabs.scrollLeft > 2);
      shell.classList.toggle('is-right-shadow', settingsTabs.scrollLeft < max - 2);
      shell.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        const dir = Number(btn.dataset.dir) || 1;
        btn.disabled = max <= 2 || (dir < 0 ? settingsTabs.scrollLeft <= 2 : settingsTabs.scrollLeft >= max - 2);
      });
    };
    if (settingsTabs) {
      settingsTabs.addEventListener('scroll', updateSettingsTabScroll, { passive: true });
      const activeTab = settingsTabs.querySelector('.we-settings-tab--active');
      if (activeTab) activeTab.scrollIntoView({ block: 'nearest', inline: 'center' });
      document.querySelectorAll('.we-settings-tab-scroll').forEach(btn => {
        btn.onclick = () => {
          const dir = Number(btn.dataset.dir) || 1;
          settingsTabs.scrollBy({ left: dir * Math.max(120, settingsTabs.clientWidth * 0.65), behavior: 'smooth' });
        };
      });
      setTimeout(updateSettingsTabScroll, 0);
    }

    const clSel = document.getElementById('we-changelog-select');
    if (clSel) {
      clSel.onchange = () => {
        const ver = clSel.value;
        document.querySelectorAll('.we-changelog-panel').forEach(p =>
          p.style.display = (p.dataset.ver === ver) ? '' : 'none');
      };
    }

    const refreshBtn = document.getElementById('we-btn-refresh');
    if (refreshBtn) refreshBtn.onclick = () => refresh();

    // Bản gắn sự kiện nội tuyến cũ giữ lại một phiên bản để tham khảo tương thích, nhưng khi chạy thống nhất dùng bindFilterControls(scope).
    if (false) {
    // —— Lọc biểu thức chính quy: hiển thị dòng trạng thái + nút kiểm tra ——
    // Ghi kết quả của core.validateFilterRegex thành dòng trạng thái we-hint (dùng lại khuôn mẫu we-hint của chatcache/backfill).
    function renderFilterStatus(v, prefix) {
      const el = document.getElementById('we-filter-status');
      if (!el) return;
      const pfx = prefix || '';
      if (!v || (!v.ok && !v.bad.length)) { el.textContent = pfx + '(Chưa nhập biểu thức chính quy)'; return; }
      if (!v.bad.length) { el.textContent = pfx + `✅ ${v.ok} dòng đều hợp lệ`; return; }
      let s = pfx + `⚠️ ${v.ok} dòng hợp lệ / ${v.bad.length} dòng lỗi:`;
      for (const b of v.bad) s += `\nDòng ${b.line} "${b.raw}" không hợp lệ: ${b.reason}`;
      el.textContent = s;
    }

    const testBtn = document.getElementById('we-btn-filter-test');
    if (testBtn) {
      testBtn.onclick = () => {
        const core = window.WORLD_ENGINE_CORE;
        const raw = (document.getElementById('we-filter-regex')?.value) || '';
        if (!raw.trim()) { showToast('Chưa nhập biểu thức chính quy', true); renderFilterStatus(null); return; }
        if (!core || !core.validateFilterRegex) { showToast('Module core không khả dụng', true); return; }
        const v = core.validateFilterRegex(raw);
        if (v.bad.length) { renderFilterStatus(v, 'Đã dừng kiểm tra——'); showToast(`Có ${v.bad.length} biểu thức chính quy không hợp lệ, vui lòng sửa trước`, true); return; }
        // Lấy đoạn hội thoại không rỗng gần nhất (không giới hạn user/ai, dùng lại khuôn mẫu lấy chat của manualEvolve)
        let sample = '';
        try {
          const ctx = SillyTavern.getContext();
          const chat = (ctx && ctx.chat) || [];
          for (let i = chat.length - 1; i >= 0; i--) {
            const t = chat[i] && String(chat[i].mes || '').trim();
            if (t) { sample = String(chat[i].mes); break; }
          }
        } catch (e) {}
        if (!sample) { showToast('Cuộc trò chuyện hiện tại không có văn bản để kiểm tra', true); return; }
        // Chạy lọc + tích lũy số chỗ xóa theo thứ tự (cùng thứ tự với filterDialogue: mỗi mục replace trên kết quả của mục trước)
        let removed = 0, work = sample;
        for (const e of v.entries) {
          try {
            const re = new RegExp(e.pattern, e.flags);
            let m, n = 0;
            while ((m = re.exec(work)) !== null) { n++; if (m.index === re.lastIndex) re.lastIndex++; }
            work = work.replace(re, '');
            removed += n;
          } catch (err) { /* Sẽ không vào đây */ }
        }
        const filtered = work;
        const before = sample.slice(0, 60), after = filtered.slice(0, 60);
        const el = document.getElementById('we-filter-status');
        if (el) el.textContent = `Đã xóa ${removed} chỗ.\nTrước: ${before}${sample.length > 60 ? '…' : ''}\nSau: ${after}${filtered.length > 60 ? '…' : ''}`;
        showToast(`Đã xóa ${removed} chỗ`);
      };
    }

    // —— Lọc biểu thức chính quy "chế độ đơn giản": chọn thẻ tự động tạo <tag>[\s\S]*?</tag>\n? ——
    // Tách rời: nền tảng vẫn là ô văn bản #we-filter-regex (trường evolveFilterRegex) làm nguồn chân lý duy nhất.
    //   Chọn ↔ ô văn bản đồng bộ hai chiều; dòng không theo dạng <tag> (nội dung tạp do người dùng tự viết) giữ nguyên, không vào danh sách chọn.
    // Phân tích ngược chỉ nhận dạng chuẩn <tag>...</tag>; có ~? / có thuộc tính / /pat/g / pattern thuần tạp → coi là viết tay nâng cao, giữ nguyên.
    const SIMPLE_TAG_LINE = /^<([a-zA-Z_][\w-]*)>[\s\S]*?<\/\1>(?:\\n\?)?$/;
    const SCAN_TAG_RE = /<([a-zA-Z_][\w-]*)/g;

    // Danh sách thẻ hiện tại: { name, checked }[]. Không phải trạng thái phái sinh, tích lũy từ phân tích ngược textarea + quét/thêm thủ công.
    let _filterTags = [];

    // Phân tích ngược từ textarea ra các thẻ đã chọn theo dạng chuẩn <tag> (dòng không chuẩn coi là viết tay nâng cao, trả về tags + các dòng tạp giữ nguyên)
    function parseTextareaTags(raw) {
      const tags = [];
      const advanced = [];
      for (const line of String(raw || '').split('\n')) {
        const m = line.match(SIMPLE_TAG_LINE);
        if (m) { if (!tags.includes(m[1])) tags.push(m[1]); }
        else if (line.trim()) advanced.push(line);
      }
      return { tags, advanced };
    }

    // Thẻ đã chọn → tạo dòng mẫu chuẩn; gộp với dòng viết tay nâng cao rồi ghi lại vào textarea
    function writeTextareaFromTags(checkedTags, advancedLines) {
      const tagLines = checkedTags.map(t => `<${t}>[\\s\\S]*?</${t}>\\n?`);
      const all = tagLines.concat(advancedLines);
      const ta = document.getElementById('we-filter-regex');
      if (ta) ta.value = all.join('\n');
    }

    // Hiển thị danh sách chip đã chọn
    function renderFilterTags() {
      const box = document.getElementById('we-filter-tags');
      if (!box) return;
      box.innerHTML = '';
      for (const t of _filterTags) {
        const chip = document.createElement('label');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border:1px solid var(--we-border,#3a3a3a);border-radius:3px;font-size:12px;cursor:pointer;';
        const cb = document.createElement('input');
        cb.type = 'checkbox'; cb.checked = !!t.checked;
        cb.onchange = () => {
          t.checked = cb.checked;
          syncTextareaFromTags();
        };
        const name = document.createElement('span'); name.textContent = t.name;
        const del = document.createElement('span');
        del.textContent = '✕'; del.style.cssText = 'color:var(--we-text3);cursor:pointer;margin-left:2px;';
        del.onclick = (e) => { e.preventDefault(); _filterTags = _filterTags.filter(x => x.name !== t.name); renderFilterTags(); syncTextareaFromTags(); };
        chip.appendChild(cb); chip.appendChild(name); chip.appendChild(del);
        box.appendChild(chip);
      }
    }

    // Thay đổi lựa chọn → ghi lại vào textarea (giữ nguyên dòng viết tay nâng cao)
    function syncTextareaFromTags() {
      const ta = document.getElementById('we-filter-regex');
      const raw = ta ? ta.value : '';
      const { advanced } = parseTextareaTags(raw);
      const checked = _filterTags.filter(t => t.checked).map(t => t.name);
      writeTextareaFromTags(checked, advanced);
    }

    // textarea sửa tay → phân tích ngược cập nhật danh sách chọn (giữ nguyên trạng thái chọn của thẻ không chuẩn đã có trong danh sách)
    let _taSyncTimer = null;
    function syncTagsFromTextarea() {
      const ta = document.getElementById('we-filter-regex');
      if (!ta) return;
      const { tags } = parseTextareaTags(ta.value);
      // tags là tên thẻ tương ứng với các dòng <tag> chuẩn trong textarea (coi là đã chọn)
      const tagSet = new Set(tags);
      // Đã có trong danh sách: cập nhật checked theo việc textarea còn công nhận nó không; thẻ chuẩn chưa có trong danh sách: thêm vào (đã chọn)
      for (const t of _filterTags) t.checked = tagSet.has(t.name);
      for (const name of tags) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
    }

    // Quét phản hồi AI mới nhất, trích xuất các tên thẻ <xxx xuất hiện trong đó
    function scanTagsFromLastAI() {
      let text = '';
      try {
        const ctx = SillyTavern.getContext();
        const chat = (ctx && ctx.chat) || [];
        for (let i = chat.length - 1; i >= 0; i--) {
          const m = chat[i];
          if (m && !m.is_user && String(m.mes || '').trim()) { text = String(m.mes); break; }
        }
      } catch (e) {}
      if (!text) { showToast('Không tìm thấy phản hồi AI', true); return; }
      const found = [];
      let m;
      SCAN_TAG_RE.lastIndex = 0;
      while ((m = SCAN_TAG_RE.exec(text)) !== null) {
        const name = m[1];
        if (name && !found.includes(name)) found.push(name);
      }
      if (!found.length) { showToast('Không phát hiện thẻ nào trong phản hồi AI mới nhất', true); return; }
      // Gộp vào danh sách: thẻ đã có giữ nguyên trạng thái chọn, thẻ mới phát hiện mặc định chọn
      for (const name of found) {
        if (!_filterTags.some(t => t.name === name)) _filterTags.push({ name, checked: true });
      }
      renderFilterTags();
      syncTextareaFromTags();
      showToast(`Đã quét được ${found.length} thẻ`);
    }

    // Gắn: nút quét
    const scanBtn = document.getElementById('we-btn-filter-scan');
    if (scanBtn) scanBtn.onclick = scanTagsFromLastAI;

    // Gắn: thêm thủ công
    const addBtn = document.getElementById('we-btn-filter-add');
    const addInput = document.getElementById('we-filter-add-input');
    function doAddTag() {
      const v = (addInput && addInput.value || '').trim();
      if (!v) return;
      if (!/^[a-zA-Z_][\w-]*$/.test(v)) { showToast('Tên thẻ không hợp lệ (chỉ cho phép chữ, số, gạch dưới và gạch nối)', true); return; }
      if (!_filterTags.some(t => t.name === v)) _filterTags.push({ name: v, checked: true });
      if (addInput) addInput.value = '';
      renderFilterTags();
      syncTextareaFromTags();
    }
    if (addBtn) addBtn.onclick = doAddTag;
    if (addInput) addInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAddTag(); } });

    // Gắn: textarea sửa tay → phân tích ngược cập nhật chọn (debounce)
    const filterTa = document.getElementById('we-filter-regex');
    if (filterTa) filterTa.addEventListener('input', () => {
      clearTimeout(_taSyncTimer);
      _taSyncTimer = setTimeout(syncTagsFromTextarea, 300);
    });

    // Khởi tạo: khi mở trang cài đặt sẽ phân tích ngược từ trường đã lưu ra trạng thái chọn
    syncTagsFromTextarea();
    }
    bindFilterControls('world');

    // Công tắc và nút liên kết sang Công Cụ Nhân Vật, đặt trong trang cài đặt của Công Cụ Thế Giới
    // vì đây là chỗ quyết định thứ tự chạy giữa hai engine.
    const npcLinkEnabled = document.getElementById('we-npc-link-enabled');
    if (npcLinkEnabled) {
      npcLinkEnabled.onchange = () => {
        window.NPC_ENGINE_SETTINGS?.patchSettings({ npcLinkEnabled: npcLinkEnabled.checked });
        showToast(npcLinkEnabled.checked ? 'Đã bật liên kết Thế Giới → Nhân Vật' : 'Đã tắt liên kết Thế Giới → Nhân Vật');
      };
    }

    const npcLinkNow = document.getElementById('we-npc-link-now');
    if (npcLinkNow) {
      npcLinkNow.onclick = async () => {
        npcLinkNow.disabled = true;
        try {
          const ok = await window.WORLD_ENGINE?.manualNpcLink?.();
          showToast(ok ? 'Đã cập nhật hồ sơ nhân vật' : 'Chưa cập nhật được hồ sơ nhân vật', !ok);
        } catch (error) {
          showToast('Cập nhật thất bại: ' + (error?.message || error), true);
        } finally {
          npcLinkNow.disabled = false;
        }
      };
    }

    const saveBtn = document.getElementById('we-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const _modeRaw = document.getElementById('we-evolve-mode')?.value;
        const gv = id => document.getElementById(id)?.value;
        const temperatureRaw = parseFloat(gv('we-temperature'));
        const timeoutSecRaw = parseFloat(gv('we-api-timeout-sec'));
        const ns = {
          ...(window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {}),
          engineEnabled: document.getElementById('we-world-engine-enabled')?.checked !== false,
          firstLayerIsAiOpening: document.getElementById('we-first-layer-ai-opening')?.checked !== false,
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || 'gpt-3.5-turbo',
          temperature: Number.isFinite(temperatureRaw) ? Math.max(0, temperatureRaw) : 0.7,
          maxTokens: Math.max(1, parseInt(gv('we-max-tokens')) || 65000),
          apiAutoRetries: Math.max(0, parseInt(gv('we-api-auto-retries')) || 0),
          apiTimeoutMs: Number.isFinite(timeoutSecRaw) ? Math.max(0, Math.round(timeoutSecRaw * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct',
          injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
          injectMaxChars: Math.max(0, parseInt(gv('we-inject-max-chars')) || 0),
          injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true,
          syncToChat: document.getElementById('we-sync-to-chat')?.checked === true,
          autoBackup: document.getElementById('we-auto-backup')?.checked === true,
          evolveMode: (_modeRaw === 'manual' || _modeRaw === 'time') ? _modeRaw : 'auto',
          evolveEveryX: Math.max(1, parseInt(document.getElementById('we-evolve-everyx')?.value) || 1),
          evolveReadRounds: Math.max(1, parseInt(document.getElementById('we-evolve-readrounds')?.value) || 1),
          manualReadRounds: Math.max(1, parseInt(document.getElementById('we-manual-readrounds')?.value) || 1),
          evolveFilterRegex: gv('we-filter-regex') || '',
          displayMode: document.getElementById('we-display-mode')?.value === 'expand' ? 'expand' : 'mask',
          // Chế độ theo thời gian
          evolveTimeFront: Math.max(0, parseInt(gv('we-time-front')) || 0),
          evolveTimeBack: Math.max(0, parseInt(gv('we-time-back')) || 0),
          evolveTimeRe1: gv('we-time-re1') || '', evolveTimeRe2: gv('we-time-re2') || '',
          evolveTimeRe3: gv('we-time-re3') || '', evolveTimeRe4: gv('we-time-re4') || '',
          evolveTimeRe5: gv('we-time-re5') || '', evolveTimeRe6: gv('we-time-re6') || '',
          evolveTimeMul1: parseFloat(gv('we-time-mul1')) || 0,
          evolveTimeMul2: parseFloat(gv('we-time-mul2')) || 0,
          evolveTimeMul3: parseFloat(gv('we-time-mul3')) || 0,
          evolveTimeThreshold: Math.max(1, parseInt(gv('we-time-threshold')) || 1),
          evolveTimeMaxRounds: Math.max(1, parseInt(gv('we-time-maxrounds')) || 10),
          localRegionalIncidentChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-ri-chance')) || 0)),
          localRegionalIncidentDuration: Math.max(1, parseInt(gv('we-local-ri-duration')) || 5),
          localRegionalIncidentCooldown: Math.max(1, parseInt(gv('we-local-ri-cooldown')) || 1),
          localDistantEventLedgerThreshold: Math.max(1, parseInt(gv('we-local-distant-threshold')) || 10),
          localDistantEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-chance')) || 0)),
          localDistantEventCooldown: Math.max(1, parseInt(gv('we-local-distant-cooldown')) || 1),
          localDistantEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-distant-event-percent')) || 0)),
          localNearEventChancePercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-chance')) || 0)),
          localNearEventCooldown: Math.max(1, parseInt(gv('we-local-near-cooldown')) || 1),
          localNearEventEventPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-near-event-percent')) || 0)),
          localEventDiceModifier: Math.min(100, Math.max(-100, parseInt(gv('we-local-dice-mod')) || 0)),
          localEventSetbackRatioPercent: Math.min(100, Math.max(0, parseFloat(gv('we-local-setback-ratio')) || 0)),
          localProgressFailBase: Math.max(0, parseInt(gv('we-local-progress-fail-base')) || 0),
          localConflictFailBase: Math.max(1, parseInt(gv('we-local-conflict-fail-base')) || 6),
          localTerminalBaseKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-base')) || 0),
          localTerminalLevelKeepRounds: Math.max(0, parseInt(gv('we-local-terminal-level')) || 0),
          localInfluenceKeepRounds: Math.max(1, parseInt(gv('we-local-influence-keep')) || 8),
          localEnemyTerminalKeepRounds: Math.max(1, parseInt(gv('we-local-enemy-keep')) || 20),
          localLedgerKeepRounds: Math.max(1, parseInt(gv('we-local-ledger-keep')) || 20),
          localCapEvents: Math.max(1, parseInt(gv('we-local-cap-events')) || 16),
          localCapFactions: Math.max(1, parseInt(gv('we-local-cap-factions')) || 15),
          localCapWinds: Math.max(1, parseInt(gv('we-local-cap-winds')) || 12),
          localCapWorldTrends: Math.max(1, parseInt(gv('we-local-cap-trends')) || 4),
          localCapInfluence: Math.max(1, parseInt(gv('we-local-cap-influence')) || 12),
          localCapEnemies: Math.max(1, parseInt(gv('we-local-cap-enemies')) || 8),
          localCapEconomySignals: Math.max(1, parseInt(gv('we-local-cap-econ')) || 8),
          localCapBlackbox: Math.max(1, parseInt(gv('we-local-cap-blackbox')) || 12),
          localWindAnnouncementBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-announcement-base')) || 0)),
          localWindAnnouncementGrace: Math.max(0, parseInt(gv('we-local-wind-announcement-grace')) || 0),
          localWindAnnouncementLinear: Math.max(0, parseFloat(gv('we-local-wind-announcement-linear')) || 0),
          localWindAnnouncementQuadratic: Math.max(0, parseFloat(gv('we-local-wind-announcement-quadratic')) || 0),
          localWindReportBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-report-base')) || 0)),
          localWindReportGrace: Math.max(0, parseInt(gv('we-local-wind-report-grace')) || 0),
          localWindReportLinear: Math.max(0, parseFloat(gv('we-local-wind-report-linear')) || 0),
          localWindReportQuadratic: Math.max(0, parseFloat(gv('we-local-wind-report-quadratic')) || 0),
          localWindRumorBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-rumor-base')) || 0)),
          localWindRumorGrace: Math.max(0, parseInt(gv('we-local-wind-rumor-grace')) || 0),
          localWindRumorLinear: Math.max(0, parseFloat(gv('we-local-wind-rumor-linear')) || 0),
          localWindRumorQuadratic: Math.max(0, parseFloat(gv('we-local-wind-rumor-quadratic')) || 0),
          localWindSentimentBase: Math.min(95, Math.max(0, parseFloat(gv('we-local-wind-sentiment-base')) || 0)),
          localWindSentimentGrace: Math.max(0, parseInt(gv('we-local-wind-sentiment-grace')) || 0),
          localWindSentimentLinear: Math.max(0, parseFloat(gv('we-local-wind-sentiment-linear')) || 0),
          localWindSentimentQuadratic: Math.max(0, parseFloat(gv('we-local-wind-sentiment-quadratic')) || 0)
        };
        // a không được vượt quá X (số vòng mỗi lần diễn biến)
        ns.evolveReadRounds = Math.min(ns.evolveReadRounds, ns.evolveEveryX);
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(ns));
        if (window.WORLD_ENGINE_API) window.WORLD_ENGINE_API.getSettings(true);

        // [FIX] Sau khi lưu kiểm tra bộ lọc biểu thức chính quy: dùng lại core.validateFilterRegex. Mục không hợp lệ không cản trở việc lưu (nhất quán với khuôn mẫu clamp giá trị số hiện có),
        //   nhưng hiển thị hiệu lực/thất bại + lý do ở dòng trạng thái, điều chỉnh toast bên dưới theo có lỗi hay không.
        let _filterBad = 0;
        try {
          const _core = window.WORLD_ENGINE_CORE;
          if (_core && _core.validateFilterRegex) {
            const _v = _core.validateFilterRegex(ns.evolveFilterRegex);
            renderFilterStatus(_v, 'Đã lưu: ');
            _filterBad = _v.bad.length;
          }
        } catch (e) { /* Kiểm tra thất bại không ảnh hưởng đến việc lưu */ }

        // Chế độ theo thời gian: ba ô thời gian chỉ ghi khi "có giá trị", ghi thời gian hội thoại vòng này xong sẽ kích hoạt phán định
        if (ns.evolveMode === 'time') {
          const stIn = gv('we-time-state');
          if (stIn != null && stIn !== '') {
            const s2 = core.loadState();
            if (s2) { s2.time = Number(stIn); core.saveState(s2); }
          }
          const cpIn = gv('we-time-checkpoint');
          if (cpIn != null && cpIn !== '') {
            const cp2 = core.restoreCheckpoint();
            if (cp2) { cp2.time = Number(cpIn); core.saveCheckpoint(cp2); }
          }
          const curIn = gv('we-time-current');
          if (curIn != null && curIn !== '') {
            window.WORLD_ENGINE?.manualTimeEvolve?.(Number(curIn));
          }
        }

        window.WORLD_ENGINE?.applyInjection?.();
        showToast(_filterBad > 0 ? `Đã lưu, nhưng có ${_filterBad} biểu thức chính quy không hợp lệ` : 'Đã lưu cài đặt', _filterBad > 0);
      };
    }

    // Chuyển đổi chế độ diễn biến: theo vòng hiển thị X/a, theo thời gian hiển thị nhóm thời gian, thủ công hiển thị số vòng đọc thủ công
    const evolveModeSel = document.getElementById('we-evolve-mode');
    if (evolveModeSel) {
      evolveModeSel.onchange = () => {
        const v = evolveModeSel.value;
        const roundShow = v === 'auto' ? '' : 'none';
        const manualShow = v === 'manual' ? '' : 'none';
        const timeShow = v === 'time' ? '' : 'none';
        const g1 = document.getElementById('we-evolve-everyx-group');
        if (g1) g1.style.display = roundShow;
        const g2 = document.getElementById('we-evolve-readrounds-group');
        if (g2) g2.style.display = roundShow;
        const g3 = document.getElementById('we-manual-readrounds-group');
        if (g3) g3.style.display = manualShow;
        const g4 = document.getElementById('we-evolve-time-group');
        if (g4) g4.style.display = timeShow;
      };
    }

    const worldbookList = document.getElementById('we-worldbook-list');
    if (worldbookList) {
      const worldbook = window.WORLD_ENGINE_WORLDBOOK;
      const worldbookScope = _engineFace;
      const summary = document.getElementById('we-worldbook-summary');
      const reloadBtn = document.getElementById('we-worldbook-reload');
      const selectAllBtn = document.getElementById('we-worldbook-select-all');
      const clearAllBtn = document.getElementById('we-worldbook-clear-all');
      const saveWorldbookBtn = document.getElementById('we-worldbook-save');

      function updateWorldbookSummary() {
        const checkboxes = [...worldbookList.querySelectorAll('.we-worldbook-entry-check')];
        const selected = checkboxes.filter(checkbox => checkbox.checked);
        const chars = selected.reduce((total, checkbox) => total + Number(checkbox.dataset.chars || 0), 0);
        if (summary) summary.textContent = `Đã chọn ${selected.length}/${checkboxes.length}, khoảng ${chars} ký tự`;
      }

      async function loadWorldbookEntries() {
        if (!worldbook) {
          worldbookList.innerHTML = '<div class="we-empty">Module Worldbook chưa tải</div>';
          return;
        }
        worldbookList.innerHTML = '<div class="we-empty">Đang đọc Worldbook của cuộc trò chuyện hiện tại...</div>';
        if (reloadBtn) reloadBtn.disabled = true;
        try {
          const entries = await worldbook.loadCurrentEntries();
          const currentChatId = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
          // Dùng hasSelection() để phân biệt "chưa từng lưu" với "đã lưu mảng rỗng", tránh sau khi làm mới vô tình kích hoạt tự động chọn tất cả
          const isFirstVisit = worldbook.hasSelection ? !worldbook.hasSelection(worldbookScope) : false;
          const savedIds = worldbook.getSelectedIds(worldbookScope);
          _wbCachedEntries = entries;
          _wbCachedChatId = currentChatId;
          _wbCachedScope = worldbookScope;
          _wbCachedOverrides = worldbook.getOverrides ? { ...worldbook.getOverrides(worldbookScope) } : {};
          // Lần đầu vào cuộc trò chuyện này (không có bản ghi trong lưu trữ) thì tự động chọn tất cả các mục đang bật
          if (isFirstVisit && entries.length) {
            const allIds = entries.filter(e => !e.disabled).map(e => e.id);
            worldbook.saveSelectedIds(allIds, worldbookScope);
            _wbCachedSelectedIds = new Set(allIds);
            showToast(`Đã tự động chọn ${allIds.length} mục Worldbook`);
          } else {
            const enabledIds = new Set(entries.filter(e => !e.disabled).map(e => e.id));
            const validSavedIds = savedIds.filter(id => enabledIds.has(id));
            _wbCachedSelectedIds = new Set(validSavedIds);
            // Chỉ ghi lại khi có mục khớp, tránh trường hợp sau khi làm mới entry.world chưa kịp tải khiến toàn bộ ID không khớp,
            // vô tình xóa sạch bản ghi đã lưu thành [] (xóa sạch rồi thì lần mở bảng sau sẽ vô tình kích hoạt tự động chọn tất cả)
            if (validSavedIds.length > 0 && validSavedIds.length !== savedIds.length) {
              worldbook.saveSelectedIds(validSavedIds, worldbookScope);
            }
          }
          renderWorldbookList();
        } catch(error) {
          worldbookList.innerHTML = `<div class="we-empty">Đọc thất bại: ${u(error.message)}</div>`;
          if (summary) summary.textContent = 'Đọc thất bại';
          _wbCachedEntries = null;
          _wbCachedSelectedIds = null;
          _wbCachedOverrides = null;
          _wbCachedChatId = null;
          _wbCachedScope = null;
        } finally {
          if (reloadBtn) reloadBtn.disabled = false;
        }
      }

      function renderWorldbookList() {
        const entries = _wbCachedEntries;
        const selectedIds = _wbCachedSelectedIds || new Set();
        const overrides = _wbCachedOverrides || {};
        const triggerOn = worldbookScope === 'npc'
          ? window.NPC_ENGINE_SETTINGS?.getSettings()?.worldbookTrigger === true
          : !!(window.WORLD_ENGINE_WORLDBOOK?.triggerEnabled?.());
        if (!entries || !entries.length) {
          worldbookList.innerHTML = '<div class="we-empty">Cuộc trò chuyện hiện tại chưa liên kết mục Worldbook nào có thể đọc</div>';
          if (summary) summary.textContent = '0 mục khả dụng';
          return;
        }
        const groups = new Map();
        for (const entry of entries) {
          if (!groups.has(entry.world)) groups.set(entry.world, []);
          groups.get(entry.world).push(entry);
        }
        worldbookList.innerHTML = [...groups.entries()].map(([world, worldEntries]) => {
          const expanded = expandedWorldbookGroups.has(world);
          return `
          <div class="we-worldbook-group" data-worldbook-group="${u(world)}">
            <div class="we-worldbook-group-header">
              <span>${expanded ? '▼' : '▶'}</span>
              <div class="we-worldbook-group-title">
                <div>${u(world)} <span>${worldEntries.length} mục</span></div>
              </div>
              <div class="we-worldbook-group-actions">
                <button type="button" data-worldbook-group-action="select">Chọn Tất Cả</button>
                <button type="button" data-worldbook-group-action="clear">Bỏ Chọn Tất Cả</button>
              </div>
            </div>
            <div class="we-worldbook-group-body" style="${expanded ? '' : 'display:none;'}">
            ${worldEntries.map(entry => {
              const keys = entry.keys || [];
              const badge = entry.constant ? '🔵' : (entry.vectorized ? '🔗' : (keys.length ? '🟢' : '⚪'));
              const keyHint = keys.length ? ' · Từ khóa: ' + keys.slice(0, 5).join(', ') + (keys.length > 5 ? '…' : '') : '';
              const ov = overrides[entry.id] || 'auto';
              const overrideSel = (triggerOn && !entry.disabled) ? `
                <select class="we-wb-override" data-entry-id="${u(entry.id)}" title="Phương thức kích hoạt của mục này">
                  <option value="auto"${ov === 'auto' ? ' selected' : ''}>Theo SillyTavern</option>
                  <option value="const"${ov === 'const' ? ' selected' : ''}>Buộc Thường Trực</option>
                  <option value="key"${ov === 'key' ? ' selected' : ''}>Buộc Từ Khóa</option>
                  <option value="off"${ov === 'off' ? ' selected' : ''}>Tắt</option>
                </select>` : '';
              return `
              <div class="we-worldbook-entry${entry.disabled ? ' is-disabled' : ''}">
                <label class="we-wb-entry-main">
                  <input class="we-worldbook-entry-check" type="checkbox" value="${u(entry.id)}" data-chars="${entry.content.length}" ${selectedIds.has(entry.id) && !entry.disabled ? 'checked' : ''} ${entry.disabled ? 'disabled' : ''}>
                  <span>
                    <strong>${badge} ${u(entry.title)}</strong>
                    <small>${entry.content.length} ký tự${u(keyHint)}${entry.disabled ? ' · Đã tắt trong Worldbook' : ''}</small>
                  </span>
                </label>${overrideSel}
              </div>`;
            }).join('')}
            </div>
          </div>`;
        }).join('');
          worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
            checkbox.onchange = () => {
              _wbCachedSelectedIds = new Set([...worldbookList.querySelectorAll('.we-worldbook-entry-check:checked')].map(cb => cb.value));
              updateWorldbookSummary();
            };
          });
          worldbookList.querySelectorAll('.we-wb-override').forEach(sel => {
            sel.onchange = () => {
              const id = sel.dataset.entryId;
              if (!id) return;
              if (!_wbCachedOverrides) _wbCachedOverrides = {};
              if (sel.value === 'auto') delete _wbCachedOverrides[id];
              else _wbCachedOverrides[id] = sel.value;
            };
          });
          worldbookList.querySelectorAll('.we-worldbook-group-header').forEach(header => {
            header.onclick = () => {
              const body = header.nextElementSibling;
              const arrow = header.querySelector('span');
              if (body) {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? '' : 'none';
                if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
                const world = header.closest('.we-worldbook-group')?.dataset.worldbookGroup;
                if (world) {
                  if (isHidden) expandedWorldbookGroups.add(world);
                  else expandedWorldbookGroups.delete(world);
                }
              }
            };
          });
          worldbookList.querySelectorAll('[data-worldbook-group-action]').forEach(button => {
            button.onclick = (e) => {
              e.stopPropagation();
              const group = button.closest('.we-worldbook-group');
              if (!group) return;
              const checked = button.dataset.worldbookGroupAction === 'select';
              group.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
                checkbox.checked = checked;
                checkbox.onchange();
              });
            };
          });
          updateWorldbookSummary();
          // Khôi phục vị trí cuộn (bổ sung lại sau khi refresh() dựng lại DOM)
          if (_wbScrollTop) worldbookList.scrollTop = _wbScrollTop;
      }

      if (reloadBtn) reloadBtn.onclick = () => { _wbCachedEntries = null; _wbCachedChatId = null; _wbCachedScope = null; loadWorldbookEntries(); };
      if (selectAllBtn) selectAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check:not(:disabled)').forEach(checkbox => {
          checkbox.checked = true;
          checkbox.onchange();
        });
      };
      if (clearAllBtn) clearAllBtn.onclick = () => {
        worldbookList.querySelectorAll('.we-worldbook-entry-check').forEach(checkbox => {
          checkbox.checked = false;
          checkbox.onchange();
        });
      };
      if (saveWorldbookBtn) saveWorldbookBtn.onclick = () => {
        const ids = [..._wbCachedSelectedIds];
        if (worldbook.saveSelection) worldbook.saveSelection(ids, _wbCachedOverrides || {}, worldbookScope);
        else worldbook.saveSelectedIds(ids, worldbookScope);
        showToast(`Đã lưu ${_wbCachedSelectedIds.size} mục Worldbook ${worldbookScope === 'npc' ? 'nhân vật' : 'nền'}`);
        updateWorldbookSummary();
      };
      const triggerBox = document.getElementById('we-worldbook-trigger');
      if (triggerBox) triggerBox.onchange = () => {
        if (worldbookScope === 'npc') {
          window.NPC_ENGINE_SETTINGS?.patchSettings({ worldbookTrigger: triggerBox.checked });
        } else {
          const wapi = window.WORLD_ENGINE_API;
          const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, worldbookTrigger: triggerBox.checked }));
          if (wapi && wapi.getSettings) wapi.getSettings(true);
        }
        showToast(triggerBox.checked ? 'Đã bật kích hoạt đèn xanh-lam' : 'Đã tắt kích hoạt đèn xanh-lam (khôi phục chèn toàn bộ mục đã chọn)');
        renderWorldbookList(); // Render lại để hiện/ẩn dropdown ghi đè kích hoạt của từng mục
      };
      // Khi refresh() dựng lại DOM, nếu chatId không đổi và đã có cache thì render trực tiếp, tránh mất lựa chọn
      const currentChatIdNow = worldbook.getChatId ? worldbook.getChatId() : (window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
      if (_wbCachedEntries && _wbCachedChatId === currentChatIdNow && _wbCachedScope === worldbookScope) {
        renderWorldbookList();
      } else {
        loadWorldbookEntries();
      }
    }

    const resetBtn = document.getElementById('we-reset-world');
    if (resetBtn) {
      resetBtn.onclick = () => {
        if (confirm('Đặt lại toàn bộ trạng thái thế giới và ký ức của cuộc trò chuyện hiện tại? Không thể khôi phục!')) {
          core.clearState();
          core.clearCheckpoint();
          core.saveFingerprint(String(core.getChatLayer()));
          showToast('Đã đặt lại thế giới');
          refresh();
        }
      };
    }

    const settingsToggle = document.querySelector('.we-settings-toggle');
    if (settingsToggle) {
      settingsToggle.onclick = () => {
        const body = document.getElementById('we-settings-body');
        const arrow = settingsToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
        }
      };
    }

    const debugToggle = document.querySelector('.we-debug-toggle');
    if (debugToggle) {
      debugToggle.onclick = () => {
        const body = document.getElementById('we-debug-body');
        const arrow = debugToggle.querySelector('.we-toggle-arrow');
        if (body) {
          const isHidden = body.style.display === 'none';
          body.style.display = isHidden ? 'block' : 'none';
          if (arrow) arrow.textContent = isHidden ? '▼' : '▶';
          if (!isHidden) { refreshDebugRender(); refreshPresetManage(); } // [FIX] Làm mới cục bộ dữ liệu thẻ gỡ lỗi, không đụng input của tab khác
        }
      };
    }

    const fetchBtn = document.getElementById('we-fetch-models');
    if (fetchBtn) {
      fetchBtn.onclick = async () => {
        const api = window.WORLD_ENGINE_API;
        if (!api) { showToast('Module API chưa tải', true); return; }
        const requestScope = _engineFace;
        const modelListElement = document.getElementById('we-model-list');
        const apiPatch = {
          apiUrl: document.getElementById('we-api-url')?.value || '',
          apiKey: document.getElementById('we-api-key')?.value || '',
          model: document.getElementById('we-model')?.value || '',
          temperature: Number.isFinite(parseFloat(document.getElementById('we-temperature')?.value))
            ? Math.max(0, parseFloat(document.getElementById('we-temperature')?.value))
            : (requestScope === 'npc' ? 0.2 : 0.7),
          maxTokens: Math.max(1, parseInt(document.getElementById('we-max-tokens')?.value) || 65000),
          apiTimeoutMs: Number.isFinite(parseFloat(document.getElementById('we-api-timeout-sec')?.value)) ? Math.max(0, Math.round(parseFloat(document.getElementById('we-api-timeout-sec')?.value) * 1000)) : 120000,
          connectionMode: document.getElementById('we-connection-mode')?.value === 'proxy' ? 'proxy' : 'direct'
        };
        let requestSettings;
        if (requestScope === 'npc') {
          requestSettings = window.NPC_ENGINE_SETTINGS?.patchSettings(apiPatch) || apiPatch;
        } else {
          const worldSettings = {
            ...(api.getSettings ? api.getSettings(true) : {}),
            ...apiPatch,
            injectIntoPrompt: document.getElementById('we-inject-into-prompt')?.checked !== false,
            injectMaxChars: Math.max(0, parseInt(document.getElementById('we-inject-max-chars')?.value) || 0),
            injectAllLevels: document.getElementById('we-inject-all-levels')?.checked === true
          };
          window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify(worldSettings));
          if (api.getSettings) api.getSettings(true);
          requestSettings = worldSettings;
        }
        fetchBtn.disabled = true;
        fetchBtn.textContent = 'Đang lấy...';
        try {
          const models = await api.fetchModelList(requestSettings);
          const select = modelListElement;
          if (select) {
            select.innerHTML = '<option value="">-- Chọn Mô Hình --</option>' +
              models.map(m => '<option value="' + u(m) + '">' + u(m) + '</option>').join('');
            select.style.display = 'block';
            select.onchange = () => {
              const modelInput = document.getElementById('we-model');
              if (modelInput) modelInput.value = select.value;
            };
          }
          showToast('Đã lấy được ' + models.length + ' mô hình');
        } catch(e) {
          showToast('' + e.message, true);
        }
        fetchBtn.disabled = false;
        fetchBtn.innerHTML = 'Lấy Danh Sách';
      };
    }

    const exportBtn = document.getElementById('we-export-data');
    if (exportBtn) {
      exportBtn.onclick = () => {
        const s = core.loadState();
        const checkpoint = core.restoreCheckpoint();
        const clean = core.getCleanExport(s);
        const cleanCheckpoint = checkpoint ? core.getCleanExport(checkpoint) : null;
        const exportData = {
          version: '1.2',
          exportedAt: new Date().toISOString(),
          chatId: core.getChatId(),
          state: clean,
          checkpoint: cleanCheckpoint,
          fingerprint: core.loadFingerprint()
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-' + core.getChatId() + '-' + Date.now() + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Đã xuất');
      };
    }

    const importBtn = document.getElementById('we-import-data');
    const importFile = document.getElementById('we-import-file');
    if (importBtn && importFile) {
      importBtn.onclick = () => importFile.click();
      importFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            const isRegionalIncident = data && typeof data === 'object' &&
              Object.prototype.hasOwnProperty.call(data, 'active') &&
              Object.prototype.hasOwnProperty.call(data, 'title') &&
              Object.prototype.hasOwnProperty.call(data, 'impact');
            if (isRegionalIncident) {
              const state = core.loadState();
              state.regionalIncident = {
                active: data.active === true || data.active === 'true',
                title: String(data.title || ''),
                type: String(data.type || 'other'),
                scope: String(data.scope || ''),
                impact: String(data.impact || ''),
                cooldown: Math.max(0, Number(data.cooldown) || 0),
                _retry: data._retry === true || data._retry === 'true',
                _retryType: String(data._retryType || '')
              };
              core.saveState(state);
              showToast('Nhập biến cố khu vực thành công');
              refresh();
              return;
            }
            if (data.version !== '1.2') { showToast('Phiên bản định dạng lưu trữ không được hỗ trợ', true); return; }
            if (!data.state) { showToast('File nhập không hợp lệ', true); return; }
            const s = data.state;
            if (s.round === undefined) { showToast('Thiếu trường round', true); return; }
            core.importState(s);
            if (Object.prototype.hasOwnProperty.call(data, 'checkpoint')) {
              if (data.checkpoint) {
                data.checkpoint.chatLayer = core.getChatLayer();
                core.saveCheckpoint(data.checkpoint);
              }
              else core.clearCheckpoint();
            }
            core.saveFingerprint(String(core.getChatLayer()));
            showToast('Nhập thành công! Vòng ' + s.round + ', ' + (s.memories||[]).filter(m=>m.type==='ledger').length + ' vòng sổ sách');
            refresh();
          } catch(err) {
            showToast('Phân tích thất bại: ' + err.message, true);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      };
    }

    // ===== Nhập / Xuất / Xóa Prompt Bổ Sung =====
    function getTonePrompt() {
      return (window.WORLD_ENGINE_API?.getSettings(true)?.tonePrompt || '');
    }
    function saveTonePrompt(text) {
      const wapi = window.WORLD_ENGINE_API;
      const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
      window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, tonePrompt: text }));
      if (wapi && wapi.getSettings) wapi.getSettings(true);
    }
    function updateToneStatus() {
      const el = document.getElementById('we-tone-status');
      if (!el) return;
      const t = getTonePrompt().trim();
      el.textContent = t ? `Đã thiết lập Prompt bổ sung (${t.length} chữ)` : 'Chưa thiết lập Prompt bổ sung';
    }
    updateToneStatus();

    const toneImportBtn = document.getElementById('we-tone-import');
    const toneFile = document.getElementById('we-tone-file');
    if (toneImportBtn && toneFile) {
      toneImportBtn.onclick = () => toneFile.click();
      toneFile.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const text = String(ev.target.result || '').trim();
          if (!text) { showToast('File rỗng', true); return; }
          saveTonePrompt(text);
          updateToneStatus();
          showToast('Đã nhập Prompt bổ sung');
        };
        reader.readAsText(file);
        toneFile.value = '';
      };
    }

    const toneExportBtn = document.getElementById('we-tone-export');
    if (toneExportBtn) {
      toneExportBtn.onclick = () => {
        const t = getTonePrompt();
        if (!t.trim()) { showToast('Hiện không có Prompt bổ sung để xuất', true); return; }
        const blob = new Blob([t], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'world-engine-tone-' + Date.now() + '.txt';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Đã xuất Prompt bổ sung');
      };
    }

    const toneClearBtn = document.getElementById('we-tone-clear');
    if (toneClearBtn) {
      toneClearBtn.onclick = () => {
        if (!getTonePrompt().trim()) { showToast('Hiện không có Prompt bổ sung', true); return; }
        saveTonePrompt('');
        updateToneStatus();
        showToast('Đã xóa Prompt bổ sung');
      };
    }

    // ===== Bộ nhớ đệm và lưu trữ SillyTavern =====
    (function setupChatcacheSection() {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      const listEl = document.getElementById('we-chatcache-snapshots');
      if (!cc || !listEl) return; // Không ở trang cài đặt hoặc thiếu module

      const statusEl = document.getElementById('we-chatcache-status');
      const fmtTime = (ms) => {
        if (!ms) return '';
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      };

      function render() {
        const st = cc.getStatus();
        if (statusEl) {
          if (!st.usable) statusEl.textContent = 'Hiện không có cuộc trò chuyện khả dụng (vui lòng mở một nhân vật/nhóm chat trước).';
          else if (!st.apiAvailable) statusEl.textContent = 'Phiên bản SillyTavern hiện tại không hỗ trợ ghi chat_metadata, bộ nhớ đệm SillyTavern không khả dụng.';
          else statusEl.textContent = `Đồng bộ thời gian thực ${st.syncEnabled ? 'đã bật' : 'đã tắt'} · Bản sửa cục bộ ${st.localRev} / Cloud ${st.liveRev} · Tổng ${st.snapshotCount} bản lưu`;
        }
        const snaps = cc.listSnapshots();
        if (!snaps.length) { listEl.innerHTML = '<div class="we-empty">Chưa có bản lưu</div>'; return; }
        listEl.innerHTML = snaps.map(s => `
          <div class="we-snapshot-row" data-snap-id="${u(s.id)}">
            <div class="we-snapshot-main">
              <div class="we-snapshot-name"><span class="we-snapshot-badge${s.auto ? ' is-auto' : ''}">${s.auto ? 'Tự Động' : 'Thủ Công'}</span>${u(s.name)}</div>
              <div class="we-snapshot-meta">Vòng ${s.round || 0} · ${fmtTime(s.createdAt)}</div>
            </div>
            <div class="we-snapshot-actions">
              <button class="we-icon-btn" data-snap-action="restore" title="Khôi Phục Vào Cuộc Trò Chuyện Hiện Tại"><i class="fa-solid fa-rotate-left"></i></button>
              <button class="we-icon-btn" data-snap-action="rename" title="Đổi Tên"><i class="fa-solid fa-pen"></i></button>
              <button class="we-icon-btn" data-snap-action="export" title="Xuất JSON"><i class="fa-solid fa-download"></i></button>
              <button class="we-icon-btn" data-snap-action="delete" title="Xóa"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>`).join('');
        listEl.querySelectorAll('[data-snap-action]').forEach(btn => {
          btn.onclick = () => {
            const row = btn.closest('.we-snapshot-row');
            const id = row && row.dataset.snapId;
            if (!id) return;
            const action = btn.dataset.snapAction;
            const snap = cc.listSnapshots().find(s => s.id === id);
            if (action === 'restore') {
              if (!confirm(`Khôi phục bản lưu "${snap ? snap.name : id}" vào cuộc trò chuyện hiện tại?\nTrạng thái hiện tại sẽ được tự động sao lưu trước, có thể khôi phục lại sau.`)) return;
              if (cc.restoreSnapshot(id)) { showToast('Đã khôi phục bản lưu'); refresh(); }
              else showToast('Khôi phục thất bại', true);
            } else if (action === 'rename') {
              const name = prompt('Tên bản lưu mới:', snap ? snap.name : '');
              if (name == null) return;
              if (cc.renameSnapshot(id, name)) { showToast('Đã đổi tên'); render(); }
            } else if (action === 'export') {
              const obj = cc.exportSnapshot(id);
              if (!obj) { showToast('Xuất thất bại', true); return; }
              const safe = String(obj.name || id).replace(/[^\w一-龥-]+/g, '_');
              setupDownload(JSON.stringify(obj, null, 2), 'we-snapshot-' + safe + '-' + Date.now() + '.json');
              showToast('Đã xuất bản lưu');
            } else if (action === 'delete') {
              if (!confirm(`Xóa bản lưu "${snap ? snap.name : id}"? Không thể khôi phục.`)) return;
              if (cc.deleteSnapshot(id)) { showToast('Đã xóa'); render(); }
            }
          };
        });
      }

      // Có hiệu lực ngay và lưu trữ lâu dài từng công tắc riêng (cùng khuôn mẫu với saveTonePrompt)
      const persist = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };

      const syncBox = document.getElementById('we-sync-to-chat');
      if (syncBox) syncBox.onchange = () => {
        persist('syncToChat', syncBox.checked);
        if (syncBox.checked && cc.pushLiveNow) cc.pushLiveNow(); // Bật là gieo dữ liệu cục bộ vào cuộc trò chuyện ngay
        showToast(syncBox.checked ? 'Đã bật đồng bộ đa thiết bị' : 'Đã tắt đồng bộ đa thiết bị');
        render();
      };
      const autoBox = document.getElementById('we-auto-backup');
      if (autoBox) autoBox.onchange = () => {
        persist('autoBackup', autoBox.checked);
        showToast(autoBox.checked ? 'Đã bật tự động sao lưu' : 'Đã tắt tự động sao lưu');
      };

      const ccSaveBtn = document.getElementById('we-chatcache-save');
      if (ccSaveBtn) ccSaveBtn.onclick = () => {
        const name = prompt('Đặt tên cho bản lưu này:', 'Bản Lưu ' + fmtTime(Date.now()));
        if (name == null) return;
        if (cc.createSnapshot(name)) { showToast('Đã lưu'); render(); }
        else showToast('Lưu thất bại (cuộc trò chuyện hiện tại không có dữ liệu thế giới hoặc không thể ghi)', true);
      };

      const ccImportBtn = document.getElementById('we-chatcache-import');
      const ccImportFile = document.getElementById('we-chatcache-import-file');
      if (ccImportBtn && ccImportFile) {
        ccImportBtn.onclick = () => ccImportFile.click();
        ccImportFile.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const obj = JSON.parse(ev.target.result);
              if (cc.importSnapshot(obj)) { showToast('Đã nhập bản lưu'); render(); }
              else showToast('Không phải file bản lưu hợp lệ', true);
            } catch (err) { showToast('Phân tích thất bại: ' + err.message, true); }
          };
          reader.readAsText(file);
          ccImportFile.value = '';
        };
      }

      render();
    })();

    // ===== Điền lại diễn biến thế giới hàng loạt =====
    (function setupBackfillSection() {
      const startBtn = document.getElementById('we-backfill-start');
      const stopBtn = document.getElementById('we-backfill-stop');
      if (!startBtn) return; // Không ở trang cài đặt

      const persistBf = (key, val) => {
        const wapi = window.WORLD_ENGINE_API;
        const cur = wapi && wapi.getSettings ? wapi.getSettings(true) : {};
        window.WORLD_ENGINE_STORE.setItem('world_engine_settings', JSON.stringify({ ...cur, [key]: val }));
        if (wapi && wapi.getSettings) wapi.getSettings(true);
      };
      const batchEl = document.getElementById('we-backfill-batch');
      const endEl = document.getElementById('we-backfill-end');
      const retriesEl = document.getElementById('we-backfill-retries');
      if (batchEl) batchEl.onchange = () => persistBf('backfillBatchSize', Math.max(1, parseInt(batchEl.value) || 1));
      if (endEl) endEl.onchange = () => persistBf('backfillEndLayer', Math.max(0, parseInt(endEl.value) || 0));
      if (retriesEl) retriesEl.onchange = () => persistBf('backfillRetries', Math.max(0, parseInt(retriesEl.value) || 0));

      startBtn.onclick = () => runBackfill();
      if (stopBtn) stopBtn.onclick = () => {
        if (evolution && evolution.abort) { evolution.abort(); showToast('Đã gửi tín hiệu dừng'); }
      };
    })();

    // Nút xuất khu vực gỡ lỗi
    function setupDownload(content, filename) {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }

    const exportPromptBtn = document.getElementById('we-export-prompt');
    if (exportPromptBtn) {
      exportPromptBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.prompt) { showToast('Không có Prompt để xuất', true); return; }
        setupDownload(dbg.prompt, 'prompt-' + Date.now() + '.txt');
        showToast('Đã xuất Prompt');
      };
    }

    const exportRawBtn = document.getElementById('we-export-raw-result');
    if (exportRawBtn) {
      exportRawBtn.onclick = () => {
        const evo = window.WORLD_ENGINE_EVOLUTION;
        if (!evo || !evo.getLastDebug) return;
        const dbg = evo.getLastDebug();
        if (!dbg.rawResult) { showToast('Không có phản hồi API để xuất', true); return; }
        setupDownload(dbg.rawResult, 'api-raw-' + Date.now() + '.txt');
        showToast('Đã xuất phản hồi API');
      };
    }

    // [FIX] Thu gọn thẻ phân đoạn prompt diễn biến (ủy quyền sự kiện, logic ở bindPromptSegToggle cấp module)
    bindPromptSegToggle(document.querySelector('.we-prompt-debug'));

    // [FIX] Xuất gói chẩn đoán
    const exportDiagBtn = document.getElementById('we-export-diag');
    if (exportDiagBtn) {
      exportDiagBtn.onclick = () => {
        const diag = window.WORLD_ENGINE_DIAG;
        if (!diag || !diag.download) { showToast('Module chẩn đoán không khả dụng', true); return; }
        try {
          diag.download();
          showToast('Đã xuất gói chẩn đoán');
        } catch (e) {
          showToast('Xuất gói chẩn đoán thất bại: ' + (e && e.message || e), true);
        }
      };
    }
    const npcExportDiagBtn = document.getElementById('we-npc-export-diag');
    if (npcExportDiagBtn) npcExportDiagBtn.onclick = () => {
      const diag = window.WORLD_ENGINE_DIAG;
      if (!diag?.download) { showToast('Module chẩn đoán ký ức không khả dụng', true); return; }
      try { diag.download('npc'); showToast('Đã xuất gói chẩn đoán nhân vật'); }
      catch (error) { showToast('Xuất gói chẩn đoán ký ức thất bại: ' + (error?.message || error), true); }
    };

    // [MAP] Quản lý preset engine: gắn sự kiện lần đầu sau khi dựng toàn trang (ủy quyền sự kiện nằm trong bindPresetEvents).
    bindPresetEvents(document.getElementById('we-preset-manage'));

    // ===== Thao tác Chú Thích Thế Giới =====
    document.querySelectorAll('.we-note-delete').forEach(button => {
      button.onclick = () => {
        const noteIndex = Number(button.dataset.noteIndex);
        const entryIndex = Number(button.dataset.entryIndex);
        const state = core.loadState();
        if (!state?.worldNotes?.[noteIndex]) return;
        const entries = parseTipEntries(state.worldNotes[noteIndex].raw || '');
        if (!confirm('Xóa chú thích này?')) return;
        entries.splice(entryIndex, 1);
        if (entries.length === 0) {
          state.worldNotes.splice(noteIndex, 1);
        } else {
          state.worldNotes[noteIndex].raw = serializeTipEntries(entries);
        }
        editingNote = null;
        core.saveState(state);
        showToast('Đã xóa chú thích');
        refresh();
      };
    });

    document.querySelectorAll('.we-note-copy').forEach(button => {
      button.onclick = () => {
        const noteIndex = Number(button.dataset.noteIndex);
        const entryIndex = Number(button.dataset.entryIndex);
        const state = core.loadState();
        const entries = parseTipEntries(state?.worldNotes?.[noteIndex]?.raw || '');
        const entry = entries[entryIndex];
        if (!entry) return;
        navigator.clipboard.writeText(entry.content).then(() => {
          showToast('Đã sao chép nội dung');
        }).catch(() => {
          showToast('Sao chép thất bại', true);
        });
      };
    });

    document.querySelectorAll('.we-note-edit').forEach(button => {
      button.onclick = () => {
        editingNote = {
          noteIndex: Number(button.dataset.noteIndex),
          entryIndex: Number(button.dataset.entryIndex)
        };
        refresh();
      };
    });

    document.querySelectorAll('.we-note-editor-close').forEach(button => {
      button.onclick = () => { editingNote = null; refresh(); };
    });

    document.querySelectorAll('.we-note-editor-save').forEach(button => {
      button.onclick = () => {
        const editor = button.closest('.we-note-editor');
        const noteIndex = Number(editor.dataset.noteIndex);
        const entryIndex = Number(editor.dataset.entryIndex);
        const state = core.loadState();
        if (!state?.worldNotes?.[noteIndex]) return;
        const entries = parseTipEntries(state.worldNotes[noteIndex].raw || '');
        if (!entries[entryIndex]) return;
        const newContent = editor.querySelector('.we-note-edit-content').value.trim();
        if (!newContent) { showToast('Nội dung không được để trống', true); return; }
        entries[entryIndex] = {
          type: editor.querySelector('.we-note-edit-type').value,
          content: newContent
        };
        state.worldNotes[noteIndex].raw = serializeTipEntries(entries);
        core.saveState(state);
        editingNote = null;
        showToast('Đã lưu chú thích');
        refresh();
      };
    });
  }

  function showPanel() {
    if (!panelElement) buildPanel();
    applyEngineFaceTheme();
    panelElement.style.display = 'flex';
    panelVisible = true;
    refresh();
  }

  function hidePanel() {
    if (!panelElement) return;
    panelElement.style.display = 'none';
    panelVisible = false;
  }

  function togglePanel() {
    if (panelVisible) hidePanel();
    else showPanel();
  }

  function initDrag(panel, handle) {
    let dragging = false, startX, startY, startLeft, startTop;
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('.we-panel-close') || e.target.closest('.we-panel-corner-actions') || e.target.closest('.we-engine-face-toggle')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.style.left = startLeft + 'px'; panel.style.top = startTop + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      panel.style.cursor = 'grabbing';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = (startLeft + dx) + 'px';
      panel.style.top = (startTop + dy) + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      panel.style.cursor = '';
    });
  }

  /** Lấy số tầng hội thoại hiện tại */
  function getChatLayer() {
    try {
      const ctx = SillyTavern.getContext();
      const chat = ctx?.chat || [];
      return Math.max(0, chat.length - 1);
    } catch(e) { return '?'; }
  }

  /** Thiết lập thanh trạng thái của bảng điều khiển */
  function setStatus(text, isError) {
    const statusBar = document.getElementById('we-status-bar');
    if (!statusBar) return;
    statusBar.textContent = text;
    statusBar.className = 'we-status-bar' + (isError ? ' error' : '');
  }

  // ========== Ủy quyền sự kiện toàn cục: nhấn danh tiếng + chỉnh sửa economy ==========
  document.addEventListener('click', function(e) {
    // Nhấn ô vuông danh tiếng
    var dot = e.target.closest('.we-rep-dot');
    if (dot) {
      var dim = dot.getAttribute('data-dim');
      var level = dot.getAttribute('data-level');
      if (dim && level) {
        var scope = dot.getAttribute('data-rep-scope');
        var s = loadScopedState(scope);
        s.reputation = s.reputation || {};
        s.reputation[dim] = level;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // Nhấn nút climate
    var cb = e.target.closest('.we-climate-btn');
    if (cb) {
      var c = cb.getAttribute('data-climate');
      if (c) {
        var scope = cb.getAttribute('data-climate-scope');
        var s = loadScopedState(scope);
        s.economy = s.economy || {};
        s.economy.climate = c;
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }
    // Chuyển trang danh sách chung
    var arr = e.target.closest('.we-list-arrow');
    if (arr) {
      var rid = arr.getAttribute('data-rid');
      var dir = parseInt(arr.getAttribute('data-dir'));
      if (!rid || isNaN(dir)) return;
      // Tìm bộ chuyển trang tương ứng
      var pager = arr.parentNode;
      var curSpan = pager.querySelector('.we-list-cur');
      if (!curSpan) return;
      var curPage = parseInt(curSpan.textContent);
      var list = document.querySelector('.we-paged-list[data-rid="' + rid + '"]');
      if (!list) return;
      var items = list.querySelectorAll('.we-page-item');
      var pages = Array.from(items).map(function(el) {
        return { el: el, page: parseInt(el.getAttribute('data-page')) };
      });
      if (!pages.length) return;
      var maxPage = Math.max.apply(null, pages.map(function(p){return p.page;}));
      var newPage = ((curPage - 1 + dir) % maxPage + maxPage) % maxPage + 1;
      pages.forEach(function(p) { p.el.style.display = p.page === newPage ? '' : 'none'; });
      curSpan.textContent = newPage;
      listPageState[rid] = newPage;
      return;
    }
    // Xóa signal
    var sd = e.target.closest('.we-signal-del');
    if (sd) {
      var idx = parseInt(sd.getAttribute('data-sigidx'));
      if (!isNaN(idx)) {
        var scope = sd.getAttribute('data-sig-scope');
        var s = loadScopedState(scope);
        if (s.economy && s.economy.signals && s.economy.signals[idx] !== undefined) {
          s.economy.signals.splice(idx, 1);
          saveScopedState(scope, s);
          refresh();
        }
      }
      return;
    }
    // Thêm signal
    var sa = e.target.closest('.we-signal-add');
    if (sa) {
      var scope = sa.getAttribute('data-sig-scope');
      var s = loadScopedState(scope);
      s.economy = s.economy || {};
      if (!s.economy.signals) s.economy.signals = [];
      if (s.economy.signals.length < 5) {
        s.economy.signals.push({ summary: 'Tín hiệu mới', scope: 'Khu vực' });
        saveScopedState(scope, s);
        refresh();
      }
      return;
    }

    // Nhấn thẻ tín hiệu để hiện nút xóa; nhấn lại cùng thẻ vẫn giữ hiển thị, tiện thao tác trên di động
    var signalCard = e.target.closest('.we-signal-item');
    if (signalCard && panelBodyElement && panelBodyElement.contains(signalCard)) {
      panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
      signalCard.classList.add('we-card-active');
      return;
    }

    // ===== Nhấn thẻ mục để hiện/ẩn nút chỉnh sửa của nó (di động không có hover, thống nhất đổi thành nhấn) =====
    if (!panelBodyElement || !panelBodyElement.contains(e.target)) return;
    // Nhấn vào nút/control nhập liệu/trình soạn đang mở rộng: giao cho từng trình xử lý riêng, không chuyển đổi
    if (e.target.closest('button, select, input, textarea, label, a, .we-event-editor, .we-rep-dot, .we-climate-btn, .we-signal-item, .we-list-arrow, .we-nav-row, .we-section-toggle')) return;
    var card = findActionCard(e.target);
    var wasActive = card && card.classList.contains('we-card-active');
    // Thu gọn các thẻ khác đang mở rộng trước
    panelBodyElement.querySelectorAll('.we-card-active').forEach(function(c){ c.classList.remove('we-card-active'); });
    if (card && !wasActive) card.classList.add('we-card-active');
  });

  /** Tìm thẻ mục chứa nhóm nút chỉnh sửa (node con trực tiếp có .we-event-actions / .we-secret-ops) */
  function findActionCard(target) {
    var el = target;
    while (el && el.nodeType === 1 && el.id !== 'we-panel-body') {
      if (el.querySelector && el.querySelector(':scope > .we-event-actions, :scope > .we-secret-ops')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Ủy quyền sự kiện toàn cục: nhấn đúp signal để chỉnh sửa
  document.addEventListener('dblclick', function(e) {
    var sum = e.target.closest('.we-signal-summary');
    var sc = e.target.closest('.we-signal-scope');
    if (!sum && !sc) return;
    e.preventDefault();
    var item = sum || sc;
    var isScope = !!sc;
    var parent = item.closest('.we-signal-item');
    if (!parent) return;
    var del = parent.querySelector('.we-signal-del');
    var idx = del ? parseInt(del.getAttribute('data-sigidx')) : -1;
    if (isNaN(idx)) return;
    var dispScope = parent.getAttribute('data-sig-scope');
    var oldText = item.textContent;
    item.contentEditable = 'true';
    item.focus();
    // select all text
    var range = document.createRange();
    range.selectNodeContents(item);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    item.onblur = function() {
      item.contentEditable = 'false';
      var s = loadScopedState(dispScope);
      if (s.economy && s.economy.signals && s.economy.signals[idx]) {
        if (isScope) s.economy.signals[idx].scope = item.textContent;
        else s.economy.signals[idx].summary = item.textContent;
        saveScopedState(dispScope, s);
      }
    };
    item.onkeydown = function(ke) {
      if (ke.key === 'Enter') { ke.preventDefault(); item.blur(); }
    };
  });

  // ========== Chuyển đổi trạng thái UI diễn biến ==========
  function setEvolvingUI(active, scope) {
    // Chỉ đặt cờ, tuyệt đối không gọi refresh() ở đây: bindEvents() mỗi lần làm mới đều gọi hàm này,
    // nếu quay lại refresh sẽ tạo vòng lặp vô hạn setEvolvingUI→refresh→bindEvents→setEvolvingUI dẫn đến treo.
    // Hiển thị bản nào do bảo vệ getActiveInjected + _evolvingScope phụ trách, việc làm mới do bên gọi tự thực hiện bên ngoài.
    _evolving = !!active;
    if (active && scope) _evolvingScope = scope;
    updateBallControls();
  }

  function setInjectedScope(scope) {
    _injectedScope = scope === 'checkpoint' ? 'checkpoint' : 'state';
  }

  // Diễn biến thủ công (dùng cho nút vệ tinh quả cầu nổi gọi): chỉ định rõ nền, không xét isNewRound.
  //   Diễn biến lại → gửi điểm lưu trữ B (mode 'redo'), bảng hiển thị điểm lưu trữ;
  //   Diễn biến tiến → gửi trạng thái hiện tại A (mode 'forward'), bảng hiển thị trạng thái hiện tại.
  async function runManualEvolve(mode, scope) {
    if (!window.WORLD_ENGINE || typeof window.WORLD_ENGINE.manualEvolve !== 'function') {
      showToast('Lối vào diễn biến thủ công chưa sẵn sàng', true);
      return;
    }
    const ok = await window.WORLD_ENGINE.manualEvolve(mode, scope);
    if (ok) showToast('Diễn biến hoàn tất');
    else if (evolution.getLastError?.()) showToast(evolution.getLastError(), true);
  }

  // Điền lại "diễn biến thế giới" hàng loạt: xóa sạch trạng thái thế giới hiện tại, từ tầng AI đầu tiên chia đợt diễn biến đến tầng chỉ định.
  async function runBackfill() {
    if (isEvolving) { showToast('Đang có diễn biến khác chạy, vui lòng đợi'); return; }
    if (evolution?.isRunning?.()) { showToast('Đang có diễn biến khác chạy, vui lòng đợi'); return; }

    const st = window.WORLD_ENGINE_API ? window.WORLD_ENGINE_API.getSettings(true) : {};
    if (st.engineEnabled === false) { showToast('World Engine đã tắt', true); return; }
    const batchSize = Math.max(1, parseInt(st.backfillBatchSize) || 1);
    const retries = Math.max(0, parseInt(st.backfillRetries) || 0);
    let endLayer = Math.max(0, parseInt(st.backfillEndLayer) || 0);

    // Đếm số tầng AI hiện tại, đưa ra thông tin xác nhận
    let aiCount = 0;
    try {
      const ctx = SillyTavern.getContext();
      const chat = (ctx && ctx.chat) || [];
      const ignoreFirstLayer = st.firstLayerIsAiOpening !== false;
      for (let index = 0; index < chat.length; index++) {
        const m = chat[index];
        if (m && !m.is_user && String(m.mes || '').trim() && !(ignoreFirstLayer && index === 0)) aiCount++;
      }
    } catch (e) {}
    if (!aiCount) { showToast('Cuộc trò chuyện hiện tại không có tầng AI nào để diễn biến', true); return; }
    const effectiveEnd = (endLayer > 0 && endLayer <= aiCount) ? endLayer : aiCount;
    const totalBatches = Math.max(1, Math.ceil(effectiveEnd / batchSize));

    const statusEl = document.getElementById('we-backfill-status');
    const setBfStatus = (t) => { if (statusEl) statusEl.textContent = t; };

    if (!confirm(
      `"Điền Lại Diễn Biến Thế Giới" sẽ xóa sạch trạng thái thế giới hiện tại, diễn biến lại từ tầng AI đầu tiên đến tầng ${effectiveEnd}, ` +
      `tổng cộng khoảng ${totalBatches} đợt, mỗi đợt thử lại tối đa ${retries} lần khi lỗi.\n` +
      `Sẽ tự động lưu một bản sao lưu trước khi bắt đầu.\nXác nhận xóa sạch làm lại?`
    )) return;

    // Tự động sao lưu trước khi điền lại (chatcache không khả dụng thì âm thầm bỏ qua)
    try {
      const cc = window.WORLD_ENGINE_CHATCACHE;
      if (cc && cc.createSnapshot) {
        const snap = cc.createSnapshot('Tự động sao lưu trước khi điền lại');
        if (snap) showToast('Đã lưu bản sao lưu trước khi điền lại');
      }
    } catch (e) { console.warn('[World Engine] Sao lưu trước khi điền lại thất bại (không ảnh hưởng đến việc điền lại)', e); }

    isEvolving = true;
    setEvolvingUI(true, 'state');
    refresh(true);
    if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Đang điền lại...');
    setBfStatus('Bắt đầu điền lại...');

    try {
      const result = await evolution.backfillEvolve({
        batchSize, retries, endLayer,
        onProgress: (p) => {
          if (p.phase === 'batch-start') {
            setBfStatus(`Đợt ${p.batch}/${p.totalBatches} (tầng ${p.layerFrom}-${p.layerTo}) đang diễn biến...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`Đang điền lại ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'retry') {
            setBfStatus(`Đợt ${p.batch}/${p.totalBatches} thất bại, đang thử lại ${p.attempt}/${retries}...`);
            if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`Đang điền lại ${p.batch}/${p.totalBatches}`);
          } else if (p.phase === 'batch-done') {
            setBfStatus(`Đợt ${p.batch}/${p.totalBatches} hoàn tất (đã tiến đến vòng ${p.round})`);
            refresh(true);
          }
        }
      });

      if (result.done) {
        setBfStatus(`✅ Điền lại hoàn tất, tổng ${result.completedBatches}/${result.totalBatches} đợt`);
        showToast(`Điền lại hoàn tất, tổng ${result.completedBatches} đợt`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Điền lại hoàn tất');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'aborted') {
        setBfStatus(`🛑 Đã hủy, hoàn thành ${result.completedBatches}/${result.totalBatches} đợt`);
        showToast(`Điền lại đã hủy (hoàn thành ${result.completedBatches} đợt)`);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Điền lại đã hủy');
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      } else if (result.reason === 'no-ai-layers') {
        setBfStatus('Cuộc trò chuyện hiện tại không có tầng AI nào để diễn biến');
        showToast('Cuộc trò chuyện hiện tại không có tầng AI nào để diễn biến', true);
      } else if (result.reason === 'busy') {
        showToast('Đang có diễn biến khác chạy, vui lòng đợi', true);
      } else {
        setBfStatus(`❌ Đợt ${result.failedAt || '?'} thất bại, đã dừng (hoàn thành ${result.completedBatches || 0} đợt)`);
        showToast(`Điền lại thất bại ở đợt ${result.failedAt || '?'}, đã dừng`, true);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus('Điền lại thất bại', true);
        if (window.WORLD_ENGINE?.applyInjection) window.WORLD_ENGINE.applyInjection();
      }
    } catch (e) {
      setBfStatus('❌ Lỗi khi điền lại: ' + (e && e.message || e));
      showToast('Lỗi khi điền lại: ' + (e && e.message || e), true);
    } finally {
      isEvolving = false;
      setEvolvingUI(false);
      refresh();
    }
  }

  // ========== Quả cầu nổi World Engine ==========
  let inputButtonObserver = null;
  let inputButtonRetryTimer = null;
  const WE_BALL_POS_KEY = 'we-ball-pos';
  let _ballStatusTimer = null;

  function getFaceSettings() {
    const face = getEngineFace();
    return callEngineFace(face, 'getSettings', {}) || {};
  }

  function updateBallControls() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    const active = Boolean(callEngineFace(face, 'isRunning', false));
    const runningLabel = String(callEngineFace(face, 'getRunningLabel', '') || '');
    const fwd = ball.querySelector('#we-sat-forward');
    const redo = ball.querySelector('#we-sat-redo');
    const abort = ball.querySelector('#we-sat-abort');
    const power = ball.querySelector('#we-sat-power');
    const engineSwitch = ball.querySelector('#we-sat-engine-switch');
    if (fwd) {
      fwd.style.display = face.showForward === true ? '' : 'none';
      fwd.classList.toggle('we-sat-off', active);
      fwd.title = face.forwardTitle || `Diễn Biến Tiến ${face.label}`;
    }
    if (redo) {
      redo.classList.toggle('we-sat-off', active);
      redo.title = `Diễn Biến Lại ${face.label}`;
    }
    if (abort) {
      abort.classList.toggle('we-sat-off', !active);
      abort.title = active && runningLabel ? `Dừng ${runningLabel}` : `Dừng Diễn Biến ${face.label}`;
    }
    if (power) {
      power.classList.toggle('on', getFaceSettings().engineEnabled === false);
      power.style.display = typeof face.setEnabled === 'function' ? '' : 'none';
      power.title = `Bật/Tắt Diễn Biến Và Chèn Của ${face.label}`;
    }
    if (engineSwitch) {
      const targetId = face.id === 'npc' ? 'world' : 'npc';
      const target = getEngineFace(targetId);
      const targetActive = Boolean(callEngineFace(target, 'isRunning', false));
      const targetRunningLabel = String(callEngineFace(target, 'getRunningLabel', '') || '');
      engineSwitch.dataset.targetEngine = target.id;
      engineSwitch.dataset.engineRunning = targetActive ? 'true' : 'false';
      engineSwitch.classList.toggle('we-sat-target-world', target.id === 'world');
      engineSwitch.classList.toggle('we-sat-target-npc', target.id === 'npc');
      engineSwitch.classList.toggle('we-sat-engine-running', targetActive);
      engineSwitch.title = targetActive
        ? `${target.label} đang ${targetRunningLabel || 'diễn biến'} · Nhấn để chuyển sang xem`
        : `Chuyển Sang ${target.label}`;
      engineSwitch.setAttribute('aria-label', engineSwitch.title);
    }
    ball.classList.toggle('we-ball-evolving', active);
    ball.title = active && runningLabel
      ? `${face.label}: đang thực hiện ${runningLabel}`
      : `${face.label}: nhấn để mở bảng điều khiển`;
    ball.setAttribute('aria-label', ball.title);
    if (active) ball.classList.remove('we-ball-success', 'we-ball-fail');
  }

  function syncBallFace() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const face = getEngineFace();
    for (const registered of _engineFaceRegistry.values()) {
      if (registered.ballClass) ball.classList.remove(registered.ballClass);
    }
    if (face.ballClass) ball.classList.add(face.ballClass);
    ball.dataset.engineFace = face.id;
    ball.title = `${face.label}: nhấn để mở bảng điều khiển`;
    ball.setAttribute('aria-label', ball.title);
    updateBallControls();
  }

  function loadBallPos() {
    try {
      const raw = localStorage.getItem(WE_BALL_POS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p.left === 'number' && typeof p.top === 'number') return p;
      }
    } catch (_) {}
    return null;
  }

  function saveBallPos(left, top, tucked, side) {
    try { localStorage.setItem(WE_BALL_POS_KEY, JSON.stringify({ left, top, tucked: !!tucked, side: side || null })); } catch (_) {}
  }

  // Tham số neo cạnh
  const WE_TUCK_EDGE = 28;    // Cách mép bao gần thì tính là "neo"
  const WE_TUCK_HANDLE = 15;  // Chiều rộng dải nhỏ lộ ra sau khi thu vào
  const WE_TUCK_INSET = 8;    // Khoảng trống cách mép sau khi kéo ra

  function applyBallTuck(ball, side) {
    const vw = window.innerWidth;
    const size = ball.offsetWidth || 52;
    ball.classList.add('we-ball-tucked');
    ball.classList.toggle('we-ball-tucked-left', side === 'left');
    ball.classList.toggle('we-ball-tucked-right', side === 'right');
    ball.style.left = (side === 'left' ? (WE_TUCK_HANDLE - size) : (vw - WE_TUCK_HANDLE)) + 'px';
  }

  function untuckBall(ball) {
    const pos = loadBallPos() || {};
    const vw = window.innerWidth, vh = window.innerHeight, size = ball.offsetWidth || 52;
    let left = typeof pos.left === 'number' ? pos.left : (vw - size - 18);
    let top = typeof pos.top === 'number' ? pos.top : (vh - size - 90);
    left = Math.max(4, Math.min(left, vw - size - 4));
    top = Math.max(4, Math.min(top, vh - size - 4));
    ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
    ball.style.left = left + 'px';
    ball.style.top = top + 'px';
    saveBallPos(left, top, false, null);
  }

  function applyBallPos(ball) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const size = ball.offsetWidth || 52;
    let pos = loadBallPos();
    if (!pos) pos = { left: vw - size - 44, top: vh - size - 90 };
    // Kẹp vào vùng nhìn thấy được, tránh kéo ra ngoài màn hình mà không tìm lại được
    pos.left = Math.max(4, Math.min(pos.left, vw - size - 4));
    pos.top = Math.max(4, Math.min(pos.top, vh - size - 4));
    ball.style.top = pos.top + 'px';
    ball.style.right = 'auto';
    ball.style.bottom = 'auto';
    if (pos.tucked && (pos.side === 'left' || pos.side === 'right')) {
      ball.style.left = pos.left + 'px';   // Vị trí ghi lại là "sau khi kéo ra"
      applyBallTuck(ball, pos.side);        // Về mặt hình ảnh thu vào mép
    } else {
      ball.classList.remove('we-ball-tucked', 'we-ball-tucked-left', 'we-ball-tucked-right');
      ball.style.left = pos.left + 'px';
    }
  }

  function makeBallDraggable(ball) {
    let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
    const onDown = (e) => {
      const pt = e.touches ? e.touches[0] : e;
      dragging = true; moved = false;
      sx = pt.clientX; sy = pt.clientY;
      const rect = ball.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      ball.classList.add('we-ball-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - sx, dy = pt.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (e.cancelable) e.preventDefault();
      const size = ball.offsetWidth || 52;
      let left = Math.max(4, Math.min(ox + dx, window.innerWidth - size - 4));
      let top = Math.max(4, Math.min(oy + dy, window.innerHeight - size - 4));
      ball.style.left = left + 'px';
      ball.style.top = top + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      ball.classList.remove('we-ball-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      if (!moved) return;
      const vw = window.innerWidth, size = ball.offsetWidth || 52;
      const left = parseFloat(ball.style.left) || 0;
      const top = parseFloat(ball.style.top) || 0;
      if (left <= WE_TUCK_EDGE) {                          // Sát mép trái → thu vào bên trái
        saveBallPos(WE_TUCK_INSET, top, true, 'left');
        applyBallTuck(ball, 'left');
      } else if (left >= vw - size - WE_TUCK_EDGE) {        // Sát mép phải → thu vào bên phải
        saveBallPos(vw - size - WE_TUCK_INSET, top, true, 'right');
        applyBallTuck(ball, 'right');
      } else {
        saveBallPos(left, top, false, null);
      }
    };
    ball.addEventListener('mousedown', onDown);
    ball.addEventListener('touchstart', onDown, { passive: true });
    // Xử lý nhấn: sau khi kéo thì không tính là nhấn; đã thu vào thì "kéo ra" thay vì mở bảng điều khiển
    ball.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopImmediatePropagation(); moved = false; return; }
      if (ball.classList.contains('we-ball-tucked')) {
        e.preventDefault(); e.stopImmediatePropagation();
        untuckBall(ball);
      }
    }, true);
  }

  function observeInputButton() {
    if (inputButtonObserver || !document.body) return;
    inputButtonObserver = new MutationObserver(() => {
      if (!document.getElementById('we-input-btn')) {
        clearTimeout(inputButtonRetryTimer);
        inputButtonRetryTimer = setTimeout(buildInputButton, 50);
      }
    });
    inputButtonObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Phân tích văn bản trạng thái diễn biến → chuyển đổi hình dạng quả cầu + vòng tiến độ
  function setBallState(text, isError) {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    const ring = ball.querySelector('.we-ball-ring');
    const badge = ball.querySelector('.we-ball-badge');
    // Quả cầu nổi không hiển thị chữ trạng thái (chữ hiển thị ở banner trên cùng màn hình)

    ball.classList.remove('we-ball-evolving', 'we-ball-success', 'we-ball-fail');
    clearTimeout(_ballStatusTimer);

    const count = ball.querySelector('.we-ball-count');
    const clearCount = () => {
      ball.classList.remove('we-ball-counting');
      if (count) count.textContent = '';
      if (ring) ring.style.setProperty('--we-ring-pct', '0deg');
    };

    if (/Đang điền lại/.test(text)) {
      // Điền lại hàng loạt: quả cầu xoay liên tục + góc dưới phải hiện tiến độ "đợt/tổng"
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      const mb = /(\d+)\s*\/\s*(\d+)/.exec(text);
      if (mb && ring) {
        const cur = Number(mb[1]), total = Number(mb[2]) || 1;
        const pct = Math.max(0, Math.min(1, cur / total));
        ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
        ball.classList.add('we-ball-counting');
        if (count) count.textContent = `${cur}/${total}`;
      } else {
        clearCount();
      }
    } else if (/Đang diễn biến/.test(text)) {
      ball.classList.add('we-ball-evolving');
      if (badge) badge.textContent = '';
      clearCount(); // Đang diễn biến thì không hiển thị đếm số vòng, tránh sót lại N/X cũ
    } else if (isError || /thất bại|Lỗi khi/i.test(text)) {
      ball.classList.add('we-ball-fail');
      if (badge) badge.textContent = '✕';
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 6000);
    } else if (/hoàn tất/i.test(text)) {
      ball.classList.add('we-ball-success');
      if (badge) badge.textContent = '✓';
      clearCount(); // Diễn biến hoàn tất → số đếm về 0, xóa vòng tiến độ và số
      _ballStatusTimer = setTimeout(() => clearBallBadge(), 4000);
    }

    // Phân tích "Vòng N/X" → vòng tiến độ + số (chỉ hiển thị ở trạng thái thông báo chưa đến lúc diễn biến)
    const m = /Vòng\s*(\d+)\s*\/\s*(\d+)/.exec(text || '');
    if (ring && m) {
      const cur = Number(m[1] ?? m[3]), total = Number(m[2] ?? m[4]) || 1;
      const pct = Math.max(0, Math.min(1, cur / total));
      ring.style.setProperty('--we-ring-pct', (pct * 360) + 'deg');
      ball.classList.toggle('we-ball-counting', cur > 0 && cur < total);
      if (count) count.textContent = (cur < total) ? `${cur}/${total}` : '';
    }

    // Đầu hàm này xoá we-ball-evolving, mà mọi thông báo trạng thái đều đi qua đây — kể cả thông báo
    // phát ra GIỮA LÚC engine đang chạy. Không dựng lại thì chính thông báo tiến độ lại dập tắt hoạt
    // ảnh xoay. Engine nào đang chạy là do hook isRunning của mặt đó quyết định, nên hỏi lại nó ở đây.
    updateBallControls();
  }

  function clearBallBadge() {
    const ball = document.getElementById('we-input-btn');
    if (!ball) return;
    ball.classList.remove('we-ball-success', 'we-ball-fail');
    const badge = ball.querySelector('.we-ball-badge');
    if (badge) badge.textContent = '';
  }

  // Banner trạng thái ngay đầu màn hình: hiển thị khoảng 5s rồi mờ dần
  let _topStatusTimer = null;
  function showTopStatus(text, isError) {
    if (!document.body || !text) return;
    let el = document.getElementById('we-top-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'we-top-status';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle('we-top-status-error', !!isError);
    el.classList.add('show');
    clearTimeout(_topStatusTimer);
    _topStatusTimer = setTimeout(() => { el.classList.remove('show'); }, 5000);
  }

  // Gắn sự kiện cho năm nút vệ tinh của quả cầu nổi; chặn bubbling, tránh kích hoạt kéo thả / mở bảng điều khiển
  function wireSatellites(ball) {
    const wire = (id, fn) => {
      const el = ball.querySelector('#' + id);
      if (!el) return;
      const stop = e => e.stopPropagation();
      el.addEventListener('mousedown', stop);
      el.addEventListener('touchstart', stop, { passive: true });
      el.addEventListener('click', (e) => {
        e.stopPropagation(); e.preventDefault();
        if (el.classList.contains('we-sat-off')) return;
        fn();
      });
    };
    wire('we-sat-forward', () => {
      callEngineFaceAction(getEngineFace(), 'forward');
    });
    wire('we-sat-redo', () => {
      callEngineFaceAction(getEngineFace(), 'redo');
    });
    wire('we-sat-abort', () => {
      const face = getEngineFace();
      const done = result => { if (result !== ENGINE_ACTION_FAILED) showToast('Đã gửi tín hiệu dừng'); };
      const result = callEngineFaceAction(face, 'abort');
      if (result && typeof result.then === 'function') result.then(done);
      else done(result);
    });

    // "Phích cắm" theo mặt quả cầu hiện tại: mặt thế giới sửa world_engine_settings, mặt nhân vật sửa npc_engine_settings.
    // Mỗi engine đã đăng ký tự quản lý công tắc tổng riêng, và không ghi đè chế độ diễn biến và tùy chọn chèn mà người dùng đã chọn.
    //   Không dùng we-sat-off (bên trong wire sẽ chặn we-sat-off không cho bấm); dùng class .on để đánh dấu trạng thái tắt, power luôn bấm được.
    wire('we-sat-power', () => {
      const face = getEngineFace();
      const turnOff = getFaceSettings().engineEnabled !== false;
      const finish = result => {
        if (result === ENGINE_ACTION_FAILED) return;
        updateBallControls();
        showToast(turnOff ? `Đã tắt diễn biến và chèn của ${face.label}` : `Đã bật diễn biến và chèn của ${face.label}`);
        if (typeof _currentView !== 'undefined' && _currentView === 'settings') refresh();
      };
      const result = callEngineFaceAction(face, 'setEnabled', !turnOff);
      if (result && typeof result.then === 'function') result.then(finish);
      else finish(result);
    });
    wire('we-sat-engine-switch', () => {
      const shortcut = ball.querySelector('#we-sat-engine-switch');
      switchEngineFace(shortcut?.dataset.targetEngine || (getEngineFace().id === 'npc' ? 'world' : 'npc'));
    });
  }

  function buildInputButton() {
    if (!document.body) return;

    let btn = document.getElementById('we-input-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'we-input-btn';
      btn.type = 'button';
      btn.title = 'World Engine';
      btn.setAttribute('aria-label', 'World Engine');
      btn.className = 'we-ball';
      btn.innerHTML =
        '<span class="we-ball-orbit"></span>' +
        '<span class="we-ball-ring"></span>' +
        '<span class="we-ball-core"><span class="we-ball-globe"></span><span class="we-ball-npc"><span class="we-npc-scan"></span></span></span>' +
        '<span class="we-ball-count"></span>' +
        '<span class="we-ball-badge"></span>' +
        '<span class="we-ball-tip"></span>' +
        '<span class="we-sat we-sat-up" id="we-sat-forward" role="button" title="Diễn Biến Tiến"><i class="fa-solid fa-forward"></i></span>' +
        '<span class="we-sat we-sat-right we-sat-off" id="we-sat-abort" role="button" title="Dừng Diễn Biến"><i class="fa-solid fa-stop"></i></span>' +
        '<span class="we-sat we-sat-down" id="we-sat-redo" role="button" title="Diễn Biến Lại"><i class="fa-solid fa-rotate-right"></i></span>' +
        '<span class="we-sat we-sat-left" id="we-sat-power" role="button" title="Cắm Vào = Tắt Diễn Biến Và Chèn / Rút Ra = Bật"><i class="fa-solid fa-power-off"></i></span>' +
        '<span class="we-sat we-sat-lower-right we-sat-engine-switch" id="we-sat-engine-switch" role="button"></span>';
      btn.onclick = () => togglePanel();
      document.body.appendChild(btn);
      wireSatellites(btn);
      syncBallFace();
      applyBallPos(btn);
      makeBallDraggable(btn);
      window.addEventListener('resize', () => applyBallPos(btn));
      setEvolvingUI(isEvolving || Boolean(evolution?.isRunning?.()));
    } else if (btn.parentElement !== document.body) {
      document.body.appendChild(btn);
      applyBallPos(btn);
    }

    // Tương thích với giao diện trạng thái ngoài cũ: giữ lại phần tử ẩn, chuyển tiếp đến máy trạng thái quả cầu
    let statusIndicator = document.getElementById('we-external-status');
    if (!statusIndicator) {
      statusIndicator = document.createElement('span');
      statusIndicator.id = 'we-external-status';
      statusIndicator.style.display = 'none';
      document.body.appendChild(statusIndicator);
    }

    window.__WE_SetExternalStatus = function(text, isError) {
      const el = document.getElementById('we-external-status');
      if (el) el.textContent = text;
      setBallState(text || '', !!isError);
      // Loại tiến độ (Vòng/Ngày N/X, đang điền lại i/M) chỉ hiển thị trên quả cầu nổi; các trạng thái khác đi qua banner trên cùng màn hình
      if (text && !/Vòng\s*\d+\s*\/\s*\d+|Ngày\s*\d+\s*\/\s*\d+/.test(text) && !/Đang điền lại/.test(text)) {
        showTopStatus(text, !!isError);
      }
    };

    buildPanel();
    observeInputButton();
  }

  // ==================== Công Cụ Nhân Vật (NPC Engine) ====================

  const NPC_THEME_KEY = 'npc-engine-theme';

  function getStoredNpcTheme() {
    try { return localStorage.getItem(NPC_THEME_KEY) || 'night'; }
    catch (error) { return 'night'; }
  }

  const NPC_VIEW_META = {
    core: { title: 'Trọng Yếu', poem: 'Người đáng nhớ thì thế gian nhớ' },
    peripheral: { title: 'Ngoại Vi', poem: 'Chưa rõ chí hướng, hãy còn đợi thời' },
    archive: { title: 'Kho Lưu Trữ', poem: 'Người đi rồi, tiếng vẫn còn' },
    rumors: { title: 'Tin Đồn', poem: 'Lời truyền đi xa hơn chân người' }
  };

  const npcData = () => window.NPC_ENGINE_DATA;
  const npcSettings = () => window.NPC_ENGINE_SETTINGS?.getSettings?.(true) || {};

  function npcPath(path) {
    const parts = (Array.isArray(path) ? path : []).map(part => String(part || '').trim()).filter(Boolean);
    return parts.length ? parts.join(' › ') : 'chưa rõ';
  }

  function renderNpcView() {
    if (_npcSettingsOpen) return renderNpcSettingsView();
    if (_npcView === 'home') return renderNpcHomeView();
    return renderNpcSubView(_npcView);
  }

  function renderNpcHomeView() {
    const state = npcData()?.loadState?.() || {};
    const npcs = Array.isArray(state.npcs) ? state.npcs : [];
    const core = npcs.filter(npc => npc.tier === 'core');
    const peripheral = npcs.filter(npc => npc.tier !== 'core');
    const archive = Array.isArray(state.archive) ? state.archive : [];
    const rumors = Array.isArray(state.rumorQueue) ? state.rumorQueue : [];
    const limit = Math.max(1, parseInt(npcSettings().npcCoreLimit) || 12);

    const moving = core.filter(npc => npc.location?.movingTo && npc.location.etaRounds > 0).length;
    const stats = [
      { label: 'Trọng Yếu', value: `${core.length}/${limit}` },
      { label: 'Đang Di Chuyển', value: String(moving) },
      { label: 'Lượt', value: String(state.round || 0) }
    ];

    // Vòng tiến độ: cho thấy ngay ngân sách NPC trọng yếu còn bao nhiêu chỗ, vì đó là con số
    // quyết định độ dài khối chèn và ai được sinh hoạt động ngầm.
    const ratio = Math.max(0, Math.min(1, core.length / limit));
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const dash = (circumference * ratio).toFixed(1);
    const ringColor = ratio >= 1 ? 'var(--we-danger)' : (ratio >= 0.8 ? 'var(--we-gold)' : 'var(--we-accent)');
    const ring = `<div class="we-npc-ring">
      <svg viewBox="0 0 160 160" width="130" height="130">
        <circle cx="80" cy="80" r="${radius}" fill="none" stroke="var(--we-ring-track)" stroke-width="8"/>
        <circle cx="80" cy="80" r="${radius}" fill="none" stroke="${ringColor}" stroke-width="8" stroke-linecap="round"
          stroke-dasharray="${dash} ${(circumference - circumference * ratio).toFixed(1)}" transform="rotate(-90 80 80)"/>
      </svg>
      <div class="we-npc-ring-text">
        <div class="we-npc-ring-value">${core.length}<span>/${limit}</span></div>
        <div class="we-npc-ring-label">Trọng Yếu</div>
      </div>
    </div>`;

    const counts = { core: core.length, peripheral: peripheral.length, archive: archive.length, rumors: rumors.length };
    const rows = ['core', 'peripheral', 'archive', 'rumors'].map((view, index, all) => {
      const meta = NPC_VIEW_META[view];
      const selected = _npcSelectedNavView === view ? ' we-nav-row--selected' : '';
      const topLine = index === 0 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      const bottomLine = index === all.length - 1 ? '<div class="we-nav-line we-nav-line-hidden"></div>' : '<div class="we-nav-line"></div>';
      return `<div class="we-nav-row we-npc-nav-row${selected}" data-npc-view="${view}">
        <div class="we-nav-label">${meta.title}</div>
        <div class="we-nav-track">${topLine}<div class="we-nav-dot"></div>${bottomLine}</div>
        <div class="we-nav-content"><span class="we-nav-sub">${counts[view]} mục</span><span class="we-nav-poem">${meta.poem}</span></div>
        <i class="fa-solid fa-chevron-right we-nav-arrow"></i>
      </div>`;
    }).join('');

    return '<div class="we-npc-home">'
      + ring
      + '<div class="we-npc-core">' + stats.map(stat =>
          `<div class="we-npc-stat"><div class="we-npc-stat-value">${h(stat.value)}</div><div class="we-npc-stat-label">${h(stat.label)}</div></div>`
        ).join('') + '</div>'
      + '<div class="we-nav-list we-npc-nav-list">' + rows + '</div>'
      + '</div>';
  }

  // ===== Trình soạn hồ sơ nhân vật =====
  // Mô hình chấm sai thì phải có đường chữa: sửa tên, bậc, vị trí, mục tiêu, tri thức, hoặc xoá hẳn
  // nhân vật bị nhận nhầm. Danh sách dùng ô nhiều dòng, mỗi dòng một mục — ít mã hơn kiểu từng hàng
  // riêng mà vẫn sửa hàng loạt được bằng dán đè.
  function npcListToText(list, format) {
    return (Array.isArray(list) ? list : []).map(format).filter(Boolean).join('\n');
  }

  function npcTextToGoals(text) {
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [goal, progress] = line.split('|').map(part => (part || '').trim());
      return { text: goal, progress: progress || 'đang tiến hành' };
    });
  }

  function npcTextToKnowledge(text, existing) {
    const known = new Map((Array.isArray(existing) ? existing : []).map(item => [String(item.fact || '').trim(), item]));
    return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
      const [fact, source, certainty] = line.split('|').map(part => (part || '').trim());
      // Giữ nguyên layer và factId của mục cũ, nếu không thì phép lùi tầng và ràng buộc tri thức hỏng.
      const old = known.get(fact);
      return {
        fact,
        source: source || old?.source || 'chứng kiến',
        certainty: certainty || old?.certainty || 'chắc chắn',
        layer: old?.layer ?? null,
        factId: old?.factId ?? null
      };
    });
  }

  function renderNpcEditor(npc, isNew) {
    const location = npc.location || {};
    const faction = npc.faction || {};
    const user = npc.relations?.user || {};
    const status = npc.status || {};
    const row = inner => `<div class="we-input-group">${inner}</div>`;
    const field = (label, inner, note) => row(`<label>${h(label)}</label>${inner}`
      + (note ? `<div class="we-hint">${h(note)}</div>` : ''));

    return `<div class="we-npc-editor" data-npc-editor="${h(npc.id || '')}">
      ${field('Tên Và Biệt Danh (phân cách bằng /)',
        `<input class="we-npc-f-names" type="text" value="${u([npc.name, ...(npc.aliases || [])].filter(Boolean).join(' / '))}" placeholder="Lý Mộ Bạch / Lý đại hiệp" style="width:100%;">`,
        'Tên đầu tiên là tên chính, phần còn lại là biệt danh dùng để nhận diện.')}
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">${field('Bậc',
          `<select class="we-npc-f-tier" style="width:100%;">
            <option value="core" ${npc.tier === 'core' ? 'selected' : ''}>Trọng yếu</option>
            <option value="peripheral" ${npc.tier !== 'core' ? 'selected' : ''}>Ngoại vi</option>
          </select>`)}</div>
        <div style="flex:1;">${field('Điểm thiết yếu',
          `<input class="we-npc-f-significance" type="number" min="0" max="100" value="${h(String(npc.significance || 0))}" style="width:100%;">`)}</div>
      </div>
      ${row(`<label class="we-switch-row"><input class="we-npc-f-pinned" type="checkbox" ${npc.pinned ? 'checked' : ''}> Ghim bậc (mô hình không đổi được)</label>`)}
      ${field('Vị trí (phân cấp, ngăn bằng ›)',
        `<input class="we-npc-f-path" type="text" value="${u(npcPath(location.path) === 'chưa rõ' ? '' : npcPath(location.path))}" placeholder="Đại Chu › Giang Nam › Dương Châu" style="width:100%;">`,
        'Từ lớn tới nhỏ: quốc gia › vùng › thành › địa điểm. Độ gần giữa hai nhân vật suy ra từ đây.')}
      ${field('Chỗ người chơi tưởng nhân vật đang ở',
        `<input class="we-npc-f-believes" type="text" value="${u(location.userBelievesAt || '')}" placeholder="Bỏ trống nếu trùng vị trí thật" style="width:100%;">`,
        'Khác vị trí thật thì chế độ che sương mù sẽ chỉ nói chỗ này cho AI.')}
      <div style="display:flex;gap:6px;">
        <div style="flex:2;">${field('Đang trên đường tới',
          `<input class="we-npc-f-moving" type="text" value="${u(location.movingTo ? npcPath(location.movingTo) : '')}" placeholder="Bỏ trống nếu đang đứng yên" style="width:100%;">`)}</div>
        <div style="flex:1;">${field('Còn (lượt)',
          `<input class="we-npc-f-eta" type="number" min="0" value="${h(String(location.etaRounds || 0))}" style="width:100%;">`)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">${field('Thế lực', `<input class="we-npc-f-faction" type="text" value="${u(faction.name || '')}" style="width:100%;">`)}</div>
        <div style="flex:1;">${field('Vai trò', `<input class="we-npc-f-role" type="text" value="${u(faction.role || '')}" style="width:100%;">`)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <div style="flex:2;">${field('Thái độ với người chơi', `<input class="we-npc-f-attitude" type="text" value="${u(user.attitude || '')}" style="width:100%;">`)}</div>
        <div style="flex:1;">${field('Tin cậy', `<input class="we-npc-f-trust" type="number" value="${h(String(user.trust || 0))}" style="width:100%;">`)}</div>
      </div>
      <div style="display:flex;gap:6px;">
        <div style="flex:1;">${field('Tình trạng', `<input class="we-npc-f-condition" type="text" value="${u(status.condition || '')}" style="width:100%;">`)}</div>
        <div style="flex:1;">${field('Tài nguyên', `<input class="we-npc-f-resources" type="text" value="${u(status.resources || '')}" style="width:100%;">`)}</div>
      </div>
      ${row(`<label class="we-switch-row"><input class="we-npc-f-alive" type="checkbox" ${status.alive !== false ? 'checked' : ''}> Còn sống</label>`)}
      ${field('Mục tiêu (mỗi dòng một mục: nội dung | tiến triển)',
        `<textarea class="we-npc-f-goals" rows="3" style="width:100%;">${h(npcListToText(npc.goals, g => g.text ? `${g.text} | ${g.progress || 'đang tiến hành'}` : ''))}</textarea>`)}
      ${field('Tri thức (mỗi dòng: điều đã biết | nguồn | độ chắc)',
        `<textarea class="we-npc-f-knowledge" rows="4" style="width:100%;">${h(npcListToText(npc.knowledge, k => k.fact ? `${k.fact} | ${k.source || ''} | ${k.certainty || ''}`.replace(/\s*\|\s*$/, '') : ''))}</textarea>`,
        'Nguồn: chứng kiến / nghe đồn / suy đoán. Đây là thứ quyết định nhân vật được phép nhắc tới điều gì.')}
      <div class="we-npc-editor-actions">
        <button class="we-btn we-npc-cancel-edit" type="button">Huỷ</button>
        ${isNew ? '' : '<button class="we-btn we-btn-danger we-npc-delete" type="button">Xoá hẳn</button>'}
        <button class="we-btn we-btn-primary we-npc-save" type="button">Lưu</button>
      </div>
    </div>`;
  }

  // Đọc ngược từ ô nhập về đối tượng nhân vật. Giữ nguyên những trường trình soạn không đụng tới
  // (offscreenLog, pendingIntent, travelMode, fogSince, quan hệ với NPC khác).
  function readNpcEditor(root, base) {
    const value = selector => (root.querySelector(selector)?.value || '').trim();
    const checked = selector => root.querySelector(selector)?.checked === true;
    const splitPath = text => text.split(/[›>\/]/).map(part => part.trim()).filter(Boolean);

    const names = value('.we-npc-f-names').split('/').map(part => part.trim()).filter(Boolean);
    const moving = splitPath(value('.we-npc-f-moving'));
    const eta = Math.max(0, parseInt(value('.we-npc-f-eta')) || 0);

    return {
      ...base,
      name: names[0] || base.name,
      aliases: names.slice(1),
      tier: value('.we-npc-f-tier') === 'core' ? 'core' : 'peripheral',
      significance: Math.min(100, Math.max(0, parseInt(value('.we-npc-f-significance')) || 0)),
      pinned: checked('.we-npc-f-pinned'),
      location: {
        ...(base.location || {}),
        path: splitPath(value('.we-npc-f-path')),
        userBelievesAt: value('.we-npc-f-believes'),
        movingTo: moving.length ? moving : null,
        etaRounds: moving.length ? eta : 0
      },
      faction: { ...(base.faction || {}), name: value('.we-npc-f-faction'), role: value('.we-npc-f-role') },
      relations: {
        ...(base.relations || {}),
        user: {
          ...((base.relations || {}).user || {}),
          attitude: value('.we-npc-f-attitude'),
          trust: parseInt(value('.we-npc-f-trust')) || 0
        }
      },
      status: {
        ...(base.status || {}),
        condition: value('.we-npc-f-condition'),
        resources: value('.we-npc-f-resources'),
        alive: checked('.we-npc-f-alive')
      },
      goals: npcTextToGoals(value('.we-npc-f-goals')),
      knowledge: npcTextToKnowledge(value('.we-npc-f-knowledge'), base.knowledge)
    };
  }

  function renderNpcCard(npc, options) {
    const key = String(npc.id || npc.name);
    const collapsed = !_npcExpanded.has(key);
    const location = npc.location || {};
    const inTransit = location.movingTo && location.etaRounds > 0;

    const badges = [];
    if (npc.pinned) badges.push('<span class="we-npc-badge we-npc-badge-pin">ghim</span>');
    if (inTransit) badges.push(`<span class="we-npc-badge we-npc-badge-move">đi đường · ${location.etaRounds} lượt</span>`);
    if (npc.status?.alive === false) badges.push('<span class="we-npc-badge we-npc-badge-dead">đã chết</span>');

    const axes = [];
    axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Vị trí</span><span>${h(npcPath(location.path))}${
      inTransit ? ` → ${h(npcPath(location.movingTo))} (còn ${location.etaRounds} lượt)` : ''}</span></div>`);

    if (location.userBelievesAt && location.userBelievesAt !== npcPath(location.path)) {
      axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Người chơi tưởng</span><span>${h(location.userBelievesAt)}</span></div>`);
    }

    const goals = (Array.isArray(npc.goals) ? npc.goals : []).slice(0, 4)
      .map(goal => `${h(goal.text || '')} <em>(${h(goal.progress || 'đang tiến hành')})</em>`).join('<br>');
    if (goals) axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Mục tiêu</span><span>${goals}</span></div>`);

    if (npc.faction?.name) {
      axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Thế lực</span><span>${h(npc.faction.name)}${
        npc.faction.role ? ' — ' + h(npc.faction.role) : ''}${npc.faction.standing ? ' (' + h(npc.faction.standing) + ')' : ''}</span></div>`);
    }
    if (npc.relations?.user?.attitude) {
      axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Với người chơi</span><span>${h(npc.relations.user.attitude)}${
        npc.relations.user.lastChangeReason ? ' — ' + h(npc.relations.user.lastChangeReason) : ''}</span></div>`);
    }

    const knowledge = (Array.isArray(npc.knowledge) ? npc.knowledge : []).slice(-5)
      .map(item => `${h(item.fact || '')} <em>(${h(item.source || '')})</em>`).join('<br>');
    if (knowledge) axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Biết</span><span>${knowledge}</span></div>`);

    if (npc.status?.condition) {
      axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Trạng thái</span><span>${h(npc.status.condition)}${
        npc.status.resources ? ' · ' + h(npc.status.resources) : ''}</span></div>`);
    }
    if (npc.pendingIntent?.action) {
      axes.push(`<div class="we-npc-axis"><span class="we-npc-axis-key">Dự định</span><span>${h(npc.pendingIntent.action)}</span></div>`);
    }

    const log = (Array.isArray(npc.offscreenLog) ? npc.offscreenLog : []).slice(-6).reverse()
      .map(entry => `<div class="we-npc-log-row"><span class="we-npc-log-layer">tầng ${entry.layer ?? '?'}</span>${h(entry.action || '')}</div>`).join('');

    const actions = options?.archived
      ? `<button class="we-btn we-btn-sm we-npc-edit" data-npc-id="${h(key)}">Sửa</button>
         <button class="we-btn we-btn-sm we-npc-revive" data-npc-id="${h(key)}">Đưa trở lại</button>`
      : `<button class="we-btn we-btn-sm we-npc-edit" data-npc-id="${h(key)}">Sửa</button>
         <button class="we-btn we-btn-sm we-npc-pin" data-npc-id="${h(key)}">${npc.pinned ? 'Bỏ ghim' : 'Ghim'}</button>
         <button class="we-btn we-btn-sm we-npc-tier" data-npc-id="${h(key)}">${npc.tier === 'core' ? 'Hạ xuống ngoại vi' : 'Nâng lên trọng yếu'}</button>
         <button class="we-btn we-btn-sm we-npc-archive" data-npc-id="${h(key)}">Đưa vào kho</button>`;

    // Đang sửa thì thay toàn bộ phần thân bằng trình soạn, giữ lại phần đầu để còn biết đang sửa ai.
    if (_npcEditingId === key) {
      return `<div class="we-npc-card">
        <div class="we-npc-card-head"><div class="we-npc-name">${h(npc.name || 'không tên')}</div></div>
        <div class="we-npc-card-body">${renderNpcEditor(npc, false)}</div>
      </div>`;
    }

    return `<div class="we-npc-card${collapsed ? ' is-collapsed' : ''}">
      <div class="we-npc-card-head" data-npc-toggle="${h(key)}">
        <div class="we-npc-name">${h(npc.name || 'không tên')}${
          npc.aliases?.length ? `<span class="we-npc-alias">${h(npc.aliases.join(' / '))}</span>` : ''}</div>
        <div class="we-npc-badges">${badges.join('')}<span class="we-npc-score">${parseInt(npc.significance) || 0}</span></div>
        <i class="fa-solid fa-chevron-${collapsed ? 'right' : 'down'}"></i>
      </div>
      <div class="we-npc-card-body"${collapsed ? ' hidden' : ''}>
        ${axes.join('')}
        ${log ? `<div class="we-npc-log"><div class="we-npc-axis-key">Hoạt động ngầm</div>${log}</div>` : ''}
        <div class="we-npc-actions">${actions}</div>
      </div>
    </div>`;
  }

  function renderNpcSubView(view) {
    // Đổi cuộc trò chuyện thì quên hết trạng thái gập/mở và trình soạn đang mở của chat cũ,
    // nếu không khoá của chat trước dồn lại mãi và có thể mở nhầm hồ sơ.
    const scope = String(window.WORLD_ENGINE_CORE?.getChatId?.() || 'default');
    if (_npcExpandScope !== scope) {
      _npcExpandScope = scope;
      _npcExpanded.clear();
      _npcEditingId = null;
    }
    const state = npcData()?.loadState?.() || {};
    const meta = NPC_VIEW_META[view] || { title: 'Nhân Vật', poem: '' };
    let body = '';

    if (view === 'rumors') {
      const rumors = (Array.isArray(state.rumorQueue) ? state.rumorQueue : []).slice().reverse();
      body = rumors.length
        ? rumors.map(item => `<div class="we-npc-rumor"><span class="we-npc-log-layer">tầng ${item.layer ?? '?'}</span>${h(item.text || '')}</div>`).join('')
        : '<div class="we-empty">Chưa có tin đồn nào</div>';
    } else {
      const source = view === 'archive'
        ? (Array.isArray(state.archive) ? state.archive : [])
        : (Array.isArray(state.npcs) ? state.npcs : []).filter(npc => view === 'core' ? npc.tier === 'core' : npc.tier !== 'core');
      // Thêm tay: mô hình bỏ sót ai thì tự nhập, không phải chờ nó nhận ra.
      const adding = _npcEditingId === ''
        ? `<div class="we-npc-card"><div class="we-npc-card-head"><div class="we-npc-name">Nhân vật mới</div></div>
             <div class="we-npc-card-body">${renderNpcEditor(
               npcData().newNpc({ tier: view === 'core' ? 'core' : 'peripheral' }), true)}</div></div>`
        : `<button class="we-btn we-npc-add" type="button" style="width:100%;margin-bottom:8px;"><i class="fa-solid fa-plus"></i> Thêm Nhân Vật</button>`;
      body = adding + (source.length
        ? source.map(npc => renderNpcCard(npc, { archived: view === 'archive' })).join('')
        : '<div class="we-empty">Chưa có nhân vật nào ở mục này</div>');
    }

    return `<div class="we-sub-topbar">
        <button class="we-icon-btn" id="we-npc-btn-back" type="button" title="Quay Lại"><i class="fa-solid fa-arrow-left"></i></button>
        <span class="we-sub-title">${h(meta.title)}</span>
        <span class="we-npc-sub-poem">${h(meta.poem)}</span>
      </div>
      <div class="we-npc-subview"><div class="we-npc-list">${body}</div></div>`;
  }

  const NPC_SETTINGS_TABS = [
    { key: 'common',    label: 'Thường Dùng' },
    { key: 'link',      label: 'Liên Kết' },
    { key: 'advanced',  label: 'Nâng Cao' },
    { key: 'archive',   label: 'Lưu Trữ' },
    { key: 'worldbook', label: 'Worldbook' },
    { key: 'debug',     label: 'Gỡ Lỗi' },
    { key: 'about',     label: 'Giới Thiệu' }
  ];

  // ===== Bản lưu theo cuộc trò chuyện =====
  // Phần backend đã có sẵn trong world-engine-chatcache.js với phạm vi riêng 'npc'; trước đây
  // không có giao diện nào chạm tới, nên code chạy được mà không ai gọi.
  function npcCache() {
    try { return window.WORLD_ENGINE_CHATCACHE?.forScope?.('npc') || null; }
    catch (error) { return null; }
  }

  function renderNpcSnapshotRows() {
    const list = npcCache()?.listSnapshots?.() || [];
    if (!list.length) return '<div class="we-empty">Chưa có bản lưu nào</div>';
    return list.map(item => {
      let time = '';
      try { time = new Date(item.createdAt).toLocaleString(); } catch (error) {}
      return '<div class="we-snapshot-row" data-npc-snap-id="' + u(item.id) + '">'
        + '<div class="we-snapshot-main">'
        + '<div class="we-snapshot-name"><span class="we-snapshot-badge' + (item.auto ? ' is-auto' : '') + '">'
        + (item.auto ? 'Tự Động' : 'Thủ Công') + '</span>' + h(item.name) + '</div>'
        + '<div class="we-snapshot-meta">Lượt ' + (item.round || 0) + ' · ' + (Number(item.characters) || 0)
        + ' nhân vật · ' + (Number(item.entities) || 0) + ' trong kho' + (time ? ' · ' + h(time) : '') + '</div>'
        + '</div><div class="we-snapshot-actions">'
        + '<button class="we-icon-btn" data-npc-snap-action="restore" title="Khôi Phục"><i class="fa-solid fa-rotate-left"></i></button>'
        + '<button class="we-icon-btn" data-npc-snap-action="rename" title="Đổi Tên"><i class="fa-solid fa-pen"></i></button>'
        + '<button class="we-icon-btn" data-npc-snap-action="export" title="Xuất Bản Lưu"><i class="fa-solid fa-download"></i></button>'
        + '<button class="we-icon-btn" data-npc-snap-action="delete" title="Xoá"><i class="fa-solid fa-trash"></i></button>'
        + '</div></div>';
    }).join('');
  }

  function refreshNpcSnapshots() {
    const list = document.getElementById('we-npc-snapshot-list');
    if (list) list.innerHTML = renderNpcSnapshotRows();
    const status = document.getElementById('we-npc-cache-status');
    const info = npcCache()?.getStatus?.();
    if (status && info) {
      status.textContent = info.usable
        ? 'Đồng bộ ' + (info.syncEnabled ? 'đã bật' : 'đã tắt') + ' · Bản sửa cục bộ ' + info.localRev
          + ' / Cloud ' + info.liveRev + ' · ' + info.snapshotCount + ' bản lưu'
        : 'Cuộc trò chuyện hiện tại không lưu được vào dữ liệu Tavern';
    }
  }

  // Tải một đối tượng xuống thành file JSON, dùng chung cho xuất hồ sơ và xuất bản lưu.
  function downloadNpcJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderNpcSettingsView() {
    const settings = npcSettings();
    const sec = (id, title, inner) =>
      '<div class="we-section"><div class="we-section-title">' + sectionHeader(title, id) + '</div>'
      + sectionBody(id, inner) + '</div>';
    const hint = note => note ? `<div class="we-hint">${note}</div>` : '';
    const text = (id, label, value, placeholder, note) => `<div class="we-input-group"><label>${h(label)}</label>
      <input type="text" id="${id}" value="${u(value || '')}" placeholder="${h(placeholder || '')}" style="width:100%;">
      ${hint(note)}</div>`;
    const num = (id, label, value, note) => `<div class="we-input-group"><label>${h(label)}</label>
      <input type="number" id="${id}" value="${h(String(value))}" style="width:100%;">${hint(note)}</div>`;
    const toggle = (id, label, checked, note) => `<div class="we-input-group">
      <label class="we-switch-row"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${h(label)}</label>
      ${hint(note)}</div>`;
    const select = (id, label, value, options, note) => `<div class="we-input-group"><label>${h(label)}</label>
      <select id="${id}" style="width:100%;">${options.map(option =>
        `<option value="${h(option[0])}" ${value === option[0] ? 'selected' : ''}>${h(option[1])}</option>`).join('')}</select>
      ${hint(note)}</div>`;
    const area = (id, label, value, placeholder, note) => `<div class="we-input-group"><label>${h(label)}</label>
      <textarea id="${id}" rows="3" placeholder="${h(placeholder || '')}" style="width:100%;">${h(value || '')}</textarea>
      ${hint(note)}</div>`;

    // ===== API riêng =====
    // Công Cụ Nhân Vật gọi API riêng, không dùng chung với Công Cụ Thế Giới, để suy diễn nhân vật
    // không tranh lượt gọi với suy diễn thế giới. Bỏ trống phần này thì engine im lặng hoàn toàn.
    const apiBody = `
      ${select('we-npc-connection-mode', 'Phương Thức Kết Nối', settings.connectionMode === 'proxy' ? 'proxy' : 'direct', [
        ['direct', 'Kết Nối Trực Tiếp (Mặc Định)'],
        ['proxy', 'Qua Proxy Của SillyTavern (Khắc Phục CORS)']
      ], 'Trình duyệt gọi thẳng tới API. Nếu console báo lỗi CORS hoặc không kết nối được, chuyển sang proxy để server SillyTavern chuyển tiếp giúp — chậm hơn một chút nhưng né được chặn của trình duyệt.')}
      ${text('we-npc-api-url', 'URL API (Tương Thích OpenAI)', settings.apiUrl, 'https://api.openai.com/v1',
        'Chỉ điền tới cấp tiền tố phiên bản, phần <code>/chat/completions</code> sẽ tự bổ sung. Ví dụ: <span style="color:var(--we-text2);">https://api.openai.com/v1</span> hoặc <span style="color:var(--we-text2);">https://openrouter.ai/api/v1</span>. Có thể dùng chung nhà cung cấp với Công Cụ Thế Giới nhưng khác model.')}
      <div class="we-input-group">
        <label>API Key</label>
        <input type="password" id="we-npc-api-key" value="${u(settings.apiKey || '')}" style="width:100%;">
        <div class="we-hint">Lưu trong bộ nhớ cục bộ của trình duyệt, không gửi đi đâu ngoài endpoint bạn điền ở trên.</div>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;align-items:end;">
        <div style="flex:1;">
          <label>Mô Hình</label>
          <input type="text" id="we-npc-model" value="${u(settings.model || 'gpt-3.5-turbo')}" placeholder="Tên mô hình" style="width:100%;">
        </div>
        <button class="we-btn" id="we-npc-fetch-models" style="white-space:nowrap;flex-shrink:0;">Lấy Danh Sách</button>
      </div>
      ${hint('Tác vụ này là trích xuất có cấu trúc, không phải sáng tác — model tầm trung, rẻ và nhanh thường cho kết quả ổn định hơn model lớn. Điều quan trọng là nó phải trả JSON đúng khuôn.')}
      <div class="we-input-group">
        <select id="we-npc-model-list" style="display:none;width:100%;margin-top:4px;">
          <option value="">-- Chọn Mô Hình --</option>
        </select>
      </div>
      <div class="we-input-group" style="display:flex;gap:6px;">
        <div style="flex:1;">${num('we-npc-temperature', 'Nhiệt Độ', settings.temperature)}</div>
        <div style="flex:1;">${num('we-npc-max-tokens', 'Giới Hạn Đầu Ra', settings.maxTokens)}</div>
      </div>
      ${hint('Nhiệt độ thấp (0.2–0.4) cho trích xuất bám sát chính văn, ít bịa. Cao hơn 0.7 thì hoạt động ngầm sáng tạo hơn nhưng dễ đi lệch truyện. Giới hạn đầu ra cần đủ lớn để chứa hồ sơ nhiều nhân vật — thiếu thì JSON bị cắt giữa chừng và hỏng.')}`;

    const runBody = toggle('we-npc-engine-enabled', 'Bật Công Cụ Nhân Vật', settings.engineEnabled !== false,
        'Tắt thì ngừng cả trích xuất lẫn chèn ràng buộc, và gỡ luôn phần đã chèn khỏi prompt. Hồ sơ nhân vật vẫn được giữ nguyên, bật lại là có ngay.')
      + toggle('we-npc-first-layer-opening', 'Tầng Đầu Là Lời Mở Đầu Của AI', settings.firstLayerIsAiOpening !== false,
        'Bật khi tin nhắn đầu tiên của cuộc trò chuyện là lời chào do thẻ nhân vật viết sẵn, không phải hội thoại thật. Khi bật, tầng 0 được bỏ qua lúc đếm lượt.');

    const filterBody = num('we-npc-core-limit', 'Số nhân vật trọng yếu tối đa', settings.npcCoreLimit,
        'Chỉ nhân vật <b>trọng yếu</b> mới sinh hoạt động ngầm và mới được đưa vào ràng buộc gửi cho AI, nên con số này quyết định trực tiếp độ dài prompt. Vượt ngưỡng thì người lâu không xuất hiện nhất bị hạ xuống ngoại vi; người được <b>ghim</b> trong hồ sơ thì miễn. Truyện ít nhân vật để 8–10, truyện quần hùng có thể lên 15–20 nhưng prompt sẽ nặng theo.')
      + num('we-npc-threshold', 'Ngưỡng điểm để lên bậc trọng yếu', settings.significanceThreshold,
        'Mô hình chấm mỗi nhân vật 0–100 theo mức thiết yếu, nhưng chỉ vượt ngưỡng này mới thành trọng yếu — không phó mặc mô hình tự quyết, vì tiêu chuẩn của nó trôi dần qua các lượt. <b>Thấy nhân vật toàn nằm ở Ngoại Vi thì hạ xuống 40–45; thấy lọt quá nhiều vai vụn thì nâng lên 70.</b>');

    const linkBody = toggle('we-npc-link', 'Thế Giới → Nhân Vật', settings.npcLinkEnabled !== false,
        'Suy diễn thế giới xong thì chạy tiếp trích xuất nhân vật và hoạt động ngầm, ngay trong cùng lượt — nhờ vậy NPC phản ứng được với diễn biến vừa xảy ra. <b>Tốn thêm một lượt gọi API mỗi turn.</b> Tắt thì hồ sơ chỉ cập nhật khi bạn bấm tay ở nút bên dưới.')
      + toggle('we-npc-to-world', 'Nhân Vật → Thế Giới', settings.injectIntoWorldEngine !== false,
        'Đưa vị trí và dự định của nhân vật trọng yếu vào prompt suy diễn thế giới, để thế giới biết ai đang toan tính gì mà sinh sự kiện cho khớp. Không tốn thêm lượt gọi API nào.')
      + num('we-npc-world-limit', 'Số nhân vật đưa sang thế giới', settings.worldEngineNpcLimit,
        'Lấy theo điểm thiết yếu từ cao xuống. Để nhỏ (5–8) là đủ; nhiều quá thì prompt suy diễn thế giới bị loãng.')
      + `<button class="we-btn we-btn-primary" id="we-npc-link-now" style="width:100%;margin-top:8px;"><i class="fa-solid fa-link"></i> Cập Nhật Hồ Sơ Nhân Vật Ngay</button>`
      + hint('Đẩy tóm tắt thế giới hiện tại sang mà không đợi lượt kế tiếp. Dùng khi vừa đổi ngưỡng lọc và muốn chấm lại ngay, hoặc khi tắt liên kết tự động. Chạy lại ở cùng tầng sẽ ghi đè kết quả lần trước, không nhân bản.');

    const offscreenBody = toggle('we-npc-offscreen', 'Cho phép nhân vật vắng mặt tự hành động', settings.offscreenEnabled !== false,
        'Đây là tính năng chính của engine. Mỗi lượt, các nhân vật trọng yếu <b>không có mặt trong cảnh</b> sẽ tự hành động theo mục tiêu của họ và theo diễn biến thế giới vừa xảy ra. Tắt thì engine chỉ còn ghi chép thụ động những gì đã diễn ra trên màn hình.')
      + num('we-npc-offscreen-max', 'Số nhân vật hành động tối đa mỗi lượt', settings.offscreenMaxPerRound,
        'Chặn trên cho mỗi lượt. Một lượt hội thoại là khoảng thời gian ngắn — để 2–3 thì thế giới chuyển động vừa phải; để cao thì mọi thứ biến động dồn dập, dễ rối truyện.')
      + num('we-npc-aggressiveness', 'Mức chủ động (0 đến 1)', settings.offscreenAggressiveness,
        'Dịch thành lời chỉ dẫn cho mô hình chứ không phải công thức. <b>0.2</b> hầu hết án binh bất động, chỉ ai có lý do cấp bách mới động thủ. <b>0.5</b> ai có mục tiêu rõ thì tiến hành, số còn lại giữ nguyên. <b>0.9</b> ráo riết theo đuổi, cục diện chuyển biến nhanh. Truyện chậm rãi nên để 0.3, truyện tranh đoạt để 0.7.');

    const injectBody = toggle('we-npc-inject', 'Bật chèn ràng buộc vào prompt', settings.injectIntoPrompt !== false,
        'Công tắc tổng của phần gửi cho AI. Tắt thì engine vẫn theo dõi và ghi hồ sơ, nhưng AI không nhận được ràng buộc nào — nhân vật lại tự do xuất hiện ở bất cứ đâu.')
      + toggle('we-npc-time-anchor', 'Neo thời gian', settings.timeAnchorEnabled !== false,
        'Một dòng ngắn ghi ngày truyện, số lượt và 2–3 diễn biến nền gần nhất. Rất rẻ về token, chống việc AI quên mốc thời gian sau vài lượt.')
      + toggle('we-npc-inject-location', 'Ràng buộc vị trí', settings.injectLocation !== false,
        'Cho AI biết ai đang ở đâu, ai đang trên đường và còn mấy lượt nữa mới tới. Kèm ràng buộc cứng: nhân vật đang đi đường thì <b>không được cho xuất hiện ở đích</b> trước hạn.')
      + toggle('we-npc-inject-knowledge', 'Ràng buộc tri thức', settings.injectKnowledge !== false,
        'Liệt kê những gì mỗi nhân vật <b>chưa</b> biết, để họ không nhắc tới chuyện chưa từng tới tai mình — kể cả cái chết của người khác. Trục tốn token nhất nhưng cũng là thứ tạo cảm giác thế giới sống mạnh nhất.')
      + toggle('we-npc-inject-rumor', 'Tin đồn', settings.injectRumor !== false,
        'Kết quả hoạt động ngầm nào đủ lộ liễu thì lan thành tin đồn và được đưa vào prompt, cho AI có chất liệu để nhân vật bàn tán.')
      + select('we-npc-fog', 'Che vị trí thật', settings.locationFogMode, [
          ['off', 'Tắt — AI biết vị trí thật'],
          ['fog', 'Sương mù — chỉ nói chỗ người chơi tưởng, kèm gợi ý mơ hồ'],
          ['strict', 'Nghiêm ngặt — chỉ nói chỗ người chơi tưởng']
        ], 'Engine lưu tách biệt <b>vị trí thật</b> và <b>chỗ người chơi tưởng nhân vật đang ở</b>. <b>Tắt:</b> AI biết hết, bạn toàn quyền quyết định tiết lộ hay không. <b>Sương mù (mặc định):</b> AI chỉ biết chỗ người chơi tưởng, kèm một câu kiểu "có tin đồn hắn không còn ở đó" — giữ được bất ngờ mà vẫn có chất liệu viết, và AI không lỡ miệng tiết lộ thứ nó không biết. <b>Nghiêm ngặt:</b> mù hoàn toàn cho tới khi người chơi tự đi tìm.')
      + select('we-npc-knowledge-scope', 'Phạm vi ràng buộc tri thức', settings.knowledgeInjectScope, [
          ['in-scene', 'Chỉ nhân vật có mặt trong cảnh'],
          ['all', 'Toàn bộ nhân vật trọng yếu'],
          ['none', 'Tắt']
        ], 'Chi phí token tăng theo <i>số nhân vật × số sự kiện</i>. Chọn "trong cảnh" là đủ dùng vì chỉ người đang đối thoại mới có nguy cơ lỡ miệng. Chọn "toàn bộ" khi truyện có nhiều tuyến song song và bạn hay chuyển cảnh.')
      + num('we-npc-knowledge-limit', 'Số mục tối đa mỗi nhân vật', settings.knowledgeInjectLimit,
        'Lấy các sự việc mới nhất trước. Để 3–5 là vừa; cao hơn thì prompt phình nhanh mà AI cũng khó nhớ hết.')
      + num('we-npc-inject-max-chars', 'Giới hạn độ dài khối chèn (ký tự)', settings.injectMaxChars,
        'Trần cứng cho toàn bộ phần gửi cho AI. Phần chèn của extension tính vào <b>prompt bắt buộc</b> của SillyTavern — vượt quá thì Tavern báo "Mandatory prompts exceed the context size" và <b>không gửi được lượt nào</b>. Hết ngân sách thì bỏ khối từ dưới lên: tin đồn trước, rồi ràng buộc tri thức, giữ lại ràng buộc vị trí và neo thời gian. Để 0 là không giới hạn.');

    const travelBody = select('we-npc-world-scale', 'Thế giới quan', settings.worldScale, [
        ['auto', 'Tự suy từ lorebook'], ['cổ trang', 'Cổ trang'], ['hiện đại', 'Hiện đại'],
        ['tu tiên', 'Tu tiên'], ['viễn tưởng', 'Viễn tưởng']
      ], 'Quyết định tốc độ đi lại khi mô hình ước lượng một chuyến đi mất bao nhiêu lượt. Cùng quãng Dương Châu → Trường An: kiếm hiệp cưỡi ngựa mất cả chục lượt, tu tiên có phi kiếm thì một lượt. Để "tự suy" thì mô hình tự đoán từ lorebook và chính văn — chọn tay chính xác hơn khi truyện pha trộn nhiều yếu tố.')
      + toggle('we-npc-travel-cache', 'Nhớ số lượt của các tuyến đường đã đi', settings.travelCacheEnabled !== false,
        'Lần đầu ai đó đi tuyến nào thì mô hình ước lượng, engine ghi lại con số đó. Lần sau dùng lại để giữ nhất quán — cùng một tuyến không thể lúc 3 lượt lúc 12 lượt. Ngữ cảnh khác hẳn (đi gấp, đường bị chặn, phương tiện tốt hơn) thì mô hình vẫn ghi đè được.');

    const toneBody = area('we-npc-tone-prompt', 'Prompt Bổ Sung', settings.tonePrompt,
        'Ví dụ: ưu tiên nhân vật thuộc phe phái, bỏ qua nhân vật chỉ xuất hiện trong hồi tưởng',
        'Chèn vào đầu prompt trích xuất. Dùng để chỉnh khẩu vị lọc nhân vật cho hợp thể loại truyện của bạn.')
      + area('we-npc-name-blacklist', 'Danh Sách Tên Không Lưu', settings.nameBlacklist, 'Mỗi dòng một tên',
        'Tên trong danh sách này sẽ không bao giờ được đưa vào hồ sơ. Dùng cho tên người chơi, hoặc những nhân vật bạn không muốn engine theo dõi.')
      + area('we-npc-filter-regex', 'Regex Lọc Nội Dung', settings.filterRegex, 'Mỗi dòng một biểu thức',
        'Xoá phần khớp mẫu khỏi hội thoại <i>trước khi</i> gửi đi trích xuất. Dùng để bỏ thẻ định dạng, khối suy nghĩ của AI, hoặc chú thích ngoài truyện.');

    const retryBody = num('we-npc-api-retries', 'Số Lần Thử Lại Khi API Lỗi', settings.apiAutoRetries,
        'Gọi lại khi API trả lỗi hoặc trả JSON hỏng. Để 1–2 giúp vượt qua lỗi mạng thoáng qua; để 0 thì thất bại là dừng ngay, dễ nhận ra vấn đề hơn khi đang chỉnh cấu hình.')
      + num('we-npc-api-timeout', 'Thời Gian Chờ API (ms)', settings.apiTimeoutMs,
        'Quá hạn thì huỷ yêu cầu. 120000 là hai phút — model chậm hoặc hồ sơ nhiều nhân vật thì nên nâng lên.');

    const archiveBody = toggle('we-npc-sync-to-chat', 'Đồng Bộ Vào Dữ Liệu Chat Của Tavern', settings.syncToChat === true,
        'Đính hồ sơ nhân vật vào chính file chat của SillyTavern, nhờ đó nó đi theo cuộc trò chuyện sang thiết bị khác mà không cần dịch vụ ngoài. Tắt thì hồ sơ chỉ nằm trong bộ nhớ trình duyệt của máy này.')
      + toggle('we-npc-auto-backup', 'Tự Động Sao Lưu', settings.autoBackup === true,
        'Tự chụp lại hồ sơ trước những thao tác ghi đè lớn, để còn đường lùi khi có sự cố.')
      + '<div class="we-hint" id="we-npc-cache-status" style="margin-bottom:8px;">Đang đọc...</div>';

    const snapshotBody = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'
      + '<button class="we-btn we-btn-primary" id="we-npc-snap-create">Tạo Bản Lưu</button>'
      + '<button class="we-btn" id="we-npc-snap-import">Nhập Bản Lưu</button>'
      + '<input type="file" id="we-npc-snap-file" accept=".json" style="display:none;">'
      + '</div><div class="we-chatcache-list" id="we-npc-snapshot-list">' + renderNpcSnapshotRows() + '</div>'
      + hint('Bản lưu nằm trong dữ liệu chat của Tavern nên đi theo cuộc trò chuyện. Khôi phục sẽ ghi đè hồ sơ hiện tại.');

    const dataBody = '<div style="display:flex;gap:6px;flex-wrap:wrap;">'
      + '<button class="we-btn" id="we-npc-export-data">Xuất JSON</button>'
      + '<button class="we-btn" id="we-npc-import-data">Nhập JSON</button>'
      + '<input type="file" id="we-npc-import-file" accept=".json" style="display:none;">'
      + '</div>'
      + hint('Xuất toàn bộ hồ sơ nhân vật của cuộc trò chuyện này ra file, gồm cả điểm lưu và bộ nhớ đệm tuyến đường. Nhập vào sẽ <b>ghi đè</b> hồ sơ hiện tại — nên tạo một bản lưu trước.');

    // Điểm lưu là trạng thái trước khi tầng hiện tại được sinh ra; reroll chèn bản này.
    const checkpoint = npcData()?.loadCheckpoint?.();
    const axis = (label, value) => '<div class="we-npc-axis"><span class="we-npc-axis-key">' + h(label) + '</span><span>' + h(String(value)) + '</span></div>';
    const checkpointBody = !checkpoint
      ? '<div class="we-empty">Chưa có điểm lưu</div>'
      : axis('Lượt', checkpoint.round || 0)
        + axis('Tầng hội thoại', checkpoint.chatLayer ?? '—')
        + axis('Nhân vật', (checkpoint.npcs || []).length + ' (' + (checkpoint.npcs || []).filter(npc => npc.tier === 'core').length + ' trọng yếu)')
        + axis('Trong kho', (checkpoint.archive || []).length)
        + hint('Reroll sẽ chèn bản này thay vì trạng thái hiện tại, để lần sinh mới không thấy hệ quả của lần sinh cũ.');

    // Điền lại hàng loạt: dựng hồ sơ cho phần quá khứ nằm ngoài tầm với của engine.
    const backfillBody = num('we-npc-backfill-end', 'Điền lại tới tầng (0 = tới hết)', settings.backfillEndLayer,
        'Số tầng hội thoại làm mốc dừng. Để 0 thì quét hết cuộc trò chuyện.')
      + num('we-npc-backfill-batch', 'Số tầng mỗi đợt', settings.backfillBatchSize,
        'Mỗi đợt là một lượt gọi API. Đợt lớn thì nhanh và rẻ hơn nhưng mô hình dễ bỏ sót; 3–5 là vừa.')
      + num('we-npc-backfill-retries', 'Số lần thử lại mỗi đợt', settings.backfillRetries)
      + `<div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="we-btn we-btn-primary" id="we-npc-backfill-start">Bắt Đầu Điền Lại</button>
          <button class="we-btn we-btn-danger" id="we-npc-backfill-stop">Dừng</button>
        </div>`
      + hint('Quét từ tầng đầu cuộc trò chuyện, chia đợt gọi API để dựng lại hồ sơ nhân vật cho phần quá khứ. Dùng khi mới cài extension giữa chừng một cuộc trò chuyện đã dài. <b>Thao tác này xoá sạch hồ sơ hiện tại rồi dựng lại từ đầu</b> — một bản lưu tự động được tạo trước khi chạy. Chỉ trích xuất nhân vật, không sinh hoạt động ngầm cho quá khứ, vì phần đó đã có chính văn rồi.');

    const maintainBody = `<button class="we-btn" id="we-npc-repair" style="width:100%;margin-bottom:4px;">Đối Soát Và Chữa Dữ Liệu</button>`
      + hint('Lùi hồ sơ về khớp với số tầng hội thoại thật, rồi quét sửa những chỗ không nhất quán tích tụ sau nhiều lượt: id trùng, quan hệ trỏ tới nhân vật đã bị xoá, tri thức trỏ tới sự thật không còn, nhân vật đánh dấu vào kho mà vẫn nằm ở danh sách hoạt động. Chỉ sửa, không xoá dữ liệu thật. Việc này cũng tự chạy mỗi lần mở cuộc trò chuyện.')
      + `<button class="we-btn" id="we-npc-unhide-all" style="width:100%;margin:12px 0 4px;">Bỏ Ẩn Toàn Bộ Tin Nhắn</button>`
      + hint('Công cụ cứu hộ cho người dùng bản cũ. Bộ Nhớ Ký Ức trước đây có tính năng ẩn chính văn đã được tóm tắt bao phủ; nay engine đó đã bị gỡ nên không còn ai bỏ ẩn nữa. Nút này quét cuộc trò chuyện hiện tại và gỡ mọi cờ ẩn còn sót. <b>Chạy một lần cho mỗi cuộc trò chuyện cũ là đủ.</b>');

    const themeBody = select('we-npc-theme-select', 'Bộ phối màu của mặt Nhân Vật', getStoredNpcTheme(),
      WE_THEMES.map(theme => [theme.id, theme.name]),
      'Mỗi mặt engine nhớ bộ màu riêng, chuyển mặt là đổi theo — nhờ đó nhìn màu là biết đang ở engine nào.');

    const debugBody = `<button class="we-btn" id="we-npc-export-diag" style="width:100%;margin-bottom:8px;">Xuất Gói Chẩn Đoán</button>`
      + hint('Xuất toàn bộ trạng thái hiện tại ra file JSON để báo lỗi. Khoá API đã được che trước khi ghi.')
      + `<div id="we-npc-debug-render">${renderNpcDebug()}</div>`;

    const aboutBody = `<div class="we-npc-about">
      <p><strong>Công Cụ Nhân Vật</strong> theo dõi các NPC trọng yếu theo sáu trục — vị trí, mục tiêu, thế lực, quan hệ, tri thức, trạng thái — và cho họ tiếp tục hành động khi vắng mặt khỏi cảnh.</p>
      <p>Cái gửi cho AI không phải nhật ký, mà là <em>ràng buộc</em>: ai đang ở đâu, ai chưa thể có mặt, ai chưa biết chuyện gì. Nhân vật không được nhắc tới điều chưa từng tới tai mình.</p>
      <p>Engine không tự hiểu địa lý. Vị trí lưu thành đường dẫn phân cấp nên độ gần suy ra bằng so khớp tiền tố; thời gian đi lại do AI ước lượng một lần theo thế giới quan, engine chỉ trừ dần mỗi lượt.</p>
      <p style="color:var(--we-text3);">Phiên bản ${h(window.NPC_ENGINE_SETTINGS?.VERSION || '?')}</p>
    </div>`;

    // Worldbook dùng chung khối giao diện với Công Cụ Thế Giới: tự đọc lorebook của cuộc trò chuyện
    // hiện tại, liệt kê từng mục kèm ô chọn và ghi đè kiểu kích hoạt. Phạm vi lưu riêng theo engine.
    const shared = renderSettingsAfterCheckpoint({ scope: 'npc' });

    const panelContent = {
      common:    sec('set-npc-api', 'API Riêng', apiBody) + sec('set-npc-run', 'Vận Hành', runBody)
                 + sec('set-npc-filter', 'Bộ Lọc Nhân Vật', filterBody),
      link:      sec('set-npc-link', 'Nối Với Công Cụ Thế Giới', linkBody),
      advanced:  sec('set-npc-offscreen', 'Hoạt Động Ngầm', offscreenBody) + sec('set-npc-inject', 'Chèn Vào Prompt', injectBody)
                 + sec('set-npc-travel', 'Di Chuyển', travelBody) + sec('set-npc-tone', 'Prompt Và Bộ Lọc', toneBody)
                 + sec('set-npc-retry', 'Thử Lại Và Thời Gian Chờ', retryBody),
      archive:   sec('set-npc-archive', 'Lưu Trữ Và Đồng Bộ', archiveBody)
                 + sec('set-npc-snapshot', 'Bản Lưu Theo Cuộc Trò Chuyện', snapshotBody)
                 + sec('set-npc-data', 'Nhập/Xuất Dữ Liệu', dataBody)
                 + sec('set-npc-checkpoint', 'Điểm Lưu Hiện Tại', checkpointBody)
                 + sec('set-npc-backfill', 'Điền Lại Hàng Loạt', backfillBody)
                 + sec('set-npc-maintain', 'Bảo Trì', maintainBody),
      worldbook: shared.worldbook,
      debug:     sec('set-npc-debug', 'Gỡ Lỗi', debugBody),
      about:     sec('set-npc-theme', 'Giao Diện', themeBody) + sec('set-npc-about', 'Giới Thiệu', aboutBody)
    };

    // Dùng lại đúng lớp .we-settings-tab / .we-settings-panel của trang cài đặt thế giới, nên việc
    // chuyển tab do bindEvents() lo — chỉ ẩn/hiện bằng CSS, không render lại, giữ nguyên nội dung đang nhập.
    const tabBar = '<div class="we-settings-tabs-shell">'
      + '<button class="we-settings-tab-scroll" data-dir="-1" title="Cuộn Sang Trái"><i class="fa-solid fa-chevron-left"></i></button>'
      + '<div class="we-settings-tabs" id="we-settings-tabs">'
      + NPC_SETTINGS_TABS.map(tab =>
          '<button class="we-settings-tab' + (tab.key === _npcSettingsTab ? ' we-settings-tab--active' : '')
          + '" data-tab="' + tab.key + '">' + tab.label + '</button>').join('')
      + '</div>'
      + '<button class="we-settings-tab-scroll" data-dir="1" title="Cuộn Sang Phải"><i class="fa-solid fa-chevron-right"></i></button>'
      + '</div>';

    const panels = NPC_SETTINGS_TABS.map(tab =>
      '<div class="we-settings-panel" data-tab="' + tab.key + '"'
      + (tab.key === _npcSettingsTab ? '' : ' style="display:none;"') + '>'
      + (panelContent[tab.key] || '') + '</div>').join('');

    return '<div class="we-sub-topbar">'
      + '<button class="we-icon-btn" id="we-npc-settings-back" type="button" title="Quay Lại"><i class="fa-solid fa-arrow-left"></i></button>'
      + '<span class="we-sub-title">Cài Đặt Công Cụ Nhân Vật</span>'
      + '</div>'
      + tabBar + '<div class="we-npc-settings">' + panels + '</div>'
      // Lưu / Đặt lại cố định dưới cùng, giống trang cài đặt thế giới: mọi tab đều lưu được bằng một chạm.
      + '<div class="we-settings-save-actions we-settings-save-sticky">'
      + '<button class="we-btn" id="we-npc-save-settings">Lưu Cài Đặt</button>'
      + '<button class="we-btn we-btn-danger" id="we-npc-reset-settings">Đặt Lại Cài Đặt</button>'
      + '</div>';
  }

  // Độ dài khối chèn lần gần nhất so với trần cấu hình. Phần chèn của extension tính vào
  // prompt bắt buộc của SillyTavern, nên đây là con số cần nhìn khi Tavern báo tràn ngữ cảnh.
  function describeInjectionSize() {
    const info = window.NPC_ENGINE?.getLastInjectionInfo?.() || {};
    const length = info.length || 0;
    if (!info.maxChars) return length + " ký tự (không giới hạn)";
    const dropped = info.dropped ? " · đã bỏ " + info.dropped + " khối cho vừa trần" : "";
    return length + " / " + info.maxChars + " ký tự" + dropped;
  }

  function renderNpcDebug() {
    const debug = window.NPC_ENGINE?.getLastDebug?.() || {};
    const state = npcData()?.loadState?.() || {};
    // Thẻ tự kiểm tra chèn, phạm vi npc: trả lời câu "ràng buộc nhân vật có thực sự vào prompt
    // gửi cho mô hình chính hay không". Đăng ký thành công không đồng nghĩa với đã vào nội dung.
    const injectCard = renderInjectInspector('npc');
    const rows = [
      ['Lượt', state.round || 0],
      ['Tầng hội thoại', state.chatLayer ?? '—'],
      ['Nhân vật trọng yếu', (state.npcs || []).filter(npc => npc.tier === 'core').length],
      ['Trong kho', (state.archive || []).length],
      ['Sự thật công khai', (state.publicFacts || []).length],
      ['Tin đồn', (state.rumorQueue || []).length],
      ['Tuyến đường đã biết', Object.keys(state.travelCache || {}).length],
      ['Độ dài khối chèn', describeInjectionSize()]
    ].map(([label, value]) => `<div class="we-npc-axis"><span class="we-npc-axis-key">${h(label)}</span><span>${h(String(value))}</span></div>`).join('');

    const block = (title, content) => content
      ? `<div class="we-input-group"><label>${h(title)}</label><textarea rows="6" readonly style="width:100%;">${h(typeof content === 'string' ? content : JSON.stringify(content, null, 2))}</textarea></div>`
      : '';

    return '<div class="we-prompt-debug">' + injectCard + '</div>'
      + rows
      + (debug.error ? `<div class="we-hint" style="color:var(--we-danger);">Lỗi lần chạy gần nhất: ${h(debug.error)}</div>` : '')
      + block('Prompt lần gần nhất', debug.prompt)
      + block('Phản hồi API lần gần nhất', debug.apiResponse);
  }

  function refreshNpcDebugRender() {
    const target = document.getElementById('we-npc-debug-render');
    if (!target) return;
    target.innerHTML = renderNpcDebug();
    // innerHTML xoá sạch handler cũ, phải gắn lại nút thu gọn của thẻ tự kiểm tra chèn.
    bindPromptSegToggle(target.querySelector('.we-prompt-debug'));
  }

  async function runNpcLink(mode) {
    // Đang chạy thì đây là "bỏ qua", không phải "thất bại" — báo nhầm khiến người dùng tưởng bị ngắt.
    if (window.NPC_ENGINE?.isRunning?.()) {
      showToast(`Đang ${window.NPC_ENGINE?.getRunningLabel?.() || 'chạy'}, vui lòng đợi hoàn tất`);
      return;
    }
    const redo = mode === 'redo';
    try {
      const ok = await window.WORLD_ENGINE?.manualNpcLink?.(mode);
      if (ok) showToast(redo ? 'Đã diễn biến lại hồ sơ nhân vật' : 'Đã cập nhật hồ sơ nhân vật');
      // Thất bại hay bỏ qua đều đã được manualNpcLink báo qua thanh trạng thái kèm lý do cụ thể,
      // nên ở đây không chồng thêm toast chung chung nữa.
    } catch (error) {
      showToast('Thao tác thất bại: ' + (error?.message || error), true);
    }
    refresh();
  }

  function bindNpcView() {
    const back = document.getElementById('we-npc-btn-back');
    if (back) back.onclick = () => { _npcView = 'home'; _npcSelectedNavView = null; refresh(); };
    const settingsBack = document.getElementById('we-npc-settings-back');
    if (settingsBack) settingsBack.onclick = () => { _npcSettingsOpen = false; refresh(); };

    document.querySelectorAll('.we-npc-nav-row[data-npc-view]').forEach(row => {
      row.onclick = () => {
        const view = row.dataset.npcView;
        if (_npcSelectedNavView === view) { _npcSelectedNavView = null; _npcView = view; }
        else { _npcSelectedNavView = view; }
        refresh();
      };
    });

    document.querySelectorAll('[data-npc-toggle]').forEach(head => {
      head.onclick = event => {
        if (event.target.closest('button')) return;
        const key = head.dataset.npcToggle;
        if (_npcExpanded.has(key)) _npcExpanded.delete(key); else _npcExpanded.add(key);
        refresh();
      };
    });

    // Thao tác tay trên hồ sơ: đọc trạng thái, sửa, ghi lại — không đụng tới API.
    const mutate = (id, action) => {
      const state = npcData()?.loadState?.();
      if (!state) return;
      const npc = npcData().findNpc(state, id);
      if (!npc) return;
      action(npc, state);
      npcData().saveState(state);
      window.NPC_ENGINE?.applyInjection?.();
      refresh();
    };

    document.querySelectorAll('.we-npc-pin').forEach(button => {
      button.onclick = () => mutate(button.dataset.npcId, npc => { npc.pinned = !npc.pinned; });
    });
    document.querySelectorAll('.we-npc-tier').forEach(button => {
      button.onclick = () => mutate(button.dataset.npcId, npc => {
        npc.tier = npc.tier === 'core' ? 'peripheral' : 'core';
      });
    });
    document.querySelectorAll('.we-npc-archive').forEach(button => {
      button.onclick = () => mutate(button.dataset.npcId, (npc, state) => {
        npcData().archiveNpc(state, npc.id, npc.status?.condition, window.WORLD_ENGINE_CORE?.getChatLayer?.());
      });
    });
    document.querySelectorAll('.we-npc-revive').forEach(button => {
      button.onclick = () => mutate(button.dataset.npcId, (npc, state) => {
        npcData().reviveNpc(state, npc.id);
      });
    });

    // ===== Trình soạn hồ sơ =====
    document.querySelectorAll('.we-npc-edit').forEach(button => {
      button.onclick = () => { _npcEditingId = button.dataset.npcId; refresh(); };
    });
    const addButton = document.querySelector('.we-npc-add');
    if (addButton) addButton.onclick = () => { _npcEditingId = ''; refresh(); };
    document.querySelectorAll('.we-npc-cancel-edit').forEach(button => {
      button.onclick = () => { _npcEditingId = null; refresh(); };
    });

    document.querySelectorAll('.we-npc-save').forEach(button => {
      button.onclick = () => {
        const root = button.closest('[data-npc-editor]');
        if (!root) return;
        const state = npcData()?.loadState?.();
        if (!state) return;
        const id = root.dataset.npcEditor;
        const existing = id ? npcData().findNpc(state, id) : null;
        const draft = readNpcEditor(root, existing || npcData().newNpc({}));
        if (!draft.name) { showToast('Nhân vật phải có tên', true); return; }

        if (existing) {
          Object.assign(existing, npcData().newNpc({ ...draft, id: existing.id }));
        } else {
          // Trùng tên với người đã có thì gộp vào người đó, tránh đẻ ra bản sao.
          const clash = npcData().findNpc(state, draft.name);
          if (clash) { showToast(`Đã có nhân vật tên "${draft.name}"`, true); return; }
          npcData().upsertNpc(state, draft);
        }
        npcData().saveState(state);
        window.NPC_ENGINE?.applyInjection?.();
        _npcEditingId = null;
        showToast(existing ? 'Đã lưu hồ sơ' : 'Đã thêm nhân vật');
        refresh();
      };
    });

    document.querySelectorAll('.we-npc-delete').forEach(button => {
      button.onclick = () => {
        const root = button.closest('[data-npc-editor]');
        const id = root?.dataset.npcEditor;
        if (!id) return;
        const state = npcData()?.loadState?.();
        const npc = state && npcData().findNpc(state, id);
        if (!npc) return;
        if (!confirm(`Xoá hẳn "${npc.name}" khỏi hồ sơ?\n\nKhác với "Đưa vào kho": xoá hẳn thì mất luôn nhật ký và tri thức của nhân vật này. Dùng khi mô hình nhận nhầm một người không có thật.`)) return;
        npcData().removeNpc(state, id);
        npcData().saveState(state);
        window.NPC_ENGINE?.applyInjection?.();
        _npcEditingId = null;
        showToast(`Đã xoá "${npc.name}"`);
        refresh();
      };
    });

    const patch = patchValue => window.NPC_ENGINE_SETTINGS?.patchSettings(patchValue);
    const bindNumber = (id, key) => {
      const element = document.getElementById(id);
      if (element) element.onchange = () => { patch({ [key]: element.value }); window.NPC_ENGINE?.applyInjection?.(); };
    };
    const bindToggle = (id, key) => {
      const element = document.getElementById(id);
      if (element) element.onchange = () => { patch({ [key]: element.checked }); window.NPC_ENGINE?.applyInjection?.(); };
    };
    const bindSelect = (id, key) => {
      const element = document.getElementById(id);
      if (element) element.onchange = () => { patch({ [key]: element.value }); window.NPC_ENGINE?.applyInjection?.(); };
    };

    const bindText = (id, key) => {
      const element = document.getElementById(id);
      if (element) element.onchange = () => patch({ [key]: element.value });
    };

    // API riêng — không có mục này thì engine nạp được nhưng im lặng tuyệt đối.
    bindText('we-npc-api-url', 'apiUrl');
    bindText('we-npc-api-key', 'apiKey');
    bindText('we-npc-model', 'model');
    bindSelect('we-npc-connection-mode', 'connectionMode');
    bindNumber('we-npc-temperature', 'temperature');
    bindNumber('we-npc-max-tokens', 'maxTokens');
    bindNumber('we-npc-api-retries', 'apiAutoRetries');
    bindNumber('we-npc-api-timeout', 'apiTimeoutMs');
    bindText('we-npc-tone-prompt', 'tonePrompt');
    bindText('we-npc-name-blacklist', 'nameBlacklist');
    bindText('we-npc-filter-regex', 'filterRegex');
    bindToggle('we-npc-engine-enabled', 'engineEnabled');
    bindToggle('we-npc-first-layer-opening', 'firstLayerIsAiOpening');
    bindToggle('we-npc-sync-to-chat', 'syncToChat');
    bindToggle('we-npc-auto-backup', 'autoBackup');

    // Lấy danh sách mô hình từ chính endpoint đã điền, dùng lại bộ gọi API dùng chung.
    const fetchModels = document.getElementById('we-npc-fetch-models');
    const modelList = document.getElementById('we-npc-model-list');
    if (fetchModels && modelList) {
      fetchModels.onclick = async () => {
        fetchModels.disabled = true;
        try {
          const models = await window.WORLD_ENGINE_API?.fetchModelList?.(npcSettings());
          if (!models || !models.length) { showToast('Không lấy được danh sách mô hình', true); return; }
          modelList.innerHTML = '<option value="">-- Chọn Mô Hình --</option>'
            + models.map(name => `<option value="${h(name)}">${h(name)}</option>`).join('');
          modelList.style.display = '';
          showToast(`Đã lấy ${models.length} mô hình`);
        } catch (error) {
          showToast('Lấy danh sách thất bại: ' + (error?.message || error), true);
        } finally {
          fetchModels.disabled = false;
        }
      };
      modelList.onchange = () => {
        if (!modelList.value) return;
        const modelInput = document.getElementById('we-npc-model');
        if (modelInput) modelInput.value = modelList.value;
        patch({ model: modelList.value });
      };
    }

    const exportDiag = document.getElementById('we-npc-export-diag');
    if (exportDiag) {
      exportDiag.onclick = () => {
        try { window.WORLD_ENGINE_DIAG?.download?.('npc'); showToast('Đã xuất gói chẩn đoán nhân vật'); }
        catch (error) { showToast('Xuất gói chẩn đoán thất bại: ' + (error?.message || error), true); }
      };
    }

    bindNumber('we-npc-core-limit', 'npcCoreLimit');
    bindNumber('we-npc-threshold', 'significanceThreshold');
    bindNumber('we-npc-offscreen-max', 'offscreenMaxPerRound');
    bindNumber('we-npc-aggressiveness', 'offscreenAggressiveness');
    bindNumber('we-npc-knowledge-limit', 'knowledgeInjectLimit');
    bindNumber('we-npc-inject-max-chars', 'injectMaxChars');
    bindNumber('we-npc-world-limit', 'worldEngineNpcLimit');
    bindToggle('we-npc-offscreen', 'offscreenEnabled');
    bindToggle('we-npc-inject', 'injectIntoPrompt');
    bindToggle('we-npc-time-anchor', 'timeAnchorEnabled');
    bindToggle('we-npc-inject-location', 'injectLocation');
    bindToggle('we-npc-inject-knowledge', 'injectKnowledge');
    bindToggle('we-npc-inject-rumor', 'injectRumor');
    bindToggle('we-npc-travel-cache', 'travelCacheEnabled');
    bindToggle('we-npc-link', 'npcLinkEnabled');
    bindToggle('we-npc-to-world', 'injectIntoWorldEngine');
    bindSelect('we-npc-fog', 'locationFogMode');
    bindSelect('we-npc-knowledge-scope', 'knowledgeInjectScope');
    bindSelect('we-npc-world-scale', 'worldScale');

    const themeSelect = document.getElementById('we-npc-theme-select');
    if (themeSelect) themeSelect.onchange = () => { setNpcTheme(themeSelect.value); refresh(); };

    // ===== Lưu / Đặt lại =====
    // Từng ô đã tự lưu khi rời khỏi (onchange), nhưng nút Lưu vẫn cần: nó quét lại TOÀN BỘ ô ở mọi tab
    // trong một lần, nên ô đang gõ dở mà chưa rời con trỏ cũng được ghi. Các tab ẩn vẫn nằm trong DOM
    // (chỉ ẩn bằng CSS) nên quét được hết.
    const NPC_FIELD_MAP = {
      'we-npc-api-url': 'apiUrl', 'we-npc-api-key': 'apiKey', 'we-npc-model': 'model',
      'we-npc-connection-mode': 'connectionMode', 'we-npc-temperature': 'temperature',
      'we-npc-max-tokens': 'maxTokens', 'we-npc-api-retries': 'apiAutoRetries',
      'we-npc-api-timeout': 'apiTimeoutMs',
      'we-npc-engine-enabled': 'engineEnabled', 'we-npc-first-layer-opening': 'firstLayerIsAiOpening',
      'we-npc-core-limit': 'npcCoreLimit', 'we-npc-threshold': 'significanceThreshold',
      'we-npc-link': 'npcLinkEnabled', 'we-npc-to-world': 'injectIntoWorldEngine',
      'we-npc-world-limit': 'worldEngineNpcLimit',
      'we-npc-offscreen': 'offscreenEnabled', 'we-npc-offscreen-max': 'offscreenMaxPerRound',
      'we-npc-aggressiveness': 'offscreenAggressiveness',
      'we-npc-inject': 'injectIntoPrompt', 'we-npc-time-anchor': 'timeAnchorEnabled',
      'we-npc-inject-location': 'injectLocation', 'we-npc-inject-knowledge': 'injectKnowledge',
      'we-npc-inject-rumor': 'injectRumor', 'we-npc-fog': 'locationFogMode',
      'we-npc-knowledge-scope': 'knowledgeInjectScope', 'we-npc-knowledge-limit': 'knowledgeInjectLimit',
      'we-npc-inject-max-chars': 'injectMaxChars',
      'we-npc-backfill-end': 'backfillEndLayer', 'we-npc-backfill-batch': 'backfillBatchSize',
      'we-npc-backfill-retries': 'backfillRetries',
      'we-npc-world-scale': 'worldScale', 'we-npc-travel-cache': 'travelCacheEnabled',
      'we-npc-tone-prompt': 'tonePrompt', 'we-npc-name-blacklist': 'nameBlacklist',
      'we-npc-filter-regex': 'filterRegex',
      'we-npc-sync-to-chat': 'syncToChat', 'we-npc-auto-backup': 'autoBackup',
      'we-worldbook-trigger': 'worldbookTrigger'
    };

    const collectNpcSettings = () => {
      const collected = {};
      for (const [id, key] of Object.entries(NPC_FIELD_MAP)) {
        const element = document.getElementById(id);
        if (!element) continue;
        collected[key] = element.type === 'checkbox' ? element.checked : element.value;
      }
      return collected;
    };

    const saveBtn = document.getElementById('we-npc-save-settings');
    if (saveBtn) {
      saveBtn.onclick = () => {
        const saved = window.NPC_ENGINE_SETTINGS?.patchSettings(collectNpcSettings());
        window.NPC_ENGINE?.applyInjection?.();
        showToast(saved ? 'Đã lưu cài đặt Công Cụ Nhân Vật' : 'Lưu cài đặt thất bại', !saved);
        refresh();
      };
    }

    const resetBtn = document.getElementById('we-npc-reset-settings');
    if (resetBtn) {
      resetBtn.onclick = () => {
        // Chỉ đặt lại CẤU HÌNH. Hồ sơ nhân vật là dữ liệu của cuộc trò chuyện, không đụng tới —
        // muốn xoá hồ sơ thì dùng thao tác trên từng thẻ nhân vật ở trang danh sách.
        const defaults = window.NPC_ENGINE_SETTINGS?.DEFAULTS;
        if (!defaults) { showToast('Không đọc được cấu hình mặc định', true); return; }
        if (!confirm('Đặt lại toàn bộ cài đặt Công Cụ Nhân Vật về mặc định?\n\nBao gồm cả URL API và khoá API. Hồ sơ nhân vật KHÔNG bị xoá.')) return;
        window.NPC_ENGINE_SETTINGS.saveSettings({ ...defaults });
        window.NPC_ENGINE?.applyInjection?.();
        showToast('Đã đặt lại cài đặt về mặc định');
        refresh();
      };
    }

    // ===== Điền lại hàng loạt =====
    bindNumber('we-npc-backfill-end', 'backfillEndLayer');
    bindNumber('we-npc-backfill-batch', 'backfillBatchSize');
    bindNumber('we-npc-backfill-retries', 'backfillRetries');

    const backfillStart = document.getElementById('we-npc-backfill-start');
    if (backfillStart) {
      backfillStart.onclick = async () => {
        if (window.NPC_ENGINE?.isRunning?.()) { showToast('Đang có tác vụ chạy, vui lòng đợi'); return; }
        const count = (window.SillyTavern?.getContext?.()?.chat || []).length;
        if (!confirm(`Điền lại hồ sơ nhân vật từ đầu cuộc trò chuyện (${count} tầng)?\n\nHồ sơ hiện tại sẽ bị XOÁ SẠCH rồi dựng lại. Một bản lưu tự động được tạo trước khi chạy.\n\nQuá trình này tốn nhiều lượt gọi API và có thể mất vài phút.`)) return;
        backfillStart.disabled = true;
        try {
          const result = await window.NPC_ENGINE?.backfill?.();
          if (result?.skipped) showToast(result.reason === 'empty' ? 'Không có tầng AI nào để điền lại' : 'Đang bận, chưa chạy được', true);
        } catch (error) {
          showToast('Điền lại thất bại: ' + (error?.message || error), true);
        } finally {
          backfillStart.disabled = false;
          refresh();
        }
      };
    }

    const backfillStop = document.getElementById('we-npc-backfill-stop');
    if (backfillStop) {
      backfillStop.onclick = () => {
        const stopped = window.NPC_ENGINE?.stopBackfill?.();
        showToast(stopped ? 'Sẽ dừng sau khi xong đợt hiện tại' : 'Hiện không có tác vụ điền lại nào đang chạy');
      };
    }

    // ===== Bản lưu theo cuộc trò chuyện =====
    refreshNpcSnapshots();

    const snapCreate = document.getElementById('we-npc-snap-create');
    if (snapCreate) {
      snapCreate.onclick = () => {
        const name = prompt('Tên bản lưu:', 'Bản lưu ' + new Date().toLocaleString());
        if (name === null) return;
        const ok = npcCache()?.createSnapshot?.(String(name).trim() || 'Không tên');
        showToast(ok ? 'Đã tạo bản lưu' : 'Tạo bản lưu thất bại', !ok);
        refreshNpcSnapshots();
      };
    }

    const snapImport = document.getElementById('we-npc-snap-import');
    const snapFile = document.getElementById('we-npc-snap-file');
    if (snapImport && snapFile) {
      snapImport.onclick = () => snapFile.click();
      snapFile.onchange = event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const ok = npcCache()?.importSnapshot?.(JSON.parse(ev.target.result));
            showToast(ok ? 'Đã nhập bản lưu' : 'Tệp không hợp lệ', !ok);
            refreshNpcSnapshots();
          } catch (error) {
            showToast('Đọc tệp thất bại: ' + (error?.message || error), true);
          }
        };
        reader.readAsText(file);
        snapFile.value = '';
      };
    }

    document.querySelectorAll('[data-npc-snap-action]').forEach(button => {
      button.onclick = () => {
        const row = button.closest('[data-npc-snap-id]');
        const id = row?.dataset.npcSnapId;
        const cache = npcCache();
        if (!id || !cache) return;
        const action = button.dataset.npcSnapAction;

        if (action === 'restore') {
          if (!confirm('Khôi phục bản lưu này?\n\nHồ sơ nhân vật hiện tại sẽ bị ghi đè. Một bản lưu tự động được tạo trước khi khôi phục.')) return;
          const ok = cache.restoreSnapshot?.(id);
          showToast(ok ? 'Đã khôi phục' : 'Khôi phục thất bại', !ok);
          window.NPC_ENGINE?.applyInjection?.();
          refresh();
          return;
        }
        if (action === 'rename') {
          const name = prompt('Tên mới:');
          if (name === null) return;
          cache.renameSnapshot?.(id, String(name).trim() || 'Không tên');
        } else if (action === 'export') {
          const payload = cache.exportSnapshot?.(id);
          if (!payload) { showToast('Không xuất được bản lưu này', true); return; }
          downloadNpcJson(payload, 'npc-engine-snapshot-' + Date.now() + '.json');
          showToast('Đã xuất bản lưu');
        } else if (action === 'delete') {
          if (!confirm('Xoá bản lưu này?')) return;
          cache.deleteSnapshot?.(id);
        }
        refreshNpcSnapshots();
      };
    });

    // ===== Nhập / Xuất toàn bộ hồ sơ =====
    const exportData = document.getElementById('we-npc-export-data');
    if (exportData) {
      exportData.onclick = () => {
        downloadNpcJson({
          type: 'npc-engine-state',
          version: window.NPC_ENGINE_DATA?.VERSION || '1.0.0',
          exportedAt: new Date().toISOString(),
          chatId: window.WORLD_ENGINE_CORE?.getChatId?.() || 'default',
          state: npcData()?.loadState?.() || null,
          checkpoint: npcData()?.loadCheckpoint?.() || null
        }, 'npc-engine-' + (window.WORLD_ENGINE_CORE?.getChatId?.() || 'chat') + '-' + Date.now() + '.json');
        showToast('Đã xuất hồ sơ nhân vật');
      };
    }

    const importData = document.getElementById('we-npc-import-data');
    const importFile = document.getElementById('we-npc-import-file');
    if (importData && importFile) {
      importData.onclick = () => importFile.click();
      importFile.onchange = event => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          try {
            const payload = JSON.parse(ev.target.result);
            if (!payload || !payload.state) { showToast('Tệp không phải hồ sơ nhân vật', true); return; }
            if (!confirm('Nhập hồ sơ này?\n\nToàn bộ hồ sơ nhân vật của cuộc trò chuyện hiện tại sẽ bị ghi đè.')) return;
            // Tự sao lưu trước khi ghi đè: nhập nhầm tệp là mất sạch hồ sơ đang có.
            npcCache()?.createSnapshot?.('Tự động trước khi nhập');
            npcData().saveState(payload.state);
            if (payload.checkpoint) npcData().saveCheckpoint(payload.checkpoint);
            window.NPC_ENGINE?.applyInjection?.();
            showToast('Đã nhập hồ sơ nhân vật');
            refresh();
          } catch (error) {
            showToast('Đọc tệp thất bại: ' + (error?.message || error), true);
          }
        };
        reader.readAsText(file);
        importFile.value = '';
      };
    }

    const repair = document.getElementById('we-npc-repair');
    if (repair) {
      repair.onclick = () => {
        const result = window.NPC_ENGINE?.reconcileHistory?.();
        if (!result) { showToast('Công Cụ Nhân Vật chưa sẵn sàng', true); return; }
        const fixed = result.repaired || {};
        const total = Object.values(fixed).reduce((sum, value) => sum + (Number(value) || 0), 0);
        const parts = [];
        if (result.changed) parts.push(`lùi về tầng ${result.layer}`);
        if (total) parts.push(`sửa ${total} chỗ`);
        showToast(parts.length ? 'Đã đối soát: ' + parts.join(' · ') : 'Dữ liệu đã nhất quán, không cần sửa');
        refresh();
      };
    }

    const unhide = document.getElementById('we-npc-unhide-all');
    if (unhide) {
      unhide.onclick = async () => {
        unhide.disabled = true;
        try {
          const count = await window.WORLD_ENGINE?.unhideAllMessages?.();
          showToast(count ? `Đã bỏ ẩn ${count} tin nhắn` : 'Không có tin nhắn nào đang bị ẩn');
        } catch (error) {
          showToast('Bỏ ẩn thất bại: ' + (error?.message || error), true);
        } finally {
          unhide.disabled = false;
        }
      };
    }

    const linkNow = document.getElementById('we-npc-link-now');
    if (linkNow) {
      linkNow.onclick = async () => {
        linkNow.disabled = true;
        try { await runNpcLink(); } finally { linkNow.disabled = false; }
      };
    }
  }

  return {
    buildPanel, buildInputButton, showPanel, hidePanel, togglePanel, refresh, setStatus,
    setEvolvingUI, setInjectedScope,
    // Cho engine ngoài báo "trạng thái chạy của tôi vừa đổi", để quả cầu vẽ lại hoạt ảnh xoay và
    // nút dừng. Không có đường này thì engine phải tự đụng vào DOM của quả cầu.
    refreshBallControls: () => updateBallControls(),
    registerEngineFace,
    listEngineFaces: () => { ensureBuiltinEngineFaces(); return _engineFaceOrder.map(id => ({ ...getEngineFace(id) })); },
    advanceEngineFace
  };
})();
