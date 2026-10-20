'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { parseEmployeeWorkbook } = require('./hrEmployeeWorkbookImport');

function workbookBuffer() {
  const wb = XLSX.utils.book_new();
  const headers = ['STT', 'TRẠNG THÁI', 'HỌ VÀ TÊN', 'BỘ PHẬN', 'CHỨC VỤ', 'NGÀY VÀO LÀM', 'SỐ NGÀY LV', 'NGÀY SINH', 'SỐ CCCD', 'SĐT', 'ĐỊA CHỈ HIỆN TẠI', 'THÔNG TIN NGƯỜI THÂN', '', '', 'GIỚI TÍNH', 'HỒ SƠ', 'VÂN TAY', 'NGÀY NGHỈ VIỆC'];
  const sub = ['', '', '', '', '', '', '', '', '', '', '', 'QH', 'Họ Tên', 'SĐT'];
  const row = [1, 'LV', 'Nguyễn Văn A', 'SALE', 'Nhân viên', new Date(2024, 0, 2), 1, new Date(1990, 4, 6), 1234567890, 901234567, 'Hà Nội', 'Vợ', 'Trần Thị B', 912345678, 'Nam', 'X', 'X', ''];
  const ws = XLSX.utils.aoa_to_sheet([headers, sub, row], { cellDates: true });
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers.slice(0, 17), sub, row.slice(0, 17)], { cellDates: true }), 'Sheet2');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

test('đọc file DS nhân sự: Sheet1=Hà Nội, giữ CCCD/SĐT dạng chuỗi và ánh xạ thông tin mở rộng', () => {
  const rows = parseEmployeeWorkbook(workbookBuffer());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].branch, 'hanoi');
  assert.equal(rows[1].branch, 'saigon');
  assert.equal(rows[0].soCccd, '001234567890');
  assert.equal(rows[0].soDienThoai, '0901234567');
  assert.equal(rows[0].nguoiThanSoDienThoai, '0912345678');
  assert.equal(rows[0].ngayVaoLam, '2024-01-02');
  assert.equal(rows[0].ngaySinh, '1990-05-06');
  assert.equal(rows[0].hoSoDayDu, true);
  assert.equal(rows[0].vanTayDaDangKy, true);
});

test('từ chối workbook không có đủ hai sheet chuẩn', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['HỌ VÀ TÊN'], ['A']]), 'Sai');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  assert.throws(() => parseEmployeeWorkbook(buffer), /Sheet1.*Sheet2/);
});

test('đọc file DS nhân sự: giới tính viết hoa trong file (NAM/NỮ) quy về Nam/Nữ; trạng thái và ngày nghỉ việc vẫn đọc đủ', () => {
  const wb = XLSX.utils.book_new();
  const headers = ['STT', 'TRẠNG THÁI', 'HỌ VÀ TÊN', 'BỘ PHẬN', 'CHỨC VỤ', 'NGÀY VÀO LÀM', 'SỐ NGÀY LV', 'NGÀY SINH', 'SỐ CCCD', 'SĐT', 'ĐỊA CHỈ HIỆN TẠI', 'THÔNG TIN NGƯỜI THÂN', '', '', 'GIỚI TÍNH', 'HỒ SƠ', 'VÂN TAY', 'NGÀY NGHỈ VIỆC'];
  const sub = ['', '', '', '', '', '', '', '', '', '', '', 'QH', 'Họ Tên', 'SĐT'];
  const hn = [1, 'NV', 'Nguyễn Văn A', 'SALE', '', new Date(2024, 0, 2), 1, new Date(1990, 4, 6), '', 901234567, '', '', '', '', 'NAM', 'X', '', new Date(2026, 5, 30)];
  const sg = [1, 'LV', 'Trần Thị B', 'KHO', '', new Date(2024, 0, 2), 1, new Date(1990, 4, 6), '', 901234568, '', '', '', '', 'NỮ', 'X', ''];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, sub, hn], { cellDates: true }), 'Sheet1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers.slice(0, 17), sub, sg], { cellDates: true }), 'Sheet2');
  const rows = parseEmployeeWorkbook(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }));
  assert.equal(rows[0].gioiTinh, 'Nam');
  assert.equal(rows[1].gioiTinh, 'Nữ');
  assert.equal(rows[0].trangThaiNguon, 'NV');
  assert.equal(rows[0].ngayNghiViec, '2026-06-30');
});
