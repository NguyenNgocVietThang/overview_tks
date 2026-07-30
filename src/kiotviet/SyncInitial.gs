// ==========================================
// DONG BO DAY DU KIOTVIET -> 9 SHEET VAN HANH
// ==========================================

/**
 * Dong bo toan bo 9 sheet van hanh va 2 sheet bao cao.
 *
 * Cac cot dashboard dang dung luon nam o ben trai; cac truong Public API dang
 * duoc su dung duoc bo sung o ben phai, khong kem cot JSON.
 */
function syncAllInitialData() {
  migrateKiotVietSheetsIfNeeded_();

  const token = getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token.');

  Logger.log('Bat dau dong bo Nhom hang...');
  syncCategoriesInitial(token);

  Logger.log('Bat dau dong bo Hang hoa...');
  syncProductsInitial(token);

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

  Logger.log('Hoan tat dong bo day du 9 sheet van hanh va 2 sheet bao cao.');
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
  return writeKiotVietSheet_(schema, items);
}

/**
 * Ba endpoint nay khong co webhook Public API; polling 5 phut de sheet khong bi cu.
 */
function syncPollingOnly_() {
  const token = getKiotVietToken();
  syncReturnsInitial(token);
  syncSuppliersInitial(token);
  syncPurchasesInitial(token);
  Logger.log('Da polling Tra hang, Nha cung cap va Nhap hang.');
}

function setupPollingTrigger() {
  removePollingTrigger_();
  ScriptApp.newTrigger('syncPollingOnly_')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Da bat polling 5 phut cho Tra hang, Nha cung cap va Nhap hang.');
}

function removePollingTrigger() {
  removePollingTrigger_();
  Logger.log('Da tat polling 5 phut.');
}

function removePollingTrigger_() {
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'syncPollingOnly_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}
