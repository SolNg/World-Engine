# NPC Engine — Bản thiết kế

Thay thế Bộ Nhớ Ký Ức (Memory Engine) bằng **Công Cụ Nhân Vật (NPC Engine)**: theo dõi NPC quan trọng và cho họ **hoạt động ngầm** khi vắng mặt khỏi cảnh, rồi ràng buộc AI chính phải tôn trọng những gì đã xảy ra ngầm.

**Trạng thái: đã thi công xong cả bốn bước.** Bộ Nhớ Ký Ức đã được gỡ hẳn (7 file, cùng toàn bộ giao diện và CSS của nó). Kiểm tra bằng `node docs/kiem-tra.js`.

Sai lệch giữa bản thiết kế này và mã nguồn thực tế, đã ghi chú tại chỗ ở các mục liên quan:

- Thêm hai trường vào trạng thái, không có trong bản nháp: `publicFacts` (mục 5) và `scene`. Không có `publicFacts` thì không viết được ràng buộc "nhân vật này CHƯA biết X" — muốn trừ thì phải có số bị trừ.
- Bỏ bảng khoảng cách vùng, thay bằng đường dẫn vị trí phân cấp + AI phán `etaRounds` một lần (mục 6).
- Mục 8.1 viết lại: cách diễn đạt "trễ một lượt" ở bản nháp đầu là sai, không hề có lệch pha thông tin.

---

## 1. Nguyên tắc nền

1. **Nhịp theo lượt, không theo đồng hồ.** Mọi ràng buộc thời gian đếm bằng *lượt hội thoại*, không bằng giờ/phút. Lý do: `parseStoryDay()` ([world-engine-core.js:589](../world-engine-core.js)) chỉ trả về **tổng số ngày** tích luỹ, không có giờ. Khi parse ra được ngày thì dùng thêm làm lớp tăng cường (mục 6), khi không parse được thì hệ thống vẫn chạy đủ.
2. **Không phải NPC nào cũng được lưu.** Bộ lọc 3 bậc, có ngưỡng chỉnh tay (mục 4).
3. **Cái để xem ≠ cái để gửi.** Nhật ký hoạt động ngầm là để người chơi đọc trong bảng điều khiển. Cái bơm vào prompt chỉ gồm **ràng buộc cứng + tin đồn** (mục 7).
4. **Bám khuôn World Engine.** Cùng kiểu IIFE gán vào `window.*`, cùng cơ chế lưu theo `chatId`, cùng hai điểm nối đã có sẵn giữa World và Memory.

---

## 2. Gỡ Memory Engine

Memory Engine cô lập tốt: `world-engine-core.js` và `world-engine-inject.js` **không tham chiếu tới nó lần nào**. Các điểm phải sửa:

| Chỗ | Việc |
|---|---|
| [world-engine.js](../world-engine.js) nhóm `memory` trong `ENGINE_GROUPS` | Thay bằng nhóm `npc` với danh sách module + `contracts` mới |
| [world-engine.js:8](../world-engine.js) `worldEngineMemoryGenerateInterceptor` | Xem mục 2.1 — **không xoá thẳng** |
| `manifest.json` khoá `generate_interceptor` | Đổi tên hàm cho khớp |
| [world-engine-evolution.js:944](../world-engine-evolution.js) `MEMORY_ENGINE.buildWorldEngineContext` | Đổi sang `NPC_ENGINE.buildWorldEngineContext` |
| [world-engine.js:594](../world-engine.js) và `:658` `ingestWorldEvolution` | Đổi sang `NPC_ENGINE.ingestWorldEvolution` |
| `world-engine-ui.js` (478 chỗ chứa "memory") | Phần nặng nhất. Gỡ panel Ký Ức, dựng panel Nhân Vật |
| `style.css` (101 chỗ) | Đổi tên lớp CSS `.memory-*` → `.npc-*` |
| 7 file `memory-engine-*.js` | Xoá |

**Dữ liệu cũ**: giữ nguyên, không migrate, không xoá. NPC Engine dùng khoá riêng `npc_engine_state_<chatId>`; các khoá `memory_engine_state_*` nằm im không ai đọc. Chat cũ không hỏng, khỏi viết code chuyển đổi cho tính năng đã bỏ.

### 2.1. Bẫy: tin nhắn bị ẩn sẽ kẹt vĩnh viễn

Memory Engine có tính năng **ẩn chính văn cũ đã được tóm tắt bao phủ** (`hideCoveredRawText`, mặc định bật). Việc bỏ ẩn do `prepareHistoryForGeneration()` đảm nhiệm, gọi qua `generate_interceptor`.

Gỡ thẳng Memory Engine → **mọi tin nhắn đang bị ẩn ở chat cũ sẽ ẩn vĩnh viễn**, vì không còn ai gọi lệnh bỏ ẩn.

Xử lý: một tiện ích **bỏ ẩn toàn bộ, chạy một lần** trong mục Bảo Trì. Đây là việc dọn dẹp một lần cho chat cũ — NPC Engine không ẩn chính văn, nên chat mới không phát sinh vấn đề này nữa.

### 2.2. Hệ quả: mất neo thời gian

Bỏ Memory Engine đồng nghĩa bỏ luôn tóm tắt lượt — AI sẽ chỉ còn chính văn thô. Rủi ro là **AI quên mốc thời gian / sự kiện của 3-4 lượt trước**, nhất là trong truyện dài.

NPC Engine bù bằng một dòng **neo thời gian** rất ngắn ở đầu khối chèn (mục 7, khối 0). Rẻ về token, và nó vốn là thứ engine đã biết chắc: số ngày truyện, số lượt, mấy sự kiện mốc gần nhất.

---

## 3. Cấu trúc file

Theo đúng khuôn nhóm engine trong `ENGINE_GROUPS`:

```
npc-engine-settings.js     → window.NPC_ENGINE_SETTINGS   (getSettings, patchSettings)
npc-engine-data.js         → window.NPC_ENGINE_DATA       (loadState, saveState) — khoá theo chatId, có checkpoint
npc-engine-prompt.js       → window.NPC_ENGINE_PROMPT     (buildUserPrompt) — trích xuất + chấm điểm NPC
npc-engine-offscreen.js    → window.NPC_ENGINE_OFFSCREEN  (buildUserPrompt) — sinh hoạt động ngầm
npc-engine.js              → window.NPC_ENGINE            (init, applyInjection, abort, isRunning)
```

5 file thay cho 7. Không cần hai file prompt tóm tắt vì bỏ tiểu/đại tóm tắt của Memory Engine.

---

## 4. Bộ lọc 3 bậc

AI chấm điểm khi trích xuất, nhưng **ngưỡng và số lượng tối đa là tham số trong UI**, không phó mặc cho AI tự cân nhắc lại mỗi lượt (nó sẽ trôi theo thời gian).

| Bậc | Điều kiện | Lưu gì | Hoạt động ngầm |
|---|---|---|---|
| **Trọng yếu** (`core`) | Có tên riêng, có động cơ/mục tiêu rõ, có tác động tới người chơi | Đủ 6 trục | Có |
| **Ngoại vi** (`peripheral`) | Có tên nhưng chưa rõ động cơ | Chỉ vị trí + trạng thái | Không |
| **Quần chúng** | "lão chủ quán", "tên lính gác" | Không lưu | Không |

- `npcCoreLimit` (mặc định 12): số NPC Trọng yếu tối đa. Vượt ngưỡng thì NPC lâu không xuất hiện nhất bị hạ bậc — đây là thứ chặn prompt phình ra khi truyện dài.
- Nâng/hạ bậc bằng tay trong bảng điều khiển, và bậc do người chơi ghim (`pinned`) thì không bị tự động hạ.

---

## 5. Mô hình trạng thái NPC

```js
{
  id: 'npc:3',
  name: 'Lý Mộ Bạch',
  aliases: ['Lý đại hiệp'],
  tier: 'core',              // core | peripheral
  significance: 0-100,
  pinned: false,
  firstSeenLayer: 4,
  lastSeenLayer: 17,         // lượt cuối cùng thực sự có mặt trong cảnh

  // ===== 6 trục =====
  location: {
    current: 'Trường An',    // sự thật
    movingTo: null,
    etaRounds: 0,            // còn mấy lượt nữa mới tới đích — trục xương sống của ràng buộc
    userBelievesAt: 'Dương Châu',  // chỗ người chơi TƯỞNG là NPC đang ở
    fogSince: 16             // từ lượt nào thì hai giá trị trên lệch nhau
  },
  goals: [{ text: 'Chiêu mộ tử sĩ', priority: 1, progress: 'đang tiến hành', dueRound: 24 }],
  faction: { name: 'Thanh Long hội', role: 'đường chủ', standing: 'đang lên' },
  relations: {
    user: { attitude: 'nghi ngại', trust: -20, lastChangeReason: 'thấy người chơi rời khỏi hiện trường' },
    npcs: [{ id: 'npc:7', type: 'thù địch', attitude: 'muốn trừ khử' }]
  },
  knowledge: [{
    fact: 'Người chơi đã giết Trương Tam',
    source: 'nghe đồn',      // chứng kiến | nghe đồn | suy đoán
    certainty: 'ngờ vực',
    sinceRound: 15
  }],
  status: { condition: 'khoẻ', resources: 'có 30 thủ hạ', alive: true, archived: false },

  // ===== hoạt động ngầm =====
  offscreenLog: [{ round: 16, storyDay: 42, action: 'Rời Dương Châu đi Trường An', becameRumor: true }],
  pendingIntent: { action: 'Tập kích kho lương', etaRounds: 2 }
}
```

`location.userBelievesAt` tách khỏi `location.current` là chi tiết quan trọng: nó cho phép tình huống người chơi tưởng NPC còn ở chỗ cũ trong khi NPC đã đi — nguồn kịch tính chính của cả tính năng.

---

## 6. Ràng buộc di chuyển

**Nguyên tắc: engine không hiểu địa lý, engine chỉ đếm.** Việc phán đoán xa-gần giao hết cho AI, engine chỉ lưu kết luận và trừ dần. Không có bảng khoảng cách cứng nào phải bảo trì.

### 6.1. Vị trí là một đường dẫn phân cấp

```js
location.path = ['Đại Chu', 'Giang Nam', 'Dương Châu', 'Túy Tiên lâu']
//                quốc gia    vùng        thành        điểm cụ thể
```

Độ gần suy ra bằng **so khớp tiền tố**, không cần dữ liệu gì thêm:

| Trùng tới cấp | Ý nghĩa | Ràng buộc |
|---|---|---|
| Hết đường dẫn | Cùng một chỗ | Gặp nhau tự nhiên, không ràng buộc |
| Tới cấp thành | Cùng thành, khác điểm | Gặp được trong cùng lượt nếu có lý do |
| Tới cấp vùng | Khác thành | Phải di chuyển, cần `etaRounds` |
| Chỉ tới quốc gia hoặc không trùng | Xa | Di chuyển dài, `etaRounds` lớn |

Đúng ý "cùng một thành phố thì dễ gặp nhau" — mà không phải khai báo khoảng cách giữa từng cặp địa danh.

### 6.2. AI phán một lần, engine đếm

Khi NPC bắt đầu di chuyển, prompt yêu cầu AI trả về `etaRounds` + `travelMode` ('cưỡi ngựa', 'đi thuyền', 'khinh công', 'dịch trạm'...). AI tự cân nhắc từ ngữ cảnh: hai địa danh cách nhau bao xa theo mô tả trong truyện, thế giới quan này đi lại bằng gì, NPC có gấp không, đường có bị chặn không.

Engine sau đó **chỉ trừ 1 mỗi lượt**. Không tự tính toán gì.

`worldScale` (cấu hình, hoặc AI tự suy từ lorebook): cổ trang / hiện đại / tu tiên / viễn tưởng. Đây là thứ khiến "từ Dương Châu tới Trường An" ra 12 lượt trong truyện kiếm hiệp nhưng 1 lượt trong truyện có phi kiếm.

### 6.3. Bộ nhớ đệm hành trình

Kết quả AI phán được **lưu lại theo cặp địa danh**. Lần sau ai đi tuyến đó thì dùng lại con số cũ, trừ khi ngữ cảnh nói khác (đi gấp, đường bị chặn, có phương tiện tốt hơn).

Đây là bộ nhớ đệm chứ không phải bảng bắt buộc: rỗng thì hỏi AI, có thì dùng lại. Mục đích là **tính nhất quán** — Dương Châu→Trường An không thể lúc 3 lượt lúc 12 lượt. Sửa tay được trong bảng điều khiển.

### 6.4. Lớp tăng cường theo ngày

Khi `parseStoryDay()` trả về số ngày hợp lệ, ghi kèm số ngày đường ước tính vào ràng buộc để AI mô tả cho hợp lý. Parse trượt thì im lặng bỏ qua, ràng buộc theo lượt vẫn nguyên hiệu lực.

---

## 7. Hai lớp: xem và gửi

### Lớp hiển thị (không bao giờ vào prompt)

Bảng điều khiển: danh sách NPC theo bậc, 6 trục của từng người, nhật ký hoạt động ngầm theo lượt. Đây là chỗ người chơi đọc để biết thế giới đang xoay thế nào sau lưng mình.

### Lớp chèn (qua `setExtensionPrompt`, giống [memory-engine.js:1587](../memory-engine.js))

Bốn khối, ngắn gọn:

**Khối 0 — Neo thời gian.** Một dòng: ngày truyện hiện tại, số lượt, 2-3 sự kiện mốc gần nhất. Bù cho việc bỏ tóm tắt của Memory Engine (mục 2.2), chống việc AI trôi mốc thời gian sau vài lượt.

**Khối 1 — Ràng buộc vị trí.** Ai đang ở đâu, ai đang trên đường, ai không thể có mặt. Hành vi phụ thuộc `locationFogMode`:

| Chế độ | Nội dung đưa vào prompt |
|---|---|
| `off` | Vị trí thật. AI biết hết, tự quyết định tiết lộ hay không. |
| `fog` *(mặc định)* | Chỉ đưa `userBelievesAt` + gợi ý mơ hồ: *"Có tin đồn Lý Mộ Bạch không còn ở Dương Châu, nhưng chưa ai rõ hắn đi đâu."* AI không biết đích thật, nên không lỡ miệng tiết lộ. |
| `strict` | Chỉ `userBelievesAt`, không gợi ý gì. Người chơi hoàn toàn mù cho đến khi tự đi tìm. |

`fog` là mặc định vì nó giữ được bất ngờ mà vẫn cho AI chất liệu để viết. Ai muốn tự cầm trịch hoàn toàn thì bật `off`.

**Khối 2 — Ràng buộc tri thức.** Với mỗi NPC **đang có mặt trong cảnh**: NPC này **chưa biết** những gì. Ví dụ: *"Lý Mộ Bạch chưa biết người chơi đã giết Trương Tam — không được để nhân vật nhắc tới việc này."* Trục đắt nhất về token, nên giới hạn ở NPC trong cảnh, không phát cho cả danh sách.

**Khối 3 — Tin đồn.** Kết quả hoạt động ngầm đã lan tới tai người chơi, nối vào hệ tin đồn sẵn có của World Engine.

Kèm chỉ thị buộc AI tuân thủ thay vì tự bịa lại vị trí/tri thức nhân vật.

---

## 8. Nối với World Engine

Dùng lại **đúng hai điểm nối** Memory Engine đang dùng, chỉ đổi tên:

```
Lượt N:
  1. World Engine suy diễn  ──> state.worldDigest, lastEvolveResult
       (prompt của nó có nhét NPC_ENGINE.buildWorldEngineContext(state)
        = dự định NPC của lượt N-1)          [world-engine-evolution.js:944]
  2. applyInjection() + làm mới UI Thế Giới
  3. NPC_ENGINE.ingestWorldEvolution({ layer, worldRound, worldDigest,
                                       worldUpdate, replace })   [world-engine.js:594]
       ├── trích xuất/cập nhật NPC từ hội thoại lượt này
       ├── sinh hoạt động ngầm cho NPC core vắng mặt
       └── kết quả nào lộ ra ngoài thì đẩy ngược thành tin đồn World Engine
```

### 8.1. Về chuyện "trễ một lượt" — không có lệch pha thông tin

Cách diễn đạt ở bản nháp trước gây hiểu nhầm. Nói cho đúng:

**Cả hai engine đều đọc chính văn của lượt N.** World Engine nhận thẳng hội thoại lượt hiện tại (`performEvolution(aiMsg, chat, ...)`), NPC Engine cũng vậy. Không có sự kiện nào của lượt N mà một bên thấy còn bên kia mù.

Thứ World Engine nhận từ NPC Engine ở bước 1 là **trạng thái nền có cấu trúc tính đến hết lượt N-1** — tức là bao gồm cả hoạt động ngầm đã sinh ra ở lượt N-1. Đó là dữ liệu NPC mới nhất tồn tại vào thời điểm đó. Nó không thể chứa phản ứng của NPC với kết quả suy diễn thế giới lượt N, vì kết quả đó **chưa được sinh ra**. Đây là quan hệ nhân quả, không phải độ trễ kỹ thuật.

Và đúng như bạn nói — sau khi World Engine xong vòng của lượt N, NPC **hoạt động ngay trong lượt N** (bước 3), dựa trên `worldDigest` vừa mới ra lò. Không đợi sang lượt sau.

Tin đồn do NPC sinh ra được **ghi thẳng vào trạng thái World Engine**, không tốn thêm lượt gọi API, nên nó có hiệu lực ngay từ lần chèn kế tiếp.

**Nếu vẫn muốn khử triệt để**, có phương án 3 pha: NPC trích xuất (chỉ cần hội thoại) → World suy diễn (thấy NPC vừa cập nhật) → NPC sinh hoạt động ngầm. Giá: **3 lượt gọi API mỗi turn** thay vì 2. Mình khuyên chưa làm — World Engine vốn đã đọc chính văn nên phần "được thêm" chỉ là bản có cấu trúc của thứ nó đã thấy. Để dành, khi chạy thực tế thấy lệch thì bật sau.

**Chi phí hiện tại**: 2 lượt gọi API mỗi turn thay vì 1. Công tắc `npcLinkEnabled` (giống `memoryLinkEnabled`) để tắt chiều World→NPC.

**Nguồn NPC**: hội thoại + World Info/Lorebook, dùng lại `world-engine-worldbook.js` như World Engine đang làm.

---

## 9. Cấu hình

Theo khuôn `MEMORY_ENGINE_SETTINGS` — API riêng, khoá lưu riêng `npc_engine_settings`.

| Khoá | Mặc định | Ý nghĩa |
|---|---|---|
| `engineEnabled` | true | Bật/tắt toàn bộ |
| `evolveEveryX` | 1 | Chạy mỗi N lượt |
| `npcCoreLimit` | 12 | Số NPC Trọng yếu tối đa |
| `significanceThreshold` | 60 | Ngưỡng điểm để lên bậc Trọng yếu |
| `offscreenEnabled` | true | Cho phép sinh hành động ngầm |
| `offscreenAggressiveness` | 0.5 | Mức độ NPC chủ động hành động khi vắng mặt |
| `injectLocation` / `injectKnowledge` / `injectRumor` | true | Bật/tắt từng khối chèn |
| `timeAnchorEnabled` | true | Dòng neo thời gian (khối 0) |
| `locationFogMode` | `fog` | `off` / `fog` / `strict` — xem mục 7 |
| `worldScale` | `auto` | Thế giới quan quyết định tốc độ đi lại — `auto` thì AI tự suy từ lorebook |
| `travelCacheEnabled` | true | Nhớ ETA theo cặp địa danh cho nhất quán (mục 6.3) |
| `knowledgeInjectScope` | `in-scene` | Chỉ phát ràng buộc tri thức cho NPC có mặt |
| `npcLinkEnabled` | true | Chiều World → NPC |
| `injectIntoWorldEngine` | true | Chiều NPC → World |

Cộng phần API riêng (`apiUrl`, `apiKey`, `model`, `temperature`...) giống Memory Engine.

---

## 10. Reroll / xoá lùi

Hai engine hiện làm **hai kiểu khác hẳn nhau**, nên phải chọn chứ không "giữ nguyên" được:

| | World Engine | Memory Engine |
|---|---|---|
| Cơ chế | Trạng thái kép a/b ([world-engine-core.js:404](../world-engine-core.js)). `a` = ảnh chụp toàn bộ, sao từ `b` mỗi lượt mới | Timeline kiểu event-sourcing: `root.base` + danh sách `nodes`, mỗi node là phần trích xuất của một lượt |
| Lùi lại | Khôi phục một ảnh chụp | `replayTimeline()` — đánh dấu node hỏng rồi **phát lại từ gốc**, gộp lại toàn bộ |
| Vì sao | Trạng thái thế giới bị **ghi đè** — bản mới nhất thay bản cũ, một ảnh chụp là đủ | Ký ức **cộng dồn** — ký ức lượt 5 và lượt 20 cùng tồn tại; xoá lượt 12 phải tính lại xem cái gì đến từ đâu |

Dữ liệu NPC **lai giữa hai kiểu**: vị trí / thái độ / mục tiêu / trạng thái là ghi đè (giống thế giới), còn `knowledge[]` và `offscreenLog[]` là cộng dồn (giống ký ức).

**Chọn: kiểu World Engine, sao nguyên cơ chế.**

Cụ thể là sao chép đúng ba thứ đã có trong [world-engine.js](../world-engine.js):

1. **Nhận diện reroll bằng `type` gốc của Tavern.** `onGenerationStarted(type, _opts, dryRun)` → `isReroll = (type === 'swipe' || type === 'regenerate')`, cộng `onMessageSwiped()` cho nút mũi tên. **Không** dùng tiêu chí thuần số kiểu `chatLayer === state.chatLayer` — bản v2.3.18 từng làm thế và bị hồi quy, vì `GENERATION_STARTED` phát ra *trước khi* tầng người dùng được đẩy vào chat (ghi chú ở [world-engine.js:773](../world-engine.js)).
2. **Reroll thì chèn điểm lưu, không chèn trạng thái hiện tại.** Đây chính là thứ chặn "AI vẫn diễn theo kịch bản đã sắp xếp": điểm lưu là trạng thái NPC *trước khi* tầng đang bị reroll được sinh ra, nên lần sinh mới không thấy hệ quả của lần sinh cũ.
3. **`replace: !isNewRound`.** Reroll thì ghi đè bản ghi của lượt đó thay vì nối thêm — nếu không, mỗi lần reroll lại đẻ thêm một bộ hoạt động ngầm chồng lên nhau.
4. **Bỏ qua `dryRun`** để tránh chèn hai lần.

**Thêm một cái rẻ tiền**: mỗi mục trong `knowledge[]` và `offscreenLog[]` đóng dấu `layer`. Khôi phục điểm lưu vốn đã xoá được dữ liệu của một tầng, nhưng điểm lưu của World Engine chỉ **sâu một cấp** — xoá lùi nhiều tầng thì nó không phủ hết. Dấu `layer` cho phép **lọc bỏ mọi mục có `layer >= L`**, vá được phần cộng dồn mà không cần dựng cả hệ timeline như Memory Engine.

Lọc, không phát lại. Làm được vì các mục tri thức là bản ghi độc lập, không có gộp/khử trùng phức tạp như `knowledge_index` — thứ vốn là lý do duy nhất khiến Memory Engine phải dùng timeline.

Bám sự kiện `MESSAGE_SWIPED` / `MESSAGE_DELETED` / `GENERATION_STARTED` như cả hai engine đang làm.

## 11. NPC chết

Chỉ áp dụng cho bậc **Trọng yếu** — quần chúng không lưu nên không có gì để đánh dấu.

- `status.alive = false`, `status.archived = true` → chuyển vào **kho lưu trữ**, tách khỏi danh sách hoạt động.
- Ngừng sinh hoạt động ngầm, và **không tính vào `npcCoreLimit`** nữa (nhường chỗ cho NPC sống).
- **Vẫn tra cứu được**: người chơi mở kho ra xem lại toàn bộ 6 trục và nhật ký của nhân vật đã chết.
- **Vẫn còn hiệu lực ràng buộc tri thức**: cái chết là một `fact` mà NPC khác có thể chưa biết. Lý Mộ Bạch chết ở lượt 20 không có nghĩa cả thiên hạ biết ngay — NPC nào chưa nhận tin vẫn phải nói năng như thể hắn còn sống. Đây là lý do chính không xoá thẳng dữ liệu.
- Sống lại được: bỏ cờ, kéo từ kho ra.

## 12. Điểm còn mở

- **Chi phí token** khi số NPC core lớn — `npcCoreLimit` là van chặn, nhưng cần đo thực tế mới biết 12 có hợp lý không.
- **Bảng khoảng cách vùng** (mục 6) suy ra dần từ truyện — chưa rõ độ chính xác thực tế tới đâu.
