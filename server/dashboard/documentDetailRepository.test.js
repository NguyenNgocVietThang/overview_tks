'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getOrderDetail, getReturnDetail, __test__ } = require('./documentDetailRepository');

// Pool gia: tra lan luot tung ket qua, ghi lai cau SQL + tham so.
function fakePool(...results) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: results.shift() || [] };
    }
  };
}

test('mapLine don dat hang: bo qua subTotal (luon 0), tinh (don gia - giam gia) * so luong', () => {
  assert.equal(__test__.mapLine({ quantity: '3', price: '1000', discount: '100', sub_total: '0' }).amount, 2700);
});

test('mapLine phieu tra: dung subTotal (so duong), thieu thi tinh lai', () => {
  const opts = { fromSubTotal: true };
  assert.equal(__test__.mapLine({ quantity: 1, price: 5, sub_total: '-5' }, opts).amount, 5);
  assert.equal(__test__.mapLine({ quantity: 2, price: 5, discount: 0, sub_total: null }, opts).amount, 10);
});

test('getOrderDetail tra dau chung + cac dong hang cua don (dung co so va ma)', async () => {
  const pool = fakePool(
    [{
      id: '77', code: 'DH027910', order_date: '27/07/2026 09:00', customer_name: 'KH C Hương HĐ', customer_code: 'KH007175',
      seller: 'Nguyễn Thị Hiền', warehouse: 'Chi nhánh trung tâm', status: 'Phiếu tạm', total: '8750000', discount: '0', paid: '0', note: 'CONT mới'
    }],
    [
      { product_code: 'A1', product_name: 'Hang A', quantity: '2', price: '1000', discount: '0', sub_total: '0', note: '' },
      { product_code: 'B2', product_name: 'Hang B', quantity: '1.5', price: '4000', discount: '0', sub_total: '0', note: 'de vo' }
    ]
  );
  const detail = await getOrderDetail({ code: ' DH027910 ', branchCode: 'hanoi', pool });

  assert.deepEqual(pool.calls[0].params, ['hanoi', 'DH027910']);
  assert.deepEqual(pool.calls[1].params, ['hanoi', '77']);
  assert.equal(detail.kind, 'order');
  assert.equal(detail.status, 'Phiếu tạm');
  assert.equal(detail.total, 8750000);
  assert.equal(detail.lineCount, 2);
  assert.equal(detail.totalQuantity, 3.5);
  assert.deepEqual(detail.lines[1], {
    productCode: 'B2', productName: 'Hang B', quantity: 1.5, price: 4000, discount: 0, amount: 6000, note: 'de vo'
  });
});

test('getOrderDetail: khong co don -> 404, thieu ma -> 400', async () => {
  await assert.rejects(getOrderDetail({ code: 'DH-NONE', branchCode: 'hanoi', pool: fakePool([]) }), { statusCode: 404 });
  await assert.rejects(getOrderDetail({ code: '  ', branchCode: 'hanoi', pool: fakePool() }), { statusCode: 400 });
});

test('getReturnDetail tra hoa don goc, tien tra la so duong', async () => {
  const pool = fakePool(
    [{
      id: '9', code: 'TH000513', return_date: '25/04/2026 11:31', customer_name: 'KMN Anh Tuấn', customer_code: 'KH005899',
      seller: 'Hồng Phấn', warehouse: 'Chi nhánh trung tâm', status: 'Đã trả', total: '1590000',
      return_discount: '0', return_fee: '0', paid: '-1590000', invoice_code: 'HD012345'
    }],
    [{ product_code: 'QMCT4CANH', product_name: 'Quạt NK96', quantity: '100', price: '15900', discount: 0, sub_total: '1590000', note: 'vỏ xấu' }]
  );
  const detail = await getReturnDetail({ code: 'TH000513', branchCode: 'saigon', pool });

  assert.deepEqual(pool.calls[0].params, ['saigon', 'TH000513']);
  assert.equal(detail.kind, 'return');
  assert.equal(detail.invoiceCode, 'HD012345');
  assert.equal(detail.paid, 1590000);
  assert.equal(detail.lines[0].amount, 1590000);
  assert.equal(detail.totalQuantity, 100);
});

test('getReturnDetail: khong co phieu -> 404', async () => {
  await assert.rejects(getReturnDetail({ code: 'TH-NONE', branchCode: 'hanoi', pool: fakePool([]) }), { statusCode: 404 });
});
