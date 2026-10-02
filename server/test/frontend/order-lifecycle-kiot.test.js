'use strict';

// Trang Vong doi don hang SAU KHI gop don Phieu tam cua KiotViet (2026-10-01): cot "Gia tri co ban",
// dong chi co o Kiot (chi doc, khong ghi de), khoa dong theo co so + ma, loc/sap xep theo ngay dat
// hang that, PHAN TRANG 100 dong/trang voi sap xep tren TOAN BO danh sach da loc, hop chi tiet nap
// dong hang tu Kiot, xuat Excel gui ma cua TAT CA dong da loc. Chay trang that trong JSDOM voi fetch gia.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { defaultsForRole } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '..', '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'shipment', 'lifecycle', 'index.html'), 'utf8');
const paginationSource = fs.readFileSync(path.join(publicDir, 'js', 'pagination.js'), 'utf8');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function fakeCan(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  return (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k)));
}

// Dong tu sheet (co moc thoi gian) — branch/summary nhu server tra ve.
function sheetOrder(code, extra = {}) {
  return {
    orderCode: code, branch: 'HN', saleName: 'Sale A', customerName: 'KH Sheet', saleSentAt: '01/10/2026 08:00', warning: false,
    summary: { code: 'DELIVERING', label: 'Đơn đang được giao', at: '01/10/2026 09:00' },
    source: 'sheet', kiotPhieuTam: false, sellableValue: null, orderTotal: null, orderDate: '',
    ...extra
  };
}

// Don chi co o Kiot: trang thai "chua gui ke toan", cac moc rong.
function kiotOnlyOrder(code, extra = {}) {
  return {
    orderCode: code, branch: 'HN', saleName: 'Sale Kiot', customerName: 'KH Kiot', saleSentAt: '', warning: false,
    summary: { code: 'NOT_SENT', label: 'Đơn chưa gửi kế toán', actor: null, at: null },
    source: 'kiotviet', kiotPhieuTam: true, sellableValue: 1500000, orderTotal: 2000000, orderDate: '01/10/2026 13:14',
    ...extra
  };
}

async function renderPage({ orders, kiot = { ok: true, stale: false, fetchedAt: null, count: 0 }, vaiTro = 'Quản lý', fetchImpl } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/shipment/lifecycle/' });
  const { window } = dom;
  const calls = [];
  window.setInterval = () => 1;
  window.TKSNav = {
    authGuard: () => Promise.resolve({ vaiTro }),
    can: fakeCan(vaiTro),
    handleBranchError: () => false
  };
  window.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (fetchImpl) {
      const custom = await fetchImpl(String(url), options, window);
      if (custom) return custom;
    }
    if (String(url).startsWith('/api/shipment/lifecycle') && !String(url).includes('order-detail') && !String(url).includes('export')) {
      return { ok: true, status: 200, json: async () => ({ orders, kiot }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.alert = () => {};
  window.eval(paginationSource);
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).forEach(script => window.eval(script));
  await settle();
  return { dom, window, document: window.document, calls };
}

const rowsOf = document => [...document.querySelectorAll('#bulkBody tr')];
const codesOf = document => rowsOf(document).map(row => row.cells[0].textContent);
const headerNamed = (document, key) => document.querySelector(`#bulkHeadRow th[data-sort="${key}"]`);
const setValue = (window, element, value) => { element.value = value; element.dispatchEvent(new window.Event('change', { bubbles: true })); };

// ---------------------------------------------------------------------------
// Cot "Gia tri co ban", dong chi co o Kiot, chi doc
// ---------------------------------------------------------------------------

test('cột "Giá trị có bán": đơn Phiếu tạm hiện số tiền (₫), đơn khác hiện "—"', async () => {
  const page = await renderPage({ orders: [
    sheetOrder('DH1', { kiotPhieuTam: true, sellableValue: 21750000, orderTotal: 32000000 }),
    sheetOrder('DH2'),
    kiotOnlyOrder('DH3', { sellableValue: 0 })
  ] });
  const cells = rowsOf(page.document).map(row => row.cells[5].textContent);
  assert.equal(cells[0], '21.750.000₫');
  assert.equal(cells[1], '—', 'don khong con Phieu tam');
  assert.equal(cells[2], '0₫', 'Phieu tam co gia tri co ban = 0 van hien 0₫ (khac voi "khong co gia tri")');
  // Cot "Gia tri don" (ngay truoc "Gia tri co ban") = tong tien phieu tren Kiot.
  const totals = rowsOf(page.document).map(row => row.cells[4].textContent);
  assert.equal(totals[0], '32.000.000₫');
  assert.equal(totals[1], '—', 'don khong con Phieu tam');
  assert.equal(totals[2], '2.000.000₫', 'don chi co o Kiot (fixture orderTotal 2.000.000)');
  page.dom.window.close();
});

test('đơn chỉ có ở Kiot: nhãn "Đơn chưa gửi kế toán", mốc rỗng "—"; Quản lý (được ghi đè) KHÔNG có ô chọn trạng thái cho đơn Kiot, nhưng vẫn có cho dòng sheet', async () => {
  const page = await renderPage({ orders: [sheetOrder('DH1'), kiotOnlyOrder('DH2')] });
  const [sheetRow, kiotRow] = rowsOf(page.document);
  assert.ok(sheetRow.querySelector('select.status-select'), 'dong sheet: o chon trang thai (ghi de)');
  assert.equal(kiotRow.querySelector('select'), null, 'don Kiot chua co dong trong Sheet: ghi de se 404 nen khong hien o chon');
  assert.equal(kiotRow.cells[7].textContent.trim(), 'Đơn chưa gửi kế toán');
  assert.ok(kiotRow.cells[7].querySelector('.lc-badge.badge-not-sent'));
  assert.equal(kiotRow.cells[6].textContent, '—', 'Sale ra don trong');
  assert.equal(kiotRow.cells[8].textContent, '—', 'Cap nhat gan nhat trong');
  assert.equal(kiotRow.cells[9].textContent, '', 'khong canh bao');
  page.dom.window.close();
});

test('khóa dòng theo CƠ SỞ + MÃ: cùng mã DH ở HN và SG đều hiện (không bị gộp thành 1 dòng)', async () => {
  const page = await renderPage({ orders: [
    sheetOrder('DH018717', { branch: 'HN' }),
    kiotOnlyOrder('DH018717', { branch: 'SG' }),
    kiotOnlyOrder('DH018717', { branch: 'HN', saleName: 'Khong trung' }) // gia lap trung hoan toan: key trung -> chi 1 dong
  ] });
  // Hai dong dau khac co so => 2 dong; dong thu 3 trung (HN + ma) voi dong 1 => hop nhat vao cung khoa DOM.
  assert.equal(rowsOf(page.document).length, 2);
  page.dom.window.close();
});

test('banner cảnh báo khi nguồn Kiot lỗi (kiot.ok=false); không hiện khi bình thường', async () => {
  const failed = await renderPage({ orders: [sheetOrder('DH1')], kiot: { ok: false, stale: false, fetchedAt: null, count: 0 } });
  const notice = failed.document.getElementById('lcKiotNotice');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /Chưa lấy được đơn Phiếu tạm từ Kiot/);
  failed.dom.window.close();

  const stale = await renderPage({ orders: [sheetOrder('DH1')], kiot: { ok: true, stale: true, fetchedAt: null, count: 1 } });
  assert.equal(stale.document.getElementById('lcKiotNotice').hidden, false);
  assert.match(stale.document.getElementById('lcKiotNotice').textContent, /chưa mới nhất/);
  stale.dom.window.close();

  const fine = await renderPage({ orders: [sheetOrder('DH1')] });
  assert.equal(fine.document.getElementById('lcKiotNotice').hidden, true);
  fine.dom.window.close();
});

// ---------------------------------------------------------------------------
// Sap xep / loc theo gia tri co ban (SO) va ngay dat hang (THOI GIAN THAT)
// ---------------------------------------------------------------------------

test('sắp xếp cột "Giá trị có bán" theo SỐ (không theo chuỗi); đơn không có giá trị luôn cuối', async () => {
  const page = await renderPage({ orders: [
    kiotOnlyOrder('A', { sellableValue: 9000000 }),
    kiotOnlyOrder('B', { sellableValue: 10000000 }), // chuoi "10..." < "9..." nhung so lon hon
    sheetOrder('C'),
    kiotOnlyOrder('D', { sellableValue: 250000 })
  ] });
  const header = headerNamed(page.document, 'sellableValue');
  header.click();
  assert.deepEqual(codesOf(page.document), ['D', 'A', 'B', 'C'], 'tang dan theo so, khong co gia tri cuoi');
  header.click();
  assert.deepEqual(codesOf(page.document), ['B', 'A', 'D', 'C'], 'giam dan, khong co gia tri VAN cuoi');
  page.dom.window.close();
});

test('lọc thời gian theo "Ngày đặt hàng (Kiot)" đúng thời gian thật; dòng sheet không có ngày đặt bị loại khi đã chọn khoảng', async () => {
  const page = await renderPage({ orders: [
    kiotOnlyOrder('DA', { orderDate: '30/09/2026 23:30' }),
    kiotOnlyOrder('DB', { orderDate: '01/10/2026 07:00' }),
    kiotOnlyOrder('DC', { orderDate: '05/01/2027 09:00' }),
    sheetOrder('DD')
  ] });
  const { window, document } = page;
  setValue(window, document.getElementById('bulkDateField'), 'orderDate');
  setValue(window, document.getElementById('bulkDateFrom'), '2026-10-01');
  setValue(window, document.getElementById('bulkDateTo'), '2026-10-01');
  assert.deepEqual(codesOf(document), ['DB']);
  setValue(window, document.getElementById('bulkDateTo'), '2027-01-05');
  assert.deepEqual(codesOf(document), ['DB', 'DC']);
  page.dom.window.close();
});

// ---------------------------------------------------------------------------
// Phan trang 100 dong/trang — sap xep TOAN BO danh sach truoc khi cat trang
// ---------------------------------------------------------------------------

function manyOrders(count) {
  // Dong i co saleSentAt GIAM dan theo i (dong 1 moi nhat, dong `count` cu nhat) -> thu tu goc != thu tu tang dan.
  return Array.from({ length: count }, (_, i) => {
    const day = String(28 - Math.floor(i / 10)).padStart(2, '0');
    return sheetOrder('DH' + String(i + 1).padStart(4, '0'), {
      saleSentAt: `${day}/09/2026 ${String(8 + (i % 10)).padStart(2, '0')}:00`,
      summary: { code: 'DELIVERING', label: 'Đơn đang được giao', at: '29/09/2026 08:00' }
    });
  });
}

test('phân trang 100 dòng/trang: nhãn "Trang 1/3", nút trang đầu/trước bị khóa ở trang 1, đếm theo tổng số đơn', async () => {
  const page = await renderPage({ orders: manyOrders(250) });
  const { document } = page;
  assert.equal(rowsOf(document).length, 100);
  assert.equal(document.getElementById('bulkPagination').hidden, false);
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 1/3');
  assert.equal(document.getElementById('bulkFirstPage').disabled, true);
  assert.equal(document.getElementById('bulkPrevPage').disabled, true);
  assert.equal(document.getElementById('bulkNextPage').disabled, false);
  assert.equal(document.getElementById('bulkCount').textContent, '250 đơn');
  assert.equal(codesOf(document)[0], 'DH0001');

  document.getElementById('bulkNextPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/3');
  assert.equal(codesOf(document)[0], 'DH0101');
  assert.equal(codesOf(document).length, 100);

  document.getElementById('bulkLastPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 3/3');
  assert.equal(rowsOf(document).length, 50);
  assert.equal(document.getElementById('bulkNextPage').disabled, true);
  assert.equal(document.getElementById('bulkLastPage').disabled, true);

  document.getElementById('bulkPrevPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/3');
  document.getElementById('bulkFirstPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 1/3');
  page.dom.window.close();
});

test('dưới 100 đơn: không hiện thanh phân trang', async () => {
  const page = await renderPage({ orders: manyOrders(40) });
  assert.equal(page.document.getElementById('bulkPagination').hidden, true);
  assert.equal(rowsOf(page.document).length, 40);
  page.dom.window.close();
});

test('sắp xếp cột thời gian áp cho TOÀN BỘ bảng, không chỉ trang đang xem; đổi sắp xếp về trang 1', async () => {
  const orders = manyOrders(250); // DH0250 co saleSentAt som nhat nhung nam o TRANG 3 theo thu tu goc
  const page = await renderPage({ orders });
  const { document } = page;
  const earliest = orders.reduce((best, o) => (
    // so sanh theo thoi gian that: ngay (thang 9) roi gio
    (o.saleSentAt.slice(0, 2) + o.saleSentAt.slice(11, 16)) < (best.saleSentAt.slice(0, 2) + best.saleSentAt.slice(11, 16)) ? o : best
  ), orders[0]);

  document.getElementById('bulkLastPage').click(); // dang o trang 3
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 3/3');

  headerNamed(document, 'saleSentAt').click(); // tang dan
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 1/3', 'doi sap xep ve trang 1');
  assert.equal(codesOf(document)[0], earliest.orderCode, 'dong som nhat (von o trang cuoi) len dau trang 1');

  // Trang 3 sau khi sap tang dan chua cac dong MUON nhat — kiem tra thu tu tang dan xuyen suot cac trang.
  const timeOf = code => {
    const o = orders.find(x => x.orderCode === code);
    return Date.UTC(2026, 8, Number(o.saleSentAt.slice(0, 2)), Number(o.saleSentAt.slice(11, 13)));
  };
  const collected = [];
  for (let p = 1; p <= 3; p++) {
    if (p > 1) document.getElementById('bulkNextPage').click();
    collected.push(...codesOf(document));
  }
  assert.equal(collected.length, 250);
  for (let i = 1; i < collected.length; i++) {
    assert.ok(timeOf(collected[i - 1]) <= timeOf(collected[i]), `thu tu thoi gian xuyen cac trang tai vi tri ${i}`);
  }
  page.dom.window.close();
});

test('đổi bộ lọc/tìm kiếm về trang 1; số đơn hiển thị là "đã lọc / tổng"', async () => {
  const orders = manyOrders(250);
  orders[240] = sheetOrder('KHAC-TIM-THAY', { saleName: 'Nguyen Tim Thay' });
  const page = await renderPage({ orders });
  const { window, document } = page;
  document.getElementById('bulkNextPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/3');

  const input = document.getElementById('bulkSearchInput');
  input.value = 'khac-tim';
  document.getElementById('bulkSearchForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(codesOf(document), ['KHAC-TIM-THAY']);
  assert.equal(document.getElementById('bulkPagination').hidden, true);
  assert.equal(document.getElementById('bulkCount').textContent, '1 / 250 đơn');
  page.dom.window.close();
});

test('tự làm mới (silent) giữ nguyên trang đang xem; kẹp lại nếu số trang giảm', async () => {
  const state = { orders: manyOrders(250) };
  const page = await renderPage({
    orders: state.orders,
    fetchImpl: url => (url === '/api/shipment/lifecycle'
      ? { ok: true, status: 200, json: async () => ({ orders: state.orders, kiot: { ok: true } }) }
      : null)
  });
  const { window, document } = page;
  document.getElementById('bulkNextPage').click();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/3');

  // Mo phong lan tu lam moi 60s (visibilitychange kich hoat loadBulkOrders(true)) — du lieu van 250 dong.
  window.eval('loadBulkOrders(true)');
  await settle();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/3', 'giu trang');

  state.orders = manyOrders(120); // con 2 trang -> trang hien tai van hop le
  window.eval('loadBulkOrders(true)');
  await settle();
  assert.equal(document.getElementById('bulkPageLabel').textContent, 'Trang 2/2');

  state.orders = manyOrders(30); // con 1 trang -> kep ve trang 1
  window.eval('loadBulkOrders(true)');
  await settle();
  assert.equal(document.getElementById('bulkPagination').hidden, true);
  assert.equal(rowsOf(document).length, 30);
  page.dom.window.close();
});

test('xuất Excel gửi mã của TẤT CẢ dòng đã lọc (mọi trang), theo đúng thứ tự đang sắp xếp', async () => {
  const orders = manyOrders(250);
  let exportBody = null;
  const page = await renderPage({
    orders,
    fetchImpl: (url, options, window) => {
      if (!url.endsWith('/export')) return null;
      exportBody = JSON.parse(options.body);
      return { ok: true, status: 200, headers: { get: () => 'attachment; filename="x.xlsx"' }, blob: async () => new window.Blob(['x']) };
    }
  });
  const { document } = page;
  headerNamed(document, 'orderCode').click(); // A-Z
  headerNamed(document, 'orderCode').click(); // Z-A
  assert.equal(codesOf(document)[0], 'DH0250');
  document.getElementById('bulkExportBtn').click();
  await settle();
  assert.equal(exportBody.codes.length, 250, 'khong chi 100 dong cua trang hien tai');
  assert.equal(exportBody.codes[0], 'DH0250');
  assert.equal(exportBody.codes[249], 'DH0001');
  page.dom.window.close();
});

// ---------------------------------------------------------------------------
// Hop chi tiet don: nap dong hang tu Kiot
// ---------------------------------------------------------------------------

function kiotDetail(overrides = {}) {
  return {
    code: 'DH041173', branch: 'HN', date: '01/10/2026 13:14', status: 'Phiếu tạm', total: 855000, phieuTam: true, sellableValue: 550000,
    lines: [
      { productCode: 'A', productName: 'Hàng A', quantity: 500, price: 1000, discount: 0, amount: 500000, isService: false, onHand: 40, inTransit: 160, sellableQty: 200, sellableAmount: 200000 },
      { productCode: 'B', productName: 'Hàng B', quantity: 70, price: 5000, discount: 0, amount: 350000, isService: false, onHand: 800, inTransit: 0, sellableQty: 70, sellableAmount: 350000 },
      { productCode: 'VATDA44', productName: 'VAT', quantity: 1, price: 5000, discount: 0, amount: 5000, isService: true, onHand: null, inTransit: null, sellableQty: null, sellableAmount: null }
    ],
    ...overrides
  };
}

test('bấm dòng: mở hộp chi tiết, gọi order-detail đúng mã/cơ sở và hiện bảng hàng hóa kèm tồn kho + đang vận chuyển + có bán', async () => {
  const page = await renderPage({
    orders: [kiotOnlyOrder('DH041173', { branch: 'HN' })],
    fetchImpl: url => (url.includes('/order-detail')
      ? { ok: true, status: 200, json: async () => ({ detail: kiotDetail() }) }
      : null)
  });
  const { document } = page;
  rowsOf(document)[0].click();
  assert.equal(document.getElementById('lcDetailOverlay').hidden, false);
  await settle();

  const detailCall = page.calls.find(call => call.url.includes('/order-detail'));
  assert.equal(detailCall.url, '/api/shipment/lifecycle/order-detail?code=DH041173&branch=HN');
  assert.ok(document.querySelector('.lc-detail-dialog').classList.contains('is-wide'));

  const headers = [...document.querySelectorAll('.lc-lines thead th')].map(th => th.textContent);
  assert.deepEqual(headers, ['Mã hàng', 'Tên hàng', 'SL đặt', 'Đơn giá', 'Thành tiền', 'Tồn kho', 'Đang vận chuyển', 'Có bán', 'Thành tiền có bán']);
  const rows = [...document.querySelectorAll('.lc-lines tbody tr')].map(tr => [...tr.cells].map(td => td.textContent));
  assert.deepEqual(rows[0], ['A', 'Hàng A', '500', '1.000₫', '500.000₫', '40', '160', '200', '200.000₫']);
  assert.deepEqual(rows[1], ['B', 'Hàng B', '70', '5.000₫', '350.000₫', '800', '0', '70', '350.000₫']);
  assert.deepEqual(rows[2].slice(5), ['—', '—', '—', '—'], 'dong thue VAT khong co ton/co ban');
  assert.ok(document.querySelectorAll('.lc-lines tbody tr')[2].classList.contains('is-service'));
  const text = document.getElementById('lcDetailBody').textContent;
  assert.match(text, /Giá trị đơn \(Kiot\)855\.000₫/);
  assert.match(text, /Giá trị có bán550\.000₫/);
  assert.match(text, /không tính dòng VAT/);
  page.dom.window.close();
});

test('đơn không còn Phiếu tạm: bảng hàng hóa không có tồn/có bán và ghi chú giải thích', async () => {
  const detail = kiotDetail({
    status: 'Hoàn thành', phieuTam: false, sellableValue: null,
    lines: [{ productCode: 'A', productName: 'Hàng A', quantity: 5, price: 1000, discount: 0, amount: 5000, isService: false, onHand: null, inTransit: null, sellableQty: null, sellableAmount: null }]
  });
  const page = await renderPage({
    orders: [sheetOrder('DH1')],
    fetchImpl: url => (url.includes('/order-detail') ? { ok: true, status: 200, json: async () => ({ detail }) } : null)
  });
  rowsOf(page.document)[0].click();
  await settle();
  const cells = [...page.document.querySelectorAll('.lc-lines tbody tr')[0].cells].map(td => td.textContent);
  assert.deepEqual(cells.slice(5), ['—', '—', '—', '—']);
  const text = page.document.getElementById('lcDetailBody').textContent;
  assert.match(text, /không còn ở trạng thái Phiếu tạm/);
  assert.doesNotMatch(text, /Giá trị có bán/);
  page.dom.window.close();
});

test('cột "Thời gian đặt hàng" nằm cạnh Mã đơn trên bảng; đơn không có thời gian đặt hiện "—"', async () => {
  const page = await renderPage({ orders: [kiotOnlyOrder('DH1'), sheetOrder('DH2')] });
  const heads = [...page.document.querySelectorAll('#bulkHeadRow th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  assert.deepEqual(heads.slice(0, 2), ['Mã đơn', 'Thời gian đặt hàng']);
  const rows = rowsOf(page.document);
  assert.equal(rows[0].cells[1].textContent, '01/10/2026 13:14');
  assert.equal(rows[1].cells[1].textContent, '—');
  page.dom.window.close();
});

test('hộp chi tiết của dòng bảng có "Thời gian đặt hàng" ngay sau Mã đơn hàng; tra cứu cho Khách (không có trường này) thì không hiện', async () => {
  const page = await renderPage({
    orders: [kiotOnlyOrder('DH1')],
    fetchImpl: url => (url.includes('/order-detail') ? { ok: false, status: 404, json: async () => ({ error: 'x' }) } : null)
  });
  rowsOf(page.document)[0].click();
  const labels = [...page.document.querySelectorAll('#lcDetailBody .lc-detail-label')].map(el => el.textContent);
  assert.deepEqual(labels.slice(0, 2), ['Mã đơn hàng', 'Thời gian đặt hàng']);
  const values = [...page.document.querySelectorAll('#lcDetailBody .lc-detail-value')].map(el => el.textContent);
  assert.equal(values[1], '01/10/2026 13:14');
  page.dom.window.close();
});

test('order-detail trả 404 (dòng chỉ có trong Sheet): chỉ còn các trường sheet, không hiện bảng hàng hóa và không rộng hộp', async () => {
  const page = await renderPage({
    orders: [sheetOrder('HD000013', { branch: 'SG' })],
    fetchImpl: url => (url.includes('/order-detail') ? { ok: false, status: 404, json: async () => ({ error: 'Không tìm thấy', code: 'ORDER_NOT_FOUND' }) } : null)
  });
  rowsOf(page.document)[0].click();
  await settle();
  assert.equal(page.document.querySelector('.lc-lines'), null);
  assert.equal(page.document.querySelector('.lc-detail-dialog').classList.contains('is-wide'), false);
  assert.match(page.document.getElementById('lcDetailBody').textContent, /Mã đơn hàng/);
  assert.doesNotMatch(page.document.getElementById('lcDetailBody').textContent, /Lỗi|Không tìm thấy/);
  page.dom.window.close();
});

test('lỗi khác (500/mạng) khi tải chi tiết hàng hóa: hiện thông báo nhỏ, hộp vẫn dùng được', async () => {
  const page = await renderPage({
    orders: [kiotOnlyOrder('DH1')],
    fetchImpl: url => (url.includes('/order-detail') ? { ok: false, status: 500, json: async () => ({ error: 'Lỗi hệ thống, vui lòng thử lại sau.' }) } : null)
  });
  rowsOf(page.document)[0].click();
  await settle();
  assert.match(page.document.getElementById('lcDetailBody').textContent, /Lỗi hệ thống/);
  assert.equal(page.document.getElementById('lcDetailOverlay').hidden, false);
  page.dom.window.close();
});

test('phản hồi chi tiết đến muộn sau khi đóng hộp / mở đơn khác bị bỏ qua (không chèn nhầm đơn)', async () => {
  const resolvers = [];
  const page = await renderPage({
    orders: [kiotOnlyOrder('DH1'), kiotOnlyOrder('DH2')],
    fetchImpl: url => (url.includes('/order-detail')
      ? new Promise(resolve => resolvers.push(body => resolve({ ok: true, status: 200, json: async () => ({ detail: body }) })))
      : null)
  });
  const { document } = page;
  rowsOf(document)[0].click();
  await settle();
  document.getElementById('lcDetailClose').click();
  rowsOf(document)[1].click();
  await settle();
  assert.equal(resolvers.length, 2);

  resolvers[0](kiotDetail({ code: 'DH1', lines: [{ productCode: 'CU', productName: 'Don cu', quantity: 1, price: 1, discount: 0, amount: 1, isService: false, onHand: 1, inTransit: 0, sellableQty: 1, sellableAmount: 1 }] }));
  await settle();
  assert.equal(page.document.querySelector('.lc-lines'), null, 'phan hoi cua don DH1 (da dong) khong duoc hien');

  resolvers[1](kiotDetail({ code: 'DH2' }));
  await settle();
  assert.ok(page.document.querySelector('.lc-lines'));
  assert.equal([...document.querySelectorAll('.lc-lines tbody tr')][0].cells[0].textContent, 'A');
  page.dom.window.close();
});

test('tra cứu 1 đơn (Khu A) và hộp từ tab Lịch sử KHÔNG gọi API Kiot — chỉ bấm dòng của bảng toàn bộ đơn mới gọi', async () => {
  const page = await renderPage({ orders: [sheetOrder('DH1')] });
  page.window.eval("openDetailModal({ orderCode: 'DH1', branch: 'HN' })"); // khong co opts.withKiot
  await settle();
  assert.equal(page.calls.some(call => call.url.includes('/order-detail')), false);
  page.dom.window.close();
});
