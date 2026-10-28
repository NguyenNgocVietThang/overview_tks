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
  quantity: 200, held: 0, available: 200, kiotQuantity: 350, warnings: [], updatedByName: 'Quản lý', updatedAt: '2026-10-27T02:30:00.000Z', version: 3, ...extra
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

const optionTexts = doc => [...doc.querySelectorAll('#vtWarnFilter option')].map(option => option.textContent);
const pickFilter = (doc, window, value) => {
  const select = doc.getElementById('vtWarnFilter');
  select.value = value;
  select.dispatchEvent(new window.Event('change'));
};

test('hàng cảnh báo đổi chữ sang đỏ (không tô nền); bộ lọc Cảnh báo/Hợp lệ/Tất cả đếm và nhớ riêng từng tab', async t => {
  const data = {
    HN: [row(1, { warnings: ['multi'] }), row(2, { warnings: ['unknowncode', 'multi'], kiotQuantity: null }), row(3)],
    SG: [row(4, { warnings: ['unreadable'], quantity: null })]
  };
  const { doc, window, changeTab } = await setup(t, { data });
  assert.deepEqual(optionTexts(doc), ['Cảnh báo (2)', 'Hợp lệ (1)', 'Tất cả']);
  assert.equal(doc.getElementById('vtWarnFilter').value, 'all', 'mặc định Tất cả');
  assert.equal(doc.querySelectorAll('#vtRows tr.vt-warning').length, 2);
  assert.equal(doc.querySelector('#vtRows tr[data-id="3"]').classList.contains('vt-warning'), false);
  assert.match(doc.querySelector('#vtRows tr[data-id="2"] .vt-badge').textContent, /Mã SP lạ, Nhiều quy cách/);
  const css = fs.readFileSync(path.join(publicDir, 'vt-positions/vt-positions.css'), 'utf8');
  assert.match(css, /tr\.vt-warning td\{color:var\(--red\)\}/);
  assert.doesNotMatch(css.match(/tr\.vt-warning td\{[^}]*\}/)[0], /background/);
  pickFilter(doc, window, 'warn');
  assert.deepEqual([...doc.querySelectorAll('#vtRows tr')].map(tr => tr.dataset.id), ['1', '2']);
  assert.equal(doc.getElementById('vtWarnFilter').parentElement.dataset.filter, 'warn');
  pickFilter(doc, window, 'valid');
  assert.deepEqual([...doc.querySelectorAll('#vtRows tr')].map(tr => tr.dataset.id), ['3']);
  assert.equal(doc.getElementById('vtWarnFilter').parentElement.dataset.filter, 'valid');
  pickFilter(doc, window, 'all');
  assert.equal(doc.querySelectorAll('#vtRows tr').length, 3);
  pickFilter(doc, window, 'warn');
  await changeTab('sg');
  assert.deepEqual(optionTexts(doc), ['Cảnh báo (1)', 'Hợp lệ (0)', 'Tất cả']);
  assert.equal(doc.getElementById('vtWarnFilter').value, 'all', 'bộ lọc cảnh báo giữ riêng từng tab');
  assert.equal(doc.querySelector('#vtRows [data-field="quantity"]').textContent, '', 'SL trống khi ghi chú sai định dạng');
});

test('bộ lọc cảnh báo: số đếm tính trên toàn bộ dòng (không theo từ khóa), rỗng thì báo đúng lý do, về trang 1 khi đổi', async t => {
  const rows = Array.from({ length: 130 }, (_, i) => row(i + 1, i < 3 ? { warnings: ['unreadable'] } : {}));
  const { doc, window } = await setup(t, { data: { HN: rows, SG: [] } });
  doc.getElementById('vtNext').click();
  assert.equal(doc.getElementById('vtPage').textContent, 'Trang 2 / 2');
  pickFilter(doc, window, 'warn');
  assert.equal(doc.getElementById('vtPage').textContent, 'Trang 1 / 1');
  const search = doc.getElementById('vtSearch');
  search.value = 'MA7';
  search.dispatchEvent(new window.Event('input'));
  assert.deepEqual(optionTexts(doc), ['Cảnh báo (3)', 'Hợp lệ (127)', 'Tất cả'], 'không đổi theo từ khóa');
  assert.equal(doc.getElementById('vtStatus').textContent, 'Không có dòng cảnh báo.');
  const noWarn = await setup(t, { data: { HN: [row(1)], SG: [] } });
  pickFilter(noWarn.doc, noWarn.window, 'warn');
  assert.equal(noWarn.doc.getElementById('vtStatus').textContent, 'Không có dòng cảnh báo.');
  const allWarn = await setup(t, { data: { HN: [row(1, { warnings: ['multi'] })], SG: [] } });
  pickFilter(allWarn.doc, allWarn.window, 'valid');
  assert.equal(allWarn.doc.getElementById('vtStatus').textContent, 'Không có dòng hợp lệ.');
  const { filterRows } = allWarn.window.TKSVtPositions;
  const sample = [row(1, { warnings: ['multi'] }), row(2)];
  assert.deepEqual(Array.from(filterRows(sample, '', true), r => r.id), [1], 'true = chỉ cảnh báo (tương thích boolean cũ)');
  assert.deepEqual(Array.from(filterRows(sample, '', 'warn'), r => r.id), [1]);
  assert.deepEqual(Array.from(filterRows(sample, '', 'valid'), r => r.id), [2]);
  assert.deepEqual(Array.from(filterRows(sample, '', 'all'), r => r.id), [1, 2]);
  assert.deepEqual(Array.from(filterRows(sample, '', false), r => r.id), [1, 2]);
});

test('hiện 10 cột gồm Có thể bốc, Cập nhật và Người sửa cuối riêng (không còn cột Thao tác), số en-US và giờ Việt Nam, SL Kiot trống khi không có', async t => {
  const data = { HN: [row(1, { quantity: 12345.5, available: 12000.5, held: 345, kiotQuantity: null, arrivalDate: 'KK 4.10' })], SG: [] };
  const { doc } = await setup(t, { data });
  const labels = [...doc.querySelectorAll('#vtTable thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  assert.deepEqual(labels, ['Mã hàng', 'Tên hàng', 'SL kho', 'Có thể bốc', 'SL Kiot', 'Ghi chú số thùng', 'Ngày về', 'Vị trí', 'Cập nhật', 'Người sửa cuối']);
  assert.equal(doc.querySelector('#vtTable th[data-field="actions"]'), null);
  assert.equal(doc.querySelector('#vtRows [data-menu-toggle], #vtRows [data-action]'), null, 'không còn nút ⋯/Xóa trong bảng');
  assert.equal(doc.querySelector('td[data-field="quantity"]').textContent, '12,345.5');
  assert.equal(doc.querySelector('td[data-field="available"]').textContent, '12,000.5');
  assert.match(doc.querySelector('td[data-field="available"]').title, /345/, 'tooltip nói rõ phần đang giữ chỗ');
  assert.equal(doc.querySelector('td[data-field="kiotQuantity"]').textContent, '');
  assert.equal(doc.querySelector('td[data-field="arrivalDate"]').textContent, 'KK 4.10');
  assert.equal(doc.querySelector('td[data-field="updated"] .vt-updated-time').textContent, '27/10/2026 09:30');
  assert.equal(doc.querySelector('td[data-field="updatedByName"]').textContent, 'Quản lý', 'Người sửa cuối là cột riêng');
  assert.equal(doc.querySelector('td[data-field="updated"] .vt-updated-by'), null);
});

test('mỗi cột khai báo độ rộng tối thiểu để kéo hẹp không làm chữ xếp từng ký tự', async t => {
  const { doc } = await setup(t);
  const mins = [...doc.querySelectorAll('#vtTable thead th')].map(th => Number(th.dataset.minWidth));
  assert.equal(mins.length, 10);
  assert.ok(mins.every(min => min >= 80), 'mọi cột ≥ 80px: ' + mins.join(','));
});

test('vị trí hiện dạng pill, huy hiệu cảnh báo có biểu tượng và chữ, mỗi dòng bấm được (tabindex)', async t => {
  const data = { HN: [row(1, { warnings: ['unreadable'] })], SG: [] };
  const { doc } = await setup(t, { data });
  assert.equal(doc.querySelector('td[data-field="location"] .vt-pill').textContent, 'K1');
  assert.ok(doc.querySelector('td[data-field="notes"] .vt-badge .vt-badge-icon'));
  assert.equal(doc.querySelector('td[data-field="notes"] .vt-badge').textContent, 'Sai định dạng');
  const tr = doc.querySelector('#vtRows tr[data-id="1"]');
  assert.equal(tr.tabIndex, 0);
  assert.ok(tr.classList.contains('vt-row'));
  assert.equal(doc.querySelector('#vtRows .vt-editable'), null, 'không còn sửa tại chỗ');
  assert.equal(doc.querySelector('#vtRows .vt-edit-icon'), null);
});

test('sắp xếp cột Cập nhật theo thời gian, ô trống luôn cuối', async t => {
  const { window } = await setup(t);
  const rows = [row(1, { updatedAt: '2026-10-27T02:00:00Z' }), row(2, { updatedAt: null }), row(3, { updatedAt: '2026-10-26T02:00:00Z' })];
  assert.deepEqual(Array.from(window.TKSVtPositions.sortRows(rows, 'updated', 'asc'), r => r.id), [3, 1, 2]);
  assert.deepEqual(Array.from(window.TKSVtPositions.sortRows(rows, 'updated', 'desc'), r => r.id), [1, 3, 2]);
});

test('chọn số dòng/trang đổi phân trang và đếm dòng định dạng en-US', async t => {
  const rows = Array.from({ length: 120 }, (_, i) => row(i + 1));
  const { doc, window } = await setup(t, { data: { HN: rows, SG: [] } });
  assert.equal(doc.querySelectorAll('#vtRows tr').length, 100, 'mặc định 100 dòng');
  assert.equal(doc.getElementById('vtCount').textContent, '1–100 / 120 dòng');
  const select = doc.getElementById('vtPageSize');
  select.value = '50';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(doc.querySelectorAll('#vtRows tr').length, 50);
  assert.equal(doc.getElementById('vtPage').textContent, 'Trang 1 / 3');
  doc.getElementById('vtNext').click();
  assert.equal(doc.getElementById('vtCount').textContent, '51–100 / 120 dòng');
  select.value = '200';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(doc.querySelectorAll('#vtRows tr').length, 120);
  assert.equal(doc.getElementById('vtPage').textContent, 'Trang 1 / 1');
});

test('chỉ hiện tab cơ sở được phép', async t => {
  const { doc, calls } = await setup(t, { branch: 'Sài Gòn', hash: '#hn' });
  assert.deepEqual([...doc.querySelectorAll('[data-vt-tab]')].filter(a => !a.hidden).map(a => a.dataset.vtTab), ['sg']);
  assert.equal(calls[0].query.get('branch'), 'SG');
});

test('canEdit=false hoặc không có quyền sửa: ẩn nút Thêm/Import; vẫn bấm dòng xem chi tiết nhưng không có Lưu/Xóa', async t => {
  const readonly = await setup(t, { canEdit: false });
  assert.equal(readonly.doc.getElementById('vtAddButton').hidden, true);
  assert.equal(readonly.doc.getElementById('vtImportButton').hidden, true);
  assert.equal(readonly.doc.getElementById('vtHistoryButton').hidden, false, 'xem lịch sử vẫn được');
  readonly.doc.querySelector('#vtRows tr[data-id="1"]').click();
  assert.ok(readonly.doc.getElementById('vtDetailDialog').hasAttribute('open'), 'chỉ xem vẫn mở được hộp chi tiết');
  assert.equal(readonly.doc.getElementById('vtDetailSave').hidden, true);
  assert.equal(readonly.doc.getElementById('vtDetailDelete').hidden, true);

  const noPermission = await setup(t, { permissions: ['stockLocationsV2.view'] });
  assert.equal(noPermission.doc.getElementById('vtAddButton').hidden, true);
  noPermission.doc.querySelector('#vtRows tr[data-id="1"]').click();
  assert.equal(noPermission.doc.getElementById('vtDetailSave').hidden, true);

  const editor = await setup(t);
  assert.equal(editor.doc.getElementById('vtAddButton').hidden, false);
  editor.doc.querySelector('#vtRows tr[data-id="1"]').click();
  assert.equal(editor.doc.getElementById('vtDetailSave').hidden, false);
  assert.equal(editor.doc.getElementById('vtDetailDelete').hidden, false);
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
  assert.deepEqual(first, ['27/10/2026 10:00', 'Lan', 'Sửa', 'AAA · K1', '1T x 5 → 2T x 5']);
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

test('import: xem trước tùy chọn hiện số liệu và lỗi theo dòng; xác nhận rồi tải lại bảng', async t => {
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
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false, 'máy chủ kiểm tra lại khi xác nhận');

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

test('import: bước Xem trước hiện bảng các dòng đã chuẩn hóa (cũ → mới), lọc theo loại, Quay lại về bước chọn file', async t => {
  const rows = [
    { kind: 'add', row: 3, code: 'ZZZ9', name: 'Hàng mới', notes: '3T x 20', arrivalDate: 'KK 4.10', location: 'H9', cartons: 3, quantity: 60 },
    { kind: 'update', row: 4, code: 'AAA1', name: 'Cưa', notes: '7T x 100', arrivalDate: '1/10', location: 'H1', cartons: 7, quantity: 700, before: { notes: '5T x 100', arrivalDate: '1/10', location: 'H1' } },
    { kind: 'delete', row: null, code: 'BBB2', name: '', notes: '1T x 10', arrivalDate: '', location: 'H2', cartons: 1, quantity: 10 }
  ];
  const { doc, window } = await setup(t, {
    handler: async (url, options, parsed) => parsed.pathname === '/api/stock-positions/import'
      ? json({ mode: 'add', commit: false, counts: { added: 1, updated: 1, deleted: 1, unchanged: 0, skippedEmpty: 0, errors: 0 }, errors: [], rows, rowsTotal: 5 })
      : null
  });
  doc.getElementById('vtImportButton').click();
  assert.equal(doc.getElementById('vtImportPickPanel').hidden, false);
  assert.equal(doc.getElementById('vtImportConfirm').hidden, true, 'bước 1 chỉ có Xem trước');
  Object.defineProperty(doc.getElementById('vtImportFile'), 'files', { value: [new window.File(['x'], 'vitri.xlsx')], configurable: true });
  doc.getElementById('vtImportFile').dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('vtImportFileName').textContent, 'vitri.xlsx');
  doc.getElementById('vtImportPreview').click();
  await settle();
  assert.equal(doc.getElementById('vtImportPickPanel').hidden, true);
  assert.equal(doc.querySelector('#vtImportSteps [data-step="2"]').classList.contains('is-current'), true);
  assert.equal(doc.getElementById('vtImportConfirm').hidden, false);
  const bodyRows = () => [...doc.querySelectorAll('#vtImportPreviewRows tr')].map(tr => [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(bodyRows(), [
    ['Thêm', '3', 'ZZZ9Hàng mới', '3T x 20', '3', '60', 'KK 4.10', 'H9'],
    ['Cập nhật', '4', 'AAA1Cưa', '5T x 100 → 7T x 100', '7', '700', '1/10', 'H1'],
    ['Xóa', '—', 'BBB2', '1T x 10', '1', '10', '—', 'H2']
  ]);
  assert.match(doc.getElementById('vtImportPreviewNote').textContent, /3 \/ 5 dòng/);
  doc.querySelector('#vtImportFilter [data-kind="update"]').click();
  assert.deepEqual(bodyRows().map(r => r[2]), ['AAA1Cưa']);
  doc.getElementById('vtImportBack').click();
  assert.equal(doc.getElementById('vtImportPickPanel').hidden, false);
  assert.equal(doc.getElementById('vtImportPreviewBox').hidden, true);
});

test('đổi chế độ hoặc file không bắt buộc xem trước lại; bỏ chọn file thì khóa import', async t => {
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
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
  Object.defineProperty(doc.getElementById('vtImportFile'), 'files', { value: [], configurable: true });
  doc.getElementById('vtImportFile').dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('vtImportConfirm').disabled, true);
});

test('import trực tiếp sau chọn file, không gọi xem trước; lỗi máy chủ giữ hộp và cho thử lại', async t => {
  let valid = false;
  const { doc, calls, window } = await setup(t, {
    handler: async (url, options, parsed) => parsed.pathname === '/api/stock-positions/import'
      ? valid ? json({ counts: { added: 1 }, imported: true })
        : json({ error: 'File còn lỗi', counts: { errors: 1 }, errors: [{ row: 2, message: 'Thiếu mã hàng.' }] }, 400)
      : null
  });
  doc.getElementById('vtImportButton').click();
  const input = doc.getElementById('vtImportFile');
  Object.defineProperty(input, 'files', { value: [new window.File(['x'], 'Book1.xlsx')], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
  doc.getElementById('vtImportConfirm').click();
  doc.getElementById('vtImportConfirm').click();
  await settle();
  let imports = calls.filter(c => c.path === '/api/stock-positions/import');
  assert.equal(imports.length, 1, 'chặn bấm lặp khi đang gửi');
  assert.equal(imports[0].query.get('commit'), '1');
  assert.ok(doc.getElementById('vtImportDialog').hasAttribute('open'));
  assert.match(doc.querySelector('[data-import-errors]').textContent, /Thiếu mã hàng/);
  assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
  valid = true;
  doc.getElementById('vtImportConfirm').click();
  await settle();
  imports = calls.filter(c => c.path === '/api/stock-positions/import');
  assert.equal(imports.length, 2);
  assert.ok(imports.every(c => c.query.get('commit') === '1'));
  assert.equal(doc.getElementById('vtImportDialog').hasAttribute('open'), false);
});

test('import lỗi kết nối báo trong hộp và mở lại nút để thử lại', async t => {
  const { doc, window } = await setup(t, {
    handler: async (url, options, parsed) => {
      if (parsed.pathname === '/api/stock-positions/import') throw new TypeError('Failed to fetch');
    }
  });
  doc.getElementById('vtImportButton').click();
  const input = doc.getElementById('vtImportFile');
  Object.defineProperty(input, 'files', { value: [new window.File(['x'], 'Book1.xlsx')], configurable: true });
  input.dispatchEvent(new window.Event('change'));
  for (const button of ['vtImportPreview', 'vtImportConfirm']) {
    doc.getElementById(button).click();
    await settle();
    assert.match(doc.getElementById('vtImportError').textContent, /Không kết nối được máy chủ/);
    assert.equal(doc.getElementById('vtImportConfirm').disabled, false);
    assert.equal(input.disabled, false);
    assert.ok(doc.getElementById('vtImportDialog').hasAttribute('open'));
  }
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
