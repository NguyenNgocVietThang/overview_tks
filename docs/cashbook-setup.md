# Thiết lập Sổ quỹ

Trạng thái 07/10/2026: migration `0033`–`0035` đã áp trên DB cấu hình; đối soát 76.086 ID nguồn HN/SG hoàn tất và bản sửa đã nạp vào server localhost:3000. Bản code production chưa được triển khai trong phiên này. Sổ quỹ dùng `cash_flows` của cả Hà Nội/Sài Gòn, danh mục `cash_book_accounts` từ KiotViet; không có số liệu nào do người dùng nhập. Bộ chọn cơ sở trên thanh điều hướng không đổi phạm vi Sổ quỹ.

## Trước khi đưa lên môi trường thật

1. Trong `server/`, chạy `npm run db:migrate` **ngoài giờ cao điểm** để áp `0033_cash_book.sql`. Migration thêm `account_id`/`status`, backfill theo lô 20.000 phiếu và tạo index; kiểm tra `schema_migrations` có `0033_cash_book.sql` trước khi chạy code mới. Không chạy backfill song song nhiều lần.
2. Triển khai code và bật `KIOTVIET_SYNC_ENABLED=true`, hoặc chỉ bật `KIOTVIET_CASHBOOK_SYNC_ENABLED=true` để chạy riêng Sổ quỹ, với credentials của **cả hai** retailer. Scheduler đồng bộ `bankaccounts` khi bảng trống và mỗi ngày. Kiểm tra danh mục có dữ liệu bằng `SELECT COUNT(*) FROM cash_book_accounts;`, sau đó kiểm tra thời điểm `synced_at` và `sync_checkpoints` cho `cash_flows` ở cả hai cơ sở.
3. Nếu cần chạy danh mục lần đầu bằng tay, xem kế hoạch trước: `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts`. Khi đã chọn đúng DB và credentials mới chạy `node kiotvietSync/backfill.js --branch=all --entity=cash_book_accounts --execute`. Tên CLI là **`cash_book_accounts`**, không phải `bankaccounts`; `--branch=all` lấy cả HN và SG. Backfill lưu tiến độ nên chunk đã hoàn tất sẽ được bỏ qua ở lần gọi sau; đồng bộ hằng ngày do scheduler thực hiện.
4. Đối chiếu số lượng danh mục theo từng retailer: `node kiotvietSync/reconcileCounts.js --branch=hanoi` và `node kiotvietSync/reconcileCounts.js --branch=saigon`. Lệnh này cũng đối chiếu các entity khác; xem riêng dòng `cash_book_accounts`. Một số ID lịch sử không còn ở danh mục vẫn được giữ và hiển thị dưới dạng `Tài khoản #ID`.

## Tồn quỹ (từ 06/10/2026, bỏ chốt số dư và nhập tên ngân hàng)

### Tự động cập nhật không cần F5 — 07/10/2026

Sổ quỹ có lịch riêng mỗi 60 giây, chạy ngay lúc startup; chu kỳ cấu hình bằng `KIOTVIET_CASHBOOK_SYNC_INTERVAL_MS` nhưng không nhỏ hơn 60 giây. Một lượt còn chạy thì nhịp kế tiếp bỏ qua, không gọi trùng API. Nhịp slow 20 phút không còn chứa `cash_flows`. Localhost đã bật `KIOTVIET_CASHBOOK_SYNC_ENABLED=true`; engine tổng vẫn giữ cấu hình cũ. Code chưa triển khai lên production.

Trang mở kiểm tra `GET /api/cashbook/sync-status` mỗi 15 giây; endpoint yêu cầu `cashbook.view`, `Cache-Control: no-store`, chỉ đọc checkpoint. Revision gồm mốc thành công riêng của cả hai cơ sở và danh mục tài khoản; không dùng riêng MAX vì có thể bỏ sót thay đổi cơ sở còn lại. Summary trả revision lấy trước khi đọc số liệu để không bỏ qua commit xảy ra trong lúc tải. Khi revision đổi, trang cập nhật KPI/số dư/sổ chi tiết tại chỗ, giữ bộ lọc, trang và sắp xếp. Dữ liệu nguồn thường xuất hiện sau khoảng 1–2 phút, phụ thuộc thời gian API/DB; sửa phiếu ngoài cửa sổ 7 ngày và ID bị thay thế được kiểm tra trong lượt đối soát lịch sử hằng ngày.

Khi tab ẩn hoặc mất mạng, ngừng kiểm tra; quay lại tab/có mạng thì kiểm tra ngay. Request nền không chen vào yêu cầu do người dùng đổi bộ lọc. Lỗi nền giữ số liệu trước đó và mốc đồng bộ cũ, báo đang thử lại, giãn nhịp 30–60 giây; timeout kiểm tra 10 giây và tải bảng 30 giây. Nếu backend tắt đồng bộ, trang vẫn tự kiểm tra nhưng hiển thị rõ trạng thái tắt.

Tồn quỹ của một quỹ tại một thời điểm = tổng mọi phiếu thu/chi **chưa hủy** của quỹ đó tới thời điểm đó (thu dương, chi âm), giống cột Tồn quỹ của Sổ quỹ KiotViet. Không còn mốc chốt, không còn số dư ban đầu do Quản lý nhập.

HN và SG là 2 retailer nên cùng một tài khoản ngân hàng có 2 ID trong `cash_book_accounts`. Bảng *Số dư tài khoản* gộp theo **số tài khoản**: mỗi dòng có Tồn quỹ HN, Tồn quỹ SG và Tổng tồn quỹ (= HN + SG). Tiền mặt tách theo `cash_flows.branch` và nhận diện bằng `method = Cash`, kể cả phiếu còn `accountId` lịch sử. Các phương thức khác mới phân nhóm theo tài khoản; giao dịch không có tài khoản hiện riêng ở “Chưa xác định tài khoản”, không cộng vào tiền mặt. Khóa quỹ (tham số `fund`) là danh sách ID của nhóm, ví dụ `1220968,1220979`. Không có dropdown Quỹ: bảng Số dư luôn liệt kê đủ quỹ (dùng ô tìm kiếm); bấm một dòng để lọc Sổ chi tiết và KPI theo tài khoản đó, bấm lại hoặc "Bỏ lọc tài khoản" để bỏ. Thẻ KPI chỉ còn Tổng thu, Tổng chi, Tồn quỹ (tổng tồn quỹ tại cuối kỳ lọc; thẻ Quỹ đầu kỳ đã bỏ); Tổng thu/Tổng chi theo bộ lọc hiển thị. Số dư lũy kế ở Sổ chi tiết luôn hiện: là tồn quỹ của các quỹ đang chọn ngay sau phiếu, tính trên toàn dòng thời gian (không bị ảnh hưởng bởi bộ lọc loại/trạng thái/tìm kiếm).

KiotViet `bankaccounts` (API công khai) chỉ có số TK, tên chủ tài khoản (`bankName`) và mô tả — không có tên ngân hàng (VPBank, OCB…) lẫn tồn quỹ như trên giao diện web KiotViet. Dashboard hiện số TK + chủ TK + mô tả. Bảng `cash_book_checkpoints` (0033) và `cash_book_account_banks` (0034) còn trong DB nhưng code không đọc nữa.

## Sửa sai số và đối soát — 07/10/2026

Migration 0035 thêm source_missing_at (timestamptz). Phiếu nguồn đã thay thế ID được giữ nguyên raw/số tiền/trạng thái trong DB và chỉ loại khỏi tính toán; nếu ID xuất hiện lại, upsert tự bỏ dấu này. Chỉ đánh dấu sau khi mọi trang/cả thu và chi thành công và số ID duy nhất khớp total API. Snapshot thiếu hoặc trùng ID không được chốt mốc hoàn tất.

Dùng orderBy=Id, orderDirection=ASC, đã kiểm chứng API thực tế, để tránh phân trang theo thời gian làm trùng/mất phiếu cùng giờ.

- Nhận diện tiền mặt theo phương thức thanh toán, không suy ra từ accountId rỗng. Phiếu Cash có accountId (kể cả -1) vẫn thuộc tiền mặt; phiếu Transfer thiếu accountId không thuộc tiền mặt.
- transDate/createdDate API không ghi múi giờ là giờ Việt Nam: ghi Postgres với +07:00; chuỗi có Z/offset giữ nguyên. Đối soát sửa lại cả account_id/status/trans_date đã lưu sai bởi phiên server cũ.
- startDate/endDate lọc ngày giao dịch, không phải ngày sửa. Mỗi ngày đối soát toàn bộ lịch sử, gồm cả phiếu hủy; các lượt giữa ngày đọc lại ít nhất 7 ngày gần nhất. Lượt đầu sau nâng cấp bắt buộc đối soát đầy đủ. Phải truyền startDate từ 1970 và endDate cụ thể: API không truyền ngày mặc định chỉ trả một phần dữ liệu.
- Chỉ ghi phiếu mới/thay đổi hoặc có cột chiếu sai; ghi theo lô 100 phiếu. Chỉ cập nhật mốc hoàn tất sau khi cả thu/chi và mọi trang thành công; lỗi giữa chừng được đọc lại. Không chạy chồng hai lượt cash_flows cùng cơ sở.
- sync_checkpoints.note của cash_flows lưu JSON {windowEnd,reconciledAt}; note cũ hoặc note báo lỗi kích hoạt đối soát đầy đủ. Cần khởi động lại server để nạp logic mới. Áp migration `0035_cash_flows_source_presence.sql` trước khi khởi động server mới.
- Ví dụ đã đối chiếu API trực tiếp tại thời điểm ảnh: Cash HN thu 208.479.951.393, chi 208.434.838.794, tồn 45.112.599; SG thu 45.376.037.373, chi 44.978.466.866, tồn 397.570.507. Đây là kết quả đối chiếu, không phải hằng số trong mã nguồn.
