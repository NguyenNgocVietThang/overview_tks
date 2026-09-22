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
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#products' });
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

function visibleHeaders(document, tbodyId) {
  const table = document.getElementById(tbodyId).closest('table');
  // Bo ky tu bieu tuong sap xep duoc gan them vao tieu de luc khoi tao trang.
  return [...table.querySelectorAll('thead th')]
    .filter(th => !th.hidden)
    .map(th => th.textContent.replace(/[↕↑↓▲▼]/g, '').trim());
}

function visibleCells(document, tbodyId) {
  return [...document.getElementById(tbodyId).querySelectorAll('tr')]
    .map(tr => [...tr.querySelectorAll('td')].filter(td => !td.hidden).map(td => td.textContent.trim()));
}

const RECENT_BOTH = {
  asOfDate: '2026-09-21',
  branch: 'Cả hai',
  totalProductsScanned: 12,
  sources: { invoices: 'db' },
  warnings: [],
  rows: [
    { code: 'SP001', name: 'Áo thun', branch: 'Hà Nội', lastOutOfStockDate: '2026-09-10', daysOutOfStock: 11, periods: [] },
    { code: 'SP001', name: 'Áo thun', branch: 'Sài Gòn', lastOutOfStockDate: '2026-09-15', daysOutOfStock: 6, periods: [] }
  ]
};

const NINETY_BOTH = {
  asOfDate: '2026-09-21',
  fromDate: '2026-06-23',
  branch: 'Cả hai',
  totalProductsScanned: 12,
  sources: { invoices: 'db' },
  warnings: [],
  rows: [
    { code: 'SP001', name: 'Áo thun', branch: 'Hà Nội', stockoutCount: 2, totalStockoutDays: 10, currentOnHand: 0, periods: [] },
    { code: 'SP001', name: 'Áo thun', branch: 'Sài Gòn', stockoutCount: 1, totalStockoutDays: 4, currentOnHand: 3, periods: [] }
  ]
};

test('Hàng đứt gần đây quét ở "Cả hai": bảng có cột Cơ sở và mỗi dòng ghi rõ nguồn', () => {
  const dom = createDashboard();
  dom.window.renderRecentStockoutResultTable(RECENT_BOTH);

  assert.equal(visibleHeaders(dom.window.document, 'recentStockoutResultRows')[0], 'Cơ sở');
  assert.deepEqual(visibleCells(dom.window.document, 'recentStockoutResultRows').map(cells => cells[0]), ['Hà Nội', 'Sài Gòn']);
  dom.window.close();
});

test('Hàng đứt gần đây quét ở một cơ sở: không thêm cột Cơ sở', () => {
  const dom = createDashboard();
  dom.window.renderRecentStockoutResultTable({ ...RECENT_BOTH, branch: 'Hà Nội', rows: [RECENT_BOTH.rows[0]] });

  const headers = visibleHeaders(dom.window.document, 'recentStockoutResultRows');
  assert.equal(headers.includes('Cơ sở'), false);
  assert.equal(headers[0], 'Mã SP');
  assert.deepEqual(visibleCells(dom.window.document, 'recentStockoutResultRows'), [
    ['SP001', 'Áo thun', '2026-09-10', '11', '', '']
  ]);
  dom.window.close();
});

test('Kiểm tra đứt hàng 90 ngày quét ở "Cả hai": bảng có cột Cơ sở và mỗi dòng ghi rõ nguồn', () => {
  const dom = createDashboard();
  dom.window.renderStockout90dResultTable(NINETY_BOTH);

  assert.equal(visibleHeaders(dom.window.document, 'stockout90dResultRows')[0], 'Cơ sở');
  assert.deepEqual(visibleCells(dom.window.document, 'stockout90dResultRows').map(cells => cells[0]), ['Hà Nội', 'Sài Gòn']);
  dom.window.close();
});

test('Kiểm tra đứt hàng 90 ngày quét ở một cơ sở: không thêm cột Cơ sở', () => {
  const dom = createDashboard();
  dom.window.renderStockout90dResultTable({ ...NINETY_BOTH, branch: 'Sài Gòn', rows: [NINETY_BOTH.rows[1]] });

  assert.equal(visibleHeaders(dom.window.document, 'stockout90dResultRows').includes('Cơ sở'), false);
  dom.window.close();
});

test('Kiểm tra đứt hàng 30 ngày quét ở "Cả hai": bảng có cột Cơ sở và mỗi dòng ghi rõ nguồn', () => {
  const dom = createDashboard();
  dom.window.renderStockout30dResultTable({ ...NINETY_BOTH, fromDate: '2026-08-23' });

  assert.equal(visibleHeaders(dom.window.document, 'stockout30dResultRows')[0], 'Cơ sở');
  assert.deepEqual(visibleCells(dom.window.document, 'stockout30dResultRows').map(cells => cells[0]), ['Hà Nội', 'Sài Gòn']);
  dom.window.close();
});

test('Kiểm tra đứt hàng 30 ngày quét ở một cơ sở: không thêm cột Cơ sở', () => {
  const dom = createDashboard();
  dom.window.renderStockout30dResultTable({ ...NINETY_BOTH, branch: 'Sài Gòn', rows: [NINETY_BOTH.rows[1]] });

  assert.equal(visibleHeaders(dom.window.document, 'stockout30dResultRows').includes('Cơ sở'), false);
  dom.window.close();
});
