// world-engine-rules-loader.js — Toàn bộ quy tắc của World Engine
// Quy tắc được chia theo các khu vực panel UI, tổng cộng 12 module
window.WORLD_ENGINE_RULES = (function() {

  // ===================== Văn Bản Quy Tắc Gốc =====================

  const RULES = [
    // ========== Module 1: Thế Giới Vận Hành ==========
    {
      comment: 'Module 1: Thế Giới Vận Hành',
      content: `<world_engine>
Thế giới đang sống. Những người không nằm trong tầm mắt của {{user}} vẫn đang sống cuộc đời của riêng họ.

I. Nguyên Tắc Cốt Lõi (Thế Giới Phi Trung Tâm)
Thế giới này là một hệ sinh thái vận hành độc lập, {{user}} chỉ là một trong những người tham gia, không phải trung tâm của thế giới.
- NPC có mục tiêu sống, lịch trình, các mối quan hệ xã hội và cảm xúc riêng, sẽ không vô cớ xoay quanh {{user}}.
- Chuỗi sự kiện, Tin Đồn, tiến độ của các thế lực... vẫn tự động tiến triển ngay cả khi không liên quan đến {{user}}.
- Đại cục thiên hạ đang tiếp diễn là ràng buộc cấp thế giới mà mỗi lượt suy diễn đều phải cân nhắc.
- Khi tạo diễn biến cốt truyện, AI nên ưu tiên tính vận hành độc lập của thế giới (suy diễn ở hậu trường), sau đó mới đến sự tham gia và cảm nhận của {{user}}.
- {{user}} có thể xem toàn cảnh thế giới qua panel (người chơi toàn tri), nhưng bản thân nhân vật chính chỉ có thể cảm nhận được phần liên quan đến mình hoặc phần mà họ tình cờ gặp phải.
- Cấm mặc định rằng "mọi chuyện đều liên quan đến {{user}}". Những sự kiện không liên quan đến {{user}} là trạng thái bình thường của thế giới, không phải ngoại lệ.

II. Ranh Giới Nhận Thức
- Những gì panel ghi lại là trạng thái thế giới mà người chơi nhìn thấy được, không đồng nghĩa với việc {{user}} hoặc NPC đã biết.
- Nhân vật trong chính văn chỉ có thể hành động dựa trên những gì họ tận mắt chứng kiến, tận tai nghe thấy, được lan truyền hợp pháp, thông qua liên lạc, báo cáo, điều tra, mệnh lệnh tổ chức hoặc thông tin tiếp xúc thực tế.
- Những trạng thái ở xa, bí mật, chưa lan truyền hoặc chỉ tồn tại trong panel không được trực tiếp đi vào nhận thức của nhân vật; phải trải qua các con đường hợp lý như Tin Đồn, chủ động tiếp xúc, chuỗi sự kiện bùng phát, biến động vật tư/giá cả, gián đoạn giao thông, liên lạc, báo cáo, điều tra... thì mới có thể ảnh hưởng đến phản ứng trong chính văn.

III. Vòng Suy Diễn Và Nhận Thức Thời Gian
Mỗi lần World Engine được gọi đại diện cho một vòng suy diễn ở hậu trường, không đồng nghĩa với mỗi lượt hội thoại trong ngữ cảnh đầu vào. Trước khi suy diễn, phải tự ước lượng "khoảng thời gian cốt truyện đã trôi qua kể từ lần cập nhật trạng thái thế giới trước đó" dựa trên diễn biến mới, nhịp độ cảnh, mức tiêu hao hành động, khoảng cách di chuyển, các manh mối như chờ đợi/nghỉ ngơi/trò chuyện/chiến đấu/làm việc. Khoảng thời gian này có thể là chốc lát, vài phút, vài giờ, vài ngày hoặc lâu hơn, cũng có thể gần như không trôi qua rõ rệt.

Những thay đổi ở hậu trường phải khớp với khoảng thời gian ước lượng này:
- Khi thời gian rất ngắn, những nhân vật không có mặt thường chỉ có phản ứng nhẹ hoặc tức thời; kế hoạch dài hạn, sự lan truyền liên vùng, cấu trúc kinh tế và thế lực không nên thay đổi nhiều.
- Khi thời gian dài hơn, những nhân vật không có mặt có thể tiến triển hoạt động theo lịch trình; Tin Đồn, chuỗi sự kiện, thế lực, kinh tế có thể xuất hiện thay đổi tương xứng với quy mô thời gian.
- Chuỗi sự kiện vẫn tiến triển theo mốc cơ sở do hệ thống xúc xắc cung cấp, nhưng API phải kết hợp khoảng thời gian cốt truyện thực tế đã trôi qua trong lượt này cùng các sự kiện mới để phán đoán nên giữ nguyên, làm chậm lại, đình trệ hay viết lại theo nhân quả rõ ràng.
- Tin Đồn chỉ cập nhật dựa trên các điểm lan truyền mới, thay đổi phạm vi lan truyền hoặc tình trạng tiếp tục lên men trong lượt này; Thông Báo và Tin Điện thường giữ ổn định, Lời Đồn có thể bị phóng đại hoặc bóp méo, Dư Luận có thể chuyển hướng theo thông tin mới.

Trọng tâm của vòng suy diễn này là "so với lần cập nhật trạng thái thế giới trước, đã có gì thay đổi". Các đoạn hội thoại cũ trong ngữ cảnh đầu vào chỉ đóng vai trò làm nền và căn cứ nhân quả, không được coi nội dung lịch sử đã xử lý là thay đổi mới của lượt này. Kết quả của vòng suy diễn nên được thể hiện trong phần tóm tắt thế giới trên panel; nếu khoảng thời gian của lượt này rất ngắn và sự kiện mới không đủ, phần tóm tắt thế giới có thể ghi rằng tình hình về cơ bản ổn định hoặc chỉ có thay đổi nhẹ.

IV. Định Danh Địa Điểm Và Thế Lực
Khi liên quan đến vị trí địa lý hoặc phạm vi thế lực, phải sử dụng tên cụ thể, không được dùng các từ mơ hồ như "cả thành", "cả nước", "một thế lực nào đó".
- Nếu thế giới quan đã có sẵn tên thành phố/quốc gia/thế lực, hãy dùng theo (ví dụ: "Đế Đô Trường An", "Vương Quốc Bắc Cương").
- Nếu chưa có sẵn, AI nên tự sáng tạo tên hợp lý và giữ nhất quán trước sau, đồng thời phù hợp với bối cảnh thế giới.
- Phạm vi lan truyền của Tin Đồn, khu vực ảnh hưởng của chuỗi sự kiện, mô tả ở tầng xa đều phải tuân theo quy tắc này.

</world_engine>`
    },
    // ========== Module 2: Chuỗi Sự Kiện ==========
    {
      comment: 'Module 2: Chuỗi Sự Kiện',
      content: `<event_chain>

I. Hai Loại Chuỗi Sự Kiện

Chuỗi sự kiện chia thành hai loại: Xung Đột (conflict) và Tiến Triển (progress). Một khi type của sự kiện đã xác định thì không được thay đổi; các lần cập nhật sau của cùng một id phải giữ nguyên type gốc. Nếu trong quá trình phát triển, xung đột đã hình thành nhánh diễn biến độc lập, hoặc sau xung đột đã khởi động công việc xử lý hậu quả có thể tiến triển độc lập, nên tạo một chuỗi sự kiện mới và ghi lại mối quan hệ truyền dẫn giữa hai chuỗi trong influenceChain.

【Ưu tiên quy nạp: xác định sự việc chính trước, rồi mới xét có tạo mới hay không】
Chuỗi sự kiện không phải là danh sách sự thật, danh sách bước nhiệm vụ hay tiêu đề tin tức, mà là sự việc chính cần theo dõi xuyên suốt nhiều lượt. Trước khi tạo sự kiện mới, phải so sánh với các events hiện có về mục tiêu/mâu thuẫn cốt lõi, đối tượng chính và quá trình thực hiện liên tục.

Nếu nội dung mới vẫn đang xử lý cùng một mục tiêu hoặc mâu thuẫn, hoặc chỉ là bước chuẩn bị, thực hiện, liên lạc, di chuyển, điều tra, thử nghiệm, cản trở, cái giá phải trả, kết quả cục bộ, lan truyền hay xử lý hậu quả của sự việc đã có, thì phải giữ nguyên id cũ, chỉ cập nhật desc, stage, level hoặc stall, không được tách thành sự kiện mới. Thời gian, địa điểm, người tham gia hoặc phạm vi ảnh hưởng giống nhau chỉ có thể hỗ trợ phán đoán, không thể một mình quyết định việc gộp chung.

Việc phán đoán có nên tạo chuỗi sự kiện mới hay không chủ yếu dựa vào việc nội dung mới có xoay quanh mục tiêu cốt lõi, mâu thuẫn hoặc hành động liên tục khác với sự việc đã có hay không. Ngay cả khi sự việc vẫn đang ở giai đoạn lên kế hoạch, thăm dò, mới bắt đầu điều tra hoặc mâu thuẫn vừa manh nha, chỉ cần đã xuất hiện dấu hiệu cụ thể và có khả năng tiếp tục phát triển, vẫn có thể tạo chuỗi sự kiện; không cần chờ đến khi con đường hành động, điều kiện tài nguyên hay ranh giới thành bại hoàn toàn rõ ràng. Nếu nội dung mới rõ ràng chỉ là một khâu thực hiện hoặc hậu quả trực tiếp của sự việc đã có, nên ưu tiên giữ nguyên chuỗi sự kiện gốc. Chủ thể liên tục mới, hệ thống tài nguyên mới hoặc quan hệ trách nhiệm mới có thể dùng làm căn cứ để tách chuỗi, nhưng không phải là yêu cầu bắt buộc.

Loại sự kiện khác nhau không tự động tạo thành lý do để tách chuỗi. Tranh chấp, tai nạn hay đối kháng cục bộ thông thường vẫn có thể là trở ngại của sự kiện tiến triển; việc sửa chữa, cứu chữa hay xử lý hậu quả thông thường vẫn có thể là kết quả của sự kiện xung đột. Chỉ khi sự việc xung đột hoặc tiến triển đã có thể diễn biến độc lập mới tạo chuỗi riêng, và dùng influenceChain để ghi lại quan hệ truyền dẫn.

【Điều kiện tạo mới: chuỗi sự kiện chỉ ghi lại sự việc chính có thể diễn biến】
Hành động, xung đột, kế hoạch, kết quả, thay đổi hoặc ảnh hưởng về sau từng xuất hiện trong lời kể không tự động trở thành chuỗi sự kiện. events dùng để ghi lại những sự việc đã lộ dấu hiệu có thể theo dõi và có khả năng tiếp tục phát triển, bị cản trở, chuyển hướng hoặc khép lại sau đó. Sự việc có thể đang ở giai đoạn khá sớm; chỉ cần nó không chỉ là một hành động nhất thời xảy ra rồi thôi, và đã thể hiện khả năng tiếp diễn nhất định, thì có thể đưa vào chuỗi sự kiện để tiếp tục quan sát.

Khi xuất hiện các dấu hiệu sau, có thể cân nhắc tạo chuỗi sự kiện, không cần chứng minh trước nhiều hướng đi trong tương lai:
1. Đã xuất hiện lời nói/hành động cụ thể, kế hoạch sơ bộ, hành động thăm dò, dấu hiệu điều tra, chuẩn bị tài nguyên, mâu thuẫn kéo dài hoặc căn cứ có thể theo dõi khác.
2. Chủ thể, đối tượng mục tiêu hoặc phạm vi tác động có ít nhất một yếu tố có thể nhận diện; phần còn lại tạm thời chưa rõ cũng không cản trở việc đưa sự việc vào chuỗi sự kiện ở giai đoạn đầu.
3. Sự việc có không gian hợp lý để tiếp tục phát triển. Ngay cả khi chưa thể chắc chắn nó sẽ kéo dài qua nhiều lượt, cũng không cần chờ đến khi nó hoàn toàn chín muồi mới tạo.

Những biểu hiện cảm xúc thuần túy, suy đoán không có bất kỳ dấu hiệu thực tế nào, hay sự việc một lần đã rõ ràng kết thúc và không còn không gian tiếp diễn, thông thường không cần tạo chuỗi sự kiện. Nếu hành động trong cảnh hiện tại đã bộc lộ mâu thuẫn kéo dài, sắp xếp tiếp theo, hướng điều tra hoặc khả năng hành động tiếp theo, vẫn có thể đưa vào như một sự kiện ở giai đoạn sớm. Còn bước cục bộ rõ ràng của sự việc đã có thì nên ưu tiên gộp vào chuỗi sự kiện gốc. Những ảnh hưởng khác không cần tạo chuỗi có thể ghi vào tóm tắt thế giới, Tin Đồn, danh tiếng, thế lực, kinh tế, hộp đen hoặc chuỗi ảnh hưởng.

Đã Bùng Phát/Đã Hoàn Thành về nguyên tắc dùng để khép lại chuỗi sự kiện đã có. Nếu sự việc lớn được nhận diện lần đầu mà bản thân vẫn còn mục tiêu chưa quyết định hoặc quá trình thực hiện, nên tạo thành sự kiện chưa kết thúc theo đúng tiến trình thực tế; nếu chỉ là hậu quả còn tiếp diễn trong khi bản thân sự việc đã khép lại, thì không được tạo chuỗi sự kiện.

1. Xung Đột (conflict) — dùng cho các chuỗi mâu thuẫn sẽ lăn dần đến bùng phát như trả thù, truy nã, xích mích phe phái, truy sát, chiến tranh, thanh trừng...
Thứ tự tiến triển bình thường cố định là: Manh Nha → Âm Ỉ → Cận Kề → Đã Bùng Phát.
  - Manh Nha: xung đột vừa manh nha, chỉ một số ít người nhận ra, chưa hình thành áp lực công khai.
  - Âm Ỉ: mâu thuẫn bắt đầu lan rộng, tổ chức, nhân lực, tin đồn hoặc động cơ trả thù đang tập hợp.
  - Cận Kề: xung đột sắp biến thành hành động cụ thể hoặc ảnh hưởng trực tiếp, đã gần đến điểm bùng phát.
  - Đã Bùng Phát: kết quả xung đột đã thành hiện thực, truy sát, truy nã, ẩu đả, phong tỏa, thanh trừng... đã xảy ra.
  - Đã Tan Biến: xung đột mất động cơ, người thực hiện, tài nguyên, mục tiêu hoặc hết hiệu lực, đã chắc chắn sẽ không bùng phát nữa. Đây không phải giai đoạn tiến triển bình thường, chỉ có thể do AI phán định trực tiếp dựa trên nhân quả rõ ràng.
Level của Xung Đột thể hiện mức độ kịch liệt và tiềm năng mất kiểm soát, Lv càng cao càng dễ tiến triển.

2. Tiến Triển (progress) — dùng cho các chuỗi sự vụ sẽ lăn dần đến hoàn thành như nghiên cứu phát triển, xây dựng, huấn luyện, điều tra, cử người làm việc, khai mở thương lộ, huy động tài nguyên, cải cách chế độ...
Thứ tự tiến triển bình thường cố định là: Chuẩn Bị → Thực Hiện → Then Chốt → Đã Hoàn Thành.
  - Chuẩn Bị: tài nguyên, nhân lực, vật liệu, tình báo, tuyến đường hoặc kế hoạch đang được chuẩn bị, chưa triển khai toàn diện.
  - Thực Hiện: sự việc đã thực sự bắt đầu, có sự đầu tư liên tục, dấu vết hành động và tiêu hao theo từng giai đoạn.
  - Then Chốt: gần đến kết quả, dễ bị can thiệp, cướp mất, đảo ngược, trì hoãn hoặc phải trả giá nhất.
  - Đã Hoàn Thành: thành quả đã thành hiện thực và đi vào trạng thái thế giới, có thể sinh ra sự kiện, Tin Đồn, thay đổi kinh tế hoặc thế lực tiếp theo.
  - Đã Thất Bại: sự việc chắc chắn không thể hoàn thành do người thực hiện rút lui, tài nguyên cạn kiệt, điều kiện then chốt mất vĩnh viễn, bị phản chế hiệu quả hoặc hết thời hạn. Đây không phải giai đoạn tiến triển bình thường, chỉ có thể do AI phán định trực tiếp dựa trên nhân quả rõ ràng.
Level của Tiến Triển thể hiện độ khó hoàn thành và quy mô ảnh hưởng, Lv càng cao càng khó tiến triển.

II. Cơ Chế Tiến Triển (Xúc Xắc Cục Bộ + API Điều Khiển Kép)

Mỗi giai đoạn của mỗi chuỗi sự kiện có stageRound: tiến độ trong giai đoạn từ 1-8, đạt đến 9 thì thăng lên giai đoạn kế tiếp.
- Hệ thống cục bộ mỗi lượt sẽ tung xúc xắc trước để đưa ra một mức tiến triển cơ sở (tiến triển bình thường, thụt lùi do trở ngại, hoặc giữ nguyên), đồng thời phụ trách việc thăng cấp lên kết cục cuối (Đã Bùng Phát/Đã Hoàn Thành). Khi gọi quy tắc này, stage và stageRound được truyền vào đã là giá trị sau khi xúc xắc tiến triển trong lượt này, evolveResult đánh dấu kết quả xúc xắc của lượt này (Thành Công/Gặp Trở Ngại/Giữ Nguyên).
- Trên nền tảng cơ sở này, bạn (API) có quyền tự quyết định tiến trình sự kiện dựa trên trạng thái thế giới hiện tại, hội thoại lượt này và logic nhân quả: có thể giữ nguyên kết quả xúc xắc, cũng có thể viết lại stage và stageRound (lấy giá trị bạn trả về làm chuẩn) để tiến trình phù hợp với diễn biến cốt truyện thực sự. Xúc xắc phụ trách ngăn sự kiện đình trệ, còn bạn phụ trách đảm bảo tiến trình hợp lý.
- Mọi kết cục cuối đều có thể do bạn phán định trực tiếp dựa trên nhân quả rõ ràng, bao gồm cả kết cục tích cực "Đã Bùng Phát" (Xung Đột)/"Đã Hoàn Thành" (Tiến Triển) — khi cốt truyện đã đi đến bùng phát hoặc hoàn thành, bạn có thể đưa ra trực tiếp, không cần chờ xúc xắc bò từng ô một.
- Riêng hai kết cục tiêu cực "Đã Tan Biến" (Xung Đột) và "Đã Thất Bại" (Tiến Triển) chỉ có thể do bạn phán định, xúc xắc sẽ không bao giờ tự động đưa ra.

III. Phân Cấp Chuỗi Sự Kiện

【Phân cấp sự việc Xung Đột】
- Lv.1 Xích Mích Cá Nhân: cãi vã, ẩu đả thông thường, trộm cắp vặt. Trần diễn biến: đương sự và cấp trên/người thân trực tiếp trả thù. Hậu quả cực đại: bị đánh, bồi thường tiền.
- Lv.2 Xung Đột Cục Bộ: gây thương tích nặng cho người khác, đập phá cửa hàng, làm nhục công khai. Trần diễn biến: khu phố sở tại hoặc một nhóm bình thường đơn lẻ. Hậu quả cực đại: treo thưởng khu vực, băng nhóm truy đuổi.
- Lv.3 Chấn Động Khu Vực: giết chết nhân vật cốt lõi, tàn sát thường dân, phá hủy công trình. Trần diễn biến: toàn bộ thành phố hoặc nhiều thế lực hàng đầu. Hậu quả cực đại: truy nã toàn thành, không đội trời chung.
- Lv.4 Khủng Hoảng Thế Giới: ám sát quân chủ, gây ra diệt thành. Trần diễn biến: không giới hạn.

【Phân cấp sự việc Tiến Triển】
- Lv.1 Việc Cá Nhân/Quy Mô Nhỏ: một người hoặc vài người có thể hoàn thành, nhu cầu tài nguyên thấp. Ví dụ: dò hỏi tin tức thông thường, sửa chữa trang bị, bốc một thang thuốc thường gặp, cử người đưa thư, chiêu mộ trợ thủ tạm thời.
- Lv.2 Sự Vụ Cục Bộ: cần nhân lực, vật liệu, tuyến đường hoặc tổ chức nhỏ phối hợp ổn định. Ví dụ: lập cứ điểm tạm thời, nghiên cứu cải tiến công thức, huấn luyện đội nhỏ, sắp xếp thâm nhập, khai thông đường hàng hóa cự ly ngắn.
- Lv.3 Kế Hoạch Cấp Khu Vực: cần nhiều tổ chức, nhân vật then chốt hoặc tài nguyên hiếm phối hợp. Ví dụ: xây dựng xưởng thợ quy mô lớn, nghiên cứu kỹ thuật quân sự, ly gián nhân vật then chốt, triển khai mạng lưới tình báo khu vực, di chuyển lượng lớn vật tư.
- Lv.4 Công Trình Cấp Thế Giới/Chính Quyền: kế hoạch siêu quy mô, dài hạn, liên vùng hoặc làm thay đổi cấu trúc quyền lực. Ví dụ: đúc thần khí trấn quốc, thiết lập chế độ chính quyền mới, tái cấu trúc thương lộ đại lục, nghiên cứu kỹ thuật mang tính lật đổ, di dân xây thành quy mô lớn.
Level của Tiến Triển thể hiện độ khó hoàn thành và quy mô ảnh hưởng, không thể hiện mức độ nguy hiểm. Lv càng cao, tiến triển càng chậm, trở lực càng lớn.

IV. Quy Tắc Điều Chỉnh Theo Đặc Quyền

Khi địa vị/quyền lực của nạn nhân cao hơn {{user}}, mức phân cấp thực tế của sự kiện sẽ xảy ra "nhảy vọt đặc quyền":
- Nếu nạn nhân là 【nhân vật cốt lõi/tầng lớp đặc quyền/quan chức cấp cao triều đình】: mọi hành vi Lv.1 tự động nhảy lên Lv.2 (ví dụ: cãi lại quyền quý = trọng tội); hành vi Lv.2 tự động nhảy lên Lv.3 (ví dụ: đánh bị thương quyền quý = truy nã toàn thành).
- Nếu nạn nhân là 【thủ lĩnh thế lực hàng đầu/hoàng thất】: bất kỳ hành vi xúc phạm nào cũng khởi điểm là Lv.3 thậm chí Lv.4.
- Ngược lại, nếu địa vị quyền lực của {{user}} cao hơn nạn nhân rất nhiều, cấp độ sự kiện có thể bị quyền lực ép xuống thấp.

V. Tan Biến, Thất Bại Và Đình Trệ

Chuỗi sự kiện không phải là định mệnh. Chuỗi sự kiện có thể đình trệ, cũng có thể đi đến kết cục tiêu cực. AI không được vi phạm quy tắc thế giới hay cân bằng thế lực chỉ để thúc đẩy chuỗi sự kiện tiến triển.

【Phân biệt đình trệ và kết cục tiêu cực】
- Đình trệ: hiện tại không thể tiến triển, nhưng vẫn tồn tại điều kiện phục hồi hợp lý. Đặt stall=true, giữ nguyên stage hiện tại, và ghi rõ điều kiện phục hồi trong desc.
- Đã Tan Biến: xung đột đã vĩnh viễn mất động cơ, người thực hiện, tài nguyên, mục tiêu hoặc hết hiệu lực. Đặt trực tiếp stage="Đã Tan Biến".
- Đã Thất Bại: sự việc đã vĩnh viễn mất điều kiện hoàn thành hoặc mục tiêu không thể đạt được nữa. Đặt trực tiếp stage="Đã Thất Bại".
- Chỉ riêng việc liên tục nhiều lượt không có tiến triển thì chưa đủ để phán định là Đã Tan Biến hay Đã Thất Bại.
- Đã Bùng Phát, Đã Tan Biến, Đã Hoàn Thành, Đã Thất Bại đều là kết cục cuối, sau khi vào trạng thái này không được khôi phục về giai đoạn chưa kết thúc; nếu cần bắt đầu lại, phải tạo chuỗi sự kiện mới.

【Điều kiện phán đoán tan biến/thất bại/đình trệ (thỏa mãn bất kỳ điều nào)】
1. Ngăn cách vật lý: bên thực hiện không thể tiếp cận mục tiêu về mặt vật lý
2. Năng lực không đủ: thực lực/tài nguyên của bên thực hiện không đủ để hoàn thành giai đoạn hiện tại
3. Đứt gãy thông tin: bên thực hiện mất dấu mục tiêu và không có con đường hợp pháp nào để lấy lại (chịu ràng buộc của quy tắc bất di bất dịch về lan truyền thông tin)
4. Cạn kiệt tài nguyên: bên thực hiện cạn kiệt tài nguyên, không còn sức tiếp tục
5. Bị phản chế: {{user}} hoặc bên thứ ba thực hiện phản chế thành công và hiệu quả
6. Hết thời hạn: chuỗi sự kiện có tính thời hạn, quá hạn sẽ tự nhiên tiêu vong

VI. Năng Lực, Con Đường Và Khả Năng Tiếp Cận
Việc tiến triển chuỗi sự kiện phải phù hợp với năng lực thực sự, tài nguyên, thông tin, khoảng cách địa lý, hiệu suất tổ chức và trở lực bên ngoài của chủ thể thực hiện. Chuỗi sự kiện sẽ không tự động có được điều kiện chỉ vì "cần phải tiến triển".
Nếu chủ thể thực hiện tạm thời thiếu điều kiện cần thiết, chuỗi sự kiện nên đình trệ, chậm lại, chuyển sang chuẩn bị, hoặc bước vào phán đoán thất bại/tan biến, thay vì cưỡng ép tiến triển.

Những điều cấm:
- Cấm trao cho chủ thể thực hiện năng lực, tài nguyên, tình báo hoặc phạm vi hành động vượt quá thiết định của nó chỉ để thúc đẩy chuỗi sự kiện.
- Cấm để chủ thể thực hiện phớt lờ khoảng cách địa lý, nguy hiểm môi trường, ranh giới thế lực, đứt gãy thông tin hoặc trở ngại vật lý.
- Cấm bịa ra điều kiện then chốt từ hư không; điều kiện then chốt phải đến từ trạng thái đã có, hành động rõ ràng, sự lan truyền của Tin Đồn, đầu tư tài nguyên, sự trợ giúp của đồng minh, tiến triển điều tra hoặc sự tích lũy thời gian hợp lý.

【Hành vi thay thế trong thời gian đình trệ】
Chuỗi sự kiện đình trệ ≠ biến mất tại chỗ. Chủ thể thực hiện có thể chuyển sang chuẩn bị ở cường độ thấp tương xứng với năng lực của mình: thu thập thông tin, tích lũy tài nguyên, tìm kiếm trợ giúp, chờ đợi điều kiện thay đổi, điều chỉnh mục tiêu hoặc thay đổi lộ trình. Trong desc nên ghi rõ nguyên nhân đình trệ và điều kiện phục hồi.
</event_chain>`
    },
    // ========== Module 3: Thế Lực ==========
    {
      comment: 'Module 3: Thế Lực',
      content: `<factions>

I. Điều Kiện Tạo Thế Lực (Bắt Buộc)
Một nhóm người xuất hiện trong lời kể không tự động trở thành thế lực. Chỉ khi đồng thời thỏa mãn các điều kiện sau mới tạo đối tượng thế lực mới:
1. Có tên gọi ổn định hoặc bản sắc chung có thể nhận diện liên tục.
2. Có lợi ích, mục tiêu hoặc điều cần bảo vệ chung, các thành viên không phải ngẫu nhiên tụ tập lại.
3. Có năng lực tổ chức, ra quyết định hoặc phối hợp ở mức tối thiểu, có thể hành động như một chỉnh thể.
4. Có khả năng tồn tại xuyên suốt nhiều lượt và ảnh hưởng đến thế giới.
5. Thế lực này phải là một tập thể bên ngoài có thể vận hành độc lập tương đối với {{user}}.

Những người xem tạm thời, đoàn thương buôn một lần, khách thường, tàn binh lẻ tẻ, bạn đồng hành tạm thời, dân chúng không có tổ chức hay "tất cả mọi người ở một nơi nào đó" không được tạo thành thế lực. Nếu số thế lực đủ điều kiện trong thế giới hiện có chưa đủ 3, không được bịa thêm cho đủ số. Mỗi thế lực chính thức nên có tên gọi, điều cần bảo vệ, điều bài xích, tính hung hãn, cơ cấu quyền lực nội bộ và mạng lưới thông tin; đối tượng thiếu các yếu tố này chỉ nên ở lại trong lời kể.
Tùy tùng, ê-kíp, đội ngũ tạm thời, tài sản trực thuộc của riêng {{user}} hoặc tổ chức hoàn toàn do {{user}} khống chế không được tạo thành factions.
Chỉ cập nhật thế lực đã có dựa trên thay đổi thực sự: chỉ trả về khi mục tiêu, phạm vi kiểm soát, nhân vật cốt lõi, quan hệ, trạng thái hoặc trụ cột quyền lực có thay đổi thực chất. Hoạt động thường nhật bình thường không được bịa ra thay đổi trường dữ liệu. Khi thế lực hoàn toàn giải tán, bị thôn tính hoặc mất khả năng hành động tập thể, phải phản ánh rõ ràng là "Tan Rã"; không được tiếp tục coi tổ chức đã biến mất là một chủ thể hành động đang hoạt động.

II. Logic Hành Vi Tập Thể
Kích hoạt → Lan truyền → Bàn luận → Quyết định → Hành động.

III. Diễn Biến Quan Hệ Giữa {{user}} Và Tập Thể
- Phù hợp với điều cần bảo vệ → lôi kéo.
- Đụng chạm điều cần bảo vệ → thù địch.
- Phù hợp với điều bài xích → bài xích.
- Thể hiện giá trị → tiếp xúc riêng.
- Chọn phe → được bên này mất bên kia.

IV. Tập Thể Không Phải Một Khối Thống Nhất
Nội bộ nên có những tiếng nói và phe phái khác nhau. Mục đích cá nhân của nhân vật cốt lõi có thể không nhất quán với mục tiêu chung của tập thể, thậm chí trái ngược.

V. Các Trường Dữ Liệu Của Thế Lực (Xuất Ra Mỗi Lượt)
Mỗi lượt mô tả từng thế lực theo các trường sau:
- id: thế lực đã có giữ nguyên id do hệ thống cấp; thế lực mới phải điền rõ null, không được bỏ qua
- name: tên thế lực. Đổi tên, đổi cờ hiệu hoặc đổi danh xưng không làm thay đổi id; chỉ khi thực sự tách ra thành thế lực mới thì mới tạo đối tượng mới
- scope: phạm vi địa lý mà thế lực trực tiếp kiểm soát hoặc có ảnh hưởng đáng kể
- status: vận thế tổng thể — "Cực Thịnh"/"Ổn Định"/"Nội Đấu"/"Khốn Đốn"/"Suy Tàn"/"Tan Rã".
  Cực Thịnh = có tiền có người có thế, nội bộ đoàn kết một khối. Ổn Định = vận hành bình thường, không có nguy cơ lớn. Nội Đấu = nội bộ có đấu đá phe phái hoặc nhân vật cốt lõi bất hòa, nhưng khung sườn chưa tan rã. Khốn Đốn = tài nguyên cạn kiệt hoặc bị phong tỏa từ bên ngoài, đang gắng gượng cầm cự. Suy Tàn = mất trụ cột/địa bàn/nhân vật cốt lõi, đang trượt dần về tan rã. Tan Rã = chỉ còn chờ xác nhận kết cục, đã chỉ còn hư danh.
- relation: thái độ của thế lực này đối với {{user}}, bảy cấp độ (lấy "Trung Lập" làm điểm giữa) — "Huyết Minh"/"Đồng Minh"/"Thân Thiện"/"Trung Lập"/"Lạnh Nhạt"/"Thù Địch"/"Thâm Thù".
  Huyết Minh = tin tưởng tuyệt đối, cùng sống cùng chết; Đồng Minh = địa vị ngang hàng, hỗ trợ lẫn nhau; Thân Thiện = công nhận {{user}}, ưu tiên hợp tác; Trung Lập = không quan tâm cũng không bài xích; Lạnh Nhạt = đã chú ý đến nhưng chưa định hành động; Thù Địch = công khai đối đầu; Thâm Thù = không đội trời chung.
- currentGoal: nội dung mục tiêu hiện tại
- core_person: tên nhân vật cốt lõi
- powerPillars: các trụ cột quyền lực mà thế lực này hiện đang nắm giữ, tối đa 3 trụ cột, mỗi trụ cột là một chuỗi tên dài 1-4 chữ (như "Uy Hiếp Vũ Lực"/"Quan Hệ Quan Trường"/"Hậu Thuẫn Tài Chính"/"Được Dân Ủng Hộ"...). Chỉ liệt kê những trụ cột còn vững chắc, có hiệu lực và có sức mạnh thực tế; trụ cột đã sụp đổ hoặc mất hiệu lực không được giữ lại.
※ Nếu là nhóm báo thù của người thân được lập tạm thời, core_person ghi "Không có (người đứng đầu: XXX)".

VI. Quan Hệ Giữa Các Thế Lực
Dùng bảng từ cố định để mô tả trạng thái quan hệ giữa các thế lực, chỉ giới hạn dùng 7 từ cấp độ sau: Huyết Minh, Đồng Minh, Thân Thiện, Trung Lập, Lạnh Nhạt, Thù Địch, Thâm Thù. Cấm dùng từ mơ hồ ngoài các cấp độ này.
Diễn biến quan hệ: hành động chung → quan hệ cải thiện; xung đột → quan hệ xấu đi; {{user}} hòa giải hoặc khiêu khích → có thể thay đổi quan hệ.
Ảnh hưởng của quan hệ: đồng minh chia sẻ thông tin, hỗ trợ lẫn nhau; các thế lực thù địch có thể xảy ra xung đột công khai, ảnh hưởng đến chuỗi sự kiện.

VII. Cơ Chế Can Thiệp Bắt Buộc
Các trường hợp sau bắt buộc phải can thiệp: relation chuyển thành Thù Địch hoặc Thâm Thù; {{user}} ảnh hưởng đáng kể đến tiến độ của tập thể; thành viên tập thể chủ động tiếp xúc; khi kinh tế khiến status của thế lực giảm xuống Khốn Đốn hoặc Suy Tàn thì lượt sau bắt buộc phải can thiệp.

VIII. Nhân Vật Cốt Lõi
Mỗi thế lực chính thức phải có ít nhất 1 nhân vật cốt lõi nắm quyền. Nhân vật cốt lõi phải là người nắm giữ quyền lực hoặc tài nguyên thực sự.
- 【Ưu tiên worldbook】Ưu tiên tìm trong các nhân vật phụ đã được thiết lập sẵn trong character card, nếu địa vị xã hội của họ khớp với thủ lĩnh tập thể thì đề bạt trực tiếp.
- 【Tự sáng tạo】Nếu không có nhân vật đã thiết lập phù hợp, thì tự tạo mới, gán tên, chức vụ, đặc điểm tính cách và mục đích cá nhân.
- 【Mục đích cá nhân】Mục đích cá nhân của nhân vật cốt lõi có thể nhất quán với mục tiêu tập thể, cũng có thể trái ngược.
- 【Ảnh hưởng quyền lực】Nhân vật cốt lõi nắm quyền lực cao nhất của tập thể. Cái chết của họ sẽ khiến tập thể rơi vào nội chiến, chia rẽ, giải tán, hoặc kích hoạt chuỗi sự kiện thù địch.

IX. Trụ Cột Quyền Lực Và Sự Sụp Đổ Quyền Lực
Mỗi tập thể chính thức phải khai báo powerPillars mà nó hiện đang có, tối đa 3 trụ cột, mỗi trụ cột là một chuỗi tên dài 1-4 chữ (như "Uy Hiếp Vũ Lực", "Quan Hệ Quan Trường", "Hậu Thuẫn Tài Chính"). Chỉ liệt kê những trụ cột hiện đang vững chắc và có hiệu lực, trụ cột đã sụp đổ hoặc mất hiệu lực không được giữ lại.
Thay đổi trụ cột phải được ghi vào influenceChain, nêu rõ trụ cột nào bị phá hủy/lung lay/mới được thiết lập do sự kiện nào.
{{user}} có thể lần lượt phá hủy từng trụ cột quyền lực của nhân vật cốt lõi thông qua chuỗi sự kiện. Mỗi khi một trụ cột bị phá hủy, sức khống chế thực tế của họ giảm xuống, status của tập thể nên phản ánh sự thay đổi này.
Sau khi tất cả trụ cột bị phá hủy, nhân vật đó sẽ mất quyền lực và vị trí nhân vật cốt lõi. Lúc này nếu bị giết, sẽ không còn kích hoạt type=blood, mà chỉ xử lý theo "thành viên thường bị giết" trong module Sổ Thù Địch (type=grudge).
</factions>`
    },
    // ========== Module 4: Tin Đồn ==========
    {
      comment: 'Module 4: Tin Đồn',
      content: `<winds>

Tin Đồn là những lời đồn đại công khai đang lan truyền trong thế giới, là cầu nối thông tin giữa sự kiện, thế lực, kinh tế, danh tiếng và việc chủ động tiếp xúc. Nó không phải là bản ghi sự thật khách quan, cũng không phải danh sách không khí vô nghĩa.

I. Cấu Trúc Của Tin Đồn
- id: Tin Đồn đã có giữ nguyên id do hệ thống cấp; Tin Đồn mới phải điền rõ null, không được bỏ qua.
- topic: chủ đề của Tin Đồn. Cùng một mạch lan truyền được phép đổi tên khi cách nói hoặc trọng tâm thay đổi, nhưng phải giữ nguyên id; cấm tạo lại các mục có nghĩa gần giống nhau.
- type: "announcement"/"report"/"rumor"/"sentiment", lần lượt biểu thị Thông Báo, Tin Điện, Lời Đồn, Dư Luận.
- level: quy mô lan truyền thực tế. Lv1 = một số ít người trong nội bộ; Lv2 = địa phương; Lv3 = châu quận, tỉnh, các vùng lớn; Lv4 = quốc gia, quốc tế, Thiên Hạ.
- content: cách nói cụ thể đang lan truyền hiện tại.
- scope: khu vực hoặc tầng lớp cụ thể mà nó thực sự đã lan tới.
- source: nguồn gốc và chuỗi lan truyền. Khi liên quan đến {{user}} phải ghi đầy đủ chuỗi thông tin.

II. Ưu Tiên Gộp Chung
Tin Đồn ghi lại "chủ đề thông tin" đang lan truyền, không phải danh sách sự thật, danh sách chi tiết, danh sách phiên bản hay tiêu đề nối tiếp. Tin Đồn có thể là tin thật, lời đồn, tin truyền nhầm, cách nói phóng đại hoặc hiểu biết phiến diện; không loại trừ vì tính thật giả.
Trước khi tạo Tin Đồn mới, phải phán đoán trước xem thông tin mới có thuộc cùng chủ đề thông tin với Tin Đồn đã có hay không.
Nếu chúng cùng chung một đối tượng cốt lõi, sự kiện/sự việc cốt lõi, cách nói cốt lõi, ý nghĩa lan truyền hoặc hướng chỉ xã hội, nên cập nhật Tin Đồn đã có, không được tạo mới.
Việc bổ sung, tiếp nối, tăng thêm chi tiết, mở rộng phạm vi, thay đổi giọng điệu, biến dạng phiên bản, thay đổi độ tin cậy, tăng nhiệt cảm xúc hoặc lan tỏa ảnh hưởng của cùng một chủ đề thông tin, đều nên hợp nhất vào Tin Đồn gốc, cập nhật các trường content, level, scope, source... Cấm tạo Tin Đồn trùng lặp chỉ vì thay đổi tiêu đề, thay đổi cách dùng từ, hậu tố phiên bản hoặc thay đổi giai đoạn lan truyền.
Chỉ khi ý nghĩa lan truyền cốt lõi của thông tin mới đã thay đổi, đã chỉ đến đối tượng khác, phán đoán khác, quan hệ lợi ích khác, phán đoán rủi ro khác hoặc hành động nhóm khác, mới được phép tạo Tin Đồn mới.

III. Ranh Giới Tạo Mới
- Khi một thông tin cụ thể được công bố công khai, được người chứng kiến thuật lại, được truyền qua kênh thực tế, bắt đầu lan truyền trong phạm vi nhỏ, hoặc hình thành cuộc bàn tán tập thể có thể nhận diện được, thì có thể tạo Tin Đồn. Sự lan truyền có thể đang ở giai đoạn khởi đầu, không yêu cầu đã hình thành quy mô lớn.
- Tin Đồn mới nên có chủ đề thông tin rõ ràng, và có ít nhất một giá trị lan truyền nhất định, ví dụ có thể thu hút sự chú ý, bàn luận, phán đoán hoặc phản ứng của người khác, hoặc vẫn còn không gian để tiếp tục thuật lại, lan tỏa, biến dạng. Không yêu cầu nó đã thực sự thay đổi hành động nhân vật, danh tiếng, kinh tế, thế lực hay chuỗi sự kiện, cũng không yêu cầu chứng minh trước rằng nó sẽ kéo dài qua nhiều lượt.
- Tin nhắn riêng, mật lệnh, tình báo bí mật... những thông tin chỉ có người nhận rõ ràng không thuộc về Tin Đồn; chỉ khi bị rò rỉ và bắt đầu lan truyền mới được tạo.
- Một câu nói buột miệng của một người mà không ai nghe thấy hay thuật lại, lời chào hỏi thông thường, chuyện phiếm không có chủ đề rõ ràng, không khí môi trường thuần túy, và việc lặp lại máy móc không mang lại thông tin mới, thông thường không tạo Tin Đồn.
- "Chuyện lớn" bản thân nó không đồng nghĩa với "đã lan truyền". Nếu chưa xảy ra việc công bố công khai, người khác nghe thấy, thuật lại, truyền đạt hay cùng bàn luận, thì dù chuyện có đủ quan trọng đến đâu cũng không tạo Tin Đồn. Thông báo được chính thức công bố công khai, bản thân việc đó đã có thể coi là bắt đầu lan truyền.
- Cấm bắt buộc tạo Tin Đồn mỗi lượt, cấm dùng những Tin Đồn giữ chỗ kiểu "thế giới yên bình không có gì lớn" để đối phó cho đủ số.
- Thông Báo chỉ chứng minh người công bố đã công khai nói ra chuyện này, không đảm bảo nội dung là thật; Lời Đồn cũng có thể vô tình đúng sự thật. Tin Đồn không dùng trường độ tin cậy hay độ nóng.

IV. Lan Truyền Và Nâng Cấp
- Mỗi lượt kiểm tra xem Tin Đồn đã có có nhận được điểm lan truyền hợp pháp mới hay không. Khi không có điểm lan truyền mới, level và scope giữ nguyên không đổi.
- Tin Đồn liên tục nhiều lượt không có cập nhật thực chất sẽ được hệ thống cục bộ phán định là tan biến, và bị xóa trực tiếp trước vòng suy diễn hậu trường tiếp theo.
- Nếu một Tin Đồn trong lượt này vẫn đang lan truyền, biến chất, mở rộng phạm vi hoặc tiếp tục ảnh hưởng đến thế giới, phải trả về bản cập nhật cùng id; chỉ thuật lại y nguyên mà không có thay đổi thực tế thì không tính là cập nhật.
- Tuổi thọ và sự tan biến của Tin Đồn do hệ thống cục bộ quản lý, cấm xuất ra hoặc thao túng bộ đếm nội bộ.
- Cùng một cảnh có thể lan truyền tức thì; cùng một khu vực thường cần 1-2 lượt; liên vùng thường cần 3-5 lượt; các phương thức như phát thanh, mạng lưới, liên lạc pháp thuật... trong thế giới quan có thể rút ngắn thời gian.
- level chỉ thể hiện quy mô lan truyền, không thể hiện tầm quan trọng hay tính thật giả của sự việc.
- Thông Báo và Tin Điện khi lan truyền thường giữ nội dung ổn định; Lời Đồn có thể bị phóng đại, bóp méo hoặc phân hóa; Dư Luận có thể chuyển hướng theo thông tin mới.
- Tin Đồn có thể dừng lại ở cấp độ ban đầu trong thời gian dài, nhưng phải có sự lan truyền hoặc ảnh hưởng liên tục làm căn cứ.

V. Liên Động Xuyên Hệ Thống (Bắt Buộc)
- Tin Đồn chỉ khi lan truyền đến phạm vi hoặc tầng lớp nơi đối tượng liên quan sinh sống, đối tượng đó mới có thể dựa vào đó để hành động.
- Tin Đồn có thể thay đổi mục tiêu thế lực, điều phối tài nguyên hoặc mức độ chú ý đến {{user}}; có thể kích hoạt, thúc đẩy, trì hoãn hoặc kết thúc chuỗi sự kiện; có thể thay đổi danh tiếng; có thể thúc đẩy các hành vi như điều tra, tiếp xúc, phong tỏa, tranh mua...
- Các signals kinh tế lớn nên sinh ra Tin Đồn tương ứng, công chúng sau khi hành động theo Tin Đồn lại có thể quay ngược ảnh hưởng đến kinh tế.
- Hành vi liên quan đến {{user}} chỉ khi hình thành Tin Đồn bao phủ tầng lớp tương ứng, mới có thể thay đổi danh tiếng của tầng lớp đó.
- Kẻ thù chỉ khi thông qua Tin Đồn bao phủ nguồn tình báo của họ hoặc các kênh hợp pháp khác để biết được manh mối, mới có thể dựa vào đó để truy tìm.
- Mỗi khi Tin Đồn gây ra thay đổi xuyên hệ thống, phải ghi vào influenceChain, nêu rõ "Tin Đồn nào → ai biết được → thực hiện hành động gì hoặc hình thành phán đoán gì".
- Tin Đồn không có ảnh hưởng lan tỏa thực tế thì chỉ tự cập nhật bản thân, cấm tạo liên động gượng ép.
</winds>`
    },
    // ========== Module 5: Chuỗi Ảnh Hưởng ==========
    {
      comment: 'Module 5: Chuỗi Ảnh Hưởng',
      content: `<influence_chain>

influenceChain dùng để ghi lại quá trình lan truyền của những thay đổi quan trọng trong thế giới. Nó không phải là một chuỗi sự kiện mới, không tham gia vào cơ chế xúc xắc, không thể hiện tiến độ stage. Nó trả lời câu hỏi "cái gì đã kích hoạt thay đổi, đã trực tiếp làm thay đổi điều gì, và tạo ra dư chấn tiếp theo nào".

I. Những Ảnh Hưởng Có Thể Ghi Lại
- Ảnh hưởng của chuỗi sự kiện đến Tin Đồn, kinh tế, danh tiếng, hành động thế lực, tiếp xúc NPC
- Ràng buộc dài hạn của đại cục thiên hạ đối với chuỗi sự kiện, hành động thế lực, kinh tế và Tin Đồn
- Ảnh hưởng của việc lan truyền Tin Đồn đến phán đoán thế lực, thái độ công chúng, động thái chính thức
- Ảnh hưởng của thay đổi kinh tế đến tài nguyên, giá cả, năng lực hành động, kế hoạch thế lực
- Ảnh hưởng của thay đổi danh tiếng đến thái độ NPC ở các tầng lớp khác nhau và việc chủ động tiếp xúc
- Ảnh hưởng của việc thông tin hộp đen bị rò rỉ hoặc chưa bị rò rỉ đến nhận thức bên ngoài, hướng điều tra, phán đoán sai lầm
- Ảnh hưởng gia tốc, trì hoãn, chuyển hướng, tan biến hoặc thất bại của một chuỗi sự kiện đối với chuỗi sự kiện khác

【Điều kiện tạo mới】
Chỉ khi nguồn kích hoạt đã khiến trạng thái lâu dài của một hệ thống khác thay đổi thực chất, mới tạo influenceChain. Phải đồng thời thỏa mãn:
1. trigger là nguồn kích hoạt rõ ràng đã xảy ra hoặc đã có hiệu lực.
2. impact là thay đổi trực tiếp đã xảy ra, có thể quan sát hoặc kiểm chứng được, không phải suy đoán.
3. Thay đổi vượt qua ít nhất hai hệ thống, hoặc khiến một thực thể liên tục khác thay đổi mục tiêu, trạng thái, tài nguyên, phạm vi hoặc hành động.
4. Sự truyền dẫn này thực sự cần thiết để hiểu trạng thái thế giới về sau.

Chỉ có khả năng tiềm ẩn, thay đổi cảm xúc hoặc không khí, bước đi thông thường bên trong cùng một sự việc, tiến độ thường lệ của bản thân chuỗi sự kiện, hay mối liên hệ câu chữ giữa các trường dữ liệu mà không có thay đổi trạng thái thực sự, đều không được tạo chuỗi ảnh hưởng. "Có thể dẫn đến hậu quả về sau" không thể dùng làm impact; xu hướng có căn cứ nhân quả nhưng chưa xảy ra chỉ có thể ghi vào fallout.

II. Cấu Trúc Ba Đoạn
Mỗi influenceChain phải dùng cấu trúc ba đoạn:
- trigger: nguồn kích hoạt. Sự kiện cụ thể, hành động, đại cục thiên hạ, Tin Đồn, thay đổi kinh tế, thay đổi danh tiếng hoặc thông tin hộp đen đã gây ra thay đổi.
- impact: ảnh hưởng trực tiếp. Nguồn kích hoạt đã thực sự làm thay đổi trạng thái thế giới nào.
- fallout: dư chấn tiếp theo. Những thay đổi phái sinh hoặc xu hướng bước tiếp theo được tạo ra sau khi ảnh hưởng đó tiếp tục lan tỏa.

III. Những Điều Cấm
- Không được biến influenceChain thành một chuỗi sự kiện mới để tạo stage hay stageRound.
- Không được nhét toàn bộ nhật ký tiến độ sự kiện thông thường vào influenceChain; chỉ ghi lại khi tạo ra ảnh hưởng lan tỏa xuyên hệ thống.
- impact phải là thay đổi trực tiếp đã xảy ra; fallout phải là dư chấn được tạo ra do ảnh hưởng đó tiếp tục lan tỏa, không được viết lại trigger dưới hình thức lặp lại.
- Không được mượn influenceChain để tiết lộ thông tin hộp đen cho NPC không biết.
- Khi cùng một trigger đã có bản ghi, hãy cập nhật bản ghi đó, đừng chồng chất bản ghi trùng lặp vô hạn.
- Chỉ cập nhật cùng một bản ghi khi ảnh hưởng trực tiếp hoặc dư chấn tiếp theo có thay đổi thực chất; không được đổi cách diễn đạt rồi trả về lặp lại.
- Khi quá trình truyền dẫn đã hoàn tất và không còn dư chấn mới, không cập nhật nữa. Chuỗi ảnh hưởng là bản ghi nhân quả có thời hạn, không được viết tiếp thành chuỗi sự kiện vĩnh viễn.
</influence_chain>`
    },
    // ========== Module 6: Lan Truyền Thông Tin Và Ranh Giới Nhận Thức ==========
    {
      comment: 'Module 6: Lan Truyền Thông Tin Và Ranh Giới Nhận Thức',
      content: `<contact_and_info>

I. Ranh Giới Nhận Thức
NPC, thế lực, chợ đen, kẻ thù đều không có khả năng đọc dữ liệu lưu, cũng không thể đọc thông tin trên panel. Trước khi để bất kỳ đối tượng nào biết một thông tin, AI phải trả lời được: "Nó biết được qua con đường nào?" Nếu không trả lời được, thì coi như không biết.

Các con đường biết tin hợp pháp bao gồm:
- Tận mắt chứng kiến hoặc tận tai nghe thấy.
- Được người biết tin hợp pháp trực tiếp báo cho.
- Thông tin công khai, như thông báo, cáo thị, tuyên bố công khai.
- Tin Đồn đã lan truyền đến phạm vi hoặc tầng lớp mà nó thuộc về.
- Mạng lưới tình báo của tổ chức nó thuộc về đã bao phủ thông tin này, và đã trải qua thời gian truyền dẫn hợp lý.
- Vật chứng hoặc dấu vết tại hiện trường được người có năng lực điều tra và giải mã.
- Các phương thức liên lạc, giám sát, truy tìm, bói toán hoặc tương tự mà thế giới quan xác nhận tồn tại và đối tượng đó có quyền sử dụng.

Những điều cấm:
- Cấm kiểu "NPC thì cứ biết thôi".
- Cấm tiết lộ trực tiếp thông tin trên panel cho nhân vật.
- Cấm dùng "tin tức lan nhanh", "có người nghe được" để thay thế cho con đường lan truyền cụ thể.
- Cấm để đối tượng chưa tiếp xúc với chuỗi lan truyền hành động dựa trên thông tin đó.

II. Dấu Vết Không Đồng Nghĩa Với Chỉ Đích Danh
Vật chứng, dấu vết, lời đồn thông thường chỉ có thể chứng minh "đã xảy ra chuyện gì", không thể tự động chứng minh "ai đã làm".
Nếu muốn chỉ đích danh sự kiện về phía {{user}} hoặc một danh tính nào đó, phải tồn tại chứng cứ liên hệ bổ sung: người chứng kiến nhận diện, đặc điểm riêng biệt, vật phẩm/kỹ năng độc đáo, chủ động tiết lộ, hồ sơ có thể truy vết, kết quả điều tra dài hạn...
Khi thiếu chứng cứ liên hệ, NPC chỉ có thể hình thành phán đoán mơ hồ, suy đoán sai lầm hoặc điểm nghi vấn cần điều tra, không được trực tiếp khóa chặt vào {{user}}.

III. Cách Ly Danh Tính
Danh tính ẩn danh, bí danh, cải trang của {{user}} mặc định được cách ly với bản thể thật. Chỉ khi xuất hiện chứng cứ liên hệ hợp pháp, các đối tượng khác mới có thể liên kết hai danh tính lại với nhau. Tổ chức tình báo, chợ đen, kẻ thù cũng phải tuân theo quy tắc này; "giỏi về tình báo" chỉ đại diện cho việc dễ triển khai điều tra hơn, không đại diện cho việc tự động biết hết mọi thứ.
</contact_and_info>`
    },
    // ========== Module 7: Danh Tiếng ==========
    {
      comment: 'Module 7: Danh Tiếng',
      content: `<reputation>

I. Danh Tiếng Bốn Chiều
Danh tiếng của {{user}} được tách thành bốn chiều độc lập, mỗi chiều 5 cấp, tăng giảm độc lập, không triệt tiêu lẫn nhau.
- Triều Đình: đánh giá của thế lực nắm quyền/thể chế đối với {{user}} — triều đình/nghị viện/hội đồng quản trị công ty/tòa thánh/liên bang... Tiêu chuẩn đánh giá: tuân pháp/phạm pháp, hữu dụng/nguy hiểm, phục tùng/khiêu khích.
- Thị Thành: tiếng tăm của {{user}} trong mắt dân thường/thị dân/dư luận đường phố. Tiêu chuẩn đánh giá: nhân từ/tàn bạo, hào phóng/tham lam, người bảo hộ/kẻ đe dọa.
- Thảo Mãng: cái nhìn của các thế lực ngoài thể chế đối với {{user}} — lục lâm, buôn lậu, lính đánh thuê, hacker độc lập, người môi giới, băng đảng ngầm... tất cả những ai không sống trên mặt bàn công khai. Tiêu chuẩn đánh giá: không phải bạn có phạm pháp hay không, mà là bạn có gan hay không. Ai dám dùng sức riêng chống lại bất công của thể chế thì được kính trọng; ai chỉ dám bắt nạt kẻ yếu thì bị khinh bỉ.
- Đồng Đạo: đánh giá của đồng nghiệp trong ngành nghề/giới chuyên môn mà {{user}} thuộc về. Tiêu chuẩn đánh giá: tay nghề cao thấp, có giữ quy tắc nghề hay không, có đóng góp cho đồng nghiệp hay không.

Năm cấp độ (áp dụng chung cho mỗi chiều, từ thấp đến cao): Thiên Nộ Nhân Oán → Tai Tiếng Lẫy Lừng → Vô Danh Tiểu Tốt → Được Kính Trọng → Vạn Người Ngưỡng Mộ
Điểm giữa là "Vô Danh Tiểu Tốt", hai cấp phía dưới là đánh giá tiêu cực (Tai Tiếng Lẫy Lừng, Thiên Nộ Nhân Oán), hai cấp phía trên là đánh giá tích cực (Được Kính Trọng, Vạn Người Ngưỡng Mộ).

【Điều kiện thay đổi】
Danh tiếng không phải là máy chấm điểm hành vi, mà là đánh giá tập thể đã hình thành trong tầng lớp liên quan. Chỉ khi đồng thời thỏa mãn "hành vi hoặc kết quả đã được lan truyền hợp pháp đến tầng lớp tương ứng" và "thông tin đó đủ để thay đổi phán đoán tổng thể của tầng lớp đó đối với {{user}}", mới có thể điều chỉnh chiều tương ứng.
Sự yêu thích, ghét bỏ, biết ơn hay để bụng của một NPC đơn lẻ nên thể hiện trong quan hệ cá nhân hoặc thế lực; khi chưa hình thành nhận thức tầng lớp thì không được ghi vào danh tiếng. Lễ phép nhẹ nhàng, giao dịch thông thường, thắng thua thường ngày và việc lan truyền lại chuyện cũ, thông thường không đủ để vượt cấp danh tiếng.
Chỉ khi xuất hiện sự thật mới đủ để thay đổi cấp độ hiện tại mới trả về reputation; khi không có thay đổi thực chất, không được dùng lastChange để tạo ra một bản cập nhật giả. Chiều danh tiếng sẽ không tự động về 0 chỉ vì tạm thời không ai nhắc đến, về sau chỉ có thể thay đổi bởi đánh giá tập thể mới đã được lan truyền.

II. Nguyên Tắc Phán Định Danh Tiếng
Thay đổi danh tiếng không phải là chấm điểm hành vi, mà là "sự thay đổi trong đánh giá tổng thể mà tầng lớp tương ứng hình thành sau khi biết được thông tin". Khi phán định, theo thứ tự sau:

1. Tiền đề lan truyền
   Hành vi, kết quả hoặc lời đồn phải đã bao phủ tầng lớp tương ứng thông qua Tin Đồn hợp pháp; hành vi chưa lan truyền, chỉ một người biết, chỉ nạn nhân biết hoặc vẫn còn trong hộp đen, không làm thay đổi danh tiếng bốn chiều.

2. Góc nhìn tầng lớp
   Cùng một sự thật có thể được đánh giá khác nhau ở các tầng lớp khác nhau:
   - Triều Đình: quan tâm đến trật tự, tính hợp pháp, sự ổn định của việc cai trị, uy tín thể chế.
   - Thị Thành: quan tâm đến an nguy của dân chúng, lợi ích đời sống, cảm giác công bằng, có gây hại cho địa phương hay không.
   - Thảo Mãng: quan tâm đến nghĩa khí, gan dạ, chống lại bất công, có ức hiếp kẻ yếu hay không; phạm tội đơn thuần không tự động được cộng điểm.
   - Đồng Đạo: quan tâm đến tay nghề, quy tắc nghề, đóng góp cho ngành, sự tin tưởng của đồng nghiệp.

3. Đánh giá tập thể
   Danh tiếng chỉ ghi lại đánh giá tổng thể ở cấp độ tầng lớp, không ghi lại sự yêu thích, biết ơn, sợ hãi hay thù hận của một NPC đơn lẻ. Ân oán nội bộ trong một tập thể đơn lẻ nên ghi vào factions, enemies hoặc quan hệ khác, không trực tiếp thay đổi danh tiếng tổng thể.

4. Cường độ thay đổi
   Chỉ khi thông tin mới đủ để thay đổi cấp độ hiện tại mới điều chỉnh danh tiếng. Lễ phép nhẹ nhàng, giao dịch thông thường, thắng thua thường ngày, tin cũ lặp lại hoặc chi tiết mới chưa lan tỏa, không nên làm thay đổi cấp độ.

5. Giới hạn ảnh hưởng đa chiều
   Cùng một sự thật có thể ảnh hưởng đến nhiều chiều, nhưng phải lần lượt phù hợp với logic đánh giá của tầng lớp tương ứng; thông thường không quá 3 chiều. Không được cưỡng ép cộng trừ đa chiều chỉ để làm phong phú panel.

III. Người Quan Sát Khác Nhau Nhìn Vào Chiều Khác Nhau
Thái độ ban đầu của NPC/tập thể mới được tạo ra, đọc theo chiều tương ứng với giới mà nó thuộc về:
- Triều đình/quyền quý/tầng lớp cai trị → xem 【Triều Đình】
- Thường dân/bách tính/thị dân → xem 【Thị Thành】
- Thảo mãng/ngầm/người ngoài thể chế → xem 【Thảo Mãng】
- Đồng nghiệp/cùng nghề/người đồng đạo → xem 【Đồng Đạo】
- Người liên giới (như nội gián triều đình trà trộn vào thảo mãng) → lấy phán đoán tổng hợp của hai chiều

IV. Hiệu Ứng Danh Tiếng Kép
- Triều Đình + Thị Thành đều cao → chuỗi sự kiện "Lòng Dân Quy Thuận" (cơ hội được phong thưởng chính thức/được dân ý ủng hộ)
- Thị Thành + Thảo Mãng đều cao → chuỗi sự kiện "Thế Thiên Hành Đạo" (cả dân chúng lẫn thảo mãng đều coi {{user}} là anh hùng, triều đình ngược lại căng thẳng)
- Thảo Mãng + Đồng Đạo đều cao → chuỗi sự kiện "Hào Kiệt Một Phương" (quan hệ hai mặt, cả thảo mãng lẫn đồng nghiệp đều nể bạn ba phần)
- Triều Đình cao + Thảo Mãng cao → chuỗi sự kiện "Thân Phận Song Diện" (rủi ro bại lộ tích lũy dần theo thời gian)
- Bất kỳ chiều nào tụt xuống Thiên Nộ Nhân Oán → chuỗi sự kiện "truy nã/truy sát/trục xuất/tẩy chay" trong giới đó

</reputation>`
    },
    // ========== Module 8: Kinh Tế ==========
    {
      comment: 'Module 8: Kinh Tế',
      content: `<world_economy>

Mạch kinh tế là dòng máu tuần hoàn của thế giới, không phải sổ sách cá nhân của {{user}}. Nó theo dõi khí hậu kinh tế tổng thể và những thay đổi đáng chú ý trên thị trường.

I. Khí Hậu Kinh Tế

climate thể hiện nhiệt độ kinh tế của khu vực hiện tại, mô tả bằng bốn từ:
- Phồn Vinh: giao thương sôi động, thương lộ an toàn, giá cả ổn định ở mức cao
- Bình Ổn: vận hành thường nhật, giá cả dao động tự nhiên theo mùa
- Suy Thoái: nhu cầu suy giảm, cửa hiệu phá sản, một số ít mặt hàng thiết yếu lại tăng vọt
- Biến Động: chiến loạn/thiên tai/phong tỏa khiến trật tự kinh tế sụp đổ, hàng đổi hàng quay trở lại

scope của climate là khu vực {{user}} hiện đang ở và vòng kinh tế liên quan trực tiếp đến nó. Tình hình kinh tế ở xa được bổ sung qua signals.

II. Tín Hiệu Thị Trường

signals ghi lại những thay đổi kinh tế đáng chú ý trên thị trường hiện tại. Tiêu chuẩn theo dõi:
- Thay đổi đó đủ để ảnh hưởng đến hành động thế lực, quyết định của NPC hoặc chiều hướng chuỗi sự kiện
- Không phải dao động thường nhật — dao động thường nhật không xứng vào signals
- Thông thường không quá 3 mục

Mỗi mục gồm:
- summary: mô tả một câu về thay đổi và ảnh hưởng
- scope: phạm vi địa lý bị ảnh hưởng (tên khu vực cụ thể, không được viết "toàn cõi")

AI phải đảm bảo mỗi signal có nhân quả: đằng sau thay đổi phải có chuỗi sự kiện có thể truy vết hoặc nguyên nhân bên ngoài (thời tiết, chiến sự, gián đoạn giao thương, công nghệ mới, hành vi tích trữ, đầu cơ). Không được để dao động một cách vô căn cứ.

【Tạo mới, cập nhật và loại bỏ】
- Chỉ khi thay đổi đã thực sự xảy ra trong thị trường, hậu cần, cung cầu, giá cả hoặc phân bổ tài nguyên mới tạo signal; chỉ dự đoán "có thể tăng giá/có thể khan hiếm" không được ghi vào dữ liệu.
- Cùng một thay đổi kinh tế nên cập nhật signal đã có, không được tạo lại mục có nghĩa gần giống nhau chỉ vì cách diễn đạt, tên gọi khác của địa điểm hoặc mở rộng hậu quả.
- Chỉ cập nhật khi biên độ, phạm vi, nguyên nhân hoặc ảnh hưởng đến hành động có thay đổi thực chất.
- Khi thị trường trở lại bình thường, ảnh hưởng đã được hấp thụ hoặc thay đổi không còn ảnh hưởng đến quyết định nào nữa, nên loại bỏ khỏi signals, không được giữ lại vĩnh viễn như tin tức lịch sử.
- climate chỉ thay đổi khi nhiệt độ kinh tế tổng thể của khu vực thực sự vượt ngưỡng; thay đổi của một mặt hàng đơn lẻ hay một cửa hiệu đơn lẻ thông thường chỉ vào signal, không thể đại diện cho cả vòng kinh tế.

III. Liên Động Giữa Tin Đồn Và Chuỗi Sự Kiện

- Giá cả tăng vọt, vật tư cạn kiệt và các thay đổi lớn khác → tạo ra ít nhất 1 Tin Điện kinh tế hoặc Dư Luận (xem Module 4).
- Sau khi mọi người biết được Tin Đồn kinh tế và thực hiện các hành động như tranh mua, tích trữ, rút vốn..., có thể quay ngược lại thay đổi kinh tế và chuỗi sự kiện.
- Cấm bỏ qua khoảng cách khiến thông tin kinh tế lan khắp thành ngay lập tức — scope của signals và scope của Tin Đồn phải nhất quán với nhau.

IV. Liên Động Giữa Kinh Tế Và Chuỗi Sự Kiện

- Liên tục nhiều lượt xuất hiện signal nghiêm trọng cùng một chiều hướng → API nên tạo một chuỗi sự kiện Tiến Triển, thể hiện rằng địa phương đang cố gắng giải quyết (khai mở thương lộ mới, tìm hàng thay thế...).
- Thay đổi kinh tế lớn → ảnh hưởng đến quan hệ giữa các thế lực (căng thẳng giữa bên chịu thiệt và bên hưởng lợi gia tăng).

V. Những Điều Cấm

- Cấm theo dõi ví tiền hay túi đồ cá nhân của {{user}}. Đây là World Engine, không phải sổ kế toán.
- Cấm để những dao động vặt vãnh thường nhật vào signals.
- Cấm để giá vật tư dao động vô cớ.
- Cấm để tất cả các xu hướng kinh tế khu vực hoàn toàn giống nhau.
</world_economy>`
    },
    // ========== Module 9: Sổ Thù Địch ==========
    {
      comment: 'Module 9: Sổ Thù Địch',
      content: `<enemies>

Kẻ thù là ân oán cá nhân không thể đảo ngược, phát sinh từ hành vi gây hại cụ thể của {{user}}. Đặc điểm cốt lõi của kẻ thù là không bao giờ phai nhạt và truy tìm xuyên khu vực. Nó hoàn toàn khác với sự đối lập thái độ ở cấp độ thế lực (factions.relation) — đối lập thế lực bắt nguồn từ lập trường và lợi ích, có thể đàm phán; kẻ thù bắt nguồn từ tổn hại, không thể đàm phán.

Mỗi bản ghi kẻ thù đều có id hệ thống. Khi cập nhật kẻ thù đã có phải giữ nguyên id gốc, ngay cả khi tên, danh xưng hoặc tên tổ chức thay đổi; kẻ thù mới phải điền rõ null, không được bỏ qua.

【Nguyên tắc tổng quát về tạo mới và cập nhật】
Trước tiên kiểm tra đầy đủ điều kiện kích hoạt của huyết thù hoặc ân oán không gây chết người dưới đây; khi không thỏa mãn thì không được tạo kẻ thù chỉ vì nhân vật biểu lộ giận dữ, thù địch hoặc dọa trả thù. Kẻ thù là ân oán cá nhân không thể đảo ngược cần theo dõi dài hạn, không phải danh sách phản diện thông thường.
Kẻ thù đã có chỉ cập nhật khi tiến độ định vị, năng lực báo thù, giai đoạn hành động, chủ thể tổ chức hoặc sự thật kết thúc có thay đổi thực chất; không được chỉ viết lại cách diễn đạt sự thù hận mỗi lượt. Tạm thời không đủ sức hành động chỉ làm thay đổi trạng thái hành động của họ, sẽ không tự động xóa kẻ thù.

I. Các Loại Kẻ Thù
1. Huyết thù (type: "blood") — điều kiện kích hoạt (thỏa mãn bất kỳ điều nào): {{user}} giết chết nhân vật cốt lõi của một tập thể (trừ nhân vật cốt lõi cũ đã mất quyền lực, xem phần sụp đổ quyền lực ở module Thế Lực); {{user}} khiến người thân ruột thịt của ai đó chết hoặc bị tàn phế vĩnh viễn.
   Đặc tính: không bao giờ phai nhạt, không thể đàm phán, động cơ báo thù không bao giờ biến mất. Ngay cả khi bên báo thù cạn kiệt tài nguyên, mối thù cũng không nguôi, chỉ tạm thời đình trệ do năng lực không đủ.

2. Ân oán không gây chết người (type: "grudge") — điều kiện kích hoạt (phải đồng thời thỏa mãn):
   - Tổn hại không thể đảo ngược: hành vi của {{user}} đã gây ra tổn thất lớn không thể khôi phục (phế bỏ võ công, cướp đi cơ nghiệp cả đời, gài bẫy khiến phá sản/lưu đày/bị tước đoạt danh phận...).
   - Ý muốn báo thù rõ ràng: nạn nhân có động cơ báo thù mãnh liệt, rõ ràng, không phải "không thích" hay "để bụng" chung chung.
   - Có năng lực truy tìm/báo thù: nạn nhân có năng lực (tài nguyên, võ nghệ, quan hệ, mạng lưới tình báo) để thực hiện việc truy tìm hoặc báo thù thực sự đối với {{user}}.
   Không thỏa mãn cả ba điều trên thì không tính là grudge. Bị {{user}} mắng chửi, thất bại trong một lần cạnh tranh thương mại, bị thương trong ẩu đả đường phố — những điều này đều không đủ tư cách vào Sổ Thù Địch, nên để AI thể hiện tự nhiên trong lời kể, không ghi vào dữ liệu.
   Đặc tính: cũng không bao giờ phai nhạt, nhưng mức độ đáng sợ thường thấp hơn huyết thù.

II. Hành Vi Và Truy Tìm Của Kẻ Thù
- Huyết thù cung cấp động cơ, không cung cấp năng lực. Việc truy sát chịu ràng buộc bởi cấp bậc thế lực: thế lực yếu không thể thâm nhập địa bàn của thế lực mạnh.
- Truy tìm xuyên khu vực cần thời gian. Kẻ thù phải thông qua các biện pháp hợp pháp để định vị {{user}} trước (mạng lưới tình báo, tay trong, Tin Đồn...), sau đó mới có thể tổ chức hành động.
- Khi status của kẻ thù = "Đang Hành Động", cứ mỗi 5-10 lượt mới có cơ hội thực sự phát động một lần truy sát/báo thù.
- Nếu thế lực của kẻ thù < thế lực bảo hộ nơi {{user}} đang ở, việc truy sát bắt buộc đình trệ, chuyển sang "Đang Truy Tìm" và tích lũy sức mạnh.

III. Kích Hoạt Kẻ Thù (Góc Nhìn Tập Thể)
Khi hành vi của {{user}} kích hoạt type=blood, AI phải phán định hướng đi của tập thể dựa trên thân phận người bị giết:
1. Người bị giết là nhân vật cốt lõi của tập thể (trừ nhân vật cốt lõi cũ đã mất quyền lực):
   - Hướng A (đồng thù địch khái): nếu sức gắn kết cao và có người kế thừa rõ ràng, người kế thừa trở thành cốt lõi mới, tạo chuỗi sự kiện Xung Đột.
   - Hướng B (nội chiến): nếu phe phái chia rẽ, tập thể rơi vào tranh giành quyền lực, việc báo thù bị gác lại, tiến độ gốc đình trệ.
   - Hướng C (giải tán): nếu sức gắn kết thấp hoặc tài nguyên cạn kiệt, tập thể giải tán trực tiếp, bị loại khỏi panel đang hoạt động.
2. Người bị giết là thành viên thường (hoặc nhân vật cốt lõi cũ đã mất quyền lực): tạo tập thể báo thù tạm thời, định dạng tên: "Đội Báo Thù Của Người Thân [tên người bị giết]". Tạo chuỗi sự kiện Xung Đột.
Dù theo hướng nào, cũng đều phải thêm một mục vào Sổ Thù Địch trong enemies, và ghi lại quan hệ truyền dẫn trong influenceChain.

IV. Kết Thúc Kẻ Thù
Chỉ khi kẻ thù bị {{user}} tiêu diệt hoàn toàn (giết chết kẻ báo thù cốt lõi, phá hủy tổ chức báo thù), mới được đánh dấu status="Đã Chấm Dứt".
- Mục đã "Đã Chấm Dứt" sẽ được giữ lại làm ghi chú 20 lượt rồi tự động xóa.
- Sau khi phản sát, danh tiếng của {{user}} có thể hồi phục, nhưng cao nhất chỉ có thể đạt đến "Được Kính Trọng" (nếu module danh tiếng được kích hoạt).
- Chuỗi sự kiện Xung Đột tương ứng đồng bộ đánh dấu là Đã Chấm Dứt.

V. Những Điều Cấm
- Cấm tạo mục kẻ thù chỉ vì các tổn hại có thể phục hồi như "bị {{user}} mắng chửi", "thất bại cạnh tranh thương mại", "bị thương nhẹ trong ẩu đả đường phố".
- Cấm tự động coi sự đối lập thái độ ở cấp độ thế lực (factions.relation = "Thù Địch") tương đương với kẻ thù.
- Cấm trao cho kẻ thù năng lực vượt quá thế lực thực có của họ. Thế lực yếu không thể tự nhiên triệu hồi viện quân mạnh, thâm nhập lãnh địa mạnh hoặc định vị toàn tri.
</enemies>`
    },
    // ========== Module 10: Biến Cố Khu Vực ==========
    {
      comment: 'Module 10: Biến Cố Khu Vực',
      content: `<regional_incident>

I. Định Vị Hệ Thống
Hệ thống này chỉ phụ trách tạo ra biến cố đột phát cấp khu vực — sự kiện lớn đủ để ảnh hưởng đến một vùng.
Không xử lý các sự kiện giá trị thấp

II. Phân Chia Trách Nhiệm
Biến cố khu vực có được kích hoạt hay không, và kích hoạt loại nào, hoàn toàn do hệ thống cục bộ phán định. Khi hệ thống cục bộ không kích hoạt, quy tắc này sẽ không yêu cầu bạn tạo biến cố khu vực, bạn cũng không được tự ý tạo ra.
Chỉ khi hệ thống cục bộ phán định kích hoạt và tiêm vào bạn "chỉ thị bắt buộc về biến cố khu vực", bạn mới được tạo tiêu đề sự kiện cụ thể, địa điểm xảy ra, phạm vi ảnh hưởng, Tin Đồn lan truyền và ảnh hưởng lan tỏa theo đúng loại mà chỉ thị đã chỉ định.

III. Các Loại Sự Kiện
Các loại dưới đây chỉ quy định phạm trù nhân quả và quy mô ảnh hưởng của sự kiện. Biểu hiện cụ thể phải phù hợp với thế giới quan, thời đại, trình độ kỹ thuật, môi trường địa lý và chế độ xã hội hiện tại, không được sao chép y nguyên ví dụ.

- banditry cướp bóc có tổ chức: cuộc tấn công và cướp bóc quy mô lớn nhắm vào khu dân cư, tuyến vận chuyển, đầu mối thương mại, kho dự trữ tài nguyên hoặc đoàn người di chuyển.
- fire hỏa hoạn lớn: hỏa hoạn diện rộng xảy ra ở khu kho bãi, khu dân cư, cơ sở sản xuất, đầu mối giao thông, công trình công cộng hoặc kiến trúc quan trọng.
- massacre bạo lực nghiêm trọng: giết người liên tục, tử vong hàng loạt, tấn công lớn hoặc các vụ bạo lực khác đủ để gây hoảng loạn khu vực.
- flood lũ lụt: mực nước bất thường, đê điều thất thủ, khu vực bị ngập, giao thông gián đoạn, khu định cư hoặc khu sản xuất bị thiệt hại.
- infrastructure hạ tầng sụp đổ: đường sá, cầu cống, cấp nước, năng lượng, thông tin liên lạc, vận tải hoặc các công trình công cộng then chốt khác bị hư hại nghiêm trọng hoặc ngừng hoạt động.
- plague dịch bệnh lan truyền: con người, động vật, thực vật hoặc các nhóm sinh vật khác xuất hiện bệnh tật, ô nhiễm hoặc lây nhiễm bất thường có nguy cơ lan truyền trong khu vực.
- famine thiếu hụt vật tư: lương thực, nước uống, năng lượng, dược phẩm hoặc các vật tư sinh tồn cơ bản khác xảy ra thiếu hụt, đứt nguồn cung hoặc mất kiểm soát giá cả trong khu vực.
- riot bạo loạn tập thể: xảy ra xung đột quy mô lớn, giẫm đạp, cướp bóc hỗn loạn hoặc mất trật tự quanh nơi công cộng, điểm phân phối tài nguyên, đầu mối giao thông hoặc cơ quan quyền lực.
- rebellion phản kháng có tổ chức: nhóm địa phương, tổ chức vũ trang hoặc tập đoàn xã hội phát động phản kháng, cát cứ hoặc nổi loạn liên tục nhằm vào sự cai trị và trật tự hiện có.
- military biến động quân sự: lực lượng vũ trang xảy ra binh biến, tan rã, vượt biên, phong tỏa, giới nghiêm, tấn công hoặc các thay đổi khác đủ để làm thay đổi cục diện an ninh khu vực.
- earthquake thiên tai địa chất: động đất, lở núi, sụt lún, nứt đất, sạt lở hoặc các bất thường địa chất quy mô lớn khác.
- storm thời tiết cực đoan: bão, bão tuyết, bão cát, đợt lạnh, sóng nhiệt hoặc các thiên tai thời tiết khác đủ để phá hoại sản xuất, giao thông và trật tự sinh hoạt của khu vực.

IV. Yêu Cầu Tạo Sinh Của API
Sau khi xúc xắc cục bộ kích hoạt và tiêm vào chỉ thị bắt buộc, API phải:
1. Tạo biến cố đột phát cấp khu vực theo đúng loại đã chỉ định, sự kiện ảnh hưởng đến một khu vực, con đường, thị trấn, ải quan, bến cảng hoặc phạm vi địa lý rõ ràng khác.
2. Sự kiện phải tạo ra Tin Đồn có thể lan truyền được.
3. Sự kiện phải gây ra ít nhất một loại ảnh hưởng lan tỏa: thay đổi kinh tế, hành động thế lực, thay đổi an ninh trật tự, thay đổi chuỗi sự kiện, thay đổi danh tiếng, thay đổi hộp đen hoặc chuỗi ảnh hưởng mới.
4. Sự kiện không có nhân quả trực tiếp với hành vi hiện tại của {{user}}, không được viết thành kết quả âm mưu của kẻ thù đã có, thế lực đã có hoặc chuỗi sự kiện đã có.
5. Không được hủy diệt sân khấu cốt lõi một cách vô căn cứ, không được phá hủy tài sản cốt lõi của {{user}} vô cớ.
6. Nếu sự kiện không xảy ra ở khu vực {{user}} đang ở, không được cưỡng ép cắt ngang hành động hiện tại của {{user}}, chỉ đóng vai trò là thay đổi thế giới ở hậu trường, tin tức từ xa hoặc Tin Đồn lan truyền.
7. Cấm viết "biến cố khu vực" thành âm mưu đã được một thế lực nào đó lên kế hoạch từ trước.

V. Cấu Trúc Dữ Liệu
{
  "regionalIncident": {
    "active": true,
    "title": "Tiêu đề sự kiện",
    "type": "Loại sự kiện",
    "scope": "Phạm vi ảnh hưởng",
    "impact": "Tóm tắt một câu về hậu quả khu vực"
  }
}
cooldown do hệ thống cục bộ duy trì, API không được xuất ra hoặc sửa đổi trường này.

VI. Yêu Cầu Tối Thiểu Khi API Trả Về
Sau khi kích hoạt, ít nhất phải trả về regionalIncident, winds, influenceChain. Tùy tình huống có thể trả về thêm events, economy, factions, reputation, blackbox.
</regional_incident>`
    },
    // ========== Module 11: Hộp Đen Thông Tin ==========
    {
      comment: 'Module 11: Hộp Đen Thông Tin',
      content: `<secret_asset>

I. Định Nghĩa Hộp Đen Thông Tin (Quy Tắc Bất Di Bất Dịch Chống Góc Nhìn Thượng Đế)
Trong quá trình vận hành cốt truyện, tồn tại hai loại nội dung cần được đưa vào 【Hộp Đen Thông Tin】 để cách ly nghiêm ngặt:
1. Hành vi bí mật (secretActions): hành động {{user}} thực hiện trong tình huống không ai chứng kiến, không để lại dấu vết (như giết trâu trong núi sâu, ám sát trong mật thất, đột nhập không tiếng động). Thuộc tính then chốt là dấu vết — có người chứng kiến hay không, có vật chứng hay không.
2. Tài sản bí mật (secretAssets): mọi tài nguyên {{user}} nắm giữ ngầm, chưa công khai trưng ra (như thư mật, độc dược, thóp yếu, vật tư giấu kín, tay trong/tình báo ngầm, danh tính bí mật). Thuộc tính then chốt là mức độ bại lộ và khả năng sử dụng.
- Trường secretActions: mỗi mục { action, witnesses: "không có/chỉ XX" }
- Trường secretAssets: mỗi mục { name, exposure: 0-100, status: "Còn Hiệu Lực/Đã Hết Hạn/Đã Bị Lộ/Mất Hiệu Lực" }

【Điều kiện tạo mới】
Thông tin chưa được biết không đồng nghĩa với việc bắt buộc phải đưa vào hộp đen. Chỉ khi cần bảo vệ ranh giới nhận thức liên tục qua nhiều lượt hoặc theo dõi công dụng tương lai/rủi ro bại lộ, mới ghi vào:
- secretActions: hành vi đã xảy ra, và việc "ai biết, để lại dấu vết gì có thể điều tra" sẽ ảnh hưởng đến phán đoán hoặc hành động trong tương lai.
- secretAssets: {{user}} thực sự kiểm soát tài nguyên đó, tài nguyên có giá trị sử dụng trong tương lai, và tính bí mật, mức độ bại lộ hoặc thời hạn hiệu lực cần được theo dõi liên tục.

Những suy nghĩ nội tâm thông thường, ý định chưa thực hiện, hành động nhỏ không có giá trị về sau, vật phẩm công khai, vật phẩm lấy tạm rồi tiêu thụ ngay, hay chuyện riêng tư không liên quan đến trạng thái thế giới tương lai, không được đưa vào hộp đen. Không được gom "tất cả những gì NPC hiện tại chưa biết" vào hộp đen.
Mục đã có chỉ cập nhật khi người biết tin, dấu vết, mức độ bại lộ, quyền kiểm soát, hiệu lực hoặc công dụng có thay đổi thực chất. Khi hành vi đã công khai và ranh giới nhận thức không còn cần cách ly nữa, không tiếp tục duy trì như bí mật đang hoạt động; khi tài sản đã bị tiêu thụ, mất hiệu lực, mất kiểm soát hoặc hoàn toàn công khai, nên cập nhật trạng thái và ngừng coi nó là quân bài ẩn có thể dùng.

II. Quy Tắc Kiểm Tra Quyền Biết Tin Và Cách Ly Vật Lý (Ưu Tiên Cao Nhất)
1. Nguyên tắc rào chắn vật lý: đối với nội dung trong hộp đen, mọi NPC không có mặt tại hiện trường, không trực tiếp tham gia, mặc định ở trạng thái cách ly vật lý "hoàn toàn, tuyệt đối không biết gì".
2. Cấm tuyệt đối góc nhìn thượng đế: AI tuyệt đối cấm tự động biến hành vi bí mật của {{user}} thành sự kiện toàn tri. Ví dụ: {{user}} giết một con trâu trong núi sâu, chỉ cần không có ai chứng kiến, thì dù có vào thành, cũng tuyệt đối không có ai biết con trâu đã chết, càng không thể biết là {{user}} giết.
3. Kiểm tra bắt buộc: trước khi miêu tả bất kỳ NPC nào (bao gồm đối thoại, hành động, thần thái, hoạt động tâm lý), AI phải kiểm tra xem NPC đó có nằm trong "danh sách biết tin" của hộp đen hay không.
4. Biểu hiện hoàn toàn không biết: nếu NPC không biết tin, AI tuyệt đối không được để họ biểu hiện bất kỳ sự ám chỉ, nghi ngờ, "nói bóng nói gió" hay "giác quan thứ sáu" nào. Không biết tin nghĩa là như tờ giấy trắng, phản ứng của NPC phải hoàn toàn dựa trên nhận thức công khai hiện tại của họ.
5. Ràng buộc suy luận từ dấu vết: nếu {{user}} để lại vật chứng rõ ràng, NPC phải thông qua "hành động điều tra" cụ thể phù hợp với trí tuệ và thân phận của họ mới dần dần thu thập được thông tin, tuyệt đối không được trực tiếp "chợt hiểu ra" hay "đoán trúng".

III. Cơ Chế Vận Hành Của Tài Sản Bí Mật
- exposure: 0-100, rủi ro bại lộ. 0 = tuyệt đối bí mật, 100 = đã hoàn toàn công khai. {{user}} hoạt động thường xuyên, cảnh giác địa phương tăng cao, phô bày hoặc ám chỉ với người khác, đều khiến mức độ bại lộ tăng lên. Đạt 50 có nguy cơ chạm trán/lộ tin, đạt 90 có thể bị lục soát/công khai.
- status: Còn Hiệu Lực/Đã Hết Hạn/Đã Bị Lộ/Mất Hiệu Lực. Còn Hiệu Lực = vẫn có thể sử dụng; Đã Hết Hạn = tình báo đã lỗi thời; Đã Bị Lộ = đã bị phát hiện; Mất Hiệu Lực = không còn dùng được nữa (như vật tư bị tịch thu, tay trong mất liên lạc, danh tính bị lộ).
- Diễn biến của tài sản: tình báo có tính thời hạn, có thể tự động hết hạn sau khi sự kiện liên quan xảy ra. Mức độ bại lộ của điểm giấu vật tư tự nhiên tăng theo thời gian, hoạt động gần đó khiến nó tăng nhanh hơn. Tay trong/tình báo ngầm sau khi bại lộ có thể bị lợi dụng ngược; danh tính sau khi bại lộ sẽ mất đi sự linh hoạt trong hành động. Mức bại lộ thấp + hiệu lực cao = tài sản an toàn; mức bại lộ thấp + đã hết hạn = không ai biết nhưng đã vô dụng; mức bại lộ cao + đã mất hiệu lực = đã bị phát hiện và bị hủy bỏ.
</secret_asset>`
    },
    // ========== Module 12: Đại Cục Thiên Hạ ==========
    {
      comment: 'Module 12: Đại Cục Thiên Hạ',
      content: `<world_trends>

Đại cục thiên hạ là cục diện dài hạn đã làm thay đổi cách vận hành của quốc gia, quốc tế hoặc toàn thế giới. Nó không phải là Tin Đồn thông thường, cũng không phải chuỗi sự kiện đang chờ tiến triển, mà là ràng buộc cấp thế giới mà các hệ thống khác phải cân nhắc khi hành động.

I. Cấu Trúc Dữ Liệu
Mỗi mục gồm:
- id: đại cục đã có giữ nguyên id do hệ thống cấp; đại cục mới phải điền rõ null, không được bỏ qua.
- name: tên đại cục. Thay đổi cách diễn đạt không làm thay đổi id.
- scope: phạm vi ảnh hưởng thực tế.
- status: "Đang Diễn Ra"/"Đã Kết Thúc".
- description: cục diện hiện tại và cách nó đang ràng buộc hành động của thế giới.
- source: nguồn gốc rõ ràng hình thành nên đại cục này.

II. Điều Kiện Hình Thành
Mỗi lượt kiểm tra các nguồn ứng viên sau:
- Sự kiện Xung Đột Lv4 chuyển vào "Đã Bùng Phát".
- Sự kiện Tiến Triển Lv4 chuyển vào "Đã Hoàn Thành", và thành quả làm thay đổi cục diện quốc gia hoặc quốc tế.
- Sự thật đằng sau Tin Đồn Lv4 được xác nhận rộng rãi, và tiếp tục ảnh hưởng đến nhiều thế lực.
- Cục diện dài hạn đã hình thành.

Nguồn ứng viên không đồng nghĩa với việc tự động tạo. Chỉ khi đồng thời thỏa mãn "kéo dài lâu dài, ảnh hưởng diện rộng, tác động xuyên hệ thống, buộc nhiều thế lực phải liên tục điều chỉnh hành động", mới tạo đại cục thiên hạ. Lễ hội toàn quốc, thông báo đơn lẻ, sự kiện gây chấn động ngắn hạn, tin tức lớn thông thường không tính là đại cục thiên hạ.

III. Tiếp Diễn Và Kết Thúc
- Đại cục thiên hạ không tham gia vào xúc xắc, không tự động tan biến, cũng không bị xóa chỉ vì một lượt nào đó không được trả về.
- Mọi đại cục thiên hạ có status="Đang Diễn Ra" đều phải được dùng làm ràng buộc nền cho chuỗi sự kiện, thế lực, kinh tế, Tin Đồn và hành động NPC trong mỗi lượt.
- Bản thân đại cục không có trường effects. Ảnh hưởng cụ thể nên được thể hiện ở hệ thống tương ứng, và ghi vào influenceChain khi tạo ra thay đổi xuyên hệ thống.
- Chỉ cập nhật description khi xuất hiện sự thật rõ ràng làm thay đổi cục diện; chỉ đánh dấu "Đã Kết Thúc" khi cục diện chắc chắn đã kết thúc.
- Đại cục đã "Đã Kết Thúc" là kết quả lịch sử, không được chuyển lại thành Đang Diễn Ra; nếu cục diện tương tự xảy ra lần nữa, nên tạo đại cục với tên mới.
</world_trends>`
    }
  ];

  // ===================== Giao Diện Bên Ngoài =====================

  function loadRules(baseUrl) {
    return new Promise((resolve) => {
      console.log('[World Engine] Quy tắc đã được tích hợp sẵn trong JS, tổng cộng', RULES.length, 'điều');
      resolve({ count: RULES.length, comments: RULES.map(r => r.comment) });
    });
  }

  function getAllRulesText() {
    console.log('[getAllRulesText] RULES:', RULES.length);
    if (RULES.length === 0) return '【Tải quy tắc thế giới thất bại, mọi quy tắc đều không khả dụng】';
    const orderedRules = RULES.map(r => `========== ${r.comment} ==========\n${r.content}`);
    return `## Quy Tắc Suy Diễn Thế Giới (Văn bản gốc, tổng cộng ${RULES.length} điều)\n\n${orderedRules.join('\n\n')}`;
  }

  function getCoreRulesSummary() {
    if (RULES.length === 0) return '';

    const summary = `
【World Engine – Quy Tắc Hành Vi Chính Văn】

I. Vận Hành Thế Giới Và Quy Mô Thời Gian
- Nhân vật, tổ chức, sự kiện và môi trường trong thế giới liên tục thay đổi theo mục tiêu riêng của chúng, {{user}} là một trong những người tham gia, không phải nguyên nhân mặc định hay trung tâm của mọi thay đổi.
- Những thay đổi bên ngoài cảnh hiện tại có thể tiếp tục xảy ra, nhưng chính văn chỉ nên thể hiện qua kết quả có thể quan sát, tiếp xúc hợp lý hoặc sự lan truyền thông tin, không được để nhân vật trực tiếp đọc panel.
- Mỗi lần cập nhật trạng thái thế giới không đồng nghĩa với một khoảng thời gian cố định. Chính văn nên phán đoán thời gian thực tế đã trôi qua dựa trên các manh mối như hành động, di chuyển, chờ đợi, nghỉ ngơi, trò chuyện và xung đột; biên độ thay đổi phải khớp với quy mô thời gian.
- Trạng thái thế giới ghi lại kết quả tương đối so với lần cập nhật trước. Không được coi nội dung lịch sử đã xử lý là thay đổi mới của lượt này.

II. Sự Kiện
- "Sự kiện đang diễn ra" chỉ biểu thị sự việc chính độc lập cần theo dõi liên tục qua nhiều lượt, không phải danh sách nhiệm vụ, danh sách tin tức hay tập hợp mọi sự thật đã xảy ra.
- Sự kiện tiến triển sẽ tiến về phía hoàn thành; sự kiện xung đột sẽ tiến về phía bùng phát. Cấp độ thể hiện độ khó, mức độ kịch liệt và phạm vi ảnh hưởng, giai đoạn và tiến độ thể hiện vị trí hiện tại.
- [Thành Công] biểu thị lượt này đã có tiến triển, [Gặp Trở Ngại] biểu thị tiến triển thụt lùi hoặc điều kiện xấu đi, [Giữ Nguyên] biểu thị giai đoạn hiện tại về cơ bản không đổi. Chính văn nên thể hiện kết quả đó, nhưng không được lặp lại nhãn một cách máy móc.
- Tạm dừng hoặc đình trệ không đồng nghĩa với kết thúc. Người thực hiện vẫn có thể thu thập thông tin, tích lũy tài nguyên, tìm kiếm trợ giúp, điều chỉnh mục tiêu hoặc chờ đợi điều kiện thay đổi.
- Đã Bùng Phát, Đã Hoàn Thành, Đã Tan Biến và Đã Thất Bại đều là kết cục cuối. Kết cục cuối có thể tạo ra ảnh hưởng tiếp theo, nhưng không được viết sự kiện gốc quay lại giai đoạn chưa kết thúc.
- Diễn biến sự kiện phải phù hợp với năng lực, tài nguyên, thông tin, khoảng cách địa lý, hiệu suất tổ chức và trở lực bên ngoài của chủ thể thực hiện; không được bịa ra điều kiện không tồn tại chỉ để thúc đẩy tiến triển.

III. Tổ Chức Và Quan Hệ
- Tổ chức hành động theo mục tiêu, tài nguyên, cơ cấu nội bộ và nguồn thông tin của riêng mình, không coi {{user}} là đối tượng hành động duy nhất.
- Trạng thái tổ chức mô tả năng lực vận hành tổng thể; quan hệ với {{user}} mô tả xu hướng hành vi của nó. Lời nói và hành động của nhân vật nên nhất quán với trạng thái và quan hệ hiện tại, nhưng không được diễn nhãn quan hệ thành tất cả thành viên hoàn toàn giống nhau.
- Nội bộ tổ chức có thể tồn tại lập trường, phe phái và mục tiêu cá nhân khác nhau; mục đích của nhân vật cốt lõi không nhất thiết phải hoàn toàn khớp với mục tiêu chung của tổ chức.
- Tổ chức chỉ có thể hành động hiệu quả trong phạm vi kiểm soát hoặc ảnh hưởng của mình. Hành động liên vùng, vượt quyền hạn hoặc phá vỡ ranh giới của tổ chức khác phải có điều kiện về thời gian, con đường, tài nguyên và thông tin.
- Nguồn tài nguyên hoặc năng lực chủ yếu quyết định sức khống chế thực tế của tổ chức. Khi nguồn liên quan mất hiệu lực, trạng thái, năng lực hành động và vị trí nhân vật cốt lõi của nó nên thay đổi tương ứng.

IV. Động Thái Toàn Cục
- Động thái toàn cục là ràng buộc nền dài hạn, diện rộng, xuyên hệ thống và buộc nhiều chủ thể phải liên tục điều chỉnh hành động, không phải một sự kiện đơn lẻ hay điểm nóng ngắn hạn.
- Động thái toàn cục đang tiếp diễn nên ảnh hưởng đến sự kiện, tổ chức, kinh tế, sự lan truyền thông tin và lựa chọn của nhân vật trong phạm vi liên quan; ảnh hưởng cụ thể vẫn phải được thể hiện qua trạng thái và cảnh tương ứng.
- Động thái toàn cục sẽ không tự động biến mất chỉ vì trong thời gian ngắn không được nhắc đến, cũng không được tự ý kết thúc khi chưa có sự thật rõ ràng.

V. Thông Tin Công Khai Và Dư Luận
- Thông Báo, Tin Điện, Lời Đồn và Dư Luận ghi lại những cách nói đang lan truyền, không đồng nghĩa với sự thật khách quan. Việc công bố công khai chỉ chứng minh hành vi công bố đã xảy ra, không thể tự động chứng minh nội dung là thật.
- Cấp độ thông tin thể hiện quy mô lan truyền thực tế, không thể hiện tầm quan trọng, tính thật giả hay cường độ ảnh hưởng; phạm vi lan truyền quyết định những khu vực, nhóm người và nhân vật nào có thể tiếp xúc với thông tin đó.
- Thông tin chỉ có thể mở rộng qua các điểm lan truyền thực tế. Khi không có con đường lan truyền mới, không được để đối tượng ngoài phạm vi dựa vào đó để phán đoán hay hành động.
- Cùng một chủ đề thông tin có thể được bổ sung, biến dạng, mở rộng hoặc thay đổi khuynh hướng; chính văn nên hiểu đó là sự phát triển của cùng một mạch lan truyền, chứ không phải các tin tức mới không liên quan đến nhau.
- Chỉ khi thông tin đã lan truyền đến đối tượng liên quan, mới có thể ảnh hưởng đến phán đoán tổ chức, hành vi kinh tế, đánh giá xã hội, diễn biến sự kiện, điều tra hoặc tiếp xúc.

VI. Lan Truyền Thông Tin, Nhận Thức Và Cách Ly Danh Tính
- Trước khi bất kỳ nhân vật hay tổ chức nào biết được thông tin, đều phải tồn tại con đường rõ ràng: tự mình trải qua, người biết tin báo lại, kênh công khai, sự lan truyền thông tin bao phủ phạm vi của nó, mạng lưới tổ chức, chứng cứ điều tra, hoặc các phương thức liên lạc và trinh sát thực sự khả dụng trong thiết định thế giới.
- "Giỏi điều tra", "tin tức lan nhanh" hay "cảm thấy không đúng" không thể thay thế cho con đường thông tin cụ thể.
- Dấu vết thông thường chỉ có thể chứng minh chuyện gì đã xảy ra, không thể tự động chứng minh do ai gây ra. Muốn chỉ đích danh sự thật về phía {{user}} hoặc một danh tính cụ thể, phải có chứng cứ liên hệ bổ sung.
- Danh tính ẩn danh, bí danh và cải trang mặc định được cách ly với nhau; chỉ khi xuất hiện chứng cứ liên hệ có hiệu lực, các đối tượng khác mới có thể thiết lập quan hệ tương ứng giữa các danh tính.
- Việc tiếp xúc, định vị và truy tìm phải phù hợp với trạng thái nhận thức, con đường hành động, khoảng cách, mục đích và năng lực, không được sắp đặt vô căn cứ chỉ để tạo ra tương tác.

VII. Kinh Tế
- Kinh tế mô tả trạng thái tổng thể của khu vực và những thay đổi thị trường đủ để ảnh hưởng đến quyết định, không ghi lại tiền bạc, vật phẩm cá nhân của {{user}} hay những dao động thường nhật thông thường.
- Tín hiệu thị trường phải đã thực sự xảy ra, có nguyên nhân rõ ràng, phạm vi thực tế và ảnh hưởng có thể quan sát được; dự đoán, khả năng hoặc một thay đổi nhỏ đơn lẻ không thể coi là trạng thái thị trường đã thành hiện thực.
- Thay đổi của một mặt hàng đơn lẻ hay hoạt động kinh doanh cục bộ thông thường không đại diện cho sự thay đổi trạng thái kinh tế của cả khu vực. Các khu vực khác nhau có thể thể hiện xu hướng khác nhau.
- Thông tin kinh tế cũng chịu giới hạn về ranh giới lan truyền; thay đổi giá cả, nguồn cung, hậu cần và tài nguyên nên được thể hiện qua cảnh cụ thể, và ảnh hưởng đến lựa chọn thực tế của chủ thể liên quan.

VIII. Đánh Giá Xã Hội
- Đánh giá xã hội chia thành bốn tầng lớp độc lập: chính thức và quyền lực, công chúng và dân gian, phi chính thức và ngầm, ngành nghề và chuyên môn. Các tầng lớp khác nhau hình thành phán đoán dựa trên lợi ích và tiêu chuẩn riêng, đánh giá không tự động đồng bộ với nhau.
- Đánh giá xã hội là nhận thức tổng thể ở cấp độ tập thể, không phải chấm điểm tức thời cho từng hành vi của {{user}}, cũng không đồng nghĩa với sự yêu thích, biết ơn, sợ hãi hay oán hận của một nhân vật đơn lẻ.
- Chỉ khi thông tin liên quan đã lan truyền hợp pháp đến tầng lớp và khu vực tương ứng, và đủ để thay đổi phán đoán tổng thể của tập thể, đánh giá đó mới ảnh hưởng đến phản ứng của nhân vật.
- Thiếu sự chú ý biểu thị tầng lớp đó chưa hình thành nhận thức rõ ràng, nên xử lý như đối tượng xa lạ thông thường; cường độ đánh giá phải thể hiện đúng theo cấp độ hiện tại, không được phóng đại.

IX. Quan Hệ Đối Lập
- Quan hệ đối lập ghi lại xung đột cá nhân hoặc tập thể dài hạn hình thành từ tổn hại nghiêm trọng, không thể đảo ngược, không đồng nghĩa với sự đối lập lập trường thông thường giữa các tổ chức.
- Sự đối lập nghiêm trọng cung cấp động cơ liên tục, nhưng không tự động cung cấp năng lực định vị, truy tìm, thâm nhập hay hành động. Hành động thực tế vẫn chịu giới hạn bởi tài nguyên, thông tin, khoảng cách và ranh giới của các tổ chức khác.
- Tạm thời không thể hành động không đồng nghĩa với việc động cơ biến mất; nhưng chính văn không được để bên thiếu năng lực có được tài nguyên, viện trợ hay vị trí chính xác một cách vô căn cứ.
- Xung đột thông thường, xúc phạm bằng lời nói, cạnh tranh bình thường hoặc tổn thất có thể phục hồi không nên bị diễn thành sự đối lập dài hạn không thể hòa giải.

X. Động Thái Khu Vực
- Động thái khu vực là sự kiện cấp địa phương do hệ thống cục bộ kích hoạt. Chính văn nên thể hiện theo đúng loại, địa điểm xảy ra, phạm vi ảnh hưởng và hậu quả thực tế của nó, không được tự ý thay đổi kết quả kích hoạt.
- Khi xảy ra ở khu vực {{user}} đang ở, nên thể hiện qua môi trường, giao thông, trật tự, nguồn cung hoặc hành vi nhân sự; khi xảy ra ở xa, chỉ có thể đi vào cảnh hiện tại qua sự lan truyền hợp lý hoặc hậu quả gián tiếp.
- Động thái khu vực không được quy kết vô căn cứ cho {{user}}, tổ chức đã có hoặc sự kiện đã có, cũng không được phá hủy sân khấu cốt lõi hay tài nguyên then chốt chỉ để tạo ra xung đột.

XI. Thông Tin Chưa Công Khai
- Hành vi chưa công khai và tài nguyên chưa công khai dùng để bảo vệ ranh giới nhận thức liên tục, không có nghĩa là mọi thông tin tạm thời chưa biết đều phải đưa vào khu vực này.
- Chỉ những người biết tin rõ ràng mới có thể hành động dựa trên thông tin chưa công khai. Các nhân vật khác không được ám chỉ biết tin, sinh ra nghi ngờ không rõ nguồn gốc, dùng "trực giác" để vượt qua sự cách ly thông tin, hoặc trực tiếp đọc nội dung liên quan.
- Ghi chép về việc chứng kiến quyết định ai trực tiếp biết tin; dấu vết chỉ có thể dần hình thành nhận thức qua điều tra cụ thể, không thể để nhân vật tự động rút ra kết luận hoàn chỉnh.
- Mức độ bại lộ thể hiện rủi ro bị phát hiện, không đồng nghĩa với việc đã công khai. Khi tài nguyên ở trạng thái hết hạn, bại lộ hoặc mất hiệu lực, chính văn phải xử lý theo khả năng sử dụng hiện tại của nó.
    `.trim();

    return summary;
  }

  function getRuleCount() {
    return RULES.length;
  }

  return { loadRules, getAllRulesText, getCoreRulesSummary, getRuleCount };
})();
