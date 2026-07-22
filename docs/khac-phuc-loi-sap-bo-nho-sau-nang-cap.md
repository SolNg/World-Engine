# Khắc Phục Lỗi Tràn Bộ Nhớ Sau Nâng Cấp / Điền Lại Hàng Loạt Làm Bẩn Bản Lưu Khi Đổi Chat (v2.3.3)

## Bối cảnh

Người dùng phản ánh "sau khi nâng cấp phiên bản, Tavern bị nổ bộ nhớ, trình duyệt bị sập". Qua quá trình quét rò rỉ song song trên 11 module + đối chiếu chéo độc lập trên 6 nghi phạm hàng đầu, đã xác định được **3 nguyên nhân gốc rễ, đều nằm trong chu kỳ v2.2.0** (được đưa vào cùng lúc với "Bộ nhớ đệm và lưu trữ Tavern (chatcache)" + "Điền lại hàng loạt (backfill)"), thuộc dạng "hồi quy phát sinh cùng tính năng mới", khớp cao với mốc thời gian người dùng phản ánh.

Ngoài ra: quá trình đối chiếu chéo đã bác bỏ 3 cáo buộc nghe có vẻ đáng sợ nhưng thực ra không thành lập (không thuộc phạm vi sửa của PR này) —
- 4 lệnh `eventSource.on` ở lối vào chính không bị tích lũy nhân đôi (cơ chế bảo vệ `__WORLD_ENGINE_LOADED__` không có đường reset + khi reload trang, các listener cũ bị hủy đồng bộ)
- `setInterval` 30s không sinh ra DOM mồ côi (`refresh()` thoát sớm khi bảng điều khiển đang ẩn)
- Bốn mảng (factions/worldTrends/events/winds) có giới hạn cứng (core.js pop ở 15/4/16/12), không tăng trưởng vô hạn

## Ba nguyên nhân gốc rễ và cách sửa

### 🔴 Nguyên nhân gốc rễ số 2 (Nghiêm trọng · Phá hỏng bản lưu): dữ liệu bị lẫn giữa các chat khi đổi chat trong lúc điền lại hàng loạt

`backfillEvolve` ngay từ đầu chụp một lần `chat = ctx.chat` (tham chiếu đến mảng tin nhắn của chat A), nhưng trong vòng lặp, mỗi lô `core.loadState()`/`saveStateWithLayer()`/`saveFingerprint()` đều dùng `getChatId()` được gọi **động**. Mỗi lô `await api.callApi` có khoảng trống tối đa 8 giây, nếu người dùng đổi sang chat B trong lúc đó, toàn bộ quá trình điền lại sẽ biến thành "đọc state của B + nhét văn bản hội thoại của A vào + ghi ngược bản lưu vào B" — mà lúc đầu đã `core.clearState()` xóa sạch A. Hậu quả gồm ba phần:

- **Bản lưu của A bị mất**: `clearState()`/`clearCheckpoint()` ở đầu quá trình đã xóa bản lưu của A, sau khi đổi chat thì không còn ghi lại vào A nữa.
- **B bị nhiễm bẩn**: nội dung hội thoại của A bị suy diễn thành trạng thái thế giới rồi ghi vào B.
- **Suy diễn tự động của B bị vô hiệu hóa âm thầm**: `_backfillRunning=true` khiến `isRunning()` luôn trả về true, suy diễn tự động do `GENERATION_ENDED` của B kích hoạt bị bỏ qua liên tục cho đến khi điền lại kết thúc.

Lối vào chính `onChatLoaded` trước đây không gọi `evolution.abort()`, không có phanh tự động — quá trình điền lại sẽ chạy đến hết hoặc đến khi một lô nào đó thất bại.

**Cách sửa** (trong [world-engine-evolution.js](../world-engine-evolution.js) hàm `backfillEvolve` + [world-engine.js](../world-engine.js) hàm `onChatLoaded`):
1. Khi `backfillEvolve` chụp `chat`, đồng thời ghi lại `const startChatId = core.getChatId()`.
2. Ở đầu vòng lặp theo lô và đầu mỗi lần thử lại, đều thêm `if (core.getChatId() !== startChatId) return { reason: 'chat-changed' }` — hễ đổi chat là lập tức trả về, không ghi tiếp vào B nữa. Hai điểm kiểm tra này bao phủ cả "khoảng nghỉ giữa các lô" lẫn "ranh giới chờ API".
3. Đầu `onChatLoaded` thêm `if (evolution.isRunning()) evolution.abort()` — đổi chat là lập tức hủy request API đang chạy dở (không cần đợi đến ranh giới lô tiếp theo), tái dùng luôn hàm `abort()` sẵn có, không sửa nó.

> Ghi chú: việc A bị `clearState` ngay đầu quá trình điền lại là thiết kế vốn có của "xóa sạch làm lại"; nếu đổi chat khiến quá trình bị hủy giữa chừng thì bản lưu của A đã mất một phần là hậu quả đã biết trước (người dùng có thể khôi phục từ ảnh chụp nhanh "tự động sao lưu trước khi điền lại"). Trọng tâm của bản sửa này là **ngăn việc làm bẩn B** và dừng lại ngay lập tức, không nhằm khôi phục lại A đã bị xóa.

### 🟠 Nguyên nhân gốc rễ số 1 (Cao · Mỗi lần suy diễn đều ghi toàn bộ chat): live không khử trùng lặp nội dung

`rev = ... + 1` trong `pushLiveNow` luôn tăng thêm 1 vô điều kiện, không bao giờ so sánh `packChat` mới với `ns.live.data` xem có giống nhau không. Chỉ cần trong máy có bất kỳ slot nào có giá trị thì `packChat` chắc chắn khác rỗng → chắc chắn trả về rev khác null → `runTick` chắc chắn gọi `writeNamespace` → `saveMetadataDebounced` ghi toàn bộ file chat. Điền lại hàng loạt N lô = N lần ghi toàn bộ chat + rev tăng vọt đơn điệu (ba lệnh setItem state+checkpoint+fingerprint trong cùng một lô bị gộp lại thành 1 tick nhờ debounce, mức độ chi tiết là "mỗi lô/mỗi bước").

**Cách sửa** (trong [world-engine-chatcache.js](../world-engine-chatcache.js)):
- Thêm hàm `sameData(a,b)`: so sánh chuỗi từng slot bằng `===` (giá trị slot vốn đã là chuỗi, không cần `JSON.stringify` tuần tự hóa hai chiều).
- `pushLiveNow(nsArg, force)` thêm tham số `force`: khi `!force && ns.live.chatId===id && sameData(ns.live.data, data)` thì trả về `ns.live.rev` hiện tại, không +1, không cập nhật live, không ghi đĩa.
- `runTick` ghi nhớ `prevRev`, chỉ khi `r !== prevRev` mới đặt `changed=true` — nội dung không đổi thì không kích hoạt `writeNamespace`.
- `restoreSnapshot` gọi rõ ràng `pushLiveNow(ns, true)` để đẩy cưỡng bức (sau khi khôi phục, dù nội dung giống nhau vẫn phải cho live trỏ về trạng thái vừa khôi phục, tránh lần `onChatLoaded` tiếp theo bị giá trị cũ trên cloud ghi đè).

### 🟠 Nguyên nhân gốc rễ số 3 (Một phần · Bão CPU/IO): chat_metadata tuần tự hóa trạng thái 24 lần

`ns` thường trực gồm live (1) + tự động sao lưu (3) + thủ công (20) ≈ **24 bản sao trạng thái đầy đủ** nhét trong `chat_metadata.world_engine`. Mỗi tick `writeNamespace` đem toàn bộ 24× ns đi `JSON.stringify` **chỉ để lấy `.length` phục vụ cảnh báo mềm**, chuỗi kết quả bị bỏ đi ngay sau đó; `addAutoBackupIfAdvanced` lại `JSON.stringify` để so sánh thêm hai lần nữa. Bản thân việc này không đến mức làm trình duyệt OOM (chỉ cỡ MB, ngưỡng SIZE_WARN_BYTES=1MB cho thấy tác giả cũng dự tính ở mức MB), nhưng cộng dồn với tần suất kích hoạt cao của nguyên nhân gốc rễ số 1 thì trở thành nguồn chính gây nghẽn CPU + bão I/O file chat, biểu hiện lâu dài là "đơ máy, tưởng như nổ bộ nhớ".

**Cách sửa** (đều ở [world-engine-chatcache.js](../world-engine-chatcache.js), sửa tối thiểu):
- Thêm hàm `nsSize(ns)`: cộng dồn trực tiếp độ dài chuỗi của từng slot `live.data`/`snapshot.data` (data vốn đã là chuỗi) + chi phí metadata cố định, thay cho `JSON.stringify(ns).length`.
- `addAutoBackupIfAdvanced` dùng `sameData(newestAuto.data, packed)` thay cho việc so sánh bằng `JSON.stringify` hai lần.
- Cuối `ensureNamespace` gọi thêm một lần `pruneSnapshots(ns)`: sau khi nâng cấp, số lượng bản lưu cũ có thể vượt giới hạn hiện tại, mở chat lên là thu gọn ngay lập tức (bịt lỗ hổng chuyển tiếp "prune chỉ được kích hoạt ở lần addSnapshot tiếp theo").
- Đầu `onChatLoaded` gọi `clearTimeout(_tickTimer)`: bỏ pending tick còn sót lại từ chat trước, tránh nó lỡ ghi đĩa/sinh bản sao lưu tự động trong ngữ cảnh của B (cùng gốc với nguyên nhân số 1).

### Bổ sung (cùng nhóm triệu chứng, rủi ro thấp): đưa việc reset trạng thái của evolve vào finally

Trong try/catch của `evolve`, các lệnh reset `_abortController=null; _isRunning=false;` được đặt riêng ở cuối try và cuối catch. Nếu câu lệnh khôi phục trong catch — `Object.assign(state, backup); core.saveState(state)` — bị ném lỗi trong lúc bộ nhớ đang căng (khả năng ghi IDB thất bại cao), nó sẽ thoát khỏi catch mà không chạy đến lệnh reset → `_isRunning` mãi mãi là true → mọi `evolve` sau đó đều bị chốt chặn `isRunning()` trả về false một cách âm thầm, biểu hiện là "suy diễn không bao giờ hoạt động nữa" (trừ khi tải lại trang).

**Cách sửa**: chuyển các lệnh reset vào khối `finally`, câu lệnh khôi phục dùng try/catch lồng bên trong để nuốt lỗi. Chỉ điều chỉnh vị trí reset và cách chặn lỗi, không đụng đến thuật toán suy diễn. Thuộc nhóm sửa cùng gốc với "suy diễn thỉnh thoảng bị treo dưới áp lực bộ nhớ sau nâng cấp".

## Các file bị ảnh hưởng

| File | Thay đổi |
|------|------|
| `world-engine-evolution.js` | Chốt chặn đổi chat khi backfill + đưa reset của evolve vào finally |
| `world-engine.js` | onChatLoaded hủy request khi đổi chat |
| `world-engine-chatcache.js` | Công cụ sameData/nsSize + khử trùng lặp pushLiveNow + dung lượng/so sánh/prune/dọn tick |
| `manifest.json` | Phiên bản 2.3.1 → 2.3.3, description bổ sung mô tả sửa lỗi ổn định |

**Không thay đổi** (nguyên tắc "bình hoa" — chỉ nhìn không động + các cáo buộc đã bị bác bỏ): `inject.js` / cấu trúc dữ liệu suy diễn trong `core.js` / logic mirror trong `store.js` / các hàm hiện có trong `api.js` / `rules-loader.js` / `ledger.js` / `worldbook.js`; cũng như 4 listener `eventSource.on`, interval 30s, giới hạn trên của bốn mảng (đã bị đối chiếu chéo bác bỏ, không phải nguyên nhân gốc rễ).

## Giải thích số phiên bản

PR này dùng **2.3.3**, nối tiếp [PR#4](https://github.com/DlSNlGHT/World/pull/4) "hiển thị lý do cụ thể khi suy diễn thất bại" đã được merge vào `cloud` (cloud hiện đã ở 2.3.2). PR này được tách ra từ `cloud` sau PR#4 và rebase lên trên đó, phiên bản 2.3.2 → 2.3.3. Khi rebase, xung đột duy nhất là số phiên bản trong `manifest.json` (PR#4 đặt 2.3.2, PR này đặt 2.3.3), giữ lại 2.3.3; các file còn lại đều tự động merge, không có xung đột thực chất.

## Kịch bản tái hiện lỗi (đề xuất người rà soát tự chạy thử)

```
1. Chuẩn bị một chat dài có 100+ tầng AI (bản lưu cũ từ trước khi nâng cấp)
2. Nâng cấp lên v2.3.0+, tải lại trang
3. Mở DevTools Console, lọc theo [World Engine]
4. Trong chat đó chạy "Điền lại hàng loạt" với batchSize=1, endLayer=0 (suy diễn toàn bộ)
5. Trong lúc đang chạy lô thứ 3 thì đổi sang một chat sạch khác là B
6. Đợi vài giây
Kỳ vọng (sau khi sửa):
  - Console lập tức in ra "🛑 Phát hiện đổi chat, hủy điền lại hàng loạt (bắt đầu từ A → giờ đang ở B)"
  - Trả về reason 'chat-changed'
  - Sổ tay thế giới/trạng thái của B không chứa nội dung hội thoại của A (không bị nhiễm bẩn)
  - Suy diễn tự động của B trở lại bình thường (_backfillRunning đã được reset)
So sánh (trước khi sửa):
  - Quá trình điền lại vẫn chạy tiếp đến hết, bản lưu của A bị xóa sạch, B bị bơm nội dung của A, suy diễn tự động của B bị bỏ qua liên tục
```

Kiểm chứng nguyên nhân gốc rễ số 1/3: chạy evolve thủ công liên tiếp nhiều bước, nếu state không có thay đổi thực chất thì `saveMetadataDebounced` không nên bị kích hoạt thường xuyên nữa (có thể tạm thời cắm điểm đo tại nơi gọi chatcache để thống kê).

## Nhật ký kiểm chứng

- Cú pháp: `world-engine.js` / `world-engine-evolution.js` / `world-engine-chatcache.js` đều pass `node --check`; `manifest.json` pass `JSON.parse`.
- Kiểm thử logic offline (dùng sandbox vm nạp module thật + mock dependency, script kiểm thử không đưa vào repo, chạy xong là xóa):
  - **Khử trùng lặp chatcache 16/16 đạt**: lần đẩy đầu tiên ghi đĩa + rev≥1; nội dung không đổi mà đẩy tiếp → không +1, không gọi updateChatMetadata (khử trùng lặp của nguyên nhân số 1 có hiệu lực); nội dung thay đổi → +1 và ghi đĩa; force=true thì dù nội dung giống nhau vẫn ép đẩy; máy trống hoàn toàn vẫn giữ chốt chặn trả về false, không ghi đĩa; nội dung giống nhau nhưng khác chatId vẫn ghi đĩa (không khử trùng lặp nhầm).
  - **Chốt chặn đổi chat khi backfill 5/5 đạt**: mock `getChatId` thay đổi ngay từ lần gọi thứ 2 → backfillEvolve lập tức trả về `reason:'chat-changed'`, không gọi evolve, không saveState, `isRunning()` được reset về false (chốt chặn của nguyên nhân số 2 có hiệu lực).
  - **Reset evolve trong finally 4/4 đạt**: mock `api.callApi` ném lỗi để vào catch, `core.saveState` ném lỗi tiếp (mô phỏng ghi IDB thất bại dưới áp lực bộ nhớ) → evolve vẫn trả về false và `isRunning()` được finally reset về false; lần evolve thứ hai vào lại bình thường, không bị chốt chặn kẹt cứng (mục #11 có hiệu lực).
- Thử nghiệm thực tế trên Tavern local: copy vào `E:\SillyTavern-1.15.0\SillyTavern-1.15.0\data\default-user\extensions\world-engine` + tải lại cứng, kiểm chứng theo kịch bản tái hiện lỗi ở trên xem B có bị nhiễm bẩn không, việc hủy suy diễn có bình thường không (đợi thử nghiệm xong sẽ bổ sung kết quả).
