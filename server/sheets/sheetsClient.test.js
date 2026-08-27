const test = require('node:test');
const assert = require('node:assert');

// Config doc env luc require — dat truoc khi require sheetsClient.
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'hn-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { BRANCHES } = require('../branch/branches');
const CONFIG = require('../config');
const sheetsClient = require('./sheetsClient');

test('client Ha Noi chinh la object module (de test monkey-patch duoc)', () => {
  assert.strictEqual(sheetsClient.getSheetsClient(BRANCHES.HANOI), sheetsClient);
  assert.strictEqual(sheetsClient.getSheetsClient(undefined), sheetsClient);
});

test('client Sai Gon va Ha Noi la hai client khac nhau', () => {
  assert.notStrictEqual(sheetsClient.getSheetsClient(BRANCHES.SAIGON), sheetsClient);
});

test('thieu SPREADSHEET_ID_SG thi bao BRANCH_NOT_CONFIGURED (503)', async () => {
  const saved = CONFIG.SPREADSHEET_ID_SG;
  CONFIG.SPREADSHEET_ID_SG = null;
  try {
    const sg = sheetsClient.getSheetsClient(BRANCHES.SAIGON);
    await assert.rejects(() => sg.getValues('Hóa đơn'), err => {
      assert.equal(err.code, 'BRANCH_NOT_CONFIGURED');
      assert.equal(err.statusCode, 503);
      return true;
    });
    await assert.rejects(() => sg.getMultipleSheetValues(['Hóa đơn']), err => {
      assert.equal(err.code, 'BRANCH_NOT_CONFIGURED');
      return true;
    });
  } finally {
    CONFIG.SPREADSHEET_ID_SG = saved;
  }
});
