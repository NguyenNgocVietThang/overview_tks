'use strict';

// Bang "Bao cao hang hoa" (tab Tong quan): bo cot "DS Khach lon nhat" (giu ten khach + %),
// them nut "Chi tiet" moi dong. Nhan Chi tiet HOAC tim ten/ma san pham o o tim trong khung
// duoi bang deu di qua 1 ham (selectProductReportDetail) nen phai cho ra ket qua y het nhau:
// bang doanh so tung khach 90 ngay (so tien + %) va bieu do tron dat canh ben.

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

test('bang bo cot "DS Khach lon nhat" nhung giu "Khach lon nhat" va "% Khach lon nhat", them cot "Chi tiet" (van 11 cot)', async () => {
  const page = createPage();
  await settle();

  const headers = [...page.$('productReportRows').closest('table').querySelectorAll('thead th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
  assert.deepEqual(headers, [
    'Mã SP', 'Tên SP', 'Tồn Hà Nội', 'Tồn Sài Gòn', 'Tổng tồn có thể bán', 'Tổng SL 30 ngày', 'DS 90 ngày',
    'SL khách bán', 'Khách lớn nhất', '% Khách lớn nhất', 'Chi tiết'
  ]);
  assert.ok(!headers.includes('DS Khách lớn nhất'));

  const firstRow = page.$('productReportRows').querySelector('tr');
  assert.equal(firstRow.cells.length, 11);
  assert.match(firstRow.cells[8].textContent, /KH A/);
  assert.match(firstRow.cells[9].textContent, /60/);
  const button = firstRow.querySelector('button[data-product-detail]');
  assert.equal(button.dataset.productDetail, 'SP-1');
});

test('cot "Chi tiet" khong co nut sap xep (khong phai du lieu de sort)', async () => {
  const page = createPage();
  await settle();
  const headers = [...page.$('productReportRows').closest('table').querySelectorAll('thead th')];
  assert.equal(headers[10].querySelector('.sort-button'), null);
  assert.ok(headers[9].querySelector('.sort-button'), 'cot % Khach lon nhat van sort duoc');
});

test('nhan Chi tiet: goi API dung ma, hien bang khach (so tien + %) va ve bieu do tron canh ben', async () => {
  const page = createPage();
  await settle();

  page.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();

  assert.ok(page.urls.includes('/api/product-report/customers?code=SP-1'));
  assert.equal(page.$('productDetailContent').hidden, false);
  assert.equal(page.$('productDetailEmptyState').hidden, true);
  assert.match(page.$('productDetailTitle').textContent, /SP-1.*Khay giấy bạc/);
  assert.equal(page.$('productDetailSearchInput').value, 'SP-1 - Khay giấy bạc');

  const rows = [...page.$('productDetailRows').querySelectorAll('tr')];
  assert.equal(rows.length, 3);
  assert.match(rows[0].cells[0].textContent, /KH A/);
  assert.match(rows[0].cells[1].textContent, /300/);
  assert.match(rows[0].cells[2].textContent, /50/); // 300 / 600

  const pies = pieCharts(page);
  assert.equal(pies.length, 1);
  assert.deepEqual(pies[0].config.data.labels, ['KH A', 'KH B', 'KH C']);
  assert.deepEqual(pies[0].config.data.datasets[0].data, [300, 200, 100]);
  // Bang va bieu do cung nam trong 1 khung duoi bang san pham (khong phai o phan khac cua trang).
  const panel = page.$('productDetailPanel');
  assert.ok(panel.contains(page.$('productDetailRows')) && panel.contains(page.$('productDetailChart')));
  assert.ok(page.$('productReportRows').closest('.panel').compareDocumentPosition(panel) & 4, 'khung chi tiet nam SAU bang san pham');
});

test('tim theo ten hoac ma roi chon goi y cho ra KET QUA Y HET nhu nhan nut Chi tiet', async () => {
  const viaButton = createPage();
  await settle();
  viaButton.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();

  const viaSearch = createPage();
  await settle();
  const input = viaSearch.$('productDetailSearchInput');
  input.value = 'khay giấy';
  viaSearch.run('handleProductDetailSearchInput()');
  const suggestions = [...viaSearch.$('productDetailSuggestions').querySelectorAll('.suggestion-item')];
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].textContent, /SP-1.*Khay giấy bạc/);
  viaSearch.run('selectProductDetailSuggestion(0)');
  await settle();

  assert.deepEqual(viaSearch.urls.filter(u => u.includes('/customers')), viaButton.urls.filter(u => u.includes('/customers')));
  ['productDetailTitle', 'productDetailRows', 'productDetailSummary', 'productDetailSearchInput'].forEach(id => {
    const a = id === 'productDetailSearchInput' ? viaButton.$(id).value : viaButton.$(id).innerHTML;
    const b = id === 'productDetailSearchInput' ? viaSearch.$(id).value : viaSearch.$(id).innerHTML;
    assert.equal(b, a, id + ' phai giong nhau');
  });
  // JSON.stringify: 2 trang JSDOM la 2 realm rieng nen deepStrictEqual se bao lech prototype.
  assert.equal(JSON.stringify(pieCharts(viaSearch)[0].config.data), JSON.stringify(pieCharts(viaButton)[0].config.data));
  assert.equal(viaSearch.$('productDetailSuggestions').classList.contains('show'), false, 'chon xong thi dong goi y');
});

test('tim theo ma cung ra goi y (khong phan biet hoa thuong) va khong co ket qua thi khong hien goi y', async () => {
  const page = createPage();
  await settle();
  const input = page.$('productDetailSearchInput');

  input.value = 'sp-2';
  page.run('handleProductDetailSearchInput()');
  assert.match(page.$('productDetailSuggestions').textContent, /SP-2.*Bình nước nhựa/);

  input.value = 'khong-co-ma-nay';
  page.run('handleProductDetailSearchInput()');
  assert.equal(page.$('productDetailSuggestions').classList.contains('show'), false);
});

test('bam Chi tiet o SP khac thi thay noi dung va huy bieu do cu; bam lai cung SP thi giu nguyen (khong goi API lai)', async () => {
  const page = createPage();
  await settle();
  const buttonOf = code => page.$('productReportRows').querySelector('button[data-product-detail="' + code + '"]');

  buttonOf('SP-1').click();
  await settle();
  const firstPie = pieCharts(page)[0];

  buttonOf('SP-2').click();
  await settle();
  assert.ok(firstPie.destroyed, 'bieu do SP cu phai bi huy');
  assert.equal(pieCharts(page).length, 1);
  assert.match(page.$('productDetailTitle').textContent, /SP-2/);

  const before = page.urls.length;
  buttonOf('SP-2').click();
  await settle();
  assert.equal(page.urls.length, before);
});

test('nut x xoa lua chon: an noi dung, huy bieu do, xoa o tim', async () => {
  const page = createPage();
  await settle();
  page.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();
  assert.equal(page.$('productDetailClearBtn').hidden, false);

  page.run('clearProductReportDetail()');

  assert.equal(page.$('productDetailContent').hidden, true);
  assert.equal(page.$('productDetailEmptyState').hidden, false);
  assert.equal(page.$('productDetailSearchInput').value, '');
  assert.equal(page.$('productDetailClearBtn').hidden, true);
  assert.equal(pieCharts(page).length, 0);
});

test('nhieu hon 10 khach: bieu do tron gop phan con lai thanh "Khac (N khach)" nhung bang van liet ke du', async () => {
  const page = createPage({ customers: code => customersPayload(code, 14) });
  await settle();
  page.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();

  assert.equal(page.$('productDetailRows').querySelectorAll('tr').length, 14);
  const pie = pieCharts(page)[0];
  assert.equal(pie.config.data.labels.length, 11);
  assert.equal(pie.config.data.labels[10], 'Khác (4 khách)');
  const values = pie.config.data.datasets[0].data;
  assert.equal(values[10], (4 + 3 + 2 + 1) * 100);
});

test('san pham chua co du lieu khach: thong bao ro rang, khong ve bieu do', async () => {
  const page = createPage({ customers: code => ({ code, totalRevenue: 0, customerCount: 0, rows: [] }) });
  await settle();
  page.$('productReportRows').querySelector('button[data-product-detail="SP-2"]').click();
  await settle();

  assert.match(page.$('productDetailRows').textContent, /Chưa có dữ liệu khách/);
  assert.equal(pieCharts(page).length, 0);
});

test('API loi: hien thong bao loi trong khung chi tiet, khong vo trang', async () => {
  const page = createPage({ customers: () => new Error('boom') });
  await settle();
  page.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();

  assert.match(page.$('productDetailRows').textContent, /Không tải được/);
  assert.equal(pieCharts(page).length, 0);
});

test('dong dang xem duoc danh dau trong bang san pham', async () => {
  const page = createPage();
  await settle();
  page.$('productReportRows').querySelector('button[data-product-detail="SP-1"]').click();
  await settle();

  const selected = [...page.$('productReportRows').querySelectorAll('tr.is-selected')];
  assert.equal(selected.length, 1);
  assert.equal(selected[0].dataset.tableItemId, 'SP-1');
});
