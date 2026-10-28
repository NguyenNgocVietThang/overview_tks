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
