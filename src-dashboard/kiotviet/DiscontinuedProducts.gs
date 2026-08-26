// LICH SU HANG NGUNG KINH DOANH
const DISCONTINUED_CFG = Object.freeze({
  SHEET: CONFIG.SHEET_DISCONTINUED_PRODUCTS,
  STATE_SHEET: '_Trạng thái hàng hóa',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  PROP_LAST_SYNC: 'DISCONTINUED_LAST_SYNC'
});

const DISCONTINUED_HEADERS = Object.freeze([
  'Ngày sửa trên KiotViet',
  'Trạng thái hiện tại',
  'Loại ghi nhận',
  'ID hàng hóa',
  'ID gian hàng',
  'Mã hàng',
  'Tên hàng',
  'Tên đầy đủ',
  'Loại hàng',
  'ID nhóm hàng',
  'Nhóm hàng',
  'Thương hiệu',
  'Hệ số quy đổi',
  'Cho phép bán',
  'Có biến thể',
  'Giá bán cơ bản',
  'Trọng lượng',
  'Tổng tồn kho',
  'Tổng khách đặt',
  'Tổng đang đặt',
  'Định mức tồn thấp nhất',
  'Định mức tồn cao nhất',
  'Tồn kho theo chi nhánh',
  'Bảng giá',
  'Hình ảnh',
  'Quản lý lô',
  'Mô tả',
  'Ngày tạo'
]);

function capNhatHangNgungKinhDoanh() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    migrateLegacyDiscontinuedSheet_(ss);
    const output = ensureDiscontinuedOutput_(ss);
    const stateSheet = ensureDiscontinuedState_(ss);

    const props = PropertiesService.getScriptProperties();
    const lastSync = props.getProperty(DISCONTINUED_CFG.PROP_LAST_SYNC);
    const token = getKiotVietToken();
    if (!token) throw new Error('Không lấy được access token KiotViet.');
    if (!lastSync) {
      const fullSync = syncHangNgungKinhDoanh_(token);
      return fullSync;
    }
    const overlapFrom = new Date(new Date(lastSync).getTime() - 120000).toISOString();

    const active = fetchKiotVietProductsByStatus_(true, overlapFrom, token);
    const inactive = fetchKiotVietProductsByStatus_(false, overlapFrom, token);
    const changedById = {};
    active.concat(inactive).forEach(function(p) {
      changedById[String(p.id)] = p;
    });

    const previous = readDiscontinuedState_(stateSheet);
    Object.keys(changedById).forEach(function(id) {
      const product = changedById[id];
      const before = previous[id];

      if (product.isActive === false &&
          (!before || before.isActive === true)) {
        upsertDiscontinuedEvent_(
          output,
          product,
          before
            ? 'Chuyển từ đang KD sang ngừng KD'
            : 'Phát hiện ngừng KD trong ngày'
        );
      } else if (product.isActive === true && before &&
                 before.isActive === false) {
        markDiscontinuedReactivated_(output, product);
      }

      previous[id] = {
        id: product.id,
        code: product.code || '',
        name: product.name || product.fullName || '',
        isActive: product.isActive !== false,
        modifiedDate: product.modifiedDate || '',
        checkedAt: new Date()
      };
    });

    writeDiscontinuedStateMap_(stateSheet, previous);
    props.setProperty(DISCONTINUED_CFG.PROP_LAST_SYNC, new Date().toISOString());
    formatDiscontinuedOutput_(output);
    return {
      sheetName: DISCONTINUED_CFG.SHEET,
      changedProducts: Object.keys(changedById).length
    };
  } finally {
    lock.releaseLock();
  }
}

function fetchKiotVietProductsByStatus_(isActive, lastModifiedFrom, token) {
  token = token || getKiotVietToken();
  if (!token) throw new Error('Không lấy được access token KiotViet.');

  const retailer = (typeof CONFIG !== 'undefined' && CONFIG.RETAILER)
    ? CONFIG.RETAILER
    : 'CHbansi';
  const result = [];
  let currentItem = 0;
  const pageSize = 100;

  while (true) {
    const query = [
      'pageSize=' + pageSize,
      'currentItem=' + currentItem,
      'orderBy=modifiedDate',
      'orderDirection=Asc',
      'isActive=' + isActive,
      'includeInventory=true',
      'includePricebook=true',
      'includeQuantity=true',
      'includeMaterial=true',
      'includeWarranties=true',
      'IncludeProductShelves=true',
      'includeSoftDeletedAttribute=false'
    ];
    if (lastModifiedFrom) {
      query.push('lastModifiedFrom=' + encodeURIComponent(lastModifiedFrom));
    }

    const requestUrl = 'https://public.kiotapi.com/products?' + query.join('&');
    const requestOptions = {
      method: 'get',
      headers: {
        Retailer: retailer,
        Authorization: 'Bearer ' + token
      },
      muteHttpExceptions: true
    };
    const response = fetchKiotVietWithRetry_(requestUrl, requestOptions);
    const status = response.getResponseCode();
    if (status < 200 || status >= 300) {
      throw new Error(
        'KiotViet products API lỗi HTTP ' + status + ': ' +
        response.getContentText().slice(0, 500)
      );
    }

    const payload = JSON.parse(response.getContentText());
    const page = payload.data || [];
    Array.prototype.push.apply(result, page);
    currentItem += page.length;
    if (!page.length || currentItem >= Number(payload.total || 0)) break;
  }
  return result;
}

function ensureDiscontinuedOutput_(ss) {
  let sheet = ss.getSheetByName(DISCONTINUED_CFG.SHEET);
  const width = DISCONTINUED_HEADERS.length;
  if (!sheet) sheet = createCompactSheet_(ss, DISCONTINUED_CFG.SHEET, 1, width);
  ensureKiotVietSheetSchema_(sheet, {
    headers: DISCONTINUED_HEADERS,
    aliases: {},
    numberHeaders: [],
    textHeaders: []
  });
  return sheet;
}

function ensureDiscontinuedState_(ss) {
  let sheet = ss.getSheetByName(DISCONTINUED_CFG.STATE_SHEET);
  if (!sheet) {
    sheet = createCompactSheet_(ss, DISCONTINUED_CFG.STATE_SHEET, 1, 6);
    sheet.getRange(1, 1, 1, 6).setValues([[
      'ID hàng hóa', 'Mã hàng', 'Tên hàng', 'isActive',
      'Ngày sửa KiotViet', 'Lần kiểm tra'
    ]]);
  }
  if (!sheet.isSheetHidden()) sheet.hideSheet();
  return sheet;
}

function readDiscontinuedState_(sheet) {
  const map = {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;
  sheet.getRange(2, 1, lastRow - 1, 6).getValues().forEach(function(row) {
    if (!row[0]) return;
    map[String(row[0])] = {
      id: row[0],
      code: row[1],
      name: row[2],
      isActive: row[3] === true || String(row[3]).toLowerCase() === 'true',
      modifiedDate: row[4],
      checkedAt: row[5]
    };
  });
  return map;
}

function writeDiscontinuedState_(sheet, products) {
  const map = {};
  products.forEach(function(p) {
    map[String(p.id)] = {
      id: p.id,
      code: p.code || '',
      name: p.name || p.fullName || '',
      isActive: p.isActive !== false,
      modifiedDate: p.modifiedDate || '',
      checkedAt: new Date()
    };
  });
  writeDiscontinuedStateMap_(sheet, map);
}

function writeDiscontinuedStateMap_(sheet, map) {
  const rows = Object.keys(map).map(function(id) {
    const s = map[id];
    return [
      s.id, s.code || '', s.name || '', s.isActive,
      s.modifiedDate || '', s.checkedAt || new Date()
    ];
  });
  rows.sort(function(a, b) { return String(a[1]).localeCompare(String(b[1])); });
  const oldRows = Math.max(0, sheet.getLastRow() - 1);
  if (oldRows) sheet.getRange(2, 1, oldRows, 6).clearContent();
  if (rows.length) {
    ensureSheetGridCapacity_(sheet, rows.length + 1, 6);
    sheet.getRange(2, 1, rows.length, 6).setValues(rows);
  }
}

function upsertDiscontinuedEvent_(sheet, product, eventType) {
  const row = discontinuedProductRow_(product, eventType);
  const lastRow = sheet.getLastRow();
  let targetRow = lastRow + 1;

  if (lastRow >= 2) {
    const ids = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(product.id)) {
        targetRow = i + 2;
        break;
      }
    }
  }
  ensureSheetGridCapacity_(sheet, targetRow, row.length);
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

function markDiscontinuedReactivated_(sheet, product) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const ids = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(product.id)) {
      sheet.getRange(i + 2, 2).setValue('Đã kinh doanh lại');
      sheet.getRange(i + 2, 1).setValue(toDateOrText_(product.modifiedDate));
      return;
    }
  }
}

function discontinuedProductRow_(p, eventType) {
  const inventories = p.inventories || [];
  const total = function(field) {
    return inventories.reduce(function(sum, item) {
      return sum + Number(item[field] || 0);
    }, 0);
  };
  const minQty = p.minQuantity != null
    ? p.minQuantity
    : inventories.reduce(function(sum, item) {
        return sum + Number(item.minQuantity || item.minQuality || 0);
      }, 0);
  const maxQty = p.maxQuantity != null
    ? p.maxQuantity
    : inventories.reduce(function(sum, item) {
        return sum + Number(item.maxQuantity || item.maxQuality || 0);
      }, 0);

  return [
    toDateOrText_(p.modifiedDate),
    p.isActive === false ? 'Ngừng kinh doanh' : 'Đang kinh doanh',
    eventType,
    p.id || '',
    p.retailerId || '',
    p.code || '',
    p.name || '',
    p.fullName || '',
    productTypeLabel_(p.type),
    p.categoryId || '',
    p.categoryName || '',
    p.tradeMarkName || '',
    p.conversionValue == null ? '' : p.conversionValue,
    booleanLabel_(p.allowsSale),
    booleanLabel_(p.hasVariants),
    p.basePrice == null ? '' : p.basePrice,
    p.weight == null ? '' : p.weight,
    total('onHand'),
    total('reserved'),
    total('onOrder'),
    minQty,
    maxQty,
    compactJson_(inventories),
    compactJson_(p.priceBooks || []),
    (p.images || []).map(function(img) {
      return typeof img === 'string' ? img : (img.Image || img.image || '');
    }).filter(String).join(String.fromCharCode(10)),
    booleanLabel_(p.isBatchExpireControl),
    p.description || '',
    toDateOrText_(p.createdDate)
  ];
}

function formatDiscontinuedOutput_(sheet) {
  const width = DISCONTINUED_HEADERS.length;
  const lastRow = sheet.getLastRow();
  const dataRowCount = Math.max(0, lastRow - 1);

  try {
    sheet.setFrozenRows(1);
  } catch (e) {
    Logger.log('Bo qua setFrozenRows: ' + e);
  }

  try {
    sheet.getRange(1, 1, Math.max(1, lastRow), width).setFontFamily('Open Sans');
  } catch (e) {
    Logger.log('Bo qua setFontFamily: ' + e);
  }

  try {
    sheet.getRange(1, 1, 1, width)
      .setBackground('#b71c1c')
      .setFontColor('#FFFFFF')
      .setFontWeight('bold')
      .setFontFamily('Open Sans')
      .setWrap(true);
  } catch (e) {
    Logger.log('Bo qua header format: ' + e);
  }

  if (dataRowCount > 0) {
    // Cot 1 (A) - Dinh dang ngay thang
    try {
      sheet.getRange(2, 1, dataRowCount, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    } catch (e) {
      Logger.log('Bo qua dinh dang ngay thang (typed column): ' + e);
    }

    // Cot 16..22 (P:V) - Dinh dang so thap phan
    try {
      sheet.getRange(2, 16, dataRowCount, 7).setNumberFormat('#,##0.00');
    } catch (e) {
      Logger.log('Bo qua dinh dang so (typed column): ' + e);
    }
  }

  try {
    sheet.getDataRange().setVerticalAlignment('top');
  } catch (e) {
    Logger.log('Bo qua setVerticalAlignment: ' + e);
  }

  try {
    sheet.autoResizeColumns(1, Math.min(width, 20));
  } catch (e) {
    Logger.log('Bo qua autoResizeColumns: ' + e);
  }

  try {
    [23, 24, 25, 27].forEach(function(column) {
      if (column <= sheet.getMaxColumns()) {
        sheet.setColumnWidth(column, 260);
      }
    });
  } catch (e) {
    Logger.log('Bo qua setColumnWidth: ' + e);
  }

  try {
    if (sheet.getFilter()) sheet.getFilter().remove();
    if (lastRow >= 1) {
      sheet.getRange(1, 1, lastRow, width).createFilter();
    }
  } catch (e) {
    Logger.log('Bo qua createFilter: ' + e);
  }
  compactUnusedSheetGrid_(sheet);
}

function toDateOrText_(value) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? value : date;
}

function booleanLabel_(value) {
  if (value === true) return 'Có';
  if (value === false) return 'Không';
  return '';
}

function productTypeLabel_(type) {
  const labels = {
    1: 'Combo',
    2: 'Hàng hóa',
    3: 'Dịch vụ'
  };
  return labels[type] || (type == null ? '' : String(type));
}

function compactJson_(value) {
  if (!value || (Array.isArray(value) && !value.length)) return '';
  return JSON.stringify(value);
}

/** Đồng bộ đầy đủ và giữ toàn bộ lịch sử sản phẩm từng ngừng kinh doanh. */
function syncHangNgungKinhDoanh() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return syncHangNgungKinhDoanh_();
  } finally {
    lock.releaseLock();
  }
}

function syncHangNgungKinhDoanh_(token) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(DISCONTINUED_CFG.TIMEZONE);
  migrateLegacyDiscontinuedSheet_(ss);
  const sheet = ensureDiscontinuedOutput_(ss);
  const width = DISCONTINUED_HEADERS.length;
  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues()
    : [];
  const rowsById = {};
  existingRows.forEach(function(row) {
    if (row[3]) rowsById[String(row[3])] = row;
  });

  const inactiveProducts = fetchKiotVietProductsByStatus_(false, null, token);
  const inactiveIds = {};
  inactiveProducts.forEach(function(product) {
    const id = String(product.id);
    inactiveIds[id] = true;
    const oldRow = rowsById[id];
    const newRow = discontinuedProductRow_(
      product,
      oldRow ? oldRow[2] : 'Nạp lịch sử ngừng kinh doanh từ KiotViet'
    );
    rowsById[id] = newRow;
  });

  Object.keys(rowsById).forEach(function(id) {
    if (!inactiveIds[id] && rowsById[id][1] === 'Ngừng kinh doanh') {
      rowsById[id][1] = 'Đã kinh doanh lại';
    }
  });

  const rows = Object.keys(rowsById).map(function(id) { return rowsById[id]; });
  rows.sort(function(a, b) {
    return new Date(b[0] || 0).getTime() - new Date(a[0] || 0).getTime();
  });
  const oldCount = Math.max(0, sheet.getLastRow() - 1);
  if (oldCount) sheet.getRange(2, 1, oldCount, width).clearContent();
  if (rows.length) {
    ensureSheetGridCapacity_(sheet, rows.length + 1, width);
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
  }
  formatDiscontinuedOutput_(sheet);
  // Chi can baseline cac ma dang ngung: ma moi ngung se duoc nhan khi khong co
  // state cu, con ma kinh doanh lai se doi chieu duoc voi state false nay.
  writeDiscontinuedState_(ensureDiscontinuedState_(ss), inactiveProducts);
  PropertiesService.getScriptProperties().setProperty(
    DISCONTINUED_CFG.PROP_LAST_SYNC,
    new Date().toISOString()
  );
  return {
    sheetName: DISCONTINUED_CFG.SHEET,
    historyCount: rows.length,
    currentInactiveCount: inactiveProducts.length
  };
}

/** Đổi tên/dọn tab legacy; không bao giờ tạo lại tab cũ. */
function migrateLegacyDiscontinuedSheet_(ss) {
  const legacySheet = ss.getSheetByName('Hàng ngừng KD hôm nay');
  if (!legacySheet) return false;
  let historySheet = ss.getSheetByName(DISCONTINUED_CFG.SHEET);
  if (!historySheet) {
    legacySheet.setName(DISCONTINUED_CFG.SHEET);
    return true;
  }

  const width = DISCONTINUED_HEADERS.length;
  historySheet = ensureDiscontinuedOutput_(ss);
  ensureKiotVietSheetSchema_(legacySheet, {
    headers: DISCONTINUED_HEADERS,
    aliases: {},
    numberHeaders: [],
    textHeaders: []
  });
  if (legacySheet.getLastRow() > 1 && legacySheet.getLastColumn() >= width) {
    const existingIds = {};
    if (historySheet.getLastRow() > 1 && historySheet.getLastColumn() >= 4) {
      historySheet.getRange(2, 4, historySheet.getLastRow() - 1, 1)
        .getValues()
        .forEach(function(row) { if (row[0]) existingIds[String(row[0])] = true; });
    }
    const legacyRows = legacySheet.getRange(
      2, 1, legacySheet.getLastRow() - 1, width
    ).getValues().filter(function(row) {
      return row[3] && !existingIds[String(row[3])];
    });
    if (legacyRows.length) {
      historySheet.getRange(historySheet.getLastRow() + 1, 1, legacyRows.length, width)
        .setValues(legacyRows);
    }
  }
  ss.deleteSheet(legacySheet);
  return true;
}

function cauHinhLichHangNgungKinhDoanh() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const token = getKiotVietToken();
    const fullSync = syncHangNgungKinhDoanh_(token);
    setupHangNgungKinhDoanhTrigger_();
    ss.toast(
      'Đã cập nhật toàn bộ lịch sử và cài lịch 07:30 mỗi ngày.',
      DISCONTINUED_CFG.SHEET,
      8
    );
    return fullSync;
  } finally {
    lock.releaseLock();
  }
}

function setupHangNgungKinhDoanhTrigger_() {
  const handlers = {
    capNhatHangNgungKinhDoanh: true,
    capNhatHangNgungKinhDoanhHomNay: true
  };
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (handlers[trigger.getHandlerFunction()]) ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('capNhatHangNgungKinhDoanh')
    .timeBased()
    .atHour(7)
    .nearMinute(30)
    .everyDays(1)
    .inTimezone(DISCONTINUED_CFG.TIMEZONE)
    .create();
}


function fetchKiotVietWithRetry_(url, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = UrlFetchApp.fetch(url, options);
      const status = response.getResponseCode();
      if (status !== 429 && status < 500) return response;
      lastError = new Error('KiotViet tạm lỗi HTTP ' + status);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 6) {
      Utilities.sleep(Math.min(15000, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError || new Error('Không thể kết nối KiotViet sau nhiều lần thử.');
}
