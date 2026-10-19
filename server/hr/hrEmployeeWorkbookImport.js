'use strict';

const XLSX = require('xlsx');

function text(cell) {
  if (!cell) return '';
  return String(cell.w != null ? cell.w : cell.v == null ? '' : cell.v).trim().replace(/\.0$/, '');
}

function numericIdentifier(cell, expectedLength) {
  const value = text(cell).replace(/\s+/g, '');
  if (cell && cell.t === 'n' && /^\d+$/.test(value) && value.length < expectedLength) {
    return value.padStart(expectedLength, '0');
  }
  return value;
}
function isoDate(cell) {
  if (!cell || cell.v == null || cell.v === '') return null;
  let value = cell.v;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const match = String(value).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : null;
}

function checked(cell) {
  return /^(x|có|co|đã có|da co|1|true)$/i.test(text(cell));
}

function parseSheet(sheet, branch) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  const rows = [];
  for (let r = 2; r <= range.e.r; r += 1) {
    const get = c => sheet[XLSX.utils.encode_cell({ r, c })];
    const hoTen = text(get(2));
    if (!hoTen) continue;
    rows.push({
      branch,
      trangThaiNguon: text(get(1)),
      hoTen,
      boPhan: text(get(3)),
      chucVu: text(get(4)),
      ngayVaoLam: isoDate(get(5)),
      ngaySinh: isoDate(get(7)),
      soCccd: numericIdentifier(get(8), 12),
      soDienThoai: numericIdentifier(get(9), 10),
      diaChiHienTai: text(get(10)),
      nguoiThanQuanHe: text(get(11)),
      nguoiThanHoTen: text(get(12)),
      nguoiThanSoDienThoai: numericIdentifier(get(13), 10),
      gioiTinh: text(get(14)),
      hoSoDayDu: checked(get(15)),
      vanTayDaDangKy: branch === 'hanoi' ? checked(get(16)) : false,
      ngayNghiViec: isoDate(get(branch === 'hanoi' ? 17 : 16))
    });
  }
  return rows;
}

function parseEmployeeWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  if (!workbook.Sheets.Sheet1 || !workbook.Sheets.Sheet2) {
    throw new Error('File phải có đủ Sheet1 (Hà Nội) và Sheet2 (Sài Gòn).');
  }
  return [
    ...parseSheet(workbook.Sheets.Sheet1, 'hanoi'),
    ...parseSheet(workbook.Sheets.Sheet2, 'saigon')
  ];
}

module.exports = { parseEmployeeWorkbook, parseSheet, isoDate };
