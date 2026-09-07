'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const { isVatProductCode, parseSheetDateKey, loadActiveCandidates, buildEventMapFromSheets } = require('./sheetTimelineBuilder');

test('parseSheetDateKey doc dung dinh dang dd/MM/yyyy (co hoac khong co gio)', () => {
  assert.equal(parseSheetDateKey('06/01/2026 10:30:00'), '2026-01-06');
  assert.equal(parseSheetDateKey('6/1/2026'), '2026-01-06');
  assert.equal(parseSheetDateKey(''), null);
  assert.equal(parseSheetDateKey(null), null);
  assert.equal(parseSheetDateKey('khong phai ngay'), null);
});

test('isVatProductCode nhan dien ma VAT khong phan biet hoa thuong', () => {
  assert.equal(isVatProductCode('VAT'), true);
  assert.equal(isVatProductCode('vat10'), true);
  assert.equal(isVatProductCode('SP001'), false);
  assert.equal(isVatProductCode(''), false);
});

test('loadActiveCandidates loc dung trang thai, mac dinh trong la dang kinh doanh, dem tong so dong', () => {
  const rows = [
    ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái'],
    ['SP001', 'Con hang', '5', 'Đang kinh doanh'],
    ['SP002', 'Ngung kinh doanh', '0', 'Ngừng kinh doanh'],
    ['SP003', 'Khong ghi trang thai', '2', '']
  ];
  const { candidates, totalProductsScanned } = loadActiveCandidates(rows);
  assert.equal(totalProductsScanned, 3);
  assert.deepEqual(candidates.map((c) => c.code).sort(), ['SP001', 'SP003']);
  const sp001 = candidates.find((c) => c.code === 'SP001');
  assert.equal(sp001.currentOnHand, 5);
});

test('buildEventMapFromSheets: hoa don Hoan thanh lam giam ton kho, Da huy/Phieu tam bi loai', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [
      ['Mã hóa đơn', 'Ngày bán', 'Trạng thái'],
      ['HD001', '06/01/2026 08:00:00', 'Hoàn thành'],
      ['HD002', '07/01/2026 08:00:00', 'Đã hủy']
    ],
    [CONFIG.SHEET_INVOICE_DETAILS]: [
      ['Mã hóa đơn', 'Mã hàng', 'Số lượng'],
      ['HD001', 'SP001', 3],
      ['HD002', 'SP001', 999]
    ],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-06', delta: -3 }]);
});

test('buildEventMapFromSheets: Nhap hang lam tang ton kho, Tra NCC lam giam ton kho', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [
      ['Mã hàng', 'Thời gian', 'Số lượng'],
      ['SP001', '10/01/2026 08:00:00', 7]
    ],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng'],
      ['SP001', '12/01/2026 08:00:00', 2]
    ]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [
    { dateKey: '2026-01-10', delta: 7 },
    { dateKey: '2026-01-12', delta: -2 }
  ]);
});

test('buildEventMapFromSheets: bo qua ma VAT va ma khong nam trong validCodeSet', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái'], ['HD001', '06/01/2026 08:00:00', 'Hoàn thành']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [
      ['Mã hóa đơn', 'Mã hàng', 'Số lượng'],
      ['HD001', 'VAT', 1],
      ['HD001', 'SP999-KHONG-HOP-LE', 1]
    ],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.equal(eventMap.size, 0);
});

test('buildEventMapFromSheets: bo qua su kien ngoai cua so ngay [fromDate, todayKey]', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái'], ['HD001', '01/12/2025 08:00:00', 'Hoàn thành']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng'], ['HD001', 'SP001', 3]],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng'], ['SP001', '01/12/2025 08:00:00', 3]],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001') || [], []);
});
