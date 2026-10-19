'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { persistStockoutDays } = require('./stockoutDaysStore');

const MIGRATIONS = path.join(__dirname, '..', '..', 'db', 'migrations');
// 0067 co ALTER TABLE product_report -> dung bang toi thieu de migration chay duoc tren PGlite.
const PRODUCT_REPORT_STUB = 'CREATE TABLE product_report (product_code TEXT);';
const STATE_SQL = `CREATE TABLE product_report_state (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  computed_at TIMESTAMPTZ NOT NULL,
  version BIGINT NOT NULL DEFAULT 1,
  last_full_at TIMESTAMPTZ
);
INSERT INTO product_report_state (computed_at, version) VALUES (now(), 7);`;

async function createDb({ withState = true } = {}) {
  const db = new PGlite();
  await db.exec(PRODUCT_REPORT_STUB);
  await db.exec(fs.readFileSync(path.join(MIGRATIONS, '0067_product_report_bc_chung.sql'), 'utf8'));
  if (withState) await db.exec(STATE_SQL);
  return db;
}

// Pool gia chi du cho persistStockoutDays: connect() tra client dung lai cung 1 PGlite.
function poolOf(db) {
  return {
    connect: async () => ({ query: (q, p) => db.query(q, p), release() {} })
  };
}

async function table(db) {
  const { rows } = await db.query(
    `SELECT product_key, product_code, days_hanoi, days_saigon,
            hanoi_scanned_at IS NOT NULL AS hn_scanned, saigon_scanned_at IS NOT NULL AS sg_scanned
     FROM product_stockout_days ORDER BY product_key`
  );
  return rows;
}

async function stateVersion(db) {
  const { rows } = await db.query('SELECT version FROM product_report_state');
  return Number(rows[0].version);
}

test('ghi so ngay dut vao dung cot cua co so vua quet va giu nguyen cot co so kia', async () => {
  const db = await createDb();
  try {
    const pool = poolOf(db);
    await persistStockoutDays({ pool, branch: 'Hà Nội', rows: [
      { code: 'SP001', totalStockoutDays: 5 },
      { code: 'SP002', totalStockoutDays: 12 }
    ] });
    await persistStockoutDays({ pool, branch: 'Sài Gòn', rows: [
      { code: 'SP002', totalStockoutDays: 3 },
      { code: 'SP003', totalStockoutDays: 9 }
    ] });

    // sp003 chi xuat hien o lan quet SG nen moc quet HN cua no con NULL (khong bi dung toi).
    assert.deepEqual(await table(db), [
      { product_key: 'sp001', product_code: 'SP001', days_hanoi: 5, days_saigon: 0, hn_scanned: true, sg_scanned: true },
      { product_key: 'sp002', product_code: 'SP002', days_hanoi: 12, days_saigon: 3, hn_scanned: true, sg_scanned: true },
      { product_key: 'sp003', product_code: 'SP003', days_hanoi: 0, days_saigon: 9, hn_scanned: false, sg_scanned: true }
    ]);
  } finally { await db.close(); }
});

test('ma het dut o lan quet sau duoc dua ve 0 chi o co so vua quet', async () => {
  const db = await createDb();
  try {
    const pool = poolOf(db);
    await persistStockoutDays({ pool, branch: 'hanoi', rows: [
      { code: 'A', totalStockoutDays: 4 }, { code: 'B', totalStockoutDays: 6 }
    ] });
    await persistStockoutDays({ pool, branch: 'saigon', rows: [{ code: 'A', totalStockoutDays: 8 }] });

    // Lan quet HN moi: A het dut, chi con B.
    await persistStockoutDays({ pool, branch: 'Hà Nội', rows: [{ code: 'B', totalStockoutDays: 2 }] });

    const rows = await table(db);
    const a = rows.find((r) => r.product_key === 'a');
    const b = rows.find((r) => r.product_key === 'b');
    assert.equal(a.days_hanoi, 0);
    assert.equal(a.days_saigon, 8, 'cot SG khong bi dung vao');
    assert.equal(b.days_hanoi, 2);
    assert.equal(b.days_saigon, 0);
  } finally { await db.close(); }
});

test('rows rong van reset cot co so do ve 0 va giu cot co so kia', async () => {
  const db = await createDb();
  try {
    const pool = poolOf(db);
    await persistStockoutDays({ pool, branch: 'hanoi', rows: [{ code: 'A', totalStockoutDays: 4 }] });
    await persistStockoutDays({ pool, branch: 'saigon', rows: [{ code: 'A', totalStockoutDays: 7 }] });

    await persistStockoutDays({ pool, branch: 'Hà Nội', rows: [] });

    assert.deepEqual((await table(db)).map((r) => [r.days_hanoi, r.days_saigon]), [[0, 7]]);
  } finally { await db.close(); }
});

test('product_key = lower(btrim(ma)), ma trung key lay so ngay lon nhat, ma rong bi bo', async () => {
  const db = await createDb();
  try {
    await persistStockoutDays({ pool: poolOf(db), branch: 'hanoi', rows: [
      { code: '  AbC1 ', totalStockoutDays: 3 },
      { code: 'abc1', totalStockoutDays: 9 },
      { code: '   ', totalStockoutDays: 5 },
      { code: null, totalStockoutDays: 5 }
    ] });

    const rows = await table(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].product_key, 'abc1');
    assert.equal(rows[0].product_code, 'AbC1');
    assert.equal(rows[0].days_hanoi, 9);
  } finally { await db.close(); }
});

test('tang product_report_state.version moi lan luu (ke ca rows rong)', async () => {
  const db = await createDb();
  try {
    const pool = poolOf(db);
    assert.equal(await stateVersion(db), 7);
    await persistStockoutDays({ pool, branch: 'hanoi', rows: [{ code: 'A', totalStockoutDays: 1 }] });
    assert.equal(await stateVersion(db), 8);
    await persistStockoutDays({ pool, branch: 'saigon', rows: [] });
    assert.equal(await stateVersion(db), 9);
  } finally { await db.close(); }
});

test('khong co bang product_report_state van luu binh thuong', async () => {
  const db = await createDb({ withState: false });
  try {
    await persistStockoutDays({ pool: poolOf(db), branch: 'saigon', rows: [{ code: 'A', totalStockoutDays: 2 }] });
    assert.deepEqual((await table(db)).map((r) => [r.product_key, r.days_saigon]), [['a', 2]]);
  } finally { await db.close(); }
});

test('co so khong hop le bi tu choi truoc khi cham DB', async () => {
  let connected = false;
  const pool = { connect: async () => { connected = true; throw new Error('khong duoc goi'); } };
  await assert.rejects(persistStockoutDays({ pool, branch: 'Cả hai', rows: [] }), /không hợp lệ/);
  assert.equal(connected, false);
});

test('loi giua chung thi ROLLBACK, nha client va nem loi (vd bang chua migrate)', async () => {
  const calls = [];
  let released = 0;
  const pool = {
    connect: async () => ({
      query: async (q) => {
        calls.push(String(q).trim().split(/\s+/).slice(0, 2).join(' '));
        if (/^UPDATE product_stockout_days/.test(String(q).trim())) {
          const err = new Error('relation "product_stockout_days" does not exist');
          err.code = '42P01';
          throw err;
        }
        return { rows: [] };
      },
      release() { released++; }
    })
  };

  await assert.rejects(persistStockoutDays({ pool, branch: 'hanoi', rows: [{ code: 'A', totalStockoutDays: 1 }] }), /does not exist/);
  assert.equal(calls[0], 'BEGIN');
  assert.equal(calls[calls.length - 1], 'ROLLBACK');
  assert.ok(!calls.includes('COMMIT'));
  assert.equal(released, 1);
});
