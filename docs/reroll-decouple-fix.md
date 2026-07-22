# Tách Rời Việc Bơm Nội Dung Và Suy Diễn Khi Reroll (v2.3.18)

Tài liệu này ghi lại nguyên nhân gốc rễ và cách sửa của hai lỗi dây chuyền đã được người dùng kiểm chứng thực tế và xác nhận vào ngày 2026-06-29.

## Hiện tượng (người dùng kiểm chứng thực tế)

Sandbox Naruto (syncToChat / auto / everyX=1), vòng 5 → mở tầng mới thứ 6 → tự động suy diễn vòng 6 → swipe reroll tầng 6:

1. **Triệu chứng A**: log bơm nội dung ghi `số tầng hội thoại 18 >= 18, bơm trạng thái hiện tại (vòng 6)` — tức là bơm trạng thái hiện tại của vòng 6, thay vì điểm lưu của vòng 5.
2. **Triệu chứng B**: log suy diễn ghi `✅ Suy diễn hoàn tất (reroll/redo), vòng không đổi: vòng 5` — vòng bị dừng ở 5 thay vì 6.

## Nguyên nhân gốc rễ

| Triệu chứng | Nguyên nhân gốc rễ | Vị trí mã nguồn |
|---|---|---|
| **B** | Khi `isNew=false`, phần đầu vào của evolve thực hiện `Object.assign(state,cp)` một cách không phân biệt, đưa state về đúng điểm lưu (vòng 5) → suy diễn → round=5. "Reroll (suy diễn lại cùng tầng, vòng hiện tại không đổi)" và "redo (chủ động khôi phục về điểm lưu)" bị gộp chung vào cùng một luồng xử lý. | evolution.js:749-774 |
| **A** | Cổng chặn `_pendingReroll` phụ thuộc vào thời điểm sự kiện swipe của Tavern, dễ bị `GENERATION_ENDED` xóa về 0 sớm / va chạm cửa sổ thời gian với plugin sinh nội dung khác → khi bơm cho reroll thì cổng chặn đã mở → rơi vào nhánh dự phòng `>=` và bơm trạng thái hiện tại. | world-engine.js:207-222 |

## Cách sửa (2 file, 3 chỗ)

### 1. evolution.js: chia ba nhánh chọn nền tảng của evolve (dòng 744-774)

```diff
- if (isNew) { forward }
- else { 
-   // isNew=false → khôi phục từ điểm lưu một cách không phân biệt (reroll/redo bị gộp chung)
-   Object.assign(state, cp)
- }

+ const isForward = isNew          // mode='forward' hoặc vòng mới tự động
+ if (isForward) { vòng mới }
+ else if (mode === 'redo') {
+   // redo: khôi phục từ điểm lưu (giữ nguyên Object.assign khôi phục + chốt chặn không có cp)
+ } else {
+   // reroll tự động: không khôi phục từ điểm lưu, suy diễn tiếp ngay trên state hiện tại
+ }
```

### 2. evolution.js: chia ba nhánh khối xử lý vòng (dòng 968-978)

Bên trong `if(isForward)`, phần `round++ / saveCheckpoint(backup) / saveFingerprint` giữ nguyên; nhánh else phân biệt log giữa redo/reroll tự động, vòng không đổi.

### 3. world-engine.js: đổi tiêu chí bơm sang dùng type gốc của Tavern + xóa `_pendingReroll`

> ⚠️ **Tiêu chí theo số (v2.3.18) `state.chatLayer===chatLayer` đã bị chứng minh sai qua kiểm tra trên máy thật, v2.3.19 chuyển sang dùng type gốc của Tavern.**

**v2.3.18 (phương án trung gian đã bị bỏ)**: dùng tiêu chí `Number.isFinite(state.chatLayer) && state.chatLayer === chatLayer`.
Về lý thuyết: "khi vòng mới sinh lần đầu, evolve chưa chạy → state.chatLayer vẫn là của vòng trước → chatLayer > state.chatLayer nên không khớp".

**Kiểm tra trên máy thật chứng minh sai (2026-06-29, khi dùng chồng với plugin "Ăn Mòn Tâm Trí · Cơ Sở Dữ Liệu")**: sự kiện `GENERATION_STARTED` của Tavern được emit **trước khi** tầng của người dùng được push vào chat (đo thực tế: lúc GEN_STARTED, chatLen=23, phải đến sự kiện MSG_SENT tiếp theo mới thành chatLen=24). Vì vậy khi **gửi tin nhắn cho một vòng mới**, chatLayer vẫn == state.chatLayer của vòng trước → tiêu chí theo số hiểu nhầm thành reroll → bơm nhầm điểm lưu của vòng trước. Đây chính là hiện tượng người dùng gặp phải: "không hề reroll nhưng vẫn bị bơm trạng thái cũ".

**v2.3.19 (phương án cuối cùng)**: tiêu chí xác định reroll chuyển sang dùng **type gốc của Tavern** (không dựa vào suy đoán theo số tầng):

```js
// onGenerationStarted(type, _opts, dryRun)
if (dryRun) return;                                  // Bỏ qua các vòng khởi động trước/tính token, tránh "suy diễn xong lại bơm thêm lần nữa"
const isReroll = (type === 'swipe' || type === 'regenerate');
applyInjectionForCurrentRound({ isReroll });
// onMessageSwiped → applyInjectionForCurrentRound({ isReroll: true })
```

`applyInjectionForCurrentRound(opts)`: nếu `opts.isReroll` → bơm điểm lưu (không có cp thì không bơm); ngược lại đi theo nhánh dự phòng cũ `chatLayer < stateLayer` (xóa lùi các tầng cũ để bơm điểm lưu) / `>=` (bơm trạng thái hiện tại).

**Vì sao dùng type đáng tin cậy hơn**: `swipe` (mũi tên dưới tin nhắn, script.js:9986) / `regenerate` (nút tạo lại ở cuối, script.js:11304) là nhãn gốc của Tavern dùng để đánh dấu "viết lại chính văn của cùng một tầng", không phụ thuộc vào số tầng hay thứ tự sự kiện, dùng chung được cho mọi plugin khác. Các loại `normal`/`continue`/`impersonate`/`quiet` đều không phải reroll.

### Bảng các trường hợp biên (tiêu chí type của v2.3.19)

| # | Trường hợp | type | dryRun | isReroll | Bơm | Đúng? |
|---|---|---|---|---|---|---|
| 1 | Gửi tin nhắn cho vòng mới (chatLayer tạm thời == state.chatLayer) | normal | false | false | Trạng thái hiện tại | ✓ (sửa hồi quy của v2.3.18) |
| 2 | Reroll bằng mũi tên swipe | swipe | false | true | Điểm lưu | ✓ |
| 3 | Tạo lại từ nút cuối (đúng đường đi người dùng gặp thực tế) | regenerate | false | true | Điểm lưu | ✓ |
| 4 | Plugin database khởi động trước/tính token | * | true | — | Không động vào việc bơm | ✓ (không còn bị bơm lặp lại) |
| 5 | Viết tiếp (continue) | continue | false | false | Trạng thái hiện tại | ✓ |
| 6 | Xóa lùi về tầng cũ (chatLayer < state.chatLayer) | normal | false | false | Đi nhánh `<`, bơm điểm lưu | ✓ |
| 7 | Reroll thật nhưng không có cp | swipe/regenerate | false | true | unregister | ✓ |

## Phần không thay đổi

- Logic lưu trữ ở inject/core/store không thay đổi gì (nguyên tắc "bình hoa" — chỉ nhìn không động)
- Ngữ nghĩa forward/redo thủ công không đổi
- Thời điểm lưu checkpoint không đổi
- Kịch bản tầng đầu tiên không có cp không đổi
- Chế độ theo thời gian không bị ảnh hưởng
