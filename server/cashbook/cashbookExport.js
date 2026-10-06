'use strict';
const ExcelJS = require('exceljs');
const {
  HEADER_FONT,
  frozenNoGridlinesView,
  applyFullTableBorder,
} = require('../excelTableStyle');
const { invalid } = require('./cashbookFilters');
const MAX_EXPORT_ROWS = 20000;
const COLUMNS = {
  balances: [
    ['name', 'Tên quỹ'],
    ['bank', 'Ngân hàng'],
    ['accountNo', 'Số tài khoản'],
    ['balance', 'Số dư hiện tại', true],
    ['checkpointAt', 'Chốt gần nhất'],
  ],
  entries: [
    ['code', 'Mã phiếu'],
    ['transDate', 'Thời gian'],
    ['docType', 'Loại chứng từ'],
    ['group', 'Loại thu chi'],
    ['partnerName', 'Người nộp/nhận'],
    ['partnerPhone', 'SĐT'],
    ['fundName', 'Quỹ/Tài khoản'],
    ['branch', 'Cơ sở'],
    ['creatorName', 'Người tạo'],
    ['staffName', 'Nhân viên'],
    ['amount', 'Giá trị', true],
    ['runningBalance', 'Số dư lũy kế', true],
    ['status', 'Trạng thái'],
    ['note', 'Ghi chú'],
  ],
  checkpoints: [
    ['checkpointAt', 'Thời điểm chốt'],
    ['fundName', 'Quỹ'],
    ['createdBy', 'Người chốt'],
    ['systemBalance', 'Số hệ thống', true],
    ['balance', 'Số thực tế', true],
    ['diff', 'Chênh lệch', true],
    ['note', 'Ghi chú'],
  ],
};
const LABELS = {
  balances: 'Số dư tài khoản',
  entries: 'Sổ chi tiết',
  checkpoints: 'Lịch sử chốt',
};
function selectedColumns(view, columns) {
  if (!['balances', 'entries', 'checkpoints'].includes(view))
    throw invalid('Bảng xuất không hợp lệ.');
  if (columns === undefined) return COLUMNS[view];
  if (typeof columns !== 'string' || !columns)
    throw invalid('Chọn ít nhất một cột để xuất.');
  const keys = columns.split(',');
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => !COLUMNS[view].some((c) => c[0] === k))
  )
    throw invalid('Cột xuất không hợp lệ.');
  return keys.map((k) => COLUMNS[view].find((c) => c[0] === k));
}
function safeText(value) {
  const text = String(value ?? '');
  return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
}
function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}
function cell(row, column) {
  const [key, , numeric] = column;
  const value = row[key];
  if (value == null) return '';
  if (numeric) return Number.isFinite(Number(value)) ? Number(value) : '';
  if (value instanceof Date || ['transDate', 'checkpointAt'].includes(key)) {
    const date = new Date(value);
    if (Number.isFinite(+date))
      return date.toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
  }
  if (key === 'docType') return value === 'receipt' ? 'Thu' : 'Chi';
  if (key === 'status') return value === 'paid' ? 'Đã thanh toán' : 'Đã hủy';
  if (key === 'branch')
    return value === 'hanoi' ? 'HN' : value === 'saigon' ? 'SG' : value;
  return safeText(value);
}
function tooManyRows() {
  const e = invalid(
    'Dữ liệu vượt giới hạn 20.000 dòng mỗi lần xuất. Hãy thu hẹp bộ lọc rồi xuất lại.',
  );
  e.code = 'TOO_MANY_ROWS';
  return e;
}
async function createExportFile(view, format, rows, columns) {
  const cols = selectedColumns(view, columns);
  if (!['xlsx', 'html'].includes(format))
    throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) throw tooManyRows();
  const fileName = `TKS_So_quy_${view}.${format}`;
  if (format === 'html') {
    const header = cols.map((c) => `<th>${escapeHtml(c[1])}</th>`).join('');
    const body = rows
      .map(
        (row) =>
          `<tr>${cols
            .map((c) => {
              const value = cell(row, c);
              const negative = c[2] && typeof value === 'number' && value < 0;
              const display =
                c[2] && typeof value === 'number'
                  ? value.toLocaleString('vi-VN', { maximumFractionDigits: 2 })
                  : value;
              return `<td${negative ? ' class="negative"' : ''}>${escapeHtml(display)}</td>`;
            })
            .join('')}</tr>`,
      )
      .join('');
    const html = `<!doctype html><html lang="vi"><meta charset="utf-8"><title>${LABELS[view]}</title><style>body{font:14px Arial,sans-serif;padding:24px}table{border-collapse:collapse}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}td{white-space:pre-wrap}.negative{color:#b91c1c}</style><h1>${LABELS[view]}</h1><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></html>`;
    return {
      buffer: Buffer.from(html),
      mimeType: 'text/html; charset=utf-8',
      fileName,
    };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  const sheet = workbook.addWorksheet(LABELS[view]);
  sheet.columns = cols.map(([key, label, numeric]) => ({
    key,
    header: label,
    width: numeric ? 20 : 28,
    style: numeric ? { numFmt: '#,##0.##' } : {},
  }));
  rows.forEach((row) => sheet.addRow(cols.map((c) => cell(row, c))));
  sheet.views = frozenNoGridlinesView(1);
  sheet.getRow(1).font = HEADER_FONT;
  sheet.getRow(1).height = 24;
  sheet.getRow(1).alignment = {
    vertical: 'middle',
    horizontal: 'center',
    wrapText: true,
  };
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, rows.length + 1), column: cols.length },
  };
  applyFullTableBorder(sheet, cols.length, rows.length + 1);
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileName,
  };
}
module.exports = {
  createExportFile,
  selectedColumns,
  MAX_EXPORT_ROWS,
  tooManyRows,
  COLUMNS,
};
