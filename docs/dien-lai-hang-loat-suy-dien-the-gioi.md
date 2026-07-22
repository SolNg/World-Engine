# PR: Điền Lại Hàng Loạt "Suy Diễn Thế Giới" (Điền Lại Theo Từng Lô Đến Tầng Chỉ Định)

> Bổ sung cho 「🌍 World Engine」 khả năng **suy diễn lại trạng thái thế giới theo từng lô, từ tầng AI đầu tiên đến tầng chỉ định**:
> khi đã có sẵn nhiều hội thoại từ trước lúc cài extension, hoặc muốn làm lại từ đầu, chỉ cần một cú bấm là điền lại theo lô, giúp trạng thái thế giới được bổ sung đầy đủ và liền mạch.
>
> Phiên bản: `2.3.0` → `2.3.1`
> Nhánh đích: `cloud` (đã có "Bộ nhớ đệm và lưu trữ Tavern v2.2.0" + "Kích hoạt đèn lam-lục sổ tay thế giới v2.3.0", PR này đắp chồng lên trên)

---

## 1. Bối cảnh và động lực

Hiện trạng: World Engine chỉ có thể suy diễn **từng lượt một** — mỗi khi nhận được một câu trả lời AI thì thế giới tiến thêm một bước ([`world-engine.js`](../world-engine.js) `onMessageReceived` → `performEvolution`).

Điểm bất tiện:

- Người dùng thường **cài/bật extension sau khi đã có vài chục tầng hội thoại**, lúc này trạng thái thế giới đang **trống rỗng**, lệch hẳn so với những gì đã xảy ra trong cốt truyện.
- Hoặc người dùng điều chỉnh lại luật/sổ tay thế giới, muốn thế giới **làm lại từ đầu**, nhưng không có lối vào nào để "tính lại từ đầu".

PR này cung cấp tính năng "**điền lại suy diễn thế giới**": bắt đầu từ tầng AI đầu tiên, suy diễn thế giới **theo từng lô** (mỗi lô N tầng AI) đến tầng chỉ định. Ví dụ 30 tầng AI, mỗi lô 5 tầng → gọi suy diễn 6 lần, mô phỏng "thế giới tiến từng đoạn về phía trước".

---

## 2. Các quyết định thiết kế (đã chốt cùng người dùng)

1. **Phạm vi hội thoại = chỉ N tầng của lô hiện tại** (không cộng dồn).
   Lô 1 chỉ đưa vào hội thoại của tầng 1–5, lô 2 chỉ đưa vào tầng 6–10... số token đưa vào API mỗi lô **cố định, có thể kiểm soát**, không tăng vọt theo số lô.
2. **Nhưng trạng thái thế giới thì cộng dồn qua từng lô**.
   Lô thứ k được suy diễn tiếp **trên kết quả suy diễn của lô k−1** (mỗi lô kết thúc thì `state` đã được ghi xuống đĩa, lô tiếp theo đọc lại từ đầu), đảm bảo thế giới liền mạch — lô 2 có thể thấy được chuỗi sự kiện, tin đồn, biến động phe phái do lô 1 tạo ra.
3. **Điểm khởi đầu = xóa sạch làm lại**.
   Trước khi điền lại sẽ **bỏ hết trạng thái thế giới và điểm lưu hiện tại**, suy diễn từ thế giới trống rỗng + tầng AI đầu tiên. Đúng với nghĩa đen của "điền lại".
   - Trước khi điền lại sẽ **tự động lưu một bản sao lưu** ("tự động sao lưu trước khi điền lại"), lỡ không ưng ý vẫn có thể khôi phục.
   - Trước khi bắt đầu sẽ **hiện hộp xác nhận** nói rõ "sẽ xóa sạch làm lại".
4. **Mỗi lô có số lần thử lại độc lập, có thể cấu hình**.
   Khi một lô suy diễn thất bại (API báo lỗi/parse lỗi) thì **thử lại độc lập lô đó** theo giới hạn đã đặt; hết số lần thử mới **dừng toàn bộ** (không tiếp tục cộng dồn trên trạng thái xấu).
5. Giao diện có thể cấu hình: **số tầng AI mỗi lô**, **tầng kết thúc** (0 = suy diễn đến hết), **số lần thử lại mỗi lô**.

> Tính năng này là **kích hoạt thủ công rõ ràng** (bấm nút + xác nhận), không thay đổi bất kỳ hành vi suy diễn tự động nào, không ảnh hưởng gì đến người dùng hiện tại.

---

## 3. Tái sử dụng chuỗi suy diễn từng lô sẵn có

Điểm mấu chốt: **không viết lại logic suy diễn**, điền lại hàng loạt = gọi tuần tự N lần hàm `evolve(forward)` có sẵn.

- Suy diễn một lô `evolution.evolve(state, userMsg, aiMsg, { mode:'forward', dialogueText })` ([`world-engine-evolution.js`](../world-engine-evolution.js)) bên trong đã xử lý đầy đủ:
  - `mode:'forward'` → coi là vòng mới, `state.round++`, xoay vòng điểm lưu, `saveStateWithLayer(state)` đưa tầng về đúng tầng thực tế hiện tại.
  - Trả về `true/false`; nếu thất bại thì đã `Object.assign(state, backup)` **hoàn tác**, có thể thử lại an toàn.
- `callEvolutionAPI` đưa `dialogueText` trực tiếp vào prompt như "## Hội thoại gần đây", nên mỗi lô chỉ cần dựng văn bản hội thoại của lô đó.

> Vì vậy sau khi điền lại xong, `round` và `chatLayer` **tự nhiên đã đúng**, không cần chuẩn hóa thêm.

---

## 4. Engine điền lại: `backfillEvolve(opts)` (`world-engine-evolution.js`)

Thêm mới và export `async function backfillEvolve(opts)`, với `opts = { batchSize, retries, endLayer, onProgress }`.

### 4.1 Tính bảng chỉ số tầng AI
Duyệt qua `SillyTavern.getContext().chat`, thu thập chỉ số của toàn bộ `!is_user && mes.trim()`, được `aiIdx = [i0, i1, ...]` (tiêu chí giống hệt `onMessageReceived` của suy diễn tự động: loại trừ tầng của user, tin nhắn rỗng). `aiIdx.length` = số tầng AI hợp lệ.

### 4.2 Chặn tầng kết thúc
`endLayer` để trống/bằng 0/vượt quá số tầng thực tế → lấy `aiIdx.length` (suy diễn đến hết).

### 4.3 Chia lô (kèm xử lý chia không hết)
`endLayer` tầng AI đầu tiên được cắt theo `batchSize`, **lô cuối gánh phần dư** — nếu lô cuối không đủ `batchSize` thì gộp vào lô trước:

| Tổng tầng / mỗi lô | Các lô (số tầng mỗi lô) |
|------------|------------------|
| 30 / 5 | 5,5,5,5,5,5 (chia hết, 6 lô) |
| 30 / 7 | 7,7,7,**9** (lô cuối gánh phần dư) |
| 14 / 7 | 7,7 (vừa chia hết, không gộp nhầm) |
| 10 / 20 | 10 (batchSize ≥ tổng số → 1 lô) |

### 4.4 Xóa sạch làm lại
`core.clearState()` + `core.clearCheckpoint()`, để lô đầu tiên suy diễn từ thế giới trống rỗng (ép `mode:'forward'`, bỏ qua phán đoán vân tay của `isNewRound()`).

### 4.5 Vòng lặp từng lô
Với mỗi lô `[pStart..pEnd]` (số thứ tự tầng AI):
- **Văn bản hội thoại của lô**: lấy đoạn cắt từ "sau tầng AI trước đó" đến "tầng AI cuối cùng của lô này" trong chat (kể cả các tầng user xen giữa), dùng đúng định dạng như `performEvolution`: `'Người dùng'/'AI'：' + core.filterDialogue(...)`, `filter(line.length>3)`, `join('\n')`.
- `aiMsg` = nội dung `mes` của tầng AI cuối cùng trong lô này.
- **Vòng lặp thử lại** `for (attempt = 0; attempt <= retries; attempt++)`: mỗi lần đọc lại `core.loadState()` (evolve đã ghi đĩa) → `evolve(state, '', aiMsg, { mode:'forward', dialogueText })`; thành công thì break; thất bại mà chưa bị hủy thì thử lại; hết số lần thì **dừng toàn bộ**.
- Sau khi mỗi lô thành công, gọi `WORLD_ENGINE_LEDGER.recordChanges(state)` (giống đường đi của một lượt đơn).
- Báo tiến trình cho giao diện qua callback `onProgress({ phase, batch, totalBatches, layerFrom, layerTo, attempt, ok, round })`.

### 4.6 Hủy và chốt chặn
- Thêm mới ở cấp module `_backfillRunning` / `_backfillAborted`.
- `abort()` đồng thời bật `_backfillAborted` (để quá trình điền lại dừng êm ả ở khoảng nghỉ giữa các lô) và gọi `_abortController.abort()` (ngắt request của lô đang chạy dở).
- `isRunning()` trả về `_isRunning || _backfillRunning` — trong lúc đang điền lại, suy diễn tự động do sự kiện kích hoạt sẽ bị chốt chặn `evolution.isRunning()` sẵn có chặn lại, không bị chen vào.

Trả về `{ done, totalBatches, completedBatches, failedAt?, reason? }`.

---

## 5. Kích hoạt và điều phối: `runBackfill()` (`world-engine-ui.js`)

Thêm mới ở cấp module `async function runBackfill()`:

1. Đọc cài đặt `backfillBatchSize / backfillRetries / backfillEndLayer`, đếm số tầng AI hiện tại, tính ra tầng kết thúc hợp lệ và số lô.
2. Hiện hộp xác nhận `confirm()`: "Sẽ xóa sạch trạng thái thế giới hiện tại, suy diễn lại từ tầng AI đầu tiên đến tầng thứ N, tổng cộng khoảng M lô, mỗi lô thử lại tối đa R lần. Trước khi bắt đầu sẽ tự động lưu một bản sao lưu. Xác nhận làm lại từ đầu?"
3. Sau khi xác nhận, gọi trước `window.WORLD_ENGINE_CHATCACHE?.createSnapshot('tự động sao lưu trước khi điền lại')` (nếu thất bại chỉ `console.warn`, không chặn lại).
4. Đặt `isEvolving`, `setEvolvingUI(true,'state')`, gọi `evolution.backfillEvolve({ batchSize, retries, endLayer, onProgress })`.
   `onProgress` ghi "Đang xử lý lô thứ i/M…" vào dòng trạng thái trên trang cài đặt `#we-backfill-status` và trạng thái bên ngoài của nút nổi.
5. Kết thúc thì hiện thông báo theo `result.reason` (hoàn thành / bị hủy / một lô thất bại / không có tầng AI), và gọi `applyInjection()` để phần chính văn được bơm theo trạng thái mới.
6. Chống gọi trùng: tái dùng chốt chặn `isEvolving` và `evolution.isRunning()`.

---

## 6. Giao diện cài đặt (`world-engine-ui.js` + `world-engine-api.js`)

`renderSettingsForm` thêm khu vực độc lập mới **"Điền lại hàng loạt suy diễn thế giới"** (đặt sau "Chế độ suy diễn"):
- Ba ô nhập số: `Số tầng AI mỗi lô` (min 1), `Tầng kết thúc (0=toàn bộ)` (min 0), `Số lần thử lại mỗi lô` (min 0), onchange là lưu ngay (theo đúng kiểu `persist` sẵn có).
- Hai nút: `▶ Bắt đầu điền lại suy diễn thế giới` (nút chính → `runBackfill()`), `■ Dừng` (→ `evolution.abort()`).
- Một dòng giải thích + dòng trạng thái.

`world-engine-api.js` thêm cài đặt mặc định mới:
```js
backfillBatchSize: 5,    // Số tầng AI mỗi lô
backfillRetries: 2,      // Số lần thử lại độc lập mỗi lô
backfillEndLayer: 0,     // Tầng AI kết thúc (0 = suy diễn đến hết)
```

---

## 7. Danh sách file thay đổi

| File | Thay đổi | Mức độ số dòng |
|------|----------|----------|
| `world-engine-evolution.js` | **Cốt lõi**: engine `backfillEvolve` + liên động `abort/isRunning` + export | +khoảng 140 dòng |
| `world-engine-ui.js` | Khu vực "điền lại hàng loạt" trên trang cài đặt + điều phối `runBackfill` + gắn nút | +khoảng 134 dòng |
| `world-engine-api.js` | Cài đặt mặc định thêm 3 khóa cho việc điền lại | +4 dòng |
| `manifest.json` | Phiên bản `2.3.0` → `2.3.1`, bổ sung mô tả | 2 dòng |

> **Không thay đổi** `world-engine-core.js` / `world-engine-worldbook.js` / `world-engine-chatcache.js`: việc điền lại hoàn toàn tái sử dụng các hàm `evolve` / `core` / `chatcache` đã export sẵn, không xâm phạm gì vào logic cốt lõi.

---

## 8. Trường hợp biên

| Trường hợp | Xử lý |
|------|------|
| Không có chat / số tầng AI bằng 0 | Báo "Chat hiện tại không có tầng AI nào để suy diễn", không thực hiện |
| `endLayer` > số tầng AI thực tế | Chặn về số tầng thực tế |
| `batchSize` ≥ tổng số tầng | Suy biến thành 1 lô (vẫn hoạt động bình thường) |
| Chia không hết | Lô cuối gánh phần dư (30/7 → 7/7/7/9), không sinh ra lô rỗng |
| Một lô hết số lần thử vẫn thất bại | Ghi vào `failedAt`, **dừng các lô tiếp theo** (không cộng dồn trên trạng thái xấu), báo dừng ở lô thứ mấy |
| Người dùng bấm dừng | `abort()` → `evolve` của lô hiện tại ném `AbortError` / khoảng nghỉ giữa lô phát hiện `_backfillAborted` → kết thúc êm ả, các lô đã hoàn thành được giữ nguyên |
| chatcache không dùng được (không đồng bộ/không ghi được) | Bản sao lưu bị bỏ qua âm thầm (warn), quá trình điền lại vẫn tiếp tục bình thường |
| Suy diễn tự động kích hoạt trong lúc đang điền lại | `isRunning()` bao gồm `_backfillRunning`, chốt chặn sẵn có ngăn không cho chen vào |
| Trang cài đặt tự làm mới sau 30s | `refresh(auto)` return ngay khi đang ở trang cài đặt (chốt chặn sẵn có), không xóa ô nhập/dòng trạng thái |

---

## 9. Kiểm thử

Không có framework test, làm theo cách sẵn có của dự án:

1. **Cú pháp**: 3 file JS đã thay đổi đều pass `node --check`; `manifest.json` pass kiểm tra `JSON.parse`.
2. **Kiểm thử offline thuật toán chia lô** (chỉ tái hiện thuật toán thuần túy, 14 trường hợp đều đạt): chia hết (30/5→6 lô đều nhau), chia không hết (30/7→7/7/7/9), lô cuối gánh phần dư, chặn `endLayer`, `endLayer` nhỏ hơn tổng số, chia hết không gộp nhầm (14/7→7/7), một tầng, 0 tầng, `batchSize=1`, `batchSize ≥ tổng số`.

**Đề xuất kiểm thử thủ công**:
- Một chat có ≥10 tầng AI, đặt mỗi lô 3 tầng, thử lại 1 lần → bấm bắt đầu → xác nhận → quan sát log F12 từng lô, `round` trên bảng điều khiển tăng dần, trạng thái thế giới liền mạch.
- Bấm "Dừng" giữa chừng, xác nhận kết thúc êm ả, các lô đã hoàn thành được giữ nguyên.
- Danh sách "Bộ nhớ đệm và lưu trữ Tavern" xuất hiện mục "tự động sao lưu trước khi điền lại".
- Chia không hết (ví dụ 10 tầng mỗi lô 3 → 3/3/4) xác nhận lô cuối chứa đúng tầng.

---

## 10. Hạn chế đã biết và hướng tiếp theo

- **Mỗi lô là một lần gọi API độc lập**: điền lại 30 tầng mỗi lô 5 tầng = 6 lượt gọi API, thời gian và chi phí tương đương 6 vòng suy diễn bình thường. Điền lại chat lớn cần dự trù thời gian.
- **Thất bại là dừng ngay**: một lô hết số lần thử vẫn thất bại thì dừng toàn bộ (thay vì bỏ qua và tiếp tục), tránh việc thế giới tiếp tục cộng dồn trên trạng thái bị đứt gãy. Các lô đã hoàn thành đã được ghi đĩa, sau khi sửa xong có thể giảm tầng kết thúc để điền lại tiếp gần điểm đứt (hướng tiếp theo có thể làm "điền lại tiếp từ điểm dừng").
- Hướng tiếp theo có thể cân nhắc: chế độ cộng dồn lịch sử khi đưa vào (tùy chọn), điền lại tiếp từ điểm dừng, thanh tiến trình điền lại trên giao diện, độ trễ có thể cấu hình giữa các lô (tránh bị API giới hạn tần suất).
