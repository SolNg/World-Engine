// npc-engine-offscreen.js — Prompt sinh hoạt động ngầm: NPC vắng mặt làm gì sau lưng người chơi
window.NPC_ENGINE_OFFSCREEN = (function() {

  const SYSTEM_PROMPT = `Bạn là bộ suy diễn hoạt động ngầm của "Công Cụ Nhân Vật". Nhiệm vụ: quyết định các nhân vật đang VẮNG MẶT khỏi cảnh đã làm gì trong khoảng thời gian vừa trôi qua.

【NGUYÊN TẮC】
- Chỉ suy diễn cho nhân vật trong danh sách được cung cấp. Không thêm nhân vật mới.
- Hành động phải bắt nguồn từ mục tiêu, thế lực và hoàn cảnh của chính nhân vật đó, cộng với diễn biến thế giới vừa xảy ra. Không sáng tác tình tiết vô căn cứ.
- Một lượt hội thoại là một khoảng thời gian ngắn. Phần lớn nhân vật chỉ nhích một bước nhỏ, hoặc không làm gì đáng kể. Nhân vật không có việc gì để làm thì cứ bỏ qua, đừng ép ra hành động.
- Nhân vật đã chết hoặc đang bị giam giữ thì không hành động.

【BỐN KIỂU HẸN — CHỌN ĐÚNG KIỂU CHO TỪNG VIỆC】
Không phải việc gì cũng tiến theo cùng một cách. Khi đặt "intent", chọn "mode" cho khớp bản chất công việc:

- "natural" — trôi theo thời gian: đi đường, chờ đợi, hồi phục vết thương, cây lớn lên. Điền "duration" là tổng thời gian cần trôi qua.
- "effort" — cần giờ CÔNG thực sự: rèn đồ, nghiên cứu, luyện tập, điều tra. Điền "duration" là tổng thời gian nhân vật phải NGỒI LÀM. Thời gian trôi qua trong lúc họ đi đường hay bận việc khác thì không tính.
- "scheduled" — hẹn giờ cố định: cuộc họp, buổi lễ, hạn chót. Điền "duration" là khoảng cách từ bây giờ tới lúc đó.
- "conditional" — chờ thứ khác xảy ra: chờ hồi âm, chờ nguyên liệu tới, chờ người khác ra tay. Điền "condition", bỏ trống "duration".

Chọn sai kiểu thì việc sẽ xong sai lúc: một thanh kiếm cần 20 giờ rèn mà đặt "natural" sẽ tự xong sau 20 giờ dù thợ rèn đang đi xa.

【DI CHUYỂN — QUY TẮC RIÊNG】
Nếu nhân vật lên đường tới nơi khác, ước lượng "duration": chuyến đi mất bao nhiêu THỜI GIAN TRUYỆN (ngày/giờ/phút), không phải bao nhiêu lượt hội thoại.

Căn cứ để ước lượng:
- Hai địa điểm cách nhau bao xa theo mô tả trong truyện.
- Thế giới quan này đi lại bằng gì — đi bộ, ngựa, thuyền, xe, khinh công, phi kiếm, phi thuyền. Thế giới quan khác nhau thì cùng một quãng đường ra số lượt rất khác nhau.
- Nhân vật có gấp gáp không, có phương tiện tốt không, đường có bị chặn không.

Trong cùng một thành thì gần như không tốn thời gian. Khác thành thì phải có thời lượng thật: đi bộ trong thành vài chục phút, cưỡi ngựa liên thành vài giờ tới vài ngày, đi thuyền hay dịch trạm thì tuỳ tuyến. Đi càng xa, thời lượng càng lớn.

Ghi rõ "travelMode" là phương tiện di chuyển.

【TÍNH NHẤT QUÁN】
Nếu phần tư liệu có sẵn số lượt cho một tuyến đường đã đi trước đây, hãy dùng lại đúng con số đó, trừ khi hoàn cảnh lần này khác hẳn (đi gấp, phương tiện tốt hơn, đường bị chặn). Cùng một tuyến đường không được lúc nhanh lúc chậm bất nhất.

【ƯỚC LƯỢNG THỜI GIAN TRƯỚC KHI SUY DIỄN — LÀM ĐẦU TIÊN】
Một lượt hội thoại KHÔNG phải một đơn vị thời gian cố định. Trước khi quyết định bất kỳ hành động nào, hãy tự ước lượng khoảng thời gian cốt truyện đã thực sự trôi qua ở lượt này, căn cứ vào chính văn: nhịp cảnh, lời thoại nhắc tới thời gian, chuyển cảnh, quãng đường di chuyển, mức tiêu hao hành động. Nó có thể là vài phút, vài giờ, một đêm, vài ngày, hoặc gần như không nhích.

Mọi hành động ngầm phải VỪA VẶN với khoảng thời gian đó:

- Vài phút tới một giờ: nhân vật chỉ kịp phản ứng ngắn, di chuyển trong cùng khu vực, nói vài câu. Không xong được việc cần hàng giờ.
- Nửa ngày tới một ngày: xong được một việc trọn vẹn, đi được trong phạm vi thành.
- Nhiều ngày trở lên: đi xa được, hoàn tất kế hoạch, đổi ý, xây dựng quan hệ mới. Mọi việc vặt của ngày cũ đều đã kết thúc từ lâu.

Mỗi mục trong "activities" BẮT BUỘC ghi trường "timeRef": mốc thời gian đối chiếu của hành động đó, viết theo cách chính văn diễn đạt (ví dụ: "trong lúc người chơi đang nói chuyện", "tối cùng ngày", "ngày thứ hai sau đó"). Trường này để đối chiếu xem hành động có vừa với thời gian đã trôi qua hay không.

【TIẾP NỐI LIÊN TỤC】
Hành động lượt này phải tiếp nối hợp lý trạng thái của nhân vật ở lượt trước — nhưng TIẾP NỐI không có nghĩa là LẶP LẠI. Việc đang làm dở ở lượt trước, sau một khoảng thời gian dài, phải có kết cục chứ không được mô tả như vẫn đang diễn ra.

【THỜI GIAN VÀ DỰ ĐỊNH ĐANG TREO — QUAN TRỌNG】
Nhân vật có dự định từ lượt trước thì phải xử lý theo thời gian đã thực sự trôi qua, KHÔNG được chép lại nguyên văn dự định đó như thể chưa có gì xảy ra.

- Dự định đánh dấu "ĐẾN HẠN" bắt buộc phải kết lại dứt điểm trong lượt này: đã làm xong, đã bỏ dở, đã thất bại, hay đã bị việc khác chen ngang. Không được để nó treo tiếp.
- Dự định đánh dấu "ĐÃ LỖI THỜI" là dự định ngắn hạn nhưng truyện đã nhảy qua nhiều ngày. Chuyện đó hoặc đã diễn ra xong từ lâu, hoặc đã bị bỏ quên. Tuyệt đối không viết như thể nó đang diễn ra ngay lúc này.
- Một cuộc hẹn "ngay hôm nay" mà truyện đã sang ngày khác thì nó đã kết thúc rồi, không phải vẫn đang tiếp diễn.

Với nhân vật có dự định đến hạn hoặc lỗi thời, phần "action" phải mô tả KẾT CỤC của dự định đó, và trường "intent" chỉ điền khi họ có dự định MỚI.

【TIN ĐỒN】
Hành động nào đủ lộ liễu để lan tới tai người khác thì đánh dấu "becameRumor": true và viết "rumorText" theo giọng tin đồn — không chắc chắn, không đầy đủ, đúng như cách tin tức thật sự lan truyền. Hành động bí mật thì để false.

【TRI THỨC THU ĐƯỢC】
Nhân vật làm gì đó có thể khiến họ biết thêm điều mới. Ghi vào "knowledgeGained" kèm nguồn: "chứng kiến", "nghe đồn", hoặc "suy đoán".

【ĐỊNH DẠNG XUẤT KẾT QUẢ】
Chỉ xuất một khối JSON hợp lệ, không kèm giải thích, không kèm dấu bao mã.

{
  "activities": [
    {
      "name": "tên nhân vật",
      "action": "nhân vật đã làm gì, một câu ngắn",
      "timeRef": "mốc thời gian đối chiếu của hành động này, theo cách chính văn diễn đạt",
      "visibility": "công khai / kín đáo / bí mật",
      "becameRumor": false,
      "rumorText": "nội dung tin đồn nếu becameRumor là true",
      "move": {
        "to": ["quốc gia", "vùng", "thành", "địa điểm"],
        "duration": { "days": 0, "hours": 0, "minutes": 0 },
        "travelMode": "phương tiện"
      },
      "intent": {
        "action": "dự định sắp tới",
        "mode": "natural / effort / scheduled / conditional",
        "duration": { "days": 0, "hours": 0, "minutes": 0 },
        "condition": "chỉ điền khi mode là conditional"
      },
      "knowledgeGained": [{ "fact": "điều mới biết", "source": "chứng kiến / nghe đồn / suy đoán", "certainty": "chắc chắn / ngờ vực / mơ hồ" }]
    }
  ]
}

Không nhân vật nào có hành động đáng kể thì trả "activities": [] — đó là kết quả hợp lệ.`;

  const clean = value => String(value == null ? '' : value).trim();
  const asArray = value => Array.isArray(value) ? value : [];
  const describePath = path => {
    const parts = asArray(path).map(clean).filter(Boolean);
    return parts.length ? parts.join(' › ') : 'chưa rõ';
  };

  // Mức chủ động: dịch tham số 0..1 thành chỉ dẫn bằng lời, vì mô hình đọc lời tốt hơn đọc số.
  function describeAggressiveness(value) {
    const level = Math.min(1, Math.max(0, Number(value)));
    if (level <= 0.2) return 'Rất dè dặt: hầu hết nhân vật nên án binh bất động, chỉ ai có lý do cấp bách mới hành động.';
    if (level <= 0.45) return 'Dè dặt: phần lớn nhân vật chỉ nhích từng bước nhỏ.';
    if (level <= 0.7) return 'Vừa phải: nhân vật có mục tiêu rõ thì chủ động tiến hành, số còn lại giữ nguyên.';
    if (level <= 0.9) return 'Chủ động: nhân vật tích cực theo đuổi mục tiêu, sẵn sàng ra quyết định lớn.';
    return 'Rất chủ động: nhân vật ráo riết hành động, cục diện chuyển biến nhanh.';
  }

  function describeAbsentNpcs(npcs, nowMinutes) {
    const now = Number(nowMinutes) || 0;
    const list = asArray(npcs);
    if (!list.length) return '(không có nhân vật nào vắng mặt cần suy diễn)';

    return list.map(npc => {
      const lines = [`■ ${clean(npc.name)} — vị trí: ${describePath(npc.location?.path)}`];

      if (npc.location?.movingTo) {
        // Thời gian còn lại tính theo đồng hồ; dữ liệu cũ chưa có mốc thì mới rơi về đếm lượt.
        const arriveAt = npc.location.arriveAt;
        const helper = window.NPC_ENGINE_DATA;
        const left = (arriveAt !== null && arriveAt !== undefined && helper)
          ? `còn ${helper.describeDuration(arriveAt - now)}`
          : `còn ${npc.location.etaRounds} lượt`;
        lines.push(`  đang trên đường tới ${describePath(npc.location.movingTo)}, ${left} (${clean(npc.location.travelMode) || 'không rõ phương tiện'})`);
      }
      if (npc.faction?.name) {
        lines.push(`  thế lực: ${clean(npc.faction.name)}${npc.faction.role ? ' — ' + clean(npc.faction.role) : ''}${npc.faction.standing ? ' (' + clean(npc.faction.standing) + ')' : ''}`);
      }

      const goals = asArray(npc.goals).slice(0, 3)
        .map(goal => `${clean(goal.text)} (${clean(goal.progress) || 'đang tiến hành'})`)
        .filter(Boolean);
      if (goals.length) lines.push('  mục tiêu: ' + goals.join('; '));

      if (npc.relations?.user?.attitude) lines.push(`  với người chơi: ${clean(npc.relations.user.attitude)}`);
      if (npc.status?.condition) lines.push(`  trạng thái: ${clean(npc.status.condition)}`);
      // Dự định đến hạn hoặc lỗi thời phải nêu bật, nếu không mô hình chỉ đọc thấy một dòng
      // trung tính rồi chép lại nguyên văn — đó là cách một cuộc hẹn "ngay hôm nay" kéo dài ba ngày.
      const intent = npc.pendingIntent;
      if (intent?.action) {
        if (intent.staleByTime) {
          lines.push(`  dự định ĐÃ LỖI THỜI (đặt ra từ ngày truyện trước): ${clean(intent.action)} — phải kết lại, không được viết như đang diễn ra`);
        } else if (intent.due) {
          lines.push(`  dự định ĐẾN HẠN, phải kết lại dứt điểm lượt này: ${clean(intent.action)}`);
        } else {
          const detail = window.NPC_ENGINE_DATA?.describeSchedule?.(intent.schedule, now) || '';
          lines.push(`  dự định đang treo: ${clean(intent.action)}${detail ? ' — ' + detail : ''}`);
        }
      }

      const recent = asArray(npc.offscreenLog).slice(-2)
        .map(entry => clean(entry.action)).filter(Boolean);
      if (recent.length) lines.push('  vừa làm: ' + recent.join(' → '));

      return lines.join('\n');
    }).join('\n\n');
  }

  function describeTravelCache(cache, limit) {
    const entries = Object.entries(cache || {}).slice(0, Math.max(0, limit || 15));
    if (!entries.length) return '';
    return entries
      .map(([route, value]) => `${route}: ${value.etaRounds} lượt${value.travelMode ? ' (' + clean(value.travelMode) + ')' : ''}`)
      .join('\n');
  }

  function buildUserPrompt(options) {
    const opts = options || {};
    const sections = [];

    const scale = clean(opts.worldScale);
    sections.push(`【THẾ GIỚI QUAN】\n${scale && scale !== 'auto'
      ? scale
      : 'Tự suy ra từ tư liệu và hội thoại bên dưới. Đây là căn cứ quyết định tốc độ đi lại.'}`);

    sections.push(`【MỨC CHỦ ĐỘNG】\n${describeAggressiveness(opts.aggressiveness)}`);

    // Khoảng thời gian trôi qua GIỮA HAI LƯỢT mới là thứ quyết định nhân vật làm được bao nhiêu việc.
    // Chỉ nói tổng số ngày từ đầu truyện thì mô hình không biết truyện vừa nhảy ba ngày hay vài phút.
    if (Number.isFinite(Number(opts.storyDay)) || Number.isFinite(Number(opts.elapsedDays))) {
      const lines = [];
      if (Number.isFinite(Number(opts.storyDay))) lines.push(`Đã trôi qua ${Number(opts.storyDay)} ngày kể từ đầu truyện.`);

      const elapsed = Number(opts.elapsedDays);
      if (Number.isFinite(elapsed)) {
        if (elapsed <= 0) {
          lines.push('So với lượt trước, thời gian truyện gần như chưa nhích: nhân vật chỉ làm được những việc ngắn.');
        } else if (elapsed === 1) {
          lines.push('So với lượt trước đã sang ngày mới. Mọi việc dự định làm "hôm nay" của ngày cũ đều đã kết thúc.');
        } else {
          lines.push(`So với lượt trước đã trôi qua ${elapsed} ngày. Đây là một quãng dài: nhân vật đủ thời gian làm nhiều việc, đi xa, hoặc đổi ý. Mọi dự định ngắn hạn của ngày cũ đều đã xong hoặc đã bị bỏ.`);
        }
      }
      sections.push(`【THỜI GIAN TRUYỆN】\n${lines.join('\n')}`);
    }

    // Tư liệu nền đặt trước diễn biến: nhân vật hành động trong một thế giới có sẵn luật lệ, thế lực
    // và địa lý riêng. Thiếu phần này thì hoạt động ngầm sinh ra sẽ chung chung, không ăn nhập với truyện.
    if (clean(opts.worldbook)) {
      sections.push(`【TƯ LIỆU SỔ TAY THẾ GIỚI】\n${clean(opts.worldbook)}\n\nHành động của nhân vật phải phù hợp với các thiết lập trên: đúng thế lực họ thuộc về, đúng địa lý, đúng luật lệ và trình độ kỹ thuật của thế giới này. Không được mâu thuẫn với tư liệu đã cho.`);
    }

    if (clean(opts.worldDigest)) {
      sections.push(`【DIỄN BIẾN THẾ GIỚI VỪA XẢY RA】\n${clean(opts.worldDigest)}`);
    }

    if (clean(opts.sceneSummary)) {
      sections.push(`【CẢNH HIỆN TẠI CỦA NGƯỜI CHƠI】\n${clean(opts.sceneSummary)}`);
    }

    const routes = describeTravelCache(opts.travelCache, opts.travelCacheLimit);
    if (routes) {
      sections.push(`【SỐ LƯỢT ĐI LẠI ĐÃ BIẾT CỦA CÁC TUYẾN ĐƯỜNG】\n${routes}`);
    }

    // Danh sách này do engine chọn sẵn theo mức liên quan, không phải toàn bộ người vắng mặt.
    // Nói rõ để mô hình không đi tìm những nhân vật khác mà nó biết là có tồn tại.
    const skipped = Math.max(0, parseInt(opts.skippedCount) || 0);
    const scopeNote = skipped
      ? `\n\nCòn ${skipped} nhân vật vắng mặt khác lượt này KHÔNG cần suy diễn — họ giữ nguyên trạng thái. Đừng nhắc tới họ, cũng đừng bịa hoạt động cho họ.`
      : '';
    sections.push(`【NHÂN VẬT VẮNG MẶT CẦN SUY DIỄN】\n${describeAbsentNpcs(opts.absentNpcs, opts.nowMinutes)}${scopeNote}`);

    const limit = Math.max(0, parseInt(opts.maxActivities) || 0);
    if (limit > 0) {
      sections.push(`【GIỚI HẠN】\nTối đa ${limit} nhân vật có hành động đáng kể trong lượt này. Chọn những người có lý do mạnh nhất.`);
    }

    sections.push('Hãy suy diễn hoạt động ngầm theo đúng định dạng JSON đã quy định.');
    return sections.join('\n\n');
  }

  function buildMessages(options) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(options) }
    ];
  }

  // Xem ghi chú ở npc-engine-prompt.js: callApi() nhận chuỗi, không nhận mảng messages.
  function buildPrompt(options) {
    return SYSTEM_PROMPT + '\n\n' + buildUserPrompt(options);
  }

  // ===== Xem tại chỗ =====
  // Chỉ để NGƯỜI CHƠI nhìn trộm nhân vật đang làm gì lúc này. Không đổi trạng thái, không tiến
  // thời gian, không gửi vào chat — nên prompt cũng phải nói rõ là đừng quyết định gì cả, nếu
  // không mô hình sẽ tự ý cho nhân vật hành động rồi lượt sau hai bên lệch nhau.
  const PEEK_PROMPT = `Bạn là bộ quan sát của "Công Cụ Nhân Vật". Nhiệm vụ: viết một đoạn ngắn tả nhân vật này đang làm gì NGAY LÚC NÀY, theo ngôi thứ nhất, như nhìn trộm qua khe cửa.

【QUY TẮC】
- Chỉ MÔ TẢ hiện trạng. Không quyết định điều gì mới, không cho nhân vật bắt đầu việc gì, không đổi vị trí, không kết thúc dự định đang treo.
- Bám sát hồ sơ được cung cấp: nhân vật đang ở đâu, đang dở việc gì, tâm trạng ra sao với người chơi.
- Ngôi thứ nhất, giọng nội tâm. 2-4 câu, không dài dòng.
- Đây là đoạn chỉ người chơi đọc ở hậu trường, không phải nội dung sẽ đưa vào truyện. Đừng viết như một cảnh truyện có đối thoại.

Chỉ xuất phần văn xuôi, không JSON, không tiêu đề, không giải thích.`;

  function buildPeekPrompt(options) {
    const opts = options || {};
    const npc = opts.npc || {};
    const helper = window.NPC_ENGINE_DATA;
    const now = Number(opts.nowMinutes) || 0;

    const lines = [`Tên: ${clean(npc.name)}`];
    const identity = helper?.describeIdentity?.(npc);
    if (identity) lines.push(`Nhân dạng: ${identity}`);
    lines.push(`Đang ở: ${describePath(npc.location?.path)}`);
    if (npc.location?.movingTo) lines.push(`Đang trên đường tới: ${describePath(npc.location.movingTo)}`);
    if (npc.faction?.name) lines.push(`Thế lực: ${clean(npc.faction.name)}${npc.faction.role ? ' — ' + clean(npc.faction.role) : ''}`);

    const goals = asArray(npc.goals).slice(0, 3)
      .map(goal => `${clean(goal.text)} (${clean(goal.progress) || 'đang tiến hành'})`).filter(Boolean);
    if (goals.length) lines.push(`Mục tiêu: ${goals.join('; ')}`);

    if (npc.pendingIntent?.action) {
      const detail = helper?.describeSchedule?.(npc.pendingIntent.schedule, now) || '';
      lines.push(`Dự định đang treo: ${clean(npc.pendingIntent.action)}${detail ? ' — ' + detail : ''}`);
    }
    if (npc.relations?.user?.attitude) lines.push(`Thái độ với người chơi: ${clean(npc.relations.user.attitude)}`);
    if (npc.status?.condition) lines.push(`Trạng thái: ${clean(npc.status.condition)}`);

    const recent = asArray(npc.offscreenLog).slice(-3).map(entry => clean(entry.action)).filter(Boolean);
    if (recent.length) lines.push(`Vừa làm: ${recent.join(' → ')}`);

    const sections = [`【HỒ SƠ NHÂN VẬT】\n${lines.join('\n')}`];
    if (clean(opts.clockLabel)) sections.push(`【THỜI ĐIỂM】\n${clean(opts.clockLabel)}`);
    if (clean(opts.worldDigest)) sections.push(`【TÌNH HÌNH THẾ GIỚI】\n${clean(opts.worldDigest)}`);
    sections.push('Hãy viết đoạn quan sát theo đúng quy tắc trên.');

    return PEEK_PROMPT + '\n\n' + sections.join('\n\n');
  }

  return {
    SYSTEM_PROMPT,
    describeAggressiveness,
    describeAbsentNpcs,
    describeTravelCache,
    buildUserPrompt,
    buildMessages,
    buildPrompt,
    buildPeekPrompt,
    PEEK_PROMPT
  };
})();
