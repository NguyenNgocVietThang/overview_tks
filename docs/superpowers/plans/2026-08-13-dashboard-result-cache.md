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

**Context:** Today, every call to `getDashboardData(filters)` does:
```js
const sheets = await getCachedDashboardSheets();
rememberSearchSheets(sheets);
```
`rememberSearchSheets` rebuilds the search index (loops over every row of every searchable sheet) even when `getCachedDashboardSheets()` returned data straight from its 90s cache — i.e. even when nothing changed. The fix moves that rebuild inside `getCachedDashboardSheets`'s fetch branch, so it only runs when Sheets was actually queried.

- [ ] **Step 1: Write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`):
```bash
node --test dashboard/dashboardData.test.js
```
Expected: FAIL — `dashboardData.__test__` is `undefined` (TypeError: Cannot read properties of undefined), since the `__test__` export doesn't exist yet.

- [ ] **Step 3: Add `version` to the raw-sheets cache and move the search-index rebuild into it**

In `server/dashboard/dashboardData.js`, replace:
```js
let dashboardSheetsCache = {
  data: null,
  expiresAt: 0,
  loading: null
};

async function getCachedDashboardSheets() {
  if (dashboardSheetsCache.data && Date.now() < dashboardSheetsCache.expiresAt) {
    return dashboardSheetsCache.data;
  }
  if (dashboardSheetsCache.loading) return dashboardSheetsCache.loading;

  const debtSheetNames = DEBT_SHEETS.map(entry => entry.name);
  const loading = sheetsClient.getMultipleSheetValues(SHEET_NAMES.concat(debtSheetNames))
    .then(sheets => {
      dashboardSheetsCache.data = sheets;
      dashboardSheetsCache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
      return sheets;
    })
    .finally(() => {
      if (dashboardSheetsCache.loading === loading) dashboardSheetsCache.loading = null;
    });
  dashboardSheetsCache.loading = loading;
  return loading;
}
```
with:
```js
let dashboardSheetsCache = {
  data: null,
  version: 0,
  expiresAt: 0,
  loading: null
};

async function getCachedDashboardSheets() {
  if (dashboardSheetsCache.data && Date.now() < dashboardSheetsCache.expiresAt) {
    return dashboardSheetsCache.data;
  }
  if (dashboardSheetsCache.loading) return dashboardSheetsCache.loading;

  const debtSheetNames = DEBT_SHEETS.map(entry => entry.name);
  const loading = sheetsClient.getMultipleSheetValues(SHEET_NAMES.concat(debtSheetNames))
    .then(sheets => {
      dashboardSheetsCache.data = sheets;
      dashboardSheetsCache.version += 1;
      dashboardSheetsCache.expiresAt = Date.now() + DASHBOARD_SHEETS_CACHE_TTL_MS;
      // Rebuild o day (chi khi vua fetch lai tu Google) thay vi trong
      // getDashboardData — truoc day rememberSearchSheets() bi goi lai o MOI
      // request /api/dashboard du raw data khong doi, ton CPU vo ich.
      rememberSearchSheets(sheets);
      return sheets;
    })
    .finally(() => {
      if (dashboardSheetsCache.loading === loading) dashboardSheetsCache.loading = null;
    });
  dashboardSheetsCache.loading = loading;
  return loading;
}
```

- [ ] **Step 4: Remove the now-redundant call site and add the test-only counter**

Replace:
```js
let searchSheetCache = {
  data: null,
  expiresAt: 0,
  loading: null
};
```
with:
```js
let searchSheetCache = {
  data: null,
  expiresAt: 0,
  loading: null
};
let searchIndexBuildCountForTest = 0; // chi dung trong test, xem __test__ o cuoi file
```

Replace:
```js
function rememberSearchSheets(sheets) {
  // Normalizing every cell and serializing every field on each keystroke was
  // the hot path for large product sheets. Build the reusable search index when
  // the Sheets cache changes instead.
  searchSheetCache.data = buildSearchIndex(sheets);
  searchSheetCache.expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
}
```
with:
```js
function rememberSearchSheets(sheets) {
  // Normalizing every cell and serializing every field on each keystroke was
  // the hot path for large product sheets. Build the reusable search index when
  // the Sheets cache changes instead.
  searchIndexBuildCountForTest += 1; // chi dung trong test, xem __test__ o cuoi file
  searchSheetCache.data = buildSearchIndex(sheets);
  searchSheetCache.expiresAt = Date.now() + SEARCH_CACHE_TTL_MS;
}
```

Find the call site inside `getDashboardData` (right after the JSDoc block starting `Ham chinh lay du lieu cho dashboard.`):
```js
  const sheets = await getCachedDashboardSheets();
  rememberSearchSheets(sheets);
```
Replace with:
```js
  const sheets = await getCachedDashboardSheets();
```

- [ ] **Step 5: Add the `__test__` export**

Replace the final line of the file:
```js
module.exports = { getDashboardData, searchDashboardRecords };
```
with:
```js
module.exports = {
  getDashboardData,
  searchDashboardRecords,
  // Cac hook duoi day CHI phuc vu test (dashboardData.test.js) — khong dung
  // trong code san pham.
  __test__: {
    resetCaches() {
      dashboardSheetsCache = { data: null, version: 0, expiresAt: 0, loading: null };
      searchSheetCache = { data: null, expiresAt: 0, loading: null };
      searchIndexBuildCountForTest = 0;
    },
    getSearchIndexBuildCount: () => searchIndexBuildCountForTest
  }
};
```

- [ ] **Step 6: Add the `test` script to `server/package.json`**

In `server/package.json`, replace:
```json
  "scripts": {
    "start": "node index.js",
    "sync:customer-report": "node jobs/syncCustomerReport.js"
  },
```
with:
```json
  "scripts": {
    "start": "node index.js",
    "test": "node --test",
    "sync:customer-report": "node jobs/syncCustomerReport.js"
  },
```

- [ ] **Step 7: Run test to verify it passes**

Run (from `server/`):
```bash
node --test dashboard/dashboardData.test.js
```
Expected: PASS (1 test, 0 failures).

- [ ] **Step 8: Commit**

```bash
git add server/dashboard/dashboardData.js server/dashboard/dashboardData.test.js server/package.json
git commit -m "fix(dashboard): only rebuild search index when raw Sheets data refetches"
```

---

### Task 2: Cache computed dashboard results per filter combination

**Files:**
- Modify: `server/dashboard/dashboardData.js:722-747` (function boundary), `:1425-1427` (closing/return, unchanged), `module.exports` block added in Task 1
- Modify: `server/dashboard/dashboardData.test.js` (add second test)

**Interfaces:**
- Consumes: `dashboardSheetsCache.version` (from Task 1) and the existing `dashboardData.__test__.resetCaches()` hook (extended here).
- Produces: `computeDashboardData(sheets, filters, now)` — a pure function extracted from the current `getDashboardData` body (same return shape as before). `getDashboardData(filters)` becomes a thin async wrapper around it.
- Produces: `dashboardData.__test__.expireSheetsCache()` and `dashboardData.__test__.getComputeCallCount()`, for this task's test.

**Context:** The body of `getDashboardData` (roughly 700 lines: product/invoice/customer/supplier aggregation) currently reruns in full on every call, even when both the raw Sheets data *and* the requested filters are identical to the previous call (e.g. the frontend's 10-minute auto-poll, or a second browser tab open on the same view). This task splits the function into a cheap caching wrapper (`getDashboardData`) and the actual computation (`computeDashboardData`), and caches the computed result keyed by `${rawDataVersion}|${JSON.stringify(filters)}`. The cache is invalidated automatically whenever `dashboardSheetsCache.version` changes (i.e. whenever raw Sheets data is refetched), so results can never be older than the existing 90s raw-data staleness window already accepted by the codebase.

- [ ] **Step 1: Extend the test-only reset hook and write the failing test**

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

- [ ] **Step 2: Run test to verify it fails**

Run (from `server/`):
```bash
node --test dashboard/dashboardData.test.js
```
Expected: FAIL — `dashboardData.__test__.getComputeCallCount` is not a function.

- [ ] **Step 3: Split `getDashboardData` into a caching wrapper and `computeDashboardData`**

Find (the JSDoc + function signature + first block, currently at `server/dashboard/dashboardData.js:722-745`):
```js
/**
 * Ham chinh lay du lieu cho dashboard.
 * @param {Object} filters - Bo loc rieng cho tung tab. Moi bo loc thoi gian co
 *   dang { mode: 'days'|'range'|'all', days?, from?, to? }; products co them
 *   status: 'all'|'Đang kinh doanh'|'Ngừng kinh doanh'.
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(filters) {
  const f = filters || {};
  const now = new Date();
  const todayStr = formatDMY(now);

  const overviewRange = resolveFilterRange(f.overview, now);
  const productsRange = resolveFilterRange(f.products, now);
  const productStatusFilter = ['Đang kinh doanh', 'Ngừng kinh doanh'].includes(f.products && f.products.status)
    ? f.products.status
    : 'all';
  const invoicesRange = resolveFilterRange(f.invoices, now);
  const customersRange = resolveFilterRange(f.customers, now);
  const newPurchasesRange = resolveFilterRange(f.newPurchases, now);
  const newProductsRange = resolveFilterRange(f.newProducts, now);
  const deactivatedRange = resolveFilterRange(f.deactivated, now);

  const sheets = await getCachedDashboardSheets();
```

Replace with:
```js
const DASHBOARD_RESULT_CACHE_TTL_MS = DASHBOARD_SHEETS_CACHE_TTL_MS; // ket qua tinh toan khong the "tuoi" hon du lieu tho dung de tinh ra no
let dashboardResultCache = new Map(); // key: `${sheetsVersion}|${JSON.stringify(filters)}` -> { data, expiresAt }
let computeCallCountForTest = 0; // chi dung trong test, xem __test__ o cuoi file

function dashboardResultCacheKey(sheetsVersion, filters) {
  return sheetsVersion + '|' + JSON.stringify(filters || {});
}

/**
 * Ham chinh lay du lieu cho dashboard — wrapper them cache ket qua da tinh
 * theo tung bo loc, tranh chay lai toan bo tinh toan ben duoi khi client doi
 * tab/poll lai voi CUNG bo loc trong luc du lieu tho (dashboardSheetsCache)
 * chua het han.
 * @param {Object} filters - xem computeDashboardData
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
async function getDashboardData(filters) {
  const f = filters || {};
  const sheets = await getCachedDashboardSheets();
  const sheetsVersion = dashboardSheetsCache.version;
  const cacheKey = dashboardResultCacheKey(sheetsVersion, f);

  const cached = dashboardResultCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  // Du lieu tho da sang phien ban moi (fetch lai) -> moi ket qua cache cu deu
  // tinh tu du lieu cu, don sach de Map khong phinh vo han qua nhieu phien ban.
  for (const key of dashboardResultCache.keys()) {
    if (!key.startsWith(sheetsVersion + '|')) dashboardResultCache.delete(key);
  }

  const data = computeDashboardData(sheets, f, new Date());
  dashboardResultCache.set(cacheKey, { data, expiresAt: Date.now() + DASHBOARD_RESULT_CACHE_TTL_MS });
  return data;
}

/**
 * Tinh toan toan bo du lieu dashboard tu du lieu tho da doc (sheets) va bo
 * loc. Ham thuan (khong tu fetch, khong cache) de getDashboardData ben tren
 * co the cache ket qua theo (phien ban du lieu tho + bo loc).
 * @param {Object} sheets - map ten sheet -> mang 2 chieu, tu getCachedDashboardSheets()
 * @param {Object} filters - Bo loc rieng cho tung tab. Moi bo loc thoi gian co
 *   dang { mode: 'days'|'range'|'all', days?, from?, to? }; products co them
 *   status: 'all'|'Đang kinh doanh'|'Ngừng kinh doanh'.
 * @param {Date} now
 * @returns {Object} Du lieu KPI, bieu do, bang xep hang cho dashboard
 */
function computeDashboardData(sheets, filters, now) {
  computeCallCountForTest += 1;
  const f = filters || {};
  const todayStr = formatDMY(now);

  const overviewRange = resolveFilterRange(f.overview, now);
  const productsRange = resolveFilterRange(f.products, now);
  const productStatusFilter = ['Đang kinh doanh', 'Ngừng kinh doanh'].includes(f.products && f.products.status)
    ? f.products.status
    : 'all';
  const invoicesRange = resolveFilterRange(f.invoices, now);
  const customersRange = resolveFilterRange(f.customers, now);
  const newPurchasesRange = resolveFilterRange(f.newPurchases, now);
  const newProductsRange = resolveFilterRange(f.newProducts, now);
  const deactivatedRange = resolveFilterRange(f.deactivated, now);
```

Leave every line after this point (the rest of the original function body, from `const debt = {};` through `return { ... };`) exactly as-is — it now belongs to `computeDashboardData` and already only references `sheets`, `filters`/`f`, and `now`, all of which are now parameters. Its closing `}` (originally the close of `getDashboardData`) now closes `computeDashboardData` — no change needed there since both a `function` and `async function` close the same way.

- [ ] **Step 4: Extend the `__test__` export**

Replace the `__test__` block added in Task 1:
```js
  __test__: {
    resetCaches() {
      dashboardSheetsCache = { data: null, version: 0, expiresAt: 0, loading: null };
      searchSheetCache = { data: null, expiresAt: 0, loading: null };
      searchIndexBuildCountForTest = 0;
    },
    getSearchIndexBuildCount: () => searchIndexBuildCountForTest
  }
```
with:
```js
  __test__: {
    resetCaches() {
      dashboardSheetsCache = { data: null, version: 0, expiresAt: 0, loading: null };
      searchSheetCache = { data: null, expiresAt: 0, loading: null };
      dashboardResultCache = new Map();
      searchIndexBuildCountForTest = 0;
      computeCallCountForTest = 0;
    },
    expireSheetsCache() {
      dashboardSheetsCache.expiresAt = 0;
    },
    getSearchIndexBuildCount: () => searchIndexBuildCountForTest,
    getComputeCallCount: () => computeCallCountForTest
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `server/`):
```bash
node --test dashboard/dashboardData.test.js
```
Expected: PASS (2 tests, 0 failures).

- [ ] **Step 6: Manual smoke check against the real server**

This task changes a 700-line hot path — run the real server once against real data before committing:
```bash
cd server && npm start
```
In another terminal:
```bash
curl "http://localhost:3000/api/dashboard?days=30&ovMode=days&ovDays=30&puMode=days&puDays=30&npMode=days&npDays=30&deMode=days&deDays=30&prMode=days&prDays=30&inMode=days&inDays=30&cuMode=all&prStatus=all" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d);console.log('kpi.totalProducts', j.kpi.totalProducts, 'allProducts.length', j.allProducts.length);})"
```
Expected: same `totalProducts`/`allProducts.length` values as before this change (compare against a `git stash`'d run if in doubt) — confirms the extraction didn't change output shape or values, only when it recomputes.

- [ ] **Step 7: Commit**

```bash
git add server/dashboard/dashboardData.js server/dashboard/dashboardData.test.js
git commit -m "perf(dashboard): cache computed /api/dashboard results per filter"
```

---

## Self-Review Notes

- **Spec coverage:** Both identified issues from the conversation (search-index rebuilt every request; full aggregation rerun every request) are covered by Task 1 and Task 2 respectively.
- **Placeholder scan:** No TBD/placeholder steps; every step has literal code.
- **Type consistency:** `computeDashboardData(sheets, filters, now)` signature is used identically in both its definition (Task 2 Step 3) and its call site inside `getDashboardData` (Task 2 Step 3). `dashboardSheetsCache.version` is introduced in Task 1 and consumed unchanged in Task 2.
