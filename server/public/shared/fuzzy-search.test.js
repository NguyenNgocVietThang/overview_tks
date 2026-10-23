const test = require('node:test');
const assert = require('node:assert/strict');
const fz = require('./fuzzy-search');

test('combo 100 set khớp combo set', () => {
  assert.ok(fz.matches('Combo 100 Set quà tặng', 'combo 100 set'));
  assert.ok(!fz.matches('Combo Set quà tặng', 'combo 100 set'));
  assert.ok(fz.matches('Combo Set quà tặng', 'combo 100 set'.replace(' 100', '')));
});
test('một từ phải khớp; hai từ phải khớp cả hai', () => {
  assert.ok(!fz.matches('abc', 'xyz'));
  assert.ok(!fz.matches('combo', 'combo set'));
});
test('bỏ dấu và đ', () => {
  assert.ok(fz.matches('Đường Hà Nội', 'duong ha noi'));
});
test('xếp khớp nhiều từ và nguyên cụm lên trước', () => {
  const out = fz.filter(['combo xyz set', 'set combo 100', 'combo 100 set'], 'combo 100 set');
  assert.equal(out[0], 'combo 100 set');
  assert.equal(out.length, 2);
});
test('ngưỡng khớp tối thiểu 80%', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10].map(fz.requiredMatches), [1, 2, 3, 4, 4, 5, 8]);
  assert.ok(!fz.matches('HN C Trạng Đại Mỗ', 'HN C Hạnh Hạ Mỗ'));
  assert.ok(fz.matches('HN C Hạnh Hạ Mỗ', 'HN C Hạnh Hạ Mỗ'));
});
test('ô trống trả toàn bộ', () => {
  assert.deepEqual(fz.filter(['a', 'b'], '  '), ['a', 'b']);
});
