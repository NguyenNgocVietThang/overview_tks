// ==========================================
// WEBHOOK QUEUE — Nhan & xu ly bat dong bo
// ==========================================

const QUEUE_CACHE_PREFIX = "kv_webhook_queue_";
const QUEUE_INDEX_KEY = "kv_webhook_queue_index";
const CACHE_EXPIRY_SECONDS = 21600; // 6 tieng - du de trigger xu ly kip, tranh mat du lieu neu trigger loi

/**
 * BUOC 1: Nhan webhook, luu vao hang doi, tra loi NGAY LAP TUC.
 * Ham nay THAY THE hoan toan ham doPost cu.
 * KiotViet goi truc tiep endpoint nay; can phan hoi trong <5 giay.
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return ContentService.createTextOutput("No data").setMimeType(ContentService.MimeType.TEXT);
    }

    if (!isValidWebhookSecret_(e)) {
      Logger.log("Webhook bi tu choi: thieu hoac sai shared-secret (query param 'secret').");
      return ContentService.createTextOutput("UNAUTHORIZED").setMimeType(ContentService.MimeType.TEXT);
    }

    const rawContents = e.postData.contents;
    const cache = CacheService.getScriptCache();

    // Tao key duy nhat cho lan nhan nay (timestamp + so ngau nhien de tranh trung neu 2 request den cung 1 mili-giay)
    const uniqueKey = QUEUE_CACHE_PREFIX + new Date().getTime() + "_" + Math.floor(Math.random() * 100000);

    // Luu payload tho vao cache - thao tac nay rat nhanh (<100ms), khong dung Sheet, khong can khoa
    cache.put(uniqueKey, rawContents, CACHE_EXPIRY_SECONDS);

    // Cap nhat danh sach cac key dang cho xu ly (de trigger biet can doc key nao)
    // Dung LockService O DAY chi de bao ve viec doc/ghi index (rat nhanh, khong lien quan Sheet)
    const indexLock = LockService.getScriptLock();
    try {
      indexLock.waitLock(2000); // chi cho toi da 2s, vi thao tac nay cuc nhanh
      let indexStr = cache.get(QUEUE_INDEX_KEY);
      let index = indexStr ? JSON.parse(indexStr) : [];
      index.push(uniqueKey);
      cache.put(QUEUE_INDEX_KEY, JSON.stringify(index), CACHE_EXPIRY_SECONDS);
    } finally {
      indexLock.releaseLock();
    }

    // Tra loi KiotViet NGAY - khong cho ghi Sheet
    return ContentService.createTextOutput("QUEUED").setMimeType(ContentService.MimeType.TEXT);

  } catch (err) {
    // Ngay ca khi loi, van co gang tra loi nhanh de KiotViet khong bi timeout
    Logger.log("Loi khi dua webhook vao hang doi: " + err.toString());
    return ContentService.createTextOutput("ERROR: " + err.toString()).setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * BUOC 2: Xu ly hang doi - doc tat ca payload dang cho, ghi vao Sheet TUAN TU.
 * Ham nay can duoc thiet lap chay theo TRIGGER THOI GIAN (xem setupQueueProcessingTrigger),
 * KHONG duoc KiotViet goi truc tiep, nen khong co ap luc timeout.
 */
function processWebhookQueue() {
  // Tan dung trigger 1 phut dang co san de cap nhat Bao cao khach hang mot lan
  // moi ngay sau 07:00. Ham nay tu bo qua neu hom nay da dong bo thanh cong.
  syncCustomerReportIfDue_();

  const cache = CacheService.getScriptCache();
  const lock = LockService.getScriptLock();

  try {
    lock.waitLock(30000); // co the cho lau vi day la tien trinh nen, khong ai dang doi phan hoi
  } catch (lockErr) {
    Logger.log("processWebhookQueue: Khong lay duoc lock, se thu lai o lan trigger sau: " + lockErr);
    return;
  }

  try {
    const indexStr = cache.get(QUEUE_INDEX_KEY);
    if (!indexStr) {
      Logger.log("Hang doi trong, khong co gi de xu ly.");
      return;
    }

    const index = JSON.parse(indexStr);
    if (index.length === 0) {
      Logger.log("Hang doi trong, khong co gi de xu ly.");
      return;
    }

    Logger.log("Bat dau xu ly " + index.length + " payload dang cho trong hang doi.");

    const processedKeys = [];

    index.forEach(key => {
      const rawContents = cache.get(key);
      if (!rawContents) {
        // Payload da het han cache hoac khong ton tai - bo qua, van danh dau la da xu ly de xoa khoi index
        processedKeys.push(key);
        return;
      }

      try {
        const payload = JSON.parse(rawContents);
        Logger.log("Xu ly payload tu key: " + key);

        // === Toan bo logic phan loai va ghi Sheet giu nguyen nhu code cu ===
        let notifications = [];
        if (Array.isArray(payload.Notifications)) {
          notifications = payload.Notifications;
        } else if (Array.isArray(payload.notifications)) {
          notifications = payload.notifications;
        } else if (payload.Action || payload.action) {
          notifications = [payload];
        }

        notifications.forEach(noti => {
          const action = (noti.Action || noti.action || "").toLowerCase();
          const rawItems = noti.Data || noti.data || [];
          const items = Array.isArray(rawItems) ? rawItems : [rawItems];

          if (!items || items.length === 0) return;

          const isDelete = action.indexOf(".delete") !== -1;
          if (action.includes("product")) {
            if (isDelete) deleteProductsFromWebhook(items);
            else updateProductsFromWebhook(items);
          }
          else if (action.includes("stock")) {
            updateProductsFromWebhook(items);
          }
          else if (action.includes("invoice")) {
            if (isDelete) deleteInvoicesFromWebhook(items);
            else updateInvoicesFromWebhook(items);
          }
          else if (action.includes("order")) {
            if (isDelete) deleteOrdersFromWebhook(items);
            else updateOrdersFromWebhook(items);
          }
          else if (action.includes("customer")) {
            if (isDelete) deleteCustomersFromWebhook(items);
            else updateCustomersFromWebhook(items);
          }
          else if (action.includes("category")) {
            if (isDelete) deleteCategoriesFromWebhook(items);
            else updateCategoriesFromWebhook(items);
          } else {
            Logger.log("Action khong xac dinh, bo qua: " + action);
          }
        });

        processedKeys.push(key);

      } catch (parseErr) {
        Logger.log("Loi parse/xu ly payload tu key " + key + ": " + parseErr.toString());
        // Van danh dau la da xu ly de tranh ket qua loi lap lai moi 1 phut
        processedKeys.push(key);
      }

      // Xoa payload khoi cache sau khi xu ly xong (thanh cong hay loi deu xoa, tranh xu ly lap)
      cache.remove(key);
    });

    // Cap nhat lai index - loai bo cac key da xu ly
    const remainingIndex = index.filter(k => processedKeys.indexOf(k) === -1);
    if (remainingIndex.length > 0) {
      cache.put(QUEUE_INDEX_KEY, JSON.stringify(remainingIndex), CACHE_EXPIRY_SECONDS);
    } else {
      cache.remove(QUEUE_INDEX_KEY);
    }

    Logger.log("Hoan tat xu ly hang doi. Da xu ly: " + processedKeys.length + " / Con lai: " + remainingIndex.length);

  } catch (err) {
    Logger.log("Loi trong qua trinh xu ly hang doi: " + err.toString());
  } finally {
    lock.releaseLock();
  }
}

/**
 * Kiem tra shared-secret dinh kem trong query string cua URL webhook.
 * KiotViet KHONG ho tro ky (HMAC) payload hay gui header tuy chinh khi goi webhook -
 * chi cho phep cau hinh Url/Type/IsActive/Description khi dang ky (xem WebhookAdmin.gs).
 * Vi vay bien phap xac thuc kha thi la nhung mot secret vao chinh URL webhook
 * (vi du: .../exec?secret=xxxx) va so sanh lai o day moi khi nhan request.
 *
 * @param {Object} e - Doi tuong request cua doPost
 * @returns {boolean} true neu secret hop le
 */
function isValidWebhookSecret_(e) {
  const expected = PropertiesService.getScriptProperties().getProperty("WEBHOOK_SECRET");
  if (!expected) return false; // Chua thiet lap secret (chay setupWebhookSecret()) => tu choi tat ca de an toan
  const received = e.parameter && e.parameter.secret;
  return typeof received === "string" && received === expected;
}

/**
 * HAM THIET LAP SHARED-SECRET CHO WEBHOOK - CHI CAN CHAY 1 LAN DUY NHAT BANG TAY.
 *
 * Sau khi chay, secret duoc luu trong Script Properties (khong nam trong source code)
 * va duoc log ra. Copy secret nay va dan vao cuoi URL webhook dang duoc dang ky voi
 * KiotViet, dang query string: .../exec?secret=<secret-vua-tao>
 * (Xem registerWebhookWithCorrectUrl() / registerWebhookProgrammatically() trong
 * WebhookAdmin.gs - ca hai da duoc cap nhat de tu dong gan secret nay vao URL.)
 *
 * LUU Y: sau khi thiet lap secret, phai dang ky lai webhook (xoa webhook cu qua
 * deleteAllOldWebhooks() roi dang ky lai) vi webhook cu (khong co ?secret=) se
 * bi doPost tu choi.
 */
function setupWebhookSecret() {
  const props = PropertiesService.getScriptProperties();
  const existing = props.getProperty("WEBHOOK_SECRET");
  if (existing) {
    Logger.log("Da co san WEBHOOK_SECRET, khong tao lai (xoa property nay truoc neu muon doi).");
    Logger.log("Secret hien tai: " + existing);
    return;
  }
  const secret = Utilities.getUuid().replace(/-/g, "");
  props.setProperty("WEBHOOK_SECRET", secret);
  Logger.log("Da tao WEBHOOK_SECRET moi: " + secret);
  Logger.log("Them vao cuoi URL webhook khi dang ky voi KiotViet: ?secret=" + secret);
}

/**
 * HAM THIET LAP TRIGGER - CHI CAN CHAY 1 LAN DUY NHAT BANG TAY
 * (bam nut Run tren chinh ham nay 1 lan, sau do co the xoa hoac de nguyen cung duoc)
 *
 * Sau khi chay, Apps Script se tu dong goi processWebhookQueue() moi 1 phut,
 * vinh vien (cho toi khi ban xoa trigger trong muc Triggers ben trai).
 */
function setupQueueProcessingTrigger() {
  // Xoa cac trigger cu cua ham nay neu co, tranh tao trung
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "processWebhookQueue") {
      ScriptApp.deleteTrigger(t);
    }
  });

  // Tao trigger moi: chay moi 1 phut
  ScriptApp.newTrigger("processWebhookQueue")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("Da thiet lap trigger: processWebhookQueue() se tu chay moi 1 phut.");
  Logger.log("Kiem tra lai bang cach vao muc Triggers (icon dong ho o thanh ben trai Apps Script).");
}
