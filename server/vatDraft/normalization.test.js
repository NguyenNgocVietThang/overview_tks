'use strict';

// Port tests/test_normalization.py (vat-draft-app) + cac truong hop rieng cua ban JS.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeCode,
  normalizeCodeForMatch,
  normalizeDiacriticsInsensitive,
  toFloatOrNone,
  normalizeNameForMatching,
  stripPriceAndVatSuffix
} = require('./normalization');

test('normalizeCode giu so 0 dau va bo khoang trang hai dau', () => {
  assert.equal(normalizeCode('00123'), '00123');
  assert.equal(normalizeCode('  ABC123  '), 'ABC123');
  assert.equal(normalizeCode(null), '');
  assert.equal(normalizeCode(NaN), 'nan', 'o NA cua pandas thanh chuoi "nan" nhu Python');
});

test('normalizeCodeForMatch khong phan biet hoa/thuong, gop khoang trang', () => {
  assert.equal(normalizeCodeForMatch('Vat001'), normalizeCodeForMatch('VAT001 '));
  assert.equal(normalizeCodeForMatch('TKS  THẤP'), 'tks thấp');
});

test('toFloatOrNone doc so dang chu', () => {
  assert.equal(toFloatOrNone('1,234'), 1234);
  assert.equal(toFloatOrNone(''), null);
  assert.equal(toFloatOrNone(null), null);
  assert.equal(toFloatOrNone('abc'), null);
  assert.equal(toFloatOrNone('8%'), 0.08);
  assert.equal(toFloatOrNone('8.00%'), 0.08);
  assert.equal(toFloatOrNone(' 75,614 '), 75614);
  assert.equal(toFloatOrNone(NaN), null);
  assert.equal(toFloatOrNone('1,5'), 15, 'giu nguyen hanh vi app cu: phay luon la phan cach nghin');
});

test('normalizeNameForMatching bo dau, tach token so', () => {
  const n = normalizeNameForMatching('Ấm giữ nhiệt 1000ML Hoa');
  assert.ok(n.numberTokens.includes('1000ml'));
  assert.ok(n.wordTokens.includes('am'));
  assert.ok(n.wordTokens.includes('giu'));
  assert.equal(n.cleanedText, 'am giu nhiet hoa');
});

test('normalizeNameForMatching: 02 va 2 la cung token', () => {
  assert.deepEqual(
    normalizeNameForMatching('Kích thước 02').numberTokens,
    normalizeNameForMatching('Kích thước 2').numberTokens
  );
});

test('normalizeNameForMatching bo dau cau va gom khoang trang', () => {
  const n = normalizeNameForMatching('Đũa tre (A6), KT: 26cm+-10%');
  assert.equal(n.cleanedText, 'dua tre a6 kt');
  assert.deepEqual(n.numberTokens, ['26cm', '10']);
});

test('stripPriceAndVatSuffix bo phan gia va chu VAT', () => {
  assert.equal(stripPriceAndVatSuffix('Ấm giữ nhiệt 1000ML (72,100 - 78,500) (VAT)'), 'Ấm giữ nhiệt 1000ML');
  assert.equal(stripPriceAndVatSuffix('Thuế vat VATDA'), 'Thuế VATDA', 'chi bo chu VAT dung rieng');
  assert.equal(stripPriceAndVatSuffix(''), '');
});

test('normalizeDiacriticsInsensitive de khop chua chuoi ten don vi ban', () => {
  assert.equal(
    normalizeDiacriticsInsensitive('CÔNG TY CỔ PHẦN  TKS GROUP'),
    'cong ty co phan tks group'
  );
});
