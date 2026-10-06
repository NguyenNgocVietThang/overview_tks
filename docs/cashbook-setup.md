# Thiết lập Sổ quỹ

Trạng thái 06/10/2026: code và kiểm thử cục bộ hoàn tất; migration `0033` và triển khai production chưa thực hiện. Sổ quỹ dùng `cash_flows` của cả Hà Nội/Sài Gòn, danh mục `cash_book_accounts` từ KiotViet; không có số liệu nào do người dùng nhập. Bộ chọn cơ sở trên thanh điều hướng không đổi phạm vi Sổ quỹ.

## Trước khi đưa lên môi trường thật

1. Trong `server/`, chạy `npm run db:migrate` **ngoài giờ cao điểm** để áp `0033_cash_book.sql`. Migration thêm `account_id`/`status`, backfill theo lô 20.000 phiếu và tạo index; kiểm tra `schema_migrations` có `0033_cash_book.sql` trước khi chạy code mới. Không chạy backfill song song nhiều lần.
2. Triển khai code và bật `KIOTVIET_SYNC_ENABLED=true` với credentials của **cả hai** retailer. Scheduler đồng bộ `bankaccounts` khi bảng trống và mỗi ngày. Kiểm tra danh mục có dữ liệu bằng `SELECT COUNT(*) FROM cash_book_accounts;`, sau đó kiểm tra thời điểm `synced_at` và `sync_checkpoints` cho `cash_flows` ở cả hai cơ sở.
3. Nếu cần chạy danh mục lần đầu bằng tay, xem kế hoạch trước: `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts`. Khi đã chọn đúng DB và credentials mới chạy `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts --execute`. Tên CLI là **`cash_book_accounts`**, không phải `bankaccounts`; `--branch=all` lấy cả HN và SG. Backfill lưu tiến độ nên chunk đã hoàn tất sẽ được bỏ qua ở lần gọi sau; đồng bộ hằng ngày do scheduler thực hiện.
4. Đối chiếu số lượng danh mục theo từng retailer: `node kiotvietSync/reconcileCounts.js --branch=hanoi` và `node kiotvietSync/reconcileCounts.js --branch=saigon`. Lệnh này cũng đối chiếu các entity khác; xem riêng dòng `cash_book_accounts`. Một số ID lịch sử không còn ở danh mục vẫn được giữ và hiển thị dưới dạng `Tài khoản #ID`.

## Tồn quỹ (từ 06/10/2026, bỏ chốt số dư và nhập tên ngân hàng)

Tồn quỹ của một quỹ tại một thời điểm = tổng mọi phiếu thu/chi **chưa hủy** của quỹ đó tới thời điểm đó (thu dương, chi âm), giống cột Tồn quỹ của Sổ quỹ KiotViet. Không còn mốc chốt, không còn số dư ban đầu do Quản lý nhập.

HN và SG là 2 retailer nên cùng một tài khoản ngân hàng có 2 ID trong `cash_book_accounts`. Bảng *Số dư tài khoản* gộp theo **số tài khoản**: mỗi dòng có Tồn quỹ HN, Tồn quỹ SG và Tổng tồn quỹ (= HN + SG). Tiền mặt tách theo `cash_flows.branch`. Khóa quỹ (tham số `fund`) là danh sách ID của nhóm, ví dụ `1220968,1220979`. Không có dropdown Quỹ: bảng Số dư luôn liệt kê đủ quỹ (dùng ô tìm kiếm); bấm một dòng để lọc Sổ chi tiết và KPI theo tài khoản đó, bấm lại hoặc "Bỏ lọc tài khoản" để bỏ. Thẻ KPI chỉ còn Tổng thu, Tổng chi, Tồn quỹ (tổng tồn quỹ tại cuối kỳ lọc; thẻ Quỹ đầu kỳ đã bỏ); Tổng thu/Tổng chi theo bộ lọc hiển thị. Số dư lũy kế ở Sổ chi tiết luôn hiện: là tồn quỹ của các quỹ đang chọn ngay sau phiếu, tính trên toàn dòng thời gian (không bị ảnh hưởng bởi bộ lọc loại/trạng thái/tìm kiếm).

KiotViet `bankaccounts` (API công khai) chỉ có số TK, tên chủ tài khoản (`bankName`) và mô tả — không có tên ngân hàng (VPBank, OCB…) lẫn tồn quỹ như trên giao diện web KiotViet. Dashboard hiện số TK + chủ TK + mô tả. Bảng `cash_book_checkpoints` (0033) và `cash_book_account_banks` (0034) còn trong DB nhưng code không đọc nữa.

Nếu tồn quỹ lệch với KiotViet, kiểm tra phiếu thiếu `accountId`, phiếu hủy và đồng bộ `cash_flows` của cả hai cơ sở; không gộp ID `-1` vào Tiền mặt.
