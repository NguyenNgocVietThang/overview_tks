'use strict';
// ==========================================
// CUSTOMER DEBT PG READER — doc bang customer_debt_report_lines (da tinh san
// boi server/kiotvietSync/customerDebtReportRefresh.js moi 5 phut, xem
// 0014_customer_debt_report_lines.sql va customerDebtReportCompute.js) va
// tra ve dung shape `[header, ...rows]` cua 3 tab HN1/HN3/HN7 Google Sheets
// cu, de dashboardData.js dung thay cho
// sheetsClient.getMultipleSheetValues(DEBT_SHEETS) ma KHONG doi logic tinh
// toan/hien thi ben duoi.
//
// Module nay CHI DOC — khong tinh toan gi (thuat toan cong no nam het o
// customerDebtReportCompute.js, chay boi refresh job, khong chay trong
// request HTTP) — giong dashboardPgReader.js.
//
// LUU Y MUI GIO: giong dashboardPgReader.js, cot txn_time la "gio treo tuong
// VN mang nhan UTC" nen phai doc lai qua `AT TIME ZONE 'UTC'`.
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode } = require('../branch/branches');
const CONFIG = require('../config');

const SHEET_DATE_FORMAT = 'DD/MM/YYYY HH24:MI'; // giong dashboardPgReader.js

const CUSTOMER_DEBT_REPORT_HEADERS = Object.freeze([
  'Mã KH', 'Khách hàng', 'Số điện thoại', 'Nhóm khách hàng',
  'Nợ đầu kỳ', 'Ghi nợ', 'Ghi có', 'Nợ cuối kỳ',
  'Mã giao dịch', 'Thời gian', 'Loại giao dịch', 'Giá trị', 'Dư nợ cuối',
  'Mã hàng', 'Tên hàng', 'Nhóm hàng(3 Cấp)',
  'Đơn giá', 'SL sản phẩm', 'Thành tiền', 'Chiết khấu',
  'Tổng cộng'
]);

const SHEET_NAME_BY_DAYS = Object.freeze({
  1: CONFIG.SHEET_DEBT_1,
  3: CONFIG.SHEET_DEBT_3,
  7: CONFIG.SHEET_DEBT_7
});

const SELECT_SQL = `
  SELECT period_days, customer_code, customer_name, phone, customer_group,
         opening_debt::float8 AS opening_debt, debit::float8 AS debit,
         credit::float8 AS credit, closing_debt::float8 AS closing_debt,
         txn_code,
         COALESCE(to_char(txn_time AT TIME ZONE 'UTC', '${SHEET_DATE_FORMAT}'), '') AS txn_time_text,
         txn_type, txn_value::float8 AS txn_value, running_debt::float8 AS running_debt,
         COALESCE(product_code, '') AS product_code,
         COALESCE(product_name, '') AS product_name,
         COALESCE(category_name, '') AS category_name,
         price::float8 AS price, quantity::float8 AS quantity,
         amount::float8 AS amount, discount::float8 AS discount,
         total::float8 AS total
  FROM customer_debt_report_lines
  WHERE branch = $1
  ORDER BY period_days, seq`;

function toRow(r) {
  return [
    r.customer_code, r.customer_name, r.phone, r.customer_group,
    r.opening_debt, r.debit, r.credit, r.closing_debt,
    r.txn_code, r.txn_time_text, r.txn_type, r.txn_value, r.running_debt,
    r.product_code, r.product_name, r.category_name,
    r.price === null ? '' : r.price,
    r.quantity === null ? '' : r.quantity,
    r.amount === null ? '' : r.amount,
    r.discount === null ? '' : r.discount,
    r.total
  ];
}

function createCustomerDebtPgReader({ pool = getPool() } = {}) {
  /**
   * Doc 3 tab HN1/HN3/HN7 (so chi tiet cong no khach hang 1/3/7 ngay gan
   * day) cho 1 co so — bang da tinh san, chi 1 cau SELECT, khong tinh toan.
   * @param {string} branch nhan hien thi ('Hà Nội'/'Sài Gòn'), xem branches.js
   * @returns {Promise<Object<string, any[][]>>} map ten sheet -> [header, ...rows]
   */
  async function readCustomerDebtReports(branch) {
    const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }

    const { rows } = await pool.query(SELECT_SQL, [branchCode]);
    const sheets = {};
    Object.values(SHEET_NAME_BY_DAYS).forEach(sheetName => { sheets[sheetName] = [CUSTOMER_DEBT_REPORT_HEADERS.slice()]; });
    for (const row of rows) {
      const sheetName = SHEET_NAME_BY_DAYS[row.period_days];
      if (!sheetName) continue;
      sheets[sheetName].push(toRow(row));
    }
    return sheets;
  }

  return { readCustomerDebtReports };
}

const reader = createCustomerDebtPgReader();

module.exports = {
  createCustomerDebtPgReader,
  readCustomerDebtReports: (...args) => reader.readCustomerDebtReports(...args),
  // Chi dung cho test/doi chieu: header phai y het Sheets that (xem
  // src-dashboard/kiotviet/CustomerDebtReport.gs).
  __headers__: CUSTOMER_DEBT_REPORT_HEADERS
};
