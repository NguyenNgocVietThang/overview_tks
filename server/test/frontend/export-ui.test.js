'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');

function readDashboardHtml() {
  return fs.readFileSync(htmlPath, 'utf8');
}

test('giao dien gan dung 18 nut xuat Excel cho 18 bang co dinh', () => {
  const html = readDashboardHtml();
  const matches = [...html.matchAll(/openExportDialog\('([^']+)'\)/g)].map(match => match[1]);
  assert.equal(matches.length, 18);
  assert.equal(new Set(matches).size, 18);
  assert.deepEqual(matches.sort(), [
    'customers.debt', 'customers.productDetail', 'customers.productMonthlyCompare', 'customers.revenue', 'debt.period',
    'invoices.orders', 'invoices.recent', 'invoices.returns',
    'overview.deactivated', 'overview.new-products', 'overview.purchases', 'overview.transactions',
    'products.all', 'products.child-categories', 'products.low-stock', 'products.newly-imported', 'products.top-selling',
    'suppliers.list'
  ].sort());
});

test('modal co du dieu khien chon truong va script inline bien dich hop le', () => {
  const html = readDashboardHtml();
  ['exportModalBackdrop', 'exportFieldSearch', 'exportFields', 'exportConfirmButton'].forEach(id => {
    assert.match(html, new RegExp(`id="${id}"`));
  });
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim());
  scripts.forEach(script => assert.doesNotThrow(() => new Function(script)));
});

test('nut xuat ket qua tim kiem bi an rieng o tab Tong quan', () => {
  const html = readDashboardHtml();
  const functionMatch = html.match(/function searchExportButtonHtml\(\)\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(functionMatch, 'phai co helper tao nut xuat cho ket qua tim kiem');
  assert.match(functionMatch[1], /state\.view === 'overview'/);
  assert.match(functionMatch[1], /openExportDialog\(\\'search\.results\\'\)/);
});
