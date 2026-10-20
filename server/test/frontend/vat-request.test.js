'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(publicDir, 'vat-request/index.html'), 'utf8');
const code = fs.readFileSync(path.join(publicDir, 'vat-request/vat-request.js'), 'utf8');
const nav = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const PROCESS_GRANTED = { 'accounting.vatRequestProcess': true };

const STATUSES = [
  { value: 'pending', label: 'Chờ KT xử lý', locksSale: false },
  { value: '0', label: '0. Không khai được', locksSale: true },
  { value: '1', label: '1. Đã xong', locksSale: true },
  { value: '2', label: '2. Đã khai chờ về', locksSale: true },
  { value: '3', label: '3. Chờ khai chèn', locksSale: false },
  { value: '4', label: '4. Chờ cont về, tăng slg', locksSale: false }
];

function row(id, extra = {}) {
  return {
    id, createdAt: '2026-10-19T03:00:00Z', createdBy: 'sale-1', createdByName: 'Khánh Thịnh', isLegacy: false,
    customerName: 'KH A', customerCode: null, productCode: '014XOAN', productKey: '014xoan', productName: 'Bát inox',
    quantity: 400, unitPrice: 11400, totalAmount: 4560000, fullVat: true, saleNote: '', status: 'pending', statusLabel: 'Chờ KT xử lý',
    accountantNote: '', arrivalDate: null, version: 1, isLockedForSale: false, isMine: true, canEditSale: true, canProcess: false, canDelete: true,
    ...extra
  };
}

function listResponse(rows) {
  return {
    rows, truncated: false, statuses: STATUSES, sales: [{ id: 'sale-1', name: 'Khánh Thịnh' }],
    metrics: { '014xoan': { vatStock: { total: 1500, byCompany: [{ company: 'TKS THẤP', vatCode: 'VAT1', stock: 1200 }, { company: 'VC', vatCode: 'VAT1', stock: 300 }] }, pendingInsertQty: 200, incomingQty: 150, nearestArrivalDate: '2026-10-28', nearestArrivalText: 'DK 28/10' } },
    stockStatus: { available: true, stale: false, loadedAt: '2026-10-20T02:00:00Z' }
  };
}

async function setup(t, { vaiTro, id = 'sale-1', responses, featurePermissions = {} }) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/vat-request/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/table-controls.js'), 'utf8'));
  window.eval(nav);
  const user = { id, vaiTro, branch: 'Cả hai', permissions: resolvePermissions({ vaiTro, featurePermissions }), pageFeatures: PAGE_FEATURES };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(url, window.location.href);
    const key = `${options.method || 'GET'} ${parsed.pathname.replace('/api/vat-requests', '') || '/'}`;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ key, query: Object.fromEntries(parsed.searchParams), body });
    const handler = responses[key];
    const result = typeof handler === 'function' ? handler(body) : { status: 200, data: handler };
    return { ok: result.status < 400, status: result.status, json: async () => result.data };
  };
  window.eval(code);
  await window.TKSVatRequest.init();
  await tick();
  return { window, doc: window.document, calls };
}

test('sale: mac dinh loc yeu cau cua minh, khong co cot chon / sua nhanh, dong khoa khong co nut Sua', async t => {
  const rows = [row(1), row(2, { status: '1', statusLabel: '1. Đã xong', isLockedForSale: true, canEditSale: false, canDelete: false }),
    row(3, { createdBy: 'sale-2', createdByName: 'Tuyên', isMine: false, canEditSale: false, canDelete: false })];
  const { doc, calls } = await setup(t, { vaiTro: 'Nhân viên sale', responses: { 'GET /': listResponse(rows) } });
  assert.equal(calls[0].query.createdBy, 'sale-1');
  assert.equal(calls[0].query.status, undefined);
  assert.equal(doc.querySelector('[data-column-key="select"]'), null);
  assert.equal(doc.querySelector('[data-inline]'), null);
  assert.equal(doc.getElementById('vrGroupToggleWrap').hidden, true);
  const editable = [...doc.querySelectorAll('[data-action="edit"]')].map(b => Number(b.dataset.id));
  assert.deepEqual(editable, [1]);
  assert.ok(doc.querySelector('tr[data-id="2"] .vr-lock'));
  assert.match(doc.querySelector('tr[data-id="1"] [data-field="total"]').textContent, /4,560,000/);
  assert.match(doc.querySelector('tr[data-id="1"] [data-field="nearestArrival"]').textContent, /28\/10\/2026/);
  assert.ok(doc.querySelector('#sidebar a[href="/vat-request/"]'), 'menu Ke toan co Yeu cau xuat VAT');
});

test('sale tao yeu cau: gui dung payload (so co dau phay, Full VAT, ma khach tu goi y)', async t => {
  const responses = {
    'GET /': listResponse([]),
    'GET /customer-suggest': { results: [{ code: 'KH001', name: 'KH A Thắng' }] },
    'GET /product-suggest': { results: [{ code: '014XOAN', name: 'Bát inox' }] },
    'GET /metrics': { productCode: '014XOAN', productName: 'Bát inox', vatStock: { total: 1500, byCompany: [] }, pendingInsertQty: 0, incomingQty: 150, nearestArrivalDate: null, nearestArrivalText: '' },
    'POST /': body => ({ status: 201, data: row(9, body) })
  };
  const { window, doc, calls } = await setup(t, { vaiTro: 'Nhân viên sale', responses });
  doc.getElementById('vrCreate').click();
  const set = (id, value) => { const el = doc.getElementById(id); el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };
  set('vrProduct', '014XOAN');
  doc.getElementById('vrProduct').dispatchEvent(new window.Event('change', { bubbles: true }));
  set('vrCustomer', 'KH A Thắng');
  await new Promise(resolve => setTimeout(resolve, 350));
  set('vrQuantity', '1,200');
  set('vrPrice', '11400');
  doc.getElementById('vrFullVat').value = 'true';
  await tick();
  assert.match(doc.getElementById('vrProductInfo').textContent, /Tồn VAT: 1,500/);
  assert.equal(doc.getElementById('vrTotal').textContent, '13,680,000 ₫');
  doc.getElementById('vrForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  const post = calls.find(c => c.key === 'POST /');
  assert.deepEqual(post.body, { productCode: '014XOAN', customerName: 'KH A Thắng', customerCode: 'KH001', quantity: 1200, unitPrice: 11400, fullVat: true, saleNote: '' });
});

test('sale nhap sai so luong -> bao loi, khong goi API', async t => {
  const { window, doc, calls } = await setup(t, { vaiTro: 'Nhân viên sale', responses: { 'GET /': listResponse([]) } });
  doc.getElementById('vrCreate').click();
  doc.getElementById('vrProduct').value = '014XOAN';
  doc.getElementById('vrCustomer').value = 'KH';
  doc.getElementById('vrQuantity').value = '1.5';
  doc.getElementById('vrPrice').value = '100';
  doc.getElementById('vrForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await tick();
  assert.match(doc.getElementById('vrFormError').textContent, /số nguyên/);
  assert.equal(calls.some(c => c.key === 'POST /'), false);
});

test('gia order VAT gan nhat chi dien khi bam goi y; khi sua giu gia hien tai', async t => {
  const responses = {
    'GET /': listResponse([row(1, { unitPrice: 13000 })]),
    'GET /1/history': { rows: [] },
    'GET /metrics': { productName: 'Bát inox', vatStock: null, pendingInsertQty: 0, incomingQty: 0 },
    'GET /price-suggest': { latestOrder: { price: 12500, customerName: 'Khách cũ', createdAt: '2026-10-20T02:00:00Z' } }
  };
  const { window, doc } = await setup(t, { vaiTro: 'Nhân viên sale', responses });
  doc.getElementById('vrCreate').click();
  const product = doc.getElementById('vrProduct');
  product.value = '014XOAN';
  product.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('vrPrice').value, '');
  assert.match(doc.getElementById('vrPriceSuggestion').textContent, /12,500/);
  doc.getElementById('vrPriceSuggestion').querySelector('button').click();
  assert.equal(doc.getElementById('vrPrice').value, '12,500');
  product.value = '26DAQUAN';
  product.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(doc.getElementById('vrPriceSuggestion').textContent, '', 'doi ma phai xoa goi y cua ma truoc');
  doc.getElementById('vrFormCancel').click();

  doc.querySelector('tr[data-id="1"] [data-field="customer"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('vrPrice').value, '13,000');
  assert.match(doc.getElementById('vrPriceSuggestion').textContent, /12,500/);
});

test('Ke toan chua duoc cap quyen: chi xem, khong co sua nhanh / chon lo / gom theo ma', async t => {
  const { doc, calls } = await setup(t, { vaiTro: 'Kế toán', id: 'kt-2', responses: { 'GET /': listResponse([row(1, { isMine: false, canEditSale: false })]) } });
  assert.equal(calls[0].query.status, undefined);
  assert.equal(doc.querySelector('[data-column-key="select"]'), null);
  assert.equal(doc.querySelector('[data-inline]'), null);
  assert.equal(doc.getElementById('vrGroupToggleWrap').hidden, true);
  assert.equal(doc.getElementById('vrBulk').hidden, true);
  assert.ok(doc.getElementById('vrCreate'));
});

test('KT: mac dinh loc Can xu ly, doi trang thai tren dong gui version; 409 hien canh bao va thay dong moi nhat', async t => {
  let conflict = false;
  const responses = {
    'GET /': listResponse([row(1, { canProcess: true, isMine: false }), row(2, { canProcess: true, isMine: false })]),
    'PATCH /1': body => conflict
      ? { status: 409, data: { error: 'Yêu cầu vừa được người khác cập nhật.', code: 'VERSION_CONFLICT', latest: row(1, { status: '3', statusLabel: '3. Chờ khai chèn', version: 5, canProcess: true }) } }
      : { status: 200, data: row(1, { ...body, version: 2, canProcess: true }) }
  };
  const { window, doc, calls } = await setup(t, { vaiTro: 'Kế toán', id: 'kt-1', responses, featurePermissions: PROCESS_GRANTED });
  assert.equal(calls[0].query.status, 'pending,3,4');
  assert.equal(calls[0].query.createdBy, undefined);
  assert.ok(doc.querySelector('[data-column-key="select"]'));
  assert.equal(doc.getElementById('vrGroupToggleWrap').hidden, false);

  const note = doc.querySelector('[data-inline="accountantNote"][data-id="1"]');
  note.value = 'CONT 10-6V';
  note.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  const patch = calls.find(c => c.key === 'PATCH /1');
  assert.deepEqual(patch.body, { version: 1, accountantNote: 'CONT 10-6V' });
  assert.equal(doc.querySelector('[data-inline="accountantNote"][data-id="1"]').value, 'CONT 10-6V');

  conflict = true;
  const select = doc.querySelector('[data-inline="status"][data-id="1"]');
  select.value = '1';
  select.dispatchEvent(new window.Event('change', { bubbles: true }));
  await tick();
  assert.equal(doc.getElementById('vrStatus').dataset.kind, 'warn');
  assert.equal(doc.querySelector('[data-inline="status"][data-id="1"]').value, '3');
});

test('KT chon nhieu dong roi doi trang thai + ghi ten cont hang loat', async t => {
  const responses = {
    'GET /': listResponse([row(1, { canProcess: true }), row(2, { canProcess: true, version: 4 })]),
    'PATCH /bulk': () => ({ status: 200, data: { updated: 2 } })
  };
  const { window, doc, calls } = await setup(t, { vaiTro: 'Kế toán', id: 'kt-1', responses, featurePermissions: PROCESS_GRANTED });
  assert.equal(doc.getElementById('vrBulk').hidden, true);
  for (const id of [1, 2]) {
    const box = doc.querySelector(`[data-select="${id}"]`);
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
  }
  assert.equal(doc.getElementById('vrBulk').hidden, false);
  assert.match(doc.getElementById('vrBulkCount').textContent, /2 dòng/);
  doc.getElementById('vrBulkStatus').value = '2';
  doc.getElementById('vrBulkNote').value = 'CONT 10-7G';
  doc.getElementById('vrBulkApply').click();
  await tick();
  const bulk = calls.find(c => c.key === 'PATCH /bulk');
  assert.deepEqual(bulk.body, { items: [{ id: 1, version: 1 }, { id: 2, version: 4 }], changes: { status: '2', accountantNote: 'CONT 10-7G' } });
});

test('gom theo ma SP: dong tieu de nhom hien ton VAT / can khai / dang ve', async t => {
  const responses = { 'GET /': listResponse([row(1, { canProcess: true }), row(2, { canProcess: true, productCode: '26DAQUAN', productKey: '26daquan', productName: 'Đồng hồ' }), row(3, { canProcess: true })]) };
  const { window, doc } = await setup(t, { vaiTro: 'Kế toán', id: 'kt-1', responses, featurePermissions: PROCESS_GRANTED });
  const toggle = doc.getElementById('vrGroupToggle');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  const groups = [...doc.querySelectorAll('.vr-group-row')].map(r => r.textContent);
  assert.equal(groups.length, 2);
  assert.match(groups[0], /014XOAN.*2 yêu cầu · Tồn VAT 1,500 · Cần khai 200 · Đang về 150 · Gần nhất 28\/10\/2026/);
  assert.deepEqual([...doc.querySelectorAll('#vrRows tr[data-id]')].map(r => Number(r.dataset.id)), [1, 3, 2]);
});

const HISTORY = { rows: [
  { id: 2, changedAt: '2026-10-20T03:07:00Z', changedBy: 'kt-1', changedByName: 'Kế toán Lan', action: 'update', field: 'status', oldValue: 'pending', newValue: '1' },
  { id: 1, changedAt: '2026-10-20T03:06:00Z', changedBy: 'sale-1', changedByName: 'Khánh Thịnh', action: 'create', field: null, oldValue: null, newValue: null }
] };

function lockedRow(id) {
  return row(id, { status: '1', statusLabel: '1. Đã xong', isLockedForSale: true, canEditSale: false, canDelete: false });
}

test('nhay dup dong sua duoc: modal sua gon, nut Lich su (co so dem) mo khung chat noi, form khong doi; dong da khoa: chi lich su', async t => {
  const responses = { 'GET /': listResponse([row(1), lockedRow(2)]), 'GET /1/history': HISTORY, 'GET /2/history': HISTORY, 'GET /metrics': { productName: 'Bát inox', vatStock: null, pendingInsertQty: 0, incomingQty: 0 } };
  const { window, doc } = await setup(t, { vaiTro: 'Nhân viên sale', responses });
  const dialog = doc.getElementById('vrFormDialog');
  const chat = doc.getElementById('vrChat');
  doc.querySelector('tr[data-id="1"] [data-field="customer"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await tick();
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(dialog.dataset.mode, 'edit');
  assert.equal(doc.getElementById('vrFormTitle').textContent, 'Sửa yêu cầu #1');
  assert.match(doc.getElementById('vrFormSub').textContent, /014XOAN · KH A/);
  assert.equal(doc.getElementById('vrFormBody').hidden, false);
  assert.equal(doc.getElementById('vrFormDelete').hidden, false);
  assert.equal(doc.getElementById('vrHistoryToggle').hidden, false);
  assert.equal(chat.hidden, true, 'lich su mac dinh thu gon');
  assert.equal(doc.getElementById('vrHistoryCount').textContent, '2');
  assert.equal(doc.getElementById('vrChatCount').textContent, '2');
  const items = [...doc.querySelectorAll('#vrHistoryList .vr-chat-item')];
  assert.deepEqual(items.map(li => li.dataset.kind), ['status', 'create']);
  assert.match(items[0].textContent, /Kế toán Lan/);
  assert.match(items[0].textContent, /Thay đổi trạng thái: Chờ KT xử lý → 1\. Đã xong/);
  assert.equal(doc.getElementById('vrProduct').value, '014XOAN');
  doc.getElementById('vrHistoryToggle').click();
  assert.equal(chat.hidden, false);
  assert.equal(dialog.dataset.historyOpen, 'true');
  assert.equal(doc.getElementById('vrHistoryToggle').getAttribute('aria-expanded'), 'true');
  assert.equal(doc.getElementById('vrFormBody').hidden, false, 'form van giu nguyen khi mo lich su');
  doc.getElementById('vrChatClose').click();
  assert.equal(chat.hidden, true);

  doc.querySelector('tr[data-id="2"] [data-field="customer"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await tick();
  assert.equal(dialog.dataset.mode, 'history');
  assert.equal(doc.getElementById('vrFormTitle').textContent, 'Lịch sử yêu cầu #2');
  assert.equal(doc.getElementById('vrFormBody').hidden, true);
  assert.equal(doc.getElementById('vrHistoryInline').hidden, false);
  assert.equal(doc.getElementById('vrHistoryToggle').hidden, true);
  assert.equal(doc.getElementById('vrFormSubmit').hidden, true);
  assert.equal(doc.getElementById('vrFormCancel').textContent, 'Đóng');
  assert.equal(doc.querySelectorAll('#vrHistoryInlineList .vr-chat-item').length, 2);
  assert.match(doc.getElementById('vrFormSub').textContent, /đã khóa/);
});

test('luu: nut co trang thai dang luu va khong gui trung khi bam 2 lan', async t => {
  let release;
  const responses = {
    'GET /': listResponse([row(1)]), 'GET /1/history': HISTORY,
    'GET /metrics': { productName: 'Bát inox', vatStock: null, pendingInsertQty: 0, incomingQty: 0 },
    'PATCH /1': body => ({ status: 200, data: row(1, { ...body, version: 2 }) })
  };
  const { window, doc, calls } = await setup(t, { vaiTro: 'Nhân viên sale', responses });
  const realFetch = window.fetch;
  window.fetch = (url, options = {}) => (options.method === 'PATCH' ? new Promise(resolve => { release = () => resolve(realFetch(url, options)); }) : realFetch(url, options));
  doc.querySelector('tr[data-id="1"] [data-field="customer"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  await tick();
  doc.getElementById('vrQuantity').value = '500';
  const submit = () => doc.getElementById('vrForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  submit();
  submit();
  const button = doc.getElementById('vrFormSubmit');
  assert.equal(button.disabled, true);
  assert.ok(button.classList.contains('is-loading'));
  assert.equal(doc.getElementById('vrFormSubmitLabel').textContent, 'Đang lưu…');
  release();
  await tick(); await tick();
  assert.equal(calls.filter(c => c.key === 'PATCH /1').length, 1);
  assert.equal(doc.getElementById('vrFormDialog').hasAttribute('open'), false);
});

test('nhay dup vao o sua nhanh cua KT khong mo hop; chuot phai hien menu, dong khoa khong co muc Sua', async t => {
  const responses = { 'GET /': listResponse([row(1, { canProcess: true, canEditSale: false, isMine: false }), lockedRow(2)]), 'GET /1/history': HISTORY, 'GET /2/history': HISTORY };
  const { window, doc } = await setup(t, { vaiTro: 'Kế toán', id: 'kt-1', responses, featurePermissions: PROCESS_GRANTED });
  doc.querySelector('[data-inline="accountantNote"][data-id="1"]').dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
  assert.equal(doc.getElementById('vrFormDialog').hasAttribute('open'), false);

  const menu = doc.getElementById('vrRowMenu');
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 });
  doc.querySelector('tr[data-id="2"] [data-field="productName"]').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(menu.hidden, false);
  assert.equal(menu.querySelector('[data-menu="edit"]').hidden, true);
  menu.querySelector('[data-menu="history"]').click();
  await tick();
  assert.equal(menu.hidden, true);
  assert.equal(doc.getElementById('vrFormDialog').dataset.mode, 'history');
});

test('chuot phai -> Sua yeu cau; xoa ngay trong hop sua gui DELETE kem version', async t => {
  let deleted = false;
  const responses = {
    'GET /': () => ({ status: 200, data: listResponse(deleted ? [] : [row(7, { version: 3 })]) }),
    'GET /7/history': HISTORY,
    'GET /metrics': { productName: 'Bát inox', vatStock: null, pendingInsertQty: 0, incomingQty: 0 },
    'DELETE /7': () => { deleted = true; return { status: 200, data: { ok: true } }; }
  };
  const { window, doc, calls } = await setup(t, { vaiTro: 'Nhân viên sale', responses });
  window.confirm = () => true;
  doc.querySelector('tr[data-id="7"] [data-field="customer"]').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
  const edit = doc.querySelector('#vrRowMenu [data-menu="edit"]');
  assert.equal(edit.hidden, false);
  edit.click();
  await tick();
  assert.equal(doc.getElementById('vrFormDialog').dataset.mode, 'edit');
  doc.getElementById('vrFormDelete').click();
  await tick();
  await tick();
  const del = calls.find(c => c.key === 'DELETE /7');
  assert.equal(del.query.version, '3');
  assert.equal(doc.getElementById('vrFormDialog').hasAttribute('open'), false);
  assert.match(doc.getElementById('vrStatus').textContent, /Đã xóa yêu cầu #7/);
});

test('o so / ma / ngay khong xuong dong giua chung; cot Thao tac chi con 1 nut', async t => {
  const { doc } = await setup(t, { vaiTro: 'Nhân viên sale', responses: { 'GET /': listResponse([row(1), lockedRow(2)]) } });
  const tr = doc.querySelector('tr[data-id="1"]');
  for (const field of ['productCode', 'quantity', 'total', 'unitPrice']) assert.ok(tr.querySelector(`[data-field="${field}"]`).classList.contains('vr-nowrap'), field);
  assert.deepEqual([...tr.querySelectorAll('[data-field="actions"] button')].map(b => b.textContent), ['Sửa']);
  assert.deepEqual([...doc.querySelectorAll('tr[data-id="2"] [data-field="actions"] button')].map(b => b.textContent), ['Lịch sử']);
  assert.equal(doc.querySelector('[data-action="delete"]'), null);
});
