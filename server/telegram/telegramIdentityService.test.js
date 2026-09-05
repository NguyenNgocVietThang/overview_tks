'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramIdentityService } = require('./telegramIdentityService');

const employee = {
  sourceBranch: 'Hà Nội', rowIndex: 2, email: 'a@example.com', soDienThoai: '0912345678',
  telegramId: '123456', hoTen: 'A', sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
};

function fixture(employees = [employee], account = { id: 'u1', username: 'a@example.com', email: 'a@example.com', hrManaged: true }) {
  const upserts = [];
  const service = createTelegramIdentityService({
    directory: { getSnapshot: async () => ({ employees }) },
    findEmployeeByIdentifier: () => employee,
    resolver: {
      findAccountForEmployee: async () => account,
      resolveUser: async user => ({ ...user, vaiTro: 'Kế toán' })
    },
    linkRepository: {
      upsertAutomaticLink: async (data, branch) => { upserts.push({ data, branch }); return { ...data, telegram_chat_id: data.chatId }; }
    },
    store: { getUserByUsername: async () => account }
  });
  return { service, upserts };
}

test('web activity auto-links the Telegram ID stored on the HR row', async () => {
  const { service, upserts } = fixture();
  await service.ensureLinkForUser({ id: 'u1', username: 'a@example.com', email: 'a@example.com', hrManaged: true });
  assert.deepEqual(upserts[0], {
    data: { userId: 'u1', webUsername: 'a@example.com', chatId: '123456', telegramUsername: '' },
    branch: 'Hà Nội'
  });
});

test('incoming Telegram chat resolves the HR employee and existing web account automatically', async () => {
  const { service, upserts } = fixture();
  const result = await service.resolveChat('123456', '@a');
  assert.equal(result.status, 'linked');
  assert.equal(result.user.id, 'u1');
  assert.equal(result.sourceBranch, 'Hà Nội');
  assert.equal(upserts[0].data.telegramUsername, '@a');
});

test('incoming Telegram chat reports account_required when HR row exists but web account does not', async () => {
  const { service } = fixture([employee], null);
  const result = await service.resolveChat('123456', '@a');
  assert.deepEqual(result, { status: 'account_required', employee, sourceBranch: 'Hà Nội' });
});

test('duplicate Telegram ID fails closed', async () => {
  const { service } = fixture([employee, { ...employee, rowIndex: 3, email: 'b@example.com' }]);
  await assert.rejects(service.resolveChat('123456'), err => err.code === 'TELEGRAM_ID_CONFLICT');
});

test('manual link cannot replace a different Telegram ID declared in HR sheet', async () => {
  const { service } = fixture();
  await assert.rejects(
    service.assertManualLinkAllowed('a@example.com', '999999'),
    err => err.code === 'TELEGRAM_ID_MISMATCH'
  );
  assert.equal(await service.assertManualLinkAllowed('a@example.com', '123456'), true);
});
