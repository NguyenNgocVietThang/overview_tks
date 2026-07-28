// ==========================================
// GOOGLE SHEETS CLIENT — doc du lieu tu sheet KiotViet export (Apps Script
// rieng ben ngoai chiu trach nhiem dong bo/ghi; server nay chi DOC)
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

let sheetsApiPromise = null;

function getSheetsApi() {
  if (!sheetsApiPromise) {
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
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

function sheetNameFromRange(rangeStr) {
  if (!rangeStr) return null;
  const namePart = rangeStr.split('!')[0];
  if (namePart.startsWith("'") && namePart.endsWith("'")) {
    return namePart.slice(1, -1).replace(/''/g, "'");
  }
  return namePart;
}

/**
 * Doc NHIEU sheet trong 1 lan goi API (giam do tre khi client poll dinh ky).
 * @param {string[]} sheetNames
 * @returns {Promise<Object<string, any[][]>>} map ten sheet -> mang 2 chieu (rong neu sheet khong co du lieu)
 */
async function getMultipleSheetValues(sheetNames) {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    ranges: sheetNames
  });
  const result = {};
  sheetNames.forEach(name => { result[name] = []; });

  const valueRanges = res.data.valueRanges || [];
  valueRanges.forEach((vr, i) => {
    const name = sheetNameFromRange(vr.range) || sheetNames[i];
    result[name] = vr.values || [];
  });
  return result;
}

module.exports = { getValues, getMultipleSheetValues };
