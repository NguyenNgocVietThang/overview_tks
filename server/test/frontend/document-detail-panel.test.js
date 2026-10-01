'use strict';

// Tab Hoa don, muc "Giao dich": bam 1 dong o "Chi tiet giao dich" mo panel chi tiet (dong hang lay tu
// /api/invoice-detail, ban do bang chi tiet: invoice_details). Hai bang "Danh sach dat hang" / "Danh sach tra hang"
// da bo 2026-10-01 (don Phieu tam xem chi tiet o trang Vong doi don hang) nen khong con panel/API chi tiet cua chung.

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
      totalCustomers: 0, customersWithDebt: 0, totalDebt: 0, inStockCodes: 0, totalInventoryValue: 0, inventoryValueCategoryCount: 0
    },
    filters: { products: { label: '30 ngày' }, invoices: { label: '30 ngày' } },
    invoices: {
      periodRevenue: 0, periodInvoices: 0, periodCancelledInvoices: 0, revenueByDay: [],
      returnsCount: 1, totalReturns: 50,
      transactionsReport: {
        transactions: [
          { code: 'HD-1', branch: HN, time: '21/09 09:08', customer: 'KH A', employee: 'NV', quantity: 3, quantityKnown: true, revenue: 90, discount: 10, paid: 90, status: 'Hoàn thành' },
          { code: 'HD-1', branch: SG, time: '21/09 09:10', customer: 'KH B', employee: 'NV', quantity: 1, quantityKnown: true, revenue: 30, discount: 0, paid: 30, status: 'Hoàn thành' }
        ],
        topTransactions: [], summary: { quantity: 4, quantityKnown: true, revenue: 120, discount: 10, paid: 120 }
      }
    },
    products: {
      newProducts: { label: '30 ngày', count: 0, dateColumnAvailable: true, products: [] },
      topSellingProducts: [], topSellingParentCategories: [], childCategorySalesByParent: {}, availableParentCategories: [],
      allSellingProducts: [],
      newlyImported: { products: [], topByRevenue: [], salesByCategory: [], countByCategory: [], salesRevenue: 0, salesQty: 0 }
    },
    stockValueByCategory: [], stockByCategory: [], allProducts: [],
    customers: { topDebt: [], topRevenue: { top15: [], all: [], label: 'Tất cả' } }
  };
}

const INVOICE_DETAIL = {
  kind: 'invoice', code: 'HD-1', date: '21/09/2026 09:08', customerName: 'KH A', customerCode: 'KH001', seller: 'NV',
  warehouse: 'Chi nhánh trung tâm', status: 'Hoàn thành', orderCode: 'DH-9', total: 90, discount: 10, paid: 90, note: 'giao <b>sớm</b>',
  lines: [{ productCode: 'A1', productName: 'Hàng A', quantity: 3, price: 30, discount: 3.33, amount: 90, note: '5T' }],
  lineCount: 1, totalQuantity: 3
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
    // Bat ca 2 API chi tiet da xoa (order/return) de chung minh trang khong con goi chung.
    if (!/^\/api\/(order|return|invoice)-detail/.test(href)) return new Promise(() => {});
    urls.push(href);
    const custom = respond && respond(href);
    if (custom) return custom;
    return Promise.resolve({ ok: true, status: 200, json: async () => INVOICE_DETAIL });
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

const drawerText = page => page.$('docModalBody').textContent.replace(/\s+/g, ' ');
// JSDOM (runScripts 'outside-only') khong chay onclick="..." inline: tu chay thuoc tinh do trong ngu canh trang.
const clickInline = (page, element) => page.dom.window.eval(element.getAttribute('onclick'));
const firstTransactionRow = page => page.$('endOfDayRows').querySelector('tr.doc-row');

test('bam dong "Chi tiet giao dich": goi /api/invoice-detail, hien ma don goc, giam gia, dong hang va tong tien hang', async () => {
  const page = createPage();
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, true);

  page.$('endOfDayRows').querySelectorAll('tr.doc-row')[0].click(); // HD-1 cua Ha Noi
  await settle();

  assert.deepEqual(page.urls, ['/api/invoice-detail?code=HD-1&branch=' + encodeURIComponent(HN)]);
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.match(page.$('docModalTitle').textContent, /Chi tiết giao dịch HD-1/);
  const text = drawerText(page);
  assert.match(text, /KH A/);
  assert.match(text, /Thời gian bán/);
  assert.match(text, /Nhân viên bán hàng/);
  assert.match(text, /DH-9/);
  assert.match(text, /Giảm giá hóa đơn/);
  assert.match(text, /Tổng tiền hàng/);
  assert.match(text, /Hàng A/);
  assert.match(text, /5T/);
  assert.match(text, /1 dòng · 3 sản phẩm/);
  assert.equal(page.$('docModalBody').querySelectorAll('tbody tr').length, 1);
  assert.equal(page.$('docModalBody').querySelector('.doc-total-main dd').textContent, '90₫');
  assert.equal(page.$('docModalBody').querySelector('b'), null, 'ghi chu phai duoc escape, khong chen HTML');
  assert.match(text, /giao <b>sớm<\/b>/);
});

test('hai dong cung ma khac co so mo dung chung tu cua co so do', async () => {
  const page = createPage();
  await settle();
  const rows = page.$('endOfDayRows').querySelectorAll('tr.doc-row');
  assert.equal(rows.length, 2);

  rows[1].click();
  await settle();
  assert.deepEqual(page.urls, ['/api/invoice-detail?code=HD-1&branch=' + encodeURIComponent(SG)]);

  rows[0].click();
  await settle();
  assert.deepEqual(page.urls.slice(1), ['/api/invoice-detail?code=HD-1&branch=' + encodeURIComponent(HN)]);
});

test('dong dang tai: hien "Dang tai"; Escape, nut x va bam nen deu dong panel', async () => {
  let resolveFetch;
  const page = createPage({ respond: () => new Promise(resolve => { resolveFetch = resolve; }) });
  await settle();

  const row = firstTransactionRow(page);
  row.click();
  assert.match(drawerText(page), /Đang tải/);

  clickInline(page, page.$('docModalClose'));
  assert.equal(page.$('docModalBackdrop').hidden, true);
  // ket qua den muon sau khi da dong khong duoc ve lai panel
  resolveFetch({ ok: true, status: 200, json: async () => INVOICE_DETAIL });
  await settle();
  assert.equal(page.$('docModalBody').innerHTML, '');

  row.click();
  await settle();
  page.doc.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(page.$('docModalBackdrop').hidden, true);

  row.click();
  await settle();
  page.dom.window.handleDocumentDetailBackdropClick({ target: page.$('docModalBackdrop') });
  assert.equal(page.$('docModalBackdrop').getAttribute('onclick'), 'handleDocumentDetailBackdropClick(event)');
  assert.equal(page.$('docModalBackdrop').hidden, true);
});

test('loi tu server (vd 404) hien thong diep server tra ve va co nut Thu lai', async () => {
  let fail = true;
  const page = createPage({
    respond: () => (fail
      ? Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy hóa đơn này.' }) })
      : null)
  });
  await settle();

  firstTransactionRow(page).click();
  await settle();
  assert.match(drawerText(page), /Không tìm thấy hóa đơn này/);

  fail = false;
  clickInline(page, page.$('docModalBody').querySelector('button'));
  await settle();
  assert.match(drawerText(page), /Hàng A/);
});

test('phim Enter tren dong (tabindex=0) cung mo panel', async () => {
  const page = createPage();
  await settle();
  const row = firstTransactionRow(page);
  assert.equal(row.getAttribute('tabindex'), '0');
  row.dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, false);
});

test('hai bang Dat hang / Tra hang da bo khoi tab Hoa don: khong con bang, khong con kind chi tiet va khong con API chi tiet cua chung', async () => {
  const page = createPage();
  await settle();
  assert.equal(page.$('orderRows'), null);
  assert.equal(page.$('returnRows'), null);
  // DOC_DETAIL_KINDS khai bao bang const (khong lo ra window): kiem tra qua hanh vi — kind la thi khong mo panel.
  page.dom.window.openDocumentDetail('orders', { code: 'DH-1', branch: HN });
  page.dom.window.openDocumentDetail('returns', { code: 'TH-1', branch: SG });
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, true);
  assert.doesNotMatch(html, /\/api\/order-detail|\/api\/return-detail/);
  assert.deepEqual(page.urls, [], 'khong goi API chi tiet nao khi chua bam dong hoa don');
});

test('hop chi tiet nam GIUA man hinh (backdrop can giua), khong phai ngan keo canh phai', () => {
  const rule = html.match(/\.doc-modal-backdrop\s*\{([^}]*)\}/)[1];
  assert.match(rule, /align-items:\s*center/);
  assert.match(rule, /justify-content:\s*center/);
  assert.doesNotMatch(html, /doc-drawer/);
});
