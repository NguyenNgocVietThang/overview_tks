'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

// Dashboard that trong JSDOM voi Chart gia (ghi lai config), moi fetch treo mai.
function createDashboard() {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  const win = dom.window;
  win.__charts = [];
  win.HTMLCanvasElement.prototype.getContext = () => ({});
  win.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; win.__charts.push(this); }
    destroy() {}
  };
  win.setInterval = () => 1;
  win.requestAnimationFrame = callback => callback();
  win.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };
  win.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    win.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => win.eval(script));
  return dom;
}

const plain = value => JSON.parse(JSON.stringify(value));

function drawRevenue(dom, rows) {
  const win = dom.window;
  win.__charts.length = 0;
  win.renderRevenueChart('chartInvoiceRevenue', 'invoiceRevenue', rows, true);
  return win.__charts.at(-1).config;
}

test('doanh thu theo ngay: "Cả hai" ve cot chong Ha Noi (cam) + Sai Gon (xanh) nhu bieu do ton kho', () => {
  const dom = createDashboard();
  const config = drawRevenue(dom, [
    { label: '10/08', revenue: 580, revenueHanoi: 380, revenueSaigon: 200, grossRevenue: 700, returnAmount: 120 },
    { label: '11/08', revenue: 50, revenueHanoi: 0, revenueSaigon: 50, grossRevenue: 50, returnAmount: 0 }
  ]);
  assert.deepEqual(plain(config.data.datasets.map(ds => [ds.label, ds.data])), [
    ['Hà Nội', [380, 0]], ['Sài Gòn', [200, 50]]
  ]);
  const theme = dom.window.chartTheme();
  assert.equal(config.data.datasets[0].backgroundColor, theme.amber);
  assert.equal(config.data.datasets[1].backgroundColor, theme.blue);
  assert.equal(config.options.scales.x.stacked, true);
  assert.equal(config.options.scales.y.stacked, true);
  assert.notEqual(config.options.plugins.legend.display, false, 'hien chu thich 2 co so');
  const footer = config.options.plugins.tooltip.callbacks.footer;
  assert.deepEqual(plain(footer([{ dataIndex: 0 }])), ['Tổng: ' + dom.window.fmtMoney(580), 'Doanh thu bán: ' + dom.window.fmtMoney(700), 'Trả hàng: -' + dom.window.fmtMoney(120)]);
});

test('doanh thu theo ngay: chi 1 co so -> 1 chuoi cung mau co so do, khong chu thich', () => {
  const dom = createDashboard();
  const config = drawRevenue(dom, [{ label: '10/08', revenue: 380, revenueSaigon: 380 }]);
  assert.deepEqual(plain(config.data.datasets.map(ds => ds.label)), ['Sài Gòn']);
  assert.equal(config.data.datasets[0].backgroundColor, dom.window.chartTheme().blue);
  assert.equal(config.options.plugins.legend.display, false);
});

test('bieu do doanh thu khac (khong co khoa co so, vd theo khach) giu nguyen 1 cot don mau cam', () => {
  const dom = createDashboard();
  const config = drawRevenue(dom, [{ label: '10/08', revenue: 100 }]);
  assert.equal(config.data.datasets.length, 1);
  assert.equal(config.data.datasets[0].label, 'Doanh thu');
  assert.notEqual(config.options.scales.x.stacked, true);
});
