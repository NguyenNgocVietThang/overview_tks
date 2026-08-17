'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}

test('login co nut dang ky rieng va giu nut Google', () => {
  const html = readPublic('login/index.html');
  assert.match(html, /href="\/register\/"/);
  assert.match(html, /googleBtnWrap/);
});

test('trang dang ky va trang van chuyen co script inline hop le', () => {
  for (const page of ['register/index.html', 'shipment/index.html']) {
    const html = readPublic(page);
    inlineScripts(html).forEach(script => assert.doesNotThrow(() => new Function(script)));
  }
});

test('trang van chuyen mac dinh an ket qua va chi co hai cot cong khai', () => {
  const html = readPublic('shipment/index.html');
  assert.match(html, /class="panel results-panel"/);
  assert.match(html, /<th>Mã hóa đơn<\/th><th>Trạng thái<\/th>/);
  assert.doesNotMatch(html, /SĐT khách|Tổng tiền hàng|Khách hàng<\/th>/);
});

test('shared nav an Bao cao tong hop voi Khach va chuyen Khach ve shipment', () => {
  const script = readPublic('shared/shared-nav.js');
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /user\.vaiTro === 'Khách'/);
  assert.match(script, /window\.location\.href = '\/shipment\/'/);
});
