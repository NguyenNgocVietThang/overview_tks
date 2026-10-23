'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { rankCustomerSuggestions, createVatRequestSuggestions } = require('./suggestions');

test('goi y khach: khong dau, dao thu tu tu, gop ten trung va uu tien ma KiotViet', () => {
  const directory = [{ name: 'Công ty Hòa Bình', code: 'KH-204' }, { name: 'Công ty Hòa Bình', code: 'SG-999' },
    { name: 'Cửa hàng Minh Anh', code: 'KH-102' }];
  const history = [
    { customer_name: 'Cong ty Hoa Binh', customer_code: '', last_order_at: '2026-10-19T03:00:00Z', order_count: 4 },
    { customer_name: 'Anh Minh cửa hàng', customer_code: null, last_order_at: '2026-10-20T03:00:00Z', order_count: 2 }
  ];
  const byName = rankCustomerSuggestions(directory, history, 'hoa binh', 10);
  assert.deepEqual(byName.results.map(row => row.name), ['Công ty Hòa Bình']);
  assert.equal(byName.results[0].code, 'KH-204');
  assert.equal(byName.results[0].source, 'kiotviet');
  assert.deepEqual(rankCustomerSuggestions(directory, history, 'minh anh', 10).results.map(row => row.name),
    ['Cửa hàng Minh Anh', 'Anh Minh cửa hàng']);
  assert.equal(rankCustomerSuggestions(directory, history, 'kh204', 10).results[0].code, 'KH-204');
});

test('gia goi y lay yeu cau VAT gan nhat cung ma, bo gia trong va dong da xoa', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/0076_vat_requests.sql'), 'utf8'));
    await db.exec(`INSERT INTO vat_requests (customer_name, product_code, quantity, unit_price_excl_vat, is_legacy, created_at)
      VALUES ('Khách cũ', '014XOAN', 1, 11000, true, '2026-10-18 00:00+07'),
             ('Khách mới', '014XOAN', 1, 12500, true, '2026-10-20 00:00+07'),
             ('Dòng thiếu giá', '014XOAN', 1, NULL, true, '2026-10-21'),
             ('Đã xóa', '014XOAN', 1, 99000, true, '2026-10-22'),
             ('Mã khác', '26DAQUAN', 1, 5000, true, '2026-10-23')`);
    await db.exec("UPDATE vat_requests SET is_deleted = true WHERE customer_name = 'Đã xóa'");
    const pool = { query: (sql, params) => db.query(sql, params) };
    const suggestions = createVatRequestSuggestions({ pool, directoryReader: async () => [] });
    assert.deepEqual(await suggestions.prices('014xoan'), {
      latestOrder: { price: 12500, customerName: 'Khách mới', createdAt: '2026-10-19T17:00:00.000Z' }
    });
    assert.deepEqual(await suggestions.prices('KHONGCO'), { latestOrder: null });
  } finally { await db.close(); }
});
