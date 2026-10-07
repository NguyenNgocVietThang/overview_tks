'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sql = require('./businessMonthlySql');
const { seed } = require('./testFixtures');

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
