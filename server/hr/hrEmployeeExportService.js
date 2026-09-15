// ==========================================
// HR EMPLOYEE EXPORT SERVICE — xuat file Excel Danh sach nhan su dang duoc
// tim kiem/loc tren trang Quan ly nhan su.
//
// Tach rieng khoi hrLeaveExportService.js vi khac schema (danh sach nhan su
// tu Google Sheet, khong phai bang leave_requests).
// ==========================================
'use strict';

const ExcelJS = require('exceljs');
const employeeDirectory = require('./employeeDirectory');
const { BRANCHES } = require('../branch/branches');
const { HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder } = require('../excelTableStyle');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const HEADERS = ['Họ và tên', 'Chức vụ', 'Số điện thoại', 'Email'];
const COLUMN_WIDTHS = [24, 28, 18, 26];

function branchFilePrefix(branch) {
  if (branch === BRANCHES.HANOI) return 'HN';
  if (branch === BRANCHES.SAIGON) return 'SG';
  return 'TKS';
}

/**
 * @param {Object} filters { keyword } — loc theo tu khoa dang go tren o tim kiem cua bang.
 * @returns {Promise<{ buffer: Buffer, fileName: string, mime: string }>}
 */
async function buildEmployeeDirectoryWorkbook(filters, branch) {
  filters = filters || {};
  const keyword = String(filters.keyword || '').trim().toLowerCase();

  const snapshot = await employeeDirectory.getSnapshot();
  let items = snapshot.employees
    .filter(employee => employee.sourceBranch === branch)
    .map(employee => ({
      hoTen: employee.hoTen,
      boPhan: employee.boPhan,
      soDienThoai: employee.soDienThoai,
      email: employee.email
    }));

  if (keyword) {
    items = items.filter(e => [e.hoTen, e.boPhan, e.soDienThoai, e.email].some(v => String(v || '').toLowerCase().includes(keyword)));
  }
  items.sort((a, b) => a.hoTen.localeCompare(b.hoTen, 'vi'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Danh sách nhân sự');

  sheet.columns = HEADERS.map((header, i) => ({ header, key: `c${i}`, width: COLUMN_WIDTHS[i] || 18 }));

  items.forEach(item => {
    sheet.addRow({ c0: item.hoTen, c1: item.boPhan, c2: item.soDienThoai, c3: item.email });
  });

  sheet.views = frozenNoGridlinesView(1);
  sheet.getRow(1).font = HEADER_FONT;
  sheet.getRow(1).alignment = { vertical: 'middle' };
  applyFullTableBorder(sheet, HEADERS.length, items.length + 1);

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `${branchFilePrefix(branch)}_danh-sach-nhan-su.xlsx`;

  return { buffer, fileName, mime: EXCEL_MIME };
}

module.exports = { buildEmployeeDirectoryWorkbook };
