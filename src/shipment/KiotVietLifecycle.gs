// ==========================================
// KIOTVIET -> VONG DOI DON VAN CHUYEN
// ==========================================

const SHIPMENT_LIFECYCLE_SCHEMAS = Object.freeze({
  orders: {
    sheetName: CONFIG.SHEET_SHIPMENT_ORDERS,
    headers: Object.freeze([
      'Mã vận đơn', 'Mã hóa đơn KiotViet', 'Kho xuất', 'Luồng giao hàng',
      'Mã xe', 'Tên tài xế', 'Tên khách hàng', 'Số điện thoại',
      'Địa chỉ nhận hàng', 'Trạng thái hiện tại', 'Giữ hàng tàu hỏa',
      'Tiền cước', 'Ghi chú cước', 'Thời gian tạo', 'Cập nhật lần cuối'
    ])
  },
  orderItems: {
    sheetName: CONFIG.SHEET_SHIPMENT_ORDER_ITEMS,
    headers: Object.freeze([
      'Mã vận đơn', 'Mã hàng', 'Tên hàng hóa',
      'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'
    ])
  },
  statusHistory: {
    sheetName: CONFIG.SHEET_SHIPMENT_STATUS_HISTORY,
    headers: Object.freeze([
      'Mã lịch sử', 'Mã vận đơn', 'Trạng thái trước', 'Trạng thái mới',
      'Người thực hiện', 'Thời gian cập nhật', 'Ghi chú'
    ])
  },
  attachments: {
    sheetName: CONFIG.SHEET_SHIPMENT_ATTACHMENTS,
    headers: Object.freeze([
      'Mã chứng từ', 'Mã vận đơn', 'Loại chứng từ', 'Google Drive File ID',
      'Link xem ảnh', 'Link thumbnail', 'Người tải lên',
      'Thời gian tải lên', 'Nội dung OCR'
    ])
  },
  exceptions: {
    sheetName: CONFIG.SHEET_SHIPMENT_EXCEPTIONS,
    headers: Object.freeze([
      'Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố',
      'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý',
      'Thời gian báo cáo', 'Thời gian xử lý xong'
    ])
  },
  vehicles: {
    sheetName: CONFIG.SHEET_SHIPMENT_VEHICLES,
    headers: Object.freeze([
      'Mã xe', 'Biển số xe', 'Loại xe',
      'Tài xế mặc định', 'Tải trọng tối đa (kg)', 'Ghi chú'
    ])
  }
});

/**
 * Ham cai dat duy nhat cho spreadsheet van chuyen.
 * Khong goi sync full va khong tao trigger bao cao cua dashboard cu.
 */
function setupShipmentLifecycleSync() {
  PropertiesService.getScriptProperties().setProperty(
    'KIOTVIET_SYNC_MODE',
    KIOTVIET_SYNC_MODES.SHIPMENT_LIFECYCLE
  );
  initializeShipmentLifecycleSheets();
  return setupKiotVietAutoSync();
}

/** Tao/kiem tra 6 tab van chuyen ma khong xoa du lieu dang co. */
function initializeShipmentLifecycleSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHIPMENT_LIFECYCLE_SCHEMAS).forEach(key => {
    ensureShipmentLifecycleSheet_(ss, SHIPMENT_LIFECYCLE_SCHEMAS[key]);
  });
  Logger.log('Da san sang 6 tab vong doi don van chuyen.');
}

/**
 * Nap bu 7 ngay gan nhat. Ham nay co pham vi nho de tranh vuot gioi han
 * thoi gian Apps Script; webhook se tiep tuc cap nhat cac hoa don moi.
 */
function syncShipmentLifecycleRecent7Days() {
  return syncShipmentLifecycleRecentDays_(7);
}

function syncShipmentLifecycleRecentDays_(days) {
  if (!hasShipmentLifecycle_()) {
    throw new Error('Che do dong bo phai co vong doi van chuyen.');
  }
  initializeShipmentLifecycleSheets();
  const token = getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc token KiotViet.');
  const invoices = fetchShipmentLifecycleInvoices_(token, days);
  const result = upsertShipmentLifecycleInvoices_(invoices);
  Logger.log('Da nap bu ' + result.orderCount + ' hoa don trong ' + days + ' ngay.');
  return result;
}

/** Dieu phoi rieng cho queue o che do SHIPMENT_LIFECYCLE. */
function processShipmentLifecycleWebhookItems_(action, items) {
  if (String(action || '').indexOf('invoice') === -1) {
    Logger.log('Bo qua webhook khong thuoc vong doi van chuyen: ' + action);
    return;
  }
  if (String(action || '').indexOf('.delete') !== -1) {
    Logger.log('Bo qua invoice.delete; giu audit don van chuyen da tao.');
    return;
  }
  const hydrated = hydrateKiotVietItems_(items, KIOTVIET_SHEET_SCHEMAS.invoices);
  upsertShipmentLifecycleInvoices_(hydrated);
}

function fetchShipmentLifecycleInvoices_(token, days) {
  const safeDays = Math.max(1, Math.min(31, Number(days) || 7));
  const from = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const pageSize = 100;
  let currentItem = 0;
  let total = 0;
  let items = [];

  do {
    const url = 'https://public.kiotapi.com/invoices?pageSize=' + pageSize +
      '&currentItem=' + currentItem +
      '&lastModifiedFrom=' + encodeURIComponent(from) +
      '&includePayment=true&includeInvoiceDelivery=true&IncludeSaleChannel=true';
    const result = fetchKiotVietJsonWithRetry_(url, token, 'shipment-invoices');
    const pageItems = Array.isArray(result.data) ? result.data : [];
    items = items.concat(pageItems);
    total = Number(result.total) || 0;
    currentItem += pageSize;
    if (currentItem < total) Utilities.sleep(120);
  } while (currentItem < total);

  return items;
}

function upsertShipmentLifecycleInvoices_(invoices) {
  const sourceInvoices = Array.isArray(invoices) ? invoices : [];
  if (sourceInvoices.length === 0) return { orderCount: 0, itemCount: 0 };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const orderSheet = ensureShipmentLifecycleSheet_(ss, SHIPMENT_LIFECYCLE_SCHEMAS.orders);
  const itemSheet = ensureShipmentLifecycleSheet_(ss, SHIPMENT_LIFECYCLE_SCHEMAS.orderItems);
  const historySheet = ensureShipmentLifecycleSheet_(ss, SHIPMENT_LIFECYCLE_SCHEMAS.statusHistory);

  const orderHeaders = SHIPMENT_LIFECYCLE_SCHEMAS.orders.headers;
  const orderIndex = shipmentHeaderIndex_(orderHeaders);
  const existingOrderRows = orderSheet.getLastRow() > 1
    ? orderSheet.getRange(2, 1, orderSheet.getLastRow() - 1, orderHeaders.length).getValues()
    : [];
  const orderRowByInvoiceCode = {};
  existingOrderRows.forEach((row, index) => {
    const code = String(row[orderIndex['Mã hóa đơn KiotViet']] || '').trim();
    if (code && orderRowByInvoiceCode[code] === undefined) orderRowByInvoiceCode[code] = index;
  });

  const sequenceByDate = shipmentLifecycleSequenceByDate_(existingOrderRows);
  const nowText = shipmentLifecycleNow_();
  const affectedOrderIds = {};
  const newHistoryRows = [];

  sourceInvoices.forEach(invoice => {
    const invoiceCode = shipmentLifecycleInvoiceCode_(invoice);
    if (!invoiceCode) return;
    const existingIndex = orderRowByInvoiceCode[invoiceCode];
    const isCancelled = shipmentLifecycleInvoiceCancelled_(invoice);

    if (existingIndex === undefined && isCancelled) return;

    if (existingIndex === undefined) {
      const orderId = shipmentLifecycleNextOrderId_(invoice, sequenceByDate);
      const newRow = shipmentLifecycleOrderRow_(invoice, orderId, null, nowText);
      existingOrderRows.push(newRow);
      orderRowByInvoiceCode[invoiceCode] = existingOrderRows.length - 1;
      affectedOrderIds[orderId] = invoice;
      newHistoryRows.push([
        'HST-' + Utilities.getUuid(), orderId, '', 'Mới tạo',
        'system:kiotviet', nowText, 'Tự động tạo từ invoice.update'
      ]);
      return;
    }

    const existingRow = existingOrderRows[existingIndex];
    const orderId = String(existingRow[orderIndex['Mã vận đơn']] || '');
    const previousStatus = String(existingRow[orderIndex['Trạng thái hiện tại']] || 'Mới tạo');
    const updatedRow = shipmentLifecycleOrderRow_(invoice, orderId, existingRow, nowText);
    if (isCancelled && previousStatus === 'Mới tạo') {
      updatedRow[orderIndex['Trạng thái hiện tại']] = 'Đã hủy';
      newHistoryRows.push([
        'HST-' + Utilities.getUuid(), orderId, previousStatus, 'Đã hủy',
        'system:kiotviet', nowText, 'Hóa đơn KiotViet đã hủy trước khi điều phối'
      ]);
    }
    existingOrderRows[existingIndex] = updatedRow;
    if (orderId) affectedOrderIds[orderId] = invoice;
  });

  if (existingOrderRows.length > 0) {
    orderSheet.getRange(2, 1, existingOrderRows.length, orderHeaders.length)
      .setValues(existingOrderRows);
  }

  const itemCount = replaceShipmentLifecycleItems_(itemSheet, affectedOrderIds);
  if (newHistoryRows.length > 0) {
    historySheet.getRange(
      historySheet.getLastRow() + 1,
      1,
      newHistoryRows.length,
      SHIPMENT_LIFECYCLE_SCHEMAS.statusHistory.headers.length
    ).setValues(newHistoryRows);
  }
  formatShipmentLifecycleSheets_(orderSheet, itemSheet, historySheet);
  SpreadsheetApp.flush();
  return { orderCount: Object.keys(affectedOrderIds).length, itemCount: itemCount };
}

function shipmentLifecycleOrderRow_(invoice, orderId, existingRow, nowText) {
  const headers = SHIPMENT_LIFECYCLE_SCHEMAS.orders.headers;
  const index = shipmentHeaderIndex_(headers);
  const row = existingRow ? existingRow.slice(0, headers.length) : new Array(headers.length).fill('');
  while (row.length < headers.length) row.push('');

  const delivery = kiotVietValue_(invoice, ['InvoiceDelivery', 'invoiceDelivery'], {}) || {};
  const branchName = kiotVietText_(invoice, ['BranchName', 'branchName']);
  row[index['Mã vận đơn']] = orderId;
  row[index['Mã hóa đơn KiotViet']] = shipmentLifecycleInvoiceCode_(invoice);
  if (!row[index['Kho xuất']]) row[index['Kho xuất']] = shipmentLifecycleWarehouse_(branchName);
  row[index['Tên khách hàng']] = kiotVietText_(invoice, ['CustomerName', 'customerName'], 'Khách lẻ') || 'Khách lẻ';
  row[index['Số điện thoại']] = kiotVietText_(
    delivery,
    ['ContactNumber', 'contactNumber'],
    kiotVietText_(invoice, ['CustomerContactNumber', 'customerContactNumber', 'ContactNumber', 'contactNumber'])
  );
  row[index['Địa chỉ nhận hàng']] = kiotVietText_(
    delivery,
    ['Address', 'address'],
    kiotVietText_(invoice, ['Address', 'address'])
  );
  if (!row[index['Trạng thái hiện tại']]) row[index['Trạng thái hiện tại']] = 'Mới tạo';
  if (!row[index['Thời gian tạo']]) {
    row[index['Thời gian tạo']] = kiotVietDate_(invoice, ['PurchaseDate', 'purchaseDate', 'CreatedDate', 'createdDate']) || nowText;
  }
  row[index['Cập nhật lần cuối']] = nowText;
  return row;
}

function replaceShipmentLifecycleItems_(itemSheet, affectedOrderIds) {
  const headers = SHIPMENT_LIFECYCLE_SCHEMAS.orderItems.headers;
  const index = shipmentHeaderIndex_(headers);
  const existingRows = itemSheet.getLastRow() > 1
    ? itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, headers.length).getValues()
    : [];
  const preservedByKey = {};
  existingRows.forEach(row => {
    const orderId = String(row[index['Mã vận đơn']] || '');
    const code = String(row[index['Mã hàng']] || '');
    const key = orderId + '|' + code;
    if (!preservedByKey[key]) preservedByKey[key] = [];
    preservedByKey[key].push(row);
  });

  const keptRows = existingRows.filter(row => {
    const orderId = String(row[index['Mã vận đơn']] || '');
    return !affectedOrderIds[orderId];
  });
  const replacementRows = [];

  Object.keys(affectedOrderIds).forEach(orderId => {
    const invoice = affectedOrderIds[orderId];
    const details = kiotVietValue_(invoice, ['InvoiceDetails', 'invoiceDetails', 'Details', 'details'], []);
    (Array.isArray(details) ? details : []).forEach(detail => {
      const productCode = kiotVietText_(detail, ['ProductCode', 'productCode']);
      const key = orderId + '|' + productCode;
      const preserved = preservedByKey[key] && preservedByKey[key].length > 0
        ? preservedByKey[key].shift()
        : null;
      replacementRows.push([
        orderId,
        productCode,
        kiotVietText_(detail, ['ProductName', 'productName']),
        kiotVietNumber_(detail, ['Quantity', 'quantity'], ''),
        preserved ? preserved[index['Số lượng đã nhặt']] : '',
        kiotVietText_(detail, ['Unit', 'unit']),
        preserved ? preserved[index['Ghi chú']] : kiotVietText_(detail, ['Note', 'note'])
      ]);
    });
  });

  const finalRows = keptRows.concat(replacementRows);
  if (itemSheet.getLastRow() > 1) {
    itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, headers.length).clearContent();
  }
  if (finalRows.length > 0) {
    itemSheet.getRange(2, 1, finalRows.length, headers.length).setValues(finalRows);
  }
  return replacementRows.length;
}

function ensureShipmentLifecycleSheet_(ss, schema) {
  let sheet = ss.getSheetByName(schema.sheetName);
  if (!sheet) sheet = ss.insertSheet(schema.sheetName);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]);
  } else {
    const actual = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), schema.headers.length))
      .getValues()[0].map(value => String(value || '').trim());
    const missing = schema.headers.filter(header => actual.indexOf(header) === -1);
    if (missing.length > 0) {
      throw new Error(
        'Tab "' + schema.sheetName + '" thieu cot bat buoc: ' + missing.join(', ')
      );
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, schema.headers.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1F4E78')
    .setFontFamily('Open Sans');
  return sheet;
}

function formatShipmentLifecycleSheets_(orderSheet, itemSheet, historySheet) {
  [orderSheet, itemSheet, historySheet].forEach(sheet => {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow > 1 && lastColumn > 0) {
      sheet.getRange(2, 1, lastRow - 1, lastColumn).setFontFamily('Open Sans');
    }
  });
  if (orderSheet.getLastRow() > 1) {
    orderSheet.getRange(2, 12, orderSheet.getLastRow() - 1, 1).setNumberFormat('#,##0');
  }
  if (itemSheet.getLastRow() > 1) {
    itemSheet.getRange(2, 4, itemSheet.getLastRow() - 1, 2).setNumberFormat('#,##0.###');
  }
}

function shipmentHeaderIndex_(headers) {
  const result = {};
  headers.forEach((header, index) => { result[header] = index; });
  return result;
}

function shipmentLifecycleInvoiceCode_(invoice) {
  return kiotVietText_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code']).trim();
}

function shipmentLifecycleInvoiceCancelled_(invoice) {
  const status = Number(kiotVietValue_(invoice, ['Status', 'status'], 0));
  const statusText = kiotVietText_(invoice, ['StatusValue', 'statusValue']).toLowerCase();
  return status === 2 || statusText.indexOf('hủy') !== -1 || statusText.indexOf('huy') !== -1;
}

function shipmentLifecycleWarehouse_(branchName) {
  const normalized = String(branchName || '').toLowerCase();
  if (normalized.indexOf('an khánh') !== -1 || normalized.indexOf('an khanh') !== -1 || normalized.indexOf('hà nội') !== -1 || normalized.indexOf('ha noi') !== -1) {
    return 'An Khánh';
  }
  if (normalized.indexOf('tân phú') !== -1 || normalized.indexOf('tan phu') !== -1 || normalized.indexOf('sài gòn') !== -1 || normalized.indexOf('sai gon') !== -1 || normalized.indexOf('hcm') !== -1) {
    return 'Tân Phú';
  }
  return '';
}

function shipmentLifecycleSequenceByDate_(rows) {
  const result = {};
  rows.forEach(row => {
    const match = String(row[0] || '').match(/^VC-(\d{8})-(\d{4})$/);
    if (!match) return;
    result[match[1]] = Math.max(result[match[1]] || 0, Number(match[2]) || 0);
  });
  return result;
}

function shipmentLifecycleNextOrderId_(invoice, sequenceByDate) {
  const rawDate = kiotVietValue_(invoice, ['PurchaseDate', 'purchaseDate', 'CreatedDate', 'createdDate'], '');
  const parsed = rawDate ? new Date(rawDate) : new Date();
  const validDate = isNaN(parsed.getTime()) ? new Date() : parsed;
  const dateText = Utilities.formatDate(validDate, 'Asia/Ho_Chi_Minh', 'yyyyMMdd');
  sequenceByDate[dateText] = (sequenceByDate[dateText] || 0) + 1;
  return 'VC-' + dateText + '-' + String(sequenceByDate[dateText]).padStart(4, '0');
}

function shipmentLifecycleNow_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd HH:mm:ss');
}
