'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createLifecycleExportFile } = require('./orderLifecycleExport');

test('createLifecycleExportFile: cột khớp y hệt sheet nguồn + Cơ sở + Trạng thái', async () => {
  const orders = [{
    orderCode: 'HD001', branch: 'HN', saleName: 'Sale A', customerName: 'KH A',
    saleSentAt: '01/09/2026 08:00', accountantApprovedOrderAt: '',
    driverName: '', driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '',
    summary: { code: 'SENT_TO_ACCOUNTANT', label: 'Đơn đã gửi kế toán' }
  }];

  const file = await createLifecycleExportFile(orders);
  assert.equal(file.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(file.fileName, /^TKS_Vong_doi_don_hang_\d{8}_\d{4}\.xlsx$/);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.worksheets[0];
  const headerRow = worksheet.getRow(1).values.slice(1);
  assert.deepEqual(headerRow, [
    'Mã đơn hàng', 'Cơ sở', 'Nhân viên bán hàng', 'Khách hàng',
    'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn', 'Lái xe',
    'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng',
    'Xác nhận đã giao/khách ký nhận', 'Trạng thái'
  ]);

  const dataRow = worksheet.getRow(2).values.slice(1);
  assert.equal(dataRow[0], 'HD001');
  assert.equal(dataRow[1], 'Hà Nội');
  assert.equal(dataRow[4], '01/09/2026 08:00');
  assert.equal(dataRow[10], 'Đơn đã gửi kế toán');
});

test('createLifecycleExportFile: danh sách rỗng vẫn tạo được file hợp lệ (chỉ có header)', async () => {
  const file = await createLifecycleExportFile([]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.worksheets[0];
  assert.equal(worksheet.rowCount, 1);
});

test('createLifecycleExportFile: giá trị bắt đầu bằng "=" được vô hiệu hóa (chống formula injection)', async () => {
  const orders = [{
    orderCode: '=SUM(A1)', branch: 'SG', saleName: '', customerName: '',
    saleSentAt: '', accountantApprovedOrderAt: '', driverName: '',
    driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '',
    summary: {}
  }];
  const file = await createLifecycleExportFile(orders);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.worksheets[0];
  const cell = worksheet.getRow(2).getCell(1);
  assert.equal(cell.type, ExcelJS.ValueType.String);
  assert.equal(cell.value, "'=SUM(A1)");
});
