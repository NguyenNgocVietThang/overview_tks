// ==========================================
// USER WRITE REPOSITORY — noi DUY NHAT runtime web duoc phep GHI vao tab
// "Users". Chi dung cho luong tu dang ky qua Google (authRoutes.js,
// POST /api/auth/google) khi email dang nhap chua co san trong sheet. Moi
// thao tac ghi khac (tao/sua tai khoan, doi vai tro, khoa/mo khoa, duyet tai
// khoan cho duyet) van lam qua server/scripts/setupUsersSheet.js (CLI, khong
// phai duong web) — vd duyet tai khoan Google moi:
//   npm run setup:users-sheet -- --unlock --username=<email>
//
// Dung write-scope Sheets client RIENG (khac server/sheets/sheetsClient.js
// dang chi doc, dung scope "spreadsheets.readonly") — mirror dung pattern
// getSheetsClient trong server/scripts/setupUsersSheet.js.
// ==========================================
const crypto = require('crypto');
const { google } = require('googleapis');
const CONFIG = require('../config');
const { USER_COLUMNS, PENDING_STATUS, ROLES } = require('./userRepository');

const SHEET_NAME = CONFIG.SHEET_USERS;
// Dung dung thu tu voi USER_COLUMNS (server/auth/userRepository.js) — "Email"
// la cot cuoi cung, them vao SAU khi tinh nang nay ra doi.
const HEADERS = Object.values(USER_COLUMNS);

let sheetsApiPromise = null;

function getSheetsApi() {
  if (!sheetsApiPromise) {
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    sheetsApiPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return sheetsApiPromise;
}

function columnLetter(oneBasedIndex) {
  let n = oneBasedIndex;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/**
 * Doc header hien co cua tab Users va TU VA them cot con thieu vao CUOI (vd
 * "Email" tren sheet production da tao truoc khi tinh nang Google ra doi) —
 * de khong phai sua tay Sheet dang chay that. Chi APPEND cot thieu, khong
 * dong lai/xoa cot da co.
 */
async function ensureHeaders(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!1:1`
  });
  const currentHeaders = (res.data.values && res.data.values[0]) || [];
  const missing = HEADERS.filter(h => !currentHeaders.includes(h));
  if (!missing.length) return currentHeaders;

  const patched = currentHeaders.concat(missing);
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A1:${columnLetter(patched.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [patched] }
  });
  return patched;
}

function formatDateVN(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

/**
 * Tao dong user moi cho nguoi dang nhap Google lan dau (email chua co trong
 * Users sheet). Vai tro thap nhat + trang thai "Chờ duyệt" — khong the dang
 * nhap (ca password lan Google) cho toi khi admin duyet qua
 * `npm run setup:users-sheet -- --unlock --username=<email>`.
 */
async function createPendingGoogleUser({ email, hoTen }) {
  const sheets = await getSheetsApi();
  const headers = await ensureHeaders(sheets);
  const colIndex = {};
  headers.forEach((header, i) => { colIndex[header] = i; });

  const row = new Array(headers.length).fill('');
  row[colIndex[USER_COLUMNS.id]] = crypto.randomUUID();
  row[colIndex[USER_COLUMNS.hoTen]] = hoTen || email;
  row[colIndex[USER_COLUMNS.username]] = email;
  row[colIndex[USER_COLUMNS.passwordHash]] = ''; // tai khoan chi dang nhap Google, chua co mat khau
  row[colIndex[USER_COLUMNS.vaiTro]] = ROLES.TRO_LY;
  row[colIndex[USER_COLUMNS.coSo]] = '';
  row[colIndex[USER_COLUMNS.trangThai]] = PENDING_STATUS;
  row[colIndex[USER_COLUMNS.ngayTao]] = formatDateVN(new Date());
  row[colIndex[USER_COLUMNS.dangNhapGanNhat]] = '';
  row[colIndex[USER_COLUMNS.email]] = email;

  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `'${SHEET_NAME}'`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  });
}

module.exports = { createPendingGoogleUser };
