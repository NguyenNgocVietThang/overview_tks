'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadAppsScript(files, globals = {}) {
  const context = vm.createContext({
    console,
    Logger: { log() {} },
    ...globals
  });

  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function getTestScriptProperty(properties, name) {
  if (name === 'KIOTVIET_RETAILER') return 'CHhanoi';
  return properties[name] || null;
}

function createFormatRange(numberFormatError) {
  return {
    setFontWeight() { return this; },
    setFontColor() { return this; },
    setBackground() { return this; },
    setFontFamily() { return this; },
    setVerticalAlignment() { return this; },
    setNumberFormat() { throw numberFormatError; }
  };
}

function createMemorySheet(name, initialRows, options = {}) {
  let rows = initialRows.map(row => row.slice());
  let clearCount = 0;
  let maxRows = options.maxRows || Math.max(rows.length, 1);
  let maxColumns = options.maxColumns || Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    1
  );
  let parent;

  return {
    getName() { return name; },
    getParent() { return parent; },
    setParent(value) { parent = value; },
    hideSheet() {},
    getLastRow() { return rows.length; },
    getLastColumn() { return rows.reduce((max, row) => Math.max(max, row.length), 0); },
    getMaxRows() { return maxRows; },
    getMaxColumns() { return maxColumns; },
    getFrozenRows() { return 0; },
    getFrozenColumns() { return 0; },
    insertRowsAfter(after, count) { maxRows += count; },
    insertColumnsAfter(after, count) { maxColumns += count; },
    deleteRows(start, count) { maxRows -= count; },
    deleteColumns(start, count) { maxColumns -= count; },
    deleteColumn() {},
    getRange(row, column, rowCount = 1, columnCount = 1) {
      if (row + rowCount - 1 > maxRows || column + columnCount - 1 > maxColumns) {
        throw new Error('Range exceeds grid limits');
      }
      return {
        getValues() {
          return Array.from({ length: rowCount }, (_, rowOffset) =>
            Array.from({ length: columnCount }, (_, columnOffset) =>
              (rows[row - 1 + rowOffset] || [])[column - 1 + columnOffset] || ''
            )
          );
        },
        setValues(values) {
          values.forEach((valueRow, rowOffset) => {
            const targetRow = row - 1 + rowOffset;
            if (!rows[targetRow]) rows[targetRow] = [];
            valueRow.forEach((value, columnOffset) => {
              rows[targetRow][column - 1 + columnOffset] = value;
            });
          });
          return this;
        },
        clearContent() {
          for (let rowOffset = 0; rowOffset < rowCount; rowOffset++) {
            const targetRow = rows[row - 1 + rowOffset];
            if (!targetRow) continue;
            for (let columnOffset = 0; columnOffset < columnCount; columnOffset++) {
              targetRow[column - 1 + columnOffset] = '';
            }
          }
          while (rows.length && rows[rows.length - 1].every(value => value === '')) rows.pop();
        }
      };
    },
    clearContents() {
      clearCount++;
      rows = [];
    },
    getRows() { return rows.map(row => row.slice()); },
    getClearCount() { return clearCount; }
  };
}

describe('Compact KiotViet sheet schemas', () => {
  it('builds the full discontinued reconciliation set from the synced product sheet without KiotViet API calls', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/DiscontinuedProducts.gs'
    ]);
    const products = vm.runInContext(`productSheetRowsToDiscontinuedProducts_([
      ['Mã hàng','Tên hàng','Nhóm hàng','Loại hàng','Giá vốn','Giá bán','Tồn kho','Khách đặt','Trạng thái','Ngày sửa cuối','Mã nhóm hàng','Vị trí','ID hàng hóa','ID gian hàng','Được phép bán','Tên gốc','Mô tả','Giá trị quy đổi','Có thuộc tính','Đang hoạt động','Ngày tạo','Ngày cập nhật','Mã loại hàng'],
      ['A-01','Sản phẩm ngừng','Nhóm A','Hàng hóa',12000,18000,3,2,'Ngừng kinh doanh','26/08/2026 09:30','N-A','Kệ 1','101','501','Có','Sản phẩm ngừng','Mô tả A',1,'Không','Không','01/01/2026 08:00','26/08/2026 09:30',2],
      ['A-02','Sản phẩm đang bán','Nhóm A','Hàng hóa',10000,15000,9,0,'Đang kinh doanh','26/08/2026 10:00','N-A','Kệ 2','102','501','Có','Sản phẩm đang bán','',1,'Không','Có','01/01/2026 08:00','26/08/2026 10:00',2]
    ])`, context);

    assert.equal(products.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(products[0])), {
      id: '101',
      retailerId: '501',
      code: 'A-01',
      name: 'Sản phẩm ngừng',
      fullName: 'Sản phẩm ngừng',
      type: 2,
      categoryId: 'N-A',
      categoryName: 'Nhóm A',
      conversionValue: 1,
      allowsSale: true,
      hasVariants: false,
      basePrice: 18000,
      description: 'Mô tả A',
      isActive: false,
      modifiedDate: '26/08/2026 09:30',
      createdDate: '01/01/2026 08:00',
      inventories: [{ onHand: 3, reserved: 2, onOrder: 0 }],
      fromProductSheet: true
    });
  });

  it('keeps every sync row aligned with its compact header list', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/DiscontinuedProducts.gs'
    ]);
    const checks = vm.runInContext(`(() => {
      const rows = {};
      Object.keys(KIOTVIET_SHEET_SCHEMAS).forEach(key => {
        const schema = KIOTVIET_SHEET_SCHEMAS[key];
        if (!schema.endpoint) return;
        const input = key === 'purchases' ? { order: {}, detail: {} } : {};
        rows[key] = [schema.headers.length, schema.buildRow(input).length];
      });
      rows.discontinued = [
        DISCONTINUED_HEADERS.length,
        discontinuedProductRow_({}, 'test').length
      ];
      return rows;
    })()`, context);

    Object.entries(checks).forEach(([key, lengths]) => {
      assert.equal(lengths[1], lengths[0], `${key} row/header length`);
    });
  });

  it('does not keep verified unused columns in source schemas', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/CustomerReport.gs',
      'src-dashboard/kiotviet/CustomerDebtReport.gs',
      'src-dashboard/kiotviet/DiscontinuedProducts.gs'
    ]);
    const remaining = vm.runInContext(`(() => {
      const checks = {
        products: ['Hình ảnh', 'Liên kết kênh bán', 'Thương hiệu', 'Dự kiến hết hàng', 'Mã vạch', 'Đơn vị tính'],
        customers: ['Giới tính', 'Email', 'Loại khách hàng', 'Ngày cập nhật', 'PSID Facebook'],
        suppliers: ['Email', 'Khu vực', 'Ghi chú', 'Nhóm nhà cung cấp'],
        invoices: ['Tổng thuế', 'Ngày cập nhật'],
        invoiceDetails: ['Là dòng chính', 'Serial/IMEI'],
        orders: ['Tổng thuế'],
        returns: ['Mã hóa đơn gốc', 'ID gian hàng', 'Tổng thuế'],
        purchases: ['Ngày cập nhật', 'Điện thoại', 'Địa chỉ', 'Thương hiệu', 'ĐVT'],
        discontinued: ['Thời gian phát hiện', 'Mã vạch', 'ID thương hiệu', 'Dữ liệu API đầy đủ (JSON)'],
        customerByProduct: ['Thương hiệu', 'Đơn vị tính'],
        customerDebt: ['Thương hiệu', 'VAT bán hàng', 'VAT hoàn lại', 'Thu khác']
      };
      const headers = {
        products: KIOTVIET_SHEET_SCHEMAS.products.headers,
        customers: KIOTVIET_SHEET_SCHEMAS.customers.headers,
        suppliers: KIOTVIET_SHEET_SCHEMAS.suppliers.headers,
        invoices: KIOTVIET_SHEET_SCHEMAS.invoices.headers,
        invoiceDetails: KIOTVIET_SHEET_SCHEMAS.invoiceDetails.headers,
        orders: KIOTVIET_SHEET_SCHEMAS.orders.headers,
        returns: KIOTVIET_SHEET_SCHEMAS.returns.headers,
        purchases: KIOTVIET_SHEET_SCHEMAS.purchases.headers,
        discontinued: DISCONTINUED_HEADERS,
        customerByProduct: CUSTOMER_BY_PRODUCT_REPORT_HEADERS,
        customerDebt: CUSTOMER_DEBT_REPORT_HEADERS
      };
      return Object.keys(checks).flatMap(key =>
        checks[key].filter(header => headers[key].indexOf(header) >= 0)
          .map(header => key + ':' + header)
      );
    })()`, context);

    assert.deepEqual(Array.from(remaining), []);
  });
});

describe('KiotViet webhook URL recovery', () => {
  it('keeps the configured public web-app URL when Apps Script reports an @HEAD development deployment', () => {
    const properties = {
      WEBHOOK_URL: 'https://script.google.com/macros/s/PUBLIC_VERSIONED_DEPLOYMENT/exec'
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; }
          };
        }
      },
      ScriptApp: {
        getService() {
          return {
            getUrl() {
              return 'https://script.google.com/macros/s/HEAD_DEVELOPMENT_DEPLOYMENT/dev';
            }
          };
        }
      }
    });

    assert.equal(
      context.getKiotVietWebhookBaseUrl_(),
      'https://script.google.com/macros/s/PUBLIC_VERSIONED_DEPLOYMENT/exec'
    );
    assert.equal(
      properties.WEBHOOK_URL,
      'https://script.google.com/macros/s/PUBLIC_VERSIONED_DEPLOYMENT/exec'
    );
  });
});

describe('Google Sheets typed-column formatting', () => {
  const typedColumnError = new Error(
    'Bạn không thể đặt định dạng số của các ô trong một cột đã nhập.'
  );

  it('does not abort a full-sheet sync when a typed column rejects number formatting', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const range = createFormatRange(typedColumnError);
    const sheet = {
      getRange() { return range; },
      setFrozenRows() {}
    };
    const schema = {
      headers: ['Số lượng'],
      numberHeaders: ['Số lượng'],
      textHeaders: []
    };

    assert.doesNotThrow(() => context.formatKiotVietSheet_(sheet, schema, 1));
  });

  it('does not return a webhook item to the retry queue for the same formatting-only error', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const range = createFormatRange(typedColumnError);
    const sheet = { getRange() { return range; } };
    const schema = {
      headers: ['Số lượng'],
      numberHeaders: ['Số lượng'],
      textHeaders: []
    };

    assert.doesNotThrow(() => context.formatKiotVietSheetRow_(sheet, schema, 2));
  });

  it('does not abort after data is written when Sheets raises the typed-column error outside the cell formatter', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const sheet = {
      getRange() { throw typedColumnError; },
      setFrozenRows() {}
    };
    const schema = {
      headers: ['Số lượng'],
      numberHeaders: ['Số lượng'],
      textHeaders: []
    };

    assert.doesNotThrow(() => context.formatKiotVietSheetIfSupported_(sheet, schema, 1));
  });
});

describe('Separated dashboard and shipment projects', () => {
  it('keeps the dashboard project on the full 9-event profile', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return { getProperty() { return 'COMBINED'; } };
        }
      }
    });

    assert.equal(context.getKiotVietSyncMode_(), 'FULL_DASHBOARD');
    assert.equal(context.getKiotVietAutoSyncProfile_().eventTypes.length, 9);
  });

  it('installs every dashboard schedule when auto-sync is reconciled', () => {
    const installed = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => false;
    context.isCombinedKiotVietMode_ = () => false;
    context.migrateKiotVietSheetsIfNeeded_ = () => {};
    context.getKiotVietToken = () => 'fake-token';
    context.ensureKiotVietWebhookSecret_ = () => {};
    context.setupQueueProcessingTrigger = () => installed.push('queue');
    context.setupPollingTrigger = () => installed.push('polling');
    context.setupCustomerReportDailyTrigger = () => installed.push('customer-reports');
    context.setupHangNgungKinhDoanhTrigger_ = () => installed.push('discontinued');
    context.setupCustomerDebtReportDailyTrigger = () => installed.push('debt');
    context.reconcileKiotVietAutoSyncWebhooks_ = () => ({
      activeCount: 9,
      createdCount: 0,
      removedCount: 0,
      failedCount: 0
    });

    context.setupKiotVietAutoSync();

    assert.deepEqual(installed, [
      'queue',
      'polling',
      'customer-reports',
      'discontinued',
      'debt'
    ]);
  });

  it('does not write shipment rows inside the dashboard project', () => {
    const calls = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return { getProperty() { return null; } };
        }
      },
      updateInvoicesFromWebhook(items) { calls.push(['dashboard', items]); },
      processShipmentLifecycleWebhookItems_(action, items) {
        calls.push(['shipment', action, items]);
      }
    });

    context.processWebhookQueueItem_({
      eventType: 'invoice.update',
      payload: JSON.stringify({
        Notifications: [{ Action: 'invoice.update', Data: [{ Id: 123 }] }]
      })
    });

    assert.deepEqual(calls.map(call => call[0]), ['dashboard']);
  });

  it('checks for a stalled master sync on every dashboard queue tick', () => {
    let watchdogCalls = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return { getProperty() { return null; } };
        }
      }
    });
    context.isShipmentLifecycleMode_ = () => false;
    context.getKiotVietDataLock_ = () => ({ tryLock() { return false; } });
    context.claimWebhookQueueBatch_ = () => [];
    context.ensureMasterChainResumeTrigger_ = () => { watchdogCalls++; };

    context.processWebhookQueue();

    assert.equal(watchdogCalls, 1);
  });

  it('skips heavy queue maintenance while the master backfill is active', () => {
    let maintenanceCalls = 0;
    let claimedBatches = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) {
              return name === 'MASTER_CHAIN_SYNC_STATE' ? '{"currentIndex":3}' : null;
            }
          };
        }
      }
    });
    context.isShipmentLifecycleMode_ = () => false;
    context.ensureMasterChainResumeTrigger_ = () => {};
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.migrateKiotVietSheetsIfNeeded_ = () => { maintenanceCalls++; };
    context.syncCustomerReportIfDue_ = () => { maintenanceCalls++; };
    context.syncCustomerDebtReportsIfDue_ = () => { maintenanceCalls++; };
    context.claimWebhookQueueBatch_ = () => {
      claimedBatches++;
      return [];
    };

    context.processWebhookQueue();

    assert.equal(maintenanceCalls, 0);
    assert.equal(claimedBatches, 1);
  });

  it('loads the shipment project with its own lifecycle mode and entry points', () => {
    const context = loadAppsScript([
      'src-order-lifecycle/config/Config.gs',
      'src-order-lifecycle/kiotviet/Auth.gs',
      'src-order-lifecycle/kiotviet/SheetSchemas.gs',
      'src-order-lifecycle/kiotviet/WebhookAdmin.gs',
      'src-order-lifecycle/shipment/KiotVietLifecycle.gs',
      'src-order-lifecycle/sync/UpdateHandlers.gs',
      'src-order-lifecycle/sync/WebhookQueue.gs',
      'src-order-lifecycle/utils/Helpers.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) {
              return name === 'KIOTVIET_SYNC_MODE' ? 'SHIPMENT_LIFECYCLE' : null;
            }
          };
        }
      }
    });

    assert.equal(context.getKiotVietSyncMode_(), 'SHIPMENT_LIFECYCLE');
    assert.equal(typeof context.setupShipmentLifecycleSync, 'function');
    assert.equal(typeof context.processShipmentLifecycleWebhookItems_, 'function');
  });

  it('routes invoice.update to shipment lifecycle inside the shipment project', () => {
    const calls = [];
    const context = loadAppsScript([
      'src-order-lifecycle/config/Config.gs',
      'src-order-lifecycle/sync/WebhookQueue.gs'
    ], {
      processShipmentLifecycleWebhookItems_(action, items) {
        calls.push([action, items]);
      }
    });

    context.processWebhookQueueItem_({
      eventType: 'invoice.update',
      payload: JSON.stringify({
        Notifications: [{ Action: 'invoice.update', Data: [{ Id: 456 }] }]
      })
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'invoice.update');
    assert.equal(calls[0][1][0].Id, 456);
  });
});

describe('Chunked sync with checkpoint and auto-resume', () => {
  it('does not access a newly inserted staging sheet before Sheets makes it available', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const staging = createMemorySheet('_KV_SYNC_STAGING_INVOICES', [], {
      maxRows: 1000,
      maxColumns: 26
    });
    staging.hideSheet = () => {
      throw new Error('Service Spreadsheets timed out while accessing document');
    };
    const spreadsheet = {
      getSheets() { return []; },
      getSheetByName() { return null; },
      insertSheet() {
        staging.setParent(spreadsheet);
        return staging;
      }
    };
    context.testSpreadsheet = spreadsheet;

    const prepared = vm.runInContext(
      `prepareKiotVietChunkStagingSheet_(
        testSpreadsheet,
        'invoices',
        KIOTVIET_SHEET_SCHEMAS.invoices
      )`,
      context
    );

    assert.equal(prepared, staging);
  });

  it('uses a bounded page size for detail-heavy purchase orders', () => {
    const requestedUrls = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) {
              return name === 'KIOTVIET_RETAILER' ? 'CHhanoi' : null;
            },
            setProperty() {},
            deleteProperty() {}
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch(url) {
          requestedUrls.push(url);
          return {
            getResponseCode() { return 200; },
            getContentText() { return JSON.stringify({ total: 0, data: [] }); }
          };
        }
      },
      Utilities: { sleep() {} }
    });
    const purchaseHeaders = vm.runInContext('PURCHASE_SHEET_HEADERS.slice()', context);
    const liveSheet = createMemorySheet('Nhập hàng', [purchaseHeaders]);
    const stagingSheet = createMemorySheet('_KV_SYNC_STAGING_PURCHASES', [purchaseHeaders]);
    const spreadsheet = {
      getSheets() { return [liveSheet, stagingSheet]; },
      getSheetByName(name) {
        if (name === 'Nhập hàng') return liveSheet;
        if (name === '_KV_SYNC_STAGING_PURCHASES') return stagingSheet;
        return null;
      }
    };
    liveSheet.setParent(spreadsheet);
    stagingSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    context.syncKiotVietTableChunk_('purchases', { token: 'fake-token' });

    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /[?&]pageSize=20(?:&|$)/);
  });

  it('persists each completed purchases page before requesting the next page', () => {
    const properties = {};
    let fetchCount = 0;
    const firstPurchase = {
      PurchaseOrderId: 101,
      PurchaseOrderCode: 'PN-FIRST',
      PurchaseDate: '2026-08-26T09:00:00',
      Status: 1,
      PurchaseOrderDetails: [{
        ProductId: 501,
        ProductCode: 'SP-FIRST',
        ProductName: 'Sản phẩm đầu tiên',
        Quantity: 1,
        Price: 100000
      }]
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() {
          fetchCount++;
          if (fetchCount === 1) {
            return {
              getResponseCode() { return 200; },
              getContentText() {
                return JSON.stringify({ total: 2, data: [firstPurchase] });
              }
            };
          }
          throw new Error('KiotViet stalled on the next page');
        }
      },
      Utilities: { sleep() {} }
    });
    const purchaseHeaders = vm.runInContext('PURCHASE_SHEET_HEADERS.slice()', context);
    const existingPurchase = Array(purchaseHeaders.length).fill('existing');
    existingPurchase[1] = 'PN-OLD';
    const liveSheet = createMemorySheet('Nhập hàng', [purchaseHeaders, existingPurchase]);
    const stagingSheet = createMemorySheet(
      '_KV_SYNC_STAGING_PURCHASES',
      [purchaseHeaders],
      { maxRows: 1, maxColumns: purchaseHeaders.length }
    );
    const spreadsheet = {
      getSheets() { return [liveSheet, stagingSheet]; },
      getSheetByName(name) {
        if (name === 'Nhập hàng') return liveSheet;
        if (name === '_KV_SYNC_STAGING_PURCHASES') return stagingSheet;
        return null;
      }
    };
    liveSheet.setParent(spreadsheet);
    stagingSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    assert.throws(
      () => context.syncKiotVietTableChunk_('purchases', { token: 'fake-token' }),
      /KiotViet API \(purchaseorders\) that bai/
    );

    const checkpoint = JSON.parse(properties.SYNC_CHUNK_STATE_purchases);
    assert.equal(checkpoint.currentItem, 1);
    assert.equal(checkpoint.stagingLastRow, 2);
    assert.equal(stagingSheet.getRows()[1][1], 'PN-FIRST');
    assert.equal(liveSheet.getRows()[1][1], 'PN-OLD');
  });

  it('persists each completed orders page before requesting the next page', () => {
    const properties = {};
    let fetchCount = 0;
    const firstOrder = {
      OrderId: 201,
      OrderCode: 'DH-FIRST',
      PurchaseDate: '2026-08-26T10:00:00',
      CustomerName: 'Khach thu nghiem',
      Total: 250000,
      Status: 3
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() {
          fetchCount++;
          if (fetchCount === 1) {
            return {
              getResponseCode() { return 200; },
              getContentText() {
                return JSON.stringify({ total: 2, data: [firstOrder] });
              }
            };
          }
          throw new Error('KiotViet stalled on the next orders page');
        }
      },
      Utilities: { sleep() {} }
    });
    const orderHeaders = vm.runInContext('ORDER_SHEET_HEADERS.slice()', context);
    const liveSheet = createMemorySheet(
      'Đặt hàng',
      [orderHeaders],
      { maxRows: 1, maxColumns: orderHeaders.length }
    );
    const spreadsheet = {
      getSheets() { return [liveSheet]; },
      getSheetByName(name) { return name === 'Đặt hàng' ? liveSheet : null; }
    };
    liveSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    assert.throws(
      () => context.syncKiotVietTableChunk_('orders', { token: 'fake-token' }),
      /KiotViet API \(orders\) that bai/
    );

    const checkpoint = JSON.parse(properties.SYNC_CHUNK_STATE_orders);
    assert.equal(checkpoint.currentItem, 1);
    assert.equal(checkpoint.sheetLastRow, 2);
    assert.equal(liveSheet.getRows()[1][0], 'DH-FIRST');
  });

  it('removes uncheckpointed order rows before resuming', () => {
    const properties = {
      SYNC_CHUNK_STATE_orders: JSON.stringify({
        schemaKey: 'orders',
        sheetName: 'Đặt hàng',
        currentItem: 1,
        total: 2,
        sheetLastRow: 2,
        isCompleted: false
      })
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() {
          return {
            getResponseCode() { return 200; },
            getContentText() {
              return JSON.stringify({
                total: 2,
                data: [{
                  OrderId: 202,
                  OrderCode: 'DH-SECOND',
                  PurchaseDate: '2026-08-26T11:00:00',
                  Total: 300000,
                  Status: 3
                }]
              });
            }
          };
        }
      },
      Utilities: { sleep() {} }
    });
    const orderHeaders = vm.runInContext('ORDER_SHEET_HEADERS.slice()', context);
    const firstRow = Array(orderHeaders.length).fill('');
    firstRow[0] = 'DH-FIRST';
    const uncheckpointedRow = Array(orderHeaders.length).fill('');
    uncheckpointedRow[0] = 'DH-UNCOMMITTED';
    const liveSheet = createMemorySheet(
      'Đặt hàng',
      [orderHeaders, firstRow, uncheckpointedRow],
      { maxRows: 4, maxColumns: orderHeaders.length }
    );
    const spreadsheet = {
      getSheets() { return [liveSheet]; },
      getSheetByName(name) { return name === 'Đặt hàng' ? liveSheet : null; }
    };
    liveSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    context.syncKiotVietTableChunk_('orders', { token: 'fake-token' });

    assert.equal(liveSheet.getRows().length, 3);
    assert.equal(liveSheet.getRows()[1][0], 'DH-FIRST');
    assert.equal(liveSheet.getRows()[2][0], 'DH-SECOND');
  });

  it('keeps the current purchases visible when the first API page fails', () => {
    const properties = {};
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() { throw new Error('KiotViet unavailable'); }
      },
      Utilities: { sleep() {} }
    });
    const purchaseHeaders = vm.runInContext('PURCHASE_SHEET_HEADERS.slice()', context);

    const existingPurchase = Array(31).fill('existing');
    existingPurchase[1] = 'PN-OLD';
    const liveSheet = createMemorySheet('Nhập hàng', [purchaseHeaders, existingPurchase]);
    const stagingSheet = createMemorySheet('_KV_SYNC_STAGING_PURCHASES', [purchaseHeaders]);
    const spreadsheet = {
      getSheets() { return [liveSheet, stagingSheet]; },
      getSheetByName(name) {
        if (name === 'Nhập hàng') return liveSheet;
        if (name === '_KV_SYNC_STAGING_PURCHASES') return stagingSheet;
        return null;
      }
    };
    liveSheet.setParent(spreadsheet);
    stagingSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    assert.throws(
      () => context.syncKiotVietTableChunk_('purchases', { token: 'fake-token' }),
      /KiotViet API \(purchaseorders\) that bai/
    );
    assert.equal(liveSheet.getClearCount(), 0);
    assert.equal(liveSheet.getRows()[1][1], 'PN-OLD');
  });

  it('publishes completed purchases from staging without clearing the live sheet first', () => {
    const properties = {};
    const createdTriggers = [];
    const newPurchase = {
      PurchaseOrderId: 101,
      PurchaseOrderCode: 'PN-NEW',
      PurchaseDate: '2026-08-25T08:00:00',
      Status: 1,
      PurchaseOrderDetails: [{
        ProductId: 501,
        ProductCode: 'SP-NEW',
        ProductName: 'Sản phẩm mới',
        Quantity: 2,
        Price: 100000
      }]
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return []; },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after() { return this; },
            create() { createdTriggers.push(handler); }
          };
        }
      },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() {
          return {
            getResponseCode() { return 200; },
            getContentText() { return JSON.stringify({ total: 1, data: [newPurchase] }); }
          };
        }
      },
      Utilities: { sleep() {} }
    });
    const purchaseHeaders = vm.runInContext('PURCHASE_SHEET_HEADERS.slice()', context);
    const existingPurchase = Array(31).fill('existing');
    existingPurchase[1] = 'PN-OLD';
    const liveSheet = createMemorySheet('Nhập hàng', [purchaseHeaders, existingPurchase]);
    const stagingSheet = createMemorySheet(
      '_KV_SYNC_STAGING_PURCHASES',
      [purchaseHeaders],
      { maxRows: 1, maxColumns: 31 }
    );
    let stagingDeleted = false;
    const spreadsheet = {
      getSheets() { return stagingDeleted ? [liveSheet] : [liveSheet, stagingSheet]; },
      getSheetByName(name) {
        if (name === 'Nhập hàng') return liveSheet;
        if (name === '_KV_SYNC_STAGING_PURCHASES' && !stagingDeleted) return stagingSheet;
        return null;
      },
      deleteSheet(sheet) {
        if (sheet === stagingSheet) stagingDeleted = true;
      }
    };
    liveSheet.setParent(spreadsheet);
    stagingSheet.setParent(spreadsheet);
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    const stagedResult = context.syncKiotVietTableChunk_('purchases', {
      token: 'fake-token',
      chunkSize: 100,
      resumeHandler: 'resumeSyncPurchasesChunk'
    });

    assert.equal(stagedResult.isCompleted, false);
    assert.equal(liveSheet.getClearCount(), 0);
    assert.equal(liveSheet.getRows()[1][1], 'PN-OLD');
    assert.equal(stagingDeleted, false);
    assert.equal(JSON.parse(properties.SYNC_CHUNK_STATE_purchases).phase, 'commit');
    assert.deepEqual(createdTriggers, ['resumeSyncPurchasesChunk']);

    const publishedResult = context.syncKiotVietTableChunk_('purchases', {
      token: 'fake-token',
      resumeHandler: 'resumeSyncPurchasesChunk'
    });

    assert.equal(publishedResult.isCompleted, true);
    assert.equal(liveSheet.getRows()[1][1], 'PN-NEW');
    assert.equal(stagingDeleted, true);
    assert.equal(properties.SYNC_CHUNK_STATE_purchases, undefined);
  });

  it('keeps current invoices and details visible when the first API page fails', () => {
    const properties = {};
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: { getProjectTriggers() { return []; } },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: { fetch() { throw new Error('KiotViet unavailable'); } },
      Utilities: { sleep() {} }
    });
    const invoiceHeaders = vm.runInContext('INVOICE_SHEET_HEADERS.slice()', context);
    const detailHeaders = vm.runInContext('INVOICE_DETAIL_SHEET_HEADERS.slice()', context);
    const oldInvoice = Array(invoiceHeaders.length).fill('old-invoice');
    oldInvoice[0] = 'HD-OLD';
    const oldDetail = Array(detailHeaders.length).fill('old-detail');
    oldDetail[0] = 'HD-OLD';
    const liveInvoices = createMemorySheet('Hóa đơn', [invoiceHeaders, oldInvoice]);
    const liveDetails = createMemorySheet('Chi tiết hóa đơn', [detailHeaders, oldDetail]);
    const sheets = [liveInvoices, liveDetails];
    const spreadsheet = {
      getSheets() { return sheets.slice(); },
      getSheetByName(name) { return sheets.find(sheet => sheet.getName() === name) || null; },
      insertSheet(name) {
        const headers = name === '_KV_SYNC_STAGING_INVOICE_DETAILS'
          ? detailHeaders
          : invoiceHeaders;
        const sheet = createMemorySheet(name, [headers], {
          maxRows: 1,
          maxColumns: headers.length
        });
        sheet.setParent(spreadsheet);
        sheets.push(sheet);
        return sheet;
      }
    };
    sheets.forEach(sheet => sheet.setParent(spreadsheet));
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    assert.throws(
      () => context.syncKiotVietTableChunk_('invoices', { token: 'fake-token' }),
      /KiotViet API \(invoices\) that bai/
    );

    assert.equal(liveInvoices.getClearCount(), 0);
    assert.equal(liveDetails.getClearCount(), 0);
    assert.equal(liveInvoices.getRows()[1][0], 'HD-OLD');
    assert.equal(liveDetails.getRows()[1][0], 'HD-OLD');
  });

  it('publishes invoices and details together after staging is complete', () => {
    const properties = {};
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return []; },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after(delayMs) { this.delayMs = delayMs; return this; },
            create() { createdTriggers.push({ handler, delayMs: this.delayMs }); }
          };
        }
      },
      SpreadsheetApp: { flush() {} },
      UrlFetchApp: {
        fetch() {
          return {
            getResponseCode() { return 200; },
            getContentText() {
              return JSON.stringify({
                total: 1,
                data: [{
                  InvoiceId: 501,
                  InvoiceCode: 'HD-NEW',
                  PurchaseDate: '2026-08-27T08:00:00',
                  Status: 1,
                  InvoiceDetails: [
                    { ProductId: 101, ProductCode: 'SP-1', ProductName: 'Sản phẩm 1', Quantity: 1, Price: 100000 },
                    { ProductId: 102, ProductCode: 'SP-2', ProductName: 'Sản phẩm 2', Quantity: 2, Price: 50000 }
                  ]
                }]
              });
            }
          };
        }
      },
      Utilities: { sleep() {} }
    });
    const invoiceHeaders = vm.runInContext('INVOICE_SHEET_HEADERS.slice()', context);
    const detailHeaders = vm.runInContext('INVOICE_DETAIL_SHEET_HEADERS.slice()', context);
    const oldInvoice = Array(invoiceHeaders.length).fill('old-invoice');
    oldInvoice[0] = 'HD-OLD';
    const oldDetail = Array(detailHeaders.length).fill('old-detail');
    oldDetail[0] = 'HD-OLD';
    const liveInvoices = createMemorySheet('Hóa đơn', [invoiceHeaders, oldInvoice]);
    const liveDetails = createMemorySheet('Chi tiết hóa đơn', [detailHeaders, oldDetail]);
    const sheets = [liveInvoices, liveDetails];
    const spreadsheet = {
      getSheets() { return sheets.slice(); },
      getSheetByName(name) { return sheets.find(sheet => sheet.getName() === name) || null; },
      insertSheet(name) {
        const headers = name === '_KV_SYNC_STAGING_INVOICE_DETAILS'
          ? detailHeaders
          : invoiceHeaders;
        const sheet = createMemorySheet(name, [headers], {
          maxRows: 1,
          maxColumns: headers.length
        });
        sheet.setParent(spreadsheet);
        sheets.push(sheet);
        return sheet;
      },
      deleteSheet(sheet) {
        const index = sheets.indexOf(sheet);
        if (index >= 0) sheets.splice(index, 1);
      }
    };
    sheets.forEach(sheet => sheet.setParent(spreadsheet));
    context.SpreadsheetApp.getActiveSpreadsheet = () => spreadsheet;

    const stagedResult = context.syncKiotVietTableChunk_('invoices', {
      token: 'fake-token',
      resumeHandler: 'resumeSyncInvoicesChunk'
    });

    assert.equal(stagedResult.isCompleted, false);
    assert.equal(liveInvoices.getRows()[1][0], 'HD-OLD');
    assert.equal(liveDetails.getRows()[1][0], 'HD-OLD');
    assert.deepEqual(createdTriggers, [{
      handler: 'resumeSyncInvoicesChunk',
      delayMs: 60000
    }]);
    const checkpoint = JSON.parse(properties.SYNC_CHUNK_STATE_invoices);
    assert.equal(checkpoint.phase, 'commit');
    assert.equal(checkpoint.invoiceCount, 1);
    assert.equal(checkpoint.invoiceDetailCount, 2);

    const publishedResult = context.syncKiotVietTableChunk_('invoices', {
      token: 'fake-token',
      resumeHandler: 'resumeSyncInvoicesChunk'
    });

    assert.equal(publishedResult.isCompleted, true);
    assert.equal(publishedResult.invoiceCount, 1);
    assert.equal(publishedResult.invoiceDetailCount, 2);
    assert.equal(liveInvoices.getRows()[1][0], 'HD-NEW');
    assert.equal(liveDetails.getRows().length, 3);
    assert.deepEqual(sheets.map(sheet => sheet.getName()).sort(), [
      'Chi tiết hóa đơn',
      'Hóa đơn'
    ]);
    assert.equal(properties.SYNC_CHUNK_STATE_invoices, undefined);
    const audit = JSON.parse(properties.KIOTVIET_INVOICE_BACKFILL_LAST_RESULT);
    assert.equal(audit.total, 1);
    assert.equal(audit.invoiceCount, 1);
    assert.equal(audit.invoiceDetailCount, 2);
    assert.equal(audit.invoiceRows, 1);
    assert.equal(audit.invoiceDetailRows, 2);
    const status = context.getInvoiceBackfillStatus();
    assert.equal(status.isCompleted, true);
    assert.equal(status.matchesExpected, true);
    assert.equal(status.invoiceRows, 1);
    assert.equal(status.invoiceDetailRows, 2);
  });

  it('restarts only the invoice backfill under the shared data lock', () => {
    const properties = {
      SYNC_CHUNK_STATE_invoices: '{"currentItem":100}',
      SYNC_CHUNK_STATE_orders: '{"currentItem":200}',
      KIOTVIET_INVOICE_BACKFILL_LAST_RESULT: '{"invoiceCount":100}'
    };
    const removedHandlers = [];
    let syncCalls = 0;
    let lockReleased = false;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      }
    });
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() { lockReleased = true; }
    });
    context.removeSpecificChunkTrigger_ = handler => removedHandlers.push(handler);
    context.syncKiotVietTableChunk_ = schemaKey => {
      syncCalls++;
      return { schemaKey, isCompleted: false };
    };

    const result = context.restartInvoicesBackfill();

    assert.equal(result.schemaKey, 'invoices');
    assert.equal(syncCalls, 1);
    assert.deepEqual(removedHandlers, ['resumeSyncInvoicesChunk']);
    assert.equal(properties.SYNC_CHUNK_STATE_invoices, undefined);
    assert.equal(properties.KIOTVIET_INVOICE_BACKFILL_LAST_RESULT, undefined);
    assert.equal(properties.SYNC_CHUNK_STATE_orders, '{"currentItem":200}');
    assert.equal(lockReleased, true);
  });

  it('waits five minutes before resuming a heavy polling chunk', () => {
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) {
              return name === 'KIOTVIET_RETAILER' ? 'CHhanoi' : null;
            },
            setProperty() {},
            deleteProperty() {}
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return []; },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after(delayMs) { this.delayMs = delayMs; return this; },
            create() { createdTriggers.push({ handler, delayMs: this.delayMs }); }
          };
        }
      }
    });
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.syncKiotVietTableChunk_ = () => ({ isCompleted: false });

    context.syncPollingOnly_();

    assert.deepEqual(createdTriggers, [{
      handler: 'resumePollingOnlyChunk_',
      delayMs: 300000
    }]);
  });

  it('reschedules the master chain when another sync holds the data lock', () => {
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      LockService: {
        getDocumentLock() {
          return {
            tryLock() { return false; },
            releaseLock() {}
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return []; },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after() { return this; },
            create() { createdTriggers.push(handler); }
          };
        }
      }
    });

    context.syncAllDataChunked();

    assert.deepEqual(createdTriggers, ['resumeMasterChainSync_']);
  });

  it('restores a missing master trigger when checkpoint state still exists', () => {
    const createdTriggers = [];
    const properties = { MASTER_CHAIN_SYNC_STATE: '{"currentIndex":3}' };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; }
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return []; },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after() { return this; },
            create() { createdTriggers.push(handler); }
          };
        }
      }
    });

    assert.equal(context.ensureMasterChainResumeTrigger_(), true);
    assert.deepEqual(createdTriggers, ['resumeMasterChainSync_']);
    assert.ok(properties.MASTER_CHAIN_SYNC_WATCHDOG_AT);
  });

  it('replaces a consumed-looking master trigger when no watchdog heartbeat exists', () => {
    const properties = { MASTER_CHAIN_SYNC_STATE: '{"currentIndex":3}' };
    const createdTriggers = [];
    const deletedTriggers = [];
    const staleTrigger = { getHandlerFunction() { return 'resumeMasterChainSync_'; } };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; }
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() { return [staleTrigger]; },
        deleteTrigger(trigger) { deletedTriggers.push(trigger); },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after() { return this; },
            create() { createdTriggers.push(handler); }
          };
        }
      }
    });

    assert.equal(context.ensureMasterChainResumeTrigger_(), true);
    assert.deepEqual(deletedTriggers, [staleTrigger]);
    assert.deepEqual(createdTriggers, ['resumeMasterChainSync_']);
  });

  it('finishes the master backfill without rebuilding separately scheduled reports', () => {
    const properties = {
      MASTER_CHAIN_SYNC_STATE: JSON.stringify({ currentIndex: 8 }),
      MASTER_CHAIN_SYNC_WATCHDOG_AT: '123'
    };
    let reportCalls = 0;
    let removedResumeTriggers = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() { return {}; }
      }
    });
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.migrateKiotVietSheetsIfNeeded_ = () => {};
    context.migrateLegacyDiscontinuedSheet_ = () => {};
    context.getKiotVietToken = () => 'fake-token';
    context.syncCustomerDebtReports = () => { reportCalls++; };
    context.syncHangNgungKinhDoanh_ = () => { reportCalls++; };
    context.syncCustomerReport = () => { reportCalls++; };
    context.removeAllChunkResumeTriggers_ = () => { removedResumeTriggers++; };

    context.syncAllDataChunked();

    assert.equal(reportCalls, 0);
    assert.equal(properties.MASTER_CHAIN_SYNC_STATE, undefined);
    assert.equal(properties.MASTER_CHAIN_SYNC_WATCHDOG_AT, undefined);
    assert.equal(removedResumeTriggers, 1);
  });

  it('stops only the accidentally started master chain', () => {
    const properties = {
      MASTER_CHAIN_SYNC_STATE: '{"currentIndex":1}',
      MASTER_CHAIN_SYNC_WATCHDOG_AT: '123',
      SYNC_CHUNK_STATE_products: '{"currentItem":100}',
      SYNC_CHUNK_STATE_invoices: '{"currentItem":200}'
    };
    const removedHandlers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      }
    });
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.removeSpecificChunkTrigger_ = handler => removedHandlers.push(handler);

    const result = context.stopMasterSyncChain();

    assert.equal(result.stopped, true);
    assert.equal(properties.MASTER_CHAIN_SYNC_STATE, undefined);
    assert.equal(properties.MASTER_CHAIN_SYNC_WATCHDOG_AT, undefined);
    assert.equal(properties.SYNC_CHUNK_STATE_products, '{"currentItem":100}');
    assert.equal(properties.SYNC_CHUNK_STATE_invoices, '{"currentItem":200}');
    assert.deepEqual(removedHandlers, ['resumeMasterChainSync_']);
  });

  it('loads chunk sync functions and executes a chunk iteration with checkpoint persistence', () => {
    const properties = {};
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      },
      LockService: {
        getDocumentLock() {
          return {
            tryLock() { return true; },
            waitLock() { return true; },
            releaseLock() {}
          };
        }
      },
      ScriptApp: {
        getProjectTriggers() {
          return [];
        },
        newTrigger(handler) {
          return {
            timeBased() { return this; },
            after() { return this; },
            create() { createdTriggers.push(handler); }
          };
        }
      },
      SpreadsheetApp: {
        flush() {},
        getActiveSpreadsheet() {
          const sheet = {
            getLastRow() { return 1; },
            getLastColumn() { return 1; },
            getDataRange() { return { getValues() { return [[]]; } }; },
            getRange() {
              return {
                setValues() { return this; },
                getValues() { return [[]]; },
                clearContent() {},
                setFontWeight() { return this; },
                setFontColor() { return this; },
                setBackground() { return this; },
                setFontFamily() { return this; },
                setVerticalAlignment() { return this; }
              };
            },
            clearContents() {},
            setFrozenRows() {}
          };
          return {
            getSheetByName() { return sheet; },
            insertSheet() { return sheet; }
          };
        }
      },
      UrlFetchApp: {
        fetch() {
          return {
            getResponseCode() { return 200; },
            getContentText() {
              return JSON.stringify({
                total: 12000,
                data: Array.from({ length: 100 }, (_, i) => ({
                  Id: i + 1,
                  Code: 'CAT' + (i + 1),
                  Name: 'Nhóm ' + (i + 1)
                }))
              });
            }
          };
        }
      },
      Utilities: {
        sleep() {}
      }
    });

    assert.equal(typeof context.syncKiotVietTableChunk_, 'function');
    assert.equal(typeof context.syncAllDataChunked, 'function');
    assert.equal(typeof context.getSyncProgressSummary, 'function');
    assert.equal(typeof context.resetAllSyncProgress, 'function');

    // Chạy 1 chunk với chunkSize = 200
    const result = context.syncKiotVietTableChunk_('categories', {
      token: 'fake-token',
      chunkSize: 200,
      resumeHandler: 'resumeSyncCategoriesChunk',
      autoSchedule: true
    });

    assert.equal(result.isCompleted, false);
    assert.equal(result.currentItem, 200);
    assert.equal(result.total, 12000);
    assert.ok(properties.SYNC_CHUNK_STATE_categories);
    assert.equal(createdTriggers.length, 1);
    assert.equal(createdTriggers[0], 'resumeSyncCategoriesChunk');

    // Kiểm tra getSyncProgressSummary
    const summary = context.getSyncProgressSummary();
    assert.ok(summary['Nhóm hàng'].includes('200/12000'));

    // Kiểm tra resetAllSyncProgress
    context.resetAllSyncProgress();
    assert.equal(properties.SYNC_CHUNK_STATE_categories, undefined);
  });
});
