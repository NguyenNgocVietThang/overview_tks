# Báo cáo kinh doanh — lọc team, gộp khách theo tên, bố cục mới (2026-10-07)

Bổ sung cho `2026-10-07-business-report-design.md` (các quyết định cũ vẫn giữ trừ chỗ nói khác dưới đây).

## Yêu cầu của người dùng
1. Bảng "Doanh số theo sale" có cột **Team** và dropdown lọc team (team lấy từ file `chia team.xlsx`).
2. Bảng khách hàng: **bỏ cột Cơ sở và Mã KH**, gộp khách HN + SG trùng tên thành một dòng.
3. Quy hoạch lại số liệu tổng quan: mục 1 "Chỉ số tổng quát"; ba báo cáo thành mục 2, 3, 4 và không còn thẻ tổng quan ở đầu mỗi mục.
4. Mỗi bảng (mục 2, 3, 4) có hàng 3 chỉ số **Tăng trưởng, TB 4 tháng, Doanh số tháng này**, đổi theo bộ lọc đang áp.

## Dữ liệu đã kiểm chứng (2026-10-07, DB thật)
- Sau khi đồng bộ lại toàn bộ khách (đổi/xóa nhóm trên KiotViet KHÔNG đổi `modifiedDate` của khách nên đồng bộ gia tăng bỏ sót), 57 tên nhóm khớp 58 sale trong Excel. "BÍCH TRÂN" chỉ khác hoa/thường.
- Mọi hóa đơn từ 03/2026 đều có khách và khách đều có nhóm. 1.691 khách chưa có nhóm đều chưa mua gì.
- 186 tên khách có ở cả HN và SG; chỉ 1 tên có hai sale (KMN A Tư Thủ Đức: Kim Thương hoạt động, Thái Bảo chỉ mua tháng 6 nên không hoạt động).

## Quyết định
- **Team:** bảng `sale_teams(sale_name PK, team_name)` (migration 0037), nạp sẵn từ Excel (58 dòng). Cập nhật về sau: người dùng gửi file Excel mới, ta chạy lại script nạp; không có giao diện sửa. So khớp tên sale theo khóa chuẩn hóa (NFKC, bỏ khoảng trắng thừa, chữ thường). Sale không có trong bảng (kể cả "Chưa phân nhóm") thuộc team **"Chưa có team"**. Tên sale hiển thị = tên trong `sale_teams` khi khớp (gộp "BÍCH TRÂN" vào "Bích Trân"), ngược lại giữ tên nhóm.
- **Gộp khách:** khóa = tên khách chuẩn hóa (cùng cách chuẩn hóa), gộp mọi mã và cả hai cơ sở; không có tên thì "Khách lẻ". Chuỗi doanh số theo tháng = cộng các hồ sơ. Sale của dòng gộp = sale có doanh số lớn nhất trong cửa sổ 4 tháng (3 tháng trước + tháng này quy đổi); không có doanh số trong cửa sổ thì lấy sale của hồ sơ có tổng doanh số lớn nhất. Level giá lấy từ hồ sơ có tổng doanh số lớn nhất. Dòng khách mang `refs` = danh sách `{branch, code}` để truy panel chi tiết.
- **Bảng Sale** vẫn tính theo nhóm gốc của từng hồ sơ (tổng không đổi). "SL Khách" = số khách đã gộp đang hoạt động có sale đó.
- **Chỉ số tổng quát (mục 1)**, toàn công ty, không phụ thuộc bộ lọc: Tăng trưởng (Σ quy đổi 30 ngày ÷ Σ tháng trước), TB 4 tháng, Doanh số tháng này (đến dd/mm), SL sale (sale hoạt động, không tính "Chưa phân nhóm"), SL khách hoạt động (khách đã gộp), SL mã hoạt động. Doanh số tổng = tổng mọi dòng của bảng Sale.
- **Hàng 3 chỉ số mỗi bảng** tính ở trang trên đúng các dòng đang hiển thị (sau lọc team/sale/công tắc khách không hoạt động và ô tìm kiếm): Σ tháng này, Σ TB 4 tháng, Tăng trưởng = Σ quy đổi ÷ Σ tháng trước (tháng trước = 0 thì "—").
- Bỏ `kpis` cũ khỏi 3 payload; thêm `GET /api/business-report/overview`.
- **Xuất file:** bảng Sale thêm cột Team và nhận `team=`; bảng khách bỏ Mã KH / Cơ sở và bỏ tham số `branch`. Bộ lọc xuất khớp bộ lọc trên màn hình.
- **Panel chi tiết:** khách khóa theo tên chuẩn hóa; top mã hàng gộp mọi `refs`; "top khách của mã hàng" gộp theo tên, bỏ cột Cơ sở. Panel sale liệt kê khách đã gộp (bỏ cột Cơ sở).

## Xử lý lỗi
- `sale_teams` chưa migrate: bỏ qua (mọi sale "Chưa có team"), báo cáo vẫn chạy.

## Kiểm chứng
Unit test cho gộp khách, chọn sale, so khớp team, gộp hoa/thường, overview, lọc/xuất; test frontend (trích code từ HTML); đối chiếu DB thật (Σ khách gộp = Σ sale); xem trang bằng harness; `npm test`.

## Việc sau deploy
Áp migration 0037 (cùng 0036 chưa áp). Nạp lại team khi người dùng gửi Excel mới: `node scripts/importSaleTeams.js <file.xlsx>` (trong `server/`).
