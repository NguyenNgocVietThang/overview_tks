'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeClient } = require('./entityTestUtils');
const entity = require('./products');
test('products maps verified fields and preserves raw JSON', async () => {
  const item = { Id: 1, Code: 'SP1', Name: 'Tea', CategoryId: 2, BasePrice: 12000, Unit: 'box', IsActive: true, CreatedDate: 'c', ModifiedDate: 'm' };
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', [item]);
  const upsert = client.calls.find((call) => /ON CONFLICT \(branch, id\) DO UPDATE/.test(call[0]));
  assert.deepEqual(upsert[1], ['hanoi', 1, 'SP1', 'Tea', 2, 12000, 'box', true, 'c', 'm', item]);
});

test('KiotViet dung lai ma cua san pham cu (id khac): doi ma dong cu truoc khi upsert, tranh vi pham UNIQUE (branch, code)', async () => {
  const items = [{ Id: 99, Code: 'KCCK16', Name: 'Moi' }, { Id: 100, Code: 'SP2', Name: 'Khac' }];
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', items);
  const [release, ...upserts] = client.calls;
  assert.match(release[0], /^\s*UPDATE products/);
  assert.deepEqual(release[1], ['hanoi', ['KCCK16', 'SP2'], ['99', '100']]);
  assert.equal(upserts.length, 2);
  assert.ok(upserts.every((call) => /ON CONFLICT \(branch, id\)/.test(call[0])));
});

test('trang rong khong goi query nao', async () => {
  const client = fakeClient();
  await entity.upsertPage(client, 'hanoi', []);
  await entity.reconcilePage(client, 'hanoi', []);
  assert.equal(client.calls.length, 0);
});

test('products khai bao doi soat day du moi 24 gio theo co che chung voi customers', () => {
  assert.equal(entity.reconcileMarkerKey, 'productsReconciledAt');
  assert.equal(entity.reconcileIntervalMs, 24 * 60 * 60 * 1000);
  assert.equal(entity.snapshotLabel, 'product');
  assert.equal(entity.incrementalParam, 'lastModifiedFrom');
});

// ---- Doi soat day du: SQL that tren PGlite (schema that 0001 + base_price NUMERIC cua 0012) ----
async function productDb(t) {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../../db/migrations/0001_core_master_data.sql'), 'utf8'));
  await db.exec('ALTER TABLE products ALTER COLUMN base_price TYPE NUMERIC USING base_price::numeric');
  return db;
}
const apiItem = (id, extra = {}) => ({
  Id: id, Code: `SP${id}`, Name: `Hang ${id}`, CategoryId: 5, BasePrice: 125537.84, Unit: 'hop', IsActive: true,
  CreatedDate: '2026-01-01T00:00:00', ModifiedDate: '2026-01-02T00:00:00', description: 'T1 # 1T-100',
  inventories: [{ branchId: 1, onHand: 5, cost: 10 }], ...extra
});
const rowOf = async (db, branch, id) => (await db.query('SELECT * FROM products WHERE branch=$1 AND id=$2', [branch, id])).rows[0];
const OLD = '2020-01-01T00:00:00Z';

test('doi soat day du: ghi lai dong doi Mo ta nhung GIU inventories do productOnHands vua va, bo qua dong khong doi', async t => {
  const db = await productDb(t);
  await entity.upsertPage(db, 'hanoi', [apiItem(1), apiItem(2)]);
  // productOnHands vua va ton kho moi cua id 1 (/products tra ban cu).
  await db.query(`UPDATE products SET raw = jsonb_set(raw, '{inventories}', '[{"branchId":1,"onHand":99,"cost":10}]') WHERE id = 1`);
  await db.query('UPDATE products SET synced_at = $1', [OLD]);
  await entity.reconcilePage(db, 'hanoi', [apiItem(1, { description: 'T1 # 1T-200 | VAT+8', Name: 'Hang 1 moi' }), apiItem(2)]);
  const changed = await rowOf(db, 'hanoi', 1);
  assert.equal(changed.raw.description, 'T1 # 1T-200 | VAT+8');
  assert.equal(changed.name, 'Hang 1 moi');
  assert.deepEqual(changed.raw.inventories, [{ branchId: 1, onHand: 99, cost: 10 }], 'khong ghi de ton kho bang ban /products cu');
  assert.ok(changed.synced_at > new Date(OLD));
  const same = await rowOf(db, 'hanoi', 2);
  assert.equal(same.synced_at.toISOString(), new Date(OLD).toISOString(), 'dong khong doi khong bi ghi (tranh WAL no-op)');
  assert.equal(Number(same.base_price), 125537.84);
});

test('doi soat day du: doi rieng Mo ta (modifiedDate khong doi) van ghi; doi duy nhat inventories thi KHONG ghi', async t => {
  const db = await productDb(t);
  await entity.upsertPage(db, 'hanoi', [apiItem(1), apiItem(2)]);
  await db.query('UPDATE products SET synced_at = $1', [OLD]);
  await entity.reconcilePage(db, 'hanoi', [
    apiItem(1, { description: 'T2 # 2T-300' }),                        // chi doi Mo ta
    apiItem(2, { inventories: [{ branchId: 1, onHand: 0, cost: 77 }] }) // chi doi inventories (do productOnHands lo)
  ]);
  assert.equal((await rowOf(db, 'hanoi', 1)).raw.description, 'T2 # 2T-300');
  const untouched = await rowOf(db, 'hanoi', 2);
  assert.equal(untouched.synced_at.toISOString(), new Date(OLD).toISOString());
  assert.deepEqual(untouched.raw.inventories, [{ branchId: 1, onHand: 5, cost: 10 }]);
});

test('doi soat day du: chen dong moi kem inventories tu API, dong thieu inventories nhan inventories tu API, khong dong nao bi nhan doi', async t => {
  const db = await productDb(t);
  await db.query(`INSERT INTO products(branch,id,code,name,raw) VALUES ('hanoi',3,'SP3','Hang 3','{}')`);
  await entity.reconcilePage(db, 'hanoi', [apiItem(3), apiItem(4)]);
  assert.deepEqual((await rowOf(db, 'hanoi', 3)).raw.inventories, [{ branchId: 1, onHand: 5, cost: 10 }]);
  const created = await rowOf(db, 'hanoi', 4);
  assert.equal(created.code, 'SP4');
  assert.equal(created.is_active, true);
  assert.deepEqual(created.raw.inventories, [{ branchId: 1, onHand: 5, cost: 10 }]);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM products')).rows[0].n, 2);
  await entity.reconcilePage(db, 'saigon', [apiItem(3)]);
  assert.equal((await db.query("SELECT COUNT(*)::int n FROM products WHERE id = 3")).rows[0].n, 2, 'khac co so la dong rieng');
});

test('doi soat day du: ma bi dung lai / hoan doi ma trong cung trang khong vi pham UNIQUE (branch, code)', async t => {
  const db = await productDb(t);
  await entity.upsertPage(db, 'hanoi', [apiItem(1, { Code: 'KCCK16' }), apiItem(5, { Code: 'DUP' })]);
  await entity.reconcilePage(db, 'hanoi', [apiItem(99, { Code: 'KCCK16' }), apiItem(1, { Code: 'KCCK16X' }), apiItem(6, { Code: 'DUP' })]);
  const codes = (await db.query("SELECT id, code FROM products WHERE branch='hanoi' ORDER BY id")).rows;
  assert.deepEqual(codes.map(r => [Number(r.id), r.code]), [[1, 'KCCK16X'], [5, 'DUP#5'], [6, 'DUP'], [99, 'KCCK16']]);
});

test('markMissing chi DANH DAU hang vang mat (is_active=false), khong xoa, bao ve dong moi hon va co so khac, hang xuat hien lai duoc khoi phuc', async t => {
  const db = await productDb(t);
  await entity.upsertPage(db, 'hanoi', [apiItem(1), apiItem(2), apiItem(3), apiItem(4, { IsActive: false })]);
  await entity.upsertPage(db, 'saigon', [apiItem(2)]);
  await db.query("UPDATE products SET synced_at = $1 WHERE id IN (1, 2, 4)", [OLD]);
  await db.query("UPDATE products SET synced_at = '2026-10-16T00:00:00Z' WHERE branch = 'hanoi' AND id = 3"); // poll tang dan ghi sau khi quet bat dau
  await entity.markMissing(db, 'hanoi', ['1'], '2026-10-15T00:00:00Z');
  const rows = (await db.query("SELECT branch, id, is_active, raw FROM products ORDER BY branch, id")).rows;
  const by = (branch, id) => rows.find(r => r.branch === branch && Number(r.id) === id);
  assert.equal(rows.length, 5, 'khong xoa vat ly');
  assert.equal(by('hanoi', 1).is_active, true);
  assert.equal(by('hanoi', 2).is_active, false);
  assert.equal(by('hanoi', 2).raw.isActive, false);
  assert.ok(by('hanoi', 2).raw.sourceMissingAt);
  assert.equal(by('hanoi', 3).is_active, true, 'dong ghi sau moc quet duoc bao ve');
  assert.equal((await rowOf(db, 'hanoi', 4)).synced_at.toISOString(), new Date(OLD).toISOString(), 'hang da ngung kinh doanh khong bi ghi lai');
  assert.equal(by('saigon', 2).is_active, true, 'co so khac khong bi anh huong');
  await entity.reconcilePage(db, 'hanoi', [apiItem(2)]);
  const back = await rowOf(db, 'hanoi', 2);
  assert.equal(back.is_active, true);
  assert.equal(back.raw.sourceMissingAt, undefined);
  await assert.rejects(entity.markMissing(db, 'hanoi', [], '2026-10-15T00:00:00Z'), /Empty product snapshot/);
});
