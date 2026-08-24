const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');

function readComputedStyle(relativePath, selector) {
  const html = fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const element = dom.window.document.querySelector(selector);

  assert.ok(element, `${selector} must exist in ${relativePath}`);
  return dom.window.getComputedStyle(element);
}

test('account content wrapper fills the available content width', () => {
  const style = readComputedStyle(path.join('account', 'index.html'), '.account-wrap');

  assert.equal(style.width, '100%');
  assert.equal(style.maxWidth, 'none');
});

test('shipment content wrapper fills the available content width', () => {
  const style = readComputedStyle(path.join('shipment', 'index.html'), '.lookup-wrap');

  assert.equal(style.width, '100%');
  assert.equal(style.maxWidth, 'none');
});
