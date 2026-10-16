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
  // Khop nguyen van dieu kien cua idx_orders_phieu_tam (khong boc COALESCE) de dung duoc index rieng.
  assert.match(sql, /\(raw->>'statusValue'\) = 'Phiếu tạm'/);
  assert.doesNotMatch(sql, /COALESCE\(o\.raw->>'statusValue'/, 'COALESCE lam mat index idx_orders_phieu_tam');
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

// ---- Co ban / Mo ta THEO TUNG CO SO (migration 0057) ----
test('REFRESH_SQL ghi them Co ban HN/SG va Mo ta HN/SG; tong hai cot co ban = available_to_sell (cung nguon phieu tam)', () => {
  const sql = __sql__.REFRESH_SQL;
  assert.match(sql, /available_hanoi, available_saigon, description_hanoi, description_saigon, computed_at/);
  assert.match(sql, /hn\.on_hand - COALESCE\(po\.qty_hanoi, 0\),\s+COALESCE\(sg\.on_hand, 0\) - COALESCE\(po\.qty_saigon, 0\),\s+hn\.description,\s+sg\.description,\s+now\(\)/);
  // Van chi 1 lan quet phieu tam: tach theo co so bang FILTER, khong them truy van thu hai.
  assert.equal((sql.match(/FROM orders/g) || []).length, 1);
  assert.match(sql, /FILTER \(WHERE d\.branch = 'hanoi'\)/);
  assert.match(sql, /FILTER \(WHERE d\.branch = 'saigon'\)/);
  // Mo ta chi con tab/xuong dong coi nhu trong (btrim mac dinh chi cat dau cach).
  assert.equal((sql.match(/NULLIF\(btrim\(p\.raw->>'description', E' \\t\\r\\n'\), ''\) AS description/g) || []).length, 2);
});

test('SQL that (PGlite): phieu tam tach dung theo co so, tong = HN + SG, chi tinh Phieu tam; mo ta cat tab/xuong dong', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const R = __sql__.REFRESH_SQL;
  const cut = (from, to) => R.slice(R.indexOf(from), R.indexOf(to, R.indexOf(from) + 1)).trim().replace(/,$/, '');
  const pending = cut('pending_orders AS (', '  sales_30d AS (');
  const hnProducts = cut('hn_products AS (', '  sg_products AS (');
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE products (branch text, id bigint, code text, name text, raw jsonb);
      CREATE TABLE orders (branch text, id bigint, raw jsonb);
      CREATE TABLE order_details (branch text, order_id bigint, product_id bigint, quantity numeric, raw jsonb);
      INSERT INTO products VALUES
        ('hanoi', 1, 'A', 'A', '{"description":"  T50 # 30/9 | VAT+3200đ\\n"}'),
        ('saigon', 1, 'A', 'A', '{"description":"\\n\\t "}'),
        ('hanoi', 2, 'B', 'B', '{}');
      INSERT INTO orders VALUES
        ('hanoi', 10, '{"statusValue":"Phiếu tạm"}'), ('saigon', 20, '{"statusValue":"Phiếu tạm"}'),
        ('hanoi', 11, '{"statusValue":"Hoàn thành"}');
      INSERT INTO order_details VALUES
        ('hanoi', 10, 1, 5, '{}'), ('saigon', 20, 1, 3, '{"productCode":"A"}'),
        ('hanoi', 11, 2, 9, '{}'), ('hanoi', 10, 2, 2, '{}');`);
    const rows = (await db.query(`WITH ${pending} SELECT * FROM pending_orders ORDER BY product_key`, [['hanoi', 'saigon']])).rows;
    assert.deepEqual(rows, [
      { product_key: 'a', qty: 8, qty_hanoi: 5, qty_saigon: 3 },
      { product_key: 'b', qty: 2, qty_hanoi: 2, qty_saigon: 0 } // don Hoan thanh (9) khong bi tru
    ]);
    const products = (await db.query(`WITH ${hnProducts} SELECT code, description FROM hn_products ORDER BY code`)).rows;
    assert.deepEqual(products, [{ code: 'A', description: 'T50 # 30/9 | VAT+3200đ' }, { code: 'B', description: null }]);
    const blank = (await db.query(`SELECT NULLIF(btrim(raw->>'description', ${__sql__.DESCRIPTION_TRIM_CHARS}), '') AS d FROM products WHERE branch = 'saigon'`)).rows;
    assert.deepEqual(blank, [{ d: null }], 'mo ta chi gom tab/xuong dong/dau cach coi nhu khong co');
  } finally { await db.close(); }
});

test('refreshProductReportIfDue: da tinh hom nay nhung con dong chua co cot theo co so (vua ap 0057) => tinh lai ngay', async () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const client = fakeClient(9);
  const pool = {
    query: async (sql) => {
      assert.match(sql, /bool_or\(available_hanoi IS NULL\)/);
      return { rows: [{ last_computed_at: new Date('2026-09-23T00:05:00Z'), needs_branch_columns: true }] };
    },
    connect: async () => client
  };
  assert.deepEqual(await refreshProductReportIfDue(pool, { now: () => now, log: () => {} }), { skipped: false, rowCount: 9 });
  // Da du cot (khong con NULL) => van bo qua nhu cu.
  const settled = { query: async () => ({ rows: [{ last_computed_at: new Date('2026-09-23T00:05:00Z'), needs_branch_columns: false }] }) };
  assert.deepEqual(await refreshProductReportIfDue(settled, { now: () => now, log: () => {} }), { skipped: true });
});

test('refreshProductReportIfDue: chua ap migration 0057 (42703) => doc moc thoi gian bang cau cu, hanh vi khong doi', async () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const queries = [];
  const pool = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('available_hanoi')) throw Object.assign(new Error('column "available_hanoi" does not exist'), { code: '42703' });
      return { rows: [{ last_computed_at: new Date('2026-09-23T00:05:00Z') }] };
    }
  };
  assert.deepEqual(await refreshProductReportIfDue(pool, { now: () => now, log: () => {} }), { skipped: true });
  assert.equal(queries.length, 2);
  assert.doesNotMatch(queries[1], /available_hanoi/);
  // Loi khac 42703 van duoc nem ra, khong bi nuot.
  await assert.rejects(() => refreshProductReportIfDue({ query: async () => { throw new Error('db down'); } }, { now: () => now, log: () => {} }), /db down/);
});
