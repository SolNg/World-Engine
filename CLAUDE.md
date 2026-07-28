# World Engine

Extension cho SillyTavern. Bản dịch tiếng Việt của dự án gốc 世界引擎 (tác giả Disnight, MIT).

Không có bước build, không có `package.json`, không dùng ES module. Mọi module là IIFE gán vào `window.*`, nạp tuần tự bằng `loadScript()` theo nhóm engine khai trong `ENGINE_GROUPS` ở `world-engine.js`. Mỗi nhóm khai kèm `contracts` — danh sách hàm bắt buộc phải có, dùng để kiểm tra sau khi nạp.

Toàn bộ mã nguồn, chú thích, chuỗi giao diện và prompt gửi AI đều bằng tiếng Việt. Giữ nguyên quy ước đó khi thêm code mới.

## Agent skills

### Issue tracker

Issue nằm ở GitHub Issues của `SolNg/World-Engine`, thao tác bằng `gh` CLI. Xem `docs/agents/issue-tracker.md`.

### Triage labels

Năm nhãn phân loại chuẩn, tên nhãn trùng với tên vai trò. Xem `docs/agents/triage-labels.md`.

### Domain docs

Một ngữ cảnh duy nhất — `CONTEXT.md` và `docs/adr/` ở gốc kho. Xem `docs/agents/domain.md`.
