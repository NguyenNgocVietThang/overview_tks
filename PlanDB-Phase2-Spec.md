# Spec: Phase 2 — Cutover "Báo cáo tổng hợp" khỏi Google Sheets sang PostgreSQL

> Tài liệu con của [`PlanDB.md`](PlanDB.md) mục 8 (Phase 2), viết theo `spec-driven-development`. Kế thừa toàn bộ hạ tầng của [`PlanDB-Phase1-Spec.md`](PlanDB-Phase1-Spec.md) (schema + sync engine). Spec này **chỉ thiết kế lớp đọc (read layer)** trên dữ liệu Postgres đã có — không đụng schema, không đụng sync engine. Phase 3 (DB làm nguồn chính) có spec riêng, ngoài phạm vi.

---

## ⚠️ Điều kiện tiên quyết — CHẶN CỨNG, xác nhận trước khi viết bất kỳ dòng code nào

Phase 1 hiện **đã code xong nhưng chưa từng chạy thật** (xác nhận qua audit trực tiếp 2026-08-30: không có log `sync:once`/`sync:start`/`backfill`, `server/db|kiotviet|kiotvietSync` vẫn ở trạng thái untracked). Trước khi bắt đầu code Phase 2, phải xác nhận với chủ dự án rằng **cả 5 điều sau đã xảy ra**:

1. `npm run db:migrate` đã chạy thành công trên Postgres thật (không phải chỉ test schema).
2. `npm run sync:once` đã chạy ít nhất 1 lần, ghi `sync_run_log.status='success'` cho đủ 10 entity × mỗi branch đang active.
3. `npm run sync:backfill --branch=hanoi --from=2026-01-01` (và `--branch=saigon` nếu SG đã cấu hình) đã chạy xong, phủ dữ liệu tới hiện tại.
4. `sync:start` (daemon dài hạn) đã chạy ổn định một khoảng thời gian đủ để tin tưởng (đề xuất: tối thiểu vài ngày liên tục không có lỗi treo, `consecutive_error_count` tự phục hồi về 0 sau mỗi lỗi thoáng qua nếu có).
5. Đối chiếu nhanh thủ công: số dòng `invoices`/`customers`/`products`/... trong Postgres không lệch bất thường so với số liệu đang thấy trên Sheets/dashboard hiện tại.

**Nếu chưa đủ 5 điều trên → dừng, không code.** Lý do file spec này vẫn được viết trước khi Phase 1 live-verify xong: để sẵn sàng bắt tay vào ngay khi được xác nhận, không mất thời gian thiết kế lại vào lúc đó.

---

## Giả định khác (xác nhận trước khi code, hoặc sửa tài liệu này nếu sai)

1. Toàn bộ nguyên tắc kiến trúc ở PlanDB.md mục 3, và toàn bộ schema/sync engine ở PlanDB.md mục 6-7 (đã hiện thực ở Phase 1) giữ nguyên, không mở lại.
2. Response shape của 5 hàm đọc chính (`getDashboardData`, `getDashboardExportSnapshot`, `searchDashboardRecords`, `searchTopCustomersByProducts`, `getCustomerProductRevenueReport`) và 2 hàm export (`getExportFields`, `createExportWorkbook`) phải **giữ nguyên 100%** — cùng tên field, cùng kiểu dữ liệu, cùng thứ tự sort mặc định — để `server/public/index.html`/`shared-nav.js` không cần sửa bất kỳ dòng nào.
3. **Không làm báo cáo gộp 2 chi nhánh** (quyết định phỏng vấn 2026-08-30). Mọi hàm mới vẫn nhận đúng 1 `branch` string (`'Hà Nội'`|`'Sài Gòn'`) như `dashboardData.js` hiện tại — không có khái niệm "cả 2" ở Phase 2.
4. **Rollback bằng git revert, không thêm cờ chuyển nguồn dữ liệu** (quyết định phỏng vấn 2026-08-30). Không thêm biến môi trường kiểu `DASHBOARD_DATA_SOURCE=sheets|postgres`.
5. Mã trạng thái (`status`) của invoices/orders/returns/purchases **chưa được xác minh ý nghĩa thật** qua API KiotViet (xem PlanDB.md §9). Phase 2 copy đúng điều kiện lọc mà `dashboardData.js` hiện tại đang dùng (đọc code cũ để biết chính xác, không suy diễn ý nghĩa mới) — đảm bảo hành vi không đổi dù ý nghĩa `status` còn mơ hồ.
6. Chỉ 2 vai trò (`Quản lý`, `Trợ lý`) thực sự nhìn thấy nhóm nav "Báo cáo tổng hợp" (`shared-nav.js:605-621`) — phạm vi người dùng thực tế của toàn bộ Phase 2 chỉ 2 vai trò này, không ảnh hưởng vai trò khác.
7. `pg.Pool` thứ 2 (của web server, bên cạnh pool của sync engine) dùng `max` thấp (đề xuất 5, giống Phase 1) — tổng 2 pool phải nằm trong giới hạn kết nối gói Postgres đã mua (PlanDB.md §9).

---

## 1. Mục tiêu & phạm vi

Sau Phase 2, 5 route sau đọc hoàn toàn từ PostgreSQL, không còn gọi `sheetsClient`:

| Route | Hàm hiện tại (Sheets) | Hàm mới (Postgres) |
|---|---|---|
| `GET /api/dashboard` | `getDashboardData` | cùng tên, module mới |
| `GET /api/search` | `searchDashboardRecords` | cùng tên, module mới |
| `GET /api/customer-product-top` | `searchTopCustomersByProducts` | cùng tên, module mới |
| `GET /api/customer-product-revenue` | `getCustomerProductRevenueReport` | cùng tên, module mới |
| `POST /api/export`, `/api/export/fields` | `createExportWorkbook`, `getExportFields` (từ `exportService.js`, dùng snapshot của `dashboardData.js`) | cùng tên, đọc snapshot từ module mới |

**Không phải mục tiêu (non-goal, ghi rõ để tránh hiểu lầm phạm vi)**:
- Không làm báo cáo gộp 2 chi nhánh.
- Không đổi UI/frontend (`index.html`, `shared-nav.js`) — response shape giữ nguyên nên không cần đổi.
- Không đụng `src-dashboard/` (Apps Script), `server/sheets/sheetsClient.js` (module dùng chung), `auth/userRepository.js`, `shipment/*`, `hr/*`, `stockoutCheck/*` — các tính năng này tiếp tục đọc Sheets bình thường.
- Không sửa schema hay sync engine của Phase 1.
- Không thêm cache layer mới phức tạp hơn cache hiện có — xem mục 9 (Caching) để biết chiến lược đơn giản hóa.

**Done khi**: cả 6 tab của "Báo cáo tổng hợp" (Tổng quan/Hàng hóa/Hóa đơn/Khách hàng/Nhà cung cấp/Công nợ) chạy 100% trên Postgres; không còn dòng code nào trong `server/dashboard/` gọi `sheetsClient`; dashboard hiển thị với người dùng y hệt như trước.

---

## 2. Tech Stack

Giống hệt Phase 1 — không thêm dependency mới:

| Hạng mục | Giá trị |
|---|---|
| DB driver | `pg` (đã có từ Phase 1), không ORM |
| Test | `node:test`, DB test thật (không mock `pg`) |
| Pool | Dùng `getPool()` từ `server/db/pool.js` (Phase 1) — web server và sync engine **không dùng chung 1 pool object trong cùng process** (web server tạo pool riêng của mình, sync engine chạy process khác) |

## 3. Commands

Thêm 1 script mới vào `server/package.json` → `scripts` (giữ nguyên toàn bộ script hiện có + 4 script Phase 1):

```json
"verify:dashboard-parity": "node scripts/compareDashboardSources.js"
```

- Test: `npm test` (không đổi, tự nhặt `*.test.js` mới trong `server/dashboard/`).
- Xác minh khớp số liệu trước cutover: `npm run verify:dashboard-parity -- --branch=hanoi --from=2026-01-01 --to=2026-08-30` (xem mục 8).

## 4. Cấu trúc thư mục

Tạo file mới **song song**, không sửa file cũ ngay từ đầu — 2 bản tồn tại đồng thời chỉ trong lúc dev/xác minh (không phải chạy song song production; xem PlanDB.md §2 "không phải thêm đường đọc mới chạy song song mãi mãi"):

```
server/dashboard/
  dashboardData.js        -- (giữ nguyên, KHÔNG sửa cho tới bước cutover cuối)
  debtReport.js            -- (giữ nguyên, KHÔNG sửa cho tới bước cutover cuối)
  exportService.js         -- (giữ nguyên, KHÔNG sửa cho tới bước cutover cuối)

  dashboardDataPg.js        -- MỚI: bản Postgres, cùng chữ ký export với dashboardData.js
  dashboardDataPg.test.js
  debtReportPg.js            -- MỚI: thay parseDebtSheet, tính công nợ trực tiếp từ Postgres
  debtReportPg.test.js
  queries/                   -- MỚI: các hàm SQL thuần theo từng nhóm, dashboardDataPg.js gọi vào đây
    overviewQueries.js
    productQueries.js
    invoiceQueries.js
    customerQueries.js
    supplierQueries.js
    searchQueries.js
    *.test.js

server/scripts/
  compareDashboardSources.js       -- MỚI: CLI so sánh output Sheets vs Postgres, KHÔNG tự động hóa vào CI
  compareDashboardSources.test.js
```

**Bước cutover cuối** (chỉ làm sau khi mục 8 xác minh pass, và sau khi hỏi lại chủ dự án — xem mục 10 Boundaries):
1. `server/routes.js` đổi `require('./dashboard/dashboardData')` → `require('./dashboard/dashboardDataPg')` (và tương tự cho `exportService.js` nếu cần đổi nguồn snapshot).
2. Xóa hoặc rút gọn `dashboardData.js`/`debtReport.js` — bỏ `require('../sheets/sheetsClient')` khỏi 2 file này (hoặc xóa hẳn file, tùy quyết định lúc đó). Giữ nguyên trong lịch sử git để revert nếu cần.
3. Đổi tên `dashboardDataPg.js` → `dashboardData.js` (bỏ hậu tố `Pg`) trong cùng commit cutover, để tên file dài hạn không mang dấu vết "phiên bản tạm" — chỉ làm sau khi đã xác nhận ổn định, không làm ngay từ đầu.

## 5. Hợp đồng module `dashboardDataPg.js`

Cùng chữ ký hàm với `dashboardData.js` hiện tại (xem audit — export tại dòng ~2174-2199 của bản cũ):

```js
'use strict';

async function getDashboardData(filters, branch) { ... }
// Trả về CÙNG shape với bản Sheets: object gồm filter-range mỗi view
// (overview/products/invoices/customers/newPurchases/newProducts) + các section
// KPI/list tương ứng + debt: { 1: {...}, 3: {...}, 7: {...} } (từ debtReportPg.js).

async function getDashboardExportSnapshot(filters, branch) { ... }
async function searchDashboardRecords(view, q, limit, mode, filterSpec, branch) { ... }
async function searchTopCustomersByProducts(q, filterSpec, now, branch) { ... }
async function getCustomerProductRevenueReport(code, name, branch, now) { ... }

module.exports = {
  getDashboardData,
  getDashboardExportSnapshot,
  searchDashboardRecords,
  searchTopCustomersByProducts,
  getCustomerProductRevenueReport
};
```

- Nhận `pool` qua dependency injection giống convention Phase 1 (`db/pool.js`), không `require` singleton trực tiếp bên trong hàm nghiệp vụ nếu tránh được — nhưng vì đây là code phục vụ route (không phải sync engine), có thể chấp nhận `require('../db/pool').getPool()` ở top-level module giống style hiện có của `sheetsClient.js` (đã dùng client singleton tương tự) — **quyết định khi code, ưu tiên nhất quán với style `sheetsClient.js` mà module này thay thế, không nhất thiết theo đúng style `kiotvietSync/`**.
- `branch` param: string `'Hà Nội'`|`'Sài Gòn'` — map sang `branch_id` qua 1 lần `SELECT id FROM branches WHERE name = $1` (cache kết quả map này trong RAM vĩnh viễn, `branches` gần như không đổi).

### 5.1. Nhóm Tổng quan (`overview`) — `queries/overviewQueries.js`

- `revenueToday`: `SUM(total_payment) FROM invoices WHERE branch_id=$1 AND purchase_date::date = (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date` (giữ đúng filter `status` hiện tại của `dashboardData.js` — đọc code cũ để copy chính xác điều kiện, không suy diễn).
- Revenue-by-day series (`overviewPeriod`/`invoicesPeriod`): `GROUP BY date_trunc('day', purchase_date AT TIME ZONE 'Asia/Ho_Chi_Minh')` trong khoảng filter.
- `recentInvoices`: `ORDER BY purchase_date DESC LIMIT N`.
- Top sản phẩm/danh mục bán chạy: `JOIN invoice_line_items` → `GROUP BY product_id` → `ORDER BY SUM(line_amount) DESC`.
- Cancelled counts: filter theo đúng `status` code hiện tại dùng cho "đã hủy" trong `dashboardData.js`.

### 5.2. Nhóm Hàng hóa (`products`) — `queries/productQueries.js`

- `totalProducts`/`allProducts`: từ bảng `products` (+ `product_inventory` cho tồn kho), filter `branch_id`, `is_active`.
- `totalStock`/`lowStock`: aggregate `product_inventory.on_hand` (cộng dồn nếu 1 sản phẩm có nhiều dòng `kiotviet_branch_id` — xem PlanDB.md §6.2 lý do bảng này tách riêng).
- `stockByCategory`/`stockValueByCategory`: `JOIN products → categories`, `GROUP BY category_id`.
- Sản phẩm mới nhập (`newProducts` filter): từ `purchase_line_items`/`created_at` trong khoảng filter.

### 5.3. Nhóm Hóa đơn (`invoices`) — dùng chung `invoiceQueries.js` với 5.1

Filter theo `inFrom`/`inTo` (giữ tên param `in*` như `parseFilterSpec` hiện tại ở `routes.js:132-139`, không đổi tên).

### 5.4. Nhóm Khách hàng (`customers`) — `queries/customerQueries.js`

- `buildTopCustomersByRevenue` (`top15`/`top50`): `SUM(invoices.total_payment) GROUP BY customer_id ORDER BY SUM DESC`, filter theo khoảng ngày `cu*`.
- `searchTopCustomersByProducts`: cần `JOIN invoice_line_items` để lọc theo sản phẩm cụ thể trong query text `q`.
- `getCustomerProductRevenueReport(code, name, branch, now)`: doanh thu 1 khách theo từng sản phẩm — `JOIN customers → invoices → invoice_line_items`, `GROUP BY product_id`.

### 5.5. Nhóm Nhà cung cấp (`suppliers`) + Nhập hàng (`newPurchases`) — `queries/supplierQueries.js`

- Trực tiếp từ bảng `suppliers` (đã có `total_purchased`/`total_purchased_net_of_returns` được sync engine tính sẵn ở Phase 1 — **ưu tiên đọc trực tiếp các cột này thay vì tự `SUM` lại từ `purchases`**, tránh trùng logic và lệch số nếu KiotViet tính khác công thức đơn giản).
- `newPurchases` (đơn nhập trong kỳ): `JOIN purchases → suppliers`, `GROUP BY supplier_id`.

### 5.6. Tìm kiếm (`searchDashboardRecords`) — `queries/searchQueries.js`

- `view` param quyết định bảng nguồn: `overview`/`invoices` → `invoices`; `products` → `products`; `customers` → `customers`; v.v. — map 1-1 theo đúng `view` key hiện tại.
- `mode='codes'`: tìm theo danh sách mã cụ thể (multi-code lookup) — dùng `WHERE code = ANY($1::text[])`, giữ đúng shape response `{requestedCount, matchedCount, missingCount}`.

## 6. Module `debtReportPg.js` — thay thế `parseDebtSheet`

### 6.1. Bối cảnh thuật toán gốc (đã đọc `src-dashboard/kiotviet/CustomerDebtReport.gs`)

Báo cáo Công nợ HN1/HN3/HN7 (period = 1/3/7 ngày gần nhất) **không phải sổ cái lưu trữ** — GAS tính lại từ đầu mỗi lần chạy bằng cách đi lùi từ số dư nợ hiện tại:

1. `closingDebt` (nợ cuối kỳ) = giá trị **sống** của field `debt` trên KiotViet customer — đã có sẵn trong Postgres là `customers.debt_amount` (do `customersSync.js` cập nhật mỗi lượt sync).
2. Với cửa sổ N ngày gần nhất (N ∈ {1,3,7}, tính từ `now`): gom giao dịch phát sinh trong cửa sổ của khách đó —
   - Hóa đơn (`invoices`, filter `status=1` — xem `CustomerDebtReport.gs:56`) → ghi nợ (**debit**, `value = +total_payment`).
   - Trả hàng (`returns`) → ghi có (**credit**, `value = -return_total`).
   - Phiếu thu (`cash_flows` WHERE `is_receipt=true`) → ghi có (**credit**, `value = -amount`).
   - Phiếu chi (`cash_flows` WHERE `is_receipt=false`) → ghi nợ (**debit**, `value = +amount`).
3. `openingDebt = closingDebt - debit + credit` (tính lùi — xem `CustomerDebtReport.gs:506`).
4. Replay từng giao dịch theo thời gian tăng dần (`ORDER BY time ASC`), `runningDebt` bắt đầu từ `openingDebt`, cộng dồn `value` của từng giao dịch (`CustomerDebtReport.gs:511-515`).
5. **Chỉ đưa khách có ít nhất 1 giao dịch trong cửa sổ vào báo cáo** (`CustomerDebtReport.gs:489-492`) — không liệt kê khách nợ cũ nhưng không phát sinh gì trong N ngày.
6. Sắp xếp kết quả theo `closingDebt` giảm dần (`CustomerDebtReport.gs:517-520`).

⚠️ **Chưa xác minh chính xác biên giờ của cửa sổ N ngày** (điểm bắt đầu/kết thúc, có làm tròn theo ngày lịch múi giờ Asia/Ho_Chi_Minh hay theo giờ tuyệt đối `now - N*24h`) — xem `getCustomerDebtReportRange_` tại `CustomerDebtReport.gs:168-190`, phải đọc kỹ hàm này khi code, không suy diễn từ tóm tắt trong spec này.

### 6.2. Hợp đồng hàm

```js
async function computeDebtReport(pool, branchId, days, now) {
  // days ∈ {1, 3, 7}
  // Trả về CÙNG shape với parseDebtSheet cũ: { customers: [...], kpi: {...} }
  // kpi: { totalClosingDebt, totalDebit, totalCredit, customersWithDebt, customersCount }
}

module.exports = { computeDebtReport };
```

`dashboardDataPg.js` gọi `computeDebtReport` 3 lần (days=1,3,7) để dựng `debt: {1:{...}, 3:{...}, 7:{...}}` — đúng shape mà `getDashboardData` cũ trả về.

### 6.3. Chiến lược truy vấn (gợi ý, tinh chỉnh khi code)

- Bước 1: tìm tập `customer_id` "ứng viên" — có ít nhất 1 dòng trong `invoices`/`returns`/`cash_flows` (branch tương ứng) trong cửa sổ N ngày (`UNION` 3 subquery `SELECT DISTINCT customer_id`).
- Bước 2: với tập ứng viên đó, `JOIN customers` lấy `debt_amount` hiện tại + lấy toàn bộ giao dịch trong cửa sổ (4 loại) bằng 3-4 query riêng (không cố gộp 1 query phức tạp — đơn giản hơn tối ưu sớm, đúng convention code style hiện có).
- Bước 3: gộp trong JS (không phải SQL) theo đúng thuật toán ở 6.1 — vì bước replay `runningDebt` tuần tự theo thời gian là logic thủ tục, khó biểu diễn gọn bằng SQL thuần (có thể dùng window function `SUM() OVER (PARTITION BY customer ORDER BY time)` nhưng ưu tiên viết JS dễ đọc/dễ test hơn, giống cách `aggregateCustomerDebtReport_` gốc cũng làm bằng JS chứ không phải SQL).

## 7. `server/scripts/compareDashboardSources.js` — script xác minh trước cutover

CLI, không phải route production, không chạy trong CI tự động:

```
node scripts/compareDashboardSources.js --branch=hanoi --from=2026-01-01 --to=2026-08-30 [--customers=KH001,KH002]
```

- Gọi `dashboardData.js` (bản Sheets, cũ) và `dashboardDataPg.js` (bản Postgres, mới) với **cùng filter object**, cho cả 2 branch, chia theo từng tháng trong khoảng `--from`/`--to`.
- Diff sâu (deep-equal) từng field số tiền/số lượng; các field snapshot text (`*_snapshot`) chấp nhận sai khác nhỏ về khoảng trắng/hoa-thường nếu cần (ghi rõ trong output).
- In báo cáo lệch ra console: `[MISMATCH] overview.revenueToday tháng 2026-03: Sheets=12,000,000 vs Postgres=11,850,000`.
- **Không tự động sửa gì** — chỉ là công cụ chẩn đoán cho người chạy quyết định có đủ tin tưởng để cutover hay chưa.
- Chạy riêng cho tab Công nợ với vài khách hàng cụ thể có lịch sử giao dịch phức tạp (nhiều hóa đơn + trả hàng + thu chi trong cùng 1-3 ngày) — đây là phần rủi ro cao nhất.

## 8. Quy trình cutover (bước 2-4 của PlanDB.md §8 Phase 2)

1. Code xong `dashboardDataPg.js` + `debtReportPg.js` + `queries/*` (song song, không đụng file cũ).
2. Chạy `verify:dashboard-parity` cho **toàn bộ khoảng backfill** (2026-01-01 → hiện tại) × cả 2 branch. Sửa lỗi lệch cho tới khi khớp tuyệt đối các trường tiền tệ (cho phép sai số làm tròn ở mức chấp nhận được, nêu rõ ngưỡng khi code — ví dụ ≤1 đồng do làm tròn `NUMERIC` vs float cũ).
3. Sau khi khớp: đổi `require` trong `routes.js` sang module mới (mục 4, bước cutover cuối).
4. Xóa `require('../sheets/sheetsClient')` khỏi `dashboardData.js`/`debtReport.js` (hoặc xóa hẳn 2 file, tùy quyết định — **hỏi chủ dự án trước khi xóa hẳn**, xem Boundaries mục 10).
5. Deploy, theo dõi vài ngày, sẵn sàng `git revert` nếu phát hiện lệch số liệu mà `verify:dashboard-parity` không bắt được (ví dụ do dữ liệu mới phát sinh sau lúc verify).

## 9. Caching

Cache RAM hiện tại (90s, nhiều `Map` theo branch trong `dashboardData.js`) tồn tại chủ yếu để giảm số lần gọi Google Sheets API (chậm, có giới hạn quota). Postgres với index đã thiết kế ở Phase 1 (mục 6, mọi FK dùng JOIN đều có index) phục vụ các truy vấn này nhanh hơn nhiều — **đề xuất bỏ tầng cache "độ mới 90 giây" theo mặc định**, chỉ giữ lại 1 lớp dedupe request đồng thời trùng nhau (nếu 2 request giống hệt tới cùng lúc, chia sẻ 1 promise thay vì query 2 lần) để tránh query trùng khi nhiều tab/người dùng bấm cùng lúc. Đo lại thời gian phản hồi thực tế khi code — nếu 1 query nào đó (ví dụ `getCustomerProductRevenueReport` join nhiều bảng) chậm bất ngờ, thêm cache ngắn hạn (5-15s) riêng cho query đó, không áp dụng đồng loạt.

## 10. Testing Strategy

- Runner: `node --test` (không đổi). Test DB thật (schema test riêng, migrate qua `migrate.js` trong `before()`/`after()`), giống Phase 1 — không mock `pg`.
- Test bắt buộc cho mỗi module `queries/*.js`: seed vài dòng dữ liệu biết trước (customers/invoices/products/...), gọi hàm, so khớp field-by-field với giá trị kỳ vọng tính tay.
- Test riêng cho `debtReportPg.js` — **quan trọng nhất**: dựng dữ liệu giả cho 1 khách hàng với `debt_amount` biết trước + vài hóa đơn/trả hàng/phiếu thu/phiếu chi rải trong 7 ngày, tính tay `openingDebt`/`closingDebt`/`runningDebt` theo đúng công thức mục 6.1, so khớp với `computeDebtReport()`. Test case biên: khách không có giao dịch nào trong cửa sổ → không xuất hiện trong kết quả.
- Test cho `dashboardDataPg.js`: so khớp shape trả về với 1 snapshot cố định của `dashboardData.js` cũ (dùng `getDashboardExportSnapshot` của bản cũ, chạy 1 lần thủ công, lưu làm fixture JSON) — phát hiện sớm nếu quên field nào.
- `compareDashboardSources.js` có test riêng: dùng dữ liệu giả nhỏ, cố tình gây 1 sai lệch, xác nhận script phát hiện đúng và in ra rõ ràng.
- **Không** cần coverage % cụ thể — tiêu chí: mỗi module `queries/*.js` + `debtReportPg.js` có tối thiểu test khớp field-by-field + 1 test case biên (dữ liệu rỗng/null).

## 11. Boundaries (Phase 2)

- **Luôn làm**: giữ nguyên response shape của cả 5 hàm đọc + 2 hàm export; dependency injection cho `pool`; viết test khớp field-by-field trước khi coi 1 nhóm (overview/products/invoices/customers/suppliers/debt) là xong; chạy `verify:dashboard-parity` full khoảng backfill trước khi cutover route.
- **Hỏi trước khi làm**: xóa hẳn `dashboardData.js`/`debtReport.js`/`exportService.js` cũ (vs. chỉ gỡ phần đọc Sheets, giữ file rỗng/deprecated) — vì đây là bước khó đảo ngược nhanh trên production; đổi ngưỡng sai số chấp nhận được trong `verify:dashboard-parity` nếu phát hiện lệch nhỏ hệ thống (ví dụ do làm tròn) mà không chắc do lỗi logic hay do khác biệt tính toán hợp lệ.
- **Không bao giờ làm**: sửa `server/sheets/sheetsClient.js`; đụng `auth/userRepository.js`, `server/shipment/*`, `server/hr/*`, `server/dashboard/stockoutCheck/*`; sửa bất kỳ file nào trong `src-dashboard/`; sửa schema/migration/sync engine của Phase 1 (`server/db/migrations/`, `server/kiotvietSync/`); làm báo cáo gộp 2 chi nhánh; thêm biến môi trường chuyển đổi nguồn dữ liệu; hardcode ý nghĩa mới cho mã `status` khi chưa xác minh qua API thật — chỉ copy nguyên điều kiện lọc `status` hiện có.

## 12. Success Criteria — "Done khi"

- [ ] Điều kiện tiên quyết (mục đầu file) đã được chủ dự án xác nhận đủ 5 điều trước khi bắt đầu code.
- [ ] `dashboardDataPg.js`, `debtReportPg.js`, `queries/*.js` code xong, đủ test theo mục 10, `npm test` pass toàn bộ (cũ + mới).
- [ ] `npm run verify:dashboard-parity` chạy khớp tuyệt đối (trong ngưỡng sai số đã thống nhất) cho toàn bộ khoảng 2026-01-01 → hiện tại, cả 2 branch.
- [ ] `git diff` (sau cutover) cho thấy `server/routes.js` trỏ sang module Postgres; `git grep -n "sheetsClient" server/dashboard` trả về rỗng.
- [ ] `git grep -n "googleapis\|GOOGLE_SERVICE_ACCOUNT_JSON" server/dashboard/dashboardDataPg.js server/dashboard/debtReportPg.js server/dashboard/queries` trả về rỗng.
- [ ] Dashboard hiển thị với người dùng thật (Quản lý/Trợ lý) y hệt như trước cutover — kiểm tra bằng mắt trên vài kỳ lọc khác nhau sau khi deploy.
- [ ] `src-dashboard/`, `server/sheets/sheetsClient.js`, `server/auth/`, `server/shipment/`, `server/hr/`, `server/dashboard/stockoutCheck/` không bị đụng (`git diff` rỗng cho các đường dẫn này).

## 13. Rủi ro & câu hỏi cần xác minh khi code

1. **Biên giờ chính xác của cửa sổ 1/3/7 ngày** trong tính công nợ — đọc kỹ `getCustomerDebtReportRange_` (`CustomerDebtReport.gs:168-190`) trước khi code `computeDebtReport`, đừng suy diễn từ mục 6.1 của spec này.
2. **Điều kiện lọc `status` hiện tại của từng bảng** (invoices/orders/returns) trong `dashboardData.js` — phải đọc chính xác code cũ (không phải đoán) trước khi viết query Postgres tương đương, vì ý nghĩa mã `status` chưa được xác minh qua API thật (PlanDB.md §9).
3. **Sai số làm tròn `NUMERIC` (Postgres) vs. float/Number (JS đọc Sheets cũ)** — `verify:dashboard-parity` cần định nghĩa ngưỡng chấp nhận được (ví dụ ≤1 đồng) thay vì yêu cầu khớp bit-for-bit, nhưng bất kỳ lệch nào vượt ngưỡng phải điều tra tới gốc rễ, không tự động làm tròn để "cho khớp".
4. **`customers.debt_amount` có đang được `customersSync.js` cập nhật đúng nhịp** (15 phút theo PlanDB.md §7.3) — nếu có độ trễ lớn hơn dự kiến so với số liệu Sheets tại đúng thời điểm so sánh, `verify:dashboard-parity` có thể báo lệch giả (false mismatch) do lệch thời điểm chụp ảnh, không phải lỗi logic — cần chạy so sánh ngay sau 1 lượt sync mới để giảm nhiễu này.
5. **Hiệu năng query tổng hợp** (đặc biệt `getCustomerProductRevenueReport`, `searchTopCustomersByProducts` — join `invoice_line_items` có thể rất lớn sau backfill từ 2026-01-01) — đo thời gian phản hồi thật trước khi quyết định có cần thêm cache/index bổ sung ngoài mục 6-7 của PlanDB.md.

---

*Tài liệu này chỉ bao phủ Phase 2. Phase 3 (DB làm nguồn chính) viết spec riêng khi tới lượt, liên kết ngược lại `PlanDB.md` mục 8.*
