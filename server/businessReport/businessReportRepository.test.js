'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seed } = require('./testFixtures');
const { createRepository } = require('./businessReportRepository');

function poolFrom(db) {
  return { query: (text, params) => db.query(text, params), connect: async () => ({ query: (t, p) => db.query(t, p), release() {} }) };
}

test('snapshot: thang da chot doc bang, thang chua chot tinh truc tiep; danh ba co sale/level gia; cache 60s', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    let now = new Date('2026-10-06T03:00:00Z');
    const repo = createRepository({ pool: poolFrom(db), now: () => now });
    // Chua chot thang nao => thang 9 tinh live
    let snap = await repo.snapshot();
    assert.equal(snap.currentMonth, '2026-10-01');
    assert.equal(snap.day, 6);
    assert.equal(snap.months[0], '2026-03-01');
    assert.deepEqual(snap.frozenMonths, []);
    assert.equal(snap.customers.find(r => r.month === '2026-09-01' && r.customerCode === 'KH1').netRevenue, 810);
    assert.equal(snap.customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 500);
    assert.deepEqual(snap.directory.find(d => d.branch === 'hanoi' && d.code === 'KH1'),
      { branch: 'hanoi', code: 'KH1', name: 'Chị A', saleName: 'Khang', priceLevel: 'Level 2' });
    // Chot thang 9 bang repo.refreeze => doc tu bang
    await repo.refreeze('2026-09');
    snap = await repo.snapshot();
    assert.ok(snap.frozenMonths.includes('2026-09-01'));
    assert.equal(snap.sales.find(s => s.month === '2026-09-01' && s.saleName === 'Khang').netRevenue, 810);
    // Cache: them hoa don moi, trong 60s van so cu; qua 60s thi so moi
    await db.exec(`INSERT INTO invoices VALUES ('hanoi', 105, 'HD5', '2026-10-05 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}')`);
    assert.equal((await repo.snapshot()).customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 500);
    now = new Date(now.getTime() + 61000);
    // Het 60s: stale-while-revalidate => tra NGAY so cu, lam moi o nen; lan doc sau thay so moi.
    assert.equal((await repo.snapshot()).customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 500);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal((await repo.snapshot()).customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue, 550);
  } finally { await db.close(); }
});

test('top ma hang cua khach va top khach cua ma hang trong cac thang chi dinh (gop thang chot + live)', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const repo = createRepository({ pool: poolFrom(db), now: () => new Date('2026-10-06T03:00:00Z') });
    await repo.refreeze('2026-09');
    const months = ['2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01'];
    const top = await repo.customerProducts({ branch: 'hanoi', customerCode: 'KH1', months });
    assert.deepEqual(top.map(r => [r.productCode, r.revenue]), [['SP1', 950], ['SP2', 360]]); // 450 + 500 (T10)
    const buyers = await repo.productCustomers({ productCode: 'SP2', months });
    assert.deepEqual(buyers.map(r => [r.branch, r.customerCode, r.revenue]), [['hanoi', 'KH1', 360], ['hanoi', 'KH2', 200]]);
  } finally { await db.close(); }
});

// Pool bao PGlite co the: dem so lan doc bang state (= 1 lan tai snapshot), giu ket qua lai
// (gate) SAU khi truy van da chay de mo phong tai nen dang do dang, va gay loi theo y.
const STATE_SELECT = `SELECT to_char(month, 'YYYY-MM-DD') AS month FROM business_monthly_state`;
function controllablePool(db) {
  const ctl = { loads: 0, gate: null, fail: false };
  return {
    ctl,
    query: async (text, params) => {
      if (String(text).includes(STATE_SELECT)) {
        ctl.loads += 1;
        if (ctl.fail) throw new Error('db down');
        const result = await db.query(text, params);
        if (ctl.gate) await ctl.gate.promise;
        return result;
      }
      return db.query(text, params);
    },
    connect: async () => ({ query: (t, p) => db.query(t, p), release() {} })
  };
}
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const tick = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, tries = 100) {
  for (let i = 0; i < tries; i++) { if (check()) return; await tick(10); }
  throw new Error('qua han cho dieu kien');
}
const kh1Oct = snap => snap.customers.find(r => r.month === '2026-10-01' && r.customerCode === 'KH1').netRevenue;

test('SWR: het ttl tra ngay ban cu, lam moi nen (1 lan du nhieu nguoi goi), lan doc sau thay so moi', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    let now = new Date('2026-10-06T03:00:00Z');
    const pool = controllablePool(db);
    const repo = createRepository({ pool, now: () => now });
    assert.equal(kh1Oct(await repo.snapshot()), 500);
    assert.equal(pool.ctl.loads, 1);
    await db.exec(`INSERT INTO invoices VALUES ('hanoi', 105, 'HD5', '2026-10-05 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}')`);
    now = new Date(now.getTime() + 61000);
    pool.ctl.gate = gate(); // giu tai nen lai de kiem tra tra-ngay-ban-cu
    const stale = await repo.snapshot();
    assert.equal(kh1Oct(stale), 500, 'tra ngay ban cu, khong cho tai nen');
    await repo.snapshot(); await repo.snapshot();
    await until(() => pool.ctl.loads === 2);
    assert.equal(pool.ctl.loads, 2, 'chi 1 lan tai nen du 3 nguoi goi (khong dam dong)');
    assert.equal(kh1Oct(await repo.snapshot()), 500, 'tai nen chua xong van ban cu');
    pool.ctl.gate.release(); pool.ctl.gate = null;
    await until(() => pool.ctl.loads === 2);
    await tick(100);
    assert.equal(kh1Oct(await repo.snapshot()), 550, 'sau khi nen xong thi doc ra so moi');
    assert.equal(pool.ctl.loads, 2);
  } finally { await db.close(); }
});

test('SWR: lam moi nen that bai thi giu ban cu va ghi log; lan lam moi sau thanh cong van cap nhat', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const origError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    await seed(db);
    let now = new Date('2026-10-06T03:00:00Z');
    const pool = controllablePool(db);
    const repo = createRepository({ pool, now: () => now });
    assert.equal(kh1Oct(await repo.snapshot()), 500);
    await db.exec(`INSERT INTO invoices VALUES ('hanoi', 105, 'HD5', '2026-10-05 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}')`);
    now = new Date(now.getTime() + 61000);
    pool.ctl.fail = true;
    assert.equal(kh1Oct(await repo.snapshot()), 500);
    await until(() => logs.length >= 1);
    assert.match(logs[0], /business-report/);
    assert.equal(kh1Oct(await repo.snapshot()), 500, 'loi nen khong lam mat ban cu, khong nem loi cho nguoi dung');
    pool.ctl.fail = false;
    // Lan doc tiep theo khoi dong lam moi nen thanh cong (moi lan doc chi tra ban cu cho den khi xong).
    let value = 0;
    for (let i = 0; i < 100 && value !== 550; i++) { value = kh1Oct(await repo.snapshot()); if (value !== 550) await tick(20); }
    assert.equal(value, 550);
  } finally { console.error = origError; await tick(100); await db.close(); }
});

test('SWR: lan tai dau tien phai cho; loi o lan dau nem loi va khong cache loi', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const pool = controllablePool(db);
    const repo = createRepository({ pool, now: () => new Date('2026-10-06T03:00:00Z') });
    pool.ctl.fail = true;
    await assert.rejects(() => repo.snapshot(), /db down/);
    pool.ctl.fail = false;
    assert.equal(kh1Oct(await repo.snapshot()), 500);
  } finally { await db.close(); }
});

test('refreeze xoa cache; tai nen dang do (bat dau truoc refreeze) khong duoc ghi de bang so cu', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    let now = new Date('2026-10-06T03:00:00Z');
    const pool = controllablePool(db);
    const repo = createRepository({ pool, now: () => now });
    assert.deepEqual((await repo.snapshot()).frozenMonths, []);
    now = new Date(now.getTime() + 61000);
    pool.ctl.gate = gate(); // tai nen doc state TRUOC refreeze roi bi giu lai
    await repo.snapshot();
    await until(() => pool.ctl.loads === 2);
    await repo.refreeze('2026-09');
    pool.ctl.gate.release(); pool.ctl.gate = null;
    await tick(200); // cho tai nen cu xong (ket qua cu: chua co thang chot)
    const snap = await repo.snapshot();
    assert.ok(snap.frozenMonths.includes('2026-09-01'), 'khong bi ban cu ghi de len cache da xoa');
    assert.equal(snap.sales.find(s => s.month === '2026-09-01' && s.saleName === 'Khang').netRevenue, 810);
  } finally { await db.close(); }
});
