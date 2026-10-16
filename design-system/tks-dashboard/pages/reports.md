# Page Design Notes — `/reports/` (Trang Báo Cáo Tổng Hợp)

> Kế thừa toàn bộ `MASTER.md`. Trang không có file HTML riêng — các tab báo cáo nằm trong `index.html`
> tại anchor `#marketing`, `#debt`, `#business`, v.v. File này ghi nhận các quy ước giao diện đặc thù
> cho khu vực báo cáo để dễ tra cứu khi phát triển tab mới.

## Cấu trúc tab báo cáo (trong `index.html`)

| Hash / Anchor | Tên tab | Tình trạng |
|---|---|---|
| `#overview` | Tổng quan | Hoàn thành |
| `#inventory` | Hàng hóa | Hoàn thành |
| `#debt` | Công nợ | Hoàn thành (bảng thưởng/phạt sale từ 14/10) |
| `#business` | Kinh doanh | Hoàn thành (Migration `0036`, `0037`) |
| `#marketing` | Marketing | Hoàn thành — nguồn Sheets; Pancake PostgreSQL chưa kích hoạt chính thức |

## Tab Công nợ (`#debt`)

### Cấu trúc bảng
- Cột đầu: **Cơ sở** (HN/SG).
- Cột ẩn mặc định: Cảnh báo.
- Xóa: Nợ đầu kỳ.
- Bổ sung: "Doanh số trong kỳ" (`inScheduleDebt`) — giữa Nợ hiện tại và Nợ quá hạn.
- Mặc định hàng chờ: "Còn nợ" (không còn "Cần xử lý").

### Lịch thanh toán (Migration `0047`)
- Lưu `debt_payment_schedules` (1–90 ngày, mặc định 1 ngày); Quản lý sửa trực tiếp trên web (`reports.debt.schedule`).
- Nợ quá hạn = Nợ hiện tại − (hóa đơn − trả hàng trong N ngày); tính lại khi đọc → đổi lịch TT hiệu lực ngay.
- Chốt 15:00 VN mỗi ngày (`debtCycleSnapshot.js`); reset cột Sale phản hồi / QL phản hồi / Trạng thái theo bản chốt 15:00 hôm sau.
- Lịch sử chỉnh sửa bất biến (ghi mọi thay đổi trên giao diện).

### Phân quyền Công nợ
| Quyền | Vai trò | Ghi chú |
|---|---|---|
| `reports.debt.saleFeedback` | Sale, Trợ lý | `isEscalationExempt` = true |
| `reports.debt.managerFeedback` | Quản lý | |
| `reports.debt.edit` | Quản lý | |
| `reports.debt.schedule` | Quản lý | Sửa lịch TT |
| `reports.debt.penalty` | Quản lý | Xem/xuất tiền phạt |
| `reports.debt.refresh` | Quản lý | Nút "Tính lại công nợ" (Migration `0050`) |

### Bảng thưởng/phạt sale (xem `pages/index.md` — Tab Công nợ)
- API: `GET /api/debt-management/penalty-board?month=YYYY-MM`
- Giao diện, hộp chi tiết và xuất Excel/HTML dùng cùng kết quả backend.

## Tab Kinh doanh (`#business`, Migration `0036`, `0037`)

- **Chốt cứng doanh số tháng** vào `business_monthly_*` (job `businessMonthlyRefresh.js`, thứ Tư 1:00 VN và đầu tháng mới).
- Cột **Team** của sale và bộ lọc Team (`sale_teams` nạp từ `chia team.xlsx`).
- Gộp khách hàng theo tên chuẩn hóa; modal chọn trường khi xuất file.
- Hộp chi tiết (Sale / Khách / Mã hàng) áp dụng chuẩn `.dp-*` với dải chỉ số `.dp-stats`.

## Tab Marketing (`#marketing`)
*(Chi tiết xem `pages/index.md` — Báo cáo Marketing)*

- 3 workbook Google Sheets nguồn (Trực page, SĐT, Ads) + đối chiếu doanh số KiotViet.
- Hỗ trợ sửa trực tiếp ô Khách mới / Ghi chú → đồng bộ ngược Sheets (`PUT /api/marketing-report/monthly/row`).
- CSS riêng `marketing-report.css`; hộp chi tiết dùng native `<dialog>`.
- **Pancake PostgreSQL:** `PANCAKE_MARKETING_SYNC_ENABLED` và `MARKETING_REPORT_SOURCE` — giữ `sheets` cho đến khi hoàn tất đối soát 3 đêm và Quản lý xác nhận nghiệp vụ "chào lại".

## Quy ước giao diện chung cho trang báo cáo

### Thanh lọc (`.panel.cb-filters` / `.filterbar`)
- **Hàng 1:** `.period-toggle` (label bọc radio ẩn, nền amber khi active) + cụm Từ–Đến (`shared/dateInput.js`).
- **Hàng 2:** Các dropdown `.dd` (radio/checkbox thật bên trong, tên kết hợp `data-dd-id` unique).
- **Dropdown đa chọn:** `.dd-tools` dính đầu danh sách (ô tìm từ ≥ 7 mục, đếm "x/y đã chọn" số amber, 2 nút viên thuốc Chọn tất cả/Bỏ chọn).
- **Trên điện thoại (≤ 760px):** Thanh lọc thành ngăn kéo từ bên phải, chừa 64px cho nút menu sidebar.

### Bảng dữ liệu báo cáo
- Dùng `fixed-table` (độ rộng cột khai báo trong `WIDTHS` JS).
- Tiền: canh phải `--font-data`; số âm dùng `var(--red)`.
- Phân trang `.pagination-controls` `«` `<` `>` `»`.
- Nút **Xuất file** → hộp `<dialog class="cb-modal">` (khuôn `export-modal`): tìm trường, Chọn tất cả/Bỏ chọn, Hủy · Xuất HTML · Xuất Excel.

### Bộ lọc active marker
- Dropdown đang lọc: viền amber (`border-color: var(--amber)`).
- Thẻ KPI đang lọc nhanh: `border-color: var(--primary); background: rgba(59,130,246,.1)` (xem `.lc-kpi-card.is-active`, MASTER §5.19).

### Nút "Bỏ sắp xếp"
- Hiện khi cột đang được sắp xếp; bấm → về thứ tự mặc định.
- Lần bấm thứ ba vào tiêu đề cột (tăng → giảm → mặc định) cũng reset về mặc định.
