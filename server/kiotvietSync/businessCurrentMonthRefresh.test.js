'use strict';

// Job tinh san doanh so thang hien tai (migration 0068) chay tren PGlite voi SQL THAT cua cau chot thang.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { seed } = require('../businessReport/testFixtures');
const job = require('./businessCurrentMonthRefresh');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0068_business_current_month.sql'), 'utf8');
const NOW = Date.parse('2026-10-06T03:00:00Z'); // 06/10/2026 10:00 gio VN
const MIN = 60 * 1000;
const quiet = () => {};

// Du lieu thang 10 them vao fixture (fixture chi co 1 hoa don thang 10): HN + SG, khach le, tra hang.
const OCTOBER_EXTRA = `
  INSERT INTO invoices VALUES ('hanoi', 105, 'HD5', '2026-10-05 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1","customerName":"Chị A"}');
  INSERT INTO invoice_details VALUES ('hanoi', 105, 1, 11, 1, 50, 0, '{"productCode":"SP2","subTotal":50}');
  INSERT INTO invoices VALUES ('saigon', 301, 'HD6', '2026-10-04 10:00:00+00', 300, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1","customerName":"Anh B"}');
  INSERT INTO invoice_details VALUES ('saigon', 301, 1, 10, 3, 100, 0, '{"productCode":"SP1","subTotal":300}');
  INSERT INTO invoices VALUES ('hanoi', 106, 'HD7', '2026-10-03 10:00:00+00', 60, 1, '{"statusValue":"Hoàn thành"}');
  INSERT INTO invoice_details VALUES ('hanoi', 106, 1, 11, 1, 60, 0, '{"productCode":"SP2","subTotal":60}');
  INSERT INTO returns VALUES ('hanoi', 202, 'TH2', '2026-10-05 09:00:00+00', 20, 1, '{"statusValue":"Đã trả","customerCode":"KH1"}');
  INSERT INTO return_details VALUES ('hanoi', 202, 1, 10, 1, 20, '{"productCode":"SP1","subTotal":20}');`;

function poolFrom(db, calls) {
  const run = (text, params) => { if (calls) calls.push({ text: String(text), params }); return db.query(text, params); };
  return { query: run, connect: async () => ({ query: run, release() {} }) };
}

async function setup({ migrate = true } = {}) {
  job.__test__.resetState();
  const db = new PGlite();
  await seed(db);
  if (migrate) await db.exec(MIGRATION);
  await db.exec(OCTOBER_EXTRA);
  return { db, pool: poolFrom(db) };
}

const options = (at = NOW, extra = {}) => ({ now: () => at, log: quiet, minIntervalMs: 0, ...extra });
const counts = async db => (await db.query(`SELECT
  (SELECT count(*)::int FROM business_current_month_customer_sales) AS customers,
  (SELECT count(*)::int FROM business_current_month_customer_product_sales) AS products`)).rows[0];

test('lan dau: day du, ghi bang khach + khach x ma + state; so == cau chot thang cho thang 10', async () => {
  const { db, pool } = await setup();
  try {
    const result = await job.refreshBusinessCurrentMonth(pool, options());
    assert.equal(result.mode, 'full');
    assert.equal(result.month, '2026-10-01');
    assert.equal(result.changed, true);
    assert.equal(result.version, 1);
    const { rows } = await db.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, branch, customer_code, customer_id::int AS customer_id,
      customer_name, net_revenue::float AS net, invoice_count, return_count FROM business_current_month_customer_sales ORDER BY branch, customer_code`);
    assert.deepEqual(rows, [
      { month: '2026-10-01', branch: 'hanoi', customer_code: '', customer_id: null, customer_name: 'Khách lẻ', net: 60, invoice_count: 1, return_count: 0 },
      { month: '2026-10-01', branch: 'hanoi', customer_code: 'KH1', customer_id: 1, customer_name: 'Chị A', net: 530, invoice_count: 2, return_count: 1 },
      { month: '2026-10-01', branch: 'saigon', customer_code: 'KH1', customer_id: 2, customer_name: 'Anh B', net: 300, invoice_count: 1, return_count: 0 }
    ]);
    const state = (await db.query(`SELECT to_char(month, 'YYYY-MM-DD') AS month, computed_at, cutoff, last_full_at, version::int AS version
      FROM business_current_month_state WHERE id = 1`)).rows[0];
    assert.equal(state.month, '2026-10-01');
    assert.equal(state.version, 1);
    assert.equal(new Date(state.computed_at).getTime(), NOW);
    assert.equal(new Date(state.last_full_at).getTime(), NOW);
    // Bang freeze (cung SELECT) cho cung so => bang tinh san khong the lech cong thuc.
    const sql = require('../businessReport/businessMonthlySql');
    const live = (await db.query(`SELECT q.branch, q.customer_code, q.net_revenue::float AS net FROM (${sql.CUSTOMER_MONTH_SELECT_SQL}) q ORDER BY 1, 2`,
      [sql.BRANCH_CODES, '2026-10-01', '2026-10-06T10:00:00.000'])).rows;
    assert.deepEqual(live, rows.map(r => ({ branch: r.branch, customer_code: r.customer_code, net: r.net })));
    // Khong ghi vao bang chot.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM business_monthly_customer_sales')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM business_monthly_state')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('luot thu hai khong doi gi: 0 dong ghi, 0 dong xoa, version giu nguyen, khong goi listener', async () => {
  const { db, pool } = await setup();
  try {
    const notified = [];
    const off = job.onBusinessCurrentMonthChanged(info => notified.push(info));
    const first = await job.refreshBusinessCurrentMonth(pool, options());
    assert.equal(notified.length, 1);
    const second = await job.refreshBusinessCurrentMonth(pool, options(NOW + 15 * MIN, { force: true }));
    assert.deepEqual([second.written, second.deleted, second.changed, second.guarded], [0, 0, false, false]);
    assert.equal(second.version, first.version);
    assert.equal(notified.length, 1, 'khong doi => khong bao repository xoa cache');
    // computed_at van duoc cham de repository biet bang con tuoi.
    const state = (await db.query('SELECT computed_at, version::int AS version FROM business_current_month_state')).rows[0];
    assert.equal(new Date(state.computed_at).getTime(), NOW + 15 * MIN);
    assert.equal(state.version, first.version);
    off();
  } finally { await db.close(); }
});

test('doi du lieu: chi ghi dong doi, xoa dong khong con, tang version, bao listener', async () => {
  const { db, pool } = await setup();
  try {
    const notified = [];
    const off = job.onBusinessCurrentMonthChanged(info => notified.push(info));
    const first = await job.refreshBusinessCurrentMonth(pool, options());
    // HD5 them 100 cho KH1 HN (SP2) + 1 hoa don moi ma hang moi cho khach le; HD7 (khach le cu) bi huy.
    await db.exec(`
      UPDATE invoices SET total = 150 WHERE code = 'HD5';
      UPDATE invoice_details SET raw = '{"productCode":"SP2","subTotal":150}' WHERE invoice_id = 105;
      UPDATE invoices SET raw = '{"statusValue":"Đã hủy"}' WHERE code = 'HD7'`);
    const next = await job.refreshBusinessCurrentMonth(pool, options(NOW + 15 * MIN, { force: true }));
    // KH1 HN (khach) + KH1 HN SP2 (ma hang) doi; khach le va dong khach le x SP2 bi xoa.
    assert.deepEqual([next.written, next.deleted, next.changed], [2, 2, true]);
    assert.equal(next.version, first.version + 1);
    assert.equal(notified.length, 2);
    assert.deepEqual(await counts(db), { customers: 2, products: 3 });
    const kh1 = (await db.query(`SELECT net_revenue::float AS net FROM business_current_month_customer_sales WHERE branch = 'hanoi' AND customer_code = 'KH1'`)).rows[0];
    assert.equal(kh1.net, 630);
    off();
  } finally { await db.close(); }
});

test('chot an toan: nguon doc ra 0 dong thi KHONG xoa bang dang co', async () => {
  const { db, pool } = await setup();
  try {
    await job.refreshBusinessCurrentMonth(pool, options());
    const before = await counts(db);
    assert.ok(before.customers > 0 && before.products > 0);
    await db.exec(`DELETE FROM invoices WHERE purchase_date >= '2026-10-01'; DELETE FROM returns WHERE return_date >= '2026-10-01'`);
    const result = await job.refreshBusinessCurrentMonth(pool, options(NOW + 15 * MIN, { force: true }));
    assert.equal(result.guarded, true);
    assert.equal(result.deleted, 0);
    assert.deepEqual(await counts(db), before);
  } finally { await db.close(); }
});

test('sang thang moi: chay day du ngay; dong thang cu chi bi xoa SAU KHI freezeMonth ghi business_monthly_state', async () => {
  const { db, pool } = await setup();
  try {
    await job.refreshBusinessCurrentMonth(pool, options());
    const october = await counts(db);
    const nov = NOW + 27 * 24 * 60 * MIN; // 02/11/2026
    // Khong force: sang thang => van phai chay day du, bo qua san thoi gian.
    const rolled = await job.refreshBusinessCurrentMonth(pool, options(nov, { minIntervalMs: 24 * 60 * MIN }));
    assert.equal(rolled.mode, 'full');
    assert.equal(rolled.month, '2026-11-01');
    assert.equal(rolled.changed, true);
    assert.deepEqual(await counts(db), october, 'thang 10 chua chot => giu nguyen cho live()/chot dung duoc');
    assert.equal((await db.query(`SELECT to_char(month, 'YYYY-MM-DD') AS m FROM business_current_month_state`)).rows[0].m, '2026-11-01');
    await db.exec(`INSERT INTO business_monthly_state (month) VALUES ('2026-10-01')`);
    const cleaned = await job.refreshBusinessCurrentMonth(pool, options(nov + 15 * MIN, { force: true }));
    assert.equal(cleaned.changed, false);
    assert.deepEqual(await counts(db), { customers: 0, products: 0 }, 'thang 10 da chot => xoa khoi bang tinh san');
  } finally { await db.close(); }
});

test('san thoi gian: luot nhanh trong minIntervalMs bi bo, luot day du (moi dem sau 00:10 VN) thi khong', async () => {
  const { db, pool } = await setup();
  try {
    const first = await job.refreshBusinessCurrentMonth(pool, options(NOW, { minIntervalMs: 10 * MIN }));
    assert.equal(first.mode, 'full');
    const tooSoon = await job.refreshBusinessCurrentMonth(pool, options(NOW + 5 * MIN, { minIntervalMs: 10 * MIN }));
    assert.equal(tooSoon.skipped, 'min-interval');
    // 07/10 00:05 VN: chua den 00:10 => chua day du, nhung da qua san 10 phut nen la luot nhanh.
    const early = await job.refreshBusinessCurrentMonth(pool, options(Date.parse('2026-10-06T17:05:00Z'), { minIntervalMs: 10 * MIN }));
    assert.equal(early.mode, 'fast');
    // 07/10 00:15 VN: qua ngay moi + 10 phut => day du, bat chap san 10 phut.
    const nightly = await job.refreshBusinessCurrentMonth(pool, options(Date.parse('2026-10-06T17:15:00Z'), { minIntervalMs: 24 * 60 * MIN }));
    assert.equal(nightly.mode, 'full');
    assert.equal(new Date((await db.query('SELECT last_full_at FROM business_current_month_state')).rows[0].last_full_at).getTime(), Date.parse('2026-10-06T17:15:00Z'));
  } finally { await db.close(); }
});

test('isFullDue: chua tung day du, hoac khac ngay VN va da qua 00:10', () => {
  assert.equal(job.isFullDue(null, new Date(NOW)), true);
  assert.equal(job.isFullDue(new Date(NOW), new Date(NOW + 60 * MIN)), false);
  assert.equal(job.isFullDue(new Date(NOW), new Date('2026-10-06T17:05:00Z')), false);
  assert.equal(job.isFullDue(new Date(NOW), new Date('2026-10-06T17:10:00Z')), true);
});

test('luot nhanh do synced_at: khong co chung tu/khach moi chi cham computed_at; co moi thi tinh lai', async () => {
  const { db, pool } = await setup();
  try {
    await db.exec(`
      ALTER TABLE invoices ADD COLUMN synced_at timestamptz;
      ALTER TABLE returns ADD COLUMN synced_at timestamptz;
      ALTER TABLE customers ADD COLUMN synced_at timestamptz;
      UPDATE invoices SET synced_at = '2026-10-05T00:00:00Z';
      UPDATE returns SET synced_at = '2026-10-05T00:00:00Z';
      UPDATE customers SET synced_at = '2026-10-05T00:00:00Z'`);
    const first = await job.refreshBusinessCurrentMonth(pool, options(NOW, { minIntervalMs: 10 * MIN }));
    assert.equal(first.mode, 'full');
    const state1 = (await db.query('SELECT customers_synced_at FROM business_current_month_state')).rows[0];
    assert.equal(new Date(state1.customers_synced_at).toISOString(), '2026-10-05T00:00:00.000Z');

    const idle = await job.refreshBusinessCurrentMonth(pool, options(NOW + 20 * MIN, { minIntervalMs: 10 * MIN }));
    assert.equal(idle.skipped, 'unchanged');
    assert.equal(idle.version, first.version);
    const state2 = (await db.query('SELECT computed_at, version::int AS version FROM business_current_month_state')).rows[0];
    assert.equal(new Date(state2.computed_at).getTime(), NOW + 20 * MIN);
    assert.equal(state2.version, first.version);

    // Hoa don duoc sync lai (synced_at moi) va THAT SU doi => tinh lai, ghi dung phan doi.
    await db.exec(`UPDATE invoices SET total = 70, synced_at = '2026-10-06T03:30:00Z' WHERE code = 'HD7'`);
    const next = await job.refreshBusinessCurrentMonth(pool, options(NOW + 40 * MIN, { minIntervalMs: 10 * MIN }));
    assert.equal(next.mode, 'fast');
    assert.equal(next.changed, true);
    assert.equal(next.written, 2, 'dong khach le + dong khach le x SP2 (tong hoa don doi => phan bo theo ma doi)');
    assert.equal(next.version, first.version + 1);

    // Khach moi duoc sync (synced_at moi hon moc da luu) cung kich hoat tinh lai.
    await db.exec(`UPDATE customers SET synced_at = '2026-10-06T04:00:00Z' WHERE code = 'KH2'`);
    const afterCustomers = await job.refreshBusinessCurrentMonth(pool, options(NOW + 60 * MIN, { minIntervalMs: 10 * MIN }));
    assert.equal(afterCustomers.mode, 'fast');
    assert.equal(afterCustomers.written, 0);
    assert.equal(afterCustomers.version, next.version);
  } finally { await db.close(); }
});

test('thieu migration 0068: job khong nem loi, tra skipped; requestBusinessCurrentMonthRefresh khong nem loi', async () => {
  const { db, pool } = await setup({ migrate: false });
  try {
    const result = await job.refreshBusinessCurrentMonth(pool, options());
    assert.deepEqual(result, { skipped: 'migration-missing', changed: false });
    assert.equal(await job.requestBusinessCurrentMonthRefresh('fake-pool'), null);
    const noTable = { query: async () => { throw Object.assign(new Error('relation does not exist'), { code: '42P01' }); }, connect: async () => { throw new Error('khong duoc mo ket noi'); } };
    const config = require('../config');
    const saved = config.SUPABASE_DB_URL;
    config.SUPABASE_DB_URL = 'postgres://test';
    try {
      assert.deepEqual(await job.requestBusinessCurrentMonthRefresh(noTable, { log: quiet }), { skipped: 'migration-missing', changed: false });
    } finally { config.SUPABASE_DB_URL = saved; }
  } finally { await db.close(); }
});

test('luot chay chong nhau gop lai: 2 loi goi dong thoi chi tinh them 1 luot, ca hai nhan ket qua', async () => {
  const { db, pool } = await setup();
  try {
    const [a, b] = await Promise.all([
      job.refreshBusinessCurrentMonth(pool, options()),
      job.refreshBusinessCurrentMonth(pool, options())
    ]);
    assert.equal(a, b);
    assert.equal(a.written, 0, 'luot chay them khong doi gi');
    assert.equal((await db.query('SELECT version::int AS v FROM business_current_month_state')).rows[0].v, 1);
  } finally { await db.close(); }
});

test('loi giua chung: ROLLBACK, bang giu nguyen ban cu', async () => {
  const { db } = await setup();
  try {
    const good = poolFrom(db);
    await job.refreshBusinessCurrentMonth(good, options());
    const before = await counts(db);
    await db.exec(`UPDATE invoices SET total = 999 WHERE code = 'HD5'`);
    const failing = { query: good.query, connect: async () => ({
      query: (text, params) => { if (/DELETE FROM business_current_month_customer_product_sales t/.test(text)) throw new Error('boom'); return good.query(text, params); },
      release() {}
    }) };
    await assert.rejects(() => job.refreshBusinessCurrentMonth(failing, options(NOW + 15 * MIN, { force: true })), /boom/);
    assert.deepEqual(await counts(db), before);
    const kh1 = (await db.query(`SELECT net_revenue::float AS net FROM business_current_month_customer_sales WHERE branch = 'hanoi' AND customer_code = 'KH1'`)).rows[0];
    assert.equal(kh1.net, 530, 'giao dich bi huy: khong ghi nua voi');
  } finally { await db.close(); }
});
