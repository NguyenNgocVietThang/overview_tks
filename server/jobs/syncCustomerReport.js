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
const HEADERS = ['Mã KH', 'Khách hàng', 'Doanh thu', 'Giá trị trả', 'Doanh thu thuần'];
const CUSTOMER_PRODUCT_REPORT_DAYS = 90;
const CUSTOMER_PRODUCT_HEADERS = [
  'Mã KH',
  'Khách hàng',
  'SL mua',
  'Doanh thu',
  'SL Trả',
  'Giá trị trả',
  'Doanh thu thuần'
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

function aggregateCustomerReport(invoices, returns, period) {
  const customers = new Map();

  const addAmount = (item, revenue, returnValue) => {
    const customerId = item.customerId == null ? '' : String(item.customerId);
    const customerCode = String(item.customerCode || '').trim();
    const customerName = String(item.customerName || 'Khách lẻ').trim() || 'Khách lẻ';
    const key = customerId
      ? `id:${customerId}`
      : (customerCode ? `code:${customerCode}` : `name:${customerName.toLowerCase()}`);

    if (!customers.has(key)) {
      customers.set(key, {
        customerCode,
        customerName,
        revenue: 0,
        returnValue: 0
      });
    }

    const customer = customers.get(key);
    if (!customer.customerCode && customerCode) customer.customerCode = customerCode;
    customer.revenue += Number(revenue || 0);
    customer.returnValue += Number(returnValue || 0);
  };

  for (const invoice of invoices || []) {
    const purchaseTime = Date.parse(invoice.purchaseDate);
    if (
      Number(invoice.status) === 1 &&
      purchaseTime >= period.startTime &&
      purchaseTime < period.endExclusiveTime
    ) {
      addAmount(invoice, invoice.total, 0);
    }
  }

  for (const returnItem of returns || []) {
    const returnTime = Date.parse(returnItem.returnDate);
    if (
      Number(returnItem.status) === 1 &&
      returnTime >= period.startTime &&
      returnTime < period.endExclusiveTime
    ) {
      addAmount(returnItem, 0, returnItem.returnTotal);
    }
  }

  return [...customers.values()]
    .map(customer => ({
      ...customer,
      netRevenue: customer.revenue - customer.returnValue
    }))
    .sort((left, right) =>
      right.netRevenue - left.netRevenue ||
      right.revenue - left.revenue ||
      left.customerCode.localeCompare(right.customerCode)
    );
}

function sumDetailQuantity(details) {
  return (Array.isArray(details) ? details : []).reduce((total, detail) => {
    const quantity = Number(detail && detail.quantity);
    return total + (Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function aggregateCustomerProductReport(invoices, returns, period) {
  const customers = new Map();

  const addAmount = (item, purchasedQuantity, revenue, returnedQuantity, returnValue) => {
    const customerId = item.customerId == null ? '' : String(item.customerId).trim();
    const customerCode = String(item.customerCode || '').trim();
    const customerName = String(item.customerName || 'Khách lẻ').trim() || 'Khách lẻ';
    const key = customerId
      ? `id:${customerId}`
      : (customerCode ? `code:${customerCode}` : `name:${customerName.toLowerCase()}`);

    if (!customers.has(key)) {
      customers.set(key, {
        customerCode,
        customerName,
        purchasedQuantity: 0,
        revenue: 0,
        returnedQuantity: 0,
        returnValue: 0
      });
    }

    const customer = customers.get(key);
    if (!customer.customerCode && customerCode) customer.customerCode = customerCode;
    if (customer.customerName === 'Khách lẻ' && customerName !== 'Khách lẻ') {
      customer.customerName = customerName;
    }
    customer.purchasedQuantity += Number(purchasedQuantity || 0);
    customer.revenue += Number(revenue || 0);
    customer.returnedQuantity += Number(returnedQuantity || 0);
    customer.returnValue += Number(returnValue || 0);
  };

  for (const invoice of invoices || []) {
    const purchaseTime = Date.parse(invoice.purchaseDate);
    if (
      Number(invoice.status) === 1 &&
      purchaseTime >= period.startTime &&
      purchaseTime < period.endExclusiveTime
    ) {
      addAmount(invoice, sumDetailQuantity(invoice.invoiceDetails), invoice.total, 0, 0);
    }
  }

  for (const returnItem of returns || []) {
    const returnTime = Date.parse(returnItem.returnDate);
    if (
      Number(returnItem.status) === 1 &&
      returnTime >= period.startTime &&
      returnTime < period.endExclusiveTime
    ) {
      addAmount(returnItem, 0, 0, sumDetailQuantity(returnItem.returnDetails), returnItem.returnTotal);
    }
  }

  return [...customers.values()]
    .map(customer => ({
      ...customer,
      netRevenue: customer.revenue - customer.returnValue
    }))
    .sort((left, right) =>
      right.netRevenue - left.netRevenue ||
      right.revenue - left.revenue ||
      left.customerCode.localeCompare(right.customerCode)
    );
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
  const [invoices, returns] = await Promise.all([
    fetchAllKiotVietPages('invoices', headers, {
      fromPurchaseDate: productPeriod.startQuery,
      toPurchaseDate: productPeriod.endQuery,
      status: '1'
    }),
    fetchAllKiotVietPages('returns', headers, {
      orderBy: 'returnDate',
      orderDirection: 'DESC'
    })
  ]);

  return {
    monthPeriod,
    productPeriod,
    customerReportRows: aggregateCustomerReport(invoices, returns, monthPeriod),
    customerProductReportRows: aggregateCustomerProductReport(invoices, returns, productPeriod)
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
  const totals = reportRows.reduce((summary, row) => {
    summary.revenue += row.revenue;
    summary.returnValue += row.returnValue;
    summary.netRevenue += row.netRevenue;
    return summary;
  }, { revenue: 0, returnValue: 0, netRevenue: 0 });

  return [
    HEADERS,
    [
      `SL khách hàng: ${reportRows.length}`,
      '',
      totals.revenue,
      totals.returnValue,
      totals.netRevenue
    ],
    ...reportRows.map(row => [
      row.customerCode,
      row.customerName,
      row.revenue,
      row.returnValue,
      row.netRevenue
    ])
  ];
}

function buildCustomerProductSheetValues(reportRows) {
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

  return [
    CUSTOMER_PRODUCT_HEADERS,
    [
      `SL khách hàng: ${reportRows.length}`,
      '',
      totals.purchasedQuantity,
      totals.revenue,
      totals.returnedQuantity,
      totals.returnValue,
      totals.netRevenue
    ],
    ...reportRows.map(row => [
      row.customerCode,
      row.customerName,
      row.purchasedQuantity,
      row.revenue,
      row.returnedQuantity,
      row.returnValue,
      row.netRevenue
    ])
  ];
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
          numberFormat: { type: 'NUMBER', pattern: numberFormat.pattern }
        }
      },
      fields: 'userEnteredFormat.numberFormat'
    }
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: { frozenRowCount: 2 },
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
                  rgbColor: { red: 0.663, green: 0.871, blue: 0.957 }
                },
                textFormat: { bold: true },
                horizontalAlignment: 'CENTER'
              }
            },
            fields: 'userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)'
          }
        },
        {
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
        },
        ...numberFormatRequests,
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
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: options.columnCount
            }
          }
        }
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
  const monthStart = reports.monthPeriod.startQuery.slice(0, 10);
  const monthEnd = reports.monthPeriod.endQuery.slice(0, 10);

  await Promise.all([
    writeReportSheet(sheets, spreadsheetId, customerSheetProperties, customerValues, {
      sheetName: REPORT_SHEET_NAME,
      columnCount: HEADERS.length,
      tabColor: { red: 0.051, green: 0.431, blue: 0.992 },
      numberFormats: [{ startColumnIndex: 2, endColumnIndex: 5, pattern: '#,##0' }],
      note:
        'Kiểu hiển thị: Báo cáo\n' +
        'Mối quan tâm: Bán hàng\n' +
        `Thời gian: Tháng này (${formatDateLabel(monthStart)} - ${formatDateLabel(monthEnd)})\n` +
        'Tự động cập nhật hàng ngày lúc 07:00.'
    }),
    writeReportSheet(sheets, spreadsheetId, productSheetProperties, productValues, {
      sheetName: CUSTOMER_PRODUCT_REPORT_SHEET_NAME,
      columnCount: CUSTOMER_PRODUCT_HEADERS.length,
      tabColor: { red: 0, green: 0.651, blue: 0.651 },
      numberFormats: [
        { startColumnIndex: 2, endColumnIndex: 3, pattern: '#,##0' },
        { startColumnIndex: 3, endColumnIndex: 4, pattern: '#,##0' },
        { startColumnIndex: 4, endColumnIndex: 5, pattern: '#,##0' },
        { startColumnIndex: 5, endColumnIndex: 7, pattern: '#,##0' }
      ],
      note:
        'Kiểu hiển thị: Báo cáo\n' +
        'Mối quan tâm: Hàng bán theo khách\n' +
        `Thời gian: 90 ngày qua (${formatDateLabel(reports.productPeriod.startDate)} - ` +
        `${formatDateLabel(reports.productPeriod.endDate)})\n` +
        'Tự động cập nhật hàng ngày lúc 07:00.'
    })
  ]);

  return {
    sheetName: REPORT_SHEET_NAME,
    customerCount: reports.customerReportRows.length,
    totalRevenue: customerValues[1][2],
    totalReturns: customerValues[1][3],
    netRevenue: customerValues[1][4],
    customerProductReport: {
      sheetName: CUSTOMER_PRODUCT_REPORT_SHEET_NAME,
      customerCount: reports.customerProductReportRows.length,
      days: CUSTOMER_PRODUCT_REPORT_DAYS,
      fromDate: reports.productPeriod.startDate,
      toDate: reports.productPeriod.endDate,
      purchasedQuantity: productValues[1][2],
      totalRevenue: productValues[1][3],
      returnedQuantity: productValues[1][4],
      totalReturns: productValues[1][5],
      netRevenue: productValues[1][6]
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
  aggregateCustomerReport,
  aggregateCustomerProductReport,
  buildSheetValues,
  buildCustomerProductSheetValues,
  getCurrentMonthRange,
  getRollingDayRange,
  syncCustomerReport
};
