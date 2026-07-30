// ==========================================
// XU LY CAP NHAT DU LIEU REAL-TIME TU WEBHOOK
// ==========================================

/**
 * Cap nhat Tab: HANG HOA (Real-time)
 * @param {Array} items - Danh sach hang hoa tu webhook payload
 */
function updateProductsFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_PRODUCTS) || ss.insertSheet(CONFIG.SHEET_PRODUCTS);
  ensureProductSheetSchema_(sheet);

  // product.update khong chua du toan bo field; stock.update chi chua ton kho
  // cua mot chi nhanh. Lay lai chi tiet de dong luon dung va khong mat field.
  const hydratedItems = hydrateProductsFromWebhook_(items);

  let data = sheet.getDataRange().getValues();
  let codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma hang o cot A (index 0)

  // Xoa tu duoi len truoc khi cap nhat de khong lam sai so dong trong codeRowMap.
  const vatRows = [];
  hydratedItems.forEach(item => {
    const code = getProductCode_(item);
    if (isVatProductCode(code) && codeRowMap[code]) vatRows.push(codeRowMap[code]);
  });
  [...new Set(vatRows)].sort((a, b) => b - a).forEach(rowNumber => sheet.deleteRow(rowNumber));
  if (vatRows.length > 0) {
    data = sheet.getDataRange().getValues();
    codeRowMap = getCodeRowMap(data, 0);
  }

  hydratedItems.forEach(item => {
    const code = getProductCode_(item);
    if (!code) return;
    if (isVatProductCode(code)) return;

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      const existingRow = data[r - 1] || [];
      const row = buildProductSheetRow_(item, existingRow);
      sheet.getRange(r, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([row]);
      formatProductSheetRow_(sheet, r);
      data[r - 1] = row;
    } else {
      const newRow = buildProductSheetRow_(item);
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, PRODUCT_SHEET_HEADERS.length).setValues([newRow]);
      const newRowNumber = sheet.getLastRow();
      formatProductSheetRow_(sheet, newRowNumber);
      codeRowMap[code] = newRowNumber;
      data.push(newRow);
    }
  });
}

/**
 * Lay chi tiet day du cua cac san pham trong webhook theo lo bang fetchAll().
 * Neu API loi, giu payload goc de webhook van co the cap nhat cac field san co.
 */
function hydrateProductsFromWebhook_(items) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const token = getKiotVietToken();
  if (!token) {
    Logger.log('Khong lay duoc token de bo sung chi tiet Hang hoa tu webhook.');
    return items;
  }

  const requests = [];
  const requestItemIndexes = [];
  items.forEach((item, index) => {
    const idResult = pickProductValue_(item, ['ProductId', 'productId', 'Id', 'id']);
    const code = getProductCode_(item);
    let url = '';
    if (idResult.found && idResult.value !== '' && idResult.value !== null && idResult.value !== undefined) {
      url = 'https://public.kiotapi.com/products/' + encodeURIComponent(String(idResult.value));
    } else if (code) {
      url = 'https://public.kiotapi.com/products/code/' + encodeURIComponent(code);
    }
    if (!url) return;

    requests.push({
      url: url + '?includeSoftDeletedAttribute=false&includeQuantity=true&IncludeProductShelves=true',
      method: 'get',
      headers: {
        Authorization: 'Bearer ' + token,
        Retailer: CONFIG.RETAILER
      },
      muteHttpExceptions: true
    });
    requestItemIndexes.push(index);
  });

  if (requests.length === 0) return items;

  const hydratedItems = items.slice();
  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    Logger.log('Loi lay chi tiet Hang hoa tu webhook: ' + error.toString());
    return items;
  }

  responses.forEach((response, responseIndex) => {
    const itemIndex = requestItemIndexes[responseIndex];
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
      Logger.log('Khong lay duoc chi tiet Hang hoa, HTTP ' + response.getResponseCode());
      return;
    }
    try {
      const detail = JSON.parse(response.getContentText());
      // Payload webhook (chu hoa) uu tien hon neu cung field voi du lieu chi tiet.
      hydratedItems[itemIndex] = Object.assign({}, detail, items[itemIndex]);
    } catch (error) {
      Logger.log('Khong parse duoc chi tiet Hang hoa: ' + error.toString());
    }
  });

  enrichProductTrademarkNames_(hydratedItems, token);
  return hydratedItems;
}

/**
 * Endpoint chi tiet chi tra tradeMarkId o mot so phien ban API. Bo sung ten
 * thuong hieu tu endpoint /trademark va cache 10 phut de giam request.
 */
function enrichProductTrademarkNames_(items, token) {
  const needsTrademarkLookup = items.some(item => {
    const name = pickProductValue_(item, ['TradeMarkName', 'tradeMarkName', 'TrademarkName', 'trademarkName']);
    const id = pickProductValue_(item, ['TradeMarkId', 'tradeMarkId', 'TrademarkId', 'trademarkId']);
    return !name.found && id.found && id.value !== null && id.value !== '';
  });
  if (!needsTrademarkLookup) return;

  const cache = CacheService.getScriptCache();
  const cacheKey = 'kv_product_trademark_map_v1';
  let tradeMarkMap = {};
  try {
    const cached = cache.get(cacheKey);
    if (cached) tradeMarkMap = JSON.parse(cached);
  } catch (error) {
    tradeMarkMap = {};
  }

  if (Object.keys(tradeMarkMap).length === 0) {
    let currentItem = 0;
    const pageSize = 100;
    let total = 0;
    try {
      do {
        const url = 'https://public.kiotapi.com/trademark?pageSize=' + pageSize + '&currentItem=' + currentItem;
        const response = UrlFetchApp.fetch(url, {
          headers: {
            Authorization: 'Bearer ' + token,
            Retailer: CONFIG.RETAILER
          },
          muteHttpExceptions: true
        });
        if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) break;
        const result = JSON.parse(response.getContentText());
        (result.data || []).forEach(tradeMark => {
          const id = pickProductValue_(tradeMark, ['TradeMarkId', 'tradeMarkId', 'Id', 'id']);
          const name = pickProductValue_(tradeMark, ['TradeMarkName', 'tradeMarkName', 'Name', 'name']);
          if (id.found) tradeMarkMap[String(id.value)] = name.found ? String(name.value || '') : '';
        });
        total = Number(result.total) || 0;
        currentItem += pageSize;
      } while (currentItem < total);
      cache.put(cacheKey, JSON.stringify(tradeMarkMap), 600);
    } catch (error) {
      Logger.log('Khong lay duoc danh sach Thuong hieu: ' + error.toString());
    }
  }

  items.forEach(item => {
    const name = pickProductValue_(item, ['TradeMarkName', 'tradeMarkName', 'TrademarkName', 'trademarkName']);
    const id = pickProductValue_(item, ['TradeMarkId', 'tradeMarkId', 'TrademarkId', 'trademarkId']);
    if (!name.found && id.found) {
      item.tradeMarkName = tradeMarkMap[String(id.value)] || '';
    }
  });
}

/**
 * Cap nhat Tab: HOA DON (Real-time)
 * @param {Array} items - Danh sach hoa don tu webhook payload
 */
function updateInvoicesFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_INVOICES);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma hoa don o cot A (index 0)

  items.forEach(item => {
    const code = String(item.InvoiceCode || item.Code || item.code || "").trim();
    if (!code) return;

    const customer = item.CustomerName || item.customerName || "Khách lẻ";
    const total = item.Total !== undefined ? item.Total : (item.total || 0);
    const discount = item.Discount !== undefined ? item.Discount : (item.discount || 0);
    const actualPay = item.ActualPayment !== undefined ? item.ActualPayment : (item.actualPayment || 0);
    const timeStr = formatDate(item.PurchaseDate || item.purchaseDate || new Date());

    let statusText = "Hoàn thành";
    if (item.Status === 2 || item.status === 2) statusText = "Đã hủy";

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      sheet.getRange(r, 2).setValue(customer);
      sheet.getRange(r, 3).setValue(total).setNumberFormat("#,##0");
      sheet.getRange(r, 4).setValue(discount).setNumberFormat("#,##0");
      sheet.getRange(r, 5).setValue(actualPay).setNumberFormat("#,##0");
      sheet.getRange(r, 6).setValue(statusText);
    } else {
      const newRow = [code, customer, total, discount, actualPay, statusText, timeStr];
      sheet.appendRow(newRow);
      formatLastRowNumbers(sheet, [3, 4, 5]);
    }
  });
}

/**
 * Cap nhat Tab: KHACH HANG (Real-time)
 * @param {Array} items - Danh sach khach hang tu webhook payload
 */
function updateCustomersFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CUSTOMERS);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma khach o cot A (index 0)

  items.forEach(item => {
    const code = String(item.Code || item.code || "").trim();
    if (!code) return;

    const name = item.Name || item.name || "";
    const phone = item.ContactNumber || item.contactNumber || "";
    const address = item.Address || item.address || "";
    const email = item.Email || item.email || "";
    const totalDebt = item.TotalDebt !== undefined ? item.TotalDebt : (item.totalDebt || 0); // No hien tai

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      sheet.getRange(r, 2).setValue(name);
      sheet.getRange(r, 3).setValue(phone).setNumberFormat("@");
      sheet.getRange(r, 4).setValue(address);
      sheet.getRange(r, 5).setValue(email);
      sheet.getRange(r, 6).setValue(totalDebt).setNumberFormat("#,##0");
    } else {
      const newRow = [code, name, phone, address, email, totalDebt];
      sheet.appendRow(newRow);
      formatLastRowNumbers(sheet, [6]);
    }
  });
}

/**
 * Cap nhat Tab: NHOM HANG (Real-time)
 * @param {Array} items - Danh sach nhom hang tu webhook payload
 */
function updateCategoriesFromWebhook(items) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_CATEGORIES) || ss.insertSheet(CONFIG.SHEET_CATEGORIES);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Mã nhóm hàng", "Tên nhóm hàng", "Mã nhóm cha"]);
  }

  const data = sheet.getDataRange().getValues();
  const codeRowMap = getCodeRowMap(data, 0); // Tim theo Ma nhom hang o cot A (index 0)

  items.forEach(item => {
    const code = String(
      item.CategoryId !== undefined ? item.CategoryId : (item.categoryId !== undefined ? item.categoryId : (item.Id || item.id || ""))
    ).trim();
    if (!code) return;

    const name = item.CategoryName || item.categoryName || item.Name || item.name || "";
    const parentId = item.ParentId !== undefined ? item.ParentId : (item.parentId !== undefined ? item.parentId : "");

    if (codeRowMap[code]) {
      const r = codeRowMap[code];
      if (name) sheet.getRange(r, 2).setValue(name);
      sheet.getRange(r, 3).setValue(parentId);
    } else {
      sheet.appendRow([code, name, parentId]);
    }
  });
}
