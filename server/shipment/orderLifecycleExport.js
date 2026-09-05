// ==========================================
// ORDER LIFECYCLE EXPORT — xuat Excel cho bang "Toan bo don hang" o
// /shipment/lifecycle/. Cot xuat ra y het 8 cot cua Google Sheet nguon
// (xem SCHEMA o orderLifecycleRepository.js) + Co so + Trang thai hien thi
// tren UI, KHONG parse ngay/gio thanh Date de tranh sai lech voi du lieu tho
// trong sheet (co the co dinh dang loi nhu "15,35" thay vi "15:35").
// ==========================================
'use strict';

const ExcelJS = require('exceljs');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BRANCH_LABEL = Object.freeze({ HN: 'Hà Nội', SG: 'Sài Gòn' });

const COLUMNS = [
  { key: 'orderCode', label: 'Mã đơn hàng' },
  { key: 'branchLabel', label: 'Cơ sở' },
  { key: 'saleName', label: 'Nhân viên bán hàng' },
  { key: 'customerName', label: 'Khách hàng' },
  { key: 'saleSentAt', label: 'Sale gửi đơn cho kế toán' },
  { key: 'accountantApprovedOrderAt', label: 'Kế toán duyệt đơn' },
  { key: 'driverName', label: 'Lái xe' },
  { key: 'driverConfirmedDeliveryAt', label: 'Tài xế gửi xác nhận giao hàng' },
  { key: 'accountantApprovedDeliveryAt', label: 'Kế toán duyệt giao hàng' },
  { key: 'deliveryConfirmedAt', label: 'Xác nhận đã giao/khách ký nhận' },
  { key: 'statusLabel', label: 'Trạng thái' }
];

function neutralizeFormulaText(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function columnValue(order, key) {
  if (key === 'branchLabel') return BRANCH_LABEL[order.branch] || order.branch || '';
  if (key === 'statusLabel') return (order.summary && order.summary.label) || '';
  const raw = order[key];
  return raw === undefined || raw === null ? '' : raw;
}

function fileTimestamp(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(part => part.type !== 'literal')
    .reduce((object, part) => ({ ...object, [part.type]: part.value }), {});
  return `${parts.year}${parts.month}${parts.day}_${parts.hour}${parts.minute}`;
}

function buildLifecycleWorkbook(orders) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Vòng đời đơn hàng');
  worksheet.columns = COLUMNS.map(column => ({ header: column.label, key: column.key }));

  orders.forEach(order => {
    const row = {};
    COLUMNS.forEach(column => { row[column.key] = neutralizeFormulaText(columnValue(order, column.key)); });
    worksheet.addRow(row);
  });

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(orders.length + 1, 1), column: COLUMNS.length }
  };
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C4CE' } } };
  });

  COLUMNS.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    const sampleValues = orders.slice(0, 200).map(order => String(columnValue(order, column.key)));
    const width = Math.min(42, Math.max(12, column.label.length + 2, ...sampleValues.map(value => Math.min(value.length + 2, 42))));
    excelColumn.width = width;
    excelColumn.alignment = { vertical: 'top', wrapText: false };
  });

  return workbook;
}

async function createLifecycleExportFile(orders) {
  const workbook = buildLifecycleWorkbook(orders || []);
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer,
    mimeType: EXCEL_MIME,
    fileName: `TKS_Vong_doi_don_hang_${fileTimestamp()}.xlsx`
  };
}

module.exports = { buildLifecycleWorkbook, createLifecycleExportFile };
