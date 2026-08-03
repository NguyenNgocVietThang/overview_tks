// ==========================================
// QUAN LY WEBHOOK KIOTVIET (Admin tools)
// ==========================================

const KIOTVIET_AUTO_SYNC_EVENT_TYPES = Object.freeze([
  "product.update",
  "product.delete",
  "stock.update",
  "customer.update",
  "customer.delete",
  "invoice.update",
  "order.update",
  "category.update",
  "category.delete"
]);
const KIOTVIET_AUTO_SYNC_DESCRIPTION_PREFIX = "Auto-sync Google Sheets - ";
const KIOTVIET_DEFAULT_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycby99mhJo_-EZPl4VBdtjxf2HI9A_x5MSgGX0yk2UjhkCV_o3DvfjJNf6HoZG5zAWw2clA/exec";

/**
 * Bat toan bo co che tu dong theo cach idempotent:
 * - Tao shared-secret neu chua co.
 * - Tao lai trigger hang doi 1 phut va polling 5 phut.
 * - Giu nguyen webhook cua he thong khac; chi thay webhook cu/trung cua dashboard.
 */
function setupKiotVietAutoSync() {
  migrateKiotVietSheetsIfNeeded_();

  const token = getKiotVietToken();
  if (!token) throw new Error("Khong lay duoc token KiotViet de bat tu dong dong bo.");

  ensureKiotVietWebhookSecret_();
  setupQueueProcessingTrigger();
  setupPollingTrigger();
  setupCustomerDebtReportDailyTrigger();

  const result = reconcileKiotVietAutoSyncWebhooks_(token);
  Logger.log(
    "AUTO-SYNC READY: active=" + result.activeCount +
    ", created=" + result.createdCount +
    ", removedStale=" + result.removedCount +
    ", failed=" + result.failedCount
  );
  if (result.activeCount !== KIOTVIET_AUTO_SYNC_EVENT_TYPES.length || result.failedCount > 0) {
    throw new Error("Chua bat du 9 webhook KiotViet: " + JSON.stringify(result));
  }
  return result;
}

function ensureKiotVietWebhookSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty("WEBHOOK_SECRET");
  if (!secret) {
    secret = Utilities.getUuid().replace(/-/g, "");
    properties.setProperty("WEBHOOK_SECRET", secret);
    Logger.log("Da tao WEBHOOK_SECRET moi (gia tri duoc an khoi nhat ky).");
  }
  return secret;
}

function getKiotVietWebhookBaseUrl_() {
  const configured = PropertiesService.getScriptProperties().getProperty("WEBHOOK_URL");
  const url = String(configured || KIOTVIET_DEFAULT_WEBHOOK_URL).trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) {
    throw new Error("WEBHOOK_URL phai la URL Apps Script /exec hop le.");
  }
  return url;
}

function appendWebhookEventType_(url, eventType) {
  const separator = url.indexOf("?") === -1 ? "?" : "&";
  return url + separator + "eventType=" + encodeURIComponent(eventType);
}

function buildKiotVietAutoSyncWebhookUrl_(eventType) {
  return appendWebhookEventType_(
    appendWebhookSecret_(getKiotVietWebhookBaseUrl_()),
    eventType
  );
}

function reconcileKiotVietAutoSyncWebhooks_(token) {
  const listResult = fetchKiotVietJsonWithRetry_(
    "https://public.kiotapi.com/webhooks?pageSize=100",
    token,
    "webhooks"
  );
  const existing = Array.isArray(listResult.data) ? listResult.data : [];
  const desiredTypes = {};
  KIOTVIET_AUTO_SYNC_EVENT_TYPES.forEach(type => { desiredTypes[type] = true; });
  const baseUrl = getKiotVietWebhookBaseUrl_();
  const activeTypes = {};
  let createdCount = 0;
  let removedCount = 0;
  let failedCount = 0;

  existing.forEach(webhook => {
    const type = String(webhook.type || webhook.Type || "").toLowerCase();
    const url = String(webhook.url || webhook.Url || "");
    const description = String(webhook.description || webhook.Description || "");
    const isActive = webhook.isActive === true || webhook.IsActive === true;
    const expectedUrl = desiredTypes[type] ? buildKiotVietAutoSyncWebhookUrl_(type) : "";
    const isManaged = description.indexOf(KIOTVIET_AUTO_SYNC_DESCRIPTION_PREFIX) === 0 ||
      (desiredTypes[type] && url.indexOf(baseUrl) === 0);
    const isExactActive = desiredTypes[type] && url === expectedUrl && isActive;

    if (isExactActive && !activeTypes[type]) {
      activeTypes[type] = true;
      return;
    }
    if (!isManaged) return;

    const webhookId = webhook.id || webhook.Id;
    if (!webhookId) {
      failedCount++;
      Logger.log("Khong xoa duoc webhook cu vi thieu id: " + JSON.stringify(webhook));
      return;
    }
    const deleteResponse = UrlFetchApp.fetch(
      "https://public.kiotapi.com/webhooks/" + encodeURIComponent(webhookId),
      {
        method: "delete",
        headers: {
          Authorization: "Bearer " + token,
          Retailer: CONFIG.RETAILER
        },
        muteHttpExceptions: true
      }
    );
    const deleteCode = deleteResponse.getResponseCode();
    if (deleteCode >= 200 && deleteCode < 300) removedCount++;
    else {
      failedCount++;
      Logger.log("Xoa webhook cu that bai, HTTP " + deleteCode + ": " + deleteResponse.getContentText());
    }
  });

  KIOTVIET_AUTO_SYNC_EVENT_TYPES.forEach(type => {
    if (activeTypes[type]) return;
    const response = UrlFetchApp.fetch("https://public.kiotapi.com/webhooks", {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: "Bearer " + token,
        Retailer: CONFIG.RETAILER
      },
      payload: JSON.stringify({
        Webhook: {
          Type: type,
          Url: buildKiotVietAutoSyncWebhookUrl_(type),
          IsActive: true,
          Description: KIOTVIET_AUTO_SYNC_DESCRIPTION_PREFIX + type
        }
      }),
      muteHttpExceptions: true
    });
    const responseCode = response.getResponseCode();
    if (responseCode >= 200 && responseCode < 300) {
      activeTypes[type] = true;
      createdCount++;
    } else {
      failedCount++;
      Logger.log(
        "Dang ky webhook " + type + " that bai, HTTP " + responseCode +
        ": " + response.getContentText()
      );
    }
  });

  return {
    activeCount: Object.keys(activeTypes).length,
    createdCount: createdCount,
    removedCount: removedCount,
    failedCount: failedCount
  };
}

/**
 * Gan shared-secret (thiet lap bang setupWebhookSecret() trong WebhookQueue.gs)
 * vao cuoi URL webhook duoi dang query string "?secret=...". doPost() se doi chieu
 * lai gia tri nay - xem isValidWebhookSecret_() trong WebhookQueue.gs.
 * Neu chua thiet lap secret (chay setupWebhookSecret() lan dau), tra ve URL goc
 * khong doi va ghi log canh bao, vi doPost se tu choi moi request khi chua co secret.
 *
 * @param {string} url - URL webhook goc (chua co query string secret)
 * @returns {string} URL da gan them ?secret=...
 */
function appendWebhookSecret_(url) {
  const secret = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
  if (!secret) {
    Logger.log("CANH BAO: Chua thiet lap WEBHOOK_SECRET. Chay setupWebhookSecret() (trong WebhookQueue.gs) truoc khi dang ky webhook, neu khong doPost se tu choi moi request.");
    return url;
  }
  const separator = url.indexOf("?") === -1 ? "?" : "&";
  return url + separator + "secret=" + encodeURIComponent(secret);
}

/**
 * HAM TU DONG DANG KY WEBHOOK TREN KIOTVIET BANG CODE
 *
 * SUA LOI QUAN TRONG (schema sai):
 * Code cu gui { "url", "isActive", "actions": [...nhieu action...] } o cap ngoai cung.
 * Theo tai lieu chinh thuc KiotViet (muc "Dang ky Webhook"), API nay yeu cau:
 *   - Body phai boc trong object "Webhook" (viet hoa chu W)
 *   - Field ten la Type/Url/IsActive/Description (viet hoa chu cai dau)
 *   - Type la MOT STRING DUY NHAT cho moi lan dang ky (vi du "product.update"),
 *     KHONG PHAI mot mang actions gom nhieu loai cung luc.
 * => Vi vay phai goi API nay NHIEU LAN, moi lan dang ky 1 Type rieng.
 */
function registerWebhookProgrammatically() {
  const myWebhookUrl = appendWebhookSecret_(ScriptApp.getService().getUrl());

  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token ket noi.");
    return;
  }

  // Danh sach day du 9 loai su kien can dang ky rieng le:
  const eventTypes = KIOTVIET_AUTO_SYNC_EVENT_TYPES;

  const url = "https://public.kiotapi.com/webhooks";
  let successCount = 0;
  let failCount = 0;

  eventTypes.forEach(type => {
    const payload = {
      "Webhook": {
        "Type": type,
        "Url": appendWebhookEventType_(myWebhookUrl, type),
        "IsActive": true,
        "Description": "Auto-sync Google Sheets - " + type
      }
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": {
        "Authorization": "Bearer " + token,
        "Retailer": CONFIG.RETAILER
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const body = response.getContentText();

      Logger.log("---- Dang ky Type: " + type + " ----");
      Logger.log("Response Code: " + code);
      Logger.log("Phan hoi tu KiotViet: " + body);

      if (code === 200 || code === 201) {
        Logger.log("THANH CONG cho type: " + type);
        successCount++;
      } else {
        Logger.log("THAT BAI cho type: " + type + " - Ma loi: " + code);
        failCount++;
      }
    } catch (e) {
      Logger.log("Loi he thong khi dang ky type " + type + ": " + e.toString());
      failCount++;
    }
  });

  Logger.log("===== TONG KET =====");
  Logger.log("Thanh cong: " + successCount + " / That bai: " + failCount);
  Logger.log("Chay checkWebhookStatus() de xac nhan lai danh sach webhook hien co.");
}

/**
 * BUOC B: Dang ky lai webhook voi URL /exec CHINH XAC (khong dung
 * ScriptApp.getService().getUrl() nua vi ham do co the tra ve /dev
 * neu duoc goi trong luc dang o che do preview/editor thay vi tu
 * ban Deploy chinh thuc). Thay vao do, dan CUNG TAY URL /exec that
 * ma ban vua lay tu Manage deployments.
 */
function registerWebhookWithCorrectUrl() {
  // URL /exec cua deployment Web App cong khai dang hoat dong.
  const CORRECT_WEBHOOK_URL = appendWebhookSecret_(KIOTVIET_DEFAULT_WEBHOOK_URL);

  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token ket noi.");
    return;
  }

  const eventTypes = KIOTVIET_AUTO_SYNC_EVENT_TYPES;

  const url = "https://public.kiotapi.com/webhooks";
  let successCount = 0;
  let failCount = 0;

  eventTypes.forEach(type => {
    const payload = {
      "Webhook": {
        "Type": type,
        "Url": appendWebhookEventType_(CORRECT_WEBHOOK_URL, type),
        "IsActive": true,
        "Description": "Auto-sync Google Sheets - " + type
      }
    };

    const options = {
      "method": "post",
      "contentType": "application/json",
      "headers": {
        "Authorization": "Bearer " + token,
        "Retailer": CONFIG.RETAILER
      },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      const code = response.getResponseCode();
      const body = response.getContentText();

      Logger.log("---- Dang ky Type: " + type + " ----");
      Logger.log("Response Code: " + code);
      Logger.log("Phan hoi tu KiotViet: " + body);

      if (code === 200 || code === 201) {
        Logger.log("THANH CONG cho type: " + type);
        successCount++;
      } else {
        Logger.log("THAT BAI cho type: " + type + " - Ma loi: " + code);
        failCount++;
      }
    } catch (e) {
      Logger.log("Loi he thong khi dang ky type " + type + ": " + e.toString());
      failCount++;
    }
  });

  Logger.log("===== TONG KET =====");
  Logger.log("Thanh cong: " + successCount + " / That bai: " + failCount);
  Logger.log("URL da dang ky: " + CORRECT_WEBHOOK_URL);
  Logger.log("Chay checkWebhookStatus() de xac nhan lai, kiem tra ky truong url co dung la /exec khong.");
}

/**
 * HAM KIEM TRA DANH SACH WEBHOOK DA DANG KY (moi them, giup debug)
 * Chay ham nay de xem webhook cua ban co dang "isActive": true hay khong,
 * va URL co dung voi URL Web App hien tai khong.
 */
function listRegisteredWebhooks() {
  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token.");
    return;
  }
  const url = "https://public.kiotapi.com/webhooks";
  const options = {
    "method": "get",
    "headers": {
      "Authorization": "Bearer " + token,
      "Retailer": CONFIG.RETAILER
    },
    "muteHttpExceptions": true
  };
  const response = UrlFetchApp.fetch(url, options);
  Logger.log(response.getContentText());
}

/**
 * Kiem tra trang thai va chi tiet cac webhook da dang ky.
 */
function checkWebhookStatus() {
  const token = getKiotVietToken();
  if (!token) {
    Logger.log("❌ Khong lay duoc token");
    return;
  }

  const url = "https://public.kiotapi.com/webhooks";
  const options = {
    "method": "get",
    "headers": {
      "Authorization": "Bearer " + token,
      "Retailer": CONFIG.RETAILER
    },
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(url, options);
  const result = JSON.parse(response.getContentText());

  Logger.log("===== WEBHOOK STATUS =====");
  Logger.log("Total webhooks: " + result.total);
  Logger.log("Chi tiet: " + JSON.stringify(result, null, 2));

  if (result.total === 0) {
    Logger.log("⚠️ KHONG CO WEBHOOK NAO DUOC DANG KY!");
    Logger.log("Hay chay ham: registerWebhookProgrammatically()");
  } else {
    result.data.forEach((webhook, index) => {
      Logger.log(`\n[Webhook ${index + 1}]`);
      Logger.log("- URL: " + webhook.url);
      Logger.log("- isActive: " + webhook.isActive);
      Logger.log("- Actions: " + JSON.stringify(webhook.actions));
    });
  }
}

/**
 * BUOC A: Huy toan bo webhook cu (dang tro sai ve URL /dev).
 * Chi can chay 1 lan.
 */
function deleteAllOldWebhooks() {
  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token.");
    return;
  }

  // Lay danh sach webhook hien co
  const listUrl = "https://public.kiotapi.com/webhooks";
  const listOptions = {
    "method": "get",
    "headers": {
      "Authorization": "Bearer " + token,
      "Retailer": CONFIG.RETAILER
    },
    "muteHttpExceptions": true
  };
  const listResponse = UrlFetchApp.fetch(listUrl, listOptions);
  const listResult = JSON.parse(listResponse.getContentText());

  if (!listResult.data || listResult.data.length === 0) {
    Logger.log("Khong co webhook nao de xoa.");
    return;
  }

  Logger.log("Tim thay " + listResult.data.length + " webhook. Bat dau xoa...");

  listResult.data.forEach(webhook => {
    const deleteUrl = "https://public.kiotapi.com/webhooks/" + webhook.id;
    const deleteOptions = {
      "method": "delete",
      "headers": {
        "Authorization": "Bearer " + token,
        "Retailer": CONFIG.RETAILER
      },
      "muteHttpExceptions": true
    };
    const deleteResponse = UrlFetchApp.fetch(deleteUrl, deleteOptions);
    const code = deleteResponse.getResponseCode();
    Logger.log("Xoa webhook id=" + webhook.id + " (type=" + webhook.type + ", url=" + webhook.url + ") -> Ma phan hoi: " + code);
  });

  Logger.log("Hoan tat xoa webhook cu. Chay checkWebhookStatus() de xac nhan Total webhooks = 0.");
}
