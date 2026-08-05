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

Engine độc lập, cho NPC tiếp tục sống khi không có mặt trên màn hình. Dùng API riêng, cấu hình riêng, dữ liệu riêng theo từng cuộc trò chuyện.

#### Lọc ba bậc

Không phải ai xuất hiện cũng được lưu. Nhân vật có tên riêng, có động cơ rõ, có tác động tới người chơi thì lên bậc **trọng yếu**; có tên nhưng chưa rõ chí hướng thì **ngoại vi**; còn "lão chủ quán", "tên lính gác" thì bỏ qua hoàn toàn.

Mô hình chấm điểm 0–100, nhưng **ngưỡng lên bậc do bạn đặt** — không phó mặc mô hình, vì tiêu chuẩn của nó trôi dần qua các lượt. Chỉ NPC trọng yếu mới sinh hoạt động ngầm và mới được đưa vào ràng buộc gửi AI, nên số lượng tối đa là van chặn giữ cho prompt không phình ra khi truyện dài.

#### Sáu trục theo dõi

Vị trí · mục tiêu · thế lực · quan hệ với người chơi và với NPC khác · tri thức · trạng thái.

Cộng một khối **nhân dạng** riêng: giới tính, cách xưng hô, chủng tộc, độ tuổi, ngoại hình cố định, thân phận xã hội. Khối này được gửi kèm vào mọi lượt để AI chính không viết sai — đây là loại lỗi người đọc nhận ra ngay lập tức.

Nhân dạng **bám theo chính văn**, không khoá cứng: truyện lột mặt nạ người cải trang, nói ra thân phận thật hay cho nhân vật biến hình thì hồ sơ đổi theo. Lượt nào chính văn không đả động tới nhân dạng thì hệ thống giữ nguyên giá trị cũ, nên nó không nhảy qua nhảy lại. Prompt cấm mô hình suy giới tính từ ngoại hình, y phục, thân thể hay chủng tộc — đó mới là chỗ hở khiến nhân vật trôi giới tính. Bạn sửa tay thì vẫn đổi được bình thường.

#### Đồng hồ thế giới

Trạng thái đếm bằng **phút truyện**, không phải bằng lượt. Một lượt hội thoại không phải một đơn vị thời gian — nó chỉ là lúc quyết toán, còn đồng hồ nhích bao nhiêu là do chính văn quyết định. Mô hình tự đọc thời gian trôi qua từ lời văn ("nửa giờ sau", "ba ngày sau", "Rằm tháng Giêng"), không cần bạn cấu hình biểu thức nào.

Nhờ vậy mọi lịch hẹn co giãn đúng: một cuộc hẹn "ngay hôm nay" mà truyện nhảy ba ngày thì nó đã kết thúc rồi, chứ không còn treo mãi.

#### Bốn kiểu hẹn

| Kiểu | Tiến theo | Dùng cho |
|---|---|---|
| **Trôi tự nhiên** | Đồng hồ thế giới | Đi đường, chờ đợi, hồi phục |
| **Giờ công hiệu lực** | Chỉ khi nhân vật thực sự bỏ công | Rèn đồ, nghiên cứu, luyện tập |
| **Hẹn giờ cố định** | Mốc thời gian cụ thể | Cuộc họp, buổi lễ, hạn chót |
| **Chờ điều kiện** | Đợi thứ khác xảy ra | Chờ hồi âm, chờ nguyên liệu |

Kiểu **giờ công** là chỗ khác biệt: một thanh kiếm cần 20 giờ *ngồi rèn*, không phải 20 giờ trôi qua — engine không cộng công khi thợ rèn đang đi đường.

#### Hoạt động ngầm

Mỗi lượt, engine **tự chấm điểm chọn** một số NPC vắng mặt để đẩy, theo mức liên quan: ai có dự định đến hạn, ai vừa được nhắc tới trong chính văn, ai đang đi đường, ai ở gần cảnh của người chơi, cộng phần thưởng cho người lâu chưa có diễn biến. Số còn lại **giữ nguyên trạng thái, không bịa hoạt động** — đứng yên một lượt là hợp lý, bịa việc cho đủ người mới phá truyện.

#### Hậu trường ≠ trong truyện đã biết

Chuyện engine suy diễn ra ở hậu trường **chưa tồn tại trong truyện** cho tới khi AI chính thật sự kể ra hoặc để lại dấu vết. Trước đó nó không lọt vào ràng buộc tri thức — vì ràng buộc *"nhân vật X chưa biết Y"* chính là đang kể Y cho AI, tức là tự tiết lộ tình tiết đang giấu.

#### Ràng buộc gửi cho AI chính

Engine không kể lể nhật ký vào prompt, chỉ đưa ràng buộc cứng, có trần độ dài và cắt theo mức thiết yếu:

- **Neo thời gian** — ngày truyện, số lượt, vài diễn biến nền gần nhất
- **Nhân dạng nhân vật** — viết đúng giới tính, xưng hô, độ tuổi của nhân vật đang có mặt
- **Vị trí** — ai đang ở đâu, ai chưa thể có mặt. Ba nấc che vị trí thật: AI biết hết, chỉ biết chỗ người chơi *tưởng* (kèm gợi ý mơ hồ), hoặc mù hoàn toàn
- **Tri thức** — với nhân vật trong cảnh, liệt kê những gì họ **chưa** biết
- **Dấu vết tại chỗ** — thứ nhìn thấy được mà chuyện hậu trường để lại ở **đúng nơi người chơi đang đứng**
- **Tuyến hệ quả** — hệ quả *có thể* tới từ việc người chơi đã làm, dưới dạng chất liệu chứ không phải mệnh lệnh
- **Tin đồn** — tách rõ chuyện chưa ai kể (chất liệu) với chuyện đã thành sự thật trong truyện

#### Tuyến hệ quả — đẻ ít có chủ đích

Việc người chơi làm phải có dư âm, nhưng dư âm đẻ vô tội vạ thì thành danh sách việc vặt. Nên engine bị siết chặt:

- Mỗi lượt **nhiều nhất một** tuyến mới, và chỉ khi người chơi làm chuyện có sức nặng — đắc tội ai đó, hứa hẹn điều gì, để lộ thân phận, lấy đi thứ có chủ
- Mỗi tuyến **bắt buộc nêu hành động nào của người chơi** đã dẫn tới nó. Không nêu được thì bị bỏ, vì đó là tình tiết bịa chứ không phải hệ quả
- Trần mặc định **4 tuyến**; tuyến ba ngày truyện không ai nhắc thì tự nguội và rời khỏi khối chèn
- Lượt trò chuyện bình thường thì không sinh gì cả, và đó là kết quả đúng

Bạn có quyền phủ quyết: mỗi tuyến có nút *Cho nguội* và *Bỏ hẳn*.

#### Ba tầng độ lộ

Chuyện xảy ra lúc người chơi vắng mặt không chỉ có hai kết cục *thành lời đồn* hoặc *biến mất hẳn* — nếu vậy thì "không có gì xảy ra" lúc nào cũng nghĩa là thế giới đứng im.

| Tầng | Đường rò | Vào prompt khi nào |
|---|---|---|
| **Tin đồn** | qua miệng người | luôn, như chất liệu chung |
| **Dấu vết** | qua vật để lại | chỉ khi người chơi đứng đúng chỗ đó |
| **Bí mật** | không rò | không bao giờ, cho tới khi truyện tự kể ra |

Dấu vết là câu tả thứ **nhìn thấy được**, không phải điều suy ra: *"bùn ướt trên bậc thềm"* chứ không phải *"có người vừa đi mưa về"*. Giới hạn theo vị trí là có chủ đích — dấu vết ở thành khác mà lọt vào prompt thì chính nó lại thành đường tiết lộ chuyện đang giấu.

#### Về khoảng cách

Engine không tự hiểu địa lý. Vị trí lưu dưới dạng đường dẫn phân cấp (quốc gia › vùng › thành › địa điểm) nên độ gần suy ra bằng so khớp tiền tố. Thời gian đi lại thì AI ước lượng một lần theo thế giới quan — cùng quãng đường, kiếm hiệp mất nhiều giờ hơn truyện có phi kiếm — rồi engine ghi lại để lần sau đi tuyến đó vẫn ra con số cũ.

#### Công cụ đi kèm

- **Tóm tắt tình hình nhân vật** — đoạn văn xuôi ở trang chủ do mô hình viết, giống Tóm Tắt Thế Giới. Prompt chỉ cho nó *diễn đạt lại* bản kê engine đưa vào, cấm thêm nhân vật hay sự việc — tóm tắt bịa thì tệ hơn không có tóm tắt. Tắt được; tắt thì engine tự dựng bản danh sách bằng mã, không tốn token. Đoạn này **không đi vào prompt nào cả**, chỉ để bạn đọc
- **Cắt khối theo nhãn** — nếu preset của bạn sinh **khối trạng thái kẹp trong chính văn** ("Sự kiện song song", "Báo cáo vận hành thế giới", bảng ETA), gõ tên khối vào đây là engine tự cắt. Những khối đó là bảng do AI chính *bịa ra*, không phải chuyện đã xảy ra — engine đọc vào là dựng hồ sơ theo lời bịa, mà engine cũng chèn trạng thái vào prompt, nên cái nó đọc lại chính là cái nó vừa viết ra. **Đừng cắt** đoạn tự sự kể chuyện xảy ra ở nơi khác (POV khác): đó là chính văn thật
- **Sổ mâu thuẫn** — ghi lại chỗ chính văn nói khác với hồ sơ đang lưu: nhân dạng đổi, nhân vật nhảy vị trí không qua đường đi, người chết trở lại, đồng hồ bị kéo lùi. Engine **vẫn nghe theo chính văn**, sổ không chặn gì cả — nó chỉ khiến việc trôi hiện ra để bạn còn thấy mà sửa tay
- **Sửa hồ sơ tay** — chữa mọi trục khi mô hình chấm sai, thêm nhân vật bị bỏ sót, xoá người bị nhận nhầm
- **Điền lại hàng loạt** — quét từ đầu cuộc trò chuyện để dựng hồ sơ cho phần quá khứ, dùng khi mới cài giữa chừng
- **Xem tại chỗ** — nút *"Đang làm gì?"* sinh đoạn tự sự ngôi thứ nhất, không gửi vào chat, không đổi trạng thái, không tiến thời gian
- **Bản lưu theo cuộc trò chuyện** — tạo, khôi phục, xuất, nhập
- **Đối soát và chữa dữ liệu** — lùi hồ sơ về khớp số tầng thật, gỡ liên kết hỏng
- **Tự kiểm tra việc chèn** — xem chính xác ràng buộc có thực sự vào prompt gửi cho mô hình hay không

### 💾 Lưu trữ & đồng bộ

- Lưu trạng thái **theo từng cuộc trò chuyện**, đính kèm luôn vào dữ liệu chat của Tavern → đồng bộ đa thiết bị tự nhiên, không cần dịch vụ ngoài.
- Cơ chế **điểm lưu / checkpoint** theo từng tầng hội thoại, tự khớp lại đúng trạng thái khi bạn reroll, xoá lùi, hoặc chuyển nhánh hội thoại — tránh tình trạng trạng thái thế giới bị lệch khỏi nội dung đang hiển thị.
- **Tái suy diễn hàng loạt**: đẩy dần từ tầng AI đầu tiên đến một tầng chỉ định, dùng khi mới cài extension giữa chừng một cuộc trò chuyện dài, hoặc muốn dựng lại toàn bộ trạng thái từ đầu.

### 🩺 Chẩn đoán & gỡ lỗi

- **Chép chẩn đoán để báo lỗi**: một cú nhấp chép vào clipboard, đã bỏ khoá API **và bỏ cả nguyên văn truyện** — dán thẳng vào issue được. Chỉ còn số đếm, cấu hình và sổ mâu thuẫn.
- **Gói chẩn đoán đầy đủ**: tải file JSON gồm cả prompt và phản hồi thật. Khoá API đã che, nhưng **có chứa nguyên văn truyện** — file này để bạn tự xem.
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

## 🔢 Phiên bản

Hai engine đánh số **độc lập với nhau**. Xem nhật ký cập nhật ngay trong extension:

- **World Engine** — mặt Thế Giới → Cài Đặt → tab **Giới Thiệu**
- **NPC Engine** — mặt Nhân Vật → Cài Đặt → tab **Giới Thiệu** → mục **Nhật Ký Cập Nhật**

---

## 🙏 Ghi công

- Dự án gốc **世界引擎 / World Engine** — tác giả **Disnight**, giấy phép MIT.
- Một số ý tưởng của Công Cụ Nhân Vật — đồng hồ thế giới, bốn kiểu hẹn, theo dõi nhân dạng, tách sự việc hậu trường khỏi sự việc trong truyện đã biết, chọn nhân vật theo mức liên quan, sổ mâu thuẫn, ba tầng độ lộ, phối hợp hai chiều giữa hai engine, gói chẩn đoán không kèm nguyên văn, cắt khối theo nhãn, rào chắn nhất quán, tuyến hệ quả tự sinh — tham khảo từ [**world-backstage**](https://github.com/h675786161-prog/world-backstage) (v0.8–v1.5.6) của **h675786161-prog**, giấy phép MIT. Phần cài đặt được viết lại theo khuôn dữ liệu của kho này, không chép mã.

---

## 📄 Giấy phép

MIT — theo giấy phép gốc của dự án.
