'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { createDocumentsRepository } = require('./documentsRepository');

let db;
let repo;

const SCHEMA = `
CREATE TABLE invoices (branch text, id bigint, code text, purchase_date timestamptz, total numeric, status smallint, raw jsonb NOT NULL, PRIMARY KEY (branch, id), UNIQUE (branch, code));
CREATE TABLE invoice_details (branch text, invoice_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, discount numeric, raw jsonb NOT NULL, PRIMARY KEY (branch, invoice_id, line_no));
CREATE TABLE orders (branch text, id bigint, code text, order_date timestamptz, total numeric, status smallint, raw jsonb NOT NULL, PRIMARY KEY (branch, id), UNIQUE (branch, code));
CREATE TABLE order_details (branch text, order_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, discount numeric, raw jsonb NOT NULL, PRIMARY KEY (branch, order_id, line_no));
CREATE TABLE products (branch text, id bigint, code text, name text, PRIMARY KEY (branch, id));
CREATE TABLE sync_checkpoints (branch text, entity text, last_synced_at timestamptz);
`;

async function invoice(branch, id, code, date, raw, lines) {
  await db.query('INSERT INTO invoices VALUES ($1,$2,$3,$4,$5,1,$6)', [branch, id, code, date, 100, raw]);
  for (const [i, line] of lines.entries()) {
    await db.query('INSERT INTO invoice_details VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [branch, id, i, line.productId || null, line.q, line.p, line.d || 0, line.raw || {}]);
  }
}
async function order(branch, id, code, date, raw, lines) {
  await db.query('INSERT INTO orders VALUES ($1,$2,$3,$4,$5,1,$6)', [branch, id, code, date, 200, raw]);
  for (const [i, line] of lines.entries()) {
    await db.query('INSERT INTO order_details VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [branch, id, i, line.productId || null, line.q, line.p, line.d || 0, line.raw || {}]);
  }
}

test.before(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec("INSERT INTO products VALUES ('hanoi', 7, 'PCODE7', 'Tên từ products')");
  await db.exec("INSERT INTO sync_checkpoints VALUES ('hanoi','invoices','2026-10-16T10:00:00Z'),('hanoi','orders','2026-10-16T10:00:01Z'),('hanoi','cash_flows','2026-10-16T09:00:00Z')");
  // Gio trong DB = gio treo tuong VN mang nhan UTC.
  await invoice('hanoi', 1, 'HD028345', '2026-10-16T14:54:37Z',
    { statusValue: 'Hoàn thành', customerName: 'KH A PHƯƠNG THANH OAI', customerCode: 'KH005518', description: 'thắng thức 16/10', orderCode: 'DH044391' },
    [
      { q: 700, p: 33300, d: 800, raw: { productCode: 'B40OD5', productName: 'Ổ điện D42', subTotal: 22750000, note: 'ghi chú\tdòng' } },
      { q: 1800, p: 2300, raw: { productCode: 'TEJO42', productName: 'Móc quần áo', subTotal: 4140000 } }
    ]);
  await invoice('hanoi', 2, 'HD028346', '2026-10-16T14:56:48Z',
    { statusValue: 'Hoàn thành', customerName: 'KH C Huyền Thanh Trì', orderCode: 'DH044262' },
    [{ q: 1, p: 2640000, productId: 7, raw: { subTotal: 2640000 } }]);
  await invoice('hanoi', 3, 'HD000001', '2026-10-15T08:00:00Z', { statusValue: 'Đã hủy', customerName: 'Hủy' }, [{ q: 1, p: 1, raw: { productCode: 'X' } }]);
  await invoice('saigon', 4, 'HD028345', '2026-10-16T09:00:00Z', { statusValue: 'Hoàn thành', customerName: 'Khách SG' }, [{ q: 1, p: 1, raw: { productCode: 'Y' } }]);
  await invoice('hanoi', 5, 'HD000002', '2026-10-16T08:00:00Z', { statusValue: 'Hoàn thành', customerName: 'Rỗng' }, []);
  // Don dat hang: DH044391 da len HD028345; DH050000 cho xu ly; DH050001 da Hoan thanh; DH050002 da huy.
  await order('hanoi', 10, 'DH044391', '2026-10-16T10:00:00Z', { statusValue: 'Phiếu tạm', customerName: 'KH A' }, [{ q: 1, p: 1, raw: { productCode: 'Z' } }]);
  await order('hanoi', 11, 'DH050000', '2026-10-16T11:00:00Z', { statusValue: 'Phiếu tạm', customerName: 'Chị Lan Đống Đa', description: 'giao sáng mai' },
    [{ q: 10, p: 5000, d: 500, raw: { productCode: 'SP01', productName: 'Sản phẩm 1', subTotal: 0, note: 'màu xanh' } }]);
  await order('hanoi', 12, 'DH050001', '2026-10-16T12:00:00Z', { statusValue: 'Hoàn thành', customerName: 'Xong' }, [{ q: 1, p: 1, raw: { productCode: 'Q' } }]);
  await order('hanoi', 13, 'DH050002', '2026-10-16T12:00:00Z', { statusValue: 'Đã hủy', customerName: 'Hủy' }, [{ q: 1, p: 1, raw: { productCode: 'Q' } }]);
  repo = createDocumentsRepository({ query: (sql, params) => db.query(sql, params) });
});

test.after(async () => { await db.close(); });

test('resolveCodes: tim/thieu/trung 2 co so, canh bao don da xuat hoa don va chung tu huy', async () => {
  const result = await repo.resolveCodes({ branchCodes: ['hanoi', 'saigon'], codes: ['DH044391', 'HD028346', 'HD999999', 'HD028345', 'HD000001', 'DH050001'] });
  assert.deepEqual(result.found.map(f => [f.code, f.selectable, f.warning]), [
    ['DH044391', true, 'Đơn đã xuất hóa đơn: HD028345'],
    ['HD028346', true, ''],
    ['HD000001', false, 'Chứng từ đã hủy'],
    ['DH050001', true, 'Đơn đặt hàng đã Hoàn thành']
  ]);
  assert.deepEqual(result.notFound, ['HD999999']);
  assert.deepEqual(result.ambiguous.map(a => [a.code, a.matches.map(m => m.branch)]), [['HD028345', ['hanoi', 'saigon']]]);
  const onlyHn = await repo.resolveCodes({ branchCodes: ['hanoi'], codes: ['HD028345'] });
  assert.deepEqual(onlyHn.found.map(f => f.branch), ['hanoi']);
});

test('readDocumentLines: thu tu chon roi thu tu dong; Gia ban = don gia - giam gia; Thanh tien dung quy tac HD/DH', async () => {
  const docs = await repo.readDocumentLines([
    { kind: 'order', branch: 'hanoi', code: 'DH050000' },
    { kind: 'invoice', branch: 'hanoi', code: 'HD028345' },
    { kind: 'invoice', branch: 'hanoi', code: 'HD028346' }
  ]);
  assert.deepEqual(docs.map(d => [d.kind, d.code, d.docNote]), [
    ['order', 'DH050000', 'giao sáng mai'], ['invoice', 'HD028345', 'thắng thức 16/10'], ['invoice', 'HD028346', '']
  ]);
  assert.deepEqual(docs[0].lines, [{ productCode: 'SP01', productName: 'Sản phẩm 1', quantity: '10', unitPrice: '4500', lineTotal: '45000', note: 'màu xanh' }]);
  assert.deepEqual(docs[1].lines.map(l => [l.productCode, Number(l.quantity), Number(l.unitPrice), Number(l.lineTotal), l.note]), [
    ['B40OD5', 700, 32500, 22750000, 'ghi chú\tdòng'], ['TEJO42', 1800, 2300, 4140000, '']
  ]);
  assert.deepEqual([docs[2].lines[0].productCode, docs[2].lines[0].productName], ['PCODE7', 'Tên từ products']);
});

test('readDocumentLines: tu choi chung tu huy, rong, khong ton tai, trung ma 2 co so', async () => {
  await assert.rejects(repo.readDocumentLines([{ kind: 'invoice', branch: 'hanoi', code: 'HD000001' }]), /đã hủy/);
  await assert.rejects(repo.readDocumentLines([{ kind: 'invoice', branch: 'hanoi', code: 'HD000002' }]), /không có dòng hàng/);
  await assert.rejects(repo.readDocumentLines([{ kind: 'invoice', branch: 'hanoi', code: 'HD404' }]), /Không tìm thấy/);
  await assert.rejects(repo.readDocumentLines([
    { kind: 'invoice', branch: 'hanoi', code: 'HD028345' }, { kind: 'invoice', branch: 'saigon', code: 'HD028345' }
  ]), error => error.code === 'VAT_DRAFT_DUPLICATE_CODE');
  await assert.rejects(repo.readDocumentLines([]), /Chưa chọn/);
});

test('syncStatus chi lay invoices/orders', async () => {
  const rows = await repo.syncStatus();
  assert.deepEqual(rows.map(r => r.entity), ['invoices', 'orders']);
});
