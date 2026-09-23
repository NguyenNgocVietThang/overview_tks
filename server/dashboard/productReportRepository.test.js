'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getProductReport, __test__ } = require('./productReportRepository');

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
  assert.equal(pool.calls.length, 1);
  assert.match(pool.calls[0], /FROM product_report/);
  assert.equal(result.rows.length, 2);
  assert.equal(result.computedAt, '2026-09-23T00:06:00.000Z');
});

test('getProductReport tra computedAt = null neu bang rong', async () => {
  const pool = { query: async () => ({ rows: [] }) };
  const result = await getProductReport({ pool });
  assert.deepEqual(result, { rows: [], computedAt: null });
});
