// ==========================================
// DONG BO DAY DU KIOTVIET -> 9 SHEET VAN HANH
// ==========================================

/**
 * Dong bo toan bo 9 sheet van hanh va 6 sheet tong hop/bao cao.
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

    Logger.log('Bat dau tao Bao cao ban hang va Hang ban theo khach...');
    syncCustomerReport();

    Logger.log('Hoan tat dong bo day du 9 sheet van hanh va 6 sheet tong hop/bao cao.');
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
