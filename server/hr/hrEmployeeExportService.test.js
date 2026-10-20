'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const employeeDirectory = require('./employeeDirectory');
const { buildEmployeeDirectoryWorkbook, workingDays } = require('./hrEmployeeExportService');
const { BRANCHES } = require('../branch/branches');

const EMPLOYEES = [
  { sourceBranch: BRANCHES.HANOI, hoTen: 'Nguyễn Văn A', boPhan: 'KHO', soDienThoai: '0900000001', email: 'a@x.com' },
  { sourceBranch: BRANCHES.HANOI, hoTen: 'Lê Văn D', boPhan: 'SALE', soDienThoai: '0900000004', email: 'd@x.com' },
  { sourceBranch: BRANCHES.SAIGON, hoTen: 'Trần Thị C', boPhan: 'Kho', soDienThoai: '0900000003', email: 'c@x.com' }
];

async function exportRows(filters, branch) {
  const original = employeeDirectory.getSnapshot;
  employeeDirectory.getSnapshot = async () => ({ employees: EMPLOYEES });
  try {
    const { buffer, fileName } = await buildEmployeeDirectoryWorkbook(filters, branch);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    const rows = [];
    sheet.eachRow((row, index) => { if (index > 1) rows.push(row.values.slice(1)); });
    return { fileName, headers: sheet.getRow(1).values.slice(1), rows };
  } finally {
    employeeDirectory.getSnapshot = original;
  }
}

test('xuất danh sách nhân sự: nhiều cơ sở gộp chung, có cột Cơ sở, tiền tố TKS_', async () => {
  const { fileName, headers, rows } = await exportRows({}, [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.match(fileName, /^TKS_danh-sach-nhan-su/);
  assert.deepEqual(headers, ['Họ và tên', 'Chức vụ', 'Cơ sở', 'Số điện thoại', 'Email', 'Trạng thái']);
  assert.deepEqual(rows.map(r => r[2]).sort(), ['Hà Nội', 'Hà Nội', 'Sài Gòn']);
  assert.equal(rows.length, 3);
});

test('Quản lý xuất đầy đủ hồ sơ nhân sự mở rộng', async () => {
  const original = EMPLOYEES[0];
  Object.assign(original, {
    chucVu: 'Thủ kho', ngayVaoLam: '2024-01-02', ngaySinh: '1995-02-03', soCccd: '012345678901',
    diaChiHienTai: 'Hà Nội', gioiTinh: 'Nam', hoSoDayDu: true, vanTayDaDangKy: true,
    nguoiThanQuanHe: 'Vợ', nguoiThanHoTen: 'Nguyễn B', nguoiThanSoDienThoai: '0900000002',
    ngayNghiViec: '', createdAt: '2026-10-01T00:00:00.000Z'
  });
  try {
    const { headers, rows } = await exportRows({ includeExtended: true }, [BRANCHES.HANOI]);
    assert.deepEqual(headers, [
      'Họ và tên', 'Bộ phận', 'Chức vụ', 'Ngày vào làm', 'Số ngày LV', 'Ngày sinh', 'Số CCCD', 'SĐT',
      'Địa chỉ hiện tại', 'Giới tính', 'Hồ sơ', 'Vân tay', 'Cơ sở', 'QH người thân', 'Họ tên người thân',
      'SĐT người thân', 'Trạng thái', 'Ngày nghỉ việc', 'Email', 'Ngày thêm'
    ]);
    const row = rows.find(item => item[0] === 'Nguyễn Văn A');
    assert.ok(row);
    assert.equal(row[1], 'KHO');
    assert.equal(row[2], 'Thủ kho');
    assert.equal(row[6], '012345678901');
    assert.equal(row[8], 'Hà Nội');
    assert.equal(row[13], 'Vợ');
    assert.equal(row[18], 'a@x.com');
  } finally {
    Object.keys(original).forEach(key => delete original[key]);
    Object.assign(original, { sourceBranch: BRANCHES.HANOI, hoTen: 'Nguyễn Văn A', boPhan: 'KHO', soDienThoai: '0900000001', email: 'a@x.com' });
  }
});

test('số ngày làm việc: nhận chuỗi ISO lẫn Date, dừng ở ngày nghỉ việc, theo giờ Việt Nam', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  assert.equal(workingDays('2026-10-10', null, now), 10);
  assert.equal(workingDays(new Date(2026, 9, 10), null, now), 10);
  assert.equal(workingDays('2026-10-10', '2026-10-15', now), 5);
  assert.equal(workingDays('2026-10-25', null, now), 0);
  assert.equal(workingDays('', null, now), '');
  // 20:00 UTC ngày 19 = 03:00 ngày 20 giờ Việt Nam
  assert.equal(workingDays('2026-10-19', null, new Date('2026-10-19T20:00:00Z')), 1);
});

test('xuất mở rộng: đủ ngày vào làm, số ngày LV, ngày sinh, giới tính, ngày nghỉ việc', async () => {
  const original = EMPLOYEES[1];
  Object.assign(original, { ngayVaoLam: '2024-01-02', ngaySinh: '1995-02-03', gioiTinh: 'Nam', ngayNghiViec: '2024-01-12', employmentStatus: 'resigned' });
  try {
    const { rows } = await exportRows({ includeExtended: true }, [BRANCHES.HANOI]);
    const row = rows.find(item => item[0] === 'Lê Văn D');
    assert.equal(row[3], '02/01/2024');
    assert.equal(row[4], 10);
    assert.equal(row[5], '03/02/1995');
    assert.equal(row[9], 'Nam');
    assert.equal(row[17], '12/01/2024');
  } finally {
    Object.keys(original).forEach(key => delete original[key]);
    Object.assign(original, { sourceBranch: BRANCHES.HANOI, hoTen: 'Lê Văn D', boPhan: 'SALE', soDienThoai: '0900000004', email: 'd@x.com' });
  }
});

test('xuất danh sách nhân sự: lọc theo phòng ban (không phân biệt hoa thường) và theo cơ sở', async () => {
  const kho = await exportRows({ department: 'kho' }, [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(kho.rows.map(r => r[0]).sort(), ['Nguyễn Văn A', 'Trần Thị C']);

  const khoHanoi = await exportRows({ department: 'KHO' }, [BRANCHES.HANOI]);
  assert.match(khoHanoi.fileName, /^HN_/);
  assert.deepEqual(khoHanoi.rows.map(r => r[0]), ['Nguyễn Văn A']);
});
