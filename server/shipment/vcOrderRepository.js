// ==========================================
// VC ORDER REPOSITORY — lop truy cap du lieu cho Spreadsheet van chuyen rieng.
//
// Boc vcSheetsClient thanh cac ham nghiep vu theo ten cot (khong rai index
// cot trong route handler). Moi ham doc truoc toan bo tab lien quan, tim
// rowIndex, roi ghi vao hang do — khong co transaction hay lock nhu RDBMS.
//
// !! CANH BAO RACE CONDITION !!
// Google Sheets khong ho tro transaction hay pessimistic locking. Neu hai
// request dong thoi cung sua 1 don (vi du 2 nguoi bam "Cap nhat trang thai"
// cung luc), co the xay ra race: ca hai doc rowIndex giong nhau, roi ghi de
// len nhau. Voi quy mo ~200 don/ngay va moi tac vu ghi hoan thanh trong <1s,
// xac suat xung dot rat thap va chap nhan duoc (tuong tu cach WebhookQueue.gs
// xu ly trong Apps Script). Neu can chinh xac tuyet doi trong tuong lai,
// can chuyen sang RDBMS co ho tro SELECT FOR UPDATE.
// ==========================================
'use strict';

const CONFIG = require('../config');
const vcClient = require('../sheets/vcSheetsClient');
const { ORDER_STATUS, canTransition, describeTransition } = require('./orderStateMachine');

// ---------------------------------------------------------------------------
// Schema anh xa header tieng Viet <-> fieldKey tieng Anh
// Khop chinh xac voi VC_SCHEMAS trong server/scripts/setupVcSheet.js
// ---------------------------------------------------------------------------

const SCHEMA = {
  orders: {
    sheetName: CONFIG.VC_SHEET_ORDERS,
    headers: [
      'Mã vận đơn', 'Mã hóa đơn KiotViet', 'Kho xuất', 'Luồng giao hàng',
      'Mã xe', 'Tên tài xế', 'Tên khách hàng', 'Số điện thoại',
      'Địa chỉ nhận hàng', 'Trạng thái hiện tại', 'Giữ hàng tàu hỏa',
      'Tiền cước', 'Ghi chú cước', 'Thời gian tạo', 'Cập nhật lần cuối'
    ],
    fieldKeys: [
      'order_id', 'kiotviet_code', 'warehouse', 'flow',
      'vehicle_id', 'driver_name', 'customer_name', 'customer_phone',
      'address', 'current_status', 'is_transit_held',
      'freight_amount', 'freight_note', 'created_at', 'updated_at'
    ]
  },
  orderItems: {
    sheetName: CONFIG.VC_SHEET_ORDER_ITEMS,
    headers: [
      'Mã vận đơn', 'Mã hàng', 'Tên hàng hóa',
      'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'
    ],
    fieldKeys: [
      'order_id', 'product_code', 'product_name',
      'quantity_ordered', 'quantity_picked', 'unit', 'notes'
    ]
  },
  statusHistory: {
    sheetName: CONFIG.VC_SHEET_STATUS_HISTORY,
    headers: [
      'Mã lịch sử', 'Mã vận đơn', 'Trạng thái trước', 'Trạng thái mới',
      'Người thực hiện', 'Thời gian cập nhật', 'Ghi chú'
    ],
    fieldKeys: [
      'history_id', 'order_id', 'from_status', 'to_status',
      'changed_by', 'changed_at', 'note'
    ]
  },
  attachments: {
    sheetName: CONFIG.VC_SHEET_ATTACHMENTS,
    headers: [
      'Mã chứng từ', 'Mã vận đơn', 'Loại chứng từ', 'Google Drive File ID',
      'Link xem ảnh', 'Link thumbnail', 'Người tải lên', 'Thời gian tải lên', 'Nội dung OCR'
    ],
    fieldKeys: [
      'attachment_id', 'order_id', 'type', 'drive_file_id',
      'drive_view_url', 'drive_thumbnail_url', 'uploaded_by', 'uploaded_at', 'ocr_text'
    ]
  },
  exceptions: {
    sheetName: CONFIG.VC_SHEET_EXCEPTIONS,
    headers: [
      'Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố',
      'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý',
      'Thời gian báo cáo', 'Thời gian xử lý xong'
    ],
    fieldKeys: [
      'exception_id', 'order_id', 'stage', 'type',
      'description', 'resolver', 'status',
      'created_at', 'resolved_at'
    ]
  },
  vehicles: {
    sheetName: CONFIG.VC_SHEET_VEHICLES,
    headers: [
      'Mã xe', 'Biển số xe', 'Loại xe',
      'Tài xế mặc định', 'Tải trọng tối đa (kg)', 'Ghi chú'
    ],
    fieldKeys: [
      'vehicle_id', 'plate_number', 'vehicle_type',
      'default_driver', 'max_weight', 'notes'
    ]
  }
};

// ---------------------------------------------------------------------------
// Tien ich anh xa row <-> object
// ---------------------------------------------------------------------------

/**
 * Chuyen mang gia tri thu cot (tu Sheets API) thanh object JS voi fieldKey.
 * Dung indexing theo header name de khong hard-code so cot.
 *
 * @param {string[]} schemaHeaders  Danh sach header chinh xac tu SCHEMA
 * @param {string[]} schemaFieldKeys Danh sach fieldKey tuong ung
 * @param {any[][]} rawRows         Rows tu vcGetValues (hang 0 = header thuc te)
 * @returns {object[]}
 */
function rowsToObjects(schemaHeaders, schemaFieldKeys, rawRows) {
  if (!rawRows || rawRows.length < 1) return [];
  const [actualHeaders, ...dataRows] = rawRows;

  // Xay dung map: fieldKey -> col index trong rawRows
  const colMap = {};
  schemaFieldKeys.forEach((key, si) => {
    const headerName = schemaHeaders[si];
    const ci = actualHeaders.findIndex(h => String(h || '').trim() === headerName);
    colMap[key] = ci;
  });

  return dataRows
    .filter(row => row && row.some(v => v !== '' && v !== undefined && v !== null))
    .map(row => {
      const obj = {};
      schemaFieldKeys.forEach(key => {
        const ci = colMap[key];
        obj[key] = ci >= 0 && ci < row.length ? row[ci] : '';
      });
      return obj;
    });
}

/**
 * Chuyen object JS (fieldKey) thanh mang gia tri theo thu tu cot trong sheet.
 *
 * @param {string[]} schemaFieldKeys
 * @param {object}   obj
 * @returns {any[]}
 */
function objectToRow(schemaFieldKeys, obj) {
  return schemaFieldKeys.map(key => (obj[key] !== undefined && obj[key] !== null ? obj[key] : ''));
}

// ---------------------------------------------------------------------------
// Sinh ID (xem muc 5, diem 2 cua spec)
// ---------------------------------------------------------------------------

/**
 * Lay chuoi YYYYMMDD hien tai theo gio Viet Nam.
 * @returns {string}  vd: "20260817"
 */
function todayVN() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).replace(/-/g, '');
}

/**
 * Sinh order_id ke tiep trong ngay.
 * Dinh dang: VC-YYYYMMDD-XXXX (XXXX: 4 chu so, bat dau tu 0001).
 *
 * @param {any[][]} existingOrderRows  Raw rows tu tab 'Don van chuyen' (bao gom header)
 * @returns {string}
 */
function generateOrderId(existingOrderRows) {
  const dateStr = todayVN();
  const prefix = `VC-${dateStr}-`;

  let maxNum = 0;
  const [, ...dataRows] = existingOrderRows.length ? existingOrderRows : [[]];
  dataRows.forEach(row => {
    const id = String(row[0] || '');
    if (id.startsWith(prefix)) {
      const num = parseInt(id.slice(prefix.length), 10);
      if (!isNaN(num) && num > maxNum) maxNum = num;
    }
  });

  return `${prefix}${String(maxNum + 1).padStart(4, '0')}`;
}

/**
 * Sinh ID tong quat cho history/attachment/exception.
 * Dinh dang: <PREFIX>-<timestamp>-<4 hex ngau nhien>
 * (khong can dep, chi can duy nhat — khong phai khoa hien thi cho nguoi dung)
 *
 * @param {string} prefix  vd: "HST", "ATT", "EXC"
 * @returns {string}
 */
function generateId(prefix) {
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${prefix}-${Date.now()}-${hex}`;
}

// ---------------------------------------------------------------------------
// Tien ich kiem tra loi
// ---------------------------------------------------------------------------

function makeError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// getOrders — danh sach don, filter tuy chon
// ---------------------------------------------------------------------------

/**
 * @param {{ warehouse?, flow?, status?, driverName?, dateFrom?, dateTo? }} filter
 * @returns {Promise<object[]>}
 */
async function getOrders(filter = {}) {
  const { warehouse, flow, status, driverName, dateFrom, dateTo } = filter;
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  const orders = rowsToObjects(SCHEMA.orders.headers, SCHEMA.orders.fieldKeys, rawRows);

  return orders.filter(o => {
    if (warehouse   && o.warehouse    !== warehouse)   return false;
    if (flow        && String(o.flow) !== String(flow)) return false;
    if (status      && o.current_status !== status)    return false;
    if (driverName  && o.driver_name  !== driverName)  return false;
    if (dateFrom    && o.created_at   < dateFrom)       return false;
    if (dateTo      && o.created_at   > dateTo)         return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// getOrderById — chi tiet 1 don (join cac tab lien quan)
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
async function getOrderById(orderId) {
  // Dung vcGetMultipleSheetValues (1 lan goi API) thay vi goi rieng le tung tab
  const sheetData = await vcClient.vcGetMultipleSheetValues([
    CONFIG.VC_SHEET_ORDERS,
    CONFIG.VC_SHEET_ORDER_ITEMS,
    CONFIG.VC_SHEET_STATUS_HISTORY,
    CONFIG.VC_SHEET_ATTACHMENTS,
    CONFIG.VC_SHEET_EXCEPTIONS
  ]);

  const orders = rowsToObjects(SCHEMA.orders.headers, SCHEMA.orders.fieldKeys, sheetData[CONFIG.VC_SHEET_ORDERS]);
  const order  = orders.find(o => o.order_id === orderId);
  if (!order) return null;

  const items = rowsToObjects(SCHEMA.orderItems.headers, SCHEMA.orderItems.fieldKeys, sheetData[CONFIG.VC_SHEET_ORDER_ITEMS])
    .filter(i => i.order_id === orderId);

  const history = rowsToObjects(SCHEMA.statusHistory.headers, SCHEMA.statusHistory.fieldKeys, sheetData[CONFIG.VC_SHEET_STATUS_HISTORY])
    .filter(h => h.order_id === orderId)
    .sort((a, b) => String(a.changed_at).localeCompare(String(b.changed_at)));

  const attachments = rowsToObjects(SCHEMA.attachments.headers, SCHEMA.attachments.fieldKeys, sheetData[CONFIG.VC_SHEET_ATTACHMENTS])
    .filter(a => a.order_id === orderId);

  const exceptions = rowsToObjects(SCHEMA.exceptions.headers, SCHEMA.exceptions.fieldKeys, sheetData[CONFIG.VC_SHEET_EXCEPTIONS])
    .filter(e => e.order_id === orderId);

  return { ...order, items, history, attachments, exceptions };
}

// ---------------------------------------------------------------------------
// createOrder — tao don moi (bat dau tu DA_IN theo spec 1B)
// ---------------------------------------------------------------------------

/**
 * @param {{ kiotviet_code, warehouse, flow, vehicle_id?, driver_name?,
 *           customer_name, customer_phone, address, items[] }} params
 * @returns {Promise<object>}  Order vua tao kem items
 */
async function createOrder({ kiotviet_code, warehouse, flow, vehicle_id, driver_name,
                              customer_name, customer_phone, address, items }) {
  // Doc tat ca du lieu can thiet truoc khi ghi
  const rawOrders = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  const existingOrders = rowsToObjects(SCHEMA.orders.headers, SCHEMA.orders.fieldKeys, rawOrders);

  // Don do webhook KiotViet tao truoc o trang thai MOI_TAO se duoc giao cho
  // quy trinh van chuyen khi nguoi dung bam tao/in don. Khong tao dong trung.
  const existing = existingOrders.find(o => o.kiotviet_code === kiotviet_code);
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

  if (existing && existing.current_status === ORDER_STATUS.MOI_TAO) {
    const preferInput = (value, fallback) => (
      value !== undefined && value !== null && value !== '' ? value : (fallback || '')
    );
    const claimedOrder = {
      ...existing,
      warehouse:      preferInput(warehouse, existing.warehouse),
      flow:           preferInput(flow, existing.flow),
      vehicle_id:     preferInput(vehicle_id, existing.vehicle_id),
      driver_name:    preferInput(driver_name, existing.driver_name),
      customer_name:  preferInput(customer_name, existing.customer_name),
      customer_phone: preferInput(customer_phone, existing.customer_phone),
      address:        preferInput(address, existing.address),
      current_status: ORDER_STATUS.DA_IN,
      updated_at:     now
    };

    const codeColumn = rawOrders[0].findIndex(header => header === 'Mã hóa đơn KiotViet');
    const existingRowIndex = rawOrders.findIndex((row, index) => (
      index > 0 && codeColumn >= 0 && row[codeColumn] === kiotviet_code
    ));
    if (existingRowIndex < 1) {
      throw makeError(`Không tìm thấy dòng dữ liệu cho hóa đơn "${kiotviet_code}".`, 409, 'ORDER_ROW_NOT_FOUND');
    }

    await vcClient.vcUpdateRow(
      CONFIG.VC_SHEET_ORDERS,
      existingRowIndex + 1,
      objectToRow(SCHEMA.orders.fieldKeys, claimedOrder)
    );

    const historyObj = {
      history_id: generateId('HST'),
      order_id: existing.order_id,
      from_status: ORDER_STATUS.MOI_TAO,
      to_status: ORDER_STATUS.DA_IN,
      changed_by: 'system:create',
      changed_at: now,
      note: 'Nhận xử lý đơn đã đồng bộ từ KiotViet'
    };
    await vcClient.vcAppendRow(
      CONFIG.VC_SHEET_STATUS_HISTORY,
      objectToRow(SCHEMA.statusHistory.fieldKeys, historyObj)
    );

    const rawItems = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDER_ITEMS);
    let savedItems = rowsToObjects(
      SCHEMA.orderItems.headers,
      SCHEMA.orderItems.fieldKeys,
      rawItems
    ).filter(item => item.order_id === existing.order_id);

    if (savedItems.length === 0) {
      savedItems = [];
      for (const item of (items || [])) {
        const itemObj = {
          order_id: existing.order_id,
          product_code:     item.product_code     || '',
          product_name:     item.product_name     || '',
          quantity_ordered: item.quantity_ordered || '',
          quantity_picked:  '',
          unit:             item.unit             || '',
          notes:            item.notes            || ''
        };
        await vcClient.vcAppendRow(
          CONFIG.VC_SHEET_ORDER_ITEMS,
          objectToRow(SCHEMA.orderItems.fieldKeys, itemObj)
        );
        savedItems.push(itemObj);
      }
    }

    return { ...claimedOrder, items: savedItems };
  }

  // Cac trang thai dang xu ly khong duoc tao lai; don DA_HUY van co the tao moi.
  if (existing && existing.current_status !== ORDER_STATUS.DA_HUY) {
    throw makeError(
      `Đã tồn tại đơn vận chuyển cho mã hóa đơn "${kiotviet_code}" (Mã vận đơn: ${existing.order_id}).`,
      409,
      'DUPLICATE_ORDER'
    );
  }

  const order_id = generateOrderId(rawOrders);

  const orderObj = {
    order_id,
    kiotviet_code: kiotviet_code || '',
    warehouse:     warehouse     || '',
    flow:          flow          || '',
    vehicle_id:    vehicle_id    || '',
    driver_name:   driver_name   || '',
    customer_name: customer_name || '',
    customer_phone:customer_phone|| '',
    address:       address       || '',
    current_status: ORDER_STATUS.DA_IN,
    is_transit_held: '',
    freight_amount: '',
    freight_note: '',
    created_at:    now,
    updated_at:    now
  };

  await vcClient.vcAppendRow(CONFIG.VC_SHEET_ORDERS, objectToRow(SCHEMA.orders.fieldKeys, orderObj));

  // Kiem tra dung do sinh order_id khi 2 request createOrder chay gan nhu
  // dong thoi (vd 2 ke toan tao don cung luc, hoac double-click submit):
  // ca hai co the doc cung mot maxNum va append cung mot order_id, tao ra
  // 2 don khac nhau trung "Mã vận đơn" — nang hon rui ro sua-de-len-nhau da
  // ghi o dau file vi day la hong khoa nghiep vu, khong chi mat du lieu 1
  // truong. Doc lai ngay sau khi ghi de phat hien som.
  //
  // LUU Y (fragile): tinh dung cua kiem tra nay dua vao viec vcGetValues() o
  // dong ngay duoi day chay NGAY SAU vcAppendRow() o tren, KHONG co await I/O
  // nao xen vao giua — vi vcSheetsClient.invalidateVcSheetCache() chi bao dam
  // "lan vcGetValues KE TIEP cho sheet nay se la cache-miss", chu khong khoa
  // toan bo sheet trong luc doc lai. Neu sau nay co ai chen 1 buoc await khac
  // (vd ghi log, goi API phu) vao giua 2 dong nay, van con dung ve mat "doc du
  // lieu moi nhat", nhung se keo dai thoi gian ho (window) truoc khi phat hien
  // trung order_id — nen tranh chen them await khong can thiet vao doan nay.
  const rawOrdersAfterAppend = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  const dupCount = rawOrdersAfterAppend
    .slice(1)
    .filter(row => row[0] === order_id).length;
  if (dupCount > 1) {
    throw makeError(
      `Trùng mã vận đơn "${order_id}" do tạo đơn đồng thời, vui lòng thử lại.`,
      409,
      'ORDER_ID_COLLISION'
    );
  }

  // Ghi lich su trang thai: tu '' sang DA_IN
  const historyObj = {
    history_id: generateId('HST'),
    order_id,
    from_status: '',
    to_status: ORDER_STATUS.DA_IN,
    changed_by: 'system:create',
    changed_at: now,
    note: ''
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_STATUS_HISTORY, objectToRow(SCHEMA.statusHistory.fieldKeys, historyObj));

  // Ghi tung item
  const savedItems = [];
  for (const item of (items || [])) {
    const itemObj = {
      order_id,
      product_code:     item.product_code     || '',
      product_name:     item.product_name     || '',
      quantity_ordered: item.quantity_ordered || '',
      quantity_picked:  '',
      unit:             item.unit             || '',
      notes:            item.notes            || ''
    };
    await vcClient.vcAppendRow(CONFIG.VC_SHEET_ORDER_ITEMS, objectToRow(SCHEMA.orderItems.fieldKeys, itemObj));
    savedItems.push(itemObj);
  }

  return { ...orderObj, items: savedItems };
}

// ---------------------------------------------------------------------------
// updateOrderMeta — cap nhat cac truong metadata (khong phai current_status)
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @param {{ vehicle_id?, driver_name?, customer_name?, customer_phone?,
 *           address?, freight_amount?, freight_note? }} patch
 * @returns {Promise<object>}  Order da cap nhat
 */
async function updateOrderMeta(orderId, patch) {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  if (!rawRows.length) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const [headerRow, ...dataRows] = rawRows;
  const fieldKeys = SCHEMA.orders.fieldKeys;
  const headers   = SCHEMA.orders.headers;

  // Xay dung colMap
  const colMap = {};
  fieldKeys.forEach((key, si) => {
    colMap[key] = headerRow.findIndex(h => String(h || '').trim() === headers[si]);
  });

  const rowIdx = dataRows.findIndex(row => row[colMap.order_id] === orderId);
  if (rowIdx < 0) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const row = [...(dataRows[rowIdx] || [])];
  // Phu ra neu row ngan hon so cot
  while (row.length < fieldKeys.length) row.push('');

  const ALLOWED_PATCH_FIELDS = ['vehicle_id', 'driver_name', 'customer_name', 'customer_phone', 'address', 'freight_amount', 'freight_note'];
  ALLOWED_PATCH_FIELDS.forEach(key => {
    if (patch[key] !== undefined) {
      const ci = colMap[key];
      if (ci >= 0) row[ci] = patch[key];
    }
  });

  // Cap nhat updated_at
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  if (colMap.updated_at >= 0) row[colMap.updated_at] = now;

  // rowIndex 1-based (1 = header, 2 = dong dau tien)
  await vcClient.vcUpdateRow(CONFIG.VC_SHEET_ORDERS, rowIdx + 2, row);

  // Tra ve object da cap nhat
  const updatedObj = {};
  fieldKeys.forEach((key, si) => {
    const ci = colMap[key];
    updatedObj[key] = ci >= 0 && ci < row.length ? row[ci] : '';
  });
  return updatedObj;
}

// ---------------------------------------------------------------------------
// transitionOrderStatus — chuyen trang thai
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @param {string} toStatus  Chuoi tieng Viet tu ORDER_STATUS
 * @param {{ changedBy: string, note?: string }} opts
 * @returns {Promise<object>}  Order da cap nhat
 */
async function transitionOrderStatus(orderId, toStatus, { changedBy, note = '' }) {
  // Chan cung: khong cho phep chuyen sang SU_CO qua endpoint transition chung.
  // Chuyen sang SU_CO BAT BUOC di kem 1 dong trong "Su co van chuyen" + luu
  // prev_status trong note lich su (spec muc 4.3) — chi createException() lam
  // dung viec do. Neu khong chan o day, don co the ket thuc o SU_CO ma khong
  // co exception nao de resolveException() tim thay -> ket ket vinh vien.
  if (toStatus === ORDER_STATUS.SU_CO) {
    throw makeError(
      'Không thể chuyển sang trạng thái "Sự cố" qua endpoint transition. Dùng POST /api/shipment/orders/:orderId/exceptions.',
      400,
      'USE_EXCEPTION_ENDPOINT'
    );
  }

  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  if (!rawRows.length) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const [headerRow, ...dataRows] = rawRows;
  const fieldKeys = SCHEMA.orders.fieldKeys;
  const headers   = SCHEMA.orders.headers;

  const colMap = {};
  fieldKeys.forEach((key, si) => {
    colMap[key] = headerRow.findIndex(h => String(h || '').trim() === headers[si]);
  });

  const rowIdx = dataRows.findIndex(row => row[colMap.order_id] === orderId);
  if (rowIdx < 0) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const dataRow = dataRows[rowIdx];
  const fromStatus = colMap.current_status >= 0 ? String(dataRow[colMap.current_status] || '') : '';
  const flow       = colMap.flow >= 0 ? Number(dataRow[colMap.flow]) : undefined;

  // Kiem tra transition hop le — dung ly do that su tu describeTransition
  // (khong doan qua noi dung chuoi trang thai tieng Viet, tranh gan nham
  // INVALID_TRANSITION_FOR_FLOW cho cac buoc khong lien quan gi den flow).
  const { allowed, reason } = describeTransition(fromStatus, toStatus, { flow });
  if (!allowed) {
    const err = makeError(
      `Không thể chuyển từ trạng thái "${fromStatus}" sang "${toStatus}"` +
        (flow ? ` (luồng ${flow})` : '') + '.',
      400,
      reason === 'FLOW_MISMATCH' ? 'INVALID_TRANSITION_FOR_FLOW' : 'INVALID_TRANSITION'
    );
    throw err;
  }

  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const row = [...dataRow];
  while (row.length < fieldKeys.length) row.push('');
  if (colMap.current_status >= 0) row[colMap.current_status] = toStatus;
  if (colMap.updated_at      >= 0) row[colMap.updated_at]    = now;

  await vcClient.vcUpdateRow(CONFIG.VC_SHEET_ORDERS, rowIdx + 2, row);

  // Ghi lich su trang thai
  const historyObj = {
    history_id:  generateId('HST'),
    order_id:    orderId,
    from_status: fromStatus,
    to_status:   toStatus,
    changed_by:  changedBy,
    changed_at:  now,
    note
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_STATUS_HISTORY, objectToRow(SCHEMA.statusHistory.fieldKeys, historyObj));

  // Tra ve order da cap nhat
  const updatedObj = {};
  fieldKeys.forEach((key, si) => {
    const ci = colMap[key];
    updatedObj[key] = ci >= 0 && ci < row.length ? row[ci] : '';
  });
  return updatedObj;
}

// ---------------------------------------------------------------------------
// updateOrderItems — cap nhat quantity_picked / notes cho item
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @param {{ product_code: string, quantity_picked?: any, notes?: string }[]} items
 * @returns {Promise<void>}
 */
async function updateOrderItems(orderId, items) {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDER_ITEMS);
  if (!rawRows.length) return;

  const [headerRow, ...dataRows] = rawRows;
  const fieldKeys = SCHEMA.orderItems.fieldKeys;
  const headers   = SCHEMA.orderItems.headers;

  const colMap = {};
  fieldKeys.forEach((key, si) => {
    colMap[key] = headerRow.findIndex(h => String(h || '').trim() === headers[si]);
  });

  for (const patch of items) {
    const rowIdx = dataRows.findIndex(
      row => row[colMap.order_id] === orderId && row[colMap.product_code] === patch.product_code
    );
    if (rowIdx < 0) continue;

    const row = [...dataRows[rowIdx]];
    while (row.length < fieldKeys.length) row.push('');
    if (patch.quantity_picked !== undefined && colMap.quantity_picked >= 0) {
      row[colMap.quantity_picked] = patch.quantity_picked;
    }
    if (patch.notes !== undefined && colMap.notes >= 0) {
      row[colMap.notes] = patch.notes;
    }
    await vcClient.vcUpdateRow(CONFIG.VC_SHEET_ORDER_ITEMS, rowIdx + 2, row);
  }
}

// ---------------------------------------------------------------------------
// appendAttachment — them anh chung tu
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @param {{ type, drive_file_id, drive_view_url, drive_thumbnail_url, uploadedBy, ocr_text? }} params
 * @returns {Promise<object>}  Attachment vua ghi
 */
async function appendAttachment(orderId, { type, drive_file_id, drive_view_url, drive_thumbnail_url, uploadedBy, ocr_text }) {
  const now = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const attachmentObj = {
    attachment_id:      generateId('ATT'),
    order_id:           orderId,
    type:               type              || '',
    drive_file_id:      drive_file_id     || '',
    drive_view_url:     drive_view_url    || '',
    drive_thumbnail_url:drive_thumbnail_url || '',
    uploaded_by:        uploadedBy        || '',
    uploaded_at:        now,
    ocr_text:           ocr_text          || ''
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_ATTACHMENTS, objectToRow(SCHEMA.attachments.fieldKeys, attachmentObj));
  return attachmentObj;
}

// ---------------------------------------------------------------------------
// listAttachments — danh sach anh cua 1 don
// ---------------------------------------------------------------------------

/**
 * @param {string} orderId
 * @returns {Promise<object[]>}
 */
async function listAttachments(orderId) {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_ATTACHMENTS);
  const all = rowsToObjects(SCHEMA.attachments.headers, SCHEMA.attachments.fieldKeys, rawRows);
  return all.filter(a => a.order_id === orderId);
}

// ---------------------------------------------------------------------------
// createException — tao su co + chuyen trang thai sang SU_CO
// ---------------------------------------------------------------------------

/**
 * Dong thoi:
 *   1. Doc trang thai hien tai cua don.
 *   2. Luu prev_status vao note lich su theo quy uoc "prev_status:<TRANG_THAI>".
 *   3. Chuyen don sang SU_CO (ghi lich su).
 *   4. Ghi dong vao tab Su co van chuyen.
 *
 * @param {string} orderId
 * @param {{ stage?, type, description, changedBy }} params
 * @returns {Promise<{ exception: object, order: object }>}
 */
async function createException(orderId, { stage, type, description, changedBy }) {
  // Doc trang thai hien tai
  const rawOrders = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  if (!rawOrders.length) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const [headerRow, ...dataRows] = rawOrders;
  const fieldKeys = SCHEMA.orders.fieldKeys;
  const headers   = SCHEMA.orders.headers;

  const colMap = {};
  fieldKeys.forEach((key, si) => {
    colMap[key] = headerRow.findIndex(h => String(h || '').trim() === headers[si]);
  });

  const rowIdx = dataRows.findIndex(row => row[colMap.order_id] === orderId);
  if (rowIdx < 0) throw makeError(`Không tìm thấy đơn vận chuyển "${orderId}".`, 404, 'ORDER_NOT_FOUND');

  const dataRow    = dataRows[rowIdx];
  const prevStatus = colMap.current_status >= 0 ? String(dataRow[colMap.current_status] || '') : '';

  // Kiem tra hop le theo EXCEPTION_ELIGIBLE_STATUSES
  if (!canTransition(prevStatus, ORDER_STATUS.SU_CO, {})) {
    throw makeError(
      `Không thể tạo sự cố từ trạng thái "${prevStatus}".`,
      400,
      'INVALID_TRANSITION'
    );
  }

  const now        = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const actualStage = stage || prevStatus;

  // Chuyen trang thai don sang SU_CO
  const updatedRow = [...dataRow];
  while (updatedRow.length < fieldKeys.length) updatedRow.push('');
  if (colMap.current_status >= 0) updatedRow[colMap.current_status] = ORDER_STATUS.SU_CO;
  if (colMap.updated_at      >= 0) updatedRow[colMap.updated_at]    = now;
  await vcClient.vcUpdateRow(CONFIG.VC_SHEET_ORDERS, rowIdx + 2, updatedRow);

  // Ghi lich su: luu prev_status trong truong note theo quy uoc spec 4.3
  const historyObj = {
    history_id:  generateId('HST'),
    order_id:    orderId,
    from_status: prevStatus,
    to_status:   ORDER_STATUS.SU_CO,
    changed_by:  changedBy,
    changed_at:  now,
    note:        `prev_status:${prevStatus}`
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_STATUS_HISTORY, objectToRow(SCHEMA.statusHistory.fieldKeys, historyObj));

  // Ghi dong Su co van chuyen
  const exceptionObj = {
    exception_id: generateId('EXC'),
    order_id:     orderId,
    stage:        actualStage,
    type:         type        || '',
    description:  description || '',
    resolver:     '',
    status:       'OPEN',
    created_at:   now,
    resolved_at:  ''
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_EXCEPTIONS, objectToRow(SCHEMA.exceptions.fieldKeys, exceptionObj));

  // Tao object order tra ve
  const updatedOrder = {};
  fieldKeys.forEach((key, si) => {
    const ci = colMap[key];
    updatedOrder[key] = ci >= 0 && ci < updatedRow.length ? updatedRow[ci] : '';
  });

  return { exception: exceptionObj, order: updatedOrder };
}

// ---------------------------------------------------------------------------
// resolveException — giai quyet su co (RESUME | CANCEL)
// ---------------------------------------------------------------------------

/**
 * @param {string} exceptionId
 * @param {{ resolution: 'RESUME'|'CANCEL', resolver: string, note?: string }} params
 * @returns {Promise<{ exception: object, order: object }>}
 */
async function resolveException(exceptionId, { resolution, resolver, note = '' }) {
  // Doc tab su co
  const rawExceptions = await vcClient.vcGetValues(CONFIG.VC_SHEET_EXCEPTIONS);
  if (!rawExceptions.length) throw makeError(`Không tìm thấy sự cố "${exceptionId}".`, 404, 'EXCEPTION_NOT_FOUND');

  const [exHeaderRow, ...exDataRows] = rawExceptions;
  const exFieldKeys = SCHEMA.exceptions.fieldKeys;
  const exHeaders   = SCHEMA.exceptions.headers;

  const exColMap = {};
  exFieldKeys.forEach((key, si) => {
    exColMap[key] = exHeaderRow.findIndex(h => String(h || '').trim() === exHeaders[si]);
  });

  const exRowIdx = exDataRows.findIndex(row => row[exColMap.exception_id] === exceptionId);
  if (exRowIdx < 0) throw makeError(`Không tìm thấy sự cố "${exceptionId}".`, 404, 'EXCEPTION_NOT_FOUND');

  const exRow = exDataRows[exRowIdx];
  const currentStatus = exColMap.status >= 0 ? String(exRow[exColMap.status] || '') : '';
  if (currentStatus === 'RESOLVED') {
    throw makeError(`Sự cố "${exceptionId}" đã được xử lý rồi.`, 409, 'EXCEPTION_ALREADY_RESOLVED');
  }

  const orderId = exColMap.order_id >= 0 ? String(exRow[exColMap.order_id] || '') : '';

  // Tim prev_status tu Lich su trang thai (dung note "prev_status:...")
  const rawHistory = await vcClient.vcGetValues(CONFIG.VC_SHEET_STATUS_HISTORY);
  const historyRows = rowsToObjects(SCHEMA.statusHistory.headers, SCHEMA.statusHistory.fieldKeys, rawHistory);
  const exceptionHistoryEntry = historyRows
    .filter(h => h.order_id === orderId && h.to_status === ORDER_STATUS.SU_CO)
    .sort((a, b) => String(b.changed_at).localeCompare(String(a.changed_at)))[0];

  // KHONG doan mo prevStatus khi khong tim thay — don co the da o
  // DANG_CHUYEN_KHO/DANG_GIAO/DA_GIAO truoc khi vao SU_CO, doan sai se am
  // tham dua don ve nham trang thai ma khong ai biet. That bai ro rang de
  // nguoi quan ly sua du lieu tay tren Sheet roi thu lai, thay vi doan.
  let prevStatus = null;
  if (exceptionHistoryEntry && exceptionHistoryEntry.note) {
    const match = exceptionHistoryEntry.note.match(/^prev_status:(.+)$/);
    if (match) prevStatus = match[1];
  }
  if (resolution === 'RESUME' && !prevStatus) {
    throw makeError(
      `Không xác định được trạng thái trước khi xảy ra sự cố cho đơn "${orderId}" — ` +
        `kiểm tra lại tab "Lịch sử trạng thái" (cột Ghi chú dòng chuyển sang "Sự cố") trước khi thử lại.`,
      409,
      'EXCEPTION_PREV_STATUS_UNKNOWN'
    );
  }

  const now     = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const newOrderStatus = resolution === 'RESUME' ? prevStatus : ORDER_STATUS.DA_HUY;

  // Cap nhat Su co: status = RESOLVED, resolved_at, resolver
  const updatedExRow = [...exRow];
  while (updatedExRow.length < exFieldKeys.length) updatedExRow.push('');
  if (exColMap.status      >= 0) updatedExRow[exColMap.status]      = 'RESOLVED';
  if (exColMap.resolved_at >= 0) updatedExRow[exColMap.resolved_at] = now;
  if (exColMap.resolver    >= 0) updatedExRow[exColMap.resolver]    = resolver;
  await vcClient.vcUpdateRow(CONFIG.VC_SHEET_EXCEPTIONS, exRowIdx + 2, updatedExRow);

  // Cap nhat trang thai don hang
  const rawOrders = await vcClient.vcGetValues(CONFIG.VC_SHEET_ORDERS);
  const [orderHeaderRow, ...orderDataRows] = rawOrders;
  const orderFieldKeys = SCHEMA.orders.fieldKeys;
  const orderHeaders   = SCHEMA.orders.headers;

  const orderColMap = {};
  orderFieldKeys.forEach((key, si) => {
    orderColMap[key] = orderHeaderRow.findIndex(h => String(h || '').trim() === orderHeaders[si]);
  });

  const orderRowIdx = orderDataRows.findIndex(row => row[orderColMap.order_id] === orderId);
  let updatedOrder = {};
  if (orderRowIdx >= 0) {
    const orderRow = [...orderDataRows[orderRowIdx]];
    while (orderRow.length < orderFieldKeys.length) orderRow.push('');
    if (orderColMap.current_status >= 0) orderRow[orderColMap.current_status] = newOrderStatus;
    if (orderColMap.updated_at     >= 0) orderRow[orderColMap.updated_at]     = now;
    await vcClient.vcUpdateRow(CONFIG.VC_SHEET_ORDERS, orderRowIdx + 2, orderRow);

    orderFieldKeys.forEach((key, si) => {
      const ci = orderColMap[key];
      updatedOrder[key] = ci >= 0 && ci < orderRow.length ? orderRow[ci] : '';
    });

    // Ghi lich su trang thai
    const histObj = {
      history_id:  generateId('HST'),
      order_id:    orderId,
      from_status: ORDER_STATUS.SU_CO,
      to_status:   newOrderStatus,
      changed_by:  resolver,
      changed_at:  now,
      note:        note || `resolve:${resolution}`
    };
    await vcClient.vcAppendRow(CONFIG.VC_SHEET_STATUS_HISTORY, objectToRow(SCHEMA.statusHistory.fieldKeys, histObj));
  }

  // Tao exception object tra ve
  const updatedException = {};
  exFieldKeys.forEach((key, si) => {
    const ci = exColMap[key];
    updatedException[key] = ci >= 0 && ci < updatedExRow.length ? updatedExRow[ci] : '';
  });

  return { exception: updatedException, order: updatedOrder };
}

// ---------------------------------------------------------------------------
// listExceptions — danh sach su co (co the filter theo status)
// ---------------------------------------------------------------------------

/**
 * @param {{ status?: 'OPEN'|'RESOLVED' }} filter
 * @returns {Promise<object[]>}
 */
async function listExceptions(filter = {}) {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_EXCEPTIONS);
  const all = rowsToObjects(SCHEMA.exceptions.headers, SCHEMA.exceptions.fieldKeys, rawRows);
  if (filter.status) return all.filter(e => e.status === filter.status);
  return all;
}

// ---------------------------------------------------------------------------
// Vehicles CRUD
// ---------------------------------------------------------------------------

/** @returns {Promise<object[]>} */
async function getVehicles() {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_VEHICLES);
  return rowsToObjects(SCHEMA.vehicles.headers, SCHEMA.vehicles.fieldKeys, rawRows);
}

/**
 * @param {{ vehicle_id, plate_number, vehicle_type, default_driver?, max_weight?, notes? }} params
 * @returns {Promise<object>}
 */
async function createVehicle({ vehicle_id, plate_number, vehicle_type, default_driver, max_weight, notes }) {
  const vehicleObj = {
    vehicle_id:     vehicle_id     || '',
    plate_number:   plate_number   || '',
    vehicle_type:   vehicle_type   || '',
    default_driver: default_driver || '',
    max_weight:     max_weight     || '',
    notes:          notes          || ''
  };
  await vcClient.vcAppendRow(CONFIG.VC_SHEET_VEHICLES, objectToRow(SCHEMA.vehicles.fieldKeys, vehicleObj));
  return vehicleObj;
}

/**
 * @param {string} vehicleId
 * @param {{ plate_number?, vehicle_type?, default_driver?, max_weight?, notes? }} patch
 * @returns {Promise<object>}
 */
async function updateVehicle(vehicleId, patch) {
  const rawRows = await vcClient.vcGetValues(CONFIG.VC_SHEET_VEHICLES);
  if (!rawRows.length) throw makeError(`Không tìm thấy xe "${vehicleId}".`, 404, 'VEHICLE_NOT_FOUND');

  const [headerRow, ...dataRows] = rawRows;
  const fieldKeys = SCHEMA.vehicles.fieldKeys;
  const headers   = SCHEMA.vehicles.headers;

  const colMap = {};
  fieldKeys.forEach((key, si) => {
    colMap[key] = headerRow.findIndex(h => String(h || '').trim() === headers[si]);
  });

  const rowIdx = dataRows.findIndex(row => row[colMap.vehicle_id] === vehicleId);
  if (rowIdx < 0) throw makeError(`Không tìm thấy xe "${vehicleId}".`, 404, 'VEHICLE_NOT_FOUND');

  const row = [...dataRows[rowIdx]];
  while (row.length < fieldKeys.length) row.push('');

  ['plate_number', 'vehicle_type', 'default_driver', 'max_weight', 'notes'].forEach(key => {
    if (patch[key] !== undefined && colMap[key] >= 0) row[colMap[key]] = patch[key];
  });

  await vcClient.vcUpdateRow(CONFIG.VC_SHEET_VEHICLES, rowIdx + 2, row);

  const updated = {};
  fieldKeys.forEach((key, si) => {
    const ci = colMap[key];
    updated[key] = ci >= 0 && ci < row.length ? row[ci] : '';
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  // Orders
  getOrders,
  getOrderById,
  createOrder,
  updateOrderMeta,
  transitionOrderStatus,
  updateOrderItems,
  // Attachments
  appendAttachment,
  listAttachments,
  // Exceptions
  createException,
  resolveException,
  listExceptions,
  // Vehicles
  getVehicles,
  createVehicle,
  updateVehicle,
  // Test helpers (khong dung trong production code)
  __test__: {
    rowsToObjects,
    objectToRow,
    generateOrderId,
    generateId,
    todayVN,
    SCHEMA
  }
};
