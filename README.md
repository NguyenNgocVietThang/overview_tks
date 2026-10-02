# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhập hàng (chỉ phục vụ kiểm tra đứt hàng và "Hàng mới nhập") và các bảng tổng hợp.
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Dữ liệu **Trả NCC** không còn đọc từ Google Sheets: người dùng tự upload file Excel xuất trực tiếp từ KiotViet, server nạp vào Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import) và dùng chung pipeline với Hóa đơn/Nhập hàng/Khách trả cho tính năng kiểm tra đứt hàng.
- CN1/CN3/CN7 (công nợ 1/3/7 ngày) được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng và Telegram ID được lưu trong PostgreSQL `app_users`; không còn tab `Users` hay luồng liên kết Telegram qua Google Sheets.
- Apps Script Kiot HN/SG và module vận chuyển cũ đã được nghỉ hưu hoàn toàn; tính năng tra cứu vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Nguồn nhân sự vẫn sử dụng workbook HR riêng khi được cấu hình. Đơn nghỉ phép nằm trong Postgres; bot xin nghỉ hiện có chạy ngoài repo. Bot Telegram riêng cho quản lý chạy cùng Express, thông báo và xử lý quyết định theo cơ sở (xem [hướng dẫn thiết lập](docs/telegram-manager-leave-setup.md)).
- Cơ sở chỉ là **bộ lọc xem**: mọi tài khoản đều xem được Hà Nội, Sài Gòn và **`Cả hai`** trên thanh điều hướng; cơ sở gán cho tài khoản (`co_so`, để trống = `Cả hai`) chỉ là cơ sở **mặc định** lúc đăng nhập. Mọi bảng dữ liệu có cột **Cơ sở**. Ở `Cả hai`: hàng hóa và giao dịch cùng mã ở hai cơ sở là hai dòng riêng `(cơ sở, mã)`, khách gộp theo **tên** (mã khách khác nhau giữa hai cơ sở, không còn cột mã khách), nhà cung cấp gộp theo mã. Chỉ hàng **Đang kinh doanh** được tính, không còn bộ lọc trạng thái kinh doanh; đầu tab không còn thanh tìm kiếm chung (chỉ còn bộ lọc thời gian và tìm kiếm trong từng bảng). `Cả hai` chỉ là phạm vi xem — cột `branch` trong database vẫn chỉ nhận `hanoi`/`saigon` (xem `server/branch/branches.js`).

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
| `SUPABASE_DB_URL` | PostgreSQL dùng cho dữ liệu KiotViet, tài khoản và workflow |
| `KIOTVIET_CLIENT_ID`, `KIOTVIET_CLIENT_SECRET`, `KIOTVIET_RETAILER` | KiotViet Hà Nội |
| `KIOTVIET_CLIENT_ID_SG`, `KIOTVIET_CLIENT_SECRET_SG`, `KIOTVIET_RETAILER_SG` | KiotViet Sài Gòn |
| `SPREADSHEET_ID`, `SPREADSHEET_ID_SG` | Lự do lịch sử — không còn phục vụ `Trả NCC` (đã chuyển sang upload Excel vào Postgres `supplier_return_imports`); bỏ trống vẫn chạy được |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Quyền Viewer để quản lý vòng đời đơn hàng / HR |
| `DEBT_MANAGEMENT_SPREADSHEET_ID` | Workbook công nợ dùng chung |
| `ORDER_LIFECYCLE_SPREADSHEET_ID` | Workbook tra cứu vòng đời đơn hàng (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`) |
| `HR_SPREADSHEET_ID`, `HR_SPREADSHEET_ID_SG` | Workbook nhân sự |
| `JWT_SECRET` | Ký phiên đăng nhập |
| `HR_MANAGER_TELEGRAM_ENABLED` | Bật bot riêng cho quản lý; mặc định `false` |
| `HR_MANAGER_TELEGRAM_BOT_TOKEN`, `HR_MANAGER_TELEGRAM_WEBHOOK_SECRET` | Token bot mới và secret xác thực webhook Telegram; giữ trong môi trường máy chủ |
| `HR_MANAGER_TELEGRAM_WEB_URL` | HTTPS origin công khai của dashboard, dùng cho webhook và nút mở web |
| `HR_MANAGER_TELEGRAM_SCAN_INTERVAL_MS` | Chu kỳ quét đơn/sự kiện trong Postgres; mặc định `5000` ms |
| `HR_LEAVE_DB_REALTIME_ENABLED` | Cầu thay đổi Postgres → SSE của HR, mặc định `true`, độc lập với công tắc bot |

Xem [server/.env.example](server/.env.example) để biết đầy đủ cấu hình.

## Cấu trúc chính

```text
server/
├── auth/                 # Tài khoản, phân quyền, OTP, Google OAuth
├── branch/               # Phân tách Hà Nội / Sài Gòn
├── dashboard/            # Tổng hợp dashboard (dashboardData + dashboardViews: API theo tab), xuất Excel/HTML, kiểm tra đứt hàng
│   ├── documentDetailRepository.js  # Chi tiết 1 chứng từ (đơn đặt hàng / phiếu trả / hóa đơn) cho popup bảng Hóa đơn
│   └── stockoutCheck/    # Engine kiểm tra đứt hàng + upload Trả NCC Excel
├── data/                 # Dữ liệu lưu trữ local (users.json, notifications.json, ...)
├── db/                   # Migration Supabase (0001–0029)
├── hr/                   # Nhân sự, quyết định nghỉ phép dùng chung và cầu Postgres → SSE
├── kiotviet/             # KiotViet API client và webhook receiver
├── kiotvietSync/         # Webhook, polling, backfill và rollup
├── lib/                  # Thư viện tiện ích nội bộ (TTL cache, ...)
├── notifications/        # Chuông thông báo + gửi email OTP
├── public/               # Frontend HTML/CSS/JS
├── scripts/              # Script thủ công (migrate dữ liệu, cài đặt ban đầu)
├── sheets/               # Google Sheets client (Công nợ, Vòng đời, HR)
├── shipment/             # Tra cứu vòng đời đơn hàng
├── telegram/             # Bot quản lý nghỉ phép, webhook, giao tin bền vững + đăng ký webhook
├── index.js
└── routes.js
```

## Dữ liệu công nợ CN1/CN3/CN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Cập nhật gần nhất

2026-10-02 — **Bot Telegram riêng cho quản lý nghỉ phép**: chạy trong Express qua `POST /api/telegram/manager-leave/webhook`, xác thực secret; quét Postgres mỗi 5 giây mặc định. Gửi các đơn `Xin nghỉ phép` mới và bù đơn `Chưa duyệt`/`Tạm duyệt` chưa gửi; quản lý nhận theo cơ sở tài khoản, phải có Telegram ID và bấm **Start** với bot mới. Chỉ có hai nút Phê duyệt (lưu Đã duyệt) và Từ chối; `Đã duyệt`/`Từ chối` khóa thao tác Telegram, web vẫn đổi trạng thái và mở lại được. Migration `0029_hr_manager_telegram.sql` thêm `decision_version` và 5 bảng cho sự kiện, giao tin, phiên từ chối, inbox cập nhật và mốc bật bot lần đầu; **chạy migration trước khi chạy bản web mới, kể cả khi bot tắt**. Bot xin nghỉ cũ tiếp tục dùng `decision_notified_at` để báo nhân viên. Xem [kế hoạch đã duyệt](docs/superpowers/plans/2026-10-02-telegram-manager-leave.md) và [thiết lập/vận hành](docs/telegram-manager-leave-setup.md); tài liệu này không xác nhận đã triển khai production.

2026-10-02 — **Vòng đời đơn hàng: lấy mọi đơn Kiot, cột Trạng thái KiotViet / Ghi chú, công thức có bán mới, ẩn/hiện cột, xuất file chỉ Quản lý**: bảng "Toàn bộ đơn hàng" nay gồm **mọi đơn đặt hàng của Kiot HN + SG ở mọi trạng thái** (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) — dòng Google Sheet không khớp đơn Kiot nào (theo cơ sở + mã) không hiện, sheet chỉ cấp mốc thời gian / trạng thái vòng đời. Thêm cột **Trạng thái KiotViet** + bộ lọc "Trạng thái KiotViet" (mặc định *Tất cả*; bộ lọc trạng thái chính vẫn còn) và cột **Ghi chú** (mô tả đơn trên Kiot) ngay bên phải "Giá trị có bán". **Giá trị có bán** đổi quy tắc: số lượng có bán = `min(SL đặt, tồn kho)` (không còn cộng hàng đang vận chuyển), thành tiền = số lượng có bán × đơn giá; chỉ đơn Phiếu tạm có giá trị này, "Giá trị đơn" thì có với mọi đơn Kiot. Cột "Đang vận chuyển" ở bảng hàng hóa trong đơn đổi tên **"Điều chuyển SG"** (chỉ để tham khảo). Nút **"Cột hiển thị"** mở hộp tick ẩn/hiện cột (mặc định hiện hết; "Mã đơn" luôn hiện; nhớ theo trình duyệt). Vì bảng lớn nên **lọc / sắp xếp / phân trang chạy ở máy chủ** (`GET /api/shipment/lifecycle?branch&status&kiotStatus&dateField&from&to&mode&q&sort&dir&page&pageSize` trả 1 trang 100 dòng; module `shipment/orderLifecycleQuery.js`; mặc định đơn mới đặt nhất trước), cache đơn Kiot 2 phút kiểu *stale-while-revalidate*; module đọc Kiot đổi tên `shipment/kiotOrdersRepository.js`. **Xuất Excel** (`POST /api/shipment/lifecycle/export`) nay nhận **bộ lọc** thay vì danh sách mã, có thêm cột Ghi chú / Trạng thái KiotViet, tối đa 20.000 dòng mỗi lần (vượt → 400 `TOO_MANY_ROWS`), và quyền `shipment.export` mặc định **chỉ Quản lý** (Quản lý vẫn cấp thêm được cho từng tài khoản).

2026-10-01 — **Vòng đời đơn hàng hợp nhất đơn Phiếu tạm của KiotViet + cột "Giá trị có bán"**: trang Vòng đời đơn hàng nay hiện cả mọi đơn **Phiếu tạm** của Kiot HN + SG cùng các đơn trên Google Sheet, ghép theo (cơ sở, mã đơn) để không trùng: đơn có trên sheet lấy trạng thái của sheet, đơn chỉ có ở Kiot là **"Đơn chưa gửi kế toán"** (trạng thái thấp nhất; xem trực tiếp, không lưu bản sao, không ghi đè trạng thái được). Cột mới **Giá trị có bán** = Σ từng mặt hàng min(SL đặt, tồn thực Kiot của chính cơ sở của đơn + hàng đang vận chuyển) × đơn giá sau chiết khấu (bỏ dòng VAT); bấm dòng mở chi tiết đơn kèm bảng hàng hóa có tồn kho / đang vận chuyển / có bán của từng mặt hàng (`GET /api/shipment/lifecycle/order-detail?code=&branch=HN|SG`). Bảng phân trang 100 dòng/trang, sắp xếp theo toàn bộ danh sách đã lọc; file Excel xuất mọi dòng đã lọc và có thêm cột "Giá trị có bán". Module mới `shipment/kiotPendingOrdersRepository.js` (cache 60 giây; Kiot lỗi thì trang vẫn hiện đơn sheet kèm cảnh báo) và `dashboard/inTransitSource.js` (SQL "hàng đang vận chuyển" dùng chung). Migration `0028_orders_phieu_tam_index.sql` thêm chỉ mục một phần cho đơn Phiếu tạm — **cần `npm run db:migrate`** (không áp thì code vẫn chạy đúng, chỉ chậm hơn).

2026-10-01 — tab **Hóa đơn**: bỏ bảng "Danh sách đặt hàng", bảng "Danh sách trả hàng" và thẻ "Đặt hàng đang chờ" (giữ thẻ "Trả hàng"); gỡ `GET /api/order-detail`, `GET /api/return-detail`, bộ lọc `or*`/`rt*` và các nút xuất `invoices.orders`/`invoices.returns`; tab này không còn đọc bảng đặt hàng nên tải nhanh hơn. Đơn Phiếu tạm xem ở trang Vòng đời đơn hàng.

2026-10-01 — công thức **Tồn có thể bán = Tồn thực tế − Đặt hàng Phiếu tạm + Hàng đang vận chuyển** áp cho bảng "Cơ cấu tồn kho" (tab Hàng hóa, cả file xuất) và bảng "Báo cáo hàng hóa" (tab Tổng quan; job đêm `kiotvietSync/productReportRefresh.js` — **sau khi deploy chạy tay `node kiotvietSync/productReportRefresh.js` trong `server/` một lần**, nếu không số mới chỉ có sau lần tính đêm). Công thức cũ (tồn − Khách đặt, không cộng hàng vận chuyển) không còn dùng.

2026-10-01 — **Tên sale** lấy từ KiotViet có dạng `<tên> - <ID Telegram>` nay hiển thị chỉ còn `<tên>` ở mọi nơi (tab Hóa đơn, chi tiết hóa đơn, Vòng đời đơn hàng, file xuất Excel/HTML); module `dashboard/saleName.js`, chỉ đổi cách hiển thị — dữ liệu gốc trong DB giữ nguyên ID.

2026-10-01 — **Phân quyền**: **Nhân viên sale** xem được tab Tổng quan (mục Xu hướng, Báo cáo doanh thu theo khách, Báo cáo hàng hóa; ẩn mục Kiểm tra đứt hàng / Trả NCC; trang đích sau đăng nhập của Sale đổi sang `/reports/`). **Quản lý** thường không còn đặt lại mật khẩu, đổi email/SĐT, hạ vai trò, rút quyền, khóa hay xóa tài khoản của **Quản lý khác** (vẫn làm được với nhân viên thường và chính mình); chỉ **Quản lý cấp cao** (tài khoản admin cứng) giữ đủ quyền như cũ — `server/auth/accountPolicy.js` (`checkProtectedManager`), `GET /api/auth/me` thêm `isSeniorAdmin`, trang Tài khoản ẩn các thao tác tương ứng.

2026-10-01 — **Cột thời gian sắp xếp đúng kiểu thời gian** (không còn so sánh chuỗi, nên `30/09` không còn đứng sau `01/10`) và trên toàn bộ dữ liệu đã lọc chứ không chỉ trang đang xem: bộ sắp xếp chung của dashboard đọc các ô `dd/MM/yyyy[ HH:mm[:ss]]`, `yyyy-MM-dd[ HH:mm[:ss]]` (Hàng mới nhập, Mã mới tạo, Ngày hết hàng…); "Chi tiết giao dịch" hiển thị giờ không có năm nên server trả thêm `timeMs`; trang Tài khoản sắp thứ tự mặc định theo ngày tạo thật.

2026-10-01 — **Doanh thu thực tế (đã trừ hàng trả lại)**: biểu đồ Doanh thu theo ngày, Top sản phẩm bán chạy, Báo cáo doanh thu theo khách và các KPI doanh thu cập nhật tính theo doanh thu thực tế sau khi trừ hàng khách trả lại (`returns` trạng thái `Đã trả`); rollup `daily_product_sales`, `customer_invoice_lines_90d`, `product_report` và `dashboardRollupRepository` đồng bộ trừ dòng hàng trả lại; giao diện tối ưu độ rộng cột bảng Báo cáo hàng hóa ("% Khách lớn").

2026-09-30 — **Gỡ tab "Nhà cung cấp"** khỏi Báo cáo tổng hợp: bỏ view `suppliers` (API `?view=`, quyền `reports.suppliers`, mục sidebar, các bảng/biểu đồ Hàng nhập + Nợ NCC, xuất `suppliers.list`/`overview.purchases`), bỏ đồng bộ entity `suppliers` và bước rollup `daily_purchase_summary`. Migration `0026` xóa bảng `suppliers` và `daily_purchase_summary` (giữ `purchases`/`purchase_details`/`product_first_purchase`/`order_suppliers` vì đứt hàng, "Hàng mới nhập" và "Hàng đang vận chuyển" vẫn dùng). **Deploy code trước, rồi mới `npm run db:migrate`** (bản code cũ còn đọc hai bảng này). Quyền `reports.suppliers` còn lưu trong `app_users.feature_permissions` được bỏ qua tự động.

2026-09-30 — **Popup chi tiết chứng từ**: bấm vào dòng bảng "Chi tiết giao dịch" / "Danh sách đặt hàng" / "Danh sách trả hàng" (tab Hóa đơn) mở hộp thoại giữa màn hình hiển thị đầy đủ dòng hàng, tổng tiền và phương thức thanh toán; nguồn từ module mới `dashboard/documentDetailRepository.js` (đọc trực tiếp `orders`/`returns`/`invoices` + `*_details` từ Postgres), route `GET /api/order-detail`, `GET /api/return-detail`, `GET /api/invoice-detail`.

2026-09-30 — biểu đồ cột chồng **Giá trị tồn kho theo ngày** (tab Tổng quan, mục 1 Xu hướng, dưới "Doanh thu theo ngày"): mỗi ngày một cột, chồng Hà Nội + Sài Gòn (chọn một cơ sở thì một màu), có bộ lọc Từ – Đến riêng, mặc định 7 ngày. Dữ liệu từ bảng mới `inventory_value_snapshots` (migration 0025), job `inventoryValueSnapshot.js` chụp 1 lần/ngày lúc 23:59 giờ VN (chụp bù sáng hôm sau trước 12:00 nếu server tắt), API `GET /api/inventory-value-history`. **Cần `npm run db:migrate` + restart trước 23:59 để có bản chụp đầu tiên; ngày trước khi bắt đầu không có số liệu.**

2026-09-30 — **Bộ lọc view theo cơ sở và độ rộng bảng cố định**: dashboard tải dữ liệu từng tab (`GET /api/dashboard?view=<tab>`) đã được tối ưu hóa tên view và đồng bộ cấu trúc layout; thêm CSS cố định độ rộng cột bảng (`fixed-table-widths.test.js`).

2026-09-29 — khung "Cơ cấu tồn kho" (tab Báo cáo hàng hóa): bỏ biểu đồ Top 15 và nút "Theo sản phẩm / Theo nhóm cha"; bảng "Chi tiết tồn kho theo sản phẩm" rộng toàn khung, thêm cột **Tồn có thể bán** (= Tồn kho − Khách đặt, không kẹp về 0 nên hàng bị giữ quá tồn hiện số âm) và **Hàng đang vận chuyển** (tổng số lượng trong phiếu **Mua hàng → Đặt hàng nhập** trạng thái "Đã xác nhận NCC" của Kiot Sài Gòn, ghép theo mã hàng; hiện ở cả 3 chế độ cơ sở). Khi chọn "Cả hai" bảng gộp 1 dòng/mã với cột Tồn kho HN/SG và Tồn có thể bán HN/SG riêng (Đơn giá = giá vốn bình quân theo tồn). Nguồn phiếu đặt hàng nhập là entity đồng bộ mới `order_suppliers` (endpoint `/ordersuppliers`, migration 0024, nhóm fast 7 phút, đối soát toàn bộ danh sách vì API bỏ qua `lastModifiedFrom`). **Sau khi deploy cần chạy `npm run db:migrate` (trong `server/`) rồi khởi động lại server** để scheduler nạp entity mới; lượt poll đầu tự quét toàn bộ phiếu. Chưa áp migration thì cột "Hàng đang vận chuyển" = 0 (đọc fail-soft), các cột khác vẫn bình thường.

2026-09-30 — trang Quản lý nhân sự, tab **Quy định công ty**: tách tài liệu dựng sẵn thành "Giờ giấc làm việc" và "Quy định nghỉ phép" (đủ: cách xin nghỉ qua bot Telegram @nghipheptks_bot, nghỉ ≤ 03 ngày xin trước 22h00 hôm trước, nghỉ > 03 ngày xin trước ≥ 02 ngày, phạt 50.000đ/lần trễ hạn, tự ý nghỉ phạt 03 ngày lương); Quản lý (quyền mới `hr.rules.manage`) tải file PDF lên thành tab + nhánh con trong sidebar, gỡ được mọi tài liệu (kể cả dựng sẵn, có nút "Khôi phục tài liệu mặc định"); mọi tài liệu có nút "Tải về PDF"; thêm/gỡ tài liệu báo lên chuông thông báo của các tài khoản có quyền xem. PDF lưu Postgres (bảng `hr_rule_documents`, migration 0027 — chạy `npm run db:migrate` trong `server/`), API `/api/hr/rules/documents*`.

2026-09-29 — bảng Báo cáo hàng hóa (tab Tổng quan): bỏ cột "DS Khách lớn nhất"; thêm nút **Chi tiết** ở mỗi dòng và ô tìm sản phẩm theo mã/tên, cùng mở khung doanh số 90 ngày của từng khách (số tiền + %) kèm biểu đồ tròn. Dữ liệu từ bảng mới `product_report_customers` (migration 0023, dựng cùng job đêm `productReportRefresh.js`), API `GET /api/product-report/customers?code=`. Sau khi áp migration 0023 cần chạy tay `node kiotvietSync/productReportRefresh.js` (trong `server/`) một lần để có dữ liệu ngay, nếu không khung Chi tiết rỗng đến đêm sau.

2026-09-23 — bổ sung bảng tổng hợp Báo cáo hàng hóa `product_report` (migration 0018) cho tab Tổng quan gộp cả 2 cơ sở, refresh định kỳ hàng đêm qua `productReportRefresh.js`, API `GET /api/product-report` và xuất Excel tùy chọn.

2026-09-22 — chuyển nguồn dữ liệu Trả NCC (kiểm tra đứt hàng) từ tab Google Sheets đọc tay sang người dùng tự upload file Excel xuất trực tiếp từ KiotViet; thêm bảng Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import), gộp vào cùng pipeline Postgres với Hóa đơn/Nhập hàng/Khách trả, loại bỏ hoàn toàn nhánh đọc Sheets riêng cho Trả NCC.

2026-09-25 — thông báo yêu cầu nghỉ phép mới cho toàn bộ tài khoản, cho phép quản lý duyệt/từ chối ngay trên chuông thông báo; bộ lọc nghỉ phép mặc định chỉ hiển thị lịch nghỉ giao với ngày hôm nay; bổ sung vai trò `Nhân viên marketing` (migration `0019`) và phân quyền theo tính năng từng tài khoản `feature_permissions JSONB` (migration `0020`).


2026-09-29 — Báo cáo tổng hợp tải dữ liệu theo từng tab: `GET /api/dashboard?view=<tab>` (`dashboard/dashboardViews.js`), cache bảng nguồn theo từng bảng, rollup chạy song song khi cache nguội, đường nhanh cho `getDashboardDateParts`; trang `/reports/` chỉ gọi tab đang mở (lần mở nguội ~3,9s → 0,2–2,8s tùy tab, payload Tổng quan 5,25 MB → 10 KB). Bỏ trống `view` vẫn trả cả 5 tab như cũ.
