'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getProductReport, getProductReportCustomers, __test__ } = require('./productReportRepository');

test('getProductReport chi giu ma dang kinh doanh o it nhat mot co so, ke ca het ton/chua ban', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/0018_product_report.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/0053_product_containers.sql'), 'utf8'));
    await db.exec(`
      CREATE TABLE products (branch text, code text, is_active boolean);
      INSERT INTO products VALUES
        ('hanoi', 'ACTIVE', true), ('saigon', 'ACTIVE', true),
        ('hanoi', 'SG_ONLY', false), ('saigon', 'SG_ONLY', true),
        ('hanoi', 'STOPPED', false), ('saigon', 'STOPPED', false),
        ('hanoi', 'UNKNOWN', null);
      INSERT INTO product_report (product_code, product_name) VALUES
        ('ACTIVE', 'Active'), ('SG_ONLY', 'Active SG'),
        ('STOPPED', 'Stopped'), ('UNKNOWN', 'Unknown'), ('MISSING', 'Missing');
    `);
    const result = await getProductReport({ pool: db });
    assert.deepEqual(result.rows.map(row => row.code), ['ACTIVE', 'SG_ONLY', 'UNKNOWN']);
    assert.equal(result.rows[0].availableToSell, 0);
    assert.equal(result.rows[0].revenue90d, 0);

    // Trang thai moi phai co hieu luc ca khi snapshot ban dem chua duoc tinh lai.
    await db.exec("UPDATE products SET is_active = false WHERE code = 'ACTIVE'");
    const updated = await getProductReport({ pool: db });
    assert.deepEqual(updated.rows.map(row => row.code), ['SG_ONLY', 'UNKNOWN']);
  } finally {
    await db.close();
  }
});

test('mapRow chuyen doi cot Postgres (snake_case, string so) sang camelCase (number)', () => {
  const row = __test__.mapRow({
    product_code: 'SP001',
    product_name: 'San pham 1',
    stock_hanoi: '10',
    stock_saigon: '5',
    available_to_sell: '12',
    qty_sold_30d: '3',
    revenue_90d: '900000',
    customer_count_90d: '2',
    top_customer_revenue_90d: '500000',
    top_customer_name: 'Nguyen Van A',
    top_customer_share: '0.5555',
    computed_at: '2026-09-23T00:05:00.000Z'
  });
  assert.deepEqual(row, {
    code: 'SP001', name: 'San pham 1', stockHanoi: 10, stockSaigon: 5, availableToSell: 12,
    qtySold30d: 3, revenue90d: 900000, customerCount90d: 2, topCustomerRevenue90d: 500000,
    topCustomerName: 'Nguyen Van A', topCustomerShare: 0.5555, computedAt: '2026-09-23T00:05:00.000Z'
  });
});

test('mapRow tra ve topCustomerShare null neu khong co du lieu (thay vi NaN/0)', () => {
  const row = __test__.mapRow({
    product_code: 'SP002', product_name: 'SP2', stock_hanoi: 0, stock_saigon: 0, available_to_sell: 0,
    qty_sold_30d: 0, revenue_90d: 0, customer_count_90d: 0, top_customer_revenue_90d: 0,
    top_customer_name: null, top_customer_share: null, computed_at: null
  });
  assert.equal(row.topCustomerShare, null);
  assert.equal(row.topCustomerName, '');
});

test('getProductReport doc bang product_report va tinh computedAt = moc gan nhat', async () => {
  const pool = {
    calls: [],
    query: async function (sql) {
      this.calls.push(sql);
      return {
        rows: [
          { product_code: 'A', product_name: 'A', stock_hanoi: 1, stock_saigon: 0, available_to_sell: 1, qty_sold_30d: 0, revenue_90d: 0, customer_count_90d: 0, top_customer_revenue_90d: 0, top_customer_name: null, top_customer_share: null, computed_at: '2026-09-23T00:05:00.000Z' },
          { product_code: 'B', product_name: 'B', stock_hanoi: 1, stock_saigon: 0, available_to_sell: 1, qty_sold_30d: 0, revenue_90d: 0, customer_count_90d: 0, top_customer_revenue_90d: 0, top_customer_name: null, top_customer_share: null, computed_at: '2026-09-23T00:06:00.000Z' }
        ]
      };
    }
  };
  const result = await getProductReport({ pool });
  // 1 cau doc state (chua co migration 0055 => luong cu) + dong bao cao + tong CONT + hang van chuyen.
  assert.equal(pool.calls.length, 4);
  assert.match(pool.calls[0], /FROM product_report_state/);
  assert.match(pool.calls[1], /FROM product_report\s/);
  assert.equal(result.rows.length, 2);
  assert.equal(result.computedAt, '2026-09-23T00:06:00.000Z');
});

test('getProductReport tra computedAt = null neu bang rong', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const result = await getProductReport({ pool });
  assert.deepEqual(result.rows, []);
  assert.equal(result.computedAt, null);
  assert.equal(result.containerSync.available, false);
});

test('getProductReportCustomers tra khach xep giam dan theo doanh so, share = khach / tong cac khach', async () => {
  const pool = {
    calls: [],
    query: async function (sql, params) {
      this.calls.push({ sql, params });
      return {
        rows: [
          { customer_name: 'KH A', revenue: '600000' },
          { customer_name: 'KH B', revenue: '300000' },
          { customer_name: 'Khách lẻ', revenue: '100000' }
        ]
      };
    }
  };
  const result = await getProductReportCustomers({ code: ' sp001 ', pool });

  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0].sql, /FROM product_report_customers/);
  assert.match(pool.calls[0].sql, /product_key = lower\(btrim\(\$1\)\)/);
  assert.match(pool.calls[0].sql, /ORDER BY revenue DESC/);
  assert.deepEqual(pool.calls[0].params, [' sp001 ']);
  assert.equal(result.code, 'sp001');
  assert.equal(result.totalRevenue, 1000000);
  assert.equal(result.customerCount, 3);
  assert.deepEqual(result.rows, [
    { customerName: 'KH A', revenue: 600000, share: 0.6 },
    { customerName: 'KH B', revenue: 300000, share: 0.3 },
    { customerName: 'Khách lẻ', revenue: 100000, share: 0.1 }
  ]);
  assert.ok(Math.abs(result.rows.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
});

test('getProductReportCustomers tra rows rong (khong loi) neu ma hang chua co du lieu khach', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const result = await getProductReportCustomers({ code: 'XYZ', pool });
  assert.deepEqual(result, { code: 'XYZ', totalRevenue: 0, customerCount: 0, rows: [] });
});

test('getProductReportCustomers dat share = null neu tong doanh so = 0 (tranh chia cho 0)', async () => {
  const pool = { query: async () => ({ rows: [{ customer_name: 'KH A', revenue: '0' }] }) };
  const result = await getProductReportCustomers({ code: 'A', pool });
  assert.equal(result.rows[0].share, null);
  assert.equal(result.totalRevenue, 0);
});

test('getProductReportCustomers nem loi 400 neu thieu ma hang', async () => {
  const pool = { query: async () => { throw new Error('khong duoc goi DB'); } };
  await assert.rejects(
    () => getProductReportCustomers({ code: '   ', pool }),
    (error) => error.statusCode === 400 && /mã hàng/i.test(error.message)
  );
  await assert.rejects(() => getProductReportCustomers({ pool }), (error) => error.statusCode === 400);
});


test('Điều chuyển SG uses the existing DB transit source per normalized code', async () => {
  const pool = { query: async (sql, params) => {
    if (sql.includes('-- in-transit:')) {
      assert.deepEqual(params, ['Đã xác nhận NCC']);
      return {rows:[{product_key:'sku-01',qty:'175.5'}]};
    }
    if (sql.includes('FROM product_report')) return {rows:[{product_code:'SKU-01',stock_hanoi:10,stock_saigon:20,available_to_sell:25}]};
    return {rows:[]};
  }};
  const result = await getProductReport({pool});
  assert.equal(result.rows[0].inTransit,175.5);
  assert.equal(result.rows[0].availableToSell,200.5);
});

// ---- Bo doc theo phien ban (product_report_state, migration 0055) ----
async function versionedFixture() {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('node:fs');
  const path = require('node:path');
  const migrations = path.join(__dirname, '../db/migrations');
  const db = new PGlite();
  await db.exec(fs.readFileSync(path.join(migrations, '0018_product_report.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(migrations, '0053_product_containers.sql'), 'utf8'));
  const m55 = fs.readFileSync(path.join(migrations, '0055_product_report_state.sql'), 'utf8');
  await db.exec(m55.slice(m55.indexOf('CREATE TABLE'), m55.indexOf(');', m55.indexOf('CREATE TABLE')) + 2));
  await db.exec(`INSERT INTO product_report (product_code, product_name, stock_hanoi, available_to_sell) VALUES ('A','Sp A',10,10),('B','Sp B',5,5);
    INSERT INTO product_report_state (id, computed_at, version) VALUES (1, '2026-10-16T05:00:00Z', 3);
    UPDATE product_container_sync SET version='00000000-0000-4000-8000-000000000001', last_success_at=now();
    INSERT INTO product_container_lines(sheet_name,sheet_order,container_row,source_row,product_code,product_key,container_name,status,status_label,quantity)
    VALUES ('YIWU',0,1,2,'A','a','CONT A',2,'2.Chưa bốc',40);`);
  const calls = [];
  const pool = { query: (sql, args) => { calls.push(sql); return db.query(sql, args); } };
  return { db, pool, calls };
}
const reads = (calls, pattern) => calls.filter(sql => pattern.test(sql)).length;

test('bo doc theo phien ban: chi keo 10,9K dong ve khi version doi; tong CONT chi doc lai khi version CONT doi', async () => {
  const { createProductReportReader } = require('./productReportRepository');
  const { db, pool, calls } = await versionedFixture();
  try {
    const reader = createProductReportReader({ pool, now: () => 1000 });
    const first = await reader.read();
    assert.equal(first.reportVersion, '3');
    assert.equal(new Date(first.computedAt).toISOString(), '2026-10-16T05:00:00.000Z');
    assert.deepEqual(first.rows.map(r => r.code), ['A', 'B']);
    assert.equal(first.rows[0].unloadedQty, 40);
    assert.equal(reads(calls, /SELECT \* FROM product_report ORDER BY/), 1);
    assert.equal(reads(calls, /jsonb_object_agg/), 1);
    // Tuy y sua ket qua tra ve khong lam ban cache.
    first.rows[0].name = 'DA SUA';
    first.rows[0].availableToSell += 1000;

    const second = await reader.read();
    assert.equal(reads(calls, /SELECT \* FROM product_report ORDER BY/), 1, 'cung version => khong doc lai bang bao cao');
    assert.equal(reads(calls, /jsonb_object_agg/), 1, 'cung version CONT => khong doc lai tong CONT');
    assert.equal(second.rows[0].name, 'Sp A');
    assert.equal(second.rows[0].availableToSell, 10);

    // Version bao cao doi => doc lai bang bao cao, KHONG doc lai tong CONT.
    await db.exec("UPDATE product_report SET stock_hanoi = 77 WHERE product_code='A'; UPDATE product_report_state SET version = 4, computed_at = '2026-10-16T05:07:00Z'");
    const third = await reader.read();
    assert.equal(third.reportVersion, '4');
    assert.equal(third.rows[0].stockHanoi, 77);
    assert.equal(reads(calls, /SELECT \* FROM product_report ORDER BY/), 2);
    assert.equal(reads(calls, /jsonb_object_agg/), 1);

    // Version CONT doi => doc lai tong CONT.
    await db.exec("UPDATE product_container_sync SET version='00000000-0000-4000-8000-000000000002'; UPDATE product_container_lines SET quantity = 90");
    const fourth = await reader.read();
    assert.equal(fourth.rows[0].unloadedQty, 90);
    assert.equal(reads(calls, /jsonb_object_agg/), 2);
  } finally { await db.close(); }
});

test('bo doc theo phien ban: hang van chuyen cache theo TTL 60 giay, ban dau chua co CONT thi unloaded/loaded = null', async () => {
  const { createProductReportReader } = require('./productReportRepository');
  const { db, pool, calls } = await versionedFixture();
  try {
    let clock = 0;
    const reader = createProductReportReader({ pool, now: () => clock });
    await reader.read();
    const transitReads = () => reads(calls, /order_suppliers/);
    const first = transitReads();
    clock = 30 * 1000; await reader.read();
    assert.equal(transitReads(), first, 'trong 60 giay khong doc lai');
    clock = 61 * 1000; await reader.read();
    assert.equal(transitReads(), first + 1, 'qua 60 giay doc lai mot lan');

    await db.exec('UPDATE product_container_sync SET version = NULL, last_success_at = NULL');
    const noContainers = await createProductReportReader({ pool }).read();
    assert.equal(noContainers.rows[0].unloadedQty, null);
    assert.equal(noContainers.rows[0].loadedQty, null);
  } finally { await db.close(); }
});

test('getProductReportVersion tra phien ban hoac null (chua migrate/loi), khong nem loi', async () => {
  const { getProductReportVersion } = require('./productReportRepository');
  const { db, pool } = await versionedFixture();
  try {
    assert.equal(await getProductReportVersion({ pool }), '3');
    await db.exec('DELETE FROM product_report_state');
    assert.equal(await getProductReportVersion({ pool }), null);
    assert.equal(await getProductReportVersion({ pool: { query: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } } }), null);
    assert.equal(await getProductReportVersion({ pool: { query: async () => { throw new Error('db down'); } } }), null);
  } finally { await db.close(); }
});

test('bang state rong (chua tung chay tang dan) => luong cu loc is_active luc doc, reportVersion = null', async () => {
  const { createProductReportReader } = require('./productReportRepository');
  const { db, pool } = await versionedFixture();
  try {
    await db.exec(`DELETE FROM product_report_state;
      CREATE TABLE products (branch text, code text, is_active boolean);
      INSERT INTO products VALUES ('hanoi','A',true),('hanoi','B',false),('saigon','B',false);`);
    const result = await createProductReportReader({ pool }).read();
    assert.equal(result.reportVersion, null);
    assert.deepEqual(result.rows.map(r => r.code), ['A']);
  } finally { await db.close(); }
});
