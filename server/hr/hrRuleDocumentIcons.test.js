'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ALLOWED_ICON_KEYS, normalizeIconKey } = require('./hrRuleDocumentIcons');

test('normalizeIconKey: giu lai icon hop le', () => {
  for (const key of ALLOWED_ICON_KEYS) {
    assert.equal(normalizeIconKey(key), key);
  }
});

test('normalizeIconKey: gia tri khong hop le / rong / null / undefined -> null (khong co icon, khong nem loi)', () => {
  assert.equal(normalizeIconKey('khong-ton-tai'), null);
  assert.equal(normalizeIconKey(''), null);
  assert.equal(normalizeIconKey(null), null);
  assert.equal(normalizeIconKey(undefined), null);
  assert.equal(normalizeIconKey('<svg onload=alert(1)>'), null);
});

test('normalizeIconKey: tu trim khoang trang quanh gia tri hop le', () => {
  assert.equal(normalizeIconKey('  clock  '), 'clock');
});

test('ALLOWED_ICON_KEYS khop dung danh sach trong migration 0062', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0062_hr_rule_document_icon.sql'), 'utf8');
  for (const key of ALLOWED_ICON_KEYS) {
    assert.match(sql, new RegExp(`'${key}'`), `migration 0062 phai liet ke icon '${key}'`);
  }
});
