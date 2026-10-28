'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const ExcelJS = require('exceljs');
const { createStockPositionsRouter } = require('./stockPositionsRoutes');

const MANAGER = { id: 'ql', vaiTro: 'Quản lý' };
const ROWS = [
  { id: 1, code: 'AAA1', name: 'Hàng A', notes: '3T x 100', arrivalDate: '4/10', location: 'H1', quantity: 300, held: 120, available: 180, kiotQuantity: 42, warnings: [], updatedByName: 'QL', updatedAt: '2026-10-27T03:00:00.000Z', version: 1 },
  { id: 2, code: 'BBB2', name: '=SUM(A1)', notes: 'rác', arrivalDate: '', location: '', quantity: null, held: 0, available: null, kiotQuantity: null, warnings: ['unreadable'], updatedByName: 'QL', updatedAt: '2026-10-27T04:30:00.000Z', version: 1 }
];

const HISTORY = [
  { id: 2, createdAt: '2026-10-27T03:44:00.000Z', branch: 'HN', code: 'CKL2DBV', location: 'ST', action: 'edit', field: 'notes', oldValue: '41T x 250', newValue: '=40T x 250', summary: null, actorName: 'Nguyễn Ngọc Việt Thắng' },
  { id: 1, createdAt: '2026-10-27T03:27:00.000Z', branch: 'HN', code: 'CKL2DBV', location: 'ST', action: 'import_add', field: null, oldValue: null, newValue: null, summary: { added: 3, fileName: 'a.xlsx' }, actorName: 'Nhập dữ liệu đầu' }
];

async function start(t, { user = MANAGER, scope = 'Cả hai' } = {}) {
  const calls = [];
  const record = name => async (ctx, ...args) => { calls.push([name, ...args]); return { ok: name }; };
  const service = {
    list: async (ctx, branch) => { calls.push(['list', branch, ctx.scope]); return { branch, rows: ROWS }; },
    create: record('create'), update: record('update'), deduct: record('deduct'), remove: record('remove'), history: record('history'),
    acknowledge: record('acknowledge'), purgeHistory: record('purgeHistory'),
    historyAll: async (ctx, branch, filters) => { calls.push(['historyAll', branch, filters, ctx.scope]); return { rows: HISTORY, truncated: false }; },
    importFile: async (ctx, branch, options) => { calls.push(['importFile', branch, options.mode, options.commit, options.fileName, options.buffer.length]); return { counts: {} }; }
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (user) req.user = user; next(); });
  app.use(createStockPositionsRouter({
    requireAuth: (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Chưa đăng nhập.' })),
    resolveBranch: (req, res, next) => { req.branch = scope; next(); },
    service
  }));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/stock-positions`;
  return { calls, base };
}

test('GET danh sách: Quản lý có canEdit + canExport, không cache, truyền phạm vi cơ sở', async t => {
  const { base, calls } = await start(t, { scope: 'Sài Gòn' });
  const res = await fetch(base + '?branch=SG');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const body = await res.json();
  assert.equal(body.canEdit, true);
  assert.equal(body.canExport, true);
  assert.deepEqual(calls[0], ['list', 'SG', ['SG']]);
});

test('Không đủ quyền: chưa đăng nhập 401; Nhân viên kho và Khách có cấp quyền giả mạo 403', async t => {
  assert.equal((await fetch((await start(t, { user: null })).base + '?branch=HN')).status, 401);
  const kho = await start(t, { user: { vaiTro: 'Nhân viên kho' } });
  assert.equal((await fetch(kho.base + '?branch=HN')).status, 403);
  const khach = await start(t, { user: { vaiTro: 'Khách', featurePermissions: { 'stockLocationsV2.view': true } } });
  assert.equal((await fetch(khach.base + '?branch=HN')).status, 403);
  assert.deepEqual([...kho.calls, ...khach.calls], []);
});

test('Chỉ xem (đã cấp view, không edit/export): đọc được, ghi + xuất bị 403', async t => {
  const viewer = { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true } };
  const { base, calls } = await start(t, { user: viewer });
  const list = await (await fetch(base + '?branch=HN')).json();
  assert.equal(list.canEdit, false);
  assert.equal(list.canExport, false);
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '?branch=HN', { method: 'POST', headers: json, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/5', { method: 'PATCH', headers: json, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/5/deduct', { method: 'POST', headers: json, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/5', { method: 'DELETE' })).status, 403);
  assert.equal((await fetch(base + '/import?branch=HN&mode=add', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/export?branch=HN')).status, 403);
  assert.equal((await fetch(base + '/history/export?branch=HN')).status, 403);
  assert.deepEqual(calls.map(c => c[0]), ['list']);
});

test('GET /history chuyển positionId (và limit/before) tới service', async t => {
  const { base, calls } = await start(t);
  await fetch(base + '/history?branch=SG&limit=50&before=9&positionId=12');
  await fetch(base + '/history?branch=HN');
  assert.deepEqual(calls[0], ['history', 'SG', { limit: '50', before: '9', positionId: '12' }]);
  assert.deepEqual(calls[1], ['history', 'HN', { limit: undefined, before: undefined, positionId: undefined }]);
});

test('Route ghi chuyển đúng tham số tới service', async t => {
  const { base, calls } = await start(t);
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '?branch=HN', { method: 'POST', headers: json, body: JSON.stringify({ code: 'A' }) })).status, 201);
  await fetch(base + '/7', { method: 'PATCH', headers: json, body: JSON.stringify({ version: 2, notes: '1T x 5' }) });
  await fetch(base + '/7/deduct', { method: 'POST', headers: json, body: JSON.stringify({ version: 2, quantity: 5 }) });
  await fetch(base + '/7?version=3', { method: 'DELETE' });
  await fetch(base + '/history?branch=HN&limit=5&before=9');
  assert.deepEqual(calls.map(c => c[0]), ['create', 'update', 'deduct', 'remove', 'history']);
  assert.deepEqual(calls[1].slice(1), [7, { version: 2, notes: '1T x 5' }]);
  assert.deepEqual(calls[3].slice(1), [7, 3]);
});

test('Import: nhận file multipart, chặn sai đuôi file, truyền chế độ + commit', async t => {
  const { base, calls } = await start(t);
  const form = name => { const f = new FormData(); f.append('file', new Blob(['abc']), name); return f; };
  assert.equal((await fetch(base + '/import?branch=SG&mode=add&commit=1', { method: 'POST', body: form('vt.xlsx') })).status, 200);
  assert.deepEqual(calls[0], ['importFile', 'SG', 'add', true, 'vt.xlsx', 3]);
  assert.equal((await fetch(base + '/import?branch=SG&mode=add', { method: 'POST', body: form('vt.pdf') })).status, 400);
  const none = await fetch(base + '/import?branch=SG&mode=add', { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
  assert.equal((await none.json()).code, 'IMPORT_FILE_REQUIRED');
});

test('Xuất Excel: đủ 10 cột dữ liệu (gồm Có thể bốc), tên file theo cơ sở, chặn công thức, giờ VN', async t => {
  const { base } = await start(t);
  const res = await fetch(base + '/export?branch=HN');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="vt_hn_\d{8}_\d{4}\.xlsx"/);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sheet = workbook.getWorksheet('VT Hà Nội');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Mã hàng', 'Tên hàng', 'SL kho', 'Có thể bốc', 'SL Kiot', 'Ghi chú số thùng', 'Ngày về', 'Vị trí', 'Người cập nhật', 'TG cập nhật']);
  assert.deepEqual(sheet.getRow(2).values.slice(1, 9), ['AAA1', 'Hàng A', 300, 180, 42, '3T x 100', '4/10', 'H1']);
  assert.equal(sheet.getRow(2).getCell(10).value.toISOString(), '2026-10-27T10:00:00.000Z'); // 03:00 UTC = 10:00 giờ VN
  assert.equal(sheet.getRow(3).getCell(2).value, "'=SUM(A1)");
  assert.equal(sheet.getRow(3).getCell(3).value, null);
  assert.equal(sheet.getRow(3).getCell(4).value, null); // Có thể bốc trống khi ghi chú không đọc được
});

test('Xuất Excel lịch sử: truyền bộ lọc + phạm vi, 9 cột, nhãn tiếng Việt, giờ VN, chặn công thức', async t => {
  const { base, calls } = await start(t, { scope: 'Hà Nội' });
  const res = await fetch(base + '/history/export?branch=HN&action=edit&q=th%E1%BA%AFng');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="vt_hn_lich-su_\d{8}_\d{4}\.xlsx"/);
  assert.equal(res.headers.get('x-history-truncated'), 'false');
  assert.deepEqual(calls[0], ['historyAll', 'HN', { action: 'edit', q: 'thắng' }, ['HN']]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const sheet = workbook.getWorksheet('Lịch sử VT Hà Nội');
  assert.deepEqual(sheet.getRow(1).values.slice(1), ['Thời gian', 'Người thực hiện', 'Hành động', 'Mã hàng', 'Vị trí', 'Trường', 'Giá trị cũ', 'Giá trị mới', 'Tóm tắt']);
  assert.equal(sheet.getRow(2).getCell(1).value.toISOString(), '2026-10-27T10:44:00.000Z'); // 03:44 UTC = 10:44 giờ VN
  assert.deepEqual(sheet.getRow(2).values.slice(2, 8), ['Nguyễn Ngọc Việt Thắng', 'Sửa', 'CKL2DBV', 'ST', 'Ghi chú', '41T x 250']);
  assert.equal(sheet.getRow(2).getCell(8).value, "'=40T x 250");
  assert.equal(sheet.getRow(3).getCell(3).value, 'Import bổ sung');
  assert.equal(sheet.getRow(3).getCell(9).value, 'Thêm 3 · a.xlsx');
});

test('Đã sửa + xóa lịch sử: chuyển tham số, route history không bị /:id nuốt, canDeleteHistory theo quyền', async t => {
  const { base, calls } = await start(t);
  const json = { 'Content-Type': 'application/json' };
  const list = await (await fetch(base + '?branch=HN')).json();
  assert.equal(list.canDeleteHistory, true);
  assert.equal((await fetch(base + '/7/ack', { method: 'POST', headers: json, body: JSON.stringify({ version: 2, acknowledged: true }) })).status, 200);
  assert.equal((await fetch(base + '/history?branch=SG&from=2026-10-01&to=2026-10-05', { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(base + '/history?branch=HN', { method: 'DELETE' })).status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['list', 'acknowledge', 'purgeHistory', 'purgeHistory']);
  assert.deepEqual(calls[1].slice(1), [7, { version: 2, acknowledged: true }]);
  assert.deepEqual(calls[2].slice(1), ['SG', { from: '2026-10-01', to: '2026-10-05' }]);
  assert.deepEqual(calls[3].slice(1), ['HN', { from: undefined, to: undefined }]);
});

test('Quyền: chỉ sửa được Đã sửa khi có edit; chỉ xóa lịch sử khi có historyDelete', async t => {
  const editor = { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true, 'stockLocationsV2.edit': true } };
  const { base, calls } = await start(t, { user: editor });
  const json = { 'Content-Type': 'application/json' };
  assert.equal((await (await fetch(base + '?branch=HN')).json()).canDeleteHistory, false);
  assert.equal((await fetch(base + '/7/ack', { method: 'POST', headers: json, body: JSON.stringify({ version: 1, acknowledged: true }) })).status, 200);
  assert.equal((await fetch(base + '/history?branch=HN', { method: 'DELETE' })).status, 403);
  const viewer = await start(t, { user: { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true } } });
  assert.equal((await fetch(viewer.base + '/7/ack', { method: 'POST', headers: json, body: '{}' })).status, 403);
  const granted = await start(t, { user: { vaiTro: 'Nhân viên kho', featurePermissions: { 'stockLocationsV2.view': true, 'stockLocationsV2.historyDelete': true } } });
  assert.equal((await fetch(granted.base + '/history?branch=HN', { method: 'DELETE' })).status, 200);
  assert.deepEqual(calls.map(c => c[0]), ['list', 'acknowledge']);
});
