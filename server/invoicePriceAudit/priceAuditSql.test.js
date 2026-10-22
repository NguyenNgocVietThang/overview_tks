'use strict';

// Bieu thuc NUMERIC dung chung (priceAuditSql.js) chay that tren PGlite.

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { parsePriceNote } = require('./priceNoteParser');
const sql = require('./priceAuditSql');

let db;
test.before(async () => { db = new PGlite(); });
test.after(async () => { await db.close(); });

const T100 = parsePriceNote('T100 # 16/10 # 1T -24000 | 3T- 23800 | 5T- 23600 | 10T-23000 | VAT+2000đ');

async function quantityPrice(note, total) {
  const { rows } = await db.query(
    `SELECT ${sql.quantityPriceSql('$1::jsonb', '$2::numeric', '$3::numeric')}::text AS p`,
    [JSON.stringify(note.tiers), note.cartonSize, String(total)]);
  return rows[0].p;
}
async function levelPrice(note, position) {
  const { rows } = await db.query(`SELECT ${sql.levelPriceSql('$1::jsonb', '$2::int')}::text AS p`,
    [JSON.stringify(note.tiers), position]);
  return rows[0].p;
}

test('Nguong T100: 1/99/100/299 -> 24000; 300/499 -> 23800; 500/999 -> 23600; 1000/1001 -> 23000', async () => {
  const expected = { 1: '24000', 99: '24000', 100: '24000', 299: '24000', 300: '23800', 499: '23800',
    500: '23600', 999: '23600', 1000: '23000', 1001: '23000' };
  for (const [qty, price] of Object.entries(expected)) {
    assert.equal(await quantityPrice(T100, qty), price, `SL ${qty}`);
  }
});

test('nguong so sanh NUMERIC voi SL thap phan: 299.5 chua du 300, 300.0 du', async () => {
  assert.equal(await quantityPrice(T100, '299.5'), '24000');
  assert.equal(await quantityPrice(T100, '300.0'), '23800');
});

test('thieu chiec/thung (hoac T0) -> khong co gia theo so luong, khong doan nguong', async () => {
  const note = parsePriceNote('1T -24000 | 3T- 23800');
  assert.equal(note.cartonSize, null);
  assert.equal(await quantityPrice(note, 1000), null);
  assert.equal(await quantityPrice(parsePriceNote('T0 # 1T-24000'), 5), null);
});

test('gia theo cap: vi tri 1/2/3, o trong -T -- giu vi tri va tra NULL (khong phai 0)', async () => {
  const note = parsePriceNote('T30 # 1T -24000 | -T -- | 5T- 23000');
  assert.equal(await levelPrice(note, 1), '24000');
  assert.equal(await levelPrice(note, 2), null);
  assert.equal(await levelPrice(note, 3), '23000');
  // Bac trong khong tao gia 0 cho nguong so luong
  assert.equal(await quantityPrice(note, 60), '24000');
  assert.equal(await quantityPrice(note, 150), '23000');
});

test('basePrice = MIN cac ung vien hop le; ca hai NULL -> NULL', async () => {
  const { rows } = await db.query(`SELECT ${sql.basePriceSql('NULL::numeric', '24000::numeric')}::text AS a,
    ${sql.basePriceSql('23800::numeric', '24000::numeric')}::text AS b,
    ${sql.basePriceSql('NULL::numeric', 'NULL::numeric')}::text AS c`);
  assert.deepEqual(rows[0], { a: '24000', b: '23800', c: null });
});

test('trang thai/tien hien tai tu ban goc + Chot', async () => {
  const { rows } = await db.query(`
    SELECT d.decision, ${sql.effectiveStatusSql('l')} AS st, ${sql.effectiveAmountSql('l')}::text AS amt,
           ${sql.penaltyAmountSql('l')}::text AS pen, ${sql.pendingAmountSql('l')}::text AS pend,
           ${sql.effectiveReasonSql('l')} AS reason
    FROM (VALUES (NULL::text), ('ok'), ('penalty')) d(decision),
         LATERAL (SELECT d.decision, 'wrong'::text AS original_status, 100000::numeric AS original_amount,
                         'Theo giá quy định'::text AS reason) l
    ORDER BY d.decision NULLS FIRST`);
  assert.deepEqual(rows, [
    { decision: null, st: 'wrong', amt: '100000', pen: '0', pend: '100000', reason: 'Theo giá quy định' },
    { decision: 'ok', st: 'correct', amt: '0', pen: '0', pend: '0', reason: 'Được duyệt Ok' },
    { decision: 'penalty', st: 'wrong', amt: '100000', pen: '100000', pend: '0', reason: 'Theo giá quy định' }
  ]);
});

test('CAPTURE_LINES_SQL chi nhan tham so jsonb, khong noi chuoi du lieu', () => {
  assert.match(sql.CAPTURE_LINES_SQL, /jsonb_to_recordset\(\$1::jsonb\)/);
  assert.doesNotMatch(sql.CAPTURE_LINES_SQL, /\$2/);
});
