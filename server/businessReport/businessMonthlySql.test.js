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

// Du lieu thang 8 de khoa hanh vi khop khach (ma > ten chuan hoa > ''), ranh gioi thang va
// phieu tra theo ten. Moi chung tu 1 dong SP1 co subTotal = total => doanh so ma hang = tong.
async function seedAugust(db) {
  await seed(db);
  const zw = '​';
  await db.exec(`
    INSERT INTO customers VALUES
      ('hanoi', 4, 'KH3', 'Nguyễn Văn Đức', '{}'),
      ('hanoi', 5, 'KH5', 'Trùng Tên', '{}'),
      ('hanoi', 6, 'KH4', 'Trùng Tên', '{}'),
      ('saigon', 7, 'KS1', 'Lê Thị Hoa', '{}');
    INSERT INTO invoices VALUES
      -- dau khung (00:00 ngay 1) duoc tinh; ten viet HOA + khoang trang + ky tu rong => KH3
      ('hanoi', 110, 'HD10', '2026-08-01 00:00:00+00', 100, 1, '{"statusValue":"Hoàn thành","customerName":"  NGUYỄN ${zw}  văn   ĐỨC "}'),
      -- ten trung 2 khach => ma lon nhat (KH5)
      ('hanoi', 111, 'HD11', '2026-08-20 10:00:00+00', 70, 1, '{"statusValue":"Hoàn thành","customerName":"trùng tên"}'),
      -- ten cua khach HN nhung hoa don SG => khong khop cheo co so => ''
      ('saigon', 112, 'HD12', '2026-08-10 10:00:00+00', 50, 1, '{"statusValue":"Hoàn thành","customerName":"Nguyễn Văn Đức"}'),
      -- khong ma, khong ten => Khach le, ma ''
      ('saigon', 113, 'HD13', '2026-08-11 10:00:00+00', 60, 1, '{"statusValue":"Hoàn thành"}'),
      -- cuoi khung (23:59:59 ngay cuoi) duoc tinh; co ma thi uu tien ma, bo qua ten
      ('hanoi', 114, 'HD14', '2026-08-31 23:59:59+00', 40, 1, '{"statusValue":"Hoàn thành","customerCode":"KH3","customerName":"Tên khác"}'),
      -- dung 00:00 ngay 1 thang sau / 23:59:59 ngay cuoi thang truoc: ngoai khung
      ('hanoi', 115, 'HD15', '2026-09-01 00:00:00+00', 1000, 1, '{"statusValue":"Hoàn thành","customerCode":"KH3"}'),
      ('hanoi', 116, 'HD16', '2026-07-31 23:59:59+00', 1000, 1, '{"statusValue":"Hoàn thành","customerCode":"KH3"}'),
      -- ma toan khoang trang => coi nhu khong ma, khop theo ten => KH5
      ('hanoi', 117, 'HD17', '2026-08-21 10:00:00+00', 20, 1, '{"statusValue":"Hoàn thành","customerCode":"  ","customerName":"Trùng  Tên"}'),
      ('saigon', 118, 'HD18', '2026-08-12 10:00:00+00', 80, 1, '{"statusValue":"Hoàn thành","customerName":"LÊ THỊ HOA"}');
    INSERT INTO invoice_details VALUES
      ('hanoi', 110, 1, 10, 1, 100, 0, '{"productCode":"SP1","subTotal":100}'),
      ('hanoi', 111, 1, 10, 1, 70, 0, '{"productCode":"SP1","subTotal":70}'),
      ('saigon', 112, 1, 10, 1, 50, 0, '{"productCode":"SP1","subTotal":50}'),
      ('saigon', 113, 1, 10, 1, 60, 0, '{"productCode":"SP1","subTotal":60}'),
      ('hanoi', 114, 1, 10, 1, 40, 0, '{"productCode":"SP1","subTotal":40}'),
      ('hanoi', 115, 1, 10, 1, 1000, 0, '{"productCode":"SP1","subTotal":1000}'),
      ('hanoi', 116, 1, 10, 1, 1000, 0, '{"productCode":"SP1","subTotal":1000}'),
      ('hanoi', 117, 1, 10, 1, 20, 0, '{"productCode":"SP1","subTotal":20}'),
      ('saigon', 118, 1, 10, 1, 80, 0, '{"productCode":"SP1","subTotal":80}');
    INSERT INTO returns VALUES
      -- phieu tra khong ma, khop theo ten chuan hoa => KH3
      ('hanoi', 210, 'TH10', '2026-08-15 09:00:00+00', 30, 1, '{"statusValue":"Đã trả","customerName":"nguyễn văn đức"}'),
      -- dau thang sau: ngoai khung
      ('hanoi', 211, 'TH11', '2026-09-01 00:00:00+00', 999, 1, '{"statusValue":"Đã trả","customerName":"nguyễn văn đức"}'),
      -- ten khong co trong danh ba => ''
      ('saigon', 212, 'TH12', '2026-08-16 09:00:00+00', 5, 1, '{"statusValue":"Đã trả","customerName":"Khách không tồn tại"}');
    INSERT INTO return_details VALUES
      ('hanoi', 210, 1, 10, 1, 30, '{"productCode":"SP1","subTotal":30}'),
      ('hanoi', 211, 1, 10, 1, 999, '{"productCode":"SP1","subTotal":999}'),
      ('saigon', 212, 1, 10, 1, 5, '{"productCode":"SP1","subTotal":5}');`);
}

test('khop khach: ma uu tien, ten chuan hoa (hoa/thuong, khoang trang, ky tu rong), ten trung => ma lon nhat, khong khop => ma rong; ranh gioi thang', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seedAugust(db);
    const { rows } = await db.query(sql.CUSTOMER_MONTH_SELECT_SQL + ' ORDER BY branch, customer_code',
      [sql.BRANCH_CODES, '2026-08-01', '2026-09-01']);
    assert.deepEqual(rows.map(r => [r.branch, r.customer_code, r.customer_name, Number(r.invoice_amount),
      Number(r.return_amount), Number(r.net_revenue), r.invoice_count, r.return_count]), [
      ['hanoi', 'KH3', 'Tên khác', 140, 30, 110, 2, 1],
      ['hanoi', 'KH5', 'Trùng  Tên', 90, 0, 90, 2, 0],
      ['saigon', '', 'Khách không tồn tại', 110, 5, 105, 2, 1],
      ['saigon', 'KS1', 'LÊ THỊ HOA', 80, 0, 80, 1, 0]
    ]);
  } finally { await db.close(); }
});

test('khach x ma hang: cung quy tac khop khach (ca phieu tra theo ten) va ranh gioi thang', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await seedAugust(db);
    const { rows } = await db.query(sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL + ' ORDER BY branch, customer_code, product_code',
      [sql.BRANCH_CODES, '2026-08-01', '2026-09-01']);
    assert.deepEqual(rows.map(r => [r.branch, r.customer_code, r.product_code, Number(r.net_revenue), Number(r.net_qty)]), [
      ['hanoi', 'KH3', 'SP1', 110, 1],
      ['hanoi', 'KH5', 'SP1', 90, 2],
      ['saigon', '', 'SP1', 105, 1],
      ['saigon', 'KS1', 'SP1', 80, 1]
    ]);
  } finally { await db.close(); }
});

// Hieu nang (do tren DB that 2026-10-07): neu de phep chuan hoa ten (NFKC + regexp) trong
// dieu kien LEFT JOIN customer_by_name, planner chon Merge Join chi theo branch va tinh lai
// chuan hoa cho MOI cap (chung tu x khach) => ~87s/thang dang chay, >120s thang du. Khoa ten
// phai duoc tinh 1 lan/chung tu trong subquery co OFFSET 0 (rao chan planner keo phep chuan
// hoa vao join filter), roi join bang so bang thuan. Dung "don dep" OFFSET 0 hay dua lai
// normalizedNameSql vao ON.
test('cau truc: khoa ten tinh 1 lan/chung tu trong subquery OFFSET 0, join customer_by_name bang so bang thuan', () => {
  const texts = {
    CUSTOMER_MONTH_SELECT_SQL: sql.CUSTOMER_MONTH_SELECT_SQL,
    CUSTOMER_PRODUCT_MONTH_SELECT_SQL: sql.CUSTOMER_PRODUCT_MONTH_SELECT_SQL,
    FREEZE_CUSTOMER_SQL: sql.FREEZE_CUSTOMER_SQL,
    FREEZE_CUSTOMER_PRODUCT_SQL: sql.FREEZE_CUSTOMER_PRODUCT_SQL
  };
  for (const [name, text] of Object.entries(texts)) {
    const flat = text.replace(/\s+/g, ' ');
    assert.match(flat, /AS name_key FROM invoices i WHERE .*? OFFSET 0\) i LEFT JOIN customer_by_name cbn ON cbn\.branch = i\.branch AND cbn\.name_key = i\.name_key /,
      `${name}: hoa don`);
    assert.match(flat, /AS name_key FROM returns r WHERE .*? OFFSET 0\) r LEFT JOIN customer_by_name cbn ON cbn\.branch = r\.branch AND cbn\.name_key = r\.name_key /,
      `${name}: phieu tra`);
    assert.doesNotMatch(flat, /cbn\.name_key = lower\(/, `${name}: khong chuan hoa trong dieu kien join`);
  }
});
