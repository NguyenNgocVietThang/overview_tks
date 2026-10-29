'use strict';

// Trang thai boc (2026-10-27): in lai nguyen tu, doi tay Dang boc -> Da boc / Da huy, tu dong theo Kiot, canh bao lech SL.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createPickAssignmentsService } = require('./pickAssignmentsService');
const kiotData = require('./pickKiotData');

const MIGRATIONS = path.join(__dirname, '../db/migrations');
const migration = file => fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');

function poolFor(db) {
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

const QL = { id: 'ql-1', hoTen: 'Quản Lý A - 123456789', username: 'ql' };
const ctx = scope => ({ user: QL, ...(scope ? { scope } : {}) });

function order(overrides = {}) {
  return {
    branch: 'HN', orderCode: 'DH001', customerName: 'Khách A', saleName: 'Sale B', saleTelegramId: '555', orderDate: '27/10/2026 09:00',
    status: { code: 'SENT_TO_ACCOUNTANT', label: 'Đơn đã gửi kế toán' }, invoiceDiscount: 0,
    lines: [{ productCode: 'AAA1', productName: 'Hàng A', quantity: 250, price: 10, discount: 0 }],
    ...overrides
  };
}

const lineOf = (productCode, quantity) => ({ productCode, productName: productCode, quantity, price: 1, discount: 0 });

async function fixture({ orders = { DH001: order() } } = {}) {
  const db = new PGlite();
  await db.exec(migration('0001_core_master_data.sql'));
  await db.exec(migration('0003_orders.sql'));
  await db.exec(migration('0064_sheet_snapshots.sql'));
  await db.exec(migration('0095_stock_positions.sql'));
  await db.exec(migration('0096_order_pick_assignments.sql'));
  await db.exec(migration('0097_order_pick_assignment_snapshots.sql'));
  await db.exec(migration('0098_order_pick_history_mismatch_ack.sql'));
  const seed = [
    { code: 'AAA1', location: 'A01', notes: '3T x 100' }, // id 1: 300
    { code: 'AAA1', location: 'B02', notes: '2T x 100' }, // id 2: 200
    { code: 'BBB2', location: 'C03', notes: '5T x 10' } // id 3
  ];
  for (const row of seed) {
    await db.query(`INSERT INTO stock_positions (branch, code, name, notes, location) VALUES ('HN', $1, $2, $3, $4)`, [row.code, 'Tên ' + row.code, row.notes, row.location]);
  }
  const service = createPickAssignmentsService({
    getDb: () => poolFor(db),
    loadOrder: async ({ branch, orderCode }) => {
      const found = orders[orderCode];
      return found && found.branch === branch ? found : null;
    }
  });
  const notesOf = async id => (await db.query('SELECT notes FROM stock_positions WHERE id = $1', [id])).rows[0]?.notes;
  const pickCount = async () => (await db.query(`SELECT count(*)::int AS n FROM stock_position_history WHERE action = 'pick'`)).rows[0].n;
  const latest = async code => (await service.get(ctx(), { branch: 'HN', orderCode: code })).assignment;
  return { db, service, notesOf, pickCount, latest };
}

async function addKiotOrder(db, { code, status, id, lines, branch = 'hanoi' }) {
  await db.query(`INSERT INTO orders (branch, id, code, raw) VALUES ($1, $2, $3, $4::jsonb)`, [branch, id, code, JSON.stringify({ statusValue: status })]);
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await db.query(`INSERT INTO order_details (branch, order_id, line_no, quantity, raw) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [branch, id, lineNo, line.quantity, JSON.stringify({ productCode: line.productCode })]);
  }
}

const body = (allocations, extra = {}) => ({ branch: 'HN', orderCode: 'DH001', allocations, ...extra });

test('kiotOutcome: chi Hoan thanh / Da huy, khong phan biet dau va hoa/thuong', () => {
  assert.equal(kiotData.kiotOutcome('Hoàn thành'), 'completed');
  assert.equal(kiotData.kiotOutcome('hoan thanh'), 'completed');
  assert.equal(kiotData.kiotOutcome('Đã hủy'), 'cancelled');
  assert.equal(kiotData.kiotOutcome('Da huy'), 'cancelled');
  for (const other of ['Phiếu tạm', 'Đã xác nhận', 'Đang giao hàng', '', null, undefined]) assert.equal(kiotData.kiotOutcome(other), null);
});

test('diffQuantities: lech khi khac SL, ma chua chi dinh (picked 0) hoac ma chi dinh khong con tren don (ordered 0); khop thi rong', () => {
  const assigned = new Map([['a1', { productCode: 'A1', quantity: 400 }], ['b2', { productCode: 'B2', quantity: 10 }]]);
  assert.deepEqual(kiotData.diffQuantities(assigned, new Map([['a1', 400], ['b2', 10]])), []);
  assert.deepEqual(kiotData.diffQuantities(assigned, new Map([['a1', 395], ['b2', 10], ['c3', 7]])), [
    { productCode: 'A1', picked: 400, ordered: 395 }, { productCode: 'c3', picked: 0, ordered: 7 }]);
  assert.deepEqual(kiotData.diffQuantities(assigned, new Map([['a1', 400]])), [{ productCode: 'B2', picked: 10, ordered: 0 }]);
});

test('assign reassign: in lai don Dang boc = huy luot cu + luot moi cung giao dich, van Dang boc, ton that khong doi', async () => {
  const { db, service, notesOf, latest } = await fixture();
  try {
    const first = (await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]))).assignment;
    await assert.rejects(() => service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 2, qty: 200 }, { productCode: 'AAA1', positionId: 1, qty: 50 }])), { code: 'ALREADY_ASSIGNED' });
    await assert.rejects(() => service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }], { reassign: true, version: 9 })), { code: 'VERSION_CONFLICT' });
    const second = (await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 2, qty: 200 }, { productCode: 'AAA1', positionId: 1, qty: 50 }], { reassign: true, version: 1 }))).assignment;
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, 'picking');
    assert.equal((await latest('DH001')).id, second.id);
    const oldRow = (await db.query('SELECT status, version FROM order_pick_assignments WHERE id = $1', [first.id])).rows[0];
    assert.deepEqual([oldRow.status, oldRow.version], ['cancelled', 2]);
    const reason = (await db.query(`SELECT summary->>'reason' AS reason FROM order_pick_history WHERE assignment_id = $1 AND action = 'cancel'`, [first.id])).rows[0].reason;
    assert.equal(reason, 'reassign');
    assert.equal(await notesOf(1), '3T x 100');
    assert.equal(await notesOf(2), '2T x 100');
    assert.equal((await service.latestStatuses()).get('HN|dh001'), 'picking');
  } finally { await db.close(); }
});

test('assign reassign: loi o luot moi thi luot cu giu nguyen; Da boc khong in lai duoc', async () => {
  const { db, service, latest } = await fixture();
  try {
    const first = (await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]))).assignment;
    await assert.rejects(() => service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 10 }], { reassign: true })), { code: 'VALIDATION' });
    const still = await latest('DH001');
    assert.deepEqual([still.id, still.status, still.version], [first.id, 'picking', 1]);
    await service.confirm(ctx(), first.id, { version: 1 });
    await assert.rejects(() => service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 2, qty: 250 }], { reassign: true })), { statusCode: 409, code: 'ALREADY_CONFIRMED' });
  } finally { await db.close(); }
});

test('setStatus: Dang boc -> Da boc tru thung dung 1 lan (bam lai khong tru nua); Dang boc -> Da huy; Da boc la cuoi', async () => {
  const { db, service, notesOf, pickCount } = await fixture({ orders: {
    DH001: order(),
    DH002: order({ orderCode: 'DH002', lines: [lineOf('BBB2', 20)] })
  } });
  try {
    await assert.rejects(() => service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH001', status: 'confirmed' }), { statusCode: 409, code: 'INVALID_STATE' });
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
    await assert.rejects(() => service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH001', status: 'picking' }), { statusCode: 400, code: 'VALIDATION' });
    await assert.rejects(() => service.setStatus(ctx(['SG']), { branch: 'HN', orderCode: 'DH001', status: 'confirmed' }), { statusCode: 403 });
    const done = (await service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH001', status: 'confirmed' })).assignment;
    assert.equal(done.status, 'confirmed');
    const notesAfter = await notesOf(1);
    assert.notEqual(notesAfter, '3T x 100', 'da tru thung that');
    const again = (await service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH001', status: 'confirmed' })).assignment;
    assert.equal(again.version, done.version);
    assert.equal(await notesOf(1), notesAfter, 'xac nhan lai khong tru lan 2');
    assert.equal(await pickCount(), 1);
    await assert.rejects(() => service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH001', status: 'cancelled' }), { statusCode: 409, code: 'INVALID_STATE' });

    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH002', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 20 }] });
    const cancelled = (await service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH002', status: 'cancelled' })).assignment;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(await notesOf(3), '5T x 10');
    assert.equal((await service.latestStatuses()).get('HN|dh002'), 'cancelled', 'Da huy thu cong van hien nhan Da huy');
    await assert.rejects(() => service.setStatus(ctx(), { branch: 'HN', orderCode: 'DH002', status: 'confirmed' }), { statusCode: 409, code: 'INVALID_STATE' });
  } finally { await db.close(); }
});

test('reconcileWithKiot: Kiot Hoan thanh -> Da boc (tru thung), Kiot Da huy -> Chua boc (tra giu cho), Da boc khong bi dong toi', async () => {
  const { db, service, notesOf, pickCount, latest } = await fixture({ orders: {
    DH001: order(),
    DH002: order({ orderCode: 'DH002', lines: [lineOf('BBB2', 20)] }),
    DH003: order({ orderCode: 'DH003', lines: [lineOf('AAA1', 50)] }),
    DH004: order({ orderCode: 'DH004', lines: [lineOf('BBB2', 10)] })
  } });
  try {
    await addKiotOrder(db, { code: 'DH001', status: 'Hoàn thành', id: 1, lines: [{ productCode: 'AAA1', quantity: 250 }] });
    await addKiotOrder(db, { code: 'DH002', status: 'Đã hủy', id: 2, lines: [{ productCode: 'BBB2', quantity: 20 }] });
    await addKiotOrder(db, { code: 'DH003', status: 'Đã xác nhận', id: 3, lines: [{ productCode: 'AAA1', quantity: 50 }] });
    await addKiotOrder(db, { code: 'DH004', status: 'Đã hủy', id: 4, lines: [{ productCode: 'BBB2', quantity: 10 }] });
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH002', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 20 }] });
    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH003', allocations: [{ productCode: 'AAA1', positionId: 2, qty: 50 }] });
    // DH004 da duoc nguoi dung xac nhan boc roi Kiot moi huy: Da boc khong bao gio bi Kiot dong toi.
    const four = (await service.assign(ctx(), { branch: 'HN', orderCode: 'DH004', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 10 }] })).assignment;
    await service.confirm(ctx(), four.id, { version: 1 });

    const result = await service.reconcileWithKiot();
    assert.deepEqual([result.checked, result.confirmed, result.cancelled, result.failed.length], [3, 1, 1, 0]);
    const dh001 = await latest('DH001');
    assert.equal(dh001.status, 'confirmed');
    assert.equal(dh001.confirmedByName, 'Hệ thống (KiotViet)');
    assert.notEqual(await notesOf(1), '3T x 100', 'da tru thung that');
    const dh002 = await latest('DH002');
    assert.equal(dh002.status, 'cancelled');
    assert.equal(dh002.history.at(-1).summary.reason, 'kiot_cancelled');
    assert.equal((await latest('DH003')).status, 'picking', 'Kiot chua hoan thanh: giu nguyen');
    assert.equal((await latest('DH004')).status, 'confirmed');
    const map = await service.latestStatuses();
    assert.equal(map.has('HN|dh002'), false, 'Kiot huy -> Chua boc (khong co khoa)');
    assert.equal(map.get('HN|dh001'), 'confirmed');
    assert.equal(map.get('HN|dh004'), 'confirmed');

    const picksBefore = await pickCount();
    const repeat = await service.reconcileWithKiot();
    assert.deepEqual([repeat.checked, repeat.confirmed, repeat.cancelled], [1, 0, 0]);
    assert.equal(await pickCount(), picksBefore, 'chay lai khong tru lan 2');
  } finally { await db.close(); }
});

test('reconcileWithKiot: ton vi tri da doi -> bao loi cho chi dinh do, giu Dang boc, khong chan don khac; khong co chi dinh nao thi nhe', async () => {
  const { db, service, notesOf, latest } = await fixture({ orders: {
    DH001: order(),
    DH002: order({ orderCode: 'DH002', lines: [lineOf('BBB2', 20)] })
  } });
  try {
    assert.deepEqual(await service.reconcileWithKiot(), { checked: 0, confirmed: 0, cancelled: 0, skipped: 0, failed: [] });
    await addKiotOrder(db, { code: 'DH001', status: 'Hoàn thành', id: 1, lines: [{ productCode: 'AAA1', quantity: 250 }] });
    await addKiotOrder(db, { code: 'DH002', status: 'Hoàn thành', id: 2, lines: [{ productCode: 'BBB2', quantity: 20 }] });
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH002', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 20 }] });
    await db.query(`UPDATE stock_positions SET notes = '1T x 100', version = version + 1 WHERE id = 1`);
    const result = await service.reconcileWithKiot();
    assert.deepEqual([result.confirmed, result.failed.length, result.failed[0].code, result.failed[0].orderCode], [1, 1, 'STOCK_CHANGED', 'DH001']);
    assert.equal((await latest('DH001')).status, 'picking');
    assert.equal((await latest('DH002')).status, 'confirmed');
    assert.equal(await notesOf(1), '1T x 100');
  } finally { await db.close(); }
});

test('pickMismatches: tong ST da chi dinh vs SL dong don Kiot, tu het khi Kiot khop lai; Da huy khong canh bao; chua ap migration thi Map rong', async () => {
  const { db, service, latest } = await fixture({ orders: {
    DH001: order({ lines: [lineOf('AAA1', 250), lineOf('BBB2', 20)] })
  } });
  try {
    await addKiotOrder(db, { code: 'DH001', status: 'Phiếu tạm', id: 1, lines: [{ productCode: 'AAA1', quantity: 240 }, { productCode: 'BBB2', quantity: 20 }, { productCode: 'VAT10', quantity: 1 }] });
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }, { productCode: 'BBB2', positionId: 3, qty: 20 }]));
    const pairs = [{ branch: 'HN', orderCode: 'DH001' }, { branch: 'HN', orderCode: 'DH999' }];
    let map = await service.pickMismatches(pairs);
    assert.deepEqual(map.get('HN|dh001'), [{ productCode: 'AAA1', picked: 250, ordered: 240 }]);
    assert.equal(map.has('HN|dh999'), false);
    // Kiot sua don khop lai -> canh bao tu het.
    await db.query(`UPDATE order_details SET quantity = 250 WHERE branch = 'hanoi' AND order_id = 1 AND line_no = 1`);
    assert.equal((await service.pickMismatches(pairs)).has('HN|dh001'), false);
    // Kiot them dong moi chua chi dinh -> lech (picked 0).
    await db.query(`INSERT INTO order_details (branch, order_id, line_no, quantity, raw) VALUES ('hanoi', 1, 9, 5, '{"productCode":"CCC3"}'::jsonb)`);
    assert.deepEqual((await service.pickMismatches(pairs)).get('HN|dh001'), [{ productCode: 'ccc3', picked: 0, ordered: 5 }]);
    // Chi dinh bi huy -> khong canh bao (chi Dang boc / Da boc).
    await service.cancel(ctx(), (await latest('DH001')).id, { version: 1 });
    assert.equal((await service.pickMismatches(pairs)).has('HN|dh001'), false);
    await db.exec('DROP TABLE order_pick_lines; DROP TABLE order_pick_history; DROP TABLE order_pick_assignments;');
    assert.equal((await service.pickMismatches(pairs)).size, 0);
  } finally { await db.close(); }
});

test('pickMismatches: don Da boc van canh bao khi SL Kiot lech', async () => {
  const { db, service, latest } = await fixture();
  try {
    await addKiotOrder(db, { code: 'DH001', status: 'Hoàn thành', id: 1, lines: [{ productCode: 'AAA1', quantity: 230 }] });
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
    await service.confirm(ctx(), (await latest('DH001')).id, { version: 1 });
    const map = await service.pickMismatches([{ branch: 'HN', orderCode: 'DH001' }]);
    assert.deepEqual(map.get('HN|dh001'), [{ productCode: 'AAA1', picked: 250, ordered: 230 }]);
  } finally { await db.close(); }
});

test('cancel: ly do huy chi do may chu dat; body.reason tu client bi bo qua (khong gia mao "Kiot huy" de an trang thai Da huy)', async () => {
  const { db, service, latest } = await fixture();
  try {
    const { assignment } = await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
    await service.cancel(ctx(), assignment.id, { version: 1, reason: 'kiot_cancelled' });
    assert.equal((await latest('DH001')).history.at(-1).summary.reason, 'manual');
    assert.equal((await service.latestStatuses()).get('HN|dh001'), 'cancelled');
  } finally { await db.close(); }
});

// ---------- "Da xu ly" canh bao lech SL (migration 0098) ----------
const historyCount = async (db, action) => (await db.query(`SELECT count(*)::int AS n FROM order_pick_history WHERE action = $1`, [action])).rows[0].n;
const PAIRS = [{ branch: 'HN', orderCode: 'DH001' }];
const mismatchOf = async service => (await service.pickMismatches(PAIRS)).get('HN|dh001');

async function lechOrder(extra) {
  // Chi dinh 250 AAA1 nhung Kiot chi dat 240.
  const f = await fixture(extra);
  await addKiotOrder(f.db, { code: 'DH001', status: 'Phiếu tạm', id: 1, lines: [{ productCode: 'AAA1', quantity: 240 }] });
  await f.service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]));
  return f;
}

test('acknowledgeMismatch: lech SL -> ack gan handled {by, at} cho tung dong; chua ack thi khong co handled', async () => {
  const { db, service } = await lechOrder();
  try {
    assert.deepEqual(await mismatchOf(service), [{ productCode: 'AAA1', picked: 250, ordered: 240 }]);
    const result = await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    assert.equal(result.mismatch.length, 1);
    const handled = result.mismatch[0].handled;
    assert.equal(handled.by, 'Quản Lý A');
    assert.ok(!Number.isNaN(Date.parse(handled.at)));
    assert.equal(result.assignment.status, 'picking');
    const after = await mismatchOf(service);
    assert.deepEqual(after.map(({ handled: _handled, ...rest }) => rest), [{ productCode: 'AAA1', picked: 250, ordered: 240 }]);
    assert.equal(after[0].handled.by, 'Quản Lý A');
    assert.equal(result.assignment.history.at(-1).action, 'mismatch_ack');
  } finally { await db.close(); }
});

test('acknowledgeMismatch: ack lan hai khi da handled la idempotent (khong them lich su)', async () => {
  const { db, service } = await lechOrder();
  try {
    await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    const second = await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    assert.equal(second.mismatch[0].handled.by, 'Quản Lý A');
    assert.equal(await historyCount(db, 'mismatch_ack'), 1);
  } finally { await db.close(); }
});

test('acknowledgeMismatch: Kiot sua tiep lam so lech doi -> handled mat (canh bao hien lai), ack lai duoc', async () => {
  const { db, service } = await lechOrder();
  try {
    await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    await db.query(`UPDATE order_details SET quantity = 230 WHERE branch = 'hanoi' AND order_id = 1 AND line_no = 1`);
    assert.deepEqual(await mismatchOf(service), [{ productCode: 'AAA1', picked: 250, ordered: 230 }]);
    const again = await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    assert.equal(again.mismatch[0].handled.by, 'Quản Lý A');
    assert.equal(await historyCount(db, 'mismatch_ack'), 2);
  } finally { await db.close(); }
});

test('acknowledgeMismatch: Kiot khop lai -> NO_MISMATCH 409; khong chi dinh / da huy -> INVALID_STATE 409', async () => {
  const { db, service, latest } = await lechOrder();
  try {
    await db.query(`UPDATE order_details SET quantity = 250 WHERE branch = 'hanoi' AND order_id = 1 AND line_no = 1`);
    await assert.rejects(() => service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' }), { statusCode: 409, code: 'NO_MISMATCH' });
    await assert.rejects(() => service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH404' }), { statusCode: 409, code: 'INVALID_STATE' });
    await service.cancel(ctx(), (await latest('DH001')).id, { version: 1 });
    await assert.rejects(() => service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' }), { statusCode: 409, code: 'INVALID_STATE' });
    assert.equal(await historyCount(db, 'mismatch_ack'), 0);
  } finally { await db.close(); }
});

test('acknowledgeMismatch: don Da boc cung ack duoc', async () => {
  const { db, service, latest } = await lechOrder();
  try {
    await service.confirm(ctx(), (await latest('DH001')).id, { version: 1 });
    const result = await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    assert.equal(result.assignment.status, 'confirmed');
    assert.equal(result.mismatch[0].handled.by, 'Quản Lý A');
    assert.equal((await mismatchOf(service))[0].handled.by, 'Quản Lý A');
  } finally { await db.close(); }
});

test('acknowledgeMismatch: chi dinh moi (reassign) thi ack cu khong con hieu luc', async () => {
  const { db, service } = await lechOrder();
  try {
    await service.acknowledgeMismatch(ctx(), { branch: 'HN', orderCode: 'DH001' });
    // Chi dinh lai cung so lech 250 vs 240: la chi dinh moi nen phai ack lai.
    await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }], { reassign: true, version: 1 }));
    assert.deepEqual(await mismatchOf(service), [{ productCode: 'AAA1', picked: 250, ordered: 240 }]);
  } finally { await db.close(); }
});

test('trừ tồn theo đơn: người sửa = mã đơn (người bấm tay lẫn job Kiot), tên người bấm nằm trong summary', async () => {
  const { db, service } = await fixture({ orders: { DH001: order(), DH002: order({ orderCode: 'DH002', lines: [lineOf('BBB2', 20)] }) } });
  try {
    await addKiotOrder(db, { code: 'DH002', status: 'Hoàn thành', id: 2, lines: [{ productCode: 'BBB2', quantity: 20 }] });
    const manual = (await service.assign(ctx(), body([{ productCode: 'AAA1', positionId: 1, qty: 250 }]))).assignment;
    await service.confirm(ctx(), manual.id, { version: 1 });
    await service.assign(ctx(), { branch: 'HN', orderCode: 'DH002', allocations: [{ productCode: 'BBB2', positionId: 3, qty: 20 }] });
    await service.reconcileWithKiot();
    const log = (await db.query(`SELECT position_id, actor_name, summary FROM stock_position_history WHERE action = 'pick' ORDER BY id`)).rows;
    assert.deepEqual(log.map(r => [Number(r.position_id), r.actor_name, r.summary.confirmedBy]), [[1, 'DH001', 'Quản Lý A'], [3, 'DH002', '']]);
    const updated = (await db.query(`SELECT updated_by_name FROM stock_positions WHERE id IN (1, 3) ORDER BY id`)).rows.map(r => r.updated_by_name);
    assert.deepEqual(updated, ['DH001', 'DH002']);
    const orderLog = (await db.query(`SELECT order_code, actor_name FROM order_pick_history WHERE action = 'confirm' ORDER BY id`)).rows;
    assert.deepEqual(orderLog.map(r => [r.order_code, r.actor_name]), [['DH001', 'Quản Lý A'], ['DH002', 'Hệ thống (KiotViet)']]);
  } finally { await db.close(); }
});


test('Kiot seller phones match ID and retailer, cache concurrent pages and retry after failure',async()=>{
 let calls=0,time=0;
 const lookup=kiotData.createSellerPhoneLookup({now:()=>time,getBranches:()=>[{branch:'hanoi'},{branch:'saigon'}],createClient:config=>({fetchAllPages:async(endpoint,query,onPage)=>{
  calls++;assert.equal(endpoint,'users');await onPage([{id:7,mobilePhone:config.branch==='hanoi'?'0901111111':'0902222222'},{id:8,mobilePhone:''}]);
 }})});
 assert.deepEqual(await Promise.all([lookup('hanoi',7),lookup('hanoi',7)]),['0901111111','0901111111']);
 assert.equal(calls,1);assert.equal(await lookup('saigon',7),'0902222222');assert.equal(await lookup('hanoi',8),'');
 assert.equal(await lookup('hanoi',999),'');assert.equal(await lookup('unknown',7),'');
 time=301000;assert.equal(await lookup('hanoi',7),'0901111111');assert.equal(calls,3);
 let fail=true,attempts=0;
 const retry=kiotData.createSellerPhoneLookup({now:()=>time,getBranches:()=>[{branch:'hanoi'}],createClient:()=>({fetchAllPages:async(e,q,cb)=>{attempts++;if(fail)throw new Error('API unavailable');await cb([{id:7,mobilePhone:'0903333333'}]);}})});
 assert.equal(await retry('hanoi',7),'');assert.equal(await retry('hanoi',7),'');assert.equal(attempts,1);
 fail=false;time+=31000;assert.equal(await retry('hanoi',7),'0903333333');
});
