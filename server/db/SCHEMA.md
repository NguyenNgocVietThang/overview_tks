# Supabase schema cho đồng bộ KiotViet

Tài liệu này mô tả schema Postgres được tạo bởi `db/migrations/0001` đến `0030`. Mọi module đồng bộ ở Giai đoạn 2/3 phải đọc cả tài liệu này và `kiotviet/API_ENDPOINTS.md` trước khi ánh xạ payload.

## Quy ước chung

- Mọi bảng nghiệp vụ dùng `branch` với đúng hai giá trị nội bộ: `hanoi` và `saigon`.
- ID KiotViet chỉ duy nhất trong phạm vi một gian hàng, nên khóa chính luôn bắt đầu bằng `branch`.
- Cột tiền và số lượng dùng `NUMERIC` (đổi từ `BIGINT`/`INTEGER` ở migration `0012`, 2026-09-16). Giả định ban đầu "tiền/số lượng luôn là số nguyên" sai với dữ liệu thật — KiotViet trả giá/chiết khấu có phần lẻ xu và số lượng hàng bán theo cân không phải số nguyên (ví dụ `7.5`).
- Các entity lấy trực tiếp từ KiotViet lưu toàn bộ object nguồn trong `raw JSONB`; các cột first-class dùng để join, lọc và sắp xếp.
- `status` giữ nguyên mã `SMALLINT` từ KiotViet, không suy diễn nhãn trong tầng lưu trữ.
- `synced_at` là thời điểm bản ghi được ghi vào Postgres, không thay thế `created_date` hoặc `modified_date` của KiotViet.
- 3 bảng rollup báo cáo Dashboard (migration `0013`, `daily_purchase_summary` đã bỏ ở `0026`) là ngoại lệ: không có `raw`, không theo quy ước `branch` là cột đầu PK duy nhất (khóa chính của chúng ghép thêm ngày/mã hàng vì là bảng tổng hợp, không phải bản sao 1-1 của KiotViet).

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
| `order_suppliers` | Phiếu **Đặt hàng nhập** (PDN…) từ endpoint `/ordersuppliers` (migration `0024`) — khác `purchases` (Nhập hàng) | `(branch, id)` | `code`, `order_date`, `supplier_id`, `total`, `status`, `created_date` (payload không có `modifiedDate`) |
| `order_supplier_details` | Dòng hàng của phiếu đặt hàng nhập | `(branch, order_supplier_id, line_no)` | `product_id`, `quantity`, `price` (payload chỉ có `productId`, không có `productCode`) |
| `inventory_value_snapshots` | Giá trị tồn kho **mỗi ngày, mỗi cơ sở** (migration `0025`) — ảnh chụp lúc 23:59 giờ VN từ 2026-09-30, nguồn biểu đồ "Giá trị tồn kho theo ngày" (tab Tổng quan) | `(snapshot_date, branch)` | `stock_value`, `captured_at` (thời điểm chụp thật; chụp bù thì > 23:59) |
| `cash_flows` | Toàn bộ phiếu thu và phiếu chi | `(branch, id)` | `code`, `is_receipt`, `amount`, `method`, đối tác/người dùng, `trans_date` |
| `webhook_events_raw` | Payload webhook thô để phân tích ở Task 7b | `id` | `received_at`, `payload` |
| `backfill_progress` | Tiến độ backfill lịch sử (Giai đoạn 3), độc lập với `sync_checkpoints` | `(branch, entity, chunk_key)` | `status`, `next_item`, `records_synced`, `last_error` |

Ngoài 18 bảng nghiệp vụ trên còn có bảng raw webhook, bảng tiến độ backfill, và runner quản lý bảng kỹ thuật `schema_migrations(filename, applied_at)` để mỗi file SQL chỉ được áp dụng một lần.

### Tài khoản đăng nhập và nhân sự (migration `0009`)

| Bảng | Mục đích | Khóa chính | Cột first-class chính |
|---|---|---|---|
| `hr_employees` | Danh sách nhân sự (thay tab "Danh sách nhân sự" Sheets) | `id` (BIGSERIAL) | `branch`, `ho_ten`, `bo_phan`, `email`, `so_dien_thoai`, `is_active` |
| `app_users` | Tài khoản đăng nhập ứng dụng (thay tab "Users" Sheets) | `id` (UUID, sinh ở app bằng `crypto.randomUUID()`, không dùng `pgcrypto`) | `username`, `password_hash`, `vai_tro`, `co_so`, `trang_thai`, `hr_employee_id`, `telegram_id` |

Hai bảng này **khác** quy ước `branch` 2 giá trị nội bộ ở cột `co_so` của `app_users`: `co_so` có 3 trạng thái + rỗng (`hanoi`/`saigon`/`both`/`''`) và chỉ là **cơ sở mặc định** lúc đăng nhập (mọi tài khoản xem được cả hai cơ sở; rỗng = mặc định `Cả hai`) — không nhầm với `branch` (chỉ `hanoi`/`saigon`) dùng ở `hr_employees` và mọi bảng KiotViet khác. `app_users.hr_employee_id` là FK tới `hr_employees(id)` (`ON DELETE SET NULL`) — thay cho cặp con trỏ sheet cũ `(hrSourceBranch, hrRowIndex)`; xoá nhân sự dùng `is_active = false` (soft-delete), không `DELETE` vật lý. Cơ chế tự khóa tài khoản khi nhân sự bị gỡ (`lock_reason = 'hr_removed'`) đã bỏ; `effectiveUserResolver.js` chỉ còn mở khóa các tài khoản từng bị khóa theo cơ chế đó khi họ đăng nhập lại.

Migration `0015` thêm `app_users.telegram_id` dạng `TEXT` để không phụ thuộc giới hạn số nguyên JavaScript và hỗ trợ Telegram ID dài. ID khác rỗng là duy nhất giữa các tài khoản chưa xoá. Từ migration `0016`, cột này là **bản đọc** được trigger đồng bộ từ `hr_telegram_links` (xem mục "Nghỉ phép và bot Telegram"); nguồn sự thật của liên kết Telegram là bảng đó. Tab `_HR_TELEGRAM_LINKS` trên Google Sheets không còn được ứng dụng sử dụng.

### Nghỉ phép và bot Telegram (migration `0016`)

Thay 3 tab Google Sheets (`Yêu cầu nghỉ phép`, `_HR_TELEGRAM_LINKS`, `_HR_TELEGRAM_SESSIONS`). Bot **xin nghỉ của nhân viên** chạy **ngoài repo này** (VPS riêng) và đọc/ghi thẳng 3 bảng bằng SQL; web chỉ đọc `hr_leave_requests`, nhập tay bản ghi "tự ý nghỉ" và đổi trạng thái phê duyệt. Cả 3 bảng đã `REVOKE SELECT` khỏi `reporting_readonly` (PII/nội dung tin nhắn).

| Bảng | Mục đích | Khóa chính | Ai ghi |
|---|---|---|---|
| `hr_leave_requests` | Đơn xin nghỉ / bản ghi tự ý nghỉ | `id` (BIGSERIAL), `request_id` UNIQUE | bot (đơn Telegram), web (nhập tay + duyệt) |
| `hr_telegram_links` | Liên kết Telegram chat ↔ tài khoản (`app_users`) | `id` | bot |
| `hr_telegram_sessions` | Trạng thái hội thoại xin nghỉ đang dở, mỗi chat một dòng | `telegram_chat_id` | bot |

**`hr_leave_requests`** — bot chỉ cần `INSERT` các cột không có DEFAULT: `branch` (`hanoi`/`saigon`), `start_date`, `start_session`, `end_date`, `end_session`, `tong_buoi_nghi`. Mọi cột còn lại có DEFAULT, kể cả:
- `request_id` DB tự sinh dạng `NP-YYYYMMDD-NNNN` (sequence, không trùng) — **bot không tự tạo mã**.
- `tong_ngay_nghi` là cột `GENERATED` = `tong_buoi_nghi / 2` — không `INSERT` được.
- Khoảng nghỉ lưu bằng ngày (`DATE`) + buổi (`'Sáng'`/`'Chiều'`); mỗi ngày 2 buổi, khoảng tính gồm cả buổi đầu và cuối. CHECK `hr_leave_requests_range_check` chặn `end < start` và "Chiều → Sáng" cùng ngày. Web dựng lại chuỗi `"Sáng 22/08/2026"` khi trả API — DB không lưu chuỗi đó.
- `ho_ten`, `chuc_vu`, `web_username` là **bản chụp** tại thời điểm gửi; `user_id`/`hr_employee_id` là khóa thật (`ON DELETE SET NULL`), bot nên điền cả hai. `source` mặc định `'telegram'`.
- `co_nghi_gap`/`co_tu_y_nghi` là boolean; `tin_nhan` giữ nguyên văn tin nhắn gốc; `thoi_gian_gui` là giờ nhận tin (khác `created_at` = giờ ghi DB).
- `trang_thai` ∈ `Chưa duyệt | Đã duyệt | Từ chối | Vi phạm` (migration 0030 đã gỡ `Tạm duyệt`, đơn cũ chuyển về `Chưa duyệt`; bot nhân viên ngoài repo không được ghi giá trị này nữa); `loai_yeu_cau` ∈ `Xin nghỉ phép | Tự ý nghỉ (HR ghi nhận)`.
- `ghi_chu_duyet` = lý do từ chối do Quản lý nhập trên web hoặc bot quản lý khi chuyển sang `Từ chối` (rỗng nếu bỏ qua, và bị xóa về rỗng khi đơn đổi sang trạng thái khác). Web không hiển thị cột này; bot xin nghỉ ngoài repo không ghi nó.

**Báo kết quả duyệt cho nhân viên** (thay cho việc bot cũ quét Sheet): hàng cần báo là

```sql
SELECT * FROM hr_leave_requests
 WHERE thoi_diem_duyet IS NOT NULL AND decision_notified_at IS NULL;
```

Sau khi nhắn Telegram thành công, bot `UPDATE ... SET decision_notified_at = now()`. Trigger `hr_leave_requests_before_update` tự đặt lại `decision_notified_at = NULL` mỗi khi `trang_thai` đổi (trừ khi câu `UPDATE` tự đặt giá trị), nên đổi ý duyệt → từ chối được báo lại. Bản ghi web nhập tay đã duyệt sẵn được đánh dấu đã báo ngay từ đầu. Index từng phần `hr_leave_requests_pending_notice_idx` phục vụ đúng truy vấn này.

**`hr_telegram_links`** — vòng đời `pending` (có `link_code` + `code_expires_at`, chờ nhân viên gõ mã) → `linked` (có `telegram_chat_id`, `linked_at`) → `revoked` (bị thay/huỷ); hoặc `pending` → `expired`. Bot cũng có thể tạo thẳng dòng `linked` với `link_method = 'hr_directory'` khi `telegram_chat_id` khớp `hr_employees.telegram_id` (không cần mã). Ràng buộc: mỗi chat chỉ `linked` cho 1 tài khoản, mỗi tài khoản chỉ 1 chat `linked`, mã `pending` duy nhất — muốn đổi liên kết phải `revoke` dòng cũ **trước** (cùng transaction) rồi thêm dòng `linked` mới. Trigger `hr_telegram_links_sync_app_user` giữ `app_users.telegram_id` khớp với dòng `linked` (đặt khi `linked`, xoá khi `revoked`/xoá dòng) → bot không cần ghi `app_users`. `telegram_chat_id` là `TEXT` (kiểu chuỗi tránh mất chính xác số lớn).

**`hr_telegram_sessions`** — `step` (tên bước của bot, không CHECK vì thuộc về bot), `data JSONB` (ngày lưu dạng chuỗi ISO), `expires_at` mặc định +60 phút; bot gia hạn `expires_at` mỗi lần ghi, coi dòng quá hạn là không tồn tại và dọn định kỳ bằng `DELETE FROM hr_telegram_sessions WHERE expires_at < now()`. Ghi phiên bằng `INSERT ... ON CONFLICT (telegram_chat_id) DO UPDATE`.

Trang hồ sơ cá nhân và hộp hồ sơ dùng chung đọc `telegramId` (và cờ `telegramEditable`) từ `GET /api/auth/profile`. Từ 2026-10-03 chỉ **Quản lý** (hoặc admin cứng) được thêm/sửa ID ở hồ sơ của chính mình: khi người dùng lưu ID qua `POST /api/auth/profile`, server chỉ cập nhật tài khoản đang đăng nhập, còn vai trò khác gửi ID khác giá trị hiện tại bị từ chối 403 `TELEGRAM_ID_LOCKED` (nhân viên nhờ Quản lý nhập hộ). ID là chuỗi số nguyên dương tối đa 20 chữ số; chuỗi rỗng hủy liên kết, không gửi trường này thì giữ ID hiện tại. `appUsersRepository.updateProfileRow` lưu hồ sơ, thu hồi liên kết cũ/các mã chờ, tạo liên kết `manual` mới và đồng bộ `hr_employees.telegram_id` của nhân sự đã gắn tài khoản trong một transaction. ID trùng tài khoản, liên kết bot hoặc nhân sự đang hoạt động khác trả HTTP 409 và rollback toàn bộ. Không cần migration mới.

Quản lý cũng có thể xem ID trong `GET /api/admin/users` và đổi/xóa ID qua `PUT /api/admin/users/:id` hoặc hộp sửa thông tin nhân viên. Luồng này dùng cùng transaction đồng bộ ID, liên kết bot và danh bạ nhân sự; các thông tin tài khoản được gửi kèm cũng lưu trong transaction đó. Quyền `account.users.manage` và chính sách bảo vệ tài khoản vẫn áp dụng: đổi ID của quản lý khác chỉ dành cho quản lý cấp cao, thao tác chiếm định danh không vượt quyền người sửa. Không gửi `telegramId` thì giữ liên kết hiện tại.

`updated_at` của cả 3 bảng do trigger tự đặt, bot không cần set.

### Bot Telegram riêng cho quản lý (migration `0029`)

`0029_hr_manager_telegram.sql` bổ sung `hr_leave_requests.decision_version` và 5 bảng kỹ thuật cho bot quản lý chạy cùng Express. Bot xin nghỉ ngoài repo tiếp tục ghi đơn vào bảng hiện có; trigger DB ghi sự kiện tạo đơn/đổi quyết định kể cả khi nguồn ghi là bot đó.

| Bảng / cột | Mục đích | Quyền sở hữu |
|---|---|---|
| `hr_leave_requests.decision_version` | BIGINT NOT NULL DEFAULT 0; đổi trạng thái/lý do/người quyết định/thời điểm làm tăng phiên bản để từ chối nút và hội thoại cũ | DB + service quyết định dùng chung |
| `hr_leave_change_events` | Sự kiện tạo đơn/đổi quyết định bền vững, nguồn phát hiện thay đổi từ mọi nguồn ghi | Trigger DB; runtime đọc/xử lý |
| `hr_leave_manager_messages` | Theo dõi bản tin theo đơn/quản lý/chat, message ID, lease xử lý và retry; hỗ trợ cập nhật các bản tin đã gửi | Bot quản lý |
| `hr_manager_telegram_sessions` | Phiên nhập lý do từ chối, gắn chat/quản lý/đơn/phiên bản và tin nhắn nhắc nhập; hết hạn 15 phút | Bot quản lý |
| `hr_manager_telegram_updates` | Inbox bền vững theo Telegram `update_id`; giữ hiệu ứng cần xử lý lại để chống cập nhật trùng khi retry/restart | Webhook + runtime bot quản lý |
| `hr_manager_telegram_state` | Một dòng lưu mốc bật bot lần đầu, phân biệt lịch sử kết thúc cũ và đơn thật sự mới; không chứa dữ liệu nghiệp vụ người dùng | Runtime bot quản lý |

**Khóa và cột kỹ thuật:**

- `hr_leave_change_events`: PK `id BIGSERIAL`, FK `request_id` → đơn, UNIQUE `(request_id, decision_version)`; `event_type` nhận `CREATE`/`DECISION`. Index hàng chưa `completed_at` theo `(available_at, id)`. Migration chỉ seed đơn Xin nghỉ phép Chưa duyệt hiện có, không gửi lại các quyết định kết thúc cũ.
- `hr_leave_manager_messages`: PK `id BIGSERIAL`, FK `request_id`/`user_id`, UNIQUE `(request_id, user_id, telegram_chat_id)`; chat ID là TEXT, message ID BIGINT. `desired_version` mặc định 0, `sent_version` mặc định -1; index hàng `NOT blocked AND desired_version > sent_version` để giao/cập nhật tin còn thiếu.
- `hr_manager_telegram_sessions`: PK `telegram_chat_id TEXT`, `session_id UUID` UNIQUE; FK `user_id`/`request_id`, `expected_version`, `prompt_message_id`, `expires_at` mặc định +15 phút. Index `expires_at` hỗ trợ tìm phiên hết hạn.
- `hr_manager_telegram_updates`: PK `update_id BIGINT`, `payload JSONB`, `chat_key TEXT GENERATED` lấy chat từ callback/message (fallback update ID), `effects JSONB` dạng mảng, `effects_done`, `handled_at`, `completed_at`. Hai index một phần cho hàng chưa hoàn tất: `(available_at, update_id)` và `(chat_key, update_id)`. Claim không vượt update trước chưa hoàn tất trong cùng chat, kể cả update trước đang retry hoặc còn lease.
- `hr_manager_telegram_state`: PK `singleton BOOLEAN CHECK (singleton)` cho một dòng, `first_enabled_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()` lưu mốc bật lần đầu qua restart/tắt-bật. Lịch sử kết thúc trước mốc này không được gửi mới; đơn tạo sau mốc vẫn gửi thông tin hiện tại dù đã được duyệt trên web trước lượt quét.
- Event, bản tin và inbox có `available_at`, `attempts`, `lease_token UUID`, `lease_until`, `last_error` để claim và retry công việc. Các FK tới đơn/tài khoản dùng `ON DELETE CASCADE`.

Bốn bảng sự kiện/giao tin/phiên/inbox chứa định danh Telegram/nội dung nghiệp vụ nội bộ nên thu hồi `SELECT` khỏi `reporting_readonly`. Bảng singleton trạng thái không chứa dữ liệu nghiệp vụ người dùng; migration cũng thu hồi SELECT của role này trên bảng đó. Không dùng chung `hr_telegram_sessions` của bot nhân viên để lưu hội thoại từ chối.

**Quyết định dùng chung:** service web/Telegram cập nhật cùng hàng `hr_leave_requests` trong transaction. Callback Telegram phải khớp `decision_version` mới nhất và người thao tác vẫn đủ vai trò Quản lý, trạng thái hoạt động, Telegram ID, quyền `hr.leave.manage` và cơ sở của đơn. Telegram không đổi tiếp đơn `Đã duyệt`/`Từ chối`; web vẫn được thay đổi/mở lại theo quyền hiện hành. Lý do từ chối trim, tối đa 500 ký tự; bỏ qua lưu rỗng, đổi sang trạng thái khác xóa lý do.

**Giao tin:** nhận các đơn `Xin nghỉ phép` mới và bù các đơn `Chưa duyệt` chưa gửi cho quản lý phù hợp; bỏ qua `Tự ý nghỉ (HR ghi nhận)`. Lease và trạng thái retry giữ việc đang dở qua restart, chống nhiều lượt quét cùng nhận một việc. Tin nhắn đã gửi được đồng bộ theo quyết định cuối cùng trong DB.

**Tương thích bot nhân viên:** `decision_notified_at` tiếp tục là cột bot xin nghỉ bên ngoài dùng để báo kết quả cho nhân viên. Bot quản lý không đánh dấu nó; trigger reset cột này khi đổi trạng thái vẫn giữ nguyên hợp đồng migration `0016`.

**Cầu DB → SSE:** `hr/hrLeaveDbRealtime.js` quét bản chụp/phiên bản dùng chung, tránh phụ thuộc cursor event tăng dần vì transaction có thể commit khác thứ tự ID. Tạo/đổi đơn bên ngoài repo được đưa vào SSE HR; kết nối/kết nối lại tải lại danh sách. `HR_LEAVE_DB_REALTIME_ENABLED=true` mặc định, độc lập với bot quản lý.

Phải áp migration này **trước khi chạy bản web mới**, kể cả khi bot quản lý tắt, vì repository đọc `decision_version`.

### Vai trò chỉ-đọc `reporting_readonly` (migration `0010`)

Role Postgres cấp cho nhân viên dùng SQL client/BI tool để truy vấn trực tiếp — xem chi tiết và cách đặt mật khẩu trong `0010_reporting_readonly_role.sql`. Role này được `GRANT SELECT` trên các bảng báo cáo KiotViet (liệt kê rõ tên bảng, không dùng `GRANT ... ON ALL TABLES`), **tuyệt đối không** trên `app_users` (chứa `password_hash`) hoặc `hr_employees` (PII nhân sự).

**Bắt buộc cho mọi migration tương lai**: vì migration `0010` có `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO reporting_readonly`, bất kỳ bảng mới nào chứa dữ liệu nhạy cảm (PII, secret, hash...) phải tự thêm `REVOKE SELECT ON <bảng> FROM reporting_readonly;` ngay trong migration tạo bảng đó — mặc định sẽ tự động được cấp quyền đọc nếu không revoke.

### Trạng thái xử lý công nợ (migration `0011`)

| Bảng | Mục đích | Khóa chính | Cột chính |
|---|---|---|---|
| `debt_collection_statuses` | Trạng thái thu nợ do Quản lý/Trợ lý cập nhật, tách khỏi workbook Google Sheets chỉ đọc | `(branch, customer_key)` | `status`, `alert_signature`, `updated_by_user_id`, `updated_by_name`, `updated_at` |

- `branch` chỉ nhận `hanoi` hoặc `saigon`; route lấy giá trị từ session/middleware, không nhận cơ sở từ body client.
- `status` chỉ nhận `Chưa xử lý`, `Đang xử lý`, `Đã xử lý`, `Bỏ qua`.
- `alert_signature` là SHA-256 64 ký tự hex của cảnh báo và số nợ hiện tại. Khi chữ ký nguồn thay đổi, trạng thái kết thúc (`Đã xử lý`/`Bỏ qua`) không còn hiệu lực và dashboard mở lại khách ở `Chưa xử lý`.
- Migration thu hồi quyền `SELECT` của `reporting_readonly` trên bảng này vì có định danh người cập nhật; bảng không thuộc nguồn BI.

### Rollup báo cáo Dashboard theo ngày (migration `0013`)

| Bảng | Mục đích | Khóa chính | Cột chính |
|---|---|---|---|
| `daily_invoice_summary` | Doanh thu/số hóa đơn theo ngày, dùng cho biểu đồ "Doanh thu theo ngày" ở tab Tổng quan/Hóa đơn | `(branch, sale_date)` | `revenue`/`invoice_count` (chỉ `raw->>'statusValue' = 'Hoàn thành'`), `cancelled_count` (`statusValue = 'Đã hủy'`). **Doanh thu thực tế** hiển thị = `revenue` trừ tiền trả hàng `returns.total` (`statusValue = 'Đã trả'`, theo ngày trả) — tính lúc đọc trong `getInvoiceRevenueByDay`, KHÔNG lưu vào bảng này |
| `daily_product_sales` | Số lượng/doanh thu bán theo ngày của từng mã hàng, dùng cho "Top sản phẩm bán chạy" và doanh thu theo nhóm hàng | `(branch, sale_date, product_id)` | `qty`, `revenue` (mọi hóa đơn `statusValue != 'Đã hủy'`, tức gồm cả Phiếu tạm/Đang xử lý — **khác** điều kiện `daily_invoice_summary`) **đã TRỪ hàng khách trả**: mỗi dòng `return_details` của phiếu trả `Đã trả` là một dòng âm (số lượng + giá trị) vào đúng ngày trả của mã hàng đó, nên `qty`/`revenue` là số ròng và có thể âm ở ngày chỉ có trả hàng |

**Quan trọng — không được lọc theo số `status` trực tiếp**: mã số không có ý nghĩa cố định giữa các entity/cửa hàng (đối chiếu dữ liệu thật 2026-09-18 xác nhận `invoices.status=1` là "Hoàn thành", KHÔNG PHẢI `status=3` như giả định ban đầu — `status=3` thực ra là "Đang xử lý"). Luôn lọc qua `raw->>'statusValue'` (chuỗi thật từ KiotViet), không suy diễn số.
| `product_first_purchase` | Ngày nhập hàng đầu tiên của từng mã hàng (toàn bộ lịch sử, không giới hạn cửa sổ refresh) | `(branch, product_id)` | `first_purchase_date` (MIN, giữ mốc cũ hơn khi `ON CONFLICT` qua `LEAST`) |

- Cả 3 bảng không có cột `raw`, chỉ lưu số đã tổng hợp — tên/nhóm hàng/trạng thái hiện tại luôn join trực tiếp với `products`/`categories` tại thời điểm đọc, không lưu lại (bake) vào rollup để tránh phải tính lại khi đổi tên/nhóm.
- Refresh bởi `server/kiotvietSync/dashboardRollupRefresh.js`: lượt "nóng" 7 ngày sau mỗi lượt sync fast, lượt đầy đủ cửa sổ 400 ngày mỗi 30 phút cho `daily_invoice_summary`/`daily_product_sales`. `product_first_purchase` cần toàn bộ lịch sử `purchases` (ngày nhập đầu tiên có thể xa hơn 400 ngày) nên bản quét đầy đủ chỉ chạy lúc khởi động và mỗi 6 giờ; giữa hai lần đó chỉ xét phiếu nhập trong cửa sổ ngày gần đây.
- **Chỉ ghi dòng thật sự đổi**: mỗi cầu SQL gộp trước rồi `LEFT JOIN` vào bảng đích và bỏ dòng có giá trị y hệt (`IS DISTINCT FROM`), nên `updated_at` là "lần thay đổi gần nhất", không phải "lần tính lại gần nhất". Đừng đổi lại thành `ON CONFLICT DO UPDATE` vô điều kiện (kể cả thêm `WHERE` trong `DO UPDATE` cũng chưa đủ — Postgres vẫn khoá từng dòng trùng khoá và ghi WAL): bản cũ từng UPDATE ~115 triệu lần trên 62.000 dòng, sinh ~37GB WAL + ~115GB tệp tạm trong 34 ngày làm cạn Disk IO Budget của Supabase (2026-09-28).
- Bộ lọc ngày so sánh thẳng cột gốc với mốc `TIMESTAMPTZ` (không bọc `(cột AT TIME ZONE 'UTC')::date`) để dùng được các index ngày (migration `0021`).
- Không `REVOKE SELECT FROM reporting_readonly` trên 3 bảng này — dữ liệu chỉ là số tổng hợp, không nhạy cảm.

### Hoạt động công nợ theo kỳ CN1/CN3/CN7 (migration `0014`)

| Bảng | Mục đích | Khóa chính | Cột chính |
|---|---|---|---|
| `customer_debt_activity_periods` | Khách hàng có phát sinh giao dịch trong 1/3/7 ngày gần nhất (CN1/CN3/CN7, trước đây gọi là HN1/HN3/HN7), thay thế các tab Google Sheets cũ | `(branch, period_days, customer_id)` | `customer_name`, `refreshed_at` |

- Làm mới mỗi 5 phút bằng upsert-khi-đổi-tên + xoá dòng không còn trong tập hiện tại (không xoá hết rồi nạp lại), nên `refreshed_at` là "lần thay đổi gần nhất" của dòng.

### Index ngày cho job định kỳ (migration `0021`)

`idx_invoices_purchase_date (branch, purchase_date)`, `idx_purchases_purchase_date (branch, purchase_date)`, `idx_returns_return_date (branch, return_date)` — phục vụ rollup Dashboard và làm mới công nợ 1/3/7 ngày chỉ cần đọc vài ngày gần nhất (cùng `idx_cash_flows_trans_date` từ `0006`).

- `period_days` nhận một trong ba giá trị: `1`, `3`, `7` tương ứng kỳ CN1, CN3, CN7.
- Index lookup: `(branch, period_days, customer_name)`.
- Bảng chỉ lưu tập tên/ID cần thiết phục vụ cảnh báo "Chưa thu" trên màn hình Quản lý công nợ Dashboard; dữ liệu nguồn tính trực tiếp từ các bảng KiotViet (`invoices`, `returns`, `cash_flows`, `customers`) trong PostgreSQL.
- Làm mới tự động bởi scheduler job `server/kiotvietSync/customerDebtReportRefresh.js`.

### Xuất Excel đọc trực tiếp bảng nào

`POST /api/export` không đọc Google Sheets. Sau khi lấy danh sách mã dòng từ `getDashboardData()`, `dashboardPgReader.readRowsByCodes(tab, cơ sở, mã)` chạy một truy vấn lọc theo mã (`code = ANY($2::text[])`, mã là tham số) trên các bảng dưới đây; chỉ 5 nguồn sau được phép xuất (`EXPORT_SHEET_NAMES`), nguồn khác bị từ chối `EXPORT_SOURCE_NOT_ALLOWED`. Giao diện hiện dùng Hàng hóa, Hóa đơn và Khách hàng; Đặt hàng/Trả hàng vẫn đọc được ở tầng reader nhưng bảng xuất tương ứng đã bỏ cùng hai bảng của tab Hóa đơn (2026-10-01). Các bảng xuất tính sẵn (công nợ, báo cáo hàng hóa, tồn kho theo sản phẩm, đứt hàng…) không đi qua `readRowsByCodes` — xem `server/dashboard/exportService.js` (`TABLE_TITLES`). Nhãn/kiểu/mô tả cột nằm ở `server/dashboard/exportFieldCatalog.js`.

| Tab xuất | Bảng đọc chính | Bảng ghép thêm |
|---|---|---|
| Hàng hóa | `products` | (không; nhóm hàng, tồn kho lấy từ cột `raw` của chính bảng) |
| Hóa đơn | `invoices` | `staff` |
| Đặt hàng | `orders` | |
| Trả hàng | `returns` | |
| Khách hàng | `customers` | |

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

### Báo cáo hàng hóa (migration `0018`)

`product_report` là bảng tổng hợp cho tab "Tổng quan" — cùng ngoại lệ như các bảng rollup ở migration `0013` (không có `raw`, khóa chính không bắt đầu bằng `branch` vì mỗi dòng gộp dữ liệu **cả 2 cơ sở** cho 1 mã hàng). Khóa chính là `product_code`. Được `TRUNCATE` + nạp lại toàn bộ **đúng 1 lần/đêm** bởi `server/kiotvietSync/productReportRefresh.js` (không phải mỗi 5 phút như các rollup khác — truy vấn quét 90 ngày hóa đơn cả 2 cơ sở là nặng, xem comment đầu file đó), route `GET /api/product-report` chỉ đọc thẳng bảng này.

Cột `available_to_sell` (từ 2026-10-01, công thức **Tồn có thể bán**) = tồn 2 cơ sở **trừ** số lượng đang bị giữ trong **đơn đặt hàng Phiếu tạm của khách** (bảng `orders`, `raw->>'statusValue' = 'Phiếu tạm'`) **cộng** hàng đang vận chuyển (phiếu "Đặt hàng nhập" `order_suppliers` trạng thái `Đã xác nhận NCC`, chỉ có ở Kiot Sài Gòn; SQL dùng chung ở `server/dashboard/inTransitSource.js`; cộng đúng 1 lần vì bảng này đã gộp 2 cơ sở). Trước 2026-10-01 công thức là tồn − Khách đặt (3 trạng thái `Phiếu tạm`/`Đang xử lý`/`Đã xác nhận`) và không có phần vận chuyển; file migration `0018` KHÔNG sửa, công thức hiện hành nằm ở `productReportRefresh.js`. Cột không kẹp về 0 (hàng bị giữ quá tồn hiện số âm). Cột `qty_sold_30d`/`revenue_90d` cộng từ `daily_product_sales` (migration `0013`) trong cửa sổ kết thúc **hôm qua** theo lịch VN (không tính hôm nay). Cột `customer_count_90d`/`top_customer_*` tính trực tiếp từ `invoice_details`/`invoices`/`customers` trong 90 ngày, dùng chung định nghĩa "hóa đơn hợp lệ" (`statusValue != 'Đã hủy'`) với `revenue_90d` để `top_customer_share` không bao giờ vượt 100%.

`product_report_customers` (migration `0023`) là bảng phụ của `product_report`: doanh số 90 ngày của **từng khách theo từng mã hàng**, phục vụ khung "Chi tiết" dưới bảng "Báo cáo hàng hóa" (`GET /api/product-report/customers?code=`). Khóa chính `(product_key, customer_key)` với `product_key = lower(btrim(mã hàng))`, `customer_key` = `code:<mã khách>` hoặc `name:<tên khách>` (khách không có mã, gồm cả "Khách lẻ"). Được ghi **trong cùng 1 câu lệnh** `INSERT` của `productReportRefresh.js` (CTE `customer_agg` `MATERIALIZED` đọc 2 lần) nên khớp tuyệt đối với `customer_count_90d`/`top_customer_*` và không quét thêm 90 ngày hóa đơn. Bảng rỗng đến khi job đêm chạy sau khi áp migration — sau khi deploy chạy tay `node kiotvietSync/productReportRefresh.js` (trong `server/`).

### Lịch sử giá trị tồn kho (migration `0025`)

`inventory_value_snapshots` lưu `stock_value` của từng cơ sở theo từng ngày lịch VN. Tồn kho trong DB (`products.raw->'inventories'`) chỉ là trạng thái hiện tại nên không dựng lại được quá khứ; job `kiotvietSync/inventoryValueSnapshot.js` chụp **1 lần/ngày lúc 23:59 giờ VN** (kiểm tra mỗi phút, `INSERT ... ON CONFLICT DO NOTHING` nên chạy trùng vô hại). Bắt đầu từ tối 2026-09-30; trước đó không có số liệu.

- Công thức giữ nguyên KPI "Giá trị tồn kho" của tab Hàng hóa: mỗi mã hàng `max(tổng onHand, 0) × max(giá vốn trung bình, 0)`, chỉ hàng đang kinh doanh (`is_active IS NOT FALSE`), bỏ mã bắt đầu `VAT`. Tổng hai cơ sở = số "Cả hai".
- Lỡ 23:59 (server tắt): khi chạy lại, nếu bảng đã có dữ liệu, thiếu bản chụp của hôm qua và giờ VN < 12:00 thì chụp bù và gán `snapshot_date` = hôm qua (`captured_at` là thời điểm thật). Qua 12:00 thì để trống ngày đó.
- Đọc qua `GET /api/inventory-value-history?from=&to=` (quyền `reports.overview`, lọc theo cơ sở đang xem); bảng chưa tồn tại (chưa áp migration) thì API trả rỗng.

### Chi tiết hóa đơn 90 ngày theo khách (migration `0022`)

`customer_invoice_lines_90d` là bảng tổng hợp phục vụ "Báo cáo doanh thu theo khách" (tab Khách hàng, `GET /api/customer-product-revenue`). Mỗi dòng là **1 dòng chi tiết hóa đơn** (`invoice_details`) của hóa đơn `Hoàn thành` đã gắn sẵn mã khách, **cộng thêm các dòng ÂM của phiếu trả `Đã trả`** (`return_details`, theo ngày trả, `invoice_id = -returns.id`, `invoice_code` = mã phiếu trả) để doanh thu/số lượng theo khách là số ròng; sau khi đổi logic này cần chạy lại `node kiotvietSync/customerInvoiceLinesRefresh.js` một lần (job đêm chỉ dựng 1 lần/ngày); khóa chính `(branch, invoice_id, line_no)`, index tra cứu `(branch, customer_code)`. Không có `raw` (không phải bản sao 1-1 từ KiotViet). `customer_invoice_lines_state` chỉ có 1 dòng (`id = 1`): cửa sổ `window_start..window_end`, `row_count`, `computed_at`; dòng này chưa tồn tại nghĩa là bảng **chưa từng được dựng** và API tự quay về cách tính cũ từ sheet.

- Được dựng lại **1 lần/đêm** bởi `server/kiotvietSync/customerInvoiceLinesRefresh.js` (kiểm tra mỗi 5 phút, chỉ chạy khi chưa dựng cho ngày VN hôm nay **và** đã qua 00:10 VN để hóa đơn cuối ngày kịp đồng bộ; khởi động lại giữa ngày mà bảng cũ từ hôm qua thì dựng bù ngay). Cũng chạy tay được: `node kiotvietSync/customerInvoiceLinesRefresh.js` (trong `server/`).
- Cửa sổ là 90 ngày kết thúc **hôm qua** theo lịch VN (khác luồng sheet cũ, cửa sổ kết thúc hôm nay) nên hóa đơn phát sinh trong ngày chỉ hiện từ đêm sau; giao diện ghi rõ "90 ngày đến hết dd/mm/yyyy".
- Không `TRUNCATE` + nạp lại: nạp vào bảng tạm rồi chỉ `DELETE` dòng đã mất/đã đổi và `INSERT` dòng mới, trong 1 giao dịch (lý do IO: xem sự cố Supabase 2026-09-28). Đọc song song vẫn thấy bản cũ tới lúc COMMIT.
- `customer_code` giữ đúng luồng cũ: `raw->>'customerCode'` trên hóa đơn; nếu trống thì đối chiếu **tên khách chuẩn hóa** (NFKC, bỏ ký tự rỗng, gộp khoảng trắng, chữ thường) với bảng `customers` cùng cơ sở (trùng tên ⇒ mã lớn nhất). Bước đối chiếu theo SĐT của luồng cũ không còn vì cột "SĐT khách" của tab Hóa đơn luôn rỗng trong Postgres.
- `sold_date` theo "giờ treo tường VN mang nhãn UTC" của `purchase_date`; `revenue` dùng `DETAIL_AMOUNT_SQL` (`subTotal` nếu có, không thì giá × SL − giảm giá); `item_code`/`item_name` lưu giá trị thô, phía đọc tự trim và thay bằng `—` khi trống.
- Không REVOKE SELECT khỏi `reporting_readonly` (không lưu SĐT; mã/tên khách và doanh thu vốn đã đọc được qua `invoices`/`customers`).

### Trả NCC upload Excel (migration `0017`)

`supplier_return_imports` là bảng phẳng lưu dữ liệu xuất từ KiotViet ("Trả hàng nhập") do người dùng tự upload file Excel. Không có quan hệ parent+detail như `invoices`/`purchases`.

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `branch` | TEXT | `hanoi`/`saigon` |
| `product_code` | TEXT | Mã hàng KiotViet |
| `product_name` | TEXT | Tên hàng tại thời điểm import |
| `return_date` | DATE | Ngày trả |
| `quantity` | NUMERIC | Số lượng trả |
| `imported_at` | TIMESTAMPTZ | Thời điểm import |
| `imported_by` | TEXT | Tên/username người thực hiện upload |
| `source_file` | TEXT | Tên file Excel nguồn |

- Mỗi lần upload cho 1 cơ sở **thay thế toàn bộ** dữ liệu cũ của cơ sở đó (`DELETE` rồi `INSERT` lại — xem `supplierReturnImportService.js`).
- Index `(branch, product_code, return_date)` phục vụ pipeline kiểm tra đứt hàng (`stockoutPgSource.js`).
- Không REVOKE SELECT khỏi `reporting_readonly` (không chứa PII, tương tự `purchases`/`returns`).

### Phân quyền tính năng theo tài khoản (migration `0019`–`0020`)

**Migration `0019`**: Bổ sung vai trò `Nhân viên marketing` vào constraint CHECK `app_users.vai_tro`. Constraint cũ bị DROP và tạo lại với danh sách đầy đủ: `Quản lý`, `Kế toán`, `Trưởng kho`, `Trợ lý`, `Lái xe`, `Nhân viên kho`, `Nhân viên sale`, `Nhân viên marketing`, `Nhân viên mua hàng`, `Khách`.

**Migration `0020`**: Thêm cột `app_users.feature_permissions JSONB NOT NULL DEFAULT '{}'` để lưu **delta** quyền tính năng so với mặc định của vai trò. Ví dụ `{"reports.debt": false, "reports.overview": true}`. Logic phân quyền thực tế nằm ở `server/auth/featureRegistry.js` — bảng chỉ lưu phần override cá nhân, không snapshot toàn bộ quyền của vai trò.

### Dọn dẹp suppliers và rollup mua hàng (migration `0026`)

Gỡ bỏ tab "Nhà cung cấp" khỏi dashboard:
- `DROP TABLE IF EXISTS daily_purchase_summary;`
- `DROP TABLE IF EXISTS suppliers;`
- Xóa bản ghi tiến độ trong `sync_checkpoints` và `backfill_progress` với `entity = 'suppliers'`.
- Các bảng `purchases`, `purchase_details`, `product_first_purchase` vẫn được giữ nguyên để phục vụ tab Hàng hóa và cảnh báo đứt hàng.

### Quản lý tài liệu quy định công ty (migration `0027`)

Bảng `hr_rule_documents` lưu trữ tài liệu quy định công ty (cả tài liệu dựng sẵn và file PDF upload):
- `kind`: `builtin` (dựng sẵn, `builtin_key` NOT NULL, `content` NULL) hoặc `pdf` (tài liệu tải lên, lưu trong `content` BYTEA).
- Gồm `title`, `sort_order`, `file_name`, `size_bytes`, `sha256`, `uploaded_by_user_id`, `uploaded_by_name`.
- Seed 2 tài liệu mặc định: `gio-giac` (Giờ giấc làm việc, sort 10) và `nghi-phep` (Quy định nghỉ phép, sort 20).
- Thu hồi quyền `SELECT` của `reporting_readonly` do chứa tài liệu nội bộ.

### Chỉ mục đơn Phiếu tạm cho Vòng đời đơn hàng (migration `0028`)

`idx_orders_phieu_tam` là chỉ mục **một phần** `ON orders (branch, id) WHERE raw->>'statusValue' = 'Phiếu tạm'`. Trang Vòng đời đơn hàng (`shipment/kiotOrdersRepository.js`) đọc dòng hàng của mọi đơn Phiếu tạm của Kiot HN + SG (~1.000 đơn, ~2.500 dòng hàng ở thời điểm 2026-10-01); bảng `orders` có ~46K dòng JSON lớn nên không có chỉ mục thì mỗi lần đọc nguội mất vài giây (đo ~4 giây, vì quét tuần tự). (Từ 2026-10-02 trang còn đọc **đầu đơn của mọi trạng thái** ~60K dòng bằng một truy vấn quét toàn bảng ~2 giây — truy vấn đó không dùng được chỉ mục này nên được cache 2 phút thay vì lọc ở DB.) Điều kiện `WHERE` của truy vấn phải giữ **y hệt** biểu thức trên (so chuỗi `statusValue`, không so số `status`) thì planner mới chọn được chỉ mục. Code chạy đúng cả khi chưa áp migration, chỉ chậm hơn; kết quả đọc được cache 60 giây trong tiến trình.

### Gỡ trạng thái "Tạm duyệt" của đơn nghỉ phép (migration `0030`)

`0030_drop_leave_provisional_status.sql` chuyển mọi đơn `hr_leave_requests.trang_thai = 'Tạm duyệt'` về `Chưa duyệt` (trigger sẵn có tự tăng `decision_version` và xóa `decision_notified_at` nên bot quản lý/nhân viên nhận lại đúng trạng thái), rồi đặt lại CHECK `hr_leave_requests_trang_thai_check` chỉ còn `Chưa duyệt`, `Đã duyệt`, `Từ chối`, `Vi phạm`. Mã web và bot quản lý đã bỏ `Tạm duyệt` khỏi danh sách hợp lệ nên migration phải áp **trước** khi chạy bản web mới. Bot xin nghỉ ngoài repo không được ghi giá trị này nữa.
