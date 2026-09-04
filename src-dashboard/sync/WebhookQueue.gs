// ==========================================
// WEBHOOK QUEUE — Hang doi ben vung tren Google Sheets
// ==========================================

const WEBHOOK_QUEUE_SHEET = '_KV_WEBHOOK_QUEUE';
const WEBHOOK_QUEUE_HEADERS = Object.freeze([
  'ID', 'Thoi diem nhan', 'Loai su kien', 'Payload',
  'Trang thai', 'So lan thu', 'Thoi diem nhan xu ly', 'Loi gan nhat'
]);
// Moi item co the hydrate API va ghi lai mot sheet lon. Batch 50 de vuot qua
// gioi han 6 phut truoc khi finalize, lam ca batch bi claim lai vo han.
const WEBHOOK_QUEUE_BATCH_SIZE = 100;
const WEBHOOK_QUEUE_INVOICE_BATCH_SIZE = 50;
const WEBHOOK_QUEUE_LEASE_MS = 10 * 60 * 1000;
const WEBHOOK_QUEUE_MAX_ATTEMPTS = 10;

/**
 * Nhan webhook va ghi ben vung vao mot tab an truoc khi tra QUEUED.
 * Neu khong ghi duoc, tra ERROR de khong xac nhan nham rang da nhan du lieu.
 *
 * Dung appendRow() thay vi getLastRow()+setValues() duoi ScriptLock: khi
 * KiotViet gui burst lon (nhieu chi nhanh ban hang cung luc), moi doPost()
 * truoc day phai xep hang cho ScriptLock (chi doi toi da 4s) trong khi lan
 * ghi + flush truoc no chiem 3-5s — burst dong thoi se lam nhieu webhook bi
 * roi vao nhanh timeout va MAT HAN, khong bao gio vao hang doi. Sheets API
 * append rows an toan cho nhieu doPost() chay song song ma khong can khoa,
 * nen bo ScriptLock o day de cac le nen chay that su song song.
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

    const sheet = ensureWebhookQueueSheet_();
    const id = Utilities.getUuid();
    sheet.appendRow([
      id, new Date(), eventType, e.postData.contents,
      'PENDING', 0, '', ''
    ]);

    return ContentService.createTextOutput('QUEUED')
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (error) {
    Logger.log('Loi khi ghi webhook vao hang doi: ' + error.toString());
    return ContentService.createTextOutput('ERROR: webhook was not queued')
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Duong dan thuong (sheet da ton tai) khong dung ScriptLock, de khong tro
 * lai nut co chai cho doPost() dang chay song song. Lan dau tien (sheet
 * chua ton tai) nhieu doPost() co the dua nhau tao sheet; nguoi thua cuoc
 * se nhan loi "trung ten" tu insertSheet() va chi can lay lai sheet vua
 * duoc nguoi thang tao.
 */
function ensureWebhookQueueSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(WEBHOOK_QUEUE_SHEET);
  if (sheet) return sheet;

  try {
    sheet = spreadsheet.insertSheet(WEBHOOK_QUEUE_SHEET);
    sheet.getRange(1, 1, 1, WEBHOOK_QUEUE_HEADERS.length)
      .setValues([WEBHOOK_QUEUE_HEADERS])
      .setFontWeight('bold')
      .setFontColor('#FFFFFF')
      .setBackground('#1F4E78')
      .setFontFamily('Open Sans');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
    return sheet;
  } catch (error) {
    sheet = spreadsheet.getSheetByName(WEBHOOK_QUEUE_SHEET);
    if (sheet) return sheet;
    throw error;
  }
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
    let queueStateChanged = false;
    const invoicePriorityMode = values.some(row => {
      const eventType = String(row[2] || '').toLowerCase();
      const status = String(row[4] || 'PENDING');
      return eventType.indexOf('invoice') !== -1 &&
        (status === 'PENDING' || status === 'PROCESSING');
    });
    const batchLimit = invoicePriorityMode
      ? WEBHOOK_QUEUE_INVOICE_BATCH_SIZE
      : WEBHOOK_QUEUE_BATCH_SIZE;

    const candidateIndexes = values.map((row, index) => index);
    candidateIndexes.sort((leftIndex, rightIndex) => {
      const leftType = String(values[leftIndex][2] || '').toLowerCase();
      const rightType = String(values[rightIndex][2] || '').toLowerCase();
      const leftPriority = leftType.indexOf('invoice') !== -1 ? 0 : 1;
      const rightPriority = rightType.indexOf('invoice') !== -1 ? 0 : 1;
      return leftPriority - rightPriority || leftIndex - rightIndex;
    });

    candidateIndexes.forEach(index => {
      if (claimed.length >= batchLimit) return;
      const row = values[index];
      const hasQueuePayload = String(row[0] || '').trim() &&
        String(row[2] || '').trim() && String(row[3] || '').trim();
      if (!hasQueuePayload) {
        // Google Sheets co the giu lai cac dong luoi trong ben duoi bang.
        // Khong coi cac dong rong la PENDING; dong thoi xoa lease/status rac
        // do phien ban cu da danh dau nham de getLastRow() co the co lai.
        if (row.slice(4, 8).some(value => value !== '' && value !== null)) {
          row[4] = '';
          row[5] = '';
          row[6] = '';
          row[7] = '';
          queueStateChanged = true;
        }
        return;
      }
      if (invoicePriorityMode && String(row[2] || '').toLowerCase().indexOf('invoice') === -1) return;
      const status = String(row[4] || 'PENDING');
      const leaseTime = row[6] instanceof Date ? row[6].getTime() : new Date(row[6] || 0).getTime();
      const leaseExpired = status === 'PROCESSING' &&
        (!isFinite(leaseTime) || now.getTime() - leaseTime >= WEBHOOK_QUEUE_LEASE_MS);
      if (status !== 'PENDING' && !leaseExpired) return;

      let attempts = Number(row[5] || 0);
      if (leaseExpired && attempts >= WEBHOOK_QUEUE_MAX_ATTEMPTS) {
        // Lease het han la loi ha tang/execution timeout, khong phai payload
        // hong. Cap lai budget de su kien khong bi bo roi vinh vien.
        attempts = 0;
      }

      row[4] = 'PROCESSING';
      row[5] = attempts + 1;
      row[6] = now;
      row[7] = '';
      queueStateChanged = true;
      claimed.push({
        id: String(row[0]),
        eventType: String(row[2] || '').toLowerCase(),
        payload: String(row[3] || '')
      });
    });

    if (queueStateChanged) {
      sheet.getRange(2, 5, values.length, 4)
        .setValues(values.map(row => row.slice(4, 8)));
      SpreadsheetApp.flush();
    }
    return claimed;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Phuc hoi cac lease PROCESSING bi ket sau timeout ma khong xoa payload.
 * Chay mot lan khi queue da bi un; trigger se xu ly lai theo batch nho.
 */
function recoverStuckWebhookQueue() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return 0;

    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, WEBHOOK_QUEUE_HEADERS.length);
    const values = range.getValues();
    let recoveredCount = 0;
    values.forEach(row => {
      if (String(row[4] || '') !== 'PROCESSING') return;
      row[4] = 'PENDING';
      row[5] = 0;
      row[6] = '';
      row[7] = '';
      recoveredCount++;
    });
    if (recoveredCount > 0) {
      range.setValues(values);
      SpreadsheetApp.flush();
    }
    Logger.log('Da phuc hoi ' + recoveredCount + ' webhook PROCESSING ve PENDING.');
    return recoveredCount;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sau khi giam batch 50 -> 10, dua cac dong ERROR do co che quarantine lease
 * cu ve PENDING. Khong cham vao lease PROCESSING con hoat dong; claim batch se
 * tu cap lai budget khi lease do thuc su het han.
 */
function recoverWebhookQueueAfterBatchResize_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 0;
  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return 0;

    const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, WEBHOOK_QUEUE_HEADERS.length);
    const values = range.getValues();
    let recoveredCount = 0;
    values.forEach(row => {
      const status = String(row[4] || '');
      const isBatchResizeQuarantine = status === 'ERROR' &&
        String(row[7] || '').indexOf('Lease xu ly het han qua ' + WEBHOOK_QUEUE_MAX_ATTEMPTS + ' lan') >= 0;
      if (!isBatchResizeQuarantine) return;
      row[4] = 'PENDING';
      row[5] = 0;
      row[6] = '';
      row[7] = '';
      recoveredCount++;
    });
    if (recoveredCount > 0) {
      range.setValues(values);
      SpreadsheetApp.flush();
    }
    Logger.log('Da tu dong phuc hoi ' + recoveredCount + ' quarantine lease legacy.');
    return recoveredCount;
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
      updateProductStocksFromWebhook(items);
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

function finalizeWebhookQueueItem_(id, error, skipAttemptPenalty) {
  return finalizeWebhookQueueBatch_([{
    id: id,
    error: error,
    skipAttemptPenalty: skipAttemptPenalty
  }]);
}

/**
 * Hoan tat ca lo webhook trong mot lan giu ScriptLock. Khi KiotViet gui burst
 * lon, doPost() cung can khoa nay de append queue; xin khoa tung item se de bi
 * starvation va lam ca trigger dung giua chung. Neu chua lay duoc khoa, giu
 * nguyen lease PROCESSING de item tu duoc retry sau khi lease het han.
 */
function finalizeWebhookQueueBatch_(results) {
  if (!results || results.length === 0) return true;

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log(
      'Hang doi dang ban; hoan tat batch ' + results.length +
      ' webhook se duoc retry sau khi lease het han.'
    );
    return false;
  }

  try {
    const sheet = ensureWebhookQueueSheet_();
    if (sheet.getLastRow() <= 1) return true;

    const resultById = results.reduce((map, result) => {
      map[String(result.id)] = result;
      return map;
    }, {});
    const values = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, WEBHOOK_QUEUE_HEADERS.length)
      .getValues();
    const successfulRows = [];

    values.forEach((row, index) => {
      const id = String(row[0]);
      const result = resultById[id];
      if (!result) return;

      const rowNumber = index + 2;
      if (!result.error) {
        successfulRows.push(rowNumber);
      } else {
        let attempts = Number(row[5] || 0);
        // Cho khoa du lieu qua han (vi dong bo nang dang chay) khong phai loi
        // xu ly that su: khong tinh vao so lan thu de item khong bi ERROR
        // vinh vien chi vi trung thoi diem voi mot lan backfill.
        if (result.skipAttemptPenalty && attempts > 0) attempts -= 1;
        const nextStatus = attempts >= WEBHOOK_QUEUE_MAX_ATTEMPTS ? 'ERROR' : 'PENDING';
        sheet.getRange(rowNumber, 5, 1, 4)
          .setValues([[nextStatus, attempts, '', String(result.error).slice(0, 500)]]);
      }
    });

    // Xoa tu duoi len de so dong cua cac item phia tren khong bi thay doi.
    for (let index = successfulRows.length - 1; index >= 0;) {
      const endRow = successfulRows[index];
      let startRow = endRow;
      index--;
      while (index >= 0 && successfulRows[index] === startRow - 1) {
        startRow = successfulRows[index];
        index--;
      }
      sheet.deleteRows(startRow, endRow - startRow + 1);
    }

    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Trigger xu ly (setupQueueProcessingTrigger, o duoi file nay) chay moi 1 phut.
// Truoc day hang so nay la 4 phut: vi Apps Script KHONG bo qua lan trigger ke
// tiep chi vi lan truoc chua chay xong, moi hang doi co viec deu de tao ra 3-4
// lan processWebhookQueue() chay CHONG LAN nhau lien tuc — tang manh tan suat
// va cham giua cac tien trinh dung dataLock/invoiceLock/ScriptLock khac nhau
// (vd job doi soat bao cao chay trong pha bao tri o duoi cung file nay).
// Giam xuong duoi 1 phut de gan nhu luon ket thuc truoc lan trigger ke tiep;
// mot lo qua cham (hydrate nhieu item) van co the vuot nhe, chap nhan duoc vi
// day tro thanh truong hop hiem thay vi la chuan.
const WEBHOOK_QUEUE_MAX_RUN_MS = 45 * 1000;

function webhookBatchItemKey_(item) {
  if (item === null || item === undefined) return String(item);
  if (typeof item !== 'object') return typeof item + ':' + String(item);
  const id = item.Id !== undefined ? item.Id
    : (item.id !== undefined ? item.id
      : (item.ProductId !== undefined ? item.ProductId
        : (item.productId !== undefined ? item.productId : '')));
  return id !== '' ? 'id:' + String(id) : 'json:' + JSON.stringify(item);
}

/** Gom cac delivery cung event/action thanh mot lan hydrate + ghi sheet. */
function coalesceWebhookQueueBatch_(batch) {
  const groups = {};
  const order = [];
  (batch || []).forEach(queueItem => {
    const eventType = String(queueItem.eventType || '').toLowerCase();
    let payload;
    let notifications;
    try {
      payload = JSON.parse(queueItem.payload);
      notifications = normalizeKiotVietWebhookNotifications_(payload, eventType);
    } catch (error) {
      const invalidKey = '__invalid__' + queueItem.id;
      groups[invalidKey] = { queueItems: [queueItem], syntheticItem: queueItem };
      order.push(invalidKey);
      return;
    }

    const key = eventType || '__unknown__';
    if (!groups[key]) {
      groups[key] = {
        queueItems: [],
        actions: {},
        actionOrder: []
      };
      order.push(key);
    }
    const group = groups[key];
    group.queueItems.push(queueItem);
    notifications.forEach(notification => {
      const action = String(notification.Action || notification.action || eventType).toLowerCase();
      if (!group.actions[action]) {
        group.actions[action] = { items: [], seen: {} };
        group.actionOrder.push(action);
      }
      const actionGroup = group.actions[action];
      const data = notification.Data !== undefined ? notification.Data : notification.data;
      const items = Array.isArray(data) ? data : (data === undefined || data === null ? [] : [data]);
      items.forEach(item => {
        const itemKey = webhookBatchItemKey_(item);
        if (actionGroup.seen[itemKey]) return;
        actionGroup.seen[itemKey] = true;
        actionGroup.items.push(item);
      });
    });
  });

  return order.map(key => {
    const group = groups[key];
    if (group.syntheticItem) return group;
    group.syntheticItem = {
      id: group.queueItems[0].id,
      eventType: String(group.queueItems[0].eventType || '').toLowerCase(),
      payload: JSON.stringify({
        Notifications: group.actionOrder.map(action => ({
          Action: action,
          Data: group.actions[action].items
        }))
      })
    };
    return group;
  });
}

/**
 * Xu ly lo da gom; neu mot item lam ca fetchAll() loi thi chia doi de co lap
 * item do ma van giu duoc loi ich hydrate/ghi theo lo cho cac item con lai.
 */
function processWebhookQueueGroupWithIsolation_(group) {
  try {
    processWebhookQueueItem_(group.syntheticItem);
    return group.queueItems.map(item => ({
      id: item.id, error: null, skipAttemptPenalty: false
    }));
  } catch (error) {
    if (group.queueItems.length <= 1) {
      Logger.log(
        'Webhook ' + group.queueItems[0].id + ' van loi khi tach khoi lo: ' +
        error.toString()
      );
      return [{
        id: group.queueItems[0].id, error: error, skipAttemptPenalty: false
      }];
    }

    const middle = Math.ceil(group.queueItems.length / 2);
    const halves = [
      group.queueItems.slice(0, middle),
      group.queueItems.slice(middle)
    ];
    return halves.reduce((results, queueItems) => {
      const subgroup = coalesceWebhookQueueBatch_(queueItems)[0];
      return results.concat(processWebhookQueueGroupWithIsolation_(subgroup));
    }, []);
  }
}

function processWebhookQueue() {
  recoverWebhookQueueAfterBatchResize_();
  if (!isShipmentLifecycleMode_()) {
    if (typeof ensureKiotVietRecoveryTriggers_ === 'function') {
      ensureKiotVietRecoveryTriggers_();
    }
    ensureMasterChainResumeTrigger_();
    ensurePollingOnlyResumeTrigger_();
    if (typeof ensureInvoicesBackfillResumeTrigger_ === 'function') {
      ensureInvoicesBackfillResumeTrigger_();
    }
    const masterBackfillActive = Boolean(
      PropertiesService.getScriptProperties().getProperty('MASTER_CHAIN_SYNC_STATE')
    );
    if (!masterBackfillActive) {
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
  }

  // Xu ly nhieu lo trong cung mot lan chay (thay vi cho trigger ke tiep) de
  // hang doi khong bi don u khi luong webhook cao (vd chi nhanh nhieu don).
  const startTime = Date.now();
  while (Date.now() - startTime < WEBHOOK_QUEUE_MAX_RUN_MS) {
    const batch = claimWebhookQueueBatch_();
    if (batch.length === 0) break;

    const finalizedResults = [];
    const groups = coalesceWebhookQueueBatch_(batch);
    groups.forEach(group => {
      const queueItem = group.syntheticItem;
      // Webhook Hoa don dung khoa rieng (getKiotVietInvoiceLock_) giong
      // resumeSyncInvoicesChunk, de khong bi cac chuoi dong bo nang khac
      // (polling-only, master chain o buoc khac Hoa don) chan mat nhieu phut.
      const isInvoiceEvent = queueItem.eventType.indexOf('invoice') !== -1;
      const dataLock = isInvoiceEvent ? getKiotVietInvoiceLock_() : getKiotVietDataLock_();
      try {
        dataLock.waitLock(30000);
      } catch (lockError) {
        Logger.log(
          'Webhook ' + queueItem.id + ' cho khoa du lieu qua han (dang co dong bo ' +
          'nang chay), se thu lai o lan sau: ' + lockError.toString()
        );
        group.queueItems.forEach(item => finalizedResults.push({
          id: item.id, error: lockError, skipAttemptPenalty: true
        }));
        return;
      }

      let isolatedResults;
      try {
        isolatedResults = processWebhookQueueGroupWithIsolation_(group);
      } finally {
        if (dataLock.hasLock()) dataLock.releaseLock();
      }
      Array.prototype.push.apply(finalizedResults, isolatedResults);
    });

    if (finalizeWebhookQueueBatch_(finalizedResults) === false) break;

    if (batch.length < WEBHOOK_QUEUE_BATCH_SIZE) break;
  }
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

/**
 * Tam dung trigger processWebhookQueue (vd: de chay tay mot dong bo nang
 * ma khong bi tranh khoa LockService moi phut). Webhook va vot bu bao cao
 * se khong duoc xu ly cho toi khi goi resumeWebhookQueueTrigger().
 */
function pauseWebhookQueueTrigger() {
  let removedCount = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'processWebhookQueue') {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });
  Logger.log('Da tam dung trigger xu ly webhook (' + removedCount + ' trigger da xoa).');
  return removedCount;
}

/**
 * Bat lai trigger processWebhookQueue sau khi tam dung bang
 * pauseWebhookQueueTrigger(). Tuong duong setupQueueProcessingTrigger().
 */
function resumeWebhookQueueTrigger() {
  setupQueueProcessingTrigger();
}
