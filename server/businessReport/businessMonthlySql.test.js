'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sql = require('./businessMonthlySql');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0036_business_monthly_sales.sql'), 'utf8');
const BASE = `
  CREATE TABLE customers(branch text, id bigint, code text, name text, raw jsonb);
  CREATE TABLE products(branch text, id bigint, code text, name text);
  CREATE TABLE invoices(branch text, id bigint, code text, purchase_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE invoice_details(branch text, invoice_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, discount numeric, raw jsonb);
  CREATE TABLE returns(branch text, id bigint, code text, return_date timestamptz, total numeric, status int, raw jsonb);
  CREATE TABLE return_details(branch text, return_id bigint, line_no int, product_id bigint, quantity numeric, price numeric, raw jsonb);`;

async function seed(db) {
  await db.exec(BASE + MIGRATION);
  await db.exec(`
    INSERT INTO customers VALUES
      ('hanoi', 1, 'KH1', 'Chị A', '{"groups":"Khang","comments":"Level 2"}'),
      ('saigon', 2, 'KH1', 'Anh B', '{"groups":"Trinh"}'),
      ('hanoi', 3, 'KH2', 'Cô C', '{}');
    INSERT INTO products VALUES ('hanoi', 10, 'SP1', 'Khay'), ('hanoi', 11, 'SP2', 'Bình');
    -- HD1 (HN, KH1, 30/09 23:00 gio VN): 2 dong 600+400 = 1000, giam ca don 100 => total 900
    INSERT INTO invoices VALUES ('hanoi', 101, 'HD1', '2026-09-30 23:00:00+00', 900, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1","customerName":"Chị A"}');
    INSERT INTO invoice_details VALUES
      ('hanoi', 101, 1, 10, 2, 300, 0, '{"productCode":"SP1","subTotal":600}'),
      ('hanoi', 101, 2, 11, 1, 400, 0, '{"productCode":"SP2","subTotal":400}');
    -- HD2 (01/10 00:30 gio VN) thuoc thang 10, khong duoc tinh vao thang 9
    INSERT INTO invoices VALUES ('hanoi', 102, 'HD2', '2026-10-01 00:30:00+00', 500, 1, '{"statusValue":"Hoàn thành","customerCode":"KH1"}');
    INSERT INTO invoice_details VALUES ('hanoi', 102, 1, 10, 1, 500, 0, '{"productCode":"SP1","subTotal":500}');
    -- HD3 da huy: bo qua; HD4 khong ma KH, khop theo ten "Cô C" => KH2
    INSERT INTO invoices VALUES ('hanoi', 103, 'HD3', '2026-09-10 10:00:00+00', 777, 2, '{"statusValue":"Đã hủy","customerCode":"KH1"}');
    INSERT INTO invoices VALUES ('hanoi', 104, 'HD4', '2026-09-11 10:00:00+00', 200, 1, '{"statusValue":"Hoàn thành","customerName":"Cô C"}');
    INSERT INTO invoice_details VALUES ('hanoi', 104, 1, 11, 1, 200, 0, '{"productCode":"SP2","subTotal":200}');
    -- Tra hang TH1 thang 9 cua KH1 HN: dong 100, giam gia tra 10 => total 90
    INSERT INTO returns VALUES ('hanoi', 201, 'TH1', '2026-09-15 09:00:00+00', 90, 1, '{"statusValue":"Đã trả","customerCode":"KH1"}');
    INSERT INTO return_details VALUES ('hanoi', 201, 1, 10, 1, 100, '{"productCode":"SP1","subTotal":100}');`);
}

test('doanh so khach thang 9: tong hoa don Hoan thanh - tong tra Da tra, khop ten khi thieu ma', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const { rows } = await db.query(sql.CUSTOMER_MONTH_SELECT_SQL + ' ORDER BY branch, customer_code',
      [sql.BRANCH_CODES, '2026-09-01', '2026-10-01']);
    assert.deepEqual(rows.map(r => [r.branch, r.customer_code, Number(r.net_revenue), Number(r.invoice_amount), Number(r.return_amount)]), [
      ['hanoi', 'KH1', 810, 900, 90],
      ['hanoi', 'KH2', 200, 200, 0]
    ]);
  } finally { await db.close(); }
});

test('khach x ma hang phan bo giam gia ca don, tong theo ma = tong theo khach', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const { rows } = await db.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL + ' ORDER BY customer_code, product_code',
      [sql.BRANCH_CODES, '2026-09-01', '2026-10-01']);
    // HD1: SP1 600*900/1000=540, SP2 360; TH1: SP1 -90; HD4: SP2 200
    assert.deepEqual(rows.map(r => [r.customer_code, r.product_code, Number(r.net_revenue), Number(r.net_qty)]), [
      ['KH1', 'SP1', 450, 1],
      ['KH1', 'SP2', 360, 1],
      ['KH2', 'SP2', 200, 1]
    ]);
  } finally { await db.close(); }
});

test('chot thang roi dung bang ma hang + bang sale theo nhom hien tai; doi nhom thi dung lai', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seed(db);
    const p = [sql.BRANCH_CODES, '2026-09-01', '2026-10-01'];
    await db.query(sql.FREEZE_CUSTOMER_SQL, p);
    await db.query(sql.FREEZE_CUSTOMER_PRODUCT_SQL, p);
    await db.query(sql.FREEZE_PRODUCT_SQL, ['2026-09-01']);
    await db.query(sql.REBUILD_SALE_SQL);
    const products = await db.query('SELECT product_code, net_revenue::float8 v FROM business_monthly_product_sales ORDER BY 1');
    assert.deepEqual(products.rows, [{ product_code: 'SP1', v: 450 }, { product_code: 'SP2', v: 560 }]);
    let sales = await db.query('SELECT sale_name, net_revenue::float8 v FROM business_monthly_sale_sales ORDER BY 1');
    assert.deepEqual(sales.rows, [{ sale_name: 'Chưa phân nhóm', v: 200 }, { sale_name: 'Khang', v: 810 }]);
    // Lan dung lai khong doi gi => 0 dong ghi
    const again = await db.query(sql.REBUILD_SALE_SQL);
    assert.deepEqual(again.rows[0], { upserted: 0, deleted: 0 });
    // KH1 HN chuyen sang nhom Trinh => toan bo lich su di theo
    await db.exec(`UPDATE customers SET raw = '{"groups":"Trinh"}' WHERE branch='hanoi' AND code='KH1'`);
    await db.query(sql.REBUILD_SALE_SQL);
    sales = await db.query('SELECT sale_name, net_revenue::float8 v FROM business_monthly_sale_sales ORDER BY 1');
    assert.deepEqual(sales.rows, [{ sale_name: 'Chưa phân nhóm', v: 200 }, { sale_name: 'Trinh', v: 810 }]);
  } finally { await db.close(); }
});
