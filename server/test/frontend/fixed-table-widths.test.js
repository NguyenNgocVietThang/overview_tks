'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', '..', 'public');
const read = file => fs.readFileSync(path.join(pub, file), 'utf8');
const pages = ['index.html', 'account/index.html', 'humanresources/index.html', 'shipment/lifecycle/index.html'];

test('shared.css dat table-layout:fixed cho bang fixed-table', () => {
  assert.match(read('shared/shared.css'), /table\.fixed-table\s*\{[^}]*table-layout:\s*fixed/);
});

test('moi <th> cua bang fixed-table deu khai bao width px (do rong cot khong doi theo du lieu)', () => {
  let tables = 0;
  pages.forEach(page => {
    for (const table of read(page).matchAll(/<table[^>]*class="[^"]*\bfixed-table\b[^"]*"[^>]*>[\s\S]*?<\/thead>/g)) {
      tables++;
      const ths = table[0].match(/<th(?:\s[^>]*)?>/g) || [];
      assert.ok(ths.length > 0, page + ': bang khong co th');
      ths.forEach(th => assert.match(th, /style="[^"]*width:\s*\d+px/, page + ': th thieu width -> ' + th));
    }
  });
  assert.ok(tables >= 19, 'phai co it nhat 19 bang co dinh, thuc te ' + tables);
});

test('cac bang du lieu chinh cua dashboard deu la fixed-table', () => {
  const html = read('index.html');
  ['cpDetailRows', 'productReportRows', 'recentStockoutResultRows', 'stockout90dResultRows', 'stockout30dResultRows',
    'inventoryValueRows', 'topSellingRows', 'allProductRows', 'newlyImportedRows', 'todayNewProductRows', 'endOfDayRows',
    'customerRevenueRows', 'debtRows', 'debtManagementRows'
  ].forEach(id => {
    const at = html.indexOf('<tbody id="' + id + '"');
    assert.ok(at > 0, id + ' khong co trong trang');
    const openTag = html.slice(html.lastIndexOf('<table', at)).match(/^<table[^>]*>/)[0];
    assert.match(openTag, /class="[^"]*fixed-table/, id + ' chua la fixed-table');
  });
});
