# Vị trí hàng Implementation Plan

> **For agentic workers:** Execute this approved plan inline, task by task, with verification after each subsystem.

**Goal:** Tra cứu vị trí hàng HN/SG cho tất cả nhân viên, chặn hoàn toàn Khách.

**Architecture:** Express đọc Google Sheets bằng service account; một nguồn chung có hai sheet. Trang riêng dùng shared navigation, tìm kiếm mã/tên và phân trang tại trình duyệt. Không ghi Sheets, không lưu Postgres, không tải định kỳ.

**Tech Stack:** Node/Express, googleapis hiện có, HTML/CSS/JavaScript, node:test và JSDOM.

## Global Constraints

- `/stock-locations/#hn|sg`; `GET /api/stock-locations?branch=HN|SG`.
- Bảng 5 cột: Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Vị trí; 100 dòng/trang; không xuất file.
- Sheet nguồn: `1J5yRJfOjNjzx0akOtog0ro3d5HGPhMTl7LklBWHZPqw`, tab `Vị trí HN` và `Vị trí SG`.
- Giữ giá trị hiển thị, thứ tự và dòng trùng; giữ SL = 0/vị trí trống; bỏ dòng không có cả mã lẫn tên.
- Khách không được cấp `stockLocations.view`, kể cả ghi đè riêng.
- Đã xác nhận nguồn thực tế: tab HN tên `VỊ TRÍ HN` (so khớp tên không phân biệt hoa/thường); cột `TỔNG SL đã đi` ở SG được ánh xạ thành `Tổng SL`.

## Task 1 — Google Sheets và API

- [ ] Thêm cấu hình optional `STOCK_LOCATIONS_SPREADSHEET_ID` và hai tên sheet.
- [ ] Mở rộng `server/sheets/sheetsClient.js` để `getValues(sheetName, { valueRenderOption: 'FORMATTED_VALUE' })` giữ mã có số 0 đầu; mặc định cũ không đổi.
- [ ] Tạo `server/stockLocations/stockLocationsService.js`: ánh xạ tiêu đề theo tên sau chuẩn hóa khoảng trắng/hoa thường, giữ nội dung ô, kiểm tra đủ 5 cột, gộp yêu cầu đang chạy theo workbook/cơ sở, không cache kết quả.
- [ ] Tạo `server/stockLocations/stockLocationsRoutes.js`: auth → feature → branch → kiểm tra HN/SG nằm trong scope → đọc nguồn. Trả `{ branch, rows }`, lỗi nguồn 503 và lỗi cơ sở 400/403.
- [ ] Test dữ liệu đổi thứ tự cột, tiêu đề phía dưới dòng ghi chú, ô trống, SL = 0, mã trùng/số 0 đầu, thiếu sheet/cột, in-flight và đọc mới.

## Task 2 — Phân quyền và điều hướng

- [ ] Thêm nhóm/quyền/trang vào `featureRegistry`; metadata `forbiddenRoles` chặn Khách sau khi áp overrides, kể cả danh sách permissions có sẵn.
- [ ] Catalog quyền trả forbiddenRoles; PUT quyền từ chối cấp cho vai trò bị chặn; form tài khoản hiển thị disabled.
- [ ] Sidebar thêm nhóm Vị trí hàng, lọc HN/SG theo cơ sở đang chọn, chuẩn hóa active hash.
- [ ] Test default mọi vai trò nội bộ, Khách có override vẫn bị chặn, page guard và PUT quyền không lưu grant trái phép.

## Task 3 — Trang bảng

- [ ] Tạo `server/public/stock-locations/` với HTML, CSS và JS; tái sử dụng header, theme, shared sidebar/auth.
- [ ] Mỗi tab có state query/page riêng; tải mới khi chuyển tab; không timer; tránh response cũ ghi đè tab mới.
- [ ] Tìm mã/tên không dấu trước phân trang 100 dòng, query mới về trang 1; render textContent để bảo toàn nội dung an toàn.
- [ ] Test JSDOM cho ba cơ sở, hash, tải lại tab, query/page riêng, tìm ngoài trang đầu, response sai thứ tự, trạng thái rỗng/lỗi, và không xuất file.

## Task 4 — Xác minh và tài liệu

- [ ] Cấu hình workbook nguồn ở `.env` local nếu chưa có; không commit thông tin xác thực.
- [ ] Cập nhật `.env.example`, README, BRD/SRS và tài liệu vận hành nguồn/quyền.
- [ ] Chạy tests tính năng và hồi quy auth/branch/frontend, sau đó `npm test`; kiểm tra diff và cú pháp.
- [ ] Đọc nguồn thực tế bằng service account với TLS được xác minh. Nếu Google trả 403, ghi rõ chưa nghiệm thu dữ liệu thực tế và cung cấp bước share Viewer; không thay quyền chia sẻ ngoài phạm vi yêu cầu.
