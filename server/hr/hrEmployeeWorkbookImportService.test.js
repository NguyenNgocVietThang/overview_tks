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

test('chỉ điền ô còn trống, không ghi đè dữ liệu đã nhập trên web', async () => {
  const updates = [];
  const repo = {
    selectAllActive: async () => [{ id: 3, branch: 'hanoi', hoTen: 'Nguyễn Văn A', soDienThoai: '0901234567', chucVu: 'Thủ kho', ngayVaoLam: null, ngaySinh: '1990-01-01', gioiTinh: '' }],
    updateExtendedById: async (id, row) => { updates.push(row); }
  };
  await importRows([{ branch: 'hanoi', hoTen: 'Nguyễn Văn A', soDienThoai: '0901234567', chucVu: 'Khác', ngayVaoLam: '2020-05-06', ngaySinh: '1999-09-09', gioiTinh: 'NAM' }], { repo });
  assert.equal(updates[0].chucVu, 'Thủ kho');
  assert.equal(updates[0].ngayVaoLam, '2020-05-06');
  assert.equal(updates[0].ngaySinh, '1990-01-01');
  assert.equal(updates[0].gioiTinh, 'NAM');
});

test('nhân sự có trong file nhưng chưa có trên web được tạo mới kèm hồ sơ', async () => {
  const created = [];
  const repo = {
    selectAllActive: async () => [],
    insertEmployee: async data => { created.push(data); return { id: 99, branch: data.branch, hoTen: data.hoTen }; },
    updateExtendedById: async (id, row) => { created.push({ id, ngayVaoLam: row.ngayVaoLam }); }
  };
  const result = await importRows([{ branch: 'saigon', hoTen: 'Lê Văn B', boPhan: 'KHO', soDienThoai: '0911111111', ngayVaoLam: '2022-02-07' }], { repo });
  assert.equal(result.created, 1);
  assert.equal(created[0].employmentStatus, 'active');
  assert.deepEqual(created[1], { id: 99, ngayVaoLam: '2022-02-07' });
});

test('tạo mới lỗi (trùng SĐT...) thì ghi vào failed, không dừng cả lần nhập', async () => {
  const repo = {
    selectAllActive: async () => [],
    insertEmployee: async () => { throw new Error('duplicate'); },
    updateExtendedById: async () => {}
  };
  const result = await importRows([{ branch: 'saigon', hoTen: 'Lê Văn B', soDienThoai: '0911111111' }], { repo });
  assert.equal(result.created, 0);
  assert.equal(result.failed.length, 1);
});
