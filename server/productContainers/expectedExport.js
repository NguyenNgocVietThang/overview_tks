'use strict';

// Xuat bang "Du kien hang ve" (tab Hang hoa) ra Excel / HTML theo "kieu B" cua Bao cao kinh doanh
// (businessReport/businessReportExport.js): loc o may chu bang cung tham so voi man hinh, whitelist cot,
// bo qua cot thi xuat tat ca. Tra cung dang /export/fields de frontend dung lai startExportDialog.

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');
const { renderHtmlReport } = require('../dashboard/exportHtmlReport');

const MAX_EXPORT_ROWS = 20000;
const TITLE = 'Hàng hóa · Dự kiến hàng về';
const FILE_BASE = 'TKS_Du_kien_hang_ve';
const COLUMNS = Object.freeze([
  { key: 'sheetName', label: 'Nguồn', type: 'text' },
  { key: 'scheduleLabel', label: 'Lịch / Trạng thái', type: 'text' },
  { key: 'containerName', label: 'Tên Cont', type: 'text' },
  { key: 'productCode', label: 'Mã SP', type: 'text' },
  { key: 'productName', label: 'Tên SP', type: 'text' },
  { key: 'color', label: 'Màu sắc', type: 'text' },
  { key: 'saleNote', label: 'Ghi chú sale', type: 'text' },
  { key: 'orderedBy', label: 'Người đặt', type: 'text' },
  { key: 'unitsPerPackage', label: 'Số cái/kiện', type: 'number' },
  { key: 'packageCount', label: 'Số kiện', type: 'number' },
  { key: 'quantity', label: 'Tổng số lượng', type: 'number' }
]);

function invalid(message, code) {
  const e = new Error(message);
  e.statusCode = 400;
  if (code) e.code = code;
  return e;
}

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// container / status: khop CHINH XAC (status = cot B, status_label); q: khong dau, khong phan biet hoa thuong.
function filterRows(rows, query = {}) {
  const container = String(query.container || '');
  const status = String(query.status || '');
  const q = fold(String(query.q || '').trim());
  return rows.filter(r => {
    if (container && r.containerName !== container) return false;
    if (status && r.statusLabel !== status) return false;
    if (q && !fold([r.productCode, r.productName, r.containerName, r.color, r.saleNote].join(' ')).includes(q)) return false;
    return true;
  });
}

// Cung dang /api/business-report/export/fields.
function exportFieldsFor(rows) {
  return {
    title: TITLE,
    selectionMode: 'custom',
    worksheets: [{
      key: 'expected',
      name: 'Dự kiến hàng về',
      rowCount: rows.length,
      fields: COLUMNS.map(({ key, label, type }) => ({ key, label, type, selected: true }))
    }]
  };
}

// columns=a,b (chuoi hoac mang khi lap lai tham so) -> khoa theo thu tu chuan; khong truyen => null (tat ca).
function resolveColumnKeys(param) {
  if (param === undefined || param === null) return null;
  const bad = () => invalid('Danh sách trường xuất không hợp lệ.', 'INVALID_COLUMNS');
  const parts = Array.isArray(param) ? param : typeof param === 'string' ? [param] : null;
  if (!parts || parts.some(p => typeof p !== 'string')) throw bad();
  const requested = new Set(parts.join(',').split(',').map(s => s.trim()).filter(Boolean));
  if (!requested.size) throw bad();
  const allowed = COLUMNS.map(c => c.key);
  for (const key of requested) if (!allowed.includes(key)) throw bad();
  return allowed.filter(key => requested.has(key));
}

function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

// So khong co du lieu (Số cái/kiện, Số kiện) de trong, khong ep ve 0.
function cellValue(row, column) {
  const value = row[column.key];
  if (column.type === 'number') return value == null || value === '' ? '' : Number(value);
  return value == null ? '' : String(value);
}

function noteLines(query, meta) {
  const notes = [];
  if (query.container) notes.push(['Cont', String(query.container)]);
  if (query.status) notes.push(['Trạng thái', String(query.status)]);
  if (query.q) notes.push(['Tìm kiếm', String(query.q)]);
  if (meta && meta.computedAt) notes.push(['Cập nhật lúc', new Date(meta.computedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })]);
  return notes;
}

async function createExportFile(format, rows, columnKeys, { query = {}, meta = null } = {}) {
  if (!['xlsx', 'html'].includes(format)) throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw invalid('Dữ liệu vượt giới hạn 20.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.', 'TOO_MANY_ROWS');
  }
  const columns = columnKeys ? COLUMNS.filter(c => columnKeys.includes(c.key)) : COLUMNS;
  if (format === 'html') {
    return renderHtmlReport({
      meta: {
        title: TITLE,
        branch: 'Hà Nội + Sài Gòn',
        generatedAt: meta && meta.computedAt ? new Date(meta.computedAt) : new Date(),
        fileBase: FILE_BASE,
        reportNotes: noteLines(query, meta)
      },
      worksheets: [{
        key: 'expected',
        name: 'Dự kiến hàng về',
        columns: columns.map(({ key, label, type }) => ({ key, label, type: type === 'text' ? 'general' : type })),
        rows: rows.map(row => Object.fromEntries(columns.map(c => [c.key, cellValue(row, c)]))),
        summaryKeys: ['quantity'],
        hints: { labelKey: 'productCode' }
      }]
    });
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet('Dự kiến hàng về');
  sheet.columns = columns.map(c => ({
    key: c.key,
    header: c.label,
    width: c.type === 'number' ? 16 : c.key === 'productName' || c.key === 'saleNote' ? 36 : 22,
    style: c.type === 'number' ? { numFmt: '#,##0.##' } : {}
  }));
  for (const row of rows) {
    sheet.addRow(columns.map(c => {
      const v = cellValue(row, c);
      return typeof v === 'string' ? safeText(v) : v;
    }));
  }
  sheet.views = frozenNoGridlinesView(1);
  sheet.getRow(1).font = HEADER_FONT;
  sheet.getRow(1).height = 24;
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: columns.length } };
  applyFullTableBorder(sheet, columns.length, rows.length + 1);
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${FILE_BASE}.xlsx`
  };
}

module.exports = { createExportFile, filterRows, exportFieldsFor, resolveColumnKeys, MAX_EXPORT_ROWS, COLUMNS };
