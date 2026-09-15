# Page Design Notes — `index.html` (Dashboard Chính)

> Kế thừa toàn bộ `MASTER.md`. File này chỉ ghi các điểm **riêng của trang này** — component đặc thù,
> token cục bộ, và các sai lệch cần lưu ý khi sửa file. Audit gần nhất: 2026-09-15.

## Vai trò trang
Dashboard vận hành thời gian thực chính — KPI tổng quan, tìm kiếm tồn kho/đơn hàng, biểu đồ xu hướng,
bảng chi tiết drill-down, xuất báo cáo.

## Component đặc thù của trang (đã chuẩn hoá vào MASTER §5)
- Nav group / accordion sidebar (`.nav-group-toggle`, `.nav-group-chevron`, `.nav-group-list`).
- Thanh filter dùng CSS `subgrid` (`.filterbar`) — xem MASTER §5.14.
- Dashboard search với mode toggle + gợi ý (`.dashboard-search`, `.suggestions`, `.suggestion-item`).
- Hệ lưới 12 cột `.grid`/`.col-*` — **dùng làm chuẩn chung cho mọi trang mới** (MASTER §5.14).
- KPI card chuẩn (`.kpi-grid`, `.kpi-card` + `.accent-*`) — đây là bản tham chiếu chính thức của
  "KPI Card" trong MASTER §5.2, ưu tiên hơn các bản sao ở trang khác (`.kpi-stat`, `.end-day-stat`).
- Modal xuất báo cáo (`.export-modal-*`) — component chọn cột export, giữ nguyên phần chọn field,
  nhưng **phải sửa `.export-modal-backdrop`** theo MASTER §5.7/§12.1 (đang có `backdrop-filter` +
  nền hardcode không đổi theo Light Mode).
- Toast nội bộ `.tks-toast-*` — hợp nhất dần về chuẩn `.toast-*` ở MASTER §5.8.
- Row reveal khi mở rộng chi tiết (`.debt-detail-row`, keyframe fade+slide nhẹ) và row flash khi cập
  nhật real-time (`rowPulseHighlight`, MASTER §5.16).
- Sortable table header (`.sort-button`, `[aria-sort]`) — MASTER §5.13.

## Token cục bộ cần lưu ý (KHÔNG lặp lại ở trang mới)
- Trang tự định nghĩa thang bo góc số (`--radius-2/4/5/6/7/8/9/10/12/14`) song song với thang ngữ
  nghĩa của MASTER §4.4, và `--radius-pill` ở đây là `999px` (lệch với `9999px` chuẩn). Khi thêm
  component mới vào trang này, **ưu tiên tên ngữ nghĩa** (`--radius-lg` thay vì `--radius-12`) để
  không mở rộng thêm sự lệch pha.
- Đã có sẵn token kênh RGB dùng tốt: `--shadow-rgb`, `--overlay-rgb`, `--primary-rgb-d/l`,
  `--glow-green-rgb`, `--glow-red-rgb` — nhân rộng mẫu này sang `shared.css` (MASTER §4.4b) thay vì
  định nghĩa lại ở từng trang.

## Nợ thiết kế riêng của trang (xem MASTER §12 để biết đầy đủ)
1. `.export-modal-backdrop{ backdrop-filter: blur(3px); background: rgba(5,10,18,.68); }` — vi phạm
   §7.1 + không đổi theo Light Mode. Sửa theo mẫu `.modal-overlay` ở §5.7.
2. Amber "cũ" `rgba(240,166,58,…)` ở `.suggestion-source`, `.search-result-source`, `.pill.warn` —
   lệch với `--amber` hiện hành, nên đổi về token.
3. `.pill.ok`/`.pill.bad` dùng rgba rời không truy được về `--green`/`--red`.
4. Chữ trên nền đặc hardcode `#1B1206` (×3) và `#07150d` (×1) — chuẩn hoá thành
   `--amber-contrast-text`/`--green-contrast-text` (§4.4c).
5. `.end-day-stat` dùng `--radius-9` trong khi `.kpi-card` (cùng vai trò) dùng `--radius-12` — nên
   hợp nhất về cùng bán kính khi có dịp sửa khu vực này.
6. `.tks-profile-*` bị khai báo lại trong trang dù đã có ở `shared.css` — 2 nguồn cho 1 component.
7. `.chart-box` dùng 7 chiều cao lẻ khác nhau — khi thêm chart mới, dùng 1 trong 4 mức chuẩn ở
   MASTER §5.15 thay vì thêm số mới.
