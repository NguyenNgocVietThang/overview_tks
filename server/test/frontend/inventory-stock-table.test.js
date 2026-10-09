'use strict';

// Khung "Cơ cấu tồn kho": bo bieu do + nut Theo nhom cha; bang co cot "Tồn có thể bán" (ton - khach dat)
// va "Hàng đang vận chuyển"; o "Cả hai" gop 1 dong/ma voi cot HN/SG rieng.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const HN = 'Hà Nội';
const SG = 'Sài Gòn';
const BOTH = 'Hà Nội, Sài Gòn';

// `available` mo phong dung payload server (dashboardData.js): ton - khach dat (quy tac 2026-10-06,
// hang dang van chuyen chi hien thi); omitAvailable mo phong payload cu khong co truong nay (giao dien tu tinh).
function product(code, branch, { stock, reserved = 0, cost = 10, inTransit = 0, name = 'Sản phẩm ' + code, omitAvailable = false }) {
  const item = {
    code, branch, name, stock, reserved, available: stock - reserved, inTransit, status: 'Đang kinh doanh',
    cost, stockValue: Math.max(stock, 0) * cost, pct: 0
  };
  if (omitAvailable) delete item.available;
  return item;
}

// stripCost mo phong payload da qua dashboardPermissionFilter cho tai khoan thieu reports.products.cost
// (Nhan vien sale): khong co cost/stockValue trong allProducts va khong co kpi.totalInventoryValue.
function payload(allProducts, { stripCost = false } = {}) {
  const rows = stripCost ? allProducts.map(({ cost, stockValue, ...rest }) => rest) : allProducts;
  return {
    kpi: {
      totalStock: 0, totalProducts: rows.length, lowStockCount: 0, inStockCodes: 0,
      ...(stripCost ? {} : { totalInventoryValue: 0 })
    },
    filters: { products: { label: '30 ngày' } },
    products: {
      newProducts: { label: '30 ngày', count: 0, dateColumnAvailable: true, products: [] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      allSellingProducts: [],
      newlyImported: { products: [], salesRevenue: 0, salesQty: 0 }
    },
    allProducts: rows
  };
}

function createPage(allProducts, options) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data: payload(allProducts, options),
    days: 30,
    filters: { products: { mode: 'days', days: 30 }, invoices: { mode: 'days', days: 30 }, customers: { mode: 'all' } }
  }));
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  dom.window.eval("switchView('products')");
  return dom;
}

const clean = th => th.textContent.replace(/[↕↑↓▲▼]/g, '').trim();

function visibleHeaders(doc) {
  return [...doc.getElementById('inventoryValueRows').closest('table').querySelectorAll('thead th')]
    .filter(th => !th.hidden).map(clean);
}

function visibleRows(doc) {
  return [...doc.querySelectorAll('#inventoryValueRows tr')]
    .filter(tr => tr.cells.length > 1)
    .map(tr => [...tr.cells].filter(td => !td.hidden).map(td => td.textContent.trim()));
}

test('bo bieu do va nut "Theo sản phẩm / Theo nhóm cha" khoi khung Cơ cấu tồn kho', () => {
  assert.equal(/id="chartInventoryValue"/.test(html), false);
  assert.equal(/inventoryViewToggle|setInventoryView/.test(html), false);
  const dom = createPage([product('SP-1', HN, { stock: 5 })]);
  const doc = dom.window.document;
  assert.equal(doc.getElementById('chartInventoryValue'), null);
  assert.equal(doc.getElementById('inventoryViewToggle'), null);
  assert.equal(dom.window.eval('typeof renderInventoryValueChart'), 'undefined');
  assert.equal(dom.window.eval('typeof setInventoryView'), 'undefined');
  const panel = doc.getElementById('inventoryTablePanel');
  assert.ok(panel.classList.contains('col-12'), 'bang chiem tron khung');
  dom.window.close();
});

test('chon 1 co so: 1 dong/ma, co Tồn có thể bán = tồn - khách đặt (khong cong van chuyen) va cot Hàng đang vận chuyển', () => {
  const dom = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, cost: 100 }),
    product('SP-2', HN, { stock: 1, reserved: 4, cost: 50 })
  ]);
  const doc = dom.window.document;
  assert.deepEqual(visibleHeaders(doc), [
    'Mã hàng', 'Tên sản phẩm', 'Đơn giá', 'Tồn kho', 'Vận chuyển SG', 'Tồn có thể bán', 'Giá trị tồn'
  ]);
  const rows = visibleRows(doc);
  assert.equal(rows.length, 2);
  const byCode = Object.fromEntries(rows.map(cells => [cells[0], cells]));
  assert.deepEqual(byCode['SP-1'].slice(3, 6), [ '8', '720', '5'], '8 - 3; 720 dang van chuyen chi de xem');
  assert.equal(byCode['SP-2'][5], '-3', 'khach dat vuot ton thi hien am, khong kep 0');
  assert.equal(byCode['SP-2'][4], '—', 'khong co hang dang van chuyen thi hien —');
  assert.equal(doc.getElementById('tagInventoryTable').textContent, '2');
  dom.window.close();
});

test('payload cu khong co "available": giao dien tu tinh ton - khach dat (1 co so va "Cả hai")', () => {
  const single = createPage([product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, omitAvailable: true })]);
  assert.equal(visibleRows(single.window.document)[0][5], '5');
  single.window.close();

  const both = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, omitAvailable: true }),
    product('SP-1', SG, { stock: 2, reserved: 1, inTransit: 720, omitAvailable: true })
  ]);
  const cells = visibleRows(both.window.document)[0];
  assert.deepEqual([cells[6], cells[7]], ['5', '1']);
  both.window.close();
});

test('"Cả hai": gop 1 dong/ma voi cot ton kho + ton co the ban HN/SG rieng va 1 cot Hàng đang vận chuyển', () => {
  const dom = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, cost: 10 }),
    product('SP-1', SG, { stock: 2, reserved: 1, inTransit: 720, cost: 20 }),
    product('SP-2', HN, { stock: 4, cost: 5 }),
    product('SP-3', SG, { stock: 6, reserved: 6, inTransit: 100, cost: 7 })
  ]);
  const doc = dom.window.document;
  assert.deepEqual(visibleHeaders(doc), [
    'Mã hàng', 'Tên sản phẩm', 'Đơn giá', 'Tồn HN', 'Vận chuyển SG', 'Tồn SG',
    'Có bán HN', 'Có bán SG', 'Giá trị tồn'
  ]);
  const rows = visibleRows(doc);
  assert.equal(rows.length, 3, 'SP-1 o hai co so chi con 1 dong');
  const byCode = Object.fromEntries(rows.map(cells => [cells[0], cells]));
  // [ma, ten, don gia, ton HN, dang van chuyen SG, ton SG, co the ban HN, co the ban SG, gia tri ton]
  // Hang dang van chuyen cung 1 so theo ma, chi hien o cot Vận chuyển — KHONG tinh vao ton co the ban (2026-10-06).
  assert.deepEqual(byCode['SP-1'].slice(3, 8), [ '8', '720', '2', '5', '1'],
    'so dang van chuyen theo ma, khong cong don 2 lan o cot Vận chuyển');
  assert.deepEqual([byCode['SP-2'][3], byCode['SP-2'][5], byCode['SP-2'][6], byCode['SP-2'][7]], ['4', '—', '4', '—'], 'ma chi co o Ha Noi');
  assert.deepEqual([byCode['SP-3'][3], byCode['SP-3'][4], byCode['SP-3'][5], byCode['SP-3'][6], byCode['SP-3'][7]], ['—', '100', '6', '—', '0'], '6 - 6');
  assert.equal(doc.getElementById('tagInventoryTable').textContent, '3');
  dom.window.close();
});

test('buildInventoryRows: gia tri ton cong theo co so, don gia binh quan theo ton, xep giam dan theo gia tri ton', () => {
  const dom = createPage([]);
  const built = dom.window.eval(`buildInventoryRows(${JSON.stringify([
    product('SP-1', HN, { stock: 8, cost: 10 }),
    product('SP-1', SG, { stock: 2, cost: 20 }),
    product('SP-2', HN, { stock: 100, cost: 5 })
  ])})`);
  assert.equal(built.isBoth, true);
  assert.deepEqual(JSON.parse(JSON.stringify(built.rows.map(r => r.code))), ['SP-2', 'SP-1'], '500 > 120');
  const sp1 = built.rows.find(r => r.code === 'SP-1');
  assert.equal(sp1.stock, 10);
  assert.equal(sp1.stockValue, 120);
  assert.equal(sp1.cost, 12, '(8*10 + 2*20) / 10');
  dom.window.close();
});

test('sap xep theo cot Tồn có thể bán tren du lieu 1 co so dung chi so cot (o an van nam trong dong)', () => {
  const dom = createPage([
    product('SP-A', HN, { stock: 10, reserved: 9, cost: 1 }),
    product('SP-B', HN, { stock: 3, reserved: 0, cost: 1 }),
    product('SP-C', HN, { stock: 7, reserved: 2, cost: 1 })
  ]);
  const doc = dom.window.document;
  const rowsHtml = [...doc.querySelectorAll('#inventoryValueRows tr')];
  assert.equal(rowsHtml[0].cells.length, 11, 'du 11 o moi dong, o cua che do kia bi hidden');
  const headerIndex = [...doc.getElementById('inventoryValueRows').closest('table').querySelectorAll('thead th')]
    .findIndex(th => clean(th) === 'Tồn có thể bán');
  dom.window.eval(`setTableSort('inventoryValueRows', ${headerIndex})`);
  const ordered = [...doc.querySelectorAll('#inventoryValueRows tr')].map(tr => tr.cells[0].textContent.trim());
  assert.deepEqual(ordered, ['SP-A', 'SP-B', 'SP-C'], 'tang dan theo ton co the ban: A=1, B=3, C=5');
  dom.window.close();
});

test('tai khoan thieu quyen xem gia von (Nhan vien sale): an cot Đơn giá + Giá trị tồn va the KPI Giá trị tồn kho', () => {
  const dom = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, cost: 100 }),
    product('SP-2', HN, { stock: 1, reserved: 4, cost: 50 })
  ], { stripCost: true });
  const doc = dom.window.document;
  assert.deepEqual(visibleHeaders(doc), ['Mã hàng', 'Tên sản phẩm', 'Tồn kho', 'Vận chuyển SG', 'Tồn có thể bán']);
  const byCode = Object.fromEntries(visibleRows(doc).map(cells => [cells[0], cells]));
  assert.deepEqual(byCode['SP-1'], ['SP-1', 'Sản phẩm SP-1', '8', '720', '5']);
  assert.equal(doc.getElementById('pr-stockvalue').closest('.kpi-card').hidden, true);
  const kpiLabels = [...doc.querySelectorAll('#allProductsKpis .eyebrow')].map(el => el.textContent.trim());
  assert.deepEqual(kpiLabels, ['Tổng số mã hàng'], 'khong con KPI Tong gia tri ton kho / khach dat');
  dom.window.close();
});

test('"Cả hai" cung an Đơn giá + Giá trị tồn khi payload khong co gia von', () => {
  const dom = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, cost: 10 }),
    product('SP-1', SG, { stock: 2, reserved: 1, cost: 20 })
  ], { stripCost: true });
  assert.deepEqual(visibleHeaders(dom.window.document), [
    'Mã hàng', 'Tên sản phẩm', 'Tồn HN', 'Vận chuyển SG', 'Tồn SG', 'Có bán HN', 'Có bán SG'
  ]);
  dom.window.close();
});

test('tai khoan co quyen xem gia von: van thay Đơn giá + Giá trị tồn va the KPI', () => {
  const dom = createPage([product('SP-1', HN, { stock: 8, cost: 100 })]);
  const doc = dom.window.document;
  assert.ok(visibleHeaders(doc).includes('Đơn giá'));
  assert.ok(visibleHeaders(doc).includes('Giá trị tồn'));
  assert.equal(doc.getElementById('pr-stockvalue').closest('.kpi-card').hidden, false);
  dom.window.close();
});
