# 🌍 Thế Giới Dẫn Truyện (World Engine)

Extension độc lập cho **SillyTavern**, dùng API riêng để **tự động suy diễn trạng thái thế giới** sau mỗi lượt hội thoại (sự kiện, thế lực, danh tiếng, kinh tế, tin đồn, kẻ thù, bí mật...), rồi chèn phần trạng thái đó vào prompt để mô hình AI viết tiếp câu chuyện nhất quán với những gì đã xảy ra — không cần bạn tự nhớ và nhắc lại bối cảnh.

Đi kèm là **Công Cụ Nhân Vật (NPC Engine)** — theo dõi các NPC trọng yếu theo sáu trục và cho họ **hoạt động ngầm** khi vắng mặt khỏi cảnh, rồi ràng buộc AI phải tôn trọng vị trí và tri thức của từng nhân vật.

> Đây là bản dịch tiếng Việt của dự án gốc tiếng Trung **世界引擎** (tác giả: Disnight, giấy phép MIT). Xem [Ghi chú về bản dịch](#-ghi-chú-về-bản-dịch) ở cuối file.

---

## 📦 Cài đặt

1. Mở SillyTavern → **Extensions** → **Install Extension**.
2. Dán đường dẫn kho chứa extension này, hoặc chép thủ công toàn bộ thư mục vào `SillyTavern/public/scripts/extensions/third-party/`.
3. Tải lại trang. Extension sẽ tự nạp `world-engine.js` + `style.css` theo khai báo trong `manifest.json`.
4. Vào bảng cài đặt của extension (biểu tượng 🌍 trong khay Extensions, hoặc quả cầu nổi ở góc màn hình) để cấu hình API.

### Cấu hình API bắt buộc trước khi dùng

World Engine **không dùng chung API với SillyTavern** — nó gọi một API tương thích OpenAI riêng (`world-engine-api.js`), để việc suy diễn nền không tốn lượt gọi hay ngữ cảnh của mô hình chính đang roleplay. Vào trang cài đặt, mục **API**, điền:

- **Base URL** (endpoint tương thích OpenAI, ví dụ của OpenRouter, DeepSeek, hoặc proxy riêng)
- **API Key**
- **Tên model**

Có thể cấu hình **preset** riêng cho World Engine (vai trò hệ thống, quy tắc suy diễn, định dạng JSON đầu ra...) trong mục **Preset** — hệ thống cho phép lưu nhiều bản, đặt bản mặc định, và khôi phục về preset gốc nếu chỉnh hỏng.

---

## ✨ Tính năng chính

### 🌏 World Engine — suy diễn trạng thái thế giới

Sau mỗi lượt hội thoại (hoặc theo chu kỳ bạn cấu hình), engine gọi API riêng để cập nhật một trạng thái thế giới có cấu trúc, hiển thị trực quan trong bảng điều khiển theo 3 nhóm:

| Nhóm | Nội dung |
|---|---|
| **Tình Hình** | Đại thế thiên hạ (xu thế lớn đang diễn ra), biến cố khu vực bất ngờ, sổ sách sự kiện lớn |
| **Sự Kiện** | Chuỗi sự kiện (xung đột / tiến triển, tiến hoá qua 5 giai đoạn), Tin Đồn (loại thông báo/tin điện/lời đồn/dư luận, tự tan biến theo thời gian nếu không được nhắc lại), chuỗi ảnh hưởng |
| **Quan Hệ** | Danh tiếng (theo 4 chiều: triều đình / thị tỉnh / giang hồ / đồng đạo), thế lực (vận thế + quan hệ với người chơi), sổ ân oán / kẻ thù |
| **Tài Nguyên** | Khí hậu kinh tế, hộp đen thông tin (hành vi bí mật, tài sản bí mật với độ lộ tăng dần) |

Các tham số cốt lõi (xác suất kích hoạt sự kiện, công thức tan biến tin đồn, số vòng giữ lại kết quả, giới hạn thất bại liên tiếp...) đều có thể chỉnh trực tiếp trong **Cơ Chế Cục Bộ**, không cần sửa code.

**Độ ổn định thế giới**: engine tự tính một chỉ số tổng hợp (0–100) từ mật độ sự kiện/tin đồn/quan hệ/kinh tế, hiển thị thành 5 mức từ "Thiên Hạ Thái Bình" đến "Bên Bờ Sụp Đổ" — giúp bạn nhìn nhanh câu chuyện đang "nóng" hay "nguội" tới đâu.

### 🔵🟢 Kích hoạt Sổ Tay Thế Giới kiểu đèn giao thông

World Engine có thể đọc trực tiếp **World Info / Lorebook** của SillyTavern làm tư liệu nền cho suy diễn, và tôn trọng đúng kiểu kích hoạt gốc của từng mục:

- 🔵 **Thường trực** (constant) — luôn được đưa vào
- 🟢 **Từ khóa** (selective) — chỉ đưa vào khi hội thoại gần đây khớp từ khóa
- Mỗi mục có thể **ghi đè riêng** (ép thường trực / ép từ khóa / tắt hẳn) ngay trong extension, không đụng tới sổ tay gốc

Mặc định tắt để không ảnh hưởng hành vi cũ; bật lên trong mục cài đặt **Sổ Tay Thế Giới**.

### 🧑 NPC Engine — Công Cụ Nhân Vật

Một engine độc lập, cho NPC tiếp tục sống khi không có mặt trên màn hình.

**Lọc ba bậc** — không phải ai xuất hiện cũng được lưu. Nhân vật có tên riêng, có động cơ rõ, có tác động tới người chơi thì lên bậc **trọng yếu**; có tên nhưng chưa rõ chí hướng thì **ngoại vi**; còn "lão chủ quán", "tên lính gác" thì bỏ qua hoàn toàn. Ngưỡng và số lượng tối đa chỉnh được trong cài đặt — đây là van chặn duy nhất giữ cho prompt không phình ra khi truyện dài.

**Sáu trục theo dõi**: vị trí, mục tiêu, thế lực, quan hệ với người chơi và với NPC khác, tri thức, trạng thái.

**Hoạt động ngầm** — mỗi lượt, các NPC trọng yếu đang vắng mặt sẽ tự hành động dựa trên mục tiêu của họ và diễn biến thế giới vừa xảy ra. Kết quả nào đủ lộ liễu thì lan thành tin đồn nối vào hệ tin đồn của World Engine.

**Ràng buộc gửi cho AI** — engine không kể lể nhật ký vào prompt, mà chỉ đưa ràng buộc cứng:

- **Vị trí**: ai đang ở đâu, ai đang trên đường và còn mấy lượt nữa mới tới. Ba nấc che vị trí thật — để AI biết hết, hoặc chỉ biết chỗ người chơi *tưởng* nhân vật đang ở (kèm gợi ý mơ hồ), hoặc mù hoàn toàn.
- **Tri thức**: với nhân vật đang có mặt trong cảnh, liệt kê những gì họ **chưa** biết. NPC không được nhắc tới chuyện chưa từng tới tai mình — kể cả cái chết của người khác.
- **Neo thời gian**: một dòng ngắn ghi ngày truyện, số lượt và vài diễn biến nền gần nhất, chống việc AI trôi mốc thời gian sau vài lượt.

**Về khoảng cách**: engine không tự hiểu địa lý. Vị trí lưu dưới dạng đường dẫn phân cấp (quốc gia › vùng › thành › địa điểm) nên độ gần suy ra bằng so khớp tiền tố; còn thời gian đi lại thì AI ước lượng một lần theo thế giới quan — cùng quãng đường, truyện kiếm hiệp tốn nhiều lượt hơn truyện có phi kiếm — rồi engine chỉ việc trừ dần mỗi lượt.

### 💾 Lưu trữ & đồng bộ

- Lưu trạng thái **theo từng cuộc trò chuyện**, đính kèm luôn vào dữ liệu chat của Tavern → đồng bộ đa thiết bị tự nhiên, không cần dịch vụ ngoài.
- Cơ chế **điểm lưu / checkpoint** theo từng tầng hội thoại, tự khớp lại đúng trạng thái khi bạn reroll, xoá lùi, hoặc chuyển nhánh hội thoại — tránh tình trạng trạng thái thế giới bị lệch khỏi nội dung đang hiển thị.
- **Tái suy diễn hàng loạt**: đẩy dần từ tầng AI đầu tiên đến một tầng chỉ định, dùng khi mới cài extension giữa chừng một cuộc trò chuyện dài, hoặc muốn dựng lại toàn bộ trạng thái từ đầu.

### 🩺 Chẩn đoán & gỡ lỗi

- **Gói chẩn đoán một cú nhấp**: xuất toàn bộ trạng thái hoạt động hiện tại để báo lỗi hoặc tự kiểm tra.
- **Bộ tự kiểm tra việc chèn** (chỉ đọc, tách rời khỏi luồng chính): xem chính xác nội dung nào đã thực sự được chèn vào prompt gửi cho mô hình, kèm nút xuất prompt đầy đủ.
- Quả cầu nổi ở góc màn hình báo trạng thái theo thời gian thực (đang suy diễn, đang điền lại hàng loạt, thành công/thất bại, tiến độ vòng/tổng).

---

## 🚀 Bắt đầu nhanh

1. Cài extension, cấu hình **API** (mục bắt buộc — xem phần Cài đặt phía trên).
2. (Tuỳ chọn) Vào **Preset** chọn hoặc chỉnh preset suy diễn cho phù hợp thể loại truyện của bạn.
3. Trò chuyện bình thường trong SillyTavern — World Engine sẽ tự động suy diễn nền sau mỗi lượt (hoặc theo chu kỳ bạn đặt trong cài đặt **Chèn**).
4. Mở bảng điều khiển (nhấn vào quả cầu nổi) để xem/sửa tay trạng thái thế giới: sự kiện, thế lực, tin đồn, danh tiếng...
5. Nếu mới cài extension giữa một cuộc trò chuyện dài đã có sẵn, dùng **Tái Suy Diễn Hàng Loạt** trong mục **Bảo Trì** để dựng trạng thái từ đầu.
6. Muốn NPC tiếp tục sống khi vắng mặt thì mở mặt **Công Cụ Nhân Vật** (nhấn nút chuyển engine trên quả cầu) và cấu hình API riêng cho nó.

---

## ⚙️ Yêu cầu

- SillyTavern (bản hỗ trợ extension bên thứ ba).
- Một API tương thích OpenAI (Base URL + API Key + tên model) — độc lập với API bạn dùng để roleplay chính.

---

## 📝 Ghi chú về bản dịch

Bản này dịch toàn bộ mã nguồn, chú thích, chuỗi giao diện và prompt gửi AI của dự án gốc **世界引擎 / World Engine** (tiếng Trung, tác giả **Disnight**) sang tiếng Việt — bao gồm cả các giá trị trạng thái nội bộ (giai đoạn sự kiện, cấp danh tiếng, vận thế thế lực, quan hệ, khí hậu kinh tế...) để toàn bộ hệ thống — kể cả những gì AI đọc và trả về — đều nhất quán bằng tiếng Việt, không còn sót tiếng Trung ở phần vận hành thực tế.

Các chuỗi được **giữ nguyên tiếng Trung có chủ đích** (không phải sót dịch) vì mang tính chức năng, không phải nội dung hiển thị:

- Bảng số đếm Hán tự (`零一二三...万廿卅`) dùng để phân tích số thứ tự Hán tự có thể xuất hiện trong chính văn truyện.
- Cụm regex ví dụ về đơn vị ngày tháng (年/月/日) trong ô cấu hình biểu thức chính quy nhận diện thời gian truyện.
- Tên font `宋体` (SimSun) trong danh sách font dự phòng của CSS.
- Vài từ khoá nhận diện lời thoại tiếng Trung dùng để tránh liên kết nhầm ký ức (không ảnh hưởng khi viết truyện bằng tiếng Việt).

Quy trình rà soát lỗi sau dịch: kiểm tra cú pháp từng file bằng **cả `node --check` lẫn trình phân tích cú pháp `acorn`** (không chỉ dùng một công cụ để tránh bỏ sót), cộng với việc chạy lại toàn bộ script kiểm thử sẵn có trong `docs/*-test.js` để xác nhận các thay đổi thuật ngữ không phá vỡ logic so khớp trạng thái giữa các file.

---

## 📄 Giấy phép

MIT — theo giấy phép gốc của dự án.
