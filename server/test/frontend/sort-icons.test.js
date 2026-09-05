'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function loadHtml(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'public', relativePath), 'utf8');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(script => script.trim());
}

function createPage(relativePath, url) {
  const html = loadHtml(relativePath);
  const dom = new JSDOM(html, { runScripts: 'outside-only', url });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart { destroy() {} };
  dom.window.Chart.defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
  dom.window.setInterval = () => 1;
  dom.window.TKSNav = {
    authGuard: () => new Promise(() => {}),
    handleBranchError: () => false,
    renderTopSidebar() {}
  };
  dom.window.fetch = () => new Promise(() => {});
  inlineScripts(html).forEach(script => dom.window.eval(script));
  return dom;
}

test('cac bang dashboard dung bieu tuong tam giac cho hai chieu sort', () => {
  const dom = createPage('index.html', 'https://tokosi.example/');
  const indicator = dom.window.document.querySelector('.sort-indicator');
  const button = indicator.closest('button');

  button.click();
  assert.equal(indicator.textContent, '▼');
  button.click();
  assert.equal(indicator.textContent, '▲');

  dom.window.close();
});

test('bang nghi phe dung bieu tuong tam giac cho hai chieu sort', () => {
  const dom = createPage('humanresources/index.html', 'https://tokosi.example/humanresources/');
  dom.window.initSortableTables();
  const indicator = dom.window.document.querySelector('.sort-indicator');
  const button = indicator.closest('button');

  button.click();
  assert.equal(indicator.textContent, '▼');
  button.click();
  assert.equal(indicator.textContent, '▲');

  dom.window.close();
});

test('bang nguoi dung dung bieu tuong tam giac cho hai chieu sort', () => {
  const dom = createPage('account/index.html', 'https://tokosi.example/account/');
  const icon = dom.window.document.getElementById('sort-hoTen');

  dom.window.handleSort('hoTen');
  assert.equal(icon.textContent, '▲');
  dom.window.handleSort('hoTen');
  assert.equal(icon.textContent, '▼');

  dom.window.close();
});
