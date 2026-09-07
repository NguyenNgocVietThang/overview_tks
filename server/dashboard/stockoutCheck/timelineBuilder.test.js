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

test('toVnDateKey: chuỗi không kèm offset đã là giờ VN, lấy thẳng phần ngày (không cộng +7h)', () => {
  assert.equal(toVnDateKey('2026-08-26T20:00:00'), '2026-08-26');
  assert.equal(toVnDateKey('2026-08-26T10:00:00'), '2026-08-26');
});

test('toVnDateKey: chuỗi UTC tường minh (kèm Z) được quy đổi sang giờ VN', () => {
  assert.equal(toVnDateKey('2026-08-26T18:00:00Z'), '2026-08-27');
  assert.equal(toVnDateKey('2026-08-26T10:00:00Z'), '2026-08-26');
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

test('accumulatePurchaseOrderEvents dùng status=3 khi API danh sách không trả isDraft', () => {
  const map = new Map();
  const page = [
    { status: 3, purchaseDate: '2026-08-01T03:00:00', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 5 }] },
    { status: 4, purchaseDate: '2026-08-02T03:00:00', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 9 }] }
  ];
  accumulatePurchaseOrderEvents(map, page, new Set(['SP001']));
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-08-01', delta: 5 }]);
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
    { date: '2026-01-01', stock: 0 },
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

test('reconstructDailyStock quy tồn âm về 0 trong kết quả cuối ngày', () => {
  const result = reconstructDailyStock(-2, [], '2026-01-05', 1);
  assert.deepEqual(result, [
    { date: '2026-01-04', stock: 0 },
    { date: '2026-01-05', stock: 0 }
  ]);
});

test('accumulateReturnEvents trim mã nhưng không khớp khác chữ hoa thường', () => {
  const map = new Map();
  const validCodes = new Set(['SP001']);
  accumulateReturnEvents(map, [{
    status: 1,
    returnDate: '2026-08-01T03:00:00',
    returnDetails: [
      { productCode: ' SP001 ', quantity: 2 },
      { productCode: 'sp001', quantity: 9 }
    ]
  }], validCodes);
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-08-01', delta: 2 }]);
  assert.equal(map.has('sp001'), false);
});

test('API accumulators trim mã và chỉ giữ sự kiện trong khoảng ngày yêu cầu', () => {
  const validCodes = new Set(['SP001']);
  const invoiceMap = new Map();
  const purchaseMap = new Map();
  const returnMap = new Map();

  accumulateInvoiceEvents(invoiceMap, [
    { status: 1, purchaseDate: '2026-01-08T00:00:00Z', invoiceDetails: [{ productCode: 'SP001', quantity: 99 }] },
    { status: 1, purchaseDate: '2026-01-10T00:00:00Z', invoiceDetails: [{ productCode: ' SP001 ', quantity: 2 }] }
  ], validCodes, '2026-01-09', '2026-01-11');
  accumulatePurchaseOrderEvents(purchaseMap, [
    { isDraft: false, purchaseDate: '2026-01-10T00:00:00Z', purchaseOrderDetails: [{ productCode: ' SP001 ', quantity: 3 }] },
    { isDraft: false, purchaseDate: '2026-01-12T00:00:00Z', purchaseOrderDetails: [{ productCode: 'SP001', quantity: 99 }] }
  ], validCodes, '2026-01-09', '2026-01-11');
  accumulateReturnEvents(returnMap, [
    { status: 1, returnDate: '2026-01-10T00:00:00Z', returnDetails: [{ productCode: ' SP001 ', quantity: 4 }] }
  ], validCodes, '2026-01-09', '2026-01-11');

  assert.deepEqual(invoiceMap.get('SP001'), [{ dateKey: '2026-01-10', delta: -2 }]);
  assert.deepEqual(purchaseMap.get('SP001'), [{ dateKey: '2026-01-10', delta: 3 }]);
  assert.deepEqual(returnMap.get('SP001'), [{ dateKey: '2026-01-10', delta: 4 }]);
});

test('accumulateReturnEvents chuẩn hóa số lượng dạng chuỗi thành số', () => {
  const map = new Map();
  accumulateReturnEvents(map, [{
    status: 1,
    returnDate: '2026-01-10T00:00:00Z',
    returnDetails: [{ productCode: 'SP001', quantity: '3' }]
  }], new Set(['SP001']));
  assert.deepEqual(map.get('SP001'), [{ dateKey: '2026-01-10', delta: 3 }]);
});
