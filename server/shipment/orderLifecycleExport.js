// ==========================================
// ORDER LIFECYCLE EXPORT — xuat Excel cho bang "Toan bo don hang" o
// /shipment/lifecycle/. Cot xuat ra y het 10 cot cua Google Sheet nguon
// (xem SCHEMA o orderLifecycleRepository.js) + Co so + Trang thai + Canh bao + cac cot cua don Kiot
// (Thoi gian dat hang, Gia tri don, Gia tri co ban, Ghi chu, Trang thai KiotViet) hien
// thi tren UI, KHONG parse ngay/gio thanh Date de tranh sai lech voi du lieu tho
// trong sheet (co the co dinh dang loi nhu "15,35" thay vi "15:35").
// ==========================================
'use strict';

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const BRANCH_LABEL = Object.freeze({ HN: 'Hà Nội', SG: 'Sài Gòn' });

// Gioi han so dong moi lan xuat: 60 nghin dong x 19 cot mat ~7 giay CPU lien tuc (do 2026-10-02), chan toan bo
// may chu vi chay 1 tien trinh. 20 nghin dong ~2 giay. Vuot thi route tra 400 TOO_MANY_ROWS.
const MAX_EXPORT_ROWS = 20000;

const COLUMNS = [
  { key: 'orderCode', label: 'Mã đơn hàng' },
  // Thời gian đặt hàng trên Kiot (bảng Đặt hàng); trống nếu dòng không có đơn Kiot.
  { key: 'orderDate', label: 'Thời gian đặt hàng' },
  { key: 'branchLabel', label: 'Cơ sở' },
  { key: 'saleName', label: 'Nhân viên bán hàng' },
  { key: 'customerName', label: 'Khách hàng' },
  // Giá trị đơn = tổng tiền phiếu trên Kiot (mọi đơn Kiot; ô trống nếu dòng không có đơn Kiot) — cột SỐ.
  { key: 'orderTotal', label: 'Giá trị đơn', numeric: true },
  // Giá trị có bán (chỉ đơn Phiếu tạm của Kiot; ô trống với đơn khác) — cột SỐ.
  { key: 'sellableValue', label: 'Giá trị có bán', numeric: true },
  // Ghi chú của đơn trên Kiot (mô tả phiếu).
  { key: 'note', label: 'Ghi chú' },
  { key: 'saleSentAt', label: 'Sale gửi đơn cho kế toán' },
  { key: 'accountantApprovedOrderAt', label: 'Kế toán duyệt đơn' },
  { key: 'driverName', label: 'Lái xe' },
  { key: 'driverConfirmedDeliveryAt', label: 'Tài xế gửi xác nhận giao hàng' },
  { key: 'accountantApprovedDeliveryAt', label: 'Kế toán duyệt giao hàng' },
  { key: 'deliveryConfirmedAt', label: 'Xác nhận đã giao/khách ký nhận' },
  { key: 'shipReceivedAt', label: 'Ship nhận đơn' },
  { key: 'orderSignedAt', label: 'Đơn đã ký nhận' },
  { key: 'kiotStatus', label: 'Trạng thái KiotViet' },
  { key: 'statusLabel', label: 'Trạng thái' },
  { key: 'warningLabel', label: 'Cảnh báo' }
];

function neutralizeFormulaText(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function columnValue(order, key) {
  if (key === 'branchLabel') return BRANCH_LABEL[order.branch] || order.branch || '';
  if (key === 'statusLabel') return (order.summary && order.summary.label) || '';
  if (key === 'warningLabel') return order.warning ? 'Cảnh báo' : '';
  // Gia tri don co voi MOI don Kiot; gia tri co ban chi voi don Phieu tam (sellableValue != null); con lai de
  // trong (giong "—" tren bang).
  if (key === 'orderTotal') {
    return order.kiotStatus && order.orderTotal !== null && order.orderTotal !== undefined && Number.isFinite(Number(order.orderTotal))
      ? Number(order.orderTotal)
      : '';
  }
  if (key === 'sellableValue') {
    return order.kiotStatus && order.sellableValue !== null && order.sellableValue !== undefined && Number.isFinite(Number(order.sellableValue))
      ? Number(order.sellableValue)
      : '';
  }
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
    COLUMNS.forEach(column => {
      const value = columnValue(order, column.key);
      // Cot so giu nguyen kieu so (de sap xep/cong trong Excel); con lai chong formula-injection.
      row[column.key] = column.numeric && typeof value === 'number' ? value : neutralizeFormulaText(value);
    });
    worksheet.addRow(row);
  });

  worksheet.views = frozenNoGridlinesView(1);
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(orders.length + 1, 1), column: COLUMNS.length }
  };
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = HEADER_FONT;
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  applyFullTableBorder(worksheet, COLUMNS.length, orders.length + 1);

  COLUMNS.forEach((column, index) => {
    const excelColumn = worksheet.getColumn(index + 1);
    const sampleValues = orders.slice(0, 200).map(order => String(columnValue(order, column.key)));
    const width = Math.min(42, Math.max(12, column.label.length + 2, ...sampleValues.map(value => Math.min(value.length + 2, 42))));
    excelColumn.width = width;
    excelColumn.alignment = column.numeric
      ? { vertical: 'top', horizontal: 'right', wrapText: false }
      : { vertical: 'top', wrapText: false };
    if (column.numeric) excelColumn.numFmt = '#,##0';
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

module.exports = { buildLifecycleWorkbook, createLifecycleExportFile, MAX_EXPORT_ROWS };
