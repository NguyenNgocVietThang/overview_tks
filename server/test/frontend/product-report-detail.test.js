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

function createPage({ customers = code => customersPayload(code), containers, meta, report, containerStatus = 200 } = {}) {
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
      return Promise.resolve({ ok: true, status: 200, json: async () => report ? report() : ({ rows: PRODUCTS, computedAt: '2026-09-29T00:15:00.000Z' }) });
    }
    if (href.startsWith('/api/product-report/containers?code=') && containers) {
      const payload = containers(decodeURIComponent(href.split('code=')[1]));
      return Promise.resolve(payload).then(data => ({ ok: !(data instanceof Error) && containerStatus < 400, status: data instanceof Error ? 500 : containerStatus, json: async () => data }));
    }
    if (href === '/api/product-report/containers/meta' && meta) return Promise.resolve({ ok: true, json: async () => ({ containerSync: meta() }) });
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
  scripts.forEach((script, index) => dom.window.eval(script + (index === mainIndex ? '\nwindow.__reportTestState = state;' : '')));

  const doc = dom.window.document;
  return { dom, doc, charts, urls, run: code => dom.window.eval(code), $: id => doc.getElementById(id) };
}

const pieCharts = page => page.charts.filter(chart => chart.config.type === 'doughnut' && !chart.destroyed);
const rowOf = (page, code) => [...page.$('productReportRows').querySelectorAll('tr.doc-row')].find(tr => tr.dataset.tableItemId === code);
const modalText = page => page.$('docModalBody').textContent.replace(/\s+/g, ' ');

test('bang bo cot "DS Khach lon nhat" va KHONG con cot/nut "Chi tiet" (12 cot), dong bam duoc', async () => {
  const page = createPage();
  await settle();

  const headers = [...page.$('productReportRows').closest('table').querySelectorAll('thead th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
  assert.deepEqual(headers, [
    'Mã SP', 'Tên SP', 'Chưa bốc', 'Đã bốc', 'Tồn HN', 'Tồn SG', 'Tồn có bán', 'Tổng SL 30 ngày', 'DS 90 ngày',
    'SL khách bán', 'Khách lớn nhất', '% Khách lớn'
  ]);

  const firstRow = page.$('productReportRows').querySelector('tr');
  assert.equal(firstRow.cells.length, 12);
  assert.match(firstRow.cells[10].textContent, /KH A/);
  assert.match(firstRow.cells[11].textContent, /60/);
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

test('nhieu khach: bieu do tron hien du tung khach (khong gop "Khac"), bang khach dong vai tro chu giai (o mau trung mau lat)', async () => {
  const page = createPage({ customers: code => customersPayload(code, 14) });
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();

  assert.equal(page.$('docModalBody').querySelectorAll('tbody tr').length, 14);
  const pie = pieCharts(page)[0];
  assert.equal(pie.config.data.labels.length, 14);
  assert.ok(!pie.config.data.labels.some(label => /^Khác/.test(label)));
  assert.equal(pie.config.data.datasets[0].data.reduce((a, b) => a + b, 0), (14 + 13 + 12 + 11 + 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1) * 100);
assert.equal(pie.config.options.plugins.legend.display, false, 'legend Chart.js tat: bang khach la chu giai');
  assert.equal(page.$('productDetailLegend'), null, 'khong con chu giai HTML rieng');
  const swatches = [...page.$('docModalBody').querySelectorAll('tbody .dp-swatch')];
  assert.equal(swatches.length, 14);
  const probe = page.doc.createElement('i');
  const normalized = color => { probe.style.background = ''; probe.style.background = color; return probe.style.background; };
  swatches.forEach((swatch, index) => {
    assert.equal(swatch.style.background, normalized(pie.config.data.datasets[0].backgroundColor[index]), 'o mau dong ' + index + ' trung mau lat');
  });
  assert.match(page.$('docModalBody').querySelector('tbody tr').textContent, /KH A/);
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

const statsOf = page => Object.fromEntries([...page.$('docModalBody').querySelectorAll('.dp-stat')].map(el => [
  el.querySelector('.dp-stat-label').textContent,
  { value: el.querySelector('.dp-stat-value').textContent, sub: (el.querySelector('.dp-stat-sub') || { textContent: '' }).textContent }
]));

test('hop co hang chi so tong quan: doanh so, so khach, khach lon nhat, top 3, ton HN-SG va SL ban 30 ngay (lay tu dong bang)', async () => {
  const page = createPage({ customers: code => customersPayload(code, 14) });
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();

  const stats = statsOf(page);
  // 14 khach, doanh so (14 - i) * 100 => tong 10.500; khach lon nhat 1.400 (13,3%); top 3 = 3.900 (37,1%)
  assert.match(stats['Doanh số 90 ngày'].value, /10.500₫/);
  assert.equal(stats['Số khách mua'].value, '14');
  assert.equal(stats['Số khách mua'].sub, 'TB 750₫ / khách');
  assert.match(stats['Khách lớn nhất'].value, /13[.,]3%/);
  assert.equal(stats['Khách lớn nhất'].sub, 'KH A');
  assert.match(stats['Top 3 khách'].value, /37[.,]1%/);
  assert.match(stats['Top 3 khách'].sub, /3.900₫/);
  assert.equal(stats['Tồn HN · SG'].value, '5 · 3');
  assert.equal(stats['Tồn HN · SG'].sub, 'Có thể bán 8');
  assert.equal(stats['SL bán 30 ngày'].value, '4');
});

test('it khach (<= 3): khong co the "Top 3 khach" (luon 100%)', async () => {
  const page = createPage();
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();
  assert.equal(statsOf(page)['Top 3 khách'], undefined);
  assert.ok(statsOf(page)['Doanh số 90 ngày']);
});

test('hop KHONG co nut "Cột hiển thị" / thanh keo do rong cot: bang khach tat bo chon cot', async () => {
  const page = createPage();
  await settle();
  page.dom.window.eval(fs.readFileSync(path.join(publicDir, 'shared', 'table-controls.js'), 'utf8'));
  rowOf(page, 'SP-1').click();
  await settle();
  assert.equal(page.$('docModalBody').querySelector('table').getAttribute('data-table-controls'), 'off');
  page.dom.window.TKSTables.refreshAll();
  assert.equal(page.$('docModalBackdrop').querySelectorAll('.tks-columns-button, .tks-column-resizer').length, 0);
  assert.doesNotMatch(page.$('docModalBackdrop').textContent, /Cột hiển thị/);
});

const CONTAINER_ROW = { containerName: 'CONT 10-7G', status: 2, statusLabel: '2. Chưa bốc', eta: 'DK 14-16/10', color: 'Đỏ/Vàng', saleNote: '<b>Trinh</b>', quantity: 50, orderedBy: 'Ánh', listedAt: '15/10', unitsPerPackage: 10, packageCount: 5, vietnamPrice: 26420 };
const READY_SYNC = { available: true, version: 'v1', lastSuccessAt: '2026-10-15T02:00:00Z' };

test('hang du kien hien dong thoi voi doanh so, 6 cot cho sale va 11 cot cho quyen day du', async () => {
  for (const fullAccess of [false, true]) {
    const page = createPage({ containers: code => ({ code, fullAccess, rows: [CONTAINER_ROW], containerSync: READY_SYNC }) });
    await settle();
    rowOf(page, 'SP-1').click();
    await settle();
    const section = page.$('productContainerSection');
    assert.ok(section, 'hang du kien luon hien ben duoi doanh so');
    assert.ok(page.$('productDetailChart'));
    assert.equal(section.querySelectorAll('thead th').length, fullAccess ? 11 : 6);
    assert.equal(section.querySelector('tbody tr').cells.length, fullAccess ? 11 : 6);
    assert.match(section.textContent, /CONT 10-7G.*2. Chưa bốc.*DK 14-16\/10.*Đỏ\/Vàng.*<b>Trinh<\/b>/s);
    assert.equal(section.querySelector('b'), null, 'ghi chu khong duoc chen HTML');
    assert.equal(section.textContent.includes('Ánh'), fullAccess);
    assert.equal(pieCharts(page).length, 1);
  }
});

test('loi rieng tung phan khong lam mat phan kia va snapshot chua san sang khong gia thanh 0', async () => {
  const page = createPage({ customers: () => new Error('fail'), containers: code => ({ code, fullAccess: false, rows: [CONTAINER_ROW], containerSync: READY_SYNC }) });
  await settle(); rowOf(page, 'SP-1').click(); await settle();
  assert.match(page.$('productCustomerSection').textContent, /Không tải được/);
  assert.match(page.$('productContainerSection').textContent, /CONT 10-7G/);
  assert.equal(rowOf(page, 'SP-1').cells[2].textContent, '—');
  const page2 = createPage({ containers: () => new Error('fail') });
  await settle(); rowOf(page2, 'SP-1').click(); await settle();
  assert.ok(page2.$('productDetailChart'));
  assert.match(page2.$('productContainerSection').textContent, /Không tải được/);
});

test('phan hoi CONT cu khong duoc ghi de ma moi hoac mo lai hop da dong', async () => {
  let resolveFirst;
  const page = createPage({ containers: code => code === 'SP-1' ? new Promise(resolve => { resolveFirst = resolve; }) : ({ code, rows: [{ ...CONTAINER_ROW, containerName: 'CONT NEW' }], containerSync: READY_SYNC }) });
  await settle(); rowOf(page, 'SP-1').click(); await settle();
  rowOf(page, 'SP-2').click(); await settle();
  resolveFirst({ rows: [CONTAINER_ROW], containerSync: READY_SYNC }); await settle();
  assert.match(page.$('productContainerSection').textContent, /CONT NEW/);
  assert.doesNotMatch(page.$('productContainerSection').textContent, /CONT 10-7G/);
  page.run('closeDocumentDetail()'); await settle();
  assert.equal(page.$('docModalBody').innerHTML, '');
});

test('snapshot chua dong bo503 hien tinh trang ro rang, khong loi chung; cot giu 0 va so thap phan', async () => {
  const page = createPage({
    report: () => ({ rows: [{ ...PRODUCTS[0], unloadedQty: 0, loadedQty: 3.25 }], containerSync: READY_SYNC }),
    containerStatus: 503,
    containers: () => ({ code: 'CONTAINER_SNAPSHOT_UNAVAILABLE', containerSync: { available: false } })
  });
  await settle();
  assert.equal(rowOf(page, 'SP-1').cells[2].textContent, '0');
  assert.equal(rowOf(page, 'SP-1').cells[3].textContent, '3,25');
  rowOf(page, 'SP-1').click(); await settle();
  assert.match(page.$('productContainerSection').textContent, /chưa có dữ liệu đồng bộ/);
  assert.doesNotMatch(page.$('productContainerSection').textContent, /Không tải được/);
});

test('metadata thay doi moi tai lai bang va giu tim kiem, sort, trang; an view khong goi API', async () => {
  let version = 'v1';
  const page = createPage({ meta: () => ({ ...READY_SYNC, version }), report: () => ({ rows: PRODUCTS.map(p => ({ ...p, unloadedQty: version === 'v1' ? 10 : 20, loadedQty: 0 })), containerSync: { ...READY_SYNC, version } }) });
  await settle();
  const calls = () => page.urls.filter(url => url === '/api/product-report').length;
  const initialCalls = calls();
  page.run("document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); document.getElementById('productReportRows').closest('.view').classList.add('active'); window.__reportTestState.view = document.getElementById('productReportRows').closest('.view').id.replace('view-', '');");
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls, 'cung version khong tai lai');
  page.run("getTableSearchState('productReport').query = 'SP-1'; window.__reportTestState.tableSorts.productReportRows = { columnIndex: 2, direction: 'desc' }; window.__reportTestState.tablePages.productReport = 1;");
  version = 'v2';
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls + 1);
  assert.equal(rowOf(page, 'SP-1').cells[2].textContent, '20');
  assert.equal(rowOf(page, 'SP-2'), undefined, 'bo loc tim kiem van duoc giu');
  assert.equal(page.run("getTableSearchState('productReport').query"), 'SP-1');
  assert.equal(page.run('window.__reportTestState.tableSorts.productReportRows.columnIndex'), 2);
  assert.equal(page.run('window.__reportTestState.tablePages.productReport'), 1);
  const metaCalls = page.urls.filter(url => url.includes('/containers/meta')).length;
  page.run("document.getElementById('productReportRows').closest('.view').classList.remove('active')");
  version = 'v3'; await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(page.urls.filter(url => url.includes('/containers/meta')).length, metaCalls);
});

test('quan ly xem canh bao nguon an toan va ngay du kien de nguyen van', async () => {
  const page = createPage({ containers: () => ({ fullAccess: true, rows: [{ ...CONTAINER_ROW, eta: '', saleNote: null }], containerSync: { ...READY_SYNC, lastError: 'sync failed', stale: true }, warnings: [{ sheetName: 'YIWU', row: 35, reason: '<script>bad</script>' }] }) });
  await settle(); rowOf(page, 'SP-1').click(); await settle();
  const section = page.$('productContainerSection');
  assert.equal(section.querySelector('tbody tr').cells[2].textContent, '—');
  assert.equal(section.querySelector('tbody tr').cells[4].textContent, '—');
  assert.match(section.textContent, /Lần cập nhật mới nhất thất bại/);
  assert.match(section.querySelector('details').textContent, /YIWU.*Dòng 35.*<script>bad<\/script>/s);
  assert.equal(section.querySelector('script'), null);
});

test('dong chi tiet sau metadata refresh tra focus ve dong ma moi thay vi dong da tach DOM', async () => {
  let version = 'v1';
  const page = createPage({
    meta: () => ({ ...READY_SYNC, version }),
    report: () => ({ rows: PRODUCTS, containerSync: { ...READY_SYNC, version } }),
    containers: () => ({ rows: [], containerSync: READY_SYNC })
  });
  await settle();
  const oldRow = rowOf(page, 'SP-1');
  oldRow.focus(); oldRow.click(); await settle();
  page.run("document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); document.getElementById('productReportRows').closest('.view').classList.add('active'); window.__reportTestState.view = document.getElementById('productReportRows').closest('.view').id.replace('view-', '');");
  version = 'v2';
  await page.run('refreshProductContainerMeta()'); await settle();
  const newRow = rowOf(page, 'SP-1');
  assert.equal(oldRow.isConnected, false);
  assert.notEqual(newRow, oldRow);
  page.run('closeDocumentDetail()');
  assert.equal(page.doc.activeElement, newRow);
});

test('dong chi tiet tra focus ve tim kiem bao cao khi ma khong con tren trang', async () => {
  const page = createPage({ containers: () => ({ rows: [], containerSync: READY_SYNC }) });
  await settle();
  rowOf(page, 'SP-1').click(); await settle();
  page.run("getTableSearchState('productReport').query = 'SP-2'; renderProductReport();");
  assert.equal(rowOf(page, 'SP-1'), undefined);
  page.run('closeDocumentDetail()');
  assert.equal(page.doc.activeElement, page.doc.querySelector('[data-table-search="productReport"] .table-search-input'));
});
