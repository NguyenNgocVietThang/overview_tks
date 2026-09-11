// ==========================================
// LICH BAO TRI TACH RIENG KHOI HANG DOI WEBHOOK
// ==========================================
//
// processWebhookQueue() (WebhookQueue.gs) truoc day gop chung ca xu ly webhook
// lan "chay bu" bao cao/cong no va cac watchdog trigger, dung chung 1 lich moi
// phut. Tach rieng ra day de: (1) mot lo bao cao cham (toi da 270s/lan) khong
// con canh tranh lock/lam tre lan trigger webhook ke tiep, (2) co the tam dung
// rieng hai tac vu ton UrlFetch (bao cao/cong no) khi dang trong thoi gian tam
// dung cua Quota Guard, trong khi watchdog/migrate schema (khong ton UrlFetch)
// van chay binh thuong.

const KIOTVIET_MAINTENANCE_TICK_HANDLER_ = 'runKiotVietMaintenanceTick_';
const KIOTVIET_MAINTENANCE_TICK_INTERVAL_MINUTES_ = 15;

function runKiotVietMaintenanceTick_() {
  if (isShipmentLifecycleMode_()) return;

  if (typeof ensureKiotVietRecoveryTriggers_ === 'function') ensureKiotVietRecoveryTriggers_();
  ensureMasterChainResumeTrigger_();
  ensurePollingOnlyResumeTrigger_();

  const masterBackfillActive = Boolean(
    PropertiesService.getScriptProperties().getProperty('MASTER_CHAIN_SYNC_STATE')
  );
  if (masterBackfillActive) return;

  const maintenanceLock = getKiotVietDataLock_();
  if (!maintenanceLock.tryLock(5000)) return;
  try {
    try {
      migrateKiotVietSheetsIfNeeded_();
    } catch (migrationError) {
      Logger.log('Loi cap nhat schema, se thu lai: ' + migrationError.toString());
    }

    if (isKiotVietQuotaPaused_()) {
      Logger.log('Bo qua chay bu Bao cao/Cong no vi dang tam dung do quota UrlFetch.');
      return;
    }

    syncCustomerReportIfDue_();
    // Sau 15:00, chay bu bao cao cong no neu trigger ngay bi tre hoac loi.
    syncCustomerDebtReportsIfDue_();
  } finally {
    maintenanceLock.releaseLock();
  }
}

function setupMaintenanceTrigger() {
  removeMaintenanceTrigger_();
  ScriptApp.newTrigger(KIOTVIET_MAINTENANCE_TICK_HANDLER_)
    .timeBased()
    .everyMinutes(KIOTVIET_MAINTENANCE_TICK_INTERVAL_MINUTES_)
    .create();
  Logger.log('Da bat trigger bao tri (bao cao/cong no/watchdog) moi 15 phut, tach khoi hang doi webhook.');
}

function removeMaintenanceTrigger_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === KIOTVIET_MAINTENANCE_TICK_HANDLER_) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}
