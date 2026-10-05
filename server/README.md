# TOKOSI Dashboard Server

Express backend cho dashboard TOKOSI.

## Nguồn dữ liệu

- Vị trí hàng: workbook `STOCK_LOCATIONS_SPREADSHEET_ID`, hai sheet HN/SG dùng chung, chỉ đọc bằng service account. Module `stockLocations/` phục vụ `GET /api/stock-locations?branch=HN|SG`; frontend `/stock-locations/` hiển thị 6 cột (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí), phân trang 100 dòng và tìm mã/tên/vị trí không dấu. Quyền `stockLocations.view` mặc định cho nhân viên, cấm cấp cho Khách. Không migration/job/tải định kỳ. Xem [thiết lập nguồn và nghiệm thu](../docs/stock-locations-setup.md).

- KiotViet dashboard: Supabase PostgreSQL qua `dashboard/dashboardPgReader.js`.
- CN1/CN3/CN7: bảng `customer_debt_activity_periods` trong Supabase (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7).
- Trả NCC: người dùng tự upload file Excel xuất từ KiotViet; server nạp vào bảng Postgres `supplier_return_imports` (migration `0017`) — **không còn đọc tab Google Sheets Trả NCC**.
- Công nợ quản lý: workbook `DEBT_MANAGEMENT_SPREADSHEET_ID` (Google Sheets, chỉ đọc).
- Nhân sự và nghỉ phép: toàn bộ ở Postgres — danh sách nhân sự `hr_employees` (migration `0009`), 3 bảng nền nghỉ phép/Telegram (`hr_leave_requests`, `hr_telegram_links`, `hr_telegram_sessions`, migration `0016`), 5 bảng bot quản lý (migration `0029`) và tài liệu quy định `hr_rule_documents` (migration `0027`). Các biến `HR_SPREADSHEET_ID*` đã gỡ khỏi `config.js` (2026-10-05); `sheets/hrSheetsClient.js` là mã chết chờ xóa tay.
- Vòng đời đơn hàng: danh sách đơn = **mọi đơn đặt hàng KiotViet** trong Postgres (bảng `orders`), ghép theo (cơ sở, mã đơn) với Google Sheets workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (`DonHang_HN`, `DonHang_SG` cấp trạng thái vòng đời; tab `Lịch sử cập nhật` do server ghi khi Quản lý ghi đè trạng thái).
- Tài khoản và Telegram ID: PostgreSQL `app_users`; không dùng tab `Users` hoặc `_HR_TELEGRAM_LINKS` để liên kết. Xem mục "Tài khoản, đăng ký và ID Telegram" bên dưới.

Không còn Apps Script KiotViet. Đã gỡ bỏ tính năng vận chuyển cũ (chỉ giữ lại tính năng vòng đời đơn hàng).

## API báo cáo tổng hợp theo tab

`GET /api/dashboard?view=<tab>` chỉ đọc/tính/trả phần của **một tab** (`overview`, `products`, `invoices`, `customers`, `debt`; có thể ghép nhiều tab bằng dấu phẩy). Trang `/reports/` gọi khi người dùng mở từng tab, mỗi tab kèm đúng bộ lọc của nó; bỏ trống `view` = cả 5 tab như trước (giữ tương thích).

- Khai báo tab (bảng nguồn, rollup, bộ lọc, phần payload) ở `dashboard/dashboardViews.js`; cache bảng nguồn theo từng bảng + cache kết quả theo (cơ sở, tab, bộ lọc của tab) ở `dashboard/dashboardData.js`.
- Tab tài khoản không có quyền xem trả `{ "filters": {}, "kpi": {} }` (không đọc/tính gì); tên tab sai trả 400 `INVALID_VIEW`.
- Thêm/đổi trường payload của một tab: sửa `VIEW_PAYLOAD` trong `dashboardViews.js` (test "tung tab: payload y het lat cat cua ban day du" sẽ báo nếu tab không tính đủ trường đã khai báo).

## API chi tiết chứng từ

`dashboard/documentDetailRepository.js` cung cấp loader cho popup chi tiết khi bấm vào dòng bảng "Chi tiết giao dịch" (tab Hóa đơn):
- `GET /api/invoice-detail?code=<mã>&branch=<cơ sở>` — hóa đơn + dòng hàng + thanh toán

Mã chứng từ chỉ duy nhất trong 1 cơ sở, nên `branch` bắt buộc khi đang xem "Cả hai"; ở chế độ 1 cơ sở có thể bỏ trống.

Từ 2026-10-01 hai bảng "Danh sách đặt hàng" / "Danh sách trả hàng" của tab Hóa đơn đã bỏ, cùng `GET /api/order-detail` và `GET /api/return-detail`. Đơn đặt hàng "Phiếu tạm" của KiotViet nay theo dõi ở trang Vòng đời đơn hàng và xem chi tiết bằng `GET /api/shipment/lifecycle/order-detail` (phần dưới); `getOrderDetail` của repository vẫn được trang đó dùng lại.

## Vòng đời đơn hàng hợp nhất đơn KiotViet (mọi trạng thái)

`GET /api/shipment/lifecycle` (quyền `shipment.lifecycle`) trả **một trang** `{ orders, page, pageSize, totalPages, total, filteredTotal, kiotStatuses, kiot }`. Nguồn dòng = **mọi** đơn đặt hàng của Kiot HN + SG (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) ghép với Google Sheet theo `(cơ sở, mã đơn)` — cùng mã DH có thể tồn tại ở cả hai cơ sở nên không được ghép theo mã trần. Đơn có trên sheet giữ trạng thái vòng đời của sheet; đơn chỉ có ở Kiot nhận trạng thái thấp nhất `NOT_SENT` ("Đơn chưa gửi kế toán"), `source: 'kiotviet'`, **không** ghi đè trạng thái được; dòng sheet không khớp đơn Kiot nào bị bỏ khỏi bảng. Mỗi dòng có `kiotStatus` (trạng thái trên Kiot), `note` (ghi chú của đơn), `orderTotal`, `orderDate`, và `sellableValue` (chỉ đơn Phiếu tạm, còn lại `null`). Postgres lỗi → `kiot.ok = false` và trang vẫn trả đơn sheet kèm cảnh báo. Từ 2026-10-03 Tra cứu theo mã (`shipment.lookup`), Lịch sử (`shipment.history`), Xuất Excel (`shipment.export`) và Ghi đè trạng thái (`shipment.override`, mặc định chỉ Quản lý) **gắn vào `shipment.lifecycle`** (`requires` trong `featureRegistry.js`): thiếu Vòng đời đơn hàng thì các quyền này bị loại dù có cấp riêng; Khách/NV kho/marketing/mua hàng không còn trang này. Các API tra cứu vẫn chỉ đọc sheet.

Query string (đều tùy chọn; giá trị sai → 400 kèm mã): `branch` (HN|SG), `status` (trạng thái vòng đời), `kiotStatus`, `dateField` (saleSentAt|at|orderDate) + `from`/`to` (YYYY-MM-DD), `mode` (code|sale|customer) + `q`, `sort` (orderCode, orderDate, saleName, customerName, orderTotal, sellableValue, note, saleSentAt, kiotStatus, status, at, warning) + `dir` (asc|desc), `page`, `pageSize` (mặc định 100, tối đa 200). Không chọn `sort` → đơn mới đặt nhất trước. Logic lọc / sắp xếp / cắt trang nằm trong `shipment/orderLifecycleQuery.js` (hàm thuần, kết quả lọc + sắp xếp được cache để lật trang không sắp xếp lại); danh sách đã gộp được dùng lại giữa các request khi dữ liệu nguồn không đổi (khóa có cả phút hiện tại vì cảnh báo quá 24h phụ thuộc đồng hồ). Trình duyệt chỉ nhận 1 trang (~8 KB) thay vì cả danh sách.

- `shipment/kiotOrdersRepository.js` — đọc đầu đơn của mọi trạng thái (một truy vấn ~2 giây, ~17 MB JSON thô) + dòng hàng **chỉ của đơn Phiếu tạm** + tồn thực của **đúng cơ sở của đơn**, rồi tính **Giá trị có bán** = Σ từng mặt hàng `min(SL đặt, max(0, tồn kho)) × đơn giá sau chiết khấu` (bỏ dòng mã `VAT*`; cùng mã hàng xuất hiện nhiều dòng thì gộp trước khi lấy min). Từ 2026-10-02 **không còn cộng hàng đang vận chuyển** vào số lượng có bán. Cache 2 phút kiểu stale-while-revalidate (hết hạn → trả ngay bản cũ và làm mới nền; lỗi → bản cũ đánh dấu `stale`, thử lại sau 15 giây; quá 15 phút mới chờ đọc lại).
- `GET /api/shipment/lifecycle/order-detail?code=<mã>&branch=HN|SG` — chi tiết đơn + từng dòng hàng kèm tồn kho / **Điều chuyển SG** (hàng đang vận chuyển, `dashboard/inTransitSource.js`; chỉ để tham khảo, không tính vào có bán) / có bán (404 `ORDER_NOT_FOUND`, 400 `INVALID_CODE` / `INVALID_BRANCH`).
- `POST /api/shipment/lifecycle/export` (quyền `shipment.export`, mặc định **chỉ Quản lý**) nhận **chính bộ tham số lọc / sắp xếp** của `GET /` (không cần `page`) và xuất **mọi dòng khớp**, tối đa 20.000 dòng (vượt → 400 `TOO_MANY_ROWS`; 60.000 dòng chặn máy chủ ~7 giây). File có thêm cột Ghi chú và Trạng thái KiotViet.
- Tên sale lấy từ Kiot có dạng `<tên> - <ID Telegram>`: `dashboard/saleName.js` (`stripTelegramId` / `saleNameSql`) bỏ hậu tố ID ở mọi nơi hiển thị (chỉ đổi hiển thị, dữ liệu gốc giữ nguyên).
- Công thức **Tồn có thể bán** dùng chung toàn dashboard: `Tồn thực tế − Đặt hàng Phiếu tạm (Khách đặt) + Hàng đang vận chuyển` (bảng "Cơ cấu tồn kho" tab Hàng hóa, bảng "Báo cáo hàng hóa" tab Tổng quan do job đêm `kiotvietSync/productReportRefresh.js` dựng, và các file xuất tương ứng).

## Bot Telegram quản lý nghỉ phép

Bot riêng cho quản lý chạy cùng tiến trình Express; `telegram/managerLeaveRuntime.js` quét Postgres theo chu kỳ mặc định 5 giây, xử lý sự kiện mới do bot xin nghỉ bên ngoài ghi trực tiếp và thử lại công việc giao tin còn tồn. `telegram/managerLeaveWebhook.js` nhận `POST /api/telegram/manager-leave/webhook`, kiểm tra header `X-Telegram-Bot-Api-Secret-Token` trước khi nhận cập nhật. Gọi Telegram API bằng native `fetch`, không thêm thư viện bot. `@electric-sql/pglite` chỉ là devDependency phục vụ kiểm thử SQL/migration.

- Gửi mọi đơn **Xin nghỉ phép** mới, kể cả trạng thái `Vi phạm`; lần quét đầu bù các đơn `Chưa duyệt` chưa giao cho quản lý phù hợp. Bản ghi **Tự ý nghỉ (HR ghi nhận)** không gửi qua bot quản lý. Mốc `first_enabled_at` bền vững loại lịch sử đã kết thúc trước khi bật bot lần đầu; đơn mới tạo sau mốc này vẫn được gửi với quyết định hiện tại nếu web đã duyệt trước khi lượt quét xử lý.
- Người nhận phải có vai trò **Quản lý**, trạng thái hoạt động, Telegram ID và quyền `hr.leave.manage`. `coSo = Hà Nội` chỉ nhận Hà Nội, `Sài Gòn` chỉ nhận Sài Gòn, `Cả hai` nhận cả hai; cơ sở rỗng bị loại. Đây là phạm vi bot, không thay đổi bộ lọc xem cơ sở trên web. Mỗi quản lý phải bấm **Start** với bot mới dù ID đã có trong database.
- Tin nhắn chỉ có hai nút quyết định: **Phê duyệt** (lưu `Đã duyệt`) và **Từ chối**; callback `Chưa duyệt`/`Vi phạm` của tin cũ bị từ chối. Đơn có thể ở 4 trạng thái `Chưa duyệt`, `Đã duyệt`, `Từ chối`, `Vi phạm` (đã gỡ `Tạm duyệt` ở migration `0030`). Chọn từ chối mở phiên nhập lý do: chỉ nhận reply đúng tin nhắn nhắc nhập, trim, tối đa 500 ký tự; có **Bỏ qua** hoặc **Hủy**, hết hạn sau 15 phút.
- `Đã duyệt`/`Từ chối` khóa tiếp thao tác Telegram cho mọi quản lý. Web vẫn sửa được; chuyển về trạng thái khác mở lại thao tác Telegram. Phiên bản `decision_version` chống nút cũ và quyết định đồng thời; mọi quyết định đi qua `hr/hrLeaveDecisionService.js`. Các tin nhắn đã gửi được cập nhật theo kết quả mới.
- `hr/hrLeaveDbRealtime.js` đưa thay đổi DB vào SSE HR, dùng bản chụp/phiên bản dùng chung thay vì cursor thứ tự event. Kết nối hoặc kết nối lại SSE làm mới danh sách. Công tắc cầu này độc lập với công tắc bot.
- Bot xin nghỉ bên ngoài vẫn sở hữu `hr_telegram_links`/`hr_telegram_sessions` và báo kết quả cho nhân viên bằng `decision_notified_at`; bot quản lý không tiêu thụ hay đánh dấu cột đó.

| Biến | Mặc định / mục đích |
|---|---|
| `HR_MANAGER_TELEGRAM_ENABLED` | `false`; bật bot quản lý |
| `HR_MANAGER_TELEGRAM_BOT_TOKEN` | Token **bot mới**, giữ kín |
| `HR_MANAGER_TELEGRAM_WEBHOOK_SECRET` | Secret dùng lúc đăng ký webhook và kiểm tra header Telegram |
| `HR_MANAGER_TELEGRAM_WEB_URL` | HTTPS origin công khai của dashboard |
| `HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS` | `5000` ms |
| `HR_LEAVE_DB_REALTIME_ENABLED` | `true`; cầu Postgres → SSE HR |

**Migration trước khi chạy bản web mới:** `npm run db:migrate` áp `0029_hr_manager_telegram.sql`; bản web mới đọc `decision_version` cả khi `HR_MANAGER_TELEGRAM_ENABLED=false`. Sau khi cấu hình và khởi động server, đăng ký webhook bằng `npm run telegram-manager:set-webhook`. Chi tiết ở [hướng dẫn thiết lập](../docs/telegram-manager-leave-setup.md) và [kế hoạch đã duyệt](../docs/superpowers/plans/2026-10-02-telegram-manager-leave.md).

Thông báo gần thời gian thực cần máy chủ chạy liên tục. Khi máy chủ ngủ/tắt, quét và giao tin dừng; công việc bền vững được xử lý lại khi máy chủ hoạt động. Tắt `HR_MANAGER_TELEGRAM_ENABLED` để dừng bot quản lý, vẫn giữ migration, luồng duyệt web và bot xin nghỉ cũ.

## Tài khoản, đăng ký và ID Telegram

- **Tự đăng ký bị khóa từ 2026-10-03** (`ALLOW_SELF_REGISTRATION`, mặc định tắt): `POST /api/auth/register` trả 403 `REGISTRATION_DISABLED` (luồng đăng ký nhân sự bằng OTP `/register/channels`, `/register/send-otp`, `/register/verify` đã gỡ 2026-10-05); đăng nhập Google chỉ liên kết/đăng nhập tài khoản **đã có** (`linkVerifiedGoogleIdentity` với `allowCreate=false`) và không tạo Khách mới. Admin cứng (`HARDCODED_ADMINS`) luôn đăng ký/đăng nhập được. `GET /api/auth/google-config` trả `{ clientId, registrationOpen }` để trang login/register ẩn link và khóa form. Tài khoản mới do Quản lý tạo ở `/account/#users` (`POST /api/admin/users`).
- **ID Telegram** (chuỗi số nguyên dương ≤ 20 chữ số; rỗng = hủy liên kết): lưu qua `appUsersRepository.updateProfileRow` trong một giao dịch (khóa advisory theo ID; thu hồi liên kết `pending`/`linked` cũ, tạo liên kết `manual`, đồng bộ `hr_employees.telegram_id`). Trùng với tài khoản, liên kết bot hoặc nhân sự đang hoạt động khác → 409 `TELEGRAM_ID_EXISTS`. Chỉ **Quản lý** (hoặc admin cứng) được thêm/sửa — `POST /api/auth/profile` của vai trò khác trả 403 `TELEGRAM_ID_LOCKED` khi ID thay đổi (`GET /api/auth/profile` có `telegramEditable`); Quản lý đổi ID người khác qua `PUT /api/admin/users/:id` (đổi ID của Quản lý khác chỉ dành cho Quản lý cấp cao).
- **Email/SĐT đăng nhập** (từ 2026-10-05): `POST /api/auth/profile` chỉ đổi họ tên (+ ID Telegram nếu là Quản lý), không đổi email — gửi email khác email hiện tại thì tài khoản nhân sự (`hrManaged`) nhận 403 `EMAIL_CHANGE_LOCKED`, tài khoản thường nhận 409 `EMAIL_CHANGE_REQUIRES_OTP`. Email tài khoản nhân sự chỉ Quản lý đổi qua `PUT /api/admin/users/:id` (đồng bộ `hr_employees`). Tài khoản thường (Khách, nội bộ không gắn nhân sự) đổi email bằng OTP gửi tới email mới: `POST /api/auth/profile/contact-change` `{ field: 'email', value }` → `POST /api/auth/profile/contact-change/verify` `{ challengeId, otp }`; thành công đặt `verifiedEmail = true`, chỉ ghi `app_users`; giới hạn: 5 lần gửi mã/giờ, 10 lần nhập sai/giờ (tính qua mọi lần xin mã), 1 lần gửi đồng thời, và 20 yêu cầu/người dùng + 60/IP mỗi 10 phút cho cả 2 route — vượt thì 429 (`OTP_SEND_LIMIT`, `OTP_TOO_MANY_ATTEMPTS`, `OTP_IN_PROGRESS`, `RATE_LIMITED`, kèm `waitSeconds`); email mới khớp nhân sự đã có tài khoản khác, hoặc xung đột với SĐT hiện có → 409 không ghi; danh bạ nhân sự lỗi → 503. `POST /api/auth/recovery` chỉ đổi email khôi phục; body có `soDienThoai` → 400 `PHONE_CHANGE_NOT_ALLOWED` (SĐT chỉ Quản lý đổi ở trang quản trị). Tài khoản đã gắn một dòng nhân sự (`hr_employee_id`) không tự gắn sang dòng khác khi email/SĐT đổi — resolver giữ ràng buộc cũ và ghi log cảnh báo. Giao diện `/account/#profile` và hộp hồ sơ chung (`shared-nav.js`) hiển thị email chỉ đọc kèm gợi ý "liên hệ Quản lý" (TK nhân sự) hoặc "Đổi email" mở hộp OTP 2 bước (TK thường).
- **Trang quản trị người dùng** (`POST`/`PUT /api/admin/users`, từ 2026-10-05): không ai ngoài Quản lý cấp cao được đặt email/username/SĐT trùng định danh admin cứng (403 `PROTECTED_IDENTITY`); không tự đổi email/SĐT của chính mình qua trang này (403 `SELF_CONTACT_CHANGE`, trừ cấp cao); người không phải Quản lý không được tạo/sửa/nâng tài khoản mang bất kỳ định danh nào (email, SĐT, username) trùng nhân sự có vai trò cao hơn mức họ được cấp (403 `HR_ROLE_ESCALATION`; danh bạ lỗi → 503). Đổi email/SĐT tài khoản không gắn nhân sự đặt lại `verifiedEmail`/`verifiedPhone = false`; đổi liên hệ tài khoản nhân sự chỉ ghi sau khi mọi kiểm tra khác đã qua. Quản lý thường không đổi trạng thái (mọi giá trị, kể cả "Chờ duyệt") hay cơ sở của Quản lý khác.
- **Đăng nhập Google liên kết nhân sự**: chỉ tự liên kết vào tài khoản chưa gắn khi tài khoản đó khớp **theo email** với email Google; khớp chỉ qua SĐT/username, hoặc tài khoản đã gắn dòng nhân sự khác → 409 `HR_IDENTITY_CONFLICT`, không ghi gì. Quản lý tạo sẵn tài khoản cho nhân sự phải dùng đúng email của họ.
- **Phân quyền** nằm ở `auth/featureRegistry.js` (quyền mặc định theo vai trò + ghi đè riêng từng tài khoản trong `app_users.feature_permissions`, và `requires` cho quyền phụ thuộc). Nhóm: Báo cáo tổng hợp (`reports.*`), Quản lý đơn hàng (`shipment.*`), Vị trí hàng (`stockLocations.view`), Quản lý nhân sự (`hr.*`), Quản lý tài khoản (`account.*`), Hệ thống (`system.syncStatus`). `GET /api/auth/me` trả `permissions`, `pageFeatures`, `isSeniorAdmin`; `auth/pageGuard.js` chặn trang theo quyền.
- Đăng nhập: JWT cookie `tks_auth`; sai mật khẩu 5 lần khóa 5 phút; quên mật khẩu qua OTP 6 số hiệu lực 5 phút, tối đa 5 lần nhập, giãn cách gửi lại 60 giây, giới hạn 8 yêu cầu/10 phút theo định danh và 20/10 phút theo IP (`/api/auth/forgot-password/*`).

## Lệnh

```bash
npm install
npm run db:migrate
npm test
npm run dev
```

Các job đồng bộ:

```bash
npm run kiotviet-sync:preflight
npm run kiotviet-sync:backfill
npm run kiotviet-sync:reconcile
```

Khi `KIOTVIET_SYNC_ENABLED=true`, service chạy một lượt catch-up nền ngay lúc
khởi động từ checkpoint gần nhất, sau đó tiếp tục polling theo
`KIOTVIET_SYNC_FAST_INTERVAL_MS` và `KIOTVIET_SYNC_SLOW_INTERVAL_MS`.

Webhook KiotViet đi vào `POST /api/kiotviet/webhook/<KIOTVIET_WEBHOOK_SECRET>` (secret sai → 404; đường dẫn cũ không secret còn mở trong giai đoạn chuyển tiếp cho tới khi đặt `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false`). Server trả 200 ngay rồi đưa payload vào hàng đợi nền (`kiotviet/webhookEventQueue.js`); webhook chỉ lưu thô vào `webhook_events_raw`, dữ liệu nghiệp vụ do polling cập nhật. Trạng thái đồng bộ xem ở `GET /api/internal/kiotviet-sync/status` (quyền `system.syncStatus`).

| Nhóm / job | Nội dung | Nhịp |
|---|---|---|
| Polling **fast** | `invoices`, `orders`, `product_on_hands`, `product_on_hands_snapshot` (quét toàn bộ tồn kho, tối đa 10 phút/lần), `order_suppliers` (Đặt hàng nhập) | 7 phút, sau mỗi lượt tính lại ngay rollup "nóng" 7 ngày rồi phát SSE `dashboard-updated` |
| Polling **slow** | `categories`, `products`, `customers`, `returns`, `purchases` (đối soát toàn bộ từ mốc sàn đứt hàng 01/02/2026), `cash_flows` | 20 phút |
| Rollup đầy đủ | `daily_invoice_summary`, `daily_product_sales`, `product_first_purchase` (cửa sổ 400 ngày) | 30 phút |
| CN1/CN3/CN7 | `customerDebtReportRefresh.js` → `customer_debt_activity_periods` | 5 phút |
| Báo cáo hàng hóa | `productReportRefresh.js` → `product_report`, `product_report_customers` | kiểm tra mỗi 5 phút, tính **1 lần/đêm** |
| Chi tiết hóa đơn 90 ngày theo khách | `customerInvoiceLinesRefresh.js` → `customer_invoice_lines_90d` | kiểm tra mỗi 5 phút, dựng 1 lần/đêm sau 00:10 VN |
| Giá trị tồn kho | `inventoryValueSnapshot.js` → `inventory_value_snapshots` | kiểm tra mỗi phút, chụp lúc 23:59 VN |

Entity `suppliers` đã bỏ khỏi scheduler (migration `0026`); file `kiotvietSync/entities/suppliers.js` (+ test) còn lại trong repo nhưng không được nạp — mã chết chờ xóa tay.

## Cấu hình Sheets

Server **không còn đọc tab Trả NCC** từ Google Sheets HN/SG (đã chuyển sang upload Excel vào Postgres `supplier_return_imports`). Service account vẫn cần quyền:
- **Viewer** trên workbook `DEBT_MANAGEMENT_SPREADSHEET_ID` (Công nợ HN/SG).
- **Viewer** trên workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (tra cứu vòng đời đơn hàng — server đọc tab `DonHang_HN`, `DonHang_SG`; ghi tab `Lịch sử cập nhật` nên cần **Editor**).
- **Viewer** trên workbook `STOCK_LOCATIONS_SPREADSHEET_ID` (Vị trí hàng HN/SG, chỉ đọc).
- Workbook HR **không còn được đọc và không còn biến cấu hình** — danh sách nhân sự lấy từ Postgres `hr_employees`.

Hai file Kiot HN/SG **không còn** được server truy cập.

## Cấu hình Supabase

Đặt `SUPABASE_DB_URL`, sau đó chạy `npm run db:migrate`. Danh sách migration:

| Migration | Mục đích |
|---|---|
| `0001–0008` | Bảng master data, hóa đơn, đơn hàng, trả hàng, nhập hàng, cash flows, webhook raw, backfill progress |
| `0009` | `hr_employees` + `app_users` (tài khoản đăng nhập thay tab "Users" Sheets) |
| `0010` | Role `reporting_readonly` cho SQL client/BI |
| `0011` | `debt_collection_statuses` (trạng thái thu nợ) |
| `0012` | Đổi cột tiền/số lượng từ `BIGINT`→`NUMERIC` |
| `0013` | 4 bảng rollup Dashboard (`daily_invoice_summary`, `daily_product_sales`, `daily_purchase_summary`, `product_first_purchase`) — `daily_purchase_summary` đã bị xóa ở `0026` |
| `0014` | `customer_debt_activity_periods` — CN1/CN3/CN7 |
| `0015` | `app_users.telegram_id` |
| `0016` | 3 bảng nghỉ phép + bot Telegram (`hr_leave_requests`, `hr_telegram_links`, `hr_telegram_sessions`) |
| `0017` | `supplier_return_imports` — Trả NCC upload Excel thay tab Google Sheets |
| `0018` | `product_report` — báo cáo hàng hóa tổng hợp 2 cơ sở |
| `0019` | Thêm vai trò `Nhân viên marketing` vào CHECK `app_users.vai_tro` |
| `0020` | `app_users.feature_permissions JSONB` — phân quyền theo tính năng từng tài khoản |
| `0021` | Index ngày `invoices`/`purchases`/`returns` cho rollup Dashboard và làm mới công nợ 1/3/7 ngày |
| `0022` | `customer_invoice_lines_90d` + `customer_invoice_lines_state` — chi tiết hóa đơn 90 ngày gắn sẵn mã khách, dựng lại 1 lần/đêm cho báo cáo doanh thu theo khách |
| `0023` | `product_report_customers` — doanh số 90 ngày từng khách theo từng mã hàng, dựng cùng job đêm với `product_report` (khung "Chi tiết" của bảng Báo cáo hàng hóa) |
| `0024` | `order_suppliers`, `order_supplier_details` — phiếu "Đặt hàng nhập" (`/ordersuppliers`), migration `0024`, nhóm fast 7 phút, đối soát toàn bộ danh sách vì API bỏ qua `lastModifiedFrom` |
| `0025` | `inventory_value_snapshots` — giá trị tồn kho từng cơ sở theo ngày, chụp 23:59 giờ VN bởi `kiotvietSync/inventoryValueSnapshot.js` (biểu đồ "Giá trị tồn kho theo ngày", tab Tổng quan); chạy tay: `node kiotvietSync/inventoryValueSnapshot.js` |
| `0026` | DROP `daily_purchase_summary` và `suppliers`, dọn sync checkpoints/backfill của `suppliers` sau khi gỡ bỏ tab Nhà cung cấp khỏi dashboard |
| `0027` | `hr_rule_documents` — tài liệu "Quy định công ty" (2 tài liệu dựng sẵn `gio-giac`, `nghi-phep` + file PDF Quản lý tải lên lưu `BYTEA`, thu hồi SELECT của `reporting_readonly`); API `/api/hr/rules/documents*`, quyền `hr.rules` (xem) / `hr.rules.manage` (tải lên, gỡ, khôi phục mặc định); thêm/gỡ tài liệu báo lên chuông (`rule_document_added` / `rule_document_removed`) |
| `0028` | `idx_orders_phieu_tam` — chỉ mục một phần `orders (branch, id) WHERE raw->>'statusValue' = 'Phiếu tạm'` cho truy vấn đơn Phiếu tạm của trang Vòng đời đơn hàng (chưa áp chỉ mục code vẫn chạy đúng, chỉ chậm hơn: đo trên dữ liệu thật khi chưa có chỉ mục ~4 giây cho lần đọc nguội, các lần sau trong 60 giây dùng cache) |
| `0029` | `hr_leave_requests.decision_version` + `hr_leave_change_events`, `hr_leave_manager_messages`, `hr_manager_telegram_sessions`, `hr_manager_telegram_updates`, `hr_manager_telegram_state` — bot riêng cho quản lý và cầu DB → SSE; phải áp trước khi chạy bản web mới, kể cả khi bot tắt |
| `0030` | Gỡ trạng thái `Tạm duyệt` của đơn nghỉ phép: đơn đang `Tạm duyệt` chuyển về `Chưa duyệt`, CHECK `hr_leave_requests_trang_thai_check` chỉ còn `Chưa duyệt`/`Đã duyệt`/`Từ chối`/`Vi phạm`; áp trước khi chạy bản web mới |

Bot **xin nghỉ của nhân viên** chạy ngoài repo và đọc/ghi 3 bảng nền nghỉ phép trực tiếp; bot **quản lý** trong `telegram/` dùng chung đơn và sở hữu các bảng bổ sung ở migration `0029`. Hợp đồng dữ liệu ở `db/SCHEMA.md`.

## Cập nhật gần nhất

2026-10-05 — Rà soát toàn bộ tài liệu theo code (HEAD `11751c4`): thêm mục Tài khoản/đăng ký/ID Telegram, migration `0030`, sửa lỗi bảng migration (trùng `0027`), bỏ mô tả workbook HR (không còn dùng) và chỉnh nút duyệt của bot quản lý (chỉ Phê duyệt / Từ chối).

2026-10-02 — Bổ sung kiến trúc, cấu hình, migration và hướng dẫn vận hành bot Telegram riêng cho quản lý nghỉ phép. Việc bật production cần thực hiện các bước kiểm tra trong hướng dẫn thiết lập.
