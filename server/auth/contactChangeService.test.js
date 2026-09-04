'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactChangeService } = require('./contactChangeService');

const employee = {
  sourceBranch: 'Hà Nội', rowIndex: 2, email: 'a@example.com', soDienThoai: '0912345678'
};

function fixture({ writeFails = false } = {}) {
  const events = [];
  const state = [{ id: 'u1', email: 'a@example.com', soDienThoai: '0912345678', hrManaged: true }];
  const service = createContactChangeService({
    directory: {
      getSnapshot: async () => ({ employees: [employee] }),
      updateEmployeeContact: async (current, field, value) => {
        events.push(`sheet:${field}:${value}`);
        if (writeFails) throw new Error('sheet failed');
        return { ...current, [field === 'email' ? 'email' : 'soDienThoai']: value };
      }
    },
    findEmployeeByIdentifier: () => employee,
    store: {
      getAllUsers: async () => state.map(user => ({ ...user })),
      updateUser: async (id, changes) => { events.push('local'); state[0] = { ...state[0], ...changes }; return { ...state[0] }; }
    },
    otp: {
      maskEmail: value => `masked:${value}`,
      maskPhone: value => `masked:${value}`,
      generateResetOtp: async () => ({ success: true, expiresInSeconds: 300 }),
      verifyResetOtp: () => ({ valid: true }),
      clearResetOtp: () => {}
    },
    randomUUID: () => 'change-1'
  });
  return { service, state, events };
}

test('beginChange sends OTP to the new primary contact', async () => {
  const { service } = fixture();
  const result = await service.beginChange({ id: 'u1', hrManaged: true }, 'email', 'NEW@EXAMPLE.COM');
  assert.deepEqual(result, {
    challengeId: 'change-1', field: 'email', targetMasked: 'masked:new@example.com', expiresInSeconds: 300
  });
});

test('confirmChange writes HR sheet before local account and verifies the new identifier', async () => {
  const { service, state, events } = fixture();
  await service.beginChange(state[0], 'phone', '0987 654 321');
  const updated = await service.confirmChange(state[0], 'change-1', '123456');
  assert.deepEqual(events, ['sheet:phone:0987654321', 'local']);
  assert.equal(updated.soDienThoai, '0987654321');
  assert.equal(updated.verifiedPhone, true);
});

test('sheet write failure leaves local account untouched', async () => {
  const { service, state, events } = fixture({ writeFails: true });
  await service.beginChange(state[0], 'email', 'new@example.com');
  await assert.rejects(service.confirmChange(state[0], 'change-1', '123456'));
  assert.deepEqual(events, ['sheet:email:new@example.com']);
  assert.equal(state[0].email, 'a@example.com');
});

test('beginChange rejects a contact already used by another local account', async () => {
  const duplicateService = createContactChangeService({
    directory: { getSnapshot: async () => ({ employees: [employee] }) },
    findEmployeeByIdentifier: () => employee,
    store: { getAllUsers: async () => [{ id: 'u1' }, { id: 'u2', email: 'used@example.com' }] },
    otp: {}
  });
  await assert.rejects(
    duplicateService.beginChange({ id: 'u1', hrManaged: true }, 'email', 'used@example.com'),
    err => err.code === 'USER_EXISTS'
  );
});

test('adminChange writes an HR-managed primary contact through to the sheet without OTP', async () => {
  const { service, state, events } = fixture();
  const updated = await service.adminChange(state[0], 'email', 'admin-change@example.com');
  assert.deepEqual(events, ['sheet:email:admin-change@example.com', 'local']);
  assert.equal(updated.email, 'admin-change@example.com');
  assert.equal(updated.verifiedEmail, true);
});
