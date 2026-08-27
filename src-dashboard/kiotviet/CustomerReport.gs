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
const CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION = 'kiotviet-export-23-columns-v2';
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
// Chi lay du lieu tu dau nam 2026 tro ve day de tranh fetch toan bo lich su
// KiotViet (tung gay timeout 6 phut cua Apps Script). Doi ngay nay neu can
// mo rong pham vi bao cao.
const CUSTOMER_REPORT_MIN_DATE_TEXT = '2026-01-01';
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
 * ==========================================
 * DONG BO PHAN DOAN (CHUNKED) CHO BAO CAO KHACH HANG
 * ==========================================
 * Voi tai khoan co nhieu du lieu, fetch+aggregate toan bo trong 1 lan goi ham
 * de bi vuot qua gioi han thuc thi 6 phut cua Apps Script. runCustomerReportChunkedJob_
 * chia cong viec thanh nhieu "tick" (moi tick toi da CUSTOMER_REPORT_CHUNK_CONFIG.MAX_RUN_SECONDS),
 * luu tien do (stage + currentItem) vao Script Properties va du lieu tho vao
 * cac sheet an tam (staging). syncCustomerReportIfDue_ (WebhookQueue.gs) da goi
 * lai handler nay moi phut neu bao cao chua xong hom nay, nen no tu dong "chay
 * tiep" qua nhieu tick ma khong can trigger rieng.
 */
const CUSTOMER_REPORT_CHUNK_CONFIG = Object.freeze({
  PAGE_SIZE: 100,
  MAX_RUN_SECONDS: 270 // dung an toan sau 4.5 phut de tranh timeout 6 phut cua Google
});

function customerReportStagingSheetName_(jobKey, stageKey) {
  return '_KV_CR_RAW_' + jobKey.toUpperCase() + '_' + stageKey.toUpperCase();
}

function ensureCustomerReportStagingSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = createCompactSheet_(spreadsheet, sheetName, 1, 1);
    sheet.hideSheet();
  }
  return sheet;
}

// Gioi han o cua Google Sheets la 50.000 ky tu; mot so hoa don co rat nhieu
// dong chi tiet nen JSON co the vuot qua muc do. Chia JSON moi ban ghi thanh
// nhieu o tren cung 1 dong (duoi muc gioi han) va ghep lai khi doc.
const CUSTOMER_REPORT_STAGING_CELL_LIMIT = 45000;

function splitCustomerReportJsonForStaging_(json) {
  const chunks = [];
  for (let i = 0; i < json.length; i += CUSTOMER_REPORT_STAGING_CELL_LIMIT) {
    chunks.push(json.substring(i, i + CUSTOMER_REPORT_STAGING_CELL_LIMIT));
  }
  return chunks.length > 0 ? chunks : [''];
}

function appendCustomerReportRawItems_(sheetName, items) {
  if (!items || items.length === 0) return;
  const sheet = ensureCustomerReportStagingSheet_(sheetName);
  const itemChunks = items.map(item => splitCustomerReportJsonForStaging_(JSON.stringify(item)));
  const maxCols = itemChunks.reduce((max, chunks) => Math.max(max, chunks.length), 1);
  const rows = itemChunks.map(chunks => {
    const row = chunks.slice();
    while (row.length < maxCols) row.push('');
    return row;
  });
  const startRow = sheet.getLastRow() + 1;
  ensureSheetGridCapacity_(sheet, startRow + rows.length - 1, maxCols);
  sheet.getRange(startRow, 1, rows.length, maxCols).setValues(rows);
}

function readCustomerReportRawItems_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 1) return [];
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, sheet.getLastRow(), lastColumn).getValues();
  return values
    .map(row => {
      const json = row.join('');
      if (!json) return null;
      try { return JSON.parse(json); } catch (e) { return null; }
    })
    .filter(item => item !== null);
}

function clearCustomerReportStagingSheet_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (sheet) spreadsheet.deleteSheet(sheet);
}

/**
 * Fetch mot endpoint theo trang, ghi truc tiep vao sheet staging sau moi
 * trang (khong giu ca mang trong bo nho) cho toi khi het du lieu, dung som
 * (returns, xem stopDateField) hoac cham nguong thoi gian cua tick nay.
 */
function fetchCustomerReportEndpointChunk_(
  endpoint, token, query, progress, sheetName, deadlineMs, stopDateField, stopMinimumTime
) {
  let currentItem = Number(progress.currentItem) || 0;
  let total = Number(progress.total) || 0;

  while (new Date().getTime() < deadlineMs) {
    const params = Object.assign({}, query || {}, {
      pageSize: CUSTOMER_REPORT_CHUNK_CONFIG.PAGE_SIZE,
      currentItem: currentItem
    });
    const queryString = Object.keys(params)
      .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))
      .join('&');
    const url = 'https://public.kiotapi.com/' + endpoint + '?' + queryString;
    const result = fetchCustomerReportJsonWithRetry_(url, token, endpoint);
    const pageItems = Array.isArray(result.data) ? result.data : [];
    total = Number(result.total) || 0;

    if (pageItems.length === 0) return { currentItem: currentItem, total: total, done: true };

    appendCustomerReportRawItems_(sheetName, pageItems);
    currentItem += pageItems.length;

    if (stopDateField && isFinite(stopMinimumTime)) {
      const pageTimes = pageItems
        .map(item => new Date(item[stopDateField]).getTime())
        .filter(time => isFinite(time));
      if (pageTimes.length > 0 && Math.max.apply(null, pageTimes) < stopMinimumTime) {
        return { currentItem: currentItem, total: total, done: true };
      }
    }

    if (currentItem >= total) return { currentItem: currentItem, total: total, done: true };
    Utilities.sleep(120);
  }

  return { currentItem: currentItem, total: total, done: false };
}

/**
 * Chay mot "tick" (toi da MAX_RUN_SECONDS) cho mot job bao cao khach hang.
 * jobConfig:
 *   - period: khoang thoi gian (dung cho invoices va early-stop cua returns)
 *   - needsReturns/needsCustomers: co can fetch endpoint do khong
 *   - buildQuery(stageKey): tra ve query params cho tung endpoint
 *   - finalize({invoices, returns, customers, period}): aggregate + ghi sheet,
 *     tra ve ket qua tom tat de hien thi
 * Tra ve { isCompleted:false } neu tick nay chua fetch xong; lan goi tiep theo
 * (do syncCustomerReportIfDue_ hoac nguoi dung chay lai) se tiep tuc tu diem dung.
 */
function runCustomerReportChunkedJob_(jobKey, jobConfig) {
  return withCustomerReportLock_(function() {
    const startMs = new Date().getTime();
    const deadlineMs = startMs + CUSTOMER_REPORT_CHUNK_CONFIG.MAX_RUN_SECONDS * 1000;
    const token = requireCustomerReportToken_();
    const props = PropertiesService.getScriptProperties();
    const stateKey = 'CUSTOMER_REPORT_JOB_STATE_' + jobKey;

    let state = {};
    try {
      const raw = props.getProperty(stateKey);
      if (raw) state = JSON.parse(raw);
    } catch (e) {
      state = {};
    }

    const stages = ['invoices']
      .concat(jobConfig.needsReturns ? ['returns'] : [])
      .concat(jobConfig.needsCustomers ? ['customers'] : []);
    let stageIndex = Number(state.stageIndex) || 0;
    const progress = state.progress || {};

    if (stageIndex === 0 && !state.progress) {
      // Lan dau cua job (khong phai tick tiep suc): don staging cu neu co.
      stages.forEach(stageKey => clearCustomerReportStagingSheet_(customerReportStagingSheetName_(jobKey, stageKey)));
    }

    while (stageIndex < stages.length && new Date().getTime() < deadlineMs) {
      const stageKey = stages[stageIndex];
      const sheetName = customerReportStagingSheetName_(jobKey, stageKey);
      const stageProgress = progress[stageKey] || { currentItem: 0, total: 0 };
      const stageResult = fetchCustomerReportEndpointChunk_(
        stageKey,
        token,
        jobConfig.buildQuery(stageKey),
        stageProgress,
        sheetName,
        deadlineMs,
        stageKey === 'returns' ? 'returnDate' : null,
        stageKey === 'returns' ? jobConfig.period.start.getTime() : null
      );
      progress[stageKey] = { currentItem: stageResult.currentItem, total: stageResult.total };
      logCustomerReportStep_(jobKey, startMs, 'fetch ' + stageKey, stageResult.currentItem + '/' + stageResult.total);

      if (stageResult.done) {
        stageIndex++;
      } else {
        break;
      }
    }

    if (stageIndex < stages.length) {
      props.setProperty(stateKey, JSON.stringify({ stageIndex: stageIndex, progress: progress }));
      Logger.log('[%s] Chua fetch xong, se tiep tuc o lan chay ke tiep (dang o buoc: %s).', jobKey, stages[stageIndex]);
      return { isCompleted: false, jobKey: jobKey };
    }

    // Tach buoc aggregate/write sang mot tick rieng. Bao cao Khach theo hang hoa
    // co the tao gan 90.000 dong; neu vua fetch xong vua tong hop trong cung mot
    // lan chay, Apps Script co the timeout sau khi da ghi mot phan sheet dich.
    if (!state.readyToFinalize && new Date().getTime() - startMs > 30000) {
      props.setProperty(stateKey, JSON.stringify({
        stageIndex: stageIndex,
        progress: progress,
        readyToFinalize: true
      }));
      Logger.log('[%s] Da fetch xong; se aggregate va ghi sheet trong tick ke tiep.', jobKey);
      return { isCompleted: false, jobKey: jobKey, phase: 'finalize' };
    }

    const invoices = readCustomerReportRawItems_(customerReportStagingSheetName_(jobKey, 'invoices'));
    const returns = jobConfig.needsReturns
      ? readCustomerReportRawItems_(customerReportStagingSheetName_(jobKey, 'returns'))
      : [];
    const customers = jobConfig.needsCustomers
      ? readCustomerReportRawItems_(customerReportStagingSheetName_(jobKey, 'customers'))
      : [];
    logCustomerReportStep_(jobKey, startMs, 'da fetch xong, bat dau aggregate', invoices.length);

    const result = jobConfig.finalize({
      invoices: invoices,
      returns: returns,
      customers: customers,
      period: jobConfig.period
    });

    stages.forEach(stageKey => clearCustomerReportStagingSheet_(customerReportStagingSheetName_(jobKey, stageKey)));
    props.deleteProperty(stateKey);
    logCustomerReportStep_(jobKey, startMs, 'HOAN TAT', invoices.length);

    return Object.assign({ isCompleted: true, jobKey: jobKey }, result);
  });
}

function salesCustomerReportFinalize_(data) {
  const rows = aggregateCustomerReport_(data.invoices, data.returns, data.period, data.customers);
  const summary = summarizeCustomerReport_(rows);
  writeCustomerReportSheet_(rows, data.period);
  PropertiesService.getScriptProperties().setProperty(
    CUSTOMER_REPORT_LAST_SYNC_PROPERTY, customerReportToday_()
  );
  return buildCustomerSalesReportResult_(rows, summary, data.period);
}

function customerProductReportFinalize_(data) {
  const rows = aggregateCustomerProductReport_(data.invoices, data.period);
  writeCustomerProductReportSheet_(rows, data.period);
  PropertiesService.getScriptProperties().setProperties({
    [CUSTOMER_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: customerReportToday_(),
    [CUSTOMER_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_PRODUCT_REPORT_SCHEMA_VERSION
  });
  return buildCustomerProductReportResult_(rows, data.period);
}

function customerByProductReportFinalize_(data) {
  const metadataLookup = buildCustomerByProductMetadataLookup_();
  const report = aggregateCustomerByProductReport_(
    data.invoices, data.returns, data.period, data.customers, metadataLookup
  );
  writeCustomerByProductReportSheet_(report.rows, data.period);
  PropertiesService.getScriptProperties().setProperties({
    [CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_PROPERTY]: customerReportToday_(),
    [CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_PROPERTY]: CUSTOMER_BY_PRODUCT_REPORT_SCHEMA_VERSION
  });
  return buildCustomerByProductReportResult_(report, data.period);
}

function customerReportInvoiceQuery_(period) {
  return { status: 1, fromPurchaseDate: period.startQuery, toPurchaseDate: period.endQuery };
}

function customerReportSalesAndByProductQuery_(stageKey, period) {
  if (stageKey === 'invoices') return customerReportInvoiceQuery_(period);
  if (stageKey === 'returns') return { orderBy: 'returnDate', orderDirection: 'DESC' };
  return { includeCustomerGroup: true };
}

/**
 * Diem vao chay tay/menu: lam moi ca ba tab bao cao khach hang.
 * QUAN TRONG: chi chay MOT tick chunked (toi da ~4.5 phut, xem
 * runCustomerReportChunkedJob_) cho MOT bang moi lan goi ham nay - dung ngay
 * sau khi bang hien tai chua xong (isCompleted=false), KHONG duoc goi tiep
 * bang ke tiep trong cung 1 lan thuc thi, vi 2-3 tick cong lai (270s x 2-3)
 * se vuot qua gioi han thuc thi 6 phut cua Apps Script.
 * Voi tai khoan nhieu du lieu, chay ham nay nhieu lan (hoac de trigger hang
 * doi 5 phut tu dong tiep tuc qua syncCustomerReportIfDue_) cho toi khi ca
 * ba tab deu hoan tat.
 */
function syncCustomerReport() {
  const salesReport = syncSalesCustomerReport();
  if (!salesReport.isCompleted) return salesReport;

  salesReport.customerProductReport = syncCustomerProductReport();
  if (!salesReport.customerProductReport.isCompleted) return salesReport;

  salesReport.customerByProductReport = syncCustomerByProductReport();
  return salesReport;
}

/**
 * Diem vao chay tay, chi dong bo tab "Bao cao ban hang". Duoc goi lai nhieu
 * lan (tu syncCustomerReportIfDue_ moi phut, hoac nguoi dung chay lai bang
 * tay) cho toi khi fetch+aggregate xong; xem runCustomerReportChunkedJob_.
 */
function syncSalesCustomerReport() {
  const period = getCustomerReportAllTimeRange_(new Date());
  return runCustomerReportChunkedJob_('sales', {
    period: period,
    needsReturns: true,
    needsCustomers: true,
    buildQuery: stageKey => customerReportSalesAndByProductQuery_(stageKey, period),
    finalize: salesCustomerReportFinalize_
  });
}

/**
 * Diem vao chay tay, chi dong bo tab "Hang ban theo khach".
 */
function syncCustomerProductReport() {
  const period = getCustomerReportRollingRange_(new Date(), CUSTOMER_PRODUCT_REPORT_DAYS);
  return runCustomerReportChunkedJob_('product', {
    period: period,
    needsReturns: false,
    needsCustomers: false,
    buildQuery: () => customerReportInvoiceQuery_(period),
    finalize: customerProductReportFinalize_
  });
}

/**
 * Diem vao chay tay, chi dong bo tab "Khach theo hang hoa".
 */
function syncCustomerByProductReport() {
  const period = getCustomerReportAllTimeRange_(new Date());
  return runCustomerReportChunkedJob_('byProduct', {
    period: period,
    needsReturns: true,
    needsCustomers: true,
    buildQuery: stageKey => customerReportSalesAndByProductQuery_(stageKey, period),
    finalize: customerByProductReportFinalize_
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

/**
 * Ghi log thoi gian tich luy (giay) tu luc bat dau tick hien tai cua job
 * `jobKey` den het buoc `stepName`, kem so dong/ban ghi de biet buoc nao
 * ton thoi gian nhat (fetch API hay aggregate hay ghi sheet).
 */
function logCustomerReportStep_(jobKey, startMs, stepName, itemCount) {
  const elapsedSeconds = ((new Date().getTime() - startMs) / 1000).toFixed(1);
  Logger.log('[%s] %s: %s, %ss tu luc bat dau tick nay.', jobKey, stepName, itemCount, elapsedSeconds);
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
 * Duoc goi boi trigger hang doi 5 phut dang co san. Moi luot chi thu mot bao
 * cao den han de khong day processWebhookQueue toi gioi han thuc thi; cac bao
 * cao con lai se duoc thu o nhung phut ke tiep.
 */
function syncCustomerReportIfDue_(now) {
  now = now || new Date();
  const today = Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const hour = Number(Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'H'));
  const minute = Number(Utilities.formatDate(now, CUSTOMER_REPORT_TIME_ZONE, 'm'));
  const minuteOfDay = hour * 60 + minute;
  const properties = PropertiesService.getScriptProperties();
  for (let index = 0; index < CUSTOMER_REPORT_CATCH_UP_DEFINITIONS.length; index++) {
    const definition = CUSTOMER_REPORT_CATCH_UP_DEFINITIONS[index];
    if (minuteOfDay < definition.minuteOfDay) continue;

    const syncedToday = properties.getProperty(definition.lastSyncProperty) === today;
    const currentSchema = !definition.schemaProperty ||
      properties.getProperty(definition.schemaProperty) === definition.schemaVersion;
    if (syncedToday && currentSchema) continue;

    try {
      definition.handler();
      return 1;
    } catch (error) {
      Logger.log(
        'Loi dong bo ' + definition.lastSyncProperty + ', se thu lai o phut sau: ' +
        error.toString()
      );
      return 0;
    }
  }

  return 0;
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
 * Khoang thoi gian tu dau nam 2026 (CUSTOMER_REPORT_MIN_DATE_TEXT) den het
 * ngay hien tai theo gio Viet Nam. Gioi han moc bat dau de tranh fetch toan
 * bo lich su KiotViet.
 */
function getCustomerReportAllTimeRange_(now) {
  const current = now || new Date();
  const todayText = Utilities.formatDate(current, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');
  const tomorrow = new Date(current.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowText = Utilities.formatDate(tomorrow, CUSTOMER_REPORT_TIME_ZONE, 'yyyy-MM-dd');

  return {
    start: new Date(CUSTOMER_REPORT_MIN_DATE_TEXT + 'T00:00:00+07:00'),
    endExclusive: new Date(tomorrowText + 'T00:00:00+07:00'),
    startQuery: CUSTOMER_REPORT_MIN_DATE_TEXT + 'T00:00:00',
    endQuery: todayText + 'T23:59:59',
    startLabel: customerReportDateLabel_(CUSTOMER_REPORT_MIN_DATE_TEXT),
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
      // Sap xep TANG DAN theo thoi gian giao dich de giao dich moi nhat nam o
      // CUOI nhom cua tung khach hang thay vi dau nhom.
      customer.transactions.sort((left, right) => {
        if (left.transactionTimeMs !== right.transactionTimeMs) {
          return left.transactionTimeMs - right.transactionTimeMs;
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
      // Sap xep TANG DAN theo thoi gian mua de giao dich moi nhat nam o CUOI
      // nhom cua tung khach hang thay vi dau nhom.
      customer.sales.sort((left, right) => {
        if (left.purchaseTimeMs !== right.purchaseTimeMs) {
          return left.purchaseTimeMs - right.purchaseTimeMs;
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
  const lookup = {};

  values.slice(1).forEach(row => {
    const code = customerReportText_(row[codeIndex]);
    if (!code) return;
    lookup[code.toLocaleLowerCase()] = {
      productCode: customerReportSafeText_(code),
      productName: nameIndex === -1 ? '' : customerReportSafeText_(row[nameIndex]),
      categoryName: categoryIndex === -1 ? '' : customerReportSafeText_(row[categoryIndex])
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
  // Sap xep TANG DAN theo thoi gian mua de du lieu moi nhat nam o CUOI bang.
  if (left.purchaseTimeMs !== right.purchaseTimeMs) {
    return left.purchaseTimeMs - right.purchaseTimeMs;
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
    'Thời gian: ' + period.startLabel + ' - ' + period.endLabel + '\n' +
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
    'Tự động cập nhật từ webhook KiotViet trong khoảng 5 phút; đối soát toàn bộ lúc gần 06:30.'
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
    sheet.getRange(2, 1, rows.length, 3).setNumberFormat('@');
    sheet.getRange(2, 10, rows.length, 3).setNumberFormat('@');
    sheet.getRange(2, 18, rows.length, 2).setNumberFormat('@');
    [4, 5, 7, 13, 15, 21].forEach(column => {
      sheet.getRange(2, column, rows.length, 1).setNumberFormat('#,##0.##');
    });
    [6, 8, 9, 14, 16, 17, 22, 23].forEach(column => {
      sheet.getRange(2, column, rows.length, 1).setNumberFormat('#,##0');
    });
    sheet.getRange(2, 20, rows.length, 1).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    populatedRange.createFilter();
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  sheet.setTabColor('#00A6A6');
  const widths = [
    230, 125, 300, 105, 135, 155, 135, 150, 170, 115, 210,
    130, 145, 165, 140, 155, 175, 125, 165, 175, 105, 125, 145
  ];
  widths.forEach((width, index) => sheet.setColumnWidth(index + 1, width));
  sheet.setRowHeight(1, 48);
  compactUnusedSheetGrid_(sheet);
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
    // Sap xep TANG DAN theo ngay mua (cot 5) de du lieu moi nhat nam o CUOI bang.
    sheet.getRange(2, 1, sheet.getLastRow() - 1, CUSTOMER_PRODUCT_REPORT_HEADERS.length)
      .sort({ column: 5, ascending: true });
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
