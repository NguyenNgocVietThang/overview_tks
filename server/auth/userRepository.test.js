'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshRepository(users) {
  delete require.cache[require.resolve('./userRepository')];
  const localUserStore = require('./localUserStore');
  localUserStore.getAllUsers = async () => users;
  return require('./userRepository');
}

const USERS = [
  { id: '1', username: 'lan', email: 'lan@example.com', soDienThoai: '0912345678', sdtKhoiPhuc: '0987654321', trangThai: 'Đang hoạt động', vaiTro: 'Kế toán' },
  { id: '2', username: 'locked', email: 'locked@example.com', trangThai: 'Khóa', vaiTro: 'Khách' }
];

test('đọc người dùng từ PostgreSQL/localUserStore, không còn phụ thuộc tab Users', async () => {
  const repo = freshRepository(USERS);
  assert.deepEqual(await repo.getAllUsers(), USERS);
});

test('tìm người dùng theo username, email và số điện thoại', async () => {
  const repo = freshRepository(USERS);
  assert.equal((await repo.findUserByUsername('LAN')).id, '1');
  assert.equal((await repo.findUserByEmail('LAN@example.com')).id, '1');
  assert.equal((await repo.findUserByPhone('+84912345678')).id, '1');
});

test('findActiveUserByUsername chặn tài khoản khóa', async () => {
  const repo = freshRepository(USERS);
  assert.equal(await repo.findActiveUserByUsername('locked'), null);
});

test('tìm người dùng theo id', async () => {
  const repo = freshRepository(USERS);
  assert.equal((await repo.findUserById('2')).username, 'locked');
});
