'use strict';

// Job 23:00 "Kiem tra gia ban": cong bo cua so 7 ngay [D-6, D] tren PGlite voi schema THAT.

const test = require('node:test');
const assert = require('node:assert/strict');
const { runDailyAudit, previewDailyAudit, slotStartUtc, latestDueDay, LOCK_KEY } = require('./priceAuditRefresh');
const { SOURCE_NOT_READY, createPriceAuditRepository } = require('./priceAuditRepository');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');
const { main: cliMain } = require('../scripts/refresh-invoice-price-audit');

const at23 = day => new Date(`${day}T16:00:00Z`); // 23:00 VN
const quiet = { error() {}, info() {}, warn() {}, log() {} };

async function setup(days, { firstId = 0 } = {}) {
  const db = await newDb();
  await product(db, 'hanoi', 1, 'T100', 'Ly giu nhiet', HN_NOTE);
  await customer(db, 'hanoi', 1, 'Khach Vua', { email: '', groups: 'Duy Thái' });
  for (const [i, day] of days.entries()) await addInvoice(db, firstId + i + 1, `${day} 10:00:00+00`);
  return db;
}
// Moi hoa don 1 dong T100 x 10, gia 23000 < min 24000 -> Sai gia, chenh 10.000.
async function addInvoice(db, id, purchaseDate, price = 23000) {
  await invoice(db, { id, purchaseDate, customerId: 1, lines: [{ productId: 1, code: 'T100', name: 'Ly', qty: 10, price }] });
}
async function state(db) {
  const { rows } = await db.query(`SELECT published_day::text, window_from::text, window_to::text,
      last_success_at, last_attempt_at, last_error, added_invoice_count, version FROM invoice_price_audit_state`);
  return rows[0] || null;
}
async function soldDays(db, table = 'invoice_price_audit_invoices') {
  const { rows } = await db.query(`SELECT sold_day::text AS d FROM ${table} ORDER BY sold_day, invoice_id`);
  return rows.map(r => r.d);
}
async function count(db, table) {
  return (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
}
async function snapshot(db) {
  const { rows } = await db.query(`SELECT to_jsonb(l) AS j FROM invoice_price_audit_lines l ORDER BY branch, invoice_id, source_line_no`);
  return rows.map(r => r.j);
}
const run = (pool, day, extra = {}) => runDailyAudit({ day, pool, now: at23(day), logger: quiet, ...extra });

test('Chay som van bo sung luc 23h, giu dong cu va khong chay lai sau restart', async () => {
  const db = await setup(['2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    await run(pool, '2026-10-20', { now: new Date('2026-10-20T10:56:55Z') });
    await db.query("UPDATE invoice_price_audit_lines SET sale_explanation = 'Da giai thich', decision = 'ok', version = 2");
    const before = await snapshot(db);
    await addInvoice(db, 2, '2026-10-20 20:00:00+00');
    assert.equal((await run(pool, '2026-10-20', { now: new Date('2026-10-20T15:59:59Z') })).status, 'already-completed');
    const night = await run(pool, '2026-10-20');
    assert.equal(night.status, 'completed');
    assert.equal(night.addedInvoices, 1);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 2);
    assert.deepEqual((await snapshot(db))[0], before[0]);
    assert.equal((await run(pool, '2026-10-20', { now: new Date('2026-10-21T01:00:00Z') })).status, 'already-completed');
    assert.equal((await state(db)).version, 2);
  } finally { await db.close(); }
});

test('Restart sau 23h bat kip luot dem du da chay som, loi van thu lai duoc', async () => {
  const db = await setup(['2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    await run(pool, '2026-10-20', { now: new Date('2026-10-20T10:00:00Z') });
    await addInvoice(db, 2, '2026-10-20 21:00:00+00');
    const failed = await run(pool, '2026-10-20', { capture: async () => { throw new Error('temporary'); } });
    assert.equal(failed.status, 'failed');
    assert.equal((await state(db)).version, 1);
    const recovered = await run(pool, '2026-10-20', { now: new Date('2026-10-21T01:00:00Z') });
    assert.equal(recovered.status, 'completed');
    assert.equal(recovered.addedInvoices, 1);
    assert.equal((await state(db)).last_error, null);
  } finally { await db.close(); }
});

test('slot 23:00 VN = 16:00 UTC; ngay den han khong phu thuoc TZ cua server', () => {
  assert.equal(slotStartUtc('2026-10-20').toISOString(), '2026-10-20T16:00:00.000Z');
  assert.equal(slotStartUtc('2027-01-01').toISOString(), '2027-01-01T16:00:00.000Z');
  const oldTz = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(latestDueDay(new Date('2026-10-20T15:59:59Z')), '2026-10-19', tz); // 22:59:59 VN
      assert.equal(latestDueDay(new Date('2026-10-20T16:00:00Z')), '2026-10-20', tz); // 23:00 VN
      assert.equal(latestDueDay(new Date('2026-10-20T17:30:00Z')), '2026-10-20', tz); // 00:30 VN ngay 21
      assert.equal(latestDueDay(new Date('2026-10-21T01:00:00Z')), '2026-10-20', tz); // 08:00 VN ngay 21
      assert.equal(latestDueDay(new Date('2026-12-31T16:00:00Z')), '2026-12-31', tz);
      assert.equal(latestDueDay(new Date('2027-01-01T08:00:00Z')), '2026-12-31', tz); // 15:00 VN 01/01
      assert.equal(latestDueDay(new Date('2027-01-01T16:00:00Z')), '2027-01-01', tz);
      assert.equal(latestDueDay(new Date('2027-03-01T15:00:00Z')), '2027-02-28', tz);
    }
  } finally {
    if (oldTz === undefined) delete process.env.TZ; else process.env.TZ = oldTz;
  }
});

test('Cua so doi ngay: giu nguyen giai thich/chot va nhat ky lau dai, chi bao cao 7 ngay', async () => {
  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];
  const db = await setup(days);
  const pool = pgliteAsPool(db);
  try {
    const first = await run(pool, '2026-10-20');
    assert.equal(first.status, 'completed');
    assert.equal(first.addedInvoices, 7);
    assert.equal(first.addedLines, 7);
    assert.equal(first.windowFrom, '2026-10-14');
    assert.equal(first.windowTo, '2026-10-20');
    assert.deepEqual(await soldDays(db), days.slice(1));
    const s1 = await state(db);
    assert.equal(s1.published_day, '2026-10-20');
    assert.equal(s1.window_from, '2026-10-14');
    assert.equal(s1.window_to, '2026-10-20');
    assert.equal(s1.added_invoice_count, 7);
    assert.equal(s1.last_error, null);
    assert.equal(new Date(s1.last_success_at).toISOString(), '2026-10-20T16:00:00.000Z');

    // Giai thich/chot + nhat ky cho ca ngay 14 (sap ra khoi cua so) va ngay 15.
    await db.query(`UPDATE invoice_price_audit_lines SET sale_explanation = 'ly do', explanation_by = 'Sale A',
      explanation_at = '2026-10-20T15:00:00Z', decision = 'penalty', version = 2`);
    await db.query(`INSERT INTO invoice_price_audit_changes (branch, invoice_id, source_line_no, actor, action, version_before, version_after)
      SELECT branch, invoice_id, source_line_no, 'u', 'decision', 1, 2 FROM invoice_price_audit_lines`);
    const before = await snapshot(db);
    // Gia ngay 21 giam (mo ta moi) - dong da ghi nhan khong doi.
    await db.query(`UPDATE products SET raw = $1 WHERE id = 1`, [JSON.stringify({ description: 'T100 # 1T-20000' })]);
    // Hoa don ngay 20 luc 23:10 (gio Kiot) dong bo muon + hoa don ngay 21.
    await addInvoice(db, 2001, '2026-10-20 23:10:00+00');
    await addInvoice(db, 2101, '2026-10-21 09:00:00+00');

    const second = await run(pool, '2026-10-21');
    assert.equal(second.status, 'completed');
    assert.equal(second.addedInvoices, 2);
    assert.equal(second.prunedInvoices, 0);
    assert.equal(second.windowFrom, '2026-10-15');
    assert.equal(second.windowTo, '2026-10-21');
    assert.deepEqual(await soldDays(db), ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19',
      '2026-10-20', '2026-10-20', '2026-10-21']);
    assert.deepEqual(await soldDays(db, 'invoice_price_audit_lines'), await soldDays(db));
    const s2 = await state(db);
    assert.equal(s2.published_day, '2026-10-21');
    assert.equal(s2.window_from, '2026-10-15');
    assert.equal(s2.added_invoice_count, 2);
    assert.equal(s2.version, s1.version + 1);

    // Ca ngay da ra khoi cua so van giu nguyen giai thich/chot va nhat ky.
    const after = await snapshot(db);
    assert.deepEqual(after.filter(r => r.sold_day !== '2026-10-21' && r.invoice_id !== 2001),
      before);
    assert.equal(await count(db, 'invoice_price_audit_changes'), 7);
    const { rows: changedDays } = await db.query(`SELECT DISTINCT l.sold_day::text AS d FROM invoice_price_audit_changes c
      JOIN invoice_price_audit_lines l USING (branch, invoice_id, source_line_no) ORDER BY 1`);
    assert.equal(changedDays[0].d, '2026-10-14');
    const report = await createPriceAuditRepository({ pool }).readReport({});
    assert.equal(report.totalRows, 8);
    assert.equal(report.rows.some(r => r.soldDay === '2026-10-14'), false);
    assert.equal(report.rows.find(r => r.soldDay === '2026-10-15').explanationBy, 'Sale A');
    // Hoa don muon mang ngay ban 20/10, gia luc ghi nhan lan dau (mo ta moi 20000 -> dung gia).
    const late = after.find(r => r.invoice_id === 2001);
    assert.equal(late.sold_day, '2026-10-20');
    assert.equal(late.minimum_unit_price, 20000);
    assert.equal(late.original_status, 'correct');
  } finally { await db.close(); }
});

test('Thang/nam: 31/12 cong bo 25-31/12; 01/01/2027 cong bo 26/12-01/01', async () => {
  const days = ['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27', '2026-12-28', '2026-12-29', '2026-12-30',
    '2026-12-31', '2027-01-01'];
  const db = await setup(days);
  const pool = pgliteAsPool(db);
  try {
    const dec = await run(pool, '2026-12-31');
    assert.equal(dec.status, 'completed');
    assert.deepEqual([dec.windowFrom, dec.windowTo], ['2026-12-25', '2026-12-31']);
    assert.deepEqual(await soldDays(db), days.slice(1, 8));
    const jan = await run(pool, '2027-01-01');
    assert.equal(jan.status, 'completed');
    assert.deepEqual([jan.windowFrom, jan.windowTo], ['2026-12-26', '2027-01-01']);
    assert.deepEqual(await soldDays(db), days.slice(1));
    assert.equal((await state(db)).published_day, '2027-01-01');
  } finally { await db.close(); }
});

test('Chay lai cung ngay: already-completed, khong nhan ban dong', async () => {
  const db = await setup(['2026-10-19', '2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    assert.equal((await run(pool, '2026-10-20')).status, 'completed');
    const lines = await snapshot(db);
    const again = await run(pool, '2026-10-20', { now: new Date('2026-10-20T16:05:00Z') });
    assert.equal(again.status, 'already-completed');
    assert.equal(again.addedInvoices, 0);
    assert.deepEqual(await snapshot(db), lines);
    assert.equal((await state(db)).version, 1);
    assert.equal(pool.stats.broken, 0);
    assert.equal(pool.stats.connects, pool.stats.released);
  } finally { await db.close(); }
});

test('Hai lan chay dong thoi: chi 1 lan cong bo, lan kia already-completed, khong trung dong', async () => {
  const db = await setup(['2026-10-18', '2026-10-19', '2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    const results = await Promise.all([run(pool, '2026-10-20'), run(pool, '2026-10-20')]);
    assert.deepEqual(results.map(r => r.status).sort(), ['already-completed', 'completed']);
    assert.equal(await count(db, 'invoice_price_audit_lines'), 3);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 3);
    // Khoa da nha: khong con advisory lock treo.
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`)).rows[0].n, 0);
  } finally { await db.close(); }
});

test('Instance khac dang giu khoa advisory: busy, khong mo giao dich, khong ghi gi', async () => {
  const queries = [];
  let released = 0;
  const pool = {
    async connect() {
      return {
        async query(text, params) {
          queries.push(text);
          if (/pg_try_advisory_lock/.test(text)) {
            assert.deepEqual(params, [LOCK_KEY]);
            return { rows: [{ locked: false }] };
          }
          throw new Error(`khong duoc goi: ${text}`);
        },
        release() { released += 1; }
      };
    }
  };
  const res = await runDailyAudit({ day: '2026-10-20', pool, now: at23('2026-10-20'), logger: quiet });
  assert.equal(res.status, 'busy');
  assert.equal(queries.length, 1);
  assert.equal(released, 1);
});

test('Loi giua chung: rollback giu nguyen toan bo ban cong bo truoc; ghi loi an toan, khong danh dau thanh cong', async () => {
  const db = await setup(['2026-10-19', '2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    assert.equal((await run(pool, '2026-10-20')).status, 'completed');
    const prevState = await state(db);
    const prevLines = await snapshot(db);
    await addInvoice(db, 2101, '2026-10-21 09:00:00+00');
    const failNow = new Date('2026-10-21T16:00:00Z');
    const res = await runDailyAudit({ day: '2026-10-21', pool, now: failNow, logger: quiet,
      async capture(args) {
        const added = await require('./priceAuditRepository').captureUnseenInvoices(args);
        assert.equal(added.addedInvoices, 1); // da ghi vao giao dich roi moi loi
        const err = new Error('canceling statement; postgres://admin:supersecret@db.internal/x');
        err.code = '57014';
        throw err;
      } });
    assert.equal(res.status, 'failed');
    assert.equal(res.code, 'PRICE_AUDIT_DB_ERROR');
    assert.deepEqual(await snapshot(db), prevLines);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 2);
    const s = await state(db);
    assert.equal(s.published_day, prevState.published_day);
    assert.equal(s.window_from, prevState.window_from);
    assert.equal(s.window_to, prevState.window_to);
    assert.equal(s.version, prevState.version);
    assert.equal(s.added_invoice_count, prevState.added_invoice_count);
    assert.equal(new Date(s.last_success_at).toISOString(), new Date(prevState.last_success_at).toISOString());
    assert.equal(new Date(s.last_attempt_at).toISOString(), failNow.toISOString());
    assert.match(s.last_error, /57014/);
    assert.doesNotMatch(s.last_error, /supersecret|postgres:\/\/|at /);
    assert.equal(pool.stats.broken, 0);

    // Lan thu lai cung ngay sau 5 phut thanh cong, khong nhan ban.
    const retry = await runDailyAudit({ day: '2026-10-21', pool, now: new Date('2026-10-21T16:05:00Z'), logger: quiet });
    assert.equal(retry.status, 'completed');
    assert.equal(retry.addedInvoices, 1);
    assert.equal(await count(db, 'invoice_price_audit_lines'), 3);
    assert.equal((await state(db)).last_error, null);
  } finally { await db.close(); }
});

test('Nguon chua san sang (Can do chua dong bo): failed SOURCE_NOT_READY, khong cong bo luot dau', async () => {
  const db = await newDb({ measuresSynced: false });
  const pool = pgliteAsPool(db);
  try {
    await product(db, 'hanoi', 1, 'T100', 'Ly', HN_NOTE);
    await customer(db, 'hanoi', 1, 'K', {});
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    const res = await run(pool, '2026-10-20');
    assert.equal(res.status, 'failed');
    assert.equal(res.code, SOURCE_NOT_READY);
    const s = await state(db);
    assert.equal(s.published_day, null);
    assert.equal(s.last_success_at, null);
    assert.match(s.last_error, /Cân đo/);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 0);
  } finally { await db.close(); }
});

test('Chay tay hom nay truoc 23:00 VN duoc cong bo; ngay tuong lai bi tu choi, khong ghi gi; ngay cu hon ban da cong bo: stale', async () => {
  const db = await setup(['2026-10-19', '2026-10-20']);
  const pool = pgliteAsPool(db);
  try {
    const future = await runDailyAudit({ day: '2026-10-21', pool, now: new Date('2026-10-20T16:59:00Z'), logger: quiet }); // 23:59 VN 20/10
    assert.equal(future.status, 'future-day');
    assert.equal(await state(db), null);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 0);

    const early = await runDailyAudit({ day: '2026-10-20', pool, now: new Date('2026-10-20T03:00:00Z'), logger: quiet }); // 10:00 VN
    assert.equal(early.status, 'completed');
    assert.equal((await state(db)).published_day, '2026-10-20');
    const lines = await snapshot(db);
    assert.equal((await run(pool, '2026-10-20')).status, 'completed');
    const old = await runDailyAudit({ day: '2026-10-15', pool, now: at23('2026-10-20'), logger: quiet });
    assert.equal(old.status, 'stale');
    assert.deepEqual(await snapshot(db), lines);
    assert.equal((await state(db)).published_day, '2026-10-20');
    await assert.rejects(runDailyAudit({ day: '2026-1-5', pool, now: at23('2026-10-20') }), /YYYY-MM-DD/);
  } finally { await db.close(); }
});

test('Dry-run: dem hoa don/dong/sai gia/cua so nhung KHONG ghi gi (ke ca state/last_error)', async () => {
  const db = await setup(['2026-10-13', '2026-10-19', '2026-10-20']);
  await addInvoice(db, 50, '2026-10-20 11:00:00+00', 24000); // dung gia
  const pool = pgliteAsPool(db);
  try {
    const res = await previewDailyAudit({ day: '2026-10-20', pool, now: at23('2026-10-20') });
    assert.deepEqual(res, { mode: 'dry-run', day: '2026-10-20', windowFrom: '2026-10-14', windowTo: '2026-10-20',
      publishedDay: null, addedInvoices: 3, addedLines: 3, wrongLines: 2, prunedInvoices: 0 });
    assert.equal(await state(db), null);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 0);
    assert.equal(await count(db, 'invoice_price_audit_lines'), 0);

    // Dry-run loi nguon cung khong ghi last_error.
    await db.query(`DELETE FROM sheet_snapshot_sync`);
    await assert.rejects(previewDailyAudit({ day: '2026-10-20', pool, now: at23('2026-10-20') }),
      err => err.code === SOURCE_NOT_READY);
    assert.equal(await state(db), null);
    assert.equal(pool.stats.connects, pool.stats.released);
  } finally { await db.close(); }
});

test('CLI: mac dinh dry-run khong ghi; --apply chay that; tham so sai tra 1', async () => {
  const db = await setup(['2026-10-19', '2026-10-20']);
  const pool = pgliteAsPool(db);
  const out = [];
  const io = { pool, now: () => at23('2026-10-20'), stdout: s => out.push(s), stderr: s => out.push(s), logger: quiet };
  try {
    assert.equal(await cliMain(['--date', '2026-10-20'], io), 0);
    const dry = JSON.parse(out.pop());
    assert.equal(dry.mode, 'dry-run');
    assert.equal(dry.addedInvoices, 2);
    assert.equal(dry.wrongLines, 2);
    assert.equal(await state(db), null);
    assert.equal(await count(db, 'invoice_price_audit_invoices'), 0);

    assert.equal(await cliMain([], io), 0); // mac dinh hom nay theo gio VN (now)
    assert.equal(JSON.parse(out.pop()).day, '2026-10-20');

    assert.equal(await cliMain(['--date', '2026-10-20', '--apply'], io), 0);
    const applied = JSON.parse(out.pop());
    assert.equal(applied.mode, 'apply');
    assert.equal(applied.status, 'completed');
    assert.equal((await state(db)).published_day, '2026-10-20');
    assert.equal(await cliMain(['--date', '2026-10-20', '--apply'], io), 0);
    assert.equal(JSON.parse(out.pop()).status, 'already-completed');

    for (const bad of [['--date', '2026-13-01'], ['--date'], ['--force'], ['--date', '20/10/2026']]) {
      assert.equal(await cliMain(bad, io), 1, bad.join(' '));
    }
  } finally { await db.close(); }
});
