'use strict';

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEffectiveUserResolver } = require('./effectiveUserResolver');

function memoryStore(users) {
  const state = users.map(user => ({ ...user }));
  const updates = [];
  return {
    state,
    updates,
    getAllUsers: async () => state.map(user => ({ ...user })),
    updateUser: async (id, changes) => {
      updates.push({ id, changes });
      const index = state.findIndex(user => user.id === id);
      state[index] = { ...state[index], ...changes };
      return { ...state[index] };
    }
  };
}

const employee = {
  sourceBranch: 'Hà Nội', rowIndex: 2, hoTen: 'Nhân viên A', boPhan: 'KẾ TOÁN',
  email: 'a@example.com', soDienThoai: '0912345678', telegramId: '123456',
  sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
};

// Hồ sơ nhân sự không còn được đọc khi đăng nhập: mọi lần đọc đều là lỗi của test.
function forbiddenDirectory() {
  const calls = { reads: 0 };
  return { calls, directory: { getSnapshot: async () => { calls.reads += 1; throw new Error('không được đọc hồ sơ nhân sự'); } } };
}

test('tài khoản thường giữ nguyên quyền và phạm vi đã cấp, không đọc hồ sơ nhân sự khi đăng nhập', async () => {
  let reads = 0;
  const store = memoryStore([{
    id: 'u-account', username: 'account@tokosi.vn', email: 'account@tokosi.vn',
    vaiTro: 'Kế toán', coSo: 'Hà Nội', boPhan: 'Kế toán', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => { reads += 1; throw new Error('không được đọc HR'); } }
  });
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(resolved.boPhan, 'Kế toán');
  assert.equal(reads, 0);
  assert.equal(store.updates.length, 0);
});

test('khách đã xác minh không được tự nâng quyền từ hồ sơ nhân sự; quyền do Quản lý cấp trên tài khoản', async () => {
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Khách');
  assert.equal(resolved.hrManaged, undefined);
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


test('unverified guest is not promoted merely because an identifier appears in HR', async () => {
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', soDienThoai: '',
    vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Khách');
  assert.equal(resolved.hrManaged, undefined);
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


test('vai trò và cơ sở đã lưu trên tài khoản (đã chốt ghi đè ở migration 0080) được dùng nguyên vẹn', async () => {
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true, hrManaged: true,
    vaiTro: 'Trợ lý', coSo: 'Hà Nội', trangThai: 'Đang hoạt động',
    vaiTroOverride: 'Trợ lý', coSoOverride: 'Hà Nội', sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
  }]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Trợ lý');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


test('khong khop dong nhan su KHONG tu khoa tai khoan; chi go khoa hr_removed cu, khoa thu cong giu nguyen', async () => {
  let employees = [];
  let reads = 0;
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true,
    hrManaged: true, vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => { reads += 1; return { employees }; } } });

  const stillActive = await resolver.resolveUser(store.state[0]);
  assert.equal(stillActive.trangThai, 'Đang hoạt động');
  assert.equal(stillActive.vaiTro, 'Kế toán');

  // Tai khoan tung bi khoa hr_removed boi co che cu duoc go khoa du van khong khop.
  store.state[0].trangThai = 'Khóa';
  store.state[0].lockReason = 'hr_removed';
  const unlocked = await resolver.resolveUser(store.state[0]);
  assert.equal(unlocked.trangThai, 'Đang hoạt động');
  assert.equal(unlocked.lockReason, '');

  employees = [employee];
  const restored = await resolver.resolveUser(store.state[0]);
  assert.equal(restored.trangThai, 'Đang hoạt động');
  assert.equal(restored.lockReason, '');

  store.state[0].trangThai = 'Khóa';
  store.state[0].lockReason = 'manual';
  const manualLock = await resolver.resolveUser(store.state[0]);
  assert.equal(manualLock.trangThai, 'Khóa');
  assert.equal(manualLock.lockReason, 'manual');

  // Khóa do nghỉ việc chỉ được mở khi nhân sự chuyển lại Đang làm việc (hrEmployeeAdminService), không mở khi đăng nhập.
  store.state[0].lockReason = 'hr_resigned';
  const resignedLock = await resolver.resolveUser(store.state[0]);
  assert.equal(resignedLock.trangThai, 'Khóa');
  assert.equal(resignedLock.lockReason, 'hr_resigned');
  assert.equal(reads, 0, 'không đọc hồ sơ nhân sự');
});

test('hardcoded admin bypasses the directory and always remains manager of both branches', async () => {
  const store = memoryStore([{
    id: 'admin-default', username: 'admin', email: 'admin@tokosi.vn',
    vaiTro: 'Khách', coSo: '', trangThai: 'Khóa'
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => { throw new Error('must not read'); } }
  });
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Quản lý');
  assert.equal(resolved.coSo, 'Cả hai');
  assert.equal(resolved.trangThai, 'Đang hoạt động');
});

test('hai tài khoản cùng định danh với một dòng nhân sự: đăng nhập không còn gắn HR nên không tài khoản nào được nâng quyền', async () => {
  const store = memoryStore([
    { id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true, vaiTro: 'Khách', trangThai: 'Đang hoạt động' },
    { id: 'u2', username: '0912345678', soDienThoai: '0912345678', verifiedPhone: true, vaiTro: 'Khách', trangThai: 'Đang hoạt động' }
  ]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });
  for (const user of store.state) {
    const resolved = await resolver.resolveUser(user);
    assert.equal(resolved.vaiTro, 'Khách');
    assert.equal(resolved.hrManaged, undefined);
  }
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


// --- Rang buoc hrRowIndex: TK da gan mot dong nhan su khong duoc "nhay" sang dong khac ---

const saleEmployee = {
  sourceBranch: 'Hà Nội', rowIndex: 10, hoTen: 'Sale A', boPhan: 'SALE',
  email: 'sale@example.com', soDienThoai: '0911111111', telegramId: '',
  sheetVaiTro: 'Sale', sheetCoSo: 'Hà Nội'
};
const managerEmployee = {
  sourceBranch: 'Hà Nội', rowIndex: 20, hoTen: 'Quản lý B', boPhan: 'QUẢN LÝ',
  email: 'boss@example.com', soDienThoai: '0922222222', telegramId: '',
  sheetVaiTro: 'Quản lý', sheetCoSo: 'Cả hai'
};

function boundSaleAccount(overrides = {}) {
  return {
    id: 'sale', username: 'sale@example.com', email: 'sale@example.com', soDienThoai: '0911111111',
    verifiedEmail: true, hrManaged: true, hrRowIndex: 10, hrSourceBranch: 'Hà Nội',
    sheetVaiTro: 'Sale', sheetCoSo: 'Hà Nội', vaiTro: 'Sale', coSo: 'Hà Nội',
    roleSource: 'sheet', trangThai: 'Đang hoạt động', ...overrides
  };
}

function boundManagerAccount() {
  return {
    id: 'boss', username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '0922222222',
    verifiedEmail: true, hrManaged: true, hrRowIndex: 20, hrSourceBranch: 'Hà Nội',
    sheetVaiTro: 'Quản lý', sheetCoSo: 'Cả hai', vaiTro: 'Quản lý', coSo: 'Cả hai',
    roleSource: 'sheet', trangThai: 'Đang hoạt động'
  };
}

function silenceWarn(t) {
  const original = console.warn;
  const calls = [];
  console.warn = (...args) => { calls.push(args); };
  t.after(() => { console.warn = original; });
  return calls;
}

test('TK Sale da gan dong A doi email sang email Quan ly (dong B) KHONG duoc gan sang B', async t => {
  const warns = silenceWarn(t);
  // Email da bi doi sang email Quan ly, SĐT bo trong -> chi khop dong B.
  const store = memoryStore([
    boundSaleAccount({ username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '' })
  ]);
  const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Sale');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(String(resolved.hrRowIndex), '10');
  assert.equal(resolved.hoTen, undefined);
  // Khong persist gi tu dong B.
  assert.equal(store.state[0].vaiTro, 'Sale');
  assert.equal(String(store.state[0].hrRowIndex), '10');
  assert.equal(store.state[0].sheetVaiTro, 'Sale');
  assert.equal(store.updates.length, 0);
  assert.equal(warns.length, 0, 'không còn đối chiếu HR nên không có cảnh báo nhảy dòng');
});

test('TK da gan dong A ma email tro B, SĐT tro A: giu rang buoc A thay vi loi HR_IDENTITY_CONFLICT', async t => {
  silenceWarn(t);
  const store = memoryStore([boundSaleAccount({ username: 'boss@example.com', email: 'boss@example.com' })]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Sale');
  assert.equal(String(resolved.hrRowIndex), '10');
  assert.equal(store.state[0].vaiTro, 'Sale');
});

test('TK Quan ly that (dong B) van resolve binh thuong khi co TK khac trung email', async t => {
  silenceWarn(t);
  const store = memoryStore([
    boundSaleAccount({ username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '' }),
    boundManagerAccount()
  ]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });

  const boss = await resolver.resolveUser(store.state[1]);
  assert.equal(boss.vaiTro, 'Quản lý');
  assert.equal(boss.coSo, 'Cả hai');
  assert.equal(String(boss.hrRowIndex), '20');

  const account = await resolver.findAccountForEmployee(managerEmployee);
  assert.equal(account.id, 'boss');

  // TK Sale van giu vai tro cu.
  const sale = await resolver.resolveUser(store.state[0]);
  assert.equal(sale.vaiTro, 'Sale');
});

test('TK mới chưa gắn hồ sơ không tự gắn dòng nhân sự khi đăng nhập (gắn liên kết do Quản lý làm)', async () => {
  const store = memoryStore([{
    id: 'new', username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '',
    verifiedEmail: true, hrRowIndex: '', vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.hrManaged, undefined);
  assert.equal(resolved.hrRowIndex, '');
  assert.equal(resolved.vaiTro, 'Khách');
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


test('TK đã gắn dòng A: đổi vai trò/họ tên trên hồ sơ nhân sự không đổi tài khoản', async () => {
  const store = memoryStore([boundSaleAccount({ hoTen: 'Sale A' })]);
  const { calls, directory } = forbiddenDirectory();
  const resolver = createEffectiveUserResolver({ store, directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Sale');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(resolved.hoTen, 'Sale A');
  assert.equal(String(resolved.hrRowIndex), '10');
  assert.equal(calls.reads, 0);
  assert.equal(store.updates.length, 0);
})


test('TK hrManaged cũ nhưng hrRowIndex rỗng/null: đăng nhập giữ nguyên, findAccountForEmployee vẫn coi là chưa gắn', async () => {
  for (const hrRowIndex of ['', null, undefined]) {
    const store = memoryStore([{
      id: 'legacy', username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '',
      hrManaged: true, hrRowIndex, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
    }]);
    const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });

    const account = await resolver.findAccountForEmployee(managerEmployee);
    assert.equal(account.id, 'legacy');
    const resolved = await resolver.resolveUser(store.state[0]);
    assert.equal(resolved.hrRowIndex, hrRowIndex, `hrRowIndex=${hrRowIndex}`);
    assert.equal(resolved.vaiTro, 'Khách');
    assert.equal(store.updates.length, 0);
  }
})


test('findAccountForEmployee: TK duy nhat khop nhung da gan dong khac -> HR_IDENTITY_CONFLICT, khong tra TK do', async t => {
  // TK Sale (gan dong 10) con giu email cu trung email nhan su Quan ly (dong 20).
  const store = memoryStore([
    boundSaleAccount({ username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '' })
  ]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });

  await assert.rejects(
    resolver.findAccountForEmployee(managerEmployee),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  // Chinh TK do van resolve binh thuong theo rang buoc cu (dong 10).
  silenceWarn(t);
  const own = await resolver.resolveUser(store.state[0]);
  assert.equal(own.vaiTro, 'Sale');
  assert.equal(String(own.hrRowIndex), '10');
});

test('findAccountForEmployee: TK duy nhat khop va da gan dung dong (hoac chua gan) -> tra TK do', async () => {
  const store = memoryStore([boundManagerAccount()]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });
  assert.equal((await resolver.findAccountForEmployee(managerEmployee)).id, 'boss');
  assert.equal(await resolver.findAccountForEmployee({ ...employee, rowIndex: 99 }), null);
});

// --- F8: TK da dong bo khong duoc ghi DB moi request chi vi hrMatchedAt ---

test('resolve nhiều lần liên tiếp không ghi DB (không còn hrMatchedAt theo request)', async () => {
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Kế toán', coSo: 'Hà Nội', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });
  const first = await resolver.resolveUser(store.state[0]);
  const second = await resolver.resolveUser(store.state[0]);
  assert.equal(first.vaiTro, 'Kế toán');
  assert.equal(second.vaiTro, 'Kế toán');
  assert.equal(store.updates.length, 0);
})


test('TK đã đồng bộ cũ: hồ sơ nhân sự đổi vai trò không còn tự đổi tài khoản, hrMatchedAt giữ nguyên', async () => {
  const synced = boundSaleAccount({ hoTen: 'Sale A', boPhan: saleEmployee.boPhan, hrMatchedAt: '2026-01-01T00:00:00.000Z' });
  const store = memoryStore([synced]);
  const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Sale');
  assert.equal(store.updates.length, 0);
  assert.equal(store.state[0].hrMatchedAt, '2026-01-01T00:00:00.000Z');
})


test('đăng nhập KHÔNG đổi ghi đè quyền riêng của tài khoản (feature_permissions)', async () => {
  const overrides = { 'reports.overview': true, 'hr.leave': false };
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Kế toán', coSo: 'Hà Nội', trangThai: 'Đang hoạt động',
    featurePermissions: overrides, lockReason: 'hr_removed'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Kế toán');
  // Ngay cả khi có ghi (gỡ khóa hr_removed), ghi đè quyền do Quản lý đặt phải còn nguyên.
  assert.equal(store.updates.length, 1);
  assert.equal(Object.hasOwn(store.updates[0].changes, 'featurePermissions'), false);
  assert.deepEqual(resolved.featurePermissions, overrides);
  assert.deepEqual(store.state[0].featurePermissions, overrides);
})


test('đăng nhập dùng Bộ phận của tài khoản, không mở rộng phạm vi duyệt hay cơ sở được gán', async () => {
  const store = memoryStore([{ id: 'u1', username: 'a@example.com', email: 'a@example.com', hrManaged: true, hrRowIndex: 2, vaiTro: 'Kế toán', coSo: '', assignedCoSo: '', boPhan: 'Kế toán', trangThai: 'Đang hoạt động', leaveApprovalDepartments: ['KHO'] }]);
  const resolver = createEffectiveUserResolver({ store, directory: forbiddenDirectory().directory });
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.boPhan, 'Kế toán');
  assert.equal(resolved.coSo, '');
  assert.equal(resolved.assignedCoSo, '');
  assert.deepEqual(resolved.leaveApprovalDepartments, ['KHO']);
  assert.equal(store.updates.length, 0);
})

