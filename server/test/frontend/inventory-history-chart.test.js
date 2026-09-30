'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8');

const tick = () => new Promise(resolve => setImmediate(resolve));
// Mang tao trong JSDOM khac realm voi Node nen deepStrictEqual can quy ve mang thuong.
const plain = value => JSON.parse(JSON.stringify(value));

// Dung dashboard that trong JSDOM voi Chart/fetch gia: fetch cua /api/inventory-value-history tra
// `rows`, moi request khac (vd /api/dashboard) treo mai de test biet co bi goi hay khong.
function createDashboard(rows) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/#overview' });
  const win = dom.window;
  win.__fetches = [];
  win.__charts = [];
  win.HTMLCanvasElement.prototype.getContext = () => ({});
  win.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; win.__charts.push(this); }
    destroy() { this.destroyed = true; }
  };
  win.setInterval = () => 1;
  win.requestAnimationFrame = callback => callback();
  win.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };
  win.fetch = url => {
    win.__fetches.push(String(url));
    if (String(url).startsWith('/api/inventory-value-history')) {
      return Promise.resolve({ ok: true, json: async () => ({ rows }) });
    }
    return new Promise(() => {});
  };
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    win.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => win.eval(script));
  return dom;
}

function inventoryFetches(dom) {
  return dom.window.__fetches.filter(url => url.startsWith('/api/inventory-value-history'));
}

function lastChart(dom) {
  return dom.window.__charts.filter(chart => chart.config.data.datasets.some(ds => ds.label === 'Hà Nội' || ds.label === 'Sài Gòn')).at(-1);
}

test('markup: panel "Giá trị tồn kho theo ngày" nằm ở mục 1 Xu hướng của Tổng quan, có ô lọc riêng', () => {
  const doc = new JSDOM(html).window.document;
  const section = doc.querySelector('#view-overview > section.section');
  assert.ok(section.querySelector('#chartInventoryHistory'), 'canvas phai nam trong muc 1 cua Tong quan');
  assert.ok(section.querySelector('[data-date-filter-slot="inventoryHistory"]'));
  assert.ok(section.querySelector('#chartInventoryHistoryEmpty'));
  // Bo loc rieng: khong dung chung khoa 'invoices' voi bieu do doanh thu.
  assert.notEqual(
    section.querySelector('[data-date-filter-slot="inventoryHistory"]'),
    section.querySelector('[data-date-filter-slot="invoices"]')
  );
});

test('bộ lọc riêng không nằm trong state.filters/TAB_FILTER_PREFIXES (không kéo theo /api/dashboard)', () => {
  const match = html.match(/const TAB_FILTER_PREFIXES = \{([\s\S]*?)\};/);
  const map = new Function('return {' + match[1] + '}')();
  assert.equal(map.inventoryHistory, undefined);
  assert.doesNotMatch(html.match(/filters: \{\s*topSelling[\s\S]*?\n      \},/)[0], /inventoryHistory/);
});

test('khởi động: tải mặc định 7 ngày gần nhất (Từ = hôm nay − 6 ngày, Đến = hôm nay) và điền vào ô lọc', async () => {
  const dom = createDashboard([]);
  await tick();
  const urls = inventoryFetches(dom);
  assert.equal(urls.length, 1);
  const params = new URLSearchParams(urls[0].split('?')[1]);
  const from = new Date(params.get('from') + 'T00:00:00');
  const to = new Date(params.get('to') + 'T00:00:00');
  assert.equal(Math.round((to - from) / 86400000), 6);

  const wrap = dom.window.document.querySelector('[data-date-filter-slot="inventoryHistory"] .table-date-filter');
  assert.ok(wrap, 'o loc Tu-Den phai duoc gan vao slot');
  assert.equal(wrap.querySelector('[data-date-role="from"]').value, params.get('from'));
  assert.equal(wrap.querySelector('[data-date-role="to"]').value, params.get('to'));
});

test('"Cả hai": cột chồng Hà Nội + Sài Gòn, tooltip có dòng Tổng', async () => {
  const dom = createDashboard([
    { date: '2026-09-30', hanoi: 1000000, saigon: 500000 },
    { date: '2026-10-01', hanoi: 1200000, saigon: 400000 }
  ]);
  await tick();
  const chart = lastChart(dom);
  assert.ok(chart, 'phai ve bieu do khi co du lieu');
  const { config } = chart;
  assert.equal(config.type, 'bar');
  assert.deepEqual(plain(config.data.labels), ['30/09', '01/10']);
  assert.deepEqual(plain(config.data.datasets.map(ds => ds.label)), ['Hà Nội', 'Sài Gòn']);
  assert.deepEqual(plain(config.data.datasets[0].data), [1000000, 1200000]);
  assert.equal(config.options.scales.x.stacked, true);
  assert.equal(config.options.scales.y.stacked, true);
  const callbacks = config.options.plugins.tooltip.callbacks;
  assert.equal(callbacks.title([{ dataIndex: 1 }]), '01/10/2026');
  assert.match(callbacks.footer([{ dataIndex: 0 }]), /^Tổng: 1\.500\.000/);
  assert.equal(dom.window.document.getElementById('chartInventoryHistory').hidden, false);
  assert.equal(dom.window.document.getElementById('chartInventoryHistoryEmpty').hidden, true);
});

test('một cơ sở: chỉ một dataset, ẩn chú giải và không có dòng Tổng', async () => {
  const dom = createDashboard([{ date: '2026-09-30', saigon: 750000 }]);
  await tick();
  const { config } = lastChart(dom);
  assert.deepEqual(plain(config.data.datasets.map(ds => ds.label)), ['Sài Gòn']);
  assert.equal(config.options.plugins.legend.display, false);
  assert.equal(config.options.plugins.tooltip.callbacks.footer([{ dataIndex: 0 }]), '');
});

test('chưa có bản chụp: ẩn canvas và báo hệ thống bắt đầu lưu từ 30/09/2026', async () => {
  const dom = createDashboard([]);
  await tick();
  const doc = dom.window.document;
  assert.equal(doc.getElementById('chartInventoryHistory').hidden, true);
  const empty = doc.getElementById('chartInventoryHistoryEmpty');
  assert.equal(empty.hidden, false);
  assert.match(empty.textContent, /30\/09\/2026/);
});

test('đổi Từ–Đến chỉ tải lại lịch sử tồn kho (không gọi /api/dashboard) và gửi đúng khoảng', async () => {
  const dom = createDashboard([]);
  await tick();
  const dashboardCallsBefore = dom.window.__fetches.filter(url => url.startsWith('/api/dashboard')).length;
  dom.window.eval("setTableDateFilter('inventoryHistory', '2026-09-01', '2026-09-30')");
  await tick();
  assert.equal(inventoryFetches(dom).at(-1), '/api/inventory-value-history?from=2026-09-01&to=2026-09-30');
  assert.equal(dom.window.__fetches.filter(url => url.startsWith('/api/dashboard')).length, dashboardCallsBefore);

  // Bo trong ca 2 o = Tat ca (khong gioi han).
  dom.window.eval("setTableDateFilter('inventoryHistory', '', '')");
  await tick();
  assert.equal(inventoryFetches(dom).at(-1), '/api/inventory-value-history');
});
