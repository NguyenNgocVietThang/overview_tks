'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createLifecycleExportFile } = require('./orderLifecycleExport');

test('createLifecycleExportFile: cột khớp y hệt sheet nguồn + Cơ sở + Trạng thái + Giá trị có bán', async () => {
  const orders = [{
    orderCode: 'HD001', branch: 'HN', saleName: 'Sale A', customerName: 'KH A',
    saleSentAt: '01/09/2026 08:00', accountantApprovedOrderAt: '',
    driverName: '', driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '',
    shipReceivedAt: '', orderSignedAt: '',
    warning: true,
    kiotPhieuTam: true, sellableValue: 21750000, orderTotal: 32000000, orderDate: '30/08/2026 09:15',
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
    'Mã đơn hàng', 'Thời gian đặt hàng', 'Cơ sở', 'Nhân viên bán hàng', 'Khách hàng', 'Giá trị đơn', 'Giá trị có bán',
    'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn', 'Lái xe',
    'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng',
    'Xác nhận đã giao/khách ký nhận', 'Ship nhận đơn', 'Đơn đã ký nhận', 'Trạng thái', 'Cảnh báo'
  ]);

  const dataRow = worksheet.getRow(2).values.slice(1);
  assert.equal(dataRow[0], 'HD001');
  assert.equal(dataRow[1], '30/08/2026 09:15');
  assert.equal(dataRow[2], 'Hà Nội');
  assert.equal(dataRow[5], 32000000, 'Giá trị đơn là SỐ (không phải chuỗi)');
  assert.equal(dataRow[6], 21750000, 'Giá trị có bán là SỐ (không phải chuỗi) để sắp xếp/cộng trong Excel');
  assert.equal(dataRow[7], '01/09/2026 08:00');
  assert.equal(dataRow[15], 'Đơn đã gửi kế toán');
  assert.equal(dataRow[16], 'Cảnh báo');
  assert.equal(worksheet.getColumn(6).numFmt, '#,##0');
  assert.equal(worksheet.getColumn(7).numFmt, '#,##0');
});

test('createLifecycleExportFile: Giá trị có bán để trống khi đơn không còn là Phiếu tạm / không có giá trị', async () => {
  const base = {
    branch: 'HN', saleName: '', customerName: '', saleSentAt: '', accountantApprovedOrderAt: '', driverName: '',
    driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '', shipReceivedAt: '', orderSignedAt: '',
    summary: { label: 'Đơn đang được giao' }
  };
  const file = await createLifecycleExportFile([
    { ...base, orderCode: 'A', kiotPhieuTam: false, sellableValue: null },
    { ...base, orderCode: 'B', sellableValue: 5000 }, // khong gop Kiot (khong co kiotPhieuTam)
    { ...base, orderCode: 'C', kiotPhieuTam: true, sellableValue: 0 }
  ]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.worksheets[0];
  const sellable = [2, 3, 4].map(rowNumber => worksheet.getRow(rowNumber).getCell(7).value);
  assert.deepEqual(sellable, ['', '', 0], 'Phiếu tạm có giá trị 0 vẫn xuất 0; còn lại để trống');
});

test('createLifecycleExportFile: header freeze, khong to mau, chu den, an gridline, full border', async () => {
  const orders = [{
    orderCode: 'HD001', branch: 'HN', saleName: 'Sale A', customerName: 'KH A',
    saleSentAt: '', accountantApprovedOrderAt: '', driverName: '',
    driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '',
    shipReceivedAt: '', summary: { code: 'SENT_TO_ACCOUNTANT', label: 'Đơn đã gửi kế toán' }
  }];
  const file = await createLifecycleExportFile(orders);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const worksheet = workbook.worksheets[0];

  assert.equal(worksheet.views[0].state, 'frozen');
  assert.equal(worksheet.views[0].showGridLines, false);

  const header = worksheet.getRow(1);
  assert.equal(header.font.color.argb, 'FF000000');
  header.eachCell(cell => {
    assert.equal(cell.fill === undefined || cell.fill.pattern === 'none', true);
    assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
  });

  const dataRow = worksheet.getRow(2);
  dataRow.eachCell(cell => {
    assert.ok(cell.border && cell.border.top && cell.border.left && cell.border.bottom && cell.border.right);
  });
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
