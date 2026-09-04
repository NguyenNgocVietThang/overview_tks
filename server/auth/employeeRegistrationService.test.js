'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmployeeRegistrationService } = require('./employeeRegistrationService');

const employee = {
  sourceBranch: 'Hà Nội', rowIndex: 2, hoTen: 'Nhân viên A', boPhan: 'KẾ TOÁN',
  email: 'a@example.com', soDienThoai: '0912345678', telegramId: '123456',
  sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
};

function makeService(overrides = {}) {
  const users = [];
  const store = {
    createUser: async data => { const user = { id: 'u1', ...data }; users.push(user); return { ...user }; },
    updateUser: async (id, data) => {
      const index = users.findIndex(user => user.id === id);
      users[index] = { ...users[index], ...data };
      return { ...users[index] };
    }
  };
  const sent = [];
  const otp = {
    OTP_TTL_MS: 300000,
    maskEmail: value => `masked:${value}`,
    maskPhone: value => `masked:${value}`,
    generateResetOtp: async (key, target, channel) => { sent.push({ key, target, channel }); return { success: true, expiresInSeconds: 300 }; },
    verifyResetOtp: () => ({ valid: true }),
    clearResetOtp: () => {}
  };
  const service = createEmployeeRegistrationService({
    directory: { getSnapshot: async () => ({ employees: [employee] }) },
    findEmployeeByIdentifier: (_, identifier) => (
      String(identifier).includes('@') || String(identifier).replace(/\D/g, '').endsWith('912345678') ? employee : null
    ),
    resolver: {
      findAccountForEmployee: async () => users[0] || null,
      resolveUser: async user => ({ ...user, vaiTro: 'Kế toán', coSo: 'Cả hai', hrManaged: true })
    },
    store,
    otp,
    hashPassword: async value => `hash:${value}`,
    randomUUID: () => 'challenge-1',
    ...overrides
  });
  return { service, users, sent, otp };
}

test('registration channels expose both masked HR contacts', async () => {
  const { service } = makeService();
  const result = await service.createChallenge('a@example.com');
  assert.equal(result.employeeMatch, true);
  assert.equal(result.challengeId, 'challenge-1');
  assert.deepEqual(result.channels, [
    { channel: 'email', targetMasked: 'masked:a@example.com' },
    { channel: 'phone', targetMasked: 'masked:0912345678' }
  ]);
});

test('sendOtp only sends to a contact belonging to the challenged HR row', async () => {
  const { service, sent } = makeService();
  await service.createChallenge('a@example.com');
  await service.sendOtp('challenge-1', 'phone');
  assert.deepEqual(sent[0], {
    key: 'hr-register:challenge-1', target: '0912345678', channel: 'phone'
  });
  await assert.rejects(service.sendOtp('challenge-1', 'recovery_email'), err => err.code === 'INVALID_OTP_CHANNEL');
});

test('verified OTP creates one account containing both login identifiers', async () => {
  const { service, users } = makeService();
  await service.createChallenge('a@example.com');
  await service.sendOtp('challenge-1', 'email');
  const user = await service.verifyAndRegister({
    challengeId: 'challenge-1', otp: '123456', hoTen: 'Tên nhập', password: 'Password123'
  });
  assert.equal(users.length, 1);
  assert.equal(user.email, 'a@example.com');
  assert.equal(user.soDienThoai, '0912345678');
  assert.equal(user.passwordHash, 'hash:Password123');
  assert.equal(user.verifiedEmail, true);
  assert.equal(user.vaiTro, 'Kế toán');
});

test('verified OTP attaches to an existing account instead of duplicating it', async () => {
  const { service, users } = makeService();
  users.push({ id: 'old', username: '0912345678', soDienThoai: '0912345678', vaiTro: 'Khách' });
  await service.createChallenge('a@example.com');
  await service.sendOtp('challenge-1', 'phone');
  const user = await service.verifyAndRegister({
    challengeId: 'challenge-1', otp: '123456', hoTen: 'A', password: 'Password123'
  });
  assert.equal(users.length, 1);
  assert.equal(user.id, 'old');
  assert.equal(user.email, 'a@example.com');
  assert.equal(user.verifiedPhone, true);
});

test('non-HR identifier remains on the existing guest registration path', async () => {
  const { service } = makeService({
    findEmployeeByIdentifier: () => null
  });
  assert.deepEqual(await service.createChallenge('guest@example.com'), { employeeMatch: false });
});

test('verified Google email attaches to an account previously created with the HR phone', async () => {
  const { service, users } = makeService();
  users.push({ id: 'old', username: '0912345678', soDienThoai: '0912345678', vaiTro: 'Khách' });
  const user = await service.linkVerifiedGoogleIdentity({ email: 'A@EXAMPLE.COM', hoTen: 'Google Name' });
  assert.equal(users.length, 1);
  assert.equal(user.id, 'old');
  assert.equal(user.email, 'a@example.com');
  assert.equal(user.soDienThoai, '0912345678');
  assert.equal(user.verifiedEmail, true);
  assert.equal(user.vaiTro, 'Kế toán');
});
