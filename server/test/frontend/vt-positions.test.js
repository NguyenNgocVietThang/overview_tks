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

const row = (id, extra = {}) => ({
  id, code: 'MA' + id, name: 'Hàng ' + id, notes: '2T x 100', arrivalDate: '', location: 'K' + id,
  quantity: 200, kiotQuantity: 350, warnings: [], updatedByName: 'Quản lý', updatedAt: '2026-10-27T02:30:00.000Z', version: 3, ...extra
});
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// handlers: hàm (url, options, parsed) trả về response giả cho các lệnh không phải GET danh sách.
async function setup(t, { branch = 'Cả hai', hash = '', data = { HN: [row(1)], SG: [row(2)] }, canEdit = true, canExport = false, permissions, handler, width = 1024 } = {}) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/vt-positions/' + hash, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
  const media = { matches: width <= 600, addEventListener() {} };
  window.matchMedia = () => media;
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new window.Event('close')); };
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/fuzzy-search.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/carton.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(publicDir, 'shared/table-controls.js'), 'utf8'));
  window.eval(nav);
  const base = resolvePermissions({ vaiTro: 'Quản lý' });
  const user = {
    vaiTro: 'Quản lý', branch,
    permissions: permissions || [...new Set([...base, 'stockLocationsV2.view', 'stockLocationsV2.edit'])],
    pageFeatures: PAGE_FEATURES
  };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options = {}) => {
    const parsed = new URL(url, window.location.href);
    if (parsed.pathname === '/api/me/table-prefs') return json({ tables: {} });
    const method = options.method || 'GET';
    calls.push({ method, path: parsed.pathname, query: parsed.searchParams, options });
    if (method === 'GET' && parsed.pathname === '/api/stock-positions') {
      const target = parsed.searchParams.get('branch');
      return json({ branch: target, canEdit, canExport, rows: data[target] });
    }
    if (method === 'GET' && parsed.pathname === '/api/stock-positions/export') {
      return { ok: true, status: 200, headers: { get: name => (name === 'Content-Disposition' ? 'attachment; filename="VT-HN-2026.xlsx"' : null) }, blob: async () => ({ size: 3 }) };
    }
    if (handler) { const answer = await handler(url, options, parsed); if (answer) return answer; }
    return json({ error: 'Không có mock', code: 'NO_MOCK' }, 500);
  };
  window.eval(code);
  await window.TKSVtPositions.init();
  return {
    window, calls, doc: window.document,
    changeTab: async tab => {
      const event = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
      window.location.hash = tab;
      await event;
      await tick();
    }
  };
}

test('hàng cảnh báo đổi chữ sang đỏ (không tô nền) và chip đếm riêng từng tab', async t => {
  const data = {
    HN: [row(1, { warnings: ['multi'] }), row(2, { warnings: ['unknowncode', 'multi'], kiotQuantity: null }), row(3)],
    SG: [row(4, { warnings: ['unreadable'], quantity: null })]
  };
  const { doc, changeTab } = await setup(t, { data });
  assert.equal(doc.getElementById('vtWarnFilter').textContent, 'Cảnh báo (2)');
  assert.equal(doc.querySelectorAll('#vtRows tr.vt-warning').length, 2);
  assert.equal(doc.querySelector('#vtRows tr[data-id="3"]').classList.contains('vt-warning'), false);
  assert.match(doc.querySelector('#vtRows tr[data-id="2"] .vt-badge').textContent, /Mã SP lạ, Nhiều quy cách/);
  const css = fs.readFileSync(path.join(publicDir, 'vt-positions/vt-positions.css'), 'utf8');
  assert.match(css, /tr\.vt-warning td\{color:var\(--red\)\}/);
  assert.doesNotMatch(css.match(/tr\.vt-warning td\{[^}]*\}/)[0], /background/);
  doc.getElementById('vtWarnFilter').click();
  assert.equal(doc.querySelectorAll('#vtRows tr').length, 2);
  await changeTab('sg');
  assert.equal(doc.getElementById('vtWarnFilter').textContent, 'Cảnh báo (1)');
  assert.equal(doc.getElementById('vtWarnFilter').getAttribute('aria-pressed'), 'false', 'bộ lọc cảnh báo giữ riêng từng tab');
  assert.equal(doc.querySelector('#vtRows [data-field="quantity"]').textContent, '', 'SL trống khi ghi chú sai định dạng');
});

test('hiện đủ 9 cột + Thao tác, số en-US và giờ Việt Nam, SL Kiot trống khi không có', async t => {
  const data = { HN: [row(1, { quantity: 12345.5, kiotQuantity: null, arrivalDate: 'KK 4.10' })], SG: [] };
  const { doc } = await setup(t, { data });
  const labels = [...doc.querySelectorAll('#vtTable thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  assert.deepEqual(labels, ['Mã hàng', 'Tên hàng', 'SL kho', 'SL Kiot', 'Ghi chú số thùng', 'Ngày về', 'Vị trí', 'Người cập nhật', 'TG cập nhật', 'Thao tác']);
  assert.equal(doc.querySelector('td[data-field="quantity"]').textContent, '12,345.5');
  assert.equal(doc.querySelector('td[data-field="kiotQuantity"]').textContent, '');
  assert.equal(doc.querySelector('td[data-field="arrivalDate"]').textContent, 'KK 4.10');
  assert.equal(doc.querySelector('td[data-field="updatedAt"]').textContent, '27/10/2026 09:30');
});

test('chỉ hiện tab cơ sở được phép', async t => {
  const { doc, calls } = await setup(t, { branch: 'Sài Gòn', hash: '#hn' });
  assert.deepEqual([...doc.querySelectorAll('[data-vt-tab]')].filter(a => !a.hidden).map(a => a.dataset.vtTab), ['sg']);
  assert.equal(calls[0].query.get('branch'), 'SG');
});

test('sửa tại chỗ Ghi chú gọi PATCH kèm đúng version và cập nhật dòng', async t => {
  let sent;
  const { doc, calls, window } = await setup(t, {
    handler: async (url, options, parsed) => {
      if (options.method === 'PATCH') { sent = { path: parsed.pathname, body: JSON.parse(options.body) }; return json({ row: row(1, { notes: '3T x 100', quantity: 300, version: 4, updatedByName: 'Tôi' }) }); }
    }
  });
  const cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="notes"]');
  cell.click();
  const input = cell.querySelector('input');
  assert.ok(input, 'ô chuyển sang ô nhập');
  input.value = '1t100 + 2T*100';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(sent.path, '/api/stock-positions/1');
  assert.deepEqual(sent.body, { version: 3, notes: '1t100 + 2T*100' });
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"] td[data-field="notes"]').textContent, '2T x 100'.replace('2', '3'));
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"] td[data-field="quantity"]').textContent, '300');
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"] td[data-field="updatedByName"]').textContent, 'Tôi');
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 1);
});

test('Esc hủy sửa và giá trị không đổi thì không gọi API', async t => {
  const { doc, calls, window } = await setup(t);
  let cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="location"]');
  cell.click();
  cell.querySelector('input').value = 'ZZ';
  cell.querySelector('input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"] td[data-field="location"]').textContent, 'K1');
  cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="location"]');
  cell.click();
  cell.querySelector('input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.equal(calls.filter(c => c.method === 'PATCH').length, 0);
});

test('409 WOULD_AUTO_DELETE hỏi xác nhận rồi gửi lại confirmEmpty và bỏ dòng', async t => {
  const bodies = [];
  const { doc, window } = await setup(t, {
    handler: async (url, options) => {
      if (options.method !== 'PATCH') return null;
      const body = JSON.parse(options.body);
      bodies.push(body);
      return body.confirmEmpty ? json({ deleted: true, id: 1 }) : json({ error: 'Hết hàng', code: 'WOULD_AUTO_DELETE' }, 409);
    }
  });
  const cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="notes"]');
  cell.click();
  cell.querySelector('input').value = 'Hết hàng';
  cell.querySelector('input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.ok(doc.getElementById('vtConfirmDialog').hasAttribute('open'));
  doc.getElementById('vtConfirmOk').click();
  await settle();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1].confirmEmpty, true);
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"]'), null);
});

test('409 VERSION_CONFLICT báo dòng đã bị người khác sửa và tải lại danh sách', async t => {
  const { doc, calls, window } = await setup(t, {
    handler: async (url, options) => options.method === 'PATCH' ? json({ error: 'conflict', code: 'VERSION_CONFLICT' }, 409) : null
  });
  const cell = doc.querySelector('#vtRows tr[data-id="1"] td[data-field="location"]');
  cell.click();
  cell.querySelector('input').value = 'MOI';
  cell.querySelector('input').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await settle();
  assert.match(doc.getElementById('vtNotice').textContent, /người khác sửa/);
  assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions').length, 2);
});

test('canEdit=false hoặc không có quyền sửa: ẩn nút Thêm/Import, không có cột Thao tác, không sửa tại chỗ', async t => {
  const readonly = await setup(t, { canEdit: false });
  assert.equal(readonly.doc.getElementById('vtAddButton').hidden, true);
  assert.equal(readonly.doc.getElementById('vtImportButton').hidden, true);
  assert.equal(readonly.doc.querySelector('#vtRows [data-action]'), null);
  assert.equal(readonly.doc.querySelector('#vtRows td.vt-editable'), null);
  assert.equal(readonly.doc.getElementById('vtHistoryButton').hidden, false, 'xem lịch sử vẫn được');

  const noPermission = await setup(t, { permissions: ['stockLocationsV2.view'] });
  assert.equal(noPermission.doc.querySelector('#vtTable th[data-field="actions"]'), null);
  assert.equal(noPermission.doc.getElementById('vtAddButton').hidden, true);
  noPermission.doc.querySelector('#vtRows td[data-field="notes"]').click();
  assert.equal(noPermission.doc.querySelector('#vtRows input'), null);

  const editor = await setup(t);
  assert.equal(editor.doc.getElementById('vtAddButton').hidden, false);
  assert.ok(editor.doc.querySelector('#vtRows [data-action="delete"]'));
});

test('thêm dòng gửi POST theo cơ sở và hiện dòng mới; lỗi trùng hiện trong hộp thoại', async t => {
  let answer = json({ row: row(9, { code: 'NEW9', location: 'A1' }) }, 201);
  let sent;
  const { doc, window } = await setup(t, {
    handler: async (url, options, parsed) => { if (options.method === 'POST') { sent = { query: parsed.searchParams, body: JSON.parse(options.body) }; return answer; } }
  });
  doc.getElementById('vtAddButton').click();
  const form = doc.getElementById('vtAddForm');
  assert.ok(doc.getElementById('vtAddDialog').hasAttribute('open'));
  form.elements.code.value = ' NEW9 ';
  form.elements.notes.value = '1T x 5';
  form.elements.location.value = 'A1';
  answer = json({ error: 'Ghi chú sai định dạng nên không cộng được vào dòng sẵn có.', code: 'VALIDATION' }, 400);
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(doc.getElementById('vtAddError').textContent, 'Ghi chú sai định dạng nên không cộng được vào dòng sẵn có.');
  assert.ok(doc.getElementById('vtAddDialog').hasAttribute('open'));
  answer = json({ row: row(9, { code: 'NEW9', location: 'A1' }) }, 201);
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  await settle();
  assert.equal(sent.query.get('branch'), 'HN');
  assert.deepEqual(sent.body, { code: 'NEW9', notes: '1T x 5', arrivalDate: '', location: 'A1' });
  assert.equal(doc.getElementById('vtAddDialog').hasAttribute('open'), false);
  assert.ok(doc.querySelector('#vtRows tr[data-id="9"]'));
});

test('trừ SL và xóa dòng gọi đúng API với version', async t => {
  const seen = [];
  const { doc } = await setup(t, {
    data: { HN: [row(1), row(2)], SG: [] },
    handler: async (url, options, parsed) => {
      seen.push({ method: options.method, path: parsed.pathname, query: parsed.searchParams, body: options.body && JSON.parse(options.body) });
      if (parsed.pathname.endsWith('/deduct')) return json({ row: row(1, { notes: '1T x 100', quantity: 100, version: 4 }) });
      if (options.method === 'DELETE') return json({ deleted: true, id: 2 });
    }
  });
  doc.querySelector('#vtRows tr[data-id="1"] [data-action="deduct"]').click();
  const form = doc.getElementById('vtDeductForm');
  form.elements.quantity.value = '100';
  form.dispatchEvent(new doc.defaultView.Event('submit', { cancelable: true }));
  await settle();
  assert.deepEqual(seen[0], { method: 'POST', path: '/api/stock-positions/1/deduct', query: seen[0].query, body: { version: 3, quantity: 100 } });
  assert.equal(doc.querySelector('#vtRows tr[data-id="1"] td[data-field="quantity"]').textContent, '100');
  doc.querySelector('#vtRows tr[data-id="2"] [data-action="delete"]').click();
  assert.ok(doc.getElementById('vtConfirmDialog').hasAttribute('open'));
  doc.getElementById('vtConfirmOk').click();
  await settle();
  assert.equal(seen[1].method, 'DELETE');
  assert.equal(seen[1].path, '/api/stock-positions/2');
  assert.equal(seen[1].query.get('version'), '3');
  assert.equal(doc.querySelector('#vtRows tr[data-id="2"]'), null);
});

test('hộp Lịch sử cập nhật tải theo cơ sở, lọc theo hành động, tìm kiếm và tải thêm bằng before', async t => {
  const entries = [
    { id: 30, createdAt: '2026-10-27T03:00:00Z', branch: 'HN', code: 'AAA', location: 'K1', action: 'edit', field: 'notes', oldValue: '1T x 5', newValue: '2T x 5', actorName: 'Lan' },
    { id: 29, createdAt: '2026-10-27T02:00:00Z', branch: 'HN', code: '', location: '', action: 'import_add', field: null, summary: { added: 3, updated: 1, deleted: 0, skippedEmpty: 2, fileName: 'a.xlsx' }, actorName: 'Minh' }
  ];
  const queries = [];
  const { doc, window } = await setup(t, {
    handler: async (url, options, parsed) => {
      if (parsed.pathname !== '/api/stock-positions/history') return null;
      queries.push(parsed.searchParams);
      return parsed.searchParams.get('before')
        ? json({ rows: [{ id: 5, createdAt: '2026-10-26T01:00:00Z', branch: 'HN', code: 'OLD', location: 'K9', action: 'create', actorName: 'Hà' }], nextBefore: null })
        : json({ rows: entries, nextBefore: 29 });
    }
  });
  doc.getElementById('vtHistoryButton').click();
  await settle();
  assert.equal(queries[0].get('branch'), 'HN');
  assert.ok(doc.getElementById('vtHistoryDialog').hasAttribute('open'));
  assert.equal(doc.querySelectorAll('#vtHistoryRows tr').length, 2);
  const first = [...doc.querySelectorAll('#vtHistoryRows tr:first-child td')].map(td => td.textContent);
  assert.deepEqual(first, ['27/10/2026 10:00', 'Lan', 'Sửa', 'AAA · K1', 'Ghi chú', '1T x 5', '2T x 5']);
  assert.match(doc.querySelectorAll('#vtHistoryRows tr')[1].textContent, /Import bổ sung.*Thêm 3 · Đổi 1 · Xóa 0 · Bỏ qua 2 · a\.xlsx/);
  const action = doc.getElementById('vtHistoryAction');
  action.value = 'import_add';
  action.dispatchEvent(new window.Event('change'));
  assert.equal(doc.querySelectorAll('#vtHistoryRows tr').length, 1);
  action.value = '';
  action.dispatchEvent(new window.Event('change'));
  const search = doc.getElementById('vtHistorySearch');
  search.value = 'lan';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(doc.querySelectorAll('#vtHistoryRows tr').length, 1);
  search.value = '';
  search.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('vtHistoryMore').hidden, false);
  doc.getElementById('vtHistoryMore').click();
  await settle();
  assert.equal(queries[1].get('before'), '29');
  assert.equal(doc.querySelectorAll('#vtHistoryRows tr').length, 3);
  assert.equal(doc.getElementById('vtHistoryMore').hidden, true);
});

test('import: xem trước hiện số liệu và lỗi theo dòng; chỉ cho xác nhận khi không còn lỗi, rồi tải lại bảng', async t => {
  const queries = [];
  let preview = { mode: 'add', commit: false, counts: { added: 2, updated: 1, deleted: 0, unchanged: 4, skippedEmpty: 1, errors: 1 }, errors: [{ row: 7, message: 'Thiếu mã SP' }] };
  const { doc, calls, window } = await setup(t, {
    handler: async (url, options, parsed) => {
      if (parsed.pathname !== '/api/stock-positions/import') return null;
      queries.push({ query: parsed.searchParams, body: options.body });
      return json({ ...preview, commit: parsed.searchParams.get('commit') === '1' });
    }
  });
  doc.getElementById('vtImportButton').click();
  assert.ok(doc.getElementById('vtImportDialog').hasAttribute('open'));
  doc.getElementById('vtImportPreview').click();
  await settle();
  assert.match(doc.getElementById('vtImportError').textContent, /chọn file/);
  const input = doc.getElementById('vtImportFile');
  Object.defineProperty(input, 'files', { value: [new window.File(['x'], 'vitri.xlsx')], configurable: true });
  doc.querySelector('input[name="vtImportMode"][value="replace"]').checked = true;
  doc.getElementById('vtImportPreview').click();
  await settle();
  assert.equal(queries[0].query.get('mode'), 'replace');
  assert.equal(queries[0].query.get('commit'), '0');
  assert.equal(queries[0].query.get('branch'), 'HN');
  assert.ok(queries[0].body instanceof window.FormData);
  assert.equal(queries[0].body.get('file').name, 'vitri.xlsx');
  assert.equal(doc.querySelector('[data-count="added"] b').textContent, '2');
  assert.equal(doc.querySelector('[data-count="errors"] b').textContent, '1');
  assert.match(doc.querySelector('[data-import-errors]').textContent, /Dòng 7: Thiếu mã SP/);
  assert.equal(doc.getElementById('vtImportConfirm').disabled, true, 'còn lỗi thì chưa cho xác nhận');

  preview = { ...preview, counts: { ...preview.counts, errors: 0 }, errors: [] };
  doc.getElementById('vtImportPreview').click();
  await settle();
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
  const listCalls = calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions').length;
  doc.getElementById('vtImportConfirm').click();
  await settle();
  assert.equal(queries[2].query.get('commit'), '1');
  assert.equal(doc.getElementById('vtImportDialog').hasAttribute('open'), false);
  assert.equal(calls.filter(c => c.method === 'GET' && c.path === '/api/stock-positions').length, listCalls + 1, 'tải lại bảng sau import');
  assert.match(doc.getElementById('vtNotice').textContent, /thêm 2, cập nhật 1, xóa 0/);
});

test('đổi chế độ hoặc file sau khi xem trước thì phải xem trước lại', async t => {
  const { doc, window } = await setup(t, {
    handler: async (url, options, parsed) => parsed.pathname === '/api/stock-positions/import'
      ? json({ counts: { added: 1, updated: 0, deleted: 0, unchanged: 0, skippedEmpty: 0, errors: 0 }, errors: [] }) : null
  });
  doc.getElementById('vtImportButton').click();
  Object.defineProperty(doc.getElementById('vtImportFile'), 'files', { value: [new window.File(['x'], 'a.csv')], configurable: true });
  doc.getElementById('vtImportPreview').click();
  await settle();
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
  doc.querySelector('input[name="vtImportMode"][value="replace"]').dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('vtImportConfirm').disabled, true);
});

test('nút Xuất Excel chỉ hiện khi canExport, tải file theo cơ sở với tên từ Content-Disposition', async t => {
  const hidden = await setup(t, { canExport: false });
  assert.equal(hidden.doc.getElementById('vtExportButton').hidden, true);

  const { doc, calls, window } = await setup(t, { canExport: true });
  assert.equal(doc.getElementById('vtExportButton').hidden, false);
  const downloads = [];
  window.URL.createObjectURL = blob => { downloads.push({ blob }); return 'blob:vt'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloads.at(-1).name = this.download; downloads.at(-1).href = this.href; };
  doc.getElementById('vtExportButton').click();
  await settle();
  const exportCall = calls.find(c => c.path === '/api/stock-positions/export');
  assert.equal(exportCall.query.get('branch'), 'HN');
  assert.equal(exportCall.options.credentials, 'same-origin');
  assert.equal(downloads[0].name, 'VT-HN-2026.xlsx');
  assert.equal(downloads[0].href, 'blob:vt');
});

test('sắp xếp số theo giá trị, ô trống luôn cuối', async t => {
  const { window } = await setup(t);
  const rows = [row(1, { quantity: 10 }), row(2, { quantity: null }), row(3, { quantity: 2 })];
  assert.deepEqual(Array.from(window.TKSVtPositions.sortRows(rows, 'quantity', 'asc'), r => r.id), [3, 1, 2]);
  assert.deepEqual(Array.from(window.TKSVtPositions.sortRows(rows, 'quantity', 'desc'), r => r.id), [1, 3, 2]);
});
