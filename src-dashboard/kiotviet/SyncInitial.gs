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
      Logger.log('Bat dau tao cac bao cao tong hop (Debt Report, Hang ngung KD, Bao cao ban hang)...');
      const token = getKiotVietToken();
      syncCustomerDebtReports(token);
      syncHangNgungKinhDoanh_(token);
      syncCustomerReport();
      props.deleteProperty('MASTER_CHAIN_SYNC_STATE');
      removeAllChunkResumeTriggers_();
      Logger.log('🎉🎉🎉 HOAN TAT TOAN BO CHUOI DONG BO 9 SHEET VAN HANH VA 7 SHEET TONG HOP/BAO CAO!');
      return;
    }

    // Chay phan doan cho bang hien tai trong chuoi
    const result = syncKiotVietTableChunk_(currentStep, {
      resumeHandler: 'resumeMasterChainSync_',
      autoSchedule: false
    });

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
        removeAllChunkResumeTriggers_();
        Logger.log('🎉 HOAN TAT TOAN BO CAC BANG DU LIEU!');
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

function syncInvoicesChunk() {
  return syncKiotVietTableChunk_('invoices', { resumeHandler: 'resumeSyncInvoicesChunk' });
}
function resumeSyncInvoicesChunk() {
  return syncInvoicesChunk();
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
  const dataLock = getKiotVietDataLock_();
  dataLock.waitLock(30000);
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
function syncPollingOnly_() {
  const dataLock = getKiotVietDataLock_();
  if (!dataLock.tryLock(30000)) {
    Logger.log('Bo qua polling lan nay vi dang co mot dot ghi du lieu khac.');
    return;
  }
  try {
    const token = getKiotVietToken();
    syncReturnsInitial(token);
    syncSuppliersInitial(token);
    syncPurchasesInitial(token);
    Logger.log('Da polling Tra hang, Nha cung cap va Nhap hang.');
  } finally {
    dataLock.releaseLock();
  }
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
}
