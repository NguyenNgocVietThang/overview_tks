'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const repository = require('./debtCollectionStatusRepository');
const dashboardData = require('./dashboardData');
const router = require('./debtManagementRoutes');

function fakeRes() {
  const res = { statusCode: 200, body: null, cookies: [] };
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { res.body = body; return res; };
  res.cookie = (...args) => { res.cookies.push(args); return res; };
  return res;
}

function routeStack() {
  const layer = router.stack.find(item => item.route?.path === '/api/debt-management/status' && item.route.methods.patch);
  return layer.route.stack.map(item => item.handle);
}

test('PATCH trả 401 khi chưa đăng nhập và 403 khi vai trò không được phép', async () => {
  const [authGuard, roleGuard] = routeStack();
  const unauthenticated = fakeRes();
  await authGuard({ cookies: {} }, unauthenticated, () => assert.fail('không được next'));
  assert.equal(unauthenticated.statusCode, 401);

  const forbidden = fakeRes();
  roleGuard({ user: { vaiTro: 'Kế toán' } }, forbidden, () => assert.fail('không được next'));
  assert.equal(forbidden.statusCode, 403);

  for (const role of ['Quản lý', 'Trợ lý']) {
    let nextCalled = false;
    roleGuard({ user: { vaiTro: role } }, fakeRes(), () => { nextCalled = true; });
    assert.equal(nextCalled, true, role);
  }
});

test('PATCH kiểm tra allowlist, customerKey và chữ ký 64 hex', async () => {
  const handler = routeStack().at(-1);
  for (const body of [
    { customerKey: '', status: 'Đang xử lý', alertSignature: 'a'.repeat(64) },
    { customerKey: 'x'.repeat(64), status: 'Không hợp lệ', alertSignature: 'a'.repeat(64) },
    { customerKey: 'x'.repeat(64), status: 'Đang xử lý', alertSignature: 'not-a-signature' }
  ]) {
    const res = fakeRes();
    await handler({ branch: 'Hà Nội', user: { id: 'u1', hoTen: 'A' }, body }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('PATCH lấy cơ sở từ session, upsert và xóa cache sau khi thành công', async () => {
  const handler = routeStack().at(-1);
  const originalUpsert = repository.upsertStatus;
  const originalInvalidate = dashboardData.invalidateDebtWorkflowCache;
  let received;
  let invalidatedBranch;
  repository.upsertStatus = async payload => {
    received = payload;
    return { ...payload, updated_at: '2026-09-15T00:00:00.000Z', updated_by_name: payload.userName };
  };
  dashboardData.invalidateDebtWorkflowCache = branch => { invalidatedBranch = branch; };

  try {
    const req = {
      branch: 'Sài Gòn',
      user: { id: '9ad42989-90ef-4da8-bf87-da505551ed15', hoTen: 'Trợ lý A', vaiTro: 'Trợ lý' },
      body: {
        customerKey: 'd'.repeat(64),
        status: 'Đang xử lý',
        alertSignature: 'e'.repeat(64),
        branch: 'hanoi'
      }
    };
    const res = fakeRes();
    await handler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(received.branch, 'saigon');
    assert.equal(received.status, 'Đang xử lý');
    assert.equal(received.userName, 'Trợ lý A');
    assert.equal(invalidatedBranch, 'Sài Gòn');
  } finally {
    repository.upsertStatus = originalUpsert;
    dashboardData.invalidateDebtWorkflowCache = originalInvalidate;
  }
});

// ----- Pham vi "Cả hai": ghi nguyen tu cho ca hai co so vat ly -----

function bothBranchesHarness({
  upsertForBranches,
  customerBranches = { found: ['Hà Nội', 'Sài Gòn'], undetermined: [] }
} = {}) {
  const originals = {
    upsertStatus: repository.upsertStatus,
    upsertStatusForBranches: repository.upsertStatusForBranches,
    invalidate: dashboardData.invalidateDebtWorkflowCache,
    findBranches: dashboardData.findDebtCustomerBranches
  };
  const log = [];
  const state = { singleBranchCalls: 0, writtenBranches: null, invalidated: [], log };
  repository.upsertStatus = async () => { state.singleBranchCalls += 1; return {}; };
  repository.upsertStatusForBranches = async payload => {
    state.writtenBranches = payload.branches;
    log.push('write');
    if (upsertForBranches) return upsertForBranches(payload);
    return payload.branches.map(branch => ({
      branch,
      customer_key: payload.customerKey,
      status: payload.status,
      alert_signature: payload.alertSignature,
      updated_by_name: payload.userName,
      updated_at: '2026-09-21T00:00:00.000Z'
    }));
  };
  dashboardData.findDebtCustomerBranches = async () => customerBranches;
  dashboardData.invalidateDebtWorkflowCache = branch => {
    state.invalidated.push(branch);
    log.push(`invalidate:${branch}`);
  };
  state.restore = () => {
    repository.upsertStatus = originals.upsertStatus;
    repository.upsertStatusForBranches = originals.upsertStatusForBranches;
    dashboardData.invalidateDebtWorkflowCache = originals.invalidate;
    dashboardData.findDebtCustomerBranches = originals.findBranches;
  };
  return state;
}

function bothBranchesRequest() {
  return {
    branch: 'Cả hai',
    user: { id: '9ad42989-90ef-4da8-bf87-da505551ed15', hoTen: 'Quản lý A', vaiTro: 'Quản lý' },
    body: { customerKey: 'a'.repeat(64), status: 'Đã xử lý', alertSignature: 'b'.repeat(64) }
  };
}

test('PATCH ở "Cả hai" ghi cả hai cơ sở vật lý rồi xóa cache sau khi commit', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness();
  try {
    const res = fakeRes();
    await handler(bothBranchesRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.writtenBranches, ['hanoi', 'saigon']);
    assert.equal(harness.singleBranchCalls, 0, 'không được dùng đường ghi một cơ sở');
    assert.deepEqual(harness.invalidated, ['Hà Nội', 'Sài Gòn']);
    assert.deepEqual(harness.log, ['write', 'invalidate:Hà Nội', 'invalidate:Sài Gòn'], 'chỉ xóa cache SAU khi ghi xong');
    assert.deepEqual(res.body.branches, ['Hà Nội', 'Sài Gòn']);
    assert.equal(res.body.status, 'Đã xử lý');
  } finally {
    harness.restore();
  }
});

test('PATCH ở "Cả hai" không xóa cache khi transaction thất bại', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness({
    upsertForBranches: async () => { throw new Error('rollback'); }
  });
  try {
    const res = fakeRes();
    await handler(bothBranchesRequest(), res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'DEBT_STATUS_UNAVAILABLE');
    assert.deepEqual(harness.invalidated, []);
  } finally {
    harness.restore();
  }
});

test('PATCH ở "Cả hai" chỉ ghi cơ sở thực sự có khách hàng này', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness({ customerBranches: { found: ['Sài Gòn'], undetermined: [] } });
  try {
    const res = fakeRes();
    await handler(bothBranchesRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.writtenBranches, ['saigon']);
    assert.deepEqual(harness.invalidated, ['Sài Gòn']);
    assert.deepEqual(res.body.branches, ['Sài Gòn']);
  } finally {
    harness.restore();
  }
});

test('PATCH ở "Cả hai" trả 404 khi không cơ sở nào có khách hàng này', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness({ customerBranches: { found: [], undetermined: [] } });
  try {
    const res = fakeRes();
    await handler(bothBranchesRequest(), res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, 'DEBT_CUSTOMER_NOT_FOUND');
    assert.equal(harness.writtenBranches, null);
    assert.deepEqual(harness.invalidated, []);
  } finally {
    harness.restore();
  }
});

test('PATCH ở "Cả hai" vẫn ghi cơ sở không đọc được nguồn công nợ (không âm thầm bỏ qua)', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness({ customerBranches: { found: ['Hà Nội'], undetermined: ['Sài Gòn'] } });
  try {
    const res = fakeRes();
    await handler(bothBranchesRequest(), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(harness.writtenBranches, ['hanoi', 'saigon']);
  } finally {
    harness.restore();
  }
});

test('PATCH một cơ sở vật lý giữ nguyên đường ghi cũ (không mở transaction hai cơ sở)', async () => {
  const handler = routeStack().at(-1);
  const harness = bothBranchesHarness();
  try {
    const res = fakeRes();
    await handler({
      branch: 'Hà Nội',
      user: { id: '9ad42989-90ef-4da8-bf87-da505551ed15', hoTen: 'Quản lý A', vaiTro: 'Quản lý' },
      body: { customerKey: 'a'.repeat(64), status: 'Đã xử lý', alertSignature: 'b'.repeat(64) }
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(harness.singleBranchCalls, 1);
    assert.equal(harness.writtenBranches, null, 'một cơ sở không được đi qua ghi hai cơ sở');
    assert.deepEqual(harness.invalidated, ['Hà Nội']);
    assert.equal(res.body.branches, undefined, 'phản hồi một cơ sở giữ nguyên hình dạng cũ');
  } finally {
    harness.restore();
  }
});

test('PATCH trả 503 khi PostgreSQL lỗi', async () => {
  const handler = routeStack().at(-1);
  const originalUpsert = repository.upsertStatus;
  repository.upsertStatus = async () => { throw new Error('database unavailable'); };
  try {
    const res = fakeRes();
    await handler({
      branch: 'Hà Nội',
      user: { id: '9ad42989-90ef-4da8-bf87-da505551ed15', hoTen: 'Quản lý' },
      body: { customerKey: 'f'.repeat(64), status: 'Bỏ qua', alertSignature: 'a'.repeat(64) }
    }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'DEBT_STATUS_UNAVAILABLE');
  } finally {
    repository.upsertStatus = originalUpsert;
  }
});
