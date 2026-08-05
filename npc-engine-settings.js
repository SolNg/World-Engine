// npc-engine-settings.js — Cấu hình độc lập của Công Cụ Nhân Vật (chỉ dùng chung phần triển khai API/lập lịch, không chia sẻ giá trị cấu hình)
window.NPC_ENGINE_SETTINGS = (function() {
  const STORAGE_KEY = 'npc_engine_settings';
  const VERSION = '1.1.1';

  const FOG_MODES = ['off', 'fog', 'strict'];
  const KNOWLEDGE_SCOPES = ['in-scene', 'all', 'none'];
  const WORLD_SCALES = ['auto', 'cổ trang', 'hiện đại', 'tu tiên', 'viễn tưởng'];

  const DEFAULTS = Object.freeze({
    // ===== API riêng, không dùng chung với World Engine =====
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    temperature: 0.3,
    maxTokens: 65000,
    apiTimeoutMs: 120000,
    apiAutoRetries: 0,

    // ===== Vận hành =====
    engineEnabled: true,
    firstLayerIsAiOpening: true,
    evolveMode: 'auto',
    evolveEveryX: 1,
    evolveReadRounds: 1,
    manualReadRounds: 1,

    // ===== Bộ lọc 3 bậc =====
    npcCoreLimit: 12,
    significanceThreshold: 60,

    // ===== Hoạt động ngầm =====
    offscreenEnabled: true,
    offscreenAggressiveness: 0.5,
    offscreenMaxPerRound: 3,

    // ===== Chèn vào prompt =====
    injectIntoPrompt: true,
    timeAnchorEnabled: true,
    injectLocation: true,
    injectKnowledge: true,
    injectRumor: true,
    injectTrace: true,
    injectIdentity: true,
    locationFogMode: 'fog',
    knowledgeInjectScope: 'in-scene',
    knowledgeInjectLimit: 5,
    injectMaxChars: 2500,

    // ===== Di chuyển =====
    worldScale: 'auto',
    travelCacheEnabled: true,
    fallbackMinutesPerTurn: 20,

    // ===== Nối với Công Cụ Thế Giới =====
    npcLinkEnabled: true,
    injectIntoWorldEngine: true,
    worldEngineNpcLimit: 8,

    // ===== Nguồn dữ liệu =====
    worldbookEnabled: false,
    worldbookTrigger: false,
    nameBlacklist: '',
    filterRegex: '',
    tonePrompt: '',

    // ===== Lưu trữ =====
    syncToChat: false,
    autoBackup: false,

    // ===== Điền bù hàng loạt =====
    backfillBatchSize: 5,
    backfillRetries: 2,
    backfillEndLayer: 0
  });

  let cached = null;

  const clampInt = (value, min, max, fallback) => {
    const parsed = parseInt(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const clampFloat = (value, min, max, fallback) => {
    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;

  function normalizeSettings(value) {
    const merged = { ...DEFAULTS, ...(value || {}) };
    return {
      ...merged,
      // Một lượt là đơn vị nhỏ nhất có thể phát lại: NPC được trích xuất và sinh hoạt động ngầm trong cùng một lượt,
      // nên các tham số nhịp bị ghim về 1 giống Công Cụ Ký Ức trước đây, tránh cấu hình cũ tiếp tục có hiệu lực.
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,

      maxTokens: Math.max(1, parseInt(merged.maxTokens) || 65000),
      temperature: clampFloat(merged.temperature, 0, 2, DEFAULTS.temperature),

      npcCoreLimit: clampInt(merged.npcCoreLimit, 1, 100, DEFAULTS.npcCoreLimit),
      significanceThreshold: clampInt(merged.significanceThreshold, 0, 100, DEFAULTS.significanceThreshold),

      offscreenAggressiveness: clampFloat(merged.offscreenAggressiveness, 0, 1, DEFAULTS.offscreenAggressiveness),
      offscreenMaxPerRound: clampInt(merged.offscreenMaxPerRound, 0, 20, DEFAULTS.offscreenMaxPerRound),

      locationFogMode: pick(merged.locationFogMode, FOG_MODES, DEFAULTS.locationFogMode),
      knowledgeInjectScope: pick(merged.knowledgeInjectScope, KNOWLEDGE_SCOPES, DEFAULTS.knowledgeInjectScope),
      knowledgeInjectLimit: clampInt(merged.knowledgeInjectLimit, 0, 50, DEFAULTS.knowledgeInjectLimit),
      injectMaxChars: clampInt(merged.injectMaxChars, 0, 100000, DEFAULTS.injectMaxChars),

      worldScale: pick(merged.worldScale, WORLD_SCALES, DEFAULTS.worldScale),
      worldEngineNpcLimit: clampInt(merged.worldEngineNpcLimit, 0, 50, DEFAULTS.worldEngineNpcLimit),
      fallbackMinutesPerTurn: clampInt(merged.fallbackMinutesPerTurn, 0, 10080, DEFAULTS.fallbackMinutesPerTurn),

      backfillBatchSize: clampInt(merged.backfillBatchSize, 1, 50, DEFAULTS.backfillBatchSize),
      backfillRetries: clampInt(merged.backfillRetries, 0, 10, DEFAULTS.backfillRetries),
      backfillEndLayer: Math.max(0, parseInt(merged.backfillEndLayer) || 0)
    };
  }

  function readStored() {
    try {
      const raw = window.WORLD_ENGINE_STORE?.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.warn('[Công Cụ Nhân Vật] Đọc cấu hình thất bại, dùng giá trị mặc định', error);
      return {};
    }
  }

  function getSettings(forceRefresh) {
    if (forceRefresh) cached = null;
    if (!cached) cached = normalizeSettings(readStored());
    return { ...cached };
  }

  function saveSettings(next) {
    cached = normalizeSettings(next);
    window.WORLD_ENGINE_STORE?.setItem(STORAGE_KEY, JSON.stringify(cached));
    return { ...cached };
  }

  function patchSettings(patch) {
    return saveSettings({ ...getSettings(true), ...(patch || {}) });
  }

  return {
    STORAGE_KEY,
    VERSION,
    DEFAULTS,
    FOG_MODES,
    KNOWLEDGE_SCOPES,
    WORLD_SCALES,
    getSettings,
    saveSettings,
    patchSettings
  };
})();
