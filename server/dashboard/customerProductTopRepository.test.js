'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCustomerProductTopRepository,
  DEFAULT_TOP_LIMIT,
  __test__: { toWallClockInstant, fromWallClockInstant }
} = require('./customerProductTopRepository');

// Repository nay chi tao va chay SQL that tren Postgres — o day chi kiem tra
// TANG WIRING (dashboardData.js goi dung tham so gi xuong SQL, va ket qua tra
// ve tu pool.query duoc mapRow() dich dung sang shape ma dashboardData.js
// mong doi). Tinh dung dan cua chinh cau SQL (JOIN/GROUP BY/ROW_NUMBER) duoc
// doi chieu bang smoke test tren du lieu that (xem bao cao cuoi).
function fakePool(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    }
  };
}

test('findTopCustomersByRevenueForProduct: dung SQL "revenue DESC" (xep theo doanh thu), khong loc ngay', async () => {
  const pool = fakePool();
  const repository = createCustomerProductTopRepository({ pool });
  await repository.findTopCustomersByRevenueForProduct({ branch: 'Hà Nội', code: 'SP-01' });

  assert.equal(pool.calls.length, 1);
  const { sql, params } = pool.calls[0];
  assert.match(sql, /revenue DESC, qty DESC/, 'phai xep theo doanh thu truoc');
  assert.deepEqual(params, ['hanoi', ['sp-01'], null, null, DEFAULT_TOP_LIMIT], 'khong loc theo ngay (toan bo lich su) va dung limit mac dinh');
});

test('findTopCustomersByRevenueForProduct: ma rong tra [] ngay, khong query', async () => {
  const pool = fakePool();
  const repository = createCustomerProductTopRepository({ pool });
  assert.deepEqual(await repository.findTopCustomersByRevenueForProduct({ branch: 'Hà Nội', code: '' }), []);
  assert.equal(pool.calls.length, 0);
});

test('toWallClockInstant/fromWallClockInstant: doi gio 2 chieu dung, khong lech +7h', () => {
  const real = new Date('2026-08-10T15:30:00+07:00'); // 08:30 UTC that
  const wallClockInDb = toWallClockInstant(real);
  assert.equal(wallClockInDb.toISOString(), '2026-08-10T15:30:00.000Z', 'gio luu trong DB phai la "gio treo tuong" VN mang nhan UTC');

  const backToReal = fromWallClockInstant(wallClockInDb);
  assert.equal(backToReal.getTime(), real.getTime(), 'doi nguoc lai phai ra dung thoi diem thuc ban dau');
});

test('findTopCustomersByRevenueForProduct: branch khong hop le bi tu choi truoc khi query', async () => {
  const pool = fakePool();
  const repository = createCustomerProductTopRepository({ pool });
  await assert.rejects(
    () => repository.findTopCustomersByRevenueForProduct({ branch: 'Không tồn tại', code: 'SP-01' }),
    err => err.statusCode === 400 && err.code === 'INVALID_BRANCH'
  );
  assert.equal(pool.calls.length, 0);
});

test('findTopCustomersByRevenueForProduct: mapRow dich dung tung truong, khach le van co ten mac dinh', async () => {
  const lastPurchaseDate = new Date('2026-08-12T10:00:00.000Z'); // "gio treo tuong" luu trong DB
  const pool = fakePool([
    {
      product_key: 'sp-01', product_code: 'SP-01', product_name: 'Sản phẩm một',
      customer_code: 'KH-A', customer_name: 'Khách A',
      qty: '8', revenue: '650.5', returned_quantity: '1', return_value: '50',
      last_purchase_date: lastPurchaseDate
    },
    {
      product_key: 'sp-01', product_code: 'SP-01', product_name: '',
      customer_code: '', customer_name: '',
      qty: '0', revenue: '0', returned_quantity: '0', return_value: '0',
      last_purchase_date: null
    }
  ]);
  const repository = createCustomerProductTopRepository({ pool });
  const [row, walkIn] = await repository.findTopCustomersByRevenueForProduct({ branch: 'Hà Nội', code: 'SP-01' });

  assert.equal(row.productCode, 'SP-01');
  assert.equal(row.productName, 'Sản phẩm một');
  assert.equal(row.customerCode, 'KH-A');
  assert.equal(row.customerName, 'Khách A');
  assert.equal(row.purchasedQuantity, 8, 'qty tra ve dang text tu SQL (numeric) phai duoc ep sang Number');
  assert.equal(row.purchaseRevenue, 650.5);
  assert.equal(row.returnedQuantity, 1);
  assert.equal(row.returnValue, 50);
  assert.equal(row.lastPurchaseDate.toISOString(), '2026-08-12T03:00:00.000Z');
  assert.equal(walkIn.productName, 'SP-01', 'ten hang rong -> fallback ve ma hang');
  assert.equal(walkIn.customerName, 'Khách lẻ');
  assert.equal(walkIn.lastPurchaseDate, null);
});

test('Ca hai: chi truyen ma co so vat ly, dung SQL gop theo khach qua ANY($1) va top-N tinh sau khi gop', async () => {
  const pool = fakePool();
  const repository = createCustomerProductTopRepository({ pool });
  await repository.findTopCustomersByRevenueForProduct({ branch: 'Cả hai', code: 'SP-01' });

  const [byRevenue] = pool.calls;
  assert.deepEqual(byRevenue.params, [['hanoi', 'saigon'], ['sp-01'], null, null, DEFAULT_TOP_LIMIT], 'chi ma co so vat ly, khong bao gio "Cả hai"');
  assert.match(byRevenue.sql, /d\.branch = ANY\(\$1::text\[\]\)/);
  assert.match(byRevenue.sql, /rd\.branch = ANY\(\$1::text\[\]\)/);
  assert.doesNotMatch(byRevenue.sql, /\.branch = \$1/, 'khong con so khop mot co so');
  assert.match(byRevenue.sql, /GROUP BY product_key, customer_key/, 'gop theo (hang, khach), khong theo co so');
  assert.match(byRevenue.sql, /rn <= \$5/);
  assert.match(byRevenue.sql, /CASE branch WHEN 'hanoi' THEN 0/, 'ten hien thi uu tien Ha Noi -> Sai Gon');
});

test('co so vat ly: SQL va tham so giu nguyen (khong dung ANY)', async () => {
  const pool = fakePool();
  const repository = createCustomerProductTopRepository({ pool });
  await repository.findTopCustomersByRevenueForProduct({ branch: 'Sài Gòn', code: 'SP-01' });
  assert.equal(pool.calls[0].params[0], 'saigon');
  assert.match(pool.calls[0].sql, /d\.branch = \$1/);
  assert.doesNotMatch(pool.calls[0].sql, /ANY\(\$1/);
});
