// ==========================================
// BAO CAO KHACH HANG - THANG NAY VA HANG BAN 90 NGAY
// ==========================================

const CUSTOMER_REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const CUSTOMER_REPORT_TRIGGER_HANDLER = 'syncCustomerReport';
const CUSTOMER_REPORT_LAST_SYNC_PROPERTY = 'CUSTOMER_REPORT_LAST_SYNC_DATE';
const CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY = 'CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION';
const CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION = 'detail-quantity-header-v2';
const CUSTOMER_REPORT_PAGE_SIZE = 100;
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

/**
 * Tao/cap nhat hai tab bao cao khach hang:
 * - "Bao cao ban hang": Ban hang -> Thang nay.
 * - "Hang ban theo khach": Hang ban theo khach -> 90 ngay qua.
 *
 * Moi hoa don/phieu tra hang la mot dong chi tiet giao dich, kem theo cac chi so
 * tong hop cua khach hang giong file xuat Bao cao ban hang cua KiotViet.
 * Doanh thu = tong hoa don hoan thanh trong thang sau giam gia hoa don.
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
    const customerProfiles = fetchCustomerReportPages_('customers', token, {
      includeCustomerGroup: true
    });
    const reportRows = aggregateCustomerReport_(invoices, returns, period, customerProfiles);
    const productReportRows = aggregateCustomerProductReport_(invoices, productPeriod);
    const reportSummary = summarizeCustomerReport_(reportRows);

    writeCustomerReportSheet_(reportRows, period);
    writeCustomerProductReportSheet_(productReportRows, productPeriod);
    PropertiesService.getScriptProperties().setProperties({
      [CUSTOMER_REPORT_LAST_SYNC_PROPERTY]:
        Utilities.formatDate(new Date(), CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd'),
      [CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION
    });
    Logger.log(
      'Da cap nhat Bao cao ban hang: %s khach hang, %s giao dich; Hang ban theo khach 90 ngay: %s dong hang.',
      reportRows.length,
      reportSummary.transactionCount,
      productReportRows.length
    );

    return {
      sheetName: CONFIG.SHEET_CUSTOMER_REPORT,
      customerCount: reportRows.length,
      transactionCount: reportSummary.transactionCount,
      totalRevenue: reportSummary.revenue,
      totalReturns: reportSummary.returnValue,
      netRevenue: reportSummary.netRevenue,
      fromDate: period.startLabel,
      toDate: period.endLabel,
      customerProductReport: {
        sheetName: CONFIG.SHEET_CUSTOMER_PRODUCT_REPORT,
        rowCount: productReportRows.length,
        purchasedQuantity: productReportRows.reduce((total, row) => {
          return total + customerReportNumber_(row.purchasedQuantity);
        }, 0),
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
  const properties = PropertiesService.getScriptProperties();
  const lastSyncDate = properties.getProperty(CUSTOMER_REPORT_LAST_SYNC_PROPERTY);
  const schemaVersion = properties.getProperty(CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY);
  const needsSchemaMigration = schemaVersion !== CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION;

  if (!needsSchemaMigration && (hour < 7 || lastSyncDate === today)) return false;

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
    'Thời gian: Tháng này (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Chi tiết: Mỗi hóa đơn hoặc phiếu trả hàng là một dòng giao dịch.\n' +
    'Tự động cập nhật hàng ngày lúc gần 07:00.'
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

  sheet.getRange(1, 1, 1, CUSTOMER_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#4F81BD')
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
  sheet.getRange(1, 1, 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#00A6A6')
    .setHorizontalAlignment('center');
  sheet.getRange(1, 1).setNote(
    'Kiểu hiển thị: Báo cáo\n' +
    'Mối quan tâm: Hàng bán theo khách\n' +
    'Thời gian: 90 ngày qua (' + period.startLabel + ' - ' + period.endLabel + ')\n' +
    'Chi tiết: Mỗi mặt hàng trong hóa đơn hoàn thành là một dòng.\n' +
    'Tự động cập nhật từ webhook KiotViet trong khoảng 1 phút; đối soát toàn bộ lúc gần 07:00.'
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
