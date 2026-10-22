'use strict';

// Service "Kiem tra gia ban": kiem tra query, quyen theo dong, ghi giai thich / Chot co version + nhat ky (PGlite, schema THAT).

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePermissions } = require('../auth/featureRegistry');
const { captureUnseenInvoices, createPriceAuditRepository } = require('./priceAuditRepository');
const { createPriceAuditService } = require('./priceAuditService');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');

const DAY = '2026-10-20';
const NOW = new Date('2026-10-20T16:00:00Z');
const user = (vaiTro, hoTen, featurePermissions = {}) => {
  const u = { id: hoTen, vaiTro, hoTen, featurePermissions };
  return { ...u, permissions: resolvePermissions(u) };
};
const SALE = user('Nhân viên sale', 'Duy Thái');
const OTHER_SALE = user('Nhân viên sale', 'Minh Anh');
const QL = user('Quản lý', 'Quản Lý A');
const BOTH = { branchScope: ['hanoi', 'saigon'] };

async function publish(db, from, to) {
  await db.query(`INSERT INTO invoice_price_audit_state (id, published_day, window_from, window_to, last_success_at, last_attempt_at, added_invoice_count)
    VALUES (TRUE, $2, $1, $2, $3, $3, 3)
    ON CONFLICT (id) DO UPDATE SET published_day = EXCLUDED.published_day, window_from = EXCLUDED.window_from, window_to = EXCLUDED.window_to`,
  [from, to, NOW]);
}

// HD1 (HN, 19/10, nhom Duy Thai): dong 1 = 100 x thieu 1000 (sai 100000); dong 2 dung; dong 3 = 5 x thieu 23000 (sai 115000).
// HD3 (SG, 18/10, nhom Minh Anh): 2 x 29000 < 30000 -> sai 2000.
async function setup() {
  const db = await newDb({ syncedAt: NOW });
  await product(db, 'hanoi', 1, 'T100', 'Ly giu nhiet', HN_NOTE);
  await customer(db, 'hanoi', 1, 'Khach Vua', { email: '', groups: 'Duy Thái' });
  await product(db, 'saigon', 9, 'T100', 'Ly SG', 'T100 # 1T-30000');
  await customer(db, 'saigon', 9, 'Khach SG', { groups: 'Minh Anh' });
  const ln = (qty, price) => ({ productId: 1, code: 'T100', name: 'Ly giu nhiet', qty, price });
  await invoice(db, { id: 1, customerId: 1, purchaseDate: '2026-10-19 08:00:00+00', lines: [ln(100, 23000), ln(10, 24000), ln(5, 1000)] });
  await invoice(db, { branch: 'saigon', id: 3, customerId: 9, purchaseDate: '2026-10-18 08:00:00+00', lines: [{ ...ln(2, 29000), productId: 9, name: 'Ly SG' }] });
  await db.transaction(tx => captureUnseenInvoices({ day: DAY, client: tx, now: NOW }));
  await publish(db, '2026-10-14', DAY);
  const service = createPriceAuditService({ repository: createPriceAuditRepository({ pool: pgliteAsPool(db) }) });
  return { db, service };
}
const key = (lineNo, invoiceId = '1', branch = 'hanoi') => ({ branch, invoiceId, lineNo: String(lineNo) });
const rejectsWith = (promise, status, code) => assert.rejects(promise, err => {
  assert.equal(err.statusCode, status, err.message);
  if (code) assert.equal(err.code, code);
  return true;
});

test('Chot: Ok -> Dung/0 giu goc; Phat -> Sai/chenh goc; doi Ok sang Phat phuc hoi; null xoa nguoi chot; nhat ky truoc/sau', async () => {
  const { db, service } = await setup();
  try {
    let { row } = await service.updateDecision(key(1), { decision: 'ok', expectedVersion: 1 }, QL);
    assert.equal(row.effectiveStatus, 'correct');
    assert.equal(Number(row.effectiveAmount), 0);
    assert.equal(row.originalStatus, 'wrong');
    assert.equal(row.originalAmount, '100000');
    assert.equal(row.unitShortfall, '1000');
    assert.equal(row.decidedBy, 'Quản Lý A');
    assert.ok(row.decidedAt);
    assert.equal(row.version, 2);
    assert.equal('currentSaleGroup' in row, false);
    assert.equal(row.canDecide, true);

    ({ row } = await service.updateDecision(key(1), { decision: 'penalty', expectedVersion: 2 }, QL));
    assert.equal(row.effectiveStatus, 'wrong');
    assert.equal(row.effectiveAmount, '100000');
    assert.equal(row.version, 3);

    ({ row } = await service.updateDecision(key(1), { decision: null, expectedVersion: 3 }, QL));
    assert.equal(row.decision, null);
    assert.equal(row.decidedBy, null);
    assert.equal(row.decidedAt, null);
    assert.equal(row.effectiveAmount, '100000');

    const log = (await db.query(`SELECT actor, action, before_value, after_value, version_before, version_after
      FROM invoice_price_audit_changes ORDER BY id`)).rows;
    assert.equal(log.length, 3);
    assert.deepEqual(log.map(r => [r.action, r.before_value.decision, r.after_value.decision, r.version_before, r.version_after]),
      [['decision', null, 'ok', 1, 2], ['decision', 'ok', 'penalty', 2, 3], ['decision', 'penalty', null, 3, 4]]);
    assert.equal(log[0].actor, 'Quản Lý A');
  } finally { await db.close(); }
});

test('Chot: tong chua chot va tong da Phat khong lan; KPI moi theo bo loc dang dung tra kem', async () => {
  const { db, service } = await setup();
  try {
    let report = await service.getReport({}, QL, BOTH);
    assert.equal(report.kpis.pendingAmount, '217000');
    assert.equal(report.kpis.penaltyAmount, '0');
    const res = await service.updateDecision(key(3), { decision: 'penalty', expectedVersion: 1 }, QL, { status: 'wrong' }, BOTH);
    assert.equal(res.kpis.pendingAmount, '102000');
    assert.equal(res.kpis.penaltyAmount, '115000');
    assert.equal(res.kpis.wrongLines, 3);
    assert.equal(res.totalRows, 3);
    report = await service.getReport({ decision: 'pending' }, QL, BOTH);
    assert.equal(report.kpis.pendingAmount, '102000');
    assert.equal(report.kpis.penaltyAmount, '0');
  } finally { await db.close(); }
});

test('Dong sai duyet Ok roi bo loc Sai gia, xuat hien o Dung gia + Ok', async () => {
  const { db, service } = await setup();
  try {
    const { kpis, totalRows } = await service.updateDecision(key(1), { decision: 'ok', expectedVersion: 1 }, QL, { status: 'wrong' }, BOTH);
    assert.equal(totalRows, 2);
    assert.equal(kpis.wrongLines, 2);
    const wrong = await service.getReport({ status: 'wrong' }, QL, BOTH);
    assert.ok(!wrong.rows.some(r => r.invoiceId === '1' && r.sourceLineNo === 1));
    const okRows = await service.getReport({ status: 'correct', decision: 'ok' }, QL, BOTH);
    assert.deepEqual(okRows.rows.map(r => [r.invoiceId, r.sourceLineNo, r.effectiveAmount]), [['1', 1, '0']]);
  } finally { await db.close(); }
});

test('Chot loi: 409 version cu kem dong hien tai; 400 Phat dong dung goc; 400 ngoai enum; 403 khong quyen; 404 het cua so / khong co', async () => {
  const { db, service } = await setup();
  try {
    await service.updateDecision(key(1), { decision: 'ok', expectedVersion: 1 }, QL);
    await assert.rejects(service.updateDecision(key(1), { decision: 'penalty', expectedVersion: 1 }, QL), err => {
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, 'VERSION_CONFLICT');
      assert.equal(err.row.version, 2);
      assert.equal(err.row.decision, 'ok');
      assert.equal('currentSaleGroup' in err.row, false);
      return true;
    });
    await rejectsWith(service.updateDecision(key(2), { decision: 'penalty', expectedVersion: 1 }, QL), 400, 'NOT_WRONG_PRICE');
    await rejectsWith(service.updateDecision(key(2), { decision: 'ok', expectedVersion: 1 }, QL), 400, 'NOT_WRONG_PRICE');
    for (const decision of ['maybe', 'OK', '', 1, undefined]) {
      await rejectsWith(service.updateDecision(key(3), { decision, expectedVersion: 1 }, QL), 400);
    }
    await rejectsWith(service.updateDecision(key(3), { decision: 'ok' }, QL), 400);
    await rejectsWith(service.updateDecision(key(3), { decision: 'ok', expectedVersion: 1, effectiveAmount: '0' }, QL), 400);
    await rejectsWith(service.updateDecision(key(3), { decision: 'ok', expectedVersion: 1 }, SALE), 403);
    await rejectsWith(service.updateDecision(key(3), { decision: 'ok', expectedVersion: 1 }, user('Trợ lý', 'TL')), 403);
    await rejectsWith(service.updateDecision(key(9), { decision: 'ok', expectedVersion: 1 }, QL), 404);
    await rejectsWith(service.updateDecision({ branch: 'both', invoiceId: '1', lineNo: '1' }, { decision: 'ok', expectedVersion: 1 }, QL), 400);
    await rejectsWith(service.updateDecision({ branch: 'hanoi', invoiceId: '1x', lineNo: '1' }, { decision: 'ok', expectedVersion: 1 }, QL), 400);
    await publish(db, '2026-10-20', '2026-10-20');
    await rejectsWith(service.updateDecision(key(3), { decision: 'ok', expectedVersion: 1 }, QL), 404);
    await rejectsWith(service.updateExplanation(key(3), { text: 'x', expectedVersion: 1 }, SALE), 404);
    const v = (await db.query('SELECT version, decision FROM invoice_price_audit_lines WHERE invoice_id = 1 AND source_line_no = 3')).rows[0];
    assert.deepEqual(v, { version: 1, decision: null });
  } finally { await db.close(); }
});

test('Giai thich: Sale dung nhom HIEN TAI ghi duoc + nhat ky; sai nhom / Quan ly 403; doi nhom khach co hieu luc ngay; khong sua snapshot', async () => {
  const { db, service } = await setup();
  try {
    const { row } = await service.updateExplanation(key(1), { text: 'Khách quen, sếp duyệt miệng', expectedVersion: 1 }, SALE);
    assert.equal(row.saleExplanation, 'Khách quen, sếp duyệt miệng');
    assert.equal(row.explanationBy, 'Duy Thái');
    assert.ok(row.explanationAt);
    assert.equal(row.canEditExplanation, true);
    assert.equal(row.version, 2);
    const log = (await db.query('SELECT action, before_value, after_value, version_before, version_after FROM invoice_price_audit_changes')).rows;
    assert.deepEqual(log, [{ action: 'explanation', before_value: { text: '' }, after_value: { text: 'Khách quen, sếp duyệt miệng' }, version_before: 1, version_after: 2 }]);

    await rejectsWith(service.updateExplanation(key(1), { text: 'x', expectedVersion: 2 }, OTHER_SALE), 403);
    await rejectsWith(service.updateExplanation(key(1), { text: 'x', expectedVersion: 2 }, QL), 403);
    await rejectsWith(service.updateExplanation(key(1), { text: 'x', expectedVersion: 1 }, SALE), 409, 'VERSION_CONFLICT');
    await rejectsWith(service.updateExplanation(key(1), { text: 'x'.repeat(4001), expectedVersion: 2 }, SALE), 400);
    await rejectsWith(service.updateExplanation(key(1), { text: 5, expectedVersion: 2 }, SALE), 400);
    for (const extra of [{ saleName: 'Minh Anh' }, { originalAmount: '0' }, { decision: 'ok' }, { minimumUnitPrice: '1' }]) {
      await rejectsWith(service.updateExplanation(key(1), { text: 'x', expectedVersion: 2, ...extra }, SALE), 400);
    }

    // Nhom khach doi sang Minh Anh: Duy Thai mat quyen, Minh Anh duoc; nhan Sale tren ban chup giu nguyen.
    await db.query(`UPDATE customers SET raw = '{"groups":"Minh Anh"}' WHERE branch = 'hanoi' AND id = 1`);
    await rejectsWith(service.updateExplanation(key(1), { text: 'x', expectedVersion: 2 }, SALE), 403);
    const after = await service.updateExplanation(key(1), { text: '', expectedVersion: 2 }, OTHER_SALE);
    assert.equal(after.row.saleExplanation, '');
    assert.equal(after.row.saleName, 'Duy Thái');
    // Nhom rong: khong ai giai thich duoc.
    await db.query(`UPDATE customers SET raw = '{"groups":""}' WHERE branch = 'hanoi' AND id = 1`);
    await rejectsWith(service.updateExplanation(key(1), { text: 'y', expectedVersion: 3 }, OTHER_SALE), 403);

    const snap = (await db.query(`SELECT sale_name, original_amount::text AS a, original_status, minimum_unit_price::text AS m, decision
      FROM invoice_price_audit_lines WHERE invoice_id = 1 AND source_line_no = 1`)).rows[0];
    assert.deepEqual(snap, { sale_name: 'Duy Thái', a: '100000', original_status: 'wrong', m: '24000', decision: null });
  } finally { await db.close(); }
});

test('getReport: quyen theo dong, bo currentSaleGroup, pham vi co so tu cookie, query khong hop le 400', async () => {
  const { db, service } = await setup();
  try {
    const r = await service.getReport({}, SALE, BOTH);
    assert.equal(r.totalRows, 4);
    for (const row of r.rows) {
      assert.equal('currentSaleGroup' in row, false);
      assert.equal(row.canEditExplanation, row.branch === 'hanoi');
      assert.equal(row.canDecide, false);
    }
    const q = await service.getReport({}, QL, BOTH);
    assert.deepEqual(q.rows.map(x => x.canDecide).sort(), [false, true, true, true]);
    assert.ok(q.rows.every(x => x.canEditExplanation === false));

    assert.equal((await service.getReport({}, QL, { branchScope: ['saigon'] })).totalRows, 1);
    assert.equal((await service.getReport({ branch: 'hanoi' }, QL, { branchScope: ['saigon'] })).totalRows, 3);
    assert.equal((await service.getReport({ from: '2026-10-19', to: '2026-10-19', pageSize: '25', page: '1', vat: 'false', freight: 'false',
      status: 'wrong', decision: 'pending', sale: 'Duy Thái', q: 'hd1' }, QL, BOTH)).totalRows, 2);

    for (const bad of [{ status: 'bad' }, { decision: 'none' }, { branch: 'both' }, { from: '2026-10-13' }, { to: '2026-10-21' },
      { from: '2026-10-20', to: '2026-10-19' }, { from: '20/10/2026' }, { pageSize: '30' }, { page: '0' }, { page: 'x' }, { vat: 'maybe' }]) {
      await rejectsWith(service.getReport(bad, QL, BOTH), 400);
    }
  } finally { await db.close(); }
});

test('getReport: chua cong bo -> available=false; thieu bang (42P01) -> available=false ly do an toan; loi DB khac nem tiep', async () => {
  const db = await newDb({ syncedAt: NOW });
  try {
    const service = createPriceAuditService({ repository: createPriceAuditRepository({ pool: pgliteAsPool(db) }) });
    const r = await service.getReport({}, QL, BOTH);
    assert.equal(r.meta.available, false);
    assert.equal(r.meta.message, 'Chưa chạy kiểm tra giá');
    assert.equal(r.kpis, null);
  } finally { await db.close(); }
  const missing = Object.assign(new Error('relation "invoice_price_audit_state" does not exist'), { code: '42P01' });
  const s1 = createPriceAuditService({ repository: { readState: async () => { throw missing; }, readReport: async () => { throw missing; } } });
  const r1 = await s1.getReport({}, QL, BOTH);
  assert.equal(r1.meta.available, false);
  assert.equal(r1.meta.reason, 'not_migrated');
  assert.doesNotMatch(JSON.stringify(r1), /relation|invoice_price_audit_state/);
  const boom = Object.assign(new Error('connection reset'), { code: '08006' });
  const s2 = createPriceAuditService({ repository: { readState: async () => { throw boom; }, readReport: async () => { throw boom; } } });
  await assert.rejects(s2.getReport({}, QL, BOTH), /connection reset/);
});
