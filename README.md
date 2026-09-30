# TOKOSI Dashboard

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

## Kiến trúc hiện tại

- **Supabase PostgreSQL** là nguồn dữ liệu KiotViet chính cho dashboard: hàng hóa, hóa đơn, đặt hàng, trả hàng, khách hàng, nhập hàng (chỉ phục vụ kiểm tra đứt hàng và "Hàng mới nhập") và các bảng tổng hợp.
- Engine `server/kiotvietSync/` đồng bộ KiotViet API vào Supabase bằng webhook/polling phía Node.js.
- Dữ liệu **Trả NCC** không còn đọc từ Google Sheets: người dùng tự upload file Excel xuất trực tiếp từ KiotViet, server nạp vào Postgres `supplier_return_imports` (thay thế toàn bộ theo cơ sở mỗi lần import) và dùng chung pipeline với Hóa đơn/Nhập hàng/Khách trả cho tính năng kiểm tra đứt hàng.
- CN1/CN3/CN7 (công nợ 1/3/7 ngày) được tính từ Supabase và lưu trong `customer_debt_activity_periods`.
- Tài khoản ứng dụng và Telegram ID được lưu trong PostgreSQL `app_users`; không còn tab `Users` hay luồng liên kết Telegram qua Google Sheets.
- Apps Script Kiot HN/SG và module vận chuyển cũ đã được nghỉ hưu hoàn toàn; tính năng tra cứu vòng đời đơn hàng tiếp tục được duy trì qua Google Sheets (`ORDER_LIFECYCLE_SPREADSHEET_ID`).
- Nguồn nhân sự vẫn sử dụng workbook HR riêng khi được cấu hình.
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
├── db/                   # Migration Supabase (0001–0021)
├── hr/                   # Nhân sự và nghỉ phép
├── kiotviet/             # KiotViet API client và webhook receiver
├── kiotvietSync/         # Webhook, polling, backfill và rollup
├── lib/                  # Thư viện tiện ích nội bộ (TTL cache, ...)
├── notifications/        # Chuông thông báo + gửi email OTP
├── public/               # Frontend HTML/CSS/JS
├── scripts/              # Script thủ công (migrate dữ liệu, cài đặt ban đầu)
├── sheets/               # Google Sheets client (Công nợ, Vòng đời, HR)
├── shipment/             # Tra cứu vòng đời đơn hàng
├── index.js
└── routes.js
```

## Dữ liệu công nợ CN1/CN3/CN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Cập nhật gần nhất

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


2026-09-29 — Báo cáo tổng hợp tải dữ liệu theo từng tab: `GET /api/dashboard?view=<tab>` (`dashboard/dashboardViews.js`), cache bảng nguồn theo từng bảng, rollup chạy song song khi cache nguội, đường nhanh cho `getDashboardDateParts`; trang `/reports/` chỉ gọi tab đang mở (lần mở nguội ~3,9s → 0,2–2,8s tùy tab, payload Tổng quan 5,25 MB → 10 KB). Bỏ trống `view` vẫn trả cả 6 tab như cũ.
