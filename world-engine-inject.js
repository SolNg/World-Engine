// world-engine-inject.js — Xây dựng ngữ cảnh chèn vào (lọc theo điều kiện, chỉ chèn thông tin then chốt ảnh hưởng đến RP)
window.WORLD_ENGINE_INJECT = (function() {
  const core = window.WORLD_ENGINE_CORE;
  const ledger = window.WORLD_ENGINE_LEDGER;

  // Lời bình danh tiếng: chuyển cấp độ thành lời văn tự nhiên cho mô hình chính văn đọc, tránh chèn nhãn cấp độ khô khan
  const REP_DIM_NAME = { authority: 'Giới quan phương và quyền lực', common: 'Giới công chúng và dân gian', shadow: 'Giới phi chính thức và ngầm', circuit: 'Giới ngành nghề và chuyên môn' };
  const REP_VERDICT = {
    authority: { // Chốn quan trường —— tuân pháp/phục tùng ↔ khiêu khích/nguy hiểm
      'Thiên Nộ Nhân Oán': 'Giới này nhìn chung xem họ là mối đe dọa nghiêm trọng, và có thể chủ động hạn chế hoặc truy cứu trách nhiệm',
      'Tai Tiếng Lẫy Lừng': 'Giới này đánh giá rõ ràng tiêu cực, luôn cảnh giác và có xu hướng hạn chế hợp tác với họ',
      'Vô Danh Tiểu Tốt': 'Giới này chưa hiểu rõ về họ, chưa hình thành đánh giá cụ thể',
      'Được Kính Trọng': 'Giới này nhìn chung đánh giá tích cực, sẵn sàng dành cho họ một mức độ tin tưởng và cơ hội hợp tác',
      'Vạn Người Ngưỡng Mộ': 'Giới này đánh giá rất cao năng lực và tầm ảnh hưởng của họ, sẵn sàng ưu tiên ủng hộ hành động của họ',
    },
    common: { // Giữa chốn thị tứ —— nhân từ/bảo vệ ↔ bạo ngược/đe dọa
      'Thiên Nộ Nhân Oán': 'Công chúng đánh giá cực kỳ tiêu cực, phần lớn né tránh, tẩy chay hoặc công khai phản đối hành động của họ',
      'Tai Tiếng Lẫy Lừng': 'Công chúng đánh giá rõ ràng tiêu cực, thiếu tin tưởng và có xu hướng giữ khoảng cách',
      'Vô Danh Tiểu Tốt': 'Công chúng chưa hiểu rõ về họ, chưa hình thành đánh giá rộng rãi',
      'Được Kính Trọng': 'Công chúng nhìn chung đánh giá tích cực, có mức độ tin tưởng nhất định vào hành động và lời hứa của họ',
      'Vạn Người Ngưỡng Mộ': 'Công chúng đánh giá rất tích cực, được đông đảo công nhận và có sức lôi cuốn mạnh mẽ',
    },
    shadow: { // Chốn giang hồ —— có gan/dám gánh vác ↔ nhát gan/bắt nạt kẻ yếu
      'Thiên Nộ Nhân Oán': 'Giới này nhìn chung xem họ là mối đe dọa nghiêm trọng, có thể chủ động bài xích hoặc nhắm vào hành động của họ',
      'Tai Tiếng Lẫy Lừng': 'Giới này đánh giá rõ ràng tiêu cực, không muốn hợp tác và luôn đề phòng họ',
      'Vô Danh Tiểu Tốt': 'Giới này chưa hiểu rõ về họ, chưa hình thành đánh giá cụ thể',
      'Được Kính Trọng': 'Giới này nhìn chung đánh giá tích cực, sẵn sàng hợp tác ở mức hạn chế hoặc hỗ trợ thông tin',
      'Vạn Người Ngưỡng Mộ': 'Giới này đánh giá rất cao năng lực và lập trường của họ, có khả năng điều phối và huy động mạnh mẽ',
    },
    circuit: { // Giữa đồng đạo —— kỹ nghệ/tuân thủ quy tắc/cống hiến ↔ phá uy tín/phản bội
      'Thiên Nộ Nhân Oán': 'Giới này đánh giá cực kỳ tiêu cực, có thể hủy hợp tác, loại họ khỏi cuộc hoặc công khai truy cứu trách nhiệm',
      'Tai Tiếng Lẫy Lừng': 'Giới này đánh giá rõ ràng tiêu cực, không tin tưởng vào năng lực chuyên môn hay độ tin cậy trong hành xử của họ',
      'Vô Danh Tiểu Tốt': 'Giới này chưa hiểu rõ về họ, chưa hình thành đánh giá chuyên môn',
      'Được Kính Trọng': 'Giới này công nhận năng lực chuyên môn và cách hành xử của họ, sẵn sàng hợp tác',
      'Vạn Người Ngưỡng Mộ': 'Giới này đánh giá rất cao năng lực chuyên môn và đóng góp của họ, xem họ là đối tượng tham chiếu quan trọng',
    },
  };
  // Tương thích lưu trữ cũ: giai đoạn thang 6 cấp, "Có Chút Tiếng Tăm" được gộp vào "Được Kính Trọng"
  const REP_LEGACY = { 'Có Chút Tiếng Tăm': 'Được Kính Trọng' };
  const REP_LEVEL_NAME = {
    'Thiên Nộ Nhân Oán': 'Cực kỳ tiêu cực',
    'Tai Tiếng Lẫy Lừng': 'Rõ ràng tiêu cực',
    'Vô Danh Tiểu Tốt': 'Thiếu sự quan tâm',
    'Được Kính Trọng': 'Tích cực',
    'Vạn Người Ngưỡng Mộ': 'Được đánh giá cao',
  };

  // Lời bình vận thế thế lực: chuyển từ vận thế thành "thế lực này hiện đang ở tình cảnh nào, nội bộ có đoàn kết không"
  const STATUS_VERDICT = {
    'Cực Thịnh': 'Nguồn lực dồi dào, nhân sự ổn định, phối hợp tổ chức trơn tru, có khả năng duy trì hành động mạnh mẽ',
    'Ổn Định': 'Nguồn lực và cơ cấu tổ chức duy trì ổn định, có thể triển khai bình thường các việc đã định',
    'Nội Đấu': 'Cơ cấu tổ chức cơ bản vẫn còn nhưng nội bộ có bất đồng rõ rệt, hiệu quả quyết sách và thực thi suy giảm',
    'Khốn Đốn': 'Nguồn lực eo hẹp hoặc bị hạn chế từ bên ngoài, chỉ đang duy trì hoạt động cơ bản, khả năng chịu thêm rủi ro yếu',
    'Suy Tàn': 'Liên tục mất đi nguồn lực then chốt, phạm vi ảnh hưởng hoặc thành viên cốt cán, tính ổn định của tổ chức suy giảm rõ rệt',
    'Tan Rã': 'Khả năng vận hành và điều phối thực tế rất yếu, cơ cấu tổ chức gần như tan rã',
  };

  // Lời bình quan hệ thế lực: chuyển từ tên quan hệ thành "thế lực này có xu hướng hành động ra sao với {{user}}"
  const RELATION_VERDICT = {
    'Huyết Minh': 'Đã cùng {{user}} thiết lập quan hệ hợp tác lâu dài với độ tin tưởng cao, sẽ ưu tiên hỗ trợ và coi trọng an toàn cũng như mục tiêu chung của {{user}}',
    'Đồng Minh': 'Duy trì hợp tác ổn định với {{user}}, chủ động hỗ trợ và chia sẻ thông tin vì lợi ích chung, nhưng vẫn giữ ranh giới riêng của mỗi bên',
    'Thân Thiện': 'Có thiện cảm với {{user}}, sẵn sàng ưu tiên hợp tác và tạo điều kiện thuận lợi ở mức hạn chế, nhưng chưa thiết lập quan hệ hợp tác ổn định',
    'Trung Lập': 'Chưa có thái độ rõ ràng với {{user}}, sẽ hành động dựa trên mục tiêu và lợi ích của bản thân',
    'Lạnh Nhạt': 'Đã chú ý đến {{user}} nhưng ít muốn hợp tác, có xu hướng giữ khoảng cách, hiện chưa có kế hoạch hành động chủ động',
    'Thù Địch': 'Công khai đối lập với {{user}}, có thể gây áp lực, cản trở hoặc trực tiếp đối đầu',
    'Thâm Thù': 'Đang trong mối quan hệ thù địch dai dẳng và gay gắt với {{user}}, có thể lâu dài thực hiện các hành động nhắm vào {{user}} với cường độ cao',
  };
  const RELATION_NAME = {
    'Huyết Minh': 'Tin tưởng cao độ',
    'Đồng Minh': 'Hợp tác ổn định',
    'Thân Thiện': 'Có thiện cảm hợp tác',
    'Trung Lập': 'Chưa rõ lập trường',
    'Lạnh Nhạt': 'Giữ khoảng cách',
    'Thù Địch': 'Công khai đối lập',
    'Thâm Thù': 'Thù địch gay gắt',
  };

  // Lời bình khí hậu kinh tế: chuyển một từ khí hậu thành mô tả thị trường cho mô hình chính văn đọc
  const CLIMATE_VERDICT = {
    'Phồn Vinh': 'Thị trường sôi động, lưu thông thông suốt, cung cầu và việc làm duy trì ở mức cao',
    'Bình Ổn': 'Thị trường vận hành bình thường, giá cả và cung cầu chỉ biến động trong mức thông thường',
    'Suy Thoái': 'Hoạt động thị trường giảm sút, nhu cầu và quy mô kinh doanh thu hẹp, nguồn cung một số tài nguyên thiết yếu trở nên eo hẹp',
    'Biến Động': 'Trật tự thị trường bất ổn, giá cả và nguồn cung biến động rõ rệt, giao dịch bình thường bị ảnh hưởng',
  };

  function buildContext(worldState, tags) {
    const rulesLoader = window.WORLD_ENGINE_RULES;
    const rulesSummary = rulesLoader ? rulesLoader.getCoreRulesSummary() : '';
    let injectAllLevels = false;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      injectAllLevels = settings.injectAllLevels === true;
    } catch (e) {}

    // Chuỗi sự kiện: khi bật chèn toàn bộ cấp độ thì chèn hết; nếu không, Lv3/4 luôn chèn toàn bộ,
    // còn Lv1/2 chỉ chèn khi stage là "Đã Bùng Phát" (đã bùng nổ) hoặc "Đã Hoàn Thành" (đã kết thúc)
    const visibleEvents = (worldState.events || []).filter(e => {
      if (injectAllLevels) return true;
      if ((e.level || 0) >= 3) return true;
      return e.stage === 'Đã Bùng Phát' || e.stage === 'Đã Hoàn Thành';
    });
    const eventsText = visibleEvents.map(e => {
      const typeName = e.type === 'progress' ? 'Sự kiện phát triển' : 'Sự kiện xung đột';
      let txt = `${e.name} (${typeName}, cấp ${e.level}) ${e.stage} ${e.stageRound||1}/9`;
      if (e.evolveResult) txt += ` [${e.evolveResult}]`;
      return txt;
    }).join('; ') || 'Không có';

    // Thế lực: chèn cả 7 cấp quan hệ, dựng thành câu văn tự nhiên, vận thế/quan hệ đều kèm lời bình
    const formatPillars = (arr) => arr.length === 1
      ? arr[0]
      : arr.slice(0, -1).join(', ') + ' và ' + arr[arr.length - 1];
    const allFactions = worldState.factions || [];
    const factionsText = allFactions.length
      ? '\n' + allFactions.map(f => {
          const statusDesc = STATUS_VERDICT[f.status] || (f.status ? `Trạng thái hiện tại là "${f.status}"` : 'Trạng thái hiện tại chưa rõ');
          const relation = f.relation || 'Trung Lập';
          const relationName = RELATION_NAME[relation] || relation;
          const relationDesc = RELATION_VERDICT[relation] || `Thái độ đối với {{user}} là "${relation}"`;
          let s = `- ${f.name}: ${statusDesc}; quan hệ với {{user}} là ${relationName} - ${relationDesc}.`;
          if (f.scope) s += ` Phạm vi hoạt động hoặc ảnh hưởng là ${f.scope}.`;
          if (f.currentGoal) s += ` Mục tiêu hiện tại là ${f.currentGoal}.`;
          const tail = [];
          if (f.core_person) tail.push(`nhân vật cốt lõi là ${f.core_person}`);
          if (f.powerPillars?.length) tail.push(`nguồn lực hoặc năng lực chủ yếu đến từ ${formatPillars(f.powerPillars)}`);
          if (tail.length) s += tail.join(', ') + '.';
          return s;
        }).join('\n')
      : 'Không có';

    // Phong thanh: khi bật chèn toàn bộ cấp độ thì chèn hết; nếu không thì chỉ chèn Lv3/4
    const windTypeNames = { announcement: 'Thông báo', report: 'Tin tức', rumor: 'Tin đồn', sentiment: 'Dư luận' };
    const visibleWinds = (worldState.winds || []).filter(w => injectAllLevels || (w.level || 0) >= 3);
    const windsText = visibleWinds.map(w =>
      `[${windTypeNames[w.type] || 'Thông tin'} cấp ${w.level || 1} ${w.scope || '?'}] ${w.content}`
    ).join('; ') || 'Không có';

    // Xu thế chung thiên hạ
    const trendsText = (worldState.worldTrends || []).filter(t => t.status !== 'Đã Kết Thúc').map(t =>
      `${t.name} (${t.scope || 'Toàn cục'}): ${t.description}`
    ).join('; ') || 'Không có';

    // Danh tiếng: chèn lời bình dễ hiểu, thay vì nhãn cấp độ khô khan
    const rep = worldState.reputation || {};
    const repText = ['authority', 'common', 'shadow', 'circuit'].map(k => {
      const lv = REP_LEGACY[rep[k]] || rep[k];
      const verdict = REP_VERDICT[k] && REP_VERDICT[k][lv];
      if (!verdict) return '';
      return `${REP_DIM_NAME[k]}: mức đánh giá là ${REP_LEVEL_NAME[lv] || lv}; ${verdict}`;
    }).filter(Boolean).join('. ') + '.';
    const repChange = rep.lastChange ? `(${rep.lastChange})` : '';

    // Tín hiệu kinh tế: chèn toàn bộ
    const econ = worldState.economy || {};
    const signalsText = (econ.signals || []).map(s => `${s.summary} (${s.scope})`).join('; ');
    const climate = econ.climate || 'Bình Ổn';
    const climateText = `Tình hình thị trường là ${climate}: ${CLIMATE_VERDICT[climate] || CLIMATE_VERDICT['Bình Ổn']}`;
    const econText = `${climateText}${signalsText ? '. Tín hiệu thị trường: ' + signalsText : ''}`;

    // Sổ ghi thù địch
    let enemiesText = 'Không có';
    if (worldState.enemies && worldState.enemies.length) {
      enemiesText = worldState.enemies.map(e =>
        `${e.name} (${e.type==='blood'?'Đối địch nghiêm trọng':'Đối địch thông thường'}, ${e.status}, lý do: ${e.reason})`
      ).join('; ');
    }

    // Biến cố đột phát khu vực
    const ri = worldState.regionalIncident || {};
    let riText = '';
    if (ri.active) {
      riText = `⚠️ ${ri.title || 'Sự kiện đột phát khu vực'} (${ri.type || '?'}, ${ri.scope || '?'}) - ${ri.impact || ''}`;
    } else {
      riText = ri.title && ri.title.includes('thử lại') ? `⚠️ ${ri.title}` : 'Vòng này không có sự kiện khu vực mới';
    }

    // Hộp đen thông tin: hiển thị nội dung cụ thể
    const blackbox = worldState.blackbox || {};
    const boxParts = [];
    if (blackbox.secretActions?.length) {
      const actionsText = blackbox.secretActions.map(a =>
        `[Hành động] ${a.action || '?'} (chứng kiến: ${a.witnesses || 'không có'})`
      ).join('; ');
      boxParts.push(`Hành động chưa công khai (${blackbox.secretActions.length}): ${actionsText}`);
    }
    if (blackbox.secretAssets?.length) {
      const assetsText = blackbox.secretAssets.map(a =>
        `[Tài sản] ${a.name || '?'} (mức lộ: ${a.exposure || 0}%, ${a.status || 'còn hiệu lực'})`
      ).join('; ');
      boxParts.push(`Tài nguyên chưa công khai (${blackbox.secretAssets.length}): ${assetsText}`);
    }
    const blackboxText = boxParts.length ? boxParts.join(' | ') : 'Không có thông tin chưa công khai';

    const context = `
【世界信息】
Vòng cập nhật: ${worldState.round}
Tóm tắt: ${worldState.worldDigest}
Diễn biến toàn cục: ${trendsText}
Sự kiện đang diễn ra: ${eventsText}
Tổ chức và quan hệ: ${factionsText}
Thông tin công khai và dư luận: ${windsText}
Quan hệ đối địch: ${enemiesText}
Đánh giá xã hội: ${repText}${repChange}
Kinh tế: ${econText}
Diễn biến khu vực: ${riText}
Thông tin chưa công khai: ${blackboxText}

${rulesSummary}
    `.trim();

    let maxChars = 5000;
    try {
      const api = window.WORLD_ENGINE_API;
      const settings = api && api.getSettings ? api.getSettings() : {};
      const configured = Number(settings.injectMaxChars);
      if (Number.isFinite(configured)) maxChars = Math.max(0, Math.floor(configured));
    } catch (e) {}
    return maxChars > 0 ? context.substring(0, maxChars) : context;
  }

  return { buildContext };
})();
