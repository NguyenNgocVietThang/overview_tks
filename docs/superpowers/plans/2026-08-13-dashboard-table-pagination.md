# Dashboard Table Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the multi-second UI freeze when opening the "Hàng hóa" (Products) tab, caused by rendering thousands of table rows into the DOM in one synchronous `innerHTML` write.

**Architecture:** Measured live (see Evidence below): `switchView('products')` blocks the main thread for **~3.5 seconds**, because it builds one giant HTML string for `d.allProducts` (7,624 rows) and another for `d.lowStock` (4,688 rows) and assigns each to `.innerHTML` in one shot. Both tables already live inside a `max-height:420px` scrollable box, so the user only ever sees a handful of rows at a time — the full-list render buys nothing visually. This plan adds a small, dependency-free, unit-tested pagination helper (`server/public/js/pagination.js`, usable from both Node tests and the browser) and wires it into the two offending tables in `server/public/index.html`, rendering ~200 rows at a time with Prev/Next controls instead of the full list.

**Tech Stack:** Plain browser JS (no bundler, matches the existing `<script src="/vendor/...">` pattern), Node's built-in `node:test` for the pure pagination logic, Claude Browser MCP tools for empirical before/after verification (this codebase has no browser test framework, and adding one is out of scope).

## Evidence (measured against the real running app, `server/public/index.html` + `/api/dashboard`)

- `/api/dashboard` payload: **2,074,787 bytes** (~2 MB) JSON.
- `allProducts` array: **7,624** items. `lowStock` array: **4,688** items. Neither is paginated or limited server-side (unlike e.g. `topSellingProducts`, capped at 10).
- `switchView('products')` timed with `performance.now()`: **3623.6 ms** (first call), **3468.7 ms** (repeat call).
- Other tabs, same technique: `overview` 252.4 ms, `customers` 98.4 ms, `suppliers` 9.3 ms, `invoices` 6.1 ms.

This isolates the Products tab's two full-list tables as the dominant, reproducible cause of "lag" — not network, not Chart.js, not the other tabs.

## Global Constraints

- No new npm dependencies, no bundler/build step — keep the existing raw `<script src>` loading pattern (see `/vendor/chart.umd.min.js`).
- Preserve the existing client-side column-sort feature (`sortTableRows`, `index.html:1524`) — after this change it sorts only the rows on the currently visible page. This is a deliberate, acceptable trade-off (documented here, not to be "fixed" as part of this plan).
- Preserve exact visual style — reuse existing CSS custom properties and match the look of the existing `.mini-filter-apply` button (`index.html:386-391`).
- Vietnamese comments matching the surrounding file's style.
- The KPI tag counts (e.g. `tagAllProducts`, `tagLowStock`) must keep showing the **total** item count, not the current page size — only the rendered `<tr>` rows are paginated.

---

### Task 1: Add a unit-tested `paginate()` helper

**Files:**
- Create: `server/public/js/pagination.js`
- Test: `server/public/js/pagination.test.js`

**Interfaces:**
- Produces: `paginate(items, page, pageSize) -> { items, page, pageSize, totalPages, totalItems }`. Exposed as `window.paginate` in the browser and via `module.exports` for Node tests (dual CommonJS/global pattern, no bundler needed). Task 2 depends on this exact signature and return shape.

- [ ] **Step 1: Write the failing test**

Create `server/public/js/pagination.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { paginate } = require('./pagination');

test('paginate tra ve dung so trang va cat dung doan items', () => {
  const items = Array.from({ length: 250 }, (_, i) => i + 1); // [1..250]

  const page1 = paginate(items, 1, 100);
  assert.deepEqual(page1.items, items.slice(0, 100));
  assert.equal(page1.page, 1);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.totalItems, 250);

  const page3 = paginate(items, 3, 100);
  assert.deepEqual(page3.items, items.slice(200, 250)); // trang cuoi chi con 50 phan tu

  const clampedLow = paginate(items, 0, 100);
  assert.equal(clampedLow.page, 1, 'page < 1 phai ep ve trang 1');

  const clampedHigh = paginate(items, 99, 100);
  assert.equal(clampedHigh.page, 3, 'page vuot qua totalPages phai ep ve trang cuoi');
});

test('paginate xu ly mang rong va input khong hop le ma khong throw', () => {
  const empty = paginate([], 1, 100);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.totalItems, 0);

  const notArray = paginate(null, 1, 100);
  assert.deepEqual(notArray.items, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from repo root):
```bash
node --test "server/public/js/pagination.test.js"
```
Expected: FAIL — `Cannot find module './pagination'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `server/public/js/pagination.js`:
```js
// Cat 1 mang lon thanh tung trang nho, tranh dua hang chuc nghin dong <tr>
// vao DOM cung luc — xem allProductRows/stockRows trong index.html (bang
// "Tat ca ma hang" ~7600 dong khien switchView('products') mat ~3.5s khi
// render toan bo cung luc). Ham thuan, dung chung cho browser (window.paginate)
// va Node test (require truc tiep).
function paginate(items, page, pageSize) {
  const list = Array.isArray(items) ? items : [];
  const size = Number(pageSize) > 0 ? Math.floor(pageSize) : (list.length || 1);
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const currentPage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (currentPage - 1) * size;
  return {
    items: list.slice(start, start + size),
    page: currentPage,
    pageSize: size,
    totalPages,
    totalItems
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { paginate };
}
if (typeof window !== 'undefined') {
  window.paginate = paginate;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from repo root):
```bash
node --test "server/public/js/pagination.test.js"
```
Expected: PASS (2 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add server/public/js/pagination.js server/public/js/pagination.test.js
git commit -m "feat(dashboard): add unit-tested pagination helper for large tables"
```

---

### Task 2: Paginate the "Tất cả mã hàng" (allProducts) table

**Files:**
- Modify: `server/public/index.html` — head script tag (`:14`), CSS (`:527`), markup (`:1031-1042`), app script (add `renderPaginatedRows` helper near `:2488`, `state` object `:1393`, call site `:2604-2611`)

**Interfaces:**
- Consumes: `window.paginate` from Task 1.
- Produces: `renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage)` — a reusable render helper. Task 3 reuses this exact function for the `lowStock` table; do not duplicate it.
- Produces: `state.tablePages` (object, mirrors the existing `state.tableSorts` convention at `index.html:1393`) — tracks the current page per table key across re-renders.

- [ ] **Step 1: Load the new script**

In `server/public/index.html`, replace:
```html
<script src="/vendor/chart.umd.min.js"></script>
```
with:
```html
<script src="/vendor/chart.umd.min.js"></script>
<script src="/js/pagination.js"></script>
```

- [ ] **Step 2: Add pagination-controls CSS**

Find (around `index.html:527`):
```css
  .loading-veil.show{ opacity:1; pointer-events:all; }

  @media (max-width:760px){
```
Replace with:
```css
  .loading-veil.show{ opacity:1; pointer-events:all; }

  .pagination-controls{
    display:flex; align-items:center; justify-content:center; gap:10px;
    margin-top:10px; font-family:var(--font-body); font-size:11.5px; color:var(--muted);
  }
  .pagination-controls button{
    min-height:30px; padding:0 12px; border:1px solid var(--border); border-radius:7px;
    background:var(--panel-2); color:var(--text); font-family:var(--font-body);
    font-size:11.5px; font-weight:600; cursor:pointer; transition:border-color .15s ease, opacity .15s ease;
  }
  .pagination-controls button:hover:not(:disabled){ border-color:var(--muted); }
  .pagination-controls button:disabled{ opacity:.4; cursor:default; }

  @media (max-width:760px){
```

- [ ] **Step 3: Add pagination controls markup**

Find (around `index.html:1031-1042`):
```html
            <div class="panel col-7">
              <div class="panel-head">
                <h2>Tất cả mã hàng <span class="tag" id="tagAllProducts">—</span></h2>
                <span class="drill-hint">Lọc theo trạng thái ở thanh bộ lọc phía trên</span>
              </div>
              <div class="scroll-list" style="max-height:420px;">
                <table>
                  <thead><tr><th>Sản phẩm</th><th>Tồn</th><th>Đặt</th><th>Tỷ lệ</th><th>Trạng thái</th></tr></thead>
                  <tbody id="allProductRows"><tr><td colspan="5" class="empty">Đang tải...</td></tr></tbody>
                </table>
              </div>
            </div>
```
Replace with:
```html
            <div class="panel col-7">
              <div class="panel-head">
                <h2>Tất cả mã hàng <span class="tag" id="tagAllProducts">—</span></h2>
                <span class="drill-hint">Lọc theo trạng thái ở thanh bộ lọc phía trên</span>
              </div>
              <div class="scroll-list" style="max-height:420px;">
                <table>
                  <thead><tr><th>Sản phẩm</th><th>Tồn</th><th>Đặt</th><th>Tỷ lệ</th><th>Trạng thái</th></tr></thead>
                  <tbody id="allProductRows"><tr><td colspan="5" class="empty">Đang tải...</td></tr></tbody>
                </table>
              </div>
              <div class="pagination-controls" id="allProductsPagination" hidden>
                <button type="button" id="allProductsPrevPage">‹ Trước</button>
                <span id="allProductsPageLabel">Trang 1/1</span>
                <button type="button" id="allProductsNextPage">Sau ›</button>
              </div>
            </div>
```

- [ ] **Step 4: Add `tablePages` state and the `renderPaginatedRows` helper**

Find (around `index.html:1393`):
```js
    tableSorts: {},
```
Replace with:
```js
    tableSorts: {},
    tablePages: {}, // { [tableKey]: currentPage } — xem renderPaginatedRows()
```

Find the start of the render helpers, right before `function renderView(view){` (around `index.html:2488`), and insert immediately above it:
```js
  const TABLE_PAGE_SIZE = 200; // allProducts/lowStock co the len toi hang nghin dong; render het cung luc lam switchView('products') mat ~3.5s (xem docs/superpowers/plans/2026-08-13-dashboard-table-pagination.md)

  /**
   * Render 1 bang lon theo trang thay vi day het toan bo `items` vao DOM cung
   * luc. Giu nguyen trang dang xem trong state.tablePages qua cac lan
   * re-render (vi du sau khi loadData() refresh du lieu).
   */
  function renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage){
    const tbody = document.getElementById(ids.tbody);
    const result = paginate(items, state.tablePages[tableKey] || 1, TABLE_PAGE_SIZE);
    state.tablePages[tableKey] = result.page;

    tbody.innerHTML = result.items.length
      ? result.items.map(rowHtmlFn).join('')
      : '<tr><td colspan="' + emptyColspan + '" class="empty">' + emptyMessage + '</td></tr>';

    const pagination = document.getElementById(ids.pagination);
    const prevBtn = document.getElementById(ids.prevBtn);
    const nextBtn = document.getElementById(ids.nextBtn);
    const label = document.getElementById(ids.label);
    pagination.hidden = result.totalPages <= 1;
    label.textContent = 'Trang ' + result.page + '/' + result.totalPages;
    prevBtn.disabled = result.page <= 1;
    nextBtn.disabled = result.page >= result.totalPages;
    prevBtn.onclick = function(){
      state.tablePages[tableKey] = result.page - 1;
      renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage);
    };
    nextBtn.onclick = function(){
      state.tablePages[tableKey] = result.page + 1;
      renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage);
    };
  }

```

- [ ] **Step 5: Wire the `allProducts` table to use it**

Find (around `index.html:2604-2611`):
```js
      const filteredProducts = d.allProducts || [];
      document.getElementById('tagAllProducts').textContent = filteredProducts.length;
      const allRows = document.getElementById('allProductRows');
      allRows.innerHTML = filteredProducts.length ? filteredProducts.map(p =>
        '<tr><td class="name-cell">' + escapeHtml(p.name) + '<br><span class="mono muted" style="font-size:10.5px;">' + escapeHtml(p.code) + '</span></td>' +
        '<td class="mono" data-sort-value="' + p.stock + '">' + stockPill(p.stock) + '</td><td class="mono muted" data-sort-value="' + p.reserved + '">' + p.reserved + '</td>' +
        '<td class="mono muted" data-sort-value="' + p.pct + '">' + p.pct.toFixed(2) + '%</td><td>' + bizStatusPill(p.status) + '</td></tr>'
      ).join('') : '<tr><td colspan="5" class="empty">Không có dữ liệu</td></tr>';
```
Replace with:
```js
      const filteredProducts = d.allProducts || [];
      document.getElementById('tagAllProducts').textContent = filteredProducts.length;
      renderPaginatedRows(
        'allProducts',
        { tbody: 'allProductRows', pagination: 'allProductsPagination', prevBtn: 'allProductsPrevPage', nextBtn: 'allProductsNextPage', label: 'allProductsPageLabel' },
        filteredProducts,
        p => '<tr><td class="name-cell">' + escapeHtml(p.name) + '<br><span class="mono muted" style="font-size:10.5px;">' + escapeHtml(p.code) + '</span></td>' +
          '<td class="mono" data-sort-value="' + p.stock + '">' + stockPill(p.stock) + '</td><td class="mono muted" data-sort-value="' + p.reserved + '">' + p.reserved + '</td>' +
          '<td class="mono muted" data-sort-value="' + p.pct + '">' + p.pct.toFixed(2) + '%</td><td>' + bizStatusPill(p.status) + '</td></tr>',
        5,
        'Không có dữ liệu'
      );
```

- [ ] **Step 6: Verify in the browser (no automated frontend test harness exists in this repo — see plan header)**

Start the dev server preview (`.claude/launch.json` config `tokosi-dashboard`), then in the browser console / via the browser JS tool, on the loaded dashboard page:
```js
(() => {
  const t0 = performance.now();
  switchView('products');
  return performance.now() - t0;
})()
```
Expected: previously ~3500ms (see plan header Evidence), now well under 300ms.

Also click the "Sau ›" / "‹ Trước" buttons under "Tất cả mã hàng" and confirm: the page label updates (`Trang 2/39`), the row count stays at 200 or fewer, `tagAllProducts` still shows the full total (7624, unchanged), and "Sau ›" disables on the last page / "‹ Trước" disables on page 1.

- [ ] **Step 7: Commit**

```bash
git add server/public/index.html
git commit -m "perf(dashboard): paginate the all-products table instead of rendering it in full"
```

---

### Task 3: Paginate the "Hàng đã hết" (lowStock) table

**Files:**
- Modify: `server/public/index.html` — markup (`:1022-1030`), app script call site (`:2592-2597`)

**Interfaces:**
- Consumes: `renderPaginatedRows` (from Task 2) — reused unchanged with a different `tableKey` and `ids`.

- [ ] **Step 1: Add pagination controls markup**

Find (around `index.html:1022-1030`):
```html
            <div class="panel col-5">
              <div class="panel-head"><h2>Hàng đã hết <span class="tag" id="tagLowStock">—</span></h2></div>
              <div class="scroll-list" style="max-height:420px;">
                <table>
                  <thead><tr><th>Sản phẩm</th><th>Loại</th><th>Trạng thái kinh doanh</th><th>Giá vốn</th><th>Giá bán</th></tr></thead>
                  <tbody id="stockRows"><tr><td colspan="5" class="empty">Đang tải...</td></tr></tbody>
                </table>
              </div>
            </div>
```
Replace with:
```html
            <div class="panel col-5">
              <div class="panel-head"><h2>Hàng đã hết <span class="tag" id="tagLowStock">—</span></h2></div>
              <div class="scroll-list" style="max-height:420px;">
                <table>
                  <thead><tr><th>Sản phẩm</th><th>Loại</th><th>Trạng thái kinh doanh</th><th>Giá vốn</th><th>Giá bán</th></tr></thead>
                  <tbody id="stockRows"><tr><td colspan="5" class="empty">Đang tải...</td></tr></tbody>
                </table>
              </div>
              <div class="pagination-controls" id="stockPagination" hidden>
                <button type="button" id="stockPrevPage">‹ Trước</button>
                <span id="stockPageLabel">Trang 1/1</span>
                <button type="button" id="stockNextPage">Sau ›</button>
              </div>
            </div>
```

- [ ] **Step 2: Wire the `lowStock` table to use `renderPaginatedRows`**

Find (around `index.html:2592-2597`):
```js
      const rows = document.getElementById('stockRows');
      rows.innerHTML = d.lowStock.length ? d.lowStock.map(p =>
        '<tr><td class="name-cell">' + escapeHtml(p.name) + '<br><span class="mono muted" style="font-size:10.5px;">' + escapeHtml(p.code) + '</span></td>' +
        '<td>' + (p.type ? escapeHtml(p.type) : '—') + '</td><td>' + bizStatusPill(p.status) + '</td>' +
        '<td class="mono muted" data-sort-value="' + p.cost + '">' + fmtMoney(p.cost) + '</td><td class="mono" data-sort-value="' + p.price + '">' + fmtMoney(p.price) + '</td></tr>'
      ).join('') : '<tr><td colspan="5" class="empty">Không có sản phẩm đã hết hàng</td></tr>';
```
Replace with:
```js
      renderPaginatedRows(
        'lowStock',
        { tbody: 'stockRows', pagination: 'stockPagination', prevBtn: 'stockPrevPage', nextBtn: 'stockNextPage', label: 'stockPageLabel' },
        d.lowStock,
        p => '<tr><td class="name-cell">' + escapeHtml(p.name) + '<br><span class="mono muted" style="font-size:10.5px;">' + escapeHtml(p.code) + '</span></td>' +
          '<td>' + (p.type ? escapeHtml(p.type) : '—') + '</td><td>' + bizStatusPill(p.status) + '</td>' +
          '<td class="mono muted" data-sort-value="' + p.cost + '">' + fmtMoney(p.cost) + '</td><td class="mono" data-sort-value="' + p.price + '">' + fmtMoney(p.price) + '</td></tr>',
        5,
        'Không có sản phẩm đã hết hàng'
      );
```

- [ ] **Step 3: Verify in the browser**

Repeat the Task 2 Step 6 timing check — `switchView('products')` should now cover both tables and stay well under 300ms (down from ~3500ms). Click "Sau ›"/"‹ Trước" under "Hàng đã hết" and confirm the same behavior as Task 2 (label updates, `tagLowStock` still shows the full total of 4688, boundary buttons disable correctly), and confirm it doesn't interfere with the "Tất cả mã hàng" pagination state (each table's page is tracked independently via its own `tableKey`).

- [ ] **Step 4: Commit**

```bash
git add server/public/index.html
git commit -m "perf(dashboard): paginate the low-stock table instead of rendering it in full"
```

---

## Self-Review Notes

- **Spec coverage:** The measured ~3.5s freeze (both `allProducts` and `lowStock`, the two unbounded arrays found in the payload) is covered by Task 2 and Task 3. The `paginate()` core logic is unit-tested (Task 1); the DOM wiring is verified empirically against the real running app since no frontend test framework exists in this repo (documented as a deliberate scope boundary, not an oversight).
- **Placeholder scan:** No TBD/placeholder steps; every step has literal code or an exact command with an expected result.
- **Type consistency:** `renderPaginatedRows(tableKey, ids, items, rowHtmlFn, emptyColspan, emptyMessage)` is defined once in Task 2 Step 4 and called identically (same parameter order, same `ids` object shape) in Task 2 Step 5 and Task 3 Step 2. `paginate(items, page, pageSize)`'s return shape (`{ items, page, pageSize, totalPages, totalItems }`) matches between Task 1's implementation/test and Task 2's `renderPaginatedRows` usage (`result.items`, `result.page`, `result.totalPages`).
