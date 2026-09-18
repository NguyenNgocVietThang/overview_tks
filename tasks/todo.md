# Todo: Nâng cấp UI/UX Dashboard

Xem `tasks/plan.md` cho tổng quan/kiến trúc/rủi ro. Mỗi task dưới đây độc lập verify được — không bắt đầu task tiếp theo khi task hiện tại chưa qua checkpoint.

---

## Task 0: Bỏ `backdrop-filter` trên overlay modal Xuất Excel

**Description:** `.export-modal-backdrop` (`index.html:1775`) dùng `backdrop-filter: blur(3px)` — tốn hiệu năng, gây giật khi mở modal trong lúc dashboard đang tự làm mới dữ liệu nền. `shared.css:937` đã có tiền lệ tự chủ đích KHÔNG dùng backdrop-filter cho `.loading-veil` vì lý do y hệt — áp dụng cùng quyết định.

**Acceptance criteria:**
- [ ] Bỏ `backdrop-filter: blur(3px)` khỏi `.export-modal-backdrop`
- [ ] Overlay vẫn đủ tối/tương phản để modal nổi bật (thay bằng nền `rgba(...)` đậm hơn nếu cần, không blur)
- [ ] Mở modal export trong lúc dashboard đang loading không còn giật (test tay)

**Verification:**
- [ ] Manual check: mở `/api/dashboard` loading + bấm Xuất Excel cùng lúc, quan sát không giật
- [ ] Screenshot trước/sau để xác nhận vẫn dễ đọc

**Dependencies:** None

**Files likely touched:**
- `server/public/index.html` (dòng ~1766-1776)

**Estimated scope:** XS (1 file, 1 dòng)

---

## Task 1: Hợp nhất design token trùng giữa `shared.css` và `index.html`

**Description:** `index.html` định nghĩa lại toàn bộ `:root`/`:root[data-theme="light"]` (dòng 29-118) trùng với `shared.css:12,141` — cùng tên biến (`--bg`, `--panel`, `--primary`, `--text`, `--muted`, `--space-*`...) nhưng cách biểu diễn khác nhau, và 2 hệ thang bo góc song song không tương thích tên (`shared.css` dùng `--radius-xs/sm/md/lg/xl/pill`, `index.html` dùng `--radius-2/4/.../14/circle/pill-lg`).

**Acceptance criteria:**
- [ ] Xóa khối `:root`/`:root[data-theme="light"]` trùng trong `index.html`, chỉ giữ lại biến THẬT SỰ riêng của trang (nếu có)
- [ ] Bổ sung vào `shared.css` các biến `index.html` có mà `shared.css` thiếu: `--shadow-rgb`, `--overlay-rgb`, `--primary-rgb-d/l`, `--glow-green-rgb`, `--glow-red-rgb`
- [ ] Map toàn bộ chỗ dùng `--radius-2/4/5/6/7/8/9/10/12/14/circle/pill-lg` trong `index.html` sang hệ `--radius-xs/sm/md/lg/xl/pill` của `shared.css` (thêm biến `--radius-pill-lg`/`--radius-circle` vào `shared.css` nếu không có tương đương)
- [ ] Cả 2 theme (dark/light) hiển thị đúng màu như trước khi sửa

**Verification:**
- [ ] `grep -n "^\s*--" server/public/index.html` chỉ còn biến thật sự riêng (nếu còn) — không còn `--bg`/`--panel`/`--primary`/`--space-*` trùng `shared.css`
- [ ] Screenshot 6 tab, cả 2 theme, trước/sau — không lệch màu/bo góc
- [ ] `npm test` (frontend tests liên quan CSS class không có, chỉ cần build/lint nếu có — chủ yếu verify bằng mắt)

**Dependencies:** None

**Files likely touched:**
- `server/public/shared/shared.css`
- `server/public/index.html` (dòng 27-118)

**Estimated scope:** M (2 files, nhiều điểm thay thế)

---

## Task 2: Hợp nhất component class trùng

**Description:** `.kpi-card`, `.panel`, `.search-input` được định nghĩa ĐẦY ĐỦ ở cả 2 file (không phải override nhỏ); `.btn-primary`/`.loading-veil` chỉ override 1 phần ở `index.html` (đã có comment tự thừa nhận). Cần 1 nguồn định nghĩa gốc.

**Acceptance criteria:**
- [ ] `.kpi-card`/`.kpi-stat`: định nghĩa gốc chuyển hẳn về `shared.css`, `index.html` chỉ giữ biến thể `.accent-amber/green/red/blue`
- [ ] `.panel`/`.panel-head`: định nghĩa gốc về `shared.css`, `index.html` chỉ giữ phần thật sự đặc thù (nếu có)
- [ ] `.search-input`: định nghĩa gốc về `shared.css` (đang định nghĩa lại toàn bộ ở `index.html:876-932`, bỏ bản trùng)
- [ ] `.btn-primary:active`/`.loading-veil` override ở `index.html` giữ nguyên (đã đúng, chỉ override thật sự) — không đụng
- [ ] Giao diện KPI card/panel/ô tìm kiếm không đổi (screenshot trước/sau)

**Verification:**
- [ ] Screenshot 6 tab trước/sau, so sánh KPI card/panel/search box
- [ ] `grep -n "\.kpi-card\|\.panel {" server/public/index.html` chỉ còn biến thể, không còn định nghĩa đầy đủ trùng `shared.css`

**Dependencies:** Task 1

**Files likely touched:**
- `server/public/shared/shared.css`
- `server/public/index.html` (dòng ~876-932, 1458-1641)

**Estimated scope:** M (2 files)

---

## Checkpoint: Phase 1 (sau Task 0-2)
- [ ] Trang render y hệt trước khi sửa — không lệch màu/bo góc/component ở cả 2 theme, 6 tab
- [ ] `grep` xác nhận không còn token/component định nghĩa trùng
- [ ] Review với người dùng trước khi sang Task 3

---

## Task 3: Tách CSS inline ra file riêng

**Description:** Sau khi Task 1-2 dọn xong phần trùng, phần CSS còn lại thật sự riêng của trang Dashboard (ước lượng còn lại sau khi bớt phần trùng) cần tách khỏi `<style>` inline (hiện dòng 27-3027) ra file CSS riêng, giữ `index.html` gọn.

**Acceptance criteria:**
- [ ] Toàn bộ CSS còn lại (sau Task 1-2) trong khối `<style>` của `index.html` chuyển sang `server/public/css/dashboard.css`
- [ ] `index.html` include bằng `<link rel="stylesheet" href="/css/dashboard.css?v=...">` (theo đúng pattern versioning `?v=` đã dùng cho `shared.css`)
- [ ] Không còn khối `<style>` lớn trong `index.html` (trừ script chặn FOUC nếu có, giữ nguyên vị trí đó)
- [ ] Giao diện không đổi (screenshot trước/sau)

**Verification:**
- [ ] Screenshot 6 tab trước/sau
- [ ] `wc -l server/public/index.html` giảm đáng kể so với 8716 dòng ban đầu (trừ phần đã tách)
- [ ] Mở DevTools Network, xác nhận `dashboard.css` load thành công, không lỗi 404

**Dependencies:** Task 1, 2

**Files likely touched:**
- `server/public/index.html`
- `server/public/css/dashboard.css` (mới)

**Estimated scope:** M (2 files, cơ học nhưng khối lượng lớn ~3000 dòng)

---

## Task 4: Tách JS inline ra file riêng

**Description:** Khối `<script>` chính (hiện dòng 4620-8711, ~4092 dòng) chứa toàn bộ logic Dashboard (fetch data, render KPI/chart/bảng, filter, search, export...) — tách ra file JS riêng. Đây là task RỦI RO CAO NHẤT trong cả kế hoạch vì JS có global state/closures giữa các hàm — làm SAU Task 3 để giảm số biến thay đổi cùng lúc.

**Acceptance criteria:**
- [ ] Toàn bộ logic trong khối `<script>` chính chuyển sang `server/public/js/dashboard.js`
- [ ] `index.html` include bằng `<script src="/js/dashboard.js?v=..." defer>` (giữ đúng vị trí tương đối so với `vendor/chart.umd.min.js`, `js/pagination.js`, `js/table-explorer.js`, `shared/shared-nav.js`, `shared/dateInput.js` — thứ tự load hiện có)
- [ ] Script chặn FOUC (dòng 9-22, load sớm trong `<head>`) GIỮ NGUYÊN inline, không tách (cần chạy trước khi CSS load xong)
- [ ] Toàn bộ 6 tab (Tổng quan/Hàng hóa/Hóa đơn/Khách hàng/Nhà cung cấp/Quản lý công nợ) hoạt động y hệt trước: load KPI, chart, bảng, filter, search, export Excel

**Verification:**
- [ ] `preview_start` + test tay ĐỦ 6 tab: đổi filter ngày, tìm kiếm, mở modal export, xuất thử 1 bảng
- [ ] `read_console_messages` không có lỗi JS mới xuất hiện
- [ ] `npm test` — chạy `server/test/frontend/*.test.js` (các test này có thể mô phỏng DOM/script, kiểm tra không vỡ)

**Dependencies:** Task 3

**Files likely touched:**
- `server/public/index.html`
- `server/public/js/dashboard.js` (mới)

**Estimated scope:** L (2 files, khối lượng lớn ~4000 dòng, rủi ro cao — cân nhắc chia nhỏ hơn nếu khi bắt tay vào thấy quá phức tạp)

---

## Checkpoint: Phase 2 (sau Task 3-4)
- [ ] Đủ 6 tab + modal export hoạt động y hệt trước
- [ ] `index.html` chỉ còn markup + `<link>`/`<script src>`, không còn CSS/JS lớn inline
- [ ] Review với người dùng trước khi sang Task 5 — **xác nhận Open Question về chia nhỏ dashboard.js trước khi làm tiếp**

---

## Task 5: Thêm class trạng thái dữ liệu dùng chung

**Description:** Hiện có 4 kiểu "trạng thái dữ liệu" rời rạc không thống nhất: loading per-table (`<td>Đang tải...</td>` viết cứng 14 chỗ), loading toàn màn hình (`.loading-veil`), empty/loading/error dùng chung 1 element đổi `textContent` (`#cpEmptyState`), lỗi rời rạc mỗi nơi 1 kiểu. Thêm class chuẩn hóa.

**Acceptance criteria:**
- [ ] Thêm `.state-skeleton` (shimmer/placeholder, tôn trọng `prefers-reduced-motion`), `.state-empty`, `.state-error` (có chỗ cho nút "Thử lại"), `.state-stale` (badge nhỏ báo dữ liệu cache cũ) vào `shared.css`
- [ ] Thêm helper JS nhỏ (vd `setTableState(tbodyEl, state, opts)`) trong `server/public/js/dashboard.js` hoặc file dùng chung mới, để gọi thống nhất thay vì set `textContent`/`innerHTML` tay
- [ ] Chưa cần áp dụng vào toàn bộ trang ở task này — chỉ tạo component, verify bằng 1 ví dụ demo/1 bảng mẫu

**Verification:**
- [ ] Test tay: gọi helper với 4 trạng thái (skeleton/empty/error/stale) trên 1 bảng mẫu, quan sát hiển thị đúng, đúng theme dark/light
- [ ] Test `prefers-reduced-motion: reduce` (dùng `resize_window` với `colorScheme`/emulate nếu công cụ hỗ trợ, hoặc DevTools) — skeleton không animate khi bật

**Dependencies:** Task 3, 4

**Files likely touched:**
- `server/public/shared/shared.css`
- `server/public/js/dashboard.js`

**Estimated scope:** M (2 files, component mới)

---

## Task 6: Áp dụng trạng thái chuẩn vào các bảng/khu vực hiện có

**Description:** Thay 14 chỗ `<td>Đang tải...</td>` viết cứng + các pattern lỗi rời rạc (`errorBox.textContent`, `setSearchStatus`, `innerHTML` tay) bằng helper từ Task 5.

**Acceptance criteria:**
- [ ] Toàn bộ 14 chỗ loading cứng (dòng liệt kê trong khảo sát: 3604,3685,3728,3824,3863,3896,3948,4133,4164,4202,4278,4328,4404,4548) dùng `.state-skeleton` qua helper
- [ ] `#cpEmptyState` và các error box (`errorBox`, `setSearchStatus`) dùng `.state-empty`/`.state-error` thay vì đổi `textContent` tay
- [ ] Hành vi hiển thị (khi nào show loading/empty/error) KHÔNG đổi — chỉ đổi CÁCH hiển thị

**Verification:**
- [ ] Test tay từng bảng: trạng thái ban đầu, lúc đang tải, khi rỗng, khi lỗi (giả lập bằng cách chặn network tạm hoặc query sai)
- [ ] `npm test` — `server/test/frontend/*.test.js` pass

**Dependencies:** Task 5

**Files likely touched:**
- `server/public/index.html`, `server/public/js/dashboard.js`

**Estimated scope:** L (nhiều điểm áp dụng, rủi ro trung bình — có thể chia nhỏ hơn theo tab nếu cần)

---

## Task 7: Sticky header đồng bộ cho bảng nghiệp vụ chính

**Description:** Sticky thead hiện chỉ có ở 3 nơi lẻ tẻ (`.search-results-table`, `.scroll-list` — có 2 định nghĩa trùng lặp dark/light, `.debt-table-wrap`); 21 bảng còn lại (Hàng hóa/Hóa đơn/Khách hàng/Nhà cung cấp...) không sticky.

**Acceptance criteria:**
- [ ] Rule chung `thead th` (hiện dòng ~2479-2489) có `position: sticky; top: 0; z-index: ...` áp dụng mặc định cho mọi bảng trong khu vực nội dung cuộn
- [ ] Dọn 2 định nghĩa trùng lặp dark/light của `.scroll-list thead th`
- [ ] Bảng nào cố tình KHÔNG cần sticky (nếu có) có class opt-out riêng
- [ ] Cuộn bảng dài (Hàng hóa/Hóa đơn) header luôn hiển thị, không đè lên nội dung khác (kiểm tra z-index với sidebar/modal)

**Verification:**
- [ ] Test tay: cuộn từng bảng lớn, xác nhận header dính đúng, không đè/không bị đè
- [ ] Screenshot trước/sau khi cuộn

**Dependencies:** Task 3

**Files likely touched:**
- `server/public/shared/shared.css` hoặc `server/public/css/dashboard.css`

**Estimated scope:** S (1 file, thay đổi CSS tập trung)

---

## Task 8: Column visibility toggle

**Description:** Thêm khả năng ẩn/hiện cột cho bảng — làm mẫu 1-2 bảng lớn nhất trước (Hàng hóa, Hóa đơn), chưa áp dụng cho cả 21 bảng.

**Acceptance criteria:**
- [ ] Component dropdown/menu chọn cột hiển thị, lưu lựa chọn vào `localStorage` (per-bảng, per-viewer — không phải state chia sẻ)
- [ ] Áp dụng cho bảng Hàng hóa và Hóa đơn trước
- [ ] Cột bị ẩn không render trong DOM (hoặc `display:none`) — không ảnh hưởng tính toán JS khác

**Verification:**
- [ ] Test tay: ẩn/hiện vài cột, reload trang, xác nhận lựa chọn được nhớ
- [ ] Xuất Excel vẫn xuất ĐỦ cột (không bị ảnh hưởng bởi ẩn cột trên UI — xác nhận rõ 2 việc tách biệt)

**Dependencies:** Task 7

**Files likely touched:**
- `server/public/js/dashboard.js`, `server/public/css/dashboard.css`

**Estimated scope:** M (2 file, component mới + áp dụng 2 bảng)

---

## Task 9: Density mode (compact/comfortable)

**Description:** Thêm chế độ đổi mật độ dòng bảng (compact/comfortable), áp dụng toàn cục (không phải per-bảng như Task 8).

**Acceptance criteria:**
- [ ] Toggle density (nút hoặc setting) đổi padding/line-height của `<td>/<th>` qua class trên `<body>` hoặc container cha
- [ ] Lưu lựa chọn vào `localStorage`, áp dụng lại khi mở trang mới
- [ ] Không vỡ bố cục sticky header (Task 7) khi đổi density

**Verification:**
- [ ] Test tay: đổi density, xác nhận bảng co giãn đúng, sticky header vẫn đúng vị trí
- [ ] Screenshot 2 chế độ

**Dependencies:** Task 7

**Files likely touched:**
- `server/public/js/dashboard.js`, `server/public/css/dashboard.css`

**Estimated scope:** S (2 file, thay đổi tập trung)

---

## Task 10: Mobile card view cho bảng chính

**Description:** Dưới 1 breakpoint (đề xuất theo `@media (max-width:760px)` đã dùng sẵn cho các khu vực khác), chuyển bảng chính sang dạng card xếp dọc thay vì bảng cuộn ngang.

**Acceptance criteria:**
- [ ] Xác nhận với người dùng phạm vi: bảng nào cần card view (xem Open Question trong `plan.md`) trước khi code
- [ ] CSS-only hoặc minimal-JS: mỗi `<tr>` render thành 1 "card" với label field ở dạng `data-label` (kỹ thuật CSS thuần phổ biến, không cần đổi cấu trúc bảng nếu dùng `::before{content:attr(data-label)}`)
- [ ] Không phá layout desktop (chỉ áp dụng dưới breakpoint mobile)

**Verification:**
- [ ] `resize_window` preset `mobile` + screenshot từng bảng đã áp dụng
- [ ] Test tay trên preset mobile: đọc được đủ thông tin, không tràn ngang

**Dependencies:** Task 7 (độc lập với Task 8/9)

**Files likely touched:**
- `server/public/index.html` (thêm `data-label` nếu cần), `server/public/css/dashboard.css`

**Estimated scope:** M (cần xác nhận phạm vi trước — có thể L nếu áp dụng nhiều bảng)

---

## Checkpoint: Phase 3-4 (sau Task 5-10)
- [ ] Bảng chính có sticky header, đổi được density, xem tốt trên mobile
- [ ] `resize_window` mobile preset kiểm tra không tràn ngang
- [ ] Review với người dùng trước khi sang Task 11

---

## Task 11: Container Queries cho KPI grid

**Description:** `.kpi-grid`/`.kpi-card` hiện responsive theo viewport (`@media max-width:1180px/760px`) bằng `grid-column: span N` cứng — đổi sang `@container` để co giãn theo container cha (hữu ích khi sidebar mở rộng/thu gọn làm đổi bề rộng khả dụng mà viewport không đổi).

**Acceptance criteria:**
- [ ] Container cha của `.kpi-grid` có `container-type: inline-size`
- [ ] `@media (max-width:1180px)`/`@media (max-width:760px)` áp dụng riêng cho `.kpi-card` chuyển thành `@container (max-width: ...)`
- [ ] Giữ nguyên breakpoint mobile toàn trang (`@media max-width:760px` cấp trang) — không đổi
- [ ] KPI card co giãn đúng khi sidebar toggle (nếu có tính năng thu gọn sidebar) mà không cần đổi kích thước cửa sổ trình duyệt

**Verification:**
- [ ] Test tay: thu gọn/mở rộng sidebar (nếu có), quan sát KPI grid tự đổi layout mà không cần resize cửa sổ
- [ ] `resize_window` các preset, xác nhận không vỡ layout so với trước

**Dependencies:** Task 3

**Files likely touched:**
- `server/public/css/dashboard.css`

**Estimated scope:** S (1 file)

---

## Task 12: Container Queries cho chart-box/filterbar-row

**Description:** Tương tự Task 11, cho `.chart-box` (chiều cao cố định theo class biến thể) và `.filterbar-row` (dùng CSS Grid + subgrid, đổi flex-column ở mobile).

**Acceptance criteria:**
- [ ] `.chart-box` container có `container-type: inline-size`, điều chỉnh chiều cao/layout theo `@container` thay vì cố định tuyệt đối khi phù hợp
- [ ] `.filterbar-row` chuyển `@media (max-width:760px)` riêng phần layout nội bộ sang `@container`
- [ ] Chart.js không vỡ (kiểm tra riêng vì chart cần logic resize JS đi kèm CSS — xác nhận `Chart.resize()` vẫn được gọi đúng lúc nếu container đổi kích thước)

**Verification:**
- [ ] Test tay: thu gọn/mở rộng sidebar, quan sát chart tự resize đúng tỉ lệ, không vỡ
- [ ] Screenshot trước/sau ở vài kích thước container

**Dependencies:** Task 3

**Files likely touched:**
- `server/public/css/dashboard.css`, `server/public/js/dashboard.js` (nếu cần gọi lại `Chart.resize()`)

**Estimated scope:** S-M (2 file, cần cẩn thận với Chart.js)

---

## Task 13: View Transitions khi đổi tab

**Description:** `switchView()` hiện toggle `display:none ↔ block` + `@keyframes fadein`. Bọc bằng `document.startViewTransition()` (progressive enhancement) để chuyển tab mượt hơn, đồng thời dọn rule `prefers-reduced-motion` trùng lặp (2 bản khác giá trị: `shared.css` `0.001ms` vs `index.html` `.01ms`).

**Acceptance criteria:**
- [ ] `switchView()` dùng `document.startViewTransition(() => { ...code cũ... })` khi `document.startViewTransition` tồn tại, fallback y hệt code cũ khi không hỗ trợ
- [ ] Xóa rule reduced-motion trùng ở `index.html:2955-2965`, chỉ giữ 1 bản ở `shared.css` (đồng bộ giá trị, ví dụ thống nhất `0.001ms`)
- [ ] View Transition tự tắt khi `prefers-reduced-motion: reduce` (CSS `::view-transition-*` cần rule tôn trọng reduced-motion tương ứng)
- [ ] Không đổi hành vi khi trình duyệt không hỗ trợ View Transitions API (Firefox tại thời điểm viết plan)

**Verification:**
- [ ] Test tay trên Chrome (có hỗ trợ) và xác nhận fallback trên trình duyệt không hỗ trợ vẫn hoạt động bình thường
- [ ] Test `prefers-reduced-motion: reduce` bật — không có transition/animation nào chạy
- [ ] `grep -n "animation-duration" server/public` chỉ còn 1 nơi định nghĩa rule toàn cục

**Dependencies:** Task 1 (dọn token trước), làm sau cùng

**Files likely touched:**
- `server/public/js/dashboard.js`, `server/public/shared/shared.css`, `server/public/index.html` (xóa rule trùng)

**Estimated scope:** S-M (3 file, thay đổi tập trung nhưng cần test kỹ reduced-motion)

---

## Checkpoint: Hoàn thành
- [ ] Toàn bộ acceptance criteria của 13 task đạt
- [ ] `npm test` pass, đặc biệt `server/test/frontend/auth-guest-ui.test.js`, `debt-management-ui.test.js`, `table-search-ui.test.js`
- [ ] Review cuối với người dùng, so sánh screenshot tổng thể trước/sau toàn bộ 7 điểm
