'use strict';

// Tab Hoa don, muc "Phan tich": bam 1 dong o "Danh sach dat hang" / "Danh sach tra hang" mo panel chi tiet
// (dong hang lay tu /api/order-detail, /api/return-detail). Ban do bang chi tiet: order_details / return_details.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const HN = 'Hà Nội';
const SG = 'Sài Gòn';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

function payload() {
  return {
    kpi: {
      revenueToday: 0, invoicesToday: 0, cancelledToday: 0, totalStock: 0, totalProducts: 0, lowStockCount: 0,
      totalCustomers: 0, customersWithDebt: 0, totalDebt: 0, totalSuppliers: 0, suppliersWithDebt: 0,
      totalSupplierDebt: 0, totalPurchaseSpend: 0, inStockCodes: 0, totalInventoryValue: 0, inventoryValueCategoryCount: 0
    },
    filters: { products: { label: '30 ngày' }, invoices: { label: '30 ngày' } },
    invoices: {
      periodRevenue: 0, periodInvoices: 0, periodCancelledInvoices: 0, revenueByDay: [],
      pendingOrdersCount: 2, pendingOrdersTotal: 300, returnsCount: 1, totalReturns: 50,
      periodOrders: [
        { code: 'DH-1', branch: HN, customer: 'KH A', total: 100, status: 'Phiếu tạm' },
        { code: 'DH-1', branch: SG, customer: 'KH B', total: 200, status: 'Phiếu tạm' }
      ],
      periodReturns: [{ code: 'TH-1', branch: SG, originalInvoiceCode: '', customer: 'KH B', total: 50, status: 'Đã trả' }],
      transactionsReport: { transactions: [], topTransactions: [], summary: { quantity: 0, quantityKnown: true, revenue: 0, discount: 0, paid: 0 } }
    },
    newPurchases: { label: '30 ngày', orderCount: 0, totalAmount: 0, supplierCount: 0, bySupplier: [], orders: [] },
    products: {
      newProducts: { label: '30 ngày', count: 0, dateColumnAvailable: true, products: [] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      allSellingProducts: [],
      newlyImported: { products: [], topByRevenue: [], salesByCategory: [], countByCategory: [], salesRevenue: 0, salesQty: 0 }
    },
    stockValueByCategory: [], stockByCategory: [], allProducts: [], suppliers: [],
    customers: { topDebt: [], topRevenue: { top15: [], all: [], label: 'Tất cả' } }
  };
}

const ORDER_DETAIL = {
  kind: 'order', code: 'DH-1', date: '27/07/2026 09:00', customerName: 'KH A', customerCode: 'KH001', seller: 'Thu Hiền',
  warehouse: 'Chi nhánh trung tâm', status: 'Phiếu tạm', total: 100, discount: 0, paid: 0, note: 'giao <b>sớm</b>',
  lines: [
    { productCode: 'A1', productName: 'Hàng A', quantity: 2, price: 30, discount: 0, amount: 60, note: '5T' },
    { productCode: 'B2', productName: 'Hàng B', quantity: 1, price: 40, discount: 0, amount: 40, note: '' }
  ],
  lineCount: 2, totalQuantity: 3
};

const RETURN_DETAIL = {
  kind: 'return', code: 'TH-1', date: '29/09/2026 14:33', customerName: 'KH B', customerCode: 'KH002', seller: 'Hồng Phấn',
  warehouse: 'Chi nhánh trung tâm', status: 'Đã trả', invoiceCode: 'HD013586', total: 50, returnDiscount: 0, returnFee: 0, paid: 0,
  lines: [{ productCode: 'C3', productName: 'Hàng C', quantity: 5, price: 10, discount: 0, amount: 50, note: 'bị lỗi' }],
  lineCount: 1, totalQuantity: 5
};

function createPage({ respond } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#invoices' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data: payload(),
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

  const urls = [];
  dom.window.fetch = (url) => {
    const href = String(url);
    if (!href.startsWith('/api/order-detail') && !href.startsWith('/api/return-detail')) return new Promise(() => {});
    urls.push(href);
    const custom = respond && respond(href);
    if (custom) return custom;
    const body = href.startsWith('/api/order-detail') ? ORDER_DETAIL : RETURN_DETAIL;
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  const doc = dom.window.document;
  return { dom, doc, urls, $: id => doc.getElementById(id) };
}

const drawerText = page => page.$('docDrawerBody').textContent.replace(/\s+/g, ' ');
// JSDOM (runScripts 'outside-only') khong chay onclick="..." inline: tu chay thuoc tinh do trong ngu canh trang.
const clickInline = (page, element) => page.dom.window.eval(element.getAttribute('onclick'));

test('bam dong dat hang: goi /api/order-detail dung ma + co so, panel hien khach, dong hang va tong tien', async () => {
  const page = createPage();
  await settle();
  assert.equal(page.$('docDrawerBackdrop').hidden, true);

  page.$('orderRows').querySelectorAll('tr.doc-row')[1].click(); // DH-1 cua Sai Gon
  await settle();

  assert.deepEqual(page.urls, ['/api/order-detail?code=DH-1&branch=' + encodeURIComponent(SG)]);
  assert.equal(page.$('docDrawerBackdrop').hidden, false);
  assert.match(page.$('docDrawerTitle').textContent, /Chi tiết đơn đặt hàng DH-1/);
  const text = drawerText(page);
  assert.match(text, /KH A/);
  assert.match(text, /Thu Hiền/);
  assert.match(text, /Hàng A/);
  assert.match(text, /5T/);
  assert.match(text, /2 dòng · 3 sản phẩm/);
  assert.equal(page.$('docDrawerBody').querySelectorAll('tbody tr').length, 2);
  assert.equal(page.$('docDrawerBody').querySelector('.doc-total-main dd').textContent, '100₫');
  assert.equal(page.$('docDrawerBody').querySelector('b'), null, 'ghi chu phai duoc escape, khong chen HTML');
});

test('bam dong tra hang: goi /api/return-detail va hien hoa don goc', async () => {
  const page = createPage();
  await settle();

  page.$('returnRows').querySelector('tr.doc-row').click();
  await settle();

  assert.deepEqual(page.urls, ['/api/return-detail?code=TH-1&branch=' + encodeURIComponent(SG)]);
  assert.match(page.$('docDrawerTitle').textContent, /Chi tiết phiếu trả hàng TH-1/);
  const text = drawerText(page);
  assert.match(text, /HD013586/);
  assert.match(text, /bị lỗi/);
  assert.match(text, /Tổng tiền trả/);
});

test('dong dau tien va dong thu hai cung ma khac co so mo dung chung tu cua co so do', async () => {
  const page = createPage();
  await settle();
  page.$('orderRows').querySelectorAll('tr.doc-row')[0].click();
  await settle();
  assert.deepEqual(page.urls, ['/api/order-detail?code=DH-1&branch=' + encodeURIComponent(HN)]);
});

test('dong dang tai: hien "Dang tai"; Escape, nut x va bam nen deu dong panel', async () => {
  let resolveFetch;
  const page = createPage({ respond: () => new Promise(resolve => { resolveFetch = resolve; }) });
  await settle();

  const row = page.$('orderRows').querySelector('tr.doc-row');
  row.click();
  assert.match(drawerText(page), /Đang tải/);

  clickInline(page, page.$('docDrawerClose'));
  assert.equal(page.$('docDrawerBackdrop').hidden, true);
  // ket qua den muon sau khi da dong khong duoc ve lai panel
  resolveFetch({ ok: true, status: 200, json: async () => ORDER_DETAIL });
  await settle();
  assert.equal(page.$('docDrawerBody').innerHTML, '');

  row.click();
  await settle();
  page.doc.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(page.$('docDrawerBackdrop').hidden, true);

  row.click();
  await settle();
  page.dom.window.handleDocumentDetailBackdropClick({ target: page.$('docDrawerBackdrop') });
  assert.equal(page.$('docDrawerBackdrop').getAttribute('onclick'), 'handleDocumentDetailBackdropClick(event)');
  assert.equal(page.$('docDrawerBackdrop').hidden, true);
});

test('loi tu server (vd 404) hien thong diep server tra ve va co nut Thu lai', async () => {
  let fail = true;
  const page = createPage({
    respond: () => (fail
      ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy đơn đặt hàng này.' }) })
      : null)
  });
  await settle();

  page.$('orderRows').querySelector('tr.doc-row').click();
  await settle();
  assert.match(drawerText(page), /Không tìm thấy đơn đặt hàng này/);

  fail = false;
  clickInline(page, page.$('docDrawerBody').querySelector('button'));
  await settle();
  assert.match(drawerText(page), /Hàng A/);
});

test('phim Enter tren dong (tabindex=0) cung mo panel', async () => {
  const page = createPage();
  await settle();
  const row = page.$('orderRows').querySelector('tr.doc-row');
  assert.equal(row.getAttribute('tabindex'), '0');
  row.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(page.$('docDrawerBackdrop').hidden, false);
});
