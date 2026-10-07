'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { refreshCustomerDebtReports, startCustomerDebtReportRefreshSchedule, __sql__ } = require('./customerDebtReportRefresh');

test('refresh công nợ 1/3/7 chạy cho từng cơ sở cấu hình', async () => {
  const calls = [];
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 4 }; } };
  const result = await refreshCustomerDebtReports(pool, {
    getConfiguredBranches: () => [{ branch: 'hanoi' }, { branch: 'saigon' }], log: () => {}
  });
  assert.deepEqual(calls.map(call => call.params), [['hanoi'], ['saigon']]);
  assert.deepEqual(result, [{ branch: 'hanoi', rowCount: 4 }, { branch: 'saigon', rowCount: 4 }]);
  assert.match(__sql__.REFRESH_SQL, /customer_debt_activity_periods/);
  assert.match(__sql__.REFRESH_SQL, /VALUES \(1\), \(3\), \(7\)/);
  assert.match(__sql__.REFRESH_SQL, /ON CONFLICT \(branch, period_days, customer_id\) DO UPDATE/);
});

test('refresh công nợ ghi log/kết quả theo row_count của câu SQL, không phải rowCount của pg', async () => {
  const pool = { query: async () => ({ rowCount: 1, rows: [{ row_count: 712 }] }) };
  const result = await refreshCustomerDebtReports(pool, { getConfiguredBranches: () => [{ branch: 'hanoi' }], log: () => {} });
  assert.deepEqual(result, [{ branch: 'hanoi', rowCount: 712 }]);
});

// Ban cu xoa + nap lai toan bo dong moi 5 phut (~3 trieu UPDATE tren ~1.000 dong)
// va gom TOAN BO lich su hoa don/tra hang/phieu thu chi roi moi loc 7 ngay.
test('refresh công nợ chỉ upsert dòng đổi + xoá dòng không còn, và lọc 7 ngày ngay tại nguồn (dùng được index)', () => {
  const sql = __sql__.REFRESH_SQL;
  assert.doesNotMatch(sql, /DELETE FROM customer_debt_activity_periods WHERE branch = \$1\s*\)/,
    'khong duoc xoa het roi nap lai');
  assert.match(sql, /WHERE customer_debt_activity_periods\.customer_name IS DISTINCT FROM EXCLUDED\.customer_name/);
  assert.match(sql, /DELETE FROM customer_debt_activity_periods t[\s\S]*NOT EXISTS[\s\S]*FROM current_rows c/);
  for (const column of ['purchase_date', 'return_date', 'trans_date']) {
    assert.match(sql, new RegExp(`${column} >= \\(\\(\\(now\\(\\) AT TIME ZONE 'Asia/Ho_Chi_Minh'\\)::date - 6\\)::timestamp AT TIME ZONE 'UTC'\\)`),
      `${column}: phai loc 7 ngay bang cot goc`);
  }
});

test('scheduler đăng ký interval và fail-soft khi refresh lỗi', async () => {
  let scheduled;
  const logs = [];
  const handle = startCustomerDebtReportRefreshSchedule(
    { query: async () => { throw new Error('db down'); } },
    { intervalMs: 123, setIntervalFn: (fn, ms) => { scheduled = { fn, ms }; return 'handle'; },
      scheduleImmediate: () => {},
      getConfiguredBranches: () => [{ branch: 'hanoi' }], log: message => logs.push(message) }
  );
  assert.equal(handle, 'handle');
  assert.equal(scheduled.ms, 123);
  scheduled.fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(logs[0], /Loi khi refresh/);
});

test('scheduler chạy ngay một lượt lúc khởi động, không đợi hết interval', async () => {
  const calls = [];
  let immediateFn;
  startCustomerDebtReportRefreshSchedule(
    { query: async () => { calls.push('query'); return { rowCount: 0 }; } },
    { setIntervalFn: () => 'handle', scheduleImmediate: fn => { immediateFn = fn; },
      getConfiguredBranches: () => [{ branch: 'hanoi' }], log: () => {} }
  );
  assert.equal(typeof immediateFn, 'function');
  assert.equal(calls.length, 0);
  immediateFn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});

test('cash activity uses Vietnamese days after UTC normalization and excludes retired source IDs',async()=>{
  const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
  try {
    await db.exec(`CREATE TABLE customers(branch text,id bigint,name text,code text,raw jsonb);
      CREATE TABLE invoices(branch text,customer_id bigint,purchase_date timestamptz,raw jsonb);
      CREATE TABLE returns(branch text,customer_id bigint,return_date timestamptz,raw jsonb);
      CREATE TABLE cash_flows(branch text,customer_id bigint,trans_date timestamptz,raw jsonb,source_missing_at timestamptz);
      CREATE TABLE customer_debt_activity_periods(branch text,period_days int,customer_id bigint,customer_name text,refreshed_at timestamptz,PRIMARY KEY(branch,period_days,customer_id));
      INSERT INTO customers SELECT 'hanoi',n,'KH'||n,'KH'||n,'{}'::jsonb FROM generate_series(1,4) n;
      INSERT INTO cash_flows VALUES('hanoi',1,'2026-10-06T18:00:00Z','{"status":0}',NULL),('hanoi',2,'2026-10-06T18:00:00Z','{"status":0}','2026-10-07T00:00:00Z'),('hanoi',3,'2026-09-30T18:00:00Z','{"status":0}',NULL);
      INSERT INTO invoices VALUES('hanoi',4,'2026-10-07T00:30:00Z','{"statusValue":"Hoàn thành"}');`);
    const sql=__sql__.REFRESH_SQL.replaceAll('now()',"TIMESTAMPTZ '2026-10-07T05:00:00Z'");
    await db.query(sql,['hanoi']);
    const rows=(await db.query('SELECT period_days,customer_id FROM customer_debt_activity_periods ORDER BY period_days,customer_id')).rows;
    assert.deepEqual(rows.map(r=>[r.period_days,r.customer_id]),[[1,1],[1,4],[3,1],[3,4],[7,1],[7,3],[7,4]]);
  } finally {await db.close();}
});
