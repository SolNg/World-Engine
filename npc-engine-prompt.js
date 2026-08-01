// npc-engine-prompt.js — Prompt trích xuất nhân vật: nhận diện NPC, chấm bậc, cập nhật 6 trục
window.NPC_ENGINE_PROMPT = (function() {

  const SYSTEM_PROMPT = `Bạn là bộ trích xuất nhân vật của "Công Cụ Nhân Vật". Nhiệm vụ: đọc đoạn hội thoại mới nhất, nhận diện các nhân vật phụ (NPC) và cập nhật hồ sơ của họ.

【NGUYÊN TẮC LỌC — QUAN TRỌNG NHẤT】
Không phải nhân vật nào xuất hiện cũng đáng lưu. Với mỗi nhân vật, tự hỏi: nhân vật này có thiết yếu với câu chuyện không?

- "core" (trọng yếu): có tên riêng rõ ràng, có động cơ hoặc mục đích nhận biết được, và có tác động tới người chơi hoặc cục diện. Ví dụ: một kiếm khách có tên họ, có mối thù, đang theo đuổi mục tiêu riêng.
- "peripheral" (ngoại vi): có tên nhưng động cơ chưa rõ, mới xuất hiện thoáng qua.
- Không lưu: nhân vật quần chúng không tên hoặc chỉ có chức danh — "lão chủ quán", "tên lính gác", "đám đông", "người qua đường". TUYỆT ĐỐI không đưa loại này vào kết quả.

Chấm "significance" từ 0 đến 100 theo mức độ thiết yếu. Thà bỏ sót còn hơn lưu thừa: danh sách phình ra thì hệ thống mất tác dụng.

【SÁU TRỤC THEO DÕI】
1. Vị trí — nơi nhân vật đang ở, dưới dạng đường dẫn phân cấp từ lớn tới nhỏ: ["quốc gia", "vùng", "thành", "địa điểm"]. Chỉ ghi những cấp mà chính văn thực sự nêu ra hoặc suy ra được chắc chắn; không bịa thêm cấp.
2. Mục tiêu — nhân vật đang theo đuổi điều gì, tiến triển tới đâu.
3. Thế lực — thuộc phe nào, giữ vai trò gì, thế lực đó đang lên hay xuống.
4. Quan hệ — thái độ với người chơi (kèm lý do thay đổi), và quan hệ với các NPC khác.
5. Tri thức — nhân vật BIẾT những gì. Ghi rõ biết qua đường nào: "chứng kiến", "nghe đồn", hoặc "suy đoán". Đây là trục quan trọng: nhân vật không được biết những chuyện chưa từng tới tai họ.
6. Trạng thái — tình trạng thân thể, tài nguyên trong tay, còn sống hay đã chết.

【QUY TẮC】
- Chỉ ghi nhận điều chính văn nêu ra hoặc suy ra được trực tiếp. Không sáng tác thêm tình tiết.
- Nhân vật đã có trong hồ sơ thì chỉ ghi phần THAY ĐỔI, giữ nguyên phần không đổi.
- RIÊNG "name", "tier" và "significance" thì LUÔN ghi lại đầy đủ cho mọi nhân vật xuất hiện, kể cả khi không đổi so với hồ sơ. Ba trường này dùng để xếp bậc, thiếu là xếp sai.
- Chấm lại "significance" theo toàn bộ những gì đã biết về nhân vật tính đến lúc này, không phải chỉ theo lượt hội thoại vừa rồi. Nhân vật chính của truyện thì điểm phải cao và giữ ổn định qua các lượt, không được tụt chỉ vì lượt này họ ít nói.
- "present" đánh dấu nhân vật có thực sự xuất hiện trong cảnh vừa rồi hay không — dùng để biết ai đang vắng mặt.
- Nhân vật chết thì đưa vào "deaths" kèm nguyên nhân, đừng chỉ đặt alive=false.
- Tên riêng giữ nguyên dạng chính văn dùng. Biệt danh cho vào "aliases".

【ĐỊNH DẠNG XUẤT KẾT QUẢ】
Chỉ xuất một khối JSON hợp lệ, không kèm giải thích, không kèm dấu bao mã.

{
  "scene": {
    "location": ["quốc gia", "vùng", "thành", "địa điểm"],
    "presentNames": ["tên các nhân vật có mặt trong cảnh"]
  },
  "npcs": [
    {
      "name": "tên riêng",
      "aliases": ["biệt danh"],
      "tier": "core hoặc peripheral",
      "significance": 0,
      "present": true,
      "identity": { "gender": "giới tính", "pronouns": "cách xưng hô", "species": "chủng tộc", "ageStage": "độ tuổi", "appearance": "đặc điểm ngoại hình cố định", "socialRole": "thân phận xã hội" },
      "location": { "path": ["quốc gia", "vùng", "thành", "địa điểm"] },
      "goals": [{ "text": "mục tiêu", "priority": 1, "progress": "chớm nảy / đang tiến hành / gần hoàn tất / đã hoàn tất / thất bại" }],
      "faction": { "name": "tên thế lực", "role": "vai trò", "standing": "đang lên / ổn định / đang xuống" },
      "relations": {
        "user": { "attitude": "thái độ với người chơi", "trust": 0, "reason": "vì sao thay đổi" },
        "npcs": [{ "name": "tên NPC khác", "type": "đồng minh / thù địch / thân tộc / thầy trò / xa lạ", "attitude": "thái độ" }]
      },
      "knowledge": [{ "fact": "điều nhân vật biết", "source": "chứng kiến / nghe đồn / suy đoán", "certainty": "chắc chắn / ngờ vực / mơ hồ" }],
      "status": { "condition": "tình trạng", "resources": "tài nguyên", "alive": true }
    }
  ],
  "deaths": [{ "name": "tên", "reason": "nguyên nhân" }],
  "time": {
    "label": "mốc thời gian của đoạn này theo đúng cách chính văn nói, ví dụ: đêm cùng ngày / sáng hôm sau / ba ngày sau / Rằm tháng Giêng",
    "elapsedDays": 0,
    "note": "căn cứ nào trong chính văn cho biết điều đó"
  }
}

【NHÂN DẠNG — CHỈ ĐIỀN, KHÔNG SỬA】
Trường "identity" là những thứ KHÔNG đổi theo thời gian: giới tính, cách xưng hô, chủng tộc, độ tuổi, ngoại hình cố định, thân phận xã hội.

- Nhân vật MỚI: điền đầy đủ những gì chính văn nêu ra. Không nêu thì để trống, đừng đoán.
- Nhân vật ĐÃ CÓ trong hồ sơ: chỉ điền vào ô còn trống. Ô đã có giá trị thì bỏ qua, không được sửa dù bạn nghĩ nó sai — hệ thống sẽ tự bỏ mọi thay đổi lên ô đã chốt.
- Đây là cơ chế chống trôi: qua vài chục lượt, nhân vật không được lặng lẽ đổi giới tính, tuổi hay chủng tộc.

【ĐỌC THỜI GIAN】
Trường "time" rất quan trọng, phải điền cho mọi lượt.

- "label": mốc thời gian của đoạn vừa đọc, viết theo đúng cách chính văn diễn đạt.
- "elapsedDays": số NGÀY đã trôi qua so với mốc thời gian của lượt trước (nêu ở phần tư liệu bên dưới). Cùng ngày hoặc chỉ vài giờ thì ghi 0. Sang hôm sau ghi 1. "Ba ngày sau" ghi 3. "Một tuần sau" ghi 7. Không rõ thì ghi 0.
- Căn cứ vào chữ trong chính văn: "sáng hôm sau", "ba ngày sau", "tuần kế tiếp", ngày tháng cụ thể, hoặc chuyển cảnh có nêu thời gian. Không có căn cứ thì đừng bịa, cứ ghi 0.

Không có nhân vật nào đáng lưu thì trả "npcs": [] — đó là kết quả hợp lệ.`;

  const clean = value => String(value == null ? '' : value).trim();
  const asArray = value => Array.isArray(value) ? value : [];

  function describePath(path) {
    const parts = asArray(path).map(clean).filter(Boolean);
    return parts.length ? parts.join(' › ') : 'chưa rõ';
  }

  // Hồ sơ hiện có, nén lại đủ để mô hình biết cái gì đã lưu mà không tốn cả kho token.
  function describeKnownNpcs(npcs, limit) {
    const list = asArray(npcs).slice(0, Math.max(0, limit || 20));
    if (!list.length) return 'Chưa có nhân vật nào trong hồ sơ.';

    return list.map(npc => {
      const bits = [
        `[${npc.tier === 'core' ? 'trọng yếu' : 'ngoại vi'}] ${clean(npc.name)}`,
        npc.aliases?.length ? `(còn gọi: ${npc.aliases.join(', ')})` : '',
        `— vị trí: ${describePath(npc.location?.path)}`
      ];
      if (npc.location?.movingTo) {
        bits.push(`đang trên đường tới ${describePath(npc.location.movingTo)}, còn ${npc.location.etaRounds} lượt`);
      }
      if (npc.faction?.name) bits.push(`thế lực: ${clean(npc.faction.name)}${npc.faction.role ? ' (' + clean(npc.faction.role) + ')' : ''}`);

      const goal = asArray(npc.goals)[0];
      if (goal?.text) bits.push(`mục tiêu: ${clean(goal.text)} (${clean(goal.progress) || 'đang tiến hành'})`);

      const identity = window.NPC_ENGINE_DATA?.describeIdentity?.(npc);
      if (identity) bits.push(`nhân dạng đã chốt: ${identity}`);
      if (npc.relations?.user?.attitude) bits.push(`với người chơi: ${clean(npc.relations.user.attitude)}`);
      if (npc.status?.alive === false) bits.push('ĐÃ CHẾT');

      return bits.filter(Boolean).join(' ');
    }).join('\n');
  }

  function buildUserPrompt(options) {
    const opts = options || {};
    const sections = [];

    if (clean(opts.tonePrompt)) {
      sections.push(`【YÊU CẦU RIÊNG CỦA NGƯỜI DÙNG】\n${clean(opts.tonePrompt)}`);
    }

    if (clean(opts.worldbook)) {
      sections.push(`【TƯ LIỆU SỔ TAY THẾ GIỚI】\n${clean(opts.worldbook)}`);
    }

    sections.push(`【HỒ SƠ NHÂN VẬT HIỆN CÓ】\n${describeKnownNpcs(opts.npcs, opts.knownLimit)}`);

    if (clean(opts.worldDigest)) {
      sections.push(`【TÓM TẮT DIỄN BIẾN THẾ GIỚI LƯỢT NÀY】\n${clean(opts.worldDigest)}`);
    }

    // Mô hình cần biết mốc của lượt TRƯỚC thì mới tính được đã trôi qua bao lâu.
    const timeLines = [];
    if (clean(opts.previousTimeLabel)) {
      timeLines.push(`Mốc thời gian của lượt trước: ${clean(opts.previousTimeLabel)}`);
    }
    if (Number.isFinite(Number(opts.storyDay))) {
      timeLines.push(`Đã trôi qua ${Number(opts.storyDay)} ngày kể từ đầu truyện.`);
    }
    if (timeLines.length) {
      timeLines.push('Hãy đọc mốc thời gian của đoạn dưới đây và điền vào trường "time".');
      sections.push(`【THỜI GIAN TRUYỆN】\n${timeLines.join('\n')}`);
    }

    sections.push(`【HỘI THOẠI CẦN TRÍCH XUẤT】\n${clean(opts.dialogue) || '(không có nội dung)'}`);

    if (clean(opts.nameBlacklist)) {
      sections.push(`【KHÔNG ĐƯỢC LƯU CÁC TÊN SAU】\n${clean(opts.nameBlacklist)}`);
    }

    sections.push('Hãy trích xuất theo đúng định dạng JSON đã quy định.');
    return sections.join('\n\n');
  }

  function buildMessages(options) {
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(options) }
    ];
  }

  // WORLD_ENGINE_API.callApi() nhận MỘT CHUỖI rồi tự bọc thành [{ role: 'user', content: prompt }].
  // Truyền mảng messages vào đó sẽ tạo ra content là một mảng object, và API trả HTTP 400.
  // Đây là dạng prompt thật sự được gửi đi; buildMessages() chỉ giữ lại cho nơi nào cần dạng hội thoại.
  function buildPrompt(options) {
    return SYSTEM_PROMPT + '\n\n' + buildUserPrompt(options);
  }

  return {
    SYSTEM_PROMPT,
    describeKnownNpcs,
    describePath,
    buildUserPrompt,
    buildMessages,
    buildPrompt
  };
})();
