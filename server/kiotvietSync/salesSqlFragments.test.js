'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('./salesSqlFragments');
const top = require('../dashboard/customerProductTopRepository');

test('manh SQL dung chung: thanh tien dong giu nguyen nguon cu, trang thai uu tien statusValue', () => {
  assert.equal(f.DETAIL_AMOUNT_SQL, top.DETAIL_AMOUNT_SQL);
  assert.equal(f.RETURN_AMOUNT_SQL, top.RETURN_AMOUNT_SQL);
  assert.match(f.INVOICE_STATUS_SQL, /i\.raw->>'statusValue'/);
  assert.match(f.CUSTOMER_BY_NAME_CTE, /^\s*WITH customer_by_name AS \(/);
  assert.match(f.CUSTOMER_BY_NAME_CTE, /branch = ANY\(\$1::text\[\]\)/);
  assert.match(f.normalizedNameSql('x'), /normalize\(x, NFKC\)/);
});

test('customerInvoiceLinesRefresh dung lai manh SQL chung (khong dinh nghia rieng)', () => {
  const src = require('node:fs').readFileSync(require.resolve('./customerInvoiceLinesRefresh'), 'utf8');
  assert.match(src, /require\('\.\/salesSqlFragments'\)/);
  assert.doesNotMatch(src, /const CUSTOMER_BY_NAME_CTE =/);
});
