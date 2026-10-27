'use strict';

// Chi dinh vi tri tren trang Vong doi don hang THAT (public/shipment/lifecycle/pick/*): popup chon vi tri, validate, giu cho,
// phieu in, nut theo trang thai (Dang nhat / Xac nhan nhat / Huy nhat), cot ST, loc + nhan tren danh sach, an theo quyen.
// Chay trang that trong JSDOM voi fetch gia (hop dong API /api/shipment/pick/*).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { lifecycleResponse, isListUrl } = require('./lifecycleFakeServer');

const publicDir = path.join(__dirname, '..', '..', 'public');
const pickDir = path.join(publicDir, 'shipment', 'lifecycle', 'pick');
const html = fs.readFileSync(path.join(publicDir, 'shipment', 'lifecycle', 'index.html'), 'utf8');
const read = file => fs.readFileSync(file, 'utf8');

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function orderRow(code, extra = {}) {
  return {
    orderCode: code, branch: 'HN', saleName: 'Sale A', customerName: 'KH A', saleSentAt: '01/10/2026 08:00', warning: false,
    summary: { code: 'SENT_TO_ACCOUNTANT', label: 'Đã gửi kế toán', at: '01/10/2026 09:00' },
    source: 'kiotviet', kiotStatus: 'Phiếu tạm', sellableValue: 100000, orderTotal: 100000, orderDate: '01/10/2026 13:14', note: '', pickStatus: null,
    ...extra
  };
}

function kiotDetail(code) {
  return {
    code, branch: 'HN', date: '01/10/2026 13:14', status: 'Phiếu tạm', total: 100000, phieuTam: true, sellableValue: 100000,
    lines: [
      { productCode: 'A', productName: 'Hàng A', quantity: 100, price: 1000, discount: 0, amount: 100000, isService: false, onHand: 200, inTransit: 0, sellableQty: 100, sellableAmount: 100000, measure: { status: 'ok', m3: 1, kg: 10, cartons: 2 } },
      { productCode: 'VATDA44', productName: 'VAT', quantity: 1, price: 5000, discount: 0, amount: 5000, isService: true, onHand: null, inTransit: null, sellableQty: null, sellableAmount: null, measure: { status: 'service', m3: null, kg: null, cartons: null } }
    ],
    freight: { unavailable: true, message: 'Không tính được' }
  };
}

const position = (id, location, notes, available, extra = {}) => ({ positionId: id, code: 'A', name: 'Hàng A', location, notes, version: 1, onHand: available, held: 0, available, warnings: [], ...extra });

function makeAssignment(status, extra = {}) {
  return {
    id: 7, branch: 'HN', orderCode: 'DH1', status, version: 1, assignedByName: 'Quản lý A', assignedAt: '2026-10-27T03:00:00.000Z',
    snapshot: {
      customerName: 'KH A', saleName: 'Sale A', saleTelegramId: '123456', orderDate: '01/10/2026 13:14',
      lines: [{ productCode: 'A', productName: 'Hàng A', quantity: 100, price: 1000, discount: 0 }], invoiceDiscount: 0, priorDebt: 0
    },
    lines: [{ id: 1, productCode: 'A', positionId: 11, location: 'A07', plannedQty: 100, reservedQty: status === 'picking' ? 100 : 0, stCartons: 2, stText: '2Tx50', pickedQty: status === 'confirmed' ? 100 : null, specBefore: '4T x 50', specAfter: status === 'confirmed' ? '2T x 50' : null }],
    history: [], ...extra
  };
}

// Kho gia cua cac API Chi dinh vi tri; test doi `store.*` de dieu khien phan hoi.
function newStore(extra = {}) {
  return {
    order: { branch: 'HN', orderCode: 'DH1', customerName: 'KH A', saleName: 'Sale A', saleTelegramId: '123456', orderDate: '01/10/2026 13:14', status: { code: 'SENT_TO_ACCOUNTANT', label: 'Đã gửi kế toán' }, eligible: true, lines: [{ productCode: 'A', productName: 'Hàng A', quantity: 100, price: 1000, discount: 0 }] },
    candidates: { a: [position(11, 'A07', '4T x 50', 200), position(12, 'B02', '2T x 25', 50)] },
    assignment: null, posted: [], statusCalls: [], candidateCalls: 0, postError: null, statusError: null,
    ...extra
  };
}

async function renderPage({ orders = [orderRow('DH1')], store = newStore(), permissions = ['shipment.lifecycle', 'shipment.pick'], fetchImpl } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/shipment/lifecycle/' });
  const { window } = dom;
  const calls = [];
  const source = { orders };
  window.setInterval = () => 1;
  window.eval(read(path.join(publicDir, 'shared/shared-nav.js')));
  const readCachedJSON = window.TKSNav.readCachedJSON;
  window.TKSNav = {
    readCachedJSON, authGuard: () => Promise.resolve({ vaiTro: 'Quản lý' }),
    can: (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k))), handleBranchError: () => false
  };
  window.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ url: href, options });
    if (fetchImpl) { const custom = await fetchImpl(href, options, window); if (custom) return custom; }
    const u = new URL(href, 'https://tokosi.example');
    if (isListUrl(href)) return json(lifecycleResponse(href, source.orders, { ok: true, stale: false, fetchedAt: null, count: 0 }));
    if (u.pathname === '/api/shipment/lifecycle/order-detail') return json({ detail: kiotDetail(u.searchParams.get('code')) });
    if (u.pathname === '/api/shipment/pick/candidates') { store.candidateCalls++; return json({ order: store.order, candidates: store.candidates, assignment: store.assignment }); }
    if (u.pathname === '/api/shipment/pick' && (options.method || 'GET') === 'GET') return json({ assignment: store.assignment });
    if (u.pathname === '/api/shipment/pick' && options.method === 'POST') {
      store.posted.push(JSON.parse(options.body));
      if (store.postError) return json(store.postError.body, store.postError.status);
      store.assignment = makeAssignment('picking');
      return json({ assignment: store.assignment }, 201);
    }
    const action = u.pathname.match(/^\/api\/shipment\/pick\/(\d+)\/(confirm|cancel)$/);
    if (action && options.method === 'POST') {
      store.statusCalls.push({ id: action[1], action: action[2], body: JSON.parse(options.body) });
      if (store.statusError) return json(store.statusError.body, store.statusError.status);
      store.assignment = makeAssignment(action[2] === 'confirm' ? 'confirmed' : 'cancelled', { version: store.assignment.version + 1 });
      return json({ assignment: store.assignment });
    }
    if (u.pathname === '/shipment/lifecycle/pick/order-template.tpl') return { ok: true, status: 200, text: async () => read(path.join(pickDir, 'order-template.tpl')) };
    if (u.pathname === '/shipment/lifecycle/pick/invoice-a4.css') return { ok: true, status: 200, text: async () => read(path.join(pickDir, 'invoice-a4.css')) };
    if (u.pathname.startsWith('/shipment/lifecycle/pick/invoice-assets/')) return { ok: true, status: 200, blob: async () => new window.Blob(['jpg'], { type: 'image/jpeg' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  window.URL.createObjectURL = () => 'blob:test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => null;
  window.alert = () => {};
  window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.eval(read(path.join(publicDir, 'shared/table-controls.js')));
  // Cac script ngoai cua trang (jsdom 'outside-only' khong tu nap): nap theo dung thu tu trong index.html.
  ['shared/carton.js', 'shared/pick-rules.js', 'shipment/lifecycle/pick/invoice.js', 'shipment/lifecycle/pick/print-tools.js', 'shipment/lifecycle/pick/pick-assign.js']
    .forEach(file => window.eval(read(path.join(publicDir, file))));
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).forEach(script => window.eval(script));
  await settle();
  return { dom, window, document: window.document, calls, source, store };
}

const rowsOf = document => [...document.querySelectorAll('#bulkBody tr')];
const openDetail = async page => { rowsOf(page.document)[0].click(); await settle(); };
const openPopup = async page => { await openDetail(page); page.document.getElementById('openPickingBtn').click(); await settle(); };
const text = (page, id) => page.document.getElementById(id).textContent;
const visible = (page, id) => !page.document.getElementById(id).hidden;
const click = async (page, id) => { page.document.getElementById(id).click(); await settle(); };

// ---------------------------------------------------------------------------

test('quyền shipment.pick: có quyền + đơn Đã gửi kế toán thì có nút Chỉ định vị trí; không quyền thì không nút và ẩn ô lọc chỉ định', async () => {
  const withPick = await renderPage();
  await openDetail(withPick);
  assert.ok(withPick.document.getElementById('openPickingBtn'), 'nút Chỉ định vị trí ở đầu khối Hàng hóa');
  assert.ok(withPick.document.querySelector('#lcDetailKiot .dp-section-head #pickingActions'));
  assert.equal(withPick.document.getElementById('bulkPickWrap').hidden, false);

  const without = await renderPage({ permissions: ['shipment.lifecycle'] });
  await openDetail(without);
  assert.equal(without.document.getElementById('openPickingBtn'), null);
  assert.equal(without.document.getElementById('bulkPickWrap').hidden, true);
  assert.equal(without.document.getElementById('pickingDialog'), null, 'popup chỉ tạo khi mở');
  [withPick, without].forEach(page => page.dom.window.close());
});

test('đơn chưa gửi kế toán và chưa có chỉ định: không có nút; đã có chỉ định thì vẫn mở được để xem/in', async () => {
  const notSent = await renderPage({ orders: [orderRow('DH1', { summary: { code: 'NOT_SENT', label: 'Chưa gửi', at: null } })] });
  await openDetail(notSent);
  assert.equal(notSent.document.getElementById('pickingActions'), null);

  const store = newStore({ assignment: makeAssignment('confirmed') });
  const assigned = await renderPage({ orders: [orderRow('DH1', { summary: { code: 'DELIVERING', label: 'Đang giao', at: null }, pickStatus: 'confirmed' })], store });
  await openDetail(assigned);
  assert.ok(assigned.document.getElementById('openPickingBtn'));
  assert.match(assigned.document.querySelector('.picking-confirmed').textContent, /Đã chỉ định · Xác nhận nhặt/);
  [notSent, assigned].forEach(page => page.dom.window.close());
});

test('popup gọi candidates đúng cơ sở + mã đơn, hiện 6 cột và gợi ý tròn thùng; Xác nhận bật khi phân bổ đủ', async () => {
  const page = await renderPage();
  await openPopup(page);
  const call = page.calls.find(c => c.url.startsWith('/api/shipment/pick/candidates'));
  assert.equal(call.url, '/api/shipment/pick/candidates?branch=HN&order=DH1');
  assert.deepEqual([...page.document.querySelectorAll('#pickingDialog thead th')].map(th => th.textContent), ['Mã hàng', 'Tên hàng', 'Cần nhặt', 'ST', 'Tồn kho', 'Vị trí kho']);
  assert.equal(page.document.querySelectorAll('#pickingRows tr').length, 1, 'dòng VAT bị bỏ');
  assert.equal(text(page, 'pickingTitle'), 'DH1 · Hà Nội');
  // gợi ý: 100 = 2 thùng x 50 tại A07
  const selected = [...page.document.querySelectorAll('.picking-loc.selected')];
  assert.equal(selected.length, 1);
  assert.match(selected[0].textContent, /A07/);
  assert.equal(selected[0].querySelector('[data-qty]').value, '100');
  assert.equal(page.document.querySelector('.picking-st').dataset.st, '2', 'ST = 2 thùng');
  assert.equal(text(page, 'pickingProgress'), '1/1 mã hàng đã phân bổ đủ');
  assert.equal(page.document.getElementById('pickingConfirm').disabled, false);
  assert.equal(text(page, 'pickingOrderStatus'), 'Chưa chỉ định');
  assert.equal(page.document.getElementById('pickingConfirmPick').hidden, true);
  page.dom.window.close();
});

test('validate: SL phân bổ thiếu thì khóa Xác nhận; bấm − / + theo bước thùng; không vượt tồn khả dụng', async () => {
  const page = await renderPage();
  await openPopup(page);
  const { document } = page;
  const confirmBtn = document.getElementById('pickingConfirm');
  const minus = document.querySelector('[data-step="-1"][data-qloc="11"]');
  minus.click();
  assert.equal(document.querySelector('[data-qty][data-qloc="11"]').value, '50', 'trừ đúng một thùng (50)');
  assert.equal(confirmBtn.disabled, true, 'đã phân bổ 50/100');
  assert.equal(document.querySelector('.picking-need small').dataset.allocated, '50');
  // nhập tay quá tồn khả dụng của vị trí B02 (50): bị chặn về 50
  const typed = document.querySelector('[data-qty][data-qloc="12"]');
  typed.value = '999';
  typed.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  assert.equal(document.querySelector('[data-qty][data-qloc="12"]').value, '50');
  assert.equal(confirmBtn.disabled, false, '50 (A07) + 50 (B02) = 100');
  // bấm "Gợi ý lại" khôi phục gợi ý ban đầu
  await click(page, 'pickingSuggest');
  assert.equal(document.querySelector('[data-qty][data-qloc="11"]').value, '100');
  page.dom.window.close();
});

test('vị trí ghi chú sai định dạng (không có SL) bị khóa và hiện nhãn cảnh báo', async () => {
  const store = newStore({ candidates: { a: [position(11, 'A07', '4T x 50', 200), position(13, 'C01', 'abc', null, { onHand: null, available: null, warnings: ['unreadable'] })] } });
  const page = await renderPage({ store });
  await openPopup(page);
  const button = page.document.querySelector('[data-location="13"]');
  assert.equal(button.disabled, true);
  assert.match(button.textContent, /Ghi chú sai định dạng/);
  page.dom.window.close();
});

test('Xác nhận & In: POST đúng phân bổ, đóng popup, mở phiếu in có vị trí/ST và chip Đã chỉ định · Đang nhặt', async () => {
  const page = await renderPage();
  await openPopup(page);
  await click(page, 'pickingConfirm');
  assert.deepEqual(page.store.posted, [{ branch: 'HN', orderCode: 'DH1', allocations: [{ productCode: 'A', positionId: 11, qty: 100 }] }]);
  assert.equal(page.document.getElementById('pickingDialog').hasAttribute('open'), false, 'popup đóng');
  const print = page.document.getElementById('pickingPrintDialog');
  assert.equal(print.hasAttribute('open'), true, 'phiếu nhặt mở');
  const sheet = page.document.getElementById('pickingPrintSheet').textContent;
  assert.match(sheet, /DH1/);
  assert.match(sheet, /KH A/);
  assert.match(sheet, /Sale A - 123456/, 'tên sale kèm ID Telegram');
  assert.match(sheet, /A07/);
  assert.match(sheet, /2Tx50/);
  assert.equal(page.document.querySelector('#pickingPrintSheet td.invoice-actual').textContent.trim(), '', 'Thực tế nhặt để trống');
  assert.match(page.document.querySelector('#lcDetailKiot .picking-confirmed').textContent, /Đã chỉ định · Đang nhặt/);
  // dòng đơn trên danh sách có nhãn trạng thái ngay trong ô mã đơn (không thêm cột)
  assert.equal(rowsOf(page.document)[0].querySelector('.lc-pick-chip').dataset.pickStatus, 'picking');
  // đơn đã có chỉ định (đang nhặt): bảng hàng hóa có thêm cột ST = 2
  const heads = [...page.document.querySelectorAll('#lcDetailKiot table.lc-lines thead th')].map(th => th.textContent);
  assert.equal(heads.length, 10);
  assert.match(heads[3], /^ST/, 'cột ST ngay sau SL đặt');
  assert.equal(page.document.querySelector('#lcDetailKiot td.lc-st').dataset.st, '2');
  page.dom.window.close();
});

test('bảng hàng hóa mặc định giữ 9 cột (không ST) khi đơn chưa có chỉ định hoặc đã Hủy nhặt', async () => {
  const page = await renderPage();
  await openDetail(page);
  assert.equal(page.document.querySelectorAll('#lcDetailKiot table.lc-lines thead th').length, 9);
  assert.equal(page.document.querySelector('#lcDetailKiot td.lc-st'), null);

  const cancelled = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'cancelled' })], store: newStore({ assignment: makeAssignment('cancelled') }) });
  await openDetail(cancelled);
  assert.equal(cancelled.document.querySelectorAll('#lcDetailKiot table.lc-lines thead th').length, 9);
  [page, cancelled].forEach(p => p.dom.window.close());
});

test('nút theo trạng thái: Đang nhặt = Xác nhận nhặt / Hủy nhặt / In đơn; Xác nhận nhặt = Hủy nhặt / Chỉ định lại / In đơn; Hủy nhặt = Chỉ định lại', async () => {
  const expectations = {
    picking: { confirmPick: true, cancelPick: true, reopen: false, reprint: true },
    confirmed: { confirmPick: false, cancelPick: true, reopen: true, reprint: true },
    cancelled: { confirmPick: false, cancelPick: false, reopen: true, reprint: false }
  };
  for (const [status, want] of Object.entries(expectations)) {
    const page = await renderPage({ orders: [orderRow('DH1', { pickStatus: status })], store: newStore({ assignment: makeAssignment(status) }) });
    await openPopup(page);
    assert.equal(text(page, 'pickingOrderStatus'), { picking: 'Đang nhặt', confirmed: 'Xác nhận nhặt', cancelled: 'Hủy nhặt' }[status]);
    assert.deepEqual(
      { confirmPick: visible(page, 'pickingConfirmPick'), cancelPick: visible(page, 'pickingCancelPick'), reopen: visible(page, 'pickingReopen'), reprint: visible(page, 'pickingReprint') },
      want, status);
    // đã có chỉ định: khóa chỉnh sửa
    assert.equal(page.document.getElementById('pickingConfirm').disabled, true);
    assert.equal(page.document.getElementById('pickingSuggest').disabled, true);
    assert.ok([...page.document.querySelectorAll('[data-qty],[data-step],[data-location]')].every(el => el.disabled));
    assert.equal(page.document.querySelector('[data-qty][data-qloc="11"]').value, '100', 'hiện lại đúng phân bổ đã chỉ định');
    page.dom.window.close();
  }
});

test('Xác nhận nhặt và Hủy nhặt gọi đúng API kèm version, cập nhật chip, nhãn danh sách và cột ST', async () => {
  const store = newStore({ assignment: makeAssignment('picking') });
  const page = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'picking' })], store });
  await openPopup(page);
  await click(page, 'pickingConfirmPick');
  assert.deepEqual(store.statusCalls, [{ id: '7', action: 'confirm', body: { version: 1 } }]);
  assert.equal(text(page, 'pickingOrderStatus'), 'Xác nhận nhặt');
  assert.match(page.document.querySelector('#lcDetailKiot .picking-confirmed').textContent, /Xác nhận nhặt/);
  assert.equal(rowsOf(page.document)[0].querySelector('.lc-pick-chip').dataset.pickStatus, 'confirmed');
  await click(page, 'pickingCancelPick');
  assert.deepEqual(store.statusCalls[1], { id: '7', action: 'cancel', body: { version: 2 } }, 'version mới sau lần xác nhận');
  assert.equal(text(page, 'pickingOrderStatus'), 'Hủy nhặt');
  assert.equal(rowsOf(page.document)[0].querySelector('.lc-pick-chip').dataset.pickStatus, 'cancelled');
  assert.equal(page.document.querySelectorAll('#lcDetailKiot table.lc-lines thead th').length, 9, 'Hủy nhặt: bỏ cột ST');
  page.dom.window.close();
});

test('Chỉ định lại: sau Hủy nhặt vào chế độ chọn mới; sau Xác nhận nhặt phải bấm hai lần (hoàn tác nhặt rồi chỉ định lại)', async () => {
  const cancelled = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'cancelled' })], store: newStore({ assignment: makeAssignment('cancelled') }) });
  await openPopup(cancelled);
  await click(cancelled, 'pickingReopen');
  assert.equal(cancelled.store.statusCalls.length, 0, 'đã hủy sẵn: không gọi hủy lần nữa');
  assert.equal(cancelled.document.getElementById('pickingConfirm').disabled, false, 'chọn lại được');
  assert.equal(text(cancelled, 'pickingOrderStatus'), 'Chưa chỉ định');

  const store = newStore({ assignment: makeAssignment('confirmed') });
  const confirmed = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'confirmed' })], store });
  await openPopup(confirmed);
  await click(confirmed, 'pickingReopen');
  assert.match(text(confirmed, 'pickingReopen'), /Bấm lại để hoàn tác nhặt/);
  assert.equal(store.statusCalls.length, 0, 'bấm lần đầu chỉ chờ xác nhận');
  await click(confirmed, 'pickingReopen');
  assert.deepEqual(store.statusCalls, [{ id: '7', action: 'cancel', body: { version: 1 } }]);
  assert.equal(text(confirmed, 'pickingOrderStatus'), 'Chưa chỉ định');
  assert.equal(confirmed.document.getElementById('pickingConfirm').disabled, false);
  await click(confirmed, 'pickingConfirm');
  assert.equal(store.posted.length, 1, 'chỉ định mới được gửi');
  [cancelled, confirmed].forEach(p => p.dom.window.close());
});

test('lỗi 409 hiện thông báo trong popup và tải lại dữ liệu (không đóng popup, không đổi trạng thái)', async () => {
  const store = newStore({ postError: { status: 409, body: { error: 'Vị trí A07 không đủ hàng khả dụng.', code: 'INSUFFICIENT_AVAILABLE' } } });
  const page = await renderPage({ store });
  await openPopup(page);
  const before = store.candidateCalls;
  await click(page, 'pickingConfirm');
  assert.match(text(page, 'pickingStatus'), /không đủ hàng khả dụng/);
  assert.match(text(page, 'pickingStatus'), /Đã tải lại/);
  assert.equal(page.document.getElementById('pickingStatus').dataset.error, 'true');
  assert.equal(store.candidateCalls, before + 1, 'tải lại candidates');
  assert.equal(page.document.getElementById('pickingDialog').hasAttribute('open'), true);
  assert.equal(page.document.getElementById('pickingPrintDialog').hasAttribute('open'), false);

  const picking = newStore({ assignment: makeAssignment('picking'), statusError: { status: 409, body: { error: 'Chỉ định đã bị đổi.', code: 'VERSION_CONFLICT' } } });
  const conflict = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'picking' })], store: picking });
  await openPopup(conflict);
  await click(conflict, 'pickingConfirmPick');
  assert.match(text(conflict, 'pickingStatus'), /Chỉ định đã bị đổi/);
  assert.equal(text(conflict, 'pickingOrderStatus'), 'Đang nhặt');
  [page, conflict].forEach(p => p.dom.window.close());
});

test('đơn không còn đủ điều kiện (eligible=false) và chưa chỉ định: popup chỉ báo, khóa chọn', async () => {
  const store = newStore();
  store.order.eligible = false;
  const page = await renderPage({ store });
  await openPopup(page);
  assert.match(text(page, 'pickingSource'), /Đã gửi kế toán/);
  assert.equal(page.document.getElementById('pickingConfirm').disabled, true);
  assert.equal(page.document.getElementById('pickingSuggest').disabled, true);
  page.dom.window.close();
});

test('danh sách: nhãn chỉ định trong ô mã đơn không thêm cột; ô lọc chỉ định gửi pickStatus và có đủ 4 lựa chọn', async () => {
  const page = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'picking' }), orderRow('DH2')] });
  const { document, window } = page;
  assert.equal(document.querySelectorAll('#bulkHeadRow th').length, 13, 'giữ nguyên 13 cột');
  const rows = rowsOf(document);
  assert.equal(rows[0].querySelector('.lc-pick-chip').textContent, 'Đang nhặt');
  assert.equal(rows[1].querySelector('.lc-pick-chip'), null);
  assert.deepEqual([...document.getElementById('bulkPickStatusFilter').options].map(o => o.value), ['', 'picking', 'confirmed', 'cancelled']);
  const select = document.getElementById('bulkPickStatusFilter');
  select.value = 'confirmed';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  const lastList = page.calls.filter(c => isListUrl(c.url)).at(-1).url;
  assert.equal(new URL(lastList, 'https://tokosi.example').searchParams.get('pickStatus'), 'confirmed');
  select.value = '';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(new URL(page.calls.filter(c => isListUrl(c.url)).at(-1).url, 'https://tokosi.example').searchParams.has('pickStatus'), false);
  page.dom.window.close();
});

test('làm mới danh sách: pickStatus đổi thì dòng vẽ lại nhãn (có trong chữ ký dòng)', async () => {
  const page = await renderPage({ orders: [orderRow('DH1')] });
  assert.equal(rowsOf(page.document)[0].querySelector('.lc-pick-chip'), null);
  page.source.orders = [orderRow('DH1', { pickStatus: 'confirmed' })];
  page.window.eval('loadBulkOrders(true)');
  await settle();
  assert.equal(rowsOf(page.document)[0].querySelector('.lc-pick-chip').dataset.pickStatus, 'confirmed');
  page.dom.window.close();
});

test('Esc khi popup mở chỉ đóng popup, hộp chi tiết đơn bên dưới vẫn mở', async () => {
  const page = await renderPage();
  await openPopup(page);
  page.document.dispatchEvent(new page.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(page.document.getElementById('lcDetailOverlay').hidden, false, 'hộp chi tiết còn mở');
  page.dom.window.close();
});

test('in lại (In đơn) mở phiếu từ bản ghi chỉ định; Hủy nhặt thì phiếu không in ST', async () => {
  const page = await renderPage({ orders: [orderRow('DH1', { pickStatus: 'confirmed' })], store: newStore({ assignment: makeAssignment('confirmed') }) });
  await openPopup(page);
  await click(page, 'pickingReprint');
  assert.equal(page.document.getElementById('pickingPrintDialog').hasAttribute('open'), true);
  assert.match(page.document.getElementById('pickingPrintTitle').textContent, /PHIẾU ĐẶT HÀNG · DH1/);
  assert.match(page.document.getElementById('pickingPrintSheet').textContent, /2Tx50/);
  // phiếu của đơn đã hủy: không còn ST
  await page.window.PickingInvoice.show({ ...makeAssignment('cancelled').snapshot, orderCode: 'DH1', branch: 'HN' }, makeAssignment('cancelled'));
  assert.doesNotMatch(page.document.getElementById('pickingPrintSheet').textContent, /2Tx50/);
  page.dom.window.close();
});

test('lỗi tải ban đầu hết bận, cho tải lại mà không gửi lệnh ghi', async () => {
  let offline = true;
  const page = await renderPage({ fetchImpl: async url => {
    if (url.includes('/pick/candidates') && offline) throw new TypeError('offline');
  } });
  await openPopup(page);
  assert.equal(page.window.TKSPick._state.busy, false);
  assert.equal(page.window.TKSPick._state.needsSync, true);
  assert.equal(page.document.getElementById('pickingConfirm').disabled, true);
  assert.equal(page.document.getElementById('pickingReload').hidden, false);
  offline = false;
  await click(page, 'pickingReload');
  assert.equal(page.window.TKSPick._state.needsSync, false);
  assert.equal(page.document.getElementById('pickingConfirm').disabled, false);
  assert.equal(page.store.posted.length, 0);
  page.dom.window.close();
});

test('mất phản hồi sau confirm đồng bộ bản đã commit, không gửi POST lần hai', async () => {
  const store = newStore({ assignment: makeAssignment('picking') });
  let writes = 0;
  const page = await renderPage({ store, fetchImpl: async (url, options) => {
    if (url.endsWith('/7/confirm') && options.method === 'POST') {
      writes++;
      store.assignment = makeAssignment('confirmed', { version: 2 });
      throw new TypeError('lost response');
    }
  } });
  await openPopup(page);
  await click(page, 'pickingConfirmPick');
  assert.equal(page.window.TKSPick._state.busy, false);
  assert.equal(page.window.TKSPick._state.needsSync, false);
  assert.equal(page.window.TKSPick._state.assignment.version, 2);
  assert.equal(text(page, 'pickingOrderStatus'), 'Xác nhận nhặt');
  assert.equal(writes, 1);
  page.dom.window.close();
});

test('POST reject và đọc lại lỗi: khóa ghi, vẫn đóng/tải lại được', async () => {
  let offline = false, writes = 0;
  const page = await renderPage({ fetchImpl: async (url, options) => {
    if (url === '/api/shipment/pick' && options.method === 'POST') {
      offline = true; writes++; throw new TypeError('offline');
    }
    if (url.includes('/pick/candidates') && offline) throw new TypeError('offline');
  } });
  await openPopup(page);
  await click(page, 'pickingConfirm');
  assert.equal(page.window.TKSPick._state.busy, false);
  assert.equal(page.window.TKSPick._state.needsSync, true);
  assert.equal(page.document.getElementById('pickingConfirm').disabled, true);
  assert.equal(page.document.getElementById('pickingReload').disabled, false);
  await click(page, 'pickingConfirm');
  assert.equal(writes, 1);
  offline = false;
  await click(page, 'pickingReload');
  assert.equal(page.window.TKSPick._state.needsSync, false);
  await click(page, 'pickingClose');
  assert.equal(page.document.getElementById('pickingDialog').open, false);
  page.dom.window.close();
});

test('JSON hỏng sau ghi được coi là kết quả chưa rõ và tải lại', async () => {
  const store = newStore();
  const page = await renderPage({ store, fetchImpl: async (url, options) => {
    if (url === '/api/shipment/pick' && options.method === 'POST') {
      store.assignment = makeAssignment('picking');
      return { ok:true, status:201, json:async () => { throw new SyntaxError('invalid JSON'); } };
    }
  } });
  await openPopup(page);
  await click(page, 'pickingConfirm');
  assert.equal(page.window.TKSPick._state.busy, false);
  assert.equal(page.window.TKSPick._state.assignment.id, 7);
  assert.equal(page.window.TKSPick._state.needsSync, false);
  assert.equal(page.document.getElementById('pickingDialog').open, true);
  page.dom.window.close();
});

test('đổi đơn khi GET đang chờ không bị phản hồi cũ ghi đè', async () => {
  let finishOld;
  const page = await renderPage({ fetchImpl: async url => {
    if (url.includes('/pick/candidates') && new URL(url, 'https://test').searchParams.get('order') === 'OLD') {
      return await new Promise(resolve => { finishOld = resolve; });
    }
  } });
  const old = page.window.TKSPick.open({ branch:'HN', orderCode:'OLD' });
  await settle();
  await page.window.TKSPick.open({ branch:'HN', orderCode:'DH1' });
  finishOld(json({ order:{ ...page.store.order, orderCode:'OLD' }, candidates:{}, assignment:null }));
  await old;
  assert.equal(page.window.TKSPick._state.order.orderCode, 'DH1');
  assert.match(text(page, 'pickingTitle'), /DH1/);
  assert.equal(page.window.TKSPick._state.busy, false);
  page.dom.window.close();
});

test('số chiếc nhập tay không được lẻ; lỗi nguồn hiện rõ, vẫn cho hủy bản cũ', async () => {
  const page = await renderPage();
  await openPopup(page);
  const input = page.document.querySelector('[data-qty]');
  assert.equal(input.getAttribute('step'), '1');
  input.value = '0.4';
  input.dispatchEvent(new page.window.Event('change', { bubbles:true }));
  assert.match(text(page, 'pickingStatus'), /số nguyên/i);
  assert.equal(page.window.TKSPick._state.allocations[0][0].quantity, 100);
  const store = newStore({ assignment:makeAssignment('picking') });
  store.order.eligible = false;
  store.order.validationErrors = ['A: số lượng phải là số nguyên dương'];
  const legacy = await renderPage({ store });
  await openPopup(legacy);
  assert.match(text(legacy, 'pickingSource'), /số nguyên/);
  assert.equal(legacy.document.getElementById('pickingCancelPick').disabled, false);
  [page, legacy].forEach(p => p.dom.window.close());
});

test('chỉ định lại bị mất phản hồi hủy: tải trạng thái, không tự tạo chỉ định mới', async () => {
  const store = newStore({ assignment:makeAssignment('confirmed') });
  let cancels=0;
  const page=await renderPage({ store, fetchImpl:async (url,options) => {
    if(url.endsWith('/7/cancel')&&options.method==='POST'){
      cancels++;
      store.assignment=makeAssignment('cancelled',{version:2});
      throw new TypeError('lost cancel response');
    }
  } });
  await openPopup(page);
  await click(page,'pickingReopen');
  await click(page,'pickingReopen');
  assert.equal(cancels,1);
  assert.equal(store.posted.length,0);
  assert.equal(page.window.TKSPick._state.assignment.status,'cancelled');
  assert.equal(page.window.TKSPick._state.busy,false);
  assert.equal(page.window.TKSPick._state.needsSync,false);
  assert.equal(page.document.getElementById('pickingConfirm').disabled,true);
  page.dom.window.close();
});

test('đóng popup khi POST đang chờ không cho phản hồi cũ ghi đè lần mở mới', async () => {
  let finishPost;
  const page=await renderPage({ fetchImpl:async (url,options) => {
    if(url==='/api/shipment/pick'&&options.method==='POST')return await new Promise(resolve=>{finishPost=resolve;});
  } });
  await openPopup(page);
  await click(page,'pickingConfirm');
  assert.equal(page.window.TKSPick._state.busy,true);
  await click(page,'pickingClose');
  await page.window.TKSPick.open({branch:'HN',orderCode:'DH1'});
  finishPost(json({assignment:makeAssignment('picking')}));
  await settle();
  assert.equal(page.window.TKSPick._state.assignment,null);
  assert.equal(page.window.TKSPick._state.busy,false);
  assert.equal(page.document.getElementById('pickingDialog').open,true);
  assert.equal(page.document.getElementById('pickingPrintDialog').open,false);
  page.dom.window.close();
});
