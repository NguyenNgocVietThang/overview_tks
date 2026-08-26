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
  it('replaces a stale configured webhook URL with the current web-app deployment URL', () => {
    const properties = {
      WEBHOOK_URL: 'https://script.google.com/macros/s/OLD_DEPLOYMENT/exec'
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs'
    ], {
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return properties[name] || null; },
            setProperty(name, value) { properties[name] = value; }
          };
        }
      },
      ScriptApp: {
        getService() {
          return {
            getUrl() {
              return 'https://script.google.com/macros/s/CURRENT_DEPLOYMENT/dev';
            }
          };
        }
      }
    });

    assert.equal(
      context.getKiotVietWebhookBaseUrl_(),
      'https://script.google.com/macros/s/CURRENT_DEPLOYMENT/exec'
    );
    assert.equal(
      properties.WEBHOOK_URL,
      'https://script.google.com/macros/s/CURRENT_DEPLOYMENT/exec'
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
            getProperty() { return null; },
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
            getProperty(name) { return properties[name] || null; },
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
            getProperty(name) { return properties[name] || null; },
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
            getProperty(name) { return properties[name] || null; },
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
            getProperty(name) { return properties[name] || null; },
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
