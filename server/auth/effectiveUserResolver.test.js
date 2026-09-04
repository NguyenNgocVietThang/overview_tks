'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEffectiveUserResolver } = require('./effectiveUserResolver');

function memoryStore(users) {
  const state = users.map(user => ({ ...user }));
  return {
    state,
    getAllUsers: async () => state.map(user => ({ ...user })),
    updateUser: async (id, changes) => {
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

test('HR removal locks managed account and reappearance only unlocks the HR lock', async () => {
  let employees = [];
  const store = memoryStore([{
    id: 'u1', username: 'a@example.com', email: 'a@example.com', verifiedEmail: true,
    hrManaged: true, vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động'
  }]);
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees }) } });

  await assert.rejects(resolver.resolveUser(store.state[0]), err => err.code === 'ACCOUNT_HR_REMOVED');
  assert.equal(store.state[0].trangThai, 'Khóa');
  assert.equal(store.state[0].lockReason, 'hr_removed');

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

