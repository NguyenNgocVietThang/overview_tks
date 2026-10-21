'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const registry = require('../auth/featureRegistry');
const { ROLES } = require('../auth/userRepository');
const { createVatRequestService } = require('./service');
const { parseStockCsv, parseMappingCsv, defaultStockConfig } = require('./stockSource');

const MIGRATIONS = ['0018_product_report.sql', '0053_product_containers.sql', '0076_vat_requests.sql'];

function poolFor(db) {
  const query = (sql, params) => db.query(sql, params);
  return { query, connect: async () => ({ query, release() {} }) };
}

async function fixture({ stock } = {}) {
  const db = new PGlite();
  for (const file of MIGRATIONS) await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', file), 'utf8'));
  await db.exec(`INSERT INTO product_report(product_code, product_name) VALUES ('014XOAN', 'Bát inox 2 lớp XOẮN 14cm'), ('26DAQUAN', 'Đồng hồ treo tường DẠ QUANG')`);
  const stockSource = { get: async () => { if (!stock) throw new Error('Sheet không còn chia sẻ công khai'); return stock; } };
  const service = createVatRequestService({ pool: poolFor(db), stockSource, now: () => new Date('2026-10-20T03:00:00Z') });
  return { db, service };
}

function user(id, vaiTro, extra = {}) {
  const base = { id, username: id, hoTen: `Tên ${id}`, email: `${id}@x.vn`, vaiTro, trangThai: 'Đang hoạt động', ...extra };
  return { ...base, permissions: registry.resolvePermissions(base) };
}
const SALE = user('sale-1', ROLES.NHAN_VIEN_SALE);
const SALE2 = user('sale-2', ROLES.NHAN_VIEN_SALE);
const KT = user('kt-1', ROLES.KE_TOAN, { featurePermissions: { 'accounting.vatRequestProcess': true } });
const KT_UNGRANTED = user('kt-2', ROLES.KE_TOAN);
const QL = user('ql-1', ROLES.QUAN_LY);

const NEW_REQUEST = { customerName: 'KH A Thắng Thanh Trì', productCode: '014xoan', quantity: 400, unitPrice: 11400, fullVat: true, saleNote: '' };

async function setStatus(db, id, status) {
  await db.query('UPDATE vat_requests SET status = $2, version = version + 1 WHERE id = $1', [id, status]);
  const { rows } = await db.query('SELECT version FROM vat_requests WHERE id = $1', [id]);
  return rows[0].version;
}

test('sale tao yeu cau: he thong gan nguoi tao, status pending, version 1, ma SP chuan theo product_report', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    assert.equal(row.createdBy, 'sale-1');
    assert.equal(row.createdByName, 'Tên sale-1');
    assert.equal(row.status, 'pending');
    assert.equal(row.version, 1);
    assert.equal(row.productCode, '014XOAN');
    assert.equal(row.productName, 'Bát inox 2 lớp XOẮN 14cm');
    assert.equal(row.totalAmount, 4560000);
    assert.equal(row.fullVat, true);
    assert.equal(row.isLockedForSale, false);
    assert.equal(row.canEditSale, true);
    const history = await service.history(SALE, row.id);
    assert.deepEqual(history.map(h => h.action), ['create']);
  } finally { await db.close(); }
});

test('payload co created_by / status / truong la khi tao -> 403, khong tao dong nao', async () => {
  const { db, service } = await fixture();
  try {
    await assert.rejects(service.create(SALE, { ...NEW_REQUEST, createdBy: 'kt-1' }), { statusCode: 403, code: 'FIELD_FORBIDDEN' });
    await assert.rejects(service.create(SALE, { ...NEW_REQUEST, status: '1' }), { statusCode: 403, code: 'FIELD_FORBIDDEN' });
    await assert.rejects(service.create(SALE, { ...NEW_REQUEST, quantity: 0 }), { statusCode: 400 });
    await assert.rejects(service.create(SALE, { ...NEW_REQUEST, quantity: 1.5 }), { statusCode: 400 });
    await assert.rejects(service.create(SALE, { ...NEW_REQUEST, productCode: 'KHONGCO' }), { statusCode: 400, code: 'PRODUCT_NOT_FOUND' });
    await assert.rejects(service.create(SALE, { productCode: '014XOAN', quantity: 1, unitPrice: 1 }), { statusCode: 400 });
    const { rows } = await db.query('SELECT count(*)::int AS n FROM vat_requests');
    assert.equal(rows[0].n, 0);
  } finally { await db.close(); }
});

test('sale sua yeu cau cua sale khac -> 403', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    await assert.rejects(service.update(SALE2, row.id, { version: 1, quantity: 10 }), { statusCode: 403, code: 'NOT_OWNER' });
    await assert.rejects(service.remove(SALE2, row.id, 1), { statusCode: 403, code: 'NOT_OWNER' });
  } finally { await db.close(); }
});

test('sale bi khoa o 0/1/2, sua duoc o pending/3/4; sua o 3/4 tu ve pending', async () => {
  const { db, service } = await fixture();
  try {
    for (const status of ['0', '1', '2']) {
      const row = await service.create(SALE, NEW_REQUEST);
      const version = await setStatus(db, row.id, status);
      const viewed = await service.get(SALE, row.id);
      assert.equal(viewed.isLockedForSale, true);
      assert.equal(viewed.canEditSale, false);
      await assert.rejects(service.update(SALE, row.id, { version, quantity: 10 }), { statusCode: 403, code: 'LOCKED' }, status);
      await assert.rejects(service.remove(SALE, row.id, version), { statusCode: 403, code: 'LOCKED' }, status);
    }
    const pending = await service.create(SALE, NEW_REQUEST);
    const updated = await service.update(SALE, pending.id, { version: 1, quantity: 500, saleNote: 'gấp' });
    assert.equal(updated.quantity, 500);
    assert.equal(updated.status, 'pending');
    assert.equal(updated.version, 2);
    for (const status of ['3', '4']) {
      const row = await service.create(SALE, NEW_REQUEST);
      const version = await setStatus(db, row.id, status);
      const result = await service.update(SALE, row.id, { version, quantity: 450 });
      assert.equal(result.status, 'pending', status);
      const history = await service.history(SALE, row.id);
      const statusChange = history.find(h => h.field === 'status');
      assert.deepEqual([statusChange.oldValue, statusChange.newValue], [status, 'pending']);
    }
  } finally { await db.close(); }
});

test('gui lai dung gia tri cu khong tang version, khong ve pending', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    const version = await setStatus(db, row.id, '3');
    const result = await service.update(SALE, row.id, { version, quantity: '400', unitPrice: 11400, customerName: ' KH A Thắng Thanh Trì ' });
    assert.equal(result.status, '3');
    assert.equal(result.version, version);
  } finally { await db.close(); }
});

test('KT khong sua truong cua sale; sua ghi chu KT khi da khoa; lui 1 -> 3 mo khoa cho sale', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    await assert.rejects(service.update(KT, row.id, { version: 1, quantity: 1 }), { statusCode: 403 });
    await assert.rejects(service.update(KT, row.id, { version: 1, unitPrice: 1 }), { statusCode: 403 });
    await assert.rejects(service.update(SALE, row.id, { version: 1, status: '1' }), { statusCode: 403, code: 'FEATURE_FORBIDDEN' });
    await assert.rejects(service.update(SALE, row.id, { version: 1, accountantNote: 'x' }), { statusCode: 403, code: 'FEATURE_FORBIDDEN' });
    await assert.rejects(service.update(KT, row.id, { version: 1, createdBy: 'kt-1' }), { statusCode: 403, code: 'FIELD_FORBIDDEN' });
    await assert.rejects(service.update(KT, row.id, { version: 1, status: '9' }), { statusCode: 400 });

    const done = await service.update(KT, row.id, { version: 1, status: '1', accountantNote: 'CONT 10-6V', arrivalDate: '2026-10-25' });
    assert.equal(done.status, '1');
    assert.equal(done.arrivalDate, '2026-10-25');
    const noted = await service.update(KT, row.id, { version: done.version, accountantNote: 'CONT 10-7G' });
    assert.equal(noted.accountantNote, 'CONT 10-7G');
    assert.equal(noted.status, '1');

    const reopened = await service.update(KT, row.id, { version: noted.version, status: '3' });
    assert.equal((await service.get(SALE, row.id)).canEditSale, true);
    const saleEdit = await service.update(SALE, row.id, { version: reopened.version, quantity: 300 });
    assert.equal(saleEdit.status, 'pending');
  } finally { await db.close(); }
});

test('Ke toan chua duoc cap quyen chi xem, khong xu ly tung dong hay hang loat', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    const listed = await service.list(KT_UNGRANTED);
    assert.equal(listed.rows.length, 1);
    assert.equal(listed.viewer.canProcess, false);
    assert.equal(listed.rows[0].canProcess, false);
    for (const changes of [{ status: '1' }, { accountantNote: 'Đã duyệt' }, { arrivalDate: '2026-10-25' }]) {
      await assert.rejects(service.update(KT_UNGRANTED, row.id, { version: 1, ...changes }), { statusCode: 403, code: 'FEATURE_FORBIDDEN' });
    }
    await assert.rejects(service.bulkUpdate(KT_UNGRANTED, { items: [{ id: row.id, version: 1 }], changes: { status: '1' } }), { statusCode: 403, code: 'FEATURE_FORBIDDEN' });
    assert.equal((await service.get(SALE, row.id)).status, 'pending');
    assert.equal((await service.get(KT, row.id)).canProcess, true);
  } finally { await db.close(); }
});

test('Quan ly sua duoc truong sale cua yeu cau da khoa va xu ly trang thai', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    const version = await setStatus(db, row.id, '1');
    const result = await service.update(QL, row.id, { version, quantity: 999, status: '2' });
    assert.equal(result.quantity, 999);
    assert.equal(result.status, '2');
  } finally { await db.close(); }
});

test('hai nguoi luu cung version: nguoi sau nhan 409 kem du lieu moi nhat', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    await service.update(KT, row.id, { version: 1, status: '1' });
    await assert.rejects(service.update(SALE, row.id, { version: 1, quantity: 10 }), error => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'VERSION_CONFLICT');
      assert.equal(error.latest.status, '1');
      assert.equal(error.latest.version, 2);
      return true;
    });
    await assert.rejects(service.update(SALE, row.id, { quantity: 10 }), { statusCode: 400, code: 'VERSION_REQUIRED' });
    const { rows } = await db.query('SELECT quantity FROM vat_requests WHERE id = $1', [row.id]);
    assert.equal(Number(rows[0].quantity), 400);
  } finally { await db.close(); }
});

test('lich su ghi dung gia tri cu va moi cho tung truong; bang lich su khong sua duoc', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    await service.update(SALE, row.id, { version: 1, quantity: 500, fullVat: false, productCode: '26DAQUAN' });
    const history = await service.history(SALE, row.id);
    const byField = Object.fromEntries(history.filter(h => h.field).map(h => [h.field, [h.oldValue, h.newValue]]));
    assert.deepEqual(byField, {
      quantity: ['400', '500'],
      full_vat: ['true', 'false'],
      product_code: ['014XOAN', '26DAQUAN']
    });
    assert.equal(history[0].changedBy, 'sale-1');
    const after = await service.get(SALE, row.id);
    assert.equal(after.productName, 'Đồng hồ treo tường DẠ QUANG');
    await assert.rejects(db.query('UPDATE vat_request_history SET new_value = $1', ['x']), /immutable/);
  } finally { await db.close(); }
});

test('xoa mem: an khoi danh sach, ghi lich su', async () => {
  const { db, service } = await fixture();
  try {
    const row = await service.create(SALE, NEW_REQUEST);
    await service.remove(SALE, row.id, 1);
    assert.equal((await service.list(SALE)).rows.length, 0);
    const { rows } = await db.query('SELECT is_deleted FROM vat_requests WHERE id = $1', [row.id]);
    assert.equal(rows[0].is_deleted, true);
    await assert.rejects(service.get(SALE, row.id), { statusCode: 404 });
  } finally { await db.close(); }
});

test('P chi cong yeu cau cung ma o 3/4; Q/R tu CONT chua ve; O tu sheet ton theo Khop ma', async () => {
  const config = defaultStockConfig();
  const stockCsv = 'CTY,Mã kiot đại diện,Tên,MÃ VAT KIOT,TÊN VAT,Tên hàng,ĐVT,x,TỒN ĐẦU NGÀY\n'
    + 'TKS THẤP,014XOAN,,VAT1,,,Cái,,"1,200"\nVC,,,VAT1,,,Cái,,300\nSHC,26DAQUAN,,VAT2,,,Cái,,50\n';
  const mappingCsv = 'CHECK TỒN BÊN SHEET VAT\nMã SP,Tên SP,,,,,,,,Mã vat kiot\n014xoan,Bát,,,,,,,,VAT1\n';
  const stock = { ...parseStockCsv(stockCsv, config), vatByProduct: parseMappingCsv(mappingCsv, config), loadedAt: Date.now() };
  const { db, service } = await fixture({ stock });
  try {
    for (const status of ['pending', '0', '1', '2', '3', '4']) {
      const row = await service.create(SALE, { ...NEW_REQUEST, quantity: 100 });
      if (status !== 'pending') await setStatus(db, row.id, status);
    }
    await db.exec(`INSERT INTO product_container_lines(sheet_name,sheet_order,container_row,source_row,product_code,product_key,container_name,status,status_label,quantity,eta)
      VALUES ('YIWU',0,1,2,'014XOAN','014xoan','CONT A',1,'1',100,'DK 14-16/11'),
             ('YIWU',0,3,4,'014XOAN','014xoan','CONT B',3,'3',50,'DK 28/10'),
             ('SD',1,1,2,'014XOAN','014xoan','CONT C',4,'4',999,'DK 1/10')`);
    const data = await service.list(KT);
    const m = data.metrics['014xoan'];
    assert.equal(m.pendingInsertQty, 200);
    assert.equal(m.incomingQty, 150);
    assert.equal(m.nearestArrivalDate, '2026-10-28');
    assert.equal(m.vatStock.total, 1500);
    assert.deepEqual(m.vatStock.byCompany.map(c => c.company), ['TKS THẤP', 'VC']);
    assert.equal(data.stockStatus.available, true);

    const metrics = await service.productMetrics('26daquan');
    assert.equal(metrics.productCode, '26DAQUAN');
    assert.equal(metrics.vatStock.total, 50, 'khong co trong Khop ma -> tra theo Mã kiot đại diện');
    assert.equal(metrics.incomingQty, 0);
    assert.equal(metrics.nearestArrivalDate, null);
  } finally { await db.close(); }
});

test('sheet ton loi: van tra danh sach, O = null, bao trang thai nguon', async () => {
  const { db, service } = await fixture();
  try {
    await service.create(SALE, NEW_REQUEST);
    const data = await service.list(SALE);
    assert.equal(data.rows.length, 1);
    assert.equal(data.metrics['014xoan'].vatStock, null);
    assert.equal(data.stockStatus.available, false);
  } finally { await db.close(); }
});

test('sale xem duoc toan bo bang (chi doc dong cua nguoi khac); loc theo trang thai / nguoi tao / tu khoa', async () => {
  const { db, service } = await fixture();
  try {
    const mine = await service.create(SALE, NEW_REQUEST);
    const other = await service.create(SALE2, { ...NEW_REQUEST, productCode: '26DAQUAN', customerName: 'Tưởng hà đông' });
    await setStatus(db, other.id, '3');
    const all = await service.list(SALE);
    assert.equal(all.rows.length, 2);
    const otherRow = all.rows.find(r => r.id === other.id);
    assert.equal(otherRow.canEditSale, false);
    assert.equal(otherRow.isMine, false);
    assert.equal(all.rows.find(r => r.id === mine.id).canEditSale, true);
    assert.equal(all.viewer.canProcess, false);
    assert.deepEqual(all.sales.map(s => s.id).sort(), ['sale-1', 'sale-2']);
    assert.deepEqual((await service.list(SALE, { statuses: ['3', '4'] })).rows.map(r => r.id), [other.id]);
    assert.deepEqual((await service.list(SALE, { createdBy: 'sale-1' })).rows.map(r => r.id), [mine.id]);
    assert.deepEqual((await service.list(SALE, { q: 'tưởng' })).rows.map(r => r.id), [other.id]);
  } finally { await db.close(); }
});

test('xuat Excel: chi KT co quyen xu ly va quan ly; dung bo loc nhu list', async () => {
  const { db, service } = await fixture();
  try {
    const mine = await service.create(SALE, NEW_REQUEST);
    const other = await service.create(SALE2, { ...NEW_REQUEST, productCode: '26DAQUAN' });
    await setStatus(db, other.id, '3');
    await assert.rejects(service.exportList(SALE), { statusCode: 403, code: 'FEATURE_FORBIDDEN' });
    await assert.rejects(service.exportList(KT_UNGRANTED), { statusCode: 403 });
    assert.deepEqual((await service.exportList(KT, { statuses: ['3'] })).rows.map(r => r.id), [other.id]);
    assert.deepEqual((await service.exportList(QL)).rows.map(r => r.id).sort(), [mine.id, other.id].sort());
  } finally { await db.close(); }
});

test('KT doi trang thai hang loat; 1 dong lech version -> huy ca lo', async () => {
  const { db, service } = await fixture();
  try {
    const a = await service.create(SALE, NEW_REQUEST);
    const b = await service.create(SALE2, NEW_REQUEST);
    await assert.rejects(service.bulkUpdate(SALE, { items: [{ id: a.id, version: 1 }], changes: { status: '2' } }), { statusCode: 403 });
    await assert.rejects(service.bulkUpdate(KT, { items: [{ id: a.id, version: 1 }], changes: { quantity: 1 } }), { statusCode: 403, code: 'FIELD_FORBIDDEN' });
    const result = await service.bulkUpdate(KT, { items: [{ id: a.id, version: 1 }, { id: b.id, version: 1 }], changes: { status: '2', accountantNote: 'CONT 10-7G' } });
    assert.equal(result.updated, 2);
    assert.deepEqual((await service.list(KT)).rows.map(r => [r.status, r.accountantNote]), [['2', 'CONT 10-7G'], ['2', 'CONT 10-7G']]);
    await assert.rejects(service.bulkUpdate(KT, { items: [{ id: a.id, version: 2 }, { id: b.id, version: 1 }], changes: { status: '1' } }), error => {
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.conflictIds, [b.id]);
      return true;
    });
    assert.equal((await service.get(KT, a.id)).status, '2', 'ca lo bi huy');
  } finally { await db.close(); }
});

test('goi y san pham theo ma / ten, uu tien khop dau ma', async () => {
  const { db, service } = await fixture();
  try {
    assert.deepEqual((await service.suggestProducts('xoan')).map(r => r.code), ['014XOAN']);
    assert.deepEqual((await service.suggestProducts('đồng hồ')).map(r => r.code), ['26DAQUAN']);
    assert.deepEqual(await service.suggestProducts('  '), []);
  } finally { await db.close(); }
});

test('form nhieu dong: gui 1 lan tao nhieu yeu cau, moi dong 1 khach / 1 ma, ghi lich su tung yeu cau', async () => {
  const { db, service } = await fixture();
  try {
    const result = await service.createMany(SALE, { submissionId: 'sub-1', items: [
      { ...NEW_REQUEST },
      { customerName: 'Tưởng hà đông', productCode: '26daquan', quantity: 280, unitPrice: 37870, fullVat: false, saleNote: 'gấp' }
    ] });
    assert.equal(result.created, 2);
    assert.equal(result.duplicate, false);
    const rows = (await service.list(SALE)).rows;
    assert.deepEqual(rows.map(r => [r.productCode, r.customerName, r.status, r.createdBy]).sort(),
      [['014XOAN', 'KH A Thắng Thanh Trì', 'pending', 'sale-1'], ['26DAQUAN', 'Tưởng hà đông', 'pending', 'sale-1']]);
    const { rows: history } = await db.query("SELECT count(*)::int AS n FROM vat_request_history WHERE action = 'create'");
    assert.equal(history[0].n, 2);
  } finally { await db.close(); }
});

test('form nhieu dong: 1 dong loi -> 400 kem loi theo tung dong, khong ghi dong nao', async () => {
  const { db, service } = await fixture();
  try {
    await assert.rejects(service.createMany(SALE, { submissionId: 'sub-2', items: [
      { ...NEW_REQUEST },
      { ...NEW_REQUEST, productCode: 'KHONGCO' },
      { ...NEW_REQUEST, quantity: 0, customerName: '' },
      { ...NEW_REQUEST, status: '1' },
      { customerName: 'KH E', productCode: '014XOAN', quantity: 1, unitPrice: 1000 }
    ] }), error => {
      assert.equal(error.statusCode, 400);
      assert.equal(error.code, 'BATCH_INVALID');
      assert.deepEqual(error.errors.map(e => [e.row, e.field]), [[2, 'productCode'], [3, 'customerName'], [3, 'quantity'], [4, 'status'], [5, 'fullVat']]);
      assert.match(error.errors[4].message, /chưa chọn Full VAT/);
      assert.match(error.message, /4 dòng chưa hợp lệ/);
      return true;
    });
    const { rows } = await db.query('SELECT count(*)::int AS n FROM vat_requests');
    assert.equal(rows[0].n, 0);
    await assert.rejects(service.createMany(SALE, { submissionId: 'x', items: [] }), { statusCode: 400 });
    await assert.rejects(service.createMany(SALE, { submissionId: 'x', items: Array.from({ length: 201 }, () => NEW_REQUEST) }), { statusCode: 400 });
    await assert.rejects(service.createMany(SALE, { items: [NEW_REQUEST] }), { statusCode: 400 });
  } finally { await db.close(); }
});

test('form nhieu dong: gui lai cung submissionId khong tao trung; loi thi cho gui lai', async () => {
  const { db, service } = await fixture();
  try {
    await assert.rejects(service.createMany(SALE, { submissionId: 'retry', items: [{ ...NEW_REQUEST, productCode: 'KHONGCO' }] }), { statusCode: 400 });
    const first = await service.createMany(SALE, { submissionId: 'retry', items: [NEW_REQUEST, NEW_REQUEST] });
    const [again, parallel] = await Promise.all([
      service.createMany(SALE, { submissionId: 'retry', items: [NEW_REQUEST, NEW_REQUEST] }),
      service.createMany(SALE, { submissionId: 'retry', items: [NEW_REQUEST, NEW_REQUEST] })
    ]);
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.ids, first.ids);
    assert.deepEqual(parallel.ids, first.ids);
    const other = await service.createMany(SALE2, { submissionId: 'retry', items: [NEW_REQUEST] });
    assert.equal(other.duplicate, false, 'ma lan gui tach theo tai khoan');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM vat_requests');
    assert.equal(rows[0].n, 3);
  } finally { await db.close(); }
});

test('tra nhieu ma cung luc: ten SP, so lieu va gia VAT gan nhat; ma khong co -> found=false', async () => {
  const { db, service } = await fixture();
  try {
    await service.createMany(SALE, { submissionId: 's', items: [{ ...NEW_REQUEST, unitPrice: 12000 }] });
    const { results } = await service.lookupProducts(['014XOAN', ' 26daquan ', 'KHONGCO']);
    assert.equal(results['014xoan'].productName, 'Bát inox 2 lớp XOẮN 14cm');
    assert.equal(results['014xoan'].latestOrder.price, 12000);
    assert.equal(results['014xoan'].pendingInsertQty, 0);
    assert.equal(results['26daquan'].found, true);
    assert.equal(results['26daquan'].latestOrder, null);
    assert.deepEqual(results.khongco, { found: false });
  } finally { await db.close(); }
});
