'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./backfillProgressRepository');

// Fake bang backfill_progress trong bo nho - hieu dung ngu nghia ON CONFLICT
// cua 3 cau SQL ghi trong backfillProgressRepository.js, de test duoc hanh vi
// idempotent/resume ma khong can Postgres that.
function createFakeTable() {
  const rows = new Map();
  const key = (b, e, c) => `${b}|${e}|${c}`;

  return {
    calls: [],
    async query(sql, params) {
      this.calls.push([sql, params]);
      const text = sql.replace(/\s+/g, ' ').trim();
      const [branch, entity, chunkKey] = params;
      const k = key(branch, entity, chunkKey);

      if (text.startsWith('SELECT')) {
        const row = rows.get(k);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (text.includes("VALUES ($1, $2, $3, 'running', now(), now())")) {
        const existing = rows.get(k);
        if (existing) {
          existing.status = 'running';
          existing.updated_at = 'now';
        } else {
          rows.set(k, { branch, entity, chunk_key: chunkKey, status: 'running', next_item: 0, records_synced: 0, last_error: null, started_at: 'now', finished_at: null, updated_at: 'now' });
        }
        return { rows: [] };
      }
      if (text.includes('next_item, records_synced, updated_at')) {
        const [, , , nextItem, recordsInPage] = params;
        const existing = rows.get(k);
        if (existing) {
          existing.next_item = nextItem;
          existing.records_synced += recordsInPage;
          existing.status = 'running';
        } else {
          rows.set(k, { branch, entity, chunk_key: chunkKey, status: 'running', next_item: nextItem, records_synced: recordsInPage, last_error: null, started_at: null, finished_at: null, updated_at: 'now' });
        }
        return { rows: [] };
      }
      if (text.startsWith("UPDATE backfill_progress SET status = 'done'")) {
        const row = rows.get(k);
        if (row) { row.status = 'done'; row.finished_at = 'now'; }
        return { rows: [] };
      }
      if (text.startsWith("UPDATE backfill_progress SET status = 'error'")) {
        const [, , , errorMessage] = params;
        const row = rows.get(k);
        if (row) { row.status = 'error'; row.last_error = errorMessage; }
        return { rows: [] };
      }
      throw new Error(`Fake SQL khong nhan dien duoc: ${text}`);
    },
    rows
  };
}

test('getChunkProgress tra null cho chunk chua tung chay', async () => {
  const client = createFakeTable();
  const progress = await repo.getChunkProgress(client, 'hanoi', 'invoices', '2026-01');
  assert.equal(progress, null);
});

test('markChunkStarted roi advanceChunkProgress khong tao dong trung, cong don records_synced', async () => {
  const client = createFakeTable();
  await repo.markChunkStarted(client, 'hanoi', 'invoices', '2026-01');
  await repo.advanceChunkProgress(client, 'hanoi', 'invoices', '2026-01', { nextItem: 100, recordsInPage: 40 });
  await repo.advanceChunkProgress(client, 'hanoi', 'invoices', '2026-01', { nextItem: 200, recordsInPage: 35 });
  assert.equal(client.rows.size, 1);
  const row = await repo.getChunkProgress(client, 'hanoi', 'invoices', '2026-01');
  assert.equal(row.next_item, 200);
  assert.equal(row.records_synced, 75);
  assert.equal(row.status, 'running');
});

test('markChunkDone danh dau xong, cac lan chay lai phai bo qua chunk nay', async () => {
  const client = createFakeTable();
  await repo.markChunkStarted(client, 'saigon', 'categories', 'full');
  await repo.advanceChunkProgress(client, 'saigon', 'categories', 'full', { nextItem: 50, recordsInPage: 50 });
  await repo.markChunkDone(client, 'saigon', 'categories', 'full');
  const row = await repo.getChunkProgress(client, 'saigon', 'categories', 'full');
  assert.equal(row.status, 'done');
  assert.equal(row.next_item, 50);
});

test('markChunkError giu nguyen next_item da luu de resume dung vi tri', async () => {
  const client = createFakeTable();
  await repo.markChunkStarted(client, 'hanoi', 'orders', 'full');
  await repo.advanceChunkProgress(client, 'hanoi', 'orders', 'full', { nextItem: 300, recordsInPage: 100 });
  await repo.markChunkError(client, 'hanoi', 'orders', 'full', 'network timeout');
  const row = await repo.getChunkProgress(client, 'hanoi', 'orders', 'full');
  assert.equal(row.status, 'error');
  assert.equal(row.next_item, 300);
  assert.equal(row.last_error, 'network timeout');
});

test('cac cau SQL dung placeholder, khong noi chuoi du lieu truc tiep', async () => {
  const client = createFakeTable();
  await repo.markChunkStarted(client, 'hanoi', 'invoices', '2026-01');
  await repo.markChunkError(client, 'hanoi', 'invoices', '2026-01', 'boom');
  for (const [sql, params] of client.calls) {
    assert.ok(Array.isArray(params), 'moi cau goi phai dung tham so, khong noi chuoi');
    assert.doesNotMatch(sql, /boom/, 'gia tri du lieu khong duoc noi truc tiep vao SQL');
  }
});
