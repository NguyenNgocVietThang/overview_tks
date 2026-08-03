// ==========================================
// BAO CAO CONG NO KHACH HANG - 1/3/7 NGAY
// ==========================================

const CUSTOMER_DEBT_REPORT_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const CUSTOMER_DEBT_REPORT_TRIGGER_HANDLER = 'syncCustomerDebtReports';
const CUSTOMER_DEBT_REPORT_LAST_SYNC_PROPERTY = 'CUSTOMER_DEBT_REPORT_LAST_SYNC_AT';
const CUSTOMER_DEBT_REPORT_PAGE_SIZE = 100;
const CUSTOMER_DEBT_REPORT_PERIODS = Object.freeze([
  { days: 1, sheetName: CONFIG.SHEET_CUSTOMER_DEBT_1_DAY },
  { days: 3, sheetName: CONFIG.SHEET_CUSTOMER_DEBT_3_DAYS },
  { days: 7, sheetName: CONFIG.SHEET_CUSTOMER_DEBT_7_DAYS }
]);
const CUSTOMER_DEBT_REPORT_HEADERS = Object.freeze([
  'Mã KH', 'Khách hàng', 'Số điện thoại', 'Nhóm khách hàng',
  'Nợ đầu kỳ', 'Ghi nợ', 'Ghi có', 'Nợ cuối kỳ',
  'Mã giao dịch', 'Thời gian', 'Loại giao dịch', 'Giá trị', 'Dư nợ cuối',
  'Mã hàng', 'Tên hàng', 'Thương hiệu', 'Nhóm hàng(3 Cấp)',
  'Đơn giá', 'SL sản phẩm', 'Thành tiền', 'Chiết khấu',
  'VAT bán hàng', 'VAT hoàn lại', 'Thu khác', 'Tổng cộng'
]);

/**
 * Lam moi ba tab HN1/HN3/HN7 theo dung cau truc file xuat
 * BaoCaoCongNoTheoKhachHang cua KiotViet.
 */
function syncCustomerDebtReports() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Bao cao cong no khach hang dang duoc dong bo boi mot tien trinh khac.');
  }

  try {
    const token = getKiotVietToken();
    if (!token) throw new Error('Khong lay duoc KiotViet token de dong bo cong no.');

    const now = new Date();
    const maxPeriod = getCustomerDebtReportRange_(now, 7);
    const customers = fetchCustomerDebtReportPages_('customers', token, {
      includeCustomerGroup: true,
      includeTotal: true,
      orderBy: 'code',
      orderDirection: 'ASC'
    });
    const invoices = fetchCustomerDebtReportPages_('invoices', token, {
      fromPurchaseDate: maxPeriod.startQuery,
      toPurchaseDate: maxPeriod.endQuery,
      includePayment: true,
      status: 1,
      orderBy: 'purchaseDate',
      orderDirection: 'DESC'
    });
    const returns = fetchCustomerDebtReportPages_('returns', token, {
      includePayment: true,
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    }, 'returnDate', maxPeriod.start.getTime());
    const cashFlowQuery = {
      partnerType: 'C',
      startDate: maxPeriod.startQuery,
      endDate: maxPeriod.endQuery,
      status: 0,
      includeAccount: true,
      includeBranch: true,
      includeUser: true
    };
    const receipts = fetchCustomerDebtReportPages_('cashflow', token,
      Object.assign({}, cashFlowQuery, { isReceipt: true }))
      .map(item => Object.assign({ _customerDebtIsReceipt: true }, item));
    const expenses = fetchCustomerDebtReportPages_('cashflow', token,
      Object.assign({}, cashFlowQuery, { isReceipt: false }))
      .map(item => Object.assign({ _customerDebtIsReceipt: false }, item));
    const productLookup = buildCustomerDebtProductLookup_();
    const transactions = buildCustomerDebtTransactions_(
      customers, invoices, returns, receipts.concat(expenses), productLookup
    );
    const results = CUSTOMER_DEBT_REPORT_PERIODS.map(definition => {
      const period = getCustomerDebtReportRange_(now, definition.days);
      const rows = aggregateCustomerDebtReport_(customers, transactions, period);
      writeCustomerDebtReportSheet_(definition.sheetName, rows, period, now);
      return {
        sheetName: definition.sheetName,
        days: definition.days,
        customerCount: rows.length,
        transactionCount: rows.reduce((total, row) => total + row.transactions.length, 0),
        totalClosingDebt: rows.reduce((total, row) => total + row.closingDebt, 0),
        fromDate: period.startLabel,
        toDate: period.endLabel
      };
    });

    PropertiesService.getScriptProperties().setProperty(
      CUSTOMER_DEBT_REPORT_LAST_SYNC_PROPERTY,
      Utilities.formatDate(now, CUSTOMER_DEBT_REPORT_TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ss")
    );
    Logger.log('Da cap nhat cong no HN1/HN3/HN7 luc %s.',
      Utilities.formatDate(now, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'dd/MM/yyyy HH:mm:ss'));
    return results;
  } finally {
    lock.releaseLock();
  }
}

/** Tao du lieu ngay va bat trigger cap nhat gan 15:00 hang ngay. */
function setupCustomerDebtReports() {
  const result = syncCustomerDebtReports();
  setupCustomerDebtReportDailyTrigger();
  return result;
}

function setupCustomerDebtReportDailyTrigger() {
  removeCustomerDebtReportDailyTrigger_();
  ScriptApp.newTrigger(CUSTOMER_DEBT_REPORT_TRIGGER_HANDLER)
    .timeBased()
    .atHour(15)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CUSTOMER_DEBT_REPORT_TIME_ZONE)
    .create();
  Logger.log('Da bat lich cap nhat HN1/HN3/HN7 hang ngay luc gan 15:00.');
}

function removeCustomerDebtReportDailyTrigger() {
  const count = removeCustomerDebtReportDailyTrigger_();
  Logger.log('Da xoa %s trigger cong no khach hang.', count);
  return count;
}

function removeCustomerDebtReportDailyTrigger_() {
  let count = 0;
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === CUSTOMER_DEBT_REPORT_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      count++;
    }
  });
  return count;
}

/** Trigger 1 phut dung ham nay de chay bu neu trigger 15:00 bi tre/loi. */
function syncCustomerDebtReportsIfDue_() {
  const now = new Date();
  const today = Utilities.formatDate(now, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'H'));
  const lastSyncAt = PropertiesService.getScriptProperties()
    .getProperty(CUSTOMER_DEBT_REPORT_LAST_SYNC_PROPERTY);
  const lastSyncHour = lastSyncAt && lastSyncAt.substring(0, 10) === today
    ? Number(lastSyncAt.substring(11, 13))
    : -1;
  if (hour < 15 || lastSyncHour >= 15) return false;

  try {
    syncCustomerDebtReports();
    return true;
  } catch (error) {
    Logger.log('Loi dong bo HN1/HN3/HN7, se thu lai o phut sau: ' + error.toString());
    return false;
  }
}

function getCustomerDebtReportRange_(now, inclusiveDays) {
  const current = now || new Date();
  const days = Math.max(1, Number(inclusiveDays) || 1);
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const startCandidate = new Date(current.getTime() - (days - 1) * millisecondsPerDay);
  const tomorrow = new Date(current.getTime() + millisecondsPerDay);
  const startText = Utilities.formatDate(startCandidate, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const todayText = Utilities.formatDate(current, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const tomorrowText = Utilities.formatDate(tomorrow, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  return {
    days: days,
    start: new Date(startText + 'T00:00:00+07:00'),
    endExclusive: new Date(tomorrowText + 'T00:00:00+07:00'),
    startQuery: startText + 'T00:00:00',
    endQuery: todayText + 'T23:59:59',
    startLabel: customerDebtDateLabel_(startText),
    endLabel: customerDebtDateLabel_(todayText)
  };
}

function customerDebtDateLabel_(dateText) {
  return dateText.substring(8, 10) + '/' + dateText.substring(5, 7) + '/' + dateText.substring(0, 4);
}

function fetchCustomerDebtReportPages_(endpoint, token, query, stopDateField, minimumTime) {
  let items = [];
  let currentItem = 0;
  let total = 0;
  do {
    const params = Object.assign({}, query || {}, {
      pageSize: CUSTOMER_DEBT_REPORT_PAGE_SIZE,
      currentItem: currentItem
    });
    const queryString = Object.keys(params)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
      .join('&');
    const result = fetchCustomerReportJsonWithRetry_(
      'https://public.kiotapi.com/' + endpoint + '?' + queryString,
      token,
      endpoint
    );
    const pageItems = Array.isArray(result.data) ? result.data : [];
    items = items.concat(pageItems);
    total = Number(result.total) || 0;
    currentItem += CUSTOMER_DEBT_REPORT_PAGE_SIZE;
    if (pageItems.length === 0) break;

    if (stopDateField && isFinite(minimumTime)) {
      const pageTimes = pageItems.map(item => new Date(item[stopDateField]).getTime())
        .filter(time => isFinite(time));
      if (pageTimes.length > 0 && Math.max.apply(null, pageTimes) < minimumTime) break;
    }
    if (currentItem < total) Utilities.sleep(150);
  } while (currentItem < total);
  return items;
}

function buildCustomerDebtProductLookup_() {
  const lookup = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_PRODUCTS);
  if (!sheet || sheet.getLastRow() < 2 || sheet.getLastColumn() < 1) return lookup;
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(value => String(value || '').trim());
  const codeIndex = headers.indexOf('Mã hàng');
  const nameIndex = headers.indexOf('Tên hàng');
  const categoryIndex = headers.indexOf('Nhóm hàng');
  const tradeMarkIndex = headers.indexOf('Thương hiệu');
  if (codeIndex < 0) return lookup;

  values.slice(1).forEach(row => {
    const code = customerDebtText_(row[codeIndex]).toLocaleLowerCase();
    if (!code) return;
    lookup[code] = {
      name: nameIndex >= 0 ? customerDebtSafeText_(row[nameIndex]) : '',
      tradeMark: tradeMarkIndex >= 0 ? customerDebtSafeText_(row[tradeMarkIndex]) : '',
      category: categoryIndex >= 0 ? customerDebtSafeText_(row[categoryIndex]) : ''
    };
  });
  return lookup;
}

function buildCustomerDebtTransactions_(customers, invoices, returns, cashFlows, productLookup) {
  const lookup = buildCustomerDebtProfileLookup_(customers);
  const transactions = [];
  const transactionCodes = {};

  (invoices || []).forEach(invoice => {
    if (Number(invoice.status) !== 1 || !invoice.customerId) return;
    const invoiceTransaction = buildCustomerDebtTransaction_(lookup, invoice, {
      time: invoice.purchaseDate,
      code: invoice.code || invoice.invoiceCode,
      type: 'Bán hàng',
      value: customerDebtNumber_(invoice.total),
      total: customerDebtNumber_(invoice.total),
      otherReceipt: customerDebtSurcharge_(invoice),
      productLines: buildCustomerDebtProductLines_(invoice.invoiceDetails, productLookup, false)
    });
    transactions.push(invoiceTransaction);
    rememberCustomerDebtTransactionCode_(transactionCodes, invoiceTransaction);

    (Array.isArray(invoice.payments) ? invoice.payments : []).forEach(payment => {
      const paymentStatus = customerDebtField_(payment, ['status', 'Status'], 0);
      if (Number(paymentStatus) === 1) return;
      const paymentTransaction = buildCustomerDebtTransaction_(lookup, invoice, {
        time: customerDebtField_(payment, ['transDate', 'TransDate'], invoice.purchaseDate),
        code: customerDebtField_(payment, ['code', 'Code'], ''),
        type: 'Thanh toán',
        value: -Math.abs(customerDebtNumber_(customerDebtField_(payment, ['amount', 'Amount'], 0))),
        total: 0,
        productLines: []
      });
      if (!hasCustomerDebtTransactionCode_(transactionCodes, paymentTransaction)) {
        transactions.push(paymentTransaction);
        rememberCustomerDebtTransactionCode_(transactionCodes, paymentTransaction);
      }
    });
  });

  (returns || []).forEach(returnItem => {
    if (Number(returnItem.status) !== 1 || !returnItem.customerId) return;
    const returnTotal = customerDebtNumber_(returnItem.returnTotal);
    const returnTransaction = buildCustomerDebtTransaction_(lookup, returnItem, {
      time: returnItem.returnDate,
      code: returnItem.code || returnItem.returnCode,
      type: 'Trả hàng',
      value: -returnTotal,
      total: -returnTotal,
      productLines: buildCustomerDebtProductLines_(returnItem.returnDetails, productLookup, true)
    });
    transactions.push(returnTransaction);
    rememberCustomerDebtTransactionCode_(transactionCodes, returnTransaction);
  });

  (cashFlows || []).forEach(cashFlow => {
    const status = customerDebtField_(cashFlow, ['status', 'Status'], 0);
    if (status !== '' && status !== null && status !== undefined && Number(status) !== 0) return;
    const amount = Math.abs(customerDebtNumber_(customerDebtField_(cashFlow, ['amount', 'Amount'], 0)));
    const rawReceipt = customerDebtField_(cashFlow, ['isReceipt', 'IsReceipt'], cashFlow._customerDebtIsReceipt);
    const isReceipt = rawReceipt === true || rawReceipt === 1 || String(rawReceipt).toLowerCase() === 'true';
    const code = customerDebtSafeText_(customerDebtField_(cashFlow, ['code', 'Code'], ''));
    const cashFlowTransaction = buildCustomerDebtTransaction_(lookup, {
      customerId: customerDebtField_(cashFlow, ['partnerId', 'PartnerId'], ''),
      customerName: customerDebtField_(cashFlow, ['partnerName', 'PartnerName'], ''),
      contactNumber: customerDebtField_(cashFlow, ['contactNumber', 'ContactNumber'], '')
    }, {
      time: customerDebtField_(cashFlow, ['transDate', 'TransDate'], ''),
      code: code,
      type: /^CB-/i.test(code) ? 'Điều chỉnh' : 'Thanh toán',
      value: isReceipt ? -amount : amount,
      total: 0,
      productLines: []
    });
    if (!hasCustomerDebtTransactionCode_(transactionCodes, cashFlowTransaction)) {
      transactions.push(cashFlowTransaction);
      rememberCustomerDebtTransactionCode_(transactionCodes, cashFlowTransaction);
    }
  });

  addCustomerDebtInitializationAdjustments_(lookup, transactions);
  const validTransactions = transactions.filter(transaction => transaction.customerKey && transaction.timeMs > 0);
  Logger.log(
    'Cong no: %s hoa don, %s tra hang, %s phieu thu/chi, %s giao dich sau khi doi soat.',
    (invoices || []).length, (returns || []).length, (cashFlows || []).length, validTransactions.length
  );
  return validTransactions;
}

function customerDebtTransactionCodeKey_(transaction) {
  const code = customerDebtText_(transaction && transaction.code).toLocaleLowerCase();
  return code ? transaction.customerKey + '|' + code : '';
}

function rememberCustomerDebtTransactionCode_(codeLookup, transaction) {
  const key = customerDebtTransactionCodeKey_(transaction);
  if (key) codeLookup[key] = true;
}

function hasCustomerDebtTransactionCode_(codeLookup, transaction) {
  const key = customerDebtTransactionCodeKey_(transaction);
  return key ? codeLookup[key] === true : false;
}

/**
 * KiotViet co the khong tra cac but toan CB khoi tao cong no qua endpoint
 * cashflow. Neu khach moi duoc tao trong cua so 7 ngay va van con phan chenhlech,
 * tao lai but toan khoi tao de bao cao khong day so do vao No dau ky.
 */
function addCustomerDebtInitializationAdjustments_(lookup, transactions) {
  const transactionsByCustomer = {};
  (transactions || []).forEach(transaction => {
    if (!transactionsByCustomer[transaction.customerKey]) transactionsByCustomer[transaction.customerKey] = [];
    transactionsByCustomer[transaction.customerKey].push(transaction);
  });

  (lookup.profiles || []).forEach(profile => {
    if (!profile.createdTimeMs) return;
    const customerTransactions = transactionsByCustomer[profile.key] || [];
    const alreadyHasAdjustment = customerTransactions.some(transaction => transaction.type === 'Điều chỉnh');
    if (alreadyHasAdjustment) return;
    const netMovement = customerTransactions.reduce((total, transaction) => total + transaction.value, 0);
    const initializationValue = profile.closingDebt - netMovement;
    if (Math.abs(initializationValue) < 0.0001) return;

    const initialTimeMs = profile.modifiedTimeMs >= profile.createdTimeMs
      ? profile.modifiedTimeMs
      : profile.createdTimeMs;
    transactions.push({
      customerKey: profile.key,
      profile: profile,
      code: 'CB-KHOITAO-' + profile.code,
      time: new Date(initialTimeMs),
      timeMs: initialTimeMs,
      type: 'Điều chỉnh',
      value: initializationValue,
      total: 0,
      otherReceipt: 0,
      productLines: [],
      isSyntheticInitialization: true
    });
  });
}

function buildCustomerDebtProductLines_(details, productLookup, isReturn) {
  return (Array.isArray(details) ? details : []).map(detail => {
    const code = customerDebtSafeText_(detail.productCode || detail.code);
    const product = productLookup[code.toLocaleLowerCase()] || {};
    const sign = isReturn ? -1 : 1;
    const quantity = customerDebtNumber_(detail.quantity);
    const price = customerDebtNumber_(detail.price);
    const discount = customerDebtNumber_(detail.discount);
    const subTotalValue = detail.subTotal === undefined || detail.subTotal === null
      ? price * quantity - discount
      : customerDebtNumber_(detail.subTotal);
    const tax = customerDebtNumber_(detail.taxAmount || detail.totalTax || detail.tax);
    return {
      productCode: code,
      productName: customerDebtSafeText_(detail.productName || product.name),
      tradeMark: customerDebtSafeText_(detail.tradeMarkName || detail.trademarkName || product.tradeMark),
      category: customerDebtSafeText_(detail.categoryName || product.category),
      price: price,
      quantity: sign * quantity,
      amount: sign * subTotalValue,
      discount: sign * discount,
      salesVat: isReturn ? 0 : tax,
      returnVat: isReturn ? tax : 0
    };
  });
}

function customerDebtSurcharge_(invoice) {
  if (invoice.surcharge !== undefined) return customerDebtNumber_(invoice.surcharge);
  if (invoice.totalSurcharge !== undefined) return customerDebtNumber_(invoice.totalSurcharge);
  const surcharges = invoice.invoiceOrderSurcharges || invoice.surcharges;
  return (Array.isArray(surcharges) ? surcharges : []).reduce((total, item) => {
    return total + customerDebtNumber_(item.value || item.amount || item.price);
  }, 0);
}

function buildCustomerDebtProfileLookup_(customers) {
  const lookup = { byId: {}, byCode: {}, profiles: [] };
  (customers || []).forEach(customer => {
    const profile = buildCustomerDebtProfile_(customer);
    lookup.profiles.push(profile);
    if (profile.id) lookup.byId[profile.id] = profile;
    if (profile.codeKey) lookup.byCode[profile.codeKey] = profile;
  });
  return lookup;
}

function buildCustomerDebtProfile_(customer) {
  const id = customerDebtText_(customer.id || customer.customerId);
  const code = customerDebtSafeText_(customer.code || customer.customerCode);
  const name = customerDebtSafeText_(customer.name || customer.customerName || 'Khách lẻ');
  const createdTimeMs = new Date(customerDebtField_(customer, ['createdDate', 'CreatedDate'], '')).getTime();
  const modifiedTimeMs = new Date(customerDebtField_(customer, ['modifiedDate', 'ModifiedDate'], '')).getTime();
  return {
    key: id ? 'id:' + id : (code ? 'code:' + code.toLocaleLowerCase() : 'name:' + name.toLocaleLowerCase()),
    id: id,
    code: code,
    codeKey: code.toLocaleLowerCase(),
    name: name,
    contactNumber: customerDebtSafeText_(customer.contactNumber),
    group: customerDebtSafeText_(customerReportCustomerGroups_(customer)),
    closingDebt: customerDebtNumber_(customer.debt),
    createdTimeMs: isFinite(createdTimeMs) ? createdTimeMs : 0,
    modifiedTimeMs: isFinite(modifiedTimeMs) ? modifiedTimeMs : 0
  };
}

function buildCustomerDebtTransaction_(lookup, item, details) {
  const customerId = customerDebtText_(item.customerId || item.partnerId);
  const customerCode = customerDebtText_(item.customerCode || item.codeCustomer);
  const profile = (customerId && lookup.byId[customerId]) ||
    (customerCode && lookup.byCode[customerCode.toLocaleLowerCase()]) || null;
  const fallbackName = customerDebtSafeText_(item.customerName || item.partnerName || 'Khách hàng');
  const key = profile ? profile.key : (customerId
    ? 'id:' + customerId
    : (customerCode ? 'code:' + customerCode.toLocaleLowerCase() : 'name:' + fallbackName.toLocaleLowerCase()));
  const timeMs = new Date(details.time).getTime();
  return {
    customerKey: key,
    profile: profile || {
      key: key, id: customerId, code: customerDebtSafeText_(customerCode), codeKey: customerCode.toLocaleLowerCase(),
      name: fallbackName, contactNumber: customerDebtSafeText_(item.contactNumber), group: '', closingDebt: 0
    },
    code: customerDebtSafeText_(details.code),
    time: isFinite(timeMs) ? new Date(timeMs) : '',
    timeMs: isFinite(timeMs) ? timeMs : 0,
    type: customerDebtSafeText_(details.type),
    value: customerDebtNumber_(details.value),
    total: customerDebtNumber_(details.total),
    otherReceipt: customerDebtNumber_(details.otherReceipt),
    productLines: Array.isArray(details.productLines) ? details.productLines : []
  };
}

function aggregateCustomerDebtReport_(customers, transactions, period) {
  const states = {};
  const lookup = buildCustomerDebtProfileLookup_(customers);
  lookup.profiles.forEach(profile => {
    if (profile.closingDebt !== 0) states[profile.key] = createCustomerDebtState_(profile);
  });

  (transactions || []).forEach(transaction => {
    if (transaction.timeMs < period.start.getTime() || transaction.timeMs >= period.endExclusive.getTime()) return;
    const profile = lookup.byId[transaction.profile.id] ||
      lookup.byCode[transaction.profile.codeKey] || transaction.profile;
    if (!states[transaction.customerKey]) states[transaction.customerKey] = createCustomerDebtState_(profile);
    if (transaction.value >= 0) states[transaction.customerKey].debit += transaction.value;
    else states[transaction.customerKey].credit += Math.abs(transaction.value);
    states[transaction.customerKey].transactions.push(transaction);
  });

  return Object.keys(states).map(key => {
    const state = states[key];
    state.openingDebt = state.closingDebt - state.debit + state.credit;
    state.transactions.sort((left, right) => {
      if (left.timeMs !== right.timeMs) return left.timeMs - right.timeMs;
      return String(left.code).localeCompare(String(right.code));
    });
    let runningDebt = state.openingDebt;
    state.transactions.forEach(transaction => {
      runningDebt += transaction.value;
      transaction.runningDebt = runningDebt;
    });
    return state;
  }).sort((left, right) => {
    if (right.closingDebt !== left.closingDebt) return right.closingDebt - left.closingDebt;
    return String(left.profile.code).localeCompare(String(right.profile.code));
  });
}

function createCustomerDebtState_(profile) {
  return {
    profile: profile,
    openingDebt: 0,
    debit: 0,
    credit: 0,
    closingDebt: customerDebtNumber_(profile.closingDebt),
    transactions: []
  };
}

function buildCustomerDebtReportValues_(rows, period) {
  const values = [CUSTOMER_DEBT_REPORT_HEADERS];
  (rows || []).forEach(row => {
    const openingTransaction = {
      code: '---', time: period.start, type: 'Dư nợ đầu kỳ', value: row.openingDebt,
      runningDebt: row.openingDebt, total: 0, otherReceipt: 0, productLines: []
    };
    const transactions = [openingTransaction].concat(row.transactions);
    const productLines = row.transactions.reduce((lines, transaction) => {
      return lines.concat(transaction.productLines || []);
    }, []);

    values.push([
      row.profile.code,
      row.profile.name,
      row.profile.contactNumber,
      row.profile.group,
      row.openingDebt,
      row.debit,
      row.credit,
      row.closingDebt,
      customerDebtJoinCellValues_(transactions.map(transaction => transaction.code)),
      customerDebtJoinCellValues_(transactions.map(transaction => customerDebtDateTimeText_(transaction.time))),
      customerDebtJoinCellValues_(transactions.map(transaction => transaction.type)),
      customerDebtJoinCellValues_(transactions.map(transaction => transaction.value)),
      customerDebtJoinCellValues_(transactions.map(transaction => transaction.runningDebt)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.productCode)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.productName)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.tradeMark)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.category)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.price)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.quantity)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.amount)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.discount)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.salesVat)),
      customerDebtJoinCellValues_(productLines.map(productLine => productLine.returnVat)),
      row.transactions.reduce((total, transaction) => total + transaction.otherReceipt, 0),
      row.transactions.reduce((total, transaction) => total + transaction.total, 0)
    ]);
  });
  return values;
}

/** Giu mot hang cho moi khach hang, cac gia tri chi tiet ngan cach bang dau |. */
function customerDebtJoinCellValues_(items) {
  const values = items || [];
  const isBlank = value => value === '' || value === null || value === undefined;
  if (values.length === 0 || values.every(isBlank)) return '';
  if (values.length === 1) return isBlank(values[0]) ? '' : values[0];
  return values.map(value => isBlank(value) ? '-' : String(value)).join(' | ');
}

function customerDebtDateTimeText_(value) {
  if (!(value instanceof Date) || !isFinite(value.getTime())) return customerDebtSafeText_(value);
  return Utilities.formatDate(value, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'dd/MM/yyyy HH:mm');
}

function writeCustomerDebtReportSheet_(sheetName, rows, period, syncedAt) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();
  sheet.getBandings().forEach(banding => banding.remove());

  const values = buildCustomerDebtReportValues_(rows, period);
  const dataRowCount = values.length - 1;
  sheet.clear();
  sheet.getRange(1, 1, values.length, CUSTOMER_DEBT_REPORT_HEADERS.length).setValues(values);
  sheet.getRange(1, 1).setNote(
    'Bao cao Cong no khach hang - ' + period.days + ' ngay gan day, tinh ca hom nay (' +
    period.startLabel + ' - ' + period.endLabel + ').\n' +
    'Moi khach hang chi hien thi tren mot dong; cac gia tri chi tiet duoc ngan cach bang dau |.\n' +
    'Cap nhat luc: ' + Utilities.formatDate(syncedAt, CUSTOMER_DEBT_REPORT_TIME_ZONE, 'dd/MM/yyyy HH:mm:ss') + '.\n' +
    'Tu dong cap nhat hang ngay luc gan 15:00.'
  );

  const fullRange = sheet.getRange(1, 1, values.length, CUSTOMER_DEBT_REPORT_HEADERS.length);
  fullRange.applyRowBanding(SpreadsheetApp.BandingTheme.BLUE, true, false);
  sheet.getRange(1, 1, 1, CUSTOMER_DEBT_REPORT_HEADERS.length)
    .setFontWeight('bold')
    .setFontColor('#FFFFFF')
    .setBackground('#4F81BD')
    .setHorizontalAlignment('left')
    .setVerticalAlignment('middle')
    .setWrap(false);
  if (dataRowCount > 0) {
    sheet.getRange(2, 1, dataRowCount, CUSTOMER_DEBT_REPORT_HEADERS.length)
      .setWrap(false)
      .setVerticalAlignment('middle');
    sheet.getRange(2, 1, dataRowCount, 4).setNumberFormat('@');
    sheet.getRange(2, 5, dataRowCount, 4).setNumberFormat('#,##0.####');
    sheet.getRange(2, 9, dataRowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 10, dataRowCount, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    sheet.getRange(2, 11, dataRowCount, 1).setNumberFormat('@');
    sheet.getRange(2, 12, dataRowCount, 2).setNumberFormat('#,##0.####');
    sheet.getRange(2, 14, dataRowCount, 4).setNumberFormat('@');
    sheet.getRange(2, 18, dataRowCount, 8).setNumberFormat('#,##0.####');
    fullRange.createFilter();
  }

  sheet.setFrozenRows(1);
  sheet.setTabColor('#4F81BD');
  sheet.setColumnWidth(1, 105);
  sheet.setColumnWidth(2, 210);
  sheet.setColumnWidth(3, 120);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidths(5, 4, 105);
  sheet.setColumnWidth(9, 125);
  sheet.setColumnWidth(10, 145);
  sheet.setColumnWidth(11, 115);
  sheet.setColumnWidths(12, 2, 105);
  sheet.setColumnWidth(14, 105);
  sheet.setColumnWidth(15, 270);
  sheet.setColumnWidth(16, 130);
  sheet.setColumnWidth(17, 230);
  sheet.setColumnWidths(18, 8, 110);
  sheet.setRowHeight(1, 30);
}

function customerDebtNumber_(value) {
  const numberValue = Number(value);
  return isFinite(numberValue) ? numberValue : 0;
}

function customerDebtText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function customerDebtSafeText_(value) {
  const text = customerDebtText_(value);
  return text.charAt(0) === '=' ? "'" + text : text;
}

function customerDebtField_(source, names, fallback) {
  const item = source || {};
  for (let index = 0; index < names.length; index++) {
    if (item[names[index]] !== undefined && item[names[index]] !== null) return item[names[index]];
  }
  return fallback;
}
