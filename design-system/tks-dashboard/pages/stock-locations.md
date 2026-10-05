# Page Design Notes — `stock-locations/index.html` (Vị Trí Hàng)

> Kế thừa toàn bộ `MASTER.md`. Trang mới từ 2026-10-03; chưa nằm trong audit 2026-09-15. Cập nhật 2026-10-05.

## Vai trò trang
Tra cứu vị trí hàng Hà Nội / Sài Gòn từ Google Sheets (chỉ đọc). Đường dẫn `/stock-locations/#hn` hoặc `#sg`; quyền `stockLocations.view` (Khách bị chặn). Tài liệu nguồn và nghiệm thu: [docs/stock-locations-setup.md](../../../docs/stock-locations-setup.md).

## Cấu trúc & component
- Hai tab theo cơ sở (chọn Hà Nội/Sài Gòn chỉ hiện tab tương ứng; "Cả hai" hiện cả hai, mặc định HN). Tab con cũng xuất hiện trên sidebar các trang khác (nhóm "Vị trí hàng" trong `shared-nav.js`).
- Bảng 6 cột: Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí. Sắp xếp ba trạng thái trên mọi cột (Tổng SL theo số, cột chữ theo thứ tự tự nhiên), tìm mã/tên/vị trí không dấu, phân trang 100 dòng với nút `<<`, `<`, `>`, `>>` ở giữa cuối bảng.
- Nút **Cột hiển thị** (hiện tất cả / về mặc định): lựa chọn nhớ riêng điện thoại (≤ 600px; mặc định Tên hàng, Tổng SL, Vị trí) và máy tính (mặc định đủ sáu cột); Tên hàng luôn hiện và cố định khi cuộn ngang trên điện thoại. Ô tìm kiếm kéo dài cạnh tiêu đề bảng.
- Tệp riêng của trang: `stock-locations.css`, `stock-locations.js`; còn lại dùng token và component chung của `shared.css`.

## Lưu ý thiết kế
- Mỗi tab giữ từ khóa, thứ tự và trang riêng; đổi từ khóa/thứ tự về trang 1.
- Lỗi nguồn (503) hiện thông báo rõ theo mã `STOCK_LOCATIONS_*`, không lộ lỗi Google thô.
