'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const registry = require('../auth/featureRegistry');
const { ROLES } = require('../auth/userRepository');
const { createVatRequestService } = require('./service');
const { createSaleNotifier, startSaleNotifySchedule, formatDigest, TYPE, RELATED_TYPE } = require('./saleNotifier');

const BASE = ['0018_product_report.sql', '0053_product_containers.sql', '0076_vat_requests.sql', '0079_vat_request_sort_rank.sql'];
const MIN = 60 * 1000;

function user(id, vaiTro, extra = {}) {
  const base = { id, username: id, hoTen: `Tên ${id}`, email: `${id}@x.vn`, vaiTro, trangThai: 'Đang hoạt động', ...extra };
  return { ...base, permissions: registry.resolvePermissions(base) };
}
const SALE = user('sale-1', ROLES.NHAN_VIEN_SALE);
const SALE2 = user('sale-2', ROLES.NHAN_VIEN_SALE);
const KT = user('kt-1', ROLES.KE_TOAN, { featurePermissions: { 'accounting.vatRequestProcess': true } });
const NEW_REQUEST = { customerName: 'KH A', productCode: '014xoan', quantity: 400, unitPrice: 11400, fullVat: true, saleNote: '' };

async function fixture({ withNotice = true, users = { 'sale-1': SALE, 'sale-2': SALE2 } } = {}) {
  const db = new PGlite();
  for (const file of BASE) await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  await db.exec(`INSERT INTO product_report(product_code, product_name) VALUES ('014XOAN', 'Bát inox'), ('26DAQUAN', 'Đồng hồ')`);
  const query = (sql, params) => db.query(sql, params);
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const service = createVatRequestService({ pool, stockSource: { get: async () => { throw new Error('khong can'); } } });
  const applyNotice = () => db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', '0080_vat_request_notice_state.sql'), 'utf8'));
  if (withNotice) await applyNotice();
  const sent = [];
  let clock = Date.now();
  const notifier = createSaleNotifier({
    getPool: () => pool,
    notificationRepo: { createNotification: async payload => { if (users.__fail) throw new Error('disk full'); sent.push(payload); return payload; } },
    userStore: { getUserById: async id => users[id] || null },
    now: () => new Date(clock),
    log: () => {}
  });
  const at = minutes => { clock = Date.now() + minutes * MIN; };
  return { db, service, notifier, sent, at, applyNotice };
}

async function version(service, id) { return (await service.get(KT, id)).version; }

test('KT sua lien tuc: chi gui 1 thong bao khi da yen 10 phut, gia tri cuoi cung, gom moi yeu cau cua sale', async () => {
  const { db, service, notifier, sent, at } = await fixture();
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    const b = await service.create(SALE, { ...NEW_REQUEST, customerName: 'KH B', productCode: '26daquan' });
    await service.update(KT, a.id, { version: 1, status: '3' });
    await service.update(KT, a.id, { version: 2, status: '2', accountantNote: 'CONT 10-6V' });
    await service.bulkUpdate(KT, { items: [{ id: b.id, version: 1, changes: { arrivalDate: '2026-10-28' } }] });

    at(5);
    assert.deepEqual((await notifier.runOnce()).sent, [], 'moi 5 phut -> chua gui');
    assert.equal(sent.length, 0);
    at(11);
    const result = await notifier.runOnce();
    assert.deepEqual(result.sent, [{ saleId: 'sale-1', count: 2 }]);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].recipientUserId, 'sale-1');
    assert.equal(sent[0].type, TYPE);
    assert.equal(sent[0].relatedType, RELATED_TYPE);
    assert.equal(sent[0].title, 'Kế toán đã cập nhật 2 yêu cầu ORDER VAT');
    assert.equal(sent[0].message, 'KH A · 014XOAN: 2. Đã khai chờ về, note: CONT 10-6V\nKH B · 26DAQUAN: ngày về 28/10/2026');

    at(30);
    await notifier.runOnce();
    assert.equal(sent.length, 1, 'chay lai khong gui trung');

    // Dot moi: sua them sau khi da bao -> dong ho moi
    await service.update(KT, b.id, { version: await version(service, b.id), status: '1' });
    at(3);
    await notifier.runOnce();
    assert.equal(sent.length, 1);
    at(12);
    await notifier.runOnce();
    assert.equal(sent.length, 2);
    assert.equal(sent[1].message, 'KH B · 26DAQUAN: 1. Đã xong');
  } finally { await db.close(); }
});

test('sua roi hoan tac ve nhu cu: khong bao, con tro van tien; sale tu sua (tu ve pending) khong bao', async () => {
  const { db, service, notifier, sent, at } = await fixture();
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    await service.update(KT, a.id, { version: 1, accountantNote: 'tạm' });
    await service.update(KT, a.id, { version: 2, accountantNote: '' });
    at(11);
    assert.deepEqual((await notifier.runOnce()).sent, []);
    const { rows } = await db.query("SELECT last_history_id FROM vat_request_notice_state WHERE sale_id = 'sale-1'");
    assert.equal(rows.length, 1, 'con tro cua sale da tao');

    await service.update(KT, a.id, { version: 3, status: '3' });
    at(22);
    await notifier.runOnce();
    assert.equal(sent.length, 1);
    // Sale sua yeu cau o 3 -> tu ve pending: lan doi trang thai nay do sale lam -> khong bao
    await service.update(SALE, a.id, { version: await version(service, a.id), quantity: 10 });
    assert.equal((await service.get(SALE, a.id)).status, 'pending');
    at(40);
    await notifier.runOnce();
    assert.equal(sent.length, 1);
  } finally { await db.close(); }
});

test('2 sale -> 2 thong bao, moi sale 1 dong ho; sale ngung hoat dong / yeu cau khong gan sale -> khong gui', async () => {
  const users = { 'sale-1': SALE, 'sale-2': { ...SALE2, trangThai: 'Khóa' } };
  const { db, service, notifier, sent, at } = await fixture({ users });
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    const b = await service.create(SALE2, NEW_REQUEST);
    await db.exec(`INSERT INTO vat_requests (customer_name, product_code, product_name, is_legacy, legacy_row, status) VALUES ('KH cũ', '014XOAN', 'Bát', true, 99, 'pending')`);
    const { rows: [legacy] } = await db.query('SELECT id FROM vat_requests WHERE is_legacy');
    await service.update(KT, a.id, { version: 1, status: '1' });
    await service.update(KT, b.id, { version: 1, status: '1' });
    await service.update(KT, Number(legacy.id), { version: 1, status: '1' });
    at(11);
    const result = await notifier.runOnce();
    assert.deepEqual(result.sent, [{ saleId: 'sale-1', count: 1 }], 'sale-2 bi khoa, dong import khong co sale');
    assert.equal(sent.length, 1);

  } finally { await db.close(); }
});

test('moi sale 1 dong ho rieng: sale da yen thi gui, sale vua bi sua tiep thi cho (gio that, quietMs ngan)', async () => {
  const { db, service } = await fixture();
  try {
    const sent = [];
    const notifier = createSaleNotifier({
      getPool: () => ({ connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) }),
      notificationRepo: { createNotification: async payload => { sent.push(payload); } },
      userStore: { getUserById: async id => ({ 'sale-1': SALE, 'sale-2': SALE2 })[id] },
      quietMs: 400,
      log: () => {}
    });
    const a = await service.create(SALE, NEW_REQUEST);
    const b = await service.create(SALE2, NEW_REQUEST);
    await service.update(KT, b.id, { version: 1, status: '1' });
    await new Promise(resolve => setTimeout(resolve, 600));
    await service.update(KT, a.id, { version: 1, status: '1' });
    const result = await notifier.runOnce();
    assert.deepEqual(result.sent.map(s => s.saleId), ['sale-2']);
    assert.equal(result.waiting, 1, 'sale-1 vua bi sua -> cho');
    await new Promise(resolve => setTimeout(resolve, 600));
    assert.deepEqual((await notifier.runOnce()).sent.map(s => s.saleId), ['sale-1']);
  } finally { await db.close(); }
});

test('lich su truoc moc 0080 khong bi bao; KT sua yeu cau do chinh minh tao khong bao', async () => {
  const { db, service, notifier, sent, at, applyNotice } = await fixture({ withNotice: false, users: { 'sale-1': SALE, 'kt-1': KT } });
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    await service.update(KT, a.id, { version: 1, status: '1' });
    at(11);
    assert.deepEqual((await notifier.runOnce()).sent, [], 'chua ap 0080 -> bo qua, khong throw');
    await applyNotice();
    assert.deepEqual((await notifier.runOnce()).sent, [], 'sua truoc moc khong bao lai');
    const own = await service.create(KT, NEW_REQUEST);
    await service.update(KT, own.id, { version: 1, status: '1' });
    at(30);
    await notifier.runOnce();
    assert.equal(sent.length, 0);
  } finally { await db.close(); }
});

test('ghi chuong loi: khong throw, khong gui lai lan sau (khong trung)', async () => {
  const users = { 'sale-1': SALE, __fail: true };
  const { db, service, notifier, sent, at } = await fixture({ users });
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    await service.update(KT, a.id, { version: 1, status: '1' });
    at(11);
    assert.deepEqual((await notifier.runOnce()).sent, []);
    delete users.__fail;
    assert.deepEqual((await notifier.runOnce()).sent, []);
    assert.equal(sent.length, 0);
  } finally { await db.close(); }
});

test('formatDigest: nhan trang thai, ngay, xoa note / ngay, toi da 5 dong', () => {
  const change = (i, fields) => ({ request: { id: i, customer_name: `KH ${i}`, product_code: `SP${i}` }, fields });
  const { title, message } = formatDigest([
    change(1, [{ field: 'status', value: 'pending' }, { field: 'accountant_note', value: '' }]),
    change(2, [{ field: 'arrival_date', value: '' }]),
    ...[3, 4, 5, 6, 7].map(i => change(i, [{ field: 'status', value: '4' }]))
  ]);
  assert.equal(title, 'Kế toán đã cập nhật 7 yêu cầu ORDER VAT');
  const lines = message.split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], 'KH 1 · SP1: Chờ KT xử lý, (xóa note)');
  assert.equal(lines[1], 'KH 2 · SP2: (xóa ngày về)');
  assert.equal(lines[2], 'KH 3 · SP3: 4. Chờ cont về, tăng slg');
  assert.equal(lines[5], '… và 2 yêu cầu khác');
});

test('lich: chay ngay roi moi phut, khong chay chong luot', async () => {
  let calls = 0;
  let release;
  const notifier = { runOnce: () => { calls += 1; return new Promise(resolve => { release = resolve; }); } };
  let tick;
  const timer = startSaleNotifySchedule({ notifier, intervalMs: 60000, setIntervalFn: (fn, ms) => { assert.equal(ms, 60000); tick = fn; return { unref() {} }; }, scheduleImmediate: fn => fn() });
  assert.ok(timer);
  assert.equal(calls, 1);
  await tick();
  assert.equal(calls, 1, 'luot truoc chua xong -> bo qua');
  release();
  await new Promise(resolve => setImmediate(resolve));
  tick();
  assert.equal(calls, 2);
});
