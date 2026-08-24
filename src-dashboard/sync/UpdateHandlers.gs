// ==========================================
// CAP NHAT REAL-TIME THEO SCHEMA DAY DU
// ==========================================

function updateProductsFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.products;
  const hydratedItems = hydrateKiotVietItems_(items, schema);
  const token = getKiotVietToken();
  if (token) enrichProductTrademarkNames_(hydratedItems, token);

  const vatItems = [];
  const validItems = [];
  hydratedItems.forEach(item => {
    if (isVatProductCode(getProductCode_(item))) vatItems.push(item);
    else validItems.push(item);
  });
  if (vatItems.length > 0) deleteKiotVietSheetItems_(schema, vatItems);
  upsertKiotVietSheetItems_(schema, validItems);
}

function updateInvoicesFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.invoices;
  const hydratedItems = hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
  replaceInvoiceDetailsForInvoices_(hydratedItems);
  try {
    updateCustomerProductReportFromInvoices_(hydratedItems);
  } catch (error) {
    Logger.log('Loi cap nhat real-time Hang ban theo khach: ' + error.toString());
  }
}

function updateOrdersFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.orders;
  const hydratedItems = hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
}

function updateCustomersFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.customers;
  const hydratedItems = hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
}

function updateCategoriesFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.categories;
  const hydratedItems = hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
}

function deleteProductsFromWebhook(items) {
  deleteKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.products, items);
}

function deleteInvoicesFromWebhook(items) {
  const deletedCodes = deleteKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.invoices, items);
  deleteInvoiceDetailsByCodes_(deletedCodes);
  try {
    deleteCustomerProductReportInvoices_(items, deletedCodes);
  } catch (error) {
    Logger.log('Loi xoa hoa don khoi Hang ban theo khach: ' + error.toString());
  }
}

function deleteOrdersFromWebhook(items) {
  deleteKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.orders, items);
}

function deleteCustomersFromWebhook(items) {
  deleteKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.customers, items);
}

function deleteCategoriesFromWebhook(items) {
  deleteKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.categories, items);
}

/**
 * Webhook KiotViet thuong chi chua cac truong vua thay doi. Lay lai chi tiet
 * theo lo bang fetchAll() de ghi du cac cot va giu nguyen cac truong khong doi.
 */
function hydrateKiotVietItems_(items, schema) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const token = getKiotVietToken();
  if (!token) {
    Logger.log('Khong lay duoc token de bo sung chi tiet ' + schema.sheetName + '.');
    return items;
  }

  const requests = [];
  const requestItemIndexes = [];
  items.forEach((item, index) => {
    const id = kiotVietId_(item, schema.idKeys);
    const code = kiotVietText_(item, schema.codeKeys).trim();
    let url = '';
    if (id) {
      url = 'https://public.kiotapi.com/' + schema.endpoint + '/' + encodeURIComponent(id);
    } else if (code) {
      url = 'https://public.kiotapi.com/' + schema.endpoint + '/code/' + encodeURIComponent(code);
    }
    if (!url) return;
    if (schema.detailQuery) url += '?' + schema.detailQuery;

    requests.push({
      url: url,
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

  let responses;
  try {
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    Logger.log('Loi lay chi tiet ' + schema.sheetName + ': ' + error.toString());
    return items;
  }

  const hydratedItems = items.slice();
  responses.forEach((response, responseIndex) => {
    const itemIndex = requestItemIndexes[responseIndex];
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      Logger.log(
        'Khong lay duoc chi tiet ' + schema.sheetName + ', HTTP ' + responseCode +
        ': ' + response.getContentText()
      );
      return;
    }

    try {
      const parsed = JSON.parse(response.getContentText());
      const detail = parsed && parsed.data && !Array.isArray(parsed.data)
        ? parsed.data
        : parsed;
      // Payload webhook uu tien neu cung truong, vi day la thay doi moi nhat.
      hydratedItems[itemIndex] = Object.assign({}, detail || {}, items[itemIndex]);
    } catch (error) {
      Logger.log('Khong parse duoc chi tiet ' + schema.sheetName + ': ' + error.toString());
    }
  });

  return hydratedItems;
}

/**
 * Mot so phien ban endpoint chi tiet chi tra tradeMarkId. Bo sung ten thuong
 * hieu tu /trademark va cache 10 phut de giam request.
 */
function enrichProductTrademarkNames_(items, token) {
  const needsTrademarkLookup = items.some(item => {
    const name = pickKiotVietValue_(item, [
      'TradeMarkName', 'tradeMarkName', 'TrademarkName', 'trademarkName'
    ]);
    const id = pickKiotVietValue_(item, [
      'TradeMarkId', 'tradeMarkId', 'TrademarkId', 'trademarkId'
    ]);
    return !name.found && id.found && id.value !== null && id.value !== '';
  });
  if (!needsTrademarkLookup) return;

  const cache = CacheService.getScriptCache();
  const cacheKey = 'kv_product_trademark_map_v2';
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
        const url = 'https://public.kiotapi.com/trademark?pageSize=' +
          pageSize + '&currentItem=' + currentItem;
        const result = fetchKiotVietJsonWithRetry_(url, token, 'trademark');
        (result.data || []).forEach(tradeMark => {
          const id = kiotVietId_(tradeMark, ['TradeMarkId', 'tradeMarkId', 'Id', 'id']);
          if (id) {
            tradeMarkMap[id] = kiotVietText_(tradeMark, [
              'TradeMarkName', 'tradeMarkName', 'Name', 'name'
            ]);
          }
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
    const name = pickKiotVietValue_(item, [
      'TradeMarkName', 'tradeMarkName', 'TrademarkName', 'trademarkName'
    ]);
    const id = kiotVietId_(item, [
      'TradeMarkId', 'tradeMarkId', 'TrademarkId', 'trademarkId'
    ]);
    if (!name.found && id) item.tradeMarkName = tradeMarkMap[id] || '';
  });
}
