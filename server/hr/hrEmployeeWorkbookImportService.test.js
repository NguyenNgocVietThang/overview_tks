'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { importRows } = require('./hrEmployeeWorkbookImportService');

test('ghép theo cơ sở + SĐT và cập nhật thông tin mở rộng', async () => {
  const updates = [];
  const repo = {
    selectAllActive: async () => [{ id: 7, branch: 'hanoi', hoTen: 'Nguyễn Văn A', soDienThoai: '+84901234567' }],
    updateExtendedById: async (id, row) => { updates.push({ id, row }); }
  };
  const result = await importRows([{ branch: 'hanoi', hoTen: 'Tên khác', soDienThoai: '0901234567', soCccd: '001' }], { repo });
  assert.equal(result.updated, 1);
  assert.equal(result.unmatched.length, 0);
  assert.equal(updates[0].id, 7);
});

test('không cập nhật khi họ tên trùng nhiều người trong cùng cơ sở', async () => {
  const repo = {
    selectAllActive: async () => [
      { id: 1, branch: 'saigon', hoTen: 'Nguyễn Văn A', soDienThoai: '' },
      { id: 2, branch: 'saigon', hoTen: 'Nguyễn Văn A', soDienThoai: '' }
    ],
    updateExtendedById: async () => { throw new Error('không được gọi'); }
  };
  const result = await importRows([{ branch: 'saigon', hoTen: 'Nguyễn Văn A', soDienThoai: '' }], { repo });
  assert.equal(result.updated, 0);
  assert.equal(result.ambiguous.length, 1);
});
