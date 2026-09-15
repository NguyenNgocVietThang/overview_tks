'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const localUserStore = require('./localUserStore');
const { createFakeAppUsersRepository } = require('./testHelpers/fakeAppUsersRepository');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function freshStore() {
  const repository = createFakeAppUsersRepository();
  localUserStore.initStore(null, { repository });
  return { store: localUserStore, repository };
}

test('createUser: tao tai khoan moi, sinh UUID va tra ve dung du lieu', async () => {
  const { store } = freshStore();
  const created = await store.createUser({
    username: 'nv_moi',
    hoTen: 'Nhân Viên Mới',
    vaiTro: 'Kế toán',
    coSo: 'Hà Nội',
    passwordHash: 'hash-xyz'
  });
  assert.ok(UUID_RE.test(created.id));
  assert.equal(created.username, 'nv_moi');
  assert.equal(created.vaiTro, 'Kế toán');
  assert.equal(created.coSo, 'Hà Nội');

  const found = await store.getUserByUsername('nv_moi');
  assert.ok(found);
  assert.equal(found.id, created.id);
});

test('createUser: trung ten tai khoan -> USER_EXISTS', async () => {
  const { store } = freshStore();
  await store.createUser({ username: 'trung_ten', hoTen: 'A', vaiTro: 'Trợ lý' });
  await assert.rejects(
    () => store.createUser({ username: 'trung_ten', hoTen: 'B', vaiTro: 'Trợ lý' }),
    err => err.code === 'USER_EXISTS'
  );
});

test('createUser: trung email -> USER_EXISTS', async () => {
  const { store } = freshStore();
  await store.createUser({ username: 'u1', email: 'a@tokosi.vn', vaiTro: 'Trợ lý' });
  await assert.rejects(
    () => store.createUser({ username: 'u2', email: 'a@tokosi.vn', vaiTro: 'Trợ lý' }),
    err => err.code === 'USER_EXISTS'
  );
});

test('getAllUsers: loai tru tai khoan da xoa mem', async () => {
  const { store } = freshStore();
  const created = await store.createUser({ username: 'se_bi_xoa', vaiTro: 'Trợ lý' });
  await store.deleteUser(created.id);
  const users = await store.getAllUsers();
  assert.ok(!users.some(u => u.id === created.id));
});

test('updateUser: cap nhat vaiTro va cache duoc lam moi dung', async () => {
  const { store } = freshStore();
  const created = await store.createUser({ username: 'nv_role', hoTen: 'A', vaiTro: 'Trợ lý' });
  const updated = await store.updateUser(created.id, { vaiTro: 'Kế toán' });
  assert.equal(updated.vaiTro, 'Kế toán');

  const reloaded = await store.getUserById(created.id);
  assert.equal(reloaded.vaiTro, 'Kế toán');
});

test('updateUser: khong tim thay id -> throw', async () => {
  const { store } = freshStore();
  await assert.rejects(() => store.updateUser('khong-ton-tai', { vaiTro: 'Kế toán' }));
});

test('deleteUser: khong ai xoa duoc thangnnv2003@gmail.com', async () => {
  const { store, repository } = freshStore();
  repository.seed([{
    id: 'c2619c62-e841-486a-9803-48c40ab0a398',
    username: 'thangnnv2003@gmail.com',
    email: 'thangnnv2003@gmail.com',
    vaiTro: 'Quản lý',
    coSo: 'Cả hai',
    trangThai: 'Đang hoạt động'
  }]);
  await assert.rejects(
    () => store.deleteUser('c2619c62-e841-486a-9803-48c40ab0a398'),
    /thangnnv2003@gmail\.com/
  );
});

test('updateUser: khong the ha quyen/khoa tai khoan Admin mac dinh', async () => {
  const { store, repository } = freshStore();
  repository.seed([{
    id: 'admin-1', username: 'admin', email: 'admin@tokosi.vn',
    vaiTro: 'Quản lý', coSo: 'Cả hai', trangThai: 'Đang hoạt động'
  }]);
  const updated = await store.updateUser('admin-1', { vaiTro: 'Khách', trangThai: 'Khóa' });
  assert.equal(updated.vaiTro, 'Quản lý');
  assert.equal(updated.trangThai, 'Đang hoạt động');
});

test('hydrateFromSheets: dam bao thangnnv2003@gmail.com luon ton tai trong Postgres', async () => {
  const { store } = freshStore();
  await store.hydrateFromSheets();
  const users = await store.getAllUsers();
  const thang = users.find(u => u.email === 'thangnnv2003@gmail.com');
  assert.ok(thang, 'phai tu tao lai admin cung neu Postgres chua co');
  assert.equal(thang.vaiTro, 'Quản lý');
});

test('hydrateFromSheets: Postgres loi -> khong throw (fail-soft)', async () => {
  localUserStore.initStore(null, {
    repository: {
      selectAllRows: async () => { throw new Error('gia lap mat ket noi Postgres'); },
      insertUser: async u => ({ ...u }),
      updateUserRow: async () => null,
      softDeleteUser: async () => null
    }
  });
  await assert.doesNotReject(() => localUserStore.hydrateFromSheets());
});
