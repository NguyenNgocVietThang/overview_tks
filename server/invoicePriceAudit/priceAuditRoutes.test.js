'use strict';

// HTTP /api/invoice-price-audit qua express that: requireFeature THAT, quyen giai lai moi request,
// requireAuth gia doc tai khoan tu "kho" (sua kho = Quan ly doi quyen) theo header x-user.

const test = require('node:test');
const assert = require('node:assert/strict');
process.env.JWT_SECRET ||= 'fixture';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';
const express = require('express');
const { resolvePermissions } = require('../auth/featureRegistry');
const { createPriceAuditRouter } = require('./priceAuditRoutes');
const { createPriceAuditService } = require('./priceAuditService');
const { captureUnseenInvoices, createPriceAuditRepository } = require('./priceAuditRepository');
const { HN_NOTE, newDb, product, customer, invoice, pgliteAsPool } = require('./priceAuditFixtures');

const NOW = new Date('2026-10-20T16:00:00Z');

function makeApp({ service, users }) {
  const requireAuth = (req, res, next) => {
    const stored = users[req.headers['x-user']];
    if (!stored) return res.status(401).json({ error: 'Chưa đăng nhập.' });
    req.user = { ...stored, permissions: resolvePermissions(stored) };
    return next();
  };
  const resolveBranch = (req, res, next) => { req.branch = decodeURIComponent(req.headers['x-branch'] || '') || 'Cả hai'; next(); };
  const app = express();
  app.use(express.json());
  app.use('/api/invoice-price-audit', createPriceAuditRouter({ service, requireAuth, resolveBranch }));
  return app;
}

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/invoice-price-audit`;
  try { return await fn(base); } finally { await new Promise(resolve => server.close(resolve)); }
}

const call = async (base, path, { user, method = 'GET', body, branch } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (user) headers['x-user'] = user;
  if (branch) headers['x-branch'] = encodeURIComponent(branch);
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
};

async function setup() {
  const db = await newDb({ syncedAt: NOW });
  await product(db, 'hanoi', 1, 'T100', 'Ly giu nhiet', HN_NOTE);
  await customer(db, 'hanoi', 1, 'Khach Vua', { groups: 'Duy Thái' });
  await product(db, 'saigon', 9, 'T100', 'Ly SG', 'T100 # 1T-30000');
  await customer(db, 'saigon', 9, 'Khach SG', { groups: 'Minh Anh' });
  await invoice(db, { id: 1, customerId: 1, purchaseDate: '2026-10-19 08:00:00+00',
    lines: [{ productId: 1, code: 'T100', name: 'Ly', qty: 100, price: 23000 }, { productId: 1, code: 'T100', name: 'Ly', qty: 1, price: 24000 }] });
  await invoice(db, { branch: 'saigon', id: 3, customerId: 9, purchaseDate: '2026-10-18 08:00:00+00',
    lines: [{ productId: 9, code: 'T100', name: 'Ly SG', qty: 2, price: 29000 }] });
  await db.transaction(tx => captureUnseenInvoices({ day: '2026-10-20', client: tx, now: NOW }));
  await db.query(`INSERT INTO invoice_price_audit_state (id, published_day, window_from, window_to, last_success_at)
    VALUES (TRUE, '2026-10-20', '2026-10-14', '2026-10-20', $1)`, [NOW]);
  const users = {
    ql: { id: 'ql', vaiTro: 'Quản lý', hoTen: 'Quản Lý A', featurePermissions: {} },
    tl: { id: 'tl', vaiTro: 'Trợ lý', hoTen: 'Trợ Lý', featurePermissions: {} },
    sale: { id: 'sale', vaiTro: 'Nhân viên sale', hoTen: 'Duy Thái', featurePermissions: {} },
    sale2: { id: 'sale2', vaiTro: 'Nhân viên sale', hoTen: 'Duy Thai', featurePermissions: {} },
    kt: { id: 'kt', vaiTro: 'Kế toán', hoTen: 'Kế Toán', featurePermissions: {} }
  };
  const service = createPriceAuditService({ repository: createPriceAuditRepository({ pool: pgliteAsPool(db) }) });
  return { db, users, app: makeApp({ service, users }) };
}

test('GET /: 401 chua dang nhap, 403 thieu quyen, no-store, pham vi co so tu cookie, query sai 400', async () => {
  const { db, users, app } = await setup();
  try {
    await withServer(app, async base => {
      assert.equal((await call(base, '/')).status, 401);
      const kt = await call(base, '/', { user: 'kt' });
      assert.equal(kt.status, 403);
      const ok = await call(base, '/', { user: 'sale' });
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get('cache-control'), 'no-store');
      assert.equal(ok.body.totalRows, 3);
      assert.deepEqual(Object.keys(ok.body).sort(), ['filters', 'kpis', 'meta', 'page', 'pageSize', 'rows', 'totalRows', 'totals']);
      assert.ok(ok.body.rows.every(r => !('currentSaleGroup' in r)));
      assert.equal((await call(base, '/', { user: 'sale', branch: 'Sài Gòn' })).body.totalRows, 1);
      assert.equal((await call(base, '/', { user: 'sale', branch: 'Hà Nội' })).body.totalRows, 2);
      assert.equal((await call(base, '/?status=nope', { user: 'sale' })).status, 400);
      assert.equal((await call(base, '/?from=2026-10-01', { user: 'sale' })).status, 400);
      // Thu hoi quyen xem: co hieu luc ngay request ke tiep.
      users.sale.featurePermissions = { 'reports.invoices.priceAudit': false };
      assert.equal((await call(base, '/', { user: 'sale' })).status, 403);
      // Nguoi duoc cap rieng (Ke toan) xem duoc.
      users.kt.featurePermissions = { 'reports.invoices': true, 'reports.invoices.priceAudit': true };
      assert.equal((await call(base, '/', { user: 'kt' })).status, 200);
    });
  } finally { await db.close(); }
});

test('PATCH explanation: sale khac nhom sua duoc va ghi ten moi nhat; thieu quyen 403; version cu 409', async () => {
  const { db, users, app } = await setup();
  try {
    await withServer(app, async base => {
      const path = '/hanoi/1/1/explanation';
      assert.equal((await call(base, path, { method: 'PATCH', body: { text: 'a', expectedVersion: 1 } })).status, 401);
      const ok = await call(base, path, { user: 'sale', method: 'PATCH', body: { text: 'Khách quen', expectedVersion: 1 } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.row.saleExplanation, 'Khách quen');
      assert.equal(ok.body.row.version, 2);
      const other = await call(base, path, { user: 'sale2', method: 'PATCH', body: { text: 'b', expectedVersion: 2 } });
      assert.equal(other.status, 200);
      assert.equal(other.body.row.explanationBy, users.sale2.hoTen);
      assert.equal(other.body.row.version, 3);
      assert.equal((await call(base, path, { user: 'ql', method: 'PATCH', body: { text: 'b', expectedVersion: 2 } })).status, 403);
      assert.equal((await call(base, path, { user: 'kt', method: 'PATCH', body: { text: 'b', expectedVersion: 2 } })).status, 403);
      const stale = await call(base, path, { user: 'sale', method: 'PATCH', body: { text: 'c', expectedVersion: 1 } });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.code, 'VERSION_CONFLICT');
      assert.equal(stale.body.row.saleExplanation, 'b');
      assert.equal((await call(base, path, { user: 'sale', method: 'PATCH', body: { text: 'c', expectedVersion: 2, originalAmount: '0' } })).status, 400);
      assert.equal((await call(base, '/hanoi/abc/1/explanation', { user: 'sale', method: 'PATCH', body: { text: 'c', expectedVersion: 2 } })).status, 400);
      users.sale.featurePermissions = { 'reports.invoices.priceAudit.explain': false };
      assert.equal((await call(base, path, { user: 'sale', method: 'PATCH', body: { text: 'd', expectedVersion: 2 } })).status, 403);
    });
  } finally { await db.close(); }
});

test('PATCH decision: Quan ly va nguoi duoc cap rieng; Tro ly 403; Ok tra row + KPI theo bo loc query; 400 dong dung goc; 404', async () => {
  const { db, users, app } = await setup();
  try {
    await withServer(app, async base => {
      assert.equal((await call(base, '/hanoi/1/1/decision', { user: 'tl', method: 'PATCH', body: { decision: 'ok', expectedVersion: 1 } })).status, 403);
      const ok = await call(base, '/hanoi/1/1/decision?status=wrong', { user: 'ql', method: 'PATCH', body: { decision: 'ok', expectedVersion: 1 } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.row.effectiveStatus, 'correct');
      assert.equal(ok.body.row.effectiveAmount, '0');
      assert.equal(ok.body.totalRows, 1);
      assert.equal(ok.body.kpis.wrongLines, 1);
      users.tl.featurePermissions = { 'reports.invoices.priceAudit.decide': true };
      const pen = await call(base, '/saigon/3/1/decision', { user: 'tl', method: 'PATCH', body: { decision: 'penalty', expectedVersion: 1 } });
      assert.equal(pen.status, 200);
      assert.equal(pen.body.row.effectiveAmount, '2000');
      assert.equal((await call(base, '/hanoi/1/2/decision', { user: 'ql', method: 'PATCH', body: { decision: 'penalty', expectedVersion: 1 } })).status, 400);
      assert.equal((await call(base, '/hanoi/1/1/decision', { user: 'ql', method: 'PATCH', body: { decision: 'x', expectedVersion: 2 } })).status, 400);
      assert.equal((await call(base, '/hanoi/99/1/decision', { user: 'ql', method: 'PATCH', body: { decision: 'ok', expectedVersion: 1 } })).status, 404);
      users.ql.featurePermissions = { 'reports.invoices.priceAudit.decide': false };
      assert.equal((await call(base, '/hanoi/1/1/decision', { user: 'ql', method: 'PATCH', body: { decision: null, expectedVersion: 2 } })).status, 403);
    });
  } finally { await db.close(); }
});

test('Loi DB that -> 503 thong diep chung, khong lo chi tiet', async () => {
  const boom = Object.assign(new Error('password authentication failed for postgres'), { code: '28P01' });
  const service = { getReport: async () => { throw boom; } };
  const app = makeApp({ service, users: { ql: { id: 'ql', vaiTro: 'Quản lý', hoTen: 'QL', featurePermissions: {} } } });
  const original = console.error; console.error = () => {};
  try {
    await withServer(app, async base => {
      const res = await call(base, '/', { user: 'ql' });
      assert.equal(res.status, 503);
      assert.doesNotMatch(JSON.stringify(res.body), /password|postgres/);
    });
  } finally { console.error = original; }
});
