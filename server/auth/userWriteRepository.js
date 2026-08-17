// ==========================================
// USER WRITE REPOSITORY — noi DUY NHAT runtime web duoc phep GHI vao tab
// "Users". Runtime web chi ghi khi tao tai khoan Khach (email/mat khau hoac
// Google) va chuyen ban ghi Google legacy tu "Cho duyet" sang Khach. Moi thao
// tac quan tri khac van lam qua server/scripts/setupUsersSheet.js.
//
// Dung write-scope Sheets client RIENG (khac server/sheets/sheetsClient.js
// dang chi doc, dung scope "spreadsheets.readonly") — mirror dung pattern
// getSheetsClient trong server/scripts/setupUsersSheet.js.
// ==========================================
const crypto = require('crypto');
const { google } = require('googleapis');
const CONFIG = require('../config');
const { USER_COLUMNS, ACTIVE_STATUS, ROLES } = require('./userRepository');

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
 * Tao tai khoan Khach hoat dong ngay cho dang ky email/mat khau hoac Google.
 * Ham tu kiem tra trung username/email ngay truoc khi append de giam rui ro
 * hai request dang ky ghi trung nhau.
 */
async function readRows(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `'${SHEET_NAME}'`
  });
  return (res.data.values || []).slice(1);
}

function normalizeIdentity(value) {
  return String(value || '').trim().toLowerCase();
}

function userExists(rows, headers, email) {
  const usernameIndex = headers.indexOf(USER_COLUMNS.username);
  const emailIndex = headers.indexOf(USER_COLUMNS.email);
  const target = normalizeIdentity(email);
  return rows.some(row =>
    normalizeIdentity(row[usernameIndex]) === target || normalizeIdentity(row[emailIndex]) === target
  );
}

async function createActiveGuest({ id, email, hoTen, passwordHash = '' }) {
  const sheets = await getSheetsApi();
  const headers = await ensureHeaders(sheets);
  const rows = await readRows(sheets);
  if (userExists(rows, headers, email)) {
    const err = new Error('Tài khoản đã tồn tại.');
    err.code = 'USER_EXISTS';
    throw err;
  }
  const colIndex = {};
  headers.forEach((header, i) => { colIndex[header] = i; });

  const row = new Array(headers.length).fill('');
  row[colIndex[USER_COLUMNS.id]] = id || crypto.randomUUID();
  row[colIndex[USER_COLUMNS.hoTen]] = hoTen || email;
  row[colIndex[USER_COLUMNS.username]] = email;
  row[colIndex[USER_COLUMNS.passwordHash]] = passwordHash;
  row[colIndex[USER_COLUMNS.vaiTro]] = ROLES.KHACH;
  row[colIndex[USER_COLUMNS.coSo]] = '';
  row[colIndex[USER_COLUMNS.trangThai]] = ACTIVE_STATUS;
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

async function activatePendingGuest({ email, hoTen }) {
  const sheets = await getSheetsApi();
  const headers = await ensureHeaders(sheets);
  const rows = await readRows(sheets);
  const emailIndex = headers.indexOf(USER_COLUMNS.email);
  const usernameIndex = headers.indexOf(USER_COLUMNS.username);
  const target = normalizeIdentity(email);
  const rowIndex = rows.findIndex(row =>
    normalizeIdentity(row[emailIndex]) === target || normalizeIdentity(row[usernameIndex]) === target
  );
  if (rowIndex < 0) throw new Error('Không tìm thấy tài khoản chờ duyệt.');

  const row = rows[rowIndex].slice(0, headers.length);
  while (row.length < headers.length) row.push('');
  const roleIndex = headers.indexOf(USER_COLUMNS.vaiTro);
  const statusIndex = headers.indexOf(USER_COLUMNS.trangThai);
  const nameIndex = headers.indexOf(USER_COLUMNS.hoTen);
  row[roleIndex] = ROLES.KHACH;
  row[statusIndex] = ACTIVE_STATUS;
  if (!row[nameIndex]) row[nameIndex] = hoTen || email;

  const rowNumber = rowIndex + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `'${SHEET_NAME}'!A${rowNumber}:${columnLetter(headers.length)}${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });
}

module.exports = { createActiveGuest, activatePendingGuest };
