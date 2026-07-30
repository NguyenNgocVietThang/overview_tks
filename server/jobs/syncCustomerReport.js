// ==========================================
// KIOTVIET -> GOOGLE SHEETS: HAI BAO CAO KHACH HANG
// Chay doc lap boi lich tu dong luc 07:00 hang ngay.
// ==========================================

const path = require('path');
const { google } = require('googleapis');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REPORT_SHEET_NAME = 'Báo cáo bán hàng';
const LEGACY_REPORT_SHEET_NAME = 'Báo cáo khách hàng';
const CUSTOMER_PRODUCT_REPORT_SHEET_NAME = 'Hàng bán theo khách';
const REPORT_TIME_ZONE_OFFSET_HOURS = 7;
const PAGE_SIZE = 100;
const HEADERS = [
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
];
const CUSTOMER_PRODUCT_REPORT_DAYS = 90;
const CUSTOMER_PRODUCT_HEADERS = [
  'Khách hàng',
  'Mã hàng',
  'Tên hàng',
  'SL mua',
  'Thời gian'
];

function readKiotVietConfig() {
  const required = key => {
    const value = process.env[key];
    if (!value) throw new Error(`Thiếu biến môi trường ${key}.`);
    return value;
  };

  return {
    clientId: required('KIOTVIET_CLIENT_ID'),
    clientSecret: required('KIOTVIET_CLIENT_SECRET'),
    retailer: required('KIOTVIET_RETAILER')
  };
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 300)}`);
  }
  return JSON.parse(responseText);
}

async function getKiotVietToken(config) {
  const body = new URLSearchParams({
    scopes: 'PublicApi.Access',
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret
  });
  const result = await fetchJson('https://id.kiotviet.vn/connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!result.access_token) throw new Error('KiotViet không trả về access token.');
  return result.access_token;
}

async function fetchAllKiotVietPages(endpoint, headers, query) {
  const rows = [];
  let currentItem = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({
      ...(query || {}),
      pageSize: String(PAGE_SIZE),
      currentItem: String(currentItem)
    });
    const result = await fetchJson(
      `https://public.kiotapi.com/${endpoint}?${params.toString()}`,
      { headers }
    );
    rows.push(...(result.data || []));
    total = Number(result.total || 0);
    currentItem += PAGE_SIZE;
  } while (currentItem < total);

  return rows;
}

function getCurrentMonthRange(now) {
  const vnNow = new Date((now || new Date()).getTime() + REPORT_TIME_ZONE_OFFSET_HOURS * 60 * 60 * 1000);
  const today = vnNow.toISOString().slice(0, 10);
  const tomorrow = new Date(vnNow.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  return {
    startQuery: `${monthStart}T00:00:00`,
    endQuery: `${today}T23:59:59`,
    startTime: Date.parse(`${monthStart}T00:00:00+07:00`),
    endExclusiveTime: Date.parse(`${tomorrow}T00:00:00+07:00`)
  };
}

function getRollingDayRange(now, days) {
  const vnNow = new Date((now || new Date()).getTime() + REPORT_TIME_ZONE_OFFSET_HOURS * 60 * 60 * 1000);
  const today = vnNow.toISOString().slice(0, 10);
  const startDate = new Date(vnNow.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tomorrow = new Date(vnNow.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    startQuery: `${startDate}T00:00:00`,
    endQuery: `${today}T23:59:59`,
    startTime: Date.parse(`${startDate}T00:00:00+07:00`),
    endExclusiveTime: Date.parse(`${tomorrow}T00:00:00+07:00`),
    startDate,
    endDate: today,
    days
  };
}

function aggregateCustomerReport(invoices, returns, period, customerProfiles) {
  const customers = new Map();
  const profileLookup = buildCustomerProfileLookup(customerProfiles);

  const getOrCreateCustomer = item => {
    const customerId = textValue(item.customerId);
    const itemCustomerCode = textValue(item.customerCode);
    const itemCustomerName = textValue(item.customerName) || 'Khách lẻ';
    const key = customerId
      ? `id:${customerId}`
      : (itemCustomerCode ? `code:${itemCustomerCode.toLowerCase()}` : `name:${itemCustomerName.toLowerCase()}`);
    const profile = (customerId && profileLookup.byId.get(customerId)) ||
      (itemCustomerCode && profileLookup.byCode.get(itemCustomerCode.toLowerCase())) || {};
    const profileCode = textValue(profile.code || profile.customerCode);
    const profileName = textValue(profile.name || profile.customerName);

    if (!customers.has(key)) {
      customers.set(key, {
        customerCode: safeText(itemCustomerCode || profileCode),
        customerName: safeText(itemCustomerName !== 'Khách lẻ' ? itemCustomerName : (profileName || itemCustomerName)),
        contactNumber: safeText(profile.contactNumber || profile.customerContactNumber || item.contactNumber || ''),
        customerGroup: safeText(getCustomerGroups(profile)),
        saleOrderCount: 0,
        grossTotal: 0,
        invoiceDiscount: 0,
        revenue: 0,
        returnOrderCount: 0,
        returnValue: 0,
        transactions: []
      });
    }

    const customer = customers.get(key);
    if (!customer.customerCode && (itemCustomerCode || profileCode)) {
      customer.customerCode = safeText(itemCustomerCode || profileCode);
    }
    if (customer.customerName === 'Khách lẻ' && (profileName || itemCustomerName !== 'Khách lẻ')) {
      customer.customerName = safeText(profileName || itemCustomerName);
    }
    if (!customer.contactNumber && profile.contactNumber) {
      customer.contactNumber = safeText(profile.contactNumber);
    }
    if (!customer.customerGroup) customer.customerGroup = safeText(getCustomerGroups(profile));
    return customer;
  };

  for (const invoice of invoices || []) {
    const purchaseTime = Date.parse(invoice.purchaseDate);
    if (
      Number(invoice.status) === 1 &&
      purchaseTime >= period.startTime &&
      purchaseTime < period.endExclusiveTime
    ) {
      const customer = getOrCreateCustomer(invoice);
      const discount = getInvoiceDiscount(invoice);
      const revenue = numberValue(invoice.total);
      const grossTotal = revenue + discount;

      customer.saleOrderCount += 1;
      customer.grossTotal += grossTotal;
      customer.invoiceDiscount += discount;
      customer.revenue += revenue;
      customer.transactions.push({
        transactionCode: safeText(invoice.code || invoice.invoiceCode || ''),
        transactionTime: invoice.purchaseDate || '',
        transactionTimeMs: Number.isFinite(purchaseTime) ? purchaseTime : 0,
        employeeName: safeText(invoice.soldByName || ''),
        transactionQuantity: sumDetailQuantity(invoice.invoiceDetails),
        transactionGrossTotal: grossTotal,
        transactionDiscount: discount,
        transactionRevenue: revenue
      });
    }
  }

  for (const returnItem of returns || []) {
    const returnTime = Date.parse(returnItem.returnDate);
    if (
      Number(returnItem.status) === 1 &&
      returnTime >= period.startTime &&
      returnTime < period.endExclusiveTime
    ) {
      const customer = getOrCreateCustomer(returnItem);
      const returnValue = numberValue(returnItem.returnTotal);
      const returnDiscount = numberValue(returnItem.returnDiscount);

      customer.returnOrderCount += 1;
      customer.returnValue += returnValue;
      customer.transactions.push({
        transactionCode: safeText(returnItem.code || returnItem.returnCode || ''),
        transactionTime: returnItem.returnDate || '',
        transactionTimeMs: Number.isFinite(returnTime) ? returnTime : 0,
        employeeName: safeText(returnItem.soldByName || ''),
        transactionQuantity: -sumDetailQuantity(returnItem.returnDetails),
        transactionGrossTotal: -(returnValue + returnDiscount),
        transactionDiscount: -returnDiscount,
        transactionRevenue: -returnValue
      });
    }
  }

  return [...customers.values()]
    .map(customer => ({
      ...customer,
      netRevenue: customer.revenue - customer.returnValue,
      transactions: customer.transactions.sort((left, right) =>
        right.transactionTimeMs - left.transactionTimeMs ||
        left.transactionCode.localeCompare(right.transactionCode)
      )
    }))
    .sort((left, right) =>
      right.netRevenue - left.netRevenue ||
      right.revenue - left.revenue ||
      left.customerCode.localeCompare(right.customerCode)
    );
}

function buildCustomerProfileLookup(customerProfiles) {
  const lookup = { byId: new Map(), byCode: new Map() };
  for (const profile of customerProfiles || []) {
    const customerId = textValue(profile.id || profile.customerId);
    const customerCode = textValue(profile.code || profile.customerCode).toLowerCase();
    if (customerId) lookup.byId.set(customerId, profile);
    if (customerCode) lookup.byCode.set(customerCode, profile);
  }
  return lookup;
}

function getCustomerGroups(profile) {
  const direct = profile.groups || profile.groupName || profile.customerGroups;
  if (Array.isArray(direct)) {
    return direct
      .map(group => typeof group === 'string' ? group : textValue(group && (group.name || group.groupName)))
      .filter(Boolean)
      .join(', ');
  }
  if (direct != null && direct !== '') return String(direct);
  return (Array.isArray(profile.customerGroupDetails) ? profile.customerGroupDetails : [])
    .map(detail => textValue(detail && (detail.groupName || detail.name)))
    .filter(Boolean)
    .join(', ');
}

function getInvoiceDiscount(invoice) {
  if (Number(invoice.pricingMode) === 1 && invoice.discountAfterTax != null) {
    return numberValue(invoice.discountAfterTax);
  }
  return numberValue(invoice.discount);
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function textValue(value) {
  return value == null ? '' : String(value).trim();
}

function safeText(value) {
  const text = textValue(value);
  return text.startsWith('=') ? `'${text}` : text;
}

function sumDetailQuantity(details) {
  return (Array.isArray(details) ? details : []).reduce((total, detail) => {
    const quantity = Number(detail && (detail.quantity !== undefined ? detail.quantity : detail.Quantity));
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function aggregateCustomerProductReport(invoices, periodOrReturns, optionalPeriod) {
  // optionalPeriod keeps compatibility with the former (invoices, returns, period) signature.
  const period = optionalPeriod || periodOrReturns;
  const rows = [];

  for (const invoice of invoices || []) {
    const purchaseDate = firstDefined(invoice, ['purchaseDate', 'PurchaseDate'], '');
    const purchaseTime = Date.parse(purchaseDate);
    const status = firstDefined(invoice, ['status', 'Status'], 0);
    if (
      Number(status) !== 1 ||
      purchaseTime < period.startTime ||
      purchaseTime >= period.endExclusiveTime
    ) {
      continue;
    }

    const details = firstDefined(invoice, ['invoiceDetails', 'InvoiceDetails'], []);
    for (const detail of Array.isArray(details) ? details : []) {
      rows.push({
        customerName: safeText(firstDefined(invoice, ['customerName', 'CustomerName'], 'Khách lẻ')) ||
          'Khách lẻ',
        productCode: safeText(firstDefined(detail, ['productCode', 'ProductCode'], '')),
        productName: safeText(firstDefined(detail, ['productName', 'ProductName'], '')),
        purchasedQuantity: numberValue(firstDefined(detail, ['quantity', 'Quantity'], 0)),
        purchaseTime: purchaseDate,
        purchaseTimeMs: purchaseTime,
        invoiceId: textValue(firstDefined(invoice, ['invoiceId', 'InvoiceId', 'id', 'Id'], '')),
        invoiceCode: textValue(firstDefined(invoice, ['invoiceCode', 'InvoiceCode', 'code', 'Code'], ''))
      });
    }
  }

  return rows.sort((left, right) =>
    right.purchaseTimeMs - left.purchaseTimeMs ||
    left.invoiceCode.localeCompare(right.invoiceCode) ||
    left.productCode.localeCompare(right.productCode)
  );
}

function firstDefined(source, keys, defaultValue) {
  const object = source || {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  }
  return defaultValue;
}

async function loadCustomerReportsData() {
  const config = readKiotVietConfig();
  const token = await getKiotVietToken(config);
  const headers = {
    Authorization: `Bearer ${token}`,
    Retailer: config.retailer
  };
  const now = new Date();
  const monthPeriod = getCurrentMonthRange(now);
  const productPeriod = getRollingDayRange(now, CUSTOMER_PRODUCT_REPORT_DAYS);
  const [invoices, returns, customers] = await Promise.all([
    fetchAllKiotVietPages('invoices', headers, {
      fromPurchaseDate: productPeriod.startQuery,
      toPurchaseDate: productPeriod.endQuery,
      status: '1'
    }),
    fetchAllKiotVietPages('returns', headers, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    }),
    fetchAllKiotVietPages('customers', headers, {
      includeCustomerGroup: 'true'
    })
  ]);

  return {
    monthPeriod,
    productPeriod,
    customerReportRows: aggregateCustomerReport(invoices, returns, monthPeriod, customers),
    customerProductReportRows: aggregateCustomerProductReport(invoices, productPeriod)
  };
}

async function loadCustomerReportData() {
  const reports = await loadCustomerReportsData();
  return reports.customerReportRows;
}

async function getSheetsClient() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
    throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_JSON hoặc SPREADSHEET_ID trong server/.env.');
  }
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureReportSheet(sheets, spreadsheetId, sheetName, legacySheetName) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties'
  });
  const existing = (metadata.data.sheets || [])
    .map(sheet => sheet.properties)
    .find(properties => properties.title === sheetName);
  if (existing) return existing;

  const legacySheet = (metadata.data.sheets || [])
    .map(sheet => sheet.properties)
    .find(properties => properties.title === legacySheetName);
  if (legacySheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: legacySheet.sheetId, title: sheetName },
            fields: 'title'
          }
        }]
      }
    });
    return { ...legacySheet, title: sheetName };
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: sheetName } } }]
    }
  });
  return response.data.replies[0].addSheet.properties;
}

function buildSheetValues(reportRows) {
  const values = [HEADERS];

  for (const customer of reportRows || []) {
    for (const transaction of customer.transactions || []) {
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
        formatTransactionDateTime(transaction.transactionTime),
        transaction.employeeName,
        transaction.transactionQuantity,
        transaction.transactionGrossTotal,
        transaction.transactionDiscount,
        transaction.transactionRevenue
      ]);
    }
  }

  return values;
}

function summarizeCustomerReport(reportRows) {
  return (reportRows || []).reduce((summary, customer) => {
    summary.transactionCount += (customer.transactions || []).length;
    summary.revenue += customer.revenue;
    summary.returnValue += customer.returnValue;
    summary.netRevenue += customer.netRevenue;
    return summary;
  }, { transactionCount: 0, revenue: 0, returnValue: 0, netRevenue: 0 });
}

function formatTransactionDateTime(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return safeText(value);
  return `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}:${match[6]}`;
}

function buildCustomerProductSheetValues(reportRows) {
  return [
    CUSTOMER_PRODUCT_HEADERS,
    ...reportRows.map(row => [
      row.customerName,
      row.productCode,
      row.productName,
      row.purchasedQuantity,
      toGoogleSheetsDateSerial(row.purchaseTime)
    ])
  ];
}

function buildCustomerProductSheetNotes(reportRows) {
  return (reportRows || []).map(row => JSON.stringify({
    invoiceId: textValue(row.invoiceId),
    invoiceCode: textValue(row.invoiceCode)
  }));
}

function toGoogleSheetsDateSerial(value) {
  const match = String(value || '').match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/
  );
  if (!match) return safeText(value);
  const milliseconds = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
  return milliseconds / 86400000 + 25569;
}

function formatDateLabel(dateText) {
  return `${dateText.slice(8, 10)}/${dateText.slice(5, 7)}/${dateText.slice(0, 4)}`;
}

async function writeReportSheet(sheets, spreadsheetId, sheetProperties, values, options) {
  const quotedSheetName = `'${options.sheetName}'`;
  const lastColumn = String.fromCharCode(64 + options.columnCount);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: quotedSheetName
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quotedSheetName}!A1:${lastColumn}${values.length}`,
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  const sheetId = sheetProperties.sheetId;
  const numberFormatRequests = (options.numberFormats || []).map(numberFormat => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: values.length,
        startColumnIndex: numberFormat.startColumnIndex,
        endColumnIndex: numberFormat.endColumnIndex
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: numberFormat.type || 'NUMBER', pattern: numberFormat.pattern }
        }
      },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));
  const textFormatRequests = (options.textColumns || []).map(columnIndex => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: values.length,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: 'TEXT', pattern: '@' }
        }
      },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));
  const columnWidthRequests = (options.columnWidths || []).map(columnWidth => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: columnWidth.startIndex,
        endIndex: columnWidth.endIndex
      },
      properties: { pixelSize: columnWidth.pixelSize },
      fields: 'pixelSize'
    }
  }));
  const summaryRowRequest = options.summaryRow ? [{
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 2,
        startColumnIndex: 0,
        endColumnIndex: options.columnCount
      },
      cell: {
        userEnteredFormat: {
          backgroundColorStyle: {
            rgbColor: { red: 0.961, green: 0.941, blue: 0.835 }
          },
          textFormat: { bold: true }
        }
      },
      fields: 'userEnteredFormat(backgroundColorStyle,textFormat)'
    }
  }] : [];
  const filterRequests = options.addFilter && values.length > 1 ? [{
    setBasicFilter: {
      filter: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: values.length,
          startColumnIndex: 0,
          endColumnIndex: options.columnCount
        }
      }
    }
  }] : [];
  const clearDataNotesRequest = options.rowNotes ? [{
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: 0,
        endColumnIndex: 1
      },
      cell: {},
      fields: 'note'
    }
  }] : [];
  const rowNotesRequest = options.rowNotes && options.rowNotes.length > 0 ? [{
    updateCells: {
      rows: options.rowNotes.map(note => ({ values: [{ note }] })),
      fields: 'note',
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: options.rowNotes.length + 1,
        startColumnIndex: 0,
        endColumnIndex: 1
      }
    }
  }] : [];

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: options.frozenRowCount || 1 },
              tabColorStyle: {
                rgbColor: options.tabColor
              }
            },
            fields: 'gridProperties.frozenRowCount,tabColorStyle'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: options.columnCount
            },
            cell: {
              userEnteredFormat: {
                backgroundColorStyle: {
                  rgbColor: options.headerColor || { red: 0.663, green: 0.871, blue: 0.957 }
                },
                textFormat: {
                  bold: true,
                  foregroundColorStyle: {
                    rgbColor: options.headerTextColor || { red: 0, green: 0, blue: 0 }
                  }
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP'
              }
            },
            fields: 'userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)'
          }
        },
        ...summaryRowRequest,
        ...numberFormatRequests,
        ...textFormatRequests,
        ...clearDataNotesRequest,
        {
          updateCells: {
            rows: [{ values: [{ note: options.note }] }],
            fields: 'note',
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 1
            }
          }
        },
        ...rowNotesRequest,
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: options.columnCount
            }
          }
        },
        ...columnWidthRequests,
        ...filterRequests
      ]
    }
  });
}

async function syncCustomerReport() {
  const reports = await loadCustomerReportsData();
  const sheets = await getSheetsClient();
  const spreadsheetId = process.env.SPREADSHEET_ID;
  const customerSheetProperties = await ensureReportSheet(
    sheets,
    spreadsheetId,
    REPORT_SHEET_NAME,
    LEGACY_REPORT_SHEET_NAME
  );
  const productSheetProperties = await ensureReportSheet(
    sheets,
    spreadsheetId,
    CUSTOMER_PRODUCT_REPORT_SHEET_NAME
  );
  const customerValues = buildSheetValues(reports.customerReportRows);
  const productValues = buildCustomerProductSheetValues(reports.customerProductReportRows);
  const productNotes = buildCustomerProductSheetNotes(reports.customerProductReportRows);
  const customerSummary = summarizeCustomerReport(reports.customerReportRows);
  const monthStart = reports.monthPeriod.startQuery.slice(0, 10);
  const monthEnd = reports.monthPeriod.endQuery.slice(0, 10);

  await Promise.all([
    writeReportSheet(sheets, spreadsheetId, customerSheetProperties, customerValues, {
      sheetName: REPORT_SHEET_NAME,
      columnCount: HEADERS.length,
      tabColor: { red: 0.051, green: 0.431, blue: 0.992 },
      frozenRowCount: 1,
      summaryRow: false,
      addFilter: true,
      headerColor: { red: 0.31, green: 0.506, blue: 0.741 },
      headerTextColor: { red: 1, green: 1, blue: 1 },
      textColumns: [0, 1, 2, 3, 11, 13],
      numberFormats: [
        { startColumnIndex: 4, endColumnIndex: 5, pattern: '#,##0' },
        { startColumnIndex: 5, endColumnIndex: 8, pattern: '#,##0' },
        { startColumnIndex: 8, endColumnIndex: 9, pattern: '#,##0' },
        { startColumnIndex: 9, endColumnIndex: 11, pattern: '#,##0' },
        { startColumnIndex: 14, endColumnIndex: 15, pattern: '#,##0.##' },
        { startColumnIndex: 15, endColumnIndex: 18, pattern: '#,##0' }
      ],
      columnWidths: [
        { startIndex: 0, endIndex: 1, pixelSize: 115 },
        { startIndex: 1, endIndex: 2, pixelSize: 220 },
        { startIndex: 2, endIndex: 3, pixelSize: 125 },
        { startIndex: 3, endIndex: 4, pixelSize: 165 },
        { startIndex: 4, endIndex: 11, pixelSize: 115 },
        { startIndex: 11, endIndex: 12, pixelSize: 125 },
        { startIndex: 12, endIndex: 13, pixelSize: 175 },
        { startIndex: 13, endIndex: 14, pixelSize: 130 },
        { startIndex: 14, endIndex: 15, pixelSize: 155 },
        { startIndex: 15, endIndex: 18, pixelSize: 175 }
      ],
      note:
        'Kiểu hiển thị: Báo cáo\n' +
        'Mối quan tâm: Bán hàng\n' +
        `Thời gian: Tháng này (${formatDateLabel(monthStart)} - ${formatDateLabel(monthEnd)})\n` +
        'Chi tiết: Mỗi hóa đơn hoặc phiếu trả hàng là một dòng giao dịch.\n' +
        'Tự động cập nhật hàng ngày lúc 07:00.'
    }),
    writeReportSheet(sheets, spreadsheetId, productSheetProperties, productValues, {
      sheetName: CUSTOMER_PRODUCT_REPORT_SHEET_NAME,
      columnCount: CUSTOMER_PRODUCT_HEADERS.length,
      tabColor: { red: 0, green: 0.651, blue: 0.651 },
      frozenRowCount: 1,
      summaryRow: false,
      addFilter: true,
      headerColor: { red: 0, green: 0.651, blue: 0.651 },
      headerTextColor: { red: 1, green: 1, blue: 1 },
      textColumns: [0, 1, 2],
      numberFormats: [
        { startColumnIndex: 3, endColumnIndex: 4, pattern: '#,##0.##' },
        {
          startColumnIndex: 4,
          endColumnIndex: 5,
          type: 'DATE_TIME',
          pattern: 'dd/MM/yyyy HH:mm:ss'
        }
      ],
      columnWidths: [
        { startIndex: 0, endIndex: 1, pixelSize: 220 },
        { startIndex: 1, endIndex: 2, pixelSize: 125 },
        { startIndex: 2, endIndex: 3, pixelSize: 260 },
        { startIndex: 3, endIndex: 4, pixelSize: 105 },
        { startIndex: 4, endIndex: 5, pixelSize: 175 }
      ],
      rowNotes: productNotes,
      note:
        'Kiểu hiển thị: Báo cáo\n' +
        'Mối quan tâm: Hàng bán theo khách\n' +
        `Thời gian: 90 ngày qua (${formatDateLabel(reports.productPeriod.startDate)} - ` +
        `${formatDateLabel(reports.productPeriod.endDate)})\n` +
        'Chi tiết: Mỗi mặt hàng trong hóa đơn hoàn thành là một dòng.\n' +
        'Tự động cập nhật từ webhook KiotViet trong khoảng 1 phút; đối soát toàn bộ lúc 07:00.'
    })
  ]);

  return {
    sheetName: REPORT_SHEET_NAME,
    customerCount: reports.customerReportRows.length,
    transactionCount: customerSummary.transactionCount,
    totalRevenue: customerSummary.revenue,
    totalReturns: customerSummary.returnValue,
    netRevenue: customerSummary.netRevenue,
    customerProductReport: {
      sheetName: CUSTOMER_PRODUCT_REPORT_SHEET_NAME,
      rowCount: reports.customerProductReportRows.length,
      days: CUSTOMER_PRODUCT_REPORT_DAYS,
      fromDate: reports.productPeriod.startDate,
      toDate: reports.productPeriod.endDate,
      purchasedQuantity: reports.customerProductReportRows.reduce(
        (total, row) => total + numberValue(row.purchasedQuantity),
        0
      )
    }
  };
}

if (require.main === module) {
  syncCustomerReport()
    .then(result => console.log(JSON.stringify({ ok: true, ...result })))
    .catch(error => {
      console.error(error.stack || error.message || String(error));
      process.exit(1);
    });
}

module.exports = {
  HEADERS,
  aggregateCustomerReport,
  aggregateCustomerProductReport,
  buildSheetValues,
  buildCustomerProductSheetValues,
  buildCustomerProductSheetNotes,
  toGoogleSheetsDateSerial,
  summarizeCustomerReport,
  formatTransactionDateTime,
  getCurrentMonthRange,
  getRollingDayRange,
  syncCustomerReport
};
