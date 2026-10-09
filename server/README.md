# TOKOSI Dashboard Server

Express backend cho dashboard TOKOSI.

## Nguồn dữ liệu

- Sổ quỹ: module `cashbook/` đọc `cash_flows`, `cash_book_accounts`, `staff` và mốc `sync_checkpoints` cho toàn công ty. API `/api/cashbook/{summary,entries,filter-options,sync-status,export}` bỏ qua cookie cơ sở. Tồn quỹ = tổng phiếu chưa hủy; quỹ ngân hàng gộp các ID HN/SG cùng số TK (cột Tồn quỹ HN/SG/Tổng). Quyền đọc `cashbook.view`; xuất xlsx/html chọn cột, tối đa 20.000 dòng. Không cache. Trang kiểm tra revision của cả HN/SG mỗi 15 giây, chỉ tải lại số liệu khi mốc thành công thay đổi; giữ bộ lọc/phân trang, tạm dừng khi ẩn/offline, thử lại với backoff 30–60 giây và giữ số cũ khi tải nền lỗi.
  Frontend `public/cashbook/index.html` dùng theme/shared-nav chung, lọc trên URL hash (giữ danh sách rỗng), debounce tìm tên/ID và SĐT 300ms, ngăn kéo mobile, phân trang máy chủ và xuất chọn cột riêng từng bảng. Ngày/giờ theo Việt Nam. `test/frontend/cashbook.test.js` trích script HTML để kiểm thử hành vi; không dùng DB production.

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

## Báo cáo Marketing (`/api/marketing-report`)

Tab `/reports/#marketing` gồm BC tháng, Check tỷ lệ nhận số, Sao lưu SĐT và Báo cáo chi phí; dùng Google Sheets chỉ đọc với ba biến `MARKETING_REPORT_SPREADSHEET_ID`, `MARKETING_PHONES_SPREADSHEET_ID`, `MARKETING_ADS_SPREADSHEET_ID`. Service account cần Viewer trên từng workbook, đặc biệt bổ sung workbook SĐT trước nghiệm thu. Không migration hoặc đồng bộ nền. Xem [cấu hình và nghiệm thu](../docs/marketing-report-setup.md).

`GET /api/marketing-report/metadata`, `/monthly`, `/receipt-check`, `/phones`, `/costs`, `/detail` đều cần đăng nhập + `reports.marketing` và trả `Cache-Control: no-store`. Quyền mặc định Quản lý, Trợ lý, Nhân viên Marketing. API chi tiết nhận loại báo cáo, khóa nguồn, tháng và bộ lọc, giữ cùng snapshot với tổng quan. Cache nguồn tối đa 5 phút, gộp yêu cầu trùng; các nguồn tải độc lập. Lỗi nguồn không tiết lộ chẩn đoán Google hoặc khóa riêng. Hỗ trợ xuất file xlsx/html qua `GET /api/marketing-report/export/fields` và `GET /api/marketing-report/export` (yêu cầu thêm quyền `reports.export`). Sửa Khách mới/Ghi chú qua `PUT /api/marketing-report/monthly/row` (yêu cầu quyền `reports.marketing.edit`).

## Báo cáo kinh doanh (`/api/business-report`)

Tab "Báo cáo kinh doanh" (`/reports/#business`) gồm 3 mục Tăng trưởng Sale / Khách hàng / Mã hàng theo tháng, từ T3/2026. Số liệu **luôn gộp HN + SG**, không theo bộ chọn cơ sở. Spec: [2026-10-07-business-report-design.md](../docs/superpowers/specs/2026-10-07-business-report-design.md).

- **Doanh số tháng** = Σ `invoices.total` của hóa đơn `Hoàn thành` (cùng điều kiện cột Trạng thái tab Hóa đơn, `INVOICE_STATUS_SQL`) theo tháng của `purchase_date` − Σ `|returns.total|` của phiếu trả `Đã trả` theo tháng của `return_date` (giờ VN). Khách = (cơ sở, mã KH); hóa đơn thiếu mã KH thì tìm mã theo tên chuẩn hóa (`CUSTOMER_BY_NAME_CTE`). Doanh số mã hàng phân bổ tổng chứng từ (đã trừ giảm giá cả đơn/giảm giá trả) cho từng dòng theo tỷ lệ thành tiền, nên tổng theo mã = tổng theo khách (lệch vài xu do làm tròn). SQL dùng chung ở `businessReport/businessMonthlySql.js`.
- **Sale** = nhóm khách **hiện tại** trên KiotViet (`customers.raw->>'groups'`) theo (cơ sở, mã KH); đổi nhóm thì cả lịch sử đi theo nhóm mới. Khách không có nhóm, khách lẻ, mã không tìm thấy → dòng "Chưa phân nhóm".
- **Tháng đã chốt** đọc từ các bảng `business_monthly_*` (migration `0036`); tháng hiện tại và tháng chưa có dòng `business_monthly_state` được tính trực tiếp bằng cùng câu SQL. Kết quả cache 60 giây kiểu stale-while-revalidate trong `businessReport/businessReportRepository.js`.
- Tính toán chỉ số (quy đổi 30 ngày, tăng trưởng, TB 4 tháng, khách hoạt động) nằm ở server (`businessReport/businessMonths.js`, `businessReportService.js`); API trả sẵn, frontend không tính lại.

| Endpoint | Quyền | Mô tả |
|---|---|---|
| `GET /api/business-report/sales` · `/customers` · `/products` | `reports.business` | `{ today, currentMonth, day, months, monthLabels, frozenMonths, computedAt, kpis, rows }`; mỗi dòng có `series` (doanh số theo tháng), `current`, `normalized`, `prev`, `growth` (`null` khi tháng trước ≤ 0), `avg4`, `active` |
| `GET /api/business-report/detail?kind=sale\|customer\|product&key=` | `reports.business` | Dữ liệu panel chi tiết. `key`: tên sale / `<branch>:<mã KH>` / mã hàng. Panel khách kèm `topProducts`, panel mã hàng kèm `topCustomers` (4 tháng gần nhất, tối đa 50 dòng). Không tìm thấy → 404, `kind` sai → 400 |
| `POST /api/business-report/refreeze` body `{ "month": "YYYY-MM" }` | `reports.business.refreeze` (mặc định chỉ Quản lý, cần `reports.business`) | Nút "Tính lại tháng": chốt lại một tháng đã qua (từ T3/2026, không nhận tháng hiện tại) rồi dựng lại bảng sale, xóa cache |
| `GET /api/business-report/export/fields?kind=...` | `reports.business` **và** `reports.export` | Danh sách trường (cột) cho hộp thoại "Xuất file" dùng chung, cùng dạng `/api/export/fields`, `rowCount` theo bộ lọc |
| `GET /api/business-report/export?kind=sales\|customers\|products&format=xlsx\|html&columns=...` | `reports.business` **và** `reports.export` | Xuất bảng theo bộ lọc `q`, `sale`, `branch`; bảng khách mặc định chỉ khách hoạt động, `inactive=1` lấy cả khách không hoạt động. `columns` = khóa cột cách nhau dấu phẩy (whitelist, sai/rỗng → 400 `INVALID_COLUMNS`; bỏ trống = tất cả). Tối đa 20.000 dòng (vượt → 400 `TOO_MANY_ROWS`) |

Chưa áp migration `0036` → các API trả 503 `BUSINESS_REPORT_NOT_READY` (giao diện hiện "Đang dựng dữ liệu tháng cũ…"). Mọi phản hồi gửi kèm `Cache-Control: no-store`.

## Vòng đời đơn hàng hợp nhất đơn KiotViet (mọi trạng thái)

`GET /api/shipment/lifecycle` (quyền `shipment.lifecycle`) trả **một trang** `{ orders, page, pageSize, totalPages, total, filteredTotal, kiotStatuses, kiot }`. Nguồn dòng = **mọi** đơn đặt hàng của Kiot HN + SG (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) ghép với Google Sheet theo `(cơ sở, mã đơn)` — cùng mã DH có thể tồn tại ở cả hai cơ sở nên không được ghép theo mã trần. Đơn có trên sheet giữ trạng thái vòng đời của sheet; đơn chỉ có ở Kiot nhận trạng thái thấp nhất `NOT_SENT` ("Đơn chưa gửi kế toán"), `source: 'kiotviet'`, **không** ghi đè trạng thái được; dòng sheet không khớp đơn Kiot nào bị bỏ khỏi bảng. Mỗi dòng có `kiotStatus` (trạng thái trên Kiot), `note` (ghi chú của đơn), `orderTotal`, `orderDate`, và `sellableValue` (chỉ đơn Phiếu tạm, còn lại `null`). Postgres lỗi → `kiot.ok = false` và trang vẫn trả đơn sheet kèm cảnh báo. Từ 2026-10-03 Tra cứu theo mã (`shipment.lookup`), Lịch sử (`shipment.history`), Xuất Excel (`shipment.export`) và Ghi đè trạng thái (`shipment.override`, mặc định chỉ Quản lý) **gắn vào `shipment.lifecycle`** (`requires` trong `featureRegistry.js`): thiếu Vòng đời đơn hàng thì các quyền này bị loại dù có cấp riêng; Khách/NV kho/marketing/mua hàng không còn trang này. Các API tra cứu vẫn chỉ đọc sheet.

Query string (đều tùy chọn; giá trị sai → 400 kèm mã): `branch` (HN|SG), `status` (trạng thái vòng đời), `kiotStatus`, `dateField` (saleSentAt|at|orderDate) + `from`/`to` (YYYY-MM-DD), `mode` (code|sale|customer) + `q`, `sort` (orderCode, orderDate, saleName, customerName, orderTotal, sellableValue, note, saleSentAt, kiotStatus, status, at, warning) + `dir` (asc|desc), `page`, `pageSize` (mặc định 100, tối đa 200). Không chọn `sort` → đơn mới đặt nhất trước. Logic lọc / sắp xếp / cắt trang nằm trong `shipment/orderLifecycleQuery.js` (hàm thuần, kết quả lọc + sắp xếp được cache để lật trang không sắp xếp lại); danh sách đã gộp được dùng lại giữa các request khi dữ liệu nguồn không đổi (khóa có cả phút hiện tại vì cảnh báo quá 24h phụ thuộc đồng hồ). Trình duyệt chỉ nhận 1 trang (~8 KB) thay vì cả danh sách.

- `shipment/kiotOrdersRepository.js` — đọc đầu đơn của mọi trạng thái (một truy vấn ~2 giây, ~17 MB JSON thô) + dòng hàng **chỉ của đơn Phiếu tạm** + tồn thực của **đúng cơ sở của đơn**, rồi tính **Giá trị có bán** = Σ từng mặt hàng `min(SL đặt, max(0, tồn kho)) × đơn giá sau chiết khấu` (bỏ dòng mã `VAT*`; cùng mã hàng xuất hiện nhiều dòng thì gộp trước khi lấy min). Từ 2026-10-02 **không còn cộng hàng đang vận chuyển** vào số lượng có bán. Cache 2 phút kiểu stale-while-revalidate (hết hạn → trả ngay bản cũ và làm mới nền; lỗi → bản cũ đánh dấu `stale`, thử lại sau 15 giây; quá 15 phút mới chờ đọc lại).
- `GET /api/shipment/lifecycle/order-detail?code=<mã>&branch=HN|SG` — chi tiết đơn + từng dòng hàng kèm tồn kho / **Điều chuyển SG** (hàng đang vận chuyển, `dashboard/inTransitSource.js`; chỉ để tham khảo, không tính vào có bán) / có bán (404 `ORDER_NOT_FOUND`, 400 `INVALID_CODE` / `INVALID_BRANCH`).
- `POST /api/shipment/lifecycle/export` (quyền `shipment.export`, mặc định **chỉ Quản lý**) nhận **chính bộ tham số lọc / sắp xếp** của `GET /` (không cần `page`) và xuất **mọi dòng khớp**, tối đa 20.000 dòng (vượt → 400 `TOO_MANY_ROWS`; 60.000 dòng chặn máy chủ ~7 giây). File có thêm cột Ghi chú và Trạng thái KiotViet.
- Tên sale lấy từ Kiot có dạng `<tên> - <ID Telegram>`: `dashboard/saleName.js` (`stripTelegramId` / `saleNameSql`) bỏ hậu tố ID ở mọi nơi hiển thị (chỉ đổi hiển thị, dữ liệu gốc giữ nguyên).
- Công thức **Tồn có thể bán** dùng chung toàn dashboard: `Tồn thực tế − Đặt hàng Phiếu tạm (Khách đặt)` (từ 2026-10-06 không còn cộng Hàng đang vận chuyển; cột Vận chuyển chỉ để xem) (bảng "Cơ cấu tồn kho" tab Hàng hóa, bảng "Báo cáo hàng hóa" tab Tổng quan do job đêm `kiotvietSync/productReportRefresh.js` dựng, và các file xuất tương ứng).

## Bot Telegram quản lý nghỉ phép

Bot riêng cho quản lý chạy cùng tiến trình Express; `telegram/managerLeaveRuntime.js` quét Postgres theo chu kỳ mặc định 5 giây, xử lý sự kiện mới do bot xin nghỉ bên ngoài ghi trực tiếp và thử lại công việc giao tin còn tồn. `telegram/managerLeaveWebhook.js` nhận `POST /api/telegram/manager-leave/webhook`, kiểm tra header `X-Telegram-Bot-Api-Secret-Token` trước khi nhận cập nhật. Gọi Telegram API bằng native `fetch`, không thêm thư viện bot. `@electric-sql/pglite` chỉ là devDependency phục vụ kiểm thử SQL/migration.

- Gửi mọi đơn **Xin nghỉ phép** mới, kể cả trạng thái `Vi phạm`; lần quét đầu bù các đơn `Chưa duyệt` chưa giao cho quản lý phù hợp. Bản ghi **Tự ý nghỉ (HR ghi nhận)** không gửi qua bot quản lý. Mốc `first_enabled_at` bền vững loại lịch sử đã kết thúc trước khi bật bot lần đầu; đơn mới tạo sau mốc này vẫn được gửi với quyết định hiện tại nếu web đã duyệt trước khi lượt quét xử lý.
- Người duyệt đang hoạt động, có `hr.leave.manage`, phòng ban được cấp và cơ sở được gán phù hợp với đơn; nhân viên được cấp quyền cũng được duyệt và được tự duyệt. Gửi tất cả người phù hợp, một quyết định thành công chốt phiên bản. Nếu không có người phù hợp, dùng quản trị cao nhất đang hoạt động; thiếu cả dự phòng thì giữ chờ và cảnh báo. Telegram ID/Start chỉ quyết định khả năng giao tin, không quyết định có người duyệt web. Mỗi người nhận Telegram phải có ID và bấm Start.
- Phê duyệt và Từ chối. Từ chối mở Mini App (`public/telegram/leave-reject.html`), xác thực initData 15 phút, lý do tùy chọn tối đa 500 ký tự; OK trống vẫn lưu người/thời điểm, Hủy không ghi. Phiên reply cũ được hỗ trợ đến hết hạn. `/donnghi` lọc phòng ban,10 đơn/trang.
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
- **Phân quyền** nằm ở `auth/featureRegistry.js` (quyền mặc định theo vai trò + ghi đè riêng từng tài khoản trong `app_users.feature_permissions`, và `requires` cho quyền phụ thuộc). Nhóm: Báo cáo tổng hợp (`reports.*`), Quản lý đơn hàng (`shipment.*`), Vị trí hàng (`stockLocations.view`), Quản lý nhân sự (`hr.*`), Sổ quỹ (`cashbook.view`, `cashbook.manage`), Quản lý tài khoản (`account.*`), Hệ thống (`system.syncStatus`). Sổ quỹ đặt ngay sau Nhân sự; mặc định chỉ Quản lý có quyền, chốt số dư cần quyền xem. Sidebar có liên kết cấp 1 `/cashbook/` ngay dưới Quản lý nhân sự, hiện theo quyền xem và không phụ thuộc cơ sở. `GET /api/auth/me` trả `permissions`, `pageFeatures`, `isSeniorAdmin`; `auth/pageGuard.js` chặn trang theo quyền, bao gồm `/cashbook`, `/cashbook/` và `/cashbook/index.html` trước static.
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

Sổ quỹ tách lịch riêng 60 giây. `KIOTVIET_CASHBOOK_SYNC_ENABLED=true` cho phép chỉ chạy `cash_flows` và danh mục tài khoản khi engine tổng tắt; `KIOTVIET_CASHBOOK_SYNC_INTERVAL_MS` không được nhỏ hơn 60 giây. Giao diện tự làm mới qua endpoint revision mỗi 15 giây khi tab hiển thị; hướng dẫn triển khai và giới hạn độ trễ ở [cashbook-setup.md](../docs/cashbook-setup.md).

Webhook KiotViet đi vào `POST /api/kiotviet/webhook/<KIOTVIET_WEBHOOK_SECRET>` (secret sai → 404; đường dẫn cũ không secret còn mở trong giai đoạn chuyển tiếp cho tới khi đặt `KIOTVIET_WEBHOOK_LEGACY_PATH_ENABLED=false`). Server trả 200 ngay rồi đưa payload vào hàng đợi nền (`kiotviet/webhookEventQueue.js`); webhook chỉ lưu thô vào `webhook_events_raw`, dữ liệu nghiệp vụ do polling cập nhật. Trạng thái đồng bộ xem ở `GET /api/internal/kiotviet-sync/status` (quyền `system.syncStatus`).

| Nhóm / job | Nội dung | Nhịp |
|---|---|---|
| Polling **fast** | `invoices`, `orders`, `product_on_hands`, `product_on_hands_snapshot` (quét toàn bộ tồn kho, tối đa 10 phút/lần), `order_suppliers` (Đặt hàng nhập) | 7 phút, sau mỗi lượt tính lại ngay rollup "nóng" 7 ngày rồi phát SSE `dashboard-updated` |
| Polling **slow** | `categories`, `products`, `customers`, `returns`, `purchases` (đối soát toàn bộ từ mốc sàn đứt hàng 01/02/2026) | 20 phút |
| Sổ quỹ | `cash_flows` HN/SG, đọc lại 7 ngày; đối soát toàn bộ lịch sử mỗi ngày | 60 giây (`KIOTVIET_CASHBOOK_SYNC_INTERVAL_MS`, tối thiểu 60 giây), không chồng lượt; bật khi engine tổng bật hoặc `KIOTVIET_CASHBOOK_SYNC_ENABLED=true` |
| Rollup đầy đủ | `daily_invoice_summary`, `daily_product_sales`, `product_first_purchase` (cửa sổ 400 ngày) | 30 phút |
| CN1/CN3/CN7 | `customerDebtReportRefresh.js` → `customer_debt_activity_periods` | 5 phút |
| Báo cáo hàng hóa | `productReportRefresh.js` → `product_report`, `product_report_customers` | kiểm tra mỗi 5 phút, tính **1 lần/đêm** |
| Chi tiết hóa đơn 90 ngày theo khách | `customerInvoiceLinesRefresh.js` → `customer_invoice_lines_90d` | kiểm tra mỗi 5 phút, dựng 1 lần/đêm sau 00:10 VN |
| Giá trị tồn kho | `inventoryValueSnapshot.js` → `inventory_value_snapshots` | kiểm tra mỗi phút, chụp lúc 23:59 VN |
| Báo cáo kinh doanh | `businessMonthlyRefresh.js` → `business_monthly_customer_sales`, `business_monthly_customer_product_sales`, `business_monthly_product_sales`, `business_monthly_sale_sales`, `business_monthly_state` | kiểm tra mỗi 5 phút; chốt tháng vừa qua khi ≥ 00:10 VN ngày mùng 1, mỗi tháng **1 lần**; dựng sale khi hash nhóm hiện tại khác `group_hash` đã lưu hoặc sau chốt/chốt lại (chỉ ghi dòng đổi) |

**Job Báo cáo kinh doanh** (`kiotvietSync/businessMonthlyRefresh.js`, đăng ký trong `scheduler.js`): mỗi lượt đọc `business_monthly_state`, chốt mọi tháng từ T3/2026 đến tháng vừa qua còn thiếu (lần khởi động đầu tiên sau khi áp `0036` sẽ backfill T3 → tháng trước), rồi so hash nhóm hiện tại với `business_monthly_state.group_hash`; chỉ chạy `REBUILD_SALE_SQL` khi khác hoặc hash NULL sau chốt/chốt lại. Hash dùng nhóm hiệu lực của khách canonical theo cơ sở/mã trim/ID mới nhất, nhóm rỗng mặc định "Chưa phân nhóm"; bỏ thay đổi trường khác và khách trùng mã cũ. Sale và hash được ghi cùng giao dịch, lỗi rollback cả hai; hash bền qua restart. Khóa state/khách tháng tuần tự hóa freeze/rebuild, SHARE trên customers giữ nhóm đồng nhất trong giao dịch (có thể chờ tác vụ sync customers). `customer_id` trên bảng tháng lưu ID canonical hoặc NULL nếu không khớp. Chốt một tháng = `DELETE` + `INSERT … SELECT` theo tháng cho 3 bảng khách / khách × mã / mã và ghi dòng state, tất cả trong **một giao dịch** (`work_mem` 32MB, không TRUNCATE). Lỗi thì giao dịch rollback, tháng chưa được coi là đã chốt và lượt 5 phút sau thử lại. Chạy tay (trong `server/`):

```bash
node kiotvietSync/businessMonthlyRefresh.js            # chốt các tháng còn thiếu + dựng lại bảng sale
node kiotvietSync/businessMonthlyRefresh.js 2026-09    # chốt LẠI đúng tháng 2026-09 rồi dựng lại bảng sale
```

Tham số tháng phải đúng `YYYY-MM`, từ `2026-03` và **đã kết thúc** theo lịch VN (cùng kiểm tra với nút "Tính lại tháng"); sai thì in lỗi, thoát mã 2 và không ghi gì. Lý do: chốt tháng đang chạy sẽ ghi dòng state cho tháng đó, job ngày mùng 1 tháng sau sẽ coi tháng ấy là đã chốt và không chốt lại. Kiểm tra: `SELECT * FROM business_monthly_state ORDER BY month`.

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
| `0031` | Phạm vi phòng ban tài khoản, snapshot phòng ban bằng trigger tương thích bot nhân viên, `hr_manager_telegram_cards`; áp trước ứng dụng mới |
| `0032` | Chuẩn hóa hai nhóm bộ phận `BAN QUẢN TRỊ` và `HẬU CẦN - BẢO VỆ` trong nhân sự, đơn nghỉ và phạm vi duyệt phép; giữ quyền tài khoản hiện tại |
| `0033` | Sổ quỹ: `account_id`/`status` phiếu thu chi, danh mục tài khoản chung HN + SG (`cash_book_accounts`), lịch sử chốt số dư (`cash_book_checkpoints`); sync bankaccounts khi bảng trống lúc startup và mỗi 24 giờ |
| `0034` | `cash_book_account_banks` — tên ngân hàng do Quản lý nhập tay theo số tài khoản (HN/SG cùng số TK dùng chung), hiện dưới tên tài khoản ở bảng Số dư của Sổ quỹ |
| `0035` | `cash_flows.source_missing_at` — đánh dấu các ID không còn trên nguồn trong kỳ đối soát Sổ quỹ để giữ toàn vẹn lịch sử và không làm sai lệch số dư |
| `0036` | Báo cáo kinh doanh: `business_monthly_customer_sales`, `business_monthly_customer_product_sales`, `business_monthly_product_sales`, `business_monthly_sale_sales`, `business_monthly_state` — doanh số theo tháng đã chốt; job `kiotvietSync/businessMonthlyRefresh.js` tự backfill từ T3/2026 ở lần khởi động đầu tiên sau khi áp (chạy tay: `node kiotvietSync/businessMonthlyRefresh.js`). Chưa áp thì API Báo cáo kinh doanh trả 503 |
| `0037` | `sale_teams` — bảng phân chia Team cho từng sale (nạp từ `chia team.xlsx`), phục vụ cột Team và bộ lọc Team ở bảng Doanh số theo sale; cập nhật bằng `node scripts/importSaleTeams.js <file.xlsx>` |
| `0038` | Hạn đăng ký nghỉ phép & lịch làm việc: `hr_leave_work_schedules` (lịch làm việc theo ngày/nhân viên), `hr_leave_submissions` (lịch sử gửi đơn bất biến), snapshot thời gian và tính toán hạn nộp / trạng thái `timing_status` (`Đúng hạn`/`Xin muộn`/`Vi phạm`) |
| `0039` | Thêm tài liệu dựng sẵn thứ 3 `phuc-loi` ("Chi tiêu & Phúc lợi") vào `hr_rule_documents` (nội dung nằm trong HTML trang Quản lý nhân sự) |
| `0040` | `account_audit_log` — lịch sử chỉnh sửa tài khoản (tab `/account/#history`, quyền `account.users`): tạo, sửa thông tin, đặt lại mật khẩu, xóa, sửa phân quyền; chỉ thêm (trigger chặn UPDATE/DELETE), không FK tới `app_users`, thu hồi SELECT của `reporting_readonly` |
| `0041` | `hr_employees.employment_status` — trạng thái làm việc của nhân sự (`active` = Đang làm việc, `resigned` = Đã nghỉ việc); tự động khóa tài khoản liên kết khi nghỉ việc (`lock_reason = 'hr_resigned'`) và mở khóa lại khi kích hoạt |
| `0042` | `hr_leave_submissions.hr_employee_id DROP NOT NULL` — cho phép mọi tài khoản nội bộ đang hoạt động (trừ Khách) dù chưa gắn hồ sơ nhân sự vẫn gửi được đơn xin nghỉ phép qua web; cơ sở lấy từ đơn, giờ ca làm việc mặc định sáng 07:45 / chiều 12:30 |

Bot **xin nghỉ của nhân viên** chạy ngoài repo và đọc/ghi 3 bảng nền nghỉ phép trực tiếp; bot **quản lý** trong `telegram/` dùng chung đơn và sở hữu các bảng bổ sung ở migration `0029`. Hợp đồng dữ liệu ở `db/SCHEMA.md`.

## Cập nhật gần nhất
2026-10-09 — **Nghỉ phép: tài khoản nội bộ chưa gắn hồ sơ nhân sự vẫn gửi đơn (migration `0042`)**: tài khoản nội bộ đang hoạt động không gắn `hr_employee_id` được phép tự gửi đơn web; cơ sở lấy từ đơn, giờ bắt đầu mặc định 07:45 sáng / 12:30 chiều. `hr_leave_submissions.hr_employee_id` chuyển sang nullable.

2026-10-09 — **Quản lý trạng thái nhân sự (`employment_status`, migration `0041`)**: tách trạng thái làm việc `active`/`resigned` khỏi xóa mềm `is_active`. Chuyển sang `resigned` tự khóa tài khoản với `lock_reason = 'hr_resigned'`; chuyển lại `active` mở đúng khóa này.

2026-10-09 — **UI dùng chung & table controls**: chuẩn hóa `public/shared/table-controls.js` (chọn cột, kéo chỉnh độ rộng cột, phân trang) và tiện ích `search-clear` trên toàn bộ các trang; tắt controls cho bảng quy định chế độ phúc lợi.

2026-10-08 — **Báo cáo Marketing**: tích hợp đối chiếu doanh số KiotViet theo tên khách hàng; Quản lý/Marketing có thể sửa trực tiếp Khách mới và Ghi chú đồng bộ ngược lại Google Sheets (`PUT /api/marketing-report/monthly/row`); hỗ trợ xuất báo cáo định dạng XLSX và HTML.

2026-10-08 — **Lịch sử chỉnh sửa tài khoản (`account_audit_log`, migration `0040`)**: tab `/account/#history` ghi log bất biến mọi thao tác tạo, sửa thông tin, đặt lại mật khẩu, xóa và thay đổi phân quyền chi tiết của quản trị viên.

2026-10-08 — **Tài liệu Chi tiêu & Phúc lợi (migration `0039`)**: thêm tài liệu dựng sẵn thứ 3 `phuc-loi` vào `hr_rule_documents`.

2026-10-08 — **Báo cáo kinh doanh: cột Team của sale (`sale_teams`, migration `0037`)**: thêm cột Team và bộ lọc Team cho bảng Doanh số theo sale (nạp từ `chia team.xlsx`); gộp khách hàng theo tên chuẩn hóa từ cả 2 cơ sở HN và SG; nút Xuất file mở modal chọn cột cho cả 3 bảng.

2026-10-08 — **Hạn nộp & lịch làm việc nghỉ phép (`hr_leave_work_schedules`, migration `0038`)**: snapshot thời gian gửi tại DB, ca làm việc cố định 07:45 sáng / 12:30 chiều, phân loại `timing_status` Đúng hạn / Xin muộn / Vi phạm.

2026-10-08 — **Sổ quỹ: 5 nhóm tài khoản số dư**: hiển thị tổng số dư theo 5 nhóm tài khoản (`account_balance_groups`), phân tách cột ngân hàng riêng và bộ lọc nhóm số dư.


2026-10-07 — **Báo cáo kinh doanh**: tab mới `/reports/#business` (quyền `reports.business`, tính lại tháng `reports.business.refreeze`), API `/api/business-report/*`, job chốt tháng `kiotvietSync/businessMonthlyRefresh.js` và migration `0036`. Sau deploy: áp `0036` (`npm run db:migrate`), khởi động lại để job backfill T3 → tháng trước, kiểm tra `business_monthly_state`. Chưa áp migration hoặc triển khai production.

2026-10-06 — Thêm trang Sổ quỹ `public/cashbook/` và kiểm thử frontend cho bộ lọc, hash, tiền, thời điểm chốt, stale response, drawer/dialog và xuất file. Đã nghiệm thu trên trình duyệt với PGlite cục bộ; hướng dẫn vận hành ở [docs/cashbook-setup.md](../docs/cashbook-setup.md). Chưa áp migration hoặc triển khai production.

2026-10-06 — Thêm backend Sổ quỹ và kiểm thử số dư/SQL/giao dịch trên PGlite cục bộ. Không xác nhận đã áp migration hoặc triển khai production.

2026-10-05 — Phạm vi duyệt phòng ban/cơ sở, tự xin nghỉ web, Mini App và `/donnghi`, inbox nhanh, cột người dùng. Migration `0031`; [kết quả kiểm chứng](../tasks/2026-10-05-hr-approval/todo.md). Chưa nghiệm thu production.

2026-10-05 — Rà soát toàn bộ tài liệu theo code (HEAD `11751c4`): thêm mục Tài khoản/đăng ký/ID Telegram, migration `0030`, sửa lỗi bảng migration (trùng `0027`), bỏ mô tả workbook HR (không còn dùng) và chỉnh nút duyệt của bot quản lý (chỉ Phê duyệt / Từ chối).

2026-10-02 — Bổ sung kiến trúc, cấu hình, migration và hướng dẫn vận hành bot Telegram riêng cho quản lý nghỉ phép. Việc bật production cần thực hiện các bước kiểm tra trong hướng dẫn thiết lập.

## Nâng cấp nghỉ phép 05/10/2026

`hr/hrLeaveAuthorization.js` dùng chung quyền web/Telegram; `hr/hrLeaveSelfService.js` lấy danh tính HR hoạt động. API `/api/hr/leave-requests/self` nhận ngày/buổi, lý do, bàn giao; `/self/context` trả hồ sơ hiển thị. PATCH trạng thái bắt buộc `expectedVersion`, trả 409 nếu đã đổi. `hr.leave.absence.manage` riêng cho tự ý nghỉ. Inbox bot độc lập giao tin; ACK sau lưu bền vững. [Hợp đồng và nghiệm thu](../docs/hr-leave-upgrade.md).

Đơn tự gửi web lấy `telegram_chat_id` từ liên kết tài khoản trên server. Khi quyết định đơn `source=web` không có chat, service đặt `decision_notified_at` để bot nhân viên không thử gửi tới chat rỗng; thông báo web vẫn được tạo. Với đơn có chat và đơn từ bot nhân viên, chu kỳ NULL → gửi kết quả → đánh dấu và reset khi đổi trạng thái giữ nguyên.

2026-10-07 — Sửa phân loại quỹ theo Cash thay cho account_id rỗng, chuẩn hóa timestamp API sang +07:00, đối soát lịch sử cash_flows mỗi ngày và replay 7 ngày giữa các lần đối soát; ghi theo lô và tự sửa cột account/status/time bị phiên đồng bộ cũ để trống hoặc hiểu sai múi giờ. Cần migration `0035_cash_flows_source_presence.sql` để giữ lịch sử các ID không còn trên nguồn bằng dấu `source_missing_at`, không xóa bản ghi.

Bao cao kinh doanh: khi chua ap migration 0036 hoac chua backfill du thang tu T3/2026, GET sales/customers/products van tra HTTP 200 voi `notReady: true`, bang va KPI tinh live cho cac thang chua chot. UI hien "Đang dựng dữ liệu tháng cũ…". Thang hien tai gioi han den thoi diem hien tai theo gio VN gan nhan UTC; chi loi 42P01 cua cac bang business_monthly duoc fallback, loi DB khac van bao loi.
