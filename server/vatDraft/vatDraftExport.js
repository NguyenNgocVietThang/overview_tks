'use strict';

// Xuat Excel ket qua Nhap VAT. Trinh duyet gui lai cac dong DUNG thu tu dang hien thi (sau
// khi sap xep) — may chu chi nhan cot nam trong danh sach cho phep cua tung bang.

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');
const { buildUnifiedColumns, GIA_NHAP_COLUMN } = require('./allocation');
const { ALL_SOURCES_COLUMNS, LOOKUP_ISSUE_COLUMNS } = require('./sourceLookup');

const MAX_EXPORT_ROWS = 10000;
const NUMERIC_COLUMNS = new Set(['SL', 'Giá bán', 'TỒN CÒN NHÁP', GIA_NHAP_COLUMN, '%VAT', 'Thành tiền', 'Tồn nháp được', 'Dòng nhập']);
const VIEWS = Object.freeze({
  allocation: { sheet: 'Xử lý hóa đơn', fileName: 'ket_qua_xu_ly_hoa_don.xlsx', columns: buildUnifiedColumns(true) },
  lookup: { sheet: 'Tra cứu nguồn', fileName: 'tra_cuu_nguon.xlsx', columns: [...ALL_SOURCES_COLUMNS] },
  lookupIssues: { sheet: 'Dòng cần kiểm tra', fileName: 'tra_cuu_nguon_can_kiem_tra.xlsx', columns: [...LOOKUP_ISSUE_COLUMNS] }
});

function invalid(message) {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'VAT_DRAFT_EXPORT_INVALID';
  return error;
}

// Chan cong thuc Excel do du lieu nguoi dung (giong cashbookExport.js).
function safeText(value) {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function cellValue(column, value) {
  if (value === null || value === undefined || value === '') return '';
  if (NUMERIC_COLUMNS.has(column)) {
    const number = Number(value);
    return Number.isFinite(number) ? number : safeText(value);
  }
  return safeText(value);
}

async function createVatDraftWorkbook({ view, columns, rows }) {
  const spec = VIEWS[view];
  if (!spec) throw invalid('Bảng xuất không hợp lệ.');
  if (!Array.isArray(columns) || !columns.length || columns.some(c => !spec.columns.includes(c)) || new Set(columns).size !== columns.length) {
    throw invalid('Cột xuất không hợp lệ.');
  }
  if (!Array.isArray(rows) || rows.some(r => !Array.isArray(r) || r.length !== columns.length)) throw invalid('Dữ liệu xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) throw invalid(`Tối đa ${MAX_EXPORT_ROWS.toLocaleString('vi-VN')} dòng mỗi lần xuất.`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(spec.sheet);
  sheet.columns = columns.map(column => ({
    key: column,
    header: column,
    width: NUMERIC_COLUMNS.has(column) ? 16 : /TÊN|Tên|Ghi chú|Nội dung|Mã kế toán/.test(column) ? 36 : 16,
    style: NUMERIC_COLUMNS.has(column)
      ? { numFmt: column === GIA_NHAP_COLUMN ? '#,##0.00' : '#,##0.##' }
      : { alignment: { wrapText: true, vertical: 'top' } }
  }));
  rows.forEach(row => sheet.addRow(row.map((value, i) => cellValue(columns[i], value))));
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
    fileName: spec.fileName
  };
}

module.exports = { createVatDraftWorkbook, MAX_EXPORT_ROWS, VIEWS, safeText };
