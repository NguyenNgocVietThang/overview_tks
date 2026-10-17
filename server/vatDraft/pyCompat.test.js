'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  pyRound, pySum, pyFloat, pyStrip, pySplitWs, pyCasefold, pyQuote, pyFloatRepr, pyStr, pyMin2, pyMax2, cmpTuple
} = require('./pyCompat');

test('pyRound: lam tron banker\'s tren gia tri nhi phan that, khop Python round()', () => {
  // Gia tri doi chieu lay tu Python 3.12.
  assert.equal(pyRound(0.125, 2), 0.12);
  assert.equal(pyRound(0.375, 2), 0.38);
  assert.equal(pyRound(2.675, 2), 2.67);
  assert.equal(pyRound(1.005, 2), 1.0);
  assert.equal(pyRound(11500 / 1.08, 2), 10648.15);
  assert.equal(pyRound(32500 / 1.08, 2), 30092.59);
  assert.equal(pyRound(1234.565, 2), 1234.57);
  assert.equal(pyRound(133518.5), 133518);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(-0.125, 2), -0.12);
});

test('pySum: tong bu Neumaier nhu sum() cua Python 3.12', () => {
  assert.equal(pySum(Array(10).fill(0.1)), 1.0);
  assert.equal(pySum([]), 0);
  assert.equal(pySum([1e100, 1, -1e100]), 1);
});

test('pyFloat: cu phap float() cua Python, khong phai Number()', () => {
  assert.equal(pyFloat('1_000'), 1000);
  assert.equal(pyFloat(' 12.5 '), 12.5);
  assert.equal(pyFloat('.5'), 0.5);
  assert.equal(pyFloat('5.'), 5);
  assert.equal(pyFloat('1e3'), 1000);
  assert.equal(pyFloat('0x10'), null);
  assert.equal(pyFloat(''), null);
  assert.equal(pyFloat('1__0'), null);
  assert.equal(pyFloat('inf'), Infinity);
  assert.equal(pyFloat('-Infinity'), -Infinity);
  assert.ok(Number.isNaN(pyFloat('NaN')));
});

test('pyStrip/pySplitWs dung tap khoang trang cua Python', () => {
  assert.equal(pyStrip('\x1c a \x85'), 'a');
  const bom = String.fromCharCode(0xfeff);
  assert.equal(pyStrip(`${bom}a`), `${bom}a`, 'U+FEFF khong phai khoang trang trong Python');
  assert.deepEqual(pySplitWs('  b  a\tc '), ['b', 'a', 'c']);
  assert.deepEqual(pySplitWs('   '), []);
});

test('pyCasefold: ß -> ss, ς -> σ, Cherokee giu chu hoa', () => {
  assert.equal(pyCasefold('Straße'), 'strasse');
  assert.equal(pyCasefold('ΟΔΟΣ ς'), 'οδοσ σ');
  assert.equal(pyCasefold('ﬁ'), 'fi');
  assert.equal(pyCasefold('ᏸ'), 'Ᏸ');
  assert.equal(pyCasefold('Đồ GIA DỤNG'), 'đồ gia dụng');
});

test('pyQuote khop urllib.parse.quote (safe="/")', () => {
  assert.equal(pyQuote("HD1 HD2 (a)!*'"), 'HD1%20HD2%20%28a%29%21%2A%27');
  assert.equal(pyQuote('a/b'), 'a/b');
  assert.equal(pyQuote('CÔNG TY'), 'C%C3%94NG%20TY');
});

test('pyFloatRepr/pyStr khop repr/str cua Python', () => {
  assert.equal(pyFloatRepr(1), '1.0');
  assert.equal(pyFloatRepr(0.1), '0.1');
  assert.equal(pyFloatRepr(1e16), '1e+16');
  assert.equal(pyFloatRepr(1234567890123456), '1234567890123456.0');
  assert.equal(pyFloatRepr(0.0001), '0.0001');
  assert.equal(pyFloatRepr(0.00001), '1e-05');
  assert.equal(pyFloatRepr(-2.5), '-2.5');
  assert.equal(pyStr(NaN), 'nan');
  assert.equal(pyStr(null), 'None');
  assert.equal(pyStr('abc'), 'abc');
});

test('pyMin2/pyMax2 giu doi so dau khi gap NaN; cmpTuple so sanh tung phan tu', () => {
  assert.equal(pyMin2(5, NaN), 5);
  assert.equal(pyMax2(0, 3), 3);
  assert.equal(cmpTuple([1, 'b'], [1, 'a']), 1);
  assert.equal(cmpTuple([false, 2], [true, 1]), -1);
  assert.equal(cmpTuple([-0, 'x'], [0, 'x']), 0);
});
