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
  // Nguon (ten sheet): chi nguoi co quyen reports.overview.containers.full thay / xuat / loc duoc.
  { key: 'sheetName', label: 'Nguồn', type: 'text', fullOnly: true },
  { key: 'scheduleLabel', label: 'Lịch / Trạng thái', type: 'text' },
  { key: 'containerName', label: 'Tên Cont', type: 'text' },
  { key: 'productCode', label: 'Mã SP', type: 'text' },
  { key: 'productName', label: 'Tên SP', type: 'text' },
  { key: 'color', label: 'Màu sắc', type: 'text' },
  { key: 'saleNote', label: 'Ghi chú sale', type: 'text' },
  { key: 'orderedBy', label: 'Người đặt', type: 'text' },
  { key: 'unitsPerPackage', label: 'Số cái/kiện', type: 'number' },
  { key: 'packageCount', label: 'Số kiện', type: 'number' },
  { key: 'quantity', label: 'Tổng số lượng', type: 'number' },
  // Cot gia: chi nguoi co quyen reports.overview.containers.full (fullAccess) moi thay / xuat duoc.
  { key: 'unitPriceCny', label: 'Giá SP (tệ)', type: 'number', decimals: 2, priceOnly: true },
  { key: 'vietnamPrice', label: 'Giá hàng về VN', type: 'number', decimals: 0, priceOnly: true }
]);
const PRICE_ROW_KEYS = Object.freeze(COLUMNS.filter(c => c.priceOnly).map(c => c.key));
const columnsFor = fullAccess => (fullAccess ? COLUMNS : COLUMNS.filter(c => !c.priceOnly && !c.fullOnly));

// Ban sao dong da bo cac truong gia khi khong co quyen (khong sua doi dong trong cache dung chung).
function stripPriceFields(rows, fullAccess) {
  if (fullAccess) return rows;
  // Ten nguon khong lo ra cho nguoi khong co quyen: thay bang ma an danh theo thu tu xuat hien trong lan tra nay
  // (van phan biet duoc sheet khac nhau de nhan dien dong / gom cont).
  const anonymous = new Map();
  return rows.map(row => {
    const copy = { ...row };
    for (const key of PRICE_ROW_KEYS) delete copy[key];
    delete copy.listedAt;
    if (!anonymous.has(row.sheetName)) anonymous.set(row.sheetName, '#' + (anonymous.size + 1));
    copy.sheetName = anonymous.get(row.sheetName);
    return copy;
  });
}

function invalid(message, code) {
  const e = new Error(message);
  e.statusCode = 400;
  if (code) e.code = code;
  return e;
}

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// source / container / status: khop CHINH XAC (status = cot B, status_label); q: khong dau, khong phan biet hoa thuong.
function filterRows(rows, query = {}) {
  const source = String(query.source || '');
  const container = String(query.container || '');
  const status = String(query.status || '');
  const q = fold(String(query.q || '').trim());
  return rows.filter(r => {
    if (source && r.sheetName !== source) return false;
    if (container && r.containerName !== container) return false;
    if (status && r.statusLabel !== status) return false;
    if (q && !fold([r.productCode, r.productName, r.containerName, r.color, r.saleNote].join(' ')).includes(q)) return false;
    return true;
  });
}

// Cung dang /api/business-report/export/fields.
function exportFieldsFor(rows, { fullAccess = false } = {}) {
  return {
    title: TITLE,
    selectionMode: 'custom',
    worksheets: [{
      key: 'expected',
      name: 'Dự kiến hàng về',
      rowCount: rows.length,
      fields: columnsFor(fullAccess).map(({ key, label, type }) => ({ key, label, type, selected: true }))
    }]
  };
}

// columns=a,b (chuoi hoac mang khi lap lai tham so) -> khoa theo thu tu chuan; khong truyen => null (tat ca).
function resolveColumnKeys(param, { fullAccess = false } = {}) {
  if (param === undefined || param === null) return null;
  const bad = () => invalid('Danh sách trường xuất không hợp lệ.', 'INVALID_COLUMNS');
  const parts = Array.isArray(param) ? param : typeof param === 'string' ? [param] : null;
  if (!parts || parts.some(p => typeof p !== 'string')) throw bad();
  const requested = new Set(parts.join(',').split(',').map(s => s.trim()).filter(Boolean));
  if (!requested.size) throw bad();
  const allowed = COLUMNS.map(c => c.key);
  for (const key of requested) if (!allowed.includes(key)) throw bad();
  // Khong co quyen: cot gia bi loai ngay ca khi duoc yeu cau; neu khong con cot nao => 400.
  const usable = columnsFor(fullAccess).map(c => c.key).filter(key => requested.has(key));
  if (!usable.length) throw bad();
  return usable;
}

function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

// So khong co du lieu (Số cái/kiện, Số kiện) de trong, khong ep ve 0.
function cellValue(row, column) {
  const value = row[column.key];
  if (column.type === 'number') {
    if (value == null || value === '') return '';
    const number = Number(value);
    if (!Number.isFinite(number)) return '';
    if (column.decimals == null) return number;
    const factor = 10 ** column.decimals;
    return Math.round(number * factor) / factor;
  }
  return value == null ? '' : String(value);
}

function noteLines(query, meta, fullAccess) {
  const notes = [];
  if (query.source && fullAccess) notes.push(['Nguồn', String(query.source)]);
  if (query.container) notes.push(['Cont', String(query.container)]);
  if (query.status) notes.push(['Trạng thái', String(query.status)]);
  if (query.q) notes.push(['Tìm kiếm', String(query.q)]);
  if (meta && meta.computedAt) notes.push(['Cập nhật lúc', new Date(meta.computedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })]);
  return notes;
}

async function createExportFile(format, rows, columnKeys, { query = {}, meta = null, fullAccess = false } = {}) {
  if (!['xlsx', 'html'].includes(format)) throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw invalid('Dữ liệu vượt giới hạn 20.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.', 'TOO_MANY_ROWS');
  }
  const available = columnsFor(fullAccess);
  const columns = columnKeys ? available.filter(c => columnKeys.includes(c.key)) : available;
  if (format === 'html') {
    return renderHtmlReport({
      meta: {
        title: TITLE,
        branch: 'Hà Nội + Sài Gòn',
        generatedAt: meta && meta.computedAt ? new Date(meta.computedAt) : new Date(),
        fileBase: FILE_BASE,
        reportNotes: noteLines(query, meta, fullAccess)
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
    style: c.type === 'number' ? { numFmt: c.decimals === 2 ? '#,##0.00' : c.decimals === 0 ? '#,##0' : '#,##0.##' } : {}
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

module.exports = { createExportFile, filterRows, exportFieldsFor, resolveColumnKeys, stripPriceFields, MAX_EXPORT_ROWS, COLUMNS };
