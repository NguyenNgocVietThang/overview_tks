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
  loadActiveCandidates,
  buildEventMapFromSheets,
  buildInvoiceEventMapFromSheets,
  buildPurchaseEventMapFromSheets,
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

test('loadActiveCandidates doc createdDateKey tu cot Thoi gian tao, null neu thieu cot hoac rong', () => {
  const rows = [
    ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái', 'Ngày tạo'],
    ['SP001', 'Ma moi tao', '0', 'Đang kinh doanh', '04/08/2026 09:44'],
    ['SP002', 'Khong co ngay tao', '0', 'Đang kinh doanh', '']
  ];
  const { candidates } = loadActiveCandidates(rows);
  assert.equal(candidates.find((c) => c.code === 'SP001').createdDateKey, '2026-08-04');
  assert.equal(candidates.find((c) => c.code === 'SP002').createdDateKey, null);

  const rowsNoColumn = [
    ['Mã hàng', 'Tên hàng', 'Tồn kho', 'Trạng thái'],
    ['SP001', 'Khong co cot Thoi gian tao', '0', 'Đang kinh doanh']
  ];
  assert.equal(loadActiveCandidates(rowsNoColumn).candidates[0].createdDateKey, null);
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
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-06', delta: -3, source: 'invoices' }]);
});

test('Hóa đơn Sheet thiếu hoặc trống Trạng thái không được mặc định là hoàn thành', () => {
  const base = {
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng'], ['HD001', 'SP001', 3]],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const missingStatus = {
    ...base,
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán'], ['HD001', '06/01/2026']]
  };
  const blankStatus = {
    ...base,
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái'], ['HD001', '06/01/2026', '']]
  };
  assert.equal(buildEventMapFromSheets(missingStatus, new Set(['SP001']), '2026-01-01', '2026-01-20').size, 0);
  assert.equal(buildEventMapFromSheets(blankStatus, new Set(['SP001']), '2026-01-01', '2026-01-20').size, 0);
});

test('buildEventMapFromSheets: Nhap hang lam tang ton kho, Tra NCC lam giam ton kho', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '10/01/2026 08:00:00', 7, 'Hoàn thành'],
      ['SP001', '11/01/2026 08:00:00', 99, 'Đã hủy']
    ],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '12/01/2026 08:00:00', 2, 'Hoàn thành'],
      ['SP001', '13/01/2026 08:00:00', 50, 'Phiếu tạm']
    ]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [
    { dateKey: '2026-01-10', delta: 7, source: 'purchases' },
    { dateKey: '2026-01-12', delta: -2, source: 'supplierReturns' }
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
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.equal(eventMap.size, 0);
});

test('buildEventMapFromSheets: bo qua su kien ngoai cua so ngay [fromDate, todayKey]', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái'], ['HD001', '01/12/2025 08:00:00', 'Hoàn thành']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng'], ['HD001', 'SP001', 3]],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'], ['SP001', '01/12/2025 08:00:00', 3, 'Hoàn thành']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001') || [], []);
});

test('buildEventMapFromSheets bỏ nguồn Nhập hàng thiếu cột Trạng thái nhưng vẫn tính Trả NCC (không có webhook, luôn hoàn tất)', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng'], ['SP001', '10/01/2026', 7]],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng'], ['SP001', '12/01/2026', 2]]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-12', delta: -2, source: 'supplierReturns' }]);
});

test('Nhập hàng Sheet dùng trạng thái số 3 là hoàn thành và bỏ trạng thái 4', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      ['SP001', '10/01/2026', 7, 3],
      ['SP001', '11/01/2026', 99, 4]
    ],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-10', delta: 7, source: 'purchases' }]);
});

test('buildEventMapFromSheets đối chiếu chính xác từng mã sau khi trim', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [
      ['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'],
      [' SP001 ', '10/01/2026', 2, 'Hoàn thành'],
      ['sp001', '10/01/2026', 9, 'Hoàn thành']
    ],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
  const eventMap = buildEventMapFromSheets(sheets, new Set(['SP001']), '2026-01-01', '2026-01-20');
  assert.deepEqual(eventMap.get('SP001'), [{ dateKey: '2026-01-10', delta: 2, source: 'purchases' }]);
  assert.equal(eventMap.has('sp001'), false);
});

test('các builder Sheet theo nguồn không kéo lẫn biến động của nguồn khác', () => {
  const sheets = {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái'], ['HD001', '10/01/2026', 'Hoàn thành']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng'], ['HD001', 'SP001', 2]],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'], ['SP001', '10/01/2026', 3, 'Hoàn thành']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái'], ['SP001', '10/01/2026', 4, 'Hoàn thành']]
  };
  const args = [sheets, new Set(['SP001']), '2026-01-09', '2026-01-11'];

  assert.deepEqual(buildInvoiceEventMapFromSheets(...args).get('SP001'), [{ dateKey: '2026-01-10', delta: -2, source: 'invoices' }]);
  assert.deepEqual(buildPurchaseEventMapFromSheets(...args).get('SP001'), [{ dateKey: '2026-01-10', delta: 3, source: 'purchases' }]);
  assert.deepEqual(buildSupplierReturnEventMapFromSheets(...args).get('SP001'), [{ dateKey: '2026-01-10', delta: -4, source: 'supplierReturns' }]);
});
