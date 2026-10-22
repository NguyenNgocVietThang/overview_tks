'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { dateOnly, rowToEmployee } = require('./hrEmployeesRepository');

test('dateOnly: Date từ cột DATE của pg và chuỗi ISO đều về YYYY-MM-DD', () => {
  assert.equal(dateOnly(new Date(2024, 0, 2)), '2024-01-02');
  assert.equal(dateOnly('2024-01-02T00:00:00.000Z'), '2024-01-02');
  assert.equal(dateOnly(null), null);
  assert.equal(dateOnly('abc'), null);
});

test('rowToEmployee: ngày vào làm, ngày sinh, ngày nghỉ việc là chuỗi YYYY-MM-DD', () => {
  const e = rowToEmployee({ id: 1, ngay_vao_lam: new Date(2016, 0, 1), ngay_sinh: new Date(1990, 7, 4), ngay_nghi_viec: null, gioi_tinh: 'NAM' });
  assert.equal(e.ngayVaoLam, '2016-01-01');
  assert.equal(e.ngaySinh, '1990-08-04');
  assert.equal(e.ngayNghiViec, null);
  assert.equal(e.gioiTinh, 'Nam', 'giới tính viết hoa trong DB được chuẩn hóa khi đọc');
});
