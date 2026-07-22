# PR: Kích Hoạt Đèn Lam-Lục Sổ Tay Thế Giới (Thường Trực / Trúng Từ Khóa)

> Bổ sung cho phần "sổ tay thế giới dùng để suy diễn nền" của 「🌍 World Engine」 khả năng **bơm nội dung theo đúng kiểu kích hoạt của từng mục**:
> mục 🔵 thường trực (constant) luôn được bơm vào, mục 🟢 từ khóa (selective) chỉ được bơm khi hội thoại gần đây khớp với từ khóa của nó,
> theo đúng cấu hình gốc của sổ tay thế giới bên Tavern, và mỗi mục đều có thể ghi đè riêng ngay trong extension này.
>
> Phiên bản: `2.2.0` → `2.3.0`
> Nhánh đích: `cloud` (đã có "Bộ nhớ đệm và lưu trữ Tavern v2.2.0", PR này đắp chồng lên trên)
> Cấu trúc commit (3 commit):
> 1. `feat(worldbook)` Cơ chế kích hoạt đèn lam-lục + giao diện cài đặt
> 2. `fix(worldbook)` Sửa lỗi sập do `settings` chưa được định nghĩa trên trang cài đặt
> 3. `feat(worldbook)` Chi tiết khớp trong console + tài liệu

---

## 1. Bối cảnh và động lực

Hiện trạng: hàm `buildPromptSection()` trong [`world-engine-worldbook.js`](../world-engine-worldbook.js) bơm **nguyên trạng, không phân biệt** toàn bộ mục **đã được chọn và chưa bị tắt** vào prompt suy diễn.
Nó gọi `getSortedEntries()` của Tavern chỉ để **liệt kê** các mục, chỉ lấy mỗi trường `disabled`, còn toàn bộ cấu hình kích hoạt gốc như `constant` / `key` / `keysecondary` / `selectiveLogic` đều bị **bỏ qua**.

Hậu quả:

- Mục 🔵 thường trực và mục 🟢 từ khóa trong sổ tay thế giới bị đối xử như nhau — hoặc là bơm hết, hoặc phải tắt tay từng mục một.
- Mục từ khóa mất hết ý nghĩa "**chỉ xuất hiện khi liên quan**" — sổ tay thế giới lớn sẽ nhồi cả những thiết định không liên quan vào suy diễn, tốn ngữ cảnh và loãng trọng tâm.

PR này giúp sổ tay thế giới dùng để suy diễn **tôn trọng đúng kiểu kích hoạt của từng mục**, khớp với ngữ nghĩa "đèn lam / đèn lục" của sổ tay thế giới bên Tavern.

---

## 2. Nguyên tắc thiết kế: tách rời

Quyết định then chốt — **sao chép lại quy tắc khớp từ khóa của Tavern, nhưng "kích hoạt cái gì" do chính extension này quyết định**:

- **Theo đúng cấu hình Tavern**: kiểu kích hoạt (🔵 thường trực / 🟢 từ khóa), từ khóa (chính/phụ), tùy chọn khớp (phân biệt hoa thường, khớp nguyên từ) đều **đọc trực tiếp từ chính mục sổ tay thế giới bên Tavern**, không đặt ra một bộ quy tắc khác.
- **Tự kích hoạt, không nghe theo Tavern**: việc xét khớp chỉ quét **ngữ cảnh mà chính extension này đưa vào suy diễn** (hội thoại gần đây), **không** gọi `checkWorldInfo` của Tavern, **không** lắng nghe sự kiện `WORLD_INFO_ACTIVATED`.
  Lý do: người dùng có thể **tự tùy biến việc suy diễn đọc mục nào** trong extension này (các mục đã chọn = nhóm ứng viên); nếu chuyển sang nghe theo kết quả quét của Tavern thì "suy diễn đọc gì" và "Tavern quét được gì trong chính văn" sẽ bị **ghép chặt** vào nhau, trong khi ngữ cảnh và mục đích của hai bên vốn không giống nhau.
- **Có thể ghi đè độc lập**: mỗi mục đều có thể bị ép thành "thường trực / từ khóa / tắt" ngay trong extension này, không đụng đến sổ tay thế giới gốc bên Tavern.

> Mặc định **tắt** (`worldbookTrigger:false`): khi chưa bật, hành vi **giữ nguyên như trước** (toàn bộ mục đã chọn đều được bơm vào), người dùng hiện tại không bị ảnh hưởng gì.

---

## 3. Sao chép quy tắc khớp từ khóa của Tavern (`world-engine-worldbook.js`)

Cốt lõi của việc xét khớp là `activationOf(entry, scanText, mode)`, trả về `{ active, reason }`: `active` quyết định lượt này có bơm hay không, `reason` là lý do dễ đọc (dùng cho chi tiết trong console, xem §6). `isEntryActive()` là bản bọc boolean của nó (dùng để lọc và test). Quy trình xét khớp:

| Kiểu kích hoạt | Hành vi |
|----------|------|
| 🔵 Thường trực (`constant:true`) | Luôn được bơm |
| 🟢 Từ khóa (có `key`) | Một trong các từ khóa chính khớp → xét tiếp theo logic từ khóa phụ; mục không phải thường trực mà không có từ khóa chính thì không kích hoạt (giống Tavern) |
| 🔗 Vector hóa (`vectorized`) | Extension này không làm truy hồi vector, xử lý như "không phải từ khóa" (có thể ghi đè tay thành thường trực/từ khóa) |

Logic từ khóa phụ (`selectiveLogic`, giá trị số giống hệt Tavern):

| Giá trị | Ý nghĩa | Điều kiện khớp (sau khi đã khớp từ khóa chính) |
|----|------|------|
| `0` AND_ANY | Và · bất kỳ | Từ khóa phụ khớp **bất kỳ** một cái |
| `1` NOT_ALL | Không · toàn bộ | Từ khóa phụ **không khớp hết toàn bộ** |
| `2` NOT_ANY | Không · bất kỳ | Từ khóa phụ **không khớp bất kỳ cái nào** |
| `3` AND_ALL | Và · toàn bộ | Từ khóa phụ khớp **toàn bộ** |

Khớp từng từ khóa đơn `matchKey()`:

- Từ khóa dạng `/pattern/flags` được xử lý như **regex**.
- Còn lại thì tùy `caseSensitive` mà phân biệt hoa thường hay không; `matchWholeWords` (khớp nguyên từ) **chỉ có hiệu lực với từ ASCII**.
- **Tiếng Trung và các ngôn ngữ không có ranh giới từ** (`\b` không dùng được) đều lùi về **khớp chuỗi con** — đây chính là mặc định hợp lý cho extension này (kịch bản võ hiệp tiếng Trung), tránh việc quy tắc khớp nguyên từ làm sót hết từ khóa tiếng Trung.

> Văn bản để quét lấy từ [`world-engine-evolution.js`](../world-engine-evolution.js): `dialogueText || (userMsg + '\n' + aiMsg)`, tức đúng phần hội thoại gần đây thực sự được đưa vào suy diễn ở lượt này.

---

## 4. Danh sách file thay đổi

| File | Thay đổi | Mức độ số dòng |
|------|----------|----------|
| `world-engine-worldbook.js` | `loadCurrentEntries` giữ lại các trường gốc; thêm mới cơ chế kích hoạt `matchKey` / `activationOf` / `isEntryActive` / `triggerEnabled`; `buildPromptSection(scanText)` khi bật sẽ lọc theo đèn lam-lục và in gộp chi tiết khớp trong console; mở rộng cấu trúc lưu lựa chọn thành `{ids,t,overrides}` (tương thích ngược) | +khoảng 110 dòng |
| `world-engine-evolution.js` | Nơi gọi truyền vào văn bản quét: `buildPromptSection(dialogueText || userMsg+aiMsg)` | +2 dòng |
| `world-engine-api.js` | Cài đặt mặc định thêm `worldbookTrigger:false` | +1 dòng |
| `world-engine-ui.js` | Trang cài đặt sổ tay thế giới thêm công tắc tổng; mỗi mục hiển thị nhãn 🔵/🟢/🔗 + xem trước từ khóa + dropdown ghi đè kích hoạt; lưu sẽ lưu luôn phần ghi đè; sửa lỗi `settings` chưa định nghĩa trong `renderSettingsAfterCheckpoint` | +khoảng 50 dòng |
| `style.css` | Kiểu dáng phần thân mục / dropdown ghi đè (tái dùng biến CSS sẵn có) | +khoảng 22 dòng |
| `manifest.json` | Phiên bản `2.2.0` → `2.3.0`, bổ sung mô tả | 2 dòng |
| `README.md` | Bổ sung một mục về kích hoạt đèn lam-lục trong phần tổng quan tính năng | 1 dòng |

> **Không thay đổi logic lưu trữ cốt lõi**: toàn bộ cơ chế kích hoạt được gói gọn trong module worldbook, hoạt động thông qua `STORE` và `getSettings` sẵn có.

---

## 5. Cấu trúc dữ liệu

`world_engine_worldbook_selection_<chatId>` (IndexedDB / localStorage, vẫn tách riêng theo từng cuộc trò chuyện):

```jsonc
{
  "ids": ["sách A::3", "sách A::7"],   // Nhóm ứng viên: các mục extension này có thể đọc (ngữ nghĩa cũ giữ nguyên)
  "t": 1700000000000,            // Mốc thời gian lưu (dùng cho FIFO dự phòng)
  "overrides": {                 // Ghi đè kích hoạt của từng mục; mặc định = auto (theo Tavern), không lưu xuống đĩa
    "sách A::7": "const"            // 'const' (ép thường trực) | 'key' (ép từ khóa) | 'off' (tắt)
  }
}
```

Tương thích ngược: định dạng cũ (mảng thuần, hoặc `{ids,t}` không có `overrides`) vẫn được đọc bình thường; mục bị bỏ chọn thì phần ghi đè của nó sẽ tự động bị dọn sạch khi lưu, không bị tích tụ.

---

## 6. Người dùng sử dụng như thế nào

Đầu khu vực **"Sổ tay thế giới dùng để suy diễn nền"** trên trang cài đặt có thêm công tắc mới **"Bật kích hoạt đèn lam-lục (theo cấu hình sổ tay thế giới bên Tavern)"**:

- **Tắt (mặc định)**: toàn bộ mục đã chọn đều được bơm vào suy diễn — giống hệt trước đây.
- **Bật**:
  - Mỗi mục hiển thị nhãn: 🔵 thường trực / 🟢 từ khóa (kèm xem trước từ khóa) / 🔗 vector hóa / ⚪ không có từ khóa.
  - 🔵 luôn được bơm; 🟢 chỉ được bơm khi hội thoại gần đây khớp với từ khóa của nó.
  - Mỗi mục có dropdown bên phải để ghi đè: **theo Tavern / ép thường trực / ép từ khóa / tắt**.
- Việc đánh dấu chọn vẫn là "nhóm ứng viên": mục chưa được chọn thì vĩnh viễn không tham gia (bất kể màu đèn gì). Sửa xong bấm "Lưu lựa chọn sổ tay thế giới" để lưu luôn một thể.

**Cách xác nhận việc khớp (khả năng quan sát)**:

- **Chi tiết trong console**: mỗi lượt suy diễn, F12 Console sẽ in một dòng log gộp lại `[World Engine] Đèn lam-lục sổ tay thế giới: X/Y được bơm`, mở ra sẽ thấy từng mục `✓ Bơm / · Bỏ qua | Lý do | Tên sách / tiêu đề`, lý do gồm 🔵 thường trực / 🟢 khớp "từ khóa" / 🟢 không khớp / bị ghi đè.
- **Xem prompt**: trang "Gỡ lỗi" trên bảng điều khiển hiển thị toàn bộ prompt gửi cho API (kèm đoạn `========== Các mục sổ tay thế giới đã chọn ==========`) và nút "Xuất Prompt", có thể đối chiếu nội dung thực sự được bơm vào.

---

## 7. Trường hợp biên

| Trường hợp | Xử lý |
|------|------|
| Chưa bật kích hoạt | `buildPromptSection` bỏ qua văn bản quét, giữ nguyên "bơm toàn bộ mục đã chọn" |
| Văn bản quét rỗng | 🔵 thường trực vẫn được bơm; mục 🟢 từ khóa không khớp (không có văn bản để quét) |
| Từ khóa chứa tiếng Trung | Khớp chuỗi con (không áp dụng quy tắc khớp nguyên từ ASCII), vẫn khớp bình thường |
| `/regex/` không hợp lệ | Từ khóa đó bị coi là không khớp, không ném lỗi |
| Mục 🔗 vector hóa | Mặc định không kích hoạt; có thể ghi đè tay |
| Bỏ chọn rồi lại đổi ghi đè | Khi lưu chỉ giữ lại phần ghi đè của mục vẫn còn trong nhóm ứng viên |
| Bản ghi lựa chọn phiên bản cũ (mảng thuần) | Vẫn đọc bình thường, `overrides` coi như rỗng |

---

## 8. Kiểm thử

**Kiểm thử logic offline**: dùng sandbox `vm` để nạp **đúng file thật** `world-engine-worldbook.js`, mock `WORLD_ENGINE_STORE` / `WORLD_ENGINE_API`, kiểm chứng trực tiếp `matchKey` / `isEntryActive` / khả năng tương thích lưu trữ, **28/28 đều đạt**:

1. Thường trực luôn được bơm; từ khóa khớp/không khớp.
2. Bốn nhánh của `selectiveLogic` (AND_ANY / NOT_ALL / NOT_ANY / AND_ALL).
3. Từ khóa `/regex/`; phân biệt hoa thường; chuỗi con tiếng Trung (quy tắc khớp nguyên từ không ảnh hưởng tiếng Trung).
4. Độ ưu tiên ghi đè (const/key/off ghi đè lên đèn gốc).
5. Khi công tắc tổng tắt = bơm toàn bộ mục đã chọn (giống hành vi cũ).
6. Tương thích ngược khi lưu trữ (mảng thuần, thiếu overrides).

**Kiểm chứng thực tế**: trên trang Tavern thật (đã cài extension này) gọi `isEntryActive` / `matchKey` đang triển khai, đối chiếu từng trường hợp trên cho khớp; và trong cuộc trò chuyện thực tế, bật công tắc tổng, hội thoại khớp từ khóa rồi xác nhận mục 🟢 được đưa vào suy diễn, 🔵 luôn có mặt.

Ngoài ra: các file JS đã sửa đều pass `node --check`.

> Script kiểm thử chỉ dùng để xác nhận offline, không đưa vào repo (bản thân dự án không có framework test).

**Đề xuất kiểm thử thủ công** (cần chạy trên Tavern thật):
- Mở một sổ tay thế giới có cả mục thường trực lẫn từ khóa: bật công tắc tổng → hội thoại nhắc đến một từ khóa → xác nhận mục 🟢 tương ứng được đưa vào suy diễn lượt này, khi không nhắc thì không vào; 🔵 luôn có mặt.
- Ghi đè một mục thành "tắt/ép thường trực" có hiệu lực.
- Chat nhóm; nhiều sổ tay thế giới gộp lại; làm mới bảng điều khiển thì lựa chọn và ghi đè không bị mất.

---

## 9. Gợi ý rà soát (nên tập trung xem)

1. [`world-engine-worldbook.js`](../world-engine-worldbook.js): các nhánh đèn/ghi đè và `reason` trong `activationOf`, phần lùi về khớp chuỗi con tiếng Trung của `matchKey`, `selectiveLogic` khớp với Tavern; phần đi thẳng nguyên trạng trong `buildPromptSection` khi tắt kích hoạt.
2. [`world-engine-evolution.js`](../world-engine-evolution.js): văn bản quét lấy đúng phần hội thoại được đưa vào suy diễn lượt này (điểm tách rời).
3. Tính tương thích: độ chắc chắn của `parseStored` với định dạng cũ và thiếu `overrides`; việc `persistSelection` dọn dẹp phần ghi đè.
4. Mặc định tắt: xác nhận khi `worldbookTrigger:false` thì hành vi giống hệt từng chữ so với trước khi thay đổi.
