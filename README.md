# TOKOSI Dashboard

> **Nguyên tắc tiên quyết:** với chức năng chưa quen thuộc, đừng viết từ con số 0 — tìm các dự án mã nguồn mở trên GitHub để so sánh ý tưởng trước khi bắt tay làm (xem mục 0 của [CLAUDE.md](CLAUDE.md)).

26/10/2026 — **Bảng nhập liệu:** sort đọc giá trị hiện tại của input/textarea/select, ưu tiên hơn metadata cũ; so sánh đúng số/ngày và giữ SĐT dạng chữ. Tiêu đề bảng căn giữa, nội dung số vẫn căn phải. Đã kiểm tra 54/54 test liên quan và fixture Edge desktop/mobile, sáng/tối; toàn suite 3.582 test: 3.579 đạt, 3 bỏ qua, 0 lỗi; chưa commit/push/deploy. Xem [thiết kế](docs/superpowers/specs/2026-10-26-editable-table-sorting-design.md).

Dashboard nội bộ cho hai cơ sở Hà Nội và Sài Gòn.

24/10/2026 — Hiệu ứng xuất hiện dùng chung `public/shared/motion.js` trên toàn bộ trang: chữ nảy lần lượt, KPI lật/count-up, panel và dòng bảng hiện nhẹ. Giữ nguyên ảnh nền/hiệu ứng nền, giao diện, bố cục, cấu trúc bảng và dữ liệu; tôn trọng giảm chuyển động, không chạy lại khi bảng tự cập nhật. Không migration/API. Xem [kế hoạch và phạm vi](docs/superpowers/plans/2026-10-24-shared-ui-motion.md).

23/10/2026 — Bảng Khách hàng bổ sung bộ lọc hình thức bán hàng/quy mô, xuất thông tin Chi tiết (trừ Note) và dropdown level nội bộ dùng chung HN/SG theo tên khách. Mã cục bộ; migration `0087` và bước khởi tạo nguồn **chưa áp DB thật**. Xem [thiết kế](docs/superpowers/specs/2026-10-23-customer-filters-local-price-level-design.md), [kế hoạch](docs/superpowers/plans/2026-10-23-customer-filters-local-price-level.md). Sau migration, chạy `node scripts/initialize-customer-price-levels.js` trong `server` để xem trước; `--apply` sao lưu nguồn và bật level nội bộ. Hóa đơn đã chụp giữ nguyên.
24/10/2026 — Cột **Khách mới** (nhãn đợt tự do như T10/26, Cũ; tối đa 50 ký tự) nằm cạnh Level giá trong bảng Doanh số theo khách, dùng chung version/quyền sửa/409/lịch sử với level; **SĐT** và **Địa chỉ** là trường sửa tay trong Chi tiết (thông tin chung). Script `server/scripts/import-customer-levels-from-excel.js <file.xlsx> [--apply|--parse-only]` nạp level + Khách mới + SĐT/địa chỉ từ "DS khách" (mặc định xem trước; --apply cần 0087 đã khởi tạo; không đè SĐT/địa chỉ đã nhập tay). Migration 0089 và 0090 chưa áp DB thật.
24/10/2026 — **Bảng dữ liệu luôn lấp đầy khung chứa:** `public/shared/table-controls.js` đặt `min-width:100%` cho mọi bảng (trừ `data-table-fit="contain"`, vốn đã vừa khung), nên ẩn cột hay kéo hẹp cột thì các cột còn lại giãn đều ra; nhiều cột quá khung vẫn tràn và cuộn ngang. Không migration/API.

24/10/2026 — Chuông thông báo chuyển từ file `server/data/notifications.json` sang bảng Postgres `notifications` (migration `0093`). File cũ nằm trên đĩa tạm của Render nên mỗi lần deploy / khởi động lại là mất hết lịch sử chuông của mọi tài khoản. Không đổi API, không đổi giao diện; thông báo cũ trong file không chuyển sang. **Phải áp `0093` trước khi deploy** (chưa áp thì chuông báo lỗi).
24/10/2026 — **Bảng giá duyệt** trong tab Hóa đơn (mục bước 2, "Giao dịch" thành bước 3): lưu giá đã được Anh Quân / Anh Duy / Anh Duy Khánh duyệt theo (cơ sở, khách, sản phẩm, ngày duyệt), gồm 2 giá tùy chọn "Giá không VAT" (`price_no_vat`) và "Giá có VAT" (`price_with_vat`), phải có ít nhất 1 giá và mỗi giá điền vào phải > 0; Kiểm tra giá bán dùng giá duyệt THAY cho mức tối thiểu theo mô tả khi hóa đơn có ngày bán >= ngày duyệt: dòng Full VAT dùng giá có VAT, dòng không Full VAT dùng giá không VAT, loại giá cần dùng mà để trống thì KHÔNG áp giá duyệt cho dòng đó (rơi về mức tối thiểu theo mô tả); mỗi loại giá được chọn riêng, lấy bản ghi `approved_on` mới nhất không quá ngày bán CÓ loại giá đó (nhãn nguồn "Giá duyệt"). Xem theo quyền riêng `reports.invoices.approvedPrice` (mặc định chỉ Quản lý, người khác ẩn), xuất cần thêm `reports.export`; tạo/sửa/xóa theo quyền mới `reports.invoices.approvedPrice.manage` (mặc định chỉ Quản lý), có khóa `version` (409) và nhật ký thay đổi. API `/api/invoice-approved-prices` (GET /, /export, /customer-suggest, /product-suggest, POST, PUT /:id, DELETE /:id). **Thứ tự triển khai: áp migration `0091` VÀ `0092` (tách `approved_price` thành `price_no_vat` / `price_with_vat`) TRƯỚC khi deploy mã**; chưa áp thì API bảng trả 503 `NOT_MIGRATED` và Kiểm tra giá bán chạy như cũ. Cập nhật gần nhất: 24/10/2026.
24/10/2026 — **Dự kiến hàng về:** bỏ các chỉ số tổng quan, bảng Tổng hợp CONT và cột Nguồn trên bảng dòng hàng. Ba ô lọc Nguồn / CONT / Trạng thái giới hạn lựa chọn theo các ô còn lại; từ khóa tìm kiếm chỉ lọc dòng, không thay đổi danh sách lựa chọn. Ô Nguồn vẫn theo quyền fullAccess; xuất file tiếp tục áp dụng các bộ lọc đang chọn. Không migration hoặc API mới.


Tiến độ, kiến trúc chi tiết và checklist vận hành: [CURRENT.md](CURRENT.md).

## Kiến trúc hiện tại

Ứng dụng Node.js/Express dùng Supabase PostgreSQL làm nguồn dữ liệu chính; KiotViet và một số Google Sheets cung cấp dữ liệu đồng bộ. Các module chính gồm báo cáo, công nợ, nhân sự, quản lý tài khoản, vòng đời đơn hàng và các công cụ kế toán. Chi tiết kiến trúc và tiến độ theo tính năng nằm trong [CURRENT.md](CURRENT.md).

Các bảng web và file HTML hỗ trợ chọn cột và kéo chỉnh độ rộng; Excel/PDF giữ định dạng xuất hiện có.

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
| `KIOTVIET_CASHBOOK_SYNC_ENABLED` | Bật riêng đồng bộ Sổ quỹ khi engine tổng tắt. Khi engine tổng bật, Sổ quỹ cũng chạy. `KIOTVIET_CASHBOOK_SYNC_INTERVAL_MS` mặc định/tối thiểu 60 giây; giao diện kiểm tra mốc đồng bộ mỗi 15 giây khi đang hiển thị |
| `KIOTVIET_WEBHOOK_SECRET` | Bí mật gắn vào đường dẫn webhook `/api/kiotviet/webhook/<secret>`; đường dẫn cũ không secret tắt bằng `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false` |
| `SPREADSHEET_ID`, `SPREADSHEET_ID_SG` | Di sản — không còn module nào đọc (Trả NCC đã chuyển sang upload Excel vào Postgres `supplier_return_imports`); bỏ trống vẫn chạy được |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account Google (bắt buộc khi khởi động). Quyền Viewer cho Công nợ, Vị trí hàng và file **VAT TKS** (`1f1vgl…`, nguồn Nháp VAT / Tra cứu VAT / Tồn VAT của ORDER VAT); **Editor** cho workbook Vòng đời đơn hàng (ghi tab `Lịch sử cập nhật`) |
| `DEBT_MANAGEMENT_SPREADSHEET_ID` | (Không còn dùng từ 13/10/2026 — tab Công nợ tính từ KiotViet + lịch TT trong Postgres) |
| `STOCK_LOCATIONS_SPREADSHEET_ID` | Workbook vị trí hàng HN/SG dùng chung, chỉ đọc |
| `PRODUCT_CONTAINER_SPREADSHEET_ID` | Workbook TKS2 ĐẶT CONT; chỉ đọc 7 sheet CONT mỗi 600.000 ms; service account cần Viewer |
| `SHIPPING_MEASURE_SPREADSHEET_ID` | Workbook có sheet `CÂN ĐO` (thể tích/cước đơn), chỉ đọc (job `sheetSnapshots` đồng bộ vào `shipping_measures` mỗi 5 phút); để trống = dùng `STOCK_LOCATIONS_SPREADSHEET_ID` |
| `MARKETING_REPORT_SPREADSHEET_ID`, `MARKETING_PHONES_SPREADSHEET_ID`, `MARKETING_ADS_SPREADSHEET_ID` | Ba workbook Báo cáo Marketing, chỉ đọc; service account cần Viewer trên cả ba |
| `MARKETING_ADS_SYNC_INTERVAL_MS`, `MARKETING_ADS_READ_MAX_AGE_MS` | Chi phí ADS được job `marketingAdsSync.js` đồng bộ từ Sheets vào `marketing_ads_costs` (migration `0069`) — chu kỳ mặc định 30 phút (tối thiểu 5 phút); job chạy cùng vòng đời job Pancake nên chỉ hoạt động khi `PANCAKE_MARKETING_SYNC_ENABLED=true`. Bảng cũ hơn `MARKETING_ADS_READ_MAX_AGE_MS` (mặc định 3 giờ) thì báo cáo lùi về đọc Sheets |
| `BUSINESS_CURRENT_MONTH_ENABLED`, `BUSINESS_CURRENT_MONTH_MIN_INTERVAL_MS` | Tính sẵn doanh số **tháng hiện tại** của Báo cáo kinh doanh vào `business_current_month_*` (migration `0068`). Mặc định bật (thiếu migration thì tự bỏ qua), `false` để tắt (báo cáo lại tính live); sàn giữa hai lượt tính nhanh mặc định 600000 ms (10 phút) |
| `ORDER_LIFECYCLE_SPREADSHEET_ID` | Workbook vòng đời đơn hàng (`DonHang_HN`, `DonHang_SG`, `DonHang_MienNam` = đơn Bắc-Nam tính như đơn Hà Nội, `Khách_HN`/`Khách_SG` = khách/ship lấy tại kho, `KeToan_ChungTu` = đơn kế toán/chứng từ dùng chung HN+SG, `Lịch sử cập nhật`) |
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
| `SPECIAL_DAYS_NOTIFY_ENABLED` | Báo ngày lễ/sinh nhật lên chuông thông báo; mặc định `true`, `false` để tắt |
| `VAT_REQUEST_NOTIFY_ENABLED` | Báo chuông cho sale ~10 phút sau khi kế toán ngừng sửa yêu cầu ORDER VAT của họ; mặc định `true`, `false` để tắt (cần migration `0080`) |
| `BACKGROUND_JOBS` | `inline` (mặc định): job nền chạy chung web; `worker`: web chỉ nghe sự kiện, job chạy ở `npm run worker` (`worker.js`) |
| `INVOICE_PRICE_AUDIT_ENABLED` | Bật job 23:00 (giờ Việt Nam) của **Kiểm tra giá bán**: chụp hóa đơn chưa quét trong cửa sổ 7 ngày và đối chiếu giá min; mặc định `false`. Rollout: áp migration `0077` → deploy khi còn `false` → chạy tay lần đầu `npm run invoices:price-audit -- --date <hôm nay> --apply` → mới bật `true` |
| `PICK_KIOT_RECONCILE_ENABLED` | Bật job đồng bộ **trạng thái bốc theo Kiot** (`pickAssignments/pickKiotReconcileJob.js`): đơn Đang bốc mà Kiot Hoàn thành → Đã bốc (lúc đó mới trừ thùng), Kiot Đã hủy → Chưa bốc (trả giữ chỗ). Mặc định **bật** (chỉ tắt khi đặt `false`); cần `SUPABASE_DB_URL`; chỉ đọc bảng `orders` đã đồng bộ, không gọi API KiotViet |
| `PICK_KIOT_RECONCILE_INTERVAL_MS` | Chu kỳ job trên, mặc định 120000 (2 phút), kẹp trong 30 giây – 30 phút |
| `DASHBOARD_PREWARM` | Nạp sẵn cache nguồn lúc khởi động; mặc định bật, `false` để tắt |
| `MEMORY_MONITOR` / `MEMORY_LOG_INTERVAL_MS` / `MEMORY_LIMIT_MB` | Log bộ nhớ định kỳ; mặc định bật, 60000 ms, trần cảnh báo 2048 MB (`MEMORY_MONITOR=false` để tắt) |
| `XKIRO_API_KEY`, `XKIRO_BASE_URL`, `INVOICE_VISION_MODEL`, `INVOICE_VISION_FALLBACK_MODEL` | AI đọc ảnh hóa đơn ở tab Tạo QR (xKiro, chuẩn OpenAI). Thiếu key = tắt, trang báo nhập tay; mặc định model `qwen/qwen3.8-max:free`, dự phòng `qwen/qwen3-vl-plus:free` |
| `VAT_REQUEST_STOCK_SHEET_ID`, `VAT_REQUEST_STOCK_GID`, `VAT_REQUEST_STOCK_COLUMN`, `VAT_REQUEST_MAPPING_SHEET_ID`, `VAT_REQUEST_MAPPING_GID` | Nguồn cột **Tồn VAT** của ORDER VAT: tab Gộp VAT (cột I `TỒN ĐẦU NGÀY`) + Khớp mã, đọc bằng service account (`*_SHEET_ID` = ID file, `*_GID` = sheetId của tab; file phải chia sẻ Viewer cho service account). **Nên bỏ trống** = tab Gộp VAT (sheetId `950697804`, cùng tab Nháp VAT / Tra cứu VAT dùng) + Khớp mã (`631827560`) của file VAT TKS; nếu Render còn đặt `39032` / `1192158065` (file trung gian "cúc cu test" cũ) thì xóa các biến này |
| `PG_POOL_MAX` | Trần kết nối pool `pg` mỗi instance (mặc định 7; 2 × giá trị ≤ 15 của Supabase session pooler) |

Xem [server/.env.example](server/.env.example) để biết đầy đủ cấu hình.

## Cấu trúc chính

```text
server/
├── auth/                 # Tài khoản, phân quyền, OTP, Google OAuth
├── branch/               # Phân tách Hà Nội / Sài Gòn
├── businessReport/       # Báo cáo kinh doanh: SQL doanh số tháng, repository (tháng đã chốt + tháng hiện tại tính sẵn business_current_month_*, lùi về live), service, API, xuất Excel/HTML
│   ├── customerProfileRepository.js  # Ghi chú / thông tin theo khách của bảng Doanh số theo khách (22/10/2026, migration 0080): Thông tin chung, ảnh kho (BYTEA), note kiểu tin nhắn, ngày đã đi tiếp khách, người được gán sửa; fail-soft khi chưa có bảng
│   └── customerProfileRules.js       # Luật thuần (không DB) kiểm tra đầu vào: quy mô kho, hình thức bán hàng, note ≤ 2000 ký tự, ngày đã đi, người sửa
├── cashbook/             # Sổ quỹ toàn công ty: số dư, sổ chi tiết, lịch sử chốt và xuất Excel/HTML; repository đọc qua view v_cash_book_transactions (0070, lùi về subquery nếu thiếu view)
├── dashboard/            # Tổng hợp dashboard (dashboardData + dashboardViews: API theo tab), xuất Excel/HTML, kiểm tra đứt hàng
│   ├── documentDetailRepository.js  # Chi tiết hóa đơn (popup bảng Chi tiết giao dịch) và chi tiết đơn đặt hàng (trang Vòng đời đơn hàng)
│   └── stockoutCheck/    # Engine kiểm tra đứt hàng + upload Trả NCC Excel; stockoutDaysStore.js lưu số ngày đứt 30 ngày theo cơ sở vào product_stockout_days (cột Đứt HN/SG của Báo cáo hàng hóa)
├── data/                 # Dữ liệu lưu trữ local (users.json.example, ...); chuông thông báo đã chuyển sang bảng Postgres `notifications` (0093)
├── debtSchedule/         # Lịch thanh toán công nợ: chốt 15:00 mỗi ngày, quy tắc thưởng/phạt, sổ cái, xếp hạng, sale teams; migration `0047`
├── db/                   # Migration Supabase và SCHEMA.md (trạng thái áp dụng xem CURRENT.md)
├── hr/                   # Nhân sự, nghỉ phép tự gửi, phạm vi duyệt chung, tài liệu quy định, nhập Excel và cầu Postgres → SSE
├── invoicePriceAudit/    # Kiểm tra giá bán (20/10/2026): priceNoteParser.js + priceAuditRules.js (đọc mô tả giá, VAT, cấp khách), priceAuditSql.js (tính NUMERIC), priceAuditRepository.js (chụp hóa đơn, đọc bảng, sửa giải thích / Chốt có version), priceAuditRefresh.js + priceAuditScheduler.js (job 23:00 và cửa sổ 7 ngày), priceAuditService.js / priceAuditRoutes.js / priceAuditAccess.js (API `/api/invoice-price-audit`, quyền) và kiểm thử PGlite; sale có quyền sửa giải thích mọi hóa đơn, hiện tên người lưu gần nhất, giữ lâu dài qua các phiên chạy; bảng dùng nhãn cột rút gọn; mục 1 có thêm bảng Tiền phạt theo sale cạnh 5 khối KPI (`saleSummary`, `GET /export/sales`); **Bảng giá duyệt** (24/10/2026, migration `0091` + `0092` tách 2 giá `price_no_vat` / `price_with_vat`): approvedPriceRules.js / approvedPriceRepository.js / approvedPriceRoutes.js / approvedPriceExport.js (API `/api/invoice-approved-prices`, bảng `invoice_approved_prices` + nhật ký bất biến `invoice_approved_price_changes`), giá duyệt (giá có VAT cho dòng Full VAT, giá không VAT cho dòng còn lại) thay giá tối thiểu theo mô tả khi tính Kiểm tra giá bán
├── kiotviet/             # KiotViet API client và webhook receiver
├── kiotvietSync/         # Webhook, polling, backfill và rollup; businessCurrentMonthRefresh.js tính sẵn doanh số tháng hiện tại cho Báo cáo kinh doanh (0068)
├── lib/                  # Thư viện tiện ích nội bộ (TTL cache, ...)
├── marketingReport/      # Báo cáo Marketing: đọc 3 workbook Google Sheets, đối chiếu doanh số KiotViet theo tên khách, cập nhật ngược Sheets, xuất Excel/HTML; tính sẵn trong DB (0069): marketingAdsSync.js (chi phí ADS), marketingSummaryRefresh.js (gộp SĐT Pancake), view v_marketing_customer_revenue (doanh số theo tên)
├── notifications/        # Chuông thông báo: notificationRepository.js (bảng `notifications`, 0093), notificationRoutes.js (/api/notifications), specialDayNotifier.js; testHelpers/notificationTestPool.js (PGlite cho test)
├── productContainers/    # Parser CONT, snapshot repository, đồng bộ Sheets chỉ đọc mỗi 10 phút (ghi khác biệt) và kiểm thử; bảng Dự kiến hàng về (20/10/2026): expectedRefresh.js (job dựng bảng tính sẵn), expectedRepository.js (đọc + cache theo version), expectedRoutes.js (/api/expected-arrivals), expectedExport.js (xuất Excel/HTML); từ 21/10/2026 route trả `fullAccess` và bỏ trường giá khi thiếu quyền `reports.overview.containers.full`, xuất file thêm cột giá theo quyền
├── public/               # Frontend HTML/CSS/JS
│   ├── invoice-approved-prices.js / .css # Mục Bảng giá duyệt của tab Hóa đơn (24/10/2026): bộ lọc Người duyệt + Ngày duyệt, sắp xếp phía máy chủ, hộp Tạo/Sửa/Xóa chọn khách + sản phẩm từ gợi ý KiotViet, 2 cột/ô giá tùy chọn Giá không VAT + Giá có VAT, xuất Excel
│   ├── cashbook/         # Trang Sổ quỹ: bộ lọc/hash, số dư, chốt và xuất chọn cột
│   ├── vat-draft/        # Trang Kế toán – Nháp VAT: dán mã HD/DH → Xử lý luôn (danh sách đã dán + hộp chi tiết) hoặc dán dữ liệu, kết quả phân bổ + Ghi chú tổng, QR; Tạo QR từ PDF (2 cột, QR to bên phải; sale dùng được qua accounting.qr); cell-select.js chọn ô kiểu Google Sheet + Ctrl+C
│   ├── vat-lookup/       # Trang Kế toán – Tra cứu VAT: 2 tab Hàng VAT có sẵn / Hàng sắp về, dán nhiều mã; thanh tab Kế toán chung (TKSNav.renderAccountingTabs)
│   ├── vat-request/      # Trang Kế toán – ORDER VAT: sale tạo/sửa yêu cầu của mình, KT được cấp quyền riêng mới xử lý trạng thái/ghi chú/ngày về; vat-request-grid.js = chọn ô / copy / kéo nhân bản / dán kiểu Google Sheet
│   ├── vendor/pdfjs/     # pdf.js 4.10.38 (legacy build) đọc text hóa đơn PDF ngay trong trình duyệt
│   └── shared/
│       ├── fuzzy-search.js # Tìm gần đúng theo từ dùng chung (UMD, window.TKSFuzzySearch: fold/tokens/score/matches/filter)
│       ├── fuzzy-search.test.js # Kiểm thử luật tìm gần đúng
│       ├── carton.js     # Luật đọc ghi chú thùng `<thùng>T x <SL/thùng>` dùng chung (UMD, `require` ở server, `PickingCarton` ở trình duyệt): SL, cảnh báo, chuẩn hóa
│       ├── carton.test.js # Kiểm thử luật ghi chú thùng
│       └── detail-panel.css # Khung xem chi tiết dùng chung (.dp-): chỉ số tổng quan, bảng 1 khung cuộn, tắt nút chọn cột
├── scripts/              # Script thủ công (migrate dữ liệu, cài đặt ban đầu)
├── shared/               # Tiện ích dùng chung phía máy chủ: fuzzySearch.js (CommonJS, createMatcher — tìm gần đúng theo từ, cùng luật với public/shared/fuzzy-search.js) và fuzzySql.js (cùng luật trong SQL)
├── userTablePrefs/       # Cấu hình bảng theo tài khoản: độ rộng cột và ẩn/hiện cột trên desktop/mobile, lưu lâu dài Postgres `user_table_prefs` (migration `0085`); API `/api/me/table-prefs`
├── sheets/               # Google Sheets client (Công nợ, Vòng đời, Vị trí hàng, lưu ý `hrSheetsClient.js` là mã chết chờ xóa tay)
├── sheetSnapshots/       # Job đọc Google Sheets (Vị trí HN/SG, CÂN ĐO) theo chu kỳ vào Postgres, ghi khác biệt; kiểm thử PGlite
├── stockPositions/       # Vị trí hàng mới (VT Hà Nội/VT Sài Gòn, migration 0095/0099): bảng `stock_positions` sửa/thêm/xóa/import trực tiếp, SL kho tính từ ghi chú thùng, SL Kiot từ `products`, lịch sử (lọc theo dòng `positionId`, xuất Excel `stockPositionsHistoryLabels.js` + `history/export`); API `/api/stock-positions`
├── pickAssignments/      # Chỉ định vị trí trên Vòng đời đơn hàng (migration 0096/0097/0098, quyền `shipment.pick`): giữ chỗ + snapshot vị trí/tiền + trừ/hoàn tác trong `stock_positions`, API `/api/shipment/pick`; giao diện ở `public/shipment/lifecycle/pick/`, kiểm tra phân bổ bằng `public/shared/pick-rules.js`; trạng thái bốc tự động theo Kiot: `pickKiotData.js` (đọc trạng thái đơn đã đồng bộ) + `pickKiotReconcileJob.js` (job 2 phút, nối ở `jobs.js`)
├── stockLocations/       # Đọc vị trí hàng HN/SG từ DB (cache theo lần đồng bộ), ánh xạ cột và API chỉ đọc
├── shipment/             # Vòng đời đơn hàng: đơn KiotViet (Postgres) ghép Google Sheet, lọc/phân trang ở máy chủ
├── telegram/             # Bot quản lý nghỉ phép, webhook, giao tin bền vững + đăng ký webhook
├── vatDraft/             # Kế toán – Nháp VAT (port vat-draft-app): phân bổ nguồn nháp, VietQR, đọc ảnh hóa đơn bằng AI (invoiceVision.js, xKiro), đọc 2 tab file VAT TKS bằng service account, chứng từ HD/DH từ Postgres
├── vatLookup/            # Kế toán – Tra cứu VAT (port app Apps Script logic v12): lookupModel.js (ghép Khớp mã + Gộp VAT + DK về 2, tìm kiếm), lookupSource.js (3 tab file VAT TKS qua service account, cache 10 phút / stale 6 giờ), vatLookupRoutes.js (/api/vat-lookup)
├── vatRequests/          # ORDER VAT: quyền/khóa/version/lịch sử; xuất Excel (export.js); gợi ý khách và giá từ yêu cầu gần nhất; Tồn VAT/Dự kiến về tính live
├── index.js
├── jobs.js               # Danh sách job nền (sync KiotViet, sheet, container, Pancake)
├── worker.js             # Tiến trình job nền riêng khi BACKGROUND_JOBS=worker
└── routes.js
```

## Dữ liệu công nợ CN1/CN3/CN7

Migration `0014_customer_debt_activity_periods.sql` tạo bảng tổng hợp ba kỳ 1/3/7 ngày (CN1/CN3/CN7). Scheduler gọi `customerDebtReportRefresh.js`; dashboard đọc bảng này qua `customerDebtActivityRepository.js`, không đọc Google Sheets.

Migration `0015_app_users_telegram_id.sql` thêm `app_users.telegram_id` để bot có thể liên kết trực tiếp qua Supabase Postgres. Giao diện/API tạo mã liên kết cũ không còn đọc hoặc ghi tab `_HR_TELEGRAM_LINKS`.

## Tiến độ dự án

Trạng thái, lịch sử cập nhật và checklist vận hành: [CURRENT.md](CURRENT.md).

## Cá nhân hủy đơn nghỉ phép — 26/10/2026

Chủ đơn hoạt động có thể xóa vĩnh viễn đơn xin nghỉ từ web/Telegram ở mọi trạng thái trước buổi nghỉ đầu tiên. Gồm xác nhận trên web, xóa đơn/lịch sử, chuông hủy, hàng đợi Telegram và realtime. Áp migration `0094_hr_leave_cancellation.sql` trước backend/worker/frontend. Xem [thiết kế](docs/superpowers/specs/2026-10-26-own-leave-cancellation-design.md) và [kế hoạch/triển khai](docs/superpowers/plans/2026-10-26-own-leave-cancellation.md).

## Tra cứu VAT: trạng thái theo Mã VAT Kiot — 27/10/2026

Cột Trạng thái ở tab Hàng VAT có sẵn tính theo mã VAT của từng dòng: tổng Tồn có thể nháp của mọi dòng Gộp VAT cùng mã VAT (toàn sheet) > 0 là "Còn VAT". Mã Kiot dùng chung mã VAT với mã còn tồn không còn bị báo "Không còn VAT". Không migration/API mới. Xem [thiết kế](docs/superpowers/specs/2026-10-27-vat-status-by-vat-code-design.md).

## Vị trí hàng mới: VT Hà Nội / VT Sài Gòn — 27/10/2026

Trang `/vt-positions/#hn|#sg` (module `stockPositions/`) là cơ sở dữ liệu Vị trí hàng mới, chạy song song hai tab cũ "Vị trí HN/SG" (còn đọc Google Sheets). Dữ liệu đầu sao chép một lần từ `stock_location_lines`; từ đó sửa/thêm/xóa/import trực tiếp. Quyền: `stockLocationsV2.view`, `stockLocationsV2.edit`, `stockLocationsV2.export`. API `/api/stock-positions`.

Giao diện làm lại (27/10/2026): tiêu đề + tab có icon, thanh công cụ nút icon, cột "Cập nhật" (giờ VN) và "Người sửa cuối" riêng, mỗi cột có độ rộng tối thiểu, vị trí dạng pill, chọn 50/100/200 dòng/trang, bộ lọc dropdown **Cảnh báo / Hợp lệ / Tất cả** (thay nút bật-tắt). Không còn cột Thao tác/menu ⋯ và không sửa tại chỗ: **bấm vào một dòng** mở hộp chi tiết gồm thông số (SL thùng, SL chiếc, SL Kiot, Vị trí, Ngày về), form sửa Ghi chú/Ngày về/Vị trí, lịch sử riêng của dòng và nút **Lưu** / **Xóa dòng** (quyền chỉ xem: ẩn Lưu/Xóa). Hộp "Lịch sử cập nhật" chung có bảng 5 cột (Thời gian · Người thực hiện · Hành động · Mã hàng/Vị trí · Thay đổi cũ→mới) và nút **Xuất Excel** (`GET /api/stock-positions/history/export`, cần `stockLocationsV2.export`, theo bộ lọc hành động/từ khóa, tối đa 50.000 dòng, header `X-History-Truncated`). File mới `public/vt-positions/vt-history.css`, `vt-detail.css`. Không thêm migration. Migration `0095` — đã commit, **chưa migrate, chưa deploy**; áp `npm run db:migrate` trước khi deploy. Xem [thiết kế](docs/superpowers/specs/2026-10-27-vt-positions-tabs-design.md).

**Đã sửa, người sửa theo mã đơn, xóa lịch sử (28/10/2026, migration `0099`, chưa áp DB):** nút "Đánh dấu Đã sửa" trong hộp chi tiết bật cờ `format_ack` cho mọi cảnh báo (giữ mãi, bảng hiện nhãn xanh); lượt trừ tồn do đơn ghi **mã đơn** làm người sửa; quyền mới `stockLocationsV2.historyDelete` (Quản lý) cho nút **Xóa lịch sử** theo khoảng ngày (để lại dòng `history_purged`, trigger chỉ cho DELETE khi `app.history_purge = 'on'`). Chạy `npm run db:migrate` trước khi deploy.

## Chỉ định vị trí trên Vòng đời đơn hàng — 27/10/2026

Trang `/shipment/lifecycle/` có tính năng **Chỉ định vị trí** (chỉ Quản lý; quyền mới `shipment.pick`, `requires: shipment.lifecycle`, cấp riêng được từng tài khoản). Chỉ đơn **Đã gửi kế toán** (`SENT_TO_ACCOUNTANT`) được chỉ định: bấm **Chỉ định vị trí** ở khối “Hàng hóa trong đơn” → chọn thùng/vị trí (gợi ý thùng nguyên, ST) → **Xác nhận & In phiếu nhặt** (đơn thành **Đang nhặt**, giữ chỗ lưu Postgres, phiếu in 9 cột) → **Xác nhận nhặt** (trừ thùng thật trong `stock_positions`, lịch sử `pick`) hoặc **Hủy nhặt** (hoàn tác đúng chuỗi ghi chú; nếu vị trí đã bị đổi tiếp thì `carton.restore` cộng trả; nếu dòng bị tự xóa khi trừ hết thì tạo lại từ ảnh chụp). Không có nút **Chỉ định lại** (từ 27/10/2026 khuya): đơn **Đang nhặt** và **Đã hủy** sửa ngay trong hộp chỉ định, **Đã bốc** chỉ xem (chi tiết ở đoạn “Hộp chỉ định sửa ngay” bên dưới). Danh sách Vòng đời có `pickStatus` của chỉ định mới nhất (kể cả `cancelled`) và ô lọc `pickStatus`; bộ lọc cũng áp dụng khi xuất Excel. Mã hàng/mã đơn khớp không phân biệt hoa thường và khoảng trắng đầu/cuối (`lower(btrim(...))`), tách cơ sở `HN`/`SG`. Đợt 1 KHÔNG gồm kiểm kê/khóa vị trí/kho nhặt thực/lấy bù/chuông thông báo; bản thử `public/prototypes/order-picking/` giữ làm demo.

API `/api/shipment/pick` (`GET /candidates?branch&order`, `GET /?branch&order` trả chỉ định mới nhất kể cả đã hủy, `POST /`, `POST /:id/confirm`, `POST /:id/cancel`, `POST /status`, `POST /mismatch-ack`), module `server/pickAssignments/`, migration `0096_order_pick_assignments.sql` (3 bảng + mở rộng CHECK lịch sử vị trí) và `0098_order_pick_history_mismatch_ack.sql` (action `mismatch_ack`). Trạng thái: đang làm trên nhánh `feat/lifecycle-pick-assign`, **chưa merge, chưa migrate (`0096`, `0097`, `0098`), chưa deploy**. Frontend thật: `pick-assign.js`, `pick-assign.css`, `invoice.js`, `print-tools.js`, `order-template.tpl`, `invoice-a4.css`, `invoice-assets/` trong `server/public/shipment/lifecycle/pick/` (prototype vẫn dùng `order-template.html`). Xem [kế hoạch](docs/04-planning/implementation_plan.md), `server/README.md` và [báo cáo rà soát bản trước khi sửa](docs/superpowers/reviews/2026-10-27-pick-assign-review.md).

**Đợt sửa 27/10/2026:** chỉ nhặt số chiếc nguyên (ST quy đổi vẫn có thể lẻ), kiểm vị trí/mã/quy cách và cách lấy đã in dưới khóa trước khi xác nhận. Migration `0097_order_pick_assignment_snapshots.sql` thêm `allocation_snapshot` lúc chỉ định, tách ảnh chụp hoàn tác. `pickAssignmentSnapshot.js` và `pickOrderSnapshot.js` tách kiểm phiếu khỏi tiền gốc: snapshot v2 giữ từng dòng/chiết khấu/thành tiền, không suy tiền từ giá bình quân. Phiếu A4 theo mẫu kho, giữ cột ST, không lặp ST khi trùng mã. Lỗi mạng luôn bỏ bận, tải lại trạng thái trước ghi tiếp, không tự gửi lại lệnh. Phiếu cũ thiếu dấu vết cần hủy/chỉ định lại để xác nhận; số đã nhặt lẻ/lệch biến động cần đối soát trước hoàn. [Spec](docs/superpowers/specs/2026-10-27-pick-assign-hardening-design.md), [kế hoạch sửa](docs/superpowers/plans/2026-10-27-pick-assign-hardening.md); kết quả kiểm chứng cập nhật trong `CURRENT.md`.

**Trạng thái bốc + phiếu in mới + cột Có thể bốc (27/10/2026, đợt này không migration mới; đợt khuya sau đó thêm `0098`; chưa commit/deploy):** Vòng đời đơn hàng có cột **Trạng thái bốc** (Chưa bốc / Đang bốc / Đã bốc / Đã hủy), chỉ người có quyền `shipment.pick` nhận dữ liệu và thấy cột; Đã hủy xử lý như Chưa bốc (đã trả giữ chỗ, in lại được, không cảnh báo). In đơn → Đang bốc + giữ chỗ; in lại đơn Đang bốc = hủy lượt cũ và tạo lượt mới trong một giao dịch (`POST /api/shipment/pick` với `reassign: true`, lượt mới lỗi thì lượt cũ giữ nguyên). Dropdown chỉ cho Đang bốc → Đã bốc / Đã hủy (`POST /api/shipment/pick/status`); Đã bốc là trạng thái cuối (API `cancel` với chỉ định Đã bốc trả 409 `ALREADY_CONFIRMED`). Job `pickKiotReconcileJob.js` tự đổi theo Kiot (Hoàn thành → Đã bốc, Đã hủy → Chưa bốc; đơn Đã bốc không bị đụng). Đơn Đang bốc hoặc Đã bốc có tổng ST đã chỉ định khác SL đơn Kiot ở bất kỳ mã nào thì tô đỏ dòng + nhãn "Lệch SL bốc", tự hết khi Kiot khớp lại. Phiếu in đổi thứ tự cột (TT, Tên hàng, SL, Đơn giá, Thành tiền, Ghi chú, Vị trí, Thùng, Thực nhặt): ô Vị trí 1 vị trí chỉ ghi tên, từ 2 vị trí mỗi dòng `VT: SL` (SL in đậm); thẻ gợi ý trong hộp chỉ định có tên vị trí đậm ở góc trái, tổng SL góc phải, ghi chú thùng dòng dưới. `carton.js` đọc `a*B`/`aXB`/`axB` (không T) là `aTxB` và gộp số hạng cùng quy cách kể cả không liền kề (`9X12+1Tx20+1TX12` → `10T x 12 + 1T x 20`). Trang `/vt-positions/` thêm cột **Có thể bốc** (SL kho − giữ chỗ của đơn Đang bốc), xuất Excel 10 cột.

**Hộp chỉ định sửa ngay, phiếu sắp theo kho, nút Đã xử lý (27/10/2026 khuya, migration `0098` chưa áp DB, chưa commit/deploy):** (1) Bỏ nút **Chỉ định lại** trong hộp chỉ định: đơn **Đang nhặt** hiện đúng bản đã chỉ định và sửa được ngay vị trí/số lượng (không khóa); nút lưu đổi thành **Cập nhật chỉ định & In phiếu**, chỉ bật khi có thay đổi chưa lưu, lưu bằng `POST /api/shipment/pick` `reassign: true` kèm `version` (một giao dịch); khi có thay đổi chưa lưu thì **Xác nhận nhặt** và **In đơn** bị khóa để không xác nhận nhầm bản cũ. Đơn **Đã hủy** chỉ định mới ngay (không reassign); **Đã bốc** chỉ xem. Hủy nhặt xong hộp tải lại và gợi ý mới. (2) Thứ tự thẻ vị trí trong mỗi dòng theo ưu tiên của thuật toán thay vì theo tên kho: vị trí được gợi ý trước (SL gợi ý giảm dần), rồi vị trí còn hàng đủ SL cần (dư ít nhất trước), rồi còn hàng nhưng thiếu SL (nhiều hàng trước), hết hàng/chưa rõ SL ở cuối; thứ tự chỉ đổi khi gợi ý lại nên thẻ không nhảy chỗ khi sửa số lượng. (3) Phiếu in: dòng hàng sắp theo tên vị trí đầu tiên (chữ cái đầu cột Vị trí; các vị trí trong cùng dòng cũng sắp theo tên), dòng chưa có vị trí xuống cuối, cùng vị trí giữ thứ tự đơn; cột TT đánh lại 1, 2, 3… sau khi sắp. (4) Nút **Đã xử lý** trong khung Cảnh báo của hộp chi tiết đơn (chỉ người có `shipment.pick`) cho cảnh báo Lệch SL bốc: không đổi số lượng, gọi `POST /api/shipment/pick/mismatch-ack` `{branch, orderCode}` → `{assignment, mismatch}`, ghi `order_pick_history` action `mismatch_ack` kèm `summary.signature` (chữ ký số lệch lúc bấm); `pickMismatches` gắn `handled: {by, at}` cho từng dòng lệch khi chữ ký còn khớp — Kiot sửa tiếp làm số lệch đổi, hoặc chỉ định mới (reassign), thì cảnh báo hiện lại. Giao diện: nhãn **Đã xử lý** vàng và dòng tô vàng thay cho nhãn đỏ “Lệch SL bốc”. Lỗi 409 `INVALID_STATE` (đơn không ở Đang bốc/Đã bốc) và `NO_MISMATCH` (không còn lệch). Migration `0098_order_pick_history_mismatch_ack.sql` chỉ mở rộng CHECK `order_pick_history.action` thêm `mismatch_ack`; chưa áp thì bấm Đã xử lý trả 500, phần còn lại không ảnh hưởng (danh sách vẫn hiện nhãn đỏ).

Cập nhật gần nhất: 28/10/2026 (Đã sửa/người sửa theo mã đơn/xóa lịch sử VT, migration 0099; hộp chỉ định sửa ngay khi Đang nhặt/bỏ nút Chỉ định lại, thẻ vị trí theo ưu tiên thuật toán, phiếu in sắp theo vị trí kho, nút Đã xử lý cho Lệch SL bốc + migration `0098`; trạng thái bốc Đang bốc/Đã bốc tự động theo Kiot, phiếu in cột Thùng, cột Có thể bốc ở VT HN/SG; Vị trí HN/SG giữ như cũ; trang VT Hà Nội / VT Sài Gòn `/vt-positions/` với hộp chi tiết dòng, lọc Cảnh báo/Hợp lệ/Tất cả, xuất Excel lịch sử, migration `0095`, quyền `stockLocationsV2.view/edit/export`; Tra cứu VAT theo Mã VAT Kiot; Chỉ định vị trí trên Vòng đời đơn hàng và đợt sửa theo rà soát, migration `0096`/`0097`/`0098`, nhánh `feat/lifecycle-pick-assign`).
