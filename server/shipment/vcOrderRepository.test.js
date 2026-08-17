'use strict';
// Thiet lap bien moi truong truoc khi require bat ky module nao trong du an
process.env.SPREADSHEET_ID              = process.env.SPREADSHEET_ID              || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET                  = process.env.JWT_SECRET                  || 'test-jwt-secret';
process.env.VC_SPREADSHEET_ID           = process.env.VC_SPREADSHEET_ID           || 'test-vc-spreadsheet-id';

const test   = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Factory: tao fresh instance repository voi vcSheetsClient da mock
// (theo pattern cua invoiceStatusService.test.js va dashboardData.test.js)
// ---------------------------------------------------------------------------

function makeOrderRows(...ids) {
  // Tao rows co dung header + data cho tab Don van chuyen
  const header = [
    'Mã vận đơn', 'Mã hóa đơn KiotViet', 'Kho xuất', 'Luồng giao hàng',
    'Mã xe', 'Tên tài xế', 'Tên khách hàng', 'Số điện thoại',
    'Địa chỉ nhận hàng', 'Trạng thái hiện tại', 'Giữ hàng tàu hỏa',
    'Tiền cước', 'Ghi chú cước', 'Thời gian tạo', 'Cập nhật lần cuối'
  ];
  const rows = [header];
  ids.forEach(([id, kiotvietCode, status, flow]) => {
    rows.push([id, kiotvietCode || '', 'An Khánh', flow || '1', '', '', '', '', '', status || 'Đã in', '', '', '', '2026-01-01', '2026-01-01']);
  });
  return rows;
}

function makeEmptySheetRows(headers) {
  return [headers];
}

/**
 * Tao fresh repository voi vcSheetsClient da duoc mock.
 * @param {object} mockData  { orders?, orderItems?, history?, attachments?, exceptions?, vehicles? }
 * @returns {{ repo, vcClient, calls }}
 */
function freshRepo(mockData = {}) {
  // Xoa cache trong require
  const resolveIds = [
    './vcOrderRepository',
    '../sheets/vcSheetsClient',
    './orderStateMachine'
  ];
  resolveIds.forEach(id => {
    try { delete require.cache[require.resolve(id)]; } catch (e) { /* ignore */ }
  });

  // Xoa ca config de tranh loi required env
  try { delete require.cache[require.resolve('../config')]; } catch (e) {}

  const repo      = require('./vcOrderRepository');
  const vcClient  = require('../sheets/vcSheetsClient');

  const calls = { append: [], update: [], get: [] };

  // Default empty sheet data
  const ITEM_HEADERS = ['Mã vận đơn', 'Mã hàng', 'Tên hàng hóa', 'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'];
  const HIST_HEADERS = ['Mã lịch sử', 'Mã vận đơn', 'Trạng thái trước', 'Trạng thái mới', 'Người thực hiện', 'Thời gian cập nhật', 'Ghi chú'];
  const ATT_HEADERS  = ['Mã chứng từ', 'Mã vận đơn', 'Loại chứng từ', 'Google Drive File ID', 'Link xem ảnh', 'Link thumbnail', 'Người tải lên', 'Thời gian tải lên', 'Nội dung OCR'];
  const EXC_HEADERS  = ['Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố', 'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý', 'Thời gian báo cáo', 'Thời gian xử lý xong'];
  const VEH_HEADERS  = ['Mã xe', 'Biển số xe', 'Loại xe', 'Tài xế mặc định', 'Tải trọng tối đa (kg)', 'Ghi chú'];

  const sheetDataMap = {
    'Đơn vận chuyển':    mockData.orders     || [[]],
    'Chi tiết vận chuyển': mockData.orderItems || [ITEM_HEADERS],
    'Lịch sử trạng thái': mockData.history    || [HIST_HEADERS],
    'Ảnh chứng từ':      mockData.attachments || [ATT_HEADERS],
    'Sự cố vận chuyển':  mockData.exceptions  || [EXC_HEADERS],
    'Danh mục xe':       mockData.vehicles    || [VEH_HEADERS]
  };

  vcClient.vcGetValues = async (sheetName) => {
    calls.get.push(sheetName);
    return sheetDataMap[sheetName] || [[]];
  };

  vcClient.vcGetMultipleSheetValues = async (sheetNames) => {
    const result = {};
    sheetNames.forEach(name => { result[name] = sheetDataMap[name] || [[]]; });
    return result;
  };

  vcClient.vcAppendRow = async (sheetName, row) => {
    calls.append.push({ sheetName, row });
    // Cap nhat mock data de cac doc tiep theo thay dong moi
    if (!sheetDataMap[sheetName] || sheetDataMap[sheetName].length === 0) {
      sheetDataMap[sheetName] = [[]];
    }
    sheetDataMap[sheetName].push(row);
  };

  vcClient.vcUpdateRow = async (sheetName, rowIndex, row) => {
    calls.update.push({ sheetName, rowIndex, row });
    if (sheetDataMap[sheetName] && rowIndex <= sheetDataMap[sheetName].length) {
      sheetDataMap[sheetName][rowIndex - 1] = row;
    }
  };

  return { repo, vcClient, calls };
}

// ---------------------------------------------------------------------------
// Test: sinh order_id tang dan trong cung ngay
// ---------------------------------------------------------------------------

test('generateOrderId: tang dan trong cung ngay, bat dau tu 0001', () => {
  const { repo } = freshRepo();
  const { generateOrderId } = repo.__test__;

  // Chua co don nao hom nay
  const id1 = generateOrderId([[]]);
  const dateStr = id1.split('-').slice(1, 3).join('-'); // YYYYMMDD
  assert.match(id1, /^VC-\d{8}-0001$/);

  // Da co 1 don hom nay
  const existingRows = [
    ['Mã vận đơn'],
    [`VC-${id1.split('-')[1]}-0001`, 'HD001']
  ];
  const id2 = generateOrderId(existingRows);
  assert.match(id2, /^VC-\d{8}-0002$/);

  // Da co 3 don hom nay
  const existingRows2 = [
    ['Mã vận đơn'],
    [`VC-${id1.split('-')[1]}-0001`],
    [`VC-${id1.split('-')[1]}-0002`],
    [`VC-${id1.split('-')[1]}-0003`]
  ];
  const id3 = generateOrderId(existingRows2);
  assert.match(id3, /^VC-\d{8}-0004$/);
});

// ---------------------------------------------------------------------------
// Test: rowsToObjects — anh xa header tieng Viet sang fieldKey
// ---------------------------------------------------------------------------

test('rowsToObjects: anh xa chinh xac theo header tieng Viet', () => {
  const { rowsToObjects } = require('./vcOrderRepository').__test__;
  const schemaHeaders  = ['Mã vận đơn', 'Trạng thái hiện tại'];
  const schemaFieldKeys = ['order_id', 'current_status'];

  const rawRows = [
    ['Mã vận đơn', 'Trạng thái hiện tại'],
    ['VC-20260101-0001', 'Đang giao'],
    ['VC-20260101-0002', 'Đã giao']
  ];

  const result = rowsToObjects(schemaHeaders, schemaFieldKeys, rawRows);
  assert.equal(result.length, 2);
  assert.equal(result[0].order_id, 'VC-20260101-0001');
  assert.equal(result[0].current_status, 'Đang giao');
  assert.equal(result[1].current_status, 'Đã giao');
});

test('rowsToObjects: bo qua dong rong', () => {
  const { rowsToObjects } = require('./vcOrderRepository').__test__;
  const rawRows = [['Mã vận đơn'], ['VC-001'], [], ['', '']];
  const result  = rowsToObjects(['Mã vận đơn'], ['order_id'], rawRows);
  assert.equal(result.length, 1);
});

// ---------------------------------------------------------------------------
// Test: createOrder — kiem tra DUPLICATE_ORDER
// ---------------------------------------------------------------------------

test('createOrder: nem DUPLICATE_ORDER neu da ton tai don cho kiotviet_code', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD001', 'Đang giao', 1]);
  const { repo } = freshRepo({ orders: existingOrders });

  await assert.rejects(
    () => repo.createOrder({
      kiotviet_code: 'HD001',
      warehouse: 'An Khánh',
      flow: 1,
      customer_name: 'Test', customer_phone: '', address: '', items: []
    }),
    err => err.statusCode === 409 && err.code === 'DUPLICATE_ORDER'
  );
});

test('createOrder: cho phep tao lai don neu don cu da DA_HUY', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD001', 'Đã hủy', 1]);
  const { repo, calls } = freshRepo({ orders: existingOrders });

  await repo.createOrder({
    kiotviet_code: 'HD001',
    warehouse: 'An Khánh',
    flow: 1,
    customer_name: 'Test', customer_phone: '', address: '', items: []
  });

  // Phai co it nhat 1 append vao Don van chuyen
  const orderAppend = calls.append.find(c => c.sheetName === 'Đơn vận chuyển');
  assert.ok(orderAppend, 'Phai append dong vao tab Don van chuyen');
});

test('createOrder: ghi lich su trang thai voi to_status = Da in', async (t) => {
  const { repo, calls } = freshRepo({ orders: [[]] });

  await repo.createOrder({
    kiotviet_code: 'HD002', warehouse: 'An Khánh', flow: 1,
    customer_name: 'KH A', customer_phone: '0123', address: 'HN', items: []
  });

  const histAppend = calls.append.find(c => c.sheetName === 'Lịch sử trạng thái');
  assert.ok(histAppend, 'Phai co dong lich su trang thai');
  // to_status la 'Da in' (chi so 3 trong fieldKeys history: from, to, ...)
  // Kiem tra gia tri trong row tai vi tri fieldKey to_status (index 3)
  assert.equal(histAppend.row[3], 'Đã in');
});

// ---------------------------------------------------------------------------
// Test: transitionOrderStatus — INVALID_TRANSITION
// ---------------------------------------------------------------------------

test('transitionOrderStatus: throw INVALID_TRANSITION khi chuyen trang thai sai', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD003', 'Mới tạo', 1]);
  const { repo } = freshRepo({ orders: existingOrders });

  await assert.rejects(
    () => repo.transitionOrderStatus('VC-20260101-0001', 'Đang giao', { changedBy: 'user1' }),
    err => err.statusCode === 400 && (err.code === 'INVALID_TRANSITION' || err.code === 'INVALID_TRANSITION_FOR_FLOW')
  );
});

test('transitionOrderStatus: throw ORDER_NOT_FOUND neu khong ton tai', async (t) => {
  const { repo } = freshRepo({ orders: [[]] });

  await assert.rejects(
    () => repo.transitionOrderStatus('VC-KHONG-TON-TAI', 'Đã in', { changedBy: 'user1' }),
    err => err.statusCode === 404 && err.code === 'ORDER_NOT_FOUND'
  );
});

test('transitionOrderStatus: cap nhat trang thai va ghi lich su khi hop le', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD004', 'Đã in', 1]);
  const { repo, calls } = freshRepo({ orders: existingOrders });

  const updated = await repo.transitionOrderStatus('VC-20260101-0001', 'Đã nhặt hàng', { changedBy: 'admin' });
  assert.equal(updated.current_status, 'Đã nhặt hàng');

  const histAppend = calls.append.find(c => c.sheetName === 'Lịch sử trạng thái');
  assert.ok(histAppend, 'Phai ghi lich su trang thai');
  assert.equal(histAppend.row[2], 'Đã in');       // from_status
  assert.equal(histAppend.row[3], 'Đã nhặt hàng'); // to_status
  assert.equal(histAppend.row[4], 'admin');          // changed_by
});

// ---------------------------------------------------------------------------
// Test: createException
// ---------------------------------------------------------------------------

test('createException: chuyen sang SU_CO va ghi dong exception', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD005', 'Đang giao', 1]);
  const { repo, calls } = freshRepo({ orders: existingOrders });

  const { exception, order } = await repo.createException('VC-20260101-0001', {
    type: 'KHONG_LIEN_LAC',
    description: 'Khong lien lac duoc khach hang',
    changedBy: 'driver1'
  });

  assert.equal(order.current_status, 'Sự cố');
  assert.equal(exception.status, 'OPEN');
  assert.ok(exception.exception_id.startsWith('EXC-'));

  // Lich su phai chua prev_status
  const histAppend = calls.append.find(c => c.sheetName === 'Lịch sử trạng thái');
  assert.ok(histAppend.row[6].startsWith('prev_status:'));
});

test('createException: throw INVALID_TRANSITION khi trang thai khong hop le', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD006', 'Mới tạo', 1]);
  const { repo } = freshRepo({ orders: existingOrders });

  await assert.rejects(
    () => repo.createException('VC-20260101-0001', { type: 'TEST', description: 'test', changedBy: 'user' }),
    err => err.statusCode === 400 && err.code === 'INVALID_TRANSITION'
  );
});

// ---------------------------------------------------------------------------
// Test: resolveException
// ---------------------------------------------------------------------------

test('resolveException: EXCEPTION_ALREADY_RESOLVED neu da xu ly', async (t) => {
  const EXC_HEADERS = ['Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố', 'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý', 'Thời gian báo cáo', 'Thời gian xử lý xong'];
  const exceptions = [
    EXC_HEADERS,
    ['EXC-001', 'VC-001', 'Đang giao', 'KHONG_GIAO', 'mo ta', 'admin', 'RESOLVED', '2026-01-01', '2026-01-02']
  ];
  const { repo } = freshRepo({ exceptions });

  await assert.rejects(
    () => repo.resolveException('EXC-001', { resolution: 'RESUME', resolver: 'admin' }),
    err => err.statusCode === 409 && err.code === 'EXCEPTION_ALREADY_RESOLVED'
  );
});

test('resolveException: EXCEPTION_NOT_FOUND neu khong tim thay', async (t) => {
  const { repo } = freshRepo({});

  await assert.rejects(
    () => repo.resolveException('EXC-KHONG-TON-TAI', { resolution: 'RESUME', resolver: 'admin' }),
    err => err.statusCode === 404 && err.code === 'EXCEPTION_NOT_FOUND'
  );
});

test('resolveException: EXCEPTION_PREV_STATUS_UNKNOWN khi khong tim thay prev_status trong lich su (khong doan mo)', async (t) => {
  const EXC_HEADERS = ['Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố', 'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý', 'Thời gian báo cáo', 'Thời gian xử lý xong'];
  const exceptions = [
    EXC_HEADERS,
    ['EXC-002', 'VC-002', 'Đang giao', 'KHONG_GIAO', 'mo ta', '', 'OPEN', '2026-01-01', '']
  ];
  // Khong co dong lich su nao chua "prev_status:" cho don VC-002
  const { repo } = freshRepo({ exceptions, history: [['Mã lịch sử', 'Mã vận đơn', 'Trạng thái trước', 'Trạng thái mới', 'Người thực hiện', 'Thời gian cập nhật', 'Ghi chú']] });

  await assert.rejects(
    () => repo.resolveException('EXC-002', { resolution: 'RESUME', resolver: 'admin' }),
    err => err.statusCode === 409 && err.code === 'EXCEPTION_PREV_STATUS_UNKNOWN'
  );
});

// ---------------------------------------------------------------------------
// Test: transitionOrderStatus — chan bypass qua nhanh SU_CO
// ---------------------------------------------------------------------------

test('transitionOrderStatus: chan USE_EXCEPTION_ENDPOINT khi to_status la Su co', async (t) => {
  const existingOrders = makeOrderRows(['VC-20260101-0001', 'HD007', 'Đang giao', 1]);
  const { repo } = freshRepo({ orders: existingOrders });

  await assert.rejects(
    () => repo.transitionOrderStatus('VC-20260101-0001', 'Sự cố', { changedBy: 'user1' }),
    err => err.statusCode === 400 && err.code === 'USE_EXCEPTION_ENDPOINT'
  );
});

// ---------------------------------------------------------------------------
// Test: createOrder — dung do sinh order_id (rai rac tao don dong thoi)
// ---------------------------------------------------------------------------

test('createOrder: nem ORDER_ID_COLLISION neu phat hien trung order_id sau khi ghi', async (t) => {
  const { repo, vcClient } = freshRepo({ orders: [[]] });

  // Gia lap 1 request createOrder khac da chen 1 dong trung order_id ngay
  // truoc khi request nay doc lai de kiem tra (rai rac tao don dong thoi).
  const originalAppend = vcClient.vcAppendRow;
  vcClient.vcAppendRow = async (sheetName, row) => {
    await originalAppend(sheetName, row);
    if (sheetName === 'Đơn vận chuyển') {
      // Them 1 dong "doi thu canh tranh" cung order_id ngay sau dong vua ghi
      await originalAppend(sheetName, row);
    }
  };

  await assert.rejects(
    () => repo.createOrder({
      kiotviet_code: 'HD008', warehouse: 'An Khánh', flow: 1,
      customer_name: 'Test', customer_phone: '', address: '', items: []
    }),
    err => err.statusCode === 409 && err.code === 'ORDER_ID_COLLISION'
  );
});
