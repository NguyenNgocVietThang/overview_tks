'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
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

test('getInvoiceRevenueByDay: chuan hoa branch, truyen dung from/to, dich dung shape', async () => {
  const pool = fakePool([
    { date_key: '10/08/2026', revenue: '500000', invoice_count: '3' },
    { date_key: '11/08/2026', revenue: '0', invoice_count: '0' }
  ]);
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getInvoiceRevenueByDay({ branch: 'Hà Nội', from: '2026-08-10', to: '2026-08-11' });

  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, ['hanoi', '2026-08-10', '2026-08-11']);
  assert.match(pool.calls[0].sql, /daily_invoice_summary/);
  assert.deepEqual(rows, [
    { dateKey: '10/08/2026', revenue: 500000, invoiceCount: 3 },
    { dateKey: '11/08/2026', revenue: 0, invoiceCount: 0 }
  ]);
});

test('getInvoiceRevenueByDay: bo loc "Tat ca" -> from/to null (khong gioi han ngay)', async () => {
  const pool = fakePool();
  const repository = createDashboardRollupRepository({ pool });
  await repository.getInvoiceRevenueByDay({ branch: 'Sài Gòn' });
  assert.deepEqual(pool.calls[0].params, ['saigon', null, null]);
});

test('branch khong hop le nem loi INVALID_BRANCH, khong query Postgres', async () => {
  const pool = fakePool();
  const repository = createDashboardRollupRepository({ pool });
  await assert.rejects(
    repository.getPurchaseTotals({ branch: 'Không tồn tại' }),
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

test('getPurchasesBySupplier: gom theo ten NCC, fallback "(Không xác định)"', async () => {
  const pool = fakePool([
    { name: 'NCC A', order_count: '3', total: '900000' },
    { name: '(Không xác định)', order_count: '1', total: '50000' }
  ]);
  const repository = createDashboardRollupRepository({ pool });
  const rows = await repository.getPurchasesBySupplier({ branch: 'Hà Nội', from: '2026-08-01', to: '2026-08-30', limit: 30 });
  assert.deepEqual(pool.calls[0].params, ['hanoi', '2026-08-01', '2026-08-30', 30]);
  assert.deepEqual(rows, [
    { name: 'NCC A', orderCount: 3, total: 900000 },
    { name: '(Không xác định)', orderCount: 1, total: 50000 }
  ]);
});

test('getPurchasesBySupplier: Ca hai merge theo ma NCC chuan hoa va giu ten HN dau tien', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: params[0] === 'hanoi'
        ? [
            { code: 'NCC-1', name: 'Tên Hà Nội', order_count: '1', total: '100' },
            { code: 'NCC-2', name: 'Trùng tên', order_count: '1', total: '50' }
          ]
        : [
            { code: ' ncc-1 ', name: 'Tên Sài Gòn', order_count: '1', total: '200' },
            { code: 'NCC-3', name: 'Trùng tên', order_count: '1', total: '70' }
          ] };
    }
  };
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getPurchasesBySupplier({ branch: 'Cả hai', limit: 30 });

  assert.deepEqual(rows, [
    { name: 'Tên Hà Nội', orderCount: 2, total: 300 },
    { name: 'Trùng tên', orderCount: 1, total: 70 },
    { name: 'Trùng tên', orderCount: 1, total: 50 }
  ]);
});

test('getPurchaseTotals: khong loc ngay, chi truyen branch', async () => {
  const pool = fakePool([{ order_count: '42', total: '12345678' }]);
  const repository = createDashboardRollupRepository({ pool });
  const totals = await repository.getPurchaseTotals({ branch: 'Hà Nội' });
  assert.deepEqual(pool.calls[0].params, ['hanoi']);
  assert.match(pool.calls[0].sql, /daily_purchase_summary/);
  assert.deepEqual(totals, { orderCount: 42, total: 12345678 });
});

test('getPurchaseTotals: khong co dong nao van tra ve 0/0, khong throw', async () => {
  const pool = fakePool([]);
  const repository = createDashboardRollupRepository({ pool });
  const totals = await repository.getPurchaseTotals({ branch: 'Hà Nội' });
  assert.deepEqual(totals, { orderCount: 0, total: 0 });
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

test('listPurchaseOrders: doc thang tu purchases (khong dung bang rollup), truyen dung from/to', async () => {
  const pool = fakePool([
    { code: 'PN-01', date: '10/08/2026 09:00', supplier_code: 'NCC-01', supplier: 'NCC A', branch: 'Hà Nội', total: '500000', status: 'Hoàn thành' }
  ]);
  const repository = createDashboardRollupRepository({ pool });
  const rows = await repository.listPurchaseOrders({ branch: 'Hà Nội', from: '2026-08-01', to: '2026-08-30' });
  assert.match(pool.calls[0].sql, /FROM purchases pu/);
  assert.doesNotMatch(pool.calls[0].sql, /purchase_details/);
  assert.deepEqual(pool.calls[0].params, ['hanoi', '2026-08-01', '2026-08-30']);
  assert.deepEqual(rows, [{
    code: 'PN-01', date: '10/08/2026 09:00', supplierCode: 'NCC-01', supplier: 'NCC A', branch: 'Hà Nội', total: 500000, status: 'Hoàn thành'
  }]);
});

test('getProductSalesBreakdown: Ca hai uu tien ten that SG khi HN chi co fallback ma', async () => {
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

  assert.deepEqual(rows, [{ code: 'SP-CHUNG', name: 'Tên thật Sài Gòn', qty: 2, revenue: 300 }]);
});

test('getInvoiceRevenueByDay: Ca hai cong bucket trung ngay sau khi doc tung co so vat ly', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: [{ date_key: '10/08/2026', revenue: params[0] === 'hanoi' ? '100' : '250', invoice_count: '1' }] };
    }
  };
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.getInvoiceRevenueByDay({ branch: 'Cả hai', from: '2026-08-10', to: '2026-08-10' });

  assert.deepEqual(pool.calls.map(call => call.params[0]), ['hanoi', 'saigon']);
  assert.deepEqual(rows, [{ dateKey: '10/08/2026', revenue: 350, invoiceCount: 2 }]);
});

test('listPurchaseOrders: Ca hai giu hai phieu trung ma va gan co so vat ly', async () => {
  const pool = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: [{
        code: 'PN-TRUNG', date: '10/08/2026 09:00', supplier_code: 'NCC-1', supplier: 'NCC A',
        branch: 'ten-kho', total: params[0] === 'hanoi' ? '100' : '200', status: 'Hoàn thành'
      }] };
    }
  };
  const repository = createDashboardRollupRepository({ pool });

  const rows = await repository.listPurchaseOrders({ branch: 'Cả hai' });

  assert.deepEqual(rows.map(row => [row.code, row.supplierCode, row.branch, row.total]), [
    ['PN-TRUNG', 'NCC-1', 'Hà Nội', 100],
    ['PN-TRUNG', 'NCC-1', 'Sài Gòn', 200]
  ]);
});
