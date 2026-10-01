'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { signToken } = require('../auth/authService');
const localUserStore = require('../auth/localUserStore');
const effectiveUserResolver = require('../auth/effectiveUserResolver');
const testUsers = new Map();
localUserStore.getUserById = async id => testUsers.get(String(id)) || null;
effectiveUserResolver.resolveUser = async user => user;
delete require.cache[require.resolve('../auth/authMiddleware')];
delete require.cache[require.resolve('./orderLifecycleRoutes')];
const { AUTH_COOKIE_NAME } = require('../auth/authMiddleware');
const router = require('./orderLifecycleRoutes');
const service = require('./orderLifecycleService');
const kiotRepository = require('./kiotPendingOrdersRepository');

function fakeRes() {
  const res = { statusCode: null, body: null, headers: {}, sentBuffer: null };
  res.status = code => { res.statusCode = code; return res; };
  res.json = payload => { res.body = payload; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; return res; };
  res.send = payload => { res.sentBuffer = payload; if (res.statusCode === null) res.statusCode = 200; return res; };
  return res;
}

function getRouteStack(method, routePath) {
  const layer = router.stack.find(l => l.route && l.route.path === routePath && l.route.methods[method]);
  if (!layer) throw new Error(`Không tìm thấy route: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack.map(l => l.handle);
}

/**
 * Chay TOAN BO middleware stack cua 1 route (requireAuth -> requireRole ->
 * handler chinh) — mo phong dung hanh vi production, khac hrLeaveRoutes.test.js
 * chi goi rieng handler cuoi (role-gating da duoc kiem o authMiddleware.test.js
 * roi). O day can kiem tra ca role-list CU THE cua tung route nen phai chay het.
 */
async function callRoute(method, routePath, req, res) {
  const stack = getRouteStack(method, routePath);
  for (const handle of stack) {
    let calledNext = false;
    await handle(req, res, () => { calledNext = true; });
    if (!calledNext) break;
  }
}

function reqAs(vaiTro, params, query, body) {
  const id = `u-${vaiTro}`;
  const user = { id, username: id, hoTen: 'Người dùng', vaiTro, coSo: 'Cả hai', trangThai: 'Đang hoạt động' };
  testUsers.set(id, user);
  const token = signToken(user);
  return { cookies: { [AUTH_COOKIE_NAME]: token }, params: params || {}, query: query || {}, body: body || {} };
}

test.beforeEach(() => {
  service.findOrder = async () => ({ found: true, branch: 'HN', summary: { code: 'DELIVERED' }, detail: {} });
  service.listAllOrders = async () => ([{ orderCode: 'HD001' }]);
  // Bang "Toan bo don hang" goi listOrdersMerged (gop don Phieu tam cua Kiot); GET '/' tra them `kiot`.
  service.listOrdersMerged = async () => ({ orders: [{ orderCode: 'HD001' }], kiot: { ok: true, stale: false, fetchedAt: null, count: 0 } });
  // Khong cham DB that: thay chi tiet dong hang cua Kiot bang ban gia.
  kiotRepository.kiotPendingOrders.readOrderDetail = async ({ branch, code }) => ({ code, branch, phieuTam: true, lines: [] });
  service.findOrdersBulk = async () => ([{ code: 'HD001', found: true }]);
  service.exportOrdersByCodes = async () => ([{ orderCode: 'HD001', branch: 'HN', summary: { label: 'Đã giao' } }]);
  service.overrideStatus = async () => ({ orderCode: 'HD001', branch: 'HN', summary: { code: 'CANCELLED', isOverride: true } });
  service.listHistory = async () => ([{ historyId: 'OVR-1', orderCode: 'HD001', statusCode: 'CANCELLED' }]);
});

test('GET /api/shipment/lifecycle/:orderCode — Khách gọi được (200)', async () => {
  const req = reqAs('Khách', { orderCode: 'HD001' });
  const res = fakeRes();
  await callRoute('get', '/:orderCode', req, res);
  assert.equal(res.statusCode, 200);
});

test('GET /api/shipment/lifecycle — Khách bị 403', async () => {
  const req = reqAs('Khách');
  const res = fakeRes();
  await callRoute('get', '/', req, res);
  assert.equal(res.statusCode, 403);
});

// Tra cuu 1 don (GET /:orderCode, POST /lookup) mo cho MOI vai tro da dang
// nhap. Xem toan bo don (GET /, GET /history, POST /export) mo cho MOI vai
// tro NOI BO (tuc INTERNAL_ROLES — tru Khach ra thi ai cung xem duoc toan bo
// don, khong chi 5 vai tro "lien quan truc tiep" nhu truoc).
const INTERNAL_ROLES = [
  'Kế toán', 'Trưởng kho', 'Quản lý', 'Trợ lý', 'Nhân viên sale',
  'Lái xe', 'Nhân viên kho', 'Nhân viên mua hàng'
];

for (const role of INTERNAL_ROLES) {
  test(`GET /api/shipment/lifecycle/:orderCode — ${role} gọi được (200)`, async () => {
    const req = reqAs(role, { orderCode: 'HD001' });
    const res = fakeRes();
    await callRoute('get', '/:orderCode', req, res);
    assert.equal(res.statusCode, 200);
  });

  test(`GET /api/shipment/lifecycle — ${role} gọi được (200)`, async () => {
    const req = reqAs(role);
    const res = fakeRes();
    await callRoute('get', '/', req, res);
    assert.equal(res.statusCode, 200);
  });
}

test('GET /api/shipment/lifecycle/history — Khách bị 403', async () => {
  const req = reqAs('Khách');
  const res = fakeRes();
  await callRoute('get', '/history', req, res);
  assert.equal(res.statusCode, 403);
});

for (const role of INTERNAL_ROLES) {
  test(`GET /api/shipment/lifecycle/history — ${role} gọi được (200)`, async () => {
    const req = reqAs(role);
    const res = fakeRes();
    await callRoute('get', '/history', req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.history, [{ historyId: 'OVR-1', orderCode: 'HD001', statusCode: 'CANCELLED' }]);
  });
}

test('GET /api/shipment/lifecycle/history KHÔNG bị route /:orderCode nuốt mất (không lẫn với tra cứu mã đơn "history")', async () => {
  const req = reqAs('Quản lý');
  const res = fakeRes();
  await callRoute('get', '/history', req, res);
  assert.deepEqual(Object.keys(res.body), ['history']);
});

test('GET /api/shipment/lifecycle gộp đơn Phiếu tạm của Kiot (truyền kiot repository) và trả thêm trạng thái nguồn `kiot`', async () => {
  let received = null;
  service.listOrdersMerged = async (branch, options) => {
    received = { branch, options };
    return { orders: [{ orderCode: 'DH1', source: 'kiotviet' }], kiot: { ok: false, stale: false, fetchedAt: null, count: 0 } };
  };
  const res = fakeRes();
  await callRoute('get', '/', reqAs('Nhân viên sale', {}, { branch: 'SG' }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { orders: [{ orderCode: 'DH1', source: 'kiotviet' }], kiot: { ok: false, stale: false, fetchedAt: null, count: 0 } });
  assert.equal(received.branch, 'SG');
  assert.equal(received.options.kiot, kiotRepository.kiotPendingOrders, 'phai truyen repository doc don Phieu tam cua Kiot');
});

test('GET /api/shipment/lifecycle?branch=XX không hợp lệ -> 400', async () => {
  const req = reqAs('Quản lý', {}, { branch: 'XX' });
  const res = fakeRes();
  await callRoute('get', '/', req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_BRANCH');
});

test('GET /api/shipment/lifecycle/:orderCode không đăng nhập -> 401', async () => {
  const req = { cookies: {}, params: { orderCode: 'HD001' }, query: {} };
  const res = fakeRes();
  await callRoute('get', '/:orderCode', req, res);
  assert.equal(res.statusCode, 401);
});

test('POST /api/shipment/lifecycle/lookup — Khách gọi được (200)', async () => {
  const req = reqAs('Khách', {}, {}, { codes: ['HD001'] });
  const res = fakeRes();
  await callRoute('post', '/lookup', req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.results, [{ code: 'HD001', found: true }]);
});

for (const role of INTERNAL_ROLES) {
  test(`POST /api/shipment/lifecycle/lookup — ${role} gọi được (200)`, async () => {
    const req = reqAs(role, {}, {}, { codes: ['HD001'] });
    const res = fakeRes();
    await callRoute('post', '/lookup', req, res);
    assert.equal(res.statusCode, 200);
  });
}

test('POST /api/shipment/lifecycle/export — Khách bị 403', async () => {
  const req = reqAs('Khách', {}, {}, { codes: ['HD001'] });
  const res = fakeRes();
  await callRoute('post', '/export', req, res);
  assert.equal(res.statusCode, 403);
});

for (const role of INTERNAL_ROLES) {
  test(`POST /api/shipment/lifecycle/export — ${role} gọi được (200, trả file xlsx)`, async () => {
    const req = reqAs(role, {}, {}, { codes: ['HD001'] });
    const res = fakeRes();
    await callRoute('post', '/export', req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.ok(res.sentBuffer && res.sentBuffer.length > 0);
  });
}

test('POST /api/shipment/lifecycle/export truyền kiot repository để xuất cả đơn Phiếu tạm đã gộp', async () => {
  let received = null;
  service.exportOrdersByCodes = async (codes, options) => {
    received = { codes, options };
    return [{ orderCode: 'DH1', branch: 'HN', summary: { label: 'Đơn chưa gửi kế toán' } }];
  };
  const res = fakeRes();
  await callRoute('post', '/export', reqAs('Quản lý', {}, {}, { codes: ['DH1'] }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(received.codes, ['DH1']);
  assert.equal(received.options.kiot, kiotRepository.kiotPendingOrders);
});

// ---------------------------------------------------------------------------
// GET /api/shipment/lifecycle/order-detail — chi tiet dong hang theo Kiot (chi vai tro xem duoc bang toan bo don)
// ---------------------------------------------------------------------------

test('GET /order-detail — Khách bị 403 (không lộ giá/tồn kho cho khách tra cứu)', async () => {
  const res = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Khách', {}, { code: 'DH1', branch: 'HN' }), res);
  assert.equal(res.statusCode, 403);
});

test('GET /order-detail — không đăng nhập -> 401', async () => {
  const res = fakeRes();
  await callRoute('get', '/order-detail', { cookies: {}, params: {}, query: { code: 'DH1', branch: 'HN' } }, res);
  assert.equal(res.statusCode, 401);
});

for (const role of INTERNAL_ROLES) {
  test(`GET /order-detail — ${role} gọi được (200) và truyền đúng cơ sở/mã`, async () => {
    let received = null;
    kiotRepository.kiotPendingOrders.readOrderDetail = async args => { received = args; return { code: args.code, branch: args.branch, phieuTam: true, lines: [] }; };
    const res = fakeRes();
    await callRoute('get', '/order-detail', reqAs(role, {}, { code: ' DH041173 ', branch: 'HN' }), res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(received, { branch: 'HN', code: 'DH041173' });
    assert.equal(res.body.detail.code, 'DH041173');
  });
}

test('GET /order-detail KHÔNG bị route /:orderCode nuốt mất (không lẫn với tra cứu mã đơn "order-detail")', async () => {
  let lookupCalled = false;
  service.findOrder = async () => { lookupCalled = true; return { found: false }; };
  const res = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Quản lý', {}, { code: 'DH1', branch: 'SG' }), res);
  assert.equal(lookupCalled, false);
  assert.deepEqual(Object.keys(res.body), ['detail']);
});

test('GET /order-detail — thiếu/sai mã hoặc cơ sở -> 400', async () => {
  const noCode = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Quản lý', {}, { branch: 'HN' }), noCode);
  assert.equal(noCode.statusCode, 400);
  assert.equal(noCode.body.code, 'INVALID_CODE');

  const badBranch = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Quản lý', {}, { code: 'DH1', branch: 'Hà Nội' }), badBranch);
  assert.equal(badBranch.statusCode, 400);
  assert.equal(badBranch.body.code, 'INVALID_BRANCH');

  const longCode = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Quản lý', {}, { code: 'D'.repeat(101), branch: 'HN' }), longCode);
  assert.equal(longCode.statusCode, 400);
});

test('GET /order-detail — lỗi 404 của kho dữ liệu được trả đúng statusCode/code', async () => {
  kiotRepository.kiotPendingOrders.readOrderDetail = async () => {
    const err = new Error('Không tìm thấy đơn đặt hàng này.');
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  };
  const res = fakeRes();
  await callRoute('get', '/order-detail', reqAs('Quản lý', {}, { code: 'DH999', branch: 'HN' }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'ORDER_NOT_FOUND');
});

test('POST /api/shipment/lifecycle/export — lỗi từ service được trả về đúng statusCode', async () => {
  service.exportOrdersByCodes = async () => { throw new Error('Lỗi Google Sheets'); };
  const req = reqAs('Quản lý', {}, {}, { codes: ['HD001'] });
  const res = fakeRes();
  await callRoute('post', '/export', req, res);
  assert.equal(res.statusCode, 500);
});

test('POST /api/shipment/lifecycle/lookup — body không hợp lệ -> lỗi từ service được trả về đúng statusCode', async () => {
  service.findOrdersBulk = async () => {
    const err = new Error('Danh sách mã đơn hàng không hợp lệ.');
    err.statusCode = 400;
    err.code = 'INVALID_CODES';
    throw err;
  };
  const req = reqAs('Quản lý', {}, {}, { codes: 'khong-phai-mang' });
  const res = fakeRes();
  await callRoute('post', '/lookup', req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_CODES');
});

// ---------------------------------------------------------------------------
// POST /api/shipment/lifecycle/:orderCode/override — chi Quan ly/Ke toan
// ---------------------------------------------------------------------------

const OVERRIDE_ROLES = ['Quản lý', 'Kế toán'];
const NON_OVERRIDE_INTERNAL_ROLES = [
  'Trưởng kho', 'Trợ lý', 'Nhân viên sale', 'Lái xe', 'Nhân viên kho', 'Nhân viên mua hàng'
];

for (const role of OVERRIDE_ROLES) {
  test(`POST /api/shipment/lifecycle/:orderCode/override — ${role} gọi được (200)`, async () => {
    const req = reqAs(role, { orderCode: 'HD001' }, {}, { status: 'CANCELLED' });
    const res = fakeRes();
    await callRoute('post', '/:orderCode/override', req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.summary.code, 'CANCELLED');
  });
}

for (const role of NON_OVERRIDE_INTERNAL_ROLES) {
  test(`POST /api/shipment/lifecycle/:orderCode/override — ${role} bị 403 (xem được nhưng không sửa được)`, async () => {
    const req = reqAs(role, { orderCode: 'HD001' }, {}, { status: 'CANCELLED' });
    const res = fakeRes();
    await callRoute('post', '/:orderCode/override', req, res);
    assert.equal(res.statusCode, 403);
  });
}

test('POST /api/shipment/lifecycle/:orderCode/override — Khách bị 403', async () => {
  const req = reqAs('Khách', { orderCode: 'HD001' }, {}, { status: 'CANCELLED' });
  const res = fakeRes();
  await callRoute('post', '/:orderCode/override', req, res);
  assert.equal(res.statusCode, 403);
});

test('POST /api/shipment/lifecycle/:orderCode/override — thiếu "status" -> 400 INVALID_REQUEST', async () => {
  const req = reqAs('Quản lý', { orderCode: 'HD001' }, {}, {});
  const res = fakeRes();
  await callRoute('post', '/:orderCode/override', req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_REQUEST');
});

test('POST /api/shipment/lifecycle/:orderCode/override — truyền đúng changedBy/changedByRole từ req.user', async () => {
  let received = null;
  service.overrideStatus = async (orderCode, opts) => {
    received = { orderCode, opts };
    return { orderCode, branch: 'HN', summary: { code: opts.code, isOverride: true } };
  };
  const req = reqAs('Kế toán', { orderCode: 'HD001' }, {}, { status: 'EXCEPTION', note: 'khách báo hỏng hàng' });
  const res = fakeRes();
  await callRoute('post', '/:orderCode/override', req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(received.orderCode, 'HD001');
  assert.equal(received.opts.code, 'EXCEPTION');
  assert.equal(received.opts.changedByRole, 'Kế toán');
  assert.equal(received.opts.note, 'khách báo hỏng hàng');
});

test('POST /api/shipment/lifecycle/:orderCode/override — lỗi từ service được trả về đúng statusCode', async () => {
  service.overrideStatus = async () => {
    const err = new Error('Không tìm thấy đơn hàng "HD999".');
    err.statusCode = 404;
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  };
  const req = reqAs('Quản lý', { orderCode: 'HD999' }, {}, { status: 'CANCELLED' });
  const res = fakeRes();
  await callRoute('post', '/:orderCode/override', req, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'ORDER_NOT_FOUND');
});
