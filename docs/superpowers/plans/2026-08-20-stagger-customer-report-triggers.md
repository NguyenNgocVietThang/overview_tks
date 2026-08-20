# Stagger Customer Report Triggers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the four daily Apps Script jobs at nominal 30-minute intervals: `Báo cáo bán hàng` 06:00, `Hàng bán theo khách` 06:30, `Khách theo hàng hóa` 07:00, and `Hàng ngừng kinh doanh` 07:30.

**Architecture:** Keep `syncCustomerReport()` as the optimized full/manual sync, while adding independent daily handlers and independent last-success properties for each customer report. Replace the single daily trigger with three idempotently managed triggers; retain the one-minute queue as a per-report catch-up mechanism and move the discontinued-product trigger to 07:30.

**Tech Stack:** Google Apps Script (`.gs` JavaScript), Node.js built-in test runner, `node:vm` Apps Script test harness, Markdown documentation.

## Global Constraints

- All scheduled times use `Asia/Ho_Chi_Minh`.
- Nominal schedules are 06:00, 06:30, 07:00, and 07:30; Apps Script execution around `nearMinute()` remains approximate.
- Keep webhook processing every 1 minute, polling every 15 minutes, and debt reports near 15:00 unchanged.
- `syncAllInitialData()` must continue to refresh all three customer reports through `syncCustomerReport()`.
- `invoice.update` must continue updating `Hàng bán theo khách` through the webhook queue.
- Do not add dependencies or sleep/wait inside Apps Script jobs.
- Preserve unrelated existing worktree changes.

---

## File Map

- Create `server/test/apps-script-report-schedule.test.js`: isolated regression tests for individual report handlers, trigger times, catch-up state, and the discontinued-product schedule.
- Modify `src/kiotviet/CustomerReport.gs`: independent report sync functions, per-report success properties, daily trigger setup/removal, and catch-up logic.
- Modify `src/kiotviet/DiscontinuedProducts.gs`: move its daily trigger and user-facing setup message to 07:30.
- Modify `src/kiotviet/WebhookAdmin.gs`: correct the auto-sync schedule comment.
- Modify `src/HuongDanSuDung.gs`: document the new handlers and staggered schedule.
- Modify `README.md`: update module descriptions, operational instructions, and function table.
- Modify `docs/01-brd/BRD_Dashboard_GoogleSheets.md`: update business-facing refresh times.
- Modify `docs/02-srs/SRS_Dashboard_GoogleSheets.md`: update functional requirements and catch-up behavior.
- Modify `docs/04-planning/implementation_plan.md`: update architecture/status descriptions of scheduled jobs.

### Task 1: Independent Customer Report Sync Handlers

**Files:**
- Create: `server/test/apps-script-report-schedule.test.js`
- Modify: `src/kiotviet/CustomerReport.gs:5-199`

**Interfaces:**
- Consumes: existing `fetchCustomerReportPages_()`, aggregation functions, sheet writers, `getKiotVietToken()`, `LockService`, and `PropertiesService`.
- Produces: `syncSalesCustomerReport()`, `syncCustomerProductReport()`, `syncCustomerByProductReport()`, plus three independent last-sync property constants.
- Preserves: `syncCustomerReport()` return shape and its use by `syncAllInitialData()`.

- [ ] **Step 1: Write failing isolation tests**

Create `server/test/apps-script-report-schedule.test.js` with a local `loadAppsScript()` helper based on `node:vm`. Build a `createCustomerReportHarness()` that stubs token retrieval, script lock, API fetches, aggregation, writers, flush, properties, date formatting, and `CONFIG`. Add these assertions:

```js
it('syncSalesCustomerReport writes only Báo cáo bán hàng', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncSalesCustomerReport();

  assert.deepEqual(writes, ['sales']);
  assert.deepEqual(fetched, ['invoices', 'returns', 'customers']);
  assert.equal(result.sheetName, 'Báo cáo bán hàng');
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

it('syncCustomerProductReport writes only Hàng bán theo khách', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncCustomerProductReport();

  assert.deepEqual(writes, ['customerProduct']);
  assert.deepEqual(fetched, ['invoices']);
  assert.equal(result.sheetName, 'Hàng bán theo khách');
  assert.equal(properties.CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

it('syncCustomerByProductReport writes only Khách theo hàng hóa', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncCustomerByProductReport();

  assert.deepEqual(writes, ['customerByProduct']);
  assert.deepEqual(fetched, ['invoices', 'returns', 'customers']);
  assert.equal(result.sheetName, 'Khách theo hàng hóa');
  assert.equal(properties.CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});
```

Also assert that one `syncCustomerReport()` call records all three writers and sets all three last-sync dates to `2026-08-20`.

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: FAIL because `syncSalesCustomerReport` and the two new per-report date properties do not exist, and the existing manual helpers refresh all three sheets.

- [ ] **Step 3: Add independent constants and result builders**

In `CustomerReport.gs`, replace the single trigger/date model with exact constants:

```js
const CUSTOMER_SALES_REPORT_TRIGGER_HANDLER = 'syncSalesCustomerReport';
const CUSTOMER_PRODUCT_REPORT_TRIGGER_HANDLER = 'syncCustomerProductReport';
const CUSTOMER_BY_PRODUCT_REPORT_TRIGGER_HANDLER = 'syncCustomerByProductReport';
const CUSTOMER_REPORT_LEGACY_TRIGGER_HANDLER = 'syncCustomerReport';
const CUSTOMER_REPORT_LAST_SYNC_PROPERTY = 'CUSTOMER_REPORT_LAST_SYNC_DATE';
const CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY =
  'CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE';
const CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY =
  'CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE';
```

Extract focused internal result builders so the full sync and the individual handlers return the same structures:

```js
function buildCustomerSalesReportResult_(reportRows, reportSummary, period) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_REPORT,
    customerCount: reportRows.length,
    transactionCount: reportSummary.transactionCount,
    totalRevenue: reportSummary.revenue,
    totalReturns: reportSummary.returnValue,
    netRevenue: reportSummary.netRevenue,
    fromDate: period.startLabel,
    toDate: period.endLabel
  };
}

function buildCustomerProductReportResult_(productReportRows, productPeriod) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT,
    rowCount: productReportRows.length,
    purchasedQuantity: productReportRows.reduce(function(total, row) {
      return total + customerReportNumber_(row.purchasedQuantity);
    }, 0),
    fromDate: productPeriod.startLabel,
    toDate: productPeriod.endLabel,
    days: CUSTOMER_PRODUCT_REPORT_DAYS
  };
}

function buildCustomerByProductReportResult_(report, period) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT,
    rowCount: report.rows.length,
    productCount: report.productCount,
    customerProductCount: report.customerProductCount,
    purchasedQuantity: report.purchasedQuantity,
    revenue: report.revenue,
    returnedQuantity: report.returnedQuantity,
    returnValue: report.returnValue,
    netRevenue: report.netRevenue,
    fromDate: period.startLabel,
    toDate: period.endLabel
  };
}

function customerReportToday_() {
  return Utilities.formatDate(new Date(), CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
}
```

The bodies of the three builders must use the existing return fields verbatim so callers do not lose `rowCount`, quantities, revenue, or date range metadata.

- [ ] **Step 4: Implement the three focused public handlers**

Implement each handler with its own lock, token check, minimal fetch set, aggregation, one writer, and one success property. The required flow is:

```js
function syncSalesCustomerReport() {
  return withCustomerReportLock_(function() {
    const token = requireCustomerReportToken_();
    const period = getCustomerReportAllTimeRange_(new Date());
    const invoices = fetchCustomerReportPages_('invoices', token, { status: 1 });
    const returns = fetchCustomerReportPages_('returns', token, {
      orderBy: 'returnDate', orderDirection: 'DESC'
    });
    const customers = fetchCustomerReportPages_('customers', token, {
      includeCustomerGroup: true
    });
    const rows = aggregateCustomerReport_(invoices, returns, period, customers);
    const summary = summarizeCustomerReport_(rows);
    writeCustomerReportSheet_(rows, period);
    PropertiesService.getScriptProperties().setProperty(
      CUSTOMER_REPORT_LAST_SYNC_PROPERTY, customerReportToday_()
    );
    return buildCustomerSalesReportResult_(rows, summary, period);
  });
}
```

`syncCustomerProductReport()` fetches only completed invoices, aggregates with the 90-day rolling period, writes only `writeCustomerProductReportSheet_()`, and sets both its last-sync property and schema property. `syncCustomerByProductReport()` fetches completed invoices, returns, and customers; builds the product metadata lookup; writes only `writeCustomerByProductReportSheet_()`; and sets both its last-sync and schema properties.

Add these shared guards:

```js
function withCustomerReportLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Bao cao khach hang dang duoc dong bo boi mot tien trinh khac.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function requireCustomerReportToken_() {
  const token = getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token de dong bo Bao cao khach hang.');
  return token;
}
```

- [ ] **Step 5: Keep full sync efficient and mark all reports successful**

Refactor `syncCustomerReport()` to use `withCustomerReportLock_()` and the same result builders while retaining its existing single shared fetch of invoices, returns, and customers. After all three writers succeed, set these five values together:

```js
properties.setProperties({
  [CUSTOMER_REPORT_LAST_SYNC_PROPERTY]: today,
  [CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: today,
  [CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: today,
  [CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION,
  [CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION
});
```

Do not change `syncAllInitialData()`; it must continue calling `syncCustomerReport()`.

- [ ] **Step 6: Run isolation tests**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: all handler-isolation and full-sync compatibility tests PASS.

- [ ] **Step 7: Commit the independent handlers**

```powershell
git add -- src/kiotviet/CustomerReport.gs server/test/apps-script-report-schedule.test.js
git commit -m "refactor: split customer report sync handlers"
```

### Task 2: Staggered Triggers and Independent Catch-Up

**Files:**
- Modify: `server/test/apps-script-report-schedule.test.js`
- Modify: `src/kiotviet/CustomerReport.gs:200-275`
- Modify: `src/kiotviet/DiscontinuedProducts.gs:500-535`

**Interfaces:**
- Consumes: Task 1 handlers and last-sync constants.
- Produces: `setupCustomerReportDailyTrigger()` with three schedules, idempotent removal of legacy/new handlers, and `syncCustomerReportIfDue_(now)` with independent due checks.
- Preserves: public setup/removal function names used by operators.

- [ ] **Step 1: Add failing trigger schedule tests**

Extend the test harness with a chainable `ScriptApp.newTrigger()` recorder and assert:

```js
assert.deepEqual(createdTriggers, [
  { handler: 'syncSalesCustomerReport', hour: 6, minute: 0, timezone: 'Asia/Ho_Chi_Minh' },
  { handler: 'syncCustomerProductReport', hour: 6, minute: 30, timezone: 'Asia/Ho_Chi_Minh' },
  { handler: 'syncCustomerByProductReport', hour: 7, minute: 0, timezone: 'Asia/Ho_Chi_Minh' }
]);
```

Seed existing trigger handlers `syncCustomerReport`, `syncSalesCustomerReport`, `syncCustomerProductReport`, `syncCustomerByProductReport`, and `unrelatedHandler`; assert setup deletes the first four and preserves `unrelatedHandler`.

Load `DiscontinuedProducts.gs` with its required globals, call `setupHangNgungKinhDoanhTrigger_()`, and assert `{ handler: 'capNhatHangNgungKinhDoanh', hour: 7, minute: 30, timezone: 'Asia/Ho_Chi_Minh' }`.

- [ ] **Step 2: Add failing catch-up state tests**

Call `syncCustomerReportIfDue_(new Date('2026-08-20T06:29:00+07:00'))` and assert only the sales handler is called when all last-sync dates are absent. At `06:30`, assert the customer-product handler becomes eligible. At `07:00`, assert customer-by-product becomes eligible. Seed a successful date for one report and assert it is not called again; make one handler throw and assert its success property remains unset so a later call retries it.

- [ ] **Step 3: Run schedule tests and verify failure**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: FAIL because only the legacy 07:00 trigger exists, catch-up uses one shared date, and discontinued products still use 07:00.

- [ ] **Step 4: Create the three daily triggers idempotently**

Update `setupCustomerReportDailyTrigger()` to iterate exact definitions:

```js
const CUSTOMER_REPORT_DAILY_SCHEDULES = Object.freeze([
  { handler: CUSTOMER_SALES_REPORT_TRIGGER_HANDLER, hour: 6, minute: 0 },
  { handler: CUSTOMER_PRODUCT_REPORT_TRIGGER_HANDLER, hour: 6, minute: 30 },
  { handler: CUSTOMER_BY_PRODUCT_REPORT_TRIGGER_HANDLER, hour: 7, minute: 0 }
]);
```

For each definition call `.timeBased().atHour(hour).nearMinute(minute).everyDays(1).inTimezone(CUSTOMER_REPORT_TIME_ZONE).create()`. Update `removeCustomerReportDailyTrigger_()` to delete every handler in the three definitions plus `CUSTOMER_REPORT_LEGACY_TRIGGER_HANDLER`, while leaving unrelated triggers untouched. Update logs/comments to list all three times.

- [ ] **Step 5: Implement independent catch-up checks**

Define due metadata with minute-of-day thresholds and optional schema properties:

```js
const CUSTOMER_REPORT_CATCH_UP_DEFINITIONS = Object.freeze([
  { minuteOfDay: 360, lastSyncProperty: CUSTOMER_REPORT_LAST_SYNC_PROPERTY, handler: syncSalesCustomerReport },
  { minuteOfDay: 390, lastSyncProperty: CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY, schemaProperty: CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY, schemaVersion: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION, handler: syncCustomerProductReport },
  { minuteOfDay: 420, lastSyncProperty: CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY, schemaProperty: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY, schemaVersion: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION, handler: syncCustomerByProductReport }
]);
```

`syncCustomerReportIfDue_(now)` must compute Vietnam hour/minute, skip definitions whose threshold has not arrived, skip reports already successful today with current schema, call each due handler inside its own `try/catch`, log report-specific retry errors, and return the number of reports successfully run. The handler itself owns the success-property write; the catch-up loop must not mark success.

- [ ] **Step 6: Move discontinued products to 07:30**

In `setupHangNgungKinhDoanhTrigger_()`, keep `.atHour(7)` and change `.nearMinute(0)` to `.nearMinute(30)`. Change the setup toast to `Đã cập nhật toàn bộ lịch sử và cài lịch 07:30 mỗi ngày.` Add/update its logger comment so no nearby text still claims 07:00.

- [ ] **Step 7: Run schedule and catch-up tests**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: all trigger, removal, due-time, independent retry, and discontinued schedule tests PASS.

- [ ] **Step 8: Commit scheduling behavior**

```powershell
git add -- src/kiotviet/CustomerReport.gs src/kiotviet/DiscontinuedProducts.gs server/test/apps-script-report-schedule.test.js
git commit -m "feat: stagger Apps Script report schedules"
```

### Task 3: Operational Documentation and Sheet Notes

**Files:**
- Modify: `src/kiotviet/CustomerReport.gs:1040-1270`
- Modify: `src/kiotviet/WebhookAdmin.gs:30-42`
- Modify: `src/HuongDanSuDung.gs`
- Modify: `README.md`
- Modify: `docs/01-brd/BRD_Dashboard_GoogleSheets.md`
- Modify: `docs/02-srs/SRS_Dashboard_GoogleSheets.md`
- Modify: `docs/04-planning/implementation_plan.md`
- Test: `server/test/apps-script-report-schedule.test.js`

**Interfaces:**
- Consumes: final schedule and function names from Tasks 1-2.
- Produces: operator-facing instructions and spreadsheet notes that exactly match runtime behavior.

- [ ] **Step 1: Add a failing stale-schedule text test**

Add a test that reads the in-scope source/documentation files and rejects these obsolete claims where they describe customer/discontinued scheduling: `đối soát toàn bộ lúc gần 07:00`, `3 báo cáo lúc 07:00`, `lịch 07:00 mỗi ngày` for discontinued products, and `trigger cập nhật ba báo cáo hàng ngày gần 07:00`.

The same test must assert the canonical schedule strings `06:00`, `06:30`, `07:00`, and `07:30` occur in `README.md`, `src/HuongDanSuDung.gs`, and the SRS.

- [ ] **Step 2: Run the stale-text test and verify failure**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: FAIL with obsolete 07:00 descriptions in source comments, sheet notes, README, BRD, SRS, and planning documentation.

- [ ] **Step 3: Update runtime notes and operator instructions**

Use these exact meanings throughout source comments, spreadsheet notes, and guides:

- `Báo cáo bán hàng`: tự động đối soát gần 06:00.
- `Hàng bán theo khách`: webhook trong khoảng một phút; đối soát toàn bộ gần 06:30.
- `Khách theo hàng hóa`: tự động đối soát gần 07:00.
- `Hàng ngừng kinh doanh`: tự động cập nhật gần 07:30.
- `HN1/HN3/HN7`: giữ nguyên gần 15:00.

Update `setupCustomerReport()` documentation to state it immediately refreshes all three reports and installs three independent schedules. Document `syncSalesCustomerReport()`, `syncCustomerProductReport()`, and `syncCustomerByProductReport()` as manual one-sheet entry points. Update `WebhookAdmin.gs` only to correct the discontinued schedule comment; do not make `setupKiotVietAutoSync()` install customer-report triggers because that would change established operator behavior beyond the approved spec.

- [ ] **Step 4: Update BRD, SRS, README, and implementation plan**

Replace every applicable shared-07:00 statement with the four-row schedule. In SRS FR-06.8, describe independent daily reconciliation and per-report queue catch-up. In SRS FR-06.14 retain the 07:00 behavior for `Khách theo hàng hóa`. In the BRD keep webhook timing intact while changing `Hàng bán theo khách` reconciliation to 06:30 and discontinued products to 07:30. In README function tables, state that `setupCustomerReportDailyTrigger()` installs three triggers rather than one.

- [ ] **Step 5: Run the documentation regression test**

Run:

```powershell
node --test server/test/apps-script-report-schedule.test.js
```

Expected: PASS with no obsolete schedule claims in the checked contexts and all canonical times present.

- [ ] **Step 6: Commit documentation updates**

```powershell
git add -- src/kiotviet/CustomerReport.gs src/kiotviet/WebhookAdmin.gs src/HuongDanSuDung.gs README.md docs/01-brd/BRD_Dashboard_GoogleSheets.md docs/02-srs/SRS_Dashboard_GoogleSheets.md docs/04-planning/implementation_plan.md server/test/apps-script-report-schedule.test.js
git commit -m "docs: document staggered report refresh times"
```

### Task 4: Full Verification

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-3.
- Produces: evidence that scheduling changes do not regress existing Apps Script or server behavior.

- [ ] **Step 1: Run focused Apps Script tests**

```powershell
node --test server/test/apps-script-report-schedule.test.js server/test/apps-script-sync.test.js
```

Expected: all tests PASS, including webhook `invoice.update` behavior.

- [ ] **Step 2: Run the complete server test suite**

```powershell
npm test --prefix server
```

Expected: exit code 0 and no failing tests.

- [ ] **Step 3: Run static schedule and diff checks**

```powershell
rg -n "atHour\(|nearMinute\(|everyMinutes\(" src -g "*.gs"
git diff --check
git status --short
```

Expected schedule evidence: customer reports at `(6,0)`, `(6,30)`, `(7,0)`; discontinued products at `(7,30)`; debt at `(15,0)`; queue every 1 minute; polling every 15 minutes. `git diff --check` must return no whitespace errors. Review `git status` to ensure no unrelated user changes were staged or committed.

- [ ] **Step 4: Review deployment action**

Record in the handoff that code deployment alone does not replace already-installed Apps Script triggers. After deploying the `.gs` files, an operator must run `setupCustomerReportDailyTrigger()` and `cauHinhLichHangNgungKinhDoanh()` once (or use the corresponding setup flow) to recreate the schedules.

- [ ] **Step 5: Commit any verification-only corrections**

If verification required an in-scope correction, stage only the corrected files and commit:

```powershell
git commit -m "fix: finalize staggered report scheduling"
```

If no correction was required, do not create an empty commit.
