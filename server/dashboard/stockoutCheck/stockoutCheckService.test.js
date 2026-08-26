'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runStockoutCheckJob } = require('./stockoutCheckService');
const { createJobStore } = require('./jobManager');

function catalogWith(entries) {
  const map = new Map();
  for (const [code, name] of entries) map.set(code, { code, name });
  return async () => map;
}

function fakeClient({ onHandByCode, onFetchAllPages, onFetchProductOnHand }) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      if (onFetchAllPages) onFetchAllPages(endpoint, query);
      onPage([], { pagesLoaded: 1, recordsLoaded: 0, total: 0 });
    },
    async fetchProductOnHand(code) {
      if (onFetchProductOnHand) onFetchProductOnHand(code);
      return { code, found: true, onHand: onHandByCode[code] };
    }
  };
}

test('chay thanh cong: tra ket qua dung cho ma hop le, giu lai ma khong hop le', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = fakeClient({ onHandByCode: { SP001: 0, SP002: 5 } });

  await runStockoutCheckJob(store, jobId, ['SP001', 'SP002', 'SP999'], {
    loadProductCatalogMap: catalogWith([['SP001', 'Bánh gạo lứt'], ['SP002', 'Nước suối']]),
    client,
    todayKey: '2026-01-10',
    daysBack: 9,
    concurrency: 2
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

test('cap nhat tien do dung 2 giai doan', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = fakeClient({ onHandByCode: { SP001: 5 } });

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A']]),
    client,
    todayKey: '2026-01-10',
    daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.progress.phase, 2);
  assert.equal(job.progress.phase2.processed, 1);
  assert.equal(job.progress.phase2.total, 1);
  assert.equal(job.progress.phase1.invoices.pagesLoaded, 1);
  assert.equal(job.progress.phase1.purchaseOrders.pagesLoaded, 1);
  assert.equal(job.progress.phase1.returns.pagesLoaded, 1);
});

test('khong co ma hop le nao thi bao loi NO_VALID_CODES, khong goi KiotViet API', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  let apiCalled = false;
  const client = fakeClient({
    onHandByCode: {},
    onFetchAllPages: () => { apiCalled = true; },
    onFetchProductOnHand: () => { apiCalled = true; }
  });

  await runStockoutCheckJob(store, jobId, ['SP999'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A']]),
    client,
    todayKey: '2026-01-10',
    daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.equal(job.error.code, 'NO_VALID_CODES');
  assert.equal(apiCalled, false);
});

test('loi trong giai doan 1 (tai chung tu) thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = {
    async fetchAllPages(endpoint) {
      if (endpoint === 'invoices') throw new Error('KiotViet timeout');
    },
    async fetchProductOnHand() {
      return { code: 'x', found: true, onHand: 0 };
    }
  };

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A']]),
    client,
    todayKey: '2026-01-10',
    daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet timeout/);
});

test('loi trong giai doan 2 (lay ton kho hien tai) thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = fakeClient({
    onHandByCode: {},
    onFetchProductOnHand: (code) => {
      if (code === 'SP001') throw new Error('mat ket noi');
    }
  });

  await runStockoutCheckJob(store, jobId, ['SP001'], {
    loadProductCatalogMap: catalogWith([['SP001', 'A']]),
    client,
    todayKey: '2026-01-10',
    daysBack: 9
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
});
