# Báo cáo kinh doanh — thiết kế (2026-10-07) (tab cấp 2 trong Báo cáo tổng hợp)

## Context
Hiện tại, báo cáo tăng trưởng theo Sale, Khách và Mã hàng đang làm tay trên Google Sheets (xem ảnh mẫu). Tên sale trên hóa đơn và phiếu trả không chuẩn, nên **sale = nhóm khách hàng trên KiotViet** (`customers.raw->>'groups'`). Mục tiêu: một tab mới `#business` trong `/reports`, gồm 3 mục Tăng trưởng Sale, Tăng trưởng Khách hàng và Tăng trưởng Mã hàng. Doanh số các tháng trước được chốt cứng trong DB, còn tháng hiện tại tính theo thời gian thực.

## Quyết định đã chốt với người dùng
- **Phạm vi:** luôn gộp HN + SG, không theo bộ chọn cơ sở.
- **Khoảng tháng:** từ **T3/2026**. DB có dữ liệu từ 05/02, nên bỏ T2 vì thiếu ngày.
- **Doanh số theo tháng:** Σ `invoices.total` của hóa đơn 'Hoàn thành' (đã trừ giảm giá cả đơn) − Σ `returns.total` của phiếu 'Đã trả' (đã trừ giảm giá trả).
  - Hóa đơn tính theo tháng của `purchase_date`; phiếu trả tính theo tháng của `return_date` (giờ VN).
  - Lọc theo `raw->>'statusValue'`.
- **Mã hàng:** tính bằng tiền, từ dòng chi tiết. Giảm giá cả đơn (và giảm giá trả) được **phân bổ theo tỷ lệ** thành tiền của từng dòng, để tổng theo mã khớp tổng theo khách.
- **Định danh:**
  - Khách = (cơ sở, mã KH). Cùng một mã ở HN và SG là 2 khách khác nhau: kiểm chứng thấy chỉ 4/1.726 cặp trùng tên.
  - Mã hàng = `code`, gộp 2 cơ sở: 3.615/3.638 cặp trùng tên.
  - Sale = tên nhóm, gộp 2 cơ sở.
  - Hóa đơn không có mã KH thì khớp theo tên chuẩn hóa, giống `CUSTOMER_BY_NAME_CTE` ở `kiotvietSync/customerInvoiceLinesRefresh.js`.
- **Đổi nhóm:** toàn bộ lịch sử đi theo **nhóm hiện tại**. Bảng sale lưu cứng phải dựng lại khi nhóm đổi.
- **Khách không có nhóm và khách lẻ:** gộp vào dòng **"Chưa phân nhóm"**.
- **Quy đổi 30 ngày:** `tháng này × 30 / số ngày đã qua (gồm hôm nay)`.
  - Tăng trưởng = quy đổi / tháng trước × 100%. Tháng trước = 0 thì hiện "—".
  - TB 4 tháng = (3 tháng chốt cứng gần nhất + quy đổi tháng này) / 4.
- **Khách hoạt động:** TB 4 tháng > 0. "SL Khách" của sale đếm các khách này.
- **Cột bảng Sale:** Sale, SL Khách, TB 4 tháng, Tăng trưởng, Tháng hiện tại (đến dd/mm), rồi T(n-1) … T3.
  - Không có "Khách mới", "TB 7 tháng" hay "Level giá".
- **Cột bảng Khách:** Mã KH, Tên, Cơ sở, Sale, Level giá (= `raw->>'comments'`), rồi các cột số liệu như bảng Sale.
  - Mặc định chỉ hiện khách hoạt động.
  - Có ô tìm kiếm, lọc theo Sale, lọc theo cơ sở, và công tắc "Hiện cả khách không hoạt động".
- **Cột bảng Mã hàng:** Mã, Tên, rồi các cột số liệu.
- **Chốt tháng:** tự chạy lúc ≥ 00:10 VN ngày mùng 1 cho tháng vừa qua. Có nút **"Tính lại tháng"** cho Quản lý.
- **Panel chi tiết:** thẻ tổng quan cùng biểu đồ cột theo tháng. Ngoài ra:
  - Sale: danh sách khách, bấm vào khách thì mở panel khách.
  - Khách: top mã hàng trong 4 tháng.
  - Mã hàng: top khách trong 4 tháng.
- **Quyền:** key `reports.business`, theo `REPORT_VIEW_ROLES` như các tab báo cáo khác.
- **UI theo đúng design system bảng hiện có:**
  - Mỗi mục có KPI tổng quan ở đầu.
  - Bảng có tìm kiếm, cuộn dọc, phân trang và sắp xếp.
  - Xuất Excel và xuất HTML (có biểu đồ), theo `reports.export`.

## Kiến trúc dữ liệu

### Migration `server/db/migrations/0036_business_monthly_sales.sql`
| Bảng | Khóa | Cột |
|---|---|---|
| `business_monthly_customer_sales` | (month, branch, customer_code) | customer_id, customer_name, invoice_amount, return_amount, net_revenue, invoice_count, return_count |
| `business_monthly_product_sales` | (month, product_code) | product_name, net_revenue, net_qty |
| `business_monthly_customer_product_sales` | (month, branch, customer_code, product_code) | net_revenue, net_qty (đã phân bổ giảm giá) |
| `business_monthly_sale_sales` | (month, sale_name) | net_revenue, customer_count |
| `business_monthly_state` | month | frozen_at, source counts, `group_hash` |

Ghi chú:
- `month` có kiểu `date`, là ngày 1 của tháng.
- Bảng `business_monthly_customer_product_sales` vừa phục vụ panel (top mã / top khách), vừa là nguồn của bảng mã hàng. Ước tính khoảng 15K dòng/tháng.
- Bảng `business_monthly_sale_sales` được dựng lại khi nhóm khách đổi.
- Không cần GRANT (mig 0010 đã đặt default privileges). Cập nhật thêm `db/SCHEMA.md`.

### Job `server/kiotvietSync/businessMonthlyRefresh.js`
Theo khuôn của `productReportRefresh.js` / `inventoryValueSnapshot.js` (`refresh`, `…IfDue`, `start…Schedule`, `main` để chạy tay).
- **`freezeMonth(pool, month)`:**
  - Một SQL cho mỗi bảng, dùng bảng tạm + `DELETE`/`INSERT` theo tháng, không TRUNCATE (bài học IO ở sự cố Supabase).
  - Chạy trong 1 giao dịch.
  - Khung tháng tính theo `D::timestamp AT TIME ZONE 'UTC'` (`WINDOW_START_SQL`).
  - Tái dùng biểu thức `RETURN_AMOUNT_SQL` / `DETAIL_AMOUNT_SQL` (`dashboard/customerProductTopRepository.js:75-83`), cùng `INVOICE_STATUS_SQL` / `CUSTOMER_BY_NAME_CTE` (`customerInvoiceLinesRefresh.js`). Nên tách các biểu thức này ra một module SQL dùng chung thay vì chép thêm lần nữa.
- **`rebuildSaleTable(pool)`:**
  - Gom `business_monthly_customer_sales` JOIN nhóm hiện tại của khách theo (branch, code). Trống thì gán "Chưa phân nhóm".
  - Chỉ chạy khi hash nhóm khách thay đổi, hoặc sau mỗi lần chốt.
- **Lịch chạy:**
  - Mỗi 5 phút: nếu tháng trước chưa có state và đã qua 00:10 ngày 1 thì chốt.
  - Lần đầu sau deploy: backfill từ T3/2026 đến tháng trước.
  - Kiểm tra hash nhóm, nếu khác thì dựng lại bảng sale.
  - Đăng ký trong `kiotvietSync/scheduler.js`.

### Repository / API `server/dashboard/businessReportRepository.js` + `server/routes.js`
- **Tháng hiện tại (live):** cùng SQL như khi chốt, nhưng giới hạn trong khung `[ngày 1, now]`. Cache khoảng 60 giây (stale-while-revalidate như `kiotOrdersRepository`).
- **Endpoint:** `router.use('/api/business-report', ...reportsUser('reports.business'))`.
  - `GET /sales`, `GET /customers`, `GET /products`: trả về `months[]`, các dòng và KPI.
  - `GET /detail?kind=sale|customer|product&key=…`: dữ liệu cho panel.
  - `POST /refreeze?month=` (chỉ Quản lý): tính lại tháng.
  - `GET /export?kind=&format=xlsx|html`.
- **Hàm thuần dùng chung (có unit test):** `normalizeTo30Days`, `growthPct`, `avg4Months`, `isActive`. Phải đặt chúng trong module JS dùng được cả ở server và frontend.

### Frontend `server/public/index.html` + `public/shared/shared-nav.js`
- `reportItems` thêm `{feature:'reports.business', view:'business', label:'Báo cáo kinh doanh'}`. Thêm nút sub-nav và section `view-business`, có 3 mục Sale / Khách hàng / Mã hàng.
- Cập nhật `REPORT_VIEW_NAMES`, `renderView`, `viewIsLoaded`, `ensureViewData`.
- Panel: thêm `DOC_DETAIL_KINDS` mới (`businessSale`, `businessCustomer`, `businessProduct`), dùng `#docModalBody`. Biểu đồ cột Chart.js vẽ bằng `renderBarChartList` / `destroyChart`.
- KPI đầu mục dùng `renderSectionKpis`. Bảng tái dùng thành phần tìm kiếm / phân trang / sắp xếp / xuất của các bảng hiện có.

### Phân quyền `server/auth/featureRegistry.js`
- Thêm `reports.business` vào FEATURES và `REPORT_VIEW_FEATURES`. Nút "Tính lại tháng" kiểm tra quyền Quản lý ở server.

## Xử lý lỗi
- Bảng chưa migrate hoặc chưa backfill: API trả `{ notReady: true }`, UI hiện "Đang dựng dữ liệu tháng cũ…", tháng hiện tại vẫn tính live.
- Job lỗi: ghi log, lượt 5 phút sau thử lại; state không ghi thì tháng chưa được coi là chốt.

## Kiểm chứng
1. Unit test (`node --test`): hàm quy đổi, tăng trưởng, chia 0, TB 4 tháng, "Chưa phân nhóm"; SQL chốt tháng trên PGlite (theo harness có sẵn) gồm giảm giá phân bổ, phiếu trả khác tháng, khớp mã theo tên.
2. Đối chiếu trên DB thật (chỉ SELECT / giao dịch ROLLBACK):
   - Σ sale = Σ khách = Σ mã hàng (lệch ≤ vài đồng do làm tròn phân bổ) = tổng doanh thu ròng tháng của rollup hiện có.
   - So vài sale trong ảnh, ví dụ Khang T9 ≈ 5.443.819.645.
3. Mở trang qua harness xem trang không đăng nhập (`reference-tokosi-view-pages-without-login`): kiểm tra bảng, lọc, panel, biểu đồ, xuất Excel/HTML.
4. Toàn bộ test suite `npm test` (chạy nền).

## Việc sau deploy
Áp migration 0036. Lần khởi động đầu tiên job sẽ tự backfill T3–T9; có thể chạy tay bằng `node kiotvietSync/businessMonthlyRefresh.js`.
