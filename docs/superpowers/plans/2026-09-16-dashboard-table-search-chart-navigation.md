# Dashboard Table Search and Chart Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add whole-dataset search to all 20 Báo cáo tổng hợp tables, exact multi-code lookup to tables with visible code columns, and one-to-one chart navigation to the corresponding table row.

**Architecture:** Add a small browser/CommonJS-compatible pure helper module for normalization, filtering, code parsing, and page lookup. `index.html` owns a table registry and routes every table through the shared search-before-pagination pipeline; Chart.js renderers receive optional drill-down metadata. Export uses the same helper through `exportService.js`, with per-table item accessors so exported rows match the current table filter.

**Tech Stack:** Vanilla JavaScript, Chart.js, JSDOM, Node.js built-in test runner, Express export service, ExcelJS.

## Global Constraints

- Search always runs on the complete table dataset before the existing 100-row pagination.
- Normal search is substring matching and ignores Vietnamese diacritics, letter case, and repeated whitespace.
- Multi-code search uses exact string matching after trim/case normalization and never coerces codes to numbers.
- Separators for multi-code input are whitespace, newlines, commas, and semicolons.
- Existing top-level `/api/search`, sorting, page size, source data, and debt-management chart filtering remain unchanged.
- Only charts with a stable one-to-one item identity become clickable.
- Existing dirty workspace changes must be preserved; stage only files owned by the current task.

---

### Task 1: Pure table-search engine

**Files:**
- Create: `server/public/js/table-explorer.js`
- Create: `server/test/frontend/table-explorer.test.js`

**Interfaces:**
- Produces: `normalizeTableSearchText(value): string`
- Produces: `parseTableCodes(value): string[]`
- Produces: `filterTableItems(items, config, searchState): { items, requestedCodes, missingCodes }`
- Produces: `findTableItemPage(items, identity, identityFn, pageSize): { index, page } | null`
- `config.searchText(item)` returns the complete searchable text for one row.
- `config.code(item)` returns the primary visible code or an empty string.

- [ ] **Step 1: Write failing unit tests for normalization and multi-code parsing**

```js
test('normalizeTableSearchText bo dau, ha chu va gom khoang trang', () => {
  assert.equal(normalizeTableSearchText('  CHỔI   Lau Nhà  '), 'choi lau nha');
});

test('parseTableCodes nhan moi separator, bo trung va giu so 0 dau', () => {
  assert.deepEqual(parseTableCodes('SP001, sp002;\n00123 SP001'), ['SP001', 'sp002', '00123']);
});
```

- [ ] **Step 2: Run the unit test and confirm the missing-module failure**

Run: `node --test server/test/frontend/table-explorer.test.js`

Expected: FAIL because `server/public/js/table-explorer.js` does not exist.

- [ ] **Step 3: Implement normalization and parsing with browser/CommonJS exports**

```js
function normalizeTableSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLocaleLowerCase('vi-VN')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTableCodes(value) {
  const seen = new Set();
  return String(value == null ? '' : value).split(/[\s,;]+/).filter(Boolean).filter(code => {
    const key = code.toLocaleLowerCase('vi-VN');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

- [ ] **Step 4: Add failing tests for substring filtering, exact codes, missing codes, and page lookup**

```js
const items = [
  { code: 'SP001', name: 'Chổi lau nhà lớn' },
  { code: 'SP002', name: 'Chổi lau nhà nhỏ' },
  { code: 'SP003', name: 'Nước lau sàn' }
];
const config = {
  searchText: item => `${item.code} ${item.name}`,
  code: item => item.code
};

assert.deepEqual(
  filterTableItems(items, config, { mode: 'normal', query: 'choi lau nha' }).items.map(item => item.code),
  ['SP001', 'SP002']
);
assert.deepEqual(
  filterTableItems(items, config, { mode: 'codes', query: 'SP003 SP404 SP001' }).missingCodes,
  ['SP404']
);
assert.deepEqual(findTableItemPage(items, 'SP003', item => item.code, 2), { index: 2, page: 2 });
```

- [ ] **Step 5: Implement `filterTableItems` and `findTableItemPage` minimally**

Normal mode returns every item whose normalized `searchText` contains the normalized query. Codes mode parses requested codes, compares normalized exact values from `config.code`, keeps source item order, and returns missing codes in requested order. Page lookup uses strict normalized string identity and returns `null` when absent.

- [ ] **Step 6: Run the unit tests**

Run: `node --test server/test/frontend/table-explorer.test.js`

Expected: PASS.

- [ ] **Step 7: Commit the pure engine**

```powershell
git add -- server/public/js/table-explorer.js server/test/frontend/table-explorer.test.js
git commit -m "feat(dashboard): add reusable table search engine"
```

---

### Task 2: Whole-dataset search controls for all dashboard tables

**Files:**
- Modify: `server/public/index.html`
- Create: `server/test/frontend/table-search-ui.test.js`
- Modify: `server/test/frontend/export-ui.test.js`

**Interfaces:**
- Consumes: Task 1 globals from `/js/table-explorer.js`.
- Produces: `TABLE_EXPLORER_CONFIGS`, keyed by existing pagination table keys.
- Produces: `getTableSearchState(tableKey)`, `handleTableSearchInput(tableKey)`, `setTableSearchMode(tableKey, mode)`, and `clearTableSearch(tableKey)`.
- Extends: `renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage)` without changing existing callers.

- [ ] **Step 1: Write a failing registry-coverage JSDOM test**

The test loads `index.html` with the same Chart/fetch stubs used by `debt-management-ui.test.js`, then asserts these 20 table keys are registered (15 use shared pagination and five have specialized renderers):

```js
const expected = [
  'cpDetail', 'cpMonthly', 'productRevenueSearch', 'recentStockout', 'stockout90d',
  'endOfDay', 'overviewPurchase', 'todayNewProducts', 'topSelling', 'lowStock',
  'allProducts', 'newlyImported', 'childCategory', 'orders', 'returns', 'invoices',
  'customerRevenue', 'topDebt', 'suppliers', 'debtManagement'
];
assert.deepEqual(Object.keys(dom.window.TABLE_EXPLORER_CONFIGS).sort(), expected.sort());
```

Run: `node --test server/test/frontend/table-search-ui.test.js`

Expected: FAIL because the registry and script include do not exist.

- [ ] **Step 2: Load the helper script and add table-search state**

Add `<script src="/js/table-explorer.js"></script>` immediately after `pagination.js`. Extend the main state with:

```js
tableSearches: {},
tableDatasets: {},
tableRenderers: {}
```

Define `TABLE_EXPLORER_CONFIGS` with `searchText`, optional `code`, optional custom control IDs, and row identity for all 20 table keys. Search text must include all meaningful displayed fields. `returns` uses `item.code` as its primary multi-code field; `originalInvoiceCode` is normal-search-only. `topSelling` exposes a code only while `state.productAnalysis === 'product'`.

- [ ] **Step 3: Add failing pure UI tests for a match outside page 1 and partial phrase matches**

Use 105 product fixtures where items 101 and 102 contain `Chổi lau nhà`. Render `allProducts`, type `choi lau nha`, dispatch `input`, and assert:

```js
assert.equal(document.querySelectorAll('#allProductRows tr[data-table-item-id]').length, 2);
assert.match(document.querySelector('[data-table-search-count="allProducts"]').textContent, /2\s*\/\s*105/);
assert.match(document.getElementById('allProductsPageLabel').textContent, /Trang 1\//);
```

Expected before implementation: FAIL because no per-table search control exists.

- [ ] **Step 4: Implement lazily created accessible controls**

On the first `renderPaginatedRows` for a registered table, inject a compact `.table-search-tools` into that table panel's `.panel-head` unless custom control IDs are configured. The control contains:

```html
<div class="table-search-tools" data-table-search="allProducts">
  <div class="table-search-modes" role="group" aria-label="Chế độ tìm kiếm Tất cả mã hàng">...</div>
  <input type="search" aria-label="Tìm trong bảng Tất cả mã hàng">
  <button type="button" aria-label="Xóa tìm kiếm">...</button>
  <span aria-live="polite" data-table-search-count="allProducts"></span>
</div>
```

Hide the mode buttons for tables without a currently visible primary code. `Escape` calls `clearTableSearch`; input updates the state, resets page 1, and invokes the stored renderer.

- [ ] **Step 5: Put filtering before pagination inside `renderPaginatedRows`**

Store the original `items` and a zero-argument renderer closure. Call:

```js
const filtered = filterTableItems(items, config, searchState);
const result = paginate(filtered.items, state.tablePages[tableKey] || 1, TABLE_PAGE_SIZE);
```

Use `filtered.items.length / items.length` for counts. In codes mode show `Đã tìm thấy X/Y mã` and a shortened missing-code list. Assign each rendered `<tr>` a `data-table-item-id` from `config.identity(result.items[index])`. Preserve current empty-state copy when there is no query; use `Không có dòng nào chứa “…”` when a query produces zero rows.

- [ ] **Step 6: Adapt the three specialized search areas without duplicate controls**

- `cpProductFilterInput` becomes substring filtering shared by `cpDetail` and `cpMonthly`; selecting a suggestion still sets an exact product code.
- `prSearchInput`/mode buttons keep driving the report query and also populate the registry search state used for counts/export.
- `recentStockoutResultRows` and `stockout90dResultRows` route their complete sorted result arrays through `filterTableItems` before writing rows; they use generated local controls because their scan inputs are not table filters.
- `debtManagementSearch` keeps its layout and expands its searchable values to all meaningful displayed debt fields.

- [ ] **Step 7: Add styling and responsive behavior**

Add CSS for `.table-search-tools`, `.table-search-modes`, count/status text, clear button, mobile wrapping, focus-visible outlines, and reduced-motion behavior. Reuse existing color/radius/font tokens; do not introduce hardcoded theme colors.

- [ ] **Step 8: Run focused frontend tests**

Run: `node --test server/test/frontend/table-explorer.test.js server/test/frontend/table-search-ui.test.js server/test/frontend/debt-management-ui.test.js server/test/frontend/export-ui.test.js`

Expected: PASS.

- [ ] **Step 9: Commit table search UI**

```powershell
git add -- server/public/index.html server/test/frontend/table-search-ui.test.js server/test/frontend/export-ui.test.js
git commit -m "feat(dashboard): add search controls to report tables"
```

---

### Task 3: Chart-to-row navigation

**Files:**
- Modify: `server/public/index.html`
- Modify: `server/test/frontend/table-search-ui.test.js`

**Interfaces:**
- Consumes: `TABLE_EXPLORER_CONFIGS`, `state.tableDatasets`, `state.tableRenderers`, and `findTableItemPage`.
- Produces: `navigateChartToTable(tableKey, identity)`.
- Extends: `renderBarChartList(..., drilldown)` and `renderPieChartList(..., drilldown)` with an optional final argument.

- [ ] **Step 1: Write failing chart-navigation tests**

Create 150 rows so the target is on page 2. Call `navigateChartToTable('allProducts', 'SP-120')` and assert:

```js
assert.equal(dom.window.eval('state.tablePages.allProducts'), 2);
assert.equal(document.querySelector('#allProductRows tr.table-row-target').dataset.tableItemId, 'SP-120');
assert.equal(document.querySelector('[data-table-search="allProducts"] input').value, '');
```

Read the page assertion through `dom.window.eval('state.tablePages.allProducts')` because the inline script declares `state` with top-level `const`.

Add a duplicate-name customer fixture and trigger the Chart.js `onClick` callback with `dataIndex`; assert the customer code, not the label, selects the target row. Add an absent identity test that preserves current page/query and writes `Không còn tìm thấy dòng tương ứng` to the live region.

Run: `node --test server/test/frontend/table-search-ui.test.js`

Expected: FAIL because navigation is not implemented.

- [ ] **Step 2: Implement `navigateChartToTable`**

The function snapshots current page/search, resolves the identity against the original dataset, and only mutates state after a match. On success it clears the target table search, sets the target page, calls the stored renderer, scrolls the panel and row with `{ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' }`, adds `.table-row-target`, removes it after 2.5 seconds, and updates a shared `aria-live` status. On absence it emits the message and changes nothing.

- [ ] **Step 3: Add optional drill-down metadata to generic chart renderers**

Use this shape:

```js
{
  tableKey: 'topSelling',
  identity: item => state.productAnalysis === 'product' ? item.code : `parent:${item.name}`
}
```

When supplied, set canvas pointer styling, add the drill hint, and configure Chart.js `onClick` to call `navigateChartToTable(drilldown.tableKey, drilldown.identity(list[element.index]))`. Do not add click behavior when `drilldown` is absent.

- [ ] **Step 4: Wire every approved one-to-one mapping**

- `chartTopTransactions` -> `endOfDay` by transaction code.
- `chartCustomerProductBar` -> `cpDetail` by product code.
- `chartTopSelling` -> `topSelling` by product code or `parent:<name>`.
- `chartNewlyImportedTopRevenue` -> `newlyImported` by product code.
- `chartChildCategoryRevenue` and `chartChildCategoryQty` -> `childCategory` by `<parent>\u0000<child>`.
- `chartTopCustomerRevenue` -> `customerRevenue` by customer code.
- `chartDebt` -> `topDebt` by customer code.
- `chartSupplierDebt` -> `suppliers` by supplier code.

Leave revenue-by-day, purchase-by-supplier, category inventory, newly-imported category doughnuts, and all debt-management chart clicks unchanged.

- [ ] **Step 5: Add target-row styling and reduced-motion handling**

Use the existing row highlight color tokens and a dedicated `tableTargetPulse` keyframe. Under `prefers-reduced-motion: reduce`, remove animation but keep a static outline/background until the same 2.5-second cleanup.

- [ ] **Step 6: Run focused tests**

Run: `node --test server/test/frontend/table-search-ui.test.js server/test/frontend/debt-management-ui.test.js`

Expected: PASS, including the existing debt click-to-filter assertions.

- [ ] **Step 7: Commit chart navigation**

```powershell
git add -- server/public/index.html server/test/frontend/table-search-ui.test.js
git commit -m "feat(dashboard): navigate from charts to table rows"
```

---

### Task 4: Export the currently searched dataset

**Files:**
- Modify: `server/public/index.html`
- Modify: `server/dashboard/exportService.js`
- Modify: `server/dashboard/exportService.test.js`

**Interfaces:**
- Consumes: Task 1 CommonJS exports from `server/public/js/table-explorer.js`.
- Extends export payload with `tableSearch: { mode: 'normal'|'codes', query: string }`.
- Produces server helper `filterExportItems(items, tableKey, tableSearch, context)`.

- [ ] **Step 1: Write failing export-service tests**

Add tests using the existing `buildSnapshot()` fixture:

```js
const normal = exportService.__test__.buildFixedDataset(
  'products.all', snapshot, {}, { mode: 'normal', query: 'san pham a' }
);
const codeColumn = normal.worksheets[0].columns.find(column => column.label === 'Mã hàng');
assert.deepEqual(normal.worksheets[0].rows.map(row => row[codeColumn.key]), ['SP-A']);

const codes = exportService.__test__.buildFixedDataset(
  'products.all', snapshot, {}, { mode: 'codes', query: 'SP-B SP-404 SP-A' }
);
assert.equal(codes.worksheets[0].rows.length, 2);
```

Also test that a blank `tableSearch` preserves current row counts and that purchase detail worksheets only contain details belonging to filtered purchase codes.

Run: `node --test server/dashboard/exportService.test.js`

Expected: FAIL because `buildFixedDataset` ignores the fourth argument.

- [ ] **Step 2: Add tableSearch to frontend export payload**

In `buildExportPayload(tableKey)`, map export table keys to pagination table keys and include only normalized state:

```js
payload.tableSearch = {
  mode: searchState.mode === 'codes' ? 'codes' : 'normal',
  query: searchState.query || ''
};
```

Keep existing special payload fields for search results, stockout results, customer-product reports, product analysis, child category, and debt management.

- [ ] **Step 3: Implement server-side filtering before worksheet construction**

Require the pure helper module. Add a per-export-key registry with `searchText` and optional `code` accessors matching the frontend fields. Change the signature to:

```js
function buildFixedDataset(tableKey, snapshot, context, tableSearch = {})
```

Filter logical item arrays before passing them to `worksheetFromLogicalRows` or `aggregateWorksheet`. For `overview.purchases`, filter order summaries first and build the detail worksheet using only the retained order codes. Pass `payload.tableSearch` from `buildExportDataset`.

- [ ] **Step 4: Apply filtering to specialized export builders**

Filter rows in `buildCustomerProductRevenueDataset`, `buildProductRevenueSearchDataset`, `buildRecentStockoutResultDataset`, and `buildStockout90dResultDataset` using their visible fields and primary code. Keep their existing `EXPORT_NO_DATA` behavior after filtering.

- [ ] **Step 5: Run export and frontend payload tests**

Run: `node --test server/dashboard/exportService.test.js server/test/frontend/export-ui.test.js server/test/frontend/table-search-ui.test.js`

Expected: PASS.

- [ ] **Step 6: Commit export synchronization**

```powershell
git add -- server/public/index.html server/dashboard/exportService.js server/dashboard/exportService.test.js server/test/frontend/export-ui.test.js server/test/frontend/table-search-ui.test.js
git commit -m "feat(dashboard): export filtered table results"
```

---

### Task 5: Full regression and acceptance verification

**Files:**
- Modify only files from Tasks 1-4 if verification exposes a scoped defect.

**Interfaces:**
- Consumes all prior tasks.
- Produces verification evidence for the accepted spec.

- [ ] **Step 1: Run the complete frontend suite**

Run: `node --test server/test/frontend/*.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the complete export-service suite**

Run: `node --test server/dashboard/exportService.test.js`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Run syntax and whitespace checks**

Run: `node --check server/public/js/table-explorer.js`

Run: `git diff --check`

Expected: both exit 0. Existing unrelated working-tree files may appear in status but must not be staged or rewritten.

- [ ] **Step 4: Verify acceptance mappings in the final diff**

Confirm from tests and diff:

- all 20 table keys are covered;
- substring search returns every matching row across pages;
- code mode exists only when a visible primary code exists;
- all nine approved chart mappings use stable identities;
- ambiguous charts and debt-management behavior are unchanged;
- export receives and applies the same table search state;
- accessible labels/live status/reduced motion are present.

- [ ] **Step 5: Commit any verification-only correction**

If and only if Step 1-4 required a scoped correction:

```powershell
git add -- server/public/index.html server/public/js/table-explorer.js server/test/frontend/table-explorer.test.js server/test/frontend/table-search-ui.test.js server/test/frontend/export-ui.test.js server/dashboard/exportService.js server/dashboard/exportService.test.js
git commit -m "fix(dashboard): complete table explorer verification"
```

If no correction was needed, do not create an empty commit.
