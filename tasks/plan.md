# Implementation Plan: Nâng cấp UI/UX trang Dashboard (server/public/index.html)

## Overview

7 điểm nâng cấp UI/UX cho trang Dashboard chính (`server/public/index.html`, 8716 dòng) và `server/public/shared/shared.css` (dùng chung 10 trang khác). Khảo sát thực tế (Explore agent, không phải suy đoán) xác nhận cả 7 điểm đều có bằng chứng cụ thể — không có điểm nào là "đã làm rồi". Kế hoạch này CHƯA code, chỉ lên task.

**Không xung đột với tiến trình rollup Postgres đang làm song song** — rollup chỉ đụng `server/dashboard/`, `server/kiotvietSync/`, `server/db/`; kế hoạch này chỉ đụng `server/public/`. An toàn chạy tuần tự bất cứ lúc nào sau khi rollup merge xong (khuyến nghị đợi rollup merge trước để tránh 2 đợt thay đổi lớn chồng lên nhau trên cùng session).

## Architecture Decisions

- **`shared.css` là nguồn sự thật duy nhất cho token/component dùng chung** (đang bị `index.html` định nghĩa lại gần như toàn bộ, dòng 27-3027) — token/biến nào `index.html` có mà `shared.css` thiếu (`--shadow-rgb`, `--overlay-rgb`, `--primary-rgb-d/l`, `--glow-green-rgb`, `--glow-red-rgb`) thì BỔ SUNG vào `shared.css`, không giữ 2 bản song song. Thang bo góc: chọn hệ `--radius-xs/sm/md/lg/xl/pill` của `shared.css` (đã dùng ở 9 trang khác), map hệ `--radius-2/4/5/6/7/8/9/10/12/14` riêng của `index.html` sang hệ này.
- **Tách file theo rủi ro tăng dần**: CSS trước (an toàn, không có logic), JS sau (rủi ro cao hơn vì global state/closures) — không gộp 2 việc cùng 1 task.
- **Component trạng thái (skeleton/empty/error/stale) là class dùng chung mới trong `shared.css`** + 1 helper JS nhỏ, thay cho 14 chỗ `<td>Đang tải...</td>` viết cứng + các pattern lỗi rời rạc hiện tại (`errorBox.textContent`, `setSearchStatus`, `innerHTML` tay).
- **Bảng**: mở rộng rule `thead th` chung để sticky mặc định (thay vì chỉ 3 nơi lẻ tẻ như hiện tại), thêm density/column-visibility/mobile-card-view làm 4 task tách biệt (đúng nguyên tắc "touches independent subsystems" trong skill — gộp chung sẽ thành 1 task XL).
- **Container Queries** thay `@media` viewport cho các khối lồng trong sidebar có thể co giãn (KPI grid, chart-box, filterbar-row) — không đổi hành vi ở viewport hẹp toàn trang (giữ `@media (max-width:760px)` cho mobile thật), chỉ thêm khả năng co giãn theo container cha.
- **View Transitions**: progressive enhancement quanh `switchView()` hiện có (`document.startViewTransition`, fallback nguyên trạng nếu trình duyệt không hỗ trợ), làm SAU CÙNG vì cần dọn xong rule reduced-motion trùng lặp (Task 1) trước để không xung đột 2 nơi định nghĩa `animation-duration` khác giá trị (`shared.css` dùng `0.001ms`, `index.html` dùng `.01ms`).

## Task List

### Phase 0: Quick win (độc lập, làm bất cứ lúc nào)
- [ ] Task 0: Bỏ `backdrop-filter` trên `.export-modal-backdrop`

### Phase 1: Nền tảng — hợp nhất token & component
- [ ] Task 1: Hợp nhất design token trùng giữa `shared.css` và `index.html`
- [ ] Task 2: Hợp nhất component class trùng (`.kpi-card`, `.panel`, `.search-input`, `.btn-primary`, `.loading-veil`)

### Checkpoint: Phase 1
- [ ] Trang render y hệt trước khi sửa (so sánh screenshot 6 tab, trước/sau)
- [ ] Không còn biến/class định nghĩa trùng giữa 2 file (grep xác nhận)
- [ ] Review với người dùng trước khi sang Phase 2

### Phase 2: Tách file `index.html`
- [ ] Task 3: Tách CSS inline ra `server/public/css/dashboard.css`
- [ ] Task 4: Tách JS inline ra `server/public/js/dashboard.js`

### Checkpoint: Phase 2
- [ ] Đủ 6 tab + modal export hoạt động y hệt trước (test tay từng tab)
- [ ] `index.html` chỉ còn markup + `<link>`/`<script src>`
- [ ] Review với người dùng trước khi sang Phase 3

### Phase 3: Chuẩn hóa trạng thái dữ liệu
- [ ] Task 5: Thêm class trạng thái dùng chung (`.state-skeleton`, `.state-empty`, `.state-error`, `.state-stale`) + helper JS
- [ ] Task 6: Áp dụng vào các bảng/khu vực hiện có (thay 14 chỗ "Đang tải..." + các pattern lỗi rời rạc)

### Phase 4: Cải thiện bảng
- [ ] Task 7: Sticky header đồng bộ cho toàn bộ bảng nghiệp vụ chính
- [ ] Task 8: Column visibility toggle (làm mẫu 1-2 bảng lớn trước)
- [ ] Task 9: Density mode (compact/comfortable)
- [ ] Task 10: Mobile card view cho bảng chính

### Checkpoint: Phase 3-4
- [ ] Bảng chính có sticky header, đổi được density, xem tốt trên mobile (test tay + `resize_window` mobile preset)
- [ ] Review với người dùng trước khi sang Phase 5

### Phase 5: Container Queries
- [ ] Task 11: Container queries cho KPI grid
- [ ] Task 12: Container queries cho chart-box/filterbar-row

### Phase 6: View Transitions
- [ ] Task 13: Bọc `switchView()` bằng View Transitions API, dọn rule reduced-motion trùng

### Checkpoint: Hoàn thành
- [ ] Toàn bộ acceptance criteria đạt
- [ ] `npm test` pass (test frontend liên quan: `auth-guest-ui.test.js`, `debt-management-ui.test.js`, `table-search-ui.test.js`...)
- [ ] Review cuối với người dùng

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tách JS (Task 4) làm vỡ global state/closures giữa các hàm | Cao — hỏng cả trang | Tách sau khi tách CSS (Task 3) đã ổn định; verify bằng test tay đủ 6 tab + preview_start trước khi coi là xong |
| Đổi sticky header (Task 7) tràn ra ngoài các bảng đã có sticky riêng (`.search-results-table`, `.debt-table-wrap`) | Trung bình — sticky đè 2 lớp | Dọn 2 định nghĩa trùng lặp dark/light ở `.scroll-list` trước, test riêng từng bảng |
| Container Queries (Task 11-12) là API mới, có thể chưa hỗ trợ trình duyệt cũ | Thấp | `container-type` suy biến an toàn (fallback về layout hiện tại) nếu trình duyệt không hỗ trợ — không cần polyfill |
| View Transitions (Task 13) xung đột với rule reduced-motion đã có 2 bản khác giá trị | Trung bình | Dọn trùng ở Task 1 trước, test với `prefers-reduced-motion: reduce` bật/tắt |
| Nhiều task chạm `index.html` — dễ đụng session khác nếu có ai cùng sửa file này | Trung bình | Kiểm tra `git status` trước mỗi task, làm trên 1 nhánh/worktree riêng nếu có việc khác đang chạy song song |

## Open Questions

- Tách JS (Task 4) thành 1 file `dashboard.js` hay chia nhỏ hơn theo khu vực (overview.js/products.js/invoices.js...)? Đề xuất: 1 file trước (an toàn hơn, ít rủi ro đứt gãy biến dùng chung), chia nhỏ tiếp ở đợt sau nếu cần — nhưng cần người dùng xác nhận trước khi làm Task 4.
- Column visibility (Task 8) và Density (Task 9) nên áp dụng ngay cho toàn bộ 21 bảng hay chỉ vài bảng lớn nhất trước (Hàng hóa, Hóa đơn)? Đề xuất làm mẫu 1-2 bảng trước, mở rộng sau khi người dùng duyệt UX.
- Mobile card view (Task 10) có cần cho TẤT CẢ bảng hay chỉ các bảng người dùng hay xem trên điện thoại? Cần hỏi người dùng use-case thực tế trước khi làm.
