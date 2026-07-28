// ==========================================
// QUAN LY WEBHOOK KIOTVIET (Admin tools)
// ==========================================

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
  const myWebhookUrl = ScriptApp.getService().getUrl();

  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token ket noi.");
    return;
  }

  // Danh sach cac loai su kien can dang ky rieng le
  // Luu y: KiotViet Retail dung "product.update" / "stock.update" / "customer.update"...
  // Neu ban da tung dang ky voi "product.insert" ma khong thay tai lieu de cap toi type nay,
  // hay uu tien dung dung cac type duoc liet ke trong tai lieu chinh thuc:
  const eventTypes = [
    "product.update",
    "product.delete",
    "stock.update",
    "customer.update",
    "customer.delete"
    // Neu can theo doi hoa don/dat hang, kiem tra lai tai lieu Retail day du (muc 2.11)
    // vi ban Retail co the co them type rieng cho invoice/order khac voi ban FNB.
  ];

  const url = "https://public.kiotapi.com/webhooks";
  let successCount = 0;
  let failCount = 0;

  eventTypes.forEach(type => {
    const payload = {
      "Webhook": {
        "Type": type,
        "Url": myWebhookUrl,
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
  // DAN CHINH XAC URL /exec cua ban vao day, thay the toan bo dong duoi:
  const CORRECT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzw165iOiCDNy2_mSKzKb-iXVIH1yahsfRiEllwNcQ6DQmTkfgWtw49S_5dngEeFVzIMA/exec";

  const token = getKiotVietToken();
  if (!token) {
    Logger.log("Loi: Khong lay duoc token ket noi.");
    return;
  }

  const eventTypes = [
    "product.update",
    "product.delete",
    "stock.update",
    "customer.update",
    "customer.delete"
  ];

  const url = "https://public.kiotapi.com/webhooks";
  let successCount = 0;
  let failCount = 0;

  eventTypes.forEach(type => {
    const payload = {
      "Webhook": {
        "Type": type,
        "Url": CORRECT_WEBHOOK_URL,
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
