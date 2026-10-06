'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createRepository } = require('./cashbookRepository');
const { parseFilters } = require('./cashbookFilters');
const express = require('express');
const { createCashbookRouter } = require('./cashbookRoutes');
const now = new Date('2026-10-06T12:00:00Z');
const f = (q) =>
  parseFilters({ from: '2026-10-01', to: '2026-10-06', ...q }, now);
let db, repo;
test.before(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE cash_flows(branch text,id bigint,code text,is_receipt boolean,amount numeric,account_id bigint,status int,trans_date timestamptz,user_id bigint,description text,raw jsonb,synced_at timestamptz default now(),primary key(branch,id));CREATE TABLE staff(branch text,id bigint,name text,primary key(branch,id));CREATE TABLE cash_book_accounts(id bigint primary key,bank_name text,account_no text,description text,raw jsonb);CREATE TABLE cash_book_account_banks(account_no text primary key,bank text not null,updated_by text,updated_at timestamptz default now());CREATE TABLE cash_book_checkpoints(id bigserial primary key,account_id bigint,checkpoint_at timestamptz,balance numeric,system_balance numeric,diff numeric,note text,created_by text,created_at timestamptz default now());
 CREATE TABLE sync_checkpoints(branch text,entity text,last_synced_at timestamptz);
 INSERT INTO sync_checkpoints VALUES('hanoi','cash_flows','2026-10-06T03:00:00Z'),('saigon','cash_flows','2026-10-06T04:00:00Z');
 INSERT INTO staff VALUES ('hanoi',9,'Lan - 1234567890');INSERT INTO cash_book_accounts VALUES (7,'Bank','123','Main','{}');
 INSERT INTO cash_book_checkpoints(account_id,checkpoint_at,balance,created_by) VALUES (7,'2026-10-02T00:00:00Z',100,'test');`);
  const rows = [
    ['hanoi', 1, 7, '2026-10-01T00:00:00Z', 10, 0],
    ['hanoi', 2, 7, '2026-10-02T00:00:00Z', 20, 0],
    ['hanoi', 3, 7, '2026-10-03T00:00:00Z', -30, 0],
    ['saigon', 3, 7, '2026-10-03T00:00:00Z', 5, 0],
    ['hanoi', 4, 7, '2026-10-04T00:00:00Z', 999, 1],
    ['hanoi', 5, null, '2026-10-03T00:00:00Z', 8, 0],
    ['saigon', 6, -1, '2026-10-03T00:00:00Z', 9, 0],
  ];
  for (const [branch, id, account, date, amount, status] of rows)
    await db.query(
      'INSERT INTO cash_flows(branch,id,code,is_receipt,amount,account_id,status,trans_date,user_id,description,raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,9,$9,$10)',
      [
        branch,
        id,
        `P${id}`,
        amount > 0,
        amount,
        account,
        status,
        date,
        'note',
        {
          cashGroup: "Tên ' nhóm",
          createdBy: 9,
          userId: 9,
          partnerName: 'Alice',
          partnerId: 99,
          contactNumber: '123%',
          usedForFinancialReporting: 0,
        },
      ],
    );
  // PGlite chưa có advisory locks; thay đúng primitive khóa bằng no-op vì pool test tuần tự, giữ toàn bộ SQL/giao dịch thật.
  const pool = {
    query: (s, p) => db.query(s, p),
    connect: async () => ({
      query: (s, p) =>
        s.includes('pg_advisory_xact_lock')
          ? Promise.resolve({ rows: [] })
          : db.query(s, p),
      release() {},
    }),
  };
  repo = createRepository(pool, { now: () => now });
});
test.after(async () => {
  await db.close();
});
test('summary SQL signed amount/cancel excludes, missing fund null and historical opening', async () => {
  const s = await repo.summary(f({ fund: '7' }));
  assert.equal(s.balances[0].balance, 75);
  assert.equal(s.kpis.openingBalance, 70);
  assert.equal(s.kpis.totalReceipts, 35);
  assert.equal(s.kpis.totalPayments, 30);
  assert.equal(s.kpis.closingBalance, 75);
  const all = await repo.summary(f({}));
  assert.equal(all.balances.length, 3);
  assert.equal(all.unclosedCount, 2);
  assert.equal(all.totalBalance, 75);
  assert.equal(all.kpis.openingBalance, null);
});
test('closing KPI is the real fund balance even when display filters narrow receipts/payments', async () => {
  const s = await repo.summary(f({ fund: '7', docTypes: 'receipt' }));
  assert.equal(s.kpis.openingBalance, 70);
  assert.equal(s.kpis.totalReceipts, 35);
  assert.equal(s.kpis.totalPayments, 0);
  assert.equal(s.kpis.closingBalance, 75);
  const none = await repo.summary(f({ fund: '7', partnerQ: 'không khớp' }));
  assert.equal(none.kpis.totalReceipts, 0);
  assert.equal(none.kpis.closingBalance, 75);
});
test('code and note search narrow entries and disable running balance', async () => {
  const byCode = await repo.entries(f({ fund: '7', code: 'p2' }));
  assert.deepEqual(byCode.entries.map((row) => row.code), ['P2']);
  assert.equal(byCode.runningBalanceAvailable, false);
  assert.equal((await repo.entries(f({ note: 'NOT' }))).total > 0, true);
  assert.equal((await repo.entries(f({ note: 'khong-co' }))).total, 0);
});
test('preview uses exact timestamp and ignores cancelled display filter', async () => {
  const s = await repo.summary(
    f({ fund: '7', at: '2026-10-03T00:00:00Z', statuses: 'cancelled' }),
  );
  assert.equal(s.balances[0].balance, 75);
  assert.equal(s.kpis.totalReceipts, 0);
  assert.equal(new Date(s.syncedAt).toISOString(), '2026-10-06T04:00:00.000Z');
  assert.equal(
    new Date((await repo.summary(f({ groups: '' }))).syncedAt).toISOString(),
    '2026-10-06T04:00:00.000Z',
  );
});
test('window runs full fund timeline before status/date and pagination; ties deterministic', async () => {
  const page = await repo.entries(f({ fund: '7', page: '1', pageSize: '2' }));
  assert.equal(page.total, 5);
  assert.deepEqual(
    page.entries.map((e) => [e.branch, e.runningBalance]),
    [
      ['hanoi', 75],
      ['saigon', 75],
    ],
  );
  const next = await repo.entries(f({ fund: '7', page: '2', pageSize: '2' }));
  assert.deepEqual(
    next.entries.map((e) => e.runningBalance),
    [70, 100],
  );
  const only = await repo.entries(f({ fund: '7', statuses: 'cancelled' }));
  assert.equal(only.entries[0].runningBalance, 75);
  const narrow = await repo.entries(f({ fund: '7', docTypes: 'payment' }));
  assert.equal(narrow.entries[0].runningBalance, null);
});
test('selected-fund export computes checkpoint anchors once per query', async () => {
  let exportQuery;
  const measured = createRepository({
    query: async (sql, params) => {
      if (sql.includes('SELECT * FROM filtered ORDER BY'))
        exportQuery = { sql, params };
      return db.query(sql, params);
    },
  }, { now: () => now });
  await measured.entries(f({ fund: '7' }), { exportLimit: 20001 });
  const plan = (await db.query(`EXPLAIN ${exportQuery.sql}`, exportQuery.params))
    .rows.map((row) => row['QUERY PLAN']).join('\n');
  assert.match(plan, /CTE checkpoint_anchors/);
  assert.match(plan, /CTE Scan on checkpoint_anchors/);
});
test('group name missing ID kept and parameterized filters match real SQL', async () => {
  const opts = await repo.filterOptions();
  assert.equal(opts.groups[0].label, "Tên ' nhóm");
  assert.equal(opts.staff[0].label, 'Lan');
  assert.equal(opts.creators[0].label, 'Lan');
  assert.equal(
    opts.funds.find((e) => e.fund === '-1').name,
    'Tài khoản #-1 (không có trong danh sách KiotViet)',
  );
  const r = await repo.entries(
    f({ groups: opts.groups[0].key, partnerPhone: '123%' }),
  );
  assert.equal(r.total, 7);
  assert.equal((await repo.entries(f({ groups: '' }))).total, 0);
  assert.equal((await repo.entries(f({ partnerQ: '99' }))).total, 7);
});
test('transactions first cash checkpoint null, following snapshots/diff, historical checkpoint', async () => {
  const first = await repo.insertCheckpoint(
    {
      fund: 'cash',
      checkpointAt: '2026-10-02T00:00:00Z',
      balance: 100,
      note: '',
    },
    'Tester',
  );
  assert.equal(first.systemBalance, null);
  assert.equal(first.diff, null);
  const second = await repo.insertCheckpoint(
    { fund: 'cash', checkpointAt: '2026-10-04T00:00:00Z', balance: 110 },
    'Tester',
  );
  assert.equal(second.systemBalance, 108);
  assert.equal(second.diff, 2);
  const old = await repo.insertCheckpoint(
    { fund: '7', checkpointAt: '2026-10-01T12:00:00Z', balance: 85 },
    'Tester',
  );
  assert.equal(old.systemBalance, 80);
  assert.equal(old.diff, 5);
});
test('concurrent checkpoint writes serialize snapshot calculation including cash', async () => {
  const [a, b] = await Promise.all([
    repo.insertCheckpoint(
      { fund: 'cash', checkpointAt: '2026-10-05T00:00:00Z', balance: 120 },
      'a',
    ),
    repo.insertCheckpoint(
      { fund: 'cash', checkpointAt: '2026-10-05T00:00:00Z', balance: 130 },
      'b',
    ),
  ]);
  assert.equal(a.systemBalance, 110);
  assert.equal(b.systemBalance, 120);
});
test('failed insert rolls back no checkpoint and transaction remains usable', async () => {
  await db.exec(
    `ALTER TABLE cash_book_checkpoints ADD CONSTRAINT test_note CHECK(note IS DISTINCT FROM 'fail');`,
  );
  await assert.rejects(
    repo.insertCheckpoint(
      {
        fund: 'cash',
        checkpointAt: '2026-10-05T01:00:00Z',
        balance: 140,
        note: 'fail',
      },
      'a',
    ),
  );
  assert.equal(
    (await repo.checkpoints(f({ fund: 'cash' }))).checkpoints.length,
    4,
  );
  assert.equal(
    (await repo.summary(f({ fund: 'cash' }))).balances[0].balance,
    130,
  );
});
test('fractional checkpoint differences use exact NUMERIC; unknown bank cannot create fund', async () => {
  await assert.rejects(
    repo.insertCheckpoint(
      { fund: '888', checkpointAt: '2026-10-05T00:00:00Z', balance: 1 },
      'test',
    ),
    (e) => e.statusCode === 400,
  );
  await repo.insertCheckpoint(
    { fund: '-1', checkpointAt: '2026-10-04T00:00:00Z', balance: '12.1' },
    'test',
  );
  const cp = await repo.insertCheckpoint(
    { fund: '-1', checkpointAt: '2026-10-05T00:00:00Z', balance: '12.3' },
    'test',
  );
  assert.equal(cp.diff, 0.2);
  const row = (
    await db.query(
      'SELECT diff::text diff FROM cash_book_checkpoints WHERE id=$1',
      [cp.id],
    )
  ).rows[0];
  assert.equal(row.diff, '0.2');
});
test('POST route writes real snapshot/diff and user identity inside SQL transaction', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = {
      username: 'AuditUser',
      vaiTro: 'Quản lý',
      permissions: ['cashbook.view', 'cashbook.manage'],
    };
    req.effectiveUserResolved = true;
    next();
  });
  app.use('/api/cashbook', createCashbookRouter({ repository: repo }));
  const server = app.listen(0);
  try {
    const res = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cashbook/checkpoints`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fund: '7',
          checkpointAt: '2026-10-05T12:00:00Z',
          balance: 77.5,
          note: 'synthetic',
        }),
      },
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.checkpoint.systemBalance, 75);
    assert.equal(body.checkpoint.diff, 2.5);
    assert.equal(body.checkpoint.createdBy, 'AuditUser');
    assert.equal(body.checkpoint.fundName, 'Bank');
    const stored = (
      await db.query(
        'SELECT system_balance::text s,diff::text d,created_by FROM cash_book_checkpoints WHERE id=$1',
        [body.checkpoint.id],
      )
    ).rows[0];
    assert.deepEqual(stored, { s: '75', d: '2.5', created_by: 'AuditUser' });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('all narrowing filters disable cumulative; empty selections empty ledger; bank excludes cash', async () => {
  for (const q of [
    { groups: '' },
    { creators: '' },
    { staff: '' },
    { docTypes: '' },
    { statuses: '' },
    { fund: '' },
  ]) {
    assert.equal((await repo.entries(f(q))).total, 0);
  }
  for (const q of [
    { groups: "name:T%C3%AAn%20'%20nh%C3%B3m" },
    { creators: '9' },
    { staff: '9' },
    { partnerQ: 'Alice' },
    { partnerPhone: '123%' },
    { accounting: 'no' },
    { docTypes: 'receipt' },
    { fund: 'all' },
    { fund: '7,-1' },
  ]) {
    const result = await repo.entries(f({ fund: '7', ...q }));
    assert.equal(result.runningBalanceAvailable, false, JSON.stringify(q));
    assert.ok(result.entries.every((row) => row.runningBalance === null));
  }
  assert.equal((await repo.entries(f({ fund: 'bank' }))).total, 6);
  assert.equal((await repo.entries(f({ fund: 'cash' }))).total, 1);
  assert.equal((await repo.entries(f({ accounting: 'yes' }))).total, 0);
  assert.equal((await repo.entries(f({ creators: '999' }))).total, 0);
});
test('inclusive VN day bounds and window date narrowing preserve prior timeline', async () => {
  await db.query(
    `INSERT INTO cash_flows(branch,id,code,is_receipt,amount,account_id,status,trans_date,user_id,description,raw) VALUES('hanoi',100,'Boundary',TRUE,2,7,0,'2026-10-04T17:00:00Z',9,'','{}'),('hanoi',101,'Outside',TRUE,3,7,0,'2026-10-05T17:00:00Z',9,'','{}')`,
  );
  const r = await repo.entries(
    parseFilters({ fund: '7', from: '2026-10-05', to: '2026-10-05' }, now),
  );
  assert.deepEqual(
    r.entries.map((row) => row.code),
    ['Boundary'],
  );
  assert.equal(r.entries[0].runningBalance, 77);
  const s = await repo.summary(
    parseFilters({ fund: '7', from: '2026-10-05', to: '2026-10-05' }, now),
  );
  assert.equal(s.kpis.openingBalance, 75);
  assert.equal(s.kpis.totalReceipts, 2);
});
test('all rows exactly at checkpoint timestamp use closed balance including branch ties', async () => {
  await db.query(
    `INSERT INTO cash_flows(branch,id,code,is_receipt,amount,account_id,status,trans_date,user_id,description,raw) VALUES('saigon',2,'Tie',TRUE,5,7,0,'2026-10-02T00:00:00Z',9,'','{}')`,
  );
  try {
    const r = await repo.entries(
      parseFilters({ fund: '7', from: '2026-10-02', to: '2026-10-02' }, now),
    );
    assert.equal(r.entries.length, 2);
    assert.ok(r.entries.every((row) => row.runningBalance === 100));
  } finally {
    await db.query("DELETE FROM cash_flows WHERE branch='saigon' AND id=2");
  }
});
test('bank per account number is shared, trimmed, cleared and shown in summary', async () => {
  await db.exec("INSERT INTO cash_book_accounts VALUES (8,'Holder','123','','{}'),(9,'NoNumber',NULL,'','{}') ON CONFLICT DO NOTHING");
  assert.deepEqual(await repo.setAccountBank('7', '  Vietcombank  ', 'mgr'), { accountNo: '123', bank: 'Vietcombank' });
  const sum = await repo.summary(f({}));
  for (const id of ['7', '8'])
    assert.equal(sum.balances.find((r) => r.fund === id).bank, 'Vietcombank');
  assert.equal(sum.balances.find((r) => r.fund === 'cash').bank, '');
  assert.equal((await repo.filterOptions()).funds.find((r) => r.fund === '8').bank, 'Vietcombank');
  await assert.rejects(() => repo.setAccountBank('9', 'MB', 'mgr'), /chưa có số TK/);
  await assert.rejects(() => repo.setAccountBank('999', 'MB', 'mgr'), /chưa có số TK/);
  await assert.rejects(() => repo.setAccountBank('abc', 'MB', 'mgr'), /không hợp lệ/);
  await assert.rejects(() => repo.setAccountBank('7', 'x'.repeat(101), 'mgr'), /tối đa 100/);
  await repo.setAccountBank('8', '   ', 'mgr');
  assert.equal((await repo.summary(f({}))).balances.find((r) => r.fund === '7').bank, '');
});
