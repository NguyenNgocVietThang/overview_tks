'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const CONFIG = require('../../config');
const { loadStockoutEvents } = require('./stockoutEventLoader');

function makeClient(pagesByEndpoint, calls) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      calls.push({ endpoint, query });
      const pages = pagesByEndpoint[endpoint] || [[]];
      let recordsLoaded = 0;
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        if (page instanceof Error) throw page;
        recordsLoaded += page.length;
        await onPage(page, {
          pagesLoaded: index + 1,
          recordsLoaded,
          total: pages.filter(item => Array.isArray(item)).reduce((sum, item) => sum + item.length, 0)
        });
      }
    }
  };
}

function makeSheetsClient(sheetValues, calls) {
  return {
    async getMultipleSheetValues(names) {
      calls.push(names.slice());
      return Object.fromEntries(names.map(name => [name, sheetValues[name] || []]));
    }
  };
}

function emptySheets() {
  return {
    [CONFIG.SHEET_INVOICES]: [['Mã hóa đơn', 'Ngày bán', 'Trạng thái']],
    [CONFIG.SHEET_INVOICE_DETAILS]: [['Mã hóa đơn', 'Mã hàng', 'Số lượng']],
    [CONFIG.SHEET_PURCHASES]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']],
    [CONFIG.SHEET_SUPPLIER_RETURNS]: [['Mã hàng', 'Thời gian', 'Số lượng', 'Trạng thái']]
  };
}

function makeDeps({ pages = {}, sheets = emptySheets() } = {}) {
  const apiCalls = [];
  const sheetCalls = [];
  return {
    deps: {
      client: makeClient(pages, apiCalls),
      sheetsClient: makeSheetsClient(sheets, sheetCalls),
      validCodeSet: new Set(['SP001']),
      fromDate: '2026-01-09',
      toDate: '2026-01-11'
    },
    apiCalls,
    sheetCalls
  };
}

test('ba API thành công và Trả NCC luôn lấy Sheet đúng một lần', async () => {
  const sheets = emptySheets();
  sheets[CONFIG.SHEET_SUPPLIER_RETURNS].push(['SP001', '10/01/2026', 1, 'Hoàn thành']);
  const fixture = makeDeps({
    sheets,
    pages: {
      invoices: [[{ status: 1, purchaseDate: '2026-01-10T00:00:00Z', invoiceDetails: [{ productCode: 'SP001', quantity: 2 }] }]],
      purchaseorders: [[
        { status: 3, purchaseDate: '2026-01-10T00:00:00Z', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 3 }] },
        { status: 4, purchaseDate: '2026-01-10T00:00:00Z', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 88 }] },
        { purchaseDate: '2026-01-10T00:00:00Z', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 77 }] }
      ]],
      returns: [[{ status: 1, returnDate: '2026-01-10T00:00:00Z', returnDetails: [{ productCode: 'SP001', quantity: 4 }] }]]
    }
  });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(fixture.apiCalls.map(call => call.endpoint), ['invoices', 'purchaseorders', 'returns']);
  assert.equal(fixture.apiCalls.find(call => call.endpoint === 'purchaseorders').query.status, '3');
  assert.deepEqual(fixture.sheetCalls, [[CONFIG.SHEET_SUPPLIER_RETURNS]]);
  assert.deepEqual(result.sources, {
    invoices: 'kiotviet-api',
    purchases: 'kiotviet-api',
    customerReturns: 'kiotviet-api',
    supplierReturns: 'google-sheets'
  });
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.eventMapByCode.get('SP001').map(event => event.delta), [-2, 3, 4, -1]);
});

test('API thành công nhưng rỗng không kích hoạt fallback', async () => {
  const fixture = makeDeps();
  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.eventMapByCode.size, 0);
  assert.deepEqual(fixture.sheetCalls, [[CONFIG.SHEET_SUPPLIER_RETURNS]]);
  assert.deepEqual(result.warnings, []);
});

test('invoices lỗi giữa phân trang bỏ dữ liệu API tạm và chỉ dùng Sheet fallback', async () => {
  const sheets = emptySheets();
  sheets[CONFIG.SHEET_INVOICES].push(['HD001', '10/01/2026', 'Hoàn thành']);
  sheets[CONFIG.SHEET_INVOICE_DETAILS].push(['HD001', 'SP001', 2]);
  const fixture = makeDeps({
    sheets,
    pages: {
      invoices: [
        [{ status: 1, purchaseDate: '2026-01-10T00:00:00Z', invoiceDetails: [{ productCode: 'SP001', quantity: 99 }] }],
        new Error('invoice page 2 timeout')
      ]
    }
  });

  const result = await loadStockoutEvents(fixture.deps);
  const deltas = result.eventMapByCode.get('SP001').map(event => event.delta);

  assert.deepEqual(deltas, [-2]);
  assert.equal(result.sources.invoices, 'google-sheets-fallback');
  assert.match(result.warnings[0], /Hóa đơn.*Google Sheets dự phòng/);
  assert.ok(fixture.sheetCalls.some(names => names.includes(CONFIG.SHEET_INVOICES)));
});

test('purchaseorders lỗi chỉ fallback Nhập hàng, các API khác vẫn chạy', async () => {
  const sheets = emptySheets();
  sheets[CONFIG.SHEET_PURCHASES].push(['SP001', '10/01/2026', 5, 'Hoàn thành']);
  const fixture = makeDeps({ pages: { purchaseorders: [new Error('forbidden')] }, sheets });

  const result = await loadStockoutEvents(fixture.deps);

  assert.equal(result.sources.purchases, 'google-sheets-fallback');
  assert.equal(result.sources.invoices, 'kiotviet-api');
  assert.equal(result.sources.customerReturns, 'kiotviet-api');
  assert.deepEqual(result.eventMapByCode.get('SP001').map(event => event.delta), [5]);
});

test('returns lỗi làm toàn bộ loader lỗi vì Sheet không có chi tiết mã hàng', async () => {
  const fixture = makeDeps({ pages: { returns: [new Error('returns timeout')] } });
  await assert.rejects(loadStockoutEvents(fixture.deps), /Khách trả hàng.*returns timeout/);
});

test('phản hồi hoàn thành thiếu mảng chi tiết fallback cho invoices nhưng làm lỗi returns', async () => {
  const invoiceFixture = makeDeps({
    pages: { invoices: [[{ status: 1, purchaseDate: '2026-01-10T00:00:00Z' }]] }
  });
  const invoiceResult = await loadStockoutEvents(invoiceFixture.deps);
  assert.equal(invoiceResult.sources.invoices, 'google-sheets-fallback');

  const returnFixture = makeDeps({
    pages: { returns: [[{ status: 1, returnDate: '2026-01-10T00:00:00Z' }]] }
  });
  await assert.rejects(loadStockoutEvents(returnFixture.deps), /Khách trả hàng.*returnDetails/);
});

test('Trả NCC thiếu cột Trạng thái vẫn được tính vì sheet này không có webhook, luôn là chứng từ hoàn tất', async () => {
  const sheets = emptySheets();
  sheets[CONFIG.SHEET_SUPPLIER_RETURNS] = [
    ['Mã hàng', 'Thời gian', 'Số lượng'],
    ['SP001', '10/01/2026', 5]
  ];
  const fixture = makeDeps({ sheets });

  const result = await loadStockoutEvents(fixture.deps);

  assert.deepEqual(result.eventMapByCode.get('SP001'), [{ dateKey: '2026-01-10', delta: -5 }]);
  assert.deepEqual(result.warnings, []);
});
