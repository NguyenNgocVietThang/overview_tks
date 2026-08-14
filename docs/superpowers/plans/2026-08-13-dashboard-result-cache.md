# Dashboard Result Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/api/dashboard` from re-running its ~700-line aggregation loop (and rebuilding the search index) on every request when the underlying Google Sheets data hasn't changed, by caching computed results per filter combination.

**Architecture:** `server/dashboard/dashboardData.js` already caches the *raw* Sheets rows for 90s (`dashboardSheetsCache`), but the expensive per-request aggregation that turns those rows into dashboard JSON runs unconditionally every call, and `rememberSearchSheets()` (which rebuilds a search index) is invoked on every call instead of only when the raw data actually refetches. This plan (1) fixes the search-index rebuild to only run on real refetch, and (2) extracts the aggregation into a pure `computeDashboardData(sheets, filters, now)` function wrapped by a small result cache keyed on `(rawDataVersion, filters)`, so repeated requests with the same filter (tab switches, the 10-minute auto-poll, multiple browser tabs) reuse the previous result instead of recomputing.

**Tech Stack:** Node.js (CommonJS, no bundler), Express, `googleapis`. Tests use Node's built-in `node:test` + `node:assert/strict` (Node 18+) — no new npm dependency.

## Global Constraints

- No new npm dependencies.
- Do not change the shape of the `/api/dashboard` JSON response — [server/routes.js](../../../server/routes.js) and the frontend depend on it unchanged.
- Do not change `DASHBOARD_SHEETS_CACHE_TTL_MS` (90s) behavior for raw Sheets data.
- Match existing Vietnamese comment style in `server/dashboard/dashboardData.js`.
- Test-only exports must be clearly marked (`__test__`) and never used from production code paths.

---

### Task 1: Fix `rememberSearchSheets` to rebuild only when raw Sheets data is actually refetched

**Files:**
- Modify: `server/dashboard/dashboardData.js:346-350` (searchSheetCache declaration), `:417-423` (`rememberSearchSheets`), `:545-569` (`getCachedDashboardSheets`), `:745-746` (call site in `getDashboardData`), `:1429` (`module.exports`)
- Create: `server/dashboard/dashboardData.test.js`
- Modify: `server/package.json` (add `test` script)

**Interfaces:**
- Produces: `dashboardData.__test__` object with `resetCaches()` and `getSearchIndexBuildCount()`, used by this task's test and extended by Task 2.
- Produces: `dashboardSheetsCache.version` (number, starts at 0, incremented each time raw Sheets data is actually refetched) — Task 2 depends on this to build its cache key.

- [x] **Step 1: Write the failing test**

Create `server/dashboard/dashboardData.test.js`:

```js
'use strict';
// Test nay tu set bien moi truong gia de config.js khong throw khi thieu
// .env that — khong dung tai khoan Google Sheets that trong test.
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';

const test = require('node:test');
const assert = require('node:assert/strict');

// Require lai module tu dau cho moi test de cac cache module-level (let o
// dashboardData.js) khong bi ro ri giua cac test.
function freshDashboardData() {
  delete require.cache[require.resolve('./dashboardData')];
  delete require.cache[require.resolve('../sheets/sheetsClient')];
  const sheetsClient = require('../sheets/sheetsClient');
  const dashboardData = require('./dashboardData');
  return { dashboardData, sheetsClient };
}

// Thay the toan bo getMultipleSheetValues bang mock dem so lan goi — dashboardData.js
// luon goi qua `sheetsClient.getMultipleSheetValues(...)` (khong destructure truoc),
// nen ghi de truc tiep property nay la du, khong can thu vien mock.
function mockSheets(sheetsClient, callCounter) {
  sheetsClient.getMultipleSheetValues = async (names) => {
    callCounter.count += 1;
    const result = {};
    names.forEach(name => { result[name] = []; });
    return result;
  };
}

const BASE_FILTERS = {
  overview: { mode: 'days', days: 30 },
  products: { mode: 'days', days: 30 },
  invoices: { mode: 'days', days: 30 },
  customers: { mode: 'all' },
  newPurchases: { mode: 'days', days: 30 },
  newProducts: { mode: 'days', days: 30 },
  deactivated: { mode: 'days', days: 30 }
};

test('rememberSearchSheets chi rebuild search index khi raw sheet data thuc su duoc fetch lai, khong phai moi lan goi getDashboardData', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const callCounter = { count: 0 };
  mockSheets(sheetsClient, callCounter);
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData({ ...BASE_FILTERS, products: { mode: 'days', days: 7 } });

  assert.equal(callCounter.count, 1, 'raw sheets phai duoc fetch dung 1 lan (con cache 90s)');
  assert.equal(
    dashboardData.__test__.getSearchIndexBuildCount(),
    1,
    'search index chi duoc rebuild 1 lan, khong phai moi lan goi getDashboardData'
  );
});

module.exports = { freshDashboardData, mockSheets, BASE_FILTERS };
```

- [x] **Step 2: Run test to verify it fails**

- [x] **Step 3: Add `version` to the raw-sheets cache and move the search-index rebuild into it**

- [x] **Step 4: Remove the now-redundant call site and add the test-only counter**

- [x] **Step 5: Add the `__test__` export**

- [x] **Step 6: Add the `test` script to `server/package.json`**

- [x] **Step 7: Run test to verify it passes**

- [x] **Step 8: Commit**

---

### Task 2: Cache computed dashboard results per filter combination

**Files:**
- Modify: `server/dashboard/dashboardData.js:722-747` (function boundary), `:1425-1427` (closing/return, unchanged), `module.exports` block added in Task 1
- Modify: `server/dashboard/dashboardData.test.js` (add second test)

**Interfaces:**
- Consumes: `dashboardSheetsCache.version` (from Task 1) and the existing `dashboardData.__test__.resetCaches()` hook (extended here).
- Produces: `computeDashboardData(sheets, filters, now)` — a pure function extracted from the current `getDashboardData` body (same return shape as before). `getDashboardData(filters)` becomes a thin async wrapper around it.
- Produces: `dashboardData.__test__.expireSheetsCache()` and `dashboardData.__test__.getComputeCallCount()`, for this task's test.

- [x] **Step 1: Extend the test-only reset hook and write the failing test**

In `server/dashboard/dashboardData.test.js`, append:

```js
const { freshDashboardData, mockSheets, BASE_FILTERS } = module.exports;

test('getDashboardData cache ket qua da tinh theo tung bo loc, khong tinh lai khi bo loc khong doi va raw sheets van con hieu luc', async () => {
  const { dashboardData, sheetsClient } = freshDashboardData();
  const callCounter = { count: 0 };
  mockSheets(sheetsClient, callCounter);
  dashboardData.__test__.resetCaches();

  await dashboardData.getDashboardData(BASE_FILTERS);
  await dashboardData.getDashboardData(BASE_FILTERS); // cung bo loc -> phai lay tu cache
  assert.equal(dashboardData.__test__.getComputeCallCount(), 1, 'bo loc khong doi -> khong tinh lai');

  const otherFilters = { ...BASE_FILTERS, products: { mode: 'days', days: 7 } };
  await dashboardData.getDashboardData(otherFilters); // bo loc khac -> phai tinh lai
  assert.equal(dashboardData.__test__.getComputeCallCount(), 2, 'bo loc khac -> phai tinh lai');

  dashboardData.__test__.expireSheetsCache();
  await dashboardData.getDashboardData(BASE_FILTERS); // raw sheets het han -> version moi -> phai tinh lai du bo loc giong lan dau
  assert.equal(dashboardData.__test__.getComputeCallCount(), 3, 'raw sheets refetch -> ket qua cu bi coi la stale, phai tinh lai');
  assert.equal(callCounter.count, 2, 'raw sheets phai duoc fetch lai dung 1 lan nua sau khi het han');
});
```

- [x] **Step 2: Run test to verify it fails**

- [x] **Step 3: Split `getDashboardData` into a caching wrapper and `computeDashboardData`**

- [x] **Step 4: Extend the `__test__` export**

- [x] **Step 5: Run test to verify it passes**

- [x] **Step 6: Manual smoke check against the real server**

- [x] **Step 7: Commit**

## Self-Review Notes

- **Spec coverage:** Both identified issues from the conversation (search-index rebuilt every request; full aggregation rerun every request) are covered by Task 1 and Task 2 respectively.
- **Placeholder scan:** No TBD/placeholder steps; every step has literal code.
- **Type consistency:** `computeDashboardData(sheets, filters, now)` signature is used identically in both its definition (Task 2 Step 3) and its call site inside `getDashboardData` (Task 2 Step 3). `dashboardSheetsCache.version` is introduced in Task 1 and consumed unchanged in Task 2.
