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

function product(code, branch, { stock, reserved = 0, cost = 10, inTransit = 0, name = 'Sản phẩm ' + code }) {
  return {
    code, branch, name, stock, reserved, available: stock - reserved, inTransit, status: 'Đang kinh doanh',
    cost, stockValue: Math.max(stock, 0) * cost, pct: 0
  };
}

function payload(allProducts) {
  return {
    kpi: { totalStock: 0, totalProducts: allProducts.length, lowStockCount: 0, inStockCodes: 0, totalInventoryValue: 0, inventoryValueCategoryCount: 0 },
    filters: { products: { label: '30 ngày' } },
    products: {
      newProducts: { label: '30 ngày', count: 0, dateColumnAvailable: true, products: [] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      allSellingProducts: [],
      newlyImported: { products: [], topByRevenue: [], salesByCategory: [], countByCategory: [], salesRevenue: 0, salesQty: 0 }
    },
    stockValueByCategory: [], stockByCategory: [], allProducts
  };
}

function createPage(allProducts) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data: payload(allProducts),
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

test('chon 1 co so: 1 dong/ma, co Tồn có thể bán = tồn - khách đặt va Hàng đang vận chuyển', () => {
  const dom = createPage([
    product('SP-1', HN, { stock: 8, reserved: 3, inTransit: 720, cost: 100 }),
    product('SP-2', HN, { stock: 1, reserved: 4, cost: 50 })
  ]);
  const doc = dom.window.document;
  assert.deepEqual(visibleHeaders(doc), [
    'Mã hàng', 'Tên sản phẩm', 'Cơ sở', 'Đơn giá', 'Tồn kho', 'Tồn có thể bán', 'Hàng đang vận chuyển', 'Giá trị tồn'
  ]);
  const rows = visibleRows(doc);
  assert.equal(rows.length, 2);
  const byCode = Object.fromEntries(rows.map(cells => [cells[0], cells]));
  assert.deepEqual(byCode['SP-1'].slice(2, 3).concat(byCode['SP-1'].slice(4, 7)), [HN, '8', '5', '720']);
  assert.equal(byCode['SP-2'][5], '-3', 'khach dat vuot ton thi hien am, khong kep 0');
  assert.equal(byCode['SP-2'][6], '—', 'khong co hang dang van chuyen thi hien —');
  assert.equal(doc.getElementById('tagInventoryTable').textContent, '2');
  dom.window.close();
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
    'Mã hàng', 'Tên sản phẩm', 'Cơ sở', 'Đơn giá', 'Tồn kho HN', 'Tồn kho SG',
    'Tồn có thể bán HN', 'Tồn có thể bán SG', 'Hàng đang vận chuyển', 'Giá trị tồn'
  ]);
  const rows = visibleRows(doc);
  assert.equal(rows.length, 3, 'SP-1 o hai co so chi con 1 dong');
  const byCode = Object.fromEntries(rows.map(cells => [cells[0], cells]));
  // [ma, ten, co so, don gia, ton HN, ton SG, co the ban HN, co the ban SG, dang van chuyen, gia tri ton]
  assert.deepEqual(byCode['SP-1'].slice(2, 3).concat(byCode['SP-1'].slice(4, 9)), [BOTH, '8', '2', '5', '1', '720'],
    'so dang van chuyen theo ma, khong cong don 2 lan');
  assert.deepEqual([byCode['SP-2'][2], byCode['SP-2'][4], byCode['SP-2'][5], byCode['SP-2'][6], byCode['SP-2'][7]], [HN, '4', '—', '4', '—'], 'ma chi co o Ha Noi');
  assert.deepEqual([byCode['SP-3'][2], byCode['SP-3'][4], byCode['SP-3'][5], byCode['SP-3'][6], byCode['SP-3'][7], byCode['SP-3'][8]], [SG, '—', '6', '—', '0', '100']);
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
  assert.equal(rowsHtml[0].cells.length, 12, 'du 12 o moi dong, o cua che do kia bi hidden');
  const headerIndex = [...doc.getElementById('inventoryValueRows').closest('table').querySelectorAll('thead th')]
    .findIndex(th => clean(th) === 'Tồn có thể bán');
  dom.window.eval(`setTableSort('inventoryValueRows', ${headerIndex})`);
  const ordered = [...doc.querySelectorAll('#inventoryValueRows tr')].map(tr => tr.cells[0].textContent.trim());
  assert.deepEqual(ordered, ['SP-A', 'SP-B', 'SP-C'], 'tang dan theo ton co the ban: A=1, B=3, C=5');
  dom.window.close();
});
