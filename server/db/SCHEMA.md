# Supabase schema cho đồng bộ KiotViet

Tài liệu này mô tả schema Postgres được tạo bởi `db/migrations/0001` đến `0008`. Mọi module đồng bộ ở Giai đoạn 2/3 phải đọc cả tài liệu này và `kiotviet/API_ENDPOINTS.md` trước khi ánh xạ payload.

## Quy ước chung

- Mọi bảng nghiệp vụ dùng `branch` với đúng hai giá trị nội bộ: `hanoi` và `saigon`.
- ID KiotViet chỉ duy nhất trong phạm vi một gian hàng, nên khóa chính luôn bắt đầu bằng `branch`.
- Tiền là số nguyên VND và dùng `BIGINT`; số lượng hàng hóa là số nguyên và dùng `INTEGER`.
- Các entity lấy trực tiếp từ KiotViet lưu toàn bộ object nguồn trong `raw JSONB`; các cột first-class dùng để join, lọc và sắp xếp.
- `status` giữ nguyên mã `SMALLINT` từ KiotViet, không suy diễn nhãn trong tầng lưu trữ.
- `synced_at` là thời điểm bản ghi được ghi vào Postgres, không thay thế `created_date` hoặc `modified_date` của KiotViet.

## Ánh xạ định danh cơ sở

| `branch` trong Postgres | Nhãn `BRANCHES` của Dashboard Sheets | Biến môi trường retailer KiotViet |
|---|---|---|
| `hanoi` | `Hà Nội` | `KIOTVIET_RETAILER` |
| `saigon` | `Sài Gòn` | `KIOTVIET_RETAILER_SG` |

Ba hệ định danh này khác nhau. Code sync phải nhận `branch` rõ ràng từ cấu hình tác vụ và không suy ra nó bằng cách so sánh nhãn hiển thị.

## Danh sách bảng

| Bảng | Mục đích | Khóa chính | Cột first-class chính |
|---|---|---|---|
| `categories` | Nhóm hàng | `(branch, id)` | `parent_id`, `name`, `rank`, `modified_date` |
| `products` | Hàng hóa và trạng thái hoạt động | `(branch, id)` | `code`, `name`, `category_id`, `base_price`, `unit`, `is_active`, các ngày |
| `customers` | Khách hàng | `(branch, id)` | `code`, `name`, `phone`, `group_id`, `debt`, `total_revenue`, các ngày |
| `suppliers` | Nhà cung cấp | `(branch, id)` | `code`, `name`, `phone`, `group_id`, `debt`, các ngày |
| `staff` | Nhân viên suy luận từ các entity khác | `(branch, id)` | `name`, `first_seen_at`, `last_seen_at` |
| `sync_checkpoints` | Tiến độ từng entity của từng cơ sở | `(branch, entity)` | `last_synced_at`, `last_success_at`, `note` |
| `invoices` | Hóa đơn | `(branch, id)` | `code`, `purchase_date`, `customer_id`, `sold_by_id`, tiền, `status`, các ngày |
| `invoice_details` | Dòng hàng của hóa đơn | `(branch, invoice_id, line_no)` | `product_id`, `quantity`, `price`, `discount` |
| `invoice_payments` | Thanh toán của hóa đơn | `(branch, invoice_id, line_no)` | `method`, `amount`, `trans_date` |
| `orders` | Đơn hàng | `(branch, id)` | `code`, `order_date`, `customer_id`, `sold_by_id`, `total`, `status`, các ngày |
| `order_details` | Dòng hàng của đơn hàng | `(branch, order_id, line_no)` | `product_id`, `quantity`, `price`, `discount` |
| `returns` | Phiếu trả hàng | `(branch, id)` | `code`, `return_date`, `invoice_id`, `customer_id`, `sold_by_id`, `total`, `status`, các ngày |
| `return_details` | Dòng hàng của phiếu trả | `(branch, return_id, line_no)` | `product_id`, `quantity`, `price` |
| `purchases` | Phiếu nhập hàng từ endpoint `/purchaseorders` | `(branch, id)` | `code`, `purchase_date`, `supplier_id`, `total`, `status`, các ngày |
| `purchase_details` | Dòng hàng của phiếu nhập | `(branch, purchase_id, line_no)` | `product_id`, `quantity`, `price` |
| `cash_flows` | Toàn bộ phiếu thu và phiếu chi | `(branch, id)` | `code`, `is_receipt`, `amount`, `method`, đối tác/người dùng, `trans_date` |
| `webhook_events_raw` | Payload webhook thô để phân tích ở Task 7b | `id` | `received_at`, `payload` |
| `backfill_progress` | Tiến độ backfill lịch sử (Giai đoạn 3), độc lập với `sync_checkpoints` | `(branch, entity, chunk_key)` | `status`, `next_item`, `records_synced`, `last_error` |

Ngoài 16 bảng nghiệp vụ trên còn có bảng raw webhook, bảng tiến độ backfill, và runner quản lý bảng kỹ thuật `schema_migrations(filename, applied_at)` để mỗi file SQL chỉ được áp dụng một lần.

### Tài khoản đăng nhập và nhân sự (migration `0009`)

| Bảng | Mục đích | Khóa chính | Cột first-class chính |
|---|---|---|---|
| `hr_employees` | Danh sách nhân sự (thay tab "Danh sách nhân sự" Sheets) | `id` (BIGSERIAL) | `branch`, `ho_ten`, `bo_phan`, `email`, `so_dien_thoai`, `is_active` |
| `app_users` | Tài khoản đăng nhập ứng dụng (thay tab "Users" Sheets) | `id` (UUID, sinh ở app bằng `crypto.randomUUID()`, không dùng `pgcrypto`) | `username`, `password_hash`, `vai_tro`, `co_so`, `trang_thai`, `hr_employee_id` |

Hai bảng này **khác** quy ước `branch` 2 giá trị nội bộ ở cột `co_so` của `app_users`: `co_so` có 3 trạng thái + rỗng (`hanoi`/`saigon`/`both`/`''`) vì một tài khoản có thể phụ trách cả hai cơ sở — không nhầm với `branch` (chỉ `hanoi`/`saigon`) dùng ở `hr_employees` và mọi bảng KiotViet khác. `app_users.hr_employee_id` là FK tới `hr_employees(id)` (`ON DELETE SET NULL`) — thay cho cặp con trỏ sheet cũ `(hrSourceBranch, hrRowIndex)`; xoá nhân sự dùng `is_active = false` (soft-delete), không `DELETE` vật lý, để logic khoá tài khoản `hr_removed` (`server/auth/effectiveUserResolver.js`) còn hoạt động được.

### Vai trò chỉ-đọc `reporting_readonly` (migration `0010`)

Role Postgres cấp cho nhân viên dùng SQL client/BI tool để truy vấn trực tiếp — xem chi tiết và cách đặt mật khẩu trong `0010_reporting_readonly_role.sql`. Role này được `GRANT SELECT` trên các bảng báo cáo KiotViet (liệt kê rõ tên bảng, không dùng `GRANT ... ON ALL TABLES`), **tuyệt đối không** trên `app_users` (chứa `password_hash`) hoặc `hr_employees` (PII nhân sự).

**Bắt buộc cho mọi migration tương lai**: vì migration `0010` có `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reporting_readonly`, bất kỳ bảng mới nào chứa dữ liệu nhạy cảm (PII, secret, hash...) phải tự thêm `REVOKE SELECT ON <bảng> FROM reporting_readonly;` ngay trong migration tạo bảng đó — mặc định sẽ tự động được cấp quyền đọc nếu không revoke.

## Quan hệ và index

- Các bảng `invoice_details`, `invoice_payments`, `order_details`, `return_details`, `purchase_details` có foreign key ghép tới bảng cha cùng `branch`, với `ON DELETE CASCADE`.
- `returns.invoice_id` không có foreign key tới `invoices`, vì hai entity có thể được đồng bộ song song và phiếu trả có thể tới trước hóa đơn gốc.
- Index `(branch, modified_date)` tồn tại trên `invoices`, `orders`, `returns`, `purchases`.
- `cash_flows` dùng index `(branch, trans_date)`.

## Ba lưu ý bắt buộc cho Giai đoạn 2

1. `branch` là định danh nội bộ (`hanoi`/`saigon`), khác nhãn tiếng Việt trong `BRANCHES` và khác retailer code dùng để gọi API. Không trộn ba giá trị này.
2. `line_no` là vị trí phần tử trong mảng payload, đánh số từ 0, không phải ID KiotViet. Khi cập nhật một entity cha, phải xóa toàn bộ dòng con cũ rồi chèn lại. Nếu payload thật có ID dòng ổn định, chỉ thay đổi chiến lược bằng một migration mới sau khi đã xác minh.
3. `cash_flows` không có `modified_date`. Đồng bộ entity này phải dùng cửa sổ `startDate`/`endDate`; trạng thái cửa sổ được lưu trong `sync_checkpoints.note`, không dùng cơ chế `lastModifiedFrom` của các entity khác.

## Một lưu ý bắt buộc cho Giai đoạn 3 (backfill)

`backfill_progress` (migration `0008`) lưu tiến độ chạy `backfill.js` theo `(branch, entity, chunk_key)`,
`chunk_key` là `'YYYY-MM'` cho entity có `backfillRangeParam` (chia theo tháng) hoặc `'full'` cho entity
chạy 1 lượt duy nhất. Bảng này **độc lập hoàn toàn** với `sync_checkpoints` — polling (Giai đoạn 2) không
đọc/ghi bảng này, và backfill không đọc/ghi `sync_checkpoints`. Ghi trùng dữ liệu nghiệp vụ giữa 2 tiến
trình là an toàn vì mọi bảng dùng `UPSERT` theo `(branch, id)`.
