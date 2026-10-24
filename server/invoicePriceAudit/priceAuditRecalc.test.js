'use strict';

// Tinh lai "Kiem tra gia ban" theo du lieu hien tai (--recalc) tren PGlite voi schema THAT:
// giu giai thich/Chot/version, cap nhat theo level, chup hoa don chua quet trong cua so, dry-run khong ghi,
// nguon chua san sang thi rollback toan bo.

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDailyAudit, runRecalc } = require('./priceAuditRefresh');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');
const { main: cliMain } = require('../scripts/refresh-invoice-price-audit');

const at23 = day => new Date(`${day}T16:00:00Z`);
const quiet = { error() {}, info() {}, warn() {}, log() {} };

// Hoa don 1 dong T100 x 10, gia 23700: cap Vua min 24000 (Sai, chenh 3.000), cap VIP min 23600 (Dung).
async function setup() {
  const db = await newDb();
  await product(db, 'hanoi', 1, 'T100', 'Ly giu nhiet', HN_NOTE);
  await customer(db, 'hanoi', 1, 'Khach Vua', { groups: 'Duy Thái' });
  return db;
}
async function addInvoice(db, id, purchaseDate, price = 23700) {
  await invoice(db, { id, purchaseDate, customerId: 1, lines: [{ productId: 1, code: 'T100', name: 'Ly', qty: 10, price }] });
}
const daily = (pool, day) => runDailyAudit({ day, pool, now: at23(day), logger: quiet });
const recalc = (pool, extra = {}) => runRecalc({ pool, now: at23('2026-10-20'), logger: quiet, ...extra });
async function lines(db) {
  return (await db.query('SELECT to_jsonb(l) AS j FROM invoice_price_audit_lines l ORDER BY branch, invoice_id, source_line_no'))
    .rows.map(r => r.j);
}
async function count(db, table) {
  return (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}
async function snapshotAll(db) {
  const out = {};
  for (const t of ['invoice_price_audit_invoices', 'invoice_price_audit_state', 'invoice_price_audit_changes']) {
    out[t] = (await db.query(`SELECT to_jsonb(t) AS j FROM ${t} t ORDER BY 1`)).rows.map(r => r.j);
  }
  out.lines = await lines(db);
  return out;
}

test('Doi level: dong duoc tinh lai, giu nguyen giai thich + Chot + version, ghi nhat ky recalc', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await db.query(`UPDATE invoice_price_audit_lines SET sale_explanation = 'Khach cu', explanation_by = 'Sale A',
      explanation_at = '2026-10-20T15:00:00Z', decision = 'penalty', decided_by = 'QL', decided_at = '2026-10-20T16:00:00Z', version = 3`);
    const [old] = await lines(db);
    assert.equal(old.original_status, 'wrong');
    assert.equal(old.customer_level, 'Vừa');
    const stateBefore = (await snapshotAll(db)).invoice_price_audit_state;

    await db.query("UPDATE customer_price_levels SET level = 'vip'");
    const res = await recalc(pool, { apply: true });
    assert.equal(res.status, 'completed');
    assert.equal(res.mode, 'recalc-apply');
    assert.equal(res.day, '2026-10-20'); // mac dinh = ngay da cong bo
    assert.equal(res.recomputedLines, 1);
    assert.equal(res.resultChangedLines, 1);
    assert.equal(res.changedByLevel, 1);
    assert.equal(res.changedByData, 0);
    assert.equal(res.statusFlippedLines, 1);
    assert.deepEqual(res.decidedStatusChanged, [{ branch: 'hanoi', invoiceCode: 'HD1', productCode: 'T100', saleName: 'Duy Thái',
      sourceLineNo: 1, from: 'wrong', to: 'correct', decision: 'penalty' }]);

    const [now] = await lines(db);
    assert.equal(now.customer_level, 'Vip');
    assert.equal(now.original_status, 'correct');
    assert.equal(Number(now.minimum_unit_price), 23600);
    assert.equal(Number(now.original_amount), 0);
    for (const k of ['sale_explanation', 'explanation_by', 'explanation_at', 'decision', 'decided_by', 'decided_at', 'version', 'captured_at', 'sale_name']) {
      assert.deepEqual(now[k], old[k], k);
    }
    assert.deepEqual((await snapshotAll(db)).invoice_price_audit_state, stateBefore); // khong dong vao state

    const log = (await db.query(`SELECT actor, action, before_value, after_value, version_before, version_after
      FROM invoice_price_audit_changes`)).rows;
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'recalc');
    assert.equal(log[0].before_value.originalStatus, 'wrong');
    assert.equal(log[0].after_value.originalStatus, 'correct');
    assert.equal(log[0].before_value.customerLevel, 'Vừa');
    assert.equal(log[0].after_value.customerLevel, 'Vip');
    assert.equal(log[0].version_before, 3);
    assert.equal(log[0].version_after, 3);

    // Chay lai khi khong co gi doi: khong them nhat ky, ket qua khong doi.
    const again = await recalc(pool, { apply: true });
    assert.equal(again.resultChangedLines, 0);
    assert.equal(again.loggedChanges, 0);
    assert.equal(await count(db, 'invoice_price_audit_changes'), 1);
  } finally { await db.close(); }
});

test('Doi du lieu khac (bang gia) khong doi level: tinh vao "do du lieu khac"', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await db.query('UPDATE products SET raw = $1 WHERE id = 1', [JSON.stringify({ description: 'T100 # 1T-23000' })]);
    const res = await recalc(pool, { apply: true });
    assert.equal(res.changedByLevel, 0);
    assert.equal(res.changedByData, 1);
    assert.equal(res.levelChangedLines, 0);
    assert.equal((await lines(db))[0].original_status, 'correct');
  } finally { await db.close(); }
});

test('Cua so 16 ngay: chup hoa don chua quet trong cua so, dong ngoai cua so khong bi dong', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-01 10:00:00+00'); // se ra ngoai cua so
    await daily(pool, '2026-10-01');
    await addInvoice(db, 2, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await addInvoice(db, 3, '2026-10-19 09:00:00+00'); // chua quet, trong cua so
    await addInvoice(db, 4, '2026-10-02 09:00:00+00'); // chua quet, ngoai cua so
    await db.query("UPDATE customer_price_levels SET level = 'vip'");

    const before = await lines(db);
    const res = await recalc(pool, { apply: true });
    assert.equal(res.status, 'completed');
    assert.equal(res.windowFrom, '2026-10-05');
    assert.equal(res.newInvoices, 1);
    assert.equal(res.newLines, 1);
    assert.equal(res.recomputedLines, 1); // chi hoa don 2

    const after = await lines(db);
    assert.deepEqual(after.find(r => r.invoice_id === 1), before.find(r => r.invoice_id === 1)); // ngoai cua so: nguyen
    assert.equal(after.find(r => r.invoice_id === 2).customer_level, 'Vip');
    assert.equal(after.find(r => r.invoice_id === 3).customer_level, 'Vip');
    assert.equal(after.find(r => r.invoice_id === 4), undefined);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 3);
  } finally { await db.close(); }
});

test('Dry-run: tinh du so lieu nhung khong ghi gi (dong, so danh dau, state, nhat ky)', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await addInvoice(db, 2, '2026-10-19 09:00:00+00');
    await db.query("UPDATE customer_price_levels SET level = 'vip'");
    const before = await snapshotAll(db);

    const res = await recalc(pool); // apply = false
    assert.equal(res.mode, 'recalc-dry-run');
    assert.equal(res.status, 'dry-run');
    assert.equal(res.recomputedLines, 1);
    assert.equal(res.resultChangedLines, 1);
    assert.equal(res.newInvoices, 1);
    assert.equal(res.newLines, 1);
    assert.deepEqual(await snapshotAll(db), before);
  } finally { await db.close(); }
});

test('Nguon chua san sang: ROLLBACK toan bo, khong ghi dong/so danh dau/nhat ky', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await addInvoice(db, 2, '2026-10-19 09:00:00+00');
    await db.query("UPDATE customer_price_levels SET level = 'vip'");
    await db.query("UPDATE sheet_snapshot_sync SET freight_error = 'Tieu de cot O sai' WHERE source = 'shipping_measures'");
    const before = await snapshotAll(db);

    const res = await recalc(pool, { apply: true });
    assert.equal(res.status, 'failed');
    assert.equal(res.code, 'PRICE_AUDIT_SOURCE_NOT_READY');
    assert.deepEqual(await snapshotAll(db), before);
    assert.equal(pool.stats.broken, 0);
  } finally { await db.close(); }
});

test('Loi giua chung (sau khi cap nhat dong) van ROLLBACK het', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await db.query("UPDATE customer_price_levels SET level = 'vip'");
    const before = await snapshotAll(db);
    // Chen loi sau khi RECALC_LINES_SQL da chay: bang nhat ky bi chan ghi.
    await db.query(`CREATE FUNCTION boom() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql`);
    await db.query('CREATE TRIGGER t_boom BEFORE INSERT ON invoice_price_audit_changes FOR EACH ROW EXECUTE FUNCTION boom()');
    const res = await recalc(pool, { apply: true });
    assert.equal(res.status, 'failed');
    await db.query('DROP TRIGGER t_boom ON invoice_price_audit_changes');
    assert.deepEqual(await snapshotAll(db), before);
  } finally { await db.close(); }
});

test('Khong co state va --date tuong lai: dung ngay hom nay / bao future-day', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    const res = await recalc(pool);
    assert.equal(res.day, '2026-10-20');
    assert.equal(res.status, 'dry-run');
    assert.equal((await recalc(pool, { day: '2026-10-25' })).status, 'future-day');
  } finally { await db.close(); }
});

test('CLI --recalc: mac dinh dry-run, --apply ghi that, --force bi tu choi', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  const out = [];
  const io = { pool, now: () => at23('2026-10-20'), stdout: s => out.push(s), stderr: s => out.push(s), logger: quiet };
  try {
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await daily(pool, '2026-10-20');
    await db.query("UPDATE customer_price_levels SET level = 'vip'");

    assert.equal(await cliMain(['--recalc'], io), 0);
    const dry = JSON.parse(out.pop());
    assert.equal(dry.mode, 'recalc-dry-run');
    assert.equal(dry.resultChangedLines, 1);
    assert.equal((await lines(db))[0].customer_level, 'Vừa');

    assert.equal(await cliMain(['--recalc', '--apply'], io), 0);
    assert.equal(JSON.parse(out.pop()).status, 'completed');
    assert.equal((await lines(db))[0].customer_level, 'Vip');

    assert.equal(await cliMain(['--recalc', '--force'], io), 1);
  } finally { await db.close(); }
});
