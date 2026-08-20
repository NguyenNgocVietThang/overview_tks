const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadAppsScript() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/kiotviet/CustomerReport.gs'),
    'utf8'
  );
  const context = vm.createContext({ console });
  vm.runInContext(source, context, { filename: 'CustomerReport.gs' });
  return context;
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
    formatDate: () => '2026-08-20',
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
