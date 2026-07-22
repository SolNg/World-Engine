# Memory Engine v1.1.0

## Nhật ký cập nhật

- Việc trích xuất trí nhớ ở vòng mới nhất giờ có thể tham chiếu thêm chính văn gần đây, các bản tóm tắt cũ hơn và tổng thuật làm tài liệu phụ trợ, mặc định là 1 vòng chính văn, 5 bản tóm tắt, 1 bản tổng thuật.
- Thêm công tắc "ẩn chính văn". Khi tắt sẽ giữ lại toàn bộ chính văn; khi bật mới ẩn chính văn cũ đã được bản tóm tắt bao phủ theo số vòng giữ lại.
- Bản tóm tắt và tổng thuật không còn bị cắt bớt nội dung trả về từ API, giá trị output tối đa mặc định của API được điều chỉnh thành 65000.
- Nhân vật, thực thể, bản tóm tắt và tổng thuật đều hỗ trợ thu gọn, bảng điều khiển sẽ tự động làm mới sau khi kết quả từ API được lưu.

## Nội dung bài đăng có thể sao chép trực tiếp

【Cập nhật Memory Engine v1.1.0】

Bản này tăng cường trí nhớ cho các cuộc trò chuyện dài. Khi tổng hợp vòng mới nhất, có thể tham chiếu thêm chính văn gần đây, các bản tóm tắt cũ hơn và tổng thuật; thêm công tắc "ẩn chính văn", khi không muốn ẩn vẫn có thể giữ nguyên toàn bộ chính văn cuộc trò chuyện. Bản tóm tắt và tổng thuật không còn bị cắt bớt nội dung trả về từ API, nhân vật, thực thể, bản tóm tắt và tổng thuật đều hỗ trợ thu gọn, bảng điều khiển sẽ tự động làm mới sau khi tạo xong.
