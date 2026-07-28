// ==========================================
// GOOGLE SHEETS CLIENT — thay the SpreadsheetApp bang Sheets API (service account)
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

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

/**
 * Doc toan bo du lieu cua 1 sheet, tra ve mang 2 chieu (giong getDataRange().getValues()).
 */
async function getValues(sheetName) {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: sheetName
  });
  return res.data.values || [];
}

/**
 * Ghi de 1 dong cu the (1-based row number), tuong ung sheet.getRange(r, 1, 1, values.length).setValues([values]).
 */
async function updateRow(sheetName, rowNumber, values) {
  const sheets = await getSheetsApi();
  const lastCol = columnLetter(values.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${sheetName}!A${rowNumber}:${lastCol}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [values] }
  });
}

/**
 * Them 1 dong vao cuoi sheet, tuong ung sheet.appendRow(values).
 */
async function appendRow(sheetName, values) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
}

/**
 * Xoa toan bo noi dung sheet va ghi lai header + rows, tuong ung
 * sheet.clearContents() + setValues() dung trong SyncInitial.gs.
 */
async function clearAndWrite(sheetName, headers, rows) {
  const sheets = await getSheetsApi();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: sheetName
  });
  const values = [headers, ...rows];
  await sheets.spreadsheets.values.update({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values }
  });
}

function columnLetter(colCount) {
  let letter = '';
  let n = colCount;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

module.exports = { getValues, updateRow, appendRow, clearAndWrite };
