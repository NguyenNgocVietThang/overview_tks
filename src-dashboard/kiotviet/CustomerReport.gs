// ==========================================
// BAO CAO KHACH HANG - TOAN THOI GIAN VA HANG BAN 90 NGAY
// ==========================================

const CUSTOMER_REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const CUSTOMER_SALES_REPORT_TRIGGER_HANDLER = 'syncSalesCustomerReport';
const CUSTOMER_PRODUCT_REPORT_TRIGGER_HANDLER = 'syncCustomerProductReport';
const CUSTOMER_BY_PRODUCT_REPORT_TRIGGER_HANDLER = 'syncCustomerByProductReport';
const CUSTOMER_REPORT_LEGACY_TRIGGER_HANDLER = 'syncCustomerReport';
const CUSTOMER_REPORT_LAST_SYNC_PROPERTY = 'CUSTOMER_REPORT_LAST_SYNC_DATE';
const CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY =
  'CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE';
const CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY =
  'CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE';
const CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY = 'CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION';
const CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION = 'detail-quantity-header-v2';
const CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY = 'CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION';
const CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION = 'kiotviet-export-25-columns-v1';
const CUSTOMER_REPORT_DAILY_SCHEDULES = Object.freeze([
  { handler: CUSTOMER_SALES_REPORT_TRIGGER_HANDLER, hour: 6, minute: 0 },
  { handler: CUSTOMER_PRODUCT_REPORT_TRIGGER_HANDLER, hour: 6, minute: 30 },
  { handler: CUSTOMER_BY_PRODUCT_REPORT_TRIGGER_HANDLER, hour: 7, minute: 0 }
]);
const CUSTOMER_REPORT_CATCH_UP_DEFINITIONS = Object.freeze([
  {
    minuteOfDay: 360,
    lastSyncProperty: CUSTOMER_REPORT_LAST_SYNC_PROPERTY,
    handler: syncSalesCustomerReport
  },
  {
    minuteOfDay: 390,
    lastSyncProperty: CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY,
    schemaProperty: CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY,
    schemaVersion: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION,
    handler: syncCustomerProductReport
  },
  {
    minuteOfDay: 420,
    lastSyncProperty: CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY,
    schemaProperty: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY,
    schemaVersion: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION,
    handler: syncCustomerByProductReport
  }
]);
const CUSTOMER_REPORT_PAGE_SIZE = 100;
const CUSTOMER_BY_PRODUCT_REPORT_WRITE_CHUNK_SIZE = 500;
const CUSTOMER_REPORT_HEADERS = Object.freeze([
  'Mã KH',
  'Khách hàng',
  'Số điện thoại',
  'Nhóm khách hàng',
  'SL đơn bán',
  'Tổng tiền',
  'Giảm giá HĐ',
  'Doanh thu',
  'SL đơn trả',
  'Giá trị trả',
  'Doanh thu thuần',
  'Mã giao dịch',
  'Thời gian (theo giao dịch)',
  'Nhân viên',
  'SL giao dịch (theo giao dịch)',
  'Tổng tiền hàng (theo giao dịch)',
  'Giảm giá (theo giao dịch)',
  'Doanh thu (theo giao dịch)'
]);
const CUSTOMER_PRODUCT_REPORT_DAYS = 90;
const CUSTOMER_PRODUCT_REPORT_HEADERS = Object.freeze([
  'Khách hàng',
  'Mã hàng',
  'Tên hàng',
  'SL mua chi tiết',
  'Thời gian'
]);
const CUSTOMER_BY_PRODUCT_REPORT_HEADERS = Object.freeze([
  'Nhóm hàng',
  'Mã hàng',
  'Tên hàng',
  'Thương hiệu',
  'Đơn vị tính',
  'SL Khách hàng',
  'SL mua (theo sản phẩm)',
  'Doanh thu (theo sản phẩm)',
  'SL Trả (theo sản phẩm)',
  'Giá trị trả (theo sản phẩm)',
  'Doanh thu thuần (theo sản phẩm)',
  'Mã KH',
  'Khách hàng',
  'Số điện thoại',
  'SL mua (theo khách hàng)',
  'Doanh thu (theo khách hàng)',
  'SL Trả (theo khách hàng)',
  'Giá trị trả (theo khách hàng)',
  'Doanh thu thuần (theo khách hàng)',
  'Mã hóa đơn',
  'Chi nhánh',
  'Thời gian',
  'SL chi tiết',
  'Đơn giá chi tiết',
  'Thành tiền chi tiết'
]);

/**
 * Tao/cap nhat ba tab bao cao khach hang:
 * - "Bao cao ban hang": Ban hang -> Toan thoi gian (tu truoc den nay).
 * - "Hang ban theo khach": Hang ban theo khach -> 90 ngay qua.
 * - "Khach theo hang hoa": Khach theo hang hoa -> Toan thoi gian.
 *
 * Moi hoa don/phieu tra hang la mot dong chi tiet giao dich, kem theo cac chi so
 * tong hop cua khach hang giong file xuat Bao cao ban hang cua KiotViet.
 * Doanh thu = tong hoa don hoan thanh tu truoc den nay sau giam gia hoa don.
 * Gia tri tra = tong phieu tra hang hoan thanh tu truoc den nay.
 * Doanh thu thuan = Doanh thu - Gia tri tra.
 */
function syncCustomerReport() {
  return withCustomerReportLock_(function() {
    const token = requireCustomerReportToken_();
    const now = new Date();
    const period = getCustomerReportAllTimeRange_(now);
    const productPeriod = getCustomerReportRollingRange_(now, CUSTOMER_PRODUCT_REPORT_DAYS);
    // Lay toan bo hoa don hoan thanh tu truoc den nay (khong gioi han fromPurchaseDate/toPurchaseDate)
    // de tab "Bao cao ban hang" tong hop du lieu toan thoi gian; tab "Hang ban theo khach" van
    // chi loc lai 90 ngay gan nhat tu chinh bo du lieu nay o buoc aggregate ben duoi.
    const invoices = fetchCustomerReportPages_('invoices', token, {
      status: 1
    });
    const returns = fetchCustomerReportPages_('returns', token, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    });
    const customerProfiles = fetchCustomerReportPages_('customers', token, {
      includeCustomerGroup: true
    });
    const reportRows = aggregateCustomerReport_(invoices, returns, period, customerProfiles);
    const productReportRows = aggregateCustomerProductReport_(invoices, productPeriod);
    const productMetadataLookup = buildCustomerByProductMetadataLookup_();
    const customerByProductReport = aggregateCustomerByProductReport_(
      invoices,
      returns,
      period,
      customerProfiles,
      productMetadataLookup
    );
    const reportSummary = summarizeCustomerReport_(reportRows);

    writeCustomerReportSheet_(reportRows, period);
    writeCustomerProductReportSheet_(productReportRows, productPeriod);
    SpreadsheetApp.flush();
    Logger.log(
      'Chuan bi ghi Khach theo hang hoa: %s dong, %s san pham.',
      customerByProductReport.rows.length,
      customerByProductReport.productCount
    );
    writeCustomerByProductReportSheet_(customerByProductReport.rows, period);
    const today = customerReportToday_();
    PropertiesService.getScriptProperties().setProperties({
      [CUSTOMER_REPORT_LAST_SYNC_PROPERTY]: today,
      [CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: today,
      [CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: today,
      [CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION,
      [CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION
    });
    Logger.log(
      'Da cap nhat Bao cao ban hang: %s khach, %s giao dich; Hang ban theo khach: %s dong; Khach theo hang hoa: %s dong, %s san pham.',
      reportRows.length,
      reportSummary.transactionCount,
      productReportRows.length,
      customerByProductReport.rows.length,
      customerByProductReport.productCount
    );

    const salesReport = buildCustomerSalesReportResult_(reportRows, reportSummary, period);
    salesReport.customerProductReport = buildCustomerProductReportResult_(
      productReportRows,
      productPeriod
    );
    salesReport.customerByProductReport = buildCustomerByProductReportResult_(
      customerByProductReport,
      period
    );
    return salesReport;
  });
}

/**
 * Diem vao chay tay, chi dong bo tab "Bao cao ban hang".
 */
function syncSalesCustomerReport() {
  return withCustomerReportLock_(function() {
    const token = requireCustomerReportToken_();
    const period = getCustomerReportAllTimeRange_(new Date());
    const invoices = fetchCustomerReportPages_('invoices', token, { status: 1 });
    const returns = fetchCustomerReportPages_('returns', token, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    });
    const customers = fetchCustomerReportPages_('customers', token, {
      includeCustomerGroup: true
    });
    const rows = aggregateCustomerReport_(invoices, returns, period, customers);
    const summary = summarizeCustomerReport_(rows);
    writeCustomerReportSheet_(rows, period);
    PropertiesService.getScriptProperties().setProperty(
      CUSTOMER_REPORT_LAST_SYNC_PROPERTY, customerReportToday_()
    );
    return buildCustomerSalesReportResult_(rows, summary, period);
  });
}

/**
 * Diem vao chay tay, chi dong bo tab "Hang ban theo khach".
 */
function syncCustomerProductReport() {
  return withCustomerReportLock_(function() {
    const token = requireCustomerReportToken_();
    const period = getCustomerReportRollingRange_(new Date(), CUSTOMER_PRODUCT_REPORT_DAYS);
    const invoices = fetchCustomerReportPages_('invoices', token, { status: 1 });
    const rows = aggregateCustomerProductReport_(invoices, period);
    writeCustomerProductReportSheet_(rows, period);
    PropertiesService.getScriptProperties().setProperties({
      [CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: customerReportToday_(),
      [CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION
    });
    return buildCustomerProductReportResult_(rows, period);
  });
}

/**
 * Diem vao chay tay, chi dong bo tab "Khach theo hang hoa".
 */
function syncCustomerByProductReport() {
  return withCustomerReportLock_(function() {
    const token = requireCustomerReportToken_();
    const period = getCustomerReportAllTimeRange_(new Date());
    const invoices = fetchCustomerReportPages_('invoices', token, { status: 1 });
    const returns = fetchCustomerReportPages_('returns', token, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    });
    const customers = fetchCustomerReportPages_('customers', token, {
      includeCustomerGroup: true
    });
    const metadataLookup = buildCustomerByProductMetadataLookup_();
    const report = aggregateCustomerByProductReport_(
      invoices,
      returns,
      period,
      customers,
      metadataLookup
    );
    writeCustomerByProductReportSheet_(report.rows, period);
    PropertiesService.getScriptProperties().setProperties({
      [CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: customerReportToday_(),
      [CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION
    });
    return buildCustomerByProductReportResult_(report, period);
  });
}

function buildCustomerSalesReportResult_(reportRows, reportSummary, period) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_REPORT,
    customerCount: reportRows.length,
    transactionCount: reportSummary.transactionCount,
    totalRevenue: reportSummary.revenue,
    totalReturns: reportSummary.returnValue,
    netRevenue: reportSummary.netRevenue,
    fromDate: period.startLabel,
    toDate: period.endLabel
  };
}

function buildCustomerProductReportResult_(productReportRows, productPeriod) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT,
    rowCount: productReportRows.length,
    purchasedQuantity: productReportRows.reduce(function(total, row) {
      return total + customerReportNumber_(row.purchasedQuantity);
    }, 0),
    fromDate: productPeriod.startLabel,
    toDate: productPeriod.endLabel,
    days: CUSTOMER_PRODUCT_REPORT_DAYS
  };
}

function buildCustomerByProductReportResult_(report, period) {
  return {
    sheetName: CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT,
    rowCount: report.rows.length,
    productCount: report.productCount,
    customerProductCount: report.customerProductCount,
    purchasedQuantity: report.purchasedQuantity,
    revenue: report.revenue,
    returnedQuantity: report.returnedQuantity,
    returnValue: report.returnValue,
    netRevenue: report.netRevenue,
    fromDate: period.startLabel,
    toDate: period.endLabel
  };
}

function customerReportToday_() {
  return Utilities.formatDate(new Date(), CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
}

function withCustomerReportLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Bao cao khach hang dang duoc dong bo boi mot tien trinh khac.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function requireCustomerReportToken_() {
  const token = getKiotVietToken();
  if (!token) throw new Error('Khong lay duoc KiotViet token de dong bo Bao cao khach hang.');
  return token;
}

/**
 * Duoc goi boi trigger hang doi 1 phut dang co san. Moi bao cao chay sau gio
 * cua rieng no neu chua thanh cong trong ngay; loi se duoc thu lai o phut sau.
 */
function syncCustomerReportIfDue_(now) {
  now = now || new Date();
  const today = Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'H'));
  const minute = Number(Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'm'));
  const minuteOfDay = hour * 60 + minute;
  const properties = PropertiesService.getScriptProperties();
  let successCount = 0;

  CUSTOMER_REPORT_CATCH_UP_DEFINITIONS.forEach(function(definition) {
    if (minuteOfDay < definition.minuteOfDay) return;

    const syncedToday = properties.getProperty(definition.lastSyncProperty) === today;
    const currentSchema = !definition.schemaProperty ||
      properties.getProperty(definition.schemaProperty) === definition.schemaVersion;
    if (syncedToday && currentSchema) return;

    try {
      definition.handler();
      successCount++;
    } catch (error) {
      Logger.log(
        'Loi dong bo ' + definition.lastSyncProperty + ', se thu lai o phut sau: ' +
        error.toString()
      );
    }
  });

  return successCount;
}

/**
 * Chay mot lan de lam moi ngay ca ba bao cao va bat ba lich doc lap luc
 * 06:00, 06:30 va 07:00.
 */
function setupCustomerReport() {
  const result = syncCustomerReport();
  setupCustomerReportDailyTrigger();
  return result;
}

/**
 * Tao ba time trigger cho Bao cao khach hang luc 06:00, 06:30 va 07:00.
 * Apps Script co the chay lech khoang +/- 15 phut quanh moi moc gio.
 */
function setupCustomerReportDailyTrigger() {
  removeCustomerReportDailyTrigger_();

  CUSTOMER_REPORT_DAILY_SCHEDULES.forEach(function(schedule) {
    ScriptApp.newTrigger(schedule.handler)
      .timeBased()
      .atHour(schedule.hour)
      .nearMinute(schedule.minute)
      .everyDays(1)
      .inTimezone(CUSTOMER_REPORT_TIME_ZONE)
      .create();
  });

  Logger.log(
    'Da bat lich Bao cao khach hang luc gan 06:00, 06:30 va 07:00 (Asia/Ho_Chi_Minh).'
  );
}

/**
 * Tat lich dong bo Bao cao khach hang.
 */
function removeCustomerReportDailyTrigger() {
  const removedCount = removeCustomerReportDailyTrigger_();
  Logger.log('Da xoa %s trigger Bao cao khach hang.', removedCount);
  return removedCount;
}

function removeCustomerReportDailyTrigger_() {
  let removedCount = 0;
  const reportHandlers = {};
  reportHandlers[CUSTOMER_REPORT_LEGACY_TRIGGER_HANDLER] = true;
  CUSTOMER_REPORT_DAILY_SCHEDULES.forEach(function(schedule) {
    reportHandlers[schedule.handler] = true;
  });
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (reportHandlers[trigger.getHandlerFunction()]) {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });
  return removedCount;
}

/**
 * Khoang thoi gian toan bo (tu truoc den nay) den het ngay hien tai theo gio Viet Nam.
 * Khong gioi han moc bat dau de tong hop du lieu ban hang toan thoi gian.
 */
function getCustomerReportAllTimeRange_(now) {
  const current = now || new Date();
  const todayText = Utilities.formatDate(current, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const tomorrow = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowText = Utilities.formatDate(tomorrow, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');

  return {
    start: new Date(0),
    endExclusive: new Date(tomorrowText + 'T00:00:00+07:00'),
    startQuery: '',
    endQuery: todayText + 'T23:59:59',
    startLabel: 'Từ trước đến nay',
    endLabel: todayText.substring(8, 10) + '/' + todayText.substring(5, 7) + '/' + todayText.substring(0, 4)
  };
}

/**
 * Khoang thoi gian tu dau thang den het ngay hien tai theo gio Viet Nam.
 * (Khong con duoc syncCustomerReport() su dung truc tiep, giu lai phong khi can bao cao theo thang.)
 */
function getCustomerReportMonthRange_(now) {
  const current = now || new Date();
  const todayText = Utilities.formatDate(current, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const yearMonth = todayText.substring(0, 7);
  const tomorrow = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowText = Utilities.formatDate(tomorrow, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const startQuery = yearMonth + '-01T00:00:00';
  const endExclusiveQuery = tomorrowText + 'T00:00:00';

  return {
    start: new Date(startQuery + '+07:00'),
    endExclusive: new Date(endExclusiveQuery + '+07:00'),
    startQuery: startQuery,
    endQuery: todayText + 'T23:59:59',
    startLabel: '01/' + todayText.substring(5, 7) + '/' + todayText.substring(0, 4),
    endLabel: todayText.substring(8, 10) + '/' + todayText.substring(5, 7) + '/' + todayText.substring(0, 4)
  };
}

/**
 * Khoang thoi gian tu 00:00 cua ngay cach day `days` ngay den het hom nay.
 * Cach tinh giong bo loc "30 ngay qua" cua KiotViet (vi du 30/06 - 30/07).
 */
function getCustomerReportRollingRange_(now, days) {
  const current = now || new Date();
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const start = new Date(current.getTime() - days * millisecondsPerDay);
  const tomorrow = new Date(current.getTime() + millisecondsPerDay);
  const startText = Utilities.formatDate(start, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const todayText = Utilities.formatDate(current, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const tomorrowText = Utilities.formatDate(tomorrow, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');

  return {
    start: new Date(startText + 'T00:00:00+07:00'),
    endExclusive: new Date(tomorrowText + 'T00:00:00+07:00'),
    startQuery: startText + 'T00:00:00',
    endQuery: todayText + 'T23:59:59',
    startLabel: customerReportDateLabel_(startText),
    endLabel: customerReportDateLabel_(todayText)
  };
}

function customerReportDateLabel_(dateText) {
  return dateText.substring(8, 10) + '/' + dateText.substring(5, 7) + '/' + dateText.substring(0, 4);
}

function fetchCustomerReportPages_(endpoint, token, query) {
  let allItems = [];
  let currentItem = 0;
  let total = 0;

  do {
    const params = Object.assign({}, query || {}, {
      pageSize: CUSTOMER_REPORT_PAGE_SIZE,
      currentItem: currentItem
    });
    const queryString = Object.keys(params)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
      .join('&');
    const url = 'https://public.kiotapi.com/' + endpoint + '?' + queryString;
    const result = fetchCustomerReportJsonWithRetry_(url, token, endpoint);
    const pageItems = Array.isArray(result.data) ? result.data : [];

    allItems = allItems.concat(pageItems);
    total = Number(result.total) || 0;
    currentItem += CUSTOMER_REPORT_PAGE_SIZE;

    if (pageItems.length === 0) break;
    if (currentItem < total) Utilities.sleep(150);
  } while (currentItem < total);

  return allItems;
}

function fetchCustomerReportJsonWithRetry_(url, token, endpoint) {
  const maxAttempts = 5;
  let lastError = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    attemptsMade = attempt;
    try {
      const response = UrlFetchApp.fetch(url, {
        headers: {
          Authorization: 'Bearer ' + token,
          Retailer: CONFIG.RETAILER
        },
        muteHttpExceptions: true,
        timeoutSeconds: 45
      });
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      if (responseCode >= 200 && responseCode < 300) {
        const result = JSON.parse(responseText);
        if (!Array.isArray(result.data)) {
          throw new Error('KiotViet khong tra ve mang data cho endpoint ' + endpoint + '.');
        }
        return result;
      }

      lastError = new Error('HTTP ' + responseCode + ' tu endpoint ' + endpoint + '.');
      if (responseCode !== 429 && responseCode < 500) break;
    } catch (error) {
      lastError = error;
    }

    if (attempt < maxAttempts) {
      Utilities.sleep(1000 * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(
    'Khong the lay du lieu ' + endpoint + ' sau ' + attemptsMade + ' lan thu: ' +
    (lastError ? lastError.message : 'Khong ro nguyen nhan')
  );
}

function aggregateCustomerReport_(invoices, returns, period, customerProfiles) {
  const customers = {};
  const profileLookup = buildCustomerReportProfileLookup_(customerProfiles);

  (invoices || []).forEach(invoice => {
    if (Number(invoice.status) !== 1) return;
    if (!isCustomerReportDateInRange_(invoice.purchaseDate, period)) return;

    const customer = getOrCreateCustomerReportCustomer_(customers, invoice, profileLookup);
    const discount = customerReportInvoiceDiscount_(invoice);
    const revenue = customerReportNumber_(invoice.total);
    const grossTotal = revenue + discount;

    customer.saleOrderCount++;
    customer.grossTotal += grossTotal;
    customer.invoiceDiscount += discount;
    customer.revenue += revenue;
    customer.transactions.push({
      transactionCode: customerReportSafeText_(invoice.code || invoice.invoiceCode || ''),
      transactionTime: customerReportDateValue_(invoice.purchaseDate),
      transactionTimeMs: customerReportDateTime_(invoice.purchaseDate),
      employeeName: customerReportSafeText_(invoice.soldByName || ''),
      transactionQuantity: sumCustomerReportDetailQuantity_(invoice.invoiceDetails),
      transactionGrossTotal: grossTotal,
      transactionDiscount: discount,
      transactionRevenue: revenue
    });
  });

  (returns || []).forEach(returnItem => {
    if (Number(returnItem.status) !== 1) return;
    if (!isCustomerReportDateInRange_(returnItem.returnDate, period)) return;

    const customer = getOrCreateCustomerReportCustomer_(customers, returnItem, profileLookup);
    const returnValue = customerReportNumber_(returnItem.returnTotal);
    const returnDiscount = customerReportNumber_(returnItem.returnDiscount);

    customer.returnOrderCount++;
    customer.returnValue += returnValue;
    customer.transactions.push({
      transactionCode: customerReportSafeText_(returnItem.code || returnItem.returnCode || ''),
      transactionTime: customerReportDateValue_(returnItem.returnDate),
      transactionTimeMs: customerReportDateTime_(returnItem.returnDate),
      employeeName: customerReportSafeText_(returnItem.soldByName || ''),
      transactionQuantity: -sumCustomerReportDetailQuantity_(returnItem.returnDetails),
      transactionGrossTotal: -(returnValue + returnDiscount),
      transactionDiscount: -returnDiscount,
      transactionRevenue: -returnValue
    });
  });

  return Object.keys(customers)
    .map(key => {
      const customer = customers[key];
      customer.netRevenue = customer.revenue - customer.returnValue;
      customer.transactions.sort((left, right) => {
        if (right.transactionTimeMs !== left.transactionTimeMs) {
          return right.transactionTimeMs - left.transactionTimeMs;
        }
        return String(left.transactionCode).localeCompare(String(right.transactionCode));
      });
      return customer;
    })
    .sort((left, right) => {
      if (right.netRevenue !== left.netRevenue) return right.netRevenue - left.netRevenue;
      if (right.revenue !== left.revenue) return right.revenue - left.revenue;
      return String(left.customerCode).localeCompare(String(right.customerCode));
    });
}

function buildCustomerReportProfileLookup_(customerProfiles) {
  const lookup = { byId: {}, byCode: {} };

  (customerProfiles || []).forEach(profile => {
    const customerId = customerReportText_(profile.id || profile.customerId);
    const customerCode = customerReportText_(profile.code || profile.customerCode).toLocaleLowerCase();
    if (customerId) lookup.byId[customerId] = profile;
    if (customerCode) lookup.byCode[customerCode] = profile;
  });

  return lookup;
}

function getOrCreateCustomerReportCustomer_(customers, item, profileLookup) {
  const customerId = customerReportText_(item.customerId);
  const itemCustomerCode = customerReportText_(item.customerCode);
  const itemCustomerName = customerReportText_(item.customerName) || 'Khách lẻ';
  const key = customerId
    ? 'id:' + customerId
    : (itemCustomerCode ? 'code:' + itemCustomerCode.toLocaleLowerCase() : 'name:' + itemCustomerName.toLocaleLowerCase());
  const profile = (customerId && profileLookup.byId[customerId]) ||
    (itemCustomerCode && profileLookup.byCode[itemCustomerCode.toLocaleLowerCase()]) || {};
  const profileCode = customerReportText_(profile.code || profile.customerCode);
  const profileName = customerReportText_(profile.name || profile.customerName);

  if (!customers[key]) {
    customers[key] = {
      customerCode: customerReportSafeText_(itemCustomerCode || profileCode),
      customerName: customerReportSafeText_(itemCustomerName !== 'Khách lẻ' ? itemCustomerName : (profileName || itemCustomerName)),
      contactNumber: customerReportSafeText_(profile.contactNumber || profile.customerContactNumber || item.contactNumber || ''),
      customerGroup: customerReportSafeText_(customerReportCustomerGroups_(profile)),
      saleOrderCount: 0,
      grossTotal: 0,
      invoiceDiscount: 0,
      revenue: 0,
      returnOrderCount: 0,
      returnValue: 0,
      netRevenue: 0,
      transactions: []
    };
  } else {
    if (!customers[key].customerCode && (itemCustomerCode || profileCode)) {
      customers[key].customerCode = customerReportSafeText_(itemCustomerCode || profileCode);
    }
    if (customers[key].customerName === 'Khách lẻ' && (profileName || itemCustomerName !== 'Khách lẻ')) {
      customers[key].customerName = customerReportSafeText_(profileName || itemCustomerName);
    }
    if (!customers[key].contactNumber && profile.contactNumber) {
      customers[key].contactNumber = customerReportSafeText_(profile.contactNumber);
    }
    if (!customers[key].customerGroup) {
      customers[key].customerGroup = customerReportSafeText_(customerReportCustomerGroups_(profile));
    }
  }

  return customers[key];
}

function customerReportCustomerGroups_(profile) {
  const direct = profile.groups || profile.groupName || profile.customerGroups;
  if (Array.isArray(direct)) {
    return direct.map(group => {
      if (typeof group === 'string') return group;
      return customerReportText_(group && (group.name || group.groupName));
    }).filter(Boolean).join(', ');
  }
  if (direct !== null && direct !== undefined && direct !== '') return String(direct);

  return (Array.isArray(profile.customerGroupDetails) ? profile.customerGroupDetails : [])
    .map(detail => customerReportText_(detail && (detail.groupName || detail.name)))
    .filter(Boolean)
    .join(', ');
}

function customerReportInvoiceDiscount_(invoice) {
  if (Number(invoice.pricingMode) === 1 && invoice.discountAfterTax !== null && invoice.discountAfterTax !== undefined) {
    return customerReportNumber_(invoice.discountAfterTax);
  }
  return customerReportNumber_(invoice.discount);
}

function customerReportText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function customerReportSafeText_(value) {
  const text = customerReportText_(value);
  return text.charAt(0) === '=' ? "'" + text : text;
}

function customerReportDateTime_(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return isFinite(time) ? time : 0;
}

function customerReportDateValue_(value) {
  const time = customerReportDateTime_(value);
  return time ? new Date(time) : '';
}

function summarizeCustomerReport_(reportRows) {
  return (reportRows || []).reduce((summary, customer) => {
    summary.transactionCount += (customer.transactions || []).length;
    summary.revenue += customer.revenue;
    summary.returnValue += customer.returnValue;
    summary.netRevenue += customer.netRevenue;
    return summary;
  }, { transactionCount: 0, revenue: 0, returnValue: 0, netRevenue: 0 });
}

function aggregateCustomerProductReport_(invoices, periodOrReturns, optionalPeriod) {
  // optionalPeriod giu tuong thich voi loi goi cu (invoices, returns, period).
  const period = optionalPeriod || periodOrReturns;
  const rows = [];

  (invoices || []).forEach(invoice => {
    const status = customerProductReportValue_(invoice, ['Status', 'status'], 0);
    const purchaseDate = customerProductReportValue_(
      invoice,
      ['PurchaseDate', 'purchaseDate'],
      ''
    );
    if (Number(status) !== 1 || !isCustomerReportDateInRange_(purchaseDate, period)) return;

    const details = customerProductReportValue_(
      invoice,
      ['InvoiceDetails', 'invoiceDetails'],
      []
    );
    (Array.isArray(details) ? details : []).forEach(detail => {
      rows.push(buildCustomerProductReportRow_(invoice, detail, purchaseDate));
    });
  });

  return rows.sort(compareCustomerProductReportRows_);
}

/**
 * Tong hop bao cao "Khach theo hang hoa" theo dung 3 tang cua file xuat
 * KiotViet: san pham -> khach hang -> chi tiet hoa don.
 */
function aggregateCustomerByProductReport_(
  invoices,
  returns,
  period,
  customerProfiles,
  productMetadataLookup
) {
  const products = {};
  const profileLookup = buildCustomerReportProfileLookup_(customerProfiles);
  const metadataLookup = productMetadataLookup || {};

  (invoices || []).forEach(invoice => {
    const status = customerProductReportValue_(invoice, ['Status', 'status'], 0);
    const purchaseDate = customerProductReportValue_(
      invoice,
      ['PurchaseDate', 'purchaseDate'],
      ''
    );
    if (Number(status) !== 1 || !isCustomerReportDateInRange_(purchaseDate, period)) return;

    const customerIdentity = customerByProductCustomerIdentity_(invoice, profileLookup);
    const details = customerProductReportValue_(
      invoice,
      ['InvoiceDetails', 'invoiceDetails'],
      []
    );
    (Array.isArray(details) ? details : []).forEach(detail => {
      const product = getOrCreateCustomerByProduct_(products, detail, metadataLookup);
      const customer = getOrCreateCustomerByProductCustomer_(product, customerIdentity);
      const quantity = customerByProductQuantity_(detail);
      const price = customerByProductPrice_(detail, invoice);
      const amount = customerByProductAmount_(detail, quantity, price);

      product.purchasedQuantity += quantity;
      product.revenue += amount;
      customer.purchasedQuantity += quantity;
      customer.revenue += amount;
      customer.sales.push({
        invoiceCode: customerReportSafeText_(customerProductReportValue_(
          invoice,
          ['InvoiceCode', 'invoiceCode', 'Code', 'code'],
          ''
        )),
        branchName: customerReportSafeText_(customerProductReportValue_(
          invoice,
          ['BranchName', 'branchName'],
          ''
        )),
        purchaseTime: customerReportDateValue_(purchaseDate),
        purchaseTimeMs: customerReportDateTime_(purchaseDate),
        quantity: quantity,
        price: price,
        amount: amount
      });
    });
  });

  (returns || []).forEach(returnItem => {
    const status = customerProductReportValue_(returnItem, ['Status', 'status'], 0);
    const returnDate = customerProductReportValue_(
      returnItem,
      ['ReturnDate', 'returnDate'],
      ''
    );
    if (Number(status) !== 1 || !isCustomerReportDateInRange_(returnDate, period)) return;

    const customerIdentity = customerByProductCustomerIdentity_(returnItem, profileLookup);
    const details = customerProductReportValue_(
      returnItem,
      ['ReturnDetails', 'returnDetails'],
      []
    );
    (Array.isArray(details) ? details : []).forEach(detail => {
      const product = getOrCreateCustomerByProduct_(products, detail, metadataLookup);
      const customer = getOrCreateCustomerByProductCustomer_(product, customerIdentity);
      const quantity = Math.abs(customerByProductQuantity_(detail));
      const price = customerByProductPrice_(detail, returnItem);
      const amount = Math.abs(customerByProductAmount_(detail, quantity, price));

      product.returnedQuantity += quantity;
      product.returnValue += amount;
      customer.returnedQuantity += quantity;
      customer.returnValue += amount;
    });
  });

  const productList = Object.keys(products).map(key => {
    const product = products[key];
    product.netRevenue = product.revenue - product.returnValue;
    product.customerList = Object.keys(product.customers).map(customerKey => {
      const customer = product.customers[customerKey];
      customer.netRevenue = customer.revenue - customer.returnValue;
      customer.sales.sort((left, right) => {
        if (right.purchaseTimeMs !== left.purchaseTimeMs) {
          return right.purchaseTimeMs - left.purchaseTimeMs;
        }
        return String(left.invoiceCode).localeCompare(String(right.invoiceCode));
      });
      return customer;
    }).sort((left, right) => {
      if (right.netRevenue !== left.netRevenue) return right.netRevenue - left.netRevenue;
      if (right.revenue !== left.revenue) return right.revenue - left.revenue;
      return String(left.customerCode).localeCompare(String(right.customerCode));
    });
    product.customerCount = product.customerList.filter(customer => {
      return customer.purchasedQuantity !== 0;
    }).length;
    return product;
  }).sort((left, right) => {
    if (right.netRevenue !== left.netRevenue) return right.netRevenue - left.netRevenue;
    if (right.revenue !== left.revenue) return right.revenue - left.revenue;
    return String(left.productCode).localeCompare(String(right.productCode));
  });

  const rows = [];
  let customerProductCount = 0;
  let purchasedQuantity = 0;
  let revenue = 0;
  let returnedQuantity = 0;
  let returnValue = 0;

  productList.forEach(product => {
    purchasedQuantity += product.purchasedQuantity;
    revenue += product.revenue;
    returnedQuantity += product.returnedQuantity;
    returnValue += product.returnValue;

    product.customerList.forEach(customer => {
      customerProductCount++;
      const sales = customer.sales.length > 0 ? customer.sales : [{
        invoiceCode: '',
        branchName: '',
        purchaseTime: '',
        purchaseTimeMs: 0,
        quantity: 0,
        price: 0,
        amount: 0
      }];
      sales.forEach(sale => {
        rows.push([
          product.categoryName,
          product.productCode,
          product.productName,
          product.tradeMarkName,
          product.unit,
          product.customerCount,
          product.purchasedQuantity,
          product.revenue,
          product.returnedQuantity,
          product.returnValue,
          product.netRevenue,
          customer.customerCode,
          customer.customerName,
          customer.contactNumber,
          customer.purchasedQuantity,
          customer.revenue,
          customer.returnedQuantity,
          customer.returnValue,
          customer.netRevenue,
          sale.invoiceCode,
          sale.branchName,
          sale.purchaseTime,
          sale.quantity,
          sale.price,
          sale.amount
        ]);
      });
    });
  });

  return {
    rows: rows,
    productCount: productList.length,
    customerProductCount: customerProductCount,
    purchasedQuantity: purchasedQuantity,
    revenue: revenue,
    returnedQuantity: returnedQuantity,
    returnValue: returnValue,
    netRevenue: revenue - returnValue
  };
}

function buildCustomerByProductMetadataLookup_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(CONFIG.SHEET_PRODUCTS);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return {};

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value || '').trim());
  const codeIndex = headers.indexOf('Mã hàng');
  if (codeIndex === -1) return {};

  const nameIndex = headers.indexOf('Tên hàng');
  const categoryIndex = headers.indexOf('Nhóm hàng');
  const tradeMarkIndex = headers.indexOf('Thương hiệu');
  const unitIndex = headers.indexOf('Đơn vị tính');
  const lookup = {};

  values.slice(1).forEach(row => {
    const code = customerReportText_(row[codeIndex]);
    if (!code) return;
    lookup[code.toLocaleLowerCase()] = {
      productCode: customerReportSafeText_(code),
      productName: nameIndex === -1 ? '' : customerReportSafeText_(row[nameIndex]),
      categoryName: categoryIndex === -1 ? '' : customerReportSafeText_(row[categoryIndex]),
      tradeMarkName: tradeMarkIndex === -1 ? '' : customerReportSafeText_(row[tradeMarkIndex]),
      unit: unitIndex === -1 ? '' : customerReportSafeText_(row[unitIndex])
    };
  });
  return lookup;
}

function getOrCreateCustomerByProduct_(products, detail, metadataLookup) {
  const productId = customerReportText_(customerProductReportValue_(
    detail,
    ['ProductId', 'productId'],
    ''
  ));
  const productCode = customerReportText_(customerProductReportValue_(
    detail,
    ['ProductCode', 'productCode', 'Code', 'code'],
    ''
  ));
  const productName = customerReportText_(customerProductReportValue_(
    detail,
    ['ProductName', 'productName', 'Name', 'name'],
    ''
  ));
  const key = productId
    ? 'id:' + productId
    : (productCode
      ? 'code:' + productCode.toLocaleLowerCase()
      : 'name:' + productName.toLocaleLowerCase());
  const metadata = metadataLookup[productCode.toLocaleLowerCase()] || {};

  if (!products[key]) {
    products[key] = {
      productCode: customerReportSafeText_(productCode || metadata.productCode || ''),
      productName: customerReportSafeText_(metadata.productName || productName),
      categoryName: customerReportSafeText_(metadata.categoryName || ''),
      tradeMarkName: customerReportSafeText_(metadata.tradeMarkName || ''),
      unit: customerReportSafeText_(metadata.unit || ''),
      purchasedQuantity: 0,
      revenue: 0,
      returnedQuantity: 0,
      returnValue: 0,
      netRevenue: 0,
      customerCount: 0,
      customers: {}
    };
  }
  return products[key];
}

function customerByProductCustomerIdentity_(item, profileLookup) {
  const customerId = customerReportText_(customerProductReportValue_(
    item,
    ['CustomerId', 'customerId'],
    ''
  ));
  const itemCode = customerReportText_(customerProductReportValue_(
    item,
    ['CustomerCode', 'customerCode'],
    ''
  ));
  const itemName = customerReportText_(customerProductReportValue_(
    item,
    ['CustomerName', 'customerName'],
    'Khách lẻ'
  )) || 'Khách lẻ';
  const profile = (customerId && profileLookup.byId[customerId]) ||
    (itemCode && profileLookup.byCode[itemCode.toLocaleLowerCase()]) || {};
  const profileCode = customerReportText_(profile.code || profile.customerCode);
  const profileName = customerReportText_(profile.name || profile.customerName);
  const code = itemCode || profileCode;
  const name = itemName !== 'Khách lẻ' ? itemName : (profileName || itemName);

  return {
    key: customerId
      ? 'id:' + customerId
      : (code ? 'code:' + code.toLocaleLowerCase() : 'name:' + name.toLocaleLowerCase()),
    customerCode: customerReportSafeText_(code),
    customerName: customerReportSafeText_(name),
    contactNumber: customerReportSafeText_(
      profile.contactNumber || profile.customerContactNumber ||
      customerProductReportValue_(item, ['ContactNumber', 'contactNumber'], '')
    )
  };
}

function getOrCreateCustomerByProductCustomer_(product, identity) {
  if (!product.customers[identity.key]) {
    product.customers[identity.key] = {
      customerCode: identity.customerCode,
      customerName: identity.customerName,
      contactNumber: identity.contactNumber,
      purchasedQuantity: 0,
      revenue: 0,
      returnedQuantity: 0,
      returnValue: 0,
      netRevenue: 0,
      sales: []
    };
  } else if (!product.customers[identity.key].contactNumber && identity.contactNumber) {
    product.customers[identity.key].contactNumber = identity.contactNumber;
  }
  return product.customers[identity.key];
}

function customerByProductQuantity_(detail) {
  return customerReportNumber_(customerProductReportValue_(
    detail,
    ['Quantity', 'quantity'],
    0
  ));
}

function customerByProductPrice_(detail, parent) {
  const taxMode = Number(customerProductReportValue_(
    parent,
    ['PricingMode', 'pricingMode'],
    0
  )) === 1;
  const priceKeys = taxMode
    ? ['PriceAfterTax', 'priceAfterTax', 'Price', 'price']
    : ['Price', 'price', 'PriceAfterTax', 'priceAfterTax'];
  return customerReportNumber_(customerProductReportValue_(detail, priceKeys, 0));
}

function customerByProductAmount_(detail, quantity, price) {
  const subTotal = customerProductReportValue_(
    detail,
    ['SubTotal', 'subTotal', 'SubTotalAfterTax', 'subTotalAfterTax'],
    null
  );
  if (subTotal !== null && subTotal !== undefined && subTotal !== '') {
    return customerReportNumber_(subTotal);
  }
  const discount = customerReportNumber_(customerProductReportValue_(
    detail,
    [
      'AllocationDiscount', 'allocationDiscount',
      'DiscountAfterTax', 'discountAfterTax',
      'Discount', 'discount'
    ],
    0
  ));
  return quantity * price - discount;
}

function buildCustomerProductReportRow_(invoice, detail, purchaseDate) {
  const customerName = customerProductReportValue_(
    invoice,
    ['CustomerName', 'customerName'],
    'Khách lẻ'
  );
  return {
    customerName: customerReportSafeText_(customerName || 'Khách lẻ'),
    productCode: customerReportSafeText_(
      customerProductReportValue_(detail, ['ProductCode', 'productCode'], '')
    ),
    productName: customerReportSafeText_(
      customerProductReportValue_(detail, ['ProductName', 'productName'], '')
    ),
    purchasedQuantity: customerReportNumber_(
      customerProductReportValue_(detail, ['Quantity', 'quantity'], 0)
    ),
    purchaseTime: customerReportDateValue_(purchaseDate),
    purchaseTimeMs: customerReportDateTime_(purchaseDate),
    invoiceId: customerReportSafeText_(
      customerProductReportValue_(invoice, ['InvoiceId', 'invoiceId', 'Id', 'id'], '')
    ),
    invoiceCode: customerReportSafeText_(
      customerProductReportValue_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code'], '')
    )
  };
}

function customerProductReportValue_(source, keys, defaultValue) {
  const object = source || {};
  for (let i = 0; i < keys.length; i++) {
    if (Object.prototype.hasOwnProperty.call(object, keys[i])) return object[keys[i]];
  }
  return defaultValue;
}

function compareCustomerProductReportRows_(left, right) {
  if (right.purchaseTimeMs !== left.purchaseTimeMs) {
    return right.purchaseTimeMs - left.purchaseTimeMs;
  }
  const invoiceCompare = String(left.invoiceCode).localeCompare(String(right.invoiceCode));
  if (invoiceCompare !== 0) return invoiceCompare;
  return String(left.productCode).localeCompare(String(right.productCode));
}

function sumCustomerReportDetailQuantity_(details) {
  return (Array.isArray(details) ? details : []).reduce((total, detail) => {
    return total + customerReportNumber_(detail && (detail.quantity !== undefined ? detail.quantity : detail.Quantity));
  }, 0);
}

function isCustomerReportDateInRange_(value, period) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return isFinite(time) && time >= period.start.getTime() && time < period.endExclusive.getTime();
}

function customerReportNumber_(value) {
  const numberValue = Number(value);
  return isFinite(numberValue) ? numberValue : 0;
}

function writeCustomerReportSheet_(reportRows, period) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_CUSTOMER_REPORT);
  if (!sheet) {
    sheet = spreadsheet.getSheetByName('Báo cáo khách hàng');
    if (sheet) sheet.setName(CONFIG.SHEET_CUSTOMER_REPORT);
  }
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_CUSTOMER_REPORT);

  const values = buildCustomerReportValues_(reportRows);
  const dataRowCount = values.length - 1;
  const previousLastRow = sheet.getLastRow();

  sheet.getRange(1, 1, values.length, CUSTOMER_REPORT_HEADERS.length).setValues(values);
  if (previousLastRow > values.length) {
    sheet.getRange(
      values.length + 1,
      1,
      previousLastRow - values.length,
      CUSTOMER_REPORT_HEADERS.length
    ).clearContent().clearNote();
  }
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Bán hàng\n' +
    'Thời gian: Toàn thời gian (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Chi tiết: Mỗi hóa đơn hoặc phiếu trả hàng là một dòng giao dịch.\n' +
    'Tự động cập nhật hàng ngày lúc gần 06:00.'
  );

  if (dataRowCount > 0) {
    sheet.getRange(2, 1, dataRowCount, 4).setNumberFormat('@');
    sheet.getRange(2, 5, dataRowCount, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 6, dataRowCount, 3).setNumberFormat('#,##0');
    sheet.getRange(2, 9, dataRowCount, 1).setNumberFormat('#,##0');
    sheet.getRange(2, 10, dataRowCount, 2).setNumberFormat('#,##0');
    sheet.getRange(2, 12, dataRowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 13, dataRowCount, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(2, 14, dataRowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 15, dataRowCount, 1).setNumberFormat('#,##0.##');
    sheet.getRange(2, 16, dataRowCount, 3).setNumberFormat('#,##0');
  }

  if (dataRowCount > 0) {
    sheet.getRange(2, 1, dataRowCount, CUSTOMER_REPORT_HEADERS.length).setFontFamily('Open Sans');
  }

  sheet.getRange(1, 1, 1, CUSTOMER_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#4F81BD')
    .setFontFamily('Open Sans')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle')
    .setWrap(true);

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  if (dataRowCount > 0) {
    sheet.getRange(1, 1, values.length, CUSTOMER_REPORT_HEADERS.length).createFilter();
  }

  sheet.setFrozenRows(1);
  sheet.setTabColor('#0D6EFD');
  sheet.autoResizeColumns(1, CUSTOMER_REPORT_HEADERS.length);
  sheet.setColumnWidth(1, 115);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 125);
  sheet.setColumnWidth(4, 165);
  sheet.setColumnWidths(5, 7, 115);
  sheet.setColumnWidth(12, 125);
  sheet.setColumnWidth(13, 175);
  sheet.setColumnWidth(14, 130);
  sheet.setColumnWidth(15, 155);
  sheet.setColumnWidths(16, 3, 175);
  sheet.setRowHeight(1, 42);
}

function buildCustomerReportValues_(reportRows) {
  const values = [CUSTOMER_REPORT_HEADERS];

  (reportRows || []).forEach(customer => {
    (customer.transactions || []).forEach(transaction => {
      values.push([
        customer.customerCode,
        customer.customerName,
        customer.contactNumber,
        customer.customerGroup,
        customer.saleOrderCount,
        customer.grossTotal,
        customer.invoiceDiscount,
        customer.revenue,
        customer.returnOrderCount,
        customer.returnValue,
        customer.netRevenue,
        transaction.transactionCode,
        transaction.transactionTime,
        transaction.employeeName,
        transaction.transactionQuantity,
        transaction.transactionGrossTotal,
        transaction.transactionDiscount,
        transaction.transactionRevenue
      ]);
    });
  });

  return values;
}

function writeCustomerProductReportSheet_(reportRows, period) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT);

  const values = [CUSTOMER_PRODUCT_REPORT_HEADERS].concat(reportRows.map(row => [
    row.customerName,
    row.productCode,
    row.productName,
    row.purchasedQuantity,
    row.purchaseTime
  ]));

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  const previousLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, values.length, CUSTOMER_PRODUCT_REPORT_HEADERS.length).setValues(values);
  if (previousLastRow > values.length) {
    sheet.getRange(
      values.length + 1,
      1,
      previousLastRow - values.length,
      CUSTOMER_PRODUCT_REPORT_HEADERS.length
    ).clearContent().clearNote();
  }
  if (reportRows.length > 0) {
    sheet.getRange(2, 1, reportRows.length, CUSTOMER_PRODUCT_REPORT_HEADERS.length).setFontFamily('Open Sans');
  }
  sheet.getRange(1, 1, 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#00A6A6')
    .setFontFamily('Open Sans')
    .setHorizontalAlignment('center');
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Hàng bán theo khách\n' +
    'Thời gian: 90 ngày qua (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Chi tiết: Mỗi mặt hàng trong hóa đơn hoàn thành là một dòng.\n' +
    'Tự động cập nhật từ webhook KiotViet trong khoảng 1 phút; đối soát toàn bộ lúc gần 06:30.'
  );

  if (reportRows.length > 0) {
    sheet.getRange(2, 1, reportRows.length, 3).setNumberFormat('@');
    sheet.getRange(2, 4, reportRows.length, 1).setNumberFormat('#,##0.##');
    sheet.getRange(2, 5, reportRows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    sheet.getRange(2, 1, reportRows.length, 1).setNotes(
      reportRows.map(row => [customerProductReportMetadataNote_(row)])
    );
    sheet.getRange(1, 1, values.length, CUSTOMER_PRODUCT_REPORT_HEADERS.length).createFilter();
  }
  sheet.setFrozenRows(1);
  sheet.setTabColor('#00A6A6');
  sheet.autoResizeColumns(1, CUSTOMER_PRODUCT_REPORT_HEADERS.length);
  sheet.setColumnWidth(1, Math.max(sheet.getColumnWidth(1), 220));
  sheet.setColumnWidth(2, Math.max(sheet.getColumnWidth(2), 125));
  sheet.setColumnWidth(3, Math.max(sheet.getColumnWidth(3), 260));
  sheet.setColumnWidth(4, Math.max(sheet.getColumnWidth(4), 105));
  sheet.setColumnWidth(5, Math.max(sheet.getColumnWidth(5), 175));
  sheet.setRowHeight(1, 36);
}

function writeCustomerByProductReportSheet_(reportRows, period) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_CUSTOMER_BY_PRODUCT_REPORT);

  const columnCount = CUSTOMER_BY_PRODUCT_REPORT_HEADERS.length;
  const rows = Array.isArray(reportRows) ? reportRows : [];
  const requiredRows = rows.length + 1;
  ensureCustomerByProductSheetSize_(sheet, requiredRows, columnCount);

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  const previousLastRow = sheet.getLastRow();
  const previousLastColumn = sheet.getLastColumn();

  sheet.getRange(1, 1, 1, columnCount).setValues([CUSTOMER_BY_PRODUCT_REPORT_HEADERS]);
  for (let offset = 0; offset < rows.length; offset += CUSTOMER_BY_PRODUCT_REPORT_WRITE_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + CUSTOMER_BY_PRODUCT_REPORT_WRITE_CHUNK_SIZE);
    sheet.getRange(offset + 2, 1, chunk.length, columnCount).setValues(chunk);
  }

  if (previousLastRow > requiredRows) {
    sheet.getRange(
      requiredRows + 1,
      1,
      previousLastRow - requiredRows,
      Math.max(previousLastColumn, columnCount)
    ).clearContent().clearNote();
  }
  if (previousLastColumn > columnCount) {
    sheet.getRange(
      1,
      columnCount + 1,
      Math.max(previousLastRow, requiredRows),
      previousLastColumn - columnCount
    ).clearContent().clearNote();
  }

  const populatedRange = sheet.getRange(1, 1, requiredRows, columnCount);
  populatedRange.setFontFamily('Open Sans');
  sheet.getRange(1, 1, 1, columnCount)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#00A6A6')
    .setFontFamily('Open Sans')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Khách theo hàng hóa\n' +
    'Thời gian: Toàn bộ lịch sử (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Chi tiết: Sản phẩm -> khách hàng -> từng dòng hóa đơn hoàn thành.\n' +
    'Tự động đối soát gần 07:00; có thể chạy tay syncCustomerByProductReport().\n' +
    'Nguồn API: https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-noi-api/public-api/'
  );

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 5).setNumberFormat('@');
    sheet.getRange(2, 12, rows.length, 3).setNumberFormat('@');
    sheet.getRange(2, 20, rows.length, 2).setNumberFormat('@');
    [6, 7, 9, 15, 17, 23].forEach(column => {
      sheet.getRange(2, column, rows.length, 1).setNumberFormat('#,##0.##');
    });
    [8, 10, 11, 16, 18, 19, 24, 25].forEach(column => {
      sheet.getRange(2, column, rows.length, 1).setNumberFormat('#,##0');
    });
    sheet.getRange(2, 22, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    populatedRange.createFilter();
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setTabColor('#00A6A6');
  const widths = [
    230, 125, 300, 130, 105, 105, 135, 155, 135, 150, 170, 115, 210,
    130, 145, 165, 140, 155, 175, 125, 165, 175, 105, 125, 145
  ];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setRowHeight(1, 48);
}

/**
 * Tang grid theo cach co the retry an toan. Neu request insert bi timeout sau
 * khi Google da xu ly, lan thu lai doc kich thuoc moi va chi chen phan con thieu.
 */
function ensureCustomerByProductSheetSize_(sheet, requiredRows, requiredColumns) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const currentRows = sheet.getMaxRows();
      if (currentRows < requiredRows) {
        sheet.insertRowsAfter(currentRows, requiredRows - currentRows);
      }
      const currentColumns = sheet.getMaxColumns();
      if (currentColumns < requiredColumns) {
        sheet.insertColumnsAfter(currentColumns, requiredColumns - currentColumns);
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        SpreadsheetApp.flush();
        Utilities.sleep(1000 * attempt);
      }
    }
  }

  throw new Error(
    'Khong the mo rong grid Khach theo hang hoa den ' + requiredRows + ' dong x ' +
    requiredColumns + ' cot: ' + (lastError ? lastError.toString() : 'khong ro loi')
  );
}

/**
 * Thay cac dong cua hoa don vua duoc webhook cap nhat. Ma hoa don/ID duoc luu
 * trong note cot A, nen tab van chi co dung 5 cot nghiep vu ma van upsert duoc.
 */
function updateCustomerProductReportFromInvoices_(invoices) {
  replaceCustomerProductReportInvoices_(invoices, true);
}

function deleteCustomerProductReportInvoices_(invoices, additionalInvoiceCodes) {
  const deleteItems = (Array.isArray(invoices) ? invoices : []).slice();
  (Array.isArray(additionalInvoiceCodes) ? additionalInvoiceCodes : []).forEach(code => {
    deleteItems.push({ invoiceCode: code });
  });
  replaceCustomerProductReportInvoices_(deleteItems, false);
}

function replaceCustomerProductReportInvoices_(invoices, appendCompletedRows) {
  const items = Array.isArray(invoices) ? invoices : [];
  if (items.length === 0) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT);
  if (!sheet || !isCustomerProductReportSchemaReady_(sheet)) {
    Logger.log(
      'Bo qua cap nhat real-time Hang ban theo khach: schema chua san sang; ' +
      'syncCustomerReportIfDue_ se tu chuyen doi.'
    );
    return;
  }

  const identities = buildCustomerProductReportIdentityMap_(items);
  if (Object.keys(identities.ids).length === 0 && Object.keys(identities.codes).length === 0) {
    return;
  }

  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  if (sheet.getLastRow() > 1) {
    const rowCount = sheet.getLastRow() - 1;
    const notes = sheet.getRange(2, 1, rowCount, 1).getNotes();
    for (let rowOffset = rowCount - 1; rowOffset >= 0; rowOffset--) {
      const metadata = parseCustomerProductReportMetadataNote_(notes[rowOffset][0]);
      if (
        (metadata.invoiceId && identities.ids[metadata.invoiceId]) ||
        (metadata.invoiceCode && identities.codes[metadata.invoiceCode])
      ) {
        sheet.deleteRow(rowOffset + 2);
      }
    }
  }

  if (appendCompletedRows) {
    const period = getCustomerReportRollingRange_(new Date(), CUSTOMER_PRODUCT_REPORT_DAYS);
    const newRows = aggregateCustomerProductReport_(items, period);
    if (newRows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      const values = newRows.map(row => [
        row.customerName,
        row.productCode,
        row.productName,
        row.purchasedQuantity,
        row.purchaseTime
      ]);
      sheet.getRange(startRow, 1, values.length, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
        .setValues(values);
      sheet.getRange(startRow, 1, values.length, 3).setNumberFormat('@');
      sheet.getRange(startRow, 4, values.length, 1).setNumberFormat('#,##0.##');
      sheet.getRange(startRow, 5, values.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
      sheet.getRange(startRow, 1, values.length, 1).setNotes(
        newRows.map(row => [customerProductReportMetadataNote_(row)])
      );
    }
  }

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
      .sort({ column: 5, ascending: false });
    sheet.getRange(1, 1, sheet.getLastRow(), CUSTOMER_PRODUCT_REPORT_HEADERS.length)
      .createFilter();
  }
}

function isCustomerProductReportSchemaReady_(sheet) {
  if (!sheet || sheet.getLastColumn() < CUSTOMER_PRODUCT_REPORT_HEADERS.length) return false;
  const headers = sheet.getRange(1, 1, 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length).getValues()[0];
  return CUSTOMER_PRODUCT_REPORT_HEADERS.every((header, index) => headers[index] === header);
}

function buildCustomerProductReportIdentityMap_(invoices) {
  const identities = { ids: {}, codes: {} };
  (invoices || []).forEach(invoice => {
    const invoiceId = customerReportText_(
      customerProductReportValue_(invoice, ['InvoiceId', 'invoiceId', 'Id', 'id'], '')
    );
    const invoiceCode = customerReportText_(
      customerProductReportValue_(invoice, ['InvoiceCode', 'invoiceCode', 'Code', 'code'], '')
    );
    if (invoiceId) identities.ids[invoiceId] = true;
    if (invoiceCode) identities.codes[invoiceCode] = true;
  });
  return identities;
}

function customerProductReportMetadataNote_(row) {
  return JSON.stringify({
    invoiceId: customerReportText_(row.invoiceId),
    invoiceCode: customerReportText_(row.invoiceCode)
  });
}

function parseCustomerProductReportMetadataNote_(note) {
  try {
    const parsed = JSON.parse(note || '{}');
    return {
      invoiceId: customerReportText_(parsed.invoiceId),
      invoiceCode: customerReportText_(parsed.invoiceCode)
    };
  } catch (error) {
    return { invoiceId: '', invoiceCode: '' };
  }
}
