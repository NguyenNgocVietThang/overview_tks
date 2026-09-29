'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');
const indexPath = path.join(publicDir, 'index.html');

function createDashboard() {
  const source = fs.readFileSync(indexPath, 'utf8');
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#customers' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = {
    authGuard: () => new Promise(() => {}),
    can: () => true,
    handleBranchError: () => false,
    renderTopSidebar() {}
  };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

test('bao cao doanh thu theo khach doc tu bang dung san ghi ro du lieu den het ngay nao', () => {
  const dom = createDashboard();
  const hint = dom.window.customerProductWindowHint({
    computedAt: '2026-09-27T17:10:00.000Z',
    range: { from: '30/06/2026', to: '27/09/2026', days: 90, label: '90 ngày' }
  });
  assert.equal(hint, '90 ngày đến hết 27/09/2026');
  dom.window.close();
});

test('bao cao tinh tu sheet (khong co computedAt) hoac thieu range giu nhan "90 ngày gần đây"', () => {
  const dom = createDashboard();
  assert.equal(dom.window.customerProductWindowHint({ range: { to: '27/09/2026' } }), '90 ngày gần đây');
  assert.equal(dom.window.customerProductWindowHint({ computedAt: '2026-09-27T17:10:00.000Z' }), '90 ngày gần đây');
  assert.equal(dom.window.customerProductWindowHint(null), '90 ngày gần đây');
  dom.window.close();
});

test('o goi y cua so 90 ngay co id de loadCustomerProductReport cap nhat', () => {
  const dom = createDashboard();
  const element = dom.window.document.getElementById('cpWindowHint');
  assert.ok(element, 'thieu #cpWindowHint');
  assert.equal(element.textContent, '90 ngày gần đây');
  dom.window.close();
});
