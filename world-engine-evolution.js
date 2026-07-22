// world-engine-evolution.js — Gọi API diễn biến thế giới (sử dụng đầy đủ quy tắc của engine sống động)
window.WORLD_ENGINE_EVOLUTION = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const api = window.WORLD_ENGINE_API;

  const EVENT_TYPES = ['conflict', 'progress'];
  const EVENT_STAGE_ORDER = {
    conflict: ['Manh Nha', 'Âm Ỉ', 'Cận Kề'],
    progress: ['Chuẩn Bị', 'Thực Hiện', 'Then Chốt']
  };
  const EVENT_FINAL_STAGE = {
    conflict: 'Đã Bùng Phát',
    progress: 'Đã Hoàn Thành'
  };
  const EVENT_TERMINAL_STAGES = {
    conflict: ['Đã Bùng Phát', 'Đã Tan Biến'],
    progress: ['Đã Hoàn Thành', 'Đã Thất Bại']
  };
  const EVENT_STAGE_BASE = {
    conflict: { 'Manh Nha': 95, 'Âm Ỉ': 85, 'Cận Kề': 75 },
    progress: { 'Chuẩn Bị': 75, 'Thực Hiện': 85, 'Then Chốt': 95 }
  };
  const WIND_DECAY = {
    announcement: { base: 10, grace: 4, linear: 3, quadratic: 1 },
    report: { base: 20, grace: 2, linear: 4, quadratic: 2 },
    rumor: { base: 25, grace: 1, linear: 5, quadratic: 3 },
    sentiment: { base: 8, grace: 5, linear: 2, quadratic: 1 }
  };

  function localSettings() {
    return api && api.getSettings ? api.getSettings() : {};
  }

  function numSetting(key, fallback, min, max) {
    const n = Number(localSettings()[key]);
    let v = Number.isFinite(n) ? n : fallback;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  function intSetting(key, fallback, min, max) {
    return Math.round(numSetting(key, fallback, min, max));
  }

  function capSetting(key, fallback) {
    return intSetting(key, fallback, 1);
  }

  function windDecayParams(type) {
    const defaults = WIND_DECAY[type] || WIND_DECAY.rumor;
    const prefix = {
      announcement: 'localWindAnnouncement',
      report: 'localWindReport',
      rumor: 'localWindRumor',
      sentiment: 'localWindSentiment'
    }[type] || 'localWindRumor';
    return {
      base: numSetting(prefix + 'Base', defaults.base, 0, 95),
      grace: intSetting(prefix + 'Grace', defaults.grace, 0),
      linear: numSetting(prefix + 'Linear', defaults.linear, 0),
      quadratic: numSetting(prefix + 'Quadratic', defaults.quadratic, 0)
    };
  }

  function positiveTerminalKeepRounds(event) {
    const base = intSetting('localTerminalBaseKeepRounds', 2, 0);
    const perLevel = intSetting('localTerminalLevelKeepRounds', 2, 0);
    return base + (event.level || 1) * perLevel;
  }

  let _lastPrompt = '';
  let _lastRawResult = '';
  // [MAP] Các đoạn prompt diễn biến (dùng để hiển thị minh bạch toàn bộ, chỉ đọc). Khớp từng byte với prompt thực tế gửi đi:
  // mỗi đoạn được tách thành biến có tên riêng, template literal và mảng segments cùng tham chiếu một biến, tránh việc tính lại/sao chép bị lệch.
  let _lastPromptSegments = [];

  function getLastDebug() {
    return { prompt: _lastPrompt, rawResult: _lastRawResult, segments: _lastPromptSegments };
  }

  // ========== Hệ thống xúc xắc sự kiện đột phát khu vực ==========

  const REGIONAL_INCIDENT_CONFIG = {
    chance: 0.03,
    durationRounds: 5,
    cooldownRounds: 5,
    typeWeights: [
      { type: 'banditry', label: 'Giặc Cướp Hoành Hành', weight: 18 },
      { type: 'fire', label: 'Hỏa Hoạn', weight: 14 },
      { type: 'massacre', label: 'Án Mạng Nghiêm Trọng', weight: 10 },
      { type: 'flood', label: 'Lũ Lụt', weight: 10 },
      { type: 'infrastructure', label: 'Đường Sá Thủy Lợi Sụp Đổ', weight: 10 },
      { type: 'plague', label: 'Dịch Bệnh', weight: 9 },
      { type: 'famine', label: 'Nạn Đói Mất Mùa', weight: 8 },
      { type: 'riot', label: 'Bạo Loạn', weight: 8 },
      { type: 'rebellion', label: 'Dân Biến Nổi Loạn', weight: 5 },
      { type: 'military', label: 'Biến Cố Quân Sự', weight: 4 },
      { type: 'earthquake', label: 'Động Đất Lở Núi', weight: 2 },
      { type: 'storm', label: 'Bão Tố Tuyết Lớn', weight: 2 }
    ]
  };

  const INCIDENT_TYPE_GUIDE = {
    banditry: 'Giặc cướp hoành hành: sơn tặc, thủy khấu, lưu khấu, băng cướp, cướp tiêu cục, chặn thuyền, cướp lương, cướp muối, tàn sát thôn trại hoặc thương đội.',
    fire: 'Hỏa hoạn: xảy ra hỏa hoạn diện rộng tại phường chợ, kho lương, bến tàu, chùa chiền, quan nha, xưởng thợ, đoàn thuyền, kho hàng.',
    massacre: 'Án mạng nghiêm trọng: các vụ án đủ sức gây hoảng loạn như giết người hàng loạt, thảm sát cả nhà, án máu ở khách điếm, thương đội bị tàn sát, xác chết ở bến tàu.',
    flood: 'Lũ lụt: nước sông dâng cao, đê vỡ, bến tàu ngập nước, ruộng làng bị phá hủy, cầu bị cuốn trôi.',
    infrastructure: 'Đường sá thủy lợi sụp đổ: quan đạo sạt lở, cầu sập, bến đò ngừng hoạt động, đê nứt vỡ, cống nước hư hỏng, đường trạm bị cắt đứt.',
    plague: 'Dịch bệnh: dịch ở người, dịch gia súc, nguồn nước nhiễm bệnh, thôn làng bị phong tỏa, bến tàu từ chối chở khách, người sốt cao trong thành tăng vọt.',
    famine: 'Nạn đói mất mùa: kho lương cạn kiệt, lương cứu tế bị cắt, giá lương thực tăng vọt, dân đói cướp lương, nhà giàu đóng kho, làng quê đứt bữa.',
    riot: 'Bạo loạn: ẩu đả ở bến tàu, dân đói cướp lương, hành hương giẫm đạp, tiệm muối bị đập phá, xung đột ở cửa ải, xung đột chợ búa lan rộng.',
    rebellion: 'Dân biến nổi loạn: lưu dân lập trại, hương binh chống quan, bạo động vì sưu thuế, tà giáo tụ tập, nổi loạn địa phương.',
    military: 'Biến cố quân sự: quân trấn thủ binh biến, quân lương bị cướp, quân biên ải tan vỡ bỏ chạy, địch quân vượt biên, quan ải giới nghiêm, doanh trại kinh động ban đêm.',
    earthquake: 'Động đất lở núi: động đất, lở núi, sập hầm mỏ, nứt đất, làng miền núi bị chôn vùi.',
    storm: 'Bão tố tuyết lớn: bão, tuyết lớn, bão cát, rét đậm, gió biển làm đắm thuyền, gió lớn phá hủy lều trại.'
  };

  function ensureRegionalIncident(state) {
    if (!state.regionalIncident) {
      state.regionalIncident = {
        active: false,
        title: '',
        type: '',
        scope: '',
        impact: '',
        duration: 0,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    }
  }

  function getIncidentTypeLabel(type) {
    const found = REGIONAL_INCIDENT_CONFIG.typeWeights.find(t => t.type === type);
    return found ? found.label : type;
  }

  function buildRegionalIncidentOngoingPrompt(incident) {
    return `
【Sự kiện đột phát khu vực vẫn đang tiếp diễn (còn lại ${incident.duration} lượt)】
Tiêu đề: ${incident.title}
Loại: ${getIncidentTypeLabel(incident.type)}
Phạm vi: ${incident.scope}
Ảnh hưởng hiện tại: ${incident.impact}
Sự kiện này vẫn đang trong giai đoạn hoạt động. Trong lượt diễn biến này, hãy tiếp tục thể hiện dư chấn của nó (kinh tế, Tin Đồn, hành động thế lực, v.v.), không được viết thành đã lắng xuống, cũng không được tạo sự kiện mới trong trường regionalIncident.
`;
  }

  function weightedPick(items, randomFn = Math.random) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = randomFn() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function buildRegionalIncidentPrompt(picked) {
    const guide = INCIDENT_TYPE_GUIDE[picked.type] || '';
    return `
【Chỉ thị bắt buộc từ xúc xắc cục bộ: lượt này bắt buộc phải tạo sự kiện đột phát khu vực】
Xúc xắc cục bộ đã quyết định: lượt này kích hoạt sự kiện đột phát khu vực.
Xúc xắc cục bộ đã chỉ định loại sự kiện:
Loại: ${picked.label}
type: ${picked.type}
Giải thích loại: ${guide}
Bạn phải căn cứ vào trạng thái thế giới hiện tại, tạo ra một sự kiện đột phát cấp khu vực phù hợp với loại này.
Sự kiện phải thỏa mãn:
1. Sự kiện ảnh hưởng đến một khu vực, con đường, thị trấn, cửa ải, bến tàu, chùa chiền, chợ, thôn làng, tuyến buôn bán hoặc đường thủy cụ thể.
2. Sự kiện không phải là tình tiết nhỏ nhặt, không phải tiếng ồn của người qua đường, không phải tai nạn ngẫu nhiên của một cá nhân.
3. Sự kiện phải tạo ra Tin Đồn có thể lan truyền.
4. Sự kiện phải gây ra ít nhất một loại ảnh hưởng lan tỏa: biến động kinh tế, hành động thế lực, thay đổi trị an, biến động chuỗi sự kiện, thay đổi danh tiếng, thay đổi hộp đen hoặc chuỗi ảnh hưởng mới.
5. Sự kiện không có quan hệ nhân quả trực tiếp với hành vi hiện tại của {{user}}, không được viết thành âm mưu của kẻ thù, thế lực hoặc chuỗi sự kiện đã có sẵn.
6. Địa điểm xảy ra sự kiện do bạn tự chọn dựa trên trạng thái thế giới hiện tại, nhưng phải hợp lý, không được hủy diệt sân khấu cốt lõi một cách vô căn cứ, không được phá hủy tài sản cốt lõi của {{user}} vô cớ.
7. Nếu sự kiện không xảy ra tại khu vực của {{user}}, không được cưỡng ép ngắt hành động hiện tại của {{user}}, chỉ đóng vai trò là biến động thế giới hậu trường, tin tức từ xa hoặc Tin Đồn lan truyền.
8. Nếu sự kiện xảy ra tại khu vực của {{user}}, có thể tạo áp lực cho cảnh hiện tại, nhưng vẫn không được thay {{user}} đưa ra lựa chọn.
9. Cấm tạo các sự kiện giá trị thấp như xe ngựa hoảng loạn, ngoại tình bị bắt, người qua đường cãi vã, trộm vặt, say rượu gây rối, tranh chấp hàng xóm thông thường.
10. Cấm viết "sự kiện đột phát khu vực" thành âm mưu đã được một thế lực có sẵn lên kế hoạch từ trước; trừ khi trong trạng thái hiện có tồn tại bằng chứng nhân quả rõ ràng.
Bạn phải trả về các trường JSON sau:
{
  "regionalIncident": {
    "active": true,
    "title": "Tiêu đề sự kiện",
    "type": "${picked.type}",
    "scope": "Phạm vi ảnh hưởng",
    "impact": "Tóm tắt hậu quả khu vực trong một câu"
  },
  "winds": [
    {
      "topic": "Tên chủ đề ổn định",
      "type": "report",
      "level": 1-4,
      "content": "Lời đồn đang lan truyền",
      "scope": "Phạm vi lan truyền",
      "source": "Chuỗi nguồn tin"
    }
  ],
  "influenceChain": [
    {
      "trigger": "Tiêu đề sự kiện đột phát khu vực",
      "impact": "Ảnh hưởng trực tiếp đã gây ra",
      "fallout": "Dư chấn tiếp theo"
    }
  ]
}
Nếu sự kiện đã đủ để hình thành xung đột kéo dài hoặc nhiệm vụ quản trị, có thể trả về thêm events.
Nếu sự kiện ảnh hưởng đến chợ, đường sá, đường thủy, giá lương thực, giá muối, vận chuyển hàng hóa, có thể trả về thêm economy.
Nếu sự kiện ảnh hưởng đến phán đoán hoặc tài nguyên của một thế lực nào đó, có thể trả về thêm factions.
Nếu sự kiện ảnh hưởng đến danh tiếng của {{user}}, có thể trả về thêm reputation.
Nếu sự kiện có nhân chứng bí mật, bằng chứng ẩn giấu, nhân vật mất tích, sự thật chưa công khai, có thể trả về thêm blackbox.
`;
  }

  function rollRegionalIncident(state, randomFn = Math.random) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // Sự kiện đang tiếp diễn: đếm ngược mỗi lượt, về 0 thì tan biến và vào thời gian hồi
    if (incident.active) {
      const remaining = Math.max(0, (incident.duration || 0) - 1);
      incident.duration = remaining;
      if (remaining <= 0) {
        const title = incident.title;
        incident.active = false;
        incident.title = '';
        incident.type = '';
        incident.scope = '';
        incident.impact = '';
        incident.duration = 0;
        incident.cooldown = intSetting('localRegionalIncidentCooldown', REGIONAL_INCIDENT_CONFIG.cooldownRounds, 1);
        incident._retry = false;
        incident._retryType = '';
        console.log('[World Engine] Sự kiện đột phát khu vực đã tan biến (hết thời hạn tiếp diễn):', title);
        return { triggered: false, injectPrompt: '', reason: 'expired' };
      }
      // Vẫn đang tiếp diễn, chèn gợi ý "đang tiếp diễn"
      return {
        triggered: true,
        ongoing: true,
        injectPrompt: buildRegionalIncidentOngoingPrompt(incident),
        reason: 'ongoing'
      };
    }

    // Đang trong thời gian hồi
    if ((incident.cooldown || 0) > 0) {
      incident.cooldown = Math.max(0, incident.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const dice = randomFn();
    const chance = numSetting('localRegionalIncidentChancePercent', REGIONAL_INCIDENT_CONFIG.chance * 100, 0, 100) / 100;

    // Xác định có cần kích hoạt hay không
    let triggerNow = false;
    let triggerType = incident._retryType || '';
    let triggerLabel = '';

    if (incident._retry && triggerType) {
      // Xúc xắc lượt trước thành công nhưng API không trả về → thử lại, loại giữ nguyên
      triggerNow = true;
      incident._retry = false;
      incident._retryType = '';
      const found = REGIONAL_INCIDENT_CONFIG.typeWeights.find(t => t.type === triggerType);
      if (found) triggerLabel = found.label;
    }

    if (!triggerNow && dice >= chance) {
      // Không kích hoạt
      incident.active = false;
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };
    }

    // Kích hoạt (lượt đầu tiên)
    let picked;
    if (!triggerNow) {
      picked = weightedPick(REGIONAL_INCIDENT_CONFIG.typeWeights, randomFn);
      triggerType = picked.type;
      triggerLabel = picked.label;
    }

    incident.active = true;
    incident.type = triggerType;
    incident.duration = intSetting('localRegionalIncidentDuration', REGIONAL_INCIDENT_CONFIG.durationRounds, 1); // Số lượt tiếp diễn, thời gian hồi chỉ bắt đầu sau khi tan biến
    incident.cooldown = 0;

    return {
      triggered: true,
      ongoing: false,
      incidentType: triggerType,
      incidentLabel: triggerLabel,
      injectPrompt: buildRegionalIncidentPrompt({ type: triggerType, label: triggerLabel || triggerType }),
      chance,
      dice,
      reason: triggerNow ? 'retry' : 'hit'
    };
  }

  function mergeRegionalIncident(state, update) {
    ensureRegionalIncident(state);
    const incident = state.regionalIncident;

    // Lượt này xúc xắc cục bộ không kích hoạt, không chấp nhận API tự phát sinh
    if (!incident.active) {
      incident.title = '';
      incident.type = '';
      incident.scope = '';
      incident.impact = '';
      incident._retry = false;
      incident._retryType = '';
      return;
    }

    // Sự kiện đang tiếp diễn (đã có tiêu đề): nội dung cố định, không chấp nhận API ghi đè
    if (incident.title) {
      if (update.regionalIncident) delete update.regionalIncident;
      return;
    }

    // Lượt đầu vừa kích hoạt (chưa có tiêu đề): hợp nhất nội dung sự kiện API trả về
    const duration = incident.duration || intSetting('localRegionalIncidentDuration', REGIONAL_INCIDENT_CONFIG.durationRounds, 1);
    if (update.regionalIncident && update.regionalIncident.active) {
      state.regionalIncident = {
        active: true,
        title: update.regionalIncident.title || 'Sự kiện đột phát khu vực chưa đặt tên',
        type: update.regionalIncident.type || incident.type || 'other',
        scope: update.regionalIncident.scope || 'Khu vực chưa xác định',
        impact: update.regionalIncident.impact || 'Trật tự khu vực bị xáo trộn.',
        duration,
        cooldown: 0,
        _retry: false,
        _retryType: ''
      };
    } else {
      // API không trả về → đặt cờ thử lại, tiếp tục vào lượt sau
      state.regionalIncident = {
        active: false,
        title: 'Tạo sự kiện đột phát khu vực thất bại (sẽ thử lại vào lượt sau)',
        type: incident.type || 'other',
        scope: 'Khu vực chưa xác định',
        impact: 'Xúc xắc cục bộ đã kích hoạt sự kiện đột phát khu vực, nhưng API không trả về regionalIncident. Lượt sau sẽ thử lại cùng loại.',
        duration: 0,
        cooldown: 0,
        _retry: true,
        _retryType: incident.type || ''
      };
    }
  }

  // ========== Sự kiện ngẫu nhiên phương xa (do sổ cái dẫn động, xúc xắc cục bộ, thất bại thì thử lại liên tục) ==========
  function ensureDistantEvent(state) {
    if (!state.distantEvent || typeof state.distantEvent !== 'object') {
      state.distantEvent = { pending: false, cooldown: 0, sample: [], requestedRound: 0, requestedType: '' };
    }
    state.distantEvent.pending = state.distantEvent.pending === true;
    state.distantEvent.cooldown = Math.max(0, parseInt(state.distantEvent.cooldown) || 0);
    state.distantEvent.sample = Array.isArray(state.distantEvent.sample) ? state.distantEvent.sample : [];
    state.distantEvent.requestedRound = Math.max(0, parseInt(state.distantEvent.requestedRound) || 0);
    state.distantEvent.requestedType = ['event', 'wind'].includes(state.distantEvent.requestedType) ? state.distantEvent.requestedType : '';
    return state.distantEvent;
  }

  function pickDistantEventType(randomFn = Math.random) {
    const eventChance = numSetting('localDistantEventEventPercent', 50, 0, 100) / 100;
    return randomFn() < eventChance ? 'event' : 'wind';
  }

  function sampleDistantLedger(state, randomFn = Math.random) {
    const entries = (state.memories || []).filter(m => m && m.type === 'ledger');
    const recentCount = Math.floor(entries.length / 4);
    const targetCount = Math.floor(entries.length / 2);
    const recent = entries.slice(0, recentCount);
    const older = entries.slice(recentCount);
    for (let i = older.length - 1; i > 0; i--) {
      const j = Math.floor(randomFn() * (i + 1));
      [older[i], older[j]] = [older[j], older[i]];
    }
    return recent.concat(older.slice(0, Math.max(0, targetCount - recent.length))).map(entry => ({
      round: entry.round,
      changes: Array.isArray(entry.changes) ? entry.changes : []
    }));
  }

  function buildDistantEventPrompt(sample, requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? 'một chuỗi sự kiện events mới' : 'một Tin Đồn winds mới';
    return `
【Chỉ thị bắt buộc từ cơ chế ngẫu nhiên cục bộ: lượt này bắt buộc phải tạo một diễn biến ở phương xa】
Dưới đây là một phần sổ cái lịch sử, chỉ dùng để nhận diện các chủ đề sự kiện, cấu trúc xung đột và nội dung Tin Đồn đã từng sử dụng. Không được viết tiếp, viết lại, sao chép hay liên hệ trực tiếp đến các bản ghi này:
${JSON.stringify(sample || [], null, 2)}

Hệ thống cục bộ đã chỉ định loại diễn biến phương xa cho lượt này: ${wantsEvent ? 'chuỗi sự kiện events' : 'Tin Đồn winds'}.
Kết hợp trạng thái thế giới hiện tại, world book, bối cảnh thời đại, cấu trúc địa lý và hệ sinh thái nhân vật, hãy tạo mới độc lập ${targetText} cho diễn biến phương xa lần này (không ảnh hưởng đến việc bạn cập nhật bình thường các trạng thái thế giới khác đã có). Không được đổi sang loại khác.

Yêu cầu bắt buộc:
- Cấp độ của đối tượng mới chỉ được là Lv2 hoặc Lv3.
- Đối tượng mới phải đặt "id": null, và đặt thêm cờ tạm "_distanceGenerated": true.
- Cờ tạm này chỉ dùng để hệ thống cục bộ xác nhận đã tạo thành công; không được thêm vào các đối tượng khác.
- Không có quan hệ nhân quả trực tiếp với hành vi, tài sản, danh tiếng, kẻ thù và bối cảnh hiện tại của {{user}}, không được cưỡng ép ngắt hành động hiện tại của {{user}}.
- Không được do các sự kiện, xung đột thế lực hoặc Tin Đồn đã có trong sổ cái nêu trên trực tiếp gây ra, cũng không được sao chép chủ đề và cấu trúc của chúng.
- Phải bắt rễ từ thế giới quan hiện tại và các điều kiện thế giới đã có, xảy ra ở khu vực, nhóm người hoặc hệ thống xã hội phương xa tồn tại hợp lý, không được là nhiễu ngẫu nhiên vô căn cứ.
- ${wantsEvent ? 'phải thỏa mãn các quy tắc chấp nhận chung của events, và điền đầy đủ các trường của sự kiện mới.' : 'phải thỏa mãn các quy tắc chấp nhận chung của winds, và điền đầy đủ các trường Tin Đồn mới.'}
- Diễn biến phương xa lần này chỉ được có một đối tượng mới mang cờ "_distanceGenerated"; nếu cùng lượt còn có các chỉ thị bắt buộc cục bộ khác, phải hoàn thành riêng biệt, không tính vào giới hạn một đối tượng của cơ chế này.
`;
  }

  function rollDistantEvent(state, randomFn = Math.random) {
    const distant = ensureDistantEvent(state);
    const ledgerEntries = (state.memories || []).filter(m => m && m.type === 'ledger');

    if (distant.pending) {
      if (!distant.sample.length && ledgerEntries.length) distant.sample = sampleDistantLedger(state, randomFn);
      // Tương thích với các bản lưu ở giai đoạn đầu ra mắt tính năng đã vào trạng thái pending nhưng chưa lưu loại mục tiêu.
      if (!distant.requestedType) distant.requestedType = pickDistantEventType(randomFn);
      return { triggered: true, retry: true, requestedType: distant.requestedType, injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType), reason: 'retry' };
    }
    if (distant.cooldown > 0) {
      distant.cooldown = Math.max(0, distant.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const threshold = intSetting('localDistantEventLedgerThreshold', 10, 1);
    if (ledgerEntries.length < threshold) return { triggered: false, injectPrompt: '', reason: 'ledger-threshold' };

    const chance = numSetting('localDistantEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    distant.pending = true;
    distant.sample = sampleDistantLedger(state, randomFn);
    distant.requestedRound = state.round;
    distant.requestedType = pickDistantEventType(randomFn);
    return { triggered: true, retry: false, requestedType: distant.requestedType, injectPrompt: buildDistantEventPrompt(distant.sample, distant.requestedType), chance, dice, reason: 'hit' };
  }

  function acceptDistantEventResult(state, update) {
    const distant = ensureDistantEvent(state);
    const markedEvents = (update.events || []).filter(item => item && item._distanceGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._distanceGenerated === true);
    const marked = markedEvents.concat(markedWinds);

    // Cờ tạm dù có ở trạng thái pending hay không cũng không được đi vào trạng thái chính thức.
    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_distanceGenerated')) delete item._distanceGenerated;
    }
    if (!distant.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((distant.requestedType === 'event' && isEvent) || (distant.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && ['conflict', 'progress'].includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && candidate._nearGenerated !== true && typeMatches && (level === 2 || level === 3) && validShape;

    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[World Engine] Sự kiện ngẫu nhiên phương xa không vượt qua kiểm định, lượt sau sẽ tiếp tục bắt buộc tạo');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    distant.pending = false;
    distant.cooldown = intSetting('localDistantEventCooldown', 5, 1);
    distant.sample = [];
    distant.requestedRound = 0;
    distant.requestedType = '';
    console.log('[World Engine] Tạo sự kiện ngẫu nhiên phương xa thành công:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  // ========== Sự kiện ngẫu nhiên gần (do cốt truyện hiện tại dẫn động, xúc xắc cục bộ, thất bại thì thử lại liên tục) ==========
  function ensureNearEvent(state) {
    if (!state.nearEvent || typeof state.nearEvent !== 'object') {
      state.nearEvent = { pending: false, cooldown: 0, requestedRound: 0, requestedType: '' };
    }
    state.nearEvent.pending = state.nearEvent.pending === true;
    state.nearEvent.cooldown = Math.max(0, parseInt(state.nearEvent.cooldown) || 0);
    state.nearEvent.requestedRound = Math.max(0, parseInt(state.nearEvent.requestedRound) || 0);
    state.nearEvent.requestedType = ['event', 'wind'].includes(state.nearEvent.requestedType) ? state.nearEvent.requestedType : '';
    return state.nearEvent;
  }

  function pickNearEventType(randomFn = Math.random) {
    const eventChance = numSetting('localNearEventEventPercent', 50, 0, 100) / 100;
    return randomFn() < eventChance ? 'event' : 'wind';
  }

  function buildNearEventPrompt(requestedType) {
    const wantsEvent = requestedType === 'event';
    const targetText = wantsEvent ? 'một chuỗi sự kiện events mới' : 'một Tin Đồn winds mới';
    return `
【Chỉ thị bắt buộc từ cơ chế ngẫu nhiên cục bộ: lượt này bắt buộc phải tạo một diễn biến gần】
Hệ thống cục bộ đã chỉ định loại diễn biến gần cho lượt này: ${wantsEvent ? 'chuỗi sự kiện events' : 'Tin Đồn winds'}.
Kết hợp trạng thái thế giới hiện tại, world book và các đoạn hội thoại gần đây, hãy thêm mới ${targetText} cho diễn biến gần lần này. Không được đổi sang loại khác.

Yêu cầu bắt buộc:
- Cấp độ của đối tượng mới chỉ được là Lv2 hoặc Lv3.
- Đối tượng mới phải đặt "id": null, và đặt thêm cờ tạm "_nearGenerated": true.
- Cờ tạm này chỉ dùng để hệ thống cục bộ xác nhận đã tạo thành công; không được thêm vào các đối tượng khác, cũng không được dùng đồng thời với "_distanceGenerated".
- Nội dung phải có quan hệ nhân quả rõ ràng và có thể truy vết với hành động hiện tại, đối tượng tiếp xúc, khu vực, cảnh hiện tại hoặc sự việc đang phát triển của {{user}}, không được chỉ là cùng nằm ở một nơi hoặc đề tài tương tự.
- Không được thay {{user}} đưa ra quyết định, không được bịa đặt nhân chứng, sự lan truyền, nguồn tin tình báo hoặc các điều kiện then chốt khác.
- ${wantsEvent
      ? 'phải thỏa mãn quy tắc tạo mới và hợp nhất của events: nó phải là một sự việc chính mới có thể phát triển độc lập qua nhiều lượt, không được tách các bước, trở ngại, kết quả cục bộ hoặc hậu quả của sự kiện đã có thành chuỗi mới.'
      : 'phải thỏa mãn quy tắc lan truyền của winds: thông tin đã bắt đầu lan truyền qua các nút hợp lệ, và ghi rõ scope và source thực tế.'}
- Diễn biến gần lần này chỉ được có một đối tượng mới mang cờ "_nearGenerated"; nếu cùng lượt còn có các chỉ thị bắt buộc cục bộ khác, phải hoàn thành riêng biệt, không tính vào giới hạn một đối tượng của cơ chế này.
`;
  }

  function rollNearEvent(state, randomFn = Math.random) {
    const near = ensureNearEvent(state);
    if (near.pending) {
      if (!near.requestedType) near.requestedType = pickNearEventType(randomFn);
      return { triggered: true, retry: true, requestedType: near.requestedType, injectPrompt: buildNearEventPrompt(near.requestedType), reason: 'retry' };
    }
    if (near.cooldown > 0) {
      near.cooldown = Math.max(0, near.cooldown - 1);
      return { triggered: false, injectPrompt: '', reason: 'cooldown' };
    }

    const chance = numSetting('localNearEventChancePercent', 20, 0, 100) / 100;
    const dice = randomFn();
    if (dice >= chance) return { triggered: false, injectPrompt: '', chance, dice, reason: 'miss' };

    near.pending = true;
    near.requestedRound = state.round;
    near.requestedType = pickNearEventType(randomFn);
    return { triggered: true, retry: false, requestedType: near.requestedType, injectPrompt: buildNearEventPrompt(near.requestedType), chance, dice, reason: 'hit' };
  }

  function acceptNearEventResult(state, update) {
    const near = ensureNearEvent(state);
    const markedEvents = (update.events || []).filter(item => item && item._nearGenerated === true);
    const markedWinds = (update.winds || []).filter(item => item && item._nearGenerated === true);
    const marked = markedEvents.concat(markedWinds);

    for (const item of [...(update.events || []), ...(update.winds || [])]) {
      if (item && Object.prototype.hasOwnProperty.call(item, '_nearGenerated')) delete item._nearGenerated;
    }
    if (!near.pending) return false;

    const candidate = marked.length === 1 ? marked[0] : null;
    const isEvent = candidate && markedEvents.includes(candidate);
    const typeMatches = !!candidate && ((near.requestedType === 'event' && isEvent) || (near.requestedType === 'wind' && !isEvent));
    const level = candidate ? parseInt(candidate.level) : 0;
    const validShape = isEvent
      ? !!(candidate.name && ['conflict', 'progress'].includes(candidate.type))
      : !!(candidate && candidate.topic && candidate.content);
    const valid = !!candidate && typeMatches && (level === 2 || level === 3) && validShape;

    if (!valid) {
      update.events = (update.events || []).filter(item => !markedEvents.includes(item));
      update.winds = (update.winds || []).filter(item => !markedWinds.includes(item));
      console.warn('[World Engine] Sự kiện ngẫu nhiên gần không vượt qua kiểm định, lượt sau sẽ tiếp tục bắt buộc tạo');
      return false;
    }

    candidate.id = null;
    candidate.level = level;
    near.pending = false;
    near.cooldown = intSetting('localNearEventCooldown', 5, 1);
    near.requestedRound = 0;
    near.requestedType = '';
    console.log('[World Engine] Tạo sự kiện ngẫu nhiên gần thành công:', isEvent ? candidate.name : candidate.topic);
    return true;
  }

  // ========== Xúc xắc thúc đẩy chuỗi sự kiện (hệ thống hai loại bốn giai đoạn) ==========
  // Mỗi giai đoạn có 9 ô, đầy 9 thì thăng cấp lên giai đoạn kế tiếp.
  // conflict: Manh Nha→Âm Ỉ→Cận Kề→Đã Bùng Phát；API có thể phán định Đã Tan Biến；level càng cao càng dễ tiến triển.
  // progress: Chuẩn Bị→Thực Hiện→Then Chốt→Đã Hoàn Thành；API có thể phán định Đã Thất Bại；level càng cao càng khó tiến triển.
  // Trạng thái đình trệ hoàn toàn do API kiểm soát, xúc xắc cục bộ không còn bỏ qua lượt
  function forceTriggerEvents(state) {
    const events = state.events || [];
    let anyTriggered = false;

    for (const ev of events) {
      // Xóa kết quả lượt trước
      delete ev.evolveResult;

      // Khởi tạo các trường
      if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
      if (ev.stageRound === undefined) ev.stageRound = 1;
      if (ev.consecutiveFails === undefined) ev.consecutiveFails = 0;
      const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
      const terminalStages = EVENT_TERMINAL_STAGES[ev.type] || EVENT_TERMINAL_STAGES.conflict;

      // Bỏ qua sự kiện đã đến hồi kết
      if (terminalStages.includes(ev.stage)) continue;
      if (!ev.stage || !stageOrder.includes(ev.stage)) ev.stage = stageOrder[0];

      // Bảo hiểm: liên tục không thành công đến ngưỡng thì ép buộc thành công
      const maxFails = getMaxFails(ev);
      if (ev.consecutiveFails >= maxFails) {
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = 'Thành Công';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
        continue;
      }

      // Đổ xúc xắc bình thường
      const r = Math.min(1, (ev.stageRound || 1) / 9);
      const stageBase = (EVENT_STAGE_BASE[ev.type] || EVENT_STAGE_BASE.conflict)[ev.stage] || 85;
      const level = ev.level || 1;
      const levelAdjust = ev.type === 'progress' ? (level - 1) * 10 : -((level - 1) * 10);
      const threshold = Math.round(stageBase - 200 * r * (1 - r) + levelAdjust - numSetting('localEventDiceModifier', 0, -100, 100));
      const dice = Math.floor(Math.random() * 100) + 1;

      if (dice > threshold) {
        // Thành công: tiến triển
        advanceStageRound(ev);
        ev.consecutiveFails = 0;
        ev.evolveResult = 'Thành Công';
        anyTriggered = true;
        if (ev.stage === EVENT_FINAL_STAGE.conflict) logEruption(state, ev);
      } else if (dice < threshold * (numSetting('localEventSetbackRatioPercent', 40, 0, 100) / 100)) {
        // Thất bại tạm thời: lùi lại
        ev.stageRound = Math.max(1, ev.stageRound - 1);
        ev.consecutiveFails++;
        ev.evolveResult = 'Gặp Trở Ngại';
      } else {
        // Giữ nguyên: không đổi
        ev.consecutiveFails++;
        ev.evolveResult = 'Giữ Nguyên';
      }
    }

    if (anyTriggered) return anyTriggered;
  }

  function getMaxFails(ev) {
    const level = ev.level || 1;
    const progressBase = intSetting('localProgressFailBase', 2, 0);
    const conflictBase = intSetting('localConflictFailBase', 6, 1);
    return ev.type === 'progress' ? progressBase + level : Math.max(1, conflictBase - level);
  }

  function advanceStageRound(ev) {
    const stageOrder = EVENT_STAGE_ORDER[ev.type] || EVENT_STAGE_ORDER.conflict;
    const finalStage = EVENT_FINAL_STAGE[ev.type] || EVENT_FINAL_STAGE.conflict;
    ev.stageRound++;
    if (ev.stageRound >= 9) {
      // Thăng cấp lên giai đoạn kế tiếp
      const idx = stageOrder.indexOf(ev.stage);
      if (idx !== -1 && idx < stageOrder.length - 1) {
        ev.stage = stageOrder[idx + 1];
        ev.stageRound = 1;
      } else {
        ev.stage = finalStage;
        ev.stageRound = 9;
      }
    }
  }

  function logEruption(state, ev) {
    console.log(`[World Engine] Sự kiện bùng nổ: ${ev.name}`);
  }

  // ========== Xúc xắc tan biến Tin Đồn ==========
  // Khi API trả về Tin Đồn cùng id trong lượt này, core.addWind sẽ đặt lại quietRounds về 0.
  // Tin Đồn không được cập nhật sẽ tích lũy im ắng cho đến lần gọi API tiếp theo, và có thể tan biến ngay.
  function decayWinds(state, randomFn = Math.random) {
    const survivors = [];
    const decayed = [];

    for (const wind of state.winds || []) {
      const params = windDecayParams(wind.type);
      const level = Math.min(4, Math.max(1, parseInt(wind.level) || 1));
      wind.quietRounds = Math.max(0, parseInt(wind.quietRounds) || 0) + 1;

      if (wind.quietRounds <= params.grace) {
        survivors.push(wind);
        continue;
      }

      const n = wind.quietRounds - params.grace - 1;
      const chance = Math.min(95, Math.max(5,
        params.base + params.linear * n + params.quadratic * n * n - (level - 1) * 10
      ));
      const dice = Math.floor(randomFn() * 100) + 1;

      if (dice <= chance) decayed.push(wind);
      else survivors.push(wind);
    }

    state.winds = survivors;
    if (decayed.length) {
      console.log(`[World Engine] 🌫️ Tin Đồn tan biến: ${decayed.map(w => w.topic).join(', ')}`);
    }
    return decayed;
  }

  const OUTPUT_INSTRUCTIONS = `
## Giải thích các trường xuất JSON

Bạn phải xuất ra một đối tượng JSON. Chỉ xuất các trường thực sự có thay đổi trong lượt này; cấm tạo nội dung vô nghĩa để lấp đầy.

### Giới hạn số từ khi xuất
Các giới hạn dưới đây tính theo số chữ Hán (Trung văn); dấu câu, khoảng trắng, số và chữ cái tiếng Anh không tính vào số từ; nhưng vẫn yêu cầu diễn đạt súc tích, không được dùng nhiều dấu câu hoặc tiếng Anh để lách giới hạn.
- events.desc: không được vượt quá 50 chữ Hán.
- factions.currentGoal: không được vượt quá 50 chữ Hán.
- winds.content: không được vượt quá 50 chữ Hán.
- influenceChain.impact: không được vượt quá 50 chữ Hán.
- influenceChain.fallout: không được vượt quá 50 chữ Hán.
- worldTrends.description: không được vượt quá 100 chữ Hán.

### events (mảng chuỗi sự kiện)
Trước khi tạo mới hoặc cập nhật events, hãy đối chiếu với các sự việc chính đã có dựa trên mục tiêu/mâu thuẫn cốt lõi, đối tượng chính và quá trình thực hiện liên tục; các bước, trở ngại, cái giá phải trả, kết quả cục bộ và hậu quả của cùng một sự việc phải dùng lại id gốc. Sự việc đã xuất hiện dấu hiệu cụ thể, vẫn còn không gian phát triển, có thể tạo mới với id:null; sự việc không cần phải đã chín muồi, cũng không cần chứng minh trước là chắc chắn sẽ kéo dài qua nhiều lượt. Lên kế hoạch, thăm dò, bắt đầu điều tra hoặc mâu thuẫn mới manh nha đều có thể là giai đoạn đầu của chuỗi sự kiện. Nếu nội dung rõ ràng thuộc về bước, trở ngại hoặc hậu quả trực tiếp của sự việc đã có, thì dùng lại id gốc. Loại sự kiện khác nhau không tự động là lý do để tách chuỗi; chỉ khi hình thành sự việc xung đột hoặc tiến triển có thể diễn biến độc lập mới tạo chuỗi riêng.
Mỗi mục gồm:
- id: sự kiện đã có phải trả về nguyên trạng id hiện tại; sự kiện mới phải điền rõ null, cấm bỏ qua
- name: tên sự kiện. Tên được phép thay đổi theo diễn biến tình hình, nhưng đổi tên không có nghĩa là tạo sự kiện mới
- type: "conflict"/"progress". conflict = chuỗi sự kiện Xung Đột, progress = chuỗi sự kiện Tiến Triển. Sự kiện mới bắt buộc phải điền; type của sự kiện đã có một khi đã xác định thì cấm thay đổi, khi cập nhật sự kiện cùng id phải giữ nguyên type hiện tại.
- level: 1-4. conflict biểu thị mức độ kịch liệt/khả năng mất kiểm soát của xung đột, Lv càng cao càng dễ leo thang; progress biểu thị quy mô sự việc/độ khó hoàn thành, Lv càng cao càng khó hoàn thành.
- stage: dùng các giai đoạn khác nhau tùy theo type:
  - conflict chỉ được dùng "Manh Nha"/"Âm Ỉ"/"Cận Kề"/"Đã Bùng Phát"/"Đã Tan Biến".
    - Manh Nha: xung đột vừa xuất hiện dấu hiệu, chỉ ít người nhận ra, chưa hình thành áp lực công khai.
    - Âm Ỉ: mâu thuẫn bắt đầu lan rộng, tổ chức, nhân lực, tin đồn hoặc động cơ trả thù đang tích tụ.
    - Cận Kề: xung đột sắp biến thành hành động cụ thể hoặc ảnh hưởng trực tiếp, đã gần đến điểm bùng nổ.
    - Đã Bùng Phát: kết quả xung đột đã thành hiện thực, truy sát, truy nã, ẩu đả, phong tỏa, thanh trừng, v.v. đã xảy ra.
    - Đã Tan Biến: xung đột mất động cơ, người thực hiện, tài nguyên, mục tiêu hoặc đã hết hiệu lực, được xác định là sẽ không bùng nổ tiếp nữa.
    - Thứ tự tiến triển bình thường cố định là: Manh Nha → Âm Ỉ → Cận Kề → Đã Bùng Phát; Đã Tan Biến không phải giai đoạn tiến triển bình thường, chỉ có thể do API trực tiếp phán định dựa trên nhân quả rõ ràng.
  - progress chỉ được dùng "Chuẩn Bị"/"Thực Hiện"/"Then Chốt"/"Đã Hoàn Thành"/"Đã Thất Bại".
    - Chuẩn Bị: tài nguyên, nhân lực, vật liệu, tình báo, lộ trình hoặc kế hoạch đang được chuẩn bị, chưa triển khai toàn diện.
    - Thực Hiện: sự việc đã thực sự bắt đầu, có đầu tư liên tục, dấu vết hành động và tiêu hao theo từng giai đoạn.
    - Then Chốt: gần đến kết quả, dễ bị can thiệp, chặn đường, đảo ngược, trì hoãn hoặc phải trả giá nhất.
    - Đã Hoàn Thành: thành quả đã thành hiện thực và đi vào trạng thái thế giới, có thể sinh ra sự kiện, Tin Đồn, biến động kinh tế hoặc thế lực tiếp theo.
    - Đã Thất Bại: sự việc chắc chắn không thể hoàn thành do người thực hiện rút lui, tài nguyên cạn kiệt, điều kiện then chốt mất vĩnh viễn, bị phản chế hiệu quả hoặc đã hết hiệu lực.
    - Thứ tự tiến triển bình thường cố định là: Chuẩn Bị → Thực Hiện → Then Chốt → Đã Hoàn Thành; Đã Thất Bại không phải giai đoạn tiến triển bình thường, chỉ có thể do API trực tiếp phán định dựa trên nhân quả rõ ràng.
- stageRound: tiến độ trong giai đoạn hiện tại 1-8. Ghi 9 ở giai đoạn không phải hồi kết sẽ được hệ thống cục bộ tự động thăng cấp; mọi giai đoạn hồi kết sẽ bị hệ thống cục bộ khóa ở mức 9/9.
- desc: mô tả sự kiện
- stall: true/false (true nghĩa là sự kiện tạm thời đình trệ/bị cản trở, nhưng tương lai vẫn có thể phục hồi; chỉ dùng để đánh dấu, không thay đổi type hay stage; lý do đình trệ và điều kiện phục hồi ghi vào desc)

### Phán định đình trệ và hồi kết của chuỗi sự kiện
- Đình trệ không phải là hồi kết. Chỉ cần vẫn tồn tại điều kiện phục hồi hợp lý, hãy đặt stall=true, và giữ nguyên stage hiện tại.
- conflict chỉ khi xung đột đã được xác định là mất khả năng tiếp tục bùng nổ, mới có thể trực tiếp đánh dấu stage là "Đã Tan Biến".
- progress chỉ khi sự việc đã được xác định là không thể tiếp tục hoặc không thể đạt được mục tiêu, mới có thể trực tiếp đánh dấu stage là "Đã Thất Bại".
- Khi đánh dấu "Đã Tan Biến"/"Đã Thất Bại", desc phải ghi rõ nguyên nhân cụ thể dẫn đến hồi kết; không được chỉ vì liên tục nhiều lượt không có tiến triển mà phán định là hồi kết.
- "Đã Bùng Phát"/"Đã Tan Biến"/"Đã Hoàn Thành"/"Đã Thất Bại" đều là hồi kết, sau khi vào trạng thái này không được phục hồi về giai đoạn không phải hồi kết. Nếu cần khởi động lại, nên tạo chuỗi sự kiện mới.

### factions (mảng thế lực)
Chỉ những nhóm có bản sắc chung ổn định, mục tiêu chung, khả năng ra quyết định có tổ chức và khả năng hành động xuyên nhiều lượt mới được tạo thành thế lực. Không được tạo thế lực cho đám đông tạm thời, đội nhóm nhất thời và công chúng vô tổ chức, cũng không được bịa ra thế lực để lấp đầy số lượng. Chỉ cập nhật khi có trường thực sự thay đổi.
Mỗi mục gồm:
- id: thế lực đã có phải trả về nguyên trạng id hiện tại; thế lực mới phải điền rõ null, cấm bỏ qua
- name: tên thế lực. Khi đổi tên, đổi cờ hiệu hoặc đổi danh xưng vẫn dùng lại id gốc; thế lực mới thực sự tách ra thì dùng đối tượng mới
- scope: phạm vi địa lý mà thế lực trực tiếp kiểm soát hoặc có ảnh hưởng lớn
- status: vận thế tổng thể — "Cực Thịnh"/"Ổn Định"/"Nội Đấu"/"Khốn Đốn"/"Suy Tàn"/"Tan Rã".
  Cực Thịnh = có tiền có người có thế, vững như bàn thạch; Ổn Định = vận hành bình thường không có nguy cơ lớn; Nội Đấu = tranh đấu phe phái nội bộ, nhưng khung sườn chưa tan rã; Khốn Đốn = tài nguyên cạn kiệt hoặc bị phong tỏa, gắng gượng cầm cự; Suy Tàn = mất trụ cột/địa bàn/nhân vật cốt lõi, đang trượt dần đến tan rã; Tan Rã = chỉ còn hư danh, chỉ chờ xác nhận hồi kết.
- relation: thái độ của thế lực này đối với {{user}}, bảy cấp (lấy "Trung Lập" làm chính giữa, chỉ được nhận bảy giá trị này) — "Huyết Minh"/"Đồng Minh"/"Thân Thiện"/"Trung Lập"/"Lạnh Nhạt"/"Thù Địch"/"Thâm Thù".
  Huyết Minh = tin tưởng tuyệt đối, sống chết có nhau; Đồng Minh = địa vị ngang hàng, hỗ trợ lẫn nhau; Thân Thiện = công nhận {{user}}, ưu tiên hợp tác; Trung Lập = không quan tâm không bài xích; Lạnh Nhạt = đã để ý nhưng chưa định hành động; Thù Địch = công khai đối đầu; Thâm Thù = không đội trời chung.
- currentGoal: nội dung mục tiêu hiện tại
- core_person: tên nhân vật cốt lõi
- powerPillars: các trụ cột quyền lực mà thế lực này hiện đang có, tối đa 3 cái, mỗi cái là chuỗi tên ngắn (ví dụ "Uy hiếp vũ lực"/"Quan hệ quan trường"/"Hậu thuẫn tài chính"). Chỉ liệt kê các trụ cột vững chắc và có thực lực; trụ cột đã sụp đổ hoặc mất hiệu lực không được giữ lại. Trường này chỉ thể hiện các trụ cột hiện tại, không bao gồm lịch sử. API phải giải thích sự thay đổi trụ cột trong desc hoặc influenceChain.

### worldTrends (mảng đại thế thiên hạ)
Đại thế thiên hạ là cục diện dài hạn đã thay đổi cách vận hành của quốc gia, quốc tế hoặc toàn bộ thế giới, không phải Tin Đồn thông thường, cũng không phải chuỗi sự kiện đang chờ bùng nổ.
Mỗi mục gồm:
- id: đại thế đã có phải trả về nguyên trạng id hiện tại; đại thế mới phải điền rõ null, cấm bỏ qua
- name: tên đại thế. Khi thay đổi cách diễn đạt vẫn dùng lại id gốc
- scope: phạm vi ảnh hưởng thực tế
- status: "Đang Diễn Ra"/"Đã Kết Thúc"
- description: cục diện hiện tại và cách nó đang ràng buộc hành động của thế giới
- source: nguồn gốc rõ ràng hình thành đại thế này

Quy tắc phán định:
- Mỗi lượt kiểm tra các nguồn khả dĩ như sự kiện Xung Đột Lv4 chuyển sang Đã Bùng Phát, sự kiện Tiến Triển Lv4 chuyển sang Đã Hoàn Thành, sự thật đằng sau Tin Đồn Lv4 được xác nhận rộng rãi, v.v.
- Chỉ khi cục diện mang tính dài hạn, phạm vi rộng, xuyên hệ thống, và buộc nhiều thế lực phải liên tục điều chỉnh hành động, mới tạo đại thế thiên hạ. Lễ hội toàn quốc, thông báo đơn lẻ, sự kiện gây chấn động ngắn hạn không tính.
- Đại thế thiên hạ không tham gia xúc xắc, không tự động tan biến. Đại thế đang tiếp diễn mỗi lượt đều phải là ràng buộc nền cho việc diễn biến chuỗi sự kiện, thế lực, kinh tế và Tin Đồn.
- Chỉ khi xuất hiện sự thật rõ ràng làm thay đổi cục diện mới được cập nhật; chỉ khi cục diện chắc chắn đã kết thúc mới đánh dấu là Đã Kết Thúc.
- Hành động mới, Tin Đồn hoặc biến động kinh tế do đại thế sinh ra nên ghi vào trường tương ứng; sự truyền dẫn xuyên hệ thống ghi vào influenceChain.

### winds (mảng Tin Đồn)
Tin Đồn mới chỉ cần đã có chủ đề thông tin rõ ràng, và đã bắt đầu quá trình lan truyền qua các cách như công bố công khai, người khác nghe được hoặc thuật lại, truyền qua kênh thực tế, lan truyền trong phạm vi nhỏ hoặc cùng bàn tán. Sự lan truyền có thể đang ở giai đoạn khởi đầu, không yêu cầu đã đạt quy mô lớn, thực sự thay đổi hệ thống khác hoặc chứng minh trước là sẽ kéo dài qua nhiều lượt. Thông tin riêng tư hoàn toàn chưa ai nghe được, lời chào hỏi thông thường, không khí thuần túy và sự lặp lại máy móc không mang thông tin mới thì không tạo.
Trước khi tạo phải phán đoán "hợp nhất chủ đề thông tin": Tin Đồn có thể là tin thật, lời đồn, tin truyền sai, cách nói phóng đại hoặc hiểu biết phiến diện; nhưng nó ghi lại chủ đề thông tin đang lan truyền, không phải danh sách sự thật, danh sách chi tiết, danh sách phiên bản hay tiêu đề tiếp theo. Nếu thông tin mới có chung đối tượng cốt lõi, sự kiện/sự việc cốt lõi, cách nói cốt lõi, ý nghĩa lan truyền hoặc hướng xã hội với Tin Đồn đã có, phải dùng lại id gốc để cập nhật content/level/scope/source, không được tạo mới.
Việc bổ sung, tiếp tục lan truyền, thêm chi tiết, mở rộng phạm vi, đổi giọng điệu, biến đổi phiên bản, thay đổi độ tin cậy, tăng nhiệt cảm xúc hoặc mở rộng ảnh hưởng của cùng một chủ đề thông tin, đều nên hợp nhất vào Tin Đồn gốc. Cấm tạo Tin Đồn trùng lặp chỉ vì thay đổi tiêu đề, thay đổi cách diễn đạt, hậu tố phiên bản hoặc thay đổi giai đoạn lan truyền. Chỉ khi ý nghĩa lan truyền cốt lõi đã thay đổi, và chỉ đến đối tượng khác, phán đoán khác, quan hệ lợi ích khác, phán đoán rủi ro khác hoặc hành động nhóm khác, mới được phép tạo Tin Đồn mới.
Mỗi mục gồm:
- id: Tin Đồn đã có phải trả về nguyên trạng id hiện tại; Tin Đồn mới phải điền rõ null, cấm bỏ qua
- topic: chủ đề của Tin Đồn. Cách nói, tâm điểm hoặc tiêu đề đang lan truyền có thể thay đổi; miễn là vẫn cùng mạch lan truyền, thì dùng lại id gốc.
- type: "announcement"/"report"/"rumor"/"sentiment", lần lượt biểu thị công báo, tin tức, lời đồn, dư luận.
- level: 1-4, biểu thị quy mô lan truyền thực tế: 1 = số ít người trong giới, 2 = địa phương, 3 = vùng lớn, 4 = quốc gia/quốc tế/thiên hạ.
- content: cách nói cụ thể đang lan truyền hiện tại; cập nhật trường này khi nội dung lan truyền biến chất.
- scope: khu vực hoặc tầng lớp cụ thể mà thông tin thực sự đã lan đến hiện tại.
- source: nguồn gốc và chuỗi lan truyền. Khi liên quan đến {{user}} phải viết ra chuỗi thông tin đầy đủ.

### Yêu cầu liên động của Tin Đồn
- Mỗi lượt kiểm tra winds đã có, nhưng chỉ khi xuất hiện nút lan truyền hợp lệ mới được mở rộng level hoặc scope; không được tự động nâng cấp.
- Tin Đồn chỉ khi đã lan đến phạm vi hoặc tầng lớp nơi đối tượng liên quan sinh sống, mới được phép thay đổi factions, reputation, economy, enemies hoặc events.
- Khi Tin Đồn dẫn đến biến động xuyên hệ thống, phải đồng bộ ghi vào influenceChain, làm rõ "Tin Đồn nào → ai biết được → thực hiện hành động gì/hình thành phán đoán gì".
- Công báo chỉ chứng minh người phát ra đã công khai nói điều này, không đảm bảo nội dung là thật; lời đồn cũng có thể vừa hay là thật. Không sử dụng trường độ tin cậy.
- Tin nhắn riêng, mật lệnh, v.v. chỉ có người nhận rõ ràng không thuộc về Tin Đồn; chỉ khi bị lộ và bắt đầu lan truyền mới tạo Tin Đồn.
- Tin Đồn không tạo ra ảnh hưởng lan tỏa thực tế thì chỉ cần cập nhật winds, không được cố tạo ra biến động ở hệ thống khác.
- Nếu một Tin Đồn liên tục nhiều lượt không có cập nhật thực chất nào, hệ thống cục bộ sẽ phán định là tan biến và xóa trước lượt diễn biến sau. Nếu một Tin Đồn trong lượt này vẫn đang lan truyền, biến chất, mở rộng phạm vi hoặc tiếp tục ảnh hưởng thế giới, phải trả về cập nhật cùng id; chỉ thuật lại y nguyên mà không có thay đổi thực tế thì không tính là cập nhật.
- quietRounds là trường nội bộ cục bộ, cấm xuất ra hoặc sửa đổi.

### economy (đối tượng kinh tế)
- climate: khí hậu kinh tế — nhiệt độ kinh tế khu vực hiện tại: "Phồn Vinh"/"Bình Ổn"/"Suy Thoái"/"Biến Động"
- signals: mảng tín hiệu thị trường. Mỗi mục { summary: "mô tả biến động và ảnh hưởng trong một câu", scope: "phạm vi địa lý bị ảnh hưởng (tên khu vực cụ thể)" }. Ghi lại các biến động kinh tế đáng chú ý trên thị trường hiện tại — biến động này phải đủ sức ảnh hưởng đến hành động thế lực, quyết định của NPC hoặc chiều hướng chuỗi sự kiện. Các dao động vặt vãnh hàng ngày không xứng đáng được đưa vào. Thường không quá 3 mục.
- signal phải là biến động thị trường đã thực sự xảy ra, không được chỉ là dự đoán; chỉ cập nhật khi mức độ, phạm vi, nguyên nhân hoặc ảnh hưởng đến quyết định thay đổi thực chất, và loại bỏ khi ảnh hưởng đã biến mất. Biến động của một mặt hàng đơn lẻ thường không được thay đổi climate của cả khu vực.

### reputation (đối tượng danh tiếng)
Chỉ khi thông tin đã lan đến tầng lớp tương ứng, và đủ để thay đổi đánh giá tổng thể của tầng lớp đó đối với {{user}}, mới được thay đổi danh tiếng. Thái độ của một NPC đơn lẻ, hành vi chưa lan truyền và tin cũ lặp lại không được thay đổi danh tiếng; không có sự thật mới cần thiết để vượt cấp thì đừng trả về reputation.
Bốn chiều danh tiếng, mỗi chiều năm cấp (từ thấp đến cao, chỉ được nhận năm giá trị này): Thiên Nộ Nhân Oán→Tai Tiếng Lẫy Lừng→Vô Danh Tiểu Tốt→Được Kính Trọng→Vạn Người Ngưỡng Mộ
- authority: chốn triều đình — đánh giá của thế lực cầm quyền/thể chế đối với {{user}}. Tuân pháp/phạm pháp, phục tùng/khiêu khích.
- common: chốn thị tứ — tiếng tăm của {{user}} trong mắt dân thường/dư luận đường phố. Nhân từ/tàn bạo, người bảo vệ/kẻ đe dọa.
- shadow: chốn giang hồ thảo mãng — cách nhìn của các thế lực ngoài thể chế (lục lâm/buôn lậu/lính đánh thuê/hacker/băng đảng ngầm, v.v.) đối với {{user}}. Tiêu chuẩn cốt lõi: có gan hay không có gan. Dùng sức mạnh cá nhân chống lại bất công của thể chế, đứng ra bênh vực kẻ yếu → cộng điểm; áp bức dân thường, bán đứng đồng đạo, cậy mạnh hiếp yếu → trừ điểm. Tội phạm hình sự đơn thuần không tự động được giang hồ tôn trọng.
- circuit: chốn đồng đạo — đánh giá của đồng nghiệp trong ngành nghề/giới chuyên môn mà {{user}} thuộc về. Tay nghề cao thấp, có tuân thủ quy tắc ngành hay không, có đóng góp cho ngành hay không.
- lastChange: tóm tắt thay đổi trong lượt này (ví dụ "không thay đổi" hoặc "đánh giá của triều đình tăng do hỗ trợ bắt giữ tội phạm")

### world_digest (chuỗi ký tự)
Bài tường thuật diễn biến thế giới ở hậu trường trong lượt này, 150-200 chữ. Trước tiên cảm nhận khoảng thời gian cốt truyện đã trôi qua đại khái kể từ lần cập nhật trạng thái thế giới trước, sau đó mô tả những thay đổi mới thực sự xảy ra so với trạng thái trước (ràng buộc từ đại thế thiên hạ, hành động độc lập của NPC, biến động nội bộ nhóm, sự lan truyền của Tin Đồn, v.v.). Hội thoại cũ chỉ đóng vai trò bối cảnh, đừng lặp lại coi như thay đổi mới; nếu thời gian rất ngắn hoặc sự thật mới không đủ, có thể viết là cục diện về cơ bản ổn định hoặc chỉ có thay đổi nhỏ. Cấm nhắc đến {{user}}.

### enemies (mảng sổ kẻ thù)
Kẻ thù là nhân vật hoặc nhóm có mối thâm thù cá nhân không thể đảo ngược với {{user}} do hành vi gây hại cụ thể. Khác với sự đối đầu về thái độ ở cấp độ thế lực (đó là trách nhiệm của factions.relation), đặc điểm cốt lõi của kẻ thù là: không bao giờ phai nhạt, đeo bám {{user}} đến cùng.
Chỉ tạo khi thỏa mãn đầy đủ điều kiện kích hoạt tương ứng với loại; sự tức giận, thù địch hoặc lời đe dọa suông bản thân nó không cấu thành kẻ thù. Kẻ thù đã có chỉ cập nhật khi khả năng hành động, vị trí xác định, giai đoạn, chủ thể hoặc sự thật kết thúc có thay đổi thực chất.

Mỗi mục gồm:
- id: kẻ thù đã có phải trả về nguyên trạng id hiện tại; kẻ thù mới phải điền rõ null, cấm bỏ qua
- name: tên kẻ thù (tên cá nhân hoặc tên nhóm báo thù)
- reason: nguyên nhân kết thù (tóm tắt {{user}} đã làm gì dẫn đến kết thù)
- type: "blood"/"grudge". blood = huyết thù (nhân vật cốt lõi bị giết, người thân qua đời/tàn phế); grudge = ân oán không chết người (bị phế truất, phá sản, bị đoạt mất vật quan trọng, v.v. gây tổn hại không thể đảo ngược)
- status: "Đang Truy Tìm"/"Đang Lên Kế Hoạch"/"Đang Hành Động"/"Đã Chấm Dứt"
  - Đang Truy Tìm: đang thu thập tình báo, xác định vị trí của {{user}}
  - Đang Lên Kế Hoạch: đã định vị được {{user}}, đang tổ chức nhân lực/tài nguyên chuẩn bị hành động
  - Đang Hành Động: đã cử lực lượng truy sát/báo thù, cuộc tấn công thực tế đã xảy ra hoặc sắp xảy ra
  - Đã Chấm Dứt: kẻ thù đã bị {{user}} tiêu diệt hoặc cuộc báo thù đã hoàn thành. Sau khi đánh dấu, hệ thống cục bộ giữ lại 20 lượt rồi mới xóa.

Quy tắc phán định:
- Điều kiện kích hoạt của type=blood: nhân vật cốt lõi bị giết (loại trừ cựu nhân vật cốt lõi đã mất quyền lực, xem phần thế lực sụp đổ quyền lực trong mô-đun thế lực); người thân qua đời/tàn phế. Loại thù hận này không thể thương lượng, không bao giờ phai nhạt, không từ bỏ theo thời gian.
- Điều kiện kích hoạt của type=grudge: hành vi của {{user}} đã gây tổn hại nghiêm trọng không thể đảo ngược cho một nhân vật cụ thể (bị phế võ công, bị đoạt mất cơ nghiệp cả đời, bị gài bẫy dẫn đến phá sản/lưu đày), và nạn nhân có động cơ và khả năng báo thù rõ ràng. Không phải ai bị {{user}} đắc tội cũng tính là grudge — phải thỏa mãn ba điều kiện "tổn hại không thể đảo ngược + ý chí báo thù rõ ràng + có khả năng truy đuổi/báo thù".
- Dù là blood hay grudge, một khi đã đánh dấu "Đã Chấm Dứt", hệ thống cục bộ sẽ giữ lại ghi chú thêm 20 lượt, sau đó tự động xóa.

Liên động với chuỗi sự kiện:
- Khi tạo mục kẻ thù, thường nên đồng thời tạo một chuỗi sự kiện Xung Đột (type=conflict), name tương ứng với name của kẻ thù, và ghi lại mối liên hệ giữa hai bên trong influenceChain.
- Khi status của mục kẻ thù thay đổi, stage của chuỗi sự kiện tương ứng nên được cập nhật đồng bộ.

Loại trừ lẫn nhau với sụp đổ quyền lực:
- Nếu tất cả trụ cột quyền lực của một nhân vật cốt lõi đã bị phá hủy (xem phần thế lực sụp đổ quyền lực trong mô-đun thế lực), người đó mất quyền lực và địa vị nhân vật cốt lõi. Lúc này nếu bị {{user}} giết, không kích hoạt type=blood, chỉ xử lý theo type=grudge.

Điều cấm:
- Huyết thù cung cấp động cơ, không cung cấp khả năng. Việc truy sát chịu ràng buộc bởi cấp bậc thế lực, thế lực yếu không thể thâm nhập địa bàn của thế lực mạnh.
- Không được chỉ vì các tổn hại có thể đảo ngược như "bị {{user}} lăng mạ" hoặc "thất bại trong cạnh tranh thương mại" mà tạo mục kẻ thù.
- Không được ghi trùng lặp sự đối đầu về thái độ ở cấp độ thế lực (factions.relation) vào sổ kẻ thù.

### influenceChain (mảng chuỗi ảnh hưởng)
Dùng để ghi lại quá trình lan truyền của các biến động quan trọng trong thế giới, giải thích điều gì đã kích hoạt biến động, đã trực tiếp thay đổi điều gì, và tạo ra dư chấn gì tiếp theo. Nó không phải chuỗi sự kiện mới, không tham gia xúc xắc tiến triển, cũng không thể hiện tiến độ stage.
Chỉ tạo khi nguồn kích hoạt đã khiến trạng thái lâu dài của một hệ thống khác thay đổi thực chất, và việc truyền dẫn này cần thiết để hiểu trạng thái tiếp theo. Khả năng tiềm ẩn, cảm xúc thông thường, các bước nội bộ của sự kiện và tiến độ thông thường của chuỗi sự kiện không được tạo; xu hướng chưa xảy ra nhưng có căn cứ chỉ được ghi vào fallout.
Mỗi mục gồm:
- trigger: nguồn kích hoạt. Sự kiện, hành động, đại thế thiên hạ, Tin Đồn, biến động kinh tế, thay đổi danh tiếng hoặc thông tin hộp đen cụ thể đã gây ra biến động
- impact: ảnh hưởng trực tiếp. Nguồn kích hoạt đã thực sự thay đổi trạng thái thế giới nào
- fallout: dư chấn tiếp theo. Biến động thứ cấp hoặc xu hướng bước tiếp theo phát sinh do ảnh hưởng tiếp tục lan tỏa

Yêu cầu:
- Chỉ ghi lại các biến động thực sự tạo ra ảnh hưởng lan tỏa, đừng nhồi nhét tiến độ thông thường của mọi chuỗi sự kiện vào influenceChain.
- impact phải là biến động trực tiếp đã xảy ra; fallout phải là dư chấn lan tỏa thêm, không được viết lại trùng lặp trigger.
- Nếu chuỗi sự kiện A khiến chuỗi sự kiện B tăng tốc, trì hoãn, chuyển hướng, tan biến hoặc thất bại, phải giải thích quá trình truyền dẫn trong influenceChain.
- Nếu ảnh hưởng phụ thuộc vào sự lan truyền thông tin, phải tuân theo quy tắc lan truyền thông tin; NPC không được có được góc nhìn toàn tri chỉ vì influenceChain tồn tại.
- Khi cùng một trigger đã có bản ghi, hãy cập nhật bản ghi đó, đừng chồng chất vô hạn các bản ghi trùng lặp.

### blackbox (đối tượng hộp đen thông tin)
Chỉ những hành vi bí mật và tài sản cần bảo vệ ranh giới nhận biết xuyên nhiều lượt, hoặc cần theo dõi mục đích sử dụng trong tương lai, rủi ro bị lộ, mới đi vào hộp đen. Suy nghĩ nội tâm thông thường, ý định chưa thực hiện, vật phẩm công khai, đồ tiêu hao tức thời và sự riêng tư không có giá trị về sau không được đưa vào.
- secretActions: mảng hành vi bí mật, mỗi mục { action: "mô tả hành vi", witnesses: "không có/chỉ XX" }
- secretAssets: mảng tài sản bí mật, mỗi mục { name: "tên tài sản", exposure: 0-100, status: "Còn Hiệu Lực/Đã Hết Hạn/Đã Bị Lộ/Mất Hiệu Lực" }
  exposure biểu thị mức độ rủi ro tài sản này bị bên ngoài phát hiện: 0 = tuyệt mật, 100 = đã hoàn toàn công khai.
  status biểu thị tài sản này hiện có còn dùng được hay không: Còn Hiệu Lực = vẫn có thể sử dụng, Đã Hết Hạn = tình báo đã lỗi thời, Đã Bị Lộ = đã bị phát hiện, Mất Hiệu Lực = đã không thể sử dụng.
`;

  const JSON_EXAMPLE = `{
  "events": [
    { "id": "event_1", "name": "Huyết Đao Môn báo thù", "type": "conflict", "level": 2, "stage": "Âm Ỉ", "stageRound": 5, "desc": "Huyết Đao Môn đã cử người truy tung, kẻ truy tung đặt vọng gác bí mật tại Tam Lý Đình ngoài Thanh Thạch Quan" },
    { "id": null, "name": "Thanh Lô Ty cải tiến hỏa dược", "type": "progress", "level": 3, "stage": "Thực Hiện", "stageRound": 4, "desc": "Thanh Lô Ty đã thu đủ diêm tiêu và than kín, đang thử lò nhỏ, chưa vào giai đoạn định hình" }
  ],
  "factions": [
    { "id": "faction_1", "name": "Huyết Đao Môn", "scope": "Huyết Đao Lĩnh và ba trấn lân cận", "status": "Ổn Định", "relation": "Thù Địch", "currentGoal": "Báo thù", "core_person": "Huyết Đao Lão Tổ", "powerPillars": ["Uy hiếp vũ lực","Mạng lưới tình báo"] }
  ],
  "worldTrends": [
    { "id": "trend_1", "name": "Chiến Tranh Bắc Cảnh", "scope": "Bắc Cảnh Tam Châu và các nước lân cận", "status": "Đang Diễn Ra", "description": "Biên quân và các bộ tộc Bắc Cảnh bước vào chiến tranh dài hạn, việc trưng thu lương thực, tuyển quân và phong tỏa thương lộ liên tục thay đổi hành động của các bên", "source": "Sự kiện Xung Đột Lv4 「Chiến Tranh Bắc Cảnh」 chuyển sang Đã Bùng Phát" }
  ],
  "winds": [
    { "id": "wind_1", "topic": "Thanh Thạch Quan lập trạm kiểm soát", "type": "report", "level": 2, "content": "Cổng bắc Thanh Thạch Quan đã có quan binh lập trạm kiểm tra", "scope": "Thanh Thạch Quan và các thôn trấn lân cận", "source": "Thương nhân chứng kiến → các đoàn thương lữ hành qua lại" }
  ],
  "economy": { "climate": "Bình Ổn", "signals": [] },
  "reputation": { "authority": "Vô Danh Tiểu Tốt", "common": "Vô Danh Tiểu Tốt", "shadow": "Vô Danh Tiểu Tốt", "circuit": "Vô Danh Tiểu Tốt", "lastChange": "Không thay đổi" },
  "world_digest": "Kẻ truy tung của Huyết Đao Môn đã đặt vọng gác bí mật tại Tam Lý Đình ngoài Thanh Thạch Quan; các chủ Thiên Cơ Các Thượng Quan Vân đã gửi mật thư triệu hồi ba mật thám ngoại vi; nhà bếp Túy Tiên Lâu đã đổi kênh cung cấp do thương nhân lương thực tăng giá.",
  "enemies": [
    { "id": "enemy_1", "name": "Huyết Đao Môn", "reason": "{{user}} đã giết thiếu chủ Huyết Đao Môn", "type": "blood", "status": "Đang Hành Động" }
  ],
  "influenceChain": [
    { "trigger": "Huyết Đao Môn phát treo thưởng lệnh", "impact": "Người trong giang hồ thảo mãng bắt đầu chủ động để ý hành tung của {{user}}", "fallout": "Khách điếm và bến đò xuất hiện kẻ dò xét và người báo tin bí mật" }
  ],
  "blackbox": { "secretActions": [], "secretAssets": [] }
}`;

  // [MAP] Preset của engine: tách chỉ thị vai trò engine, 10 bước kiểm tra nhân quả thành const cấp module (nội dung khớp từng chữ với hằng số trong hàm gốc),
  // dùng làm nguồn chân lý duy nhất cho "preset mặc định", để world-engine-preset.js tham chiếu (tránh hai bản sao bị lệch nhau).
  // Trong callEvolutionAPI không định nghĩa lại nữa, tham chiếu trực tiếp tại đây; lớp ghi đè dùng biến Final để phân biệt giá trị mặc định và ghi đè của người dùng.
  const DEFAULT_SEG_ENGINE_ROLE = `Bạn là một engine diễn biến thế giới. Sau mỗi lượt hội thoại, thế giới hậu trường bắt buộc phải tự động tiến triển thêm một bước.\nHãy căn cứ vào quy tắc thế giới và hội thoại lượt này, cập nhật trạng thái thế giới. Chỉ xuất JSON, không có văn bản nào khác.`;

  // Giao thức định danh thuộc về ràng buộc toàn vẹn dữ liệu cục bộ, không cho phép bị preset engine tùy chỉnh ghi đè.
  const ENTITY_ID_PROTOCOL = `【Giao thức ID thực thể liên tục (bắt buộc, không được ghi đè)】
- id của events, factions, worldTrends, winds, enemies là định danh hệ thống.
- Khi cập nhật đối tượng đã có phải trả về nguyên trạng id trong trạng thái hiện tại, dù name/topic có đổi tên cũng không được thay đổi id.
- Khi tạo đối tượng mới phải điền rõ ràng "id": null, do hệ thống cục bộ cấp phát; cấm bỏ qua id, cũng cấm bịa đặt, đoán mò hoặc dùng lại id.
- Việc xác định có phải cùng một đối tượng hay không chỉ nhìn vào id. id không tồn tại trong trạng thái hiện tại là không hợp lệ.`;

  const DEFAULT_SEG_CAUSAL_STEPS = `Khi diễn biến, hãy kiểm tra theo thứ tự nhân quả sau:\n1. 【Phán định riêng tư · thực hiện đầu tiên】Trước tiên phán định xem hành vi của {{user}} và các nhân vật liên quan trong lượt này có nhân chứng hay không, có để lại dấu vết có thể truy vết hay không. Mọi hành vi riêng tư xảy ra trong tình huống không có nhân chứng, không để lại dấu vết (ở một mình, tình ái riêng tư, chuyện phòng the, mật đàm trong mật thất, đột nhập bí mật, giết chóc khi không có ai, v.v.), đều tính vào blackbox.secretActions (witnesses ghi "không có" hoặc "chỉ XX"), và: không được dựa vào đó tạo ra Tin Đồn, không được thay đổi danh tiếng ở bất kỳ chiều nào, không được hình thành hoặc thúc đẩy chuỗi sự kiện, không được để bất kỳ NPC nào không có mặt hành động dựa trên đó. Chỉ khi hành vi này bị chứng kiến, để lại dấu vết có thể truy vết, hoặc sau đó thực sự bị lan truyền, mới có thể chuyển thành ảnh hưởng công khai.\n2. Coi tất cả các đại thế thiên hạ đang tiếp diễn là ràng buộc cấp thế giới cho lượt này, và kiểm tra xem có hình thành đại thế mới hoặc đại thế đã có kết thúc rõ ràng hay không.\n3. Phán định xem sự thật, hành động và thông tin công khai trong lượt này có hình thành Tin Đồn mới hay không (trừ hành vi riêng tư, xem bước 1).\n4. Kiểm tra xem Tin Đồn đã có có đạt được nút lan truyền hợp lệ mới hay không, và dựa vào đó cập nhật level/scope/content/source.\n5. Phán định xem Tin Đồn thực sự đã bao phủ những thế lực, tầng lớp hoặc người hành động nào; chỉ những ai được bao phủ mới có thể dựa vào đó thay đổi phán đoán và hành động.\n6. Khi đại thế thiên hạ hoặc Tin Đồn gây ra biến động xuyên hệ thống, hãy hiện thực hóa kết quả trong trường trạng thái tương ứng, và dùng influenceChain ghi lại quá trình truyền dẫn.\n7. Phán định danh tiếng: chỉ khi hành vi của {{user}} đã hình thành Tin Đồn bao phủ tầng lớp tương ứng, mới thay đổi danh tiếng ở chiều tương ứng; hành vi riêng tư, chưa lan truyền hoặc chỉ một người chứng kiến không thay đổi danh tiếng của nhóm.\n8. Phán định kẻ thù: phán định xem lượt này có phát sinh tổn hại không thể đảo ngược kích hoạt huyết thù/ân oán hay không; kẻ thù đã có chỉ có thể thúc đẩy truy đuổi sau khi biết được manh mối thông qua Tin Đồn bao phủ nguồn tình báo của họ hoặc các kênh hợp pháp khác, và chịu ràng buộc bởi cấp bậc thế lực, không được định vị {{user}} một cách vô căn cứ.\n9. Phán định kinh tế: chỉ cập nhật climate và signals khi có chuỗi sự kiện hoặc nguyên nhân bên ngoài có thể truy vết dẫn động; biến động kinh tế lớn phải tạo ra Tin Đồn tương ứng, cấm dao động vô căn cứ.\n10. Không được nhảy trực tiếp từ thông tin toàn tri trên bảng điều khiển sang hành động của NPC, không được bịa đặt nút lan truyền chỉ để tạo ra sự liên động.`;

  async function callEvolutionAPI(state, userMsg, aiMsg, extraInstruction = '', dialogueText = '') {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const fullRules = rulesLoader ? rulesLoader.getAllRulesText() : '【Tải quy tắc thất bại】';
    // Kích hoạt đèn xanh-đỏ: quét hội thoại gần đây mà chính extension này đưa vào diễn biến (tách rời, không đọc quét chat của SillyTavern)
    const worldbookScanText = dialogueText || `${userMsg || ''}\n${aiMsg || ''}`;
    const worldbookSection = await window.WORLD_ENGINE_WORLDBOOK?.buildPromptSection?.(worldbookScanText) || '';
    let memoryEngineSection = '';
    try {
      memoryEngineSection = window.MEMORY_ENGINE?.buildWorldEngineContext?.(state) || '';
    } catch (error) {
      // Ngữ cảnh xuyên engine tùy chọn phải được cách ly lỗi: sự cố của memory engine không được làm gián đoạn việc diễn biến thế giới.
      console.error('[World Engine] Đọc ngữ cảnh của memory engine thất bại (đã cách ly)', error);
    }
    const tonePrompt = ((api.getSettings ? api.getSettings() : {}).tonePrompt || '').trim();
    const toneSection = tonePrompt
      ? `\n\n========== Prompt bổ sung (do người dùng tùy chỉnh · ưu tiên tuân thủ · nhưng không được vi phạm định dạng xuất JSON ở trên) ==========\n${tonePrompt}`
      : '';

    // [MAP] Lớp ghi đè preset của engine: giá trị mặc định dùng DEFAULT_SEG_* cấp module (nguồn chân lý duy nhất, khớp từng chữ với template gốc),
    // nếu preset đang kích hoạt có ghi đè tùy chỉnh cho một đoạn nào đó thì dùng giá trị ghi đè, ngược lại dùng giá trị mặc định.
    // Khi kích hoạt preset "mặc định" (không có ghi đè nào), 4 biến Final khớp từng chữ với hằng số gốc → kết quả ghép nối giống hệt từng byte so với hiện trạng PR#12.
    // [PERF] Lấy 4 đoạn ghi đè một lần (getOverrides đi đường nhanh 0-parse ở preset mặc định, 1 lần parse ở preset tùy chỉnh),
    // tránh việc tra cứu riêng từng đoạn khiến cùng một lượt diễn biến phải JSON.parse lặp lại toàn bộ mảng preset tùy chỉnh.
    const _P = window.WORLD_ENGINE_PRESET;
    const _ov = (_P && typeof _P.getOverrides === 'function') ? _P.getOverrides() : null;
    const segEngineRole = (_ov && _ov['engine-role']) || DEFAULT_SEG_ENGINE_ROLE;
    const segCausalSteps = (_ov && _ov['causal-steps']) || DEFAULT_SEG_CAUSAL_STEPS;
    const segOutputInstructions = (_ov && _ov['output-format']) || OUTPUT_INSTRUCTIONS;
    const segJsonExample = (_ov && _ov['json-example']) || JSON_EXAMPLE;

    const segStateBlock = `## Trạng thái thế giới hiện tại (lượt thứ ${state.round})\n${JSON.stringify({
  round: state.round,
  events: (state.events || []).map(e => ({ id: e.id, name: e.name, type: e.type || 'conflict', stage: e.stage, stageRound: e.stageRound, level: e.level, desc: e.desc, evolveResult: e.evolveResult, stall: e.stall })),
  factions: (state.factions || []).map(f => ({ id: f.id, name: f.name, scope: f.scope, status: f.status, relation: f.relation, currentGoal: f.currentGoal, core_person: f.core_person, powerPillars: f.powerPillars })),
  worldTrends: state.worldTrends || [],
  winds: (state.winds || []).map(({ quietRounds, ...wind }) => wind),
  reputation: state.reputation,
  economy: state.economy,
  enemies: state.enemies || [],
  influenceChain: state.influenceChain || [],
  blackbox: state.blackbox || { secretActions: [], secretAssets: [] }
}, null, 2)}`;

    const segDialogue = `## Hội thoại gần đây\n${dialogueText ? dialogueText : `Người dùng: ${userMsg || ''}\nAI: ${aiMsg || ''}`}`;

    const segExtraInstruction = extraInstruction ? extraInstruction : '';
    // toneSection đã chứa \n\n dẫn đầu; segments lưu toneSection gốc, khớp với nội dung thực tế gửi đi
    const segToneSection = toneSection;

    // [MAP] Prompt hoàn chỉnh thực tế gửi đi: thứ tự ghép nối và dấu phân cách khớp từng chữ với template gốc, không lệch ngữ nghĩa.
    // 4 đoạn dùng seg* ở trên (biến Final của lớp ghi đè): khi không có ghi đè thì khớp từng chữ với hằng số gốc.
    const prompt = segEngineRole + '\n\n' + ENTITY_ID_PROTOCOL + '\n\n' + segCausalSteps
      + '\n\n========== Quy Tắc Diễn Biến Thế Giới ==========\n' + fullRules
      + '\n\n' + worldbookSection
      + (memoryEngineSection ? '\n\n' + memoryEngineSection : '')
      + '\n\n' + segStateBlock
      + '\n\n' + segDialogue
      + '\n\n' + segOutputInstructions
      + '\n' + segJsonExample
      + '\n' + (extraInstruction ? '\n' + extraInstruction : '') + toneSection;

    // [MAP] Bản sao các đoạn (dùng để hiển thị minh bạch toàn bộ, chỉ đọc). content của mỗi đoạn tham chiếu cùng biến với prompt ở trên.
    // Khi worldbookSection / toneSection / extraInstruction rỗng thì content là chuỗi rỗng, phía hiển thị ghi chú "Lượt Này Chưa Kích Hoạt".
    _lastPromptSegments = [
      { key: 'engine-role',    label: '① Chỉ Thị Vai Trò Engine',              content: segEngineRole },
      { key: 'entity-ids',     label: '② Giao Thức ID Thực Thể Liên Tục',       content: ENTITY_ID_PROTOCOL },
      { key: 'causal-steps',   label: '③ Kiểm Tra Nhân Quả (10 Bước)',         content: segCausalSteps },
      { key: 'rules',          label: '④ Quy Tắc Diễn Biến Thế Giới',          content: fullRules },
      { key: 'worldbook',      label: '⑤ Chèn World Book',                     content: worldbookSection },
      { key: 'memory-engine',  label: '⑤b Chèn Nhân Vật/Thực Thể Từ Memory Engine', content: memoryEngineSection },
      { key: 'state',          label: '⑥ Trạng Thái Thế Giới Hiện Tại (JSON)', content: segStateBlock },
      { key: 'dialogue',       label: '⑦ Hội Thoại Gần Đây',                   content: segDialogue },
      { key: 'output-format',  label: '⑧ Giải Thích Trường Xuất JSON',        content: segOutputInstructions },
      { key: 'json-example',   label: '⑨ Ví Dụ JSON',                         content: segJsonExample },
      { key: 'extra-instr',    label: '⑩ Chỉ Thị Bổ Sung',                     content: segExtraInstruction },
      { key: 'tone',           label: '⑪ Prompt Bổ Sung (Người Dùng Tùy Chỉnh)', content: segToneSection }
    ];

    _lastPrompt = prompt;
    _lastRawResult = '';
    const knownFields = [
      'events', 'factions', 'worldTrends', 'winds', 'economy', 'reputation',
      'world_digest', 'enemies', 'influenceChain', 'regionalIncident', 'blackbox'
    ];
    const retrySettings = api.getSettings ? api.getSettings() : {};
    const maxRetries = Math.max(0, parseInt(retrySettings.apiAutoRetries) || 0);
    let update = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const rawResult = await api.callApi(prompt, undefined, undefined, _abortController.signal);
        _lastRawResult = rawResult;
        update = api.parseJSON(rawResult);
        if (!update || typeof update !== 'object' || Array.isArray(update)) {
          throw new Error('API trả về không thể phân tích thành JSON hợp lệ, đã giữ lại trạng thái hiện tại trước khi reroll');
        }
        if (!knownFields.some(field => Object.prototype.hasOwnProperty.call(update, field))) {
          throw new Error('API trả về không chứa bất kỳ trường trạng thái thế giới nào, đã giữ lại trạng thái hiện tại trước khi reroll');
        }
        break;
      } catch (error) {
        if (_abortController && _abortController.signal.aborted) throw error;
        if (attempt >= maxRetries) {
          if (maxRetries > 0 && error && error.message) error.message += ` (đã tự động thử lại ${maxRetries} lần)`;
          throw error;
        }
        console.warn(`[World Engine] API fault, tự động thử lại ${attempt + 1}/${maxRetries}:`, error && error.message ? error.message : error);
        if (window.__WE_SetExternalStatus) window.__WE_SetExternalStatus(`API fault, tự động thử lại ${attempt + 1}/${maxRetries}`);
      }
    }
    console.log('[World Engine] Phân tích JSON từ API thành công, tóm tắt thế giới:', update.world_digest || '[không trả về]');

    update.events = Array.isArray(update.events) ? update.events : [];
    update.factions = Array.isArray(update.factions) ? update.factions : [];
    update.worldTrends = Array.isArray(update.worldTrends) ? update.worldTrends : [];
    update.winds = Array.isArray(update.winds) ? update.winds : [];
    update.economy = update.economy || {};
    if (!update.economy.signals) update.economy.signals = [];
    update.reputation = update.reputation || {};
    update.world_digest = update.world_digest || state.worldDigest;
    update.enemies = Array.isArray(update.enemies) ? update.enemies : [];
    update.influenceChain = Array.isArray(update.influenceChain) ? update.influenceChain : [];
    // regionalIncident do xúc xắc cục bộ kiểm soát, không tự động bổ sung trong callEvolutionAPI
    // regionalIncident do API trả về được kiểm định trong mergeRegionalIncident
    if (!update.blackbox) update.blackbox = { secretActions: [], secretAssets: [] };

    return update;
  }

  let _abortController = null;
  let _isRunning = false;
  let _backfillRunning = false;
  let _backfillAborted = false;
  let _lastError = '';

  async function evolve(state, userMsg, aiMsg, opts) {
    if (_isRunning) {
      console.warn('[World Engine] ⚠️ Đã có diễn biến đang thực hiện, bỏ qua yêu cầu trùng lặp');
      _lastError = 'Đã có diễn biến đang thực hiện';
      return false;
    }
    _lastError = '';

    delete state._terminalEventsThisRound;
    const hadStoredState = core.hasState();
    const backup = JSON.parse(JSON.stringify(state));
    // Nền tảng do bên gọi chỉ định rõ ràng (hai nút bấm thủ công):
    //   'forward' = diễn biến tiến tới, đẩy từ trạng thái hiện tại, đẩy xong thì mốc lưu tiến lên (tương đương lượt mới);
    //   'redo'    = diễn biến lại, khôi phục từ mốc lưu rồi đẩy lại, lượt không đổi;
    //   không truyền = diễn biến tự động, dựa theo phán định của isNewRound().
    const mode = opts && opts.mode;
    const isNew = mode === 'forward' ? true
                : mode === 'redo'    ? false
                : core.isNewRound();
    // [FIX] Chia ba lựa chọn nền tảng, tách rời "reroll" và "redo":
    //   isForward  = mode==='forward' hoặc lượt mới tự động (isNew=true) —— tiếp tục đẩy từ hiện tại, round++, mốc lưu tiến lên, làm mới fingerprint.
    //   isRedo     = mode==='redo' (nút thủ công "Diễn Biến Lại") —— khôi phục nền tảng từ mốc lưu rồi đẩy lại, lượt = lượt của mốc lưu, không động đến mốc lưu/fingerprint.
    //   reroll tự động = trường hợp còn lại (mode=undefined và !isNew) —— đẩy lại được kích hoạt do tạo lại cùng một tầng văn bản, **không khôi phục từ mốc lưu**,
    //                 đẩy trực tiếp trên state hiện tại, lượt giữ nguyên lượt hiện tại, không động đến mốc lưu/fingerprint.
    //   Code cũ khiến "reroll tự động" cũng đi vào nhánh else Object.assign(state,cp), khôi phục toàn bộ state thành mốc lưu (lượt trước) rồi mới đẩy → lượt bị lùi về
    //   thành lượt của mốc lưu (triệu chứng B: reroll ở lượt 6 xong lại dừng ở lượt 5). Nay đã sửa: chỉ isRedo mới quay về mốc lưu; reroll tự động đẩy trên state hiện tại
    //   (đúng như chú thích dòng 768 của bản sửa 2 trong PR#27 đã nói rõ là "cách làm đúng dựa trên trạng thái hiện tại để đẩy", cách triển khai cũ không khớp với chú thích, ở đây đã chỉnh lại cho khớp).
    const isForward = isNew;

    if (isForward) {
      console.log('[World Engine] 📌 Lượt mới forward');
    } else if (mode === 'redo') {
      // redo (thủ công "Diễn Biến Lại"): khôi phục nền tảng từ mốc lưu a rồi đẩy lại, lượt = lượt của mốc lưu
      const cp = core.restoreCheckpoint();
      if (cp) {
        Object.assign(state, cp);
        state.memories = cp.memories || [];
        state.events = cp.events || [];
        state.factions = cp.factions || [];
        state.worldTrends = cp.worldTrends || [];
        state.winds = cp.winds || [];
        state.enemies = cp.enemies || [];
        state.influenceChain = cp.influenceChain || [];
        console.log('[World Engine] 🔄 redo khôi phục từ mốc lưu rồi đẩy lại');
      } else {
        // [FIX bảo vệ] redo phải có mốc lưu làm nền tảng. Khi không có mốc lưu (sau lần diễn biến đầu tiên, hoặc chỉ mới redo mà chưa từng forward), từ chối thực hiện,
        //   tránh việc âm thầm thoái hóa thành "đẩy trên state hiện tại" + round++ tạo ra một redo giả. reroll tự động không nằm trong phạm vi bảo vệ này (xem nhánh dưới).
        _lastError = 'Không có mốc lưu, không thể diễn biến lại (redo); vui lòng "Tiến Về Phía Trước" ít nhất một lượt trước khi dùng "Diễn Biến Lại"';
        console.warn('[World Engine] ⚠️ redo không có mốc lưu, đã từ chối (không thoái hóa thành forward giả)');
        return false;
      }
    } else {
      // reroll tự động (mode=undefined và không phải lượt mới): đẩy lại được kích hoạt do tạo lại cùng một tầng văn bản.
      //   không khôi phục nền tảng từ mốc lưu (mốc lưu là trạng thái "trước khi tầng văn bản này được tạo ra", để dành cho việc chèn, nền tảng diễn biến dùng state hiện tại);
      //   lượt giữ nguyên lượt hiện tại (forward đã round++ lên lượt hiện tại, ở đây không động đến); không động đến mốc lưu/fingerprint.
      //   khi không có mốc lưu (kịch bản tầng đầu tiên) cũng không báo lỗi —— đẩy trực tiếp trên state hiện tại, tầng đầu vốn dĩ không có cp.
      console.log('[World Engine] 🔄 Diễn biến lại lượt hiện tại (reroll tự động, lượt không đổi)');
    }

    _isRunning = true;
    _abortController = new AbortController();

    try {
      // Bước 1: xúc xắc cục bộ thúc đẩy chuỗi sự kiện (toàn bộ thao tác trên b)
      forceTriggerEvents(state);

      // Bước 2: tích lũy im ắng và phán định tan biến của Tin Đồn
      decayWinds(state);

      // Bước 3: xúc xắc sự kiện đột phát khu vực
      const regionalIncidentRoll = rollRegionalIncident(state);

      // Bước 4: xúc xắc sự kiện ngẫu nhiên phương xa do sổ cái dẫn động (khi pending thì bỏ qua xúc xắc và tiếp tục thử lại)
      const distantEventRoll = rollDistantEvent(state);

      // Bước 5: xúc xắc sự kiện ngẫu nhiên gần do cốt truyện hiện tại dẫn động
      const nearEventRoll = rollNearEvent(state);

      // Bước 6: đưa cho API để cập nhật diễn biến
      const extraInstructions = [regionalIncidentRoll.injectPrompt, distantEventRoll.injectPrompt, nearEventRoll.injectPrompt].filter(Boolean).join('\n\n');
      const update = await callEvolutionAPI(state, userMsg, aiMsg, extraInstructions, (opts && opts.dialogueText) || '');

      // Đối tượng ngẫu nhiên được nhận diện và xóa cờ tạm trước, rồi mới vào quy trình cấp ID thực thể đã có và hợp nhất.
      acceptDistantEventResult(state, update);
      acceptNearEventResult(state, update);

      // Bước 7: hợp nhất kết quả API trả về
      for (const ev of update.events) {
        const existingIndex = core.findEntityIndex(state.events, ev, core.ENTITY_ID_PREFIXES.events, 'name');
        const existing = existingIndex !== -1 ? state.events[existingIndex] : null;
        if (existing) {
          // ID không xác định/sai của API không được làm bẩn định danh cục bộ; khi nhận diện trùng tên cũng bắt buộc kế thừa ID cục bộ.
          ev.id = existing.id;
          // Loại sự kiện một khi đã xác định thì API không được thay đổi
          ev.type = existing.type || 'conflict';

          const stageOrder = EVENT_STAGE_ORDER[existing.type] || EVENT_STAGE_ORDER.conflict;
          const finalStage = EVENT_FINAL_STAGE[existing.type] || EVENT_FINAL_STAGE.conflict;
          const terminalStages = EVENT_TERMINAL_STAGES[existing.type] || EVENT_TERMINAL_STAGES.conflict;

          // Bảo vệ sự kiện hồi kết: chỉ cho phép API sửa desc
          if (terminalStages.includes(existing.stage)) {
            if (ev.desc !== undefined) existing.desc = ev.desc;
            core.ensureEventFields(existing);
            continue;
          }

          // API đã sửa stageRound? Lấy API làm chuẩn, nhưng >=9 thì tự động thăng cấp
          if (ev.stageRound !== undefined && ev.stageRound !== existing.stageRound) {
            existing.stageRound = ev.stageRound;
            existing.consecutiveFails = 0;
            // stageRound >= 9 kích hoạt thăng cấp
            if (existing.stageRound >= 9) {
              const idx = stageOrder.indexOf(existing.stage);
              if (idx !== -1 && idx < stageOrder.length - 1) {
                existing.stage = stageOrder[idx + 1];
                existing.stageRound = existing.stageRound - 9;
              } else {
                existing.stage = finalStage;
                existing.stageRound = 9;
              }
            }
          }
          // Hợp nhất các trường khác
          if (ev.stage !== undefined) existing.stage = ev.stage;
          if (ev.desc !== undefined) existing.desc = ev.desc;
          if (ev.level !== undefined) existing.level = ev.level;
          if (ev.name !== undefined) existing.name = ev.name;
          if (ev.stall !== undefined) existing.stall = ev.stall;
          existing.type = ev.type;
          core.ensureEventFields(existing);
        } else {
          if (!ev.type || !EVENT_TYPES.includes(ev.type)) ev.type = 'conflict';
          core.addEvent(state, ev);
        }
      }
      for (const fac of update.factions) core.addFaction(state, fac);
      for (const trend of update.worldTrends) core.addWorldTrend(state, trend);
      for (const wind of update.winds) core.addWind(state, wind);
      if (Object.keys(update.economy).length) Object.assign(state.economy, update.economy);
      if (Object.keys(update.reputation).length) Object.assign(state.reputation, update.reputation);
      if (update.world_digest) state.worldDigest = update.world_digest;

      // Sổ kẻ thù
      if (update.enemies.length) {
        for (const en of update.enemies) {
          if (!en.name || !en.reason) continue;
          if (!en.type || !['blood', 'grudge'].includes(en.type)) en.type = 'blood';
          if (!en.status|| !['Đang Truy Tìm','Đang Lên Kế Hoạch','Đang Hành Động','Đã Chấm Dứt'].includes(en.status)) en.status = 'Đang Truy Tìm';
          core.addEnemy(state, en);
        }
        // Kẻ thù đã Đã Chấm Dứt được giữ lại 20 lượt rồi mới dọn dẹp
        state.enemies = (state.enemies || []).filter(en => {
          if (en.status === 'Đã Chấm Dứt') {
            en._terminalSince = en._terminalSince || state.round;
            return (state.round - en._terminalSince) < intSetting('localEnemyTerminalKeepRounds', 20, 1);
          }
          return true;
        });
        if (state.enemies.length > capSetting('localCapEnemies', 8)) state.enemies.length = capSetting('localCapEnemies', 8);
      }

      // Chuỗi ảnh hưởng
      if (update.influenceChain.length) {
        const completedRound = state.round + 1;
        for (const influence of update.influenceChain) {
          if (!influence.trigger || !influence.impact) continue;
          influence.fallout = influence.fallout || '';
          const idx = (state.influenceChain || []).findIndex(existing => existing.trigger === influence.trigger);
          if (idx !== -1) {
            influence._createdRound = state.influenceChain[idx]._createdRound ?? completedRound;
            state.influenceChain[idx] = influence;
          } else {
            influence._createdRound = completedRound;
            state.influenceChain.unshift(influence);
          }
        }
        if (state.influenceChain.length > capSetting('localCapInfluence', 12)) state.influenceChain.length = capSetting('localCapInfluence', 12);
      }

      // Influence entries expire after the configured number of rounds; updates to the same trigger do not renew them.
      const completedRound = state.round + 1;
      const influenceKeepRounds = intSetting('localInfluenceKeepRounds', 8, 1);
      const cleanedInfluence = (state.influenceChain || []).filter(influence => {
        if (!influence || typeof influence !== 'object') return false;
        if (influence._createdRound === undefined) influence._createdRound = state.round;
        return (completedRound - influence._createdRound) < influenceKeepRounds;
      });
      if (cleanedInfluence.length !== (state.influenceChain || []).length) {
        console.log('[World Engine] auto-removed influence entries:', (state.influenceChain || [])
          .filter(influence => !cleanedInfluence.includes(influence))
          .map(influence => influence.trigger)
          .join(', '));
      }
      state.influenceChain = cleanedInfluence;

      // Giới hạn trên của economy signals
      if (state.economy && state.economy.signals && state.economy.signals.length > capSetting('localCapEconomySignals', 8)) {
        state.economy.signals.length = capSetting('localCapEconomySignals', 8);
      }

      // Hợp nhất sự kiện đột phát khu vực
      mergeRegionalIncident(state, update);

      if (update.blackbox) {
        state.blackbox = update.blackbox;
        const totalBlackbox = (state.blackbox.secretActions?.length || 0) + (state.blackbox.secretAssets?.length || 0);
        const blackboxCap = capSetting('localCapBlackbox', 12);
        if (totalBlackbox > blackboxCap) {
          const excess = totalBlackbox - blackboxCap;
          const actions = state.blackbox.secretActions || [];
          const assets = state.blackbox.secretAssets || [];
          if (actions.length > excess) {
            state.blackbox.secretActions.length = Math.max(1, actions.length - excess);
          } else {
            state.blackbox.secretActions = [];
            state.blackbox.secretAssets.length = Math.max(1, assets.length - excess + actions.length);
          }
        }
      }

      // Tự động dọn dẹp: chuỗi sự kiện Đã Tan Biến/Đã Thất Bại & đại thế thiên hạ đã Đã Kết Thúc
      // - Hồi kết tiêu cực (Đã Tan Biến/Đã Thất Bại): xóa ngay ở lượt sau
      // - Hồi kết tích cực (Đã Bùng Phát/Đã Hoàn Thành): kể từ khi vào hồi kết, giữ lại 2+level*2 lượt (Lv1=4/Lv2=6/Lv3=8/Lv4=10),
      //   dành thời gian để triển khai dư chấn, hết hạn thì tự động dọn dẹp
      const POSITIVE_TERMINALS = ['Đã Bùng Phát', 'Đã Hoàn Thành'];
      const cleanedEvents = (state.events || []).filter(e => {
        if (e.stage === 'Đã Tan Biến' || e.stage === 'Đã Thất Bại') return false;
        if (POSITIVE_TERMINALS.includes(e.stage)) {
          if (e._terminalSince === undefined) e._terminalSince = state.round;
          const keepRounds = positiveTerminalKeepRounds(e);
          return (state.round - e._terminalSince) < keepRounds;
        }
        // Không phải hồi kết: xóa cờ đếm ngược có thể còn sót lại (khi bị API đổi ngược về giai đoạn không phải hồi kết)
        if (e._terminalSince !== undefined) delete e._terminalSince;
        return true;
      });
      if (cleanedEvents.length !== (state.events || []).length) {
        const removed = (state.events || []).filter(e => !cleanedEvents.includes(e));
        state._terminalEventsThisRound = removed.map(e => JSON.parse(JSON.stringify(e)));
        console.log('[World Engine] 🧹 Tự động dọn dẹp chuỗi sự kiện:', removed.map(e => e.name).join(', '));
      }
      state.events = cleanedEvents;

      const cleanedTrends = (state.worldTrends || []).filter(t => t.status !== 'Đã Kết Thúc');
      if (cleanedTrends.length !== (state.worldTrends || []).length) {
        const removed = (state.worldTrends || []).filter(t => !cleanedTrends.includes(t));
        console.log('[World Engine] 🧹 Tự động dọn dẹp đại thế thiên hạ:', removed.map(t => t.name).join(', '));
      }
      state.worldTrends = cleanedTrends;

      state.lastEvolveResult = update;

      // [FIX] Chia ba khối lượt, đồng bộ với chia ba lựa chọn nền tảng ở trên (xem isForward/isRedo/reroll tự động):
      //   isForward        → round++ + mốc lưu tiến lên (saveCheckpoint(backup)) + làm mới fingerprint (saveFingerprint).
      //   isRedo           → lượt không đổi (=lượt của mốc lưu); không lưu checkpoint, không cập nhật fingerprint (nền tảng của redo chính là mốc lưu, không động đến nó).
      //   reroll tự động   → lượt không đổi (=lượt hiện tại); không lưu checkpoint, không cập nhật fingerprint.
      //     Then chốt: reroll tự động **không saveCheckpoint** —— mốc lưu vẫn giữ trạng thái "lượt trước" đã lưu khi forward,
      //     đây là tiền đề để phía chèn sau này có thể lấy "trạng thái thế giới trước khi tầng văn bản này được tạo ra" = mốc lưu. Nếu tiến mốc lưu lên ở đây,
      //     sau khi reroll, phần chèn sẽ lấy được trạng thái "trước khi diễn biến reroll" thay vì "trước khi tầng văn bản này được tạo ra", gây lệch ngữ nghĩa.
      //   Code cũ không phân biệt, khi isNew=false đều in ra "reroll/redo lượt không đổi", nhưng lựa chọn nền tảng ở trên đã khiến reroll tự động
      //   sai lầm Object.assign(cp) quay về mốc lưu (triệu chứng B), nay nền tảng đã sửa thành không quay về mốc lưu, ở đây lượt giữ nguyên lượt hiện tại.
      if (isForward) {
        // Lần diễn biến đầu tiên không tạo mốc lưu trống; các lần sau trạng thái hiện tại cũ trở thành mốc lưu và giữ nguyên số tầng gốc.
        state.round++;                             // Chỉ tăng lượt khi forward
        if (hadStoredState) core.saveCheckpoint(backup);
        core.saveFingerprint(core.getChatFingerprint());
        console.log('[World Engine] ✅ Diễn biến hoàn tất, lượt mới thứ', state.round, ', mốc lưu đã tiến lên');
      } else {
        const label = (mode === 'redo') ? 'redo' : 'reroll tự động';
        console.log('[World Engine] ✅ Diễn biến hoàn tất (' + label + '), lượt không đổi: lượt thứ', state.round);
      }
      core.saveStateWithLayer(state);
      return true;

    } catch(e) {
      if (e.name === 'AbortError') {
        console.log('[World Engine] 🛑 Diễn biến đã bị hủy');
        _lastError = 'Đã hủy';
      } else {
        console.error('[World Engine] Diễn biến thất bại', e);
        _lastError = e && e.message ? e.message : 'Lỗi không xác định';
      }
      // Nếu lượt này vừa mới xúc xắc trúng sự kiện phương xa, khi API gặp sự cố cũng phải giữ lại pending và mẫu cố định; lượt sau không được xúc xắc lại.
      const pendingDistant = state.distantEvent && state.distantEvent.pending
        ? JSON.parse(JSON.stringify(state.distantEvent))
        : null;
      const pendingNear = state.nearEvent && state.nearEvent.pending
        ? JSON.parse(JSON.stringify(state.nearEvent))
        : null;
      // Khôi phục trạng thái trước đó; bản thân câu lệnh khôi phục có thể ném lỗi (ví dụ IDB ghi thất bại khi bộ nhớ bị áp lực), nuốt lỗi để tránh bỏ qua việc đặt lại ở finally
      try {
        Object.assign(state, backup);
        if (pendingDistant) state.distantEvent = pendingDistant;
        if (pendingNear) state.nearEvent = pendingNear;
        core.saveState(state);
      } catch (_) {}
      return false;
    } finally {
      // Dù thành công/thất bại/câu lệnh khôi phục ném lỗi, đều phải đặt lại cờ kiểm soát đồng thời; nếu không các lần evolve sau sẽ bị bảo vệ isRunning() bỏ qua vĩnh viễn
      // (tức là triệu chứng thỉnh thoảng "diễn biến không hoạt động nữa" dưới áp lực bộ nhớ sau khi nâng cấp)
      _abortController = null;
      _isRunning = false;
    }
  }

  function abort() {
    if (_backfillRunning) {
      _backfillAborted = true;
      console.log('[World Engine] 🛑 Đã nhận yêu cầu hủy diễn biến hàng loạt');
    }
    if (_abortController) {
      _abortController.abort();
      console.log('[World Engine] 🛑 Đã phát tín hiệu hủy');
    }
  }

  function isRunning() {
    return _isRunning || _backfillRunning;
  }

  // ========== "Diễn Biến Lại Thế Giới Hàng Loạt" ==========
  // Bắt đầu từ tầng AI thứ 1, chia theo từng đợt để diễn biến lại trạng thái thế giới đến tầng chỉ định (xóa sạch làm lại từ đầu).
  // Mỗi đợt chỉ đưa vào hội thoại của N tầng AI (và các tầng user xen giữa) của đợt đó, nhưng state tích lũy qua từng đợt——
  // đợt thứ k tiếp nối trên kết quả diễn biến của đợt thứ k-1, đảm bảo thế giới liền mạch; token của mỗi đợt cố định và có thể kiểm soát.
  // opts: { batchSize, retries, endLayer, onProgress }
  //   onProgress({ phase, batch, totalBatches, layerFrom, layerTo, attempt, ok, round })
  // Trả về { done, totalBatches, completedBatches, failedAt }
  async function backfillEvolve(opts) {
    opts = opts || {};
    if (_isRunning || _backfillRunning) {
      console.warn('[World Engine] ⚠️ Đã có diễn biến/tái điền đang thực hiện, bỏ qua tái điền hàng loạt');
      return { done: false, reason: 'busy' };
    }

    const settings = api && api.getSettings ? api.getSettings(true) : {};
    const batchSize = Math.max(1, parseInt(opts.batchSize ?? settings.backfillBatchSize) || 1);
    const retries = Math.max(0, parseInt(opts.retries ?? settings.backfillRetries) || 0);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};

    // 1) Thu thập chỉ số của mọi tầng AI hợp lệ trong chat (khớp với tiêu chí diễn biến tự động: không phải user, mes không rỗng)
    let chat = [];
    let startChatId = 'default';
    try {
      const ctx = SillyTavern.getContext();
      chat = (ctx && ctx.chat) || [];
      if (ctx && ctx.chatId) startChatId = ctx.chatId;
    } catch (e) { chat = []; }
    const aiIdx = [];
    const ignoreFirstLayer = settings.firstLayerIsAiOpening !== false;
    for (let i = 0; i < chat.length; i++) {
      const m = chat[i];
      if (m && !m.is_user && String(m.mes || '').trim() && !(ignoreFirstLayer && i === 0)) aiIdx.push(i);
    }
    if (!aiIdx.length) {
      return { done: false, reason: 'no-ai-layers', totalBatches: 0 };
    }

    // 2) Kẹp tầng kết thúc (0 hoặc mặc định = đẩy đến tầng AI cuối cùng)
    let endLayer = parseInt(opts.endLayer ?? settings.backfillEndLayer) || 0;
    if (!Number.isFinite(endLayer) || endLayer <= 0 || endLayer > aiIdx.length) endLayer = aiIdx.length;

    // 3) Chia đợt: endLayer tầng AI đầu tiên được nhóm theo batchSize, đợt cuối hấp thụ phần dư (không tạo ra đợt rỗng)
    const batches = [];
    for (let p = 0; p < endLayer; p += batchSize) {
      const pEnd = Math.min(p + batchSize, endLayer) - 1; // Bao gồm
      // Gộp phần dư vào đợt trước: nếu phần còn lại không đủ một đợt và đã có đợt, thì gộp nó vào đợt cuối
      batches.push({ pStart: p, pEnd });
    }
    // Gộp phần lẻ ở cuối vào đợt trước (ví dụ 30/7 → 7/7/7/9 thay vì 7/7/7/7/2)
    if (batches.length >= 2) {
      const last = batches[batches.length - 1];
      const lastCount = last.pEnd - last.pStart + 1;
      if (lastCount < batchSize) {
        batches[batches.length - 2].pEnd = last.pEnd;
        batches.pop();
      }
    }
    const totalBatches = batches.length;

    // 4) Xóa sạch làm lại: bỏ trạng thái thế giới hiện tại và mốc lưu, để đợt 1 bắt đầu diễn biến từ thế giới trống
    core.clearState();
    core.clearCheckpoint();

    _backfillRunning = true;
    _backfillAborted = false;
    let completedBatches = 0;

    try {
      for (let b = 0; b < totalBatches; b++) {
        if (_backfillAborted) {
          console.log('[World Engine] 🛑 Tái điền hàng loạt đã bị hủy, dừng ở đợt', b, '/', totalBatches);
          return { done: false, reason: 'aborted', totalBatches, completedBatches, failedAt: b + 1 };
        }
        // Bảo vệ chuyển chat: nếu người dùng chuyển sang chat khác trong lúc đang tái điền → hủy ngay lập tức, tuyệt đối không ghi vào B.
        // Nếu không, clearState() ở đầu đã xóa A, nhưng các thao tác đọc/ghi sau đó dùng chatId động sẽ rơi vào B, làm bẩn B và mất bản lưu của A.
        if (core.getChatId() !== startChatId) {
          console.warn('[World Engine] 🛑 Phát hiện chuyển chat, hủy tái điền hàng loạt (start', startChatId, '→ now', core.getChatId(), ')');
          return { done: false, reason: 'chat-changed', totalBatches, completedBatches, failedAt: b + 1 };
        }
        const { pStart, pEnd } = batches[b];
        const lastChatIdx = aiIdx[pEnd];
        const startChatIdx = pStart === 0 ? (ignoreFirstLayer ? 1 : 0) : aiIdx[pStart - 1] + 1;
        const aiMsg = String(chat[lastChatIdx].mes || '').trim();

        // Dựng văn bản hội thoại của đợt này (khớp với performEvolution: bao gồm cả tầng user xen giữa)
        const dialogueText = chat.slice(startChatIdx, lastChatIdx + 1)
          .map(m => (m.is_user ? 'Người dùng' : 'AI') + ': ' + core.filterDialogue(String(m.mes || '').trim(), settings))
          .filter(line => line.length > 3)
          .join('\n');

        onProgress({ phase: 'batch-start', batch: b + 1, totalBatches,
          layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: 0 });

        // Mỗi đợt đọc lại state (evolve đã lưu xuống đĩa), khớp với đường dẫn đơn lượt
        let ok = false;
        let lastAttempt = 0;
        for (let attempt = 0; attempt <= retries; attempt++) {
          lastAttempt = attempt;
          if (_backfillAborted) break;
          if (core.getChatId() !== startChatId) {
            console.warn('[World Engine] 🛑 Phát hiện chuyển chat, hủy tái điền hàng loạt (start', startChatId, '→ now', core.getChatId(), ')');
            return { done: false, reason: 'chat-changed', totalBatches, completedBatches, failedAt: b + 1 };
          }
          const state = core.loadState();
          ok = await evolve(state, '', aiMsg, { mode: 'forward', dialogueText });
          if (ok || _backfillAborted) break;
          if (attempt < retries) {
            console.warn(`[World Engine] ⚠️ Đợt ${b + 1}/${totalBatches} API fault, thử lại ${attempt + 1}/${retries}`);
            onProgress({ phase: 'retry', batch: b + 1, totalBatches,
              layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: attempt + 1 });
          }
        }

        if (!ok) {
          if (_backfillAborted) {
            return { done: false, reason: 'aborted', totalBatches, completedBatches, failedAt: b + 1 };
          }
          console.error(`[World Engine] ❌ Đợt ${b + 1}/${totalBatches} API fault đã hết số lần thử lại, hủy tái điền`);
          onProgress({ phase: 'batch-failed', batch: b + 1, totalBatches,
            layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: lastAttempt });
          return { done: false, reason: 'evolve-failed', totalBatches, completedBatches, failedAt: b + 1 };
        }

        completedBatches++;
        const cur = core.loadState();
        if (window.WORLD_ENGINE_LEDGER) {
          try { window.WORLD_ENGINE_LEDGER.recordChanges(cur); } catch (e) {}
        }
        onProgress({ phase: 'batch-done', batch: b + 1, totalBatches,
          layerFrom: pStart + 1, layerTo: pEnd + 1, attempt: lastAttempt, ok: true, round: cur.round });
      }

      onProgress({ phase: 'all-done', totalBatches, completedBatches });
      return { done: true, totalBatches, completedBatches };
    } catch (e) {
      console.error('[World Engine] Sự cố tái điền hàng loạt', e);
      return { done: false, reason: 'exception', error: String(e && e.message || e), totalBatches, completedBatches };
    } finally {
      _backfillRunning = false;
      _backfillAborted = false;
    }
  }

  function getLastError() {
    return _lastError;
  }

  window.WORLD_ENGINE_DEBUG = {
    evolve,
    backfillEvolve,
    callEvolutionAPI,
    forceTriggerEvents,
    decayWinds,
    state: () => core.loadState()
  };

  // [MAP] Preset của engine: phơi bày 4 đoạn văn bản mặc định cho world-engine-preset.js làm nguồn chân lý duy nhất cho "preset mặc định".
  // Chỉ tham chiếu để đọc, tránh việc mô-đun preset sao chép thành hai bản khiến giá trị mặc định bị lệch nhau.
  window.WORLD_ENGINE_EVOLUTION_DEFAULT_SEGS = {
    'engine-role':   DEFAULT_SEG_ENGINE_ROLE,
    'causal-steps':  DEFAULT_SEG_CAUSAL_STEPS,
    'output-format': OUTPUT_INSTRUCTIONS,
    'json-example':  JSON_EXAMPLE
  };

  return { evolve, backfillEvolve, getLastDebug, abort, isRunning, getLastError };
})();
