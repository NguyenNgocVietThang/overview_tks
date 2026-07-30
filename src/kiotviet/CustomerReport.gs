// ==========================================
// BAO CAO KHACH HANG - THANG NAY VA HANG BAN 90 NGAY
// ==========================================

const CUSTOMER_REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const CUSTOMER_REPORT_TRIGGER_HANDLER = 'syncCustomerReport';
const CUSTOMER_REPORT_LAST_SYNC_PROPERTY = 'CUSTOMER_REPORT_LAST_SYNC_DATE';
const CUSTOMER_REPORT_PAGE_SIZE = 100;
const CUSTOMER_REPORT_HEADERS = Object.freeze([
  'Mã KH',
  'Khách hàng',
  'Doanh thu',
  'Giá trị trả',
  'Doanh thu thuần'
]);
const CUSTOMER_PRODUCT_REPORT_DAYS = 90;
const CUSTOMER_PRODUCT_REPORT_HEADERS = Object.freeze([
  'Mã KH',
  'Khách hàng',
  'SL mua',
  'Doanh thu',
  'SL Trả',
  'Giá trị trả',
  'Doanh thu thuần'
]);

/**
 * Tao/cap nhat hai tab bao cao khach hang:
 * - "Bao cao ban hang": Ban hang -> Thang nay.
 * - "Hang ban theo khach": Hang ban theo khach -> 90 ngay qua.
 *
 * Doanh thu = tong hoa don hoan thanh trong thang.
 * Gia tri tra = tong phieu tra hang hoan thanh trong thang.
 * Doanh thu thuan = Doanh thu - Gia tri tra.
 */
function syncCustomerReport() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Bao cao khach hang dang duoc dong bo boi mot tien trinh khac.');
  }

  try {
    const token = getKiotVietToken();
    if (!token) {
      throw new Error('Khong lay duoc KiotViet token de dong bo Bao cao khach hang.');
    }

    const now = new Date();
    const period = getCustomerReportMonthRange_(now);
    const productPeriod = getCustomerReportRollingRange_(now, CUSTOMER_PRODUCT_REPORT_DAYS);
    const invoices = fetchCustomerReportPages_('invoices', token, {
      fromPurchaseDate: productPeriod.startQuery,
      toPurchaseDate: productPeriod.endQuery,
      status: 1
    });
    const returns = fetchCustomerReportPages_('returns', token, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    });
    const reportRows = aggregateCustomerReport_(invoices, returns, period);
    const productReportRows = aggregateCustomerProductReport_(invoices, returns, productPeriod);

    writeCustomerReportSheet_(reportRows, period);
    writeCustomerProductReportSheet_(productReportRows, productPeriod);
    PropertiesService.getScriptProperties().setProperty(
      CUSTOMER_REPORT_LAST_SYNC_PROPERTY,
      Utilities.formatDate(new Date(), CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd')
    );
    Logger.log(
      'Da cap nhat Bao cao khach hang: %s khach hang; Hang ban theo khach 90 ngay: %s khach hang.',
      reportRows.length,
      productReportRows.length
    );

    return {
      sheetName: CONFIG.SHEET_CUSTOMER_REPORT,
      customerCount: reportRows.length,
      fromDate: period.startLabel,
      toDate: period.endLabel,
      customerProductReport: {
        sheetName: CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT,
        customerCount: productReportRows.length,
        fromDate: productPeriod.startLabel,
        toDate: productPeriod.endLabel,
        days: CUSTOMER_PRODUCT_REPORT_DAYS
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Dong bo thu cong tab "Hang ban theo khach". De toi uu so lan goi API,
 * ham nay cung lam moi tab "Bao cao khach hang" trong cung mot lan chay.
 */
function syncCustomerProductReport() {
  return syncCustomerReport().customerProductReport;
}

/**
 * Duoc goi boi trigger hang doi 1 phut dang co san. Sau 07:00, neu bao cao
 * chua duoc cap nhat trong ngay thi chay mot lan; neu loi se thu lai o phut sau.
 * Co che nay giup lich 07:00 hoat dong ngay sau khi push ma khong can tao them
 * trigger thu cong.
 */
function syncCustomerReportIfDue_() {
  const now = new Date();
  const today = Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'H'));
  const lastSyncDate = PropertiesService.getScriptProperties()
    .getProperty(CUSTOMER_REPORT_LAST_SYNC_PROPERTY);

  if (hour < 7 || lastSyncDate === today) return false;

  try {
    syncCustomerReport();
    return true;
  } catch (error) {
    Logger.log('Loi dong bo Bao cao khach hang, se thu lai o phut sau: ' + error.toString());
    return false;
  }
}

/**
 * Chay mot lan de tao du lieu ngay va bat lich dong bo moi ngay luc 07:00.
 */
function setupCustomerReport() {
  const result = syncCustomerReport();
  setupCustomerReportDailyTrigger();
  return result;
}

/**
 * Tao duy nhat mot time trigger cho Bao cao khach hang.
 * Apps Script co the chay lech khoang +/- 15 phut quanh 07:00.
 */
function setupCustomerReportDailyTrigger() {
  removeCustomerReportDailyTrigger_();

  ScriptApp.newTrigger(CUSTOMER_REPORT_TRIGGER_HANDLER)
    .timeBased()
    .atHour(7)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CUSTOMER_REPORT_TIME_ZONE)
    .create();

  Logger.log('Da bat lich syncCustomerReport() hang ngay luc gan 07:00 (Asia/Ho_Chi_Minh).');
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
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === CUSTOMER_REPORT_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removedCount++;
    }
  });
  return removedCount;
}

/**
 * Khoang thoi gian tu dau thang den het ngay hien tai theo gio Viet Nam.
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

function aggregateCustomerReport_(invoices, returns, period) {
  const customers = {};

  (invoices || []).forEach(invoice => {
    if (Number(invoice.status) !== 1) return;
    if (!isCustomerReportDateInRange_(invoice.purchaseDate, period)) return;
    addCustomerReportAmount_(customers, invoice, customerReportNumber_(invoice.total), 0);
  });

  (returns || []).forEach(returnItem => {
    if (Number(returnItem.status) !== 1) return;
    if (!isCustomerReportDateInRange_(returnItem.returnDate, period)) return;
    addCustomerReportAmount_(customers, returnItem, 0, customerReportNumber_(returnItem.returnTotal));
  });

  return Object.keys(customers)
    .map(key => {
      const customer = customers[key];
      customer.netRevenue = customer.revenue - customer.returnValue;
      return customer;
    })
    .sort((left, right) => {
      if (right.netRevenue !== left.netRevenue) return right.netRevenue - left.netRevenue;
      if (right.revenue !== left.revenue) return right.revenue - left.revenue;
      return String(left.customerCode).localeCompare(String(right.customerCode));
    });
}

function aggregateCustomerProductReport_(invoices, returns, period) {
  const customers = {};

  (invoices || []).forEach(invoice => {
    if (Number(invoice.status) !== 1) return;
    if (!isCustomerReportDateInRange_(invoice.purchaseDate, period)) return;
    addCustomerProductReportAmount_(
      customers,
      invoice,
      sumCustomerReportDetailQuantity_(invoice.invoiceDetails),
      customerReportNumber_(invoice.total),
      0,
      0
    );
  });

  (returns || []).forEach(returnItem => {
    if (Number(returnItem.status) !== 1) return;
    if (!isCustomerReportDateInRange_(returnItem.returnDate, period)) return;
    addCustomerProductReportAmount_(
      customers,
      returnItem,
      0,
      0,
      sumCustomerReportDetailQuantity_(returnItem.returnDetails),
      customerReportNumber_(returnItem.returnTotal)
    );
  });

  return Object.keys(customers)
    .map(key => {
      const customer = customers[key];
      customer.netRevenue = customer.revenue - customer.returnValue;
      return customer;
    })
    .sort((left, right) => {
      if (right.netRevenue !== left.netRevenue) return right.netRevenue - left.netRevenue;
      if (right.revenue !== left.revenue) return right.revenue - left.revenue;
      return String(left.customerCode).localeCompare(String(right.customerCode));
    });
}

function addCustomerProductReportAmount_(customers, item, purchasedQuantity, revenue, returnedQuantity, returnValue) {
  const customerId = item.customerId === null || item.customerId === undefined
    ? ''
    : String(item.customerId).trim();
  const customerCode = String(item.customerCode || '').trim();
  const customerName = String(item.customerName || 'Khách lẻ').trim() || 'Khách lẻ';
  const key = customerId
    ? 'id:' + customerId
    : (customerCode ? 'code:' + customerCode : 'name:' + customerName.toLocaleLowerCase());

  if (!customers[key]) {
    customers[key] = {
      customerCode: customerCode,
      customerName: customerName,
      purchasedQuantity: 0,
      revenue: 0,
      returnedQuantity: 0,
      returnValue: 0,
      netRevenue: 0
    };
  } else {
    if (!customers[key].customerCode && customerCode) customers[key].customerCode = customerCode;
    if (customers[key].customerName === 'Khách lẻ' && customerName !== 'Khách lẻ') {
      customers[key].customerName = customerName;
    }
  }

  customers[key].purchasedQuantity += purchasedQuantity;
  customers[key].revenue += revenue;
  customers[key].returnedQuantity += returnedQuantity;
  customers[key].returnValue += returnValue;
}

function sumCustomerReportDetailQuantity_(details) {
  return (Array.isArray(details) ? details : []).reduce((total, detail) => {
    return total + customerReportNumber_(detail && detail.quantity);
  }, 0);
}

function addCustomerReportAmount_(customers, item, revenue, returnValue) {
  const customerId = item.customerId === null || item.customerId === undefined
    ? ''
    : String(item.customerId).trim();
  const customerCode = String(item.customerCode || '').trim();
  const customerName = String(item.customerName || 'Khách lẻ').trim() || 'Khách lẻ';
  const key = customerId
    ? 'id:' + customerId
    : (customerCode ? 'code:' + customerCode : 'name:' + customerName.toLocaleLowerCase());

  if (!customers[key]) {
    customers[key] = {
      customerCode: customerCode,
      customerName: customerName,
      revenue: 0,
      returnValue: 0,
      netRevenue: 0
    };
  } else {
    if (!customers[key].customerCode && customerCode) customers[key].customerCode = customerCode;
    if (customers[key].customerName === 'Khách lẻ' && customerName !== 'Khách lẻ') {
      customers[key].customerName = customerName;
    }
  }

  customers[key].revenue += revenue;
  customers[key].returnValue += returnValue;
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

  const totals = reportRows.reduce((summary, row) => {
    summary.revenue += row.revenue;
    summary.returnValue += row.returnValue;
    summary.netRevenue += row.netRevenue;
    return summary;
  }, { revenue: 0, returnValue: 0, netRevenue: 0 });

  const values = [
    CUSTOMER_REPORT_HEADERS,
    [
      'SL khách hàng: ' + reportRows.length,
      '',
      totals.revenue,
      totals.returnValue,
      totals.netRevenue
    ]
  ].concat(reportRows.map(row => [
    row.customerCode,
    row.customerName,
    row.revenue,
    row.returnValue,
    row.netRevenue
  ]));

  sheet.clear();
  sheet.getRange(1, 1, values.length, CUSTOMER_REPORT_HEADERS.length).setValues(values);
  sheet.getRange(1, 1, 1, CUSTOMER_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#A9DEF4')
    .setHorizontalAlignment('center');
  sheet.getRange(2, 1, 1, CUSTOMER_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#F5F0D5');
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Bán hàng\n' +
    'Thời gian: Tháng này (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Tự động cập nhật hàng ngày lúc gần 07:00.'
  );

  if (reportRows.length > 0) {
    sheet.getRange(3, 1, reportRows.length, 1).setNumberFormat('@');
    sheet.getRange(3, 3, reportRows.length, 3).setNumberFormat('#,##0');
  }
  sheet.getRange(2, 3, 1, 3).setNumberFormat('#,##0');
  sheet.setFrozenRows(2);
  sheet.setTabColor('#0D6EFD');
  sheet.autoResizeColumns(1, CUSTOMER_REPORT_HEADERS.length);
  sheet.setColumnWidth(1, Math.max(sheet.getColumnWidth(1), 130));
  sheet.setColumnWidth(2, Math.max(sheet.getColumnWidth(2), 230));
  sheet.setColumnWidth(3, Math.max(sheet.getColumnWidth(3), 135));
  sheet.setColumnWidth(4, Math.max(sheet.getColumnWidth(4), 135));
  sheet.setColumnWidth(5, Math.max(sheet.getColumnWidth(5), 150));
}

function writeCustomerProductReportSheet_(reportRows, period) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT);
  if (!sheet) sheet = spreadsheet.insertSheet(CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT);

  const totals = reportRows.reduce((summary, row) => {
    summary.purchasedQuantity += row.purchasedQuantity;
    summary.revenue += row.revenue;
    summary.returnedQuantity += row.returnedQuantity;
    summary.returnValue += row.returnValue;
    summary.netRevenue += row.netRevenue;
    return summary;
  }, {
    purchasedQuantity: 0,
    revenue: 0,
    returnedQuantity: 0,
    returnValue: 0,
    netRevenue: 0
  });

  const values = [
    CUSTOMER_PRODUCT_REPORT_HEADERS,
    [
      'SL khách hàng: ' + reportRows.length,
      '',
      totals.purchasedQuantity,
      totals.revenue,
      totals.returnedQuantity,
      totals.returnValue,
      totals.netRevenue
    ]
  ].concat(reportRows.map(row => [
    row.customerCode,
    row.customerName,
    row.purchasedQuantity,
    row.revenue,
    row.returnedQuantity,
    row.returnValue,
    row.netRevenue
  ]));

  sheet.clear();
  sheet.getRange(1, 1, values.length, CUSTOMER_PRODUCT_REPORT_HEADERS.length).setValues(values);
  sheet.getRange(1, 1, 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#A9DEF4')
    .setHorizontalAlignment('center');
  sheet.getRange(2, 1, 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setBackground('#F5F0D5');
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Hàng bán theo khách\n' +
    'Thời gian: 90 ngày qua (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Tự động cập nhật hàng ngày lúc gần 07:00.'
  );

  if (reportRows.length > 0) {
    sheet.getRange(3, 1, reportRows.length, 1).setNumberFormat('@');
    sheet.getRange(3, 3, reportRows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(3, 4, reportRows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(3, 5, reportRows.length, 1).setNumberFormat('#,##0');
    sheet.getRange(3, 6, reportRows.length, 2).setNumberFormat('#,##0');
  }
  sheet.getRange(2, 3, 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 4, 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 5, 1, 1).setNumberFormat('#,##0');
  sheet.getRange(2, 6, 1, 2).setNumberFormat('#,##0');
  sheet.setFrozenRows(2);
  sheet.setTabColor('#00A6A6');
  sheet.autoResizeColumns(1, CUSTOMER_PRODUCT_REPORT_HEADERS.length);
  sheet.setColumnWidth(1, Math.max(sheet.getColumnWidth(1), 130));
  sheet.setColumnWidth(2, Math.max(sheet.getColumnWidth(2), 230));
  sheet.setColumnWidth(3, Math.max(sheet.getColumnWidth(3), 105));
  sheet.setColumnWidth(4, Math.max(sheet.getColumnWidth(4), 135));
  sheet.setColumnWidth(5, Math.max(sheet.getColumnWidth(5), 105));
  sheet.setColumnWidth(6, Math.max(sheet.getColumnWidth(6), 135));
  sheet.setColumnWidth(7, Math.max(sheet.getColumnWidth(7), 150));
}
