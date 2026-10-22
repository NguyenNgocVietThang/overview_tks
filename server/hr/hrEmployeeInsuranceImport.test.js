'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { parseInsuranceWorkbook, previewInsuranceImport } = require('./hrEmployeeInsuranceImport');

test('đọc file xuất theo ID và chỉ lấy số bảo hiểm', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Danh sách nhân sự');
  sheet.addRow(['Họ và tên', 'Số bảo hiểm', 'ID nhân sự']);
  sheet.addRow(['Tên đã bị sửa', '0123456789', '42']);
  const rows = await parseInsuranceWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(rows, [{ number: 2, id: '42', insuranceNumber: '0123456789' }]);
  const preview = previewInsuranceImport(rows, [{ rowIndex: 42, sourceBranch: 'Hà Nội', insuranceNumber: '' }], ['Hà Nội']);
  assert.deepEqual(preview.updates, [{ id: '42', insuranceNumber: '0123456789' }]);
});

test('nhập mã bảo hiểm dạng text và không cắt đuôi .0', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Danh sách nhân sự');
  sheet.addRow(['Số bảo hiểm', 'ID nhân sự']);
  sheet.addRow(['HAN.D10.BVC.26.', '42']);
  sheet.addRow(['HAN.D10.BVC.0', '43']);
  const rows = await parseInsuranceWorkbook(await workbook.xlsx.writeBuffer());
  assert.deepEqual(rows.map(row => row.insuranceNumber), ['HAN.D10.BVC.26.', 'HAN.D10.BVC.0']);
  const preview = previewInsuranceImport(rows, [
    { rowIndex: 42, sourceBranch: 'Hà Nội', insuranceNumber: '' },
    { rowIndex: 43, sourceBranch: 'Hà Nội', insuranceNumber: '' }
  ], ['Hà Nội']);
  assert.deepEqual(preview.updates, [
    { id: '42', insuranceNumber: 'HAN.D10.BVC.26.' },
    { id: '43', insuranceNumber: 'HAN.D10.BVC.0' }
  ]);
});

test('chặn ID lặp, số trùng và nhân sự ngoài phạm vi', () => {
  const employees = [
    { rowIndex: 1, sourceBranch: 'Hà Nội', insuranceNumber: '1111111111' },
    { rowIndex: 2, sourceBranch: 'Hà Nội', insuranceNumber: '' },
    { rowIndex: 3, sourceBranch: 'Sài Gòn', insuranceNumber: '' }
  ];
  const result = previewInsuranceImport([
    { number: 2, id: '2', insuranceNumber: '1111111111' },
    { number: 3, id: '2', insuranceNumber: '2222222222' },
    { number: 4, id: '3', insuranceNumber: '3333333333' },
    { number: 5, id: '999', insuranceNumber: '4444444444' }
  ], employees, ['Hà Nội']);
  assert.equal(result.valid, 0);
  assert.equal(result.errors.length, 4);
});
