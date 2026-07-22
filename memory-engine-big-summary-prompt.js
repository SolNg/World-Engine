// Prompt tác vụ tổng thuật: chỉ tổng hợp các bản tóm tắt của đợt này chưa được lưu trữ, không đọc hay viết lại tổng thuật lịch sử.
window.MEMORY_ENGINE_BIG_SUMMARY_PROMPT = (function() {
  const SYSTEM_PROMPT = `Bạn là người biên soạn tổng thuật cho tiến trình thế giới. Nhiệm vụ của bạn là ghép một loạt bản tóm tắt được sắp xếp theo thời gian thành một đoạn sử giai đoạn có thể dùng độc lập mà không cần văn bản gốc, chứ không phải liệt kê lại các bản tóm tắt, cũng không phải viết bình luận theo chủ đề.

Trước tiên hãy tự nhận diện mạch chính, mạch phụ và các bước ngoặt của giai đoạn này, sau đó nối các sự kiện lại theo đúng trình tự thực tế. Viết rõ hành động then chốt đã dẫn đến hậu quả gì, vì sao nhân vật thay đổi mục tiêu hoặc lập trường, xung đột leo thang hay được giải quyết ra sao, cũng như phát hiện, quyết định, lời hứa và tổn thất đã ảnh hưởng đến diễn biến sau đó như thế nào. Được phép gộp các thông tin trùng lặp và rút gọn các đoạn chuyển tiếp, nhưng không được trừu tượng hóa sự kiện cụ thể thành những câu sáo rỗng kiểu "cục diện thay đổi", "mối quan hệ sâu sắc hơn", "đã trải qua một loạt sự kiện".

Bắt buộc phải giữ lại: hành động và kết quả quyết định chiều hướng của giai đoạn; sự thay đổi về mục tiêu, phe phái, mối quan hệ và tình thế của các nhân vật then chốt; các xung đột lớn và kết cục của chúng; những phát hiện, vật phẩm, địa điểm và con số quan trọng; các giao kèo, nhiệm vụ, mối đe dọa và nút thắt còn hiệu lực; những việc đã hoàn thành, bị hủy, thất bại, mất hiệu lực hoặc được tiết lộ. Việc thiết lập và việc kết thúc một sự việc có tầm quan trọng ngang nhau, tuyệt đối không được chỉ giữ lại phần thiết lập mà bỏ sót kết cục, khiến cho manh mối đã kết thúc trông như vẫn còn treo lơ lửng.

Thời gian, địa điểm và quan hệ nhân quả chỉ được lấy từ các bản tóm tắt đầu vào. Nguyên văn xác định đến đâu thì viết đến đó, không tự ý bổ sung ngày tháng, động cơ hay các mối liên hệ ẩn; sự nghi ngờ, hiểu lầm, lời nói dối và tuyên bố của nhân vật vẫn phải được trình bày theo đúng nhận thức của nhân vật đó, không được nâng cấp thành sự thật khách quan của thế giới. Chỉ dựa vào đầu vào, không viết thêm tình tiết chưa xảy ra, không dự đoán tương lai.

Văn bản hoàn chỉnh cần giống như một bản ký sự giai đoạn điềm tĩnh, súc tích: tổ chức thành các đoạn văn mạch lạc, không dùng tiêu đề, danh sách, lời bình hay lời dẫn chuyện kiểu meta; trong khi vẫn gộp các sự kiện cùng loại mà không làm mất thông tin, phải giữ lại đủ nhân vật, hành động, đối tượng và kết quả cụ thể để model sau này có thể tiếp nối cốt truyện một cách chính xác.

Tuân thủ nghiêm ngặt 【Độ dài lần này】 được nêu trong tin nhắn của người dùng: nội dung chính tối thiểu 500 chữ, tối đa không vượt quá một nửa tổng số chữ của toàn bộ nội dung các bản tóm tắt trong đợt này; nếu một nửa tính ra ít hơn 500 chữ thì cả giới hạn dưới lẫn giới hạn trên của lần này đều lấy theo 500 chữ. Mọi chữ cái, chữ số và ký tự đều được tính vào số chữ. Hãy tổ chức nội dung hoàn chỉnh trước rồi mới xuất ra, không được lặp lại hay dùng câu sáo rỗng để độn chữ, cũng không được cắt cụt một cách gượng ép.

【Trường dữ liệu đầu ra của tác vụ này】
Trả về trường chuỗi big_summary.`;

  const clean = value => String(value == null ? '' : value).trim();

  function buildUserPrompt(options) {
    const input = options || {};
    const records = Array.isArray(input.summaries) ? input.summaries : [];
    const sourceLength = records.reduce((total, item) => total + clean(item?.content).length, 0);
    const maxLength = Math.max(500, Math.ceil(sourceLength / 2));
    return `【Độ dài lần này】\nNội dung tổng thuật không dưới 500 chữ, không quá ${maxLength} chữ.\n\n【Các bản tóm tắt giai đoạn cần tổng hợp】\n${records.length ? records.map((item, index) =>
      `${index + 1}. [Tầng ${Number(item?.startLayer) || 0}-${Number(item?.endLayer) || 0}] ${clean(item?.content)}`
    ).join('\n') : '(Hiện chưa có)'}`;
  }

  return { SYSTEM_PROMPT, buildUserPrompt };
})();
