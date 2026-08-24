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
