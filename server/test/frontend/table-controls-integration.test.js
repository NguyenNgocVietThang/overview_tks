'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const publicDir = path.join(__dirname, '../../public');
const pages = ['index.html', 'account/index.html', 'cashbook/index.html', 'humanresources/index.html', 'shipment/lifecycle/index.html', 'stock-locations/index.html'];
test('every table page loads shared controls after page styles and before application scripts', () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(publicDir, page), 'utf8');
    const css = html.indexOf('/shared/table-controls.css?v=20261009-1');
    const js = html.indexOf('/shared/table-controls.js?v=20261009-1');
    assert.ok(css > html.lastIndexOf('</style>'), page + ': controls CSS must override page styles');
    assert.ok(js > 0 && js < html.lastIndexOf('<script'), page + ': shared controller required');
    assert.match(html, /data-table-key=/, page + ': stable table identities required');
    const dom = new JSDOM(html);
    for (const header of dom.window.document.querySelectorAll('table th')) {
      assert.ok(header.dataset.columnKey, page + ': field identity missing for ' + header.textContent.trim());
    }
    dom.window.close();
  }
});
test('legacy column persistence and clipped lifecycle notes are replaced', () => {
  const lifecycle = fs.readFileSync(path.join(publicDir, 'shipment/lifecycle/index.html'), 'utf8');
  const locations = fs.readFileSync(path.join(publicDir, 'stock-locations/stock-locations.js'), 'utf8');
  assert.doesNotMatch(lifecycle, /HIDDEN_COLUMNS_STORAGE_KEY|bulkColumnStyle|-webkit-line-clamp/);
  assert.doesNotMatch(locations, /COLUMN_STORAGE_KEY/);
  assert.match(lifecycle, /TKSTables\.enhance\(bulkTable/);
  assert.match(locations, /onVisibilityChange/);
});
