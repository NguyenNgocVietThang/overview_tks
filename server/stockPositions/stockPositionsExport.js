'use strict';

// Xuat Excel bang VT Ha Noi / VT Sai Gon: du 10 cot nhu tren trang (cung thu tu), ke ca dong dang bi loc.
const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');

const { ACTION_LABELS, FIELD_LABELS, summaryText } = require('./stockPositionsHistoryLabels');

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const NUMBER = '#,##0.##';

// Chan cong thuc Excel do du lieu nguoi dung nhap (giong vatRequests/export.js).
const safeText = value => (/^[\s]*[=+\-@]/u.test(String(value ?? '')) ? `'${value}` : String(value ?? ''));
// Lech gio VN co dinh +7: Excel khong co mui gio nen ghi "gio dong ho VN" duoi dang UTC.
const vnTime = iso => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? null : new Date(date.getTime() + VN_OFFSET_MS); };

const COLUMNS = Object.freeze([
  { header: 'Mã hàng', width: 16, value: row => row.code },
  { header: 'Tên hàng', width: 40, value: row => row.name },
  { header: 'SL kho', width: 12, numFmt: NUMBER, value: row => row.quantity },
  { header: 'SL Kiot', width: 12, numFmt: NUMBER, value: row => row.kiotQuantity },
  { header: 'Ghi chú số thùng', width: 30, value: row => row.notes },
  { header: 'Ngày về', width: 14, value: row => row.arrivalDate },
  { header: 'Vị trí', width: 16, value: row => row.location },
  { header: 'Người cập nhật', width: 22, value: row => row.updatedByName },
  { header: 'TG cập nhật', width: 18, numFmt: 'dd/mm/yyyy hh:mm', value: row => vnTime(row.updatedAt) }
]);

function cellValue(value) {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date || typeof value === 'number' ? value : safeText(value);
}

async function createStockPositionsWorkbook({ branch, rows = [] }, { now = new Date() } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(branch === 'SG' ? 'VT Sài Gòn' : 'VT Hà Nội');
  sheet.columns = COLUMNS.map(col => ({ header: col.header, width: col.width, style: col.numFmt ? { numFmt: col.numFmt } : { alignment: { wrapText: true, vertical: 'top' } } }));
  rows.forEach(row => sheet.addRow(COLUMNS.map(col => cellValue(col.value(row)))));
  sheet.views = frozenNoGridlinesView(1);
  const header = sheet.getRow(1);
  header.font = HEADER_FONT;
  header.height = 28;
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: COLUMNS.length } };
  applyFullTableBorder(sheet, COLUMNS.length, rows.length + 1);
  const stamp = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `vt_${String(branch).toLowerCase()}_${stamp.slice(0, 10).replace(/-/g, '')}_${stamp.slice(11, 16).replace(':', '')}.xlsx`
  };
}

const HISTORY_COLUMNS = Object.freeze([
  { header: 'Thời gian', width: 18, numFmt: 'dd/mm/yyyy hh:mm', value: entry => vnTime(entry.createdAt) },
  { header: 'Người thực hiện', width: 24, value: entry => entry.actorName },
  { header: 'Hành động', width: 22, value: entry => ACTION_LABELS[entry.action] || entry.action },
  { header: 'Mã hàng', width: 16, value: entry => entry.code },
  { header: 'Vị trí', width: 16, value: entry => entry.location },
  { header: 'Trường', width: 16, value: entry => FIELD_LABELS[entry.field] || entry.field },
  { header: 'Giá trị cũ', width: 30, value: entry => entry.oldValue },
  { header: 'Giá trị mới', width: 30, value: entry => entry.newValue },
  { header: 'Tóm tắt', width: 36, value: entry => summaryText(entry.summary) }
]);

// Xuat Excel Lich su cap nhat: moi dong lich su 1 dong Excel, thu tu moi nhat truoc nhu tren man hinh.
async function createStockPositionsHistoryWorkbook({ branch, rows = [] }, { now = new Date() } = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(branch === 'SG' ? 'Lịch sử VT Sài Gòn' : 'Lịch sử VT Hà Nội');
  sheet.columns = HISTORY_COLUMNS.map(col => ({ header: col.header, width: col.width, style: col.numFmt ? { numFmt: col.numFmt } : { alignment: { wrapText: true, vertical: 'top' } } }));
  rows.forEach(entry => sheet.addRow(HISTORY_COLUMNS.map(col => cellValue(col.value(entry)))));
  sheet.views = frozenNoGridlinesView(1);
  const header = sheet.getRow(1);
  header.font = HEADER_FONT;
  header.height = 28;
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: HISTORY_COLUMNS.length } };
  applyFullTableBorder(sheet, HISTORY_COLUMNS.length, rows.length + 1);
  const stamp = new Date(now.getTime() + VN_OFFSET_MS).toISOString();
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `vt_${String(branch).toLowerCase()}_lich-su_${stamp.slice(0, 10).replace(/-/g, '')}_${stamp.slice(11, 16).replace(':', '')}.xlsx`
  };
}

module.exports = { createStockPositionsWorkbook, createStockPositionsHistoryWorkbook, COLUMNS, HISTORY_COLUMNS };
