'use strict';

// Xuat Bao cao kinh doanh ra Excel / HTML (dashboard dung chung bo dung cua tab Bao cao).
// Cot: cac cot nhan dien theo bang, TB 4 thang, Tang truong, Thang hien tai, roi cac thang
// truoc theo thu tu giam dan (thang hien tai da co cot rieng nen khong lap lai).

const ExcelJS = require('exceljs');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');
const { renderHtmlReport } = require('../dashboard/exportHtmlReport');
const { monthLabel } = require('./businessMonths');

const MAX_EXPORT_ROWS = 20000;
const KINDS = ['sales', 'customers', 'products'];
const TITLES = { sales: 'Sale', customers: 'Khách hàng', products: 'Mã hàng' };
const FIXED = {
  sales: [['saleName', 'Sale'], ['team', 'Team'], ['activeCustomers', 'SL Khách', 'number']],
  customers: [['name', 'Tên khách'], ['saleName', 'Sale'], ['priceLevel', 'Level giá']],
  products: [['code', 'Mã hàng'], ['name', 'Tên hàng']]
};

function invalid(message, code) {
  const e = new Error(message);
  e.statusCode = 400;
  if (code) e.code = code;
  return e;
}

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Loc dong theo truy van. Chi bang KHACH mac dinh an khach khong hoat dong (TB 4 thang = 0),
// inactive=1 giu tat ca; bang Sale / Ma hang khong co cong tac nay nen xuat du dong nhu tren man hinh.
function filterRows(kind, rows, query = {}) {
  const q = fold(String(query.q || '').trim());
  const sale = String(query.sale || '');
  const team = String(query.team || '');
  const all = kind !== 'customers' || String(query.inactive || '') === '1';
  return rows.filter(r => {
    if (!all && !r.active) return false;
    if (sale && r.saleName !== sale) return false;
    if (team && r.team !== team) return false;
    if (q && !fold([r.code, r.name, r.saleName, r.team].filter(Boolean).join(' ')).includes(q)) return false;
    return true;
  });
}

function dateLabel(today) {
  return `${String(today).slice(8, 10)}/${String(today).slice(5, 7)}`;
}

function monthColumnKey(month) {
  return `m_${month.slice(0, 7).replace('-', '_')}`;
}

function columnsFor(kind, report) {
  const previous = report.months.filter(m => m !== report.currentMonth).slice().reverse();
  return [
    ...FIXED[kind].map(([key, label, type]) => ({ key, label, type: type || 'text' })),
    { key: 'avg4', label: 'TB 4 tháng', type: 'number' },
    { key: 'growth', label: 'Tăng trưởng', type: 'percent' },
    { key: 'current', label: `Tháng hiện tại (đến ${dateLabel(report.today)})`, type: 'number' },
    ...previous.map(m => ({ key: monthColumnKey(m), label: monthLabel(m), type: 'number', month: m }))
  ];
}

// Danh sach truong cho hop thoai "Xuat file" dung chung cua tab Bao cao (cung dang voi /api/export/fields):
// truong = dung cac cot cua file, mac dinh chon het; rowCount = so dong sau bo loc dang ap.
function exportFieldsFor(kind, report, rows) {
  if (!KINDS.includes(kind)) throw invalid('Bảng xuất không hợp lệ.');
  return {
    title: `Báo cáo kinh doanh · ${TITLES[kind]}`,
    selectionMode: 'custom',
    worksheets: [{
      key: kind,
      name: TITLES[kind],
      rowCount: rows.length,
      fields: columnsFor(kind, report).map(({ key, label, type }) => ({ key, label, type, selected: true }))
    }]
  };
}

// Tham so columns (chuoi "a,b,c" hoac mang khi lap lai ?columns=) -> danh sach khoa theo thu tu chuan.
// Khong truyen => null (xuat tat ca). Chi chap nhan khoa co trong whitelist columnsFor; rong / khoa la => 400.
function resolveColumnKeys(kind, report, param) {
  if (param === undefined || param === null) return null;
  const bad = () => invalid('Danh sách trường xuất không hợp lệ.', 'INVALID_COLUMNS');
  const parts = Array.isArray(param) ? param : typeof param === 'string' ? [param] : null;
  if (!parts || parts.some(p => typeof p !== 'string')) throw bad();
  const requested = new Set(parts.join(',').split(',').map(s => s.trim()).filter(Boolean));
  if (!requested.size) throw bad();
  const allowed = columnsFor(kind, report).map(c => c.key);
  for (const key of requested) if (!allowed.includes(key)) throw bad();
  return allowed.filter(key => requested.has(key));
}

function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function rawValue(row, column) {
  if (column.month) return Number(row.series && row.series[column.month]) || 0;
  if (column.key === 'growth') return row.growth == null ? '—' : row.growth / 100;
  if (column.type === 'number') return Number(row[column.key]) || 0;
  return row[column.key] == null ? '' : String(row[column.key]);
}

function htmlWorksheet(kind, report, rows, columns) {
  return {
    key: kind,
    name: TITLES[kind],
    columns: columns.map(({ key, label, type }) => ({ key, label, type: type === 'text' ? 'general' : type })),
    rows: rows.map(row => Object.fromEntries(columns.map(c => [c.key, rawValue(row, c)]))),
    summaryKeys: ['current', 'avg4'],
    hints: { labelKey: kind === 'sales' ? 'saleName' : 'name' }
  };
}

// columnKeys: danh sach khoa da qua resolveColumnKeys (null/undefined = tat ca cot).
async function createExportFile(kind, format, report, rows, columnKeys) {
  if (!KINDS.includes(kind)) throw invalid('Bảng xuất không hợp lệ.');
  if (!['xlsx', 'html'].includes(format)) throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw invalid('Dữ liệu vượt giới hạn 20.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.', 'TOO_MANY_ROWS');
  }
  const columns = columnKeys ? columnsFor(kind, report).filter(c => columnKeys.includes(c.key)) : columnsFor(kind, report);
  const fileBase = `TKS_Bao_cao_kinh_doanh_${kind}`;
  if (format === 'html') {
    return renderHtmlReport({
      meta: {
        title: `Báo cáo kinh doanh · ${TITLES[kind]}`,
        branch: 'Hà Nội + Sài Gòn',
        generatedAt: report.computedAt ? new Date(report.computedAt) : new Date(),
        fileBase
      },
      worksheets: [htmlWorksheet(kind, report, rows, columns)]
    });
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(`Theo ${TITLES[kind].toLowerCase()}`);
  sheet.columns = columns.map(c => ({
    key: c.key,
    header: c.label,
    width: c.type === 'number' ? 18 : c.type === 'percent' ? 14 : 28,
    style: c.type === 'number' ? { numFmt: '#,##0' } : c.type === 'percent' ? { numFmt: '0%' } : {}
  }));
  for (const row of rows) {
    sheet.addRow(columns.map(c => {
      const v = rawValue(row, c);
      return typeof v === 'string' && c.key !== 'growth' ? safeText(v) : v;
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
    fileName: `${fileBase}.xlsx`
  };
}

module.exports = { createExportFile, filterRows, exportFieldsFor, resolveColumnKeys, MAX_EXPORT_ROWS };
