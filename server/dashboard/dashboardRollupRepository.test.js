'use strict';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDashboardRollupRepository } = require('./dashboardRollupRepository');

// Repository nay chi wiring den SQL that tren 4 bang rollup + `purchases` —
// o day chi kiem tra dung branch/tham so duoc truyen xuong va ket qua tra ve
// tu pool.query duoc dich dung shape ma dashboardData.js mong doi. Dung SQL
// (GROUP BY/JOIN) duoc doi chieu bang smoke test tren du lieu that sau khi
// migration+refresh chay (xem bao cao cuoi).
function fakePool(rows = [], returnRows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: /FROM returns/.test(sql) ? returnRows : rows };
    }
  };
}

test('getInvoiceRevenueByDay: chuan hoa branch, truyen dung from/to, dich dung shape', async () => {
  const pool = fakePool([
    { date_key: '10/08/2026', revenue: '500000', invoice_count: '3' },
    { date_key: '11/08/2026', revenue: '0', invoice_count: '0' }
  ]);
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getInvoiceRevenueByDay({ branch: 'Hà Nội', from: '2026-08-10', to: '2026-08-11' });

  assert.equal(pool.calls.length, 2, '1 truy van hoa don + 1 truy van tra hang');
  const salesCall = pool.calls.find(call => /daily_invoice_summary/.test(call.sql));
  const returnsCall = pool.calls.find(call => /FROM returns/.test(call.sql));
  assert.deepEqual(salesCall.params, ['hanoi', '2026-08-10', '2026-08-11']);
  assert.deepEqual(returnsCall.params, ['hanoi', '2026-08-10', '2026-08-11']);
  assert.match(returnsCall.sql, /statusValue' = 'Đã trả'/, 'chi phieu Đã trả (loai Phiếu tạm/Đã hủy)');
  assert.deepEqual(rows, [
    { dateKey: '10/08/2026', revenue: 500000, grossRevenue: 500000, returnAmount: 0, returnCount: 0, invoiceCount: 3 },
    { dateKey: '11/08/2026', revenue: 0, grossRevenue: 0, returnAmount: 0, returnCount: 0, invoiceCount: 0 }
  ]);
});

test('getInvoiceRevenueByDay: doanh thu thuc te = doanh thu ban tru tien tra hang cua ngay do', async () => {
  const pool = fakePool(
    [
      { date_key: '10/08/2026', revenue: '500000', invoice_count: '3' },
      { date_key: '12/08/2026', revenue: '200000', invoice_count: '1' }
    ],
    [
      { date_key: '10/08/2026', return_amount: '120000', return_count: '2' },
      // Ngay chi co tra hang (khong co hoa don) van phai co dong, doanh thu am.
      { date_key: '11/08/2026', return_amount: '30000', return_count: '1' }
    ]
  );
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getInvoiceRevenueByDay({ branch: 'Hà Nội', from: '2026-08-10', to: '2026-08-12' });

  assert.deepEqual(rows, [
    { dateKey: '10/08/2026', revenue: 380000, grossRevenue: 500000, returnAmount: 120000, returnCount: 2, invoiceCount: 3 },
    { dateKey: '11/08/2026', revenue: -30000, grossRevenue: 0, returnAmount: 30000, returnCount: 1, invoiceCount: 0 },
    { dateKey: '12/08/2026', revenue: 200000, grossRevenue: 200000, returnAmount: 0, returnCount: 0, invoiceCount: 1 }
  ]);
});

test('getInvoiceRevenueByDay: bo loc "Tat ca" -> from/to null (khong gioi han ngay)', async () => {
  const pool = fakePool();
  const repository = createDashboardRollupRepository({ pool });
  await repository.getInvoiceRevenueByDay({ branch: 'Sài Gòn' });
  pool.calls.forEach(call => assert.deepEqual(call.params, ['saigon', null, null]));
});

test('branch khong hop le nem loi INVALID_BRANCH, khong query Postgres', async () => {
  const pool = fakePool();
  const repository = createDashboardRollupRepository({ pool });
  await assert.rejects(
    repository.getFirstPurchaseDates({ branch: 'Không tồn tại' }),
    error => error.code === 'INVALID_BRANCH' && error.statusCode === 400
  );
  assert.equal(pool.calls.length, 0);
});

test('getProductSalesBreakdown: join products hien tai, fallback ten/ma khi khong khop', async () => {
  const pool = fakePool([
    { product_id: '1', code: 'SP-01', name: 'Sản phẩm một', qty: '5', revenue: '500000' },
    { product_id: '2', code: null, name: null, qty: '1', revenue: '10000' }
  ]);
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getProductSalesBreakdown({ branch: 'Hà Nội', from: '2026-08-01', to: '2026-08-30' });

  assert.match(pool.calls[0].sql, /daily_product_sales/);
  assert.deepEqual(pool.calls[0].params, ['hanoi', '2026-08-01', '2026-08-30']);
  assert.deepEqual(rows[0], { code: 'SP-01', name: 'Sản phẩm một', qty: 5, revenue: 500000 });
  // product_id=2 khong join duoc san pham hien tai (code/name null tu SQL) —
  // repository van dich ve chuoi rong, KHONG throw (dashboardData.js tu quyet
  // dinh fallback hien thi).
  assert.deepEqual(rows[1], { code: '', name: '', qty: 1, revenue: 10000 });
});

test('getTopSellingProducts: truyen dung limit xuong SQL (LIMIT $4)', async () => {
  const pool = fakePool([{ product_id: '1', code: 'SP-01', name: 'A', qty: '1', revenue: '100' }]);
  const repository = createDashboardRollupRepository({ pool });
  await repository.getTopSellingProducts({ branch: 'Hà Nội', from: null, to: null, limit: 10 });
  assert.match(pool.calls[0].sql, /ORDER BY revenue DESC LIMIT \$4/);
  assert.deepEqual(pool.calls[0].params, ['hanoi', null, null, 10]);
});

test('getFirstPurchaseDates: tra chuoi ngay dang DD/MM/YYYY HH24:MI:SS de parseSheetDate() doc lai', async () => {
  const pool = fakePool([
    { code: 'SP-01', name: 'Sản phẩm một', first_purchase_date_text: '05/03/2026 09:15:00' }
  ]);
  const repository = createDashboardRollupRepository({ pool });
  const rows = await repository.getFirstPurchaseDates({ branch: 'Hà Nội' });
  assert.deepEqual(pool.calls[0].params, ['hanoi']);
  assert.match(pool.calls[0].sql, /product_first_purchase/);
  assert.deepEqual(rows, [{ code: 'SP-01', name: 'Sản phẩm một', firstPurchaseDateText: '05/03/2026 09:15:00' }]);
});

test('getProductSalesBreakdown: Ca hai giu hang cung ma o hai co so thanh hai dong rieng kem nhan co so', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: [{
        product_id: params[0] === 'hanoi' ? '1' : '2',
        code: 'SP-CHUNG',
        name: params[0] === 'hanoi' ? null : 'Tên thật Sài Gòn',
        qty: '1',
        revenue: params[0] === 'hanoi' ? '100' : '200'
      }] };
    }
  };
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getProductSalesBreakdown({ branch: 'Cả hai' });

  assert.deepEqual(rows, [
    { code: 'SP-CHUNG', name: 'SP-CHUNG', qty: 1, revenue: 100, branch: 'Hà Nội' },
    { code: 'SP-CHUNG', name: 'Tên thật Sài Gòn', qty: 1, revenue: 200, branch: 'Sài Gòn' }
  ]);
  pool.calls.forEach(call => assert.match(call.sql, /p.is_active IS NOT FALSE/, 'chi hang dang kinh doanh'));
});

test('getInvoiceRevenueByDay: Ca hai cong bucket trung ngay sau khi doc tung co so vat ly', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (/FROM returns/.test(sql)) {
        return { rows: [{ date_key: '10/08/2026', return_amount: params[0] === 'hanoi' ? '40' : '10', return_count: '1' }] };
      }
      return { rows: [{ date_key: '10/08/2026', revenue: params[0] === 'hanoi' ? '100' : '250', invoice_count: '1' }] };
    }
  };
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getInvoiceRevenueByDay({ branch: 'Cả hai', from: '2026-08-10', to: '2026-08-10' });

  assert.deepEqual([...new Set(pool.calls.map(call => call.params[0]))].sort(), ['hanoi', 'saigon']);
  assert.deepEqual(rows, [
    { dateKey: '10/08/2026', revenue: 300, grossRevenue: 350, returnAmount: 50, returnCount: 2, invoiceCount: 2 }
  ]);
});

test('getFirstPurchaseDates: Ca hai giu tung dong theo co so (khong gop theo ma), chi hang dang kinh doanh', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: [{ code: 'SP-1', name: 'Áo', first_purchase_date_text: params[0] === 'hanoi' ? '02/09/2026 09:00:00' : '01/09/2026 09:00:00' }] };
    }
  };
  const rows = await createDashboardRollupRepository({ pool }).getFirstPurchaseDates({ branch: 'Cả hai' });
  assert.deepEqual(rows.map(row => [row.code, row.branch, row.firstPurchaseDateText]), [
    ['SP-1', 'Hà Nội', '02/09/2026 09:00:00'],
    ['SP-1', 'Sài Gòn', '01/09/2026 09:00:00']
  ]);
  pool.calls.forEach(call => assert.match(call.sql, /p\.is_active IS NOT FALSE/));
});
