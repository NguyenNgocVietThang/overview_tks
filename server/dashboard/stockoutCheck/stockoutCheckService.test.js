'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStockoutCheckJob } = require('./stockoutCheckService');
const { createJobStore } = require('./jobManager');

const HEADERS = {
  invoices: ['Mã hóa đơn', 'Ngày bán', 'Trạng thái'],
  invoiceDetails: ['Mã hóa đơn', 'Mã hàng', 'Số lượng'],
  purchases: ['Mã hàng', 'Thời gian', 'Số lượng'],
  purchaseReturns: ['Mã hàng', 'Thời gian', 'Số lượng']
};

function catalogWith(entries) {
  const map = new Map();
  for (const [code, name, currentOnHand] of entries) map.set(code, { code, name, currentOnHand });
  return async () => map;
}

function fakeSheetsClient(sheets) {
  return {
    async getMultipleSheetValues(names) {
      const result = {};
      names.forEach((name) => { result[name] = sheets[name] || []; });
      return result;
    }
  };
}

function fakeReturnsClient(returnPages = []) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint !== 'returns') throw new Error('unexpected endpoint: ' + endpoint);
      for (const page of returnPages) await onPage(page.items, page.meta);
    }
  };
}

function emptySheets() {
  return {
    'Hóa đơn': [HEADERS.invoices],
    'Chi tiết hóa đơn': [HEADERS.invoiceDetails],
    'Nhập hàng': [HEADERS.purchases],
    'Trả NCC': [HEADERS.purchaseReturns]
  };
}

test('chay thanh cong: tra ket qua dung cho ma hop le, giu lai ma khong hop le', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySheets());
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]);

  await runStockoutCheckJob(store, jobId, ['SP001', 'SP002', 'SP999'], {
    loadProductCatalogMap: catalogWith([['SP001', 'Bánh gạo lứt', 0], ['SP002', 'Nước suối', 5]]),
    sheetsClient,
    client,
    todayKey: '2026-01-10',
    daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.invalidCodes, ['SP999']);
  assert.equal(job.result.totalValidCodes, 2);
  assert.equal(job.result.fromDate, '2026-01-01');
  assert.equal(job.result.toDate, '2026-01-10');

  const sp001 = job.result.rows.find((r) => r.code === 'SP001');
  const sp002 = job.result.rows.find((r) => r.code === 'SP002');
  assert.equal(sp001.currentOnHand, 0);
  assert.equal(sp001.stockoutCount, 1);
  assert.equal(sp001.totalStockoutDays, 10);
  assert.deepEqual(sp001.periods, [{ fromDate: '2026-01-01', toDate: '2026-01-10', days: 10 }]);

  assert.equal(sp002.currentOnHand, 5);
  assert.equal(sp002.stockoutCount, 0);
  assert.equal(sp002.totalStockoutDays, 0);
});

test('cap nhat tien do dung 2 giai doan (doc Sheets, roi goi API tra hang)', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySheets());
  const client = fakeReturnsClient([{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 3, total: 3 } }]);

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A', 5]]),
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.progress.phase, 2);
  assert.equal(job.progress.phase2.recordsLoaded, 3);
  assert.equal(job.progress.phase2.total, 3);
});

test('khong co ma hop le nao thi bao loi NO_VALID_CODES, khong doc Sheets/goi API', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  let sheetsCalled = false;
  let apiCalled = false;
  const sheetsClient = { async getMultipleSheetValues() { sheetsCalled = true; return {}; } };
  const client = { async fetchAllPages() { apiCalled = true; } };

  await runStockoutCheckJob(store, jobId, ['SP999'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A', 0]]),
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.equal(job.error.code, 'NO_VALID_CODES');
  assert.equal(sheetsCalled, false);
  assert.equal(apiCalled, false);
});

test('loi khi doc Google Sheets thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = { async getMultipleSheetValues() { throw new Error('Google Sheets timeout'); } };
  const client = fakeReturnsClient([]);

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A', 0]]),
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /Google Sheets timeout/);
});

test('loi khi goi API tra hang thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const sheetsClient = fakeSheetsClient(emptySheets());
  const client = { async fetchAllPages() { throw new Error('KiotViet returns API timeout'); } };

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A', 0]]),
    sheetsClient, client, todayKey: '2026-01-10', daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet returns API timeout/);
});
