// ==========================================
// WEBHOOK QUEUE — Hang doi ben vung tren Google Sheets
// ==========================================

const WEBHOOK_QUEUE_SHEET = '_KV_WEBHOOK_QUEUE';
const WEBHOOK_QUEUE_HEADERS = Object.freeze([
  'ID', 'Thoi diem nhan', 'Loai su kien', 'Payload',
  'Trang thai', 'So lan thu', 'Thoi diem nhan xu ly', 'Loi gan nhat'
]);
const WEBHOOK_QUEUE_BATCH_SIZE = 50;
const WEBHOOK_QUEUE_LEASE_MS = 10 * 60 * 1000;
const WEBHOOK_QUEUE_MAX_ATTEMPTS = 10;

/**
 * Nhan webhook va ghi ben vung vao mot tab an truoc khi tra QUEUED.
 * Neu khong ghi duoc, tra ERROR de khong xac nhan nham rang da nhan du lieu.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('No data')
        .setMimeType(ContentService.MimeType.TEXT);
    }
    if (!isValidWebhookSecret_(e)) {
      Logger.log("Webhook bi tu choi: thieu hoac sai shared-secret.");
      return ContentService.createTextOutput('UNAUTHORIZED')
        .setMimeType(ContentService.MimeType.TEXT);
    }

    const eventType = String(
      (e.parameter && (e.parameter.eventType || e.parameter.type)) || ''
    ).toLowerCase();
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(4000)) {
      throw new Error('Hang doi dang ban; chua ghi payload.');
    }

    try {
      const sheet = ensureWebhookQueueSheet_();
      const id = Utilities.getUuid();
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, WEBHOOK_QUEUE_HEADERS.length)
        .setValues([[
          id, new Date(), eventType, e.postData.contents,
          'PENDING', 0, '', ''
        ]]);
      SpreadsheetApp.flush();
    } finally {
      lock.releaseLock();
    }

    return ContentService.createTextOutput('QUEUED')
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    Logger.log('Loi khi ghi webhook vao hang doi: ' + error.toString());
    return ContentService.createTextOutput('ERROR: webhook was not queued')
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function ensureWebhookQueueSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(WEBHOOK_QUEUE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(WEBHOOK_QUEUE_SHEET);
    sheet.getRange(1, 1, 1, WEBHOOK_QUEUE_HEADERS.length)
      .setValues([WEBHOOK_QUEUE_HEADERS])
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground('#1F4E78')
      .setFontFamily('Open Sans');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function normalizeKiotVietWebhookNotifications_(payload, eventType) {
  const normalizedType = String(eventType || '').toLowerCase();
  if (!payload || typeof payload !== 'object') return [];

  const sourceNotifications = Array.isArray(payload.Notifications)
    ? payload.Notifications
    : (Array.isArray(payload.notifications) ? payload.notifications : null);
  if (sourceNotifications) {
    return sourceNotifications.map(notification => {
      const copy = Object.assign({}, notification || {});
      if (!copy.Action && !copy.action && normalizedType) copy.Action = normalizedType;
      return copy;
    });
  }
  if (payload.Action || payload.action) return [payload];

  const removedIds = payload.RemoveId || payload.removeId ||
    payload.RemovedId || payload.removedId;
  if (normalizedType.indexOf('.delete') !== -1 && Array.isArray(removedIds)) {
    return [{
      Action: normalizedType,
      Data: removedIds.map(id => id && typeof id === 'object' ? id : { Id: id, id: id })
    }];
  }
  if (normalizedType && (payload.Data !== undefined || payload.data !== undefined)) {
    return [{
      Action: normalizedType,
      Data: payload.Data !== undefined ? payload.Data : payload.data
    }];
  }
  return [];
}

/**
 * Lay mot lo payload va danh dau PROCESSING. Payload bi treo qua 10 phut se
 * tu dong duoc thu lai. Du lieu chi bi xoa khoi hang doi sau khi xu ly thanh cong.
 */
function claimWebhookQueueBatch_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return [];
  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return [];
    const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, WEBHOOK_QUEUE_HEADERS.length)
      .getValues();
    const now = new Date();
    const claimed = [];

    values.forEach((row, index) => {
      if (claimed.length >= WEBHOOK_QUEUE_BATCH_SIZE) return;
      const status = String(row[4] || 'PENDING');
      const leaseTime = row[6] instanceof Date ? row[6].getTime() : new Date(row[6] || 0).getTime();
      const leaseExpired = status === 'PROCESSING' &&
        (!isFinite(leaseTime) || now.getTime() - leaseTime >= WEBHOOK_QUEUE_LEASE_MS);
      if (status !== 'PENDING' && !leaseExpired) return;

      row[4] = 'PROCESSING';
      row[5] = Number(row[5] || 0) + 1;
      row[6] = now;
      row[7] = '';
      claimed.push({
        id: String(row[0]),
        eventType: String(row[2] || '').toLowerCase(),
        payload: String(row[3] || '')
      });
    });

    if (claimed.length > 0) {
      sheet.getRange(2, 5, values.length, 4)
        .setValues(values.map(row => row.slice(4, 8)));
      SpreadsheetApp.flush();
    }
    return claimed;
  } finally {
    lock.releaseLock();
  }
}

function processWebhookQueueItem_(queueItem) {
  const payload = JSON.parse(queueItem.payload);
  const notifications = normalizeKiotVietWebhookNotifications_(payload, queueItem.eventType);
  if (notifications.length === 0) throw new Error('Payload khong co notification hop le.');

  notifications.forEach(notification => {
    const action = String(
      notification.Action || notification.action || queueItem.eventType || ''
    ).toLowerCase();
    const rawItems = notification.Data !== undefined
      ? notification.Data
      : notification.data;
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];
    if (items.length === 0 || items[0] === undefined || items[0] === null) return;

    if (isShipmentLifecycleMode_()) {
      processShipmentLifecycleWebhookItems_(action, items);
      return;
    }

    const isDelete = action.indexOf('.delete') !== -1;
    if (action.indexOf('product') !== -1) {
      if (isDelete) deleteProductsFromWebhook(items); else updateProductsFromWebhook(items);
    } else if (action.indexOf('stock') !== -1) {
      updateProductsFromWebhook(items);
    } else if (action.indexOf('invoice') !== -1) {
      if (isDelete) {
        deleteInvoicesFromWebhook(items);
      } else {
        updateInvoicesFromWebhook(items);
      }
      if (isCombinedKiotVietMode_()) {
        processShipmentLifecycleWebhookItems_(action, items);
      } else if (!isDelete) {
        forwardInvoiceWebhookToShipment_(action, items);
      }
    } else if (action.indexOf('order') !== -1) {
      if (isDelete) deleteOrdersFromWebhook(items); else updateOrdersFromWebhook(items);
    } else if (action.indexOf('customer') !== -1) {
      if (isDelete) deleteCustomersFromWebhook(items); else updateCustomersFromWebhook(items);
    } else if (action.indexOf('category') !== -1) {
      if (isDelete) deleteCategoriesFromWebhook(items); else updateCategoriesFromWebhook(items);
    } else {
      throw new Error('Loai su kien chua duoc ho tro: ' + action);
    }
  });
}

/**
 * KiotViet chi cho mot webhook cho moi Type. Project tong hop cu giu
 * invoice.update va chuyen tiep payload sang project van chuyen sau khi da
 * cap nhat thanh cong. Neu project dich tam loi, queue cu se retry idempotent.
 */
function forwardInvoiceWebhookToShipment_(action, items) {
  const properties = PropertiesService.getScriptProperties();
  const baseUrl = String(properties.getProperty('SHIPMENT_WEBHOOK_URL') || '').trim();
  const secret = String(properties.getProperty('SHIPMENT_WEBHOOK_SECRET') || '').trim();
  if (!baseUrl) return;
  if (!secret) throw new Error('Thieu SHIPMENT_WEBHOOK_SECRET de chuyen tiep invoice.update.');
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(baseUrl)) {
    throw new Error('SHIPMENT_WEBHOOK_URL khong hop le.');
  }

  const targetUrl = appendWebhookEventType_(
    baseUrl + '?secret=' + encodeURIComponent(secret),
    action || 'invoice.update'
  );
  const response = UrlFetchApp.fetch(targetUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      Notifications: [{ Action: action || 'invoice.update', Data: items }]
    }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const responseText = String(response.getContentText() || '').trim();
  if (code < 200 || code >= 300 || responseText !== 'QUEUED') {
    throw new Error(
      'Chuyen tiep invoice.update sang sheet van chuyen that bai, HTTP ' +
      code + ': ' + responseText
    );
  }
}

function finalizeWebhookQueueItem_(id, error) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return;
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    for (let index = 0; index < ids.length; index++) {
      if (String(ids[index][0]) !== id) continue;
      const rowNumber = index + 2;
      if (!error) {
        sheet.deleteRow(rowNumber);
      } else {
        const attempts = Number(sheet.getRange(rowNumber, 6).getValue() || 0);
        const nextStatus = attempts >= WEBHOOK_QUEUE_MAX_ATTEMPTS ? 'ERROR' : 'PENDING';
        sheet.getRange(rowNumber, 5, 1, 4)
          .setValues([[nextStatus, attempts, '', String(error).slice(0, 500)]]);
      }
      return;
    }
  } finally {
    lock.releaseLock();
  }
}

function processWebhookQueue() {
  if (!isShipmentLifecycleMode_()) {
    const maintenanceLock = getKiotVietDataLock_();
    if (maintenanceLock.tryLock(5000)) {
      try {
        try {
          migrateKiotVietSheetsIfNeeded_();
        } catch (migrationError) {
          Logger.log('Loi cap nhat schema, se thu lai: ' + migrationError.toString());
        }
        syncCustomerReportIfDue_();

        // Sau 15:00, chay bu bao cao cong no neu trigger ngay bi tre hoac loi.
        syncCustomerDebtReportsIfDue_();
      } finally {
        maintenanceLock.releaseLock();
      }
    }
  }

  const batch = claimWebhookQueueBatch_();
  if (batch.length === 0) return;
  batch.forEach(queueItem => {
    let itemError = null;
    const dataLock = getKiotVietDataLock_();
    try {
      dataLock.waitLock(30000);
      processWebhookQueueItem_(queueItem);
    } catch (error) {
      itemError = error;
      Logger.log('Webhook ' + queueItem.id + ' loi, se thu lai: ' + error.toString());
    } finally {
      if (dataLock.hasLock()) dataLock.releaseLock();
    }
    finalizeWebhookQueueItem_(queueItem.id, itemError);
  });
}

function getWebhookQueueStatus() {
  const sheet = ensureWebhookQueueSheet_();
  const statuses = sheet.getLastRow() > 1
    ? sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).getValues()
    : [];
  const summary = statuses.reduce((result, row) => {
    const status = String(row[0] || 'PENDING');
    result[status] = (result[status] || 0) + 1;
    return result;
  }, { PENDING: 0, PROCESSING: 0, ERROR: 0 });
  summary.total = statuses.length;
  summary.sheet = WEBHOOK_QUEUE_SHEET;
  Logger.log('Trang thai webhook queue: ' + JSON.stringify(summary));
  return summary;
}

/** Sau khi sua nguyen nhan loi, chay ham nay de dua cac dong ERROR ve PENDING. */
function retryWebhookQueueErrors() {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return 0;
    const range = sheet.getRange(2, 5, sheet.getLastRow() - 1, 4);
    const values = range.getValues();
    let count = 0;
    values.forEach(row => {
      if (String(row[0]) !== 'ERROR') return;
      row[0] = 'PENDING';
      row[1] = 0;
      row[2] = '';
      count++;
    });
    range.setValues(values);
    Logger.log('Da dua ' + count + ' webhook loi ve hang cho.');
    return count;
  } finally {
    lock.releaseLock();
  }
}

function isValidWebhookSecret_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  if (!expected) return false;
  const received = e.parameter && e.parameter.secret;
  return typeof received === 'string' && received === expected;
}

function setupWebhookSecret() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('WEBHOOK_SECRET')) {
    Logger.log('Da co WEBHOOK_SECRET, khong tao lai.');
    return;
  }
  props.setProperty('WEBHOOK_SECRET', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('Da tao WEBHOOK_SECRET moi.');
}

function setupQueueProcessingTrigger() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processWebhookQueue') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('processWebhookQueue').timeBased().everyMinutes(1).create();
  Logger.log('Da bat trigger xu ly webhook moi 1 phut.');
}
