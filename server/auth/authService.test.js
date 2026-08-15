'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, comparePassword, signToken, verifyToken } = require('./authService');

test('hashPassword + comparePassword: mat khau dung tra ve true', async () => {
  const hash = await hashPassword('MatKhau123!');
  assert.equal(await comparePassword('MatKhau123!', hash), true);
});

test('hashPassword + comparePassword: mat khau sai tra ve false', async () => {
  const hash = await hashPassword('MatKhau123!');
  assert.equal(await comparePassword('sai-mat-khau', hash), false);
});

test('comparePassword: khong throw khi passwordHash rong/undefined (user khong ton tai)', async () => {
  assert.equal(await comparePassword('bat-ky', ''), false);
  assert.equal(await comparePassword('bat-ky', undefined), false);
});

test('signToken + verifyToken: round-trip giu nguyen payload', () => {
  const payload = { id: '1', username: 'ketoan1', hoTen: 'Kế Toán A', vaiTro: 'Kế toán', coSo: 'An Khánh' };
  const token = signToken(payload);
  const decoded = verifyToken(token);
  assert.equal(decoded.id, payload.id);
  assert.equal(decoded.username, payload.username);
  assert.equal(decoded.vaiTro, payload.vaiTro);
});

test('verifyToken: throw voi token gia mao/khong hop le', () => {
  assert.throws(() => verifyToken('token-khong-hop-le'));
});

test('verifyToken: throw voi token ky bang secret khac', () => {
  const jwt = require('jsonwebtoken');
  const foreignToken = jwt.sign({ id: '1' }, 'secret-khac-hoan-toan');
  assert.throws(() => verifyToken(foreignToken));
});
