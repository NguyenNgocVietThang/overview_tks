# Phase 2 — PostgreSQL read-layer modules

> Status: **dev/TDD build, not cutover-ready.** Built per [`PlanDB-Phase2-Spec.md`](../../PlanDB-Phase2-Spec.md) with the scope explicitly agreed for this round: parallel read-layer modules, tested against a local/seeded Postgres schema, **not** wired into `server/routes.js`, **not** replacing `dashboardData.js`/`debtReport.js`/`exportService.js`. Phase 2's own spec hard-blocks cutover until Phase 1 (schema + KiotViet sync engine) has been run live and verified — see that document's prerequisites section. Nothing here was verified against real KiotViet data; every test below uses hand-seeded fixture rows with hand-computed expected values.

Written per `source-driven-development`: implementation choices below are grounded in the official [`node-postgres`](https://node-postgres.com/) docs (parameterized queries, `pg.Pool`, type parsing) and Node's official [`node:test`](https://nodejs.org/api/test.html) runner docs, not habit — each non-obvious decision cites what it's grounded in.

## Module map

| Module | Exports | Sheets-era equivalent |
|---|---|---|
| `queries/overviewQueries.js` | `getRevenueToday`, `getRevenueByDay`, `getRecentInvoices`, `getCancelledCount`, `getTopSellingProducts`, `getTopSellingParentCategories` | `dashboardData.js` overview loop (~L1649-1809) |
| `queries/invoiceQueries.js` | `getOrdersSummary`, `getReturnsSummary` | `dashboardData.js` orders/returns section (~L1877-1930) |
| `queries/productQueries.js` | `getProductsSection` | `dashboardData.js` products loop (~L1490-1589) |
| `queries/customerQueries.js` | `getTopCustomersByRevenue`, `searchTopCustomersByProducts`, `getCustomerProductRevenueReport`, `getCustomerDebtSummary` | `dashboardData.js` L768-1359, L1933-1978 |
| `queries/supplierQueries.js` | `getSuppliersList`, `getPurchasesSummaryAllTime`, `getNewPurchases` | `dashboardData.js` L1980-2075 |
| `queries/searchQueries.js` | `searchByCodes`, `searchByText` | `searchDashboardRecords` (L603-726) |
| `debtReportPg.js` | `computeDebtReport(pool, branchId, days, now)` | `src-dashboard/kiotviet/CustomerDebtReport.gs` (`aggregateCustomerDebtReport_`) |
| `dashboardDataPg.js` | `getDashboardData`, `getDashboardExportSnapshot`, `searchDashboardRecords`, `searchTopCustomersByProducts`, `getCustomerProductRevenueReport` | `dashboardData.js` public exports |
| `../db/testPool.js` | `withTestPool(prefix, fn)` | test-only; extracted from the per-file helper in `kiotvietSync/entities/*.test.js` |

All query functions take `pool` as their first parameter (dependency injection, no `require('../db/pool')` inside business logic) — matches the DI convention already established in `kiotvietSync/entities/*.js` and confirmed against the official `pg.Pool` docs (a `Pool` is safe to share and query concurrently; passing it explicitly keeps every function unit-testable against an isolated schema).

## Key sourced facts (read from code, not inferred — see spec §13 for why this mattered)

1. **Invoice/order/return status codes are numeric, not text**, and their meaning is *only* documented in `src-dashboard/kiotviet/SheetSchemas.gs`'s `kiotVietStatus_()` fallback maps (GAS converts these to Vietnamese labels before ever writing to Sheets, which is why `dashboardData.js` compares against strings like `'Hoàn thành'`):
   - Invoices: `{1: 'Phiếu tạm', 2: 'Đã hủy', 3: 'Hoàn thành'}`
   - Orders: `{1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Đã xác nhận', 4: 'Đã hủy', 5: 'Hoàn thành'}`
   - Returns: `{1: 'Hoàn thành', 2: 'Đã hủy'}`
   - `productsSync.js` stores `is_active` as KiotViet's raw boolean `IsActive`, mapped 1:1 to the Sheets labels `'Đang kinh doanh'`/`'Ngừng kinh doanh'`.

2. **`revenueToday`/day-series sum `total_amount`** ("Tổng tiền hàng"), *not* `total_payment` — confirmed by reading `dashboardData.js:1660,1670` directly; the Phase 2 spec's own §5.1 summary is imprecise here.

3. **Top-selling products/categories exclude only CANCELLED invoices, not drafts** (`!invoiceEntry.isCancelled`, `dashboardData.js:1721`) — different rule from `revenueToday`, which requires exactly `status=3`.

4. **Category rollup walks the FULL parent chain to the root**, not just one level (`buildParentCategoryResolver`, `dashboardData.js:210-246`) — implemented here via a recursive CTE against `categories.parent_category_id`.

5. **`debtReportPg.js` uses `status=1` as the "valid" invoice/return status**, sourced directly from `CustomerDebtReport.gs:253,285`. This is *not* the same status value the dashboard overview uses (`status=3`) — a concrete instance of the status-code ambiguity `PlanDB.md §9` warned about. Not inferred; read from the literal filter condition in the GAS source.

## A real bug this TDD process caught

`pg@8.23.0` pins `pg-types@2.2.0` (exact version, confirmed via `node_modules/pg/package.json`'s `dependencies` and `server/package-lock.json`), whose `lib/textParsers.js:174` maps oid 1082 (`DATE`) to the `parseDate` function from the separate `postgres-date` npm package. That function's own source (`postgres-date/index.js:74-75`, comment: *"YYYY-MM-DD will be parsed as local time"*) constructs the value with `new Date(year, month-1, day)` — the JS `Date` constructor's local-timezone-implied form (per [MDN's `Date()` constructor reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/Date), the multi-argument form always uses the host system's local time zone, never UTC). Calling `.toISOString()` on that value converts it to UTC — which silently shifts the date backward by one day whenever the process's local timezone is ahead of UTC (e.g. `Asia/Ho_Chi_Minh`, `+07:00`, which is exactly this dev machine's timezone). This is **not documented on node-postgres.com** — its `/apis/types` page explicitly says "these docs are incomplete, for now please reference pg-types docs," and even pg-types' own README doesn't call out the local-time behavior; it only surfaces by reading the installed `postgres-date` source directly (re-verified 2026-08-30 against the exact installed version, not GitHub's `master` branch, which has since refactored this code and cannot be used as a stand-in for what actually ships). `overviewQueries.test.js`'s `getRevenueByDay` test caught this immediately (dates came back as `2026-07-31` instead of `2026-08-01`). Fix: use `to_char(expr, 'YYYY-MM-DD')` in the query so Postgres returns a plain `TEXT` string, sidestepping the client-side `Date` object entirely. Applied consistently in `overviewQueries.getRevenueByDay`.

All other `.toISOString()` call sites across the Phase 2 modules (`overviewQueries.getRecentInvoices`, `invoiceQueries` order/return times, `customerQueries.lastPurchaseDate`, `supplierQueries` purchase dates, `debtReportPg.js`'s transaction times) were re-checked against this same finding and are **not** affected: they all read `TIMESTAMPTZ` columns (`purchase_date`, `return_date`, `order_date`, `trans_date` — confirmed in `server/db/migrations/000{7,8,9,10,11}_*.sql`), not plain `DATE`. `postgres-date`'s `parseDate` takes a different branch for values with an explicit UTC offset in their text form (which `TIMESTAMPTZ` always includes): it builds the date via `Date.UTC(...)` and corrects for the offset, which is timezone-safe. The local-time bug is specific to bare `DATE` columns/expressions with no time component.

## Known gaps (do not assume these are correct without follow-up work — listed so nobody re-discovers them the hard way)

- **`searchTopCustomersByProducts`'s `returnedQuantityAllTime`/`returnValueAllTime` always return `0`.** The Sheets version reads these from a KiotViet-native pre-aggregated report keyed by (product, customer). Phase 1's Postgres schema has no per-product return detail table (`returns` has only a header-level `return_total`, no `return_line_items`) — this data literally cannot be computed from the current schema. Needs a Phase 1 schema addition before this field can be real.
- **`debtReportPg.js`'s invoice debit value uses `total_payment`, matching spec §6.1's contract — but the actual GAS algorithm (`CustomerDebtReport.gs:258`) debits the full `invoice.total`, plus a separate `'Thanh toán'` credit transaction per `invoice.payments[]` entry.** Postgres has no `invoice_payments` table (Phase 1 doesn't sync individual payment records), so that second transaction type cannot be reproduced. Spec's `total_payment` substitution is a plausible compensating simplification (it nets out the immediate at-sale payment without needing the payments sub-ledger) but this has **not been verified against real data** and must be checked via `compareDashboardSources.js` before any cutover.
- **`searchQueries.js`'s free-text search has no Vietnamese diacritic-insensitive matching.** The Sheets version normalizes to a "compact" form (`compactCode`/`compactName`) for accent-insensitive prefix matching; this Postgres version only does plain `ILIKE` prefix matching. Needs an `unaccent`-equivalent strategy (e.g. Postgres `unaccent` extension) before parity.
- **Several secondary dashboard fields are not yet ported**: `overview.endOfDayReport` (full transactions report with quantity/discount/paid breakdown), `overview.todayNewProducts`, `products.newlyImported` (pie-chart-with-"others"-bucket breakdowns), `products.childCategorySalesByParent`, `products.availableParentCategories`, `customers.topDebt`'s phone-based Sheets logic (this Postgres version instead joins directly on `customer_id`, which is more correct but not literally the same code path). These exist in `dashboardData.js` but were out of scope for this pass — flagged here rather than silently omitted.
- **`dashboardDataPg.resolveFilterRange`'s `mode: 'range'` parsing** uses plain `new Date(raw.from)` on the query-string date, unlike the Sheets version's `parseSheetDate` (which handles Google Sheets' various date serialization formats). Fine for `YYYY-MM-DD`-style input from an HTML date picker; not a general-purpose date parser.

## Verification performed

- `npm test` (server/) — all new `*.test.js` pass alongside the full existing suite (no regressions).
- Every query/report function has ≥1 field-by-field test against hand-seeded fixtures with hand-computed expected values, plus an edge case (empty/no-match) — per spec §10.
- `debtReportPg.js` specifically verified against the invariant `openingDebt + Σ(transaction.value) === closingDebt`, which held exactly in the test fixture — strong signal the debit/credit/replay math is internally consistent (though real-world correctness still depends on the `total_payment` assumption flagged above).
- Branch isolation verified explicitly (`dashboardDataPg.test.js`): Hanoi and Saigon data seeded in the same test schema never leak into each other's query results.

## Not done in this pass (explicitly out of scope, per user's chosen scope for this round)

- No changes to `server/routes.js` — these modules are not reachable via HTTP yet.
- No changes to `dashboardData.js`, `debtReport.js`, `exportService.js`, `server/sheets/sheetsClient.js`.
- `server/scripts/compareDashboardSources.js` (cutover parity-verification CLI) not built — meaningless without live backfilled Postgres data per the Phase 1 prerequisites.
