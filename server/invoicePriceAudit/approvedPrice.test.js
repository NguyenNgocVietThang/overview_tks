'use strict';

// Bang "Gia duyet" (migration 0091) tren PGlite voi schema THAT: migration, quy tac dau vao, repository (tao / sua / xoa,
// ten theo Kiot, tinh lai Kiem tra gia ban), ap gia duyet khi chup hoa don, va HTTP qua express that.

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'fixture';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ExcelJS = require('exceljs');
const { resolvePermissions } = require('../auth/featureRegistry');
const rules = require('./approvedPriceRules');
const { createApprovedPriceRepository } = require('./approvedPriceRepository');
const { createApprovedPriceRouter } = require('./approvedPriceRoutes');
const { runDailyAudit } = require('./priceAuditRefresh');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');

const at23 = day => new Date(`${day}T16:00:00Z`);
const quiet = { error() {}, info() {}, warn() {}, log() {} };
const NOW = at23('2026-10-20');

// Hoa don 1 dong T100 x 10 gia 23700 (HN_NOTE: cap Vua min 24000 => SAI, chenh 300/chiec = 3.000).
async function setup() {
  const db = await newDb();
  await product(db, 'hanoi', 1, 'T100', 'Ly giu nhiet', HN_NOTE);
  await product(db, 'hanoi', 2, 'T200', 'Binh nuoc', 'T200 # 1T-50000');
  await customer(db, 'hanoi', 1, 'Khach Vua', { groups: 'Duy Thái' });
  await customer(db, 'hanoi', 2, 'Khach Ngung', { isActive: 'false' });
  await customer(db, 'saigon', 9, 'Khach SG');
  await product(db, 'saigon', 9, 'T100', 'Ly SG', 'T100 # 1T-30000');
  return db;
}
async function addInvoice(db, id, purchaseDate, price = 23700, customerId = 1) {
  await invoice(db, { id, purchaseDate, customerId, lines: [{ productId: 1, code: 'T100', name: 'Ly', qty: 10, price }] });
}
const line = async (db, id = 1) => (await db.query(
  'SELECT original_status, minimum_unit_price::text AS min, original_amount::text AS amount, winning_source, reason, calculation FROM invoice_price_audit_lines WHERE invoice_id = $1', [id])).rows[0];
const valid = (over = {}) => ({ branch: 'hanoi', customerId: '1', productId: '1', approvedPrice: '23500', approver: 'Anh Quân', approvedOn: '2026-10-19', ...over });

test('migration 0091: chay lai an toan, unique, CHECK gia > 0, nhat ky bat bien', async () => {
  const db = await setup();
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0091_invoice_approved_prices.sql'), 'utf8');
    await db.exec(sql); // lan 2
    const repo = createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW });
    await repo.create(valid(), 'QL');
    await assert.rejects(repo.create(valid(), 'QL'), e => e.statusCode === 409 && e.code === 'DUPLICATE');
    await assert.rejects(db.query("INSERT INTO invoice_approved_prices (branch,customer_id,product_id,approved_price,approver,approved_on,created_by,updated_by) VALUES ('hanoi',1,1,0,'x','2026-10-19','a','a')"));
    await assert.rejects(db.query("UPDATE invoice_approved_price_changes SET actor = 'x'"), /immutable/);
    await assert.rejects(db.query('DELETE FROM invoice_approved_price_changes'), /immutable/);
  } finally { await db.close(); }
});

test('rules: gia / ngay / nguoi duyet / co so / khoa sort chi nhan gia tri hop le', () => {
  assert.equal(rules.parsePrice(23500), '23500');
  assert.equal(rules.parsePrice('023500.50'), '23500.50');
  for (const bad of [0, '0', -1, '', null, undefined, 'abc', '1e3', '1,000', '1.23456', true, Infinity]) {
    assert.throws(() => rules.parsePrice(bad), e => e.code === 'INVALID_PRICE', String(bad));
  }
  assert.ok(rules.isValidDay('2026-10-19'));
  assert.ok(!rules.isValidDay('2026-02-30'));
  assert.ok(!rules.isValidDay('19/10/2026'));
  assert.throws(() => rules.parseCreate(valid({ approver: 'Anh Ba' })), e => e.code === 'INVALID_APPROVER');
  assert.throws(() => rules.parseCreate(valid({ branch: 'both' })), e => e.code === 'INVALID_BRANCH');
  assert.throws(() => rules.parseCreate(valid({ customerId: 'x' })), e => e.code === 'INVALID_ID');
  assert.throws(() => rules.parseCreate(valid({ approvedOn: '2026-13-01' })), e => e.code === 'INVALID_DATE');
  assert.throws(() => rules.parseCreate({ ...valid(), extra: 1 }), e => e.statusCode === 400);
  assert.throws(() => rules.parseUpdate(valid()), e => /expectedVersion/.test(e.message));
  assert.equal(rules.parseUpdate({ ...valid(), expectedVersion: 2 }).expectedVersion, 2);
  assert.throws(() => rules.parseListQuery({ sort: 'id; DROP TABLE x' }), e => e.code === 'INVALID_SORT');
  assert.throws(() => rules.parseListQuery({ from: '2026-10-20', to: '2026-10-01' }), e => e.code === 'INVALID_RANGE');
  assert.deepEqual(rules.APPROVERS, ['Anh Quân', 'Anh Duy', 'Anh Duy Khánh']);
});

test('tao: khach / san pham khong co (hoac khach ngung hoat dong, sai co so) thi khong tao duoc', async () => {
  const db = await setup();
  try {
    const repo = createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW });
    await assert.rejects(repo.create(valid({ customerId: '999' }), 'QL'), e => e.statusCode === 422 && e.code === 'CUSTOMER_NOT_FOUND');
    await assert.rejects(repo.create(valid({ customerId: '2' }), 'QL'), e => e.code === 'CUSTOMER_NOT_FOUND');
    await assert.rejects(repo.create(valid({ customerId: '9' }), 'QL'), e => e.code === 'CUSTOMER_NOT_FOUND'); // KH SG o co so HN
    await assert.rejects(repo.create(valid({ productId: '999' }), 'QL'), e => e.statusCode === 422 && e.code === 'PRODUCT_NOT_FOUND');
    assert.equal((await repo.list(rules.parseListQuery({}))).totalRows, 0);
    const { row } = await repo.create(valid(), 'Quan Ly A');
    assert.equal(row.customerName, 'Khach Vua');
    assert.equal(row.productCode, 'T100');
    assert.equal(row.productName, 'Ly giu nhiet');
    assert.equal(row.branchLabel, 'Hà Nội');
    assert.equal(row.approvedPrice, '23500');
    assert.equal(row.version, 1);
    const log = (await db.query('SELECT action, actor, before_value, after_value FROM invoice_approved_price_changes')).rows;
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'create');
    assert.equal(log[0].after_value.approvedPrice, '23500');
  } finally { await db.close(); }
});

test('ten khach / ma + ten SP lay theo Kiot luc doc: Kiot doi ten thi bang cap nhat theo', async () => {
  const db = await setup();
  try {
    const repo = createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW });
    await repo.create(valid(), 'QL');
    await db.query("UPDATE customers SET name = 'Khach Vua (doi ten)', code = 'KH-MOI' WHERE branch = 'hanoi' AND id = 1");
    await db.query("UPDATE products SET name = 'Ly moi', code = 'T100X' WHERE branch = 'hanoi' AND id = 1");
    const { rows } = await repo.list(rules.parseListQuery({}));
    assert.equal(rows[0].customerName, 'Khach Vua (doi ten)');
    assert.equal(rows[0].customerCode, 'KH-MOI');
    assert.equal(rows[0].productCode, 'T100X');
    assert.equal(rows[0].productName, 'Ly moi');
  } finally { await db.close(); }
});

test('loc theo nguoi duyet / khoang ngay, sort moi cot hai chieu, phan trang va tie-break on dinh', async () => {
  const db = await setup();
  try {
    await customer(db, 'hanoi', 3, 'An Khach');
    await product(db, 'hanoi', 3, 'A001', 'Zeta', 'A001 # 1T-1000');
    const repo = createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW });
    await repo.create(valid({ approver: 'Anh Quân', approvedOn: '2026-10-10', approvedPrice: '100' }), 'QL');
    await repo.create(valid({ productId: '3', approver: 'Anh Duy', approvedOn: '2026-10-15', approvedPrice: '300' }), 'QL');
    await repo.create(valid({ customerId: '3', productId: '3', approver: 'Anh Duy Khánh', approvedOn: '2026-10-20', approvedPrice: '200' }), 'QL');
    await repo.create({ ...valid({ branch: 'saigon', customerId: '9', productId: '9', approver: 'Anh Duy', approvedOn: '2026-10-15', approvedPrice: '150' }) }, 'QL');
    const q = extra => rules.parseListQuery(extra);
    const ids = async extra => (await repo.list(q(extra))).rows.map(r => r.approvedPrice);
    assert.deepEqual(await ids({}), ['200', '150', '300', '100']); // mac dinh: ngay duyet moi nhat truoc, cung ngay -> id giam
    assert.equal((await repo.list(q({ approver: 'Anh Duy' }))).totalRows, 2);
    assert.deepEqual(await ids({ from: '2026-10-12', to: '2026-10-16' }), ['150', '300']);
    assert.deepEqual(await ids({ from: '2026-10-16' }), ['200']);
    assert.deepEqual(await ids({ sort: 'approvedPrice', dir: 'asc' }), ['100', '150', '200', '300']);
    assert.deepEqual(await ids({ sort: 'approvedPrice', dir: 'desc' }), ['300', '200', '150', '100']);
    assert.deepEqual((await repo.list(q({ sort: 'customerName' }))).rows[0].customerName, 'An Khach');
    assert.deepEqual((await repo.list(q({ sort: 'productName', dir: 'desc' }))).rows[0].productName, 'Zeta');
    assert.equal((await repo.list(q({ sort: 'productCode' }))).rows[0].productCode, 'A001');
    assert.equal((await repo.list(q({ sort: 'branch', dir: 'desc' }))).rows[0].branch, 'saigon');
    assert.equal((await repo.list(q({ sort: 'approver' }))).rows[0].approver, 'Anh Duy');
    assert.equal((await repo.list(q({ sort: 'approvedOn' }))).rows[0].approvedOn, '2026-10-10');
    const p1 = await repo.list(q({ pageSize: 3, page: 1 }));
    const p2 = await repo.list(q({ pageSize: 3, page: 2 }));
    assert.equal(p1.rows.length, 3);
    assert.equal(p2.rows.length, 1);
    assert.equal(p1.totalRows, 4);
    assert.equal((await repo.list(q({ approver: 'Anh Duy' }), { all: true })).rows.length, 2);
  } finally { await db.close(); }
});

test('ap gia duyet khi chup hoa don: thay gia toi thieu, hieu luc theo ngay duyet, lay ban moi nhat', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    const repo = createApprovedPriceRepository({ pool, now: () => NOW });
    // Khong co gia duyet: 23700 < 24000 => sai.
    await addInvoice(db, 1, '2026-10-18 10:00:00+00');
    await addInvoice(db, 2, '2026-10-20 10:00:00+00');
    await runDailyAudit({ day: '2026-10-20', pool, now: NOW, logger: quiet });
    assert.equal((await line(db, 1)).original_status, 'wrong');
    assert.equal((await line(db, 2)).original_status, 'wrong');

    // Gia duyet 23500 tu 19/10: hoa don 18/10 (truoc ngay duyet) khong doi; hoa don 20/10 thanh dung gia.
    const created = await repo.create(valid({ approvedPrice: '23500', approvedOn: '2026-10-19' }), 'QL');
    assert.equal(created.recalc.status, 'applied');
    assert.equal((await line(db, 1)).original_status, 'wrong');
    const l2 = await line(db, 2);
    assert.equal(l2.original_status, 'correct');
    assert.equal(l2.min, '23500');
    assert.equal(l2.winning_source, 'Giá duyệt');
    assert.equal(l2.reason, 'Theo giá duyệt');
    assert.equal(l2.calculation.approvedPrice.price, '23500');
    assert.equal(l2.calculation.approvedPrice.approvedOn, '2026-10-19');

    // Gia duyet moi hon 25000 tu 20/10 thay the ban cu: 23700 < 25000 => sai, chenh 1.300 x 10.
    await repo.create(valid({ approvedPrice: '25000', approvedOn: '2026-10-20' }), 'QL');
    const l2b = await line(db, 2);
    assert.equal(l2b.original_status, 'wrong');
    assert.equal(l2b.min, '25000');
    assert.equal(Number(l2b.amount), 13000);

    // Sua gia ve 23000 -> dung; xoa het -> tro lai tinh theo mo ta (sai).
    const second = (await repo.list(rules.parseListQuery({}))).rows[0];
    const upd = await repo.update(second.id, { ...valid({ approvedPrice: '23000', approvedOn: '2026-10-20' }), expectedVersion: second.version }, 'QL');
    assert.equal(upd.recalc.status, 'applied');
    assert.equal((await line(db, 2)).original_status, 'correct');
    const del = await repo.remove(second.id, upd.row.version, 'QL');
    assert.equal(del.recalc.status, 'applied');
    assert.equal((await line(db, 2)).min, '23500'); // quay lai ban 19/10
    await repo.remove(created.row.id, null, 'QL');
    const l2c = await line(db, 2);
    assert.equal(l2c.original_status, 'wrong');
    assert.equal(l2c.winning_source, 'HN');
    assert.equal(l2c.calculation.approvedPrice, null);
  } finally { await db.close(); }
});

test('gia duyet khong dong vao khach / san pham / co so khac; giu giai thich + Chot cua dong', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    const repo = createApprovedPriceRepository({ pool, now: () => NOW });
    await customer(db, 'hanoi', 3, 'Khach Khac');
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await addInvoice(db, 2, '2026-10-20 10:00:00+00', 23700, 3);
    await runDailyAudit({ day: '2026-10-20', pool, now: NOW, logger: quiet });
    await db.query("UPDATE invoice_price_audit_lines SET sale_explanation = 'ghi chu', decision = 'penalty', decided_by = 'QL', version = 4 WHERE invoice_id = 1");
    await repo.create(valid({ approvedPrice: '23000', approvedOn: '2026-10-20' }), 'QL');
    assert.equal((await line(db, 1)).original_status, 'correct');
    assert.equal((await line(db, 2)).original_status, 'wrong'); // khach khac khong bi anh huong
    const kept = (await db.query('SELECT sale_explanation, decision, version FROM invoice_price_audit_lines WHERE invoice_id = 1')).rows[0];
    assert.deepEqual([kept.sale_explanation, kept.decision, kept.version], ['ghi chu', 'penalty', 4]);
    // Gia duyet cua co so Sai Gon khong ap cho hoa don Ha Noi cung ma SP.
    await repo.create(valid({ branch: 'saigon', customerId: '9', productId: '9', approvedPrice: '1' }), 'QL');
    assert.equal((await line(db, 2)).original_status, 'wrong');
  } finally { await db.close(); }
});

test('sua: version lech -> 409 kem dong hien tai; chi doi nguoi duyet thi khong tinh lai; doi khach tinh lai ca hai', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    const repo = createApprovedPriceRepository({ pool, now: () => NOW });
    await customer(db, 'hanoi', 3, 'Khach Khac');
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await addInvoice(db, 2, '2026-10-20 10:00:00+00', 23700, 3);
    await runDailyAudit({ day: '2026-10-20', pool, now: NOW, logger: quiet });
    const { row } = await repo.create(valid({ approvedPrice: '23000', approvedOn: '2026-10-20' }), 'QL');
    await assert.rejects(repo.update(row.id, { ...valid({ approvedOn: '2026-10-20' }), expectedVersion: 7 }, 'QL'),
      e => e.statusCode === 409 && e.code === 'VERSION_CONFLICT' && e.row.id === row.id);
    await assert.rejects(repo.update('99999', { ...valid(), expectedVersion: 1 }, 'QL'), e => e.statusCode === 404);
    await assert.rejects(repo.update(row.id, { ...valid({ customerId: '999', approvedOn: '2026-10-20' }), expectedVersion: 1 }, 'QL'),
      e => e.code === 'CUSTOMER_NOT_FOUND');
    const same = await repo.update(row.id, { ...valid({ approvedPrice: '23000', approvedOn: '2026-10-20', approver: 'Anh Duy' }), expectedVersion: 1 }, 'QL');
    assert.equal(same.recalc.status, 'skipped');
    assert.equal(same.row.version, 2);
    assert.equal(same.row.approver, 'Anh Duy');
    // Doi sang khach 3: hoa don khach 1 tro lai sai, khach 3 thanh dung.
    const moved = await repo.update(row.id, { ...valid({ customerId: '3', approvedPrice: '23000', approvedOn: '2026-10-20' }), expectedVersion: 2 }, 'QL');
    assert.equal(moved.recalc.status, 'applied');
    assert.equal((await line(db, 1)).original_status, 'wrong');
    assert.equal((await line(db, 2)).original_status, 'correct');
    const actions = (await db.query('SELECT action FROM invoice_approved_price_changes ORDER BY id')).rows.map(r => r.action);
    assert.deepEqual(actions, ['create', 'update', 'update']);
    await assert.rejects(repo.remove(row.id, 1, 'QL'), e => e.statusCode === 409);
    await repo.remove(row.id, 3, 'QL');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_approved_prices')).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM invoice_approved_price_changes WHERE action = 'delete'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test('chua chay kiem tra gia lan nao: van luu gia duyet (recalc not_published); nguon loi -> luu van thanh cong, recalc failed', async () => {
  const db = await setup();
  const pool = pgliteAsPool(db);
  try {
    const repo = createApprovedPriceRepository({ pool, now: () => NOW });
    // Ngay duyet 21/10 (sau hoa don 20/10) nen chua ap cho hoa don nao.
    const first = await repo.create(valid({ approvedOn: '2026-10-21' }), 'QL');
    assert.equal(first.recalc.status, 'not_published');
    await addInvoice(db, 1, '2026-10-20 10:00:00+00');
    await runDailyAudit({ day: '2026-10-20', pool, now: NOW, logger: quiet });
    await db.query("DELETE FROM sheet_snapshot_sync WHERE source = 'shipping_measures'"); // nguon Can do chua san sang
    const second = await repo.create(valid({ approvedOn: '2026-10-20', approvedPrice: '22000' }), 'QL');
    assert.equal(second.recalc.status, 'failed');
    assert.match(second.recalc.message, /Cân đo|chưa/i);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_approved_prices')).rows[0].n, 2);
    assert.equal((await line(db, 1)).original_status, 'wrong'); // chua tinh lai
  } finally { await db.close(); }
});

test('goi y khach / san pham: loc gan dung bo dau theo co so, bo khach ngung hoat dong', async () => {
  const db = await setup();
  try {
    await customer(db, 'hanoi', 3, 'Nguyễn Văn Á');
    await product(db, 'hanoi', 3, 'ABC9', 'Bình giữ nhiệt', '');
    const repo = createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW });
    assert.deepEqual((await repo.suggestCustomers('hanoi', 'nguyen van a')).map(r => r.name), ['Nguyễn Văn Á']);
    assert.deepEqual((await repo.suggestCustomers('hanoi', 'khach')).map(r => r.name).sort(), ['Khach Vua']); // Khach Ngung bi loai
    assert.deepEqual((await repo.suggestCustomers('saigon', 'khach')).map(r => r.name), ['Khach SG']);
    const [p] = await repo.suggestProducts('hanoi', 'binh giu');
    assert.deepEqual([p.code, p.name, typeof p.id], ['ABC9', 'Bình giữ nhiệt', 'string']);
    assert.equal((await repo.suggestProducts('hanoi', 'abc9'))[0].code, 'ABC9');
    assert.deepEqual(await repo.suggestProducts('hanoi', 'khong-co'), []);
  } finally { await db.close(); }
});

// ---------------------------------------------------------------- HTTP

function makeApp({ repository, users }) {
  const requireAuth = (req, res, next) => {
    const stored = users[req.headers['x-user']];
    if (!stored) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    req.user = { ...stored, permissions: resolvePermissions(stored) };
    return next();
  };
  const app = express();
  app.use('/api/invoice-approved-prices', createApprovedPriceRouter({ repository, requireAuth }));
  return app;
}
async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/invoice-approved-prices`;
  try { return await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}
const call = async (base, p, { user, method = 'GET', body, raw } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (user) headers['x-user'] = user;
  const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};
const USERS = {
  ql: { id: 'ql', vaiTro: 'Quản lý', hoTen: 'Quản Lý A', featurePermissions: {} },
  tl: { id: 'tl', vaiTro: 'Trợ lý', hoTen: 'Trợ Lý', featurePermissions: {} },
  sale: { id: 'sale', vaiTro: 'Nhân viên sale', hoTen: 'Duy Thái', featurePermissions: {} },
  kt: { id: 'kt', vaiTro: 'Kế toán', hoTen: 'Kế Toán', featurePermissions: {} }
};

test('HTTP: quyen xem / tao-sua-xoa, no-store, tao 201, sua + xoa co xac nhan version, xuat Excel theo bo loc va sort', async () => {
  const db = await setup();
  try {
    const users = JSON.parse(JSON.stringify(USERS));
    const app = makeApp({ repository: createApprovedPriceRepository({ pool: pgliteAsPool(db), now: () => NOW }), users });
    await withServer(app, async base => {
      assert.equal((await call(base, '/')).status, 401);
      assert.equal((await call(base, '/', { user: 'kt' })).status, 403);
      const sale = await call(base, '/', { user: 'sale' });
      assert.equal(sale.status, 200);
      assert.equal(sale.headers.get('cache-control'), 'no-store');
      assert.equal(sale.body.canManage, false);
      assert.deepEqual(sale.body.options.approvers, ['Anh Quân', 'Anh Duy', 'Anh Duy Khánh']);
      // Sale / Tro ly chi xem: khong tao / sua / xoa / goi y.
      for (const u of ['sale', 'tl']) {
        assert.equal((await call(base, '/', { user: u, method: 'POST', body: valid() })).status, 403, u);
        assert.equal((await call(base, '/1', { user: u, method: 'PUT', body: { ...valid(), expectedVersion: 1 } })).status, 403, u);
        assert.equal((await call(base, '/1', { user: u, method: 'DELETE' })).status, 403, u);
        assert.equal((await call(base, '/customer-suggest?branch=hanoi&q=a', { user: u })).status, 403, u);
      }
      assert.equal((await call(base, '/', { user: 'ql' })).body.canManage, true);

      assert.equal((await call(base, '/', { user: 'ql', method: 'POST', body: valid({ customerId: '999' }) })).status, 422);
      assert.equal((await call(base, '/', { user: 'ql', method: 'POST', body: valid({ approver: 'Ai do' }) })).status, 400);
      const created = await call(base, '/', { user: 'ql', method: 'POST', body: valid() });
      assert.equal(created.status, 201);
      assert.equal(created.body.row.customerName, 'Khach Vua');
      assert.equal((await call(base, '/', { user: 'ql', method: 'POST', body: valid() })).status, 409);
      const id = created.body.row.id;
      assert.equal((await call(base, `/${id}`, { user: 'ql', method: 'PUT', body: { ...valid({ approvedPrice: 23600 }), expectedVersion: 5 } })).status, 409);
      const put = await call(base, `/${id}`, { user: 'ql', method: 'PUT', body: { ...valid({ approvedPrice: 23600 }), expectedVersion: 1 } });
      assert.equal(put.status, 200);
      assert.equal(put.body.row.approvedPrice, '23600');
      assert.equal(put.body.row.version, 2);
      assert.equal((await call(base, '/abc', { user: 'ql', method: 'DELETE' })).status, 400);

      const sug = await call(base, '/customer-suggest?branch=hanoi&q=khach', { user: 'ql' });
      assert.deepEqual(sug.body.results.map(r => r.name), ['Khach Vua']);
      assert.equal((await call(base, '/customer-suggest?branch=xx&q=a', { user: 'ql' })).status, 400);
      assert.equal((await call(base, '/product-suggest?branch=hanoi&q=T200', { user: 'ql' })).body.results[0].code, 'T200');

      // Loc + sort qua query; tham so sai -> 400.
      await call(base, '/', { user: 'ql', method: 'POST', body: valid({ productId: '2', approver: 'Anh Duy', approvedOn: '2026-10-21', approvedPrice: '50000' }) });
      const filtered = await call(base, '/?approver=Anh%20Duy&sort=approvedPrice&dir=desc', { user: 'sale' });
      assert.equal(filtered.body.totalRows, 1);
      assert.equal(filtered.body.rows[0].approvedPrice, '50000');
      assert.equal((await call(base, '/?sort=hack', { user: 'sale' })).status, 400);
      assert.equal((await call(base, '/?approver=Ai', { user: 'sale' })).status, 400);

      // Xuat Excel: can reports.export (Sale khong co), dung tap loc + thu tu sort.
      assert.equal((await call(base, '/export', { user: 'sale' })).status, 403);
      const xlsx = await call(base, '/export?sort=approvedPrice&dir=asc', { user: 'ql', raw: true });
      assert.equal(xlsx.status, 200);
      assert.match(xlsx.headers.get('content-disposition'), /TKS_Gia_duyet\.xlsx/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(xlsx.buffer);
      const sheet = wb.getWorksheet('Giá duyệt');
      assert.deepEqual(sheet.getRow(1).values.slice(1), ['Khách hàng', 'Cơ sở', 'Mã SP', 'Tên SP', 'Giá duyệt', 'Người duyệt', 'Ngày duyệt']);
      assert.equal(sheet.rowCount, 3);
      assert.deepEqual(sheet.getRow(2).values.slice(1), ['Khach Vua', 'Hà Nội', 'T100', 'Ly giu nhiet', 23600, 'Anh Quân', '19/10/2026']);
      assert.equal(sheet.getRow(3).getCell(5).value, 50000);
      const onlyDuy = await call(base, '/export?approver=Anh%20Duy', { user: 'ql', raw: true });
      const wb2 = new ExcelJS.Workbook();
      await wb2.xlsx.load(onlyDuy.buffer);
      assert.equal(wb2.getWorksheet('Giá duyệt').rowCount, 2);

      const del = await call(base, `/${id}?expectedVersion=2`, { user: 'ql', method: 'DELETE' });
      assert.equal(del.status, 200);
      assert.equal((await call(base, `/${id}`, { user: 'ql', method: 'DELETE' })).status, 404);
      // Thu hoi quyen co hieu luc ngay.
      users.ql.featurePermissions = { 'reports.invoices.priceAudit.approvedPrice': false };
      assert.equal((await call(base, '/', { user: 'ql', method: 'POST', body: valid() })).status, 403);
    });
  } finally { await db.close(); }
});
