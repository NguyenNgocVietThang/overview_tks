'use strict';

// Xuat Excel trang Ke toan – ORDER VAT: moi dong khop bo loc hien tai (khong gom), DU moi cot
// cua bang tren trang ke ca cot dang an. Du lieu lay tu service.list() nen khop dung man hinh.

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Lech gio VN co dinh +7 -> Excel khong co mui gio, ghi "gio dong ho VN" duoi dang UTC.
function vnDateTime(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + VN_OFFSET_MS);
}

function plainDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
}

// Chan cong thuc Excel do du lieu nguoi dung (giong vatDraftExport.js).
function safeText(value) {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

const DATE_TIME = 'dd/mm/yyyy hh:mm';
const DATE = 'dd/mm/yyyy';
const NUMBER = '#,##0.##';

// Cung thu tu / ten cot voi bang tren trang (bo cot Chon, Thao tac). `kt`: chi nguoi co quyen xu ly
// (viewer.canProcess) moi co cot nay — service cung khong gui so lieu cho nguoi khac.
const COLUMNS = Object.freeze([
  { header: 'Thời gian', width: 17, numFmt: DATE_TIME, value: row => vnDateTime(row.createdAt) },
  { header: 'Tên Sale', width: 20, value: row => row.createdByName },
  { header: 'Khách hàng', width: 32, value: row => row.customerName },
  { header: 'Mã SP', width: 16, value: row => row.productCode },
  { header: 'Tên SP', width: 36, value: row => row.productName },
  { header: 'Số lượng', width: 12, numFmt: NUMBER, value: row => row.quantity },
  { header: 'Giá chưa VAT', width: 14, numFmt: NUMBER, value: row => row.unitPrice },
  { header: 'Tổng tiền', width: 16, numFmt: NUMBER, value: row => row.totalAmount },
  { header: 'Full VAT', width: 16, value: row => (row.fullVat ? 'Full VAT' : 'Không full VAT') },
  { header: 'Ghi chú', width: 30, value: row => row.saleNote },
  { header: 'KT phản hồi', width: 24, value: row => row.statusLabel },
  { header: 'KT note cho sale', width: 24, value: row => row.accountantNote },
  { header: 'Ngày về', width: 12, numFmt: DATE, value: row => plainDate(row.arrivalDate) },
  { header: 'Tồn VAT', width: 12, numFmt: NUMBER, kt: true, value: (row, m) => (m && m.vatStock ? m.vatStock.total : null) },
  { header: 'SLG tổng cần khai', width: 14, numFmt: NUMBER, kt: true, value: (row, m) => (m ? m.pendingInsertQty : null) },
  { header: 'Dự kiến hàng về', width: 18, kt: true, value: (row, m) => (m ? m.incomingContainer : null) },
  { header: 'Dự kiến ngày về gần nhất', width: 24, kt: true, value: (row, m) => (m ? m.nearestSchedule : null) }
]);

function cellValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date || typeof value === 'number') return value;
  return safeText(value);
}

function fileStamp(now) {
  const vn = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
  return `${vn.slice(0, 10).replace(/-/g, '')}_${vn.slice(11, 16).replace(':', '')}`;
}

/** @param {{ rows: object[], metrics: object, viewer: { canProcess: boolean } }} list  ket qua service.list() */
async function createVatRequestWorkbook({ rows = [], metrics = {}, viewer = null } = {}, { now = new Date() } = {}) {
  const columns = viewer && viewer.canProcess ? COLUMNS : COLUMNS.filter(col => !col.kt);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet('ORDER VAT');
  sheet.columns = columns.map(col => ({
    header: col.header,
    width: col.width,
    style: col.numFmt ? { numFmt: col.numFmt } : { alignment: { wrapText: true, vertical: 'top' } }
  }));
  rows.forEach(row => {
    const m = metrics[row.productKey] || null;
    sheet.addRow(columns.map(col => cellValue(col.value(row, m))));
  });
  sheet.views = frozenNoGridlinesView(1);
  const header = sheet.getRow(1);
  header.font = HEADER_FONT;
  header.height = 32;
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: columns.length } };
  applyFullTableBorder(sheet, columns.length, rows.length + 1);
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `order_vat_${fileStamp(now)}.xlsx`
  };
}

module.exports = { createVatRequestWorkbook, COLUMNS, safeText };
