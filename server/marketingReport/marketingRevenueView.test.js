'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDb, createPool } = require('./precomputeFixture');
const { createRevenueProvider, CURRENT_MONTH_MAX_AGE_MS } = require('./marketingRevenue');
const { nameKey, FIRST_MONTH } = require('../businessReport/businessMonths');
const { normalizedNameSql } = require('../kiotvietSync/salesSqlFragments');

const NOW = Date.parse('2026-10-12T05:00:00Z');
const ZW = '​';

// Danh ba KiotViet (bang customers).
const CUSTOMERS = [
  { branch: 'hanoi', id: 1, code: 'KH1', name: 'Nguyễn Văn A' },
  { branch: 'saigon', id: 1, code: 'KH1', name: 'NGUYỄN  VĂN A' },
  { branch: 'hanoi', id: 2, code: 'KH2', name: 'Known Zero' },
  { branch: 'hanoi', id: 3, code: 'KH3', name: 'Inactive Cust', raw: { isActive: false } },
  { branch: 'hanoi', id: 4, code: 'KH4', name: `Zero${ZW}Width` },
  { branch: 'hanoi', id: 5, code: 'KH5', name: 'Old Name', raw: { isActive: false } }, // ban cu cua KH5
  { branch: 'hanoi', id: 6, code: 'KH5', name: 'Latest Name' },                       // ban moi nhat: dang hoat dong
  { branch: 'hanoi', id: 7, code: 'KH7', name: '   ' },                                // ten rong: khong vao danh ba
  { branch: 'saigon', id: 8, code: 'KH8', name: 'Đặng Thị B' }
];
// Doanh so da chot (business_monthly_customer_sales) + thang hien tai (business_current_month_customer_sales).
const SALES = {
  '2026-09-01': [
    ['hanoi', 'KH1', 'Nguyễn Văn A', 100], ['saigon', 'KH1', 'nguyễn văn a ', 50], ['hanoi', 'KH3', 'Inactive Cust', 77],
    ['hanoi', '', 'Khách lẻ', 9], ['hanoi', 'KH9', 'Not In Dir', 12], ['hanoi', 'KH4', 'ZeroWidth', 5],
    ['hanoi', 'KH5', 'Latest Name', -3], ['saigon', 'KH8', 'ĐẶNG THỊ B', 40], ['saigon', 'KH10', '', 8]
  ],
  '2026-08-01': [['hanoi', 'KH2', 'Known Zero', 0], ['hanoi', 'KH1', 'Nguyễn Văn A', 1]],
  '2026-10-01': [['hanoi', 'KH1', 'Nguyễn Văn A', 300], ['saigon', 'KH1', 'Nguyễn Văn A', 20], ['hanoi', 'KH3', 'Inactive Cust', 5], ['hanoi', 'KH9', 'Not In Dir', -2]]
};
const FROZEN = ['2026-08-01', '2026-09-01'];
const NAMES = ['Nguyễn Văn A', 'nguyễn  văn a', 'NGUYỄN VĂN A', 'Known Zero', 'Inactive Cust', 'ZeroWidth', `Zero${ZW}Width`, 'Khách lẻ', 'Not In Dir',
  'Latest Name', 'Old Name', 'Đặng Thị B', 'đặng thị b', 'Unknown', '', '   ', null, 'Nguyễn Văn A'.normalize('NFD')];

async function setup(t, { precompute = true, currentComputedAt = new Date(NOW - 60000) } = {}) {
  const db = await createDb({ precompute });
  t.after(() => db.close());
  for (const c of CUSTOMERS) {
    await db.query('INSERT INTO customers (branch, id, code, name, raw) VALUES ($1, $2, $3, $4, $5::jsonb)', [c.branch, c.id, c.code, c.name, JSON.stringify(c.raw || {})]);
  }
  for (const [month, rows] of Object.entries(SALES)) {
    const frozen = FROZEN.includes(month);
    if (frozen) await db.query('INSERT INTO business_monthly_state (month) VALUES ($1)', [month]);
    for (const [branch, code, name, net] of rows) {
      await db.query(`INSERT INTO ${frozen ? 'business_monthly_customer_sales' : 'business_current_month_customer_sales'}
        (month, branch, customer_code, customer_name, net_revenue) VALUES ($1, $2, $3, $4, $5)`, [month, branch, code, name, net]);
    }
  }
  await db.query('INSERT INTO business_current_month_state (id, month, computed_at) VALUES (1, $1, $2)', ['2026-10-01', currentComputedAt]);
  return { db, pool: createPool(db) };
}

// Mo phong businessReportRepository.snapshot(): thang chot + thang hien tai, bo khach khong hoat dong, danh ba chi gom khach dang hoat dong.
function ramRepository(extraMonthRows = {}) {
  const calls = { snapshot: 0 };
  const latest = new Map();
  for (const c of CUSTOMERS) {
    const key = `${c.branch}:${c.code}`;
    if (!latest.has(key) || latest.get(key).id < c.id) latest.set(key, c);
  }
  const inactive = new Set([...latest.values()].filter(c => c.raw?.isActive === false).map(c => `${c.branch}:${c.code}`));
  const directory = [...latest.values()].filter(c => c.raw?.isActive !== false).map(c => ({ name: c.name }));
  const customers = [];
  for (const [month, rows] of Object.entries({ ...SALES, ...extraMonthRows })) {
    for (const [branch, code, name, net] of rows) {
      if (!inactive.has(`${branch}:${code.trim()}`)) customers.push({ month, branch, customerCode: code, customerName: name, netRevenue: net });
    }
  }
  const months = [];
  for (let m = 3; m <= 10; m++) months.push(`2026-${String(m).padStart(2, '0')}-01`);
  return { calls, snapshot: async () => { calls.snapshot++; return { months, customers, directory }; } };
}

const sample = lookup => NAMES.map(name => lookup.revenueOf(name));

test('view == duong RAM cho thang da chot va thang hien tai (HN+SG gop, danh ba=0, khong co=null)', async t => {
  const { pool } = await setup(t);
  for (const [month, year] of [[9, 2026], [8, 2026], [10, 2026]]) {
    const ram = ramRepository();
    const viaRam = await createRevenueProvider({ repository: ram, now: () => NOW })(month, year);
    const viaView = await createRevenueProvider({ pool, repository: ramRepository(), now: () => NOW })(month, year, { names: NAMES.filter(n => typeof n === 'string') });
    const repo = ramRepository();
    const spied = await createRevenueProvider({ pool, repository: repo, now: () => NOW })(month, year, { names: NAMES.filter(n => typeof n === 'string') });
    assert.equal(spied.available, true);
    assert.deepEqual(sample(viaView), sample(viaRam), `thang ${month}`);
    assert.equal(repo.calls.snapshot, 0, `thang ${month}: khong duoc keo snapshot RAM khi view dung duoc`);
  }
});

test('gia tri cu the: gop HN+SG theo ten, 0 cho khach co danh ba khong ban, NULL cho ten la, bo khach khong hoat dong', async t => {
  const { pool } = await setup(t);
  const sep = await createRevenueProvider({ pool, repository: ramRepository(), now: () => NOW })(9, 2026, { names: NAMES.filter(Boolean) });
  assert.equal(sep.revenueOf('Nguyễn Văn A'), 150);
  assert.equal(sep.revenueOf('NGUYỄN  VĂN  a'), 150);
  assert.equal(sep.revenueOf('Nguyễn Văn A'.normalize('NFD')), 150);
  assert.equal(sep.revenueOf('Known Zero'), 0);
  assert.equal(sep.revenueOf('Inactive Cust'), null);   // khach khong hoat dong: bo doanh so, khong vao danh ba
  assert.equal(sep.revenueOf('Zero​Width'), 5);
  assert.equal(sep.revenueOf('ZeroWidth'), 5);
  assert.equal(sep.revenueOf('Khách lẻ'), 9);           // co doanh so nhung khong co trong danh ba
  assert.equal(sep.revenueOf('Not In Dir'), 12);
  assert.equal(sep.revenueOf('Latest Name'), -3);       // ban ghi KH5 moi nhat dang hoat dong
  assert.equal(sep.revenueOf('Old Name'), null);
  assert.equal(sep.revenueOf('đặng thị b'), 40);
  assert.equal(sep.revenueOf('Unknown'), null);
  assert.equal(sep.revenueOf(''), null);
  assert.equal(sep.revenueOf(null), null);
  const oct = await createRevenueProvider({ pool, repository: ramRepository(), now: () => NOW })(10, 2026, { names: ['Nguyễn Văn A', 'Inactive Cust', 'Not In Dir', 'Known Zero'] });
  assert.equal(oct.revenueOf('Nguyễn Văn A'), 320);
  assert.equal(oct.revenueOf('Not In Dir'), -2);
  assert.equal(oct.revenueOf('Known Zero'), 0);
  assert.equal(oct.revenueOf('Inactive Cust'), null);
});

test('khong truyen names: doc ca thang tu view va van cung ket qua', async t => {
  const { pool } = await setup(t);
  const repo = ramRepository();
  const all = await createRevenueProvider({ pool, repository: repo, now: () => NOW })(9, 2026);
  const ram = await createRevenueProvider({ repository: ramRepository(), now: () => NOW })(9, 2026);
  assert.deepEqual(sample(all), sample(ram));
  assert.equal(repo.calls.snapshot, 0);
});

test('thang hien tai qua cu / khong phai thang chot => lui ve duong RAM, khong loi', async t => {
  const stale = await setup(t, { currentComputedAt: new Date(NOW - CURRENT_MONTH_MAX_AGE_MS - 1000) });
  let repo = ramRepository();
  const viaStale = await createRevenueProvider({ pool: stale.pool, repository: repo, now: () => NOW })(10, 2026, { names: NAMES.filter(Boolean) });
  assert.equal(repo.calls.snapshot, 1, 'ban tinh san qua han phai di duong RAM');
  assert.equal(viaStale.revenueOf('Nguyễn Văn A'), 320);
  // Thang cu chua chot (07): view khong biet => duong RAM
  const fresh = await setup(t);
  repo = ramRepository();
  const july = await createRevenueProvider({ pool: fresh.pool, repository: repo, now: () => NOW })(7, 2026, { names: ['Known Zero', 'Unknown'] });
  assert.equal(repo.calls.snapshot, 1);
  assert.equal(july.available, true);
  assert.equal(july.revenueOf('Known Zero'), 0);
  assert.equal(july.revenueOf('Unknown'), null);
  // Truoc FIRST_MONTH: khong co du lieu, khong can hoi DB lan RAM.
  repo = ramRepository();
  const early = await createRevenueProvider({ pool: fresh.pool, repository: repo, now: () => NOW })(2, 2026, { names: ['Known Zero'] });
  assert.equal(early.available, false);
  assert.equal(early.revenueOf('Known Zero'), null);
  assert.equal(repo.calls.snapshot, 0);
  assert.ok(FIRST_MONTH > '2026-02-01');
});

test('thieu view / bang (chua migrate 0068-0069) => lui ve duong RAM, ket qua nhu cu', async t => {
  const { pool } = await setup(t, { precompute: false });
  const repo = ramRepository();
  const lookup = await createRevenueProvider({ pool, repository: repo, now: () => NOW })(9, 2026, { names: NAMES.filter(Boolean) });
  assert.equal(repo.calls.snapshot, 1);
  assert.equal(lookup.revenueOf('Nguyễn Văn A'), 150);
  assert.equal(lookup.revenueOf('Known Zero'), 0);
  // Co bang monthly nhung thieu view: van lui ve.
  const partial = await createDb({ precompute: false, migrations: ['0036_business_monthly_sales.sql'] });
  t.after(() => partial.close());
  const repo2 = ramRepository();
  const lookup2 = await createRevenueProvider({ pool: createPool(partial), repository: repo2, now: () => NOW })(9, 2026, { names: ['Known Zero'] });
  assert.equal(repo2.calls.snapshot, 1);
  assert.equal(lookup2.revenueOf('Known Zero'), 0);
});

test('provider cu (chi repository, khong pool) giu nguyen hanh vi RAM', async () => {
  const repo = ramRepository();
  const lookup = await createRevenueProvider({ repository: repo, now: () => NOW })(9, 2026, { names: ['x'] });
  assert.equal(repo.calls.snapshot, 1);
  assert.equal(lookup.revenueOf('Nguyễn Văn A'), 150);
});

// ---- nameKey JS <-> SQL ----------------------------------------------------------------------------------------
const NAME_CASES = [
  'Nguyễn Văn A', '  Nguyễn   Văn  A ', 'NGUYỄN VĂN A', 'Nguyễn Văn A'.normalize('NFD'), `Nguy${ZW}ễn Văn A`, `﻿Nguyễn Văn A`,
  `A‌‍B`, 'Đặng Thị B', 'ĐẶNG THỊ B', 'ＡＢＣ　１２３', 'café', 'café', 'x y', 'tab\tsep\nline', 'ǅ', 'ℌ',
  '', '   ', 'Khách lẻ', 'ÀÁẢÃẠ ÂẤẦẨẪẬ ĂẮẰẲẴẶ', 'O’Brien', '花子', `${ZW}${ZW}`, 'a  ​ b'
];

test('nameKey (JS) == tks_name_key (SQL) == normalizedNameSql, ke ca zero-width, dau, NFD/NFKC', async t => {
  const db = await createDb();
  t.after(() => db.close());
  for (const input of [...NAME_CASES, null]) {
    const js = nameKey(input);
    const sql = (await db.query('SELECT tks_name_key($1) AS k', [input])).rows[0].k;
    const fragment = (await db.query(`SELECT ${normalizedNameSql('$1::text')} AS k`, [input])).rows[0].k;
    assert.equal(sql, js, `tks_name_key khac nameKey voi ${JSON.stringify(input)}`);
    assert.equal(fragment === null ? '' : fragment, sql, `tks_name_key khac normalizedNameSql voi ${JSON.stringify(input)}`);
  }
  assert.equal(nameKey(`Nguy${ZW}ễn Văn A`), nameKey('Nguyễn Văn A'));
  const { rows } = await db.query(`SELECT proname, provolatile FROM pg_proc WHERE proname = 'tks_name_key'`);
  assert.equal(rows[0].provolatile, 'i', 'tks_name_key phai IMMUTABLE');
});

test('BC thang (service Pancake doc lap): cot Doanh so + KPI tu view == tu duong RAM, view chi hoi dung ten khach cua thang', async t => {
  const { createDatabaseMarketingReportService } = require('./marketingDatabaseReportService');
  const { pool } = await setup(t);
  const monthlyRows = ['Nguyễn Văn A', 'Known Zero', 'Inactive Cust', 'Khách lẻ', 'Unknown', 'đặng thị b', ''].map((customer, i) => ({
    id: String(i + 1), origin: 'manual', reportYear: 2026, reportMonth: 9, pageId: '1', page: 'Page', sale: 'Sale', customer, phone: '0900', status: 'Chốt', version: '1'
  }));
  const snapshot = () => ({ pages: [{ pageId: '1', name: 'Page', status: 'success', lastSuccessAt: '2026-10-11T00:00:00Z', coverage: { complete: true, since: 0 } }],
    aliases: [], monthlyRows: structuredClone(monthlyRows), rawRows: [] });
  const build = revenue => createDatabaseMarketingReportService({ independent: true, repository: { readIndependentSnapshot: async () => snapshot() }, legacy: {}, revenue, now: () => NOW });
  const viaView = await build(createRevenueProvider({ pool, repository: ramRepository(), now: () => NOW })).report('monthly', { year: 2026, month: 9 });
  const viaRam = await build(createRevenueProvider({ repository: ramRepository(), now: () => NOW })).report('monthly', { year: 2026, month: 9 });
  const strip = ({ snapshotId, ...rest }) => rest;
  assert.deepEqual(strip(viaView), strip(viaRam));
  assert.deepEqual(viaView.rows.map(r => r.revenue), [150, 0, null, 9, null, 40, null]);
  assert.equal(viaView.kpis[0].value, 199);
});
