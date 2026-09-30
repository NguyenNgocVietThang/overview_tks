'use strict';

// Bang "Bao cao hang hoa" (tab Tong quan): bo cot "DS Khach lon nhat" (giu ten khach + %), KHONG co
// nut "Chi tiet" nua. Bam vao 1 dong mo hop chi tiet giua man hinh (dung chung voi bang giao dich/dat hang/tra hang)
// gom bang doanh so tung khach 90 ngay (so tien + %) va bieu do tron dat canh ben.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };

const PRODUCTS = [
  { code: 'SP-1', name: 'Khay giấy bạc', stockHanoi: 5, stockSaigon: 3, availableToSell: 8, qtySold30d: 4, revenue90d: 1000, customerCount90d: 3, topCustomerRevenue90d: 600, topCustomerName: 'KH A', topCustomerShare: 0.6 },
  { code: 'SP-2', name: 'Bình nước nhựa', stockHanoi: 0, stockSaigon: 0, availableToSell: 0, qtySold30d: 0, revenue90d: 0, customerCount90d: 0, topCustomerRevenue90d: 0, topCustomerName: '', topCustomerShare: null }
];

function customersPayload(code, count = 3) {
  const rows = Array.from({ length: count }, (_, i) => ({
    customerName: 'KH ' + String.fromCharCode(65 + i),
    revenue: (count - i) * 100,
    share: null
  }));
  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  rows.forEach(row => { row.share = row.revenue / total; });
  return { code, totalRevenue: total, customerCount: count, rows };
}

function createPage({ customers = code => customersPayload(code) } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  const charts = [];
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; this.destroyed = false; charts.push(this); }
    destroy() { this.destroyed = true; }
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.HTMLElement.prototype.scrollIntoView = function () { dom.window.__scrolled = (dom.window.__scrolled || 0) + 1; };
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };

  const urls = [];
  dom.window.fetch = (url) => {
    const href = String(url);
    urls.push(href);
    if (href === '/api/product-report') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ rows: PRODUCTS, computedAt: '2026-09-29T00:15:00.000Z' }) });
    }
    if (href.startsWith('/api/product-report/customers?code=')) {
      const code = decodeURIComponent(href.split('code=')[1]);
      const payload = customers(code);
      if (payload instanceof Error) return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'loi' }) });
      return Promise.resolve({ ok: true, status: 200, json: async () => payload });
    }
    return new Promise(() => {});
  };

  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).filter(script => script.trim());
  const mainIndex = scripts.reduce((best, script, index) => (script.length > scripts[best].length ? index : best), 0);
  scripts.forEach(script => dom.window.eval(script));

  const doc = dom.window.document;
  return { dom, doc, charts, urls, run: code => dom.window.eval(code), $: id => doc.getElementById(id) };
}

const pieCharts = page => page.charts.filter(chart => chart.config.type === 'doughnut' && !chart.destroyed);
const rowOf = (page, code) => [...page.$('productReportRows').querySelectorAll('tr.doc-row')].find(tr => tr.dataset.tableItemId === code);
const modalText = page => page.$('docModalBody').textContent.replace(/\s+/g, ' ');

test('bang bo cot "DS Khach lon nhat" va KHONG con cot/nut "Chi tiet" (10 cot), dong bam duoc', async () => {
  const page = createPage();
  await settle();

  const headers = [...page.$('productReportRows').closest('table').querySelectorAll('thead th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
  assert.deepEqual(headers, [
    'Mã SP', 'Tên SP', 'Tồn HN', 'Tồn SG', 'Tồn có bán', 'Tổng SL 30 ngày', 'DS 90 ngày',
    'SL khách bán', 'Khách lớn nhất', '% Khách lớn nhất'
  ]);

  const firstRow = page.$('productReportRows').querySelector('tr');
  assert.equal(firstRow.cells.length, 10);
  assert.match(firstRow.cells[8].textContent, /KH A/);
  assert.match(firstRow.cells[9].textContent, /60/);
  assert.equal(page.$('productReportRows').querySelector('button'), null);
  assert.equal(firstRow.getAttribute('tabindex'), '0');
});

test('khung "Doanh so theo khach" va o tim san pham duoi bang da bi go', async () => {
  const page = createPage();
  await settle();
  ['productDetailPanel', 'productDetailSearchInput', 'productDetailSuggestions', 'productDetailEmptyState', 'productDetailContent']
    .forEach(id => assert.equal(page.$(id), null, id + ' khong con'));
});

test('bam 1 dong: goi API dung ma, hop giua man hinh hien bang khach (so tien + %) va bieu do tron canh ben', async () => {
  const page = createPage();
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, true);

  rowOf(page, 'SP-1').click();
  await settle();

  assert.ok(page.urls.includes('/api/product-report/customers?code=SP-1'));
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.ok(page.doc.querySelector('.doc-modal').classList.contains('is-wide'));
  assert.match(page.$('docModalTitle').textContent, /SP-1.*Khay giấy bạc/);
  assert.match(page.$('docModalSubtitle').textContent, /3 khách.*600.*90 ngày/);

  const rows = [...page.$('docModalBody').querySelectorAll('tbody tr')];
  assert.equal(rows.length, 3);
  assert.match(rows[0].cells[0].textContent, /KH A/);
  assert.match(rows[0].cells[1].textContent, /300/);
  assert.match(rows[0].cells[2].textContent, /50/); // 300 / 600

  const pies = pieCharts(page);
  assert.equal(pies.length, 1);
  assert.deepEqual(pies[0].config.data.labels, ['KH A', 'KH B', 'KH C']);
  assert.deepEqual(pies[0].config.data.datasets[0].data, [300, 200, 100]);
  assert.ok(page.$('docModalBody').contains(page.$('productDetailChart')), 'bieu do nam trong hop');
});

test('bam dong khac: huy bieu do cu, chi con 1 bieu do; dong hop huy bieu do', async () => {
  const page = createPage();
  await settle();

  rowOf(page, 'SP-1').click();
  await settle();
  const firstPie = pieCharts(page)[0];

  rowOf(page, 'SP-2').click();
  await settle();
  assert.ok(firstPie.destroyed, 'bieu do SP cu phai bi huy');
  assert.match(page.$('docModalTitle').textContent, /SP-2/);

  page.run('closeDocumentDetail()');
  assert.equal(page.$('docModalBackdrop').hidden, true);
  assert.equal(pieCharts(page).length, 0);
  assert.equal(page.$('docModalBody').innerHTML, '');
});

test('nhieu khach: bieu do tron hien du tung khach (khong gop "Khac"), chu giai HTML liet ke du', async () => {
  const page = createPage({ customers: code => customersPayload(code, 14) });
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();

  assert.equal(page.$('docModalBody').querySelectorAll('tbody tr').length, 14);
  const pie = pieCharts(page)[0];
  assert.equal(pie.config.data.labels.length, 14);
  assert.ok(!pie.config.data.labels.some(label => /^Khác/.test(label)));
  assert.equal(pie.config.data.datasets[0].data.reduce((a, b) => a + b, 0), (14 + 13 + 12 + 11 + 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1) * 100);
  assert.equal(pie.config.options.plugins.legend.display, false, 'legend Chart.js tat, dung chu giai HTML');
  const legendRows = page.$('productDetailLegend').querySelectorAll('.legend-row');
  assert.equal(legendRows.length, 14);
  assert.match(legendRows[0].textContent, /KH A/);
});

test('san pham chua co du lieu khach: thong bao ro rang, khong ve bieu do', async () => {
  const page = createPage({ customers: code => ({ code, totalRevenue: 0, customerCount: 0, rows: [] }) });
  await settle();
  rowOf(page, 'SP-2').click();
  await settle();

  assert.match(modalText(page), /Chưa có dữ liệu khách/);
  assert.equal(pieCharts(page).length, 0);
});

test('API loi: hien thong bao loi + nut Thu lai trong hop, khong vo trang', async () => {
  const page = createPage({ customers: () => new Error('boom') });
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();

  assert.match(modalText(page), /Không tải được doanh số khách/);
  assert.ok(page.$('docModalBody').querySelector('button'), 'co nut Thu lai');
  assert.equal(pieCharts(page).length, 0);
});

test('phim Enter tren dong cung mo hop chi tiet', async () => {
  const page = createPage();
  await settle();
  rowOf(page, 'SP-1').dispatchEvent(new page.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.match(page.$('docModalTitle').textContent, /SP-1/);
});
