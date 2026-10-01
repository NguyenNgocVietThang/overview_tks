'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const documentDetailRepository = require('./documentDetailRepository');
const { getOrderDetail, getInvoiceDetail, __test__ } = documentDetailRepository;

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

test('"Nhan vien" cua don dat hang/hoa don bi cat hau to "- <ID Telegram>" trong SQL (saleName.js)', async () => {
  const header = [{ id: '1', code: 'X1' }];
  for (const [fn, alias] of [[getOrderDetail, 'o'], [getInvoiceDetail, 'i']]) {
    const pool = fakePool(header, []);
    await fn({ code: 'X1', branchCode: 'hanoi', pool });
    const sql = pool.calls[0].sql;
    assert.match(sql, new RegExp(`regexp_replace\\(COALESCE\\(NULLIF\\(${alias}\\.raw->>'soldByName', ''\\), s\\.name, ''\\)`), `${fn.name}: cat hau to o cot seller`);
    assert.match(sql, /\[0-9\]\{5,\}/);
    assert.match(sql, /AS seller/);
  }
});

test('getReturnDetail da bo cung bang Danh sach tra hang (chi con getOrderDetail cho Vong doi don hang va getInvoiceDetail)', () => {
  assert.equal('getReturnDetail' in documentDetailRepository, false);
  assert.deepEqual(Object.keys(documentDetailRepository).filter(key => key !== '__test__').sort(), ['getInvoiceDetail', 'getOrderDetail']);
});

test('getOrderDetail: khong co don -> 404, thieu ma -> 400', async () => {
  await assert.rejects(getOrderDetail({ code: 'DH-NONE', branchCode: 'hanoi', pool: fakePool([]) }), { statusCode: 404 });
  await assert.rejects(getOrderDetail({ code: '  ', branchCode: 'hanoi', pool: fakePool() }), { statusCode: 400 });
});

test('getInvoiceDetail tra dau chung + dong hang, dung subTotal cua hoa don (giu dau)', async () => {
  const pool = fakePool(
    [{
      id: '5', code: 'HD013586', purchase_date: '30/09/2026 08:10', customer_name: 'KH A', customer_code: 'KH001', seller: 'Thu Hiền',
      warehouse: 'Chi nhánh trung tâm', status: 'Hoàn thành', total: '900', discount: '100', paid: '900', order_code: 'DH-9', note: 'giao nhanh'
    }],
    [
      { product_code: 'A1', product_name: 'Hang A', quantity: '2', price: '500', discount: '50', sub_total: '900', note: '' },
      { product_code: 'B2', product_name: 'Hang B', quantity: '1', price: '10', discount: '0', sub_total: '-10', note: '' }
    ]
  );
  const detail = await getInvoiceDetail({ code: 'HD013586', branchCode: 'hanoi', pool });

  assert.deepEqual(pool.calls[0].params, ['hanoi', 'HD013586']);
  assert.deepEqual(pool.calls[1].params, ['hanoi', '5']);
  assert.equal(detail.kind, 'invoice');
  assert.equal(detail.orderCode, 'DH-9');
  assert.equal(detail.discount, 100);
  assert.equal(detail.paid, 900);
  assert.deepEqual(detail.lines.map(line => line.amount), [900, -10]);
  assert.equal(detail.totalQuantity, 3);
});

test('getInvoiceDetail: khong co hoa don -> 404', async () => {
  await assert.rejects(getInvoiceDetail({ code: 'HD-NONE', branchCode: 'hanoi', pool: fakePool([]) }), { statusCode: 404 });
});
