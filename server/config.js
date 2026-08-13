// ==========================================
// CAU HINH — doc tu bien moi truong (khong commit secret)
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv optional in prod */ }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const CONFIG = {
  SPREADSHEET_ID: required('SPREADSHEET_ID'),
  GOOGLE_SERVICE_ACCOUNT_JSON: required('GOOGLE_SERVICE_ACCOUNT_JSON'),
  PORT: process.env.PORT || 3000,

  SHEET_CATEGORIES: 'Nhóm hàng',
  SHEET_PRODUCTS: 'Hàng hóa',
  SHEET_INVOICES: 'Hóa đơn',
  SHEET_INVOICE_DETAILS: 'Chi tiết hóa đơn',
  SHEET_ORDERS: 'Đặt hàng',
  SHEET_RETURNS: 'Trả hàng',
  SHEET_CUSTOMERS: 'Khách hàng',
  SHEET_CUSTOMER_REPORT: 'Báo cáo bán hàng',
  SHEET_SUPPLIERS: 'Nhà cung cấp',
  SHEET_PURCHASES: 'Nhập hàng',
  SHEET_DEACTIVATED_TODAY: 'Hàng ngừng kinh doanh',

  // HN1/HN3/HN7 do Apps Script tính từ dữ liệu KiotViet theo kỳ 1/3/7 ngày.
  // Server CHỈ ĐỌC — không được tạo/xóa/ghi ba tab này.
  SHEET_DEBT_1: 'HN1',
  SHEET_DEBT_3: 'HN3',
  SHEET_DEBT_7: 'HN7'
};

module.exports = CONFIG;
