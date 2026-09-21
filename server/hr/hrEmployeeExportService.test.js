'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const employeeDirectory = require('./employeeDirectory');
const { buildEmployeeDirectoryWorkbook } = require('./hrEmployeeExportService');
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
  assert.deepEqual(headers, ['Họ và tên', 'Chức vụ', 'Cơ sở', 'Số điện thoại', 'Email']);
  assert.deepEqual(rows.map(r => r[2]).sort(), ['Hà Nội', 'Hà Nội', 'Sài Gòn']);
  assert.equal(rows.length, 3);
});

test('xuất danh sách nhân sự: lọc theo phòng ban (không phân biệt hoa thường) và theo cơ sở', async () => {
  const kho = await exportRows({ department: 'kho' }, [BRANCHES.HANOI, BRANCHES.SAIGON]);
  assert.deepEqual(kho.rows.map(r => r[0]).sort(), ['Nguyễn Văn A', 'Trần Thị C']);

  const khoHanoi = await exportRows({ department: 'KHO' }, [BRANCHES.HANOI]);
  assert.match(khoHanoi.fileName, /^HN_/);
  assert.deepEqual(khoHanoi.rows.map(r => r[0]), ['Nguyễn Văn A']);
});
