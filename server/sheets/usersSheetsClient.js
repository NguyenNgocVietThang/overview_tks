// ==========================================
// USERS SHEETS CLIENT — doc/ghi tab "Users" trong spreadsheet KiotViet hien
// co (CONFIG.SPREADSHEET_ID). Khac voi sheetsClient.js (chi doc, scope
// spreadsheets.readonly), client nay dung scope "spreadsheets" (doc + GHI)
// de localUserStore.js dong bo phan quyen/ho so nguoi dung ra Sheets — nguon
// luu tru ben vung, khong bi mat khi container Render restart (dia ephemeral).
//
// Tab "Users" CHI ton tai o spreadsheet Ha Noi (SPREADSHEET_ID), khong co
// bien the Sai Gon — xem server/scripts/setupUsersSheet.js va comment trong
// server/config.js canh SHEET_USERS. Vi vay client nay KHONG theo co so,
// khac pattern vcSheetsClient.js/hrSheetsClient.js.
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

const USERS_API_TIMEOUT_MS = 15000; // 15s — tranh request Express treo vo thoi han

let usersSheetsApiPromise = null;

function getUsersSheetsApi() {
  if (!usersSheetsApiPromise) {
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      // Scope day du de doc va GHI (append/update). Luu y: spreadsheet phai
      // duoc share Editor cho service account nay, khong chi Viewer.
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    usersSheetsApiPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return usersSheetsApiPromise;
}

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnIndexToLetter(colIndex) {
  let letter = '';
  while (colIndex > 0) {
    const mod = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

function requireSpreadsheetId() {
  if (!CONFIG.SPREADSHEET_ID) {
    const err = new Error('SPREADSHEET_ID chưa được cấu hình — không thể đồng bộ tab Users.');
    err.code = 'USERS_SHEET_NOT_CONFIGURED';
    throw err;
  }
  return CONFIG.SPREADSHEET_ID;
}

/**
 * Doc toan bo du lieu 1 sheet (giong sheetsClient.getValues, nhung qua client
 * co quyen ghi).
 */
async function usersGetValues(sheetName) {
  const spreadsheetId = requireSpreadsheetId();
  const sheets = await getUsersSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: quoteSheetName(sheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  }, { timeout: USERS_API_TIMEOUT_MS });
  return res.data.values || [];
}

/**
 * Them 1 hang moi vao cuoi sheet (tai khoan moi tao).
 */
async function usersAppendRow(sheetName, row) {
  const spreadsheetId = requireSpreadsheetId();
  const sheets = await getUsersSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: quoteSheetName(sheetName),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] }
  }, { timeout: USERS_API_TIMEOUT_MS });
}

/**
 * Ghi de 1 hang co san theo so thu tu hang (1-based, tinh ca header).
 */
async function usersUpdateRow(sheetName, rowIndex, row) {
  const spreadsheetId = requireSpreadsheetId();
  const sheets = await getUsersSheetsApi();
  const lastColLetter = columnIndexToLetter(row.length);
  const range = `${quoteSheetName(sheetName)}!A${rowIndex}:${lastColLetter}${rowIndex}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [row] }
  }, { timeout: USERS_API_TIMEOUT_MS });
}

module.exports = {
  usersGetValues,
  usersAppendRow,
  usersUpdateRow
};
