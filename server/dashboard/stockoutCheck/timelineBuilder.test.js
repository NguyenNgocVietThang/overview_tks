'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  toVnDateKey,
  accumulateInvoiceEvents,
  accumulatePurchaseOrderEvents,
  accumulateReturnEvents,
  reconstructDailyStock
} = require('./timelineBuilder');

test('toVnDateKey cộng offset +7h trước khi lấy ngày (qua nửa đêm)', () => {
  assert.equal(toVnDateKey('2026-08-26T20:00:00'), '2026-08-27');
  assert.equal(toVnDateKey('2026-08-26T10:00:00'), '2026-08-26');
  assert.equal(toVnDateKey('2026-08-26T18:00:00Z'), '2026-08-27');
});

test('accumulateInvoiceEvents chỉ tính hóa đơn status=1 (Hoàn thành), bỏ qua mã không hợp lệ', () => {
  const map = new Map();
  const validCodes = new Set(['SP001']);
  const page = [
    { status: 1, purchaseDate: '2026-08-01T03:00:00', invoiceDetails: [{ productCode: 'SP001', quantity: 5 }] },
    { status: 3, purchaseDate: '2026-08-02T03:00:00', invoiceDetails: [{ productCode: 'SP001', quantity: 9 }] },
    { status: 1, purchaseDate: '2026-08-03T03:00:00', invoiceDetails: [{ productCode: 'SP999', quantity: 2 }] }
  ];
  accumulateInvoiceEvents(map, page, validCodes);
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-08-01', delta: -5 }]);
  assert.equal(map.has('SP999'), false);
});

test('accumulatePurchaseOrderEvents chỉ tính phiếu không phải draft, cộng dồn tồn kho', () => {
  const map = new Map();
  const validCodes = new Set(['SP001']);
  const page = [
    { isDraft: false, purchaseDate: '2026-08-01T03:00:00', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 20 }] },
    { isDraft: true, purchaseDate: '2026-08-02T03:00:00', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 99 }] }
  ];
  accumulatePurchaseOrderEvents(map, page, validCodes);
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-08-01', delta: 20 }]);
});

test('accumulateReturnEvents chỉ tính phiếu trả status=1 (Đã trả), cộng dồn tồn kho', () => {
  const map = new Map();
  const validCodes = new Set(['SP001']);
  const page = [
    { status: 1, returnDate: '2026-08-01T03:00:00', returnDetails: [{ productCode: 'SP001', quantity: 3 }] },
    { status: 2, returnDate: '2026-08-02T03:00:00', returnDetails: [{ productCode: 'SP001', quantity: 7 }] }
  ];
  accumulateReturnEvents(map, page, validCodes);
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-08-01', delta: 3 }]);
});

test('accumulate* gộp vào mảng events đã có sẵn của mã (gọi nhiều trang liên tiếp)', () => {
  const map = new Map();
  map.set('SP001', [{ dateKey: '2026-07-01', delta: -1 }]);
  accumulateInvoiceEvents(
    map,
    [{ status: 1, purchaseDate: '2026-08-01T03:00:00', invoiceDetails: [{ productCode: 'SP001', quantity: 2 }] }],
    new Set(['SP001'])
  );
  assert.deepEqual(map.get('SP001'), [
    { dateKey: '2026-07-01', delta: -1 },
    { dateKey: '2026-08-01', delta: -2 }
  ]);
});

test('reconstructDailyStock round-trip: dựng events từ 1 dailyStock đã biết rồi dựng ngược lại phải khớp', () => {
  const knownStock = [10, 10, 8, 8, 8, 0, 0, 0, 0, 20, 15];
  const dates = [];
  let d = new Date('2026-01-01T00:00:00Z');
  for (let i = 0; i < knownStock.length; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }

  const events = [];
  for (let i = 1; i < knownStock.length; i++) {
    const delta = knownStock[i] - knownStock[i - 1];
    if (delta !== 0) events.push({ dateKey: dates[i], delta });
  }

  const todayKey = dates[dates.length - 1];
  const daysBack = knownStock.length - 1;
  const currentOnHand = knownStock[knownStock.length - 1];

  const result = reconstructDailyStock(currentOnHand, events, todayKey, daysBack);

  assert.deepEqual(
    result.map((r) => r.stock),
    knownStock
  );
  assert.deepEqual(
    result.map((r) => r.date),
    dates
  );
});

test('reconstructDailyStock gộp nhiều event trong cùng 1 ngày trước khi trừ ngược', () => {
  const events = [
    { dateKey: '2026-01-03', delta: -5 },
    { dateKey: '2026-01-03', delta: -3 },
    { dateKey: '2026-01-02', delta: 10 }
  ];
  const result = reconstructDailyStock(0, events, '2026-01-03', 2);
  assert.deepEqual(result, [
    { date: '2026-01-01', stock: -2 },
    { date: '2026-01-02', stock: 8 },
    { date: '2026-01-03', stock: 0 }
  ]);
});

test('reconstructDailyStock không có event nào thì tồn kho không đổi suốt khoảng thời gian', () => {
  const result = reconstructDailyStock(7, [], '2026-01-05', 4);
  assert.deepEqual(
    result.map((r) => r.stock),
    [7, 7, 7, 7, 7]
  );
});
