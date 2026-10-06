'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createRepository, groupFunds } = require('./cashbookRepository');
const { parseFilters } = require('./cashbookFilters');
const now = new Date('2026-10-06T12:00:00Z');
const f = (q) =>
  parseFilters({ from: '2026-10-01', to: '2026-10-06', ...q }, now);
let db, repo;
// TK số 123 có ID 7 ở HN và ID 8 ở SG (2 retailer KiotViet); -1 chỉ còn trong phiếu.
test.before(async () => {
  db = new PGlite();
  await db.exec(`CREATE TABLE cash_flows(branch text,id bigint,code text,is_receipt boolean,amount numeric,account_id bigint,status int,trans_date timestamptz,user_id bigint,description text,raw jsonb,synced_at timestamptz default now(),primary key(branch,id));CREATE TABLE staff(branch text,id bigint,name text,primary key(branch,id));CREATE TABLE cash_book_accounts(id bigint primary key,bank_name text,account_no text,description text,raw jsonb);
 CREATE TABLE sync_checkpoints(branch text,entity text,last_synced_at timestamptz);
 INSERT INTO sync_checkpoints VALUES('hanoi','cash_flows','2026-10-06T03:00:00Z'),('saigon','cash_flows','2026-10-06T04:00:00Z');
 INSERT INTO staff VALUES ('hanoi',9,'Lan - 1234567890');
 INSERT INTO cash_book_accounts VALUES (7,'Holder','123','Main','{}'),(8,'Holder','123','','{}');`);
  const rows = [
    ['hanoi', 8, 7, '2026-09-25T00:00:00Z', 50, 0],
    ['saigon', 7, null, '2026-09-20T00:00:00Z', 100, 0],
    ['hanoi', 1, 7, '2026-10-01T00:00:00Z', 10, 0],
    ['hanoi', 2, 7, '2026-10-02T00:00:00Z', 20, 0],
    ['hanoi', 3, 7, '2026-10-03T00:00:00Z', -30, 0],
    ['saigon', 3, 8, '2026-10-03T00:00:00Z', 5, 0],
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
  repo = createRepository({ query: (s, p) => db.query(s, p) });
});
test.after(async () => {
  await db.close();
});
test('tồn quỹ = tổng phiếu chưa hủy, gộp HN+SG theo số TK, tách cột từng cơ sở', async () => {
  const s = await repo.summary(f({}));
  assert.deepEqual(
    s.balances.map((r) => [r.fund, r.balanceHanoi, r.balanceSaigon, r.balance]),
    [
      ['cash', 8, 100, 108],
      ['7,8', 50, 5, 55],
      ['-1', 0, 9, 9],
    ],
  );
  const bank = s.balances[1];
  assert.equal(bank.accountNo, '123');
  assert.equal(bank.name, 'Holder');
  assert.equal(bank.description, 'Main');
  assert.deepEqual(bank.accountIds, ['7', '8']);
  assert.equal(s.totalBalance, 172);
  assert.deepEqual(s.kpis, {
    totalReceipts: 52,
    totalPayments: 30,
    closingBalance: 172,
  });
  assert.equal(new Date(s.syncedAt).toISOString(), '2026-10-06T04:00:00.000Z');
});
test('bảng số dư luôn đủ quỹ; KPI Tồn quỹ theo nhóm ID đang chọn, link cũ 1 ID chỉ cộng ID đó', async () => {
  for (const [fund, closing] of [
    ['7,8', 55],
    ['7', 50],
    ['bank', 64],
    ['cash', 108],
    ['', 0],
  ]) {
    const s = await repo.summary(f({ fund }));
    assert.deepEqual(
      s.balances.map((r) => [r.fund, r.balance]),
      [
        ['cash', 108],
        ['7,8', 55],
        ['-1', 9],
      ],
      fund,
    );
    assert.equal(s.totalBalance, 172, fund);
    assert.equal(s.kpis.closingBalance, closing, fund);
  }
});
test('tồn quỹ cuối kỳ không phụ thuộc bộ lọc hiển thị thu/chi', async () => {
  const s = await repo.summary(f({ fund: '7,8', docTypes: 'receipt' }));
  assert.equal(s.kpis.totalReceipts, 35);
  assert.equal(s.kpis.totalPayments, 0);
  assert.equal(s.kpis.closingBalance, 55);
  const none = await repo.summary(f({ fund: '7,8', partnerQ: 'không khớp' }));
  assert.equal(none.kpis.totalReceipts, 0);
  assert.equal(none.kpis.closingBalance, 55);
  const past = await repo.summary(
    parseFilters({ fund: '7,8', from: '2026-10-01', to: '2026-10-02' }, now),
  );
  assert.equal(past.balances.find((r) => r.fund === '7,8').balance, 80);
  assert.equal(past.kpis.closingBalance, 80);
});
test('số dư lũy kế chạy trên toàn dòng thời gian của nhóm quỹ, kể cả khi lọc', async () => {
  const page = await repo.entries(f({ fund: '7,8', page: '1', pageSize: '2' }));
  assert.equal(page.total, 5);
  assert.deepEqual(
    page.entries.map((e) => [e.code, e.branch, e.runningBalance]),
    [
      ['P4', 'hanoi', 55],
      ['P3', 'saigon', 55],
    ],
  );
  const next = await repo.entries(f({ fund: '7,8', page: '2', pageSize: '2' }));
  assert.deepEqual(
    next.entries.map((e) => e.runningBalance),
    [50, 80],
  );
  const payments = await repo.entries(f({ fund: '7,8', docTypes: 'payment' }));
  assert.deepEqual(
    payments.entries.map((e) => [e.code, e.runningBalance]),
    [['P3', 50]],
  );
  const byCode = await repo.entries(f({ fund: '7,8', code: 'p2' }));
  assert.deepEqual(
    byCode.entries.map((e) => [e.code, e.runningBalance]),
    [['P2', 80]],
  );
  const all = await repo.entries(f({ pageSize: '1' }));
  assert.equal(all.entries[0].runningBalance, 172);
  assert.equal(page.entries[0].fundName, '123 · Holder');
});
test('tìm mã phiếu/ghi chú và các bộ lọc tham số hóa khớp SQL thật', async () => {
  assert.equal((await repo.entries(f({ note: 'NOT' }))).total > 0, true);
  assert.equal((await repo.entries(f({ note: 'khong-co' }))).total, 0);
  const opts = await repo.filterOptions();
  assert.equal(opts.groups[0].label, "Tên ' nhóm");
  assert.equal(opts.staff[0].label, 'Lan');
  assert.equal(opts.creators[0].label, 'Lan');
  assert.deepEqual(
    opts.funds.map((x) => x.fund),
    ['cash', '7,8', '-1'],
  );
  assert.equal(
    opts.funds.find((e) => e.fund === '-1').name,
    'Tài khoản #-1 (không có trong danh sách KiotViet)',
  );
  assert.equal(
    (await repo.entries(f({ groups: opts.groups[0].key, partnerPhone: '123%' })))
      .total,
    7,
  );
  for (const q of [
    { groups: '' },
    { creators: '' },
    { staff: '' },
    { docTypes: '' },
    { statuses: '' },
    { fund: '' },
  ])
    assert.equal((await repo.entries(f(q))).total, 0, JSON.stringify(q));
  assert.equal((await repo.entries(f({ partnerQ: '99' }))).total, 7);
  assert.equal((await repo.entries(f({ fund: 'bank' }))).total, 6);
  assert.equal((await repo.entries(f({ fund: 'cash' }))).total, 1);
  assert.equal((await repo.entries(f({ accounting: 'yes' }))).total, 0);
  assert.equal((await repo.entries(f({ creators: '999' }))).total, 0);
});
test('ngày VN bao gồm cả ngày cuối; lũy kế giữ phiếu trước kỳ', async () => {
  await db.query(
    `INSERT INTO cash_flows(branch,id,code,is_receipt,amount,account_id,status,trans_date,user_id,description,raw) VALUES('hanoi',100,'Boundary',TRUE,2,7,0,'2026-10-04T17:00:00Z',9,'','{}'),('hanoi',101,'Outside',TRUE,3,7,0,'2026-10-05T17:00:00Z',9,'','{}')`,
  );
  try {
    const q = { fund: '7,8', from: '2026-10-05', to: '2026-10-05' };
    const r = await repo.entries(parseFilters(q, now));
    assert.deepEqual(
      r.entries.map((row) => [row.code, row.runningBalance]),
      [['Boundary', 57]],
    );
    const s = await repo.summary(parseFilters(q, now));
    assert.equal(s.kpis.totalReceipts, 2);
    assert.equal(s.kpis.closingBalance, 57);
  } finally {
    await db.query("DELETE FROM cash_flows WHERE id IN (100,101)");
  }
});
test('groupFunds bỏ tên trùng số TK, gộp tên/mô tả khác nhau và giữ quỹ không có số TK riêng', () => {
  const funds = groupFunds([
    { account_id: null },
    { account_id: '20', bank_name: '2222', account_no: '2222' },
    { account_id: '10', bank_name: 'NH CŨ', account_no: ' 2222 ', description: 'a' },
    { account_id: '30', bank_name: 'Khác', account_no: '', description: 'b' },
    { account_id: '31', bank_name: 'Khác', account_no: null },
  ]);
  assert.deepEqual(
    funds.map((x) => [x.fund, x.accountNo, x.name, x.description]),
    [
      ['cash', '', 'Tiền mặt', ''],
      ['30', '', 'Khác', 'b'],
      ['31', '', 'Khác', ''],
      ['10,20', '2222', 'NH CŨ', 'a'],
    ],
  );
});
