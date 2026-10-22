'use strict';

// Xuat "Kiem tra gia ban" ra Excel / HTML theo kieu B (xem productContainers/expectedExport.js): may chu doc
// TOAN BO tap da loc tu cung repository/bo loc voi man hinh (cung thu tu sap xep), whitelist cot theo catalog
// priceAuditColumns. Tien / so luong giu so goc dang Number (o trong = thieu gia), chu chong formula injection.

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');
const { renderHtmlReport } = require('../dashboard/exportHtmlReport');
const { COLUMNS, STATUS_LABELS, BRANCH_LABELS, exportValue, formatLocalDateTime, formatTimestamp } = require('./priceAuditColumns');

const MAX_EXPORT_ROWS = 50000;
const TITLE = 'Hóa đơn · Kiểm tra giá bán';
const SHEET_NAME = 'Kiểm tra giá bán';
const FILE_BASE = 'TKS_Kiem_tra_gia_ban';
const DECISION_FILTER_LABELS = Object.freeze({ pending: 'Chưa chốt', ok: 'Ok', penalty: 'Phạt' });

function invalid(message, code) {
  return Object.assign(new Error(message), { statusCode: 400, ...(code ? { code } : {}) });
}

// columns=a,b (chuoi hoac mang) -> khoa theo thu tu catalog; khong truyen => cot hien mac dinh.
function resolveColumnKeys(param) {
  if (param === undefined || param === null) return COLUMNS.filter(c => c.defaultVisible).map(c => c.key);
  const bad = () => invalid('Danh sách trường xuất không hợp lệ.', 'INVALID_COLUMNS');
  const parts = Array.isArray(param) ? param : typeof param === 'string' ? [param] : null;
  if (!parts || parts.some(p => typeof p !== 'string')) throw bad();
  const requested = new Set(parts.join(',').split(',').map(s => s.trim()).filter(Boolean));
  if (!requested.size) throw bad();
  const allowed = COLUMNS.map(c => c.key);
  for (const key of requested) if (!allowed.includes(key)) throw bad();
  return allowed.filter(key => requested.has(key));
}

// Cung dang /api/business-report/export/fields (hop thoai "Xuat file" dung chung); chon san = cot hien mac dinh.
function exportFieldsFor(rowCount) {
  return {
    title: 'Kiểm tra giá bán',
    selectionMode: 'custom',
    worksheets: [{
      key: 'priceAudit',
      name: SHEET_NAME,
      rowCount: Number(rowCount) || 0,
      fields: COLUMNS.map(c => ({ key: c.key, label: c.label, type: htmlType(c), selected: c.defaultVisible }))
    }]
  };
}

function htmlType(column) {
  if (column.type === 'money') return 'money';
  if (column.type === 'number') return 'number';
  return 'general';
}

function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

const day = value => (value ? formatLocalDateTime(value) : '—');
const money = value => (value === null || value === undefined || value === '' ? '' : Number(value));

/** Cac dong thong tin: cua so, lan chay, bo loc, chi so (cung so voi man hinh, tinh tren toan tap loc). */
function infoLines(meta = {}) {
  const m = meta || {};
  const lines = [
    ['Dữ liệu', `${day(m.windowFrom)} – ${day(m.windowTo)}`],
    ['Chạy thành công lúc', m.lastSuccessAt ? formatTimestamp(m.lastSuccessAt) : '—'],
    ['Hóa đơn bổ sung lần chạy gần nhất', Number(m.addedInvoiceCount) || 0]
  ];
  const failedAfterSuccess = m.lastError && (!m.lastSuccessAt || (m.lastAttemptAt && m.lastAttemptAt > m.lastSuccessAt));
  if (failedAfterSuccess) lines.push(['Cảnh báo', `Lần chạy ${formatTimestamp(m.lastAttemptAt)} bị lỗi; đây là dữ liệu của lần chạy thành công trước.`]);
  const f = m.filters || {};
  if (f.branch) lines.push(['Cơ sở', BRANCH_LABELS[f.branch] || f.branch]);
  if (f.from || f.to) lines.push(['Ngày bán', `${day(f.from || m.windowFrom)} – ${day(f.to || m.windowTo)}`]);
  if (f.sale) lines.push(['Sale', f.sale]);
  if (f.status) lines.push(['Kết quả', STATUS_LABELS[f.status] || f.status]);
  if (f.decision) lines.push(['Chốt', DECISION_FILTER_LABELS[f.decision] || f.decision]);
  if (f.vat === true || f.vat === false) lines.push(['Full VAT', f.vat ? 'Có' : 'Không']);
  if (f.freight === true || f.freight === false) lines.push(['Bao cước', f.freight ? 'Có' : 'Không']);
  if (f.q) lines.push(['Tìm kiếm', f.q]);
  const k = m.kpis;
  if (k) {
    lines.push(['Số hóa đơn', Number(k.invoiceCount) || 0]);
    lines.push(['Dòng đúng giá', Number(k.correctLines) || 0]);
    lines.push(['Dòng sai giá', Number(k.wrongLines) || 0]);
    lines.push(['Tiền chênh chưa chốt', money(k.pendingAmount)]);
    lines.push(['Tiền đã chốt Phạt', money(k.penaltyAmount)]);
    lines.push(['Tổng tiền chênh / phạt đang hiển thị', money(k.effectiveAmount)]);
  }
  return lines;
}

/**
 * @param {{ rows: object[], columns: string[]|null, format: 'xlsx'|'html', meta?: object }} input
 *   meta: meta cua bao cao + { kpis, filters } (bo loc da hop le) de ghi vao file.
 * @returns {Promise<{ buffer: Buffer, mimeType: string, fileName: string }>}
 */
async function createPriceAuditExport({ rows = [], columns = null, format = 'xlsx', meta = {} } = {}) {
  if (!['xlsx', 'html'].includes(format)) throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw invalid('Dữ liệu vượt giới hạn 50.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.', 'TOO_MANY_ROWS');
  }
  const keys = columns || resolveColumnKeys(undefined);
  const picked = COLUMNS.filter(c => keys.includes(c.key));
  const notes = infoLines(meta);

  if (format === 'html') {
    return renderHtmlReport({
      meta: {
        title: TITLE,
        branch: meta && meta.filters && meta.filters.branch ? BRANCH_LABELS[meta.filters.branch] : 'Hà Nội + Sài Gòn',
        generatedAt: new Date(),
        fileBase: FILE_BASE,
        reportNotes: notes.map(([label, value]) => [label, typeof value === 'number' ? value.toLocaleString('en-US') : String(value)])
      },
      worksheets: [{
        key: 'priceAudit',
        name: SHEET_NAME,
        columns: picked.map(c => ({ key: c.key, label: c.label, type: htmlType(c) })),
        rows: rows.map(row => Object.fromEntries(picked.map(c => [c.key, exportValue(row, c)]))),
        summaryKeys: picked.filter(c => c.key === 'effectiveAmount' || c.key === 'originalAmount').map(c => c.key),
        hints: { labelKey: picked.some(c => c.key === 'invoiceCode') ? 'invoiceCode' : undefined }
      }]
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(SHEET_NAME);
  sheet.columns = picked.map(c => ({
    key: c.key,
    header: c.label,
    width: c.wrap ? 40 : c.type === 'money' || c.type === 'number' ? 16 : 20,
    style: c.type === 'money' ? { numFmt: '#,##0.##' } : c.type === 'number' ? { numFmt: '#,##0.##' } : (c.wrap ? { alignment: { wrapText: true, vertical: 'top' } } : {})
  }));
  for (const row of rows) {
    sheet.addRow(picked.map(c => {
      const v = exportValue(row, c);
      if (v === '' && (c.type === 'money' || c.type === 'number')) return null;
      return typeof v === 'string' ? safeText(v) : v;
    }));
  }
  sheet.views = frozenNoGridlinesView(1);
  sheet.getRow(1).font = HEADER_FONT;
  sheet.getRow(1).height = 24;
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: Math.max(1, picked.length) } };
  applyFullTableBorder(sheet, picked.length, rows.length + 1);

  const info = workbook.addWorksheet('Thông tin');
  info.columns = [{ header: 'Mục', key: 'label', width: 36 }, { header: 'Giá trị', key: 'value', width: 60 }];
  for (const [label, value] of notes) info.addRow([safeText(label), typeof value === 'string' ? safeText(value) : value]);
  info.addRow(['Số dòng xuất', rows.length]);
  info.getRow(1).font = HEADER_FONT;
  info.getColumn(2).numFmt = '#,##0.##';

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName: `${FILE_BASE}.xlsx`
  };
}

module.exports = { createPriceAuditExport, resolveColumnKeys, exportFieldsFor, MAX_EXPORT_ROWS };
