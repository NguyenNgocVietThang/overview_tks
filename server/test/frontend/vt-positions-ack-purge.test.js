'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(publicDir, 'vt-positions/index.html'), 'utf8');
const code = fs.readFileSync(path.join(publicDir, 'vt-positions/vt-positions.js'), 'utf8');
const nav = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const row = (id, extra = {}) => ({ id, code: 'MA' + id, name: 'Hàng ' + id, notes: '2T x 100', arrivalDate: '', location: 'K' + id, quantity: 200, available: 200, held: 0, kiotQuantity: 350, warnings: [], rawWarnings: [], acknowledged: false, updatedByName: 'Quản lý', updatedAt: '2026-10-27T02:30:00.000Z', version: 3, ...extra });
const BAD = (id = 1) => row(id, { notes: 'rác', quantity: null, warnings: ['unreadable'], rawWarnings: ['unreadable'] });

async function setup(t, { rows = [BAD()], canDeleteHistory = true, handlers = {} } = {}) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/vt-positions/', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
  window.matchMedia = () => ({ matches: false, addEventListener() {} });
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/fuzzy-search.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/carton.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/table-controls.js'), 'utf8'));
  window.eval(nav);
  const base = resolvePermissions({ vaiTro: 'Quản lý' });
  const permissions = [...new Set([...base, 'stockLocationsV2.view', 'stockLocationsV2.edit', ...(canDeleteHistory ? ['stockLocationsV2.historyDelete'] : [])])];
  const user = { vaiTro: 'Quản lý', branch: 'Cả hai', permissions, pageFeatures: PAGE_FEATURES };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname === '/api/me/table-prefs') return json({ tables: {} });
    const method = options.method || 'GET';
    calls.push({ method, path: parsed.pathname, query: parsed.searchParams, body: options.body ? JSON.parse(options.body) : null });
    const custom = handlers[method + ' ' + parsed.pathname];
    if (custom) return custom(parsed, options);
    if (method === 'GET' && parsed.pathname === '/api/stock-positions') return json({ branch: parsed.searchParams.get('branch'), canEdit: true, canExport: true, canDeleteHistory, rows });
    if (method === 'GET' && parsed.pathname === '/api/stock-positions/history') return json({ rows: [], nextBefore: null });
    return json({ error: 'Không có mock' }, 500);
  };
  window.eval(code);
  await window.TKSVtPositions.init();
  return { window, doc: window.document, calls };
}

test('Đã sửa: dòng sai định dạng mở hộp chi tiết có nút, bấm gửi /ack rồi hiện nhãn xanh và dòng rời bộ lọc Cảnh báo', async t => {
  const acked = row(1, { notes: 'rác', quantity: null, warnings: [], rawWarnings: ['unreadable'], acknowledged: true, version: 4 });
  const { doc, calls } = await setup(t, { handlers: { 'POST /api/stock-positions/1/ack': () => json({ row: acked }) } });
  const warnOption = doc.querySelector('#vtWarnFilter option[value="warn"]');
  assert.match(warnOption.textContent, /Cảnh báo \(1\)/);
  doc.querySelector('#vtRows tr[data-id="1"]').click();
  await settle();
  const button = doc.getElementById('vtDetailAck');
  assert.ok(button, 'có nút đánh dấu');
  assert.equal(button.textContent, 'Đánh dấu Đã sửa');
  button.click();
  await settle();
  const post = calls.find(c => c.method === 'POST');
  assert.equal(post.path, '/api/stock-positions/1/ack');
  assert.deepEqual(post.body, { version: 3, acknowledged: true });
  assert.equal(doc.getElementById('vtDetailAck').textContent, 'Bỏ đánh dấu Đã sửa');
  assert.match(doc.querySelector('#vtDetailWarn .vt-badge.is-ack').textContent, /Đã sửa/);
  assert.match(warnOption.textContent, /Cảnh báo \(0\)/);
  const cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="notes"] .vt-badge');
  assert.ok(cell.classList.contains('is-ack'));
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"]').classList.contains('vt-warning'), false);
  // bấm lần nữa = bỏ đánh dấu, dùng version mới
  doc.getElementById('vtDetailAck').click();
  await settle();
  assert.deepEqual(calls.filter(c => c.method === 'POST')[1].body, { version: 4, acknowledged: false });
});

test('Đã sửa: dòng không cảnh báo không có nút; chỉ xem thì không có nút', async t => {
  const { doc } = await setup(t, { rows: [row(2)] });
  doc.querySelector('#vtRows tr[data-id="2"]').click();
  await settle();
  assert.equal(doc.getElementById('vtDetailAck'), null);
});

const openHistory = async ({ doc }) => { doc.getElementById('vtHistoryButton').click(); await settle(); };
const WARNING_TEXT = 'Bạn có chắc chắn muốn xóa? Hãy lưu dữ liệu lịch sử trước khi xóa.';

test('Xóa lịch sử: chỉ người có quyền thấy nút; hộp thoại có cảnh báo, ngày sai không gọi API, OK mới xóa rồi tải lại', async t => {
  const ui = await setup(t, { handlers: { 'DELETE /api/stock-positions/history': () => json({ deleted: 7, from: '2026-10-01', to: '2026-10-05' }) } });
  const { doc, calls, window } = ui;
  await openHistory(ui);
  const button = doc.getElementById('vtHistoryPurge');
  assert.equal(button.hidden, false);
  button.click();
  const dialog = doc.getElementById('vtPurgeDialog');
  assert.ok(dialog.hasAttribute('open'));
  assert.ok(dialog.textContent.includes(WARNING_TEXT));
  doc.getElementById('vtPurgeFrom').value = '31/02/2026';
  doc.getElementById('vtPurgeOk').click();
  await settle();
  assert.match(doc.getElementById('vtPurgeError').textContent, /dd\/mm\/yyyy/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtPurgeFrom').value = '05/10/2026';
  doc.getElementById('vtPurgeTo').value = '01/10/2026';
  doc.getElementById('vtPurgeOk').click();
  await settle();
  assert.match(doc.getElementById('vtPurgeError').textContent, /Từ ngày/);
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtPurgeFrom').value = '1/10/2026';
  doc.getElementById('vtPurgeTo').value = '05/10/2026';
  const before = calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions/history').length;
  doc.getElementById('vtPurgeOk').click();
  await settle();
  const del = calls.filter(c => c.method === 'DELETE');
  assert.equal(del.length, 1);
  assert.equal(del[0].query.get('branch'), 'HN');
  assert.equal(del[0].query.get('from'), '2026-10-01');
  assert.equal(del[0].query.get('to'), '2026-10-05');
  assert.equal(dialog.hasAttribute('open'), false);
  assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions/history').length, before + 1, 'tải lại lịch sử');
  void window;
});

test('Xóa lịch sử: để trống 2 ngày = xóa toàn bộ (không gửi from/to); Hủy không gọi API', async t => {
  const ui = await setup(t, { handlers: { 'DELETE /api/stock-positions/history': () => json({ deleted: 3, from: null, to: null }) } });
  const { doc, calls } = ui;
  await openHistory(ui);
  doc.getElementById('vtHistoryPurge').click();
  doc.getElementById('vtPurgeCancel').click();
  assert.equal(calls.filter(c => c.method === 'DELETE').length, 0);
  doc.getElementById('vtHistoryPurge').click();
  doc.getElementById('vtPurgeOk').click();
  await settle();
  const del = calls.find(c => c.method === 'DELETE');
  assert.equal(del.query.has('from'), false);
  assert.equal(del.query.has('to'), false);
});

test('Xóa lịch sử: không có quyền historyDelete thì ẩn nút', async t => {
  const ui = await setup(t, { canDeleteHistory: false });
  await openHistory(ui);
  assert.equal(ui.doc.getElementById('vtHistoryPurge').hidden, true);
});
