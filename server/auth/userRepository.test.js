'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

// Mirror pattern trong dashboard/dashboardData.test.js: require lai module +
// sheetsClient tu dau moi lan, roi ghi de truc tiep getValues bang mock —
// khong can thu vien mock rieng.
function freshUserRepository() {
  delete require.cache[require.resolve('./userRepository')];
  delete require.cache[require.resolve('../sheets/sheetsClient')];
  const userRepository = require('./userRepository');
  const sheetsClient = require('../sheets/sheetsClient');
  return { userRepository, sheetsClient };
}

const HEADERS = ['ID', 'Họ tên', 'Tài khoản đăng nhập', 'Mật khẩu (bcrypt hash)', 'Vai trò', 'Cơ sở phụ trách', 'Trạng thái tài khoản', 'Ngày tạo', 'Đăng nhập gần nhất', 'Email'];

test('getAllUsers: sheet rong -> tra ve mang rong, khong throw', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [];
  assert.deepEqual(await userRepository.getAllUsers(), []);
});

test('getAllUsers: parse dung tung cot theo ten header (khong phu thuoc thu tu cot vat ly)', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'Kế Toán A', 'ketoan1', 'hash1', 'Kế toán', 'An Khánh', 'Đang hoạt động', '01/01/2026', '']
  ];
  const users = await userRepository.getAllUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'ketoan1');
  assert.equal(users[0].vaiTro, 'Kế toán');
  assert.equal(users[0].trangThai, 'Đang hoạt động');
});

test('getAllUsers: bo qua dong trong (padding) cuoi sheet', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'user1', 'hash1', 'Quản lý', '', 'Đang hoạt động', '', ''],
    ['', '', '', '', '', '', '', '', '']
  ];
  const users = await userRepository.getAllUsers();
  assert.equal(users.length, 1);
});

test('findActiveUserByUsername: khong phan biet hoa/thuong va trim khoang trang', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'QuanLy1', 'hash1', 'Quản lý', '', 'Đang hoạt động', '', '']
  ];
  const found = await userRepository.findActiveUserByUsername('  quanly1  ');
  assert.ok(found);
  assert.equal(found.username, 'QuanLy1');
});

test('findActiveUserByUsername: tai khoan bi khoa -> tra ve null', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'bituro1', 'hash1', 'Trợ lý', '', 'Khóa', '', '']
  ];
  assert.equal(await userRepository.findActiveUserByUsername('bituro1'), null);
});

test('findActiveUserByUsername: khong tim thay -> tra ve null', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [HEADERS];
  assert.equal(await userRepository.findActiveUserByUsername('khong-ton-tai'), null);
});

test('getAllUsers: parse dung cot Email', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'nguoia', 'hash1', 'Trợ lý', '', 'Chờ duyệt', '', '', 'nguoia@gmail.com']
  ];
  const users = await userRepository.getAllUsers();
  assert.equal(users[0].email, 'nguoia@gmail.com');
});

test('findUserByEmail: khong phan biet hoa/thuong va trim khoang trang', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'nguoia', 'hash1', 'Trợ lý', '', 'Đang hoạt động', '', '', 'NguoiA@Gmail.com']
  ];
  const found = await userRepository.findUserByEmail('  nguoia@gmail.com  ');
  assert.ok(found);
  assert.equal(found.username, 'nguoia');
});

test('findUserByEmail: tra ve user du trang thai "Chờ duyệt" (khac findActiveUserByUsername)', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [
    HEADERS,
    ['u1', 'A', 'nguoib@gmail.com', '', 'Trợ lý', '', 'Chờ duyệt', '', '', 'nguoib@gmail.com']
  ];
  const found = await userRepository.findUserByEmail('nguoib@gmail.com');
  assert.ok(found);
  assert.equal(found.trangThai, userRepository.PENDING_STATUS);
});

test('findUserByEmail: khong tim thay -> tra ve null', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => [HEADERS];
  assert.equal(await userRepository.findUserByEmail('khong-ton-tai@gmail.com'), null);
});

test('findUserByEmail: email rong -> tra ve null, khong doc sheet', async () => {
  const { userRepository, sheetsClient } = freshUserRepository();
  sheetsClient.getValues = async () => { throw new Error('khong nen goi'); };
  assert.equal(await userRepository.findUserByEmail(''), null);
});
