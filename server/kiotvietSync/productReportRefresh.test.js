'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  refreshProductReport, refreshProductReportIfDue, startProductReportSchedule, __sql__, __test__
} = require('./productReportRefresh');

function fakeClient(insertRowCount = 7) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK' || sql === TRUNCATE_SQL) return {};
      return { rowCount: insertRowCount };
    },
    release: () => {}
  };
}

const TRUNCATE_SQL = 'TRUNCATE product_report, product_report_customers';

function fakePool(client) {
  return { connect: async () => client, query: async () => ({ rows: [] }) };
}

test('refreshProductReport chay dung trinh tu BEGIN/TRUNCATE/INSERT/COMMIT trong 1 transaction', async () => {
  const client = fakeClient(42);
  const pool = fakePool(client);
  const logs = [];
  const result = await refreshProductReport(pool, { log: (m) => logs.push(m) });

  assert.deepEqual(client.calls.map((c) => c.sql.split('\n')[0].trim() || c.sql), [
    'BEGIN', TRUNCATE_SQL, __sql__.REFRESH_SQL.split('\n')[0].trim() || __sql__.REFRESH_SQL, 'COMMIT'
  ]);
  assert.deepEqual(client.calls[2].params, [['hanoi', 'saigon']]);
  assert.equal(result.rowCount, 42);
  assert.match(logs[0], /42/);
});

test('REFRESH_SQL luu lai customer_agg vao product_report_customers trong CUNG 1 cau lenh (quet 90 ngay 1 lan)', () => {
  const sql = __sql__.REFRESH_SQL;
  assert.match(sql, /INSERT INTO product_report_customers\s*\(product_key, customer_key, customer_name, revenue\)/);
  assert.match(sql, /FROM customer_agg/);
  // Ca 2 bang cung doc customer_agg => phai la CTE, khong quet lai invoice_details lan nua.
  assert.equal((sql.match(/FROM invoice_details/g) || []).length, 1);
  assert.match(sql, /INSERT INTO product_report \(/);
});

test('REFRESH_SQL tru hang khach tra khoi doanh so rong cua khach (khop revenue_90d) va chan ty le > 100%', () => {
  const sql = __sql__.REFRESH_SQL;
  assert.match(sql, /FROM return_details rd/);
  assert.match(sql, /r\.raw->>'statusValue' = 'Đã trả'/);
  assert.match(sql, /-\(CASE/, 'dong tra hang la dong AM');
  assert.match(sql, /HAVING SUM\(amount\) > 0/);
  assert.match(sql, /LEAST\(1, /);
});

test('REFRESH_SQL: Ton co ban = ton HN + ton SG - Dat hang PHIEU TAM (quy tac 2026-10-06, khong cong hang dang van chuyen)', () => {
  const sql = __sql__.REFRESH_SQL;
  // Chi Phieu tam bi tru (khong con 'Đang xử lý' / 'Đã xác nhận').
  assert.match(sql, /COALESCE\(o\.raw->>'statusValue', ''\) = 'Phiếu tạm'/);
  assert.doesNotMatch(sql, /statusValue', ''\) IN \(/, 'khong con loc nhieu trang thai (IN (...)) cho don dat hang');
  assert.match(sql, /hn\.on_hand \+ COALESCE\(sg\.on_hand, 0\) - COALESCE\(po\.qty, 0\),/);
  // Hang dang van chuyen (order_suppliers) khong con tinh vao ton co the ban.
  assert.doesNotMatch(sql, /in_transit|order_suppliers|tr\.qty/);
  // Chi 1 tham so ($1 = danh sach co so).
  assert.equal(/\$2/.test(sql), false);
});

test('refreshProductReport ROLLBACK va nem loi neu INSERT that bai', async () => {
  const calls = [];
  const client = {
    calls,
    query: async (sql) => {
      calls.push(sql);
      if (sql === __sql__.REFRESH_SQL) throw new Error('boom');
      return {};
    },
    release: () => {}
  };
  await assert.rejects(() => refreshProductReport(fakePool(client), { log: () => {} }), /boom/);
  assert.ok(calls.includes('ROLLBACK'));
});

test('refreshProductReportIfDue bo qua neu da tinh cho ngay VN hom nay', async () => {
  const now = new Date('2026-09-23T10:00:00Z'); // 17h VN cung ngay
  const pool = {
    query: async () => ({ rows: [{ last_computed_at: new Date('2026-09-23T00:05:00Z') }] })
  };
  const result = await refreshProductReportIfDue(pool, { now: () => now, log: () => {} });
  assert.deepEqual(result, { skipped: true });
});

test('refreshProductReportIfDue tinh lai neu chua tinh cho ngay VN hom nay', async () => {
  const now = new Date('2026-09-23T00:03:00Z'); // dau ngay VN moi (07h VN)
  const client = fakeClient(10);
  const pool = {
    query: async (sql) => {
      if (sql.includes('MAX(computed_at)')) return { rows: [{ last_computed_at: new Date('2026-09-21T20:00:00Z') }] };
      return { rows: [] };
    },
    connect: async () => client
  };
  const result = await refreshProductReportIfDue(pool, { now: () => now, log: () => {} });
  assert.deepEqual(result, { skipped: false, rowCount: 10 });
});

test('refreshProductReportIfDue tinh lai neu bang con trong (chua tung tinh)', async () => {
  const client = fakeClient(3);
  const pool = { query: async () => ({ rows: [{ last_computed_at: null }] }), connect: async () => client };
  const result = await refreshProductReportIfDue(pool, { now: () => new Date(), log: () => {} });
  assert.deepEqual(result, { skipped: false, rowCount: 3 });
});

test('startProductReportSchedule dang ky interval va chay ngay 1 lan luc boot', async () => {
  let scheduledFn;
  let scheduledMs;
  let immediateFn;
  const setIntervalFn = (fn, ms) => { scheduledFn = fn; scheduledMs = ms; return 'handle-product-report'; };
  const scheduleImmediate = (fn) => { immediateFn = fn; };
  const client = fakeClient(5);
  const pool = { query: async () => ({ rows: [{ last_computed_at: null }] }), connect: async () => client };

  const handle = startProductReportSchedule(pool, { intervalMs: 5000, setIntervalFn, scheduleImmediate, log: () => {} });

  assert.equal(handle, 'handle-product-report');
  assert.equal(scheduledMs, 5000);
  assert.equal(typeof immediateFn, 'function');
  assert.equal(typeof scheduledFn, 'function');

  await immediateFn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(client.calls.some((c) => c.sql === 'BEGIN'), 'phai tinh ngay 1 lan luc boot');
});

test('vnDateKey tra ve ngay lich VN (UTC+7), khong phai ngay UTC', () => {
  // 2026-09-22T18:30:00Z = 2026-09-23 01:30 VN -> da sang ngay moi theo lich VN.
  assert.equal(__test__.vnDateKey(new Date('2026-09-22T18:30:00Z')), '2026-09-23');
  assert.equal(__test__.vnDateKey(new Date('2026-09-22T10:00:00Z')), '2026-09-22');
});
