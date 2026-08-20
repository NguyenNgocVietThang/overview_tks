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

  const calls = { append: [], update: [], get: [], batchUpdate: [], getSheetId: [] };

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

  // sheetId SO gia lap cho tung tab (giong Google: tab dau tien co sheetId 0 —
  // gia tri 0 la "falsy", co chu y de bat loi kieu `if (!sheetId)`).
  const SHEET_IDS = {
    'Đơn vận chuyển':      0,
    'Chi tiết vận chuyển': 1234567,
    'Lịch sử trạng thái':  222,
    'Ảnh chứng từ':        333,
    'Sự cố vận chuyển':    444,
    'Danh mục xe':         555
  };

  vcClient.vcGetSheetId = async (sheetName) => {
    calls.getSheetId.push(sheetName);
    if (!(sheetName in SHEET_IDS)) {
      throw new Error(`[vcSheetsClient] Khong tim thay sheetId cho tab "${sheetName}"`);
    }
    return SHEET_IDS[sheetName];
  };

  vcClient.vcBatchUpdate = async (requests) => {
    calls.batchUpdate.push(requests);
  };

  return { repo, vcClient, calls, SHEET_IDS, sheetDataMap };
}

/**
 * "Ap dung" cac request updateCells len 1 ban sao rawRows — mo phong Google
 * Sheets de kiem chung ket qua CUOI CUNG tren sheet, khong chi kiem hinh dang
 * request. Cai dat theo dung ngu nghia tai lieu Sheets API:
 *   - GridRange 0-based, half-open [startRowIndex, endRowIndex)
 *   - fields='userEnteredValue' => CellData rong `{}` XOA gia tri o
 * @param {any[][]} rawRows  rows goc (hang 0 = header)
 * @param {object[]} requests
 * @returns {any[][]} rows sau khi ap dung
 */
function applyUpdateCells(rawRows, requests) {
  const grid = rawRows.map(r => r.slice());
  for (const req of requests) {
    const uc = req.updateCells;
    assert.ok(uc, 'moi request phai la updateCells');
    assert.equal(uc.fields, 'userEnteredValue', 'mask phai chi dong vao gia tri, khong dong vao dinh dang');
    const { sheetId, startRowIndex, endRowIndex, startColumnIndex, endColumnIndex } = uc.range;
    assert.equal(typeof sheetId, 'number', 'sheetId phai la SO');
    assert.equal(endRowIndex - startRowIndex, uc.rows.length, 'so dong du lieu phai khop chieu cao range');
    uc.rows.forEach((rowData, ri) => {
      assert.equal(
        rowData.values.length, endColumnIndex - startColumnIndex,
        'so o du lieu phai khop chieu rong range'
      );
      const absRow = startRowIndex + ri;
      while (grid.length <= absRow) grid.push([]);
      rowData.values.forEach((cell, ci) => {
        const absCol = startColumnIndex + ci;
        while (grid[absRow].length <= absCol) grid[absRow].push('');
        if (!cell.userEnteredValue) { grid[absRow][absCol] = ''; return; }
        const uev = cell.userEnteredValue;
        const keys = Object.keys(uev);
        assert.equal(keys.length, 1, 'userEnteredValue chi duoc co dung 1 kieu gia tri');
        assert.ok(
          ['numberValue', 'stringValue', 'boolValue', 'formulaValue'].includes(keys[0]),
          `kieu gia tri khong hop le: ${keys[0]}`
        );
        grid[absRow][absCol] = uev[keys[0]];
      });
    });
  }
  return grid;
}

const ITEM_HEADERS_FIXTURE = [
  'Mã vận đơn', 'Mã hàng', 'Tên hàng hóa',
  'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'
];

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

test('createOrder: nhan don MOI_TAO tu KiotViet ma khong tao dong hoac item trung', async () => {
  const orderId = 'VC-20260101-0001';
  const existingOrders = makeOrderRows([orderId, 'HD-SYNC-01', 'Mới tạo', 1]);
  const existingItems = [
    ['Mã vận đơn', 'Mã hàng', 'Tên hàng hóa', 'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'],
    [orderId, 'SP001', 'Sản phẩm đồng bộ', 2, '', 'Cái', '']
  ];
  const { repo, calls } = freshRepo({ orders: existingOrders, orderItems: existingItems });

  const result = await repo.createOrder({
    kiotviet_code: 'HD-SYNC-01',
    warehouse: 'Tân Phú',
    flow: 2,
    vehicle_id: 'XE-01',
    driver_name: 'Tài xế A',
    customer_name: 'Khách cập nhật',
    customer_phone: '0900000000',
    address: 'TP.HCM',
    items: [{ product_code: 'SP001', product_name: 'Sản phẩm đồng bộ', quantity_ordered: 2 }]
  });

  assert.equal(result.order_id, orderId);
  assert.equal(result.current_status, 'Đã in');
  assert.equal(result.warehouse, 'Tân Phú');
  assert.equal(result.items.length, 1);
  assert.equal(calls.append.filter(c => c.sheetName === 'Đơn vận chuyển').length, 0);
  assert.equal(calls.append.filter(c => c.sheetName === 'Chi tiết vận chuyển').length, 0);

  const orderUpdate = calls.update.find(c => c.sheetName === 'Đơn vận chuyển');
  assert.ok(orderUpdate, 'Phải cập nhật đúng dòng đơn đã đồng bộ');
  assert.equal(orderUpdate.rowIndex, 2);
  assert.equal(orderUpdate.row[0], orderId);
  assert.equal(orderUpdate.row[9], 'Đã in');

  const history = calls.append.find(c => c.sheetName === 'Lịch sử trạng thái');
  assert.ok(history, 'Phải ghi lịch sử nhận xử lý');
  assert.equal(history.row[2], 'Mới tạo');
  assert.equal(history.row[3], 'Đã in');
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

// ---------------------------------------------------------------------------
// Test: updateOrderItems — batch hoa vong lap ghi tuan tu (Task 4.2)
//
// LUU Y: toan bo test duoi day chay tren vcSheetsClient DA MOCK — KHONG co
// request that nao toi Google Sheets API, khong dung toi du lieu production.
// ---------------------------------------------------------------------------

const ITEMS_SHEET = 'Chi tiết vận chuyển';

/**
 * Fixture 4 dong du lieu, co xen ke don khac de bat loi ghi lech dong:
 *   dataRows[0] = VC-0001/SP-A  -> dong 2 tren Sheets -> startRowIndex 1
 *   dataRows[1] = VC-0001/SP-B  -> dong 3            -> startRowIndex 2
 *   dataRows[2] = VC-0002/SP-A  -> dong 4 (don KHAC) -> startRowIndex 3
 *   dataRows[3] = VC-0001/SP-C  -> dong 5 (dong CUOI)-> startRowIndex 4
 */
function makeItemRows() {
  return [
    ITEM_HEADERS_FIXTURE.slice(),
    ['VC-0001', 'SP-A', 'Hàng A', 10, 0,  'Thùng', ''],
    ['VC-0001', 'SP-B', 'Hàng B', 20, 0,  'Cái',   'ghi chú cũ'],
    ['VC-0002', 'SP-A', 'Hàng A', 30, 30, 'Thùng', 'đơn khác'],
    ['VC-0001', 'SP-C', 'Hàng C', 40, 0,  'Kg',    '']
  ];
}

test('updateOrderItems: gui DUNG 1 lan vcBatchUpdate cho nhieu item (khong phai N lan ghi tuan tu)', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [
    { product_code: 'SP-A', quantity_picked: 10 },
    { product_code: 'SP-B', quantity_picked: 15, notes: 'thiếu 5' },
    { product_code: 'SP-C', quantity_picked: 40 }
  ]);

  assert.equal(calls.batchUpdate.length, 1, 'phai gom vao DUNG 1 lan goi vcBatchUpdate');
  assert.equal(calls.batchUpdate[0].length, 3, '1 request updateCells cho moi item khop');
  assert.equal(calls.update.length, 0, 'khong duoc con dung vcUpdateRow tuan tu nua');
  assert.deepEqual(calls.getSheetId, [ITEMS_SHEET], 'chi tra cuu sheetId 1 lan, dung tab Chi tiet van chuyen');
});

test('updateOrderItems: sheetId lay dung tu vcGetSheetId va gan vao moi range', async () => {
  const { repo, calls, SHEET_IDS } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 5 }]);

  const req = calls.batchUpdate[0][0];
  assert.equal(req.updateCells.range.sheetId, SHEET_IDS[ITEMS_SHEET]);
  assert.equal(typeof req.updateCells.range.sheetId, 'number');
});

test('updateOrderItems: row-index math 0-based dung cho dong dau/giua/cuoi (co header)', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [
    { product_code: 'SP-A', quantity_picked: 1 }, // dataRows[0] -> dong tuyet doi 1
    { product_code: 'SP-B', quantity_picked: 2 }, // dataRows[1] -> dong tuyet doi 2
    { product_code: 'SP-C', quantity_picked: 3 }  // dataRows[3] -> dong tuyet doi 4 (dong cuoi)
  ]);

  const ranges = calls.batchUpdate[0].map(r => r.updateCells.range);
  assert.deepEqual(
    ranges.map(r => [r.startRowIndex, r.endRowIndex]),
    [[1, 2], [2, 3], [4, 5]],
    'startRowIndex = chi so trong dataRows + 1 (header chiem dong 0); range half-open 1 dong'
  );
  ranges.forEach(r => {
    assert.equal(r.startColumnIndex, 0, 'luon ghi tu cot A');
    assert.equal(r.endColumnIndex, 7, 'ghi het 7 cot cua schema orderItems');
  });
});

test('updateOrderItems: KHONG lech dong sang don khac va khong dung toi dong khong lien quan', async () => {
  const rows = makeItemRows();
  const { repo, calls } = freshRepo({ orderItems: rows.map(r => r.slice()) });

  await repo.updateOrderItems('VC-0001', [
    { product_code: 'SP-A', quantity_picked: 7 },
    { product_code: 'SP-C', quantity_picked: 40, notes: 'đủ' }
  ]);

  const after = applyUpdateCells(rows, calls.batchUpdate[0]);

  // Dong cua don VC-0002 (index 3) phai NGUYEN VEN
  assert.deepEqual(after[3], ['VC-0002', 'SP-A', 'Hàng A', 30, 30, 'Thùng', 'đơn khác']);
  // Dong SP-B cua chinh don do (khong nam trong patch) cung phai nguyen ven
  assert.deepEqual(after[2], ['VC-0001', 'SP-B', 'Hàng B', 20, 0, 'Cái', 'ghi chú cũ']);
  // Header nguyen ven
  assert.deepEqual(after[0], ITEM_HEADERS_FIXTURE);
  // 2 dong duoc sua dung gia tri, cac cot khac giu nguyen
  assert.deepEqual(after[1], ['VC-0001', 'SP-A', 'Hàng A', 10, 7, 'Thùng', '']);
  assert.deepEqual(after[4], ['VC-0001', 'SP-C', 'Hàng C', 40, 40, 'Kg', 'đủ']);
});

test('updateOrderItems: item khong ton tai bi bo qua, khong crash, khong sinh request', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [
    { product_code: 'SP-KHONG-CO', quantity_picked: 99 },
    { product_code: 'SP-B',        quantity_picked: 20 }
  ]);

  assert.equal(calls.batchUpdate.length, 1);
  assert.equal(calls.batchUpdate[0].length, 1, 'chi item tim thay moi sinh request');
  assert.equal(calls.batchUpdate[0][0].updateCells.range.startRowIndex, 2, 'dung dong cua SP-B');
});

test('updateOrderItems: khong item nao khop -> KHONG goi vcBatchUpdate va khong tra cuu sheetId', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-KHONG-CO', quantity_picked: 1 }]);

  assert.equal(calls.batchUpdate.length, 0);
  assert.equal(calls.getSheetId.length, 0, 'khong can sheetId khi khong co gi de ghi');
});

test('updateOrderItems: items rong -> khong doc sheet, khong goi API ghi nao', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', []);

  assert.equal(calls.batchUpdate.length, 0);
  assert.equal(calls.getSheetId.length, 0);
  assert.equal(calls.get.length, 0, 'khong can doc sheet khi khong co item nao');
});

test('updateOrderItems: sheet rong (chi header / khong co dong nao) -> khong goi vcBatchUpdate', async () => {
  const { repo, calls } = freshRepo({ orderItems: [ITEM_HEADERS_FIXTURE.slice()] });
  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 1 }]);
  assert.equal(calls.batchUpdate.length, 0);

  const empty = freshRepo({ orderItems: [] });
  await empty.repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 1 }]);
  assert.equal(empty.calls.batchUpdate.length, 0);
});

test('updateOrderItems: cap nhat CHI notes (khong co quantity_picked) khong lam mat so luong da nhat', async () => {
  const rows = makeItemRows();
  const { repo, calls } = freshRepo({ orderItems: rows.map(r => r.slice()) });

  await repo.updateOrderItems('VC-0002', [{ product_code: 'SP-A', notes: 'ghi chú mới' }]);

  const after = applyUpdateCells(rows, calls.batchUpdate[0]);
  assert.deepEqual(after[3], ['VC-0002', 'SP-A', 'Hàng A', 30, 30, 'Thùng', 'ghi chú mới']);
});

test('updateOrderItems: quantity_picked dang chuoi so duoc ghi thanh SO (giu hanh vi USER_ENTERED cu)', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });

  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: '12' }]);

  const cells = calls.batchUpdate[0][0].updateCells.rows[0].values;
  assert.deepEqual(cells[4], { userEnteredValue: { numberValue: 12 } });
});

test('updateOrderItems: gia tri VAN BAN giu nguyen kieu chuoi (khong bi suy dien thanh so)', async () => {
  const rows = [
    ITEM_HEADERS_FIXTURE.slice(),
    // Ma hang "0012" la VAN BAN tren sheet — USER_ENTERED se bien no thanh so 12,
    // updateCells ghi tuong minh stringValue nen giu nguyen.
    ['VC-0001', '0012', 'Hàng số', 10, 0, 'Thùng', '']
  ];
  const { repo, calls } = freshRepo({ orderItems: rows.map(r => r.slice()) });

  await repo.updateOrderItems('VC-0001', [{ product_code: '0012', quantity_picked: 3 }]);

  const cells = calls.batchUpdate[0][0].updateCells.rows[0].values;
  assert.deepEqual(cells[1], { userEnteredValue: { stringValue: '0012' } }, 'ma hang van la VAN BAN');
  assert.deepEqual(cells[3], { userEnteredValue: { numberValue: 10 } }, 'so luong dat van la SO');

  const after = applyUpdateCells(rows, calls.batchUpdate[0]);
  assert.deepEqual(after[1], ['VC-0001', '0012', 'Hàng số', 10, 3, 'Thùng', '']);
});

test('updateOrderItems: dong ngan (thieu cot cuoi) duoc pad du 7 cot va range khop chieu rong', async () => {
  const rows = [
    ITEM_HEADERS_FIXTURE.slice(),
    ['VC-0001', 'SP-A', 'Hàng A', 10] // Sheets cat bo cac o trong o cuoi dong
  ];
  const { repo, calls } = freshRepo({ orderItems: rows.map(r => r.slice()) });

  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 4, notes: 'x' }]);

  const uc = calls.batchUpdate[0][0].updateCells;
  assert.equal(uc.range.endColumnIndex, 7);
  assert.equal(uc.rows[0].values.length, 7);
  // O trong -> CellData rong {} (XOA gia tri o, khong ghi chuoi rong)
  assert.deepEqual(uc.rows[0].values[5], {}, 'cot Don vi tinh trong -> CellData rong');

  const after = applyUpdateCells(rows, calls.batchUpdate[0]);
  assert.deepEqual(after[1], ['VC-0001', 'SP-A', 'Hàng A', 10, 4, '', 'x']);
});

test('updateOrderItems: dong DAI hon schema (co cot phu) khong lam mat cot phu', async () => {
  const rows = [
    ITEM_HEADERS_FIXTURE.concat(['Cột phụ']),
    ['VC-0001', 'SP-A', 'Hàng A', 10, 0, 'Thùng', '', 'giữ nguyên']
  ];
  const { repo, calls } = freshRepo({ orderItems: rows.map(r => r.slice()) });

  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 9 }]);

  const uc = calls.batchUpdate[0][0].updateCells;
  assert.equal(uc.range.endColumnIndex, 8, 'range phu het ca cot phu de ghi lai nguyen ven');
  const after = applyUpdateCells(rows, calls.batchUpdate[0]);
  assert.deepEqual(after[1], ['VC-0001', 'SP-A', 'Hàng A', 10, 9, 'Thùng', '', 'giữ nguyên']);
});

test('updateOrderItems: mask fields chi dong vao userEnteredValue (khong xoa dinh dang)', async () => {
  const { repo, calls } = freshRepo({ orderItems: makeItemRows() });
  await repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 1 }]);

  calls.batchUpdate[0].forEach(req => {
    assert.equal(req.updateCells.fields, 'userEnteredValue');
    // Khong duoc gui userEnteredFormat/note/dataValidation... (se bi xoa neu vao mask)
    req.updateCells.rows[0].values.forEach(cell => {
      assert.deepEqual(Object.keys(cell).filter(k => k !== 'userEnteredValue'), []);
    });
  });
});

test('updateOrderItems: loi tu vcBatchUpdate duoc nem ra ngoai (khong nuot am tham)', async () => {
  const { repo, vcClient } = freshRepo({ orderItems: makeItemRows() });
  vcClient.vcBatchUpdate = async () => { throw new Error('Google API 500'); };

  await assert.rejects(
    () => repo.updateOrderItems('VC-0001', [{ product_code: 'SP-A', quantity_picked: 1 }]),
    /Google API 500/
  );
});

test('toCellData: anh xa kieu gia tri dung dac ta CellData', () => {
  const { toCellData } = require('./vcOrderRepository').__test__;
  assert.deepEqual(toCellData(0),        { userEnteredValue: { numberValue: 0 } });
  assert.deepEqual(toCellData(12.5),     { userEnteredValue: { numberValue: 12.5 } });
  assert.deepEqual(toCellData('abc'),    { userEnteredValue: { stringValue: 'abc' } });
  assert.deepEqual(toCellData('=SUM(A1)'), { userEnteredValue: { stringValue: '=SUM(A1)' } }, 'khong bien thanh cong thuc');
  assert.deepEqual(toCellData(true),     { userEnteredValue: { boolValue: true } });
  assert.deepEqual(toCellData(''),          {}, 'o trong -> XOA gia tri');
  assert.deepEqual(toCellData(null),        {});
  assert.deepEqual(toCellData(undefined),   {});
  assert.deepEqual(toCellData(NaN),      { userEnteredValue: { stringValue: 'NaN' } }, 'NaN khong hop le voi numberValue');
});
