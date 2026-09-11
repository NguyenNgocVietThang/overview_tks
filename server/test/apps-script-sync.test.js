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
  it('keeps every sync row aligned with its compact header list', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const checks = vm.runInContext(`(() => {
      const rows = {};
      Object.keys(KIOTVIET_SHEET_SCHEMAS).forEach(key => {
        const schema = KIOTVIET_SHEET_SCHEMAS[key];
        if (!schema.endpoint) return;
        const input = key === 'purchases' ? { order: {}, detail: {} } : {};
        rows[key] = [schema.headers.length, schema.buildRow(input).length];
      });
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/CustomerReport.gs',
      'src-dashboard/kiotviet/CustomerDebtReport.gs'
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
  it('propagates a queue write failure so KiotViet receives a failed webhook request', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      ContentService: {
        MimeType: { TEXT: 'text' },
        createTextOutput(value) {
          return { value, setMimeType() { return this; } };
        }
      },
      Utilities: { getUuid() { return 'webhook-1'; }, sleep() {} },
      SpreadsheetApp: { flush() {} }
    });
    context.isValidWebhookSecret_ = () => true;
    context.ensureWebhookQueueSheet_ = () => ({
      appendRow() { throw new Error('Service Spreadsheets timed out'); }
    });

    assert.throws(() => context.doPost({
      parameter: { eventType: 'invoice.update' },
      postData: { contents: '{"Notifications":[]}' }
    }), /Webhook was not queued/);
  });

  it('retries a transient queue append before acknowledging the webhook', () => {
    let attempts = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      ContentService: {
        MimeType: { TEXT: 'text' },
        createTextOutput(value) {
          return { value, setMimeType() { return this; } };
        }
      },
      Utilities: { getUuid() { return 'webhook-1'; }, sleep() {} },
      SpreadsheetApp: { flush() {} }
    });
    context.isValidWebhookSecret_ = () => true;
    context.ensureWebhookQueueSheet_ = () => ({
      appendRow() {
        attempts++;
        if (attempts === 1) throw new Error('Service Spreadsheets timed out');
      }
    });

    const response = context.doPost({
      parameter: { eventType: 'invoice.update' },
      postData: { contents: '{"Notifications":[]}' }
    });

    assert.equal(response.value, 'QUEUED');
    assert.equal(attempts, 2);
  });

  it('claims at most one hundred webhook items after same-type deliveries are coalesced', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const rows = [headers];
    for (let index = 1; index <= 105; index++) {
      rows.push(['webhook-' + index, new Date(), 'product.update', '{}', 'PENDING', 0, '', '']);
    }
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', rows);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    const claimed = context.claimWebhookQueueBatch_();

    assert.equal(claimed.length, 100);
    assert.equal(queueSheet.getRows().filter(row => row[4] === 'PROCESSING').length, 100);
    assert.equal(queueSheet.getRows().filter(row => row[4] === 'PENDING').length, 5);
  });

  it('ignores blank queue rows instead of turning them into processing work', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['valid-1', new Date(), 'stock.update', '{}', 'PENDING', 0, '', ''],
      ['', '', '', '', '', '', '', ''],
      ['', '', '', '', 'PROCESSING', 1, new Date(), '']
    ]);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    const claimed = context.claimWebhookQueueBatch_();

    assert.equal(Array.from(claimed, item => item.id).join(','), 'valid-1');
    assert.deepEqual(queueSheet.getRows()[2].slice(4, 8), ['', '', '', '']);
    assert.deepEqual(queueSheet.getRows()[3].slice(4, 8), ['', '', '', '']);
  });

  it('includes invoice events in the next batch even when product backlog is older', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const rows = [headers];
    for (let index = 1; index <= 12; index++) {
      rows.push(['product-' + index, new Date(), 'stock.update', '{}', 'PENDING', 0, '', '']);
    }
    rows.push(['invoice-1', new Date(), 'invoice.update', '{}', 'PENDING', 0, '', '']);
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', rows);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    const claimed = context.claimWebhookQueueBatch_();

    assert.equal(claimed.length, 1);
    assert.equal(claimed.some(item => item.id === 'invoice-1'), true);
  });

  it('claims up to fifty invoice events so detail rows are rewritten once per burst', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const rows = [headers];
    for (let index = 1; index <= 55; index++) {
      rows.push(['invoice-' + index, new Date(), 'invoice.update', '{}', 'PENDING', 0, '', '']);
    }
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', rows);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    assert.equal(context.claimWebhookQueueBatch_().length, 50);
  });

  it('reclaims an expired webhook lease with a fresh attempt budget after infrastructure timeouts', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const staleLease = new Date(Date.now() - 11 * 60 * 1000);
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['stuck', new Date(), 'invoice.update', '{}', 'PROCESSING', 10, staleLease, '']
    ]);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    const claimed = context.claimWebhookQueueBatch_();

    assert.equal(claimed.length, 1);
    assert.equal(queueSheet.getRows()[1][4], 'PROCESSING');
    assert.equal(queueSheet.getRows()[1][5], 1);
    assert.equal(queueSheet.getRows()[1][7], '');
  });

  it('recovers processing webhook rows without deleting their payloads', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['stuck', new Date(), 'invoice.update', '{"invoice":1}', 'PROCESSING', 27, new Date(), ''],
      ['waiting', new Date(), 'order.update', '{"order":1}', 'PENDING', 0, '', '']
    ]);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { waitLock() {}, releaseLock() {} };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    const recovered = context.recoverStuckWebhookQueue();

    assert.equal(recovered, 1);
    assert.deepEqual(queueSheet.getRows()[1].slice(2, 8), [
      'invoice.update', '{"invoice":1}', 'PENDING', 0, '', ''
    ]);
    assert.equal(queueSheet.getRows()[2][4], 'PENDING');
  });

  it('automatically recovers legacy quarantine errors without touching active leases', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const properties = {};
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['legacy', new Date(), 'invoice.update', '{"invoice":1}', 'PROCESSING', 27, new Date(), ''],
      ['quarantined', new Date(), 'stock.update', '{"stock":1}', 'ERROR', 27, '',
        'Lease xu ly het han qua 10 lan; can phuc hoi hang doi sau khi sua nguyen nhan timeout.']
    ]);
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      },
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return properties[name] || null; },
            setProperty(name, value) { properties[name] = value; }
          };
        }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return { getSheetByName() { return queueSheet; } };
        },
        flush() {}
      }
    });

    assert.equal(context.recoverWebhookQueueAfterBatchResize_(), 1);
    assert.equal(queueSheet.getRows()[1][4], 'PROCESSING');
    assert.equal(queueSheet.getRows()[1][5], 27);
    assert.equal(queueSheet.getRows()[2][4], 'PENDING');
    assert.equal(queueSheet.getRows()[2][5], 0);
    assert.equal(context.recoverWebhookQueueAfterBatchResize_(), 0);
  });

  it('finalizes a processed webhook batch once instead of reacquiring the script lock per item', () => {
    const finalizedBatches = [];
    let individualFinalizations = 0;
    let claimCalls = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => true;
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      return claimCalls === 1
        ? [
          { id: 'webhook-1', eventType: 'product.update', payload: '{}' },
          { id: 'webhook-2', eventType: 'customer.update', payload: '{}' }
        ]
        : [];
    };
    context.getKiotVietDataLock_ = () => ({
      waitLock() {},
      hasLock() { return true; },
      releaseLock() {}
    });
    context.processWebhookQueueItem_ = () => {};
    context.finalizeWebhookQueueItem_ = () => { individualFinalizations++; };
    context.finalizeWebhookQueueBatch_ = results => finalizedBatches.push(results);

    context.processWebhookQueue();

    assert.equal(individualFinalizations, 0);
    assert.equal(finalizedBatches.length, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(finalizedBatches[0].map(result => ({
        id: result.id,
        error: result.error,
        skipAttemptPenalty: result.skipAttemptPenalty
      })))),
      [
        { id: 'webhook-1', error: null, skipAttemptPenalty: false },
        { id: 'webhook-2', error: null, skipAttemptPenalty: false }
      ]
    );
  });

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
    context.setupCustomerDebtReportDailyTrigger = () => installed.push('debt');
    context.setupKiotVietRecoveryTriggers = () => installed.push('recovery');
    context.setupMaintenanceTrigger = () => installed.push('maintenance');
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
      'debt',
      'recovery',
      'maintenance'
    ]);
  });

  it('keeps recovery lightweight and does not schedule automatic invoice backfills', () => {
    const created = [];
    const oldHealth = { getHandlerFunction() { return 'reconcileKiotVietAutoSyncHealth_'; } };
    const oldBackfill = { getHandlerFunction() { return 'reconcileInvoicesDaily_'; } };
    const deleted = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs'
    ], {
      ScriptApp: {
        getProjectTriggers() { return [oldHealth, oldBackfill]; },
        deleteTrigger(trigger) { deleted.push(trigger.getHandlerFunction()); },
        newTrigger(handler) {
          const record = { handler };
          const builder = {
            timeBased() { return builder; },
            everyHours(hours) { record.hours = hours; return builder; },
            atHour(hour) { record.hour = hour; return builder; },
            everyDays(days) { record.days = days; return builder; },
            after(delayMs) { record.delayMs = delayMs; return builder; },
            create() { created.push(record); }
          };
          return builder;
        }
      }
    });

    context.setupKiotVietRecoveryTriggers();

    assert.deepEqual(deleted.sort(), [
      'reconcileInvoicesDaily_',
      'reconcileKiotVietAutoSyncHealth_'
    ]);
    assert.deepEqual(created, [{
      handler: 'reconcileKiotVietAutoSyncHealth_', hours: 6
    }]);
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

  it('never calls report/debt-report/schema-migration maintenance from the webhook queue', () => {
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
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.claimWebhookQueueBatch_ = () => [];
    // processWebhookQueue() nay chi con xu ly webhook; bao cao/cong no/migrate
    // schema/watchdog da chuyen het sang runKiotVietMaintenanceTick_ (xem
    // MaintenanceSchedule.gs) de khong con canh tranh lock/lam tre webhook.
    context.migrateKiotVietSheetsIfNeeded_ = () => {
      throw new Error('processWebhookQueue must not migrate sheet schema anymore');
    };
    context.syncCustomerReportIfDue_ = () => {
      throw new Error('processWebhookQueue must not run report catch-up anymore');
    };
    context.syncCustomerDebtReportsIfDue_ = () => {
      throw new Error('processWebhookQueue must not run debt-report catch-up anymore');
    };
    context.ensureMasterChainResumeTrigger_ = () => {
      throw new Error('processWebhookQueue must not run the master-chain watchdog anymore');
    };
    context.ensurePollingOnlyResumeTrigger_ = () => {
      throw new Error('processWebhookQueue must not run the polling-only watchdog anymore');
    };

    assert.doesNotThrow(() => context.processWebhookQueue());
  });

  it('does not start a second queue runner while another trigger owns the lease', () => {
    let claimCalls = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.acquireWebhookQueueRunnerLease_ = () => null;
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.isShipmentLifecycleMode_ = () => true;
    context.claimWebhookQueueBatch_ = () => { claimCalls++; return []; };

    context.processWebhookQueue();

    assert.equal(claimCalls, 0);
  });

  it('drains more than one full invoice batch in the same queue execution', () => {
    let claimCalls = 0;
    let processedGroups = 0;
    const invoiceBatch = Array.from({ length: 50 }, (_, index) => ({
      id: 'invoice-' + index,
      eventType: 'invoice.update',
      payload: JSON.stringify({
        Notifications: [{ Action: 'invoice.update', Data: [{ Id: index + 1 }] }]
      })
    }));
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ], {
      PropertiesService: {
        getScriptProperties() { return { getProperty() { return null; } }; }
      }
    });
    context.acquireWebhookQueueRunnerLease_ = () => 'runner-1';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.isShipmentLifecycleMode_ = () => true;
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      return claimCalls <= 2 ? invoiceBatch : [];
    };
    context.coalesceWebhookQueueBatch_ = batch => [{
      syntheticItem: batch[0], queueItems: batch
    }];
    context.getKiotVietInvoiceLock_ = () => ({
      waitLock() {}, hasLock() { return true; }, releaseLock() {}
    });
    context.processWebhookQueueGroupWithIsolation_ = group => {
      processedGroups++;
      return group.queueItems.map(item => ({ id: item.id, error: null }));
    };
    context.finalizeWebhookQueueBatch_ = () => true;

    context.processWebhookQueue();

    assert.equal(processedGroups, 2);
    assert.equal(claimCalls, 3);
  });

  it('merges same-type webhook deliveries into one sheet update and deduplicates item ids', () => {
    let claimCalls = 0;
    const processedPayloads = [];
    const finalizedBatches = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => true;
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      if (claimCalls > 1) return [];
      return [
        {
          id: 'queue-1', eventType: 'product.update',
          payload: JSON.stringify({ Id: 'delivery-1', Notifications: [{ Action: 'product.update', Data: [{ Id: 1 }] }] })
        },
        {
          id: 'queue-2', eventType: 'product.update',
          payload: JSON.stringify({ Id: 'delivery-2', Notifications: [{ Action: 'product.update', Data: [{ Id: 2 }] }] })
        },
        {
          id: 'queue-3', eventType: 'product.update',
          payload: JSON.stringify({ Id: 'delivery-2', Notifications: [{ Action: 'product.update', Data: [{ Id: 2 }] }] })
        }
      ];
    };
    context.getKiotVietDataLock_ = () => ({
      waitLock() {},
      hasLock() { return true; },
      releaseLock() {}
    });
    context.processWebhookQueueItem_ = queueItem => {
      processedPayloads.push(JSON.parse(queueItem.payload));
    };
    context.finalizeWebhookQueueBatch_ = results => {
      finalizedBatches.push(results);
      return true;
    };

    context.processWebhookQueue();

    assert.equal(processedPayloads.length, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(processedPayloads[0].Notifications)),
      [{ Action: 'product.update', Data: [{ Id: 1 }, { Id: 2 }] }]
    );
    assert.deepEqual(Array.from(finalizedBatches[0], result => result.id), [
      'queue-1', 'queue-2', 'queue-3'
    ]);
  });

  it('routes stock webhooks through the non-hydrating stock updater', () => {
    const received = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => false;
    context.isCombinedKiotVietMode_ = () => false;
    context.updateProductsFromWebhook = () => {
      throw new Error('stock updates must not hydrate product details');
    };
    context.updateProductStocksFromWebhook = items => received.push(...items);

    context.processWebhookQueueItem_({
      id: 'stock-1',
      eventType: 'stock.update',
      payload: JSON.stringify({
        Notifications: [{
          Action: 'stock.update',
          Data: [{ ProductId: 1, ProductCode: 'SKU-1', OnHand: 42 }]
        }]
      })
    });

    assert.deepEqual(JSON.parse(JSON.stringify(received)), [
      { ProductId: 1, ProductCode: 'SKU-1', OnHand: 42 }
    ]);
  });

  it('isolates a failed coalesced webhook so valid deliveries are not marked as errors', () => {
    let claimCalls = 0;
    let processCalls = 0;
    const finalizedBatches = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => true;
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      if (claimCalls > 1) return [];
      return Array.from({ length: 8 }, (_, index) => ({
        id: index === 7 ? 'queue-bad' : 'queue-good-' + (index + 1),
        eventType: 'stock.update',
        payload: JSON.stringify({
          Notifications: [{ Action: 'stock.update', Data: [{ ProductId: index + 1 }] }]
        })
      }));
    };
    context.getKiotVietDataLock_ = () => ({
      waitLock() {},
      hasLock() { return true; },
      releaseLock() {}
    });
    context.processWebhookQueueItem_ = queueItem => {
      processCalls++;
      const payload = JSON.parse(queueItem.payload);
      const productIds = payload.Notifications[0].Data.map(item => item.ProductId);
      if (productIds.includes(8)) {
        throw new Error('Address unavailable');
      }
    };
    context.finalizeWebhookQueueBatch_ = results => {
      finalizedBatches.push(results);
      return true;
    };

    context.processWebhookQueue();

    assert.equal(finalizedBatches.length, 1);
    assert.deepEqual(
      JSON.parse(JSON.stringify(
        finalizedBatches[0].slice(0, 7).map(result => [result.id, result.error])
      )),
      Array.from({ length: 7 }, (_, index) => ['queue-good-' + (index + 1), null])
    );
    assert.equal(finalizedBatches[0][7].id, 'queue-bad');
    assert.match(finalizedBatches[0][7].error.message, /Address unavailable/);
    assert.equal(processCalls, 7);
  });

});

describe('KiotViet maintenance tick (decoupled from the webhook queue)', () => {
  function loadMaintenance(propertyOverrides, globals) {
    const properties = Object.assign({}, propertyOverrides);
    return loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/sync/MaintenanceSchedule.gs'
    ], Object.assign({
      PropertiesService: {
        getScriptProperties() {
          return {
            getProperty(name) { return getTestScriptProperty(properties, name); },
            setProperty(name, value) { properties[name] = value; },
            deleteProperty(name) { delete properties[name]; }
          };
        }
      }
    }, globals));
  }

  it('checks for a stalled master sync on every maintenance tick', () => {
    let watchdogCalls = 0;
    const context = loadMaintenance({});
    context.isShipmentLifecycleMode_ = () => false;
    context.getKiotVietDataLock_ = () => ({ tryLock() { return false; } });
    context.ensureMasterChainResumeTrigger_ = () => { watchdogCalls++; };
    context.ensurePollingOnlyResumeTrigger_ = () => {};

    context.runKiotVietMaintenanceTick_();

    assert.equal(watchdogCalls, 1);
  });

  it('does not resurrect an automatic invoice backfill on a maintenance tick', () => {
    let pollingWatchdogCalls = 0;
    let invoiceWatchdogCalls = 0;
    const context = loadMaintenance({});
    context.isShipmentLifecycleMode_ = () => false;
    context.getKiotVietDataLock_ = () => ({ tryLock() { return false; } });
    context.ensureMasterChainResumeTrigger_ = () => {};
    context.ensurePollingOnlyResumeTrigger_ = () => { pollingWatchdogCalls++; };
    context.ensureInvoicesBackfillResumeTrigger_ = () => { invoiceWatchdogCalls++; };

    context.runKiotVietMaintenanceTick_();

    assert.equal(pollingWatchdogCalls, 1);
    assert.equal(invoiceWatchdogCalls, 0);
  });

  it('skips report/debt-report catch-up while the master backfill is active', () => {
    let maintenanceCalls = 0;
    const context = loadMaintenance({ MASTER_CHAIN_SYNC_STATE: '{"currentIndex":3}' });
    context.isShipmentLifecycleMode_ = () => false;
    context.ensureMasterChainResumeTrigger_ = () => {};
    context.ensurePollingOnlyResumeTrigger_ = () => {};
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.migrateKiotVietSheetsIfNeeded_ = () => { maintenanceCalls++; };
    context.syncCustomerReportIfDue_ = () => { maintenanceCalls++; };
    context.syncCustomerDebtReportsIfDue_ = () => { maintenanceCalls++; };

    context.runKiotVietMaintenanceTick_();

    assert.equal(maintenanceCalls, 0);
  });

  it('skips report/debt-report catch-up while quota is paused, but still runs schema migration', () => {
    let migrateCalls = 0;
    let reportCalls = 0;
    const context = loadMaintenance({});
    context.isShipmentLifecycleMode_ = () => false;
    context.ensureMasterChainResumeTrigger_ = () => {};
    context.ensurePollingOnlyResumeTrigger_ = () => {};
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.migrateKiotVietSheetsIfNeeded_ = () => { migrateCalls++; };
    context.isKiotVietQuotaPaused_ = () => true;
    context.syncCustomerReportIfDue_ = () => { reportCalls++; };
    context.syncCustomerDebtReportsIfDue_ = () => { reportCalls++; };

    context.runKiotVietMaintenanceTick_();

    assert.equal(migrateCalls, 1);
    assert.equal(reportCalls, 0);
  });

  it('runs report/debt-report catch-up when not backfilling and quota is available', () => {
    let reportCalls = 0;
    let debtCalls = 0;
    const context = loadMaintenance({});
    context.isShipmentLifecycleMode_ = () => false;
    context.ensureMasterChainResumeTrigger_ = () => {};
    context.ensurePollingOnlyResumeTrigger_ = () => {};
    context.getKiotVietDataLock_ = () => ({
      tryLock() { return true; },
      releaseLock() {}
    });
    context.migrateKiotVietSheetsIfNeeded_ = () => {};
    context.isKiotVietQuotaPaused_ = () => false;
    context.syncCustomerReportIfDue_ = () => { reportCalls++; };
    context.syncCustomerDebtReportsIfDue_ = () => { debtCalls++; };

    context.runKiotVietMaintenanceTick_();

    assert.equal(reportCalls, 1);
    assert.equal(debtCalls, 1);
  });

  it('installs the 15-minute maintenance trigger idempotently', () => {
    const created = [];
    const deleted = [];
    const oldTrigger = { getHandlerFunction() { return 'runKiotVietMaintenanceTick_'; } };
    const context = loadMaintenance({}, {
      ScriptApp: {
        getProjectTriggers() { return [oldTrigger]; },
        deleteTrigger(trigger) { deleted.push(trigger.getHandlerFunction()); },
        newTrigger(handler) {
          const record = { handler };
          const builder = {
            timeBased() { return builder; },
            everyMinutes(minutes) { record.minutes = minutes; return builder; },
            create() { created.push(record); }
          };
          return builder;
        }
      }
    });

    context.setupMaintenanceTrigger();

    assert.deepEqual(deleted, ['runKiotVietMaintenanceTick_']);
    assert.deepEqual(created, [{ handler: 'runKiotVietMaintenanceTick_', minutes: 15 }]);
  });
});

describe('Quota-pause defers hydrate-needing webhooks without an attempt penalty', () => {
  // createMemorySheet() (khai bao o dau file) chi mo phong deleteRows() bang
  // cach giam maxRows cho cac test kiem tra gioi han luoi; no khong that su
  // cat phan tu khoi mang rows noi bo. Test cuoi trong khoi nay can xac nhan
  // mot dong DA THAT SU bi xoa sau khi xu ly thanh cong, nen dung mock rieng,
  // don gian hon, co deleteRows() xoa dung mang rows.
  function createDeletingQueueSheet(name, initialRows) {
    let rows = initialRows.map(row => row.slice());
    return {
      getName() { return name; },
      hideSheet() {},
      getLastRow() { return rows.length; },
      getRange(row, column, rowCount = 1, columnCount = 1) {
        return {
          getValues() {
            return Array.from({ length: rowCount }, (_, rowOffset) =>
              Array.from({ length: columnCount }, (_, columnOffset) =>
                (rows[row - 1 + rowOffset] || [])[column - 1 + columnOffset] ?? ''
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
          }
        };
      },
      deleteRows(start, count) { rows.splice(start - 1, count); },
      getRows() { return rows.map(row => row.slice()); }
    };
  }

  it('a quota-related failure on an isolated item is finalized with skipAttemptPenalty', () => {
    let claimCalls = 0;
    const finalizedBatches = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => true;
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.getKiotVietDataLock_ = () => ({
      waitLock() {}, hasLock() { return true; }, releaseLock() {}
    });
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      if (claimCalls > 1) return [];
      return [{
        id: 'queue-paused',
        eventType: 'product.update',
        payload: JSON.stringify({ Notifications: [{ Action: 'product.update', Data: [{ Id: 1 }] }] })
      }];
    };
    context.processWebhookQueueItem_ = () => {
      throw new Error('KIOTVIET_QUOTA_PAUSED: dang tam dung goi KiotViet API do het quota UrlFetch.');
    };
    context.finalizeWebhookQueueBatch_ = results => {
      finalizedBatches.push(results);
      return true;
    };

    context.processWebhookQueue();

    assert.equal(finalizedBatches.length, 1);
    assert.equal(finalizedBatches[0][0].id, 'queue-paused');
    assert.equal(finalizedBatches[0][0].skipAttemptPenalty, true);
  });

  it('a non-quota failure on an isolated item is still finalized without the penalty (attempts still count)', () => {
    const finalizedBatches = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/sync/WebhookQueue.gs'
    ]);
    context.isShipmentLifecycleMode_ = () => true;
    context.acquireWebhookQueueRunnerLease_ = () => 'test-runner';
    context.releaseWebhookQueueRunnerLease_ = () => {};
    context.recoverWebhookQueueAfterBatchResize_ = () => 0;
    context.getKiotVietDataLock_ = () => ({
      waitLock() {}, hasLock() { return true; }, releaseLock() {}
    });
    let claimCalls = 0;
    context.claimWebhookQueueBatch_ = () => {
      claimCalls++;
      if (claimCalls > 1) return [];
      return [{
        id: 'queue-bad-data',
        eventType: 'product.update',
        payload: JSON.stringify({ Notifications: [{ Action: 'product.update', Data: [{ Id: 1 }] }] })
      }];
    };
    context.processWebhookQueueItem_ = () => {
      throw new Error('Loi khong lien quan quota: du lieu khong hop le.');
    };
    context.finalizeWebhookQueueBatch_ = results => {
      finalizedBatches.push(results);
      return true;
    };

    context.processWebhookQueue();

    assert.equal(finalizedBatches[0][0].skipAttemptPenalty, false);
  });

  it('end-to-end: a webhook needing hydrate stays PENDING with unchanged attempts while quota is paused', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const queueSheet = createMemorySheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['wh-1', new Date(), 'product.update', JSON.stringify({
        Notifications: [{ Action: 'product.update', Data: [{ Id: 1, ProductCode: 'SP1' }] }]
      }), 'PENDING', 0, '', '']
    ], { maxRows: 10, maxColumns: 8 });
    const properties = {
      KIOTVIET_RETAILER: 'CHhanoi',
      KIOTVIET_QUOTA_PAUSE_UNTIL: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
    let fetchAllCalls = 0;

    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/sync/UpdateHandlers.gs',
      'src-dashboard/sync/WebhookQueue.gs'
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
        getDocumentLock() { return null; },
        getScriptLock() { return { tryLock() { return true; }, waitLock() {}, hasLock() { return true; }, releaseLock() {} }; }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return {
            getSheetByName(name) { return name === '_KV_WEBHOOK_QUEUE' ? queueSheet : null; },
            insertSheet(name) {
              if (name === '_KV_WEBHOOK_QUEUE') return queueSheet;
              throw new Error('unexpected sheet requested: ' + name);
            }
          };
        },
        flush() {}
      },
      Utilities: {
        getUuid() { return 'lease-' + Math.random().toString(36).slice(2); },
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      },
      UrlFetchApp: {
        fetchAll(requests) { fetchAllCalls++; return requests.map(() => ({ getResponseCode: () => 200, getContentText: () => '{}' })); }
      }
    });
    context.getKiotVietToken = () => 'fake-token';

    context.processWebhookQueue();

    assert.equal(fetchAllCalls, 0, 'khong duoc goi fetchAll thuc te trong luc dang tam dung');
    const rows = queueSheet.getRows();
    assert.equal(rows.length, 2, 'webhook can hydrate phai con nam lai trong hang doi, khong bi xoa');
    assert.equal(rows[1][0], 'wh-1');
    assert.equal(rows[1][4], 'PENDING', 'trang thai phai quay lai PENDING, khong duoc danh dau ERROR');
    assert.equal(rows[1][5], 0, 'so lan thu khong duoc tang len vi day la loi lien quan quota');
  });

  it('end-to-end: once the backoff window elapses, the deferred webhook is processed and removed from the queue', () => {
    const headers = ['ID', 'Received', 'Type', 'Payload', 'Status', 'Attempts', 'Lease', 'Error'];
    const queueSheet = createDeletingQueueSheet('_KV_WEBHOOK_QUEUE', [
      headers,
      ['wh-1', new Date(), 'product.update', JSON.stringify({
        Notifications: [{ Action: 'product.update', Data: [{ Id: 1, ProductCode: 'SP1' }] }]
      }), 'PENDING', 0, '', '']
    ]);
    // Khong dat KIOTVIET_QUOTA_PAUSE_UNTIL: mo phong thoi diem sau khi backoff da het han.
    const properties = { KIOTVIET_RETAILER: 'CHhanoi' };

    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/sync/UpdateHandlers.gs',
      'src-dashboard/sync/WebhookQueue.gs'
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
        getDocumentLock() { return null; },
        getScriptLock() { return { tryLock() { return true; }, waitLock() {}, hasLock() { return true; }, releaseLock() {} }; }
      },
      SpreadsheetApp: {
        getActiveSpreadsheet() {
          return {
            getSheetByName(name) { return name === '_KV_WEBHOOK_QUEUE' ? queueSheet : null; },
            insertSheet(name) {
              if (name === '_KV_WEBHOOK_QUEUE') return queueSheet;
              throw new Error('unexpected sheet requested: ' + name);
            }
          };
        },
        flush() {}
      },
      Utilities: {
        getUuid() { return 'lease-' + Math.random().toString(36).slice(2); },
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      },
      UrlFetchApp: {
        fetchAll(requests) {
          return requests.map(() => ({
            getResponseCode: () => 200,
            getContentText: () => JSON.stringify({ data: { Id: 1, ProductCode: 'SP1' } })
          }));
        }
      }
    });
    context.getKiotVietToken = () => 'fake-token';
    context.upsertKiotVietSheetItems_ = () => {};
    context.enrichProductTrademarkNames_ = () => {};

    context.processWebhookQueue();

    const rows = queueSheet.getRows();
    assert.equal(rows.length, 1, 'webhook da xu ly xong phai bi xoa khoi hang doi, hang doi khong bi reset thu cong');
  });
});

describe('Invoice webhook fast path and cross-owner locks', () => {
  function loadInvoiceUpdater() {
    return loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/sync/UpdateHandlers.gs'
    ], {
      LockService: {
        getDocumentLock() { return null; },
        getScriptLock() { return {}; },
        getUserLock() { return {}; }
      }
    });
  }

  it('writes a complete invoice webhook without hydrating it from KiotViet', () => {
    const context = loadInvoiceUpdater();
    const writes = [];
    context.hydrateKiotVietItems_ = () => {
      throw new Error('complete invoice webhook must not consume UrlFetch quota');
    };
    context.upsertKiotVietSheetItems_ = (schema, items) => writes.push(['invoices', items]);
    context.replaceInvoiceDetailsForInvoices_ = items => writes.push(['details', items]);
    context.updateCustomerProductReportFromInvoices_ = items => writes.push(['report', items]);
    const invoice = { Id: 1, Code: 'HD000001', InvoiceDetails: [{ ProductCode: 'SP1' }] };

    context.updateInvoicesFromWebhook([invoice]);

    assert.equal(writes.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(writes[0][1])), [invoice]);
  });

  it('hydrates only incomplete invoice webhook items and preserves their input order', () => {
    const context = loadInvoiceUpdater();
    const hydrateCalls = [];
    const written = [];
    const complete = { Id: 1, Code: 'HD1', InvoiceDetails: [] };
    const incomplete = { Id: 2, Code: 'HD2' };
    context.hydrateKiotVietItems_ = items => {
      hydrateCalls.push(items);
      return items.map(item => Object.assign({}, item, {
        CustomerName: 'Hydrated',
        InvoiceDetails: [{ ProductCode: 'SP2' }]
      }));
    };
    context.upsertKiotVietSheetItems_ = (schema, items) => written.push(...items);
    context.replaceInvoiceDetailsForInvoices_ = () => {};
    context.updateCustomerProductReportFromInvoices_ = () => {};

    context.updateInvoicesFromWebhook([complete, incomplete]);

    assert.equal(hydrateCalls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(hydrateCalls[0])), [incomplete]);
    assert.deepEqual(written.map(item => item.Id), [1, 2]);
    assert.equal(written[1].CustomerName, 'Hydrated');
  });

  it('uses a script-wide lock when no document lock exists', () => {
    const scriptLock = { name: 'script' };
    let userLockCalls = 0;
    const context = loadAppsScript([
      'src-dashboard/utils/Helpers.gs'
    ], {
      LockService: {
        getDocumentLock() { return null; },
        getScriptLock() { return scriptLock; },
        getUserLock() { userLockCalls++; return { name: 'user' }; }
      }
    });

    assert.equal(context.getKiotVietDataLock_(), scriptLock);
    assert.equal(context.getKiotVietInvoiceLock_(), scriptLock);
    assert.equal(userLockCalls, 0);
  });
});

describe('Flagged hydrate-skip for products/orders/customers/categories', () => {
  function loadUpdater(hydrateSkipEntities) {
    const properties = {
      KIOTVIET_HYDRATE_SKIP_ENTITIES: hydrateSkipEntities || ''
    };
    return loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/sync/UpdateHandlers.gs'
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
        getDocumentLock() { return null; },
        getScriptLock() { return {}; },
        getUserLock() { return {}; }
      }
    });
  }

  const ENTITY_CASES = [
    {
      key: 'products', handler: 'updateProductsFromWebhook',
      complete: { Id: 1, ProductCode: 'SP1', Inventories: [] },
      incomplete: { Id: 2, ProductCode: 'SP2' }
    },
    {
      key: 'orders', handler: 'updateOrdersFromWebhook',
      complete: { Id: 1, OrderCode: 'DH1', OrderDetails: [] },
      incomplete: { Id: 2, OrderCode: 'DH2' }
    },
    {
      key: 'customers', handler: 'updateCustomersFromWebhook',
      complete: { Id: 1, CustomerCode: 'KH1', Name: 'Khach A', GroupId: 5 },
      incomplete: { Id: 2, CustomerCode: 'KH2', Name: 'Khach B' }
    },
    {
      key: 'categories', handler: 'updateCategoriesFromWebhook',
      complete: { Id: 1, CategoryId: 1, Name: 'Nhom A' },
      incomplete: { Id: 2, CategoryId: 2 }
    }
  ];

  ENTITY_CASES.forEach(function(entityCase) {
    describe(entityCase.key, () => {
      it('co bat KIOTVIET_HYDRATE_SKIP_ENTITIES nhung khong bat cho bang nay: van hydrate toan bo nhu cu (khong doi hanh vi mac dinh)', () => {
        const context = loadUpdater('mot-bang-khac');
        let hydrateCalls = 0;
        context.hydrateKiotVietItems_ = items => {
          hydrateCalls++;
          return items;
        };
        context.enrichProductTrademarkNames_ = () => {};
        context.getKiotVietToken = () => 'token';
        context.upsertKiotVietSheetItems_ = () => {};
        context.deleteKiotVietSheetItems_ = () => {};

        context[entityCase.handler]([entityCase.complete, entityCase.incomplete]);

        assert.equal(hydrateCalls, 1, 'khi co gan bat cho bang nay, van phai hydrate toan bo nhu truoc (mac dinh khong doi)');
      });

      it('bat cho bang nay: payload du du lieu khong hydrate, khong tieu UrlFetch', () => {
        const context = loadUpdater(entityCase.key);
        context.hydrateKiotVietItems_ = () => {
          throw new Error('complete webhook payload must not consume UrlFetch quota');
        };
        context.enrichProductTrademarkNames_ = () => {};
        context.getKiotVietToken = () => 'token';
        const writes = [];
        context.upsertKiotVietSheetItems_ = (schema, items) => writes.push(items);
        context.deleteKiotVietSheetItems_ = () => {};

        assert.doesNotThrow(() => context[entityCase.handler]([entityCase.complete]));
      });

      it('bat cho bang nay: chi hydrate item thieu du lieu, giu nguyen thu tu trong lo', () => {
        const context = loadUpdater(entityCase.key);
        const hydrateCalls = [];
        context.hydrateKiotVietItems_ = items => {
          hydrateCalls.push(items);
          return items.map(item => Object.assign({}, item, { Hydrated: true }));
        };
        context.enrichProductTrademarkNames_ = () => {};
        context.getKiotVietToken = () => 'token';
        const writes = [];
        context.upsertKiotVietSheetItems_ = (schema, items) => writes.push(...items);
        context.deleteKiotVietSheetItems_ = () => {};

        context[entityCase.handler]([entityCase.complete, entityCase.incomplete]);

        assert.equal(hydrateCalls.length, 1);
        assert.deepEqual(
          JSON.parse(JSON.stringify(hydrateCalls[0])),
          [entityCase.incomplete]
        );
        assert.equal(writes.length, 2);
        assert.equal(writes[0].Id, entityCase.complete.Id);
        assert.equal(writes[0].Hydrated, undefined);
        assert.equal(writes[1].Id, entityCase.incomplete.Id);
        assert.equal(writes[1].Hydrated, true);
      });
    });
  });
});

describe('Chunked sync with checkpoint and auto-resume', () => {
  it('replaces every stale detail row for recently changed purchase orders', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs'
    ]);
    const purchaseHeaders = vm.runInContext('Array.from(PURCHASE_SHEET_HEADERS)', context);
    const existingRows = [
      Array.from(purchaseHeaders),
      ['HN', 'PN-OLD', '01/09/2026', '', '', '', '', '', 100, 0, 100, 0, '', 2, 2, 'Phiếu tạm', 'SP-OLD-1'],
      ['HN', 'PN-OLD', '01/09/2026', '', '', '', '', '', 100, 0, 100, 0, '', 2, 2, 'Phiếu tạm', 'SP-OLD-2'],
      ['HN', 'PN-KEEP', '01/09/2026', '', '', '', '', '', 50, 0, 50, 0, '', 1, 1, 'Đã nhập hàng', 'SP-KEEP']
    ];
    const merged = context.mergeRecentPurchaseRows_(existingRows, [{
      Code: 'PN-OLD',
      BranchName: 'HN',
      PurchaseDate: '2026-09-08T09:00:00+07:00',
      Total: 300,
      StatusValue: 'Đã nhập hàng',
      PurchaseOrderDetails: [
        { ProductCode: 'SP-NEW-1', Quantity: 1, Price: 100 },
        { ProductCode: 'SP-NEW-2', Quantity: 2, Price: 100 }
      ]
    }]);

    assert.deepEqual(
      Array.from(merged.slice(1), row => [row[1], row[16]]),
      [['PN-KEEP', 'SP-KEEP'], ['PN-OLD', 'SP-NEW-1'], ['PN-OLD', 'SP-NEW-2']]
    );
  });

  it('polls purchases from an incremental lastModified checkpoint', () => {
    const fetchedQueries = [];
    const replaced = [];
    const properties = {};
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      Utilities: {
        formatDate(date) { return date.toISOString().slice(0, 19); }
      },
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
      tryLock() { return true; }, releaseLock() {}
    });
    context.getKiotVietToken = () => 'token';
    context.fetchAllKiotVietPages_ = (schema, token, extraQuery) => {
      fetchedQueries.push(extraQuery);
      return [{ Code: 'PN-1' }];
    };
    context.replaceRecentPurchaseOrders_ = orders => replaced.push(...orders);

    const result = context.syncRecentPurchases_(new Date('2026-09-08T05:00:00.000Z'));

    assert.equal(fetchedQueries.length, 1);
    assert.match(fetchedQueries[0], /lastModifiedFrom=2026-09-06T05%3A00%3A00/);
    assert.deepEqual(replaced, [{ Code: 'PN-1' }]);
    assert.equal(result.updatedOrders, 1);
    assert.equal(
      properties.KIOTVIET_INCREMENTAL_CHECKPOINT_purchases,
      '2026-09-08T05:00:00.000Z'
    );
  });

  it('reconciles invoices with overlap and advances checkpoint only after success', () => {
    const fetchedQueries = [];
    const written = [];
    const properties = {
      KIOTVIET_INCREMENTAL_CHECKPOINT_invoices: '2026-09-08T04:30:00.000Z',
      KIOTVIET_INCREMENTAL_LAST_START_invoices: '2026-09-08T04:00:00.000Z'
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      Utilities: {
        formatDate(date) { return date.toISOString().slice(0, 19); }
      },
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
    context.getKiotVietInvoiceLock_ = () => ({
      tryLock() { return true; }, releaseLock() {}
    });
    context.getKiotVietToken = () => 'token';
    context.fetchAllKiotVietPages_ = (schema, token, extraQuery) => {
      fetchedQueries.push(extraQuery);
      return [{ Code: 'HD-1', InvoiceDetails: [] }];
    };
    context.updateInvoicesFromWebhook = invoices => written.push(...invoices);

    const result = context.syncRecentInvoices_(new Date('2026-09-08T05:00:00.000Z'));

    assert.match(fetchedQueries[0], /lastModifiedFrom=2026-09-08T04%3A20%3A00/);
    assert.equal(result.updatedInvoices, 1);
    assert.deepEqual(written, [{ Code: 'HD-1', InvoiceDetails: [] }]);
    assert.equal(
      properties.KIOTVIET_INCREMENTAL_CHECKPOINT_invoices,
      '2026-09-08T05:00:00.000Z'
    );

    properties.KIOTVIET_INCREMENTAL_LAST_START_invoices = '2026-09-08T05:01:00.000Z';
    context.updateInvoicesFromWebhook = () => { throw new Error('sheet write failed'); };
    assert.throws(
      () => context.syncRecentInvoices_(new Date('2026-09-08T05:10:00.000Z')),
      /sheet write failed/
    );
    assert.equal(
      properties.KIOTVIET_INCREMENTAL_CHECKPOINT_invoices,
      '2026-09-08T05:00:00.000Z'
    );
  });

  it('throttles duplicate incremental invoice runs across trigger owners', () => {
    let fetchCalls = 0;
    const properties = {
      KIOTVIET_INCREMENTAL_LAST_START_invoices: '2026-09-08T04:58:00.000Z'
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
    context.getKiotVietInvoiceLock_ = () => ({
      tryLock() { return true; }, releaseLock() {}
    });
    context.fetchAllKiotVietPages_ = () => { fetchCalls++; return []; };

    const result = context.syncRecentInvoices_(new Date('2026-09-08T05:00:00.000Z'));

    assert.equal(result.throttled, true);
    assert.equal(fetchCalls, 0);
  });

  it('uses incremental polling for returns and suppliers instead of historical chunks', () => {
    const schemaKeys = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ]);
    context.syncKiotVietIncrementalTable_ = schemaKey => {
      schemaKeys.push(schemaKey);
      return { schemaKey, updatedItems: 0 };
    };
    context.syncKiotVietTableChunk_ = () => {
      throw new Error('incremental polling must not start a historical chunk');
    };

    const result = context.syncPollingOnly_(new Date('2026-09-08T05:00:00.000Z'));

    assert.deepEqual(schemaKeys, ['returns', 'suppliers']);
    assert.equal(result.length, 2);
  });

  it('installs near-real-time invoice and incremental polling triggers', () => {
    const deleted = [];
    const created = [];
    const oldFast = { getHandlerFunction() { return 'syncRecentPurchases_'; } };
    const oldFull = { getHandlerFunction() { return 'syncPollingOnly_'; } };
    const oldInvoices = { getHandlerFunction() { return 'syncRecentInvoices_'; } };
    const oldInvoiceBackfill = { getHandlerFunction() { return 'resumeSyncInvoicesChunk'; } };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      ScriptApp: {
        getProjectTriggers() { return [oldFast, oldFull, oldInvoices, oldInvoiceBackfill]; },
        deleteTrigger(trigger) { deleted.push(trigger.getHandlerFunction()); },
        newTrigger(handler) {
          const record = { handler };
          const builder = {
            timeBased() { return builder; },
            everyMinutes(minutes) { record.minutes = minutes; return builder; },
            everyHours(hours) { record.hours = hours; return builder; },
            create() { created.push(record); }
          };
          return builder;
        }
      },
      PropertiesService: {
        getScriptProperties() { return { deleteProperty() {} }; }
      }
    });

    context.setupPollingTrigger();

    assert.deepEqual(deleted.sort(), [
      'resumeSyncInvoicesChunk', 'syncPollingOnly_',
      'syncRecentInvoices_', 'syncRecentPurchases_'
    ]);
    assert.deepEqual(created, [
      { handler: 'syncPollingOnly_', hours: 4 },
      { handler: 'syncRecentPurchases_', minutes: 60 },
      { handler: 'syncRecentInvoices_', minutes: 60 }
    ]);
  });

  it('does not access a newly inserted staging sheet before Sheets makes it available', () => {
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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

    assert.equal(prepared.sheet, staging);
    assert.equal(prepared.created, true);
  });

  it('uses a bounded page size for detail-heavy purchase orders', () => {
    const requestedUrls = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
    const properties = {
      KIOTVIET_INCREMENTAL_CHECKPOINT_invoices: '2026-08-27T00:00:00.000Z'
    };
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      Utilities: {
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
      }
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
    assert.equal(properties.KIOTVIET_INCREMENTAL_CHECKPOINT_invoices, undefined);
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

  it('restarts only the invoice backfill under the invoice data lock', () => {
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      LockService: {
        getScriptLock() {
          return {
            tryLock() { return true; },
            releaseLock() { lockReleased = true; }
          };
        }
      },
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
    context.removeSpecificChunkTrigger_ = handler => removedHandlers.push(handler);
    context.syncKiotVietTableChunk_ = schemaKey => {
      syncCalls++;
      return { schemaKey, isCompleted: false };
    };

    const result = context.restartInvoicesBackfill();

    assert.equal(result.schemaKey, 'invoices');
    assert.equal(syncCalls, 1);
    assert.deepEqual(removedHandlers, [
      'resumeSyncInvoicesChunk', 'resumeManualInvoicesBackfill_'
    ]);
    assert.equal(properties.SYNC_CHUNK_STATE_invoices, undefined);
    assert.equal(properties.KIOTVIET_INVOICE_BACKFILL_LAST_RESULT, undefined);
    assert.equal(properties.SYNC_CHUNK_STATE_orders, '{"currentItem":200}');
    assert.equal(lockReleased, true);
  });

  it('reschedules invoice backfill after an unexpected Sheets timeout', () => {
    const scheduled = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ], {
      LockService: {
        getScriptLock() {
          return { tryLock() { return true; }, releaseLock() {} };
        }
      }
    });
    context.syncKiotVietTableChunk_ = () => {
      throw new Error('Service Spreadsheets timed out while accessing document');
    };
    context.scheduleSpecificChunkTrigger_ = handler => scheduled.push(handler);

    const result = context.syncInvoicesChunk();

    assert.equal(result.isCompleted, false);
    assert.match(result.error, /timed out/);
    assert.deepEqual(scheduled, ['resumeManualInvoicesBackfill_']);
  });

  it('runs the legacy polling resume handler through incremental reconciliation', () => {
    let pollingCalls = 0;
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs'
    ]);
    context.syncPollingOnly_ = () => { pollingCalls++; return []; };

    context.resumePollingOnlyChunk_();

    assert.equal(pollingCalls, 1);
  });

  it('retires obsolete polling resume state without restarting historical chunks', () => {
    const deletedTriggers = [];
    const properties = {
      POLLING_ONLY_CHAIN_INDEX: '2',
      SYNC_CHUNK_STATE_purchases: '{"currentItem":21320}'
    };
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      ScriptApp: {
        getProjectTriggers() {
          return [{ getHandlerFunction() { return 'resumePollingOnlyChunk_'; } }];
        },
        deleteTrigger(trigger) { deletedTriggers.push(trigger.getHandlerFunction()); }
      }
    });

    assert.equal(context.ensurePollingOnlyResumeTrigger_(), false);
    assert.deepEqual(deletedTriggers, ['resumePollingOnlyChunk_']);
    assert.equal(properties.POLLING_ONLY_CHAIN_INDEX, undefined);
    assert.equal(properties.SYNC_CHUNK_STATE_purchases, '{"currentItem":21320}');
  });

  it('reschedules the master chain when another sync holds the data lock', () => {
    const createdTriggers = [];
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
    context.getKiotVietToken = () => 'fake-token';
    context.syncCustomerDebtReports = () => { reportCalls++; };
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
      'src-dashboard/kiotviet/QuotaGuard.gs',
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
        sleep() {},
        formatDate(date) { return date.toISOString().slice(0, 10).replace(/-/g, ''); }
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

describe('Full backfill stays manual-only (no periodic trigger)', () => {
  const BACKFILL_RESUME_HANDLERS = [
    'resumeMasterChainSync_',
    'resumeSyncCategoriesChunk',
    'resumeSyncProductsChunk',
    'resumeSyncOrdersChunk',
    'resumeSyncReturnsChunk',
    'resumeSyncCustomersChunk',
    'resumeSyncSuppliersChunk',
    'resumeSyncPurchasesChunk',
    'resumeManualInvoicesBackfill_',
    'resumeSyncInvoicesChunk',
    'syncAllDataChunked',
    'syncAllInitialData'
  ];

  function createTriggerRecorder() {
    const created = [];
    const scriptApp = {
      getProjectTriggers() { return []; },
      deleteTrigger() {},
      newTrigger(handler) {
        const record = { handler };
        const builder = {
          timeBased() { return builder; },
          everyMinutes(minutes) { record.everyMinutes = minutes; return builder; },
          everyHours(hours) { record.everyHours = hours; return builder; },
          everyDays(days) { record.everyDays = days; return builder; },
          atHour(hour) { record.atHour = hour; return builder; },
          nearMinute(minute) { record.nearMinute = minute; return builder; },
          inTimezone(timezone) { record.timezone = timezone; return builder; },
          create() { created.push(record); }
        };
        return builder;
      }
    };
    return { scriptApp, created };
  }

  it('never installs a periodic trigger for any full-backfill handler', () => {
    const { scriptApp, created } = createTriggerRecorder();
    const properties = {};
    const context = loadAppsScript([
      'src-dashboard/config/Config.gs',
      'src-dashboard/utils/Helpers.gs',
      'src-dashboard/kiotviet/QuotaGuard.gs',
      'src-dashboard/kiotviet/SheetSchemas.gs',
      'src-dashboard/kiotviet/SyncInitial.gs',
      'src-dashboard/sync/WebhookQueue.gs',
      'src-dashboard/kiotviet/WebhookAdmin.gs',
      'src-dashboard/kiotviet/CustomerReport.gs',
      'src-dashboard/kiotviet/CustomerDebtReport.gs'
    ], {
      ScriptApp: scriptApp,
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

    context.setupQueueProcessingTrigger();
    context.setupPollingTrigger();
    context.setupCustomerReportDailyTrigger();
    context.setupCustomerDebtReportDailyTrigger();
    context.setupKiotVietRecoveryTriggers();

    const createdHandlers = created.map(record => record.handler);
    const backfillTriggersCreated = createdHandlers.filter(
      handler => BACKFILL_RESUME_HANDLERS.indexOf(handler) !== -1
    );

    assert.deepEqual(
      backfillTriggersCreated,
      [],
      'setup*Trigger() functions must never schedule a periodic trigger for a full-backfill handler; ' +
      'full backfill (syncAllDataChunked/syncAllInitialData and their resume handlers) is manual-only.'
    );
    assert.ok(createdHandlers.length > 0, 'sanity check: the setup functions should still install their own real triggers');
  });
});
