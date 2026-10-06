# Thiết lập Sổ quỹ

Trạng thái 06/10/2026: code và kiểm thử cục bộ hoàn tất; migration `0033` và triển khai production chưa thực hiện. Sổ quỹ dùng `cash_flows` của cả Hà Nội/Sài Gòn, danh mục `cash_book_accounts` từ KiotViet và các mốc `cash_book_checkpoints` do Quản lý nhập. Bộ chọn cơ sở trên thanh điều hướng không đổi phạm vi Sổ quỹ.

## Trước khi đưa lên môi trường thật

1. Trong `server/`, chạy `npm run db:migrate` **ngoài giờ cao điểm** để áp `0033_cash_book.sql`. Migration thêm `account_id`/`status`, backfill theo lô 20.000 phiếu và tạo index; kiểm tra `schema_migrations` có `0033_cash_book.sql` trước khi chạy code mới. Không chạy backfill song song nhiều lần.
2. Triển khai code và bật `KIOTVIET_SYNC_ENABLED=true` với credentials của **cả hai** retailer. Scheduler đồng bộ `bankaccounts` khi bảng trống và mỗi ngày. Kiểm tra danh mục có dữ liệu bằng `SELECT COUNT(*) FROM cash_book_accounts;`, sau đó kiểm tra thời điểm `synced_at` và `sync_checkpoints` cho `cash_flows` ở cả hai cơ sở.
3. Nếu cần chạy danh mục lần đầu bằng tay, xem kế hoạch trước: `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts`. Khi đã chọn đúng DB và credentials mới chạy `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts --execute`. Tên CLI là **`cash_book_accounts`**, không phải `bankaccounts`; `--branch=all` lấy cả HN và SG. Backfill lưu tiến độ nên chunk đã hoàn tất sẽ được bỏ qua ở lần gọi sau; đồng bộ hằng ngày do scheduler thực hiện.
4. Đối chiếu số lượng danh mục theo từng retailer: `node kiotvietSync/reconcileCounts.js --branch=hanoi` và `node kiotvietSync/reconcileCounts.js --branch=saigon`. Lệnh này cũng đối chiếu các entity khác; xem riêng dòng `cash_book_accounts`. Một số ID lịch sử không còn ở danh mục vẫn được giữ và hiển thị dưới dạng `Tài khoản #ID`.

## Chốt số dư ban đầu

Quản lý mở `/cashbook/`, chọn **Chốt số dư** cho từng tài khoản ngân hàng và quỹ **Tiền mặt**. Nhập số dư thực tế từ Excel/sao kê và thời điểm sao kê tương ứng (giờ Việt Nam), xem phần tính thử rồi lưu. Lần chốt đầu tiên có `Số hệ thống`/`Chênh lệch` chưa xác định; trang hiện **Chưa chốt** cho quỹ còn thiếu mốc, không tự coi là 0. Phiếu tại đúng thời điểm chốt không cộng lại; phiếu sau mốc mới thay đổi số dư. Phiếu hủy luôn bị loại khỏi số dư.

Sau 1–2 ngày, đối chiếu từng quỹ với sao kê. Nếu lệch, kiểm tra phiếu thiếu `accountId`, phiếu hủy, thời điểm chốt và các tài khoản lịch sử; không gộp ID `-1` vào Tiền mặt. Chỉ dùng số trong file Excel như số dư đầu vào tại một thời điểm rõ ràng, không nhập số đoán. Quyền mặc định `cashbook.view`/`cashbook.manage` dành cho Quản lý; người được cấp riêng quyền xem không thấy nút chốt.
