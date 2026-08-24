const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppsScript() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src-dashboard/kiotviet/CustomerReport.gs'),
    'utf8'
  );
  const context = vm.createContext({ console });
  vm.runInContext(source, context, { filename: 'CustomerReport.gs' });
  return context;
}

function loadDiscontinuedProducts(context) {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src-dashboard/kiotviet/DiscontinuedProducts.gs'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'DiscontinuedProducts.gs' });
}

function readScheduleDocumentation(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

test('operator documentation uses staggered report schedules instead of obsolete shared 07:00 claims', () => {
  const inScopeFiles = [
    'src-dashboard/kiotviet/CustomerReport.gs',
    'src-dashboard/kiotviet/WebhookAdmin.gs',
    'src-dashboard/HuongDanSuDung.gs',
    'README.md',
    'docs/01-brd/BRD_Dashboard_GoogleSheets.md',
    'docs/02-srs/SRS_Dashboard_GoogleSheets.md',
    'docs/04-planning/implementation_plan.md'
  ];
  const obsoleteClaims = [
    'đối soát toàn bộ lúc gần 07:00',
    '3 báo cáo lúc 07:00',
    'lịch 07:00 mỗi ngày',
    'trigger cập nhật ba báo cáo hàng ngày gần 07:00'
  ];

  for (const relativePath of inScopeFiles) {
    const contents = readScheduleDocumentation(relativePath).toLocaleLowerCase('vi-VN');
    for (const obsoleteClaim of obsoleteClaims) {
      assert.ok(
        !contents.includes(obsoleteClaim),
        `${relativePath} must not claim "${obsoleteClaim}"`
      );
    }
  }

  for (const relativePath of [
    'README.md',
    'src-dashboard/HuongDanSuDung.gs',
    'docs/02-srs/SRS_Dashboard_GoogleSheets.md'
  ]) {
    const contents = readScheduleDocumentation(relativePath);
    for (const scheduleTime of ['06:00', '06:30', '07:00', '07:30']) {
      assert.ok(
        contents.includes(scheduleTime),
        `${relativePath} must document the ${scheduleTime} schedule`
      );
    }
  }
});

function createTriggerRecorder(existingHandlers = []) {
  const createdTriggers = [];
  const deletedHandlers = [];

  return {
    createdTriggers,
    deletedHandlers,
    scriptApp: {
      getProjectTriggers: () => existingHandlers.map(handler => ({
        getHandlerFunction: () => handler
      })),
      deleteTrigger: trigger => deletedHandlers.push(trigger.getHandlerFunction()),
      newTrigger: handler => {
        const trigger = { handler };
        const builder = {
          timeBased: () => builder,
          atHour: hour => {
            trigger.hour = hour;
            return builder;
          },
          nearMinute: minute => {
            trigger.minute = minute;
            return builder;
          },
          everyDays: () => builder,
          inTimezone: timezone => {
            trigger.timezone = timezone;
            return builder;
          },
          create: () => createdTriggers.push(trigger)
        };
        return builder;
      }
    }
  };
}

function customerReportFormatDate(date, timezone, format) {
  assert.equal(timezone, 'Asia/Ho_Chi_Minh');
  if (format === 'yyyy-MM-dd') return '2026-08-20';
  const vietnam = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  if (format === 'H') return String(vietnam.getUTCHours());
  if (format === 'm') return String(vietnam.getUTCMinutes());
  throw new Error('Unexpected date format: ' + format);
}

function createCustomerReportHarness() {
  const context = loadAppsScript();
  const writes = [];
  const fetched = [];
  const properties = {};

  context.CONFIG = {
    SHEET_CUSTOMER_REPORT: 'Báo cáo bán hàng',
    SHEET_CUSTOMER_PRODUCT_REPORT: 'Hàng bán theo khách',
    SHEET_CUSTOMER_BY_PRODUCT_REPORT: 'Khách theo hàng hóa'
  };
  context.getKiotVietToken = () => 'token';
  context.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };
  context.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: key => properties[key],
      setProperty: (key, value) => {
        properties[key] = value;
      },
      setProperties: values => Object.assign(properties, values)
    })
  };
  context.Utilities = {
    formatDate: customerReportFormatDate,
    sleep: () => {}
  };
  context.SpreadsheetApp = { flush: () => {} };
  context.Logger = { log: () => {} };
  context.fetchCustomerReportPages_ = endpoint => {
    fetched.push(endpoint);
    return [];
  };
  context.getCustomerReportAllTimeRange_ = () => ({
    startLabel: 'Từ trước đến nay',
    endLabel: '20/08/2026'
  });
  context.getCustomerReportRollingRange_ = () => ({
    startLabel: '22/05/2026',
    endLabel: '20/08/2026'
  });
  context.aggregateCustomerReport_ = () => [{ customerId: 1 }];
  context.summarizeCustomerReport_ = () => ({
    transactionCount: 2,
    revenue: 300,
    returnValue: 50,
    netRevenue: 250
  });
  context.aggregateCustomerProductReport_ = () => [{ purchasedQuantity: 4 }];
  context.buildCustomerByProductMetadataLookup_ = () => ({});
  context.aggregateCustomerByProductReport_ = () => ({
    rows: [{ productCode: 'SP-1' }],
    productCount: 1,
    customerProductCount: 1,
    purchasedQuantity: 4,
    revenue: 300,
    returnedQuantity: 1,
    returnValue: 50,
    netRevenue: 250
  });
  context.writeCustomerReportSheet_ = () => writes.push('sales');
  context.writeCustomerProductReportSheet_ = () => writes.push('customerProduct');
  context.writeCustomerByProductReportSheet_ = () => writes.push('customerByProduct');

  return { context, writes, fetched, properties };
}

test('syncSalesCustomerReport writes only Báo cáo bán hàng', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncSalesCustomerReport();

  assert.deepEqual(writes, ['sales']);
  assert.deepEqual(fetched, ['invoices', 'returns', 'customers']);
  assert.equal(result.sheetName, 'Báo cáo bán hàng');
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

test('syncCustomerProductReport writes only Hàng bán theo khách', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncCustomerProductReport();

  assert.deepEqual(writes, ['customerProduct']);
  assert.deepEqual(fetched, ['invoices']);
  assert.equal(result.sheetName, 'Hàng bán theo khách');
  assert.equal(properties.CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

test('syncCustomerByProductReport writes only Khách theo hàng hóa', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncCustomerByProductReport();

  assert.deepEqual(writes, ['customerByProduct']);
  assert.deepEqual(fetched, ['invoices', 'returns', 'customers']);
  assert.equal(result.sheetName, 'Khách theo hàng hóa');
  assert.equal(properties.CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

test('syncCustomerReport refreshes all reports and records every last-sync date', () => {
  const { context, writes, fetched, properties } = createCustomerReportHarness();
  const result = context.syncCustomerReport();

  assert.deepEqual(writes, ['sales', 'customerProduct', 'customerByProduct']);
  assert.deepEqual(fetched, ['invoices', 'returns', 'customers']);
  assert.equal(result.sheetName, 'Báo cáo bán hàng');
  assert.equal(result.customerProductReport.sheetName, 'Hàng bán theo khách');
  assert.equal(result.customerByProductReport.sheetName, 'Khách theo hàng hóa');
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, '2026-08-20');
  assert.equal(properties.CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
  assert.equal(properties.CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

test('setupCustomerReportDailyTrigger creates staggered schedules and replaces only report triggers', () => {
  const { context } = createCustomerReportHarness();
  const recorder = createTriggerRecorder([
    'syncCustomerReport',
    'syncSalesCustomerReport',
    'syncCustomerProductReport',
    'syncCustomerByProductReport',
    'unrelatedHandler'
  ]);
  context.ScriptApp = recorder.scriptApp;

  context.setupCustomerReportDailyTrigger();

  assert.deepEqual(recorder.createdTriggers, [
    { handler: 'syncSalesCustomerReport', hour: 6, minute: 0, timezone: 'Asia/Ho_Chi_Minh' },
    { handler: 'syncCustomerProductReport', hour: 6, minute: 30, timezone: 'Asia/Ho_Chi_Minh' },
    { handler: 'syncCustomerByProductReport', hour: 7, minute: 0, timezone: 'Asia/Ho_Chi_Minh' }
  ]);
  assert.deepEqual(recorder.deletedHandlers, [
    'syncCustomerReport',
    'syncSalesCustomerReport',
    'syncCustomerProductReport',
    'syncCustomerByProductReport'
  ]);
  assert.ok(!recorder.deletedHandlers.includes('unrelatedHandler'));
});

test('setupHangNgungKinhDoanhTrigger_ schedules discontinued products for 07:30', () => {
  const recorder = createTriggerRecorder();
  const context = vm.createContext({
    console,
    CONFIG: { SHEET_DISCONTINUED_PRODUCTS: 'Hàng ngừng kinh doanh' },
    ScriptApp: recorder.scriptApp
  });
  loadDiscontinuedProducts(context);

  context.setupHangNgungKinhDoanhTrigger_();

  assert.deepEqual(recorder.createdTriggers, [
    { handler: 'capNhatHangNgungKinhDoanh', hour: 7, minute: 30, timezone: 'Asia/Ho_Chi_Minh' }
  ]);
});

test('syncCustomerReportIfDue_ runs each report at its independent due time once per day', () => {
  const { context, writes, properties } = createCustomerReportHarness();

  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T06:29:00+07:00')),
    1
  );
  assert.deepEqual(writes, ['sales']);

  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T06:30:00+07:00')),
    1
  );
  assert.deepEqual(writes, ['sales', 'customerProduct']);

  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T07:00:00+07:00')),
    1
  );
  assert.deepEqual(writes, ['sales', 'customerProduct', 'customerByProduct']);
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, '2026-08-20');
  assert.equal(properties.CUSTOMER_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
  assert.equal(properties.CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE, '2026-08-20');
});

test('syncCustomerReportIfDue_ retries a failed report without recording success', () => {
  const { context, writes, properties } = createCustomerReportHarness();
  let shouldFail = true;
  context.writeCustomerReportSheet_ = () => {
    if (shouldFail) throw new Error('write failed');
    writes.push('sales');
  };

  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T06:29:00+07:00')),
    0
  );
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, undefined);

  shouldFail = false;
  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T06:29:00+07:00')),
    1
  );
  assert.deepEqual(writes, ['sales']);
  assert.equal(properties.CUSTOMER_REPORT_LAST_SYNC_DATE, '2026-08-20');
});
