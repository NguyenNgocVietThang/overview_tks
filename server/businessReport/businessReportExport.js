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
  sales: [['saleName', 'Sale'], ['activeCustomers', 'SL Khách', 'number']],
  customers: [['code', 'Mã KH'], ['name', 'Tên khách'], ['branch', 'Cơ sở'], ['saleName', 'Sale'], ['priceLevel', 'Level giá']],
  products: [['code', 'Mã hàng'], ['name', 'Tên hàng']]
};

function invalid(message, code) {
  const e = new Error(message);
  e.statusCode = 400;
  if (code) e.code = code;
  return e;
}

const fold = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

// Loc dong theo truy van: mac dinh chi dong "hoat dong" (TB 4 thang > 0), inactive=1 giu tat ca.
function filterRows(kind, rows, query = {}) {
  const q = fold(String(query.q || '').trim());
  const sale = String(query.sale || '');
  const branch = String(query.branch || '');
  const all = String(query.inactive || '') === '1';
  return rows.filter(r => {
    if (!all && !r.active) return false;
    if (sale && r.saleName !== sale) return false;
    if (branch && r.branch !== branch) return false;
    if (q && !fold([r.code, r.name, r.saleName].filter(Boolean).join(' ')).includes(q)) return false;
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

function safeText(value) {
  const text = String(value == null ? '' : value);
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}

function rawValue(row, column) {
  if (column.month) return Number(row.series && row.series[column.month]) || 0;
  if (column.key === 'growth') return row.growth == null ? '—' : row.growth / 100;
  if (column.type === 'number') return Number(row[column.key]) || 0;
  if (column.key === 'branch') return row.branch === 'hanoi' ? 'HN' : row.branch === 'saigon' ? 'SG' : (row.branch || '');
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

async function createExportFile(kind, format, report, rows) {
  if (!KINDS.includes(kind)) throw invalid('Bảng xuất không hợp lệ.');
  if (!['xlsx', 'html'].includes(format)) throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) {
    throw invalid('Dữ liệu vượt giới hạn 20.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.', 'TOO_MANY_ROWS');
  }
  const columns = columnsFor(kind, report);
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

module.exports = { createExportFile, filterRows, MAX_EXPORT_ROWS };
