'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const debtScheduleRepository = require('../debtSchedule/debtScheduleRepository');
const router = require('./debtManagementRoutes');

function fakeRes() {
  const res = { statusCode: 200, body: null, cookies: [] };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.cookie = (...args) => { res.cookies.push(args); return res; };
  return res;
}

function routeStack(path, method = 'patch') {
  const layer = router.stack.find(item => item.route?.path === path && item.route.methods[method]);
  assert.ok(layer, `${method} ${path}`);
  return layer.route.stack.map(item => item.handle);
}

function withRepo(fake, run) {
  const original = debtScheduleRepository.getDebtScheduleRepository;
  debtScheduleRepository.getDebtScheduleRepository = () => fake;
  return Promise.resolve(run()).finally(() => { debtScheduleRepository.getDebtScheduleRepository = original; });
}

function allowed(guard, role) {
  let nextCalled = false;
  guard({ user: { vaiTro: role } }, fakeRes(), () => { nextCalled = true; });
  return nextCalled;
}

test('quyen mac dinh: Sale phan hoi chi Nhan vien sale; QL phan hoi, trang thai, lich TT chi Quan ly', () => {
  const cases = [
    ['/api/debt-management/sale-feedback', { 'Nhân viên sale': true, 'Quản lý': false, 'Trợ lý': false }],
    ['/api/debt-management/manager-feedback', { 'Nhân viên sale': false, 'Quản lý': true, 'Trợ lý': false }],
    ['/api/debt-management/status', { 'Nhân viên sale': false, 'Quản lý': true, 'Trợ lý': false }],
    ['/api/debt-management/schedule', { 'Nhân viên sale': false, 'Quản lý': true, 'Trợ lý': false }]
  ];
  for (const [path, expected] of cases) {
    const [, featureGuard] = routeStack(path);
    for (const [role, ok] of Object.entries(expected)) assert.equal(allowed(featureGuard, role), ok, `${path} ${role}`);
  }
});

test('GET /cycles: can quyen xuat file, tra danh sach ban chot tu repository', async () => {
  const [authGuard, featureGuard, handler] = routeStack('/api/debt-management/cycles', 'get');
  const res0 = fakeRes();
  await authGuard({ cookies: {} }, res0, () => assert.fail('khong duoc next'));
  assert.equal(res0.statusCode, 401);
  assert.equal(typeof featureGuard, 'function');
  const cycles = [{ cycleDate: '2026-10-13', takenAt: 'x' }, { cycleDate: '2026-10-12', takenAt: 'y' }];
  await withRepo({ listCycles: async () => cycles }, async () => {
    const res = fakeRes();
    await handler({ user: { vaiTro: 'Quản lý' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { cycles });
  });
});

test('PATCH chua dang nhap tra 401', async () => {
  const [authGuard] = routeStack('/api/debt-management/sale-feedback');
  const res = fakeRes();
  await authGuard({ cookies: {} }, res, () => assert.fail('khong duoc next'));
  assert.equal(res.statusCode, 401);
});

test('PATCH sale-feedback chuyen dung tham so xuong repository, nguoi sua lay tu session', async () => {
  const handler = routeStack('/api/debt-management/sale-feedback').at(-1);
  let received;
  await withRepo({ saveFeedback: async payload => { received = payload; return { cycleDate: '2026-10-13', value: 'Hẹn thứ 6', by: 'Lan', changed: true }; } }, async () => {
    const res = fakeRes();
    await handler({ user: { id: 'u1', hoTen: 'Lan' }, body: { branch: 'hanoi', customerId: '42', cycleDate: '2026-10-13', value: 'Hẹn thứ 6' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.value, 'Hẹn thứ 6');
  });
  assert.deepEqual(received, {
    branch: 'hanoi', customerId: '42', cycleDate: '2026-10-13', field: 'sale', value: 'Hẹn thứ 6', user: { id: 'u1', hoTen: 'Lan' }
  });
});

test('loi nghiep vu (409 sang chu ky moi) tra nguyen ma loi; loi DB tra 503', async () => {
  const handler = routeStack('/api/debt-management/manager-feedback').at(-1);
  const conflict = Object.assign(new Error('Bảng công nợ đã sang chu kỳ mới'), { statusCode: 409, code: 'DEBT_CYCLE_CHANGED' });
  await withRepo({ saveFeedback: async () => { throw conflict; } }, async () => {
    const res = fakeRes();
    await handler({ user: {}, body: { branch: 'hanoi', customerId: '1', cycleDate: '2026-10-12', value: 'x' } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'DEBT_CYCLE_CHANGED');
  });
  await withRepo({ saveFeedback: async () => { throw new Error('db down'); } }, async () => {
    const res = fakeRes();
    await handler({ user: {}, body: { branch: 'hanoi', customerId: '1', value: 'x' } }, res);
    assert.equal(res.statusCode, 503);
  });
});

test('PATCH status tu choi trang thai ngoai danh sach truoc khi cham DB', async () => {
  const handler = routeStack('/api/debt-management/status').at(-1);
  await withRepo({ saveStatus: async () => assert.fail('khong duoc ghi') }, async () => {
    const res = fakeRes();
    await handler({ user: {}, body: { branch: 'hanoi', customerId: '1', status: 'Không hợp lệ' } }, res);
    assert.equal(res.statusCode, 400);
  });
});

test('PATCH schedule gui so ngay + nguoi sua xuong repository', async () => {
  const handler = routeStack('/api/debt-management/schedule').at(-1);
  let received;
  await withRepo({ setSchedule: async payload => { received = payload; return { scheduleDays: 3, changed: true }; } }, async () => {
    const res = fakeRes();
    await handler({ user: { hoTen: 'QL' }, body: { branch: 'saigon', customerId: '7', scheduleDays: '3' } }, res);
    assert.equal(res.statusCode, 200);
  });
  assert.deepEqual(received, { branch: 'saigon', customerId: '7', days: '3', user: { hoTen: 'QL' } });
});

test('GET feedback-history doc theo co so dang xem', async () => {
  const handler = routeStack('/api/debt-management/feedback-history', 'get').at(-1);
  let received;
  await withRepo({ listFeedbackHistory: async payload => { received = payload; return { cycleDate: '2026-10-13', entries: [] }; } }, async () => {
    const res = fakeRes();
    await handler({ branch: 'Cả hai', user: {} }, res);
    assert.equal(res.statusCode, 200);
  });
  assert.deepEqual(received, { branches: ['hanoi', 'saigon'] });
});
