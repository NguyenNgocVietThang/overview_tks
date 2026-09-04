// ==========================================
// TIEN ICH DUNG CHUNG (Helper functions)
// ==========================================

/**
 * Khoa rieng luong ghi du lieu. Project bound dung DocumentLock; neu project
 * standalone thi dung UserLock (web app va trigger deu chay bang tai khoan deploy).
 * Dung cho: chuoi master, polling-only (Tra hang/Nha cung cap/Nhap hang), va
 * webhook cua cac bang khong phai Hoa don.
 */
function getKiotVietDataLock_() {
  return LockService.getDocumentLock() || LockService.getUserLock();
}

/**
 * Khoa rieng cho Hoa don + Chi tiet hoa don (backfill phan doan va webhook).
 * Tach khoi getKiotVietDataLock_() de dong bo Hoa don khong bi doi vo han khi
 * chuoi polling-only (Tra hang/Nha cung cap/Nhap hang) dang giu khoa chung
 * nhieu phut lien tuc. Dung UserLock vi DocumentLock da danh cho luong con lai;
 * trigger va web app deu chay bang tai khoan deploy nen UserLock van la mot
 * khoa duy nhat, on dinh giua cac lan chay ke tiep nhau.
 */
function getKiotVietInvoiceLock_() {
  return LockService.getUserLock();
}

/**
 * Ham lay ban do Dong tuong ung voi Ma (code) de tim kiem nhanh.
 * Tranh viec scan toan bo sheet moi lan cap nhat.
 *
 * @param {Array[][]} data - Mang 2 chieu lay tu sheet.getDataRange().getValues()
 * @param {number} codeIndex - Chi so cot chua ma code (0-based)
 * @returns {Object} Map { code: rowNumber } voi rowNumber la 1-based
 */
function getCodeRowMap(data, codeIndex) {
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const code = String(data[r][codeIndex]).trim();
    if (code) map[code] = r + 1;
  }
  return map;
}

/**
 * Dinh dang nhanh cac cot so cua dong moi them vao sheet.
 * Goi ngay sau appendRow() de format tuc thi.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Sheet dang lam viec
 * @param {number[]} colIndexes - Mang chi so cot can format (1-based)
 */
function formatLastRowNumbers(sheet, colIndexes) {
  const lastRow = sheet.getLastRow();
  colIndexes.forEach(col => {
    sheet.getRange(lastRow, col).setNumberFormat("#,##0");
  });
}

/**
 * Chuyen doi chuoi hoac doi tuong Date sang dinh dang "dd/MM/yyyy HH:mm".
 * Tra ve "---" neu gia tri khong hop le.
 *
 * @param {string|Date} dateString - Gia tri ngay can dinh dang
 * @returns {string} Chuoi ngay da dinh dang hoac "---"
 */
function formatDate(dateString) {
  if (!dateString) return "---";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "---";
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  } catch (e) { return "---"; }
}

/**
 * Nhan dien ma VAT qua Ma hang bat dau bang "VAT".
 */
function isVatProductCode(value) {
  return String(value || '').trim().toUpperCase().startsWith('VAT');
}

// ==========================================
// TIEN ICH RIENG CHO SCHEMA HANG HOA
// ==========================================

/**
 * Lay gia tri dau tien thuc su ton tai tren object. Khong dung toan tu || vi
 * cac gia tri hop le nhu 0, false va chuoi rong phai duoc giu nguyen.
 */
function pickProductValue_(product, keys) {
  const source = product || {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      return { found: true, value: source[key] };
    }
  }
  return { found: false, value: undefined };
}

function productNumber_(value) {
  const numberValue = Number(value);
  return isFinite(numberValue) ? numberValue : 0;
}

function getProductCode_(product) {
  const result = pickProductValue_(product, ['ProductCode', 'productCode', 'Code', 'code']);
  return result.found ? String(result.value || '').trim() : '';
}

function getProductArray_(product, keys) {
  const result = pickProductValue_(product, keys);
  if (!result.found) return { found: false, value: [] };
  return { found: true, value: Array.isArray(result.value) ? result.value : [] };
}

function sumInventoryField_(inventories, keys) {
  let found = false;
  const total = inventories.reduce((sum, inventory) => {
    const result = pickProductValue_(inventory, keys);
    if (!result.found) return sum;
    found = true;
    return sum + productNumber_(result.value);
  }, 0);
  return found ? total : undefined;
}

function firstInventoryField_(inventories, keys) {
  for (let i = 0; i < inventories.length; i++) {
    const result = pickProductValue_(inventories[i], keys);
    if (result.found) return productNumber_(result.value);
  }
  return undefined;
}

function getProductTypeLabel_(product) {
  const result = pickProductValue_(product, ['Type', 'type', 'ProductType', 'productType']);
  if (!result.found) return undefined;

  const type = Number(result.value);
  if (type === 1) return 'Combo';
  if (type === 3) return 'Dịch vụ';
  return 'Hàng hóa';
}

function getProductImagesText_(product) {
  const result = getProductArray_(product, ['Images', 'images']);
  if (!result.found) return undefined;

  return result.value.map(image => {
    if (typeof image === 'string') return image.trim();
    const url = pickProductValue_(image, ['Image', 'image', 'Url', 'url']);
    return url.found ? String(url.value || '').trim() : '';
  }).filter(Boolean).join('\n');
}

function getProductChannelsText_(product) {
  const result = getProductArray_(product, [
    'SaleChannels', 'saleChannels', 'SaleChannelNames', 'saleChannelNames',
    'Channels', 'channels', 'ChannelNames', 'channelNames'
  ]);
  if (!result.found) return undefined;

  return result.value.map(channel => {
    if (typeof channel === 'string') return channel.trim();
    const name = pickProductValue_(channel, ['Name', 'name', 'ChannelName', 'channelName']);
    return name.found ? String(name.value || '').trim() : '';
  }).filter(Boolean).join(', ');
}

function getProductShelvesText_(product) {
  const result = getProductArray_(product, ['ProductShelves', 'productShelves']);
  if (!result.found) return undefined;

  return result.value.map(shelf => {
    if (typeof shelf === 'string') return shelf.trim();

    const branch = pickProductValue_(shelf, ['BranchName', 'branchName']);
    const positions = pickProductValue_(shelf, [
      'ProductShelves', 'productShelves', 'Shelves', 'shelves',
      'Shelf', 'shelf', 'Position', 'position'
    ]);
    const branchText = branch.found ? String(branch.value || '').trim() : '';
    const positionText = positions.found ? String(positions.value || '').trim() : '';
    if (!positionText) return '';
    return branchText ? branchText + ': ' + positionText : positionText;
  }).filter(Boolean).join('\n');
}

function getProductInventoryValues_(product) {
  const inventoryResult = getProductArray_(product, ['Inventories', 'inventories', 'Inventory', 'inventory']);
  const inventories = inventoryResult.value;

  let onHand;
  let reserved;
  let cost;
  let minQuantity;
  let maxQuantity;

  if (inventoryResult.found) {
    onHand = sumInventoryField_(inventories, ['OnHand', 'onHand', 'onhand']);
    reserved = sumInventoryField_(inventories, ['Reserved', 'reserved']);
    cost = firstInventoryField_(inventories, ['Cost', 'cost']);
    minQuantity = sumInventoryField_(inventories, [
      'MinQuantity', 'minQuantity', 'MinQuality', 'minQuality'
    ]);
    maxQuantity = sumInventoryField_(inventories, [
      'MaxQuantity', 'maxQuantity', 'MaxQuality', 'maxQuality'
    ]);

    // Mang ton kho rong la mot gia tri day du: ton va khach dat deu bang 0.
    if (inventories.length === 0) {
      onHand = 0;
      reserved = 0;
      cost = 0;
      minQuantity = 0;
      maxQuantity = 0;
    }
  } else {
    const onHandResult = pickProductValue_(product, ['OnHand', 'onHand', 'onhand', 'TotalOnHand', 'totalOnHand']);
    const reservedResult = pickProductValue_(product, ['Reserved', 'reserved', 'TotalReserved', 'totalReserved']);
    const costResult = pickProductValue_(product, ['Cost', 'cost']);
    if (onHandResult.found) onHand = productNumber_(onHandResult.value);
    if (reservedResult.found) reserved = productNumber_(reservedResult.value);
    if (costResult.found) cost = productNumber_(costResult.value);
  }

  const minResult = pickProductValue_(product, ['MinQuantity', 'minQuantity']);
  const maxResult = pickProductValue_(product, ['MaxQuantity', 'maxQuantity']);
  if (minResult.found) minQuantity = productNumber_(minResult.value);
  if (maxResult.found) maxQuantity = productNumber_(maxResult.value);

  return {
    onHand: onHand,
    reserved: reserved,
    cost: cost,
    minQuantity: minQuantity,
    maxQuantity: maxQuantity
  };
}

function productRowValue_(value, existingRow, index, defaultValue) {
  if (value !== undefined) return value;
  if (existingRow && existingRow[index] !== undefined) return existingRow[index];
  return defaultValue;
}

/**
 * Chuyen object san pham (Public API hoac webhook) thanh mot dong theo schema
 * PRODUCT_SHEET_HEADERS. Truong khong co trong payload webhook se giu gia tri
 * hien tai thay vi bi ghi de thanh 0/chuoi rong.
 */
function buildProductSheetRow_(product, existingRow) {
  const inventories = getProductInventoryValues_(product);
  const name = pickProductValue_(product, ['FullName', 'fullName', 'ProductName', 'productName', 'Name', 'name']);
  const categoryName = pickProductValue_(product, ['CategoryName', 'categoryName']);
  const basePrice = pickProductValue_(product, ['BasePrice', 'basePrice', 'Price', 'price']);
  const isActive = pickProductValue_(product, ['IsActive', 'isActive']);
  const modifiedDate = pickProductValue_(product, ['ModifiedDate', 'modifiedDate', 'CreatedDate', 'createdDate']);
  const categoryId = pickProductValue_(product, ['CategoryId', 'categoryId']);
  const values = [
    getProductCode_(product),
    name.found ? String(name.value || '') : undefined,
    categoryName.found ? String(categoryName.value || '') : undefined,
    getProductTypeLabel_(product),
    inventories.cost,
    basePrice.found ? productNumber_(basePrice.value) : undefined,
    inventories.onHand,
    inventories.reserved,
    isActive.found ? (isActive.value === false ? 'Ngừng kinh doanh' : 'Đang kinh doanh') : undefined,
    modifiedDate.found ? formatDate(modifiedDate.value) : undefined,
    categoryId.found ? categoryId.value : undefined,
    getProductShelvesText_(product)
  ];

  const defaults = [
    '', '', '', 'Hàng hóa', 0, 0, 0, 0, 'Đang kinh doanh',
    '---', '', ''
  ];

  return values.map((value, index) => productRowValue_(value, existingRow, index, defaults[index]));
}

function formatProductSheet_(sheet, dataRowCount) {
  sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#1F4E78')
    .setFontFamily('Open Sans');
  sheet.setFrozenRows(1);

  if (dataRowCount <= 0) return;
  sheet.getRange(2, 1, dataRowCount, PRODUCT_SHEET_HEADERS.length).setFontFamily('Open Sans');
  sheet.getRange(2, 5, dataRowCount, 4).setNumberFormat('#,##0');
  sheet.getRange(2, 12, dataRowCount, 1).setWrap(true);
}

function formatProductSheetRow_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 1, 1, PRODUCT_SHEET_HEADERS.length).setFontFamily('Open Sans');
  sheet.getRange(rowNumber, 5, 1, 4).setNumberFormat('#,##0');
  sheet.getRange(rowNumber, 12).setWrap(true);
}

/**
 * Nang cap sheet cu (7 hoac 12 cot) sang schema moi ma van giu du lieu hien co.
 * Cac cot doi ten duoc map bang alias; cot moi chua co nguon du lieu se de trong.
 */
function ensureProductSheetSchema_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow === 0 || lastColumn === 0) {
    sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([PRODUCT_SHEET_HEADERS]);
    formatProductSheet_(sheet, 0);
    return;
  }

  const oldHeaders = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const schemaMatches = PRODUCT_SHEET_HEADERS.length === oldHeaders.length &&
    PRODUCT_SHEET_HEADERS.every((header, index) => header === oldHeaders[index]);
  if (schemaMatches) return;

  const aliases = {
    'Loại hàng': ['Loại hàng', 'Loại'],
    'Trạng thái': ['Trạng thái', 'Trạng thái kinh doanh'],
    'Ngày sửa cuối': ['Ngày sửa cuối', 'Thời gian tạo', 'Ngày cập nhật']
  };
  const oldIndexByHeader = {};
  oldHeaders.forEach((header, index) => {
    if (header) oldIndexByHeader[header] = index;
  });

  const oldRows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues()
    : [];
  const migratedRows = oldRows.map(oldRow => PRODUCT_SHEET_HEADERS.map((header, newIndex) => {
    const candidates = aliases[header] || [header];
    for (let i = 0; i < candidates.length; i++) {
      const oldIndex = oldIndexByHeader[candidates[i]];
      if (oldIndex !== undefined) return oldRow[oldIndex];
    }
    const defaults = ['', '', '', 'Hàng hóa', 0, 0, 0, 0, 'Đang kinh doanh', '---', '', ''];
    return defaults[newIndex];
  }));

  const previousLastRow = lastRow;
  const previousLastColumn = lastColumn;
  sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([PRODUCT_SHEET_HEADERS]);
  if (migratedRows.length > 0) {
    sheet.getRange(2, 1, migratedRows.length, PRODUCT_SHEET_HEADERS.length).setValues(migratedRows);
  }
  const newLastRow = migratedRows.length + 1;
  if (previousLastRow > newLastRow) {
    sheet.getRange(
      newLastRow + 1,
      1,
      previousLastRow - newLastRow,
      previousLastColumn
    ).clearContent();
  }
  if (previousLastColumn > PRODUCT_SHEET_HEADERS.length) {
    sheet.deleteColumns(
      PRODUCT_SHEET_HEADERS.length + 1,
      previousLastColumn - PRODUCT_SHEET_HEADERS.length
    );
  }
  formatProductSheet_(sheet, migratedRows.length);
}

/**
 * Dinh dang tat ca cac sheet trong spreadsheet sang font Open Sans va tieu de cac truong mau trang (#FFFFFF).
 * Co the chay truc tiep tu GAS Editor de cap nhat tat ca cac tab hien co.
 */
function formatAllSheetsToOpenSans() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();

  sheets.forEach(sheet => {
    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow <= 0 || lastCol <= 0) return;

    const fullRange = sheet.getRange(1, 1, lastRow, lastCol);
    fullRange.setFontFamily('Open Sans');

    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    headerRange
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setFontFamily('Open Sans');

    // Neu hang dau chua co mau nen dam, dat mau nen mac dinh #1F4E78 cho tieu de de chu trang noi bat
    const currentBg = headerRange.getBackground();
    if (!currentBg || currentBg === '#ffffff' || currentBg.toLowerCase() === '#efefef') {
      headerRange.setBackground('#1F4E78');
    }
  });
}

// Google Sheets gioi han 10 trieu o cho moi spreadsheet. Truoc khi mo rong
// mot sheet, thu hoi cac hang/cot hoan toan trong o cac sheet khac neu phep
// mo rong se vuot gioi han. Du lieu trong used range khong bi thay doi.
const SPREADSHEET_GRID_CELL_LIMIT_ = 10000000;

function spreadsheetGridCellCount_(spreadsheet) {
  return spreadsheet.getSheets().reduce(function(total, sheet) {
    return total + sheet.getMaxRows() * sheet.getMaxColumns();
  }, 0);
}

function compactUnusedSheetGrid_(sheet) {
  // Sheets bat buoc giu lai it nhat mot hang/cot khong bi co dinh.
  const usedRows = Math.max(sheet.getLastRow(), sheet.getFrozenRows() + 1, 1);
  const usedColumns = Math.max(sheet.getLastColumn(), sheet.getFrozenColumns() + 1, 1);
  const extraRows = sheet.getMaxRows() - usedRows;
  const extraColumns = sheet.getMaxColumns() - usedColumns;

  if (extraRows > 0) sheet.deleteRows(usedRows + 1, extraRows);
  if (extraColumns > 0) sheet.deleteColumns(usedColumns + 1, extraColumns);
}

/** Thu gon lưới trống cua tat ca tab ma khong cham vao used range/frozen panes. */
function compactAllSheetsSafely() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const beforeCells = spreadsheetGridCellCount_(spreadsheet);
  const sheets = [];
  spreadsheet.getSheets().forEach(function(sheet) {
    const beforeRows = sheet.getMaxRows();
    const beforeColumns = sheet.getMaxColumns();
    compactUnusedSheetGrid_(sheet);
    const afterRows = sheet.getMaxRows();
    const afterColumns = sheet.getMaxColumns();
    sheets.push({
      sheetName: sheet.getName(),
      beforeRows: beforeRows,
      beforeColumns: beforeColumns,
      afterRows: afterRows,
      afterColumns: afterColumns,
      reclaimedCells: beforeRows * beforeColumns - afterRows * afterColumns
    });
  });
  const result = {
    beforeCells: beforeCells,
    afterCells: spreadsheetGridCellCount_(spreadsheet),
    sheets: sheets
  };
  Logger.log('Ket qua thu gon lưới: ' + JSON.stringify(result));
  return result;
}

function ensureSpreadsheetCellHeadroom_(spreadsheet, additionalCells) {
  additionalCells = Math.max(Number(additionalCells) || 0, 0);
  let currentCells = spreadsheetGridCellCount_(spreadsheet);
  if (currentCells + additionalCells <= SPREADSHEET_GRID_CELL_LIMIT_) {
    return;
  }

  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i];
    const before = sheet.getMaxRows() * sheet.getMaxColumns();
    compactUnusedSheetGrid_(sheet);
    const after = sheet.getMaxRows() * sheet.getMaxColumns();
    currentCells += after - before;
    if (currentCells + additionalCells <= SPREADSHEET_GRID_CELL_LIMIT_) return;
  }

  throw new Error(
    'Bảng tính đã đạt giới hạn 10.000.000 ô và không còn lưới trống để thu gọn.'
  );
}

function createCompactSheet_(spreadsheet, sheetName, requiredRows, requiredColumns) {
  // Apps Script tao sheet moi voi lưới mac dinh 1.000 x 26. Can bao dam
  // headroom truoc khi tao. Khong truy cap sheet ngay sau insertSheet: tren file
  // lon, Sheets co the timeout moi phep getMaxRows/getLastRow/hideSheet trong
  // vai chuc giay dau. Lưới mac dinh du cho trang staging dau tien; cac lan ghi
  // sau mo rong theo nhu cau qua ensureSheetGridCapacity_.
  ensureSpreadsheetCellHeadroom_(spreadsheet, 1000 * 26);
  return spreadsheet.insertSheet(sheetName);
}

function ensureSheetGridCapacity_(sheet, requiredRows, requiredColumns) {
  requiredRows = Math.max(Number(requiredRows) || 0, 1);
  requiredColumns = Math.max(Number(requiredColumns) || 0, 1);

  let currentRows = sheet.getMaxRows();
  let currentColumns = sheet.getMaxColumns();
  if (currentRows >= requiredRows && currentColumns >= requiredColumns) return;

  const spreadsheet = sheet.getParent();
  const projectedRows = Math.max(currentRows, requiredRows);
  const projectedColumns = Math.max(currentColumns, requiredColumns);
  const growth = projectedRows * projectedColumns - currentRows * currentColumns;

  if (spreadsheetGridCellCount_(spreadsheet) + growth > SPREADSHEET_GRID_CELL_LIMIT_) {
    ensureSpreadsheetCellHeadroom_(spreadsheet, growth);
    currentRows = sheet.getMaxRows();
    currentColumns = sheet.getMaxColumns();
  }

  const finalRows = Math.max(currentRows, requiredRows);
  const finalColumns = Math.max(currentColumns, requiredColumns);
  const finalGrowth = finalRows * finalColumns - currentRows * currentColumns;
  if (spreadsheetGridCellCount_(spreadsheet) + finalGrowth > SPREADSHEET_GRID_CELL_LIMIT_) {
    throw new Error(
      'Bảng tính đã đạt giới hạn 10.000.000 ô và không còn lưới trống để thu gọn.'
    );
  }

  if (currentRows < requiredRows) {
    sheet.insertRowsAfter(currentRows, requiredRows - currentRows);
  }
  currentColumns = sheet.getMaxColumns();
  if (currentColumns < requiredColumns) {
    sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
  }
}
