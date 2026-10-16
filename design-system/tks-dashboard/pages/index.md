# Page Design Notes — `index.html` (Dashboard Chính)

> Kế thừa toàn bộ `MASTER.md`. File này chỉ ghi các điểm **riêng của trang này** — component đặc thù,
> token cục bộ, và các sai lệch cần lưu ý khi sửa file. Audit gần nhất: 2026-09-15.
> **Cập nhật 2026-10-12:** Hộp xem chi tiết (Chi tiết giao dịch, Báo cáo hàng hóa theo khách, Báo cáo
> kinh doanh) chuyển sang chuẩn `.dp-*` (`detail-panel.css`). Tất cả bảng dữ liệu trong hộp đặt
> `data-table-controls="off"`. **Cập nhật 2026-10-14:** Tab Công nợ có bảng thưởng/phạt sale đầy đủ
> (điểm, hạng, quỹ thưởng). **Cập nhật 2026-10-15:** Cột Sale/Team thu gọn (`data-table-fit="off"`);
> chỉ tính khách/mã hàng đang hoạt động ở tất cả tab; Công nợ lọc `isActive` từ `customers.raw`.

## Vai trò trang
Dashboard vận hành thời gian thực chính — KPI tổng quan, tìm kiếm tồn kho/đơn hàng, biểu đồ xu hướng,
bảng chi tiết drill-down, xuất báo cáo. Bao gồm 7 tab báo cáo: Tổng quan, Hàng hóa, Công nợ, Kinh doanh, Marketing, v.v.

## Component đặc thù của trang (đã chuẩn hoá vào MASTER §5)
- Nav group / accordion sidebar (`.nav-group-toggle`, `.nav-group-chevron`, `.nav-group-list`).
- Thanh filter dùng CSS `subgrid` (`.filterbar`) — xem MASTER §5.14.
- Dashboard search với mode toggle + gợi ý (`.dashboard-search`, `.suggestions`, `.suggestion-item`).
- Hệ lưới 12 cột `.grid`/`.col-*` — **dùng làm chuẩn chung cho mọi trang mới** (MASTER §5.14).
- KPI card chuẩn (`.kpi-grid`, `.kpi-card` + `.accent-*`) — đây là bản tham chiếu chính thức của "KPI Card" trong MASTER §5.2, ưu tiên hơn các bản sao ở trang khác (`.kpi-stat`, `.end-day-stat`).
- Modal xuất báo cáo (`.export-modal-*`) — component chọn cột export, giữ nguyên phần chọn field, nhưng **phải sửa `.export-modal-backdrop`** theo MASTER §5.7/§12.1 (đang có `backdrop-filter` + nền hardcode không đổi theo Light Mode).
- Toast nội bộ `.tks-toast-*` — hợp nhất dần về chuẩn `.toast-*` ở MASTER §5.8.
- Row reveal khi mở rộng chi tiết (`.debt-detail-row`, keyframe fade+slide nhẹ) và row flash khi cập nhật real-time (`rowPulseHighlight`, MASTER §5.16).
- Sortable table header (`.sort-button`, `[aria-sort]`) — MASTER §5.13.
- **Hộp xem chi tiết dùng chung (`detail-panel.css`, `.dp-*`):** Hộp Chi tiết giao dịch (`#docModalBackdrop`), Báo cáo hàng hóa theo khách, Báo cáo kinh doanh (Sale/Khách/Mã hàng) áp dụng chuẩn `.dp-*` với dải chỉ số tổng quan ở đầu hộp (`.dp-stats`), 1 khung cuộn mượt mà, tiêu đề dính và bảng con tắt nút Cột hiển thị (`data-table-controls="off"`).

## Tab Công nợ — Bảng thưởng/phạt sale (`#debt-reward`)
Áp dụng từ 2026-10-14 (Migration `0051`, `0052`):
- **Điểm:** số hóa đơn Hoàn thành + doanh số sau trừ trả hàng trong tháng của từng khách (cơ sở + mã).
- **Điều kiện xếp hạng:** ≥ 30 điểm; xếp hạng chung HN + SG theo phạt gốc/điểm tăng dần rồi điểm giảm dần; đồng hạng kiểu 1–2–2–4.
- **Phân phối thưởng:** Top 1–20 miễn phạt; Top 10 nhận quỹ `max(80% phạt phải nộp, 3 triệu)` — 50% theo trọng số hạng, 50% theo tỷ trọng điểm. Đồng hạng gộp trọng số.
- **API:** `GET /api/debt-management/penalty-board?month=YYYY-MM` (mặc định tháng chu kỳ đang mở); lọc cơ sở sau khi tính hạng/quỹ toàn công ty.
- **Chốt bất biến:** `debt_reward_months` sau bản chốt 15:00 đầu tháng mới.
- **Thưởng tạm tính:** Hiển thị mỗi ngày với nhãn "Thưởng tạm tính" (chưa chốt); chỉ chốt/lưu thưởng chính thức một lần khi kết thúc tháng. Cutoff: 15:00 VN — reset chu kỳ; mỗi chu kỳ lưu đúng 1 lần.
- **Cùng khách 2 cơ sở:** Lấy mức phạt cao nhất ở 1 cơ sở (bằng nhau → Hà Nội); không cộng dồn 2 cơ sở.
- **Hiển thị:** Đơn vị đồng (làm tròn số nguyên), tooltip giữ phép chia gốc, API/thứ hạng không làm tròn.

## Quy tắc "chỉ tính khách/mã hàng đang hoạt động" (từ 2026-10-15)
- **Khách:** `isActive=false` → loại khỏi tổng khách (Tổng quan), xếp hạng doanh thu, gợi ý tìm, báo cáo hàng hóa/kinh doanh, công nợ.
- **Mã hàng:** `is_active IS NOT FALSE` tại ít nhất 1 cơ sở HN/SG → lọc báo cáo hàng hóa; mã ngừng cả 2 cơ sở bị loại; mã đang kinh doanh hết tồn/chưa bán vẫn giữ.
- Doanh thu công ty theo ngày giữ nguyên (không lọc khách).
- Kết quả thưởng/phạt tháng đã chốt giữ nguyên (không áp lại lọc).

## Báo cáo Marketing (`#marketing`)
- Bốn phần đánh số dùng KPI `.kpi-card`, lưới 12 cột, panel và Chart.js của trang báo cáo.
- Bộ lọc độc lập, bảng tra cứu 100 dòng/trang, cột ẩn/hiện và dòng có focus để mở chi tiết.
- Hộp chi tiết dùng native `dialog`, token nền/viền/bo góc của trang và focus trả về dòng nguồn; không xếp nhiều hộp.
- CSS riêng `marketing-report.css` dùng token sáng/tối hiện có. Màn hình nhỏ xếp panel một cột, KPI một/hai cột và bảng cuộn trong khung.
- **Nguồn dữ liệu:** `MARKETING_REPORT_SOURCE` — `sheets` (mặc định) hoặc `postgres` (sau khi xác minh Pancake). Quyền `reports.marketing.edit` chỉ Quản lý.

## Token cục bộ cần lưu ý (KHÔNG lặp lại ở trang mới)
- Trang tự định nghĩa thang bo góc số (`--radius-2/4/5/6/7/8/9/10/12/14`) song song với thang ngữ nghĩa của MASTER §4.4, và `--radius-pill` ở đây là `999px` (lệch với `9999px` chuẩn). Khi thêm component mới vào trang này, **ưu tiên tên ngữ nghĩa** (`--radius-lg` thay vì `--radius-12`) để không mở rộng thêm sự lệch pha.
- Đã có sẵn token kênh RGB dùng tốt: `--shadow-rgb`, `--overlay-rgb`, `--primary-rgb-d/l`, `--glow-green-rgb`, `--glow-red-rgb` — nhân rộng mẫu này sang `shared.css` (MASTER §4.4b) thay vì định nghĩa lại ở từng trang.

## Cột Sale/Team (từ 2026-10-14)
- Bảng Doanh số theo sale: cột Sale = 125 px, Team = 133 px.
- Bảng Doanh số theo khách: cột Sale = 117 px.
- Cả hai bảng dùng `data-table-fit="off"` để tránh tự giãn cột khi tải dữ liệu; vẫn hỗ trợ kéo chỉnh thủ công.

## Nợ thiết kế riêng của trang (xem MASTER §12 để biết đầy đủ)
1. `.export-modal-backdrop{ backdrop-filter: blur(3px); background: rgba(5,10,18,.68); }` — vi phạm §7.1 + không đổi theo Light Mode. Sửa theo mẫu `.modal-overlay` ở §5.7.
2. Amber "cũ" `rgba(240,166,58,…)` ở `.suggestion-source`, `.search-result-source`, `.pill.warn` — lệch với `--amber` hiện hành, nên đổi về token.
3. `.pill.ok`/`.pill.bad` dùng rgba rời không truy được về `--green`/`--red`.
4. Chữ trên nền đặc hardcode `#1B1206` (×3) và `#07150d` (×1) — chuẩn hoá thành `--amber-contrast-text`/`--green-contrast-text` (§4.4c).
5. `.end-day-stat` dùng `--radius-9` trong khi `.kpi-card` (cùng vai trò) dùng `--radius-12` — nên hợp nhất về cùng bán kính khi có dịp sửa khu vực này.
6. `.tks-profile-*` bị khai báo lại trong trang dù đã có ở `shared.css` — 2 nguồn cho 1 component.
7. `.chart-box` dùng 7 chiều cao lẻ khác nhau — khi thêm chart mới, dùng 1 trong 4 mức chuẩn ở MASTER §5.15 thay vì thêm số mới.
