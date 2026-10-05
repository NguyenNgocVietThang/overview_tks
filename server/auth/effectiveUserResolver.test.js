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

test('verified guest becomes one HR-managed multi-identifier account', async () => {
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [employee], stale: false }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.hrManaged, true);
  assert.equal(resolved.email, 'a@example.com');
  assert.equal(resolved.soDienThoai, '0912345678');
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.equal(resolved.coSo, 'Cả hai');
  assert.equal(resolved.hrSourceBranch, 'Hà Nội');
});

test('unverified guest is not promoted merely because an identifier appears in HR', async () => {
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', soDienThoai: '',
    vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees: [employee] }) } });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Khách');
  assert.equal(resolved.hrManaged, undefined);
  assert.equal(resolved.hrVerificationRequired, true);
});

test('manual role and branch overrides win over the sheet', async () => {
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true,
    vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động',
    vaiTroOverride: 'Trợ lý', coSoOverride: 'Hà Nội'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees: [employee] }) } });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Trợ lý');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(resolved.roleSource, 'override');
});

test('khong khop dong nhan su KHONG tu khoa tai khoan; chi go khoa hr_removed cu, khoa thu cong giu nguyen', async () => {
  let employees = [];
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true,
    hrManaged: true, vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees }) } });

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

test('two local accounts matching one HR row fail closed', async () => {
  const store = memoryStore([
    { id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true, vaiTro: 'Khách', trangThai: 'Đang hoạt động' },
    { id: 'u2', username: '0912345678', soDienThoai: '0912345678', verifiedPhone: true, vaiTro: 'Khách', trangThai: 'Đang hoạt động' }
  ]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees: [employee] }) } });
  await assert.rejects(resolver.resolveUser(store.state[0]), err => err.code === 'HR_IDENTITY_CONFLICT');
});

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
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Sale');
  assert.equal(resolved.coSo, 'Hà Nội');
  assert.equal(String(resolved.hrRowIndex), '10');
  assert.equal(resolved.hoTen, undefined);
  // Khong persist gi tu dong B.
  assert.equal(store.state[0].vaiTro, 'Sale');
  assert.equal(String(store.state[0].hrRowIndex), '10');
  assert.equal(store.state[0].sheetVaiTro, 'Sale');
  assert.ok(warns.some(args => args.join(' ').includes('sale')));
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

test('TK moi chua gan (hrRowIndex rong) khop lan dau van duoc gan nhu cu', async () => {
  const store = memoryStore([{
    id: 'new', username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '',
    verifiedEmail: true, hrRowIndex: '', vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.hrManaged, true);
  assert.equal(String(resolved.hrRowIndex), '20');
  assert.equal(resolved.vaiTro, 'Quản lý');
  assert.equal(String(store.state[0].hrRowIndex), '20');
});

test('TK da gan dong A ma email/SĐT van khop A: cap nhat binh thuong theo sheet', async () => {
  const store = memoryStore([boundSaleAccount()]);
  const promoted = { ...saleEmployee, sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai', hoTen: 'Sale A moi' };
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [promoted, managerEmployee] }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.equal(resolved.coSo, 'Cả hai');
  assert.equal(resolved.hoTen, 'Sale A moi');
  assert.equal(String(resolved.hrRowIndex), '10');
  assert.equal(store.state[0].vaiTro, 'Kế toán');
});

test('TK hrManaged cu nhung hrRowIndex rong/null duoc xu ly nhu chua gan va gan duoc dong khop', async () => {
  for (const hrRowIndex of ['', null, undefined]) {
    const store = memoryStore([{
      id: 'legacy', username: 'boss@example.com', email: 'boss@example.com', soDienThoai: '',
      hrManaged: true, hrRowIndex, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
    }]);
    const resolver = createEffectiveUserResolver({
      store,
      directory: { getSnapshot: async () => ({ employees: [saleEmployee, managerEmployee] }) }
    });

    const account = await resolver.findAccountForEmployee(managerEmployee);
    assert.equal(account.id, 'legacy');
    const resolved = await resolver.resolveUser(store.state[0]);
    assert.equal(String(resolved.hrRowIndex), '20', `hrRowIndex=${hrRowIndex}`);
    assert.equal(resolved.vaiTro, 'Quản lý');
    assert.equal(String(store.state[0].hrRowIndex), '20');
  }
});

// --- F4: nhanh chi 1 TK khop cung phai loai TK da gan dong KHAC ---

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

test('resolve 2 lan lien tiep voi du lieu khong doi -> lan 2 KHONG goi store.updateUser', async () => {
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [employee] }) }
  });

  const first = await resolver.resolveUser(store.state[0]);
  assert.equal(first.hrManaged, true);
  assert.equal(store.updates.length, 1);
  assert.ok(store.updates[0].changes.hrMatchedAt, 'gan lan dau phai ghi hrMatchedAt');
  // Gia lap lan gan truoc da xay ra tu luc khac (tranh trung mili-giay).
  store.state[0].hrMatchedAt = '2026-01-01T00:00:00.000Z';
  const matchedAt = store.state[0].hrMatchedAt;

  const second = await resolver.resolveUser(store.state[0]);
  assert.equal(store.updates.length, 1, 'lan 2 khong duoc ghi DB');
  assert.equal(second.vaiTro, 'Kế toán');
  assert.equal(second.hrMatchedAt, matchedAt);
});

test('TK da dong bo: chi khi co truong khac doi moi ghi va cap nhat hrMatchedAt', async () => {
  const synced = boundSaleAccount({ hoTen: 'Sale A', hrMatchedAt: '2026-01-01T00:00:00.000Z' });
  let employees = [saleEmployee];
  const store = memoryStore([synced]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees }) } });

  await resolver.resolveUser(store.state[0]);
  assert.equal(store.updates.length, 0);
  assert.equal(store.state[0].hrMatchedAt, '2026-01-01T00:00:00.000Z');

  employees = [{ ...saleEmployee, sheetVaiTro: 'Kế toán' }];
  const resolved = await resolver.resolveUser(store.state[0]);
  assert.equal(store.updates.length, 1);
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.notEqual(store.state[0].hrMatchedAt, '2026-01-01T00:00:00.000Z');
});

test('dong bo HR KHONG xoa ghi de quyen rieng cua tai khoan (feature_permissions)', async () => {
  const overrides = { 'reports.overview': true, 'hr.leave': false };
  const store = memoryStore([{
    id: 'u1', username: '0912345678', email: '', soDienThoai: '0912345678',
    verifiedPhone: true, vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động',
    featurePermissions: overrides
  }]);
  const resolver = createEffectiveUserResolver({
    store,
    directory: { getSnapshot: async () => ({ employees: [employee], stale: false }) }
  });

  const resolved = await resolver.resolveUser(store.state[0]);

  // Vai tro duoc dong bo lai tu Danh sach nhan su...
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.equal(resolved.hrManaged, true);
  // ...nhung ghi de quyen do Quan ly dat phai con nguyen, ca trong ket qua tra
  // ve lan trong ban ghi da luu.
  assert.deepEqual(resolved.featurePermissions, overrides);
  assert.deepEqual(store.state[0].featurePermissions, overrides);
});
