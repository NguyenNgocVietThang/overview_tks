# TOKOSI Dashboard Server

Express backend cho dashboard TOKOSI.

## Nguồn dữ liệu

- KiotViet dashboard: Supabase PostgreSQL qua `dashboard/dashboardPgReader.js`.
- CN1/CN3/CN7: bảng `customer_debt_activity_periods` trong Supabase (công nợ 1/3/7 ngày, trước đây gọi là HN1/HN3/HN7).
- Trả NCC: người dùng tự upload file Excel xuất từ KiotViet; server nạp vào bảng Postgres `supplier_return_imports` (migration `0017`) — **không còn đọc tab Google Sheets Trả NCC**.
- Công nợ quản lý: workbook `DEBT_MANAGEMENT_SPREADSHEET_ID` (Google Sheets, chỉ đọc).
- Nhân sự và nghỉ phép: 3 bảng nền Postgres (`hr_leave_requests`, `hr_telegram_links`, `hr_telegram_sessions`, migration `0016`); workbook HR riêng dùng cho `HR_SPREADSHEET_ID`/`HR_SPREADSHEET_ID_SG`.
- Vòng đời đơn hàng: Google Sheets workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (`DonHang_HN`, `DonHang_SG`, `Lịch sử cập nhật`).
- Tài khoản và Telegram ID: PostgreSQL `app_users`; không dùng tab `Users` hoặc `_HR_TELEGRAM_LINKS` để liên kết.

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

`GET /api/shipment/lifecycle` (quyền `shipment.lifecycle`) trả **một trang** `{ orders, page, pageSize, totalPages, total, filteredTotal, kiotStatuses, kiot }`. Nguồn dòng = **mọi** đơn đặt hàng của Kiot HN + SG (Phiếu tạm, Đã xác nhận, Đang giao hàng, Hoàn thành, Đã hủy; ~60 nghìn đơn) ghép với Google Sheet theo `(cơ sở, mã đơn)` — cùng mã DH có thể tồn tại ở cả hai cơ sở nên không được ghép theo mã trần. Đơn có trên sheet giữ trạng thái vòng đời của sheet; đơn chỉ có ở Kiot nhận trạng thái thấp nhất `NOT_SENT` ("Đơn chưa gửi kế toán"), `source: 'kiotviet'`, **không** ghi đè trạng thái được; dòng sheet không khớp đơn Kiot nào bị bỏ khỏi bảng. Mỗi dòng có `kiotStatus` (trạng thái trên Kiot), `note` (ghi chú của đơn), `orderTotal`, `orderDate`, và `sellableValue` (chỉ đơn Phiếu tạm, còn lại `null`). Postgres lỗi → `kiot.ok = false` và trang vẫn trả đơn sheet kèm cảnh báo. Các API tra cứu cho vai trò Khách vẫn chỉ đọc sheet, không bao giờ thấy dữ liệu Kiot.

Query string (đều tùy chọn; giá trị sai → 400 kèm mã): `branch` (HN|SG), `status` (trạng thái vòng đời), `kiotStatus`, `dateField` (saleSentAt|at|orderDate) + `from`/`to` (YYYY-MM-DD), `mode` (code|sale|customer) + `q`, `sort` (orderCode, orderDate, saleName, customerName, orderTotal, sellableValue, note, saleSentAt, kiotStatus, status, at, warning) + `dir` (asc|desc), `page`, `pageSize` (mặc định 100, tối đa 200). Không chọn `sort` → đơn mới đặt nhất trước. Logic lọc / sắp xếp / cắt trang nằm trong `shipment/orderLifecycleQuery.js` (hàm thuần, kết quả lọc + sắp xếp được cache để lật trang không sắp xếp lại); danh sách đã gộp được dùng lại giữa các request khi dữ liệu nguồn không đổi (khóa có cả phút hiện tại vì cảnh báo quá 24h phụ thuộc đồng hồ). Trình duyệt chỉ nhận 1 trang (~8 KB) thay vì cả danh sách.

- `shipment/kiotOrdersRepository.js` — đọc đầu đơn của mọi trạng thái (một truy vấn ~2 giây, ~17 MB JSON thô) + dòng hàng **chỉ của đơn Phiếu tạm** + tồn thực của **đúng cơ sở của đơn**, rồi tính **Giá trị có bán** = Σ từng mặt hàng `min(SL đặt, max(0, tồn kho)) × đơn giá sau chiết khấu` (bỏ dòng mã `VAT*`; cùng mã hàng xuất hiện nhiều dòng thì gộp trước khi lấy min). Từ 2026-10-02 **không còn cộng hàng đang vận chuyển** vào số lượng có bán. Cache 2 phút kiểu stale-while-revalidate (hết hạn → trả ngay bản cũ và làm mới nền; lỗi → bản cũ đánh dấu `stale`, thử lại sau 15 giây; quá 15 phút mới chờ đọc lại).
- `GET /api/shipment/lifecycle/order-detail?code=<mã>&branch=HN|SG` — chi tiết đơn + từng dòng hàng kèm tồn kho / **Điều chuyển SG** (hàng đang vận chuyển, `dashboard/inTransitSource.js`; chỉ để tham khảo, không tính vào có bán) / có bán (404 `ORDER_NOT_FOUND`, 400 `INVALID_CODE` / `INVALID_BRANCH`).
- `POST /api/shipment/lifecycle/export` (quyền `shipment.export`, mặc định **chỉ Quản lý**) nhận **chính bộ tham số lọc / sắp xếp** của `GET /` (không cần `page`) và xuất **mọi dòng khớp**, tối đa 20.000 dòng (vượt → 400 `TOO_MANY_ROWS`; 60.000 dòng chặn máy chủ ~7 giây). File có thêm cột Ghi chú và Trạng thái KiotViet.
- Tên sale lấy từ Kiot có dạng `<tên> - <ID Telegram>`: `dashboard/saleName.js` (`stripTelegramId` / `saleNameSql`) bỏ hậu tố ID ở mọi nơi hiển thị (chỉ đổi hiển thị, dữ liệu gốc giữ nguyên).
- Công thức **Tồn có thể bán** dùng chung toàn dashboard: `Tồn thực tế − Đặt hàng Phiếu tạm (Khách đặt) + Hàng đang vận chuyển` (bảng "Cơ cấu tồn kho" tab Hàng hóa, bảng "Báo cáo hàng hóa" tab Tổng quan do job đêm `kiotvietSync/productReportRefresh.js` dựng, và các file xuất tương ứng).

## Bot Telegram quản lý nghỉ phép

Bot riêng cho quản lý chạy cùng tiến trình Express; `telegram/managerLeaveRuntime.js` quét Postgres theo chu kỳ mặc định 5 giây, xử lý sự kiện mới do bot xin nghỉ bên ngoài ghi trực tiếp và thử lại công việc giao tin còn tồn. `telegram/managerLeaveWebhook.js` nhận `POST /api/telegram/manager-leave/webhook`, kiểm tra header `X-Telegram-Bot-Api-Secret-Token` trước khi nhận cập nhật. Gọi Telegram API bằng native `fetch`, không thêm thư viện bot. `@electric-sql/pglite` chỉ là devDependency phục vụ kiểm thử SQL/migration.

- Gửi mọi đơn **Xin nghỉ phép** mới, kể cả trạng thái `Vi phạm`; lần quét đầu bù các đơn `Chưa duyệt`/`Tạm duyệt` chưa giao cho quản lý phù hợp. Bản ghi **Tự ý nghỉ (HR ghi nhận)** không gửi qua bot quản lý. Mốc `first_enabled_at` bền vững loại lịch sử đã kết thúc trước khi bật bot lần đầu; đơn mới tạo sau mốc này vẫn được gửi với quyết định hiện tại nếu web đã duyệt trước khi lượt quét xử lý.
- Người nhận phải có vai trò **Quản lý**, trạng thái hoạt động, Telegram ID và quyền `hr.leave.manage`. `coSo = Hà Nội` chỉ nhận Hà Nội, `Sài Gòn` chỉ nhận Sài Gòn, `Cả hai` nhận cả hai; cơ sở rỗng bị loại. Đây là phạm vi bot, không thay đổi bộ lọc xem cơ sở trên web. Mỗi quản lý phải bấm **Start** với bot mới dù ID đã có trong database.
- Nút quyết định gồm 5 trạng thái hiện có: `Chưa duyệt`, `Tạm duyệt`, `Đã duyệt`, `Từ chối`, `Vi phạm`. Chọn từ chối mở phiên nhập lý do: chỉ nhận reply đúng tin nhắn nhắc nhập, trim, tối đa 500 ký tự; có **Bỏ qua** hoặc **Hủy**, hết hạn sau 15 phút.
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

## Cấu hình Sheets

Server **không còn đọc tab Trả NCC** từ Google Sheets HN/SG (đã chuyển sang upload Excel vào Postgres `supplier_return_imports`). Service account vẫn cần quyền:
- **Viewer** trên workbook `DEBT_MANAGEMENT_SPREADSHEET_ID` (Công nợ HN/SG).
- **Viewer** trên workbook `ORDER_LIFECYCLE_SPREADSHEET_ID` (tra cứu vòng đời đơn hàng — server đọc tab `DonHang_HN`, `DonHang_SG`; ghi tab `Lịch sử cập nhật` nên cần **Editor**).
- **Viewer** (hoặc không cần) trên workbook HR — chỉ đọc `HR_SHEET_EMPLOYEES` để đồng bộ nhân sự.

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
| `0027` | `hr_rule_documents` — tài liệu "Quy định công ty" (2 tài liệu dựng sẵn `gio-giac`, `nghi-phep` + file PDF Quản lý tải lên lưu `BYTEA`); API `/api/hr/rules/documents*`, quyền `hr.rules` (xem) / `hr.rules.manage` (tải lên, gỡ, khôi phục mặc định); thêm/gỡ tài liệu báo lên chuông (`rule_document_added` / `rule_document_removed`) |
| `0027` | `hr_rule_documents` — lưu trữ tài liệu quy định công ty (dựng sẵn hoặc PDF upload trong Postgres BYTEA), thu hồi SELECT của reporting_readonly |
| `0028` | `idx_orders_phieu_tam` — chỉ mục một phần `orders (branch, id) WHERE raw->>'statusValue' = 'Phiếu tạm'` cho truy vấn đơn Phiếu tạm của trang Vòng đời đơn hàng (chưa áp chỉ mục code vẫn chạy đúng, chỉ chậm hơn: đo trên dữ liệu thật khi chưa có chỉ mục ~4 giây cho lần đọc nguội, các lần sau trong 60 giây dùng cache) |
| `0029` | `hr_leave_requests.decision_version` + `hr_leave_change_events`, `hr_leave_manager_messages`, `hr_manager_telegram_sessions`, `hr_manager_telegram_updates`, `hr_manager_telegram_state` — bot riêng cho quản lý và cầu DB → SSE; phải áp trước khi chạy bản web mới, kể cả khi bot tắt |

Bot **xin nghỉ của nhân viên** chạy ngoài repo và đọc/ghi 3 bảng nền nghỉ phép trực tiếp; bot **quản lý** trong `telegram/` dùng chung đơn và sở hữu các bảng bổ sung ở migration `0029`. Hợp đồng dữ liệu ở `db/SCHEMA.md`.

## Cập nhật gần nhất

2026-10-02 — Bổ sung kiến trúc, cấu hình, migration và hướng dẫn vận hành bot Telegram riêng cho quản lý nghỉ phép. Việc bật production cần thực hiện các bước kiểm tra trong hướng dẫn thiết lập.
