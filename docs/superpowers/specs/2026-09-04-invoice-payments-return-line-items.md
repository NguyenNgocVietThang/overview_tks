# Prompt: Add `invoice_payments` + `return_line_items` to Phase 1 Postgres sync

> **HỦY / KHÔNG ÁP DỤNG (05/09/2026):** Toàn bộ PostgreSQL proof-of-concept (`server/db`, `server/kiotvietSync`, `dashboardDataPg`, `debtReportPg`) đã bị xóa khỏi working tree; runtime hiện đọc Google Sheets. Không thực thi prompt này nếu chưa có quyết định kiến trúc và migration plan mới.

Copy the block below into a new session to execute this task.

---

## Task

Add two missing tables to the Phase 1 KiotViet→Postgres sync (`server/kiotvietSync/`) and update `debtReportPg.js`/`customerQueries.js` to use them, closing two known gaps documented in `server/dashboard/PHASE2_PG_MODULES.md` ("Known gaps" section):

1. **`invoice_payments`** — per-payment-transaction detail for each invoice (currently only `invoices.total_payment`, a single aggregated column, exists). Needed so the debt report (`debtReportPg.js`) can replay actual payment transactions instead of approximating with `total_payment`.
2. **`return_line_items`** — per-product-line detail for each return (currently `returns.return_total` is header-level only, no line detail — asymmetric with `invoice_line_items`, which already exists for invoices). Needed so `customerQueries.searchTopCustomersByProducts`'s `returnedQuantityAllTime`/`returnValueAllTime` fields (currently hardcoded to `0`) can be computed for real.

## Confirmed source data (already verified against production GAS code — do not re-derive from scratch)

Read `src-dashboard/kiotviet/CustomerDebtReport.gs:266-294` and `:392-417` (`buildCustomerDebtProductLines_`) directly — this is the ALREADY-LIVE Apps Script code that reads these exact fields from the real KiotViet API response today, so the field names below are confirmed, not guessed:

**`invoice.payments[]`** (array on the same `/invoices` response you already fetch — check if `includePayment=true` already returned this in `invoicesSync.js`'s existing response before assuming a new API call is needed):
- `status` / `Status` — payment status code (GAS skips when `Number(status) === 1`; confirm exact meaning via a live probe before coding, per this codebase's `kiotviet/API_ENDPOINTS.md` convention — do not assume status semantics without checking a real response)
- `transDate` / `TransDate` — falls back to `invoice.purchaseDate` if absent
- `code` / `Code` — payment code
- `amount` / `Amount` — payment amount
- (there is very likely also an `id`/`Id` on each payment row — confirm via live probe)

**`returnItem.returnDetails[]`** (array on the `/returns` response — same live-probe caveat: confirm it's actually present when `includePayment=true` is set, or if `returnDetails` needs a different query param):
- `productCode` / `code`, `productId` (confirm exact key — not shown in the snippet above but present on `invoiceDetails[]` as `productId`/`ProductId`, likely mirrored here)
- `productName`
- `quantity`, `price`, `discount`
- `subTotal` (falls back to `price * quantity - discount` when absent/null)
- `taxAmount` / `totalTax` / `tax`

**Before writing any code**: live-probe one real invoice with payments and one real return with detail lines (same method already used in `server/kiotviet/API_ENDPOINTS.md` — there's likely already a probe script or you can add a temporary one-off script under `server/kiotviet/`). Confirm the exact field names/casing and whether `returnDetails`/`payments` actually come back in the existing `invoicesSync.js`/`returnsSync.js` queries (`includePayment=true` is already set for both — it's plausible payments are already in the raw API response and simply being discarded/ignored right now). **Append findings to `server/kiotviet/API_ENDPOINTS.md`** in the same style as the existing entries once confirmed.

## Files to touch

### 1. New migration: `server/db/migrations/0014_invoice_payments_and_return_line_items.sql`
Follow the exact conventions of `server/db/migrations/0007_invoices.sql`'s `invoice_line_items` table (BIGINT identity PK, `branch_id` denormalized copy, `ON DELETE CASCADE` from parent, natural per-payment/per-line unique index). Suggested shape (adjust once field names are confirmed by the live probe):

```sql
CREATE TABLE invoice_payments (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id         BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  branch_id          BIGINT NOT NULL,
  kiotviet_payment_id BIGINT NULL,       -- confirm exists via live probe
  payment_code       TEXT NULL,
  trans_date         TIMESTAMPTZ NULL,
  amount             NUMERIC(18,2) NOT NULL,
  status             SMALLINT NULL,
  kiotviet_synced_at TIMESTAMPTZ NULL
);
CREATE INDEX invoice_payments_invoice_idx ON invoice_payments(invoice_id);

CREATE TABLE return_line_items (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  return_id             BIGINT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  branch_id             BIGINT NOT NULL,
  line_no               INT NOT NULL,
  product_id            BIGINT NULL REFERENCES products(id),
  kiotviet_product_id   BIGINT NULL,
  product_code_snapshot TEXT NULL,
  product_name_snapshot TEXT NULL,
  quantity              NUMERIC(18,3) NOT NULL,
  price                 NUMERIC(18,2) NOT NULL,
  discount              NUMERIC(18,2) NOT NULL DEFAULT 0,
  line_amount           NUMERIC(18,2) NOT NULL,
  tax_amount            NUMERIC(18,2) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX return_line_items_uq ON return_line_items(return_id, line_no);
CREATE INDEX return_line_items_product_idx ON return_line_items(product_id);
```

Run `npm run db:migrate` against both the local test setup and confirm `server/db/migrate.test.js`/`migrations.entities.test.js` still pass (they likely just assert "N migrations applied", update the expected count).

### 2. `server/kiotvietSync/entities/invoicesSync.js`
Add payment persistence inside `upsertInvoice`'s existing transaction (same BEGIN/COMMIT block as the invoice header + line items), mirroring the `insertLineItems`/`insertLineItemsBulk` DELETE-then-INSERT pattern already used for `invoice_line_items`. Since `invoicesSync.js` already has a batched (`maps`-based) fast path and a non-batched fallback path (see `upsertInvoice(pool, branch, invoice, maps = null)`), follow the SAME dual-path pattern:
  - Non-batched path: simple per-payment `DELETE` + loop `INSERT` (like the old `insertLineItems`).
  - Batched path (`upsertInvoicesPage`): bulk `unnest()`-based insert per invoice, same technique as `insertLineItemsBulk`. Payments don't need cross-invoice ID resolution (no customer/product/staff lookup needed for a payment row), so this is simpler than the line-items case — no new page-level batch-resolve query needed, just switch the per-invoice INSERT to a single multi-row statement instead of a loop.

### 3. `server/kiotvietSync/entities/returnsSync.js`
Add return-line-item persistence inside `upsertReturn`'s transaction, same DELETE-then-bulk-INSERT pattern as `invoice_line_items`. Note `returnsSync.js` currently has **no batched fast path at all** (it's a `SLOW_ENTITIES` member, unlike invoices/orders) — you do NOT need to add page-level batching for this task; just add the line-items persistence to the existing single-record `upsertReturn` function, same style as the ORIGINAL (pre-optimization) `insertLineItems` in `invoicesSync.js` looked like before the 2026-09-04 batching change (git log around commit `3c5388f` for reference if useful, though don't copy the batching complexity — out of scope here).

### 4. `server/dashboard/debtReportPg.js`
Replace the `total_payment`-substitution debit logic (per `PHASE2_PG_MODULES.md`'s "Known gaps" note — search this file for how it currently computes the payment/debit transaction) with a real per-payment-transaction query against the new `invoice_payments` table, matching `CustomerDebtReport.gs:266-278`'s logic exactly: for each invoice, emit ONE "Bán hàng" transaction (value = `invoice.total`, unchanged) PLUS one "Thanh toán" transaction per row in `invoice_payments` (value = `-abs(amount)`), skipping rows where `status === 1` (confirm this status-skip condition against your live-probe findings first — don't blindly copy `=== 1` without confirming what status 1 means for a payment row).

### 5. `server/dashboard/queries/customerQueries.js`
Fix `searchTopCustomersByProducts`'s `returnedQuantityAllTime`/`returnValueAllTime` (currently hardcoded `0` per `PHASE2_PG_MODULES.md`) to aggregate real values from `return_line_items` joined to `returns`, filtered by branch/customer/product-code the same way the invoice-based revenue side of that query already does.

### 6. Tests
Follow the exact TDD conventions already used throughout `server/kiotvietSync/entities/*.test.js` (schema-per-test via `withTestPool`, `fakeClient`, hand-seeded fixtures with hand-computed expected values — see `invoicesSync.test.js` for the house style). Add:
  - `invoicesSync.test.js`: a case asserting payment rows are written/replaced correctly (mirror the existing "hoa don sua doi so luong line item" re-sync test, but for payments).
  - `returnsSync.test.js`: a case asserting return line items are written correctly, plus a rollback-isolation case mirroring invoices' "1 hoa don loi khong lam hong hoa don khac" pattern if you add any batching (skip if you keep the non-batched single-record approach per file 3 above).
  - `debtReportPg.test.js`: update/add a fixture with multiple `invoice_payments` rows spread across different dates and confirm the debt replay matches `CustomerDebtReport.gs`'s algorithm output for the same fixture (hand-compute expected values from the GAS logic, don't just assert "some number").
  - `customerQueries.test.js`: a case with real `return_line_items` rows confirming `returnedQuantityAllTime`/`returnValueAllTime` are no longer `0`.

### 7. Update docs
Remove the two now-fixed bullets from `server/dashboard/PHASE2_PG_MODULES.md`'s "Known gaps" section (the `total_payment`-substitution one and the `returnedQuantityAllTime`/`returnValueAllTime`-always-`0` one) and replace with a short note of when/how they were fixed (commit reference).

## Constraints (carry over from this codebase's established conventions)

- Every non-obvious decision must cite what it's grounded in (`source-driven-development` — this repo's convention, see `PHASE2_PG_MODULES.md`'s own header for the expected citation style).
- Don't guess field names — live-probe first, exactly like `kiotviet/API_ENDPOINTS.md`'s existing entries did.
- Don't touch `src-dashboard/` (Apps Script/Sheets) or `server/sheets/sheetsClient.js` — this is Postgres-side only.
- Run the new/changed test files individually (`node --test path/to/file.test.js`), not the full suite — this dev machine has known false-failures under full-suite parallelism (unrelated Postgres connection/OOM contention), and separately the DB is now Render (remote, ~200-300ms latency per round trip) so each test file takes 15-20s just for its own migration setup — budget for that, don't mistake it for a hang.
- This DB is now **live production data** (already cut over to Postgres as of 2026-09-04, `routes.js`/`exportService.js` read from `dashboardDataPg.js`) — test against a local Docker Postgres or an isolated schema (`withTestPool` already does schema-per-test isolation against whatever `DATABASE_URL` is configured), never run migrations/backfills against production data as a test side-effect.
