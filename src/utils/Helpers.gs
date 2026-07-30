// ==========================================
// TIEN ICH DUNG CHUNG (Helper functions)
// ==========================================

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
  const tradeMarkName = pickProductValue_(product, ['TradeMarkName', 'tradeMarkName', 'TrademarkName', 'trademarkName']);
  const basePrice = pickProductValue_(product, ['BasePrice', 'basePrice', 'Price', 'price']);
  const isActive = pickProductValue_(product, ['IsActive', 'isActive']);
  const createdDate = pickProductValue_(product, ['CreatedDate', 'createdDate']);
  const categoryId = pickProductValue_(product, ['CategoryId', 'categoryId']);
  const estimatedOutOfStock = pickProductValue_(product, [
    'EstimatedOutOfStockDate', 'estimatedOutOfStockDate',
    'ExpectedOutOfStockDate', 'expectedOutOfStockDate'
  ]);

  const values = [
    getProductCode_(product),
    name.found ? String(name.value || '') : undefined,
    categoryName.found ? String(categoryName.value || '') : undefined,
    tradeMarkName.found ? String(tradeMarkName.value || '') : undefined,
    getProductTypeLabel_(product),
    inventories.cost,
    basePrice.found ? productNumber_(basePrice.value) : undefined,
    inventories.onHand,
    inventories.reserved,
    isActive.found ? (isActive.value === false ? 'Ngừng kinh doanh' : 'Đang kinh doanh') : undefined,
    createdDate.found ? formatDate(createdDate.value) : undefined,
    categoryId.found ? categoryId.value : undefined,
    getProductImagesText_(product),
    getProductChannelsText_(product),
    getProductShelvesText_(product),
    estimatedOutOfStock.found ? formatDate(estimatedOutOfStock.value) : undefined,
    inventories.minQuantity,
    inventories.maxQuantity
  ];

  const defaults = [
    '', '', '', '', 'Hàng hóa', 0, 0, 0, 0, 'Đang kinh doanh',
    '---', '', '', '', '', '---', 0, 0
  ];

  return values.map((value, index) => productRowValue_(value, existingRow, index, defaults[index]));
}

function formatProductSheet_(sheet, dataRowCount) {
  sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#EFEFEF');
  sheet.setFrozenRows(1);

  if (dataRowCount <= 0) return;
  sheet.getRange(2, 6, dataRowCount, 4).setNumberFormat('#,##0');
  sheet.getRange(2, 17, dataRowCount, 2).setNumberFormat('#,##0');
  sheet.getRange(2, 13, dataRowCount, 1).setWrap(true);
  sheet.getRange(2, 15, dataRowCount, 1).setWrap(true);
}

function formatProductSheetRow_(sheet, rowNumber) {
  sheet.getRange(rowNumber, 6, 1, 4).setNumberFormat('#,##0');
  sheet.getRange(rowNumber, 17, 1, 2).setNumberFormat('#,##0');
  sheet.getRange(rowNumber, 13).setWrap(true);
  sheet.getRange(rowNumber, 15).setWrap(true);
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
    'Trạng thái': ['Trạng thái', 'Trạng thái kinh doanh']
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
    const defaults = ['', '', '', '', 'Hàng hóa', 0, 0, 0, 0, 'Đang kinh doanh', '---', '', '', '', '', '---', 0, 0];
    return defaults[newIndex];
  }));

  sheet.clearContents();
  sheet.getRange(1, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([PRODUCT_SHEET_HEADERS]);
  if (migratedRows.length > 0) {
    sheet.getRange(2, 1, migratedRows.length, PRODUCT_SHEET_HEADERS.length).setValues(migratedRows);
  }
  formatProductSheet_(sheet, migratedRows.length);
}
