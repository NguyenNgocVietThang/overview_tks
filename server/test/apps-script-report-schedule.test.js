const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppsScript() {
  const helpersSource = fs.readFileSync(
    path.join(__dirname, '../../src-dashboard/utils/Helpers.gs'),
    'utf8'
  );
  const source = fs.readFileSync(
    path.join(__dirname, '../../src-dashboard/kiotviet/CustomerReport.gs'),
    'utf8'
  );
  const context = vm.createContext({ console });
  vm.runInContext(helpersSource, context, { filename: 'Helpers.gs' });
  vm.runInContext(source, context, { filename: 'CustomerReport.gs' });
  return context;
}

function readScheduleDocumentation(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8');
}

function createGridSheet(
  name, maxRows, maxColumns, lastRow = 1, lastColumn = 1,
  frozenRows = 0, frozenColumns = 0
) {
  let parent;
  const sheet = {
    getName: () => name,
    getParent: () => parent,
    setParent: value => { parent = value; },
    hideSheet: () => {},
    getMaxRows: () => maxRows,
    getMaxColumns: () => maxColumns,
    getFrozenRows: () => frozenRows,
    getFrozenColumns: () => frozenColumns,
    getLastRow: () => lastRow,
    getLastColumn: () => lastColumn,
    deleteRows: (start, count) => {
      if (maxRows - count <= frozenRows) throw new Error('Cannot delete all non-frozen rows');
      maxRows -= count;
    },
    deleteColumns: (start, count) => {
      if (maxColumns - count <= frozenColumns) throw new Error('Cannot delete all non-frozen columns');
      maxColumns -= count;
    },
    insertRowsAfter: (after, count) => { maxRows += count; },
    insertColumnsAfter: (after, count) => { maxColumns += count; },
    getRange: (row, column, rowCount = 1, columnCount = 1) => {
      if (row + rowCount - 1 > maxRows || column + columnCount - 1 > maxColumns) {
        throw new Error('Spreadsheet cell limit exceeded');
      }
      return {
        setValues: () => {
          lastRow = Math.max(lastRow, row + rowCount - 1);
          lastColumn = Math.max(lastColumn, column + columnCount - 1);
        }
      };
    }
  };
  return sheet;
}

function createGridSpreadsheet(initialSheets = []) {
  const sheets = initialSheets.slice();
  const spreadsheet = {
    getSheets: () => sheets.slice(),
    getSheetByName: name => sheets.find(sheet => sheet.getName() === name),
    insertSheet: (...args) => {
      if (args.length !== 1) throw new Error('Invalid argument: options. Should be of type: Map.');
      const sheet = createGridSheet(args[0], 1000, 26, 0, 0);
      sheet.setParent(spreadsheet);
      sheets.push(sheet);
      return sheet;
    }
  };
  sheets.forEach(sheet => sheet.setParent(spreadsheet));
  return spreadsheet;
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
    for (const scheduleTime of ['06:00', '06:30', '07:00']) {
      assert.ok(
        contents.includes(scheduleTime),
        `${relativePath} must document the ${scheduleTime} schedule`
      );
    }
  }
});

test('customer report staging keeps the fresh default grid while writing raw rows', () => {
  const context = loadAppsScript();
  const spreadsheet = createGridSpreadsheet();
  context.SpreadsheetApp = { getActiveSpreadsheet: () => spreadsheet };

  context.appendCustomerReportRawItems_('_KV_CR_RAW_TEST', [
    { id: 1, code: 'A' },
    { id: 2, code: 'B' }
  ]);

  const sheet = spreadsheet.getSheetByName('_KV_CR_RAW_TEST');
  assert.equal(sheet.getMaxRows(), 1000);
  assert.equal(sheet.getMaxColumns(), 26);
  assert.equal(sheet.getLastRow(), 2);
});

test('grid capacity helper reclaims unused cells before growing a full spreadsheet', () => {
  const context = loadAppsScript();
  const target = createGridSheet('Target', 1, 1, 1, 1);
  const bloated = createGridSheet('Bloated', 1000000, 10, 1, 1);
  const spreadsheet = createGridSpreadsheet([target, bloated]);

  context.ensureSheetGridCapacity_(target, 2, 2);

  assert.equal(target.getMaxRows(), 2);
  assert.equal(target.getMaxColumns(), 2);
  assert.equal(bloated.getMaxRows(), 1);
  assert.equal(bloated.getMaxColumns(), 1);
});

test('grid compaction preserves one unfrozen row and column', () => {
  const context = loadAppsScript();
  const frozen = createGridSheet('Frozen', 1000, 26, 1, 1, 1, 1);

  assert.doesNotThrow(() => context.compactUnusedSheetGrid_(frozen));
  assert.equal(frozen.getMaxRows(), 2);
  assert.equal(frozen.getMaxColumns(), 2);
});

test('compact sheet creation keeps a fresh staging sheet when grid inspection times out', () => {
  const context = loadAppsScript();
  const spreadsheet = createGridSpreadsheet();
  const fresh = createGridSheet('Staging', 1000, 26, 0, 0);
  fresh.setParent(spreadsheet);
  const readMaxRows = fresh.getMaxRows;
  let firstRead = true;
  fresh.getMaxRows = () => {
    if (firstRead) {
      firstRead = false;
      throw new Error('Service Spreadsheets timed out while accessing document');
    }
    return readMaxRows();
  };
  spreadsheet.insertSheet = () => fresh;

  const created = context.createCompactSheet_(spreadsheet, 'Staging', 1, 11);

  assert.equal(firstRead, true);
  fresh.getMaxRows = readMaxRows;
  assert.equal(created.getMaxRows(), 1000);
  assert.equal(created.getMaxColumns(), 26);
});

test('headroom cleanup stops as soon as enough cells have been reclaimed', () => {
  const context = loadAppsScript();
  const bloated = createGridSheet('Bloated', 1000000, 10, 1, 1);
  const untouched = createGridSheet('Untouched', 2, 1, 1, 1);
  untouched.getLastRow = () => { throw new Error('should not inspect later sheets'); };
  const spreadsheet = createGridSpreadsheet([bloated, untouched]);

  assert.doesNotThrow(() => context.ensureSpreadsheetCellHeadroom_(spreadsheet, 26000));
  assert.equal(bloated.getMaxRows(), 1);
  assert.equal(untouched.getMaxRows(), 2);
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
    }),
    // customerProductReportFinalize_ takes getKiotVietInvoiceLock_() (UserLock)
    // around the actual sheet write, so it never races the invoice webhook's
    // incremental update to the same "Hàng bán theo khách" sheet.
    getUserLock: () => ({
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
      setProperties: values => Object.assign(properties, values),
      deleteProperty: key => {
        delete properties[key];
      }
    })
  };
  context.Utilities = {
    formatDate: customerReportFormatDate,
    sleep: () => {}
  };
  const fakeSheets = {};
  context.SpreadsheetApp = {
    flush: () => {},
    getActiveSpreadsheet: () => ({
      getSheetByName: name => fakeSheets[name],
      insertSheet: name => {
        const sheet = { hideSheet: () => {} };
        fakeSheets[name] = sheet;
        return sheet;
      },
      deleteSheet: sheet => {
        Object.keys(fakeSheets).forEach(key => {
          if (fakeSheets[key] === sheet) delete fakeSheets[key];
        });
      }
    })
  };
  context.Logger = { log: () => {} };
  context.fetchCustomerReportJsonWithRetry_ = (url, token, endpoint) => {
    fetched.push(endpoint);
    return { data: [], total: 0 };
  };
  context.getCustomerReportAllTimeRange_ = () => ({
    start: new Date('2026-01-01T00:00:00+07:00'),
    startQuery: '2026-01-01T00:00:00',
    endQuery: '2026-08-20T23:59:59',
    startLabel: '01/01/2026',
    endLabel: '20/08/2026'
  });
  context.getCustomerReportRollingRange_ = () => ({
    start: new Date('2026-05-22T00:00:00+07:00'),
    startQuery: '2026-05-22T00:00:00',
    endQuery: '2026-08-20T23:59:59',
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
  assert.deepEqual(fetched, [
    'invoices', 'returns', 'customers', // sales
    'invoices', // product (90-day rolling)
    'invoices', 'returns', 'customers' // byProduct
  ]);
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

test('syncCustomerReportIfDue_ runs at most one overdue report per queue invocation', () => {
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

test('syncCustomerReportIfDue_ limits a late queue run to one heavy report', () => {
  const { context, writes } = createCustomerReportHarness();

  assert.equal(
    context.syncCustomerReportIfDue_(new Date('2026-08-20T14:23:00+07:00')),
    1
  );
  assert.deepEqual(writes, ['sales']);
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
