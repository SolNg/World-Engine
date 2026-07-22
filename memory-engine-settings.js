// memory-engine-settings.js — Cấu hình độc lập của Bộ Nhớ Ký Ức (chỉ dùng chung phần triển khai API/lập lịch, không chia sẻ giá trị cấu hình)
window.MEMORY_ENGINE_SETTINGS = (function() {
  const STORAGE_KEY = 'memory_engine_settings';
  const VERSION = '1.1.1';
  const DEFAULTS = Object.freeze({
    apiUrl: '',
    apiKey: '',
    model: 'gpt-3.5-turbo',
    connectionMode: 'direct',
    temperature: 0.2,
    maxTokens: 65000,
    apiTimeoutMs: 120000,
    engineEnabled: true,
    firstLayerIsAiOpening: true,
    evolveMode: 'auto',
    evolveEveryX: 1,
    evolveReadRounds: 1,
    manualReadRounds: 1,
    smallSummaryEveryX: 1,
    bigSummaryEveryX: 5,
    bigSummaryInjectLimit: 3,
    hideCoveredRawText: true,
    recentRawRounds: 1,
    referenceRawRounds: 1,
    referenceSmallSummaryCount: 5,
    referenceBigSummaryCount: 1,
    injectIntoPrompt: true,
    injectIntoWorldEngine: false,
    worldEngineMemoryLimit: 5,
    searchDepth: 5,
    maxPerCharacter: 20,
    injectionDiceSides: 10000,
    apiAutoRetries: 0,
    nameBlacklist: '',
    filterRegex: '',
    tonePrompt: '',
    worldbookEnabled: false,
    worldbookTrigger: false,
    syncToChat: false,
    autoBackup: false,
    backfillBatchSize: 5,
    summaryBackfillSmallEveryX: 5,
    summaryBackfillBigEveryX: 5,
    backfillRetries: 2,
    backfillEndLayer: 0
  });

  let cached = null;

  // Trí nhớ hằng ngày lấy một lượt làm đơn vị nhỏ nhất có thể phát lại: nhân vật/thực thể và bản tóm tắt được trích xuất chung trong cùng lượt.
  // Ở đây ghi đè cả dữ liệu lưu trữ cũ lẫn giá trị truyền vào từ UI, để tránh các thiết lập X trong lịch sử tiếp tục có hiệu lực.
  function normalizeSettings(value) {
    const merged = { ...DEFAULTS, ...(value || {}) };
    const savedMaxTokens = Math.max(1, parseInt(merged.maxTokens) || 65000);
    return {
      ...merged,
      // Một số cấu hình bản cũ từng lưu giới hạn đầu ra là 4096; sau khi nâng cấp sẽ tự động chuyển đổi để tránh tiếp tục cắt bớt phản hồi API.
      maxTokens: savedMaxTokens === 4096 ? 65000 : savedMaxTokens,
      evolveEveryX: 1,
      evolveReadRounds: 1,
      manualReadRounds: 1,
      smallSummaryEveryX: 1,
      recentRawRounds: Math.max(0, parseInt(merged.recentRawRounds) || 0),
      referenceRawRounds: Math.max(0, parseInt(merged.referenceRawRounds) || 0),
      referenceSmallSummaryCount: Math.max(0, parseInt(merged.referenceSmallSummaryCount) || 0),
      referenceBigSummaryCount: Math.max(0, parseInt(merged.referenceBigSummaryCount) || 0)
    };
  }

  function readStored() {
    try {
      const raw = window.WORLD_ENGINE_STORE?.getItem(STORAGE_KEY);
      if (!raw) {
        // Ở các phiên bản nhánh thử nghiệm (test) đầu tiên, các trường memory* từng bị đặt nhầm vào world_engine_settings; chỉ di chuyển dữ liệu vào lần đọc đầu tiên.
        const worldRaw = window.WORLD_ENGINE_STORE?.getItem('world_engine_settings');
        const world = worldRaw ? JSON.parse(worldRaw) : {};
        const migrated = {
          evolveMode: world.memoryEvolveMode,
          evolveEveryX: world.memoryEvolveEveryX,
          evolveReadRounds: world.memoryEvolveReadRounds,
          manualReadRounds: world.memoryManualReadRounds,
          injectIntoPrompt: world.memoryInjectIntoPrompt,
          searchDepth: world.memorySearchDepth,
          maxPerCharacter: world.memoryMaxPerCharacter,
          worldbookEnabled: world.memoryWorldbookEnabled,
          backfillBatchSize: world.memoryBackfillBatchSize,
          backfillRetries: world.memoryBackfillRetries,
          backfillEndLayer: world.memoryBackfillEndLayer
        };
        const clean = Object.fromEntries(Object.entries(migrated).filter(([, value]) => value !== undefined));
        if (Object.keys(clean).length) return clean;
      }
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      console.warn('[Memory Engine] Đọc cấu hình thất bại, dùng giá trị mặc định', error);
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
    getSettings,
    saveSettings,
    patchSettings
  };
})();
