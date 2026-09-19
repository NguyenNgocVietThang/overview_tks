// ==========================================
// CAU HINH — doc tu bien moi truong (khong commit secret)
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const CONFIG = {
  // SPREADSHEET_ID = co so HA NOI (bat buoc). Spreadsheet bao cao cua co so
  // SAI GON la optional — thieu bien nay thi co so Sai Gon tra 503
  // BRANCH_NOT_CONFIGURED chu khong lam sap server.
  SPREADSHEET_ID: required('SPREADSHEET_ID'),
  SPREADSHEET_ID_SG: process.env.SPREADSHEET_ID_SG || null,
  // Workbook "Bảng Công nợ" dùng chung cho hai cơ sở, server chỉ đọc hai
  // tab Công nợ HN/SG. Optional để thiếu cấu hình không làm sập dashboard.
  DEBT_MANAGEMENT_SPREADSHEET_ID: process.env.DEBT_MANAGEMENT_SPREADSHEET_ID || null,
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
  // GUI OTP QUEN MAT KHAU — Email (Gmail SMTP)
  // OPTIONAL: thieu bien nao thi tu dong fallback ve console.log (che do dev),
  // KHONG lam sap server. Xem server/notifications/.
  // ==========================================
  // Gmail SMTP: bat 2FA cho tai khoan Gmail dung de gui, roi tao "App
  // Password" 16 ky tu tai https://myaccount.google.com/apppasswords —
  // KHONG dung mat khau Gmail that.
  SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
  SMTP_PORT: Number(process.env.SMTP_PORT) || 465,
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_APP_PASSWORD: process.env.SMTP_APP_PASSWORD || null,
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || 'TOKOSI Dashboard',

  // ==========================================
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
  SHEET_SUPPLIER_RETURNS: 'Trả NCC',

  DEBT_MANAGEMENT_SHEET_HN: 'Công nợ HN',
  DEBT_MANAGEMENT_SHEET_SG: 'Công nợ SG',

  // ==========================================
  // VONG DOI DON HANG — spreadsheet RIENG (2 tab DonHang_HN/DonHang_SG trong
  // CUNG 1 spreadsheet). Server CHI DOC 2 tab do.
  // Tab "Lich su cap nhat" (ORDER_LIFECYCLE_SHEET_HISTORY) la NGOAI LE: do
  // server tu tao/ghi (ghi de trang thai thu cong cua Quan ly/Ke toan).
  // ==========================================
  ORDER_LIFECYCLE_SPREADSHEET_ID: process.env.ORDER_LIFECYCLE_SPREADSHEET_ID || null,
  ORDER_LIFECYCLE_SHEET_HN: 'DonHang_HN',
  ORDER_LIFECYCLE_SHEET_SG: 'DonHang_SG',
  ORDER_LIFECYCLE_SHEET_HISTORY: 'Lịch sử cập nhật',

  // ==========================================
  // QUAN LY NHAN SU — Spreadsheet rieng (HR_*)
  // ==========================================
  // Optional — neu chua set thi log canh bao khi module HR duoc goi, khong
  // lam crash server hien tai.
  HR_SPREADSHEET_ID: process.env.HR_SPREADSHEET_ID || null,
  // Nguon nhan su rieng cua co so Sai Gon (se cung cap sau) — bo trong thi tab
  // "Quan ly nhan su" o co so Sai Gon bao "Chua duoc cau hinh".
  HR_SPREADSHEET_ID_SG: process.env.HR_SPREADSHEET_ID_SG || null,

  HR_SHEET_LEAVE_REQUESTS: 'Yêu cầu nghỉ phép',
  HR_SHEET_EMPLOYEES: 'Danh sách nhân sự',
  HR_SHEET_TELEGRAM_LINKS: '_HR_TELEGRAM_LINKS',
  HR_SHEET_TELEGRAM_SESSIONS: '_HR_TELEGRAM_SESSIONS',

  // Co "nghi gap": tin nhan gui tu gio nay tro di (gio Bangkok, 0-23) VA ca
  // nghi bat dau ngay hom sau lien ke thi tu dong gan co, chi de canh bao,
  // khong tu tu choi.
  HR_URGENT_LATE_NIGHT_HOUR: Number(process.env.HR_URGENT_LATE_NIGHT_HOUR) || 22,
  // So lan nghi gap/thang vuot nguong nay thi hien badge canh bao cho Quan ly.
  HR_URGENT_FLAG_MONTHLY_THRESHOLD: Number(process.env.HR_URGENT_FLAG_MONTHLY_THRESHOLD) || 2,
  // Thoi han hieu luc cua ma lien ket Telegram (phut).
  HR_LINK_CODE_TTL_MINUTES: Number(process.env.HR_LINK_CODE_TTL_MINUTES) || 15,

  // ==========================================
  // SUPABASE POSTGRES — dong bo KiotViet, xem
  // docs/04-planning/2026-09-14-roadmap-supabase-kiotviet-sync.md
  // ==========================================
  // Optional — fail-soft: engine dong bo mac dinh TAT
  // (KIOTVIET_SYNC_ENABLED=false), thieu bien nay khong duoc lam sap server.
  SUPABASE_DB_URL: process.env.SUPABASE_DB_URL || null,
  // Optional — mac dinh true khi production (Supabase Postgres can SSL), false
  // khi dev local (Postgres qua Docker thuong khong bat SSL).
  PGSSL: process.env.PGSSL ? process.env.PGSSL === 'true' : process.env.NODE_ENV === 'production',
  // Cong tac chinh cua toan bo engine dong bo KiotViet->Supabase (webhook +
  // polling). Mac dinh TAT tuong minh — khong co logic tu bat theo NODE_ENV.
  KIOTVIET_SYNC_ENABLED: process.env.KIOTVIET_SYNC_ENABLED === 'true',
  KIOTVIET_SYNC_FAST_INTERVAL_MS: Number(process.env.KIOTVIET_SYNC_FAST_INTERVAL_MS) > 0
    ? Number(process.env.KIOTVIET_SYNC_FAST_INTERVAL_MS) : 7 * 60 * 1000,
  KIOTVIET_SYNC_SLOW_INTERVAL_MS: Number(process.env.KIOTVIET_SYNC_SLOW_INTERVAL_MS) > 0
    ? Number(process.env.KIOTVIET_SYNC_SLOW_INTERVAL_MS) : 20 * 60 * 1000
};

module.exports = CONFIG;
