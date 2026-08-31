# Spec: Phase 1 — Database + Ingest KiotViet (PostgreSQL)

> Tài liệu con của [`PlanDB.md`](PlanDB.md), viết theo `spec-driven-development`. Chỉ bao phủ **Phase 1** (mục 8 của PlanDB.md): dựng PostgreSQL + sync engine đọc KiotViet cho cả 2 chi nhánh. **Không đổi route web nào, không đụng Google Sheets/GAS.** Phase 2 (cutover route) và Phase 3 (DB làm nguồn chính) có spec riêng, không nằm trong tài liệu này.

## Giả định (xác nhận trước khi code, hoặc sửa tài liệu này nếu sai)

1. Toàn bộ quyết định kiến trúc ở PlanDB.md mục 3, 4, 5, 6 giữ nguyên — spec này không mở lại các quyết định đó, chỉ cụ thể hoá thành file/hàm/test.
2. `pg` chưa có trong `server/package.json` — Phase 1 thêm dependency mới này (bản `^8.x` mới nhất tại thời điểm code). Không thêm ORM nào khác.
3. KiotViet Public API hỗ trợ lọc theo `lastModifiedFrom` (hoặc tham số tương đương) cho các endpoint liệt kê — **codebase hiện tại (`src-dashboard/`, `server/jobs/syncCustomerReport.js`) chưa từng dùng tham số này**, chỉ lọc theo `fromPurchaseDate`/`fromOrderDate`/full-poll. Đây là giả định **chưa được xác minh**, xem mục "Rủi ro cần xác minh sớm" — nếu sai, mục 6 (checkpoint) phải đổi chiến lược cho từng entity riêng.
4. `server/dashboard/stockoutCheck/kiotVietClient.js` và `server/dashboard/stockoutCheck/concurrencyPool.js` được trích xuất **nguyên vẹn logic**, chỉ đổi vị trí file + tên export nếu cần — không refactor hành vi (giữ nguyên retry/backoff/token cache).
5. Render Postgres đã được tạo thủ công bởi chủ dự án trước khi bắt đầu bước 1 (ngoài phạm vi code) — spec này giả định `DATABASE_URL` sẽ tồn tại trong `.env`/biến môi trường Render khi migration chạy.

---

## 1. Mục tiêu

Sau Phase 1, có một tiến trình Node long-running đồng bộ 10 entity KiotViet (2 tài khoản Hà Nội/Sài Gòn, độc lập hoàn toàn) vào PostgreSQL, đúng nguyên tắc kiến trúc ở PlanDB.md mục 3. Chưa có route web nào đọc từ Postgres — dữ liệu tồn tại để Phase 2 dùng, nhưng Phase 1 tự nó phải **verify được bằng `sync_run_log`/`sync_checkpoints`**, không phụ thuộc Phase 2 để biết Phase 1 đúng hay sai.

## 2. Tech Stack

| Hạng mục | Giá trị |
|---|---|
| Runtime | Node 22.x (giữ nguyên `engines` hiện có) |
| DB driver | `pg` (node-postgres), không ORM |
| Migration | File `.sql` đánh số tay + runner viết tay (`server/db/migrate.js`) |
| Test | `node:test` (built-in), dependency-injection cho `pg.Pool` và KiotViet client — **không thêm test framework mới** |
| Hosting DB | Render Postgres, kết nối qua `DATABASE_URL` chuẩn |
| Process | 1 Node process dài hạn, `setTimeout` nối tiếp — không cron ngắn hạn, không thêm thư viện scheduler |

## 3. Commands

Thêm vào `server/package.json` → `scripts` (giữ nguyên toàn bộ script hiện có):

```json
"db:migrate": "node db/migrate.js",
"sync:once": "node kiotvietSync/runSyncEngine.js --once",
"sync:start": "node kiotvietSync/runSyncEngine.js",
"sync:backfill": "node kiotvietSync/backfill.js"
```

- Build: `npm run build` (không đổi — vẫn "no build step required")
- Test: `npm test` (chạy `node --test`, tự động nhặt mọi `*.test.js` mới trong `server/db/`, `server/kiotviet/`, `server/kiotvietSync/`)
- Lint: repo hiện không có lint script riêng — không thêm mới trong Phase 1 (ngoài phạm vi)
- Chạy migration: `npm run db:migrate` (idempotent, đọc bảng `schema_migrations`, chỉ chạy file chưa ghi nhận)
- Chạy sync 1 lần rồi thoát (dùng để test/verify thủ công): `npm run sync:once`
- Chạy sync engine dài hạn (production, Render Background Worker): `npm run sync:start`
- Backfill lịch sử: `node kiotvietSync/backfill.js --branch=hanoi --from=2026-01-01 [--to=2026-08-30]`

## 4. Biến môi trường mới (thêm vào `server/config.js`, theo đúng pattern `required()`/optional hiện có)

| Biến | Bắt buộc? | Mặc định | Ghi chú |
|---|---|---|---|
| `DATABASE_URL` | Có | — | `required('DATABASE_URL')` — thiếu thì server/sync engine không khởi động được, đúng tinh thần `JWT_SECRET` hiện tại (hạ tầng lõi, không fallback im lặng) |
| `PGSSL` | Không | `true` khi `NODE_ENV=production`, ngược lại `false` | Render Postgres managed cần SSL; local dev thường không |
| `KIOTVIET_SYNC_FAST_INTERVAL_MS` | Không | `90000` | Nhịp invoices/orders |
| `KIOTVIET_SYNC_SLOW_INTERVAL_MS` | Không | `900000` | Nhịp categories/products/customers/suppliers/purchases/returns/cash_flows |
| `KIOTVIET_CLIENT_ID` / `_SECRET` / `RETAILER` | Có (đã tồn tại) | — | Tái dùng nguyên trạng, không đổi tên |
| `KIOTVIET_CLIENT_ID_SG` / `_SECRET_SG` / `_RETAILER_SG` | Không (đã tồn tại) | — | Thiếu → bỏ qua Sài Gòn, log cảnh báo, không crash — đúng `branchConfig.js` mô tả ở PlanDB.md §5.1 |

**Không** thêm biến env mới nào khác ngoài bảng trên trong Phase 1.

## 5. Cấu trúc thư mục (chốt từ PlanDB.md §7.1, không đổi)

```
server/db/
  pool.js                       -- pg.Pool singleton; export getPool(), closePool() cho test teardown
  migrate.js                    -- migration runner, đọc migrations/*.sql theo thứ tự tên file
  migrations/
    0001_branches.sql
    0002_staff.sql
    0003_categories.sql
    0004_products.sql           -- gồm products + product_inventory + inventory_daily_snapshot
    0005_customers.sql
    0006_suppliers.sql
    0007_invoices.sql           -- gồm invoices + invoice_line_items
    0008_orders.sql
    0009_returns.sql
    0010_purchases.sql          -- gồm purchases + purchase_line_items
    0011_cash_flows.sql
    0012_sync_infra.sql         -- sync_checkpoints + sync_run_log
server/kiotviet/
  kiotVietApiClient.js          -- trích xuất nguyên vẹn từ stockoutCheck/kiotVietClient.js
  kiotVietApiClient.test.js
server/kiotvietSync/
  branchConfig.js
  branchConfig.test.js
  syncCheckpointRepository.js
  syncCheckpointRepository.test.js
  entities/
    categoriesSync.js
    productsSync.js             -- + product_inventory + inventory_daily_snapshot
    customersSync.js
    suppliersSync.js
    staffSync.js                 -- helper: upsertStaffFromEntity(), KHÔNG tự chạy độc lập, không có checkpoint riêng
    invoicesSync.js
    ordersSync.js
    returnsSync.js
    purchasesSync.js
    cashFlowsSync.js
    *.test.js                    -- 1 file test / entity
  scheduler.js
  scheduler.test.js
  runSyncEngine.js
  backfill.js
  backfill.test.js
```

**Thứ tự migration bắt buộc** (khớp FK, xem PlanDB.md §6 cuối mục): `branches` → `staff`, `categories` → `products` (+ `product_inventory`, `inventory_daily_snapshot`) → `customers` → `suppliers` → `invoices` (+ line items) → `orders` → `returns` → `purchases` (+ line items) → `cash_flows` → `sync_checkpoints`/`sync_run_log`.

DDL chi tiết của từng bảng **đã chốt tại PlanDB.md §6.1–6.7** — migration file chỉ copy nguyên khối SQL tương ứng vào đúng file theo bảng trên, không thiết kế lại schema ở đây.

## 6. `server/db/pool.js` — hợp đồng module

```js
'use strict';
const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.PGSSL ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

async function closePool() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { getPool, closePool };
```

- Mọi module sync **nhận `pool` qua tham số** (dependency injection), không `require('../db/pool')` trực tiếp bên trong hàm nghiệp vụ — giữ đúng convention DI đã thấy ở `createKiotVietClient(config)` trong `kiotVietClient.js`, để test dùng `pg-mem` hoặc test Postgres thật mà không đụng singleton toàn cục.
- `server/db/migrate.js` tự mở connection riêng (không qua `getPool()`) vì chạy như CLI độc lập, đóng connection khi xong — giống style `migrateUserBranches.js` (`main().catch(...)`, `require.main === module`).

## 7. `server/db/migrate.js` — hợp đồng runner

- Đọc `server/db/migrations/*.sql`, sort theo tên file (đã đánh số 4 chữ số nên sort chuỗi = sort đúng thứ tự).
- Bảng `schema_migrations(filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())` — tự tạo bảng này nếu chưa có (migration 0000 ẩn, chạy trước mọi migration khác).
- Mỗi file `.sql` chạy trong **1 transaction riêng**; ghi vào `schema_migrations` trong cùng transaction đó — lỗi giữa chừng thì rollback toàn bộ file, không để migration chạy dở dang.
- File nào đã có trong `schema_migrations` thì bỏ qua — idempotent, chạy lại an toàn (giống `migrateUserBranches.js`).
- In log rõ ràng từng file: `[migrate] applying 0007_invoices.sql...` / `[migrate] up to date (12/12)`.
- Không có down-migration (forward-only, đúng quyết định ở PlanDB.md §4).

## 8. `server/kiotviet/kiotVietApiClient.js` — trích xuất

Giữ nguyên 100% logic của `stockoutCheck/kiotVietClient.js` (`createKiotVietClient(config)` → `{ getAccessToken, fetchJsonWithRetry, fetchAllPages, fetchProductOnHand }`), chỉ đổi đường dẫn file. `stockoutCheck/kiotVietClient.js` **giữ nguyên tại chỗ** và `require` lại từ vị trí mới (không phá tính năng stockout-check hiện có) — hoặc nếu di dời hẳn, phải cập nhật import tại `stockoutCheck/*.js` trong cùng commit và chạy lại test hiện có của module đó.

Sync engine dùng thêm `fetchAllPages(endpoint, query, onPage)` (đã có sẵn, dùng callback theo trang — phù hợp để upsert theo batch thay vì tải hết vào RAM trước, đặc biệt quan trọng cho `backfill.js` kéo 8 tháng dữ liệu).

`concurrencyPool.js` (`runWithConcurrencyLimit(items, limit, worker)`) tái dùng nguyên vẹn cho giới hạn 2-3 request đồng thời/branch nêu ở PlanDB.md §5.2 — copy sang `server/kiotvietSync/` hoặc giữ tại `stockoutCheck/` và import chéo (ưu tiên copy để `kiotvietSync/` không phụ thuộc ngược vào `dashboard/stockoutCheck/`, tránh coupling hai tính năng không liên quan).

## 9. Hợp đồng từng module sync entity

Toàn bộ `entities/*Sync.js` theo cùng 1 chữ ký hàm:

```js
// Trả về { fetched, upserted } để scheduler ghi sync_run_log.
async function syncCategories(pool, kiotVietClient, branch, sinceIso) { ... }
```

Trong đó `branch = { id, code, kiotvietRetailer }` (từ bảng `branches`), `sinceIso` = `last_checkpoint_at` trừ buffer, do `syncCheckpointRepository.js` tính sẵn và scheduler truyền vào — module entity **không tự đọc `sync_checkpoints`**, giữ pure/dễ test.

### 9.1. Bảng tra cứu endpoint + query (nguồn: `src-dashboard/kiotviet/SheetSchemas.gs`, đã xác minh trong repo)

| Entity | Endpoint | Query cố định | Query theo checkpoint | Ghi chú |
|---|---|---|---|---|
| categories | `/categories` | `hierachicalData=false` (đúng chính tả lỗi của KiotViet, không sửa) | *(xem giả định #3 — cần xác minh `lastModifiedFrom`)* | Full-poll nếu không có filter incremental — bảng nhỏ, chấp nhận được |
| products | `/products` | `includeInventory=true&includeQuantity=true&IncludeProductShelves=true&includePricebook=true&IncludeSerials=true&IncludeBatchExpires=true&includeWarranties=true&includeMaterial=true&includeSoftDeletedAttribute=false` | như trên | `Inventories[]` trong response → ghi `product_inventory`, 1 dòng/branch nội bộ KiotViet |
| invoices | `/invoices` | `includePayment=true&includeInvoiceDelivery=true&IncludeSaleChannel=true` | `fromPurchaseDate`/`toPurchaseDate` (đã dùng trong `syncCustomerReport.js`) | Line items nằm trong `InvoiceDetails[]`/`invoiceDetails[]` của cùng response — không cần gọi endpoint riêng |
| orders | `/orders` | `includePayment=true&includeOrderDelivery=true` | `fromOrderDate`/`toOrderDate` (đối xứng invoices, xác minh tên tham số thật khi code) | |
| returns | `/returns` | `includePayment=true` | theo `returnDate`, xác minh tên tham số | |
| customers | `/customers` | `includeTotal=true&includeCustomerGroup=true&includeCustomerSocial=true` | *(giả định #3)* | |
| suppliers | `/suppliers` | `includeTotal=true&includeSupplierGroup=true` | *(giả định #3)* | |
| purchases | `/purchaseorders` | `includePayment=true&includeOrderDelivery=true` | theo ngày nhập, xác minh tên tham số | **Chú ý**: endpoint là `purchaseorders`, KHÔNG phải `/purchases` — bẫy đã ghi rõ ở PlanDB.md §11 |
| cash_flows | `/cashflow` | `includeAccount=true&includeBranch=true&includeUser=true` | theo `startDate`/`endDate`, **gọi 2 lần**: `isReceipt=true` và `isReceipt=false` | Tham chiếu `CustomerDebtReport.gs:34-79`; cũng cân nhắc thêm `partnerType` nếu cần lọc — xác minh với API thật trước khi hardcode |
| staff | *(không gọi endpoint riêng)* | — | — | Suy ra từ `SoldById`/`CreatedById`/`UserId`... trong response của invoices/orders/returns/purchases/cash_flows, qua `staffSync.upsertStaffFromEntity()` |

Phân trang mọi endpoint: `pageSize=100&currentItem=N`, dùng `fetchAllPages()` có sẵn — **không tự viết lại vòng lặp phân trang** trong từng entity module.

### 9.2. Chiến lược upsert theo loại bảng

- **Bảng đơn (categories, products, customers, suppliers)**: 1 câu `INSERT ... ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET <mọi cột trừ id/created_at/source>, kiotviet_synced_at = now(), updated_at = now() RETURNING id`.
- **Bảng có line item (invoices+invoice_line_items, purchases+purchase_line_items)**: trong **1 transaction**: (1) upsert header, lấy `id` qua `RETURNING`; (2) `DELETE FROM invoice_line_items WHERE invoice_id = $1`; (3) `INSERT` lại toàn bộ dòng mới với `line_no` = index trong mảng response. Đúng chiến lược đã chốt ở PlanDB.md §6.3.
- **`product_inventory`**: khác line items — có unique key ổn định `(product_id, kiotviet_branch_id)` nên **upsert trực tiếp qua `ON CONFLICT`**, không cần xoá-chèn-lại. Với `Inventories[]` rỗng hoặc thiếu, bỏ qua (không xoá dòng cũ — tránh mất dữ liệu tồn kho khi 1 lượt poll trả thiếu field).
- **`inventory_daily_snapshot`**: sau khi upsert `product_inventory` xong trong `productsSync.js`, `INSERT ... ON CONFLICT (product_id, kiotviet_branch_id, snapshot_date) DO NOTHING` với `snapshot_date` = ngày hiện tại theo `+07:00` (dùng đúng cách cộng offset thủ công như `getCurrentMonthRange` trong `syncCustomerReport.js`, KHÔNG dùng `Intl`/timezone DB của OS). `DO NOTHING` vì đây là snapshot đầu ngày — lượt poll sau trong cùng ngày không ghi đè.
- **`staff`**: `upsertStaffFromEntity()` chỉ set `full_name`/`phone` khi giá trị mới không rỗng (tránh 1 entity thiếu field ghi đè mất field entity khác đã điền) — dùng `COALESCE(EXCLUDED.full_name, staff.full_name)` kiểu pattern trong câu `ON CONFLICT`.
- **`cash_flows`**: 2 lượt gọi API (`isReceipt=true/false`) gộp kết quả trước khi upsert, set cột `is_receipt` tương ứng — không upsert 2 lần cho cùng 1 checkpoint tick.

### 9.3. Múi giờ

Mọi field ngày-giờ trả về từ KiotViet (không kèm offset) khi convert sang tham số query hoặc khi so sánh với `TIMESTAMPTZ` trong Postgres, phải cộng thủ công `+07:00`, tái dùng đúng công thức trong `getCurrentMonthRange`/`getRollingDayRange` (`server/jobs/syncCustomerReport.js:107-136`) — viết thành 1 helper dùng chung `server/kiotvietSync/vietnamTime.js` thay vì copy-paste công thức vào từng entity module.

## 10. `syncCheckpointRepository.js` — hợp đồng

```js
async function getCheckpoint(pool, branchId, entityName) { ... }
// trả { lastCheckpointAt, consecutiveErrorCount } hoặc null nếu chưa có dòng nào

async function recordSuccess(pool, branchId, entityName, { checkpointAt, fetched, upserted, startedAt, finishedAt }) { ... }
// UPDATE sync_checkpoints (đẩy last_checkpoint_at, reset consecutive_error_count=0)
// + INSERT sync_run_log (status='success')
// Trong CÙNG transaction — không đẩy checkpoint mà thiếu log, hoặc ngược lại.

async function recordError(pool, branchId, entityName, { error, startedAt, finishedAt }) { ... }
// KHÔNG đổi last_checkpoint_at. Tăng consecutive_error_count += 1.
// INSERT sync_run_log (status='error', error_message=...).
```

`checkpointAt` truyền vào `recordSuccess` là **thời điểm bắt đầu request** (đọc trước khi gọi KiotViet), không phải giá trị lớn nhất của `ModifiedDate` trong kết quả — đúng nguyên tắc PlanDB.md §7.2 ("không tin tưởng mù quáng vào ModifiedDate").

## 11. `scheduler.js` + `runSyncEngine.js`

- `scheduler.js` export `startBranchLoops(pool, kiotVietClient, branch, { fastEntities, slowEntities, fastIntervalMs, slowIntervalMs })` — trả về hàm `stop()` để `runSyncEngine.js` gọi khi nhận `SIGTERM`.
- Mỗi vòng lặp (fast/slow) tự `try/catch` toàn bộ — lỗi 1 entity không chặn entity kế tiếp trong cùng vòng, và lỗi 1 branch không chặn branch kia (2 lời gọi `startBranchLoops` độc lập, không `await` lẫn nhau).
- Stagger: fast loop Hà Nội bắt đầu ngay, fast loop Sài Gòn lệch `fastIntervalMs / 2`; tương tự cho slow loop — tránh dồn request cùng lúc, cùng nguyên tắc đã áp dụng ở `docs/superpowers/specs/2026-08-20-stagger-customer-report-triggers-design.md`.
- `runSyncEngine.js`: đọc `branchConfig.js`, với mỗi branch hợp lệ gọi `startBranchLoops`; bắt `SIGTERM`/`SIGINT` → gọi `stop()` mọi branch → `closePool()` → `process.exit(0)`. Cờ `--once`: chạy đúng 1 lượt mỗi entity (dùng cho `npm run sync:once` và cho test thủ công), không lặp `setTimeout`.

## 12. `backfill.js`

- CLI: `node backfill.js --branch=hanoi|saigon --from=2026-01-01 [--to=YYYY-MM-DD, mặc định hôm nay]`.
- Chia theo tháng (khớp cảnh báo phân trang offset-based ở PlanDB.md §9), gọi lần lượt từng entity giao dịch (invoices/orders/returns/purchases/cash_flows) cho từng tháng, dimension (categories/products/customers/suppliers) chạy 1 lần full (không chia tháng — không có khái niệm "theo tháng" cho dimension).
- Tự resume: log tiến độ ra `sync_run_log` với `entity_name = '<entity>:backfill:2026-03'` (namespaced để không lẫn với checkpoint incremental thường) — nếu chạy lại, script kiểm tra tháng nào đã có `status='success'` trong `sync_run_log` thì bỏ qua.
- Không đẩy `sync_checkpoints` (đó là mốc cho sync incremental thường, backfill là tác vụ riêng, chạy tay).

## 13. Code style

Theo đúng convention hiện có trong `server/` — không JSDoc dài dòng, không class, factory function + object trả về, DI qua tham số:

```js
'use strict';

function createProductsSync({ vietnamTime }) {
  async function syncProducts(pool, kiotVietClient, branch, sinceIso) {
    let fetched = 0;
    let upserted = 0;

    await kiotVietClient.fetchAllPages('products', buildQuery(sinceIso), async (items) => {
      fetched += items.length;
      for (const item of items) {
        upserted += await upsertProduct(pool, branch, item);
      }
    });

    return { fetched, upserted };
  }

  return { syncProducts };
}

module.exports = { createProductsSync };
```

- Comment chỉ khi giải thích lý do không hiển nhiên (bẫy API, quyết định nghiệp vụ) — giống style hiện có trong `stockoutCheck/kiotVietClient.js`, không comment mô tả "hàm này làm gì".
- Không dùng `async/await` lồng `.then()`; không dùng biến toàn cục module-level cho state có thể thay đổi giữa các lần gọi test (trừ `pool` singleton ở `db/pool.js`, có lý do rõ: 1 process chỉ cần 1 pool).

## 14. Testing Strategy

- Runner: `node --test` (không đổi). Mỗi module mới có `*.test.js` cạnh nó, đúng convention hiện có (`hrLeaveRepository.test.js`, `authRoutes.test.js`, v.v.).
- **DB trong test**: dùng Postgres thật (test schema riêng hoặc DB tạm), tạo/huỷ qua `migrate.js` trong `before()`/`after()` — không mock `pg` bằng object giả, vì mục tiêu chính của Phase 1 là đúng ràng buộc SQL (`ON CONFLICT`, FK, unique index) mà mock không kiểm chứng được. Biến môi trường test: `DATABASE_URL` trỏ tới DB test riêng (không tái dùng DB dev/prod).
- **KiotViet API trong test**: mock qua tham số `fetchImpl` của `createKiotVietClient` (đã hỗ trợ sẵn — xem `kiotVietClient.js:16`), không gọi API thật trong test tự động.
- Test bắt buộc cho **mỗi entity module**:
  1. Upsert lần đầu tạo dòng mới đúng field mapping.
  2. Upsert lần 2 với cùng `kiotviet_id` → update, không tạo dòng trùng (kiểm tra qua `COUNT(*)`).
  3. Dòng có `kiotviet_id = NULL` (giả lập future manual-entry) không vi phạm unique index.
  4. Lỗi giữa chừng (client ném lỗi ở trang thứ 2) → `recordError` được gọi, `sync_checkpoints.last_checkpoint_at` **không đổi**.
- Test riêng cho `invoicesSync`/`purchasesSync`: đổi số lượng line item giữa 2 lần sync cùng 1 `kiotviet_id` (hóa đơn bị sửa thêm/bớt dòng) → sau lần 2, số dòng trong `invoice_line_items` khớp đúng dữ liệu mới (không còn dòng cũ thừa) — đây là test then chốt cho chiến lược xoá-và-chèn-lại.
- Test cho `scheduler.js`: dùng fake timers hoặc interval rất ngắn — xác nhận lỗi ở branch Hà Nội không ngăn vòng lặp Sài Gòn tiếp tục chạy (mock 2 `kiotVietClient` riêng, 1 cái luôn throw).
- Test cho `migrate.js`: chạy trên schema rỗng → xác nhận 12 bảng + `schema_migrations` tồn tại; chạy lần 2 → không lỗi, không áp lại file nào (kiểm tra qua log hoặc query `schema_migrations`).
- **Không** cần coverage % cụ thể (repo hiện không đo coverage) — tiêu chí là mỗi entity module có tối thiểu 4 test case ở trên.

## 15. Boundaries (Phase 1)

- **Luôn làm**: dependency-injection cho `pool`/`kiotVietClient` trong mọi hàm nghiệp vụ; transaction bao trọn upsert-header + xoá/chèn line-item; test cho mọi entity module trước khi coi là xong; migration chạy được từ schema rỗng nhiều lần không lỗi.
- **Hỏi trước khi làm**: đổi tên/tham số của bất kỳ biến môi trường `KIOTVIET_*` hiện có; thêm bảng ngoài 10 entity + 2 bảng hạ tầng đã liệt kê ở mục 5; đổi nhịp fast/slow interval mặc định (90s/15p) đã chốt ở PlanDB.md §7.3.
- **Không bao giờ làm** (bất biến, kế thừa từ PlanDB.md §10): `server/kiotvietSync/`, `server/kiotviet/`, `server/db/` import `googleapis` hoặc đọc `GOOGLE_SERVICE_ACCOUNT_JSON`; dùng ID KiotViet làm khoá chính; hardcode ý nghĩa mã `status`; đăng ký thêm webhook KiotViet; sửa `server/routes.js`, `server/dashboard/dashboardData.js`, `server/dashboard/debtReport.js`, `server/sheets/sheetsClient.js` (đó là phạm vi Phase 2); sửa bất kỳ file nào trong `src-dashboard/`.

## 16. Success Criteria — "Done khi" (từ PlanDB.md §8, cụ thể hoá thành checklist kiểm chứng được)

- [ ] `npm run db:migrate` chạy thành công từ DB rỗng, tạo đủ 12 bảng nghiệp vụ + `schema_migrations`, chạy lại lần 2 không lỗi và không áp lại file nào.
- [ ] `branches` có đúng 2 dòng seed (`hanoi`, `saigon`) sau bước seed thủ công/script.
- [ ] `npm run sync:once` chạy thành công cho cả 2 branch (hoặc chỉ Hà Nội nếu `_SG` chưa cấu hình — không crash), ghi được ít nhất 1 dòng `sync_run_log` `status='success'` cho mỗi 10 entity × mỗi branch active.
- [ ] Cố tình làm KiotViet client Hà Nội throw (test/manual) → `sync_checkpoints` của Sài Gòn vẫn tiến, `consecutive_error_count` chỉ tăng ở dòng Hà Nội.
- [ ] `node kiotvietSync/backfill.js --branch=hanoi --from=2026-01-01` chạy xong (có thể mất nhiều giờ, chấp nhận được), phủ đủ dữ liệu tới ngày chạy, log rõ tháng nào backfill xong.
- [ ] `git grep -n "googleapis\|GOOGLE_SERVICE_ACCOUNT_JSON" server/db server/kiotviet server/kiotvietSync` trả về **rỗng**.
- [ ] `git diff` không đụng `server/routes.js`, `server/dashboard/`, `server/sheets/`, `src-dashboard/`.
- [ ] Toàn bộ test mới (`server/db/*.test.js`, `server/kiotviet/*.test.js`, `server/kiotvietSync/**/*.test.js`) pass qua `npm test`, và **toàn bộ test hiện có khác vẫn pass** (không có regression từ việc thêm `pg` vào `package.json`/`config.js`).

## 17. Rủi ro & câu hỏi cần xác minh trước khi code từng entity (thu hẹp từ PlanDB.md §9 cho đúng phạm vi Phase 1)

Thứ tự xác minh nên đi trước bước code tương ứng, không code trước rồi sửa sau:

1. **Tham số incremental thật sự của từng endpoint** (giả định #3 ở đầu tài liệu) — gọi thử `GET /invoices?lastModifiedFrom=...` (và tương tự cho orders/customers/suppliers/products/categories/returns/purchaseorders) bằng token thật, xem có được hỗ trợ không, trước khi code phần `sinceIso` trong bảng ở mục 9.1. Nếu không hỗ trợ cho 1 entity nào đó, entity đó tạm thời full-poll ở nhịp slow (15 phút) thay vì dùng checkpoint — ghi rõ trong code bằng comment tại sao.
2. **Endpoint `/cashflow`**: xác minh phân trang, tham số `isReceipt`, có cần OAuth scope khác `PublicApi.Access` không — đối chiếu `CustomerDebtReport.gs:46-78` trước khi code `cashFlowsSync.js`.
3. **Endpoint danh sách nhân viên** (`/users` hay tương đương) — nếu tồn tại, ưu tiên dùng thay vì suy luận `staff` từ `SoldById`/`CreatedById` (đủ field hơn: vai trò, SĐT, trạng thái hoạt động). Nếu không tồn tại hoặc yêu cầu scope khác, giữ nguyên chiến lược suy luận đã thiết kế ở mục 9.2.
4. **Rate limit thực tế** — đo qua log số lần 429 khi chạy `sync:once`/backfill; nếu cao, giảm `runWithConcurrencyLimit` xuống 1-2 thay vì 2-3.
5. **Tham số ngày cho orders/returns/purchaseorders** (`fromOrderDate`/`toOrderDate`, tên field ngày của return/purchase) — repo hiện tại chỉ có tiền lệ cho `invoices` (`fromPurchaseDate`/`toPurchaseDate` trong `syncCustomerReport.js`); xác nhận tên tham số đúng qua tài liệu KiotViet hoặc gọi thử trước khi code `ordersSync.js`/`returnsSync.js`/`purchasesSync.js`.
6. **Dữ liệu lịch sử cho backfill 2026-01-01** — test nhanh 1 hoá đơn tháng 3/2026 so với 1 hoá đơn gần đây, xác nhận field không bị cắt bớt, trước khi chạy `backfill.js` đầy đủ.
7. **Kích thước connection pool** — `pg.Pool` mặc định `max: 10`; xác nhận giới hạn kết nối gói Render Postgres đã mua đủ cho pool của sync engine (Phase 1 chỉ có 1 process, Phase 2 sẽ thêm pool thứ 2 từ web server — không phải rủi ro Phase 1 nhưng nên chọn `max` thấp ngay từ đầu, ví dụ 5, để có chỗ cho Phase 2).

---

*Tài liệu này chỉ bao phủ Phase 1. Khi bắt đầu code Phase 2 hoặc Phase 3, viết spec con tương ứng theo cùng khuôn mẫu, liên kết ngược lại `PlanDB.md` mục 8.*
