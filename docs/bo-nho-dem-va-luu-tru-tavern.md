# PR: Bộ Nhớ Đệm Và Lưu Trữ Tavern (Đồng Bộ Đa Thiết Bị + Bản Lưu Chống Mất Dữ Liệu)

> Bổ sung cho 「🌍 World Engine」 khả năng "lưu bản lưu tách riêng theo từng chat ngay vào trong chính chat của Tavern":
> dữ liệu được lưu cùng file chat lên server của SillyTavern, nhờ đó **đồng bộ được qua nhiều thiết bị**, đồng thời cung cấp **bản lưu có đặt tên / tự động sao lưu xoay vòng** để chống mất dữ liệu.
>
> Phiên bản: `2.1.0` → `2.2.0`

---

## 1. Bối cảnh và động lực

Hiện trạng: toàn bộ bản lưu của extension này đi qua [`world-engine-store.js`](../world-engine-store.js), lưu vào **IndexedDB** (không dùng được thì lùi về localStorage).
IndexedDB là bộ nhớ cục bộ **tách riêng theo từng "thiết bị + trình duyệt"** —

- Đổi sang máy khác / trình duyệt khác / xóa dữ liệu trình duyệt là trạng thái thế giới biến mất, dù bản thân chat vẫn còn trên server của Tavern.
- Nhu cầu thực sự của người dùng: "**bộ nhớ đệm đi kèm với chat tương ứng. Dù có đổi thiết bị, miễn còn trong Tavern thì bộ nhớ đệm vẫn còn.**"

Trong khi đó, bản thân SillyTavern đã có sẵn một "hộp chứa" tự nhiên "đi theo chat, lưu trên server, đồng bộ qua nhiều thiết bị": **`chat_metadata`**.
Nó được tuần tự hóa vào phần đầu file chat, được lưu cùng chat lên server Tavern, rồi được nạp lại cùng chat trên bất kỳ thiết bị nào.

PR này chính là việc **mirror** bản lưu của "extension này, chat hiện tại" vào `chat_metadata`, nhờ đó đạt được đồng bộ đa thiết bị và chống mất dữ liệu.

---

## 2. Xác nhận cơ chế của SillyTavern (vì sao cách này đồng bộ được đa thiết bị)

Đã đọc mã nguồn nhánh `release` của SillyTavern để xác nhận (`public/script.js` / `public/scripts/st-context.js` / `public/scripts/extensions.js`):

| Thời điểm | Hành vi | Vị trí mã nguồn |
|------|------|----------|
| Mở chat | `chat_metadata = chatHeader.chat_metadata` (nạp từ **phần đầu file** chat) xảy ra **trước** khi sự kiện `CHAT_LOADED` được kích hoạt | `script.js`, nơi nạp chat (`chat_metadata = chatHeader?.chat_metadata ?? {}` → ngay sau đó `eventSource.emit(CHAT_LOADED, ...)`) |
| Lưu chat | `saveChat` ghi `chat_metadata` vào **phần đầu file** chat `{ chat_metadata: metadata, ... }`, POST lên server | `script.js`, nơi `saveChat()` dựng `chatHeader` |
| API đọc/ghi | `getContext()` cung cấp `chatMetadata`, `updateChatMetadata(values, reset)`, `saveMetadataDebounced()`, `saveMetadata()`, `saveChat` | `st-context.js` |
| Debounce khi lưu | `saveMetadataDebounced()` có debounce và **an toàn với chat nhóm** (đổi group/character sẽ tự động bỏ qua việc lưu) | `extensions.js`, hàm `saveMetadataDebounced()` |

Hai kết luận then chốt:

1. **Khi `CHAT_LOADED` kích hoạt thì `chat_metadata` đã sẵn sàng** → `onChatLoaded` sẵn có của extension này có thể đọc trực tiếp bản lưu vừa được đồng bộ về.
2. **`saveChat` ghi `chat_metadata` vào file chat (phía server)** → đây chính là phương tiện mang lại khả năng "đa thiết bị".

> ⚠️ `chat_metadata` bị **thay thế toàn bộ** (gán lại) mỗi khi đổi chat, nếu giữ tham chiếu cũ sẽ ghi nhầm sang chat khác.
> Vì vậy module này **luôn lấy tham chiếu mới nhất qua `SillyTavern.getContext()`** mỗi lần dùng.

---

## 3. Tổng quan giải pháp

Đặt hai thứ dưới namespace `chat_metadata.world_engine`, cả hai đều đi theo chat qua các thiết bị:

1. **Đồng bộ thời gian thực (`live`)** — công tắc `syncToChat`, **mặc định tắt**.
   Khi bật, trạng thái làm việc liên tục được mirror vào chat; đổi thiết bị mở lại đúng chat đó là tiếp tục được ngay tiến độ.
   Xung đột được giải quyết theo nguyên tắc "**bản sửa mới hơn thắng**" (bộ đếm Lamport, xem §6).

2. **Bản lưu trong chat (`snapshots`)** — chống mất dữ liệu.
   - **Bản lưu thủ công có đặt tên**: bất cứ lúc nào cũng có thể bấm "Tạo bản lưu có đặt tên mới" để lưu.
   - **Tự động sao lưu xoay vòng**: công tắc `autoBackup`, **mặc định tắt**; khi bật thì mỗi lần vòng suy diễn tiến lên sẽ tự động lưu một bản, giữ lại 3 bản gần nhất.
   - Mỗi bản lưu hỗ trợ: **khôi phục / đổi tên / xuất (JSON) / xóa**; và hỗ trợ **nhập** file bản lưu đã xuất ra từ bên ngoài.

> Cả hai công tắc đều **mặc định tắt**: khi chưa bật thì **hoàn toàn không ghi vào file chat**, không ảnh hưởng gì đến hành vi của người dùng hiện tại (bản lưu có đặt tên là thao tác bấm rõ ràng, không tính là ghi tự động).

---

## 4. Danh sách file thay đổi

| File | Thay đổi | Mức độ số dòng |
|------|----------|----------|
| `world-engine-chatcache.js` | **Mới**: engine bộ nhớ đệm và lưu trữ (đồng bộ + snapshot) | File mới |
| `world-engine-store.js` | Thêm "khe đồng bộ" `setSyncSink` dùng chung, gọi callback sau `setItem/removeItem` | +khoảng 15 dòng |
| `world-engine.js` | `MODULES` đăng ký module mới; gọi `chatcache.init()` sau `hydrate`; đầu `onChatLoaded` gọi `chatcache.onChatLoaded()` | +khoảng 10 dòng |
| `world-engine-api.js` | Cài đặt mặc định thêm `syncToChat:false`, `autoBackup:false` | +khoảng 4 dòng |
| `world-engine-ui.js` | Trang cài đặt thêm khu vực "Bộ nhớ đệm và lưu trữ Tavern": hai công tắc + danh sách bản lưu + thêm/nhập/khôi phục/đổi tên/xuất/xóa | +khoảng 110 dòng |
| `style.css` | Kiểu dáng danh sách bản lưu (tái dùng biến CSS và class nút sẵn có) | +khoảng 35 dòng |
| `manifest.json` | Phiên bản `2.1.0` → `2.2.0`, bổ sung mô tả | 2 dòng |

> **Không thay đổi** `world-engine-core.js` / `world-engine-worldbook.js`: toàn bộ logic bộ nhớ đệm được gói gọn trong module mới,
> hoạt động qua khe đồng bộ `STORE` sẵn có và các hàm `core` đã export, giảm tối đa ảnh hưởng lên logic lưu trữ cốt lõi để dễ rà soát.

---

## 5. Cấu trúc dữ liệu

`chat_metadata.world_engine`:

```jsonc
{
  "v": 1,                      // Phiên bản schema
  "live": {                    // Khe đồng bộ thời gian thực (chỉ dùng khi bật syncToChat; nếu không thì là null)
    "rev": 12,                 // Số bản sửa Lamport
    "updatedAt": 1700000000000,// Dùng để gỡ lỗi
    "chatId": "xxx",
    "data": { /* slots */ }
  },
  "snapshots": [               // Danh sách bản lưu (mới → cũ)
    {
      "id": "s...",
      "name": "Đêm trước quyết chiến",
      "auto": false,           // true = tự động sao lưu, false = thủ công/nhập
      "round": 23,
      "createdAt": 1700000000000,
      "chatId": "xxx",
      "data": { /* slots */ }
    }
  ]
}
```

**slots** = 5 khóa "tách riêng theo từng chat" của extension này, **lưu nguyên dạng chuỗi**, lưu theo tên slot (không lưu key đầy đủ, để tiện khi chat đổi tên/nhân bản thì vẫn khớp lại đúng chatId hiện tại):

| Tên slot | Khóa store tương ứng | Nguồn gốc |
|------|---------------|------|
| `state` | `world_engine_<id>` | Trạng thái chính của core |
| `checkpoint` | `world_engine_<id>_checkpoint` | Điểm lưu của core |
| `fingerprint` | `world_engine_<id>_fingerprint` | Vân tay của core |
| `anchorLayer` | `world_engine_<id>_anchorLayer` | Điểm neo phiên bản cũ của core |
| `worldbook` | `world_engine_worldbook_selection_<id>` | Lựa chọn sổ tay thế giới dùng để suy diễn nền |

Giảm dung lượng: khi đóng gói `state`/`checkpoint`, loại bỏ các trường thuần gỡ lỗi mà `ensureArrays` có thể dựng lại được (`lastInjection`, `lastEvolveResult`), giảm kích thước file chat.

> **Tuyệt đối không ghi** khóa cài đặt toàn cục `world_engine_settings` (bên trong có **API Key**) — xem §7.

---

## 6. Giải quyết xung đột: số bản sửa Lamport ("mới hơn thắng")

Việc "ai cập nhật sau" giữa các thiết bị không thể dựa vào timestamp (đồng hồ thiết bị có thể lệch nhau). Dùng **bộ đếm Lamport**:

- Mỗi thiết bị lưu cục bộ `world_engine_<id>_syncrev` (chỉ ở máy đó, không đưa vào chat, không kích hoạt đồng bộ).
- Khi đẩy live: `rev mới = max(rev cục bộ, rev hiện có trong chat) + 1`.
- Khi mở chat:
  - `rev` trong chat > cục bộ → **dùng bản trên cloud** (cài vào store, rev cục bộ = rev trên cloud).
  - `rev` trong chat < cục bộ → **bản cục bộ mới hơn**, đẩy lên cho hội tụ.
  - Bằng nhau → đã đồng bộ.

Hiệu quả (đã kiểm thử, xem kịch bản 1 ở §10): A suy diễn đến vòng 10 → B mở lên tiếp tục đến vòng 10 → B suy diễn tiếp đến vòng 11 → A mở lên tiếp tục đến vòng 11, hội tụ đơn điệu.

**Chốt chặn an toàn dữ liệu**: khi máy cục bộ **không có bất kỳ bản lưu nào** (đúng là "thiết bị bị mất dữ liệu"), thì **tuyệt đối không** đẩy/ghi đè nội dung rỗng lên live trên cloud —
nếu không, một thiết bị trống mở đồng bộ trước sẽ xóa sạch bản lưu thật ở nơi khác (cài đặt chính xác sẽ xóa cả slot). Đã kiểm thử (kịch bản 2).

---

## 7. Bảo mật và quyền riêng tư

- **Chỉ mirror 5 khóa bản lưu "tách riêng theo chat"**, **tuyệt đối không** ghi `world_engine_settings` vào file chat.
  Cài đặt đó chứa **API URL / API Key**; file chat có thể bị chia sẻ, xuất ra ngoài, để lộ khóa API sẽ hậu quả nghiêm trọng. Đây là ranh giới được thiết kế có chủ đích.
- Khi ghi `chat_metadata` chỉ động vào đúng một khóa `world_engine` (`updateChatMetadata` merge nông ở cấp cao nhất),
  giữ nguyên `integrity` của ST, ghi chú tác giả và dữ liệu do các extension khác ghi vào.

---

## 8. Trường hợp biên

| Trường hợp | Xử lý |
|------|------|
| Không có chat / `chatId === 'default'` | Bỏ qua toàn bộ việc đọc/ghi chat_metadata (chốt chặn `chatUsable()`) |
| Tavern phiên bản cũ không có `updateChatMetadata`/`saveMetadataDebounced` | Lùi dần về `saveMetadata`/`saveChat`; không có cái nào thì tính năng tự giảm cấp một cách nhẹ nhàng (không bị sập) |
| Tranh chấp khi đổi chat | Luôn dùng `getContext()` mới nhất; khi đẩy dùng `ctx.chatId`; bản thân `saveMetadataDebounced` khi đổi chat sẽ tự bỏ qua việc lưu |
| Vòng phản hồi khi khôi phục bản lưu | Trong lúc cài đặt sẽ tạm ngưng khe đồng bộ `_suspend`, tránh việc "ghi ngược vào store → lại bị coi là ghi mới rồi đẩy ngược lại chat" |
| Tầng bị lệch sau khi khôi phục bản lưu cũ | Chuẩn hóa `chatLayer`/`fingerprint` về đúng số tầng hội thoại hiện tại (giống logic "nhập dữ liệu" sẵn có), tránh bị hiểu nhầm là reroll |
| Khôi phục nhầm | Trước khi khôi phục sẽ tự động tạo một bản "tự động sao lưu trước khi khôi phục", có thể khôi phục lại được |
| Dung lượng file chat | Tự động sao lưu xoay vòng giữ lại 3 bản, thủ công giữ 20 bản; namespace vượt khoảng 1MB thì `console.warn` cảnh báo mềm |
| Chat nhóm | `chatId` là chat_id của nhóm, `saveMetadataDebounced` an toàn với chat nhóm; nên dùng được (đề xuất tập trung kiểm thử hồi quy) |
| Trang tự làm mới sau 30s | Trang cài đặt không bị dọn sạch khi tự làm mới (logic sẵn có `auto && view==='settings'` return ngay) |

---

## 9. Người dùng sử dụng như thế nào

Trang cài đặt thêm khu vực mới **"Bộ nhớ đệm và lưu trữ Tavern"**:

- ☐ **Đồng bộ thời gian thực đa thiết bị (lưu vào chat hiện tại)** — khi bật, trạng thái thế giới của chat này liên tục được ghi vào file chat và đồng bộ qua nhiều thiết bị.
- ☐ **Tự động sao lưu xoay vòng (mỗi khi vòng suy diễn tiến lên thì lưu một bản, giữ lại 3 bản gần nhất)**
- Dòng trạng thái: `Đồng bộ thời gian thực đã bật · Bản sửa cục bộ 12 / Cloud 12 · Tổng cộng 5 bản lưu`
- Nút: **Tạo bản lưu có đặt tên mới**, **Nhập bản lưu**
- Danh sách: mỗi bản lưu hiển thị `[Thủ công/Tự động] Tên · Vòng thứ N · Thời gian`, thao tác trong dòng gồm **Khôi phục / Đổi tên / Xuất / Xóa**

---

## 10. Kiểm thử

Đã viết kiểm thử logic offline (dùng sandbox `vm` nạp **file thật** `world-engine-chatcache.js`, mock `SillyTavern`/`store`/`core`,
hai "thiết bị" dùng chung một object `chat_metadata` để mô phỏng đồng bộ qua server), **18/18 đều đạt**:

1. **Kịch bản 1, đồng bộ thời gian thực bản mới hơn thắng**: A↔B thay nhau tiến lên, hội tụ đơn điệu; live đã loại bỏ `lastInjection`.
2. **Kịch bản 2, chốt chặn nội dung rỗng**: thiết bị trống mở đồng bộ không xóa sạch bản lưu thật trên cloud, ngược lại còn được khôi phục từ cloud.
3. **Kịch bản 3, CRUD bản lưu**: tạo/liệt kê/đổi tên/khôi phục/xuất/nhập/xóa đều đúng; bản sao lưu trước khi khôi phục được tạo ra.
4. **Kịch bản 4, tự động sao lưu xoay vòng**: sau 6 vòng suy diễn thì tự động sao lưu chỉ còn giữ 3 bản gần nhất, bản mới nhất là vòng thứ 6.

Ngoài ra: 5 file JS đã thay đổi đều pass kiểm tra cú pháp `node --check`.

> Script kiểm thử chỉ dùng để xác nhận offline, không đưa vào repo (bản thân dự án không có framework test). Nếu cần giữ lại có thể đặt vào thư mục `tests/`.

**Đề xuất kiểm thử thủ công**:
- Chat một nhân vật: bật đồng bộ → suy diễn vài vòng → đổi trình duyệt/cửa sổ ẩn danh mở đúng chat đó, xác nhận tiếp tục được.
- Bản lưu có đặt tên → suy diễn → khôi phục, xác nhận bảng điều khiển và phần bơm vào đều quay về đúng điểm lưu.
- Kịch bản chat nhóm; giảm cấp nhẹ nhàng trên Tavern phiên bản cũ (không có `updateChatMetadata`).

---

## 11. Hạn chế đã biết và hướng tiếp theo

- **Người ghi sau cùng thắng**: hai thiết bị **cùng lúc** chỉnh sửa một chat rồi lưu, người lưu sau sẽ ghi đè người lưu trước (bản thân mô hình file chat của SillyTavern là vậy). World Engine dùng theo kiểu một người dùng thay phiên, ảnh hưởng rất nhỏ.
- **Ngoại tuyến**: trong lúc ngoại tuyến, việc lưu lên server của `saveMetadataDebounced` có thể thất bại, sẽ được ghi đĩa vào lần lưu chat kế tiếp (cố gắng hết sức).
- Hướng tiếp theo có thể cân nhắc: số bản tự động sao lưu / chiến lược kích hoạt có thể cấu hình; nút "buộc kéo về từ Tavern" ngay trên bảng điều khiển; giới hạn cứng cho dung lượng namespace.

---

## 12. Gợi ý rà soát (nên tập trung xem)

1. [`world-engine-chatcache.js`](../world-engine-chatcache.js): logic cốt lõi. Tập trung xem chốt chặn nội dung rỗng trong `pushLiveNow`, các nhánh xung đột trong `onChatLoaded`, việc `restoreSnapshot` dùng **cùng một ns** để ghi đĩa một lần (tránh hai lần `writeNamespace` ghi đè lẫn nhau).
2. [`world-engine-store.js`](../world-engine-store.js): `setSyncSink` có đủ tổng quát không, việc `hydrate` nạp mirror không đi qua khe đồng bộ (sẽ không bị bật ngược lại).
3. [`world-engine.js`](../world-engine.js): **thứ tự thời gian** của việc khôi phục ở đầu `onChatLoaded` (phải xảy ra trước khi đọc state).
4. Ranh giới quyền riêng tư: xác nhận **không có** đường nào ghi `world_engine_settings` vào `chat_metadata`.
