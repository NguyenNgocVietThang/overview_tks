# Dropdown Nguồn — kế hoạch triển khai

Thiết kế được duyệt trong chat: [spec](../specs/2026-10-21-expected-source-filter-design.md). Main, phạm vi file tách biệt cho các subagent, agent chính tích hợp/review/tài liệu. Không commit/push/deploy hoặc ghi Sheets/DB production.

- [x] Giao diện: chỉ `server/public/index.html` và `server/test/frontend/expected-arrivals.test.js`. Thêm select `expectedArrivalsSource` trước Cont, aria-label Lọc theo nguồn; option trống Tất cả nguồn và đủ bảy tên theo SHEET_NAMES. Lọc chính xác sheetName, đăng ký change reset trang1, truyền `source` trong query xuất. Test trước sửa: nguồn/AND/search/KPI/empty/reset/giữ lựa chọn/query xuất; chạy test frontend và shared controls.
- [x] Xuất file: chỉ `server/productContainers/expectedExport.js` và `server/productContainers/expectedRoutes.test.js`. `filterRows` nhận source rỗng hoặc so khớp chính xác sheetName; mô tả HTML bổ sung nguồn. Test trước sửa: exact source/AND/empty, metadata rowCount và đọc lại XLSX/HTML theo nguồn/cột chọn; giữ trường hợp không truyền nguồn và cột cũ.
- [x] Agent chính review độc lập, chạy nhóm test và toàn bộ npm test (dotenv bị chặn, URL DB thật trống, 4 workers), kiểm tra browser fixture đủ7 nguồn desktop/mobile/sáng/tối, cập nhật README/server README/BRD/SRS/implementation_plan/CURRENT thực sự bị ảnh hưởng; graphify update và diff check. Báo chính xác kết quả và hạn chế, chưa deploy.


Kết quả 21/10/2026: review độc lập chấp thuận; nhóm liên quan 67/67 đạt; toàn bộ npm test -- --test-concurrency=4: 3.122 test, 3.119 đạt, 3 bỏ qua, 0 lỗi, exit 0. Môi trường chặn dotenv và URL DB thật trống. Browser fixture 157 dòng desktop/mobile375 sáng/tối xác nhận 7 nguồn, kết hợp Cont, reset trang2 về trang1, KPI và metadata xuất. XLSX/HTML đọc lại qua ExcelJS/JSDOM; chưa mở Excel desktop hoặc kiểm chứng production. Graphify exit0; diff check đạt. Chưa commit/push/deploy; không ghi DB production hoặc Sheets. Chi tiết CURRENT.md và log .codex_tmp/source-filter-full.log.
