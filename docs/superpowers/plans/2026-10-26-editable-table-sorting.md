# Editable Table Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sắp xếp đúng các cột có ô nhập và căn giữa tiêu đề của các bảng dữ liệu.

**Architecture:** Giữ bộ điều khiển bảng và sort riêng đang có; sửa cách đọc giá trị hiện tại của form control tại các điểm cần thiết. Dùng CSS chung để căn tiêu đề mà không thay cách căn nội dung ô hoặc cơ chế sort phía máy chủ.

**Tech Stack:** Vanilla JavaScript/CSS/HTML, Node.js, node:test, JSDOM.

## Global Constraints

- Thiết kế: [editable-table-sorting-design](../specs/2026-10-26-editable-table-sorting-design.md).
- Thực hiện trên checkout riêng của `main` local tại `C:/Users/BOSS/.codex/worktrees/editable-table-sort/Web TKS Dashboard`, nền `18dab0c6`; không pull, bảo toàn prototype trong workspace cũ.
- Không thêm API, migration hoặc thư viện; không deploy trong phạm vi này.
- Một subagent sửa Markdown, agent chính sửa mã và kiểm chứng.
- Giữ sort trên toàn bộ dữ liệu đã lọc của bảng phân trang, các cột thao tác và bảng chủ đích tắt sort.

### Task 1: Đọc đúng giá trị và bổ sung sort còn thiếu

**Files:** `server/public/shared/table-controls.js`, `server/public/index.html`, `server/public/humanresources/index.html` và trang có bộ sort riêng được xác định khi rà soát; test liên quan trong `server/test/frontend/`.

**Interfaces:** Giữ `TKSTables` và các hàm sort hiện có; bộ đọc ô trả giá trị so sánh từ input/textarea/select đang hiển thị.

- [x] Rà soát các bộ đọc giá trị và tiêu đề cột nhập liệu chưa sort được; phân biệt ngoại lệ có chủ đích.
- [x] Thêm regression test cho số, ngày, ghi chú, select và giá trị vừa sửa, chạy để xác nhận lỗi trước sửa.
- [x] Sửa tối thiểu, giữ quy tắc ô trống/thứ tự ổn định và chu kỳ tăng → giảm → ban đầu.
- [x] Chạy nhóm test sort, table controls, phân trang và trang bị ảnh hưởng.

### Task 2: Căn giữa tiêu đề bảng và nghiệm thu

**Files:** `server/public/shared/shared.css`, `server/public/shared/table-controls.css`, test CSS/frontend liên quan, `CURRENT.md`.

**Interfaces:** Tiêu đề và nhãn sort căn giữa; nội dung ô dữ liệu, biểu tượng sort và resize giữ đúng chức năng.

- [x] Thêm kiểm tra tiêu đề thông thường, tiêu đề số liệu và tiêu đề có nút sort.
- [x] Sửa CSS chung và kiểm tra ảnh hưởng của CSS riêng từng trang.
- [x] Kiểm tra trình duyệt fixture: sáng/tối, desktop/mobile và sort. Chưa kiểm kéo độ rộng cột trên trình duyệt.
- [x] Chạy kiểm thử phù hợp và toàn suite; ghi nhận bằng chứng cùng lỗi ngoài phạm vi nếu có.
- [x] Cập nhật `CURRENT.md`, rà soát diff và cập nhật đồ thị mã theo quy định dự án.


Tiến độ 26/10/2026: nhóm liên quan 54/54 đạt; fixture Edge desktop/mobile sáng/tối đạt, chưa kiểm ứng dụng đăng nhập/production. Graphify exit 0. Toàn suite `npm test -- --test-concurrency=4` exit 0: 3.582 test, 3.579 đạt, 3 bỏ qua, 0 lỗi; log `server/table-sort-full.log`. Graphify cuối: 12.836 nút, 28.117 cạnh, 542 cộng đồng (`server/table-sort-graphify-final.log`). Hoàn tất cục bộ; chưa commit/push/deploy.
