# Supabase schema cho đồng bộ KiotViet

Tài liệu này mô tả schema Postgres được tạo bởi `db/migrations/0001` đến `0006`. Mọi module đồng bộ ở Giai đoạn 2 phải đọc cả tài liệu này và `kiotviet/API_ENDPOINTS.md` trước khi ánh xạ payload.

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

Ngoài 16 bảng trên, runner quản lý bảng kỹ thuật `schema_migrations(filename, applied_at)` để mỗi file SQL chỉ được áp dụng một lần.

## Quan hệ và index

- Các bảng `invoice_details`, `invoice_payments`, `order_details`, `return_details`, `purchase_details` có foreign key ghép tới bảng cha cùng `branch`, với `ON DELETE CASCADE`.
- `returns.invoice_id` không có foreign key tới `invoices`, vì hai entity có thể được đồng bộ song song và phiếu trả có thể tới trước hóa đơn gốc.
- Index `(branch, modified_date)` tồn tại trên `invoices`, `orders`, `returns`, `purchases`.
- `cash_flows` dùng index `(branch, trans_date)`.

## Ba lưu ý bắt buộc cho Giai đoạn 2

1. `branch` là định danh nội bộ (`hanoi`/`saigon`), khác nhãn tiếng Việt trong `BRANCHES` và khác retailer code dùng để gọi API. Không trộn ba giá trị này.
2. `line_no` là vị trí phần tử trong mảng payload, đánh số từ 0, không phải ID KiotViet. Khi cập nhật một entity cha, phải xóa toàn bộ dòng con cũ rồi chèn lại. Nếu payload thật có ID dòng ổn định, chỉ thay đổi chiến lược bằng một migration mới sau khi đã xác minh.
3. `cash_flows` không có `modified_date`. Đồng bộ entity này phải dùng cửa sổ `startDate`/`endDate`; trạng thái cửa sổ được lưu trong `sync_checkpoints.note`, không dùng cơ chế `lastModifiedFrom` của các entity khác.
