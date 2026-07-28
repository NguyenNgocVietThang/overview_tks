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
  CLIENT_ID: required('CLIENT_ID'),
  CLIENT_SECRET: required('CLIENT_SECRET'),
  RETAILER: required('RETAILER'),
  SPREADSHEET_ID: required('SPREADSHEET_ID'),
  GOOGLE_SERVICE_ACCOUNT_JSON: required('GOOGLE_SERVICE_ACCOUNT_JSON'),
  PORT: process.env.PORT || 3000,

  SHEET_PRODUCTS: 'Hàng hóa',
  SHEET_INVOICES: 'Hóa đơn',
  SHEET_CUSTOMERS: 'Khách hàng'
};

module.exports = CONFIG;
