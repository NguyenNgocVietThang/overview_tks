// ==========================================
// CAP NHAT REAL-TIME THEO SCHEMA DAY DU
// ==========================================

function updateProductsFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.products;
  const hydratedItems = isKiotVietHydrateSkipEnabled_('products')
    ? hydrateIncompleteWebhookItems_(items, schema, isCompleteProductWebhookItem_)
    : hydrateKiotVietItems_(items, schema);
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

/**
 * stock.update da co ma hang va cac truong ton kho moi nhat. Ghi truc tiep de
 * tranh mot endpoint chi tiet loi lam tre ca burst; upsert se giu lai cac cot
 * metadata hien co ma payload stock khong cung cap.
 */
function updateProductStocksFromWebhook(items) {
  upsertKiotVietSheetItems_(KIOTVIET_SHEET_SCHEMAS.products, items);
}

function updateInvoicesFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.invoices;
  const hydratedItems = hydrateIncompleteInvoiceWebhookItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
  replaceInvoiceDetailsForInvoices_(hydratedItems);
  try {
    updateCustomerProductReportFromInvoices_(hydratedItems);
  } catch (error) {
    Logger.log('Loi cap nhat real-time Hang ban theo khach: ' + error.toString());
  }
}

/**
 * invoice.update cua KiotViet thuong da kem day du InvoiceDetails. Chi goi
 * endpoint chi tiet cho payload thieu code hoac thieu mang chi tiet, de moi
 * webhook binh thuong khong ton them mot UrlFetch request.
 */
function hydrateIncompleteInvoiceWebhookItems_(items, schema) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const incompleteItems = [];
  const incompleteIndexes = [];
  items.forEach(function(item, index) {
    const code = kiotVietText_(item, schema.codeKeys).trim();
    const details = item && (
      Array.isArray(item.InvoiceDetails) ? item.InvoiceDetails :
      (Array.isArray(item.invoiceDetails) ? item.invoiceDetails : null)
    );
    if (code && details !== null) return;
    incompleteItems.push(item);
    incompleteIndexes.push(index);
  });

  if (incompleteItems.length === 0) return items.slice();

  const hydratedIncompleteItems = hydrateKiotVietItems_(incompleteItems, schema);
  const hydratedItems = items.slice();
  incompleteIndexes.forEach(function(itemIndex, hydratedIndex) {
    hydratedItems[itemIndex] = hydratedIncompleteItems[hydratedIndex];
  });
  return hydratedItems;
}

/**
 * Script Property danh sach cac bang (phan cach boi dau phay) duoc phep dung
 * hydrate-skip-if-complete nhu Hoa don, vi du "products,orders". Mac dinh
 * rong: giu nguyen hanh vi hydrate-toan-bo hien tai cho toi khi soi log
 * _KV_WEBHOOK_QUEUE that xac nhan tieu chi "du du lieu" duoi day dung voi
 * payload webhook that cua tung bang, roi moi bat tung bang mot qua Script
 * Properties (khong can deploy lai code).
 */
const KIOTVIET_HYDRATE_SKIP_ENTITIES_PROPERTY_ = 'KIOTVIET_HYDRATE_SKIP_ENTITIES';

function isKiotVietHydrateSkipEnabled_(entityKey) {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(KIOTVIET_HYDRATE_SKIP_ENTITIES_PROPERTY_) || '';
  return raw.split(',')
    .map(function(value) { return value.trim().toLowerCase(); })
    .indexOf(String(entityKey).toLowerCase()) !== -1;
}

/**
 * Ban tong quat cua hydrateIncompleteInvoiceWebhookItems_ cho cac bang khac
 * Hoa don: chi hydrate nhung item ma isItemComplete tra ve false, giu nguyen
 * cac item da du du lieu de khong tieu UrlFetch.
 */
function hydrateIncompleteWebhookItems_(items, schema, isItemComplete) {
  if (!Array.isArray(items) || items.length === 0) return [];

  const incompleteItems = [];
  const incompleteIndexes = [];
  items.forEach(function(item, index) {
    if (isItemComplete(item, schema)) return;
    incompleteItems.push(item);
    incompleteIndexes.push(index);
  });

  if (incompleteItems.length === 0) return items.slice();

  const hydratedIncompleteItems = hydrateKiotVietItems_(incompleteItems, schema);
  const hydratedItems = items.slice();
  incompleteIndexes.forEach(function(itemIndex, hydratedIndex) {
    hydratedItems[itemIndex] = hydratedIncompleteItems[hydratedIndex];
  });
  return hydratedItems;
}

/**
 * Suy doan cau truc payload webhook (chua co mau that trong repo de doi
 * chieu, khac voi Hoa don). Chi bat qua Script Property
 * KIOTVIET_HYDRATE_SKIP_ENTITIES sau khi da soi log that xac nhan dung.
 */
function isCompleteProductWebhookItem_(item, schema) {
  const code = kiotVietText_(item, schema.codeKeys).trim();
  if (!code) return false;
  const inventories = item && (
    Array.isArray(item.Inventories) ? item.Inventories :
    (Array.isArray(item.inventories) ? item.inventories : null)
  );
  return inventories !== null;
}

function isCompleteOrderWebhookItem_(item, schema) {
  const code = kiotVietText_(item, schema.codeKeys).trim();
  if (!code) return false;
  const details = item && (
    Array.isArray(item.OrderDetails) ? item.OrderDetails :
    (Array.isArray(item.orderDetails) ? item.orderDetails : null)
  );
  return details !== null;
}

function isCompleteCustomerWebhookItem_(item, schema) {
  const code = kiotVietText_(item, schema.codeKeys).trim();
  if (!code) return false;
  const name = pickKiotVietValue_(item, ['Name', 'name']);
  if (!name.found || !String(name.value || '').trim()) return false;
  const group = pickKiotVietValue_(item, ['GroupId', 'groupId', 'GroupName', 'groupName']);
  return group.found;
}

function isCompleteCategoryWebhookItem_(item, schema) {
  const code = kiotVietText_(item, schema.codeKeys).trim();
  if (!code) return false;
  const name = pickKiotVietValue_(item, ['Name', 'name']);
  return name.found && Boolean(String(name.value || '').trim());
}

function updateOrdersFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.orders;
  const hydratedItems = isKiotVietHydrateSkipEnabled_('orders')
    ? hydrateIncompleteWebhookItems_(items, schema, isCompleteOrderWebhookItem_)
    : hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
}

function updateCustomersFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.customers;
  const hydratedItems = isKiotVietHydrateSkipEnabled_('customers')
    ? hydrateIncompleteWebhookItems_(items, schema, isCompleteCustomerWebhookItem_)
    : hydrateKiotVietItems_(items, schema);
  upsertKiotVietSheetItems_(schema, hydratedItems);
}

function updateCategoriesFromWebhook(items) {
  const schema = KIOTVIET_SHEET_SCHEMAS.categories;
  const hydratedItems = isKiotVietHydrateSkipEnabled_('categories')
    ? hydrateIncompleteWebhookItems_(items, schema, isCompleteCategoryWebhookItem_)
    : hydrateKiotVietItems_(items, schema);
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
    // Token co the da nam san trong cache (khong tieu UrlFetch), nen phai
    // kiem tra cau dao ngay truoc lenh fetchAll thuc su, khong chi dua vao
    // ensureKiotVietQuotaAvailable_() da chay ben trong getKiotVietToken().
    ensureKiotVietQuotaAvailable_();
    recordKiotVietQuotaUsage_(requests.length);
    responses = UrlFetchApp.fetchAll(requests);
  } catch (error) {
    if (isKiotVietQuotaExceededError_(error)) {
      tripKiotVietQuotaBreaker_('hydrateKiotVietItems_: ' + schema.sheetName);
    }
    // Neu khong goi duoc API thi khong ghi du lieu thieu: nem loi de webhook
    // duoc thu lai (item van PENDING) thay vi luu hoa don/chi tiet thieu cot.
    throw new Error('Loi lay chi tiet ' + schema.sheetName + ': ' + error.toString());
  }

  const hydratedItems = items.slice();
  let hydrationFailed = false;
  responses.forEach((response, responseIndex) => {
    const itemIndex = requestItemIndexes[responseIndex];
    const responseCode = response.getResponseCode();
    if (responseCode < 200 || responseCode >= 300) {
      Logger.log(
        'Khong lay duoc chi tiet ' + schema.sheetName + ', HTTP ' + responseCode +
        ': ' + response.getContentText()
      );
      hydrationFailed = true;
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
      hydrationFailed = true;
    }
  });

  if (hydrationFailed) {
    // Mot phan chi tiet khong lay duoc: khong ghi ban ghi thieu cot, de
    // finalizeWebhookQueueItem_ dua item ve PENDING va thu lai o lan sau.
    throw new Error(
      'Khong lay du chi tiet ' + schema.sheetName + ' cho tat ca item, se thu lai.'
    );
  }

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
