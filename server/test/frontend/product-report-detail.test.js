'use strict';

// Bang "Bao cao hang hoa" (tab Hang hoa): 19 cot theo file HANG HOA.xlsx (+ Khach lon nhat) + 2 cot Don gia HN/SG sau Ten san pham, KHONG co
// nut "Chi tiet" rieng; so Chua boc / Da boc / Ti trong khach lon nhat la nut mo hop chi tiet o dung muc. Bam vao 1 dong mo hop chi tiet giua man hinh (dung chung voi bang giao dich/dat hang/tra hang)
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
  {
    code: 'SP-1', name: 'Khay giấy bạc', inTransit: 75, stockHanoi: 5, stockSaigon: 3, availableToSell: 8, qtySold30d: 4, revenue90d: 1000, customerCount90d: 3, topCustomerRevenue90d: 600, topCustomerName: 'KH A', topCustomerShare: 0.6,
    availableHanoi: -2, availableSaigon: 5, descriptionHanoi: 'T50 # 30/9 | <b>VAT</b>+3200đ', descriptionSaigon: '', totalStock: 83, daysToOrder: 12.5, priceHanoi: 15000, priceSaigon: 16500
  },
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

function createPage({ customers = code => customersPayload(code), containers, meta, report, containerStatus = 200, reportVersion, can = () => true } = {}) {
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
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    dom.window.__scrolled = (dom.window.__scrolled || 0) + 1;
    (dom.window.__scrolledTo = dom.window.__scrolledTo || []).push(this.id);
  };
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can, handleBranchError: () => false, renderTopSidebar() {} };

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
    if (href === '/api/product-report/containers/meta' && meta) return Promise.resolve({ ok: true, json: async () => ({ containerSync: meta(), reportVersion: reportVersion ? reportVersion() : null }) });
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
  scripts.forEach((script, index) => dom.window.eval(script + (index === mainIndex ? '\nwindow.__reportTestState = state; window.__reportTestInternals = { docDetail, hiddenByProfile: PRODUCT_REPORT_HIDDEN_BY_PROFILE };' : '')));

  const doc = dom.window.document;
  return { dom, doc, charts, urls, run: code => dom.window.eval(code), $: id => doc.getElementById(id) };
}

const pieCharts = page => page.charts.filter(chart => chart.config.type === 'doughnut' && !chart.destroyed);
const rowOf = (page, code) => [...page.$('productReportRows').querySelectorAll('tr.doc-row')].find(tr => tr.dataset.tableItemId === code);
const modalText = page => page.$('docModalBody').textContent.replace(/\s+/g, ' ');

const HEADERS = [
  'Mã sản phẩm', 'Tên sản phẩm', 'Đơn giá HN', 'Đơn giá SG', 'Chưa bốc', 'Đã bốc', 'Tồn thực HN', 'Có bán HN', 'Điều chuyển SG', 'Tồn thực SG', 'Có bán SG',
  'Mô tả HN', 'Mô tả SG', 'Tổng tồn thực + ĐC', 'Tổng có bán + ĐC', 'SL bán 30 ngày', 'Ngày cần đặt', 'DS 90 ngày', 'SL khách bán',
  'Khách lớn nhất', 'Tỉ trọng khách lớn nhất'
];
const reportTable = page => page.$('productReportRows').closest('table');
const columnKeys = page => [...reportTable(page).querySelectorAll('thead th')].map(th => th.dataset.columnKey);
const scrolledSections = page => (page.dom.window.__scrolledTo || []).filter(id => id === 'productContainerSection' || id === 'productCustomerSection');
const READY = { available: true, version: 'v1', lastSuccessAt: '2026-10-15T02:00:00Z' };

test('bang Bao cao hang hoa co 21 cot (19 cot theo file HANG HOA.xlsx + Don gia HN/SG sau Ten san pham), moi dong du 21 o, dong bam duoc', async () => {
  const page = createPage();
  await settle();

  const headers = [...reportTable(page).querySelectorAll('thead th')].map(th => th.textContent.replace(/[↕▲▼]/g, '').trim());
  assert.deepEqual(headers, HEADERS);
  assert.equal(new Set(columnKeys(page)).size, 21, 'data-column-key duy nhat cho tung cot');

  const firstRow = page.$('productReportRows').querySelector('tr');
  assert.equal(firstRow.cells.length, 21);
  const text = i => firstRow.cells[i].textContent;
  assert.equal(text(0), 'SP-1');
  assert.equal(text(2), '15,000');  // Đơn giá HN
  assert.equal(text(3), '16,500');  // Đơn giá SG
  assert.equal(text(4), '—', 'chua co snapshot CONT => —');
  assert.equal(text(6), '5');      // Tồn thực HN
  assert.equal(text(7), '-2');     // Có bán HN (âm giữ nguyên dấu)
  assert.equal(text(8), '75');     // Điều chuyển SG
  assert.equal(text(9), '3');      // Tồn thực SG
  assert.equal(text(10), '5');      // Có bán SG
  assert.equal(text(13), '83');    // Tổng tồn thực + ĐC
  assert.equal(text(14), '8');     // Tổng có bán + ĐC
  assert.equal(text(15), '4');     // SL bán 30 ngày
  assert.equal(text(16), '12.5');  // Ngày cần đặt: 1 số thập phân
  assert.equal(text(18), '3');     // SL khách bán
  assert.match(text(19), /KH A/);  // Khách lớn nhất (giữ lại)
  assert.match(text(20), /60/);    // Tỉ trọng khách lớn nhất
  assert.equal(firstRow.getAttribute('tabindex'), '0');
  assert.match(firstRow.title, /hàng dự kiến.*doanh số theo khách/);
  [...page.$('productReportRows').querySelectorAll('tr.doc-row')].forEach(row => assert.equal(row.cells.length, 21));
});

test('o chua co so (Co ban, Tong ton, Ngay can dat, Mo ta) hien "—", KHONG gia thanh 0 va KHONG dung moc sort -1 (so am hop le)', async () => {
  const page = createPage();
  await settle();
  const sp2 = rowOf(page, 'SP-2');
  [2, 3, 7, 10, 11, 12, 13, 16].forEach(index => assert.equal(sp2.cells[index].textContent.trim(), '—', 'cot ' + index));
  // So co the am (Co ban, Ngay can dat) nen o trong khong duoc co data-sort-value (-1 se xep lan voi so am that).
  [2, 3, 7, 10, 13, 16].forEach(index => assert.equal(sp2.cells[index].hasAttribute('data-sort-value'), false, 'cot ' + index));
  const sp1 = rowOf(page, 'SP-1');
  assert.equal(sp1.cells[7].getAttribute('data-sort-value'), '-2');
  assert.equal(sp1.cells[16].getAttribute('data-sort-value'), '12.5');
  // Sap xep theo "Co ban HN": so am dung truoc so duong, o trong luon cuoi o ca hai chieu.
  page.run("setTableSort('productReportRows', 7)");
  assert.deepEqual([...page.$('productReportRows').querySelectorAll('tr.doc-row')].map(tr => tr.dataset.tableItemId), ['SP-1', 'SP-2']);
  page.run("setTableSort('productReportRows', 7)");
  assert.deepEqual([...page.$('productReportRows').querySelectorAll('tr.doc-row')].map(tr => tr.dataset.tableItemId), ['SP-1', 'SP-2'], 'o trong van o cuoi khi sap giam dan');
});

test('Mo ta HN/SG hien nguyen van, an toan HTML, rong thi "—"; tim kiem tim duoc theo noi dung mo ta', async () => {
  const page = createPage();
  await settle();
  const sp1 = rowOf(page, 'SP-1');
  assert.equal(sp1.cells[11].textContent, 'T50 # 30/9 | <b>VAT</b>+3200đ');
  assert.equal(sp1.cells[11].querySelector('b'), null, 'mo ta khong duoc chen HTML');
  assert.equal(sp1.cells[12].textContent.trim(), '—');
  page.run("getTableSearchState('productReport').query = 'T50'; renderProductReport();");
  assert.deepEqual([...page.$('productReportRows').querySelectorAll('tr.doc-row')].map(tr => tr.dataset.tableItemId), ['SP-1']);
});

test('Chua boc / Da boc / Ti trong khach lon nhat la nut chi khi co so > 0; 0 va null chi la chu', async () => {
  const page = createPage({ report: () => ({ rows: [
    { ...PRODUCTS[0], unloadedQty: 150, loadedQty: 0 },
    { ...PRODUCTS[1], unloadedQty: null, loadedQty: null }
  ], containerSync: READY }) });
  await settle();
  const sp1 = rowOf(page, 'SP-1'); const sp2 = rowOf(page, 'SP-2');
  const link = (row, index) => row.cells[index].querySelector('button.cell-link');
  assert.equal(link(sp1, 4).dataset.detailFocus, 'containers');
  assert.equal(link(sp1, 4).textContent, '150');
  assert.equal(link(sp1, 5), null, 'Da boc = 0 => khong co muc de xem');
  assert.equal(sp1.cells[5].textContent, '0');
  assert.equal(link(sp1, 20).dataset.detailFocus, 'customers');
  assert.match(link(sp1, 20).textContent, /60/);
  assert.equal(link(sp2, 4), null);
  assert.equal(sp2.cells[4].textContent.trim(), '—');
  assert.equal(link(sp2, 20), null, 'khong co ti trong => khong co nut');
  // Nut chi nam o 3 cot nay.
  assert.deepEqual([...page.$('productReportRows').querySelectorAll('button')].map(button => button.closest('td').cellIndex), [4, 20]);
});

test('hop chi tiet: Hang du kien dung TRUOC Doanh so theo khach (kem bang Khach hang va bieu do)', async () => {
  const page = createPage({ containers: code => ({ code, fullAccess: false, rows: [CONTAINER_ROW], containerSync: READY }) });
  await settle();
  rowOf(page, 'SP-1').click();
  await settle();
  const containers = page.$('productContainerSection');
  const customers = page.$('productCustomerSection');
  assert.ok(containers && customers);
  assert.ok(containers.compareDocumentPosition(customers) & page.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'Hang du kien o tren');
  assert.equal([...page.$('docModalBody').querySelectorAll(':scope > section')].map(section => section.id).join(','), 'productContainerSection,productCustomerSection');
  assert.match(containers.querySelector('.dp-section-title').textContent, /Hàng dự kiến/);
  assert.match(customers.querySelector('.dp-section-title').textContent, /Doanh số theo khách/);
  assert.ok(customers.querySelector('#productDetailChart'), 'bieu do ty trong nam trong Doanh so theo khach');
  assert.match(customers.textContent, /Khách hàng/);
});

test('bam so Ti trong khach lon nhat: mo hop va cuon toi Doanh so theo khach (o duoi) SAU khi ca hai phan da tai xong', async () => {
  const page = createPage({ report: () => ({ rows: [{ ...PRODUCTS[0], unloadedQty: 150, loadedQty: 0 }], containerSync: READY }),
    containers: code => ({ code, fullAccess: false, rows: [CONTAINER_ROW], containerSync: READY }) });
  await settle();
  rowOf(page, 'SP-1').cells[20].querySelector('button').click();
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.deepEqual(scrolledSections(page), ['productCustomerSection']);
  assert.equal(page.dom.window.__reportTestInternals.docDetail.focus, null, 'muc tieu chi dung 1 lan');
  // Tai lai hop (metadata doi / Thu lai) khong cuon lai.
  page.run('loadDocumentDetail()'); await settle();
  assert.deepEqual(scrolledSections(page), ['productCustomerSection']);
});

test('bam so Chua bot / Da boc: mo hop va dua muc Hang du kien ve dau khung cuon', async () => {
  const page = createPage({ report: () => ({ rows: [{ ...PRODUCTS[0], unloadedQty: 150, loadedQty: 20 }], containerSync: READY }),
    containers: code => ({ code, fullAccess: false, rows: [CONTAINER_ROW], containerSync: READY }) });
  await settle();
  rowOf(page, 'SP-1').cells[5].querySelector('button').click();
  await settle();
  assert.equal(page.$('docModalBackdrop').hidden, false);
  assert.equal(page.urls.filter(url => url === '/api/product-report/customers?code=SP-1').length, 1, 'nut khong mo hop hai lan');
  assert.deepEqual(scrolledSections(page), ['productContainerSection']);
});

test('bam o thuong (khong phai nut) mo hop khong cuon; dong dong hop huy muc tieu dang cho', async () => {
  let release;
  const page = createPage({ report: () => ({ rows: [{ ...PRODUCTS[0], unloadedQty: 150, loadedQty: 0 }], containerSync: READY }),
    containers: code => new Promise(resolve => { release = () => resolve({ code, rows: [CONTAINER_ROW], containerSync: READY }); }) });
  await settle();
  rowOf(page, 'SP-1').cells[1].click();
  await settle();
  assert.equal(page.dom.window.__reportTestInternals.docDetail.focus, null);
  release(); await settle();
  assert.deepEqual(scrolledSections(page), []);
  page.run('closeDocumentDetail()');

  // Bam nut roi dong hop truoc khi Hang du kien ve: khong cuon, khong de lai muc tieu cho lan mo sau.
  rowOf(page, 'SP-1').cells[20].querySelector('button').click();
  await settle();
  assert.equal(page.dom.window.__reportTestInternals.docDetail.focus, 'customers');
  page.run('closeDocumentDetail()');
  assert.equal(page.dom.window.__reportTestInternals.docDetail.focus, null);
  release(); await settle();
  assert.deepEqual(scrolledSections(page), []);
});

function sessionHidden(page) {
  const state = page.dom.window.TKSTables.getState(reportTable(page));
  // Mang tao trong realm cua jsdom khong deepEqual duoc voi mang cua test => sao chep ra mang thuong.
  return { key: state.key, hidden: Array.from(state.columns).filter(column => column.hidden).map(column => column.key) };
}
function pageWithTableControls(options) {
  const page = createPage(options);
  page.dom.window.eval(fs.readFileSync(path.join(publicDir, 'shared', 'table-controls.js'), 'utf8'));
  return page;
}

test('khung nhin mac dinh: Nhan vien sale hien A→K + DS 90 ngay; Quan ly / Tro ly an E→K (theo file HANG HOA.xlsx)', async () => {
  const keys = (page) => columnKeys(page);
  const sale = pageWithTableControls();
  await settle();
  sale.dom.window.TKSTables.refreshAll();
  assert.deepEqual(sessionHidden(sale).hidden, [], 'truoc khi biet vai tro chua an cot nao');
  sale.run("window.__reportTestState.currentUser = { vaiTro: 'Nhân viên sale' }; applyProductReportColumnView();");
  const saleView = sessionHidden(sale);
  assert.equal(saleView.key, 'dashboard-table-2:sale');
  const columns = keys(sale);
  assert.deepEqual(columns.filter(key => !saleView.hidden.includes(key)), [...columns.slice(0, 2), ...columns.slice(4, 13), columns[17]], 'sale: A→K (khong co don gia) + cot DS 90 ngay');
  assert.deepEqual(saleView.hidden, [...columns.slice(2, 4), ...columns.slice(13, 17), ...columns.slice(18)]);

  for (const vaiTro of ['Quản lý', 'Trợ lý']) {
    const manager = pageWithTableControls();
    await settle();
    manager.dom.window.TKSTables.refreshAll();
    manager.run("window.__reportTestState.currentUser = { vaiTro: '" + vaiTro + "' }; applyProductReportColumnView();");
    const view = sessionHidden(manager);
    assert.equal(view.key, 'dashboard-table-2:manager');
    assert.deepEqual(view.hidden, [...columns.slice(2, 4), ...columns.slice(6, 13), columns[19]], vaiTro + ': an E→K');
    const hiddenHeaders = [...reportTable(manager).querySelectorAll('thead th.tks-column-hidden')].map(th => th.dataset.columnKey);
    assert.deepEqual(hiddenHeaders, [...columns.slice(2, 4), ...columns.slice(6, 13), columns[19]], 'cot an that su bi an tren giao dien');
    const bodyRows = [...reportTable(manager).querySelectorAll('tbody tr.doc-row')];
    assert.ok(bodyRows.length > 0);
    bodyRows.forEach(row => {
      [2, 3, 6, 7, 8, 9, 10, 11, 12, 19].forEach(index => assert.ok(row.cells[index].classList.contains('tks-column-hidden'), 'o E→K bi an, cot ' + index));
      [0, 1, 4, 5, 13, 16, 17, 20].forEach(index => assert.equal(row.cells[index].classList.contains('tks-column-hidden'), false, 'cot ' + index));
    });
  }
});

test('khung nhin theo vai tro: nguoi dung bat lai cot bang "Cot hien thi" thi duoc giu; goi lai khong ghi de', async () => {
  const page = pageWithTableControls();
  await settle();
  page.dom.window.TKSTables.refreshAll();
  page.run("window.__reportTestState.currentUser = { vaiTro: 'Quản lý' }; applyProductReportColumnView();");
  const keys = columnKeys(page);
  assert.ok(sessionHidden(page).hidden.includes('ton-thuc-hn'));
  reportTable(page).closest('.panel').querySelector('.tks-columns-button').click();
  const box = page.doc.querySelector('.tks-columns-picker input[data-column-key="ton-thuc-hn"]');
  box.checked = true; box.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
  assert.equal(sessionHidden(page).hidden.includes('ton-thuc-hn'), false);
  // authGuard ve lai / dong goi lai cung hoi so: khong dua cot vua bat ve trang thai an.
  page.run('applyProductReportColumnView()');
  assert.equal(sessionHidden(page).hidden.includes('ton-thuc-hn'), false);
  assert.deepEqual(sessionHidden(page).hidden, [...keys.slice(2, 4), ...keys.slice(7, 13), keys[19]]);
});

test('cot Don gia HN/SG: mac dinh an o moi ho so; khong co quyen reports.products.price thi cot bi go khoi bang va hop "Cot hien thi"', async () => {
  const PRICE_KEYS = ['don-gia-hn', 'don-gia-sg'];
  // Co quyen: nam ngay sau Ten san pham, an mac dinh, bat lai duoc bang hop Cot hien thi.
  for (const vaiTro of ['Quản lý', 'Trợ lý', 'Nhân viên sale']) {
    const page = pageWithTableControls({ can: key => key === 'reports.products.price' || key.startsWith('reports.') });
    await settle();
    page.dom.window.TKSTables.refreshAll();
    page.run("window.__reportTestState.currentUser = { vaiTro: '" + vaiTro + "' }; applyProductReportColumnView();");
    assert.deepEqual(columnKeys(page).slice(0, 4), ['ma-sp', 'ten-sp', ...PRICE_KEYS], 'don gia ngay sau ten hang');
    assert.ok(PRICE_KEYS.every(key => sessionHidden(page).hidden.includes(key)), vaiTro + ': don gia an mac dinh');
    reportTable(page).closest('.panel').querySelector('.tks-columns-button').click();
    assert.ok(PRICE_KEYS.every(key => page.doc.querySelector('.tks-columns-picker input[data-column-key="' + key + '"]')), 'co trong hop Cot hien thi');
    const box = page.doc.querySelector('.tks-columns-picker input[data-column-key="don-gia-hn"]');
    box.checked = true; box.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    assert.equal(sessionHidden(page).hidden.includes('don-gia-hn'), false);
    assert.equal(rowOf(page, 'SP-1').cells[2].classList.contains('tks-column-hidden'), false, 'cot don gia hien khi bat');
    assert.equal(rowOf(page, 'SP-1').cells[2].textContent, '15,000');
  }
  // Khong co quyen: cot bi an han, khong xuat hien trong hop chon cot.
  for (const vaiTro of ['Nhân viên sale', 'Quản lý']) {
    const page = pageWithTableControls({ can: key => key !== 'reports.products.price' });
    await settle();
    page.dom.window.TKSTables.refreshAll();
    page.run("window.__reportTestState.currentUser = { vaiTro: '" + vaiTro + "' }; applyProductReportColumnView();");
    const priceHeads = [...reportTable(page).querySelectorAll('thead th[data-price-column]')];
    assert.equal(priceHeads.length, 2);
    priceHeads.forEach(th => { assert.equal(th.hidden, true); assert.ok(th.classList.contains('tks-column-hidden')); });
    rowOf(page, 'SP-1') && [2, 3].forEach(index => assert.ok(rowOf(page, 'SP-1').cells[index].classList.contains('tks-column-hidden'), 'o don gia bi an'));
    reportTable(page).closest('.panel').querySelector('.tks-columns-button').click();
    PRICE_KEYS.forEach(key => assert.equal(page.doc.querySelector('.tks-columns-picker input[data-column-key="' + key + '"]'), null, key + ' khong co trong hop Cot hien thi'));
    assert.ok(page.doc.querySelector('.tks-columns-picker input[data-column-key="ton-thuc-hn"]'), 'cac cot khac van co');
  }
});

test('khung nhin theo vai tro: chua biet vai tro hoac chua nap table-controls thi khong lam gi, khong loi', async () => {
  const page = createPage();
  await settle();
  assert.equal(page.dom.window.TKSTables, undefined);
  page.run("window.__reportTestState.currentUser = { vaiTro: 'Quản lý' }; applyProductReportColumnView();");
  const withControls = pageWithTableControls();
  await settle();
  withControls.dom.window.TKSTables.refreshAll();
  withControls.run('applyProductReportColumnView()'); // currentUser = null
  assert.deepEqual(sessionHidden(withControls), { key: 'dashboard-table-2', hidden: [] });
});

test('cot an mac dinh khop file mau: khoa an cua tung ho so deu co trong thead', async () => {
  const page = createPage();
  await settle();
  const keys = columnKeys(page);
  const raw = page.dom.window.__reportTestInternals.hiddenByProfile;
  const lists = { sale: Array.from(raw.sale), manager: Array.from(raw.manager) };
  [...lists.sale, ...lists.manager].forEach(key => assert.ok(keys.includes(key), key));
  assert.deepEqual(keys.filter(key => !lists.manager.includes(key)), [...keys.slice(0, 2), ...keys.slice(4, 6), ...keys.slice(13, 19), keys[20]]);
  assert.deepEqual(keys.filter(key => !lists.sale.includes(key)), [...keys.slice(0, 2), ...keys.slice(4, 13), keys[17]]);
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
  assert.match(stats['Doanh số 90 ngày'].value, /10,500₫/);
  assert.equal(stats['Số khách mua'].value, '14');
  assert.equal(stats['Số khách mua'].sub, 'TB 750₫ / khách');
  assert.match(stats['Khách lớn nhất'].value, /13[.,]3%/);
  assert.equal(stats['Khách lớn nhất'].sub, 'KH A');
  assert.match(stats['Top 3 khách'].value, /37[.,]1%/);
  assert.match(stats['Top 3 khách'].sub, /3,900₫/);
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

test('hop co sort, thanh keo do rong cot va nut "Cột hiển thị" o dau khoi Khach hang; sort theo so (data-sort-value)', async () => {
  const page = createPage();
  await settle();
  page.dom.window.eval(fs.readFileSync(path.join(publicDir, 'shared', 'table-controls.js'), 'utf8'));
  rowOf(page, 'SP-1').click();
  await settle();
  const table = page.$('docModalBody').querySelector('table');
  assert.equal(table.getAttribute('data-table-controls'), null);
  page.dom.window.TKSTables.refreshAll();
  const buttons = page.$('docModalBackdrop').querySelectorAll('.tks-columns-button');
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].parentElement.classList.contains('dp-section-head'), 'nut nam o dau khoi, khong them hang cong cu');
  assert.equal(table.querySelectorAll('th > .tks-column-resizer').length, 3);

  // sort theo cot "Doanh so 90 ngay": tang dan roi giam dan, thu tu goc khi bam lan 3
  const names = () => [...table.tBodies[0].rows].map(row => row.cells[0].textContent.trim());
  const original = names();
  const header = table.tHead.rows[0].cells[1];
  header.querySelector('.sort-button').click();
  const ascending = names();
  assert.deepEqual(ascending, original.slice().sort((a, b) => revenueOf(table, a) - revenueOf(table, b)));
  header.querySelector('.sort-button').click();
  assert.deepEqual(names(), ascending.slice().reverse());
  header.querySelector('.sort-button').click();
  assert.deepEqual(names(), original);
  // an cot: du lieu van con, chi cot bi an
  buttons[0].click();
  const picker = page.$('docModalBackdrop').ownerDocument.querySelector('.tks-columns-picker');
  assert.equal(picker.hidden, false);
});

function revenueOf(table, name) {
  const row = [...table.tBodies[0].rows].find(item => item.cells[0].textContent.trim() === name);
  return Number(row.cells[1].getAttribute('data-sort-value'));
}

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
  assert.equal(rowOf(page, 'SP-1').cells[4].textContent, '—');
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
  assert.equal(rowOf(page, 'SP-1').cells[4].textContent, '0');
  assert.equal(rowOf(page, 'SP-1').cells[5].textContent, '3.25');
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
  page.run("getTableSearchState('productReport').query = 'SP-1'; window.__reportTestState.tableSorts.productReportRows = { columnIndex: 4, direction: 'desc' }; window.__reportTestState.tablePages.productReport = 1;");
  version = 'v2';
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls + 1);
  assert.equal(rowOf(page, 'SP-1').cells[4].textContent, '20');
  assert.equal(rowOf(page, 'SP-2'), undefined, 'bo loc tim kiem van duoc giu');
  assert.equal(page.run("getTableSearchState('productReport').query"), 'SP-1');
  assert.equal(page.run('window.__reportTestState.tableSorts.productReportRows.columnIndex'), 4);
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

test('reportVersion cua bao cao doi (CONT khong doi) => tai lai bang; cung version hoac null => khong tai lai', async () => {
  let version = 'r1';
  const page = createPage({
    meta: () => READY_SYNC,
    reportVersion: () => version,
    report: () => ({ rows: PRODUCTS, containerSync: READY_SYNC, reportVersion: 'r1' })
  });
  await settle();
  const calls = () => page.urls.filter(url => url === '/api/product-report').length;
  const initialCalls = calls();
  page.run("document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); document.getElementById('productReportRows').closest('.view').classList.add('active'); window.__reportTestState.view = document.getElementById('productReportRows').closest('.view').id.replace('view-', '');");
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls, 'cung reportVersion => khong tai lai');
  version = 'r2';
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls + 1, 'reportVersion doi => tai lai 1 lan');
  // Phan hoi tai lai van mang version cu 'r1' trong fixture nen lan poll sau lai thay khac; doi fixture cho khop.
});

test('chua co che do tang dan (reportVersion = null) thi khong tai lai chi vi reportVersion', async () => {
  const page = createPage({ meta: () => READY_SYNC, reportVersion: () => null, report: () => ({ rows: PRODUCTS, containerSync: READY_SYNC }) });
  await settle();
  const calls = () => page.urls.filter(url => url === '/api/product-report').length;
  const initialCalls = calls();
  page.run("document.querySelectorAll('.view').forEach(el => el.classList.remove('active')); document.getElementById('productReportRows').closest('.view').classList.add('active'); window.__reportTestState.view = document.getElementById('productReportRows').closest('.view').id.replace('view-', '');");
  await page.run('refreshProductContainerMeta()'); await settle();
  assert.equal(calls(), initialCalls);
});
