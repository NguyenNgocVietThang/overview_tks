'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshProductCodeValidator() {
  delete require.cache[require.resolve('./productCodeValidator')];
  delete require.cache[require.resolve('../../sheets/sheetsClient')];
  const sheetsClient = require('../../sheets/sheetsClient');
  const productCodeValidator = require('./productCodeValidator');
  return { productCodeValidator, sheetsClient };
}

test('loadProductCatalogMap doc cot theo ten header, key la ma hang viet hoa+trim', async () => {
  const { productCodeValidator, sheetsClient } = freshProductCodeValidator();
  sheetsClient.getValues = async () => [
    ['Mã hàng', 'Tên hàng', 'Nhóm hàng'],
    [' sp001 ', 'Bánh gạo lứt', 'Thực phẩm'],
    ['SP002', 'Nước suối', 'Đồ uống']
  ];
  const map = await productCodeValidator.loadProductCatalogMap();
  assert.deepEqual(map.get('SP001'), { code: 'sp001', name: 'Bánh gạo lứt' });
  assert.deepEqual(map.get('SP002'), { code: 'SP002', name: 'Nước suối' });
  assert.equal(map.size, 2);
});

test('loadProductCatalogMap voi sheet rong tra ve map rong', async () => {
  const { productCodeValidator, sheetsClient } = freshProductCodeValidator();
  sheetsClient.getValues = async () => [];
  const map = await productCodeValidator.loadProductCatalogMap();
  assert.equal(map.size, 0);
});

test('validateCodes tach ma hop le va khong hop le, giu nguyen chuoi goc cho invalid', () => {
  const { productCodeValidator } = freshProductCodeValidator();
  const catalogMap = new Map([
    ['SP001', { code: 'SP001', name: 'Bánh gạo lứt' }],
    ['SP002', { code: 'SP002', name: 'Nước suối' }]
  ]);
  const result = productCodeValidator.validateCodes([' sp001 ', 'SP002', 'SP999'], catalogMap);
  assert.deepEqual(result.validCodes, [
    { code: 'SP001', name: 'Bánh gạo lứt' },
    { code: 'SP002', name: 'Nước suối' }
  ]);
  assert.deepEqual(result.invalidCodes, ['SP999']);
});

test('validateCodes voi danh sach rong tra ve hai mang rong', () => {
  const { productCodeValidator } = freshProductCodeValidator();
  const result = productCodeValidator.validateCodes([], new Map());
  assert.deepEqual(result, { validCodes: [], invalidCodes: [] });
});
