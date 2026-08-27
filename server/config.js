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
  // SPREADSHEET_ID = co so HA NOI (bat buoc). Spreadsheet bao cao cua co so
  // SAI GON la optional — thieu bien nay thi co so Sai Gon tra 503
  // BRANCH_NOT_CONFIGURED chu khong lam sap server (giong VC_SPREADSHEET_ID).
  SPREADSHEET_ID: required('SPREADSHEET_ID'),
  SPREADSHEET_ID_SG: process.env.SPREADSHEET_ID_SG || null,
  GOOGLE_SERVICE_ACCOUNT_JSON: required('GOOGLE_SERVICE_ACCOUNT_JSON'),
  PORT: process.env.PORT || 3000,

  // Dang nhap/phan quyen — xem server/auth/. JWT_SECRET bat buoc de tranh
  // token gia mao; khong co gia tri mac dinh vi day la secret bao mat.
  JWT_SECRET: required('JWT_SECRET'),
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '12h',

  // Dang nhap bang Google (server/auth/googleAuthService.js). OAuth Client ID
  // loai "Web application" tren Google Cloud Console — KHONG phai secret (se
  // duoc tra ve qua GET /api/auth/google-config cho trang login doc), nen
  // khong dung required(): thieu bien nay chi tat tinh nang Google, khong
  // lam sap server. Khong can GOOGLE_CLIENT_SECRET vi dung ID token flow
  // (Google Identity Services), khong dung authorization-code flow.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || null,

  // ==========================================
  // QUAN LY VAN CHUYEN — Spreadsheet rieng (VC_*) va Google Drive luu anh
  // ==========================================
  // Optional — neu chua set thi log canh bao khi module van chuyen duoc goi,
  // khong lam crash server hien tai. Phai set truoc khi dung Phase 1B+.
  VC_SPREADSHEET_ID: process.env.VC_SPREADSHEET_ID || null,
  VC_DRIVE_FOLDER_ID: process.env.VC_DRIVE_FOLDER_ID || null,

  // Nguon van chuyen rieng cua co so Sai Gon (se cung cap sau) — bo trong thi
  // tab "Quan ly van chuyen" o co so Sai Gon bao "Chua duoc cau hinh".
  VC_SPREADSHEET_ID_SG: process.env.VC_SPREADSHEET_ID_SG || null,
  VC_DRIVE_FOLDER_ID_SG: process.env.VC_DRIVE_FOLDER_ID_SG || null,

  // Ten 6 tab trong Spreadsheet van chuyen rieng (Tieng Viet truc quan, de su dung).
  VC_SHEET_ORDERS: 'Đơn vận chuyển',
  VC_SHEET_ORDER_ITEMS: 'Chi tiết vận chuyển',
  VC_SHEET_STATUS_HISTORY: 'Lịch sử trạng thái',
  VC_SHEET_ATTACHMENTS: 'Ảnh chứng từ',
  VC_SHEET_EXCEPTIONS: 'Sự cố vận chuyển',
  VC_SHEET_VEHICLES: 'Danh mục xe',

  // Tab "Users" nam CHUNG spreadsheet KiotViet hien co (khong tao spreadsheet
  // rieng cho tab nay) — vi tab Users KHONG bao gio duoc bot Telegram/GAS
  // ghi tu dong (chi Quan ly tao/sua tai khoan qua script setup), nen khong
  // co rui ro race condition can spreadsheet rieng bao ve.
  SHEET_USERS: 'Users',

  SHEET_CATEGORIES: 'Nhóm hàng',
  SHEET_PRODUCTS: 'Hàng hóa',
  SHEET_INVOICES: 'Hóa đơn',
  SHEET_INVOICE_DETAILS: 'Chi tiết hóa đơn',
  SHEET_ORDERS: 'Đặt hàng',
  SHEET_RETURNS: 'Trả hàng',
  SHEET_CUSTOMERS: 'Khách hàng',
  SHEET_CUSTOMER_REPORT: 'Báo cáo bán hàng',
  SHEET_CUSTOMER_BY_PRODUCT_REPORT: 'Khách theo hàng hóa',
  SHEET_SUPPLIERS: 'Nhà cung cấp',
  SHEET_PURCHASES: 'Nhập hàng',
  SHEET_DEACTIVATED_TODAY: 'Hàng ngừng kinh doanh',

  // HN1/HN3/HN7 do Apps Script tính từ dữ liệu KiotViet theo kỳ 1/3/7 ngày.
  // Server CHỈ ĐỌC — không được tạo/xóa/ghi ba tab này.
  SHEET_DEBT_1: 'HN1',
  SHEET_DEBT_3: 'HN3',
  SHEET_DEBT_7: 'HN7',

  // ==========================================
  // QUAN LY NHAN SU — Spreadsheet rieng (HR_*) + Bot Telegram xin nghi phep
  // ==========================================
  // Optional — neu chua set thi log canh bao khi module HR duoc goi, khong
  // lam crash server hien tai (giong VC_SPREADSHEET_ID).
  HR_SPREADSHEET_ID: process.env.HR_SPREADSHEET_ID || null,
  // Nguon nhan su rieng cua co so Sai Gon (se cung cap sau) — bo trong thi tab
  // "Quan ly nhan su" o co so Sai Gon bao "Chua duoc cau hinh".
  HR_SPREADSHEET_ID_SG: process.env.HR_SPREADSHEET_ID_SG || null,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || null,

  HR_SHEET_LEAVE_REQUESTS: 'Yêu cầu nghỉ phép',
  HR_SHEET_TELEGRAM_LINKS: '_HR_TELEGRAM_LINKS',

  // Nguong canh bao "nghi gap": thoi gian bat dau nghi - thoi gian nhan tin
  // < nguong nay (gio) thi tu dong gan co, chi de canh bao, khong tu tu choi.
  HR_URGENT_NOTICE_HOURS_THRESHOLD: Number(process.env.HR_URGENT_NOTICE_HOURS_THRESHOLD) || 10,
  // So lan nghi gap/thang vuot nguong nay thi hien badge canh bao cho Quan ly.
  HR_URGENT_FLAG_MONTHLY_THRESHOLD: Number(process.env.HR_URGENT_FLAG_MONTHLY_THRESHOLD) || 2,
  // Thoi han hieu luc cua ma lien ket Telegram (phut).
  HR_LINK_CODE_TTL_MINUTES: Number(process.env.HR_LINK_CODE_TTL_MINUTES) || 15
};

module.exports = CONFIG;
