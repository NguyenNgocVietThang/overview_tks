// ==========================================
// DONG BO KIOTVIET -> 9 SHEET VAN HANH
// ==========================================

// ==========================================
// 1. DONG BO PHAN DOAN (CHUNKED SYNC) — KHUYEN DUNG CHO DU LIEU LON
// ==========================================

const MASTER_SYNC_CHAIN = Object.freeze([
  'categories',
  'products',
  'invoices',
  'orders',
  'returns',
  'customers',
  'suppliers',
  'purchases',
  'reports'
]);

/**
 * Dong bo toan bo he thong theo chuoi phan doan (Chunked Chain Sync).
 *
 * Moi lan chay chi lay 5.000 ban ghi va ngat an toan o phut 4.5; sau do tu tao
 * trigger 1 phut de chay tiep dot sau hoac chuyen sang bang tiep theo.
 * Khong bao gio bi loi Timeout 6 phut cua Google Apps Script.
 */
function syncAllDataChunked() {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    scheduleSpecificChunkTrigger_('resumeMasterChainSync_');
    Logger.log('Co tien trinh khac dang ghi du lieu, se thu lai o luot trigger sau.');
    return;
  }
  try {
    migrateKiotVietSheetsIfNeeded_();

    const props = PropertiesService.getScriptProperties();
    let masterState = {};
    try {
      const raw = props.getProperty('MASTER_CHAIN_SYNC_STATE');
      if (raw) masterState = JSON.parse(raw);
    } catch (e) {
      masterState = {};
    }

    let currentIndex = Number(masterState.currentIndex) || 0;
    if (currentIndex >= MASTER_SYNC_CHAIN.length) {
      currentIndex = 0;
    }

    const currentStep = MASTER_SYNC_CHAIN[currentIndex];
    Logger.log('=== CHUOI DONG BO LIEN HOAN: Buoc ' + (currentIndex + 1) + '/' + MASTER_SYNC_CHAIN.length + ' (' + currentStep + ') ===');

    if (currentStep === 'reports') {
      props.deleteProperty('MASTER_CHAIN_SYNC_STATE');
      props.deleteProperty('MASTER_CHAIN_SYNC_WATCHDOG_AT');
      removeAllChunkResumeTriggers_();
      Logger.log('HOAN TAT CHUOI DONG BO DU LIEU VAN HANH. CAC BAO CAO SE CHAY QUA TRIGGER RIENG.');
      return;
    }

    // Chay phan doan cho bang hien tai trong chuoi. Rieng Hoa don dung khoa
    // rieng (getKiotVietInvoiceLock_) de dong bo voi resumeSyncInvoicesChunk
    // va webhook Hoa don, tranh ghi de chong cheo len cung sheet Hoa don.
    let result;
    if (currentStep === 'invoices') {
      const invoiceLock = getKiotVietInvoiceLock_();
      if (!invoiceLock.tryLock(30000)) {
        scheduleSpecificChunkTrigger_('resumeMasterChainSync_');
        Logger.log('Hoa don dang duoc dong bo rieng o noi khac, se thu lai o luot sau.');
        return;
      }
      try {
        result = syncKiotVietTableChunk_(currentStep, {
          resumeHandler: 'resumeMasterChainSync_',
          autoSchedule: false
        });
      } finally {
        invoiceLock.releaseLock();
      }
    } else {
      result = syncKiotVietTableChunk_(currentStep, {
        resumeHandler: 'resumeMasterChainSync_',
        autoSchedule: false
      });
    }

    if (result.isCompleted) {
      // Bang nay da xong 100% -> Chuyen sang bang ke tiep
      currentIndex++;
      if (currentIndex < MASTER_SYNC_CHAIN.length) {
        props.setProperty('MASTER_CHAIN_SYNC_STATE', JSON.stringify({
          currentIndex: currentIndex,
          chain: MASTER_SYNC_CHAIN,
          updatedAt: new Date().toISOString()
        }));
        scheduleSpecificChunkTrigger_('resumeMasterChainSync_');
        Logger.log('Bang ' + currentStep + ' da hoan tat 100%. Da len lich chuyen sang buoc tiep: ' + MASTER_SYNC_CHAIN[currentIndex]);
      } else {
        props.deleteProperty('MASTER_CHAIN_SYNC_STATE');
        props.deleteProperty('MASTER_CHAIN_SYNC_WATCHDOG_AT');
        removeAllChunkResumeTriggers_();
        Logger.log('HOAN TAT TOAN BO CAC BANG DU LIEU!');
      }
    } else {
      // Bang nay chua xong -> Luu state va len lich chay tiep bang nay
      props.setProperty('MASTER_CHAIN_SYNC_STATE', JSON.stringify({
        currentIndex: currentIndex,
        chain: MASTER_SYNC_CHAIN,
        updatedAt: new Date().toISOString()
      }));
      scheduleSpecificChunkTrigger_('resumeMasterChainSync_');
      Logger.log('Bang ' + currentStep + ' chua xong. Se tu dong chay tiep phan doan sau 1 phut.');
    }
  } finally {
    dataLock.releaseLock();
  }
}

/**
 * Handler tiep suc cho chuoi dong bo Master.
 */
function resumeMasterChainSync_() {
  syncAllDataChunked();
}

/**
 * Watchdog nhe cho chuoi master: neu checkpoint con ton tai nhung trigger
 * mot-lan da bi tieu thu/mat, tao lai trigger de chuoi khong dung vinh vien.
 */
function ensureMasterChainResumeTrigger_() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('MASTER_CHAIN_SYNC_STATE')) return false;

  const handlerName = 'resumeMasterChainSync_';
  const watchdogKey = 'MASTER_CHAIN_SYNC_WATCHDOG_AT';
  const watchdogAt = Number(props.getProperty(watchdogKey)) || 0;
  const watchdogIsFresh = Date.now() - watchdogAt < 7 * 60 * 1000;
  const hasResumeTrigger = ScriptApp.getProjectTriggers().some(trigger =>
    trigger.getHandlerFunction() === handlerName
  );
  if (hasResumeTrigger && watchdogIsFresh) return false;

  scheduleSpecificChunkTrigger_(handlerName);
  props.setProperty(watchdogKey, String(Date.now()));
  Logger.log('Da khoi phuc trigger tiep suc cho chuoi dong bo master.');
  return true;
}

/**
 * Dung rieng chuoi master ma khong xoa checkpoint cua bat ky bang nao.
 * Dung khi chuoi bi khoi dong ngoai y muon hoac can nhuong lock cho backfill
 * quan tri rieng.
 */
function stopMasterSyncChain() {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    throw new Error('Chuoi master dang chay; hay chay lai stopMasterSyncChain sau.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('MASTER_CHAIN_SYNC_STATE');
    props.deleteProperty('MASTER_CHAIN_SYNC_WATCHDOG_AT');
    removeSpecificChunkTrigger_('resumeMasterChainSync_');
    Logger.log('Da dung chuoi master; checkpoint tung bang duoc giu nguyen.');
    return { stopped: true };
  } finally {
    dataLock.releaseLock();
  }
}

// ----------------------------------------------------
// CAC HAM DONG BO PHAN DOAN RIENG CHO TUNG BANG
// ----------------------------------------------------

/**
 * Boc syncKiotVietTableChunk_ bang getKiotVietDataLock_() cho cac bang dung
 * chung khoa voi chuoi master/polling-only (moi thu ngoai tru Hoa don). Truoc
 * ban sua nay, cac ham syncXxxChunk() duoi day khong lay khoa nao ca — trong
 * khi HuongDanSuDung.gs khuyen dung chung de "chi dong bo rieng mot bang cu
 * the". Neu chay dung luc chuoi master/polling dang dong bo cung bang, ca hai
 * cung clearContents() + ghi de len nhau va de checkpoint chung
 * (SYNC_CHUNK_STATE_<bang>) trong Script Properties, gay mat/trung du lieu.
 * Neu khong lay duoc khoa (mot tien trinh khac dang ghi), len lich trigger
 * tiep suc thay vi ghi de khong khoa.
 */
function runKiotVietDataLockedChunk_(schemaKey, resumeHandler) {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    scheduleSpecificChunkTrigger_(resumeHandler);
    Logger.log('[' + schemaKey + '] Co tien trinh khac dang ghi du lieu, se thu lai o luot trigger sau.');
    return { schemaKey: schemaKey, isCompleted: false, waitingForLock: true };
  }
  try {
    return syncKiotVietTableChunk_(schemaKey, { resumeHandler: resumeHandler });
  } finally {
    dataLock.releaseLock();
  }
}

function syncCategoriesChunk() {
  return runKiotVietDataLockedChunk_('categories', 'resumeSyncCategoriesChunk');
}
function resumeSyncCategoriesChunk() {
  return syncCategoriesChunk();
}

function syncProductsChunk() {
  return runKiotVietDataLockedChunk_('products', 'resumeSyncProductsChunk');
}
function resumeSyncProductsChunk() {
  return syncProductsChunk();
}

/**
 * Dung khoa rieng (getKiotVietInvoiceLock_) thay vi khoa chung, de backfill
 * Hoa don khong bao gio bi doi vo han khi chuoi polling-only (Tra hang/Nha
 * cung cap/Nhap hang) dang giu khoa chung hang phut. Khoa rieng nay chi tranh
 * chap voi webhook Hoa don va buoc 'invoices' trong chuoi master — hai noi
 * duy nhat khac cung ghi vao sheet Hoa don/Chi tiet hoa don.
 */
function syncInvoicesChunk() {
  const resumeHandler = 'resumeManualInvoicesBackfill_';
  const invoiceLock = getKiotVietInvoiceLock_();
  if (!invoiceLock.tryLock(30000)) {
    scheduleSpecificChunkTrigger_(resumeHandler);
    Logger.log('Hoa don dang cho mot tien trinh ghi khac; se thu lai sau 1 phut.');
    return { schemaKey: 'invoices', isCompleted: false, waitingForLock: true };
  }
  try {
    return syncKiotVietTableChunk_('invoices', {
      resumeHandler: resumeHandler
    });
  } catch (error) {
    scheduleSpecificChunkTrigger_(resumeHandler);
    Logger.log('Backfill Hoa don bi gian doan; se thu lai sau: ' + error.toString());
    return {
      schemaKey: 'invoices',
      isCompleted: false,
      error: String((error && error.message) || error)
    };
  } finally {
    invoiceLock.releaseLock();
  }
}
function resumeSyncInvoicesChunk() {
  Logger.log('Trigger backfill Hoa don cu da duoc chuyen sang doi soat incremental.');
  return syncRecentInvoices_();
}
function resumeManualInvoicesBackfill_() {
  return syncInvoicesChunk();
}

function hasInvoicesBackfillProgress_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('SYNC_CHUNK_STATE_invoices')) return true;
  if (typeof SpreadsheetApp === 'undefined' ||
      typeof SpreadsheetApp.getActiveSpreadsheet !== 'function') return false;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  return Boolean(
    spreadsheet.getSheetByName(KIOTVIET_CHUNK_STAGING_SHEETS_.invoices) ||
    spreadsheet.getSheetByName(KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_)
  );
}

/** Khoi phuc trigger mot lan neu backfill Hoa don con checkpoint/staging. */
function ensureInvoicesBackfillResumeTrigger_() {
  removeSpecificChunkTrigger_('resumeSyncInvoicesChunk');
  return false;
}

/**
 * Khoi dong lai rieng backfill Hoa don/Chi tiet hoa don. Khong xoa checkpoint
 * cua bang khac; du lieu live chi duoc thay sau khi ca hai staging tai xong.
 */
function restartInvoicesBackfill() {
  const invoiceLock = getKiotVietInvoiceLock_();
  if (!invoiceLock.tryLock(30000)) {
    throw new Error('Dang co tien trinh ghi du lieu khac; hay chay lai restartInvoicesBackfill sau.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('SYNC_CHUNK_STATE_invoices');
    props.deleteProperty(KIOTVIET_INVOICE_BACKFILL_LAST_RESULT_PROPERTY_);
    removeSpecificChunkTrigger_('resumeSyncInvoicesChunk');
    removeSpecificChunkTrigger_('resumeManualInvoicesBackfill_');

    if (typeof SpreadsheetApp !== 'undefined' &&
        typeof SpreadsheetApp.getActiveSpreadsheet === 'function') {
      const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      [
        KIOTVIET_CHUNK_STAGING_SHEETS_.invoices,
        KIOTVIET_INVOICE_DETAIL_STAGING_SHEET_
      ].forEach(function(sheetName) {
        const stagingSheet = spreadsheet.getSheetByName(sheetName);
        if (stagingSheet) spreadsheet.deleteSheet(stagingSheet);
      });
    }

    return syncKiotVietTableChunk_('invoices', {
      resumeHandler: 'resumeManualInvoicesBackfill_'
    });
  } finally {
    invoiceLock.releaseLock();
  }
}

/**
 * Khoi dong lai rieng backfill Nhap hang, cung co che voi restartInvoicesBackfill:
 * xoa checkpoint + staging cua Nhap hang, khong dung cac bang khac; du lieu live
 * chi duoc thay sau khi staging tai xong toan bo.
 */
function restartPurchasesBackfill() {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    throw new Error('Dang co tien trinh ghi du lieu khac; hay chay lai restartPurchasesBackfill sau.');
  }
  try {
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('SYNC_CHUNK_STATE_purchases');
    removeSpecificChunkTrigger_('resumeSyncPurchasesChunk');

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const stagingSheet = spreadsheet.getSheetByName(KIOTVIET_CHUNK_STAGING_SHEETS_.purchases);
    if (stagingSheet) spreadsheet.deleteSheet(stagingSheet);

    return syncKiotVietTableChunk_('purchases', {
      resumeHandler: 'resumeSyncPurchasesChunk'
    });
  } finally {
    dataLock.releaseLock();
  }
}

function syncOrdersChunk() {
  return runKiotVietDataLockedChunk_('orders', 'resumeSyncOrdersChunk');
}
function resumeSyncOrdersChunk() {
  return syncOrdersChunk();
}

function syncReturnsChunk() {
  return runKiotVietDataLockedChunk_('returns', 'resumeSyncReturnsChunk');
}
function resumeSyncReturnsChunk() {
  return syncReturnsChunk();
}

function syncCustomersChunk() {
  return runKiotVietDataLockedChunk_('customers', 'resumeSyncCustomersChunk');
}
function resumeSyncCustomersChunk() {
  return syncCustomersChunk();
}

function syncSuppliersChunk() {
  return runKiotVietDataLockedChunk_('suppliers', 'resumeSyncSuppliersChunk');
}
function resumeSyncSuppliersChunk() {
  return syncSuppliersChunk();
}

function syncPurchasesChunk() {
  return runKiotVietDataLockedChunk_('purchases', 'resumeSyncPurchasesChunk');
}
function resumeSyncPurchasesChunk() {
  return syncPurchasesChunk();
}

// ==========================================
// 2. DONG BO TOAN BO MOT LAN (LEGACY FULL SYNC)
// ==========================================

/**
 * Dong bo toan bo 9 sheet van hanh va 7 sheet tong hop/bao cao.
 *
 * Cac cot dashboard dang dung luon nam o ben trai; cac truong Public API dang
 * duoc su dung duoc bo sung o ben phai, khong kem cot JSON.
 */
function syncAllInitialData() {
  // Ham nay ghi tuan tu ca 9+7 sheet trong 1 lan chay, gom ca Hoa don, nen
  // phai giu ca hai khoa (chung + rieng Hoa don) de khong bi ghi de boi
  // resumeSyncInvoicesChunk/webhook hoac cac chuoi chunked khac chay song song.
  const dataLock = getKiotVietDataLock_();
  dataLock.waitLock(30000);
  const invoiceLock = getKiotVietInvoiceLock_();
  invoiceLock.waitLock(30000);
  try {
    migrateKiotVietSheetsIfNeeded_();

    const token = getKiotVietToken();
    if (!token) throw new Error('Khong lay duoc KiotViet token.');

    Logger.log('Bat dau dong bo Nhom hang...');
    syncCategoriesInitial(token);

    Logger.log('Bat dau dong bo Hang hoa...');
    syncProductsInitial(token);

    // Bao cao cong no tra cuu ten/nhom/thuong hieu tu tab Hang hoa. Phai tao
    // sau khi tab nay da duoc lam moi de sync all cho ket qua dung nhu khi chay
    // syncCustomerDebtReports() rieng, nhung van chay som de tranh het thoi gian.
    Logger.log('Bat dau tao Bao cao cong no HN1/HN3/HN7...');
    syncCustomerDebtReports(token);

    Logger.log('Bat dau dong bo Hoa don va Chi tiet hoa don...');
    syncInvoicesInitial(token);

    Logger.log('Bat dau dong bo Dat hang...');
    syncOrdersInitial(token);

    Logger.log('Bat dau dong bo Tra hang...');
    syncReturnsInitial(token);

    Logger.log('Bat dau dong bo Khach hang...');
    syncCustomersInitial(token);

    Logger.log('Bat dau dong bo Nha cung cap...');
    syncSuppliersInitial(token);

    Logger.log('Bat dau dong bo Nhap hang...');
    syncPurchasesInitial(token);

    Logger.log('Bat dau tao 3 bao cao khach hang...');
    syncCustomerReport();

    Logger.log('Hoan tat dong bo day du 9 sheet van hanh va 7 sheet tong hop/bao cao.');
  } finally {
    invoiceLock.releaseLock();
    dataLock.releaseLock();
  }
}

function syncCategoriesInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.categories;
  const items = fetchAllKiotVietPages_(schema, token);
  return writeKiotVietSheet_(schema, items);
}

function syncProductsInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.products;
  const items = fetchAllKiotVietPages_(schema, token)
    .filter(product => !isVatProductCode(getProductCode_(product)));
  return writeKiotVietSheet_(schema, items);
}

function syncInvoicesInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.invoices;
  const items = fetchAllKiotVietPages_(schema, token);
  writeKiotVietSheet_(schema, items);
  writeInvoiceDetailsSheet_(items);
  return items.length;
}

function syncOrdersInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.orders;
  const items = fetchAllKiotVietPages_(schema, token);
  return writeKiotVietSheet_(schema, items);
}

function syncReturnsInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.returns;
  const items = fetchAllKiotVietPages_(schema, token);
  return writeKiotVietSheet_(schema, items);
}

function syncCustomersInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.customers;
  const items = fetchAllKiotVietPages_(schema, token);
  return writeKiotVietSheet_(schema, items);
}

function syncSuppliersInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.suppliers;
  const items = fetchAllKiotVietPages_(schema, token);
  return writeKiotVietSheet_(schema, items);
}

function syncPurchasesInitial(token) {
  token = token || getKiotVietToken();
  const schema = KIOTVIET_SHEET_SCHEMAS.purchases;
  const items = fetchAllKiotVietPages_(schema, token);
  const wrappers = buildPurchaseOrderWrappers_(items);
  return writeKiotVietSheet_(schema, wrappers);
}

/** Hai endpoint nay khong co webhook Public API; polling 15 phut de giam quota. */
const POLLING_ONLY_CHAIN = Object.freeze(['returns', 'suppliers']);
const POLLING_ONLY_STATE_PROPERTY = 'POLLING_ONLY_CHAIN_INDEX';
const POLLING_ONLY_RESUME_HANDLER = 'resumePollingOnlyChunk_';
const KIOTVIET_INCREMENTAL_CHECKPOINT_PREFIX_ = 'KIOTVIET_INCREMENTAL_CHECKPOINT_';
const KIOTVIET_INCREMENTAL_LAST_START_PREFIX_ = 'KIOTVIET_INCREMENTAL_LAST_START_';
const KIOTVIET_INCREMENTAL_INITIAL_LOOKBACK_MS_ = 48 * 60 * 60 * 1000;
const KIOTVIET_INCREMENTAL_OVERLAP_MS_ = 10 * 60 * 1000;
const KIOTVIET_INCREMENTAL_MIN_INTERVAL_MS_ = 4 * 60 * 1000;

/**
 * Lay cac ban ghi thay doi tu checkpoint gan nhat. Cua so chong lan 10 phut
 * giup bu cho webhook/trigger den tre; checkpoint chi duoc luu sau khi ghi xong.
 */
function syncKiotVietIncrementalTable_(schemaKey, now) {
  const isInvoice = schemaKey === 'invoices';
  const dataLock = isInvoice ? getKiotVietInvoiceLock_() : getKiotVietDataLock_();
  if (!dataLock.tryLock(5000)) {
    Logger.log('Bo qua incremental ' + schemaKey + ' vi dang co tien trinh ghi khac.');
    return { schemaKey: schemaKey, updatedItems: 0, waitingForLock: true };
  }
  try {
    const props = PropertiesService.getScriptProperties();
    const runStartedAt = now && typeof now.getTime === 'function'
      ? new Date(now.getTime())
      : new Date();
    const lastStartKey = KIOTVIET_INCREMENTAL_LAST_START_PREFIX_ + schemaKey;
    const lastStart = new Date(props.getProperty(lastStartKey) || 0);
    if (!isNaN(lastStart.getTime()) &&
        runStartedAt.getTime() - lastStart.getTime() < KIOTVIET_INCREMENTAL_MIN_INTERVAL_MS_) {
      return { schemaKey: schemaKey, updatedItems: 0, throttled: true };
    }
    props.setProperty(lastStartKey, runStartedAt.toISOString());

    const checkpointKey = KIOTVIET_INCREMENTAL_CHECKPOINT_PREFIX_ + schemaKey;
    const checkpoint = new Date(props.getProperty(checkpointKey) || 0);
    const startMs = !isNaN(checkpoint.getTime()) && checkpoint.getTime() > 0
      ? checkpoint.getTime() - KIOTVIET_INCREMENTAL_OVERLAP_MS_
      : runStartedAt.getTime() - KIOTVIET_INCREMENTAL_INITIAL_LOOKBACK_MS_;
    const start = new Date(startMs);
    const formattedStart = Utilities.formatDate(
      start,
      'Asia/Ho_Chi_Minh',
      "yyyy-MM-dd'T'HH:mm:ss"
    );
    const token = getKiotVietToken();
    if (!token) throw new Error('Khong lay duoc KiotViet token.');
    const schema = KIOTVIET_SHEET_SCHEMAS[schemaKey];
    const items = fetchAllKiotVietPages_(
      schema,
      token,
      'lastModifiedFrom=' + encodeURIComponent(formattedStart)
    );

    if (schemaKey === 'invoices') {
      updateInvoicesFromWebhook(items);
    } else if (schemaKey === 'purchases') {
      replaceRecentPurchaseOrders_(items);
    } else {
      upsertKiotVietSheetItems_(schema, items);
    }
    props.setProperty(checkpointKey, runStartedAt.toISOString());
    return { schemaKey: schemaKey, updatedItems: items.length };
  } finally {
    dataLock.releaseLock();
  }
}

function syncPollingOnly_(now) {
  return POLLING_ONLY_CHAIN.map(function(schemaKey) {
    return syncKiotVietIncrementalTable_(schemaKey, now);
  });
}

function resumePollingOnlyChunk_() {
  return syncPollingOnly_();
}

function syncRecentPurchases_(now) {
  const result = syncKiotVietIncrementalTable_('purchases', now);
  result.updatedOrders = result.updatedItems;
  return result;
}

function syncRecentInvoices_(now) {
  const result = syncKiotVietIncrementalTable_('invoices', now);
  result.updatedInvoices = result.updatedItems;
  return result;
}

/** Don trigger/state cua co che full polling tu cac ban deploy cu. */
function ensurePollingOnlyResumeTrigger_() {
  const props = PropertiesService.getScriptProperties();
  removeSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER);
  props.deleteProperty(POLLING_ONLY_STATE_PROPERTY);
  return false;
}

function setupPollingTrigger() {
  removePollingTrigger_();
  removeSpecificChunkTrigger_('resumeSyncInvoicesChunk');
  ScriptApp.newTrigger('syncPollingOnly_')
    .timeBased()
    .everyMinutes(15)
    .create();
  ScriptApp.newTrigger('syncRecentPurchases_')
    .timeBased()
    .everyMinutes(5)
    .create();
  ScriptApp.newTrigger('syncRecentInvoices_')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Da bat doi soat incremental: Hoa don/Nhap hang 5 phut, Tra hang/NCC 15 phut.');
}

function removePollingTrigger() {
  removePollingTrigger_();
  Logger.log('Da tat polling 15 phut.');
}

function removePollingTrigger_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncPollingOnly_' ||
        trigger.getHandlerFunction() === 'syncRecentPurchases_' ||
        trigger.getHandlerFunction() === 'syncRecentInvoices_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  removeSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER);
  PropertiesService.getScriptProperties().deleteProperty(POLLING_ONLY_STATE_PROPERTY);
}
