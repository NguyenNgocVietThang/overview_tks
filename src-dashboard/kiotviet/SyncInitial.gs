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
    migrateLegacyDiscontinuedSheet_(SpreadsheetApp.getActiveSpreadsheet());

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

function syncCategoriesChunk() {
  return syncKiotVietTableChunk_('categories', { resumeHandler: 'resumeSyncCategoriesChunk' });
}
function resumeSyncCategoriesChunk() {
  return syncCategoriesChunk();
}

function syncProductsChunk() {
  return syncKiotVietTableChunk_('products', { resumeHandler: 'resumeSyncProductsChunk' });
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
  const invoiceLock = getKiotVietInvoiceLock_();
  if (!invoiceLock.tryLock(30000)) {
    scheduleSpecificChunkTrigger_('resumeSyncInvoicesChunk');
    Logger.log('Hoa don dang cho mot tien trinh ghi khac; se thu lai sau 1 phut.');
    return { schemaKey: 'invoices', isCompleted: false, waitingForLock: true };
  }
  try {
    return syncKiotVietTableChunk_('invoices', {
      resumeHandler: 'resumeSyncInvoicesChunk'
    });
  } finally {
    invoiceLock.releaseLock();
  }
}
function resumeSyncInvoicesChunk() {
  return syncInvoicesChunk();
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
      resumeHandler: 'resumeSyncInvoicesChunk'
    });
  } finally {
    invoiceLock.releaseLock();
  }
}

function syncOrdersChunk() {
  return syncKiotVietTableChunk_('orders', { resumeHandler: 'resumeSyncOrdersChunk' });
}
function resumeSyncOrdersChunk() {
  return syncOrdersChunk();
}

function syncReturnsChunk() {
  return syncKiotVietTableChunk_('returns', { resumeHandler: 'resumeSyncReturnsChunk' });
}
function resumeSyncReturnsChunk() {
  return syncReturnsChunk();
}

function syncCustomersChunk() {
  return syncKiotVietTableChunk_('customers', { resumeHandler: 'resumeSyncCustomersChunk' });
}
function resumeSyncCustomersChunk() {
  return syncCustomersChunk();
}

function syncSuppliersChunk() {
  return syncKiotVietTableChunk_('suppliers', { resumeHandler: 'resumeSyncSuppliersChunk' });
}
function resumeSyncSuppliersChunk() {
  return syncSuppliersChunk();
}

function syncPurchasesChunk() {
  return syncKiotVietTableChunk_('purchases', { resumeHandler: 'resumeSyncPurchasesChunk' });
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
    // Don tab legacy ngay tu dau; neu chi co tab cu thi doi ten de giu du lieu.
    migrateLegacyDiscontinuedSheet_(SpreadsheetApp.getActiveSpreadsheet());

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

    Logger.log('Bat dau cap nhat lich su Hang ngung kinh doanh...');
    syncHangNgungKinhDoanh_(token);

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

/**
 * Ba endpoint nay khong co webhook Public API; polling 15 phut de giam quota.
 */
const POLLING_ONLY_CHAIN = Object.freeze(['returns', 'suppliers', 'purchases']);
const POLLING_ONLY_STATE_PROPERTY = 'POLLING_ONLY_CHAIN_INDEX';
const POLLING_ONLY_RESUME_HANDLER = 'resumePollingOnlyChunk_';
const POLLING_ONLY_RESUME_DELAY_MS = 5 * 60 * 1000;

/**
 * Chay mot phan doan (chunk) cho bang dang den luot trong POLLING_ONLY_CHAIN,
 * qua co che chunked/resumable dung chung voi syncAllDataChunked (xem
 * syncKiotVietTableChunk_ o SheetSchemas.gs). Moi lan chay toi da ~4.5 phut
 * (SYNC_CHUNK_CONFIG.MAX_RUN_SECONDS) roi nha lock, tranh timeout 6 phut cua
 * Apps Script va tranh giu lock qua lau lam chan processWebhookQueue.
 * Neu chua xong bang hien tai (hoac chua het chuoi), tu tao trigger 5 phut
 * (POLLING_ONLY_RESUME_HANDLER) doc lap voi trigger chinh 15 phut de tiep suc.
 */
function syncPollingOnly_() {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    Logger.log('Bo qua polling lan nay vi dang co mot dot ghi du lieu khac.');
    return;
  }
  try {
    const props = PropertiesService.getScriptProperties();
    let tableIndex = Number(props.getProperty(POLLING_ONLY_STATE_PROPERTY)) || 0;
    if (tableIndex >= POLLING_ONLY_CHAIN.length) tableIndex = 0;

    const schemaKey = POLLING_ONLY_CHAIN[tableIndex];
    const result = syncKiotVietTableChunk_(schemaKey, {
      resumeHandler: POLLING_ONLY_RESUME_HANDLER,
      autoSchedule: false
    });

    if (!result.isCompleted) {
      props.setProperty(POLLING_ONLY_STATE_PROPERTY, String(tableIndex));
      scheduleSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER, POLLING_ONLY_RESUME_DELAY_MS);
      Logger.log('[' + schemaKey + '] Polling chua xong, se tiep tuc sau 5 phut.');
      return;
    }

    tableIndex++;
    if (tableIndex < POLLING_ONLY_CHAIN.length) {
      props.setProperty(POLLING_ONLY_STATE_PROPERTY, String(tableIndex));
      scheduleSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER, POLLING_ONLY_RESUME_DELAY_MS);
      Logger.log('Da polling xong ' + schemaKey + ', tiep tuc ' + POLLING_ONLY_CHAIN[tableIndex] + ' sau 5 phut.');
    } else {
      props.deleteProperty(POLLING_ONLY_STATE_PROPERTY);
      removeSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER);
      Logger.log('Da polling xong Tra hang, Nha cung cap va Nhap hang.');
    }
  } finally {
    dataLock.releaseLock();
  }
}

function resumePollingOnlyChunk_() {
  syncPollingOnly_();
}

function setupPollingTrigger() {
  removePollingTrigger_();
  ScriptApp.newTrigger('syncPollingOnly_')
    .timeBased()
    .everyMinutes(15)
    .create();
  Logger.log('Da bat polling 15 phut cho Tra hang, Nha cung cap va Nhap hang.');
}

function removePollingTrigger() {
  removePollingTrigger_();
  Logger.log('Da tat polling 15 phut.');
}

function removePollingTrigger_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncPollingOnly_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  removeSpecificChunkTrigger_(POLLING_ONLY_RESUME_HANDLER);
  PropertiesService.getScriptProperties().deleteProperty(POLLING_ONLY_STATE_PROPERTY);
}
