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
  "deaths": [{ "name": "tên", "reason": "nguyên nhân" }]
}

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

    if (Number.isFinite(Number(opts.storyDay))) {
      sections.push(`【THỜI GIAN TRUYỆN】\nĐã trôi qua ${Number(opts.storyDay)} ngày kể từ đầu truyện.`);
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

  return {
    SYSTEM_PROMPT,
    describeKnownNpcs,
    describePath,
    buildUserPrompt,
    buildMessages
  };
})();
