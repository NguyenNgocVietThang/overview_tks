'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const indexPath = path.join(publicDir, 'index.html');

function createDashboard() {
  const source = fs.readFileSync(indexPath, 'utf8');
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.Chart = class FakeChart {
    static instances = [];
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; FakeChart.instances.push(this); }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = {
    authGuard: () => new Promise(() => {}),
    // Trang bao cao goi TKSNav.can('reports.<tab>') de biet tab nao duoc xem
    // (nguon: user.permissions tu /api/auth/me) — test nay khong kiem tra phan
    // quyen nen mo het.
    can: () => true,
    handleBranchError: () => false,
    renderTopSidebar() {}
  };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

test('registry bao phủ đủ 17 bảng trong Báo cáo tổng hợp (không còn 2 bảng Đặt hàng / Trả hàng của tab Hóa đơn; thêm 3 bảng Báo cáo kinh doanh)', () => {
  const dom = createDashboard();
  const expected = [
    'cpDetail', 'productReport', 'recentStockout', 'stockout90d', 'stockout30d',
    'endOfDay', 'todayNewProducts', 'topSelling',
    'allProducts', 'inventoryValue', 'newlyImported',
    'customerRevenue', 'topDebt', 'debtManagement',
    'businessSales', 'businessCustomers', 'businessProducts'
  ];
  const actual = Object.keys(dom.window.TABLE_EXPLORER_CONFIGS);
  assert.deepEqual([...actual].sort(), expected.sort());
  dom.window.close();
});

test('tìm từng bảng lọc toàn bộ dữ liệu trước phân trang và giữ mọi kết quả chứa cụm từ', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const products = Array.from({ length: 105 }, (_, index) => ({
    code: `SP${String(index + 1).padStart(3, '0')}`,
    name: index === 100 || index === 101 ? `Chổi lau nhà ${index}` : `Sản phẩm ${index}`,
    stock: index
  }));

  dom.window.renderPaginatedRows(
    'allProducts',
    {
      tbody: 'allProductRows', pagination: 'allProductsPagination',
      firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
      nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage',
      label: 'allProductsPageLabel'
    },
    products,
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`,
    2,
    'Không có dữ liệu'
  );

  const input = document.querySelector('[data-table-search="allProducts"] .table-search-input');
  input.value = 'choi lau nha';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const rows = [...document.querySelectorAll('#allProductRows tr[data-table-item-id]')];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.dataset.tableItemId), ['SP101', 'SP102']);
  assert.equal(document.querySelector('[data-table-search-count="allProducts"]').textContent, '');
  assert.match(document.getElementById('allProductsPageLabel').textContent, /Trang 1\/1/);
  dom.window.close();
});

test('sort cột áp dụng cho toàn bộ dữ liệu đã lọc, không chỉ trang đang xem', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  // stock giam dan theo thu tu nguon: dong dau co stock lon nhat (249), dong cuoi co
  // stock nho nhat (0) — trang 1 (100 dong dau) truoc khi sort chi chua cac gia tri
  // stock tu 150 den 249, khong chua gia tri nho nhat nao.
  const products = Array.from({ length: 250 }, (_, index) => ({
    code: `SP${index}`,
    stock: 249 - index
  }));
  const ids = {
    tbody: 'allProductRows', pagination: 'allProductsPagination',
    firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
    nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage', label: 'allProductsPageLabel'
  };
  dom.window.renderPaginatedRows('allProducts', ids, products,
    item => `<tr><td>${item.code}</td><td data-sort-value="${item.stock}">${item.stock}</td></tr>`,
    2, 'Không có dữ liệu');

  dom.window.setTableSort('allProductRows', 1); // sort tang dan theo cot stock (cot index 1)

  const stocksOnPage1 = [...document.querySelectorAll('#allProductRows tr td:nth-child(2)')]
    .map(td => Number(td.getAttribute('data-sort-value')));
  assert.equal(stocksOnPage1.length, 100);
  assert.deepEqual(stocksOnPage1, Array.from({ length: 100 }, (_, i) => i));
  assert.match(document.getElementById('allProductsPageLabel').textContent, /Trang 1\/3/);

  document.getElementById('allProductsNextPage').click();
  const stocksOnPage2 = [...document.querySelectorAll('#allProductRows tr td:nth-child(2)')]
    .map(td => Number(td.getAttribute('data-sort-value')));
  assert.deepEqual(stocksOnPage2, Array.from({ length: 100 }, (_, i) => i + 100));

  dom.window.close();
});

test('chế độ nhiều mã khớp chính xác trên toàn bộ bảng và báo mã thiếu', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const products = [
    { code: 'SP001', name: 'Sản phẩm 1' },
    { code: 'SP002', name: 'Sản phẩm 2' },
    { code: '00123', name: 'Sản phẩm giữ số 0' }
  ];
  const ids = {
    tbody: 'allProductRows', pagination: 'allProductsPagination',
    firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
    nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage', label: 'allProductsPageLabel'
  };
  dom.window.renderPaginatedRows('allProducts', ids, products,
    item => `<tr><td>${item.name}</td><td>${item.branch}</td></tr>`, 2, 'Không có dữ liệu');

  document.querySelector('[data-table-search="allProducts"] [data-table-search-mode="codes"]').click();
  const input = document.querySelector('[data-table-search="allProducts"] .table-search-input');
  input.value = '00123, SP404; sp002';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.deepEqual(
    [...document.querySelectorAll('#allProductRows tr[data-table-item-id]')].map(row => row.dataset.tableItemId),
    ['SP002', '00123']
  );
  assert.match(document.querySelector('[data-table-search-count="allProducts"]').textContent, /Đã tìm thấy 2\/3 mã/);
  assert.match(document.querySelector('[data-table-search-count="allProducts"]').textContent, /SP404/);
  dom.window.close();
});

test('bảng kết quả đứt hàng dùng cùng bộ lọc dù có renderer chuyên biệt', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  dom.window.renderRecentStockoutResultTable({
    asOfDate: '16/09/2026',
    totalProductsScanned: 3,
    rows: [
      { code: 'SP01', name: 'Chổi lau nhà lớn', lastOutOfStockDate: '15/09/2026', daysOutOfStock: 2, periods: [] },
      { code: 'SP02', name: 'Chổi lau nhà nhỏ', lastOutOfStockDate: '14/09/2026', daysOutOfStock: 3, periods: [] },
      { code: 'SP03', name: 'Nước lau sàn', lastOutOfStockDate: '13/09/2026', daysOutOfStock: 4, periods: [] }
    ]
  });

  const input = document.querySelector('[data-table-search="recentStockout"] .table-search-input');
  input.value = 'choi lau nha';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  assert.deepEqual(
    [...document.querySelectorAll('#recentStockoutResultRows tr[data-table-item-id]')].map(row => row.dataset.tableItemId),
    ['SP02', 'SP01']
  );
  assert.equal(document.getElementById('tagRecentStockoutRows').textContent, '2/3');
  dom.window.close();
});

test('điều hướng biểu đồ xóa tìm kiếm, chuyển đúng trang và tô sáng dòng đích', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const products = Array.from({ length: 150 }, (_, index) => ({
    code: `SP${String(index + 1).padStart(3, '0')}`,
    name: `Sản phẩm ${index + 1}`
  }));
  const ids = {
    tbody: 'allProductRows', pagination: 'allProductsPagination',
    firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
    nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage', label: 'allProductsPageLabel'
  };
  dom.window.renderPaginatedRows('allProducts', ids, products,
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`, 2, 'Không có dữ liệu');

  const input = document.querySelector('[data-table-search="allProducts"] .table-search-input');
  input.value = 'SP001';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  dom.window.navigateChartToTable('allProducts', 'SP120');

  assert.equal(input.value, '');
  assert.equal(document.getElementById('allProductsPageLabel').textContent, 'Trang 2/2');
  assert.equal(document.querySelector('#allProductRows tr.table-row-target').dataset.tableItemId, 'SP120');
  dom.window.close();
});

test('điều hướng tới dòng doanh thu khách theo tên khách (khách gộp hai cơ sở, không còn mã KH)', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const customers = [
    { name: 'Công ty Minh Anh', branch: 'Hà Nội', revenue: 100, saleOrderCount: 1 },
    { name: 'Công ty Hồng Hà', branch: 'Hà Nội, Sài Gòn', revenue: 200, saleOrderCount: 2 }
  ];
  const ids = {
    tbody: 'customerRevenueRows', pagination: 'customerRevenuePagination',
    firstBtn: 'customerRevenueFirstPage', prevBtn: 'customerRevenuePrevPage',
    nextBtn: 'customerRevenueNextPage', lastBtn: 'customerRevenueLastPage', label: 'customerRevenuePageLabel'
  };
  dom.window.renderPaginatedRows('customerRevenue', ids, customers,
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`, 2, 'Không có dữ liệu');
  dom.window.navigateChartToTable('customerRevenue', dom.window.customerIdentity(customers[1]));

  assert.equal(document.querySelector('#customerRevenueRows tr.table-row-target').dataset.tableItemId, 'công ty hồng hà');
  dom.window.close();
});

test('mục biểu đồ đã biến mất chỉ thông báo và giữ nguyên bộ lọc bảng', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const ids = {
    tbody: 'allProductRows', pagination: 'allProductsPagination',
    firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
    nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage', label: 'allProductsPageLabel'
  };
  dom.window.renderPaginatedRows('allProducts', ids, [{ code: 'SP001', name: 'Sản phẩm 1' }],
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`, 2, 'Không có dữ liệu');
  const input = document.querySelector('[data-table-search="allProducts"] .table-search-input');
  input.value = 'SP001';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  dom.window.navigateChartToTable('allProducts', 'SP404');

  assert.equal(input.value, 'SP001');
  assert.equal(document.getElementById('allProductsPageLabel').textContent, 'Trang 1/1');
  assert.equal(document.getElementById('tableNavigationStatus').textContent, 'Không còn tìm thấy dòng tương ứng');
  dom.window.close();
});

test('payload xuất Excel mang theo chế độ và từ khóa của đúng bảng', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  const ids = {
    tbody: 'allProductRows', pagination: 'allProductsPagination',
    firstBtn: 'allProductsFirstPage', prevBtn: 'allProductsPrevPage',
    nextBtn: 'allProductsNextPage', lastBtn: 'allProductsLastPage', label: 'allProductsPageLabel'
  };
  dom.window.renderPaginatedRows('allProducts', ids, [{ code: 'SP001', name: 'Chổi lau nhà' }],
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`, 2, 'Không có dữ liệu');
  document.querySelector('[data-table-search="allProducts"] [data-table-search-mode="codes"]').click();
  const input = document.querySelector('[data-table-search="allProducts"] .table-search-input');
  input.value = 'SP001 SP404';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const payload = dom.window.buildExportPayload('products.all');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.tableSearch)), {
    mode: 'codes',
    query: 'SP001 SP404'
  });
  dom.window.close();
});

test('xuất file (Excel/HTML) gửi đúng bộ lọc thời gian riêng của từng bảng, xóa lọc thì gửi "Tất cả"', () => {
  const dom = createDashboard();
  const win = dom.window;
  const clone = value => JSON.parse(JSON.stringify(value));
  // khóa bộ lọc của bảng trên trang -> [khoảng ngày]; mỗi bảng một khoảng khác nhau để phát hiện lẫn lộn.
  const ranges = {
    topSelling: ['2026-01-01', '2026-01-07'], newlyImported: ['2026-02-01', '2026-02-07'],
    newProducts: ['2026-03-01', '2026-03-07'], invoices: ['2026-04-01', '2026-04-07'],
    customers: ['2026-07-01', '2026-07-07']
  };
  Object.entries(ranges).forEach(([key, [from, to]]) => win.setTableDateFilter(key, from, to));

  // bảng xuất file -> [khóa bộ lọc trong payload, khóa bộ lọc trên trang]
  const exportTables = {
    'products.top-selling': ['products', 'topSelling'],
    'products.newly-imported': ['newlyImported', 'newlyImported'],
    'overview.new-products': ['newProducts', 'newProducts'],
    'overview.transactions': ['invoices', 'invoices'],
    'customers.revenue': ['customers', 'customers'],
    'customers.debt': ['customers', 'customers']
  };
  Object.entries(exportTables).forEach(([tableKey, [payloadKey, stateKey]]) => {
    const [from, to] = ranges[stateKey];
    assert.deepEqual(clone(win.buildExportPayload(tableKey).filters[payloadKey]), { mode: 'range', from, to }, tableKey);
  });
  // 2 bang Dat hang / Tra hang cua tab Hoa don da bo: payload khong con bo loc orders/returns.
  const filters = clone(win.buildExportPayload('overview.transactions').filters);
  assert.equal('orders' in filters, false);
  assert.equal('returns' in filters, false);

  win.setTableDateFilter('newlyImported', '', '');
  assert.deepEqual(clone(win.buildExportPayload('products.newly-imported').filters.newlyImported), { mode: 'all' });
  assert.deepEqual(clone(win.buildExportPayload('products.top-selling').filters.products), { mode: 'range', from: '2026-01-01', to: '2026-01-07' },
    'xóa lọc Hàng mới nhập không đụng tới Hàng bán chạy');
  dom.window.close();
});

test('bảng Chi tiết tồn kho có nút xuất file, payload mang chế độ và từ khóa tìm kiếm của bảng', () => {
  const dom = createDashboard();
  const document = dom.window.document;
  assert.match(document.getElementById('inventoryTablePanel').innerHTML, /openExportDialog\('products\.inventory'\)/);
  const ids = {
    tbody: 'inventoryValueRows', pagination: 'inventoryValuePagination',
    firstBtn: 'inventoryValueFirstPage', prevBtn: 'inventoryValuePrevPage',
    nextBtn: 'inventoryValueNextPage', lastBtn: 'inventoryValueLastPage', label: 'inventoryValuePageLabel'
  };
  dom.window.renderPaginatedRows('inventoryValue', ids, [{ code: 'SP001', name: 'Chổi lau nhà' }],
    item => `<tr><td>${item.code}</td><td>${item.name}</td></tr>`, 2, 'Không có dữ liệu');
  const input = document.querySelector('[data-table-search="inventoryValue"] .table-search-input');
  input.value = 'chổi';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));

  const payload = dom.window.buildExportPayload('products.inventory');
  assert.equal(payload.tableKey, 'products.inventory');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.tableSearch)), { mode: 'normal', query: 'chổi' });
  dom.window.close();
});

test('ô tìm kiếm bảng ẩn nút × mặc định của trình duyệt để chỉ còn một nút xóa', () => {
  const source = fs.readFileSync(indexPath, 'utf8');
  assert.match(source, /\.table-search-input\[type="search"\]::-webkit-search-cancel-button/);
});
