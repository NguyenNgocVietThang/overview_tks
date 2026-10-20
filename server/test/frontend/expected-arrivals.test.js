'use strict';

// Muc 2 "Du kien hang ve" cua tab Hang hoa (/reports/#products): bang toan bo dong hang cua moi cont tu
// API rieng /api/expected-arrivals (quyen reports.products.expected), loc Cont / Trang thai o trinh duyet,
// chi so theo dong dang hien, nut "Xuat file", va luong cua tai khoan CHI co quyen moi (Ke toan / Mua hang / Kho).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

const row = (over) => Object.assign({
  scheduleLabel: '2. Đã bốc 18-20/10', statusLabel: '2. Đã bốc', eta: '18-20/10', containerName: 'CONT 10-5H',
  productCode: 'MCRY301', productName: 'Máy cạo râu 301', color: 'Đen', saleNote: 'Giữ cho khách A', orderedBy: 'Lan',
  unitsPerPackage: 24, packageCount: 10, quantity: 240, sheetName: 'CONT 2026', sourceRow: 5
}, over);

const SAMPLE = {
  rows: [
    row({}),
    row({ productCode: 'MCRY302', productName: 'Máy cạo râu 302', color: null, saleNote: null, orderedBy: 'Hoa', unitsPerPackage: 12, packageCount: 5, quantity: 60, sourceRow: 6 }),
    row({ scheduleLabel: '1. Chưa bốc 05/11', statusLabel: '1. Chưa bốc', eta: '05/11', containerName: 'CONT 11-2A', productCode: 'QAT001', productName: 'Quạt mini', color: 'Trắng', orderedBy: null, unitsPerPackage: null, packageCount: null, quantity: 1000, sourceRow: 12 }),
    row({ scheduleLabel: '3. Đã về kho', statusLabel: '3. Đã về kho', eta: '', containerName: 'CONT 09-1C', productCode: 'DEN200', productName: 'Đèn bàn 200', quantity: 500, sourceRow: 20 })
  ],
  filters: { containers: ['CONT 10-5H', 'CONT 11-2A', 'CONT 09-1C'], statuses: ['1. Chưa bốc', '2. Đã bốc', '3. Đã về kho'] },
  meta: { computedAt: '2026-10-20T03:00:00.000Z', version: 7, rowCount: 4 }
};

const FIELDS = {
  title: 'Dự kiến hàng về', selectionMode: 'custom',
  worksheets: [{ key: 'expected', name: 'Dự kiến hàng về', rowCount: 4, fields: [
    { key: 'scheduleLabel', label: 'Lịch/Trạng thái', type: 'text', selected: true },
    { key: 'containerName', label: 'Tên Cont', type: 'text', selected: true },
    { key: 'quantity', label: 'Tổng số lượng', type: 'number', selected: true }
  ] }]
};

// `real: true` mo phong TKSNav that: co getPermissions + authGuard nap quyen roi moi tai (trang cho quyen).
function createPage({ permissions = null, can = () => true, hash = '#products', real = false, respond = SAMPLE } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/reports/' + hash });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = cb => cb();
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.URL.createObjectURL = () => 'blob:test';
  dom.window.URL.revokeObjectURL = () => {};
  const downloads = [];
  dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.getAttribute('download')); };
  dom.window.EventSource = class { constructor(url) { dom.sseUrls = (dom.sseUrls || []).concat(url); } addEventListener() {} close() {} };

  if (real) {
    const perms = permissions || [];
    dom.window.TKSNav = {
      getPermissions: () => perms.slice(),
      can: (...keys) => keys.some(k => perms.includes(k)),
      authGuard: () => Promise.resolve({ vaiTro: 'Kế toán', permissions: perms }),
      handleBranchError: () => false, renderTopSidebar() {}
    };
  } else {
    dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can, handleBranchError: () => false, renderTopSidebar() {} };
  }

  const urls = [];
  dom.window.fetch = (url) => {
    const href = String(url);
    urls.push(href);
    const ok = body => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (href === '/api/expected-arrivals') return respond instanceof Error ? Promise.resolve({ ok: false, status: 500, json: async () => ({}) }) : ok(respond);
    if (href.startsWith('/api/expected-arrivals/export/fields')) return ok(FIELDS);
    if (href.startsWith('/api/expected-arrivals/export?')) {
      const params = new URLSearchParams(href.split('?')[1]);
      return Promise.resolve({
        ok: true, status: 200,
        headers: { get: name => (/disposition/i.test(name) ? 'attachment; filename="TKS_Du_kien_hang_ve.' + params.get('format') + '"' : null) },
        blob: async () => new dom.window.Blob(['x'])
      });
    }
    return new Promise(() => {}); // cac API khac khong tra loi
  };

  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));

  const doc = dom.window.document;
  return { dom, doc, urls, downloads, $: id => doc.getElementById(id), run: code => dom.window.eval(code) };
}

const bodyRows = page => [...page.$('expectedArrivalsRows').querySelectorAll('tr')].filter(tr => tr.cells.length > 1);
const cellTexts = tr => [...tr.cells].map(c => c.textContent.trim());
const cardsOf = (page, id) => [...page.$(id).querySelectorAll('.kpi-card')]
  .map(c => [c.querySelector('.eyebrow').textContent.trim(), c.querySelector('.value').textContent.trim()]);
const setSelect = (page, id, value) => {
  page.$(id).value = value;
  page.$(id).dispatchEvent(new page.dom.window.Event('change'));
};
const paramsOf = href => new URLSearchParams(href.split('?')[1]);
const clickInline = (page, el) => { if (!el.disabled) page.run(el.getAttribute('onclick')); };

test('muc 2 nam giua Bao cao hang hoa va Tang truong ma hang, co hang chi so ngay duoi tieu de', () => {
  const page = createPage();
  const sections = [...page.$('view-products').querySelectorAll(':scope > section.section')];
  assert.deepEqual(sections.map(s => s.id), ['productReportSection', 'expectedArrivalsSection', 'productGrowthSection']);
  assert.deepEqual(sections.map(s => s.querySelector('.section-step').textContent.trim()), ['1', '2', '3']);
  const section = page.$('expectedArrivalsSection');
  assert.equal(section.querySelector('.section-head h2').firstChild.textContent.trim(), 'Dự kiến hàng về');
  assert.ok(section.querySelector(':scope > .section-head').nextElementSibling.classList.contains('section-kpis'));
});

test('bang 10 cot dung thu tu, moi th co width px + data-column-key, key bang rieng', () => {
  const page = createPage();
  const table = page.$('expectedArrivalsRows').closest('table');
  assert.equal(table.dataset.tableKey, 'dashboard-table-expected-arrivals');
  const ths = [...table.querySelectorAll('thead th')];
  assert.deepEqual(ths.map(th => th.textContent.replace(/[▲▼]/g, '').trim()),
    ['Lịch/Trạng thái', 'Tên Cont', 'Mã SP', 'Tên SP', 'Màu sắc', 'Ghi chú sale', 'Người đặt', 'Số cái/kiện', 'Số kiện', 'Tổng số lượng']);
  ths.forEach(th => {
    assert.match(th.getAttribute('style') || '', /width:\s*\d+px/);
    assert.ok(th.dataset.columnKey, 'thieu data-column-key');
  });
  assert.equal(new Set(ths.map(th => th.dataset.columnKey)).size, 10);
  // Quy uoc tieu de sap xep: moi th co nut sap xep, glyph chua sap la ▲▼.
  ths.forEach(th => assert.equal(th.querySelector('.sort-indicator').textContent, '▲▼'));
  assert.equal(table.querySelector('tbody').id, 'expectedArrivalsRows');
});

test('dang ky TABLE_EXPLORER_CONFIGS de tim kiem; hai o loc co aria-label', () => {
  const page = createPage();
  assert.ok(page.dom.window.TABLE_EXPLORER_CONFIGS.expectedArrivals);
  assert.equal(page.$('expectedArrivalsContainer').getAttribute('aria-label'), 'Lọc theo cont');
  assert.equal(page.$('expectedArrivalsStatus').getAttribute('aria-label'), 'Lọc theo trạng thái');
  assert.equal(page.$('expectedArrivalsContainer').options[0].textContent, 'Tất cả cont');
  assert.equal(page.$('expectedArrivalsStatus').options[0].textContent, 'Tất cả trạng thái');
});

test('vao tab Hang hoa: goi /api/expected-arrivals, ve du 4 dong, cot A = B+C, so en-US, thoi diem cap nhat', async () => {
  const page = createPage();
  page.run("switchView('products')");
  await settle();
  assert.equal(page.urls.filter(u => u === '/api/expected-arrivals').length, 1);
  assert.equal(page.$('expectedArrivalsSection').hidden, false);
  const rows = bodyRows(page);
  assert.equal(rows.length, 4);
  assert.deepEqual(cellTexts(rows[0]), ['2. Đã bốc 18-20/10', 'CONT 10-5H', 'MCRY301', 'Máy cạo râu 301', 'Đen', 'Giữ cho khách A', 'Lan', '24', '10', '240']);
  // Gia tri rong -> "—"; so lon dinh dang 1,000.
  assert.deepEqual(cellTexts(rows[2]).slice(4), ['Trắng', 'Giữ cho khách A', '—', '—', '—', '1,000']);
  assert.match(page.$('expectedArrivalsUpdatedAt').textContent, /^Dữ liệu cập nhật lúc /);
  assert.equal(page.$('tagExpectedArrivals').textContent, '4');
});

test('hai o loc lay danh sach tu filters cua may chu; loc theo Cont va Trang thai (statusLabel = o B), chi so theo dong da loc', async () => {
  const page = createPage();
  page.run("switchView('products')");
  await settle();
  assert.deepEqual([...page.$('expectedArrivalsContainer').options].map(o => o.value), ['', 'CONT 10-5H', 'CONT 11-2A', 'CONT 09-1C']);
  assert.deepEqual([...page.$('expectedArrivalsStatus').options].map(o => o.value), ['', '1. Chưa bốc', '2. Đã bốc', '3. Đã về kho']);
  // KPI ban dau: 3 cont, 4 dong, tong 1800.
  assert.deepEqual(cardsOf(page, 'expectedArrivalsKpis'), [['Số cont', '3'], ['Số dòng hàng', '4'], ['Tổng số lượng', '1,800']]);

  setSelect(page, 'expectedArrivalsContainer', 'CONT 10-5H');
  assert.equal(bodyRows(page).length, 2);
  assert.deepEqual(cardsOf(page, 'expectedArrivalsKpis'), [['Số cont', '1'], ['Số dòng hàng', '2'], ['Tổng số lượng', '300']]);
  assert.equal(page.$('tagExpectedArrivals').textContent, '2');

  // Trang thai loc theo o B (statusLabel) nen "2. Đã bốc" giu ca dong co lich "2. Đã bốc 18-20/10".
  setSelect(page, 'expectedArrivalsContainer', '');
  setSelect(page, 'expectedArrivalsStatus', '2. Đã bốc');
  assert.equal(bodyRows(page).length, 2);
  assert.ok(bodyRows(page).every(tr => cellTexts(tr)[0] === '2. Đã bốc 18-20/10'));

  setSelect(page, 'expectedArrivalsContainer', 'CONT 11-2A');
  assert.equal(bodyRows(page).length, 0, 'Cont + Trang thai la giao cua hai bo loc');
  assert.match(page.$('expectedArrivalsRows').textContent, /Chưa có hàng dự kiến về/);
  assert.deepEqual(cardsOf(page, 'expectedArrivalsKpis'), [['Số cont', '0'], ['Số dòng hàng', '0'], ['Tổng số lượng', '0']]);
});

test('tim kiem trong bang cap nhat ca bang lan chi so; sap xep theo Tong so luong', async () => {
  const page = createPage();
  page.run("switchView('products')");
  await settle();
  const input = page.doc.querySelector('[data-table-search="expectedArrivals"] input[type="search"], [data-table-search="expectedArrivals"] input');
  assert.ok(input, 'phai co o tim kiem');
  input.value = 'quạt';
  input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
  await settle();
  assert.equal(bodyRows(page).length, 1);
  assert.equal(cellTexts(bodyRows(page)[0])[2], 'QAT001');
  assert.deepEqual(cardsOf(page, 'expectedArrivalsKpis'), [['Số cont', '1'], ['Số dòng hàng', '1'], ['Tổng số lượng', '1,000']]);
  input.value = '';
  input.dispatchEvent(new page.dom.window.Event('input', { bubbles: true }));
  await settle();

  page.$('expectedArrivalsRows').closest('table').querySelectorAll('thead th')[9].querySelector('.sort-button').click();
  assert.deepEqual(bodyRows(page).map(tr => cellTexts(tr)[9]), ['60', '240', '500', '1,000']);
});

test('loi tai /api/expected-arrivals: hien thong bao trong bang, khong ne loi', async () => {
  const page = createPage({ respond: new Error('x') });
  page.run("switchView('products')");
  await settle();
  assert.match(page.$('expectedArrivalsRows').textContent, /Không tải được bảng dự kiến hàng về/);
});

test('nut Xuat file: mo hop thoai chung, gui container/status/q dang ap, xuat dung cot da chon (xlsx va html)', async () => {
  const page = createPage();
  page.run("switchView('products')");
  await settle();
  const btn = page.$('expectedArrivalsExport').querySelector('button.export-button');
  assert.equal(btn.textContent.trim(), 'Xuất file');
  assert.ok(btn.hasAttribute('data-not-export'), 'khong bi an boi reports.export');
  assert.equal(btn.getAttribute('onclick'), 'openExpectedArrivalsExportDialog()');

  setSelect(page, 'expectedArrivalsContainer', 'CONT 10-5H');
  setSelect(page, 'expectedArrivalsStatus', '2. Đã bốc');
  clickInline(page, btn);
  await settle();
  assert.equal(page.$('exportModalBackdrop').hidden, false);
  const fieldsUrl = page.urls.find(u => u.startsWith('/api/expected-arrivals/export/fields'));
  const fp = paramsOf(fieldsUrl);
  assert.equal(fp.get('container'), 'CONT 10-5H');
  assert.equal(fp.get('status'), '2. Đã bốc');
  assert.equal(fp.has('q'), false);
  const inputs = [...page.$('exportFields').querySelectorAll('input[type="checkbox"]')];
  assert.equal(inputs.length, 3);
  inputs.find(i => i.value === 'containerName').checked = false;
  page.run(page.$('exportConfirmButton').getAttribute('onclick'));
  await settle();
  const exportUrl = page.urls.find(u => u.startsWith('/api/expected-arrivals/export?'));
  const p = paramsOf(exportUrl);
  assert.equal(p.get('format'), 'xlsx');
  assert.equal(p.get('container'), 'CONT 10-5H');
  assert.equal(p.get('status'), '2. Đã bốc');
  assert.equal(p.get('columns'), 'scheduleLabel,quantity');
  assert.deepEqual(page.downloads, ['TKS_Du_kien_hang_ve.xlsx']);

  clickInline(page, btn);
  await settle();
  page.run(page.$('exportHtmlButton').getAttribute('onclick'));
  await settle();
  const htmlUrls = page.urls.filter(u => u.startsWith('/api/expected-arrivals/export?') && paramsOf(u).get('format') === 'html');
  assert.equal(htmlUrls.length, 1);
});

test('xuat file bi bo qua khi khong co reports.products.expected', async () => {
  const page = createPage({ can: k => k !== 'reports.products.expected' });
  page.run('openExpectedArrivalsExportDialog()');
  await settle();
  assert.equal(page.$('exportModalBackdrop').hidden, true);
  assert.equal(page.urls.some(u => u.startsWith('/api/expected-arrivals')), false);
});

test('thieu reports.products.expected: an muc, khong goi API', async () => {
  const page = createPage({ can: k => k !== 'reports.products.expected' });
  page.run("switchView('products')");
  await settle();
  assert.equal(page.$('expectedArrivalsSection').hidden, true);
  assert.equal(page.urls.includes('/api/expected-arrivals'), false);
});

test('chi co reports.products (khong co quyen moi): an muc moi, van tai Bao cao hang hoa', async () => {
  const page = createPage({ can: k => k === 'reports.products' });
  page.run("switchView('products')");
  await settle();
  assert.equal(page.$('expectedArrivalsSection').hidden, true);
  assert.equal(page.$('productReportSection').hidden, false);
  assert.equal(page.urls.includes('/api/product-report'), true);
});

// ---- Tai khoan CHI co reports.products.expected (Ke toan / NV mua hang / NV kho) tren trang that ----
test('chi co quyen moi: vao duoc tab Hang hoa, chi goi /api/expected-arrivals, cac muc/tab khac an', async () => {
  const page = createPage({ real: true, permissions: ['reports.products.expected'], hash: '' });
  await settle();
  // Tab dang xem la Hang hoa du hash trong (Tong quan khong duoc xem).
  assert.equal(page.$('view-products').classList.contains('active'), true);
  assert.equal(page.$('view-overview').classList.contains('active'), false);
  assert.equal(page.$('expectedArrivalsSection').hidden, false);
  assert.equal(page.$('productReportSection').hidden, true, 'khong co reports.products -> an Bao cao hang hoa');
  assert.equal(page.$('productGrowthSection').hidden, true);
  assert.equal(bodyRows(page).length, 4);

  // KHONG goi bat ky API nao khac (Bao cao hang hoa, ton kho, /api/dashboard, business-report, meta cont...) va khong mo SSE.
  assert.deepEqual(page.urls, ['/api/expected-arrivals']);
  assert.equal(page.dom.sseUrls, undefined, 'khong mo /api/dashboard/events');

  // Chi tab Hang hoa hien tren thanh tab con.
  const visible = [...page.doc.querySelectorAll('.report-subnav-item')].filter(b => !b.hidden).map(b => b.dataset.view);
  assert.deepEqual(visible, ['products']);
});

test('chi co quyen moi, vao thang /reports/#products: cung chi goi API moi', async () => {
  const page = createPage({ real: true, permissions: ['reports.products.expected'], hash: '#products' });
  await settle();
  assert.deepEqual(page.urls, ['/api/expected-arrivals']);
  assert.equal(page.$('view-products').classList.contains('active'), true);
});

test('chi co quyen moi, hash tro toi tab khong duoc xem (#debt): chuyen ve Hang hoa, khong goi API khac', async () => {
  const page = createPage({ real: true, permissions: ['reports.products.expected'], hash: '#debt' });
  await settle();
  assert.equal(page.$('view-products').classList.contains('active'), true);
  assert.deepEqual(page.urls, ['/api/expected-arrivals']);
});

test('trang that co du quyen bao cao: van tai Bao cao hang hoa sau khi nap quyen (khong doi hanh vi cu)', async () => {
  const page = createPage({
    real: true, hash: '#products',
    permissions: ['reports.overview', 'reports.products', 'reports.products.expected', 'reports.business']
  });
  await settle();
  assert.equal(page.urls.includes('/api/product-report'), true);
  assert.equal(page.urls.includes('/api/expected-arrivals'), true);
  assert.equal(page.$('productReportSection').hidden, false);
  assert.equal(page.$('expectedArrivalsSection').hidden, false);
});

test('canViewReport(products): chap nhan reports.products HOAC reports.products.expected', () => {
  const only = createPage({ can: k => k === 'reports.products.expected' });
  assert.equal(only.run("canViewReport('products')"), true);
  assert.equal(only.run("canViewReport('invoices')"), false);
  const none = createPage({ can: () => false });
  assert.equal(none.run("canViewReport('products')"), false);
});

test('shared-nav: muc Hang hoa cua sidebar chap nhan 1 trong 2 quyen', () => {
  const nav = fs.readFileSync(path.join(publicDir, 'shared', 'shared-nav.js'), 'utf8');
  assert.match(nav, /feature: 'reports\.products', anyOf: \['reports\.products', 'reports\.products\.expected'\], view: 'products'/);
});
