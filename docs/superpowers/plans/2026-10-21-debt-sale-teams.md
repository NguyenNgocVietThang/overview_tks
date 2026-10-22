# Nhóm sale trong Công nợ — Implementation Plan

**Goal:** Nhóm sale và lọc nhóm tại ba bảng chính, đồng bộ Khách hàng và xuất Excel/HTML có biểu đồ theo nhóm.

**Architecture:** Tra `sale_teams` tại thời điểm đọc sau cache; dùng `businessMonths.nameKey` và `NO_TEAM`. Không thêm DB migration hoặc sao chép nhóm vào bản chốt.

**Tech Stack:** Express/CommonJS, Postgres, vanilla JS, ExcelJS, Chart.js.

## Constraints

- Chỉ ba bảng chính; không sửa bảng chi tiết hoặc tiền/hạng đã chốt.
- Giữ phân quyền và phạm vi cơ sở, phân trang, bộ lọc, Light/Dark.

## Tasks

- [x] Viết test thay nhóm trong DB và kiểm tra chuẩn hóa tên/không sửa cache; chạy test đỏ trước khi thêm `debtSchedule/saleTeams.js`.
- [x] Ghép `saleTeam` sau cache ở `debtScheduleService.js`, `debtRewardService.js`; đổi nhóm trong `businessReportRepository.js` tăng version và phát SSE.
- [x] Viết test lọc nhóm UI/export; thêm cột, dropdown, reset phân trang và context xuất trong `public/index.html`.
- [x] Thêm cột/lọc nhóm cho dataset dùng chung Excel/HTML trong `dashboard/exportService.js`.
- [x] Viết test tổng hợp nhóm; thêm biểu đồ theo nhóm vào `dashboard/exportHtmlReport.js`.
- [x] Chạy toàn bộ tests, kiểm tra diff và cập nhật CURRENT.md với kết quả. Test Công nợ/export đạt; còn 3 test phân quyền Marketing/Hàng hóa ngoài phạm vi (xem CURRENT.md).

**Validation:** `node --require dotenv/config --max-old-space-size=4096 --test` tại server; `git diff --check`; `graphify update .`.
