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
