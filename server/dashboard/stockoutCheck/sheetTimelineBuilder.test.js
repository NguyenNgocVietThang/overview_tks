'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const {
  isVatProductCode,
  parseSheetDateKey,
  findEarliestSheetDateKey,
  buildSupplierReturnEventMapFromSheets
} = require('./sheetTimelineBuilder');

test('parseSheetDateKey doc dung dinh dang dd/MM/yyyy (co hoac khong co gio)', () => {
  assert.equal(parseSheetDateKey('06/01/2026 10:30:00'), '2026-01-06');
  assert.equal(parseSheetDateKey('6/1/2026'), '2026-01-06');
  assert.equal(parseSheetDateKey(''), null);
  assert.equal(parseSheetDateKey(null), null);
  assert.equal(parseSheetDateKey('khong phai ngay'), null);
});

test('findEarliestSheetDateKey tra ve ngay som nhat, null neu thieu cot hoac rong', () => {
  const rows = [
    ['Mã hàng', 'Thời gian', 'Số lượng'],
    ['SP001', '10/01/2026', 5],
    ['SP002', '05/01/2026', 2],
    ['SP003', '20/01/2026', 1]
  ];
  assert.equal(findEarliestSheetDateKey(rows, 'Thời gian'), '2026-01-05');
  assert.equal(findEarliestSheetDateKey([['Mã hàng', 'Số lượng']], 'Thời gian'), null);
  assert.equal(findEarliestSheetDateKey([['Thời gian']], 'Thời gian'), null);
});

test('isVatProductCode nhan dien ma VAT khong phan biet hoa thuong', () => {
  assert.equal(isVatProductCode('VAT'), true);
  assert.equal(isVatProductCode('vat10'), true);
  assert.equal(isVatProductCode('SP001'), false);
  assert.equal(isVatProductCode(''), false);
});

test('buildSupplierReturnEventMapFromSheets: Tra NCC lam giam ton kho, bo qua Phieu tam', () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '12/01/2026 08:00:00', 2, 'Hoàn thành'],
      ['SP001', '13/01/2026 08:00:00', 50, 'Phiếu tạm']
    ]
  };
  const eventMap = buildSupplierReturnEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-12', delta: -2, source: 'supplierReturns' }]);
});

test('buildSupplierReturnEventMapFromSheets: thieu cot Trang thai van tinh vi sheet nay khong co webhook, luon la chung tu hoan tat', () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng'],
      ['SP001', '09/01/2026', 5]
    ]
  };
  const eventMap = buildSupplierReturnEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-09', delta: -5, source: 'supplierReturns' }]);
});

test('buildSupplierReturnEventMapFromSheets: bo qua ma VAT, ma ngoai validCodeSet va su kien ngoai cua so ngay', () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['VAT', '10/01/2026', 1, 'Hoàn thành'],
      ['SP999-KHONG-HOP-LE', '10/01/2026', 1, 'Hoàn thành'],
      ['SP001', '01/12/2025', 1, 'Hoàn thành']
    ]
  };
  const eventMap = buildSupplierReturnEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001') || [], []);
});

test('buildSupplierReturnEventMapFromSheets: doi chieu ma sau khi trim, khong phan biet hoa thuong bi tron lan', () => {
  const sheets = {
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      [' SP001 ', '10/01/2026', 2, 'Hoàn thành'],
      ['sp001', '10/01/2026', 9, 'Hoàn thành']
    ]
  };
  const eventMap = buildSupplierReturnEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-10', delta: -2, source: 'supplierReturns' }]);
  assert.equal(eventMap.has('sp001'), false);
});
