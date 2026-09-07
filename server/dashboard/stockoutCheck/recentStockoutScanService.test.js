'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runRecentStockoutScanJob } = require('./recentStockoutScanService');
const { createJobStore } = require('./jobManager');

function fakeClient({ productPages, historyPages = {} }) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint === 'products') {
        for (const page of productPages) await onPage(page.items, page.meta);
        return;
      }
      const pages = historyPages[endpoint] || [];
      for (const page of pages) await onPage(page.items, page.meta);
    }
  };
}

test('chi lay ung vien dang kinh doanh va ton kho tong = 0', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = fakeClient({
    productPages: [{
      items: [
        { code: 'SP001', name: 'Con hang', isActive: true, inventories: [{ onHand: 3 }] },
        { code: 'SP002', name: 'Het hang, dang ban', isActive: true, inventories: [{ onHand: 0 }, { onHand: 0 }] },
        { code: 'SP003', name: 'Het hang nhung ngung kinh doanh', isActive: false, inventories: [{ onHand: 0 }] },
        { code: 'SP004', name: 'Khong co truong isActive (mac dinh dang KD)', inventories: [{ onHand: 0 }] }
      ],
      meta: { pagesLoaded: 1, recordsLoaded: 4, total: 4 }
    }]
  });

  await runRecentStockoutScanJob(store, jobId, {
    client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  const codes = job.result.rows.map((r) => r.code).sort();
  assert.deepEqual(codes, ['SP002', 'SP004']);
});

test('ung vien het hang du 5 ngay lien tuc tinh den hom nay thi liet ke, chua du 5 ngay thi bo qua', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = fakeClient({
    productPages: [{
      items: [
        { code: 'SP001', name: 'Het 5 ngay', isActive: true, inventories: [{ onHand: 0 }] },
        { code: 'SP002', name: 'Het 2 ngay', isActive: true, inventories: [{ onHand: 0 }] }
      ],
      meta: { pagesLoaded: 1, recordsLoaded: 2, total: 2 }
    }],
    historyPages: {
      invoices: [{
        items: [
          // SP001: ban het 5 ngay truoc (2026-01-06), tu do khong nhap lai -> het hang lien tuc 5 ngay den 2026-01-10
          { status: 1, purchaseDate: '2026-01-06T00:00:00Z', invoiceDetails: [{ productCode: 'SP001', quantity: 3 }] },
          // SP002: ban het 2 ngay truoc (2026-01-09) -> chi het hang 2 ngay, chua du nguong 5
          { status: 1, purchaseDate: '2026-01-09T00:00:00Z', invoiceDetails: [{ productCode: 'SP002', quantity: 2 }] }
        ],
        meta: { pagesLoaded: 1, recordsLoaded: 2, total: 2 }
      }],
      purchaseorders: [{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }],
      returns: [{ items: [], meta: { pagesLoaded: 1, recordsLoaded: 0, total: 0 } }]
    }
  });

  await runRecentStockoutScanJob(store, jobId, {
    client, todayKey: '2026-01-10', daysBack: 9, minConsecutiveDays: 5
  });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.rows.length, 1);
  assert.equal(job.result.rows[0].code, 'SP001');
  assert.equal(job.result.rows[0].lastOutOfStockDate, '2026-01-06');
  assert.equal(job.result.rows[0].daysOutOfStock, 5);
});

test('khong co ung vien nao thi tra ket qua rong, khong goi API chung tu', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  let historyCalled = false;
  const client = {
    async fetchAllPages(endpoint, query, onPage) {
      if (endpoint === 'products') {
        await onPage([{ code: 'SP001', name: 'Con hang', isActive: true, inventories: [{ onHand: 10 }] }],
          { pagesLoaded: 1, recordsLoaded: 1, total: 1 });
        return;
      }
      historyCalled = true;
    }
  };

  await runRecentStockoutScanJob(store, jobId, { client, todayKey: '2026-01-10', daysBack: 9 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.deepEqual(job.result.rows, []);
  assert.equal(job.result.totalCandidates, 0);
  assert.equal(historyCalled, false);
});

test('loi khi quet danh muc thi job chuyen sang status error', async () => {
  const store = createJobStore();
  const jobId = store.createJob();
  const client = {
    async fetchAllPages(endpoint) {
      if (endpoint === 'products') throw new Error('KiotViet timeout');
    }
  };

  await runRecentStockoutScanJob(store, jobId, { client, todayKey: '2026-01-10', daysBack: 9 });

  const job = store.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.match(job.error.message, /KiotViet timeout/);
});
