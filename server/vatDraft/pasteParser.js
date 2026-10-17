'use strict';

// Doc du lieu DAN TAY (giu nguyen quy tac tung trang cua vat-draft-app) va danh sach
// ma chung tu (HD.../DH...) ke toan dan vao o "Dán mã chứng từ".

const { pyStrip } = require('./pyCompat');

const EMPTY_COLS = ['', '', '', '', ''];

/**
 * Trang Xu ly hoa don (01_xu_ly_hoa_don.py): text.strip("\n").split("\n"), bo dong trang,
 * tach Tab, lay 5 cot (Mã SP, Tên SP, SL, Giá bán, Ghi chú hàng hóa); bo dong tieu de
 * khi cot 1 la "mã sp"/"ma sp" VA cot 3 la "sl".
 */
function parseInvoicePasteRows(text) {
  const lines = String(text || '').replace(/^\n+|\n+$/g, '').split('\n').filter(line => pyStrip(line) !== '');
  const rows = [];
  for (const line of lines) {
    const cols = [...line.split('\t'), ...EMPTY_COLS].slice(0, 5);
    if (['mã sp', 'ma sp'].includes(pyStrip(cols[0]).toLowerCase()) && pyStrip(cols[2]).toLowerCase() === 'sl') continue;
    rows.push(cols);
  }
  return rows;
}

/**
 * Dong da doc -> query cho thuat toan. orderIndex = vi tri dong (tinh ca dong bi bo vi
 * trong ca Ma SP lan Ten SP) + 1, dung nhu DataFrame.iterrows() cua app cu.
 */
function rowsToQueries(rows) {
  const queries = [];
  rows.forEach((cols, idx) => {
    const [maSp = '', tenSp = '', sl = '', giaBan = '', ghiChuHangHoa = ''] = cols;
    if (pyStrip(maSp) === '' && pyStrip(tenSp) === '') return;
    queries.push({ orderIndex: idx + 1, maSp, tenSp, sl, giaBan, ghiChuHangHoa, maHoaDon: '', thanhTien: '' });
  });
  return queries;
}

const DOCUMENT_CODE_RE = /^(HD|DH)[A-Z0-9._-]+$/;
const MAX_DOCUMENT_CODES = 300;

/** O "Dán mã chứng từ": tach theo khoang trang / phay / cham phay, viet hoa, bo trung. */
function parseDocumentCodes(text) {
  const tokens = String(text || '').split(/[\s,;]+/).map(token => token.trim().toUpperCase()).filter(Boolean);
  const codes = [];
  const invalid = [];
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (DOCUMENT_CODE_RE.test(token)) codes.push(token);
    else invalid.push(token);
  }
  return { codes: codes.slice(0, MAX_DOCUMENT_CODES), invalid, truncated: codes.length > MAX_DOCUMENT_CODES };
}

module.exports = {
  MAX_DOCUMENT_CODES,
  parseInvoicePasteRows,
  rowsToQueries,
  parseDocumentCodes
};
