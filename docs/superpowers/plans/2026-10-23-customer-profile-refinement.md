# Cập nhật Chi tiết khách Implementation Plan

> For agentic workers: thực hiện tuần tự theo các hạng mục dưới đây; dùng executing-plans hoặc subagent-driven-development cho các phần độc lập.

**Goal:** Cập nhật Chi tiết khách theo demo và thiết kế người dùng đã duyệt ngày 23/10/2026.

**Architecture:** Giữ frontend hiện hữu và route Express/Pg. Thông tin chung và đánh giá quy mô có thao tác upsert riêng, không ghi đè nhóm cột của nhau. Không thêm thư viện.

**Tech Stack:** JavaScript, Express, PostgreSQL/PGlite, JSDOM, Chrome/Playwright cho kiểm chứng.

## Global Constraints
- Giữ các thay đổi có sẵn của người dùng; không reset hay ghi đè nội dung ngoài phạm vi.
- Không áp migration lên DB dùng chung hoặc deploy trong công việc này.
- Thiết kế: `docs/superpowers/specs/2026-10-23-customer-profile-refinement-design.md`.

## Task 1 — Dữ liệu và quyền (hoàn tất)
- [x] Viết ca kiểm thử mới cho area, enum, migration cũ, quyền và lưu riêng; chạy để xác nhận thiếu tính năng.
- [x] Bổ sung migration 0084, area mặc định rỗng, very_large và khac; giữ nguyên migration 0080.
- [x] Tách PUT scale có customerNotes + customerManage, trả `{warehouseScale}`; PUT profile bỏ qua scale. Hai UPSERT cập nhật cột riêng.
- [x] Kiểm thử repository, route và migration: 38 ca qua, không truy cập DB thật.

## Task 2 — Giao diện và hành vi (hoàn tất)
- [x] Điều chỉnh form Diện tích/Đối thủ rộng hàng, text tự xuống dòng và tăng chiều cao; dropdown Khác chọn nhiều.
- [x] Ba nhóm quản lý: người sửa tối đa 260px, quy mô tối đa 220px, lịch compact; màn hình nhỏ xếp dọc. Ngày chỉ có viền khi được chọn, ô vuông, giữ Các ngày đã đi/Lưu/Hủy.
- [x] Bỏ nút lịch ngoài bảng; Note cuộn riêng tối đa 360px.
- [x] Gallery: nút/phím trước sau chỉ trong ảnh lớn, chặn biên, một ảnh ẩn nút, giữ focus, Esc đóng ảnh lớn trước.
- [x] Kiểm tra giữ thông tin chưa lưu khi lưu quy mô, lỗi lưu và cảnh báo đóng có thay đổi.
- [x] Sửa theo review: tự tính lại chiều cao textarea khi viewport/khung thay đổi; dọn ResizeObserver và listener khi đóng/vẽ lại.

## Task 3 — Kiểm chứng và tài liệu (hoàn tất)
- [x] JSDOM khách hàng 29 ca; bộ báo cáo kinh doanh + frontend báo cáo + migration tổng 169 ca qua.
- [x] Chrome dùng dữ liệu giả: desktop 1440px và mobile 390px; ô ngày vuông, ba nhóm đúng bố cục, Note 360px, textarea không che nội dung sau resize, không tràn ngang/không lỗi JavaScript.
- [x] Review độc lập backend/frontend và re-review phần resize, không còn phát hiện cần sửa.
- [x] Cập nhật spec, README, server README/API, schema, BRD/SRS và trạng thái triển khai.

## Bàn giao
Nhánh `codex/customer-profile-refinement`, thay đổi giữ ở workspace để người dùng review. Migration `0084_customer_profile_details.sql` chưa áp DB dùng chung; chưa deploy. Kết quả kiểm chứng cục bộ trong `.codex_tmp/customer-profile-regression.log` và `.codex_tmp/customer-profile-browser-results.json`.
