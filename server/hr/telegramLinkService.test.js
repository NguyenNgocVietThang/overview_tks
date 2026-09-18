'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramLinkService } = require('./telegramLinkService');

test('hoạt động web tự đồng bộ Telegram ID trên hồ sơ HR vào bảng liên kết Sheets', async () => {
  const employee = {
    sourceBranch: 'Hà Nội', rowIndex: 2, email: 'a@example.com', soDienThoai: '0912345678',
    telegramId: '123456', hoTen: 'A'
  };
  const upserts = [];
  const service = createTelegramLinkService({
    directory: { getSnapshot: async () => ({ employees: [employee] }) },
    findEmployeeByIdentifier: () => employee,
    linkRepository: {
      upsertAutomaticLink: async (data, branch) => { upserts.push({ data, branch }); return data; }
    }
  });

  await service.ensureLinkForUser({
    id: 'u1', username: 'a@example.com', email: 'a@example.com', hrManaged: true
  });

  assert.deepEqual(upserts, [{
    data: { userId: 'u1', webUsername: 'a@example.com', chatId: '123456', telegramUsername: '' },
    branch: 'Hà Nội'
  }]);
});

test('không ghi liên kết khi tài khoản không do HR quản lý', async () => {
  let calls = 0;
  const service = createTelegramLinkService({
    directory: { getSnapshot: async () => { calls += 1; return { employees: [] }; } },
    findEmployeeByIdentifier: () => null,
    linkRepository: { upsertAutomaticLink: async () => null }
  });

  assert.equal(await service.ensureLinkForUser({ id: 'guest', hrManaged: false }), null);
  assert.equal(calls, 0);
});
