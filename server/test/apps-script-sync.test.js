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
      'src/config/Config.gs',
      'src/kiotviet/WebhookAdmin.gs'
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
      'src/config/Config.gs',
      'src/kiotviet/SheetSchemas.gs'
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
      'src/config/Config.gs',
      'src/kiotviet/SheetSchemas.gs'
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
      'src/config/Config.gs',
      'src/kiotviet/SheetSchemas.gs'
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

describe('Combined dashboard and shipment mode', () => {
  function combinedProperties() {
    return {
      getProperty(name) {
        return name === 'KIOTVIET_SYNC_MODE' ? 'COMBINED' : null;
      }
    };
  }

  it('keeps the full 9-event webhook profile for a combined spreadsheet', () => {
    const context = loadAppsScript([
      'src/config/Config.gs',
      'src/kiotviet/WebhookAdmin.gs'
    ], {
      PropertiesService: { getScriptProperties: combinedProperties }
    });

    assert.equal(context.getKiotVietSyncMode_(), 'COMBINED');
    assert.equal(context.getKiotVietAutoSyncProfile_().eventTypes.length, 9);
  });

  it('applies invoice.update to both dashboard and shipment sheets', () => {
    const calls = [];
    const context = loadAppsScript([
      'src/config/Config.gs',
      'src/sync/WebhookQueue.gs'
    ], {
      PropertiesService: { getScriptProperties: combinedProperties },
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

    assert.deepEqual(calls.map(call => call[0]), ['dashboard', 'shipment']);
  });
});
