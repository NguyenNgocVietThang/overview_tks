'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGender } = require('./hrGender');

test('normalizeGender: dữ liệu file cũ viết hoa/không dấu quy về Nam/Nữ/Khác', () => {
  for (const [input, expected] of [['NAM', 'Nam'], [' nam ', 'Nam'], ['Nam', 'Nam'], ['NỮ', 'Nữ'], ['nu', 'Nữ'], ['Nữ', 'Nữ'], ['NỮ', 'Nữ'], ['KHÁC', 'Khác'], ['khac', 'Khác'], ['', ''], [null, ''], [undefined, '']]) {
    assert.equal(normalizeGender(input), expected, String(input));
  }
  assert.equal(normalizeGender('  Không rõ '), 'Không rõ', 'giá trị lạ giữ nguyên (không mất dữ liệu)');
});
