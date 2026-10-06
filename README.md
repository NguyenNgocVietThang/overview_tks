# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Vị trí hàng** đọc trực tiếp hai sheet `VỊ TRÍ HN` / `Vị trí SG` của workbook `STOCK_LOCATIONS_SPREADSHEET_ID`. Trang `/stock-locations/` có hai tab theo cơ sở đang chọn, bảng 6 cột (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí) 100 dòng/trang, tìm mã/tên/vị trí không dấu và sort toàn bộ dữ liệu trước phân trang. Có nút hiện/ẩn cột, nhớ riêng điện thoại/máy tính; điện thoại ưu tiên Tên hàng, Tổng SL, Vị trí. Không xuất file hoặc tải định kỳ. Mọi vai trò nội bộ có quyền mặc định; Khách bị chặn hoàn toàn. Xem [cấu hình và nghiệm thu](docs/stock-locations-setup.md).

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhập hàng (chỉ phục vụ kiểm tra đứt hàng và "Hàng mới nhập"), phiếu **Đặt hàng nhập** (`order_suppliers`, cho "Hàng đang vận chuyển") và các bảng tổng hợp. Tab Nhà cung cấp đã gỡ (migration `0026`).
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Dữ liệu **Trả NCC** không còn đọc từ Google Sheets: người dùng tự upload file Excel xuất trực tiếp từ KiotViet, server nạp vào Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import) và dùng chung pipeline với Hóa đơn/Nhập hàng/Khách trả cho tính năng kiểm tra đứt hàng.
- CN1/CN3/CN7 (công nợ 1/3/7 ngày) được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng và Telegram ID được lưu trong PostgreSQL `app_users`; không còn tab `Users` hay luồng liên kết Telegram qua Google Sheets.
- Apps Script Kiot HN/SG và module vận chuyển cũ đã được nghỉ hưu hoàn toàn. Trang **Vòng đời đơn hàng** hiện lấy **mọi đơn đặt hàng KiotViet** (Postgres, ~60 nghìn đơn) làm danh sách chính và ghép với Google Sheet `ORDER_LIFECYCLE_SPREADSHEET_ID` để lấy trạng thái vòng đời/mốc thời gian; lọc, sắp xếp, phân trang chạy ở máy chủ. Các quyền Tra cứu theo mã, Lịch sử, Xuất Excel, Ghi đè trạng thái đều gắn vào quyền `shipment.lifecycle` (từ 2026-10-03).
- Nhân sự và nghỉ phép lưu PostgreSQL. Nhân viên có hồ sơ hoạt động gửi đơn từ web hoặc bot xin nghỉ ngoài repo; người được cấp quyền xử lý theo phòng ban/cơ sở. Quyền ghi nhận Tự ý nghỉ tách riêng. Migration `0031` bổ sung phạm vi, snapshot phòng ban và card Telegram. Xem [chức năng nâng cấp](docs/hr-leave-upgrade.md) và [thiết lập bot](docs/telegram-manager-leave-setup.md).
- **Tài khoản**: tự đăng ký tài khoản mới (form `/register`, đăng ký nhân sự qua OTP, Google tạo tài khoản lần đầu) **bị khóa từ 2026-10-03**; tài khoản mới do Quản lý tạo ở trang Quản lý người dùng. Đặt `ALLOW_SELF_REGISTRATION=true` để mở lại. ID Telegram chỉ **Quản lý** được thêm/sửa (hồ sơ cá nhân hiển thị chỉ đọc với vai trò khác).
- Cơ sở chỉ là **bộ lọc xem**: mọi tài khoản đều xem được Hà Nội, Sài Gòn và **`Cả hai`** trên thanh điều hướng; cơ sở gán cho tài khoản (`co_so`, để trống = `Cả hai`) chỉ là cơ sở **mặc định** lúc đăng nhập. Mọi bảng dữ liệu có cột **Cơ sở**. Ở `Cả hai`: hàng hóa và giao dịch cùng mã ở hai cơ sở là hai dòng riêng `(cơ sở, mã)`, khách gộp theo **tên** (mã khách khác nhau giữa hai cơ sở, không còn cột mã khách). Chỉ hàng **Đang kinh doanh** được tính, không còn bộ lọc trạng thái kinh doanh; đầu tab không còn thanh tìm kiếm chung (chỉ còn bộ lọc thời gian và tìm kiếm trong từng bảng). `Cả hai` chỉ là phạm vi xem — cột `branch` trong database vẫn chỉ nhận `hanoi`/`saigon` (xem `server/branch/branches.js`).

## Chạy local

```bash
cd server
npm install
copy .env.example .env
npm run db:migrate
npm test
npm run dev
```

Mở `http://localhost:3000`.

## Biến môi trường chính

| Biến | Mục đích |
|---|---|
| `SUPABASE_DB_URL` | PostgreSQL dùng cho dữ liệu KiotViet, tài khoản, nhân sự, nghỉ phép và workflow |
| `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` | KiotViet Hà Nội |
| `KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG`, `KIOTVIET_RETAILER_SG` | KiotViet Sài Gòn |
| `KIOTVIET_SYNC_ENABLED` | Công tắc chính của engine đồng bộ KiotViet → Supabase (mặc định tắt); kèm `KIOTVIET_SYNC_FAST_INTERVAL_MS` (7 phút), `KIOTVIET_SYNC_SLOW_INTERVAL_MS` (20 phút), `KIOTVIET_SYNC_ONHAND_SNAPSHOT_INTERVAL_MS` (10 phút) |
| `KIOTVIET_WEBHOOK_SECRET` | Bí mật gắn vào đường dẫn webhook `/api/kiotviet/webhook/<secret>`; đường dẫn cũ không secret tắt bằng `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false` |
| `SPREADSHEET_ID`, `SPREADSHEET_ID_SG` | Di sản — không còn module nào đọc (Trả NCC đã chuyển sang upload Excel vào Postgres `supplier_return_imports`); bỏ trống vẫn chạy được |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account Google (bắt buộc khi khởi động). Quyền Viewer cho Công nợ và Vị trí hàng; **Editor** cho workbook Vòng đời đơn hàng (ghi tab `Lịch sử cập nhật`) |
| `DEBT_MANAGEMENT_SPREADSHEET_ID` | Workbook công nợ dùng chung (chỉ đọc) |
| `STOCK_LOCATIONS_SPREADSHEET_ID` | Workbook vị trí hàng HN/SG dùng chung, chỉ đọc |
| `ORDER_LIFECYCLE_SPREADSHEET_ID` | Workbook vòng đời đơn hàng (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`) |
| `HR_SPREADSHEET_ID`, `HR_SPREADSHEET_ID_SG` | **Đã gỡ khỏi `config.js` và `.env.example` (2026-10-05)** — danh sách nhân sự nay ở Postgres `hr_employees`; biến còn trong môi trường cũ thì bỏ qua được |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Ký phiên đăng nhập (bắt buộc / mặc định `12h`) |
| `GOOGLE_CLIENT_ID` | Đăng nhập Google (tùy chọn; thiếu thì ẩn nút) |
| `ALLOW_SELF_REGISTRATION` | `true` để mở lại tự đăng ký tài khoản; mặc định khóa từ 2026-10-03 |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `SMTP_FROM_NAME` | Gửi email OTP (thiếu thì OTP ghi ra console) |
| `HR_MANAGER_TELEGRAM_ENABLED` | Bật bot riêng cho quản lý; mặc định `false` |
| `HR_MANAGER_TELEGRAM_BOT_TOKEN`, `HR_MANAGER_TELEGRAM_WEBHOOK_SECRET` | Token bot mới và secret xác thực webhook Telegram; giữ trong môi trường máy chủ |
| `HR_MANAGER_TELEGRAM_WEB_URL` | HTTPS origin công khai của dashboard, dùng cho webhook và nút mở web |
| `HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS` | Chu kỳ quét đơn/sự kiện trong Postgres; mặc định `5000` ms (giới hạn 1.000–60.000) |
| `HR_LEAVE_DB_REALTIME_ENABLED` | Cầu thay đổi Postgres → SSE của HR, mặc định `true`, độc lập với công tắc bot |
| `DASHBOARD_PREWARM` | Nạp sẵn cache nguồn lúc khởi động; mặc định bật, `false` để tắt |
| `PG_POOL_MAX` | Trần kết nối pool `pg` mỗi instance (mặc định 7; 2 × giá trị ≤ 15 của Supabase session pooler) |

Xem [server/.env.example](server/.env.example) để biết đầy đủ cấu hình.

## Cấu trúc chính

```text
server/
├── auth/                 # Tài khoản, phân quyền, OTP, Google OAuth
├── branch/               # Phân tách Hà Nội / Sài Gòn
├── dashboard/            # Tổng hợp dashboard (dashboardData + dashboardViews: API theo tab), xuất Excel/HTML, kiểm tra đứt hàng
│   ├── documentDetailRepository.js  # Chi tiết hóa đơn (popup bảng Chi tiết giao dịch) và chi tiết đơn đặt hàng (trang Vòng đời đơn hàng)
│   └── stockoutCheck/    # Engine kiểm tra đứt hàng + upload Trả NCC Excel
├── data/                 # Dữ liệu lưu trữ local (users.json, notifications.json, ...)
├── db/                   # Migration Supabase (0001–0033) + SCHEMA.md (hợp đồng schema)
├── hr/                   # Nhân sự, nghỉ phép tự gửi, phạm vi duyệt chung, tài liệu quy định và cầu Postgres → SSE
├── kiotviet/             # KiotViet API client và webhook receiver
├── kiotvietSync/         # Webhook, polling, backfill và rollup
├── lib/                  # Thư viện tiện ích nội bộ (TTL cache, ...)
├── notifications/        # Chuông thông báo + gửi email OTP
├── public/               # Frontend HTML/CSS/JS
├── scripts/              # Script thủ công (migrate dữ liệu, cài đặt ban đầu)
├── sheets/               # Google Sheets client (Công nợ, Vòng đời, Vị trí hàng, lưu ý `hrSheetsClient.js` là mã chết chờ xóa tay)
├── stockLocations/       # Đọc vị trí hàng HN/SG, ánh xạ cột và API chỉ đọc
├── shipment/             # Vòng đời đơn hàng: đơn KiotViet (Postgres) ghép Google Sheet, lọc/phân trang ở máy chủ
├── telegram/             # Bot quản lý nghỉ phép, webhook, giao tin bền vững + đăng ký webhook
├── index.js
└── routes.js
```

## Dữ liệu công nợ CN1/CN3/CN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Cập nhật gần nhất

2026-10-06 — Chuẩn bị dữ liệu Sổ quỹ: migration `0033` thêm tài khoản/trạng thái phiếu thu chi, danh mục tài khoản chung và lịch sử chốt số dư. Engine lấy danh mục từ cả HN/SG khi bảng trống lúc khởi động và mỗi 24 giờ. Migration đã kiểm thử trên DB nhúng local; chưa áp production.

2026-10-05 — Nâng cấp nghỉ phép/phân quyền phòng ban, form tự xin nghỉ web, Mini App từ chối Telegram và `/donnghi`; bảng người dùng chọn cột và mặc định tài khoản hoạt động. Áp migration `0031` trước ứng dụng mới. [Hợp đồng và nghiệm thu](docs/hr-leave-upgrade.md); chưa xác nhận production.

2026-10-05 — **Bảo mật hồ sơ/tài khoản**: `POST /api/auth/profile` chỉ đổi họ tên (+ ID Telegram nếu là Quản lý), **không đổi email** — gửi email khác email hiện tại thì tài khoản nhân sự (`hrManaged`) nhận 403 `EMAIL_CHANGE_LOCKED`, tài khoản thường nhận 409 `EMAIL_CHANGE_REQUIRES_OTP`. Email tài khoản nhân sự chỉ Quản lý đổi qua `PUT /api/admin/users/:id` (đồng bộ `hr_employees`); tài khoản thường (Khách, nội bộ không gắn nhân sự) đổi email bằng OTP gửi tới email mới (`POST /api/auth/profile/contact-change` `{ field: 'email', value }` → `/verify` `{ challengeId, otp }`, đặt `verifiedEmail = true`, chỉ ghi `app_users`; có giới hạn số lần gửi và nhập sai, vượt thì 429). `POST /api/auth/recovery` chỉ đổi email khôi phục — body có `soDienThoai` → 400 `PHONE_CHANGE_NOT_ALLOWED`; SĐT chỉ Quản lý đổi ở trang quản trị (sửa lỗi trước đó luôn 400 khi đổi SĐT tài khoản nhân sự). Tài khoản đã gắn một dòng nhân sự (`hr_employee_id`) không tự gắn sang dòng khác khi email/SĐT đổi: giữ ràng buộc cũ, ghi log cảnh báo. `/account/#profile` và hộp hồ sơ chung có ô email chỉ đọc, gợi ý "liên hệ Quản lý" (TK nhân sự) hoặc nút "Đổi email" mở hộp OTP 2 bước (TK thường). **Dọn API/payload không dùng**: gỡ `GET /api/search`, export `search.results`, `GET /api/customer-product-top`, `POST /api/auth/register/{channels,send-otp,verify}` (`POST /api/auth/register` vẫn 403 `REGISTRATION_DISABLED` khi khóa), `GET /api/hr/telegram/link-status`, `POST /api/shipment/lifecycle/lookup`; payload dashboard bỏ `kpi.revenueToday`/`invoicesToday`/`cancelledToday`/`activeProducts`/`inventoryValueCategoryCount`, bộ lọc `ov*` (Tổng quan dùng `in*`, không còn `filters.overview`), `invoices.returnsCount`/`totalReturns`/`periodGrossRevenue`, `stockByCategory`, `stockValueByCategory`, `newlyImported.topByRevenue`/`salesByCategory`/`countByCategory`; tab Hóa đơn không còn đọc bảng Trả hàng. Bộ lọc trạng thái bảng "Toàn bộ đơn hàng" (Vòng đời đơn hàng) thêm "Sự cố", "Đã hủy". Không cần migration. Tài liệu này không xác nhận đã deploy production.

2026-10-03 — **Tài khoản và ID Telegram**: tự đăng ký tài khoản mới (form `/register`, đăng ký nhân sự qua OTP, Google tạo tài khoản lần đầu) bị khóa — API trả 403 `REGISTRATION_DISABLED`, trang đăng nhập ẩn link đăng ký (`GET /api/auth/google-config` trả thêm `registrationOpen`); admin cứng vẫn đăng nhập/đăng ký được; mở lại bằng `ALLOW_SELF_REGISTRATION=true`. **ID Telegram** (`app_users.telegram_id`) nay lưu bằng một giao dịch duy nhất (`appUsersRepository.updateProfileRow`): đổi ID thì thu hồi liên kết bot cũ, tạo liên kết `manual` mới và đồng bộ `hr_employees.telegram_id`; ID trùng tài khoản/liên kết bot/nhân sự khác → 409 `TELEGRAM_ID_EXISTS`. Chỉ **Quản lý** (hoặc admin cứng) được thêm/sửa ID — hồ sơ cá nhân của vai trò khác hiển thị chỉ đọc (`telegramEditable` trong `GET /api/auth/profile`, ghi bị chặn 403 `TELEGRAM_ID_LOCKED`); Quản lý sửa ID người khác qua `PUT /api/admin/users/:id` (đổi ID của Quản lý khác chỉ cấp cao). Không cần migration.

2026-10-03 — **Phân quyền Vòng đời đơn hàng**: Tra cứu theo mã (`shipment.lookup`), Lịch sử (`shipment.history`), Xuất Excel (`shipment.export`) và Ghi đè trạng thái (`shipment.override`) khai báo `requires: 'shipment.lifecycle'` trong `featureRegistry.js` — thiếu Vòng đời đơn hàng thì các quyền này bị loại dù vai trò hay ghi đè có cấp; catalog quyền (`GET /api/admin/permissions/catalog`) trả thêm `requires` để form phân quyền hiển thị đúng. `Nhân viên kho` cũng không còn Vòng đời đơn hàng (cùng `Nhân viên marketing`, `Nhân viên mua hàng`); `Kế toán` không còn ghi đè trạng thái theo mặc định (chỉ Quản lý, cấp thêm được từng tài khoản); Khách không còn vào trang này. Mục sidebar "Vòng đời đơn hàng" chỉ hiện cho ai có `shipment.lifecycle`.

2026-10-03 — **Vị trí hàng**: thêm nhóm sidebar riêng, tab HN/SG theo bộ chọn cơ sở, bảng 6 cột thống nhất (Mã hàng, Tên hàng, Tổng SL, Ghi chú hàng hóa, Ngày về, Vị trí) và tìm kiếm mã/tên/vị trí không dấu; phân trang 100 dòng, chỉ đọc Google Sheets khi mở tab/tải lại. Quyền `stockLocations.view` mặc định cho mọi vai trò nội bộ; chặn Khách cả khi có ghi đè. Cần cấu hình `STOCK_LOCATIONS_SPREADSHEET_ID` và share Viewer cho service account; không cần migration. Tài liệu này không xác nhận đã deploy production.

2026-10-02 — **Nghỉ phép (web)**: gỡ trạng thái `Tạm duyệt` (migration `0030` chuyển đơn đang `Tạm duyệt` về `Chưa duyệt`; còn 4 trạng thái `Chưa duyệt`/`Đã duyệt`/`Từ chối`/`Vi phạm`); bảng nghỉ phép có phân trang chọn số dòng/trang; **lịch nghỉ phép** (biểu tượng lịch cạnh chuông thông báo ở mọi trang, cho tài khoản có `hr.leave`): chọn ngày để xem ai nghỉ buổi sáng/chiều/cả ngày, ẩn đơn bị từ chối. **Chạy `npm run db:migrate` (0030) trước khi chạy bản web mới** — mã đã bỏ `Tạm duyệt` khỏi danh sách trạng thái hợp lệ.

2026-10-02 — **Bot Telegram riêng cho quản lý nghỉ phép**: chạy trong Express qua `POST /api/telegram/manager-leave/webhook`, xác thực secret; quét Postgres mỗi 5 giây mặc định. Gửi các đơn `Xin nghỉ phép` mới và bù đơn `Chưa duyệt` chưa gửi; quản lý nhận theo cơ sở tài khoản, phải có Telegram ID và bấm **Start** với bot mới. Chỉ có hai nút Phê duyệt (lưu Đã duyệt) và Từ chối; `Đã duyệt`/`Từ chối` khóa thao tác Telegram, web vẫn đổi trạng thái và mở lại được. Migration `0029_hr_manager_telegram.sql` thêm `decision_version` và 5 bảng cho sự kiện, giao tin, phiên từ chối, inbox cập nhật và mốc bật bot lần đầu; **chạy migration trước khi chạy bản web mới, kể cả khi bot tắt**. Bot xin nghỉ cũ tiếp tục dùng `decision_notified_at` để báo nhân viên. Xem [kế hoạch đã duyệt](docs/superpowers/plans/2026-10-02-telegram-manager-leave.md) và [thiết lập/vận hành](docs/telegram-manager-leave-setup.md); tài liệu này không xác nhận đã triển khai production.

2026-10-02 — **Phân quyền Nhân viên sale**: mặc định xem đủ 5 tab báo cáo (Tổng quan, Hàng hóa, Hóa đơn, Khách hàng, Quản lý công nợ) thay vì chỉ Tổng quan (`REPORT_VIEW_ROLES` trong `featureRegistry.js`); Xuất Excel báo cáo và sửa trạng thái công nợ vẫn chỉ Quản lý + Trợ lý. Mục Kiểm tra đứt hàng / Trả NCC của tab Tổng quan chỉ hiện khi có quyền Hàng hóa (`reports.products`) — rút quyền này thì mục bị ẩn.

2026-10-02 — **Vòng đời đơn hàng: lấy mọi đơn Kiot, cột Trạng thái KiotViet / Ghi chú, công thức có bán mới, ẩn/hiện cột, xuất file chỉ Quản lý**: bảng "Toàn bộ đơn hàng" nay gồm **mọi đơn đặt hàng của Kiot HN + SG ở mọi trạng thái** (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) — dòng Google Sheet không khớp đơn Kiot nào (theo cơ sở + mã) không hiện, sheet chỉ cấp mốc thời gian / trạng thái vòng đời. Thêm cột **Trạng thái KiotViet** + bộ lọc "Trạng thái KiotViet" (mặc định *Tất cả*; bộ lọc trạng thái chính vẫn còn) và cột **Ghi chú** (mô tả đơn trên Kiot) ngay bên phải "Giá trị có bán". **Giá trị có bán** đổi quy tắc: số lượng có bán = `min(SL đặt, tồn kho)` (không còn cộng hàng đang vận chuyển), thành tiền = số lượng có bán × đơn giá; chỉ đơn Phiếu tạm có giá trị này, "Giá trị đơn" thì có với mọi đơn Kiot. Cột "Đang vận chuyển" ở bảng hàng hóa trong đơn đổi tên **"Điều chuyển SG"** (chỉ để tham khảo). Nút **"Cột hiển thị"** mở hộp tick ẩn/hiện cột (mặc định hiện hết; "Mã đơn" luôn hiện; nhớ theo trình duyệt). Vì bảng lớn nên **lọc / sắp xếp / phân trang chạy ở máy chủ** (`GET /api/shipment/lifecycle?branch&status&kiotStatus&dateField&from&to&mode&q&sort&dir&page&pageSize` trả 1 trang 100 dòng; module `shipment/orderLifecycleQuery.js`; mặc định đơn mới đặt nhất trước), cache đơn Kiot 2 phút kiểu *stale-while-revalidate*; module đọc Kiot đổi tên `shipment/kiotOrdersRepository.js`. **Xuất Excel** (`POST /api/shipment/lifecycle/export`) nay nhận **bộ lọc** thay vì danh sách mã, có thêm cột Ghi chú / Trạng thái KiotViet, tối đa 20.000 dòng mỗi lần (vượt → 400 `TOO_MANY_ROWS`), và quyền `shipment.export` mặc định **chỉ Quản lý** (Quản lý vẫn cấp thêm được cho từng tài khoản).

2026-10-01 — **Vòng đời đơn hàng hợp nhất đơn Phiếu tạm của KiotViet + cột "Giá trị có bán"**: trang Vòng đời đơn hàng nay hiện cả mọi đơn **Phiếu tạm** của Kiot HN + SG cùng các đơn trên Google Sheet, ghép theo (cơ sở, mã đơn) để không trùng: đơn có trên sheet lấy trạng thái của sheet, đơn chỉ có ở Kiot là **"Đơn chưa gửi kế toán"** (trạng thái thấp nhất; xem trực tiếp, không lưu bản sao, không ghi đè trạng thái được). Cột mới **Giá trị có bán** = Σ từng mặt hàng min(SL đặt, tồn thực Kiot của chính cơ sở của đơn + hàng đang vận chuyển) × đơn giá sau chiết khấu (bỏ dòng VAT); bấm dòng mở chi tiết đơn kèm bảng hàng hóa có tồn kho / đang vận chuyển / có bán của từng mặt hàng (`GET /api/shipment/lifecycle/order-detail?code=&branch=HN|SG`). Bảng phân trang 100 dòng/trang, sắp xếp theo toàn bộ danh sách đã lọc; file Excel xuất mọi dòng đã lọc và có thêm cột "Giá trị có bán". Module mới `shipment/kiotPendingOrdersRepository.js` (cache 60 giây; Kiot lỗi thì trang vẫn hiện đơn sheet kèm cảnh báo) và `dashboard/inTransitSource.js` (SQL "hàng đang vận chuyển" dùng chung). Migration `0028_orders_phieu_tam_index.sql` thêm chỉ mục một phần cho đơn Phiếu tạm — **cần `npm run db:migrate`** (không áp thì code vẫn chạy đúng, chỉ chậm hơn). *(Đã mở rộng sang mọi trạng thái đơn và đổi công thức ở mục 2026-10-02 phía trên; quyền gắn vào `shipment.lifecycle` từ 2026-10-03.)*

2026-10-01 — tab **Hóa đơn**: bỏ bảng "Danh sách đặt hàng", bảng "Danh sách trả hàng" và thẻ "Đặt hàng đang chờ" (thẻ "Trả hàng" cũng không còn hiển thị ở UI); gỡ `GET /api/order-detail`, `GET /api/return-detail`, bộ lọc `or*`/`rt*` và các nút xuất `invoices.orders`/`invoices.returns`; tab này không còn đọc bảng đặt hàng nên tải nhanh hơn. Đơn Phiếu tạm xem ở trang Vòng đời đơn hàng.

2026-10-01 — công thức **Tồn có thể bán = Tồn thực tế − Đặt hàng Phiếu tạm + Hàng đang vận chuyển** áp cho bảng "Cơ cấu tồn kho" (tab Hàng hóa, cả file xuất) và bảng "Báo cáo hàng hóa" (tab Tổng quan; job đêm `kiotvietSync/productReportRefresh.js` — **sau khi deploy chạy tay `node kiotvietSync/productReportRefresh.js` trong `server/` một lần**, nếu không số mới chỉ có sau lần tính đêm). Công thức cũ (tồn − Khách đặt, không cộng hàng vận chuyển) không còn dùng.

2026-10-01 — **Tên sale** lấy từ KiotViet có dạng `<tên> - <ID Telegram>` nay hiển thị chỉ còn `<tên>` ở mọi nơi (tab Hóa đơn, chi tiết hóa đơn, Vòng đời đơn hàng, file xuất Excel/HTML); module `dashboard/saleName.js`, chỉ đổi cách hiển thị — dữ liệu gốc trong DB giữ nguyên ID.

2026-10-01 — **Phân quyền**: **Nhân viên sale** xem được tab Tổng quan (mục Xu hướng, Báo cáo doanh thu theo khách, Báo cáo hàng hóa; ẩn mục Kiểm tra đứt hàng / Trả NCC; trang đích sau đăng nhập của Sale đổi sang `/reports/`) *(từ 2026-10-02 Sale xem đủ 5 tab, xem mục trên)*. **Quản lý** thường không còn đặt lại mật khẩu, đổi email/SĐT, hạ vai trò, rút quyền, khóa hay xóa tài khoản của **Quản lý khác** (vẫn làm được với nhân viên thường và chính mình); chỉ **Quản lý cấp cao** (tài khoản admin cứng) giữ đủ quyền như cũ — `server/auth/accountPolicy.js` (`checkProtectedManager`), `GET /api/auth/me` thêm `isSeniorAdmin`, trang Tài khoản ẩn các thao tác tương ứng.

2026-10-01 — **Cột thời gian sắp xếp đúng kiểu thời gian** (không còn so sánh chuỗi, nên `30/09` không còn đứng sau `01/10`) và trên toàn bộ dữ liệu đã lọc chứ không chỉ trang đang xem: bộ sắp xếp chung của dashboard đọc các ô `dd/MM/yyyy[ HH:mm[:ss]]`, `yyyy-MM-dd[ HH:mm[:ss]]` (Hàng mới nhập, Mã mới tạo, Ngày hết hàng…); "Chi tiết giao dịch" hiển thị giờ không có năm nên server trả thêm `timeMs`; trang Tài khoản sắp thứ tự mặc định theo ngày tạo thật.

2026-10-01 — **Doanh thu thực tế (đã trừ hàng trả lại)**: biểu đồ Doanh thu theo ngày, Top sản phẩm bán chạy, Báo cáo doanh thu theo khách và các KPI doanh thu cập nhật tính theo doanh thu thực tế sau khi trừ hàng khách trả lại (`returns` trạng thái `Đã trả`); rollup `daily_product_sales`, `customer_invoice_lines_90d`, `product_report` và `dashboardRollupRepository` đồng bộ trừ dòng hàng trả lại; giao diện tối ưu độ rộng cột bảng Báo cáo hàng hóa ("% Khách lớn").

2026-09-30 — **Gỡ tab "Nhà cung cấp"** khỏi Báo cáo tổng hợp: bỏ view `suppliers` (API `?view=`, quyền `reports.suppliers`, mục sidebar, các bảng/biểu đồ Hàng nhập + Nợ NCC, xuất `suppliers.list`/`overview.purchases`), bỏ đồng bộ entity `suppliers` và bước rollup `daily_purchase_summary`. Migration `0026` xóa bảng `suppliers` và `daily_purchase_summary` (giữ `purchases`/`purchase_details`/`product_first_purchase`/`order_suppliers` vì đứt hàng, "Hàng mới nhập" và "Hàng đang vận chuyển" vẫn dùng). **Deploy code trước, rồi mới `npm run db:migrate`** (bản code cũ còn đọc hai bảng này). Quyền `reports.suppliers` còn lưu trong `app_users.feature_permissions` được bỏ qua tự động.

2026-09-30 — **Popup chi tiết chứng từ**: bấm vào dòng bảng "Chi tiết giao dịch" / "Danh sách đặt hàng" / "Danh sách trả hàng" (tab Hóa đơn) mở hộp thoại giữa màn hình hiển thị đầy đủ dòng hàng, tổng tiền và phương thức thanh toán; nguồn từ module mới `dashboard/documentDetailRepository.js` (đọc trực tiếp `orders`/`returns`/`invoices` + `*_details` từ Postgres), route `GET /api/order-detail`, `GET /api/return-detail`, `GET /api/invoice-detail`. *(Từ 2026-10-01 chỉ còn popup hóa đơn: hai bảng Danh sách đặt hàng / Danh sách trả hàng cùng `GET /api/order-detail`, `GET /api/return-detail` đã gỡ.)*

2026-09-30 — biểu đồ cột chồng **Giá trị tồn kho theo ngày** (tab Tổng quan, mục 1 Xu hướng, dưới "Doanh thu theo ngày"): mỗi ngày một cột, chồng Hà Nội + Sài Gòn (chọn một cơ sở thì một màu), có bộ lọc Từ – Đến riêng, mặc định 7 ngày. Dữ liệu từ bảng mới `inventory_value_snapshots` (migration 0025), job `inventoryValueSnapshot.js` chụp 1 lần/ngày lúc 23:59 giờ VN (chụp bù sáng hôm sau trước 12:00 nếu server tắt), API `GET /api/inventory-value-history`. **Cần `npm run db:migrate` + restart trước 23:59 để có bản chụp đầu tiên; ngày trước khi bắt đầu không có số liệu.**

2026-09-30 — **Bộ lọc view theo cơ sở và độ rộng bảng cố định**: dashboard tải dữ liệu từng tab (`GET /api/dashboard?view=<tab>`) đã được tối ưu hóa tên view và đồng bộ cấu trúc layout; thêm CSS cố định độ rộng cột bảng (`fixed-table-widths.test.js`).

2026-09-30 — trang Quản lý nhân sự, tab **Quy định công ty**: tách tài liệu dựng sẵn thành "Giờ giấc làm việc" và "Quy định nghỉ phép" (đủ: cách xin nghỉ qua bot Telegram @nghipheptks_bot, nghỉ ≤ 03 ngày xin trước 22h00 hôm trước, nghỉ > 03 ngày xin trước ≥ 02 ngày, phạt 50.000đ/lần trễ hạn, tự ý nghỉ phạt 03 ngày lương); Quản lý (quyền mới `hr.rules.manage`) tải file PDF lên thành tab + nhánh con trong sidebar, gỡ được mọi tài liệu (kể cả dựng sẵn, có nút "Khôi phục tài liệu mặc định"); mọi tài liệu có nút "Tải về PDF"; thêm/gỡ tài liệu báo lên chuông thông báo của các tài khoản có quyền xem. PDF lưu Postgres (bảng `hr_rule_documents`, migration 0027 — chạy `npm run db:migrate` trong `server/`), API `/api/hr/rules/documents*`.

2026-09-29 — khung "Cơ cấu tồn kho" (tab Báo cáo hàng hóa): bỏ biểu đồ Top 15 và nút "Theo sản phẩm / Theo nhóm cha"; bảng "Chi tiết tồn kho theo sản phẩm" rộng toàn khung, thêm cột **Tồn có thể bán** (= Tồn kho − Khách đặt, không kẹp về 0 nên hàng bị giữ quá tồn hiện số âm) và **Hàng đang vận chuyển** (tổng số lượng trong phiếu **Mua hàng → Đặt hàng nhập** trạng thái "Đã xác nhận NCC" của Kiot Sài Gòn, ghép theo mã hàng; hiện ở cả 3 chế độ cơ sở). Khi chọn "Cả hai" bảng gộp 1 dòng/mã với cột Tồn kho HN/SG và Tồn có thể bán HN/SG riêng (Đơn giá = giá vốn bình quân theo tồn). Nguồn phiếu đặt hàng nhập là entity đồng bộ mới `order_suppliers` (endpoint `/ordersuppliers`, migration 0024, nhóm fast 7 phút, đối soát toàn bộ danh sách vì API bỏ qua `lastModifiedFrom`). **Sau khi deploy cần chạy `npm run db:migrate` (trong `server/`) rồi khởi động lại server** để scheduler nạp entity mới; lượt poll đầu tự quét toàn bộ phiếu. Chưa áp migration thì cột "Hàng đang vận chuyển" = 0 (đọc fail-soft), các cột khác vẫn bình thường.

2026-09-29 — bảng Báo cáo hàng hóa (tab Tổng quan): bỏ cột "DS Khách lớn nhất"; thêm nút **Chi tiết** ở mỗi dòng và ô tìm sản phẩm theo mã/tên, cùng mở khung doanh số 90 ngày của từng khách (số tiền + %) kèm biểu đồ tròn. Dữ liệu từ bảng mới `product_report_customers` (migration 0023, dựng cùng job đêm `productReportRefresh.js`), API `GET /api/product-report/customers?code=`. Sau khi áp migration 0023 cần chạy tay `node kiotvietSync/productReportRefresh.js` (trong `server/`) một lần để có dữ liệu ngay, nếu không khung Chi tiết rỗng đến đêm sau.

2026-09-29 — Báo cáo tổng hợp tải dữ liệu theo từng tab: `GET /api/dashboard?view=<tab>` (`dashboard/dashboardViews.js`), cache bảng nguồn theo từng bảng, rollup chạy song song khi cache nguội, đường nhanh cho `getDashboardDateParts`; trang `/reports/` chỉ gọi tab đang mở (lần mở nguội ~3,9s → 0,2–2,8s tùy tab, payload Tổng quan 5,25 MB → 10 KB). Bỏ trống `view` vẫn trả cả 5 tab như cũ.

2026-09-25 — thông báo yêu cầu nghỉ phép mới cho toàn bộ tài khoản, cho phép quản lý duyệt/từ chối ngay trên chuông thông báo; bộ lọc nghỉ phép mặc định chỉ hiển thị lịch nghỉ giao với ngày hôm nay; bổ sung vai trò `Nhân viên marketing` (migration `0019`) và phân quyền theo tính năng từng tài khoản `feature_permissions JSONB` (migration `0020`).

2026-09-23 — bổ sung bảng tổng hợp Báo cáo hàng hóa `product_report` (migration 0018) cho tab Tổng quan gộp cả 2 cơ sở, refresh định kỳ hàng đêm qua `productReportRefresh.js`, API `GET /api/product-report` và xuất Excel tùy chọn.

2026-09-22 — chuyển nguồn dữ liệu Trả NCC (kiểm tra đứt hàng) từ tab Google Sheets đọc tay sang người dùng tự upload file Excel xuất trực tiếp từ KiotViet; thêm bảng Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import), gộp vào cùng pipeline Postgres với Hóa đơn/Nhập hàng/Khách trả, loại bỏ hoàn toàn nhánh đọc Sheets riêng cho Trả NCC.

2026-10-05 — Chuẩn hóa bộ phận thành **Ban quản trị** (Ban quản lý + Trưởng chi nhánh) và **Hậu cần - Bảo vệ** (Hậu cần + Bảo vệ). Chạy `npm run db:migrate` trong `server/` để áp `0032` rồi khởi động lại server; cập nhật nhân sự, đơn nghỉ cũ và phạm vi duyệt phép.
