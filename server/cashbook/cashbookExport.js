'use strict';
const ExcelJS = require('exceljs');
const {
  HEADER_FONT,
  frozenNoGridlinesView,
  applyFullTableBorder,
} = require('../excelTableStyle');
const { invalid } = require('./cashbookFilters');
const { renderHtmlReport } = require('../dashboard/exportHtmlReport');
const MAX_EXPORT_ROWS = 20000;
const COLUMNS = {
  balances: [
    ['accountNo', 'Số tài khoản'],
    ['name', 'Tài khoản'],
    ['description', 'Mô tả'],
    ['balanceHanoi', 'Tồn quỹ HN', true],
    ['balanceSaigon', 'Tồn quỹ SG', true],
    ['balance', 'Tổng tồn quỹ', true],
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
};
const LABELS = {
  balances: 'Số dư tài khoản',
  entries: 'Sổ chi tiết',
};
function selectedColumns(view, columns) {
  if (!['balances', 'entries'].includes(view))
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
function cell(row, column) {
  const [key, , numeric] = column;
  const value = row[key];
  if (value == null) return '';
  if (numeric) return Number.isFinite(Number(value)) ? Number(value) : '';
  if (value instanceof Date || key === 'transDate') {
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
const VN_OFFSET_MS = 7 * 3600000;
// Giá trị cho báo cáo HTML: số giữ nguyên, thời gian dời sang giờ VN (bộ dựng đọc phần UTC), chữ đã dịch nhãn.
function htmlValue(row, column) {
  const [key, , numeric] = column;
  const value = row[key];
  if (value == null || value === '') return null;
  if (numeric) return Number.isFinite(Number(value)) ? Number(value) : null;
  if (key === 'transDate') {
    const date = new Date(value);
    return Number.isFinite(+date) ? new Date(+date + VN_OFFSET_MS) : null;
  }
  // HTML không chạy công thức: bỏ dấu ' mà bản Excel thêm để chặn công thức.
  const text = cell(row, column);
  return text === "'" + value ? String(value) : text;
}
// Báo cáo HTML dạng dashboard (KPI, ô tìm, bộ lọc, biểu đồ, bảng) dùng chung bộ dựng
// của tab Báo cáo. Sổ chi tiết thêm 2 cột Thu/Chi (số dương) để KPI và biểu đồ có
// Tổng thu/Tổng chi; số dư lũy kế không cộng dồn nên không làm chỉ số.
function htmlWorksheet(view, rows, cols) {
  const columns = cols.map(([key, label, numeric]) => ({
    key,
    label,
    type: numeric ? 'number' : key === 'transDate' ? 'date' : 'general',
  }));
  const data = rows.map((row) => {
    const out = {};
    for (const c of cols) out[c[0]] = htmlValue(row, c);
    return out;
  });
  let summaryKeys = ['balance', 'balanceHanoi', 'balanceSaigon'],
    // Biểu đồ Top theo số TK (một chủ TK có thể có nhiều TK); Tiền mặt không có số TK.
    hints = { labelKey: cols.some((c) => c[0] === 'accountNo') ? 'accountNo' : 'name' };
  if (view === 'balances')
    data.forEach((row, i) => {
      if ('accountNo' in row && !row.accountNo) row.accountNo = rows[i].name || null;
    });
  if (view === 'entries') {
    summaryKeys = ['receipt', 'payment', 'amount'];
    // Top theo người nộp/nhận, cơ cấu + bộ lọc theo loại thu chi.
    hints = { labelKey: 'partnerName', categoryKey: 'group' };
    if (cols.some((c) => c[0] === 'amount')) {
      columns.push(
        { key: 'receipt', label: 'Thu', type: 'number' },
        { key: 'payment', label: 'Chi', type: 'number' },
      );
      rows.forEach((row, i) => {
        // Phiếu hủy không tính vào thu/chi, giống KPI trên trang.
        const amount = row.status === 'cancelled' ? 0 : Number(row.amount) || 0;
        data[i].receipt = amount > 0 ? amount : 0;
        data[i].payment = amount < 0 ? -amount : 0;
      });
    }
  }
  return { key: view, name: LABELS[view], columns, rows: data, summaryKeys, hints };
}
async function createExportFile(view, format, rows, columns, meta = {}) {
  const cols = selectedColumns(view, columns);
  if (!['xlsx', 'html'].includes(format))
    throw invalid('Định dạng xuất không hợp lệ.');
  if (rows.length > MAX_EXPORT_ROWS) throw tooManyRows();
  const fileName = `TKS_So_quy_${view}.${format}`;
  if (format === 'html')
    return renderHtmlReport({
      meta: {
        title: `Sổ quỹ · ${LABELS[view]}${meta.period ? ` (${meta.period})` : ''}`,
        branch: 'Hà Nội + Sài Gòn',
        generatedAt: meta.generatedAt || new Date(),
        fileBase: `TKS_So_quy_${view}`,
      },
      worksheets: [htmlWorksheet(view, rows, cols)],
    });
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
