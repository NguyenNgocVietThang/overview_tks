'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWorkAssignment } = require('./accountWorkAssignment');
test('role and department are independent and canonicalized', () => {
  assert.deepEqual(normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: 'Hà Nội', boPhan: 'kế toán' }), { workCoSo: 'Hà Nội', boPhan: 'Kế toán' });
});
test('internal workplace requires a physical branch and catalog department', () => {
  for (const workCoSo of ['', 'Cả hai', 'invalid']) assert.throws(() => normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo, boPhan: 'Kế toán' }), { statusCode: 400, code: 'WORK_BRANCH_REQUIRED' });
  assert.throws(() => normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: 'Hà Nội' }), { code: 'DEPARTMENT_REQUIRED' });
  assert.throws(() => normalizeWorkAssignment({ vaiTro: 'Trợ lý', workCoSo: 'Hà Nội', boPhan: 'Sale SG' }), { code: 'DEPARTMENT_BRANCH_MISMATCH' });
});
test('guest keeps valid workplace and may leave both fields empty', () => {
  assert.deepEqual(normalizeWorkAssignment({ vaiTro: 'Khách', workCoSo: 'Hà Nội', boPhan: 'Kế toán' }), { workCoSo: 'Hà Nội', boPhan: 'Kế toán' });
  assert.deepEqual(normalizeWorkAssignment({ vaiTro: 'Khách' }), { workCoSo: '', boPhan: '' });
});
