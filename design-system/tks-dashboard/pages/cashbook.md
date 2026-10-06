# Page Design Notes — `cashbook/index.html` (Sổ Quỹ)

> Kế thừa toàn bộ `MASTER.md`. Trang mới từ 2026-10-06; dựng lại giao diện cùng ngày để khớp tab Báo cáo tổng hợp (`index.html`).

## Vai trò trang
Số dư từng quỹ (ngân hàng + Tiền mặt), sổ chi tiết phiếu thu chi, chốt số dư và lịch sử chốt. Đường dẫn `/cashbook/`; quyền `cashbook.view` (xem/xuất) và `cashbook.manage` (chốt), mặc định chỉ Quản lý. Không tách cơ sở: luôn gộp HN + SG, bỏ qua cookie `tks_branch`. Spec: [docs/superpowers/specs/2026-10-06-so-quy-design.md](../../../docs/superpowers/specs/2026-10-06-so-quy-design.md).

## Cấu trúc (từ trên xuống)
1. `.view-title` "Sổ quỹ" + `.view-sub` (phạm vi + mốc đồng bộ KiotViet `#syncedAt`).
2. **Thanh lọc ngang** `.panel.cb-filters`: hàng 1 `.period-toggle` (label bọc radio ẩn, mục chọn nền amber như tab Báo cáo) + cụm Từ–Đến (`shared/dateInput.js`, dd/mm/yyyy); hàng 2 các dropdown `.dd` (Quỹ, Loại chứng từ, Loại thu chi, Trạng thái, Hạch toán KQKD, Người tạo, Nhân viên) + "Đặt lại bộ lọc". Nút dropdown cùng khuôn `.dd-button` của Vòng đời đơn hàng: nhãn nhỏ + tóm tắt ("Tất cả", "2 mục", tên mục duy nhất), viền amber khi đang lọc; bên trong là radio/checkbox thật nên logic lọc và test không phụ thuộc cách trình bày.
3. Mục `section-head` có số bước: **1 Tổng quan quỹ** (4 `kpi-card` eyebrow/value/sub: Quỹ đầu kỳ, Tổng thu `accent-green`, Tổng chi `accent-red`, Tồn quỹ; "Chưa chốt" màu muted) + bảng Số dư tài khoản; **2 Sổ chi tiết**; **3 Lịch sử chốt số dư**.
4. Mỗi bảng: `.panel-head` = tiêu đề + `.export-button` "Xuất file" → hàng `.table-search-tools` chiếm trọn chiều ngang. Số dư & Lịch sử chốt tìm tại máy khách (không dấu); Sổ chi tiết tìm ở máy chủ với `.table-search-modes` Mã phiếu / Người nộp/nhận / SĐT / Ghi chú (tham số `code`, `partnerQ`, `partnerPhone`, `note`; áp cả cho KPI). Bảng `fixed-table` (độ rộng cột khai báo trong `WIDTHS`), tiền canh phải `--font-data`, số âm và chênh lệch ≠ 0 dùng `var(--red)`. Phân trang `.pagination-controls` `<<` `<` `>` `>>`.
5. Hộp thoại là `<dialog class="cb-modal">` theo khuôn `export-modal`: Xuất file (tìm trường, Chọn tất cả / Bỏ chọn, Hủy · Xuất HTML · Xuất Excel) và Chốt số dư (hiện "Hệ thống đang tính / chênh lệch" trước khi lưu).

## Lưu ý thiết kế
- Các lớp `.section-head`, `.kpi-card .eyebrow…`, `.period-toggle`, `.table-search-*`, `.export-modal-*` chỉ có trong `index.html` nên được chép tối thiểu vào `<style>` của trang, dùng thang bo góc ngữ nghĩa (`--radius-xs/sm/md/lg/xl`). Nếu sau này đưa các lớp này vào `shared.css` thì xóa bản chép ở đây.
- Điện thoại (≤ 760px): thanh lọc thành ngăn kéo mở từ **bên phải**, chừa 64px vì nút menu nổi của sidebar (z-index 40) nằm ngoài stacking context của `.content`; dropdown xếp mỗi cái 1 hàng, danh sách mở tĩnh bên dưới.

Bảng Số dư tài khoản: tiêu đề cột sắp xếp được (nút `.cb-sort`, mũi tên ↕/▼/▲, `aria-sort`, active màu amber như tab Báo cáo); dòng ghi chú `.cb-fund-bank` dưới tên tài khoản ("Ngân hàng: …" + nút Sửa cho Quản lý) nằm trên mô tả KiotViet.
