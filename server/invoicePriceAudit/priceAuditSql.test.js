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

test('Bac 1-2-3 = Vua/Lon/VIP, bac 4 = cat lo: dat SL cat lo thi lay gia cat lo, chua dat thi san la gia VIP', async () => {
  const note = parsePriceNote('T1 # 21/10 # 20T -86000 | 50T- 85600 | 100T- 85300 | 300T -85000 | VAT+12000đ');
  const base = async (position, qty) => {
    const { rows } = await db.query(
      `SELECT ${sql.basePriceSql(sql.quantityPriceSql('$1::jsonb', '$2::numeric', '$3::numeric'),
        sql.levelPriceSql('$1::jsonb', '$4::int'))}::text AS p`,
      [JSON.stringify(note.tiers), note.cartonSize, String(qty), position]);
    return rows[0].p;
  };
  for (const position of [1, 2, 3]) {
    assert.equal(await base(position, 300), '85000', `cat lo, cap ${position}`);
    assert.equal(await base(position, 1000), '85000', `qua cat lo, cap ${position}`);
  }
  // Chua dat cat lo: theo cap + SL, khong bao gio duoi gia VIP (bac 3)
  assert.equal(await base(1, 10), '86000');
  assert.equal(await base(2, 10), '85600');
  assert.equal(await base(3, 10), '85300');
  assert.equal(await base(1, 299), '85300');
  // Khong co bac cat lo: SL lon van chi xuong gia VIP
  const noLot = parsePriceNote('T1 # 21/10 # 20T -86000 | 50T- 85600 | 100T- 85300 | -T -- | VAT+12000đ');
  const { rows } = await db.query(`SELECT ${sql.quantityPriceSql('$1::jsonb', '$2::numeric', '$3::numeric')}::text AS p`,
    [JSON.stringify(noLot.tiers), noLot.cartonSize, '5000']);
  assert.equal(rows[0].p, '85300');
});

test('Bac theo chiec (CT) va le (let): khong can chiec/thung, cat lo 2000CT van ap dung', async () => {
  const note = parsePriceNote('T2000 # 14/9 # 100CT -2800 | 500CT- 2770 | 1000CT- 2740 | 2000CT -2700 | VAT+230đ');
  assert.equal(note.tiers.length, 4);
  for (const [qty, price] of Object.entries({ 1: '2800', 499: '2800', 500: '2770', 999: '2770', 1000: '2740', 1999: '2740', 2000: '2700' })) {
    assert.equal(await quantityPrice(note, qty), price, `SL ${qty}`);
  }
  assert.equal(await levelPrice(note, 3), '2740');
  const noCarton = parsePriceNote('100CT -2800 | 500CT- 2770');
  assert.equal(await quantityPrice(noCarton, 600), '2770');
  const retail = parsePriceNote('T500 # 31/8 # LẻT -10200 | 1T- 10000 | 2T- 9800 | -T --');
  assert.equal(await quantityPrice(retail, 1), '10200');
  assert.equal(await quantityPrice(retail, 500), '10000');
  assert.equal(await quantityPrice(retail, 1000), '9800');
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
