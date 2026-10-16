'use strict';

// Cot "Cơ sở" o bang Chi tiet giao dich (hoa don cung ma o hai co so la hai dong rieng) va thanh tim kiem chung da bo.
// (Cac bang cua tab Hang hoa cu va tab Khach hang cu da go 2026-10-16.)

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

function payload() {
  return {
    kpi: {
      totalStock: 7, totalProducts: 2, lowStockCount: 1,
      totalCustomers: 1, customersWithDebt: 1, totalDebt: 500, inStockCodes: 2, totalInventoryValue: 70
    },
    filters: { products: { label: '30 ngày' }, invoices: { label: '30 ngày' } },
    invoices: {
      periodRevenue: 0, periodInvoices: 0, periodCancelledInvoices: 0, revenueByDay: [],
      transactionsReport: {
        transactions: [
          { code: 'HD-1', branch: HN, time: '21/09 09:08', customer: 'KH A', employee: 'NV', quantity: 1, quantityKnown: true, revenue: 10, discount: 0, paid: 10, status: 'Hoàn thành' },
          { code: 'HD-1', branch: SG, time: '21/09 09:10', customer: 'KH B', employee: 'NV', quantity: 2, quantityKnown: true, revenue: 20, discount: 0, paid: 20, status: 'Hoàn thành' }
        ],
        topTransactions: [], summary: { quantity: 3, quantityKnown: true, revenue: 30, discount: 0, paid: 30 }
      }
    },
  };
}

function createPage() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
    data: payload(),
    days: 30,
    filters: { products: { mode: 'days', days: 30 }, invoices: { mode: 'days', days: 30 } }
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
  return dom;
}

function headers(doc, tbodyId) {
  return [...doc.getElementById(tbodyId).closest('table').querySelectorAll('thead th')].filter(th => !th.hidden)
    .map(th => th.textContent.replace(/[↕↑↓▲▼]/g, '').trim());
}

function rows(doc, tbodyId) {
  return [...doc.querySelectorAll('#' + tbodyId + ' tr[data-table-item-id], #' + tbodyId + ' tr')]
    .filter((tr, index, all) => all.indexOf(tr) === index && tr.cells.length > 1)
    .map(tr => [...tr.cells].filter(td => !td.hidden).map(td => td.textContent.trim()));
}

const TABLES_WITH_BRANCH = {
  invoices: ['endOfDayRows']
};

test('cac bang dong theo co so co cot "Cơ sở" va dong nao cung ghi co so', () => {
  const dom = createPage();
  const doc = dom.window.document;
  Object.entries(TABLES_WITH_BRANCH).forEach(([view, tables]) => {
    dom.window.eval("switchView('" + view + "')");
    tables.forEach(id => {
      assert.ok(headers(doc, id).includes('Cơ sở'), id + ' phai co cot Cơ sở: ' + JSON.stringify(headers(doc, id)));
      rows(doc, id).forEach(cells => {
        assert.ok(cells.some(text => [HN, SG, BOTH].includes(text)), id + ' dong ' + JSON.stringify(cells) + ' phai ghi co so');
      });
    });
  });
  dom.window.close();
});

test('thanh tim kiem chung dau tab da bo, bo loc thoi gian chuyen vao bang', () => {
  const dom = createPage();
  const doc = dom.window.document;
  assert.equal(doc.getElementById('dashboardSearchForm'), null);
  assert.equal(doc.getElementById('dashboardSearchInput'), null);
  assert.equal(doc.getElementById('searchResult'), null);
  // Bo loc thoi gian gio nam trong tung bang (TABLE_DATE_FILTERS), khong con thanh loc dau tab.
  assert.equal(doc.getElementById('filterBar'), null);
  dom.window.close();
});
