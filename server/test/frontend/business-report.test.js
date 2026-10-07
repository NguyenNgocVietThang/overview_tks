'use strict';

// Tab "Bao cao kinh doanh" (/reports/#business): 3 muc Tang truong Sale / khach hang / ma hang,
// API rieng /api/business-report (khong qua /api/dashboard), loc khach, panel chi tiet co bieu do cot,
// nut xuat Excel/HTML theo reports.export, nut "Tinh lai thang" theo reports.business.refreeze.
// Payload gia lay tu service that (businessReportService + testFixtures) de khop hop dong API.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const svc = require('../../businessReport/businessReportService');
const { serviceSnapshot } = require('../../businessReport/testFixtures');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

function createPage({ can = () => true, notReady = false } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/reports/#business' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  const charts = [];
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; this.destroyed = false; charts.push(this); }
    destroy() { this.destroyed = true; }
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = cb => cb();
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.URL.createObjectURL = () => 'blob:test';
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can, handleBranchError: () => false, renderTopSidebar() {} };

  const urls = [];
  const snap = serviceSnapshot();
  dom.window.fetch = (url, opts) => {
    const href = String(url);
    urls.push({ href, opts });
    const ok = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (href.startsWith('/api/business-report/') && notReady && !href.startsWith('/api/business-report/export')) {
      return Promise.resolve({
        ok: false, status: 503,
        json: async () => ({ error: 'Báo cáo kinh doanh chưa sẵn sàng (chưa áp migration 0036).', code: 'BUSINESS_REPORT_NOT_READY' })
      });
    }
    if (href === '/api/business-report/sales') return ok(svc.buildSaleReport(snap));
    if (href === '/api/business-report/customers') return ok(svc.buildCustomerReport(snap));
    if (href === '/api/business-report/products') return ok(svc.buildProductReport(snap));
    if (href.startsWith('/api/business-report/detail?kind=sale')) return ok(svc.buildDetail('sale', 'Khang', snap, {}));
    if (href.startsWith('/api/business-report/detail?kind=customer')) {
      const key = decodeURIComponent(href.split('key=')[1]);
      return ok(svc.buildDetail('customer', key, snap, {}));
    }
    if (href.startsWith('/api/business-report/export')) {
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: name => (/disposition/i.test(name) ? 'attachment; filename="TKS_Bao_cao_kinh_doanh.xlsx"' : null) },
        blob: async () => new dom.window.Blob(['x'])
      });
    }
    return new Promise(() => {}); // cac API khac cua trang khong can tra loi trong test nay
  };

  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim())
    .forEach(script => dom.window.eval(script));

  const doc = dom.window.document;
  return { dom, doc, urls, charts, $: id => doc.getElementById(id), run: code => dom.window.eval(code) };
}

const headerTexts = (page, tbodyId) => [...page.$(tbodyId).closest('table').querySelectorAll('thead th')]
  .map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
const rowsOf = (page, tbodyId) => [...page.$(tbodyId).querySelectorAll('tr.doc-row')];
const rowById = (page, tbodyId, id) => rowsOf(page, tbodyId).find(tr => tr.dataset.tableItemId === id);
const businessUrls = page => page.urls.map(u => u.href).filter(h => h.startsWith('/api/business-report/'));

test('sub-nav co tab "Báo cáo kinh doanh" va #view-business co 3 muc', () => {
  const page = createPage();
  const btn = page.doc.querySelector('.report-subnav-item[data-view="business"]');
  assert.ok(btn, 'thieu nut sub-nav business');
  assert.match(btn.textContent, /Báo cáo kinh doanh/);
  const view = page.$('view-business');
  assert.ok(view, 'thieu #view-business');
  const titles = [...view.querySelectorAll('.section-head h2')].map(h => h.textContent.trim());
  assert.deepEqual(titles, ['Tăng trưởng Sale', 'Tăng trưởng khách hàng', 'Tăng trưởng mã hàng']);
});

test('sidebar dung chung co muc Báo cáo kinh doanh (reports.business)', () => {
  const nav = fs.readFileSync(path.join(publicDir, 'shared', 'shared-nav.js'), 'utf8');
  assert.match(nav, /feature: 'reports\.business', view: 'business', label: 'Báo cáo kinh doanh'/);
});

test('mo tab: goi dung 3 API /api/business-report, KHONG goi /api/dashboard?view=business', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  const called = businessUrls(page);
  assert.deepEqual(called.slice().sort(), ['/api/business-report/customers', '/api/business-report/products', '/api/business-report/sales']);
  assert.equal(page.urls.some(u => u.href.startsWith('/api/dashboard?view=business')), false, 'khong goi /api/dashboard cho tab business');
  assert.equal(page.$('view-business').classList.contains('active'), true);
});

test('bang Sale: cot co dinh + TB 4 thang + Tang truong + hom nay + cac thang giam dan; tang truong %', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  assert.deepEqual(headerTexts(page, 'businessSalesRows'),
    ['Sale', 'SL Khách', 'TB 4 tháng', 'Tăng trưởng', '06/10/2026', 'T9/26', 'T8/26', 'T7/26']);
  const khang = rowById(page, 'businessSalesRows', 'Khang');
  assert.ok(khang, 'co dong Khang');
  assert.equal(khang.cells[3].textContent.trim(), '100%');
  const ungrouped = rowById(page, 'businessSalesRows', 'Chưa phân nhóm');
  assert.ok(ungrouped, 'co dong Chua phan nhom');
  assert.equal(ungrouped.cells[3].textContent.trim(), '—');
  // Moi <th> sinh dong deu co width px (bang fixed-table).
  page.$('businessSalesRows').closest('table').querySelectorAll('thead th')
    .forEach(th => assert.match(th.getAttribute('style') || '', /width:\s*\d+px/));
});

test('KPI muc Sale co the "Doanh số tháng này (đến 06/10)"', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  const labels = [...page.$('businessSalesKpis').querySelectorAll('.eyebrow')].map(e => e.textContent.trim());
  assert.ok(labels.includes('Doanh số tháng này (đến 06/10)'), labels.join(' | '));
});

test('bang khach: an khach khong hoat dong mac dinh, cong tac hien lai, loc theo sale, cot Level gia', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  const ids = () => rowsOf(page, 'businessCustomersRows').map(tr => tr.dataset.tableItemId);
  assert.equal(ids().includes('hanoi:KH9'), false, 'KH9 khong hoat dong bi an mac dinh');
  assert.equal(ids().length, 3);

  const inactive = page.$('businessCustomersInactive');
  inactive.checked = true;
  inactive.dispatchEvent(new page.dom.window.Event('change'));
  assert.equal(ids().includes('hanoi:KH9'), true, 'tick cong tac thi KH9 hien');
  inactive.checked = false;
  inactive.dispatchEvent(new page.dom.window.Event('change'));

  const sale = page.$('businessCustomersSale');
  assert.ok([...sale.options].some(o => o.value === 'Khang'), 'dropdown sale co Khang');
  sale.value = 'Khang';
  sale.dispatchEvent(new page.dom.window.Event('change'));
  assert.deepEqual(ids().sort(), ['hanoi:KH1', 'saigon:KH1']);
  assert.deepEqual(page.run('businessFilteredCustomers().map(r => r.saleName)'), ['Khang', 'Khang']);

  const headers = headerTexts(page, 'businessCustomersRows');
  assert.deepEqual(headers.slice(0, 5), ['Mã KH', 'Tên khách', 'Cơ sở', 'Sale', 'Level giá']);
  const chiA = rowById(page, 'businessCustomersRows', 'hanoi:KH1');
  assert.equal(chiA.cells[4].textContent.trim(), 'Level 2');
});

test('bam dong Khang: mo panel chi tiet co the tong quan, bieu do cot theo thang va bang khach', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, true);
  rowById(page, 'businessSalesRows', 'Khang').click();
  await settle();

  assert.ok(businessUrls(page).includes('/api/business-report/detail?kind=sale&key=Khang'));
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.match(page.$('docModalTitle').textContent, /Khang/);
  const summary = page.$('docModalBody').querySelector('.business-summary');
  assert.ok(summary, 'co khoi .business-summary');
  assert.ok([...summary.querySelectorAll('.eyebrow')].some(e => e.textContent.trim() === 'TB 4 tháng'));

  const bars = page.charts.filter(c => c.config.type === 'bar' && !c.destroyed);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0].config.data.labels, ['T7/26', 'T8/26', 'T9/26', 'T10/26*']);
  assert.deepEqual(bars[0].config.data.datasets[0].data, [0, 300, 500, 100]);

  const customerRows = [...page.$('docModalBody').querySelectorAll('tbody tr')];
  assert.equal(customerRows.length, 2, 'bang khach cua sale Khang');
  assert.match(page.$('docModalBody').textContent, /Chị A/);

  page.run('closeDocumentDetail()');
  assert.equal(page.charts.filter(c => c.config.type === 'bar' && !c.destroyed).length, 0, 'dong panel huy bieu do');
});

test('panel khach: tieu de la ten khach (khong phai ten sale), ca khi mo tu bang lan khi di tu panel Sale', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();

  rowById(page, 'businessCustomersRows', 'hanoi:KH1').click();
  await settle();
  assert.ok(businessUrls(page).includes('/api/business-report/detail?kind=customer&key=hanoi%3AKH1'));
  const title = page.$('docModalTitle').textContent;
  assert.match(title, /Khách hàng · Chị A/);
  assert.doesNotMatch(title, /Khang/);
  page.run('closeDocumentDetail()');

  rowById(page, 'businessSalesRows', 'Khang').click();
  await settle();
  const drill = [...page.$('docModalBody').querySelectorAll('tr.business-detail-customer')].find(tr => tr.dataset.key === 'hanoi:KH1');
  assert.ok(drill, 'panel Sale co dong khach hanoi:KH1');
  drill.click();
  await settle();
  const drillTitle = page.$('docModalTitle').textContent;
  assert.match(drillTitle, /Khách hàng · Chị A/);
  assert.doesNotMatch(drillTitle, /Khang/);
});

test('quyen: khong co reports.business.refreeze thi an nut Tinh lai thang; khong co reports.export thi an nut xuat', async () => {
  const noRefreeze = createPage({ can: k => k !== 'reports.business.refreeze' });
  noRefreeze.run("switchView('business')");
  await settle();
  assert.equal(noRefreeze.$('businessRefreezeBtn').hidden, true);
  noRefreeze.doc.querySelectorAll('.business-export').forEach(el => assert.equal(el.hidden, false));

  const manager = createPage();
  manager.run("switchView('business')");
  await settle();
  assert.equal(manager.$('businessRefreezeBtn').hidden, false);

  const noExport = createPage({ can: k => k !== 'reports.export' });
  noExport.run("switchView('business')");
  await settle();
  const exportBoxes = [...noExport.doc.querySelectorAll('.business-export')];
  assert.equal(exportBoxes.length, 3);
  exportBoxes.forEach(el => assert.equal(el.hidden, true));
});

test('xuat: bang Khach gui inactive=1 khi bat cong tac, kem loc sale; bang Sale khong gui inactive', async () => {
  const page = createPage();
  page.run("switchView('business')");
  await settle();
  page.$('businessCustomersInactive').checked = true;
  page.$('businessCustomersSale').value = 'Khang';
  page.run("exportBusiness('customers','xlsx')");
  await settle();
  const customerExport = businessUrls(page).find(h => h.startsWith('/api/business-report/export'));
  const params = new URLSearchParams(customerExport.split('?')[1]);
  assert.equal(params.get('kind'), 'customers');
  assert.equal(params.get('format'), 'xlsx');
  assert.equal(params.get('inactive'), '1');
  assert.equal(params.get('sale'), 'Khang');

  page.run("exportBusiness('sales','html')");
  await settle();
  const salesExport = businessUrls(page).filter(h => h.startsWith('/api/business-report/export'))[1];
  const salesParams = new URLSearchParams(salesExport.split('?')[1]);
  assert.equal(salesParams.get('kind'), 'sales');
  assert.equal(salesParams.get('format'), 'html');
  assert.equal(salesParams.has('inactive'), false);
});

test('API 503 BUSINESS_REPORT_NOT_READY: bang hien "Đang dựng dữ liệu tháng cũ…"', async () => {
  const page = createPage({ notReady: true });
  page.run("switchView('business')");
  await settle();
  ['businessSalesRows', 'businessCustomersRows', 'businessProductsRows'].forEach(id => {
    assert.match(page.$(id).textContent, /Đang dựng dữ liệu tháng cũ…/);
  });
});

test('ham tang truong: >=100% xanh, <100% do, null "—"', () => {
  const page = createPage();
  assert.match(page.run('businessGrowthHtml(100)'), /pill ok[^>]*>100%/);
  assert.match(page.run('businessGrowthHtml(54.6)'), /pill bad[^>]*>55%/);
  assert.match(page.run('businessGrowthHtml(null)'), /—/);
});
