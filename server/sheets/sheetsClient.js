// ==========================================
// GOOGLE SHEETS CLIENT — doc du lieu tu sheet KiotViet export (Apps Script
// rieng ben ngoai chiu trach nhiem dong bo/ghi; server nay chi DOC)
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

let sheetsApiPromise = null;

function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

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
    range: quoteSheetName(sheetName)
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
 * Danh sach ten cac sheet (tab) hien co trong spreadsheet — dung de debug
 * va de loc bot range khong ton tai truoc khi goi batchGet.
 */
async function listSheetTitles() {
  const sheets = await getSheetsApi();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    fields: 'sheets.properties.title'
  });
  return (res.data.sheets || []).map(s => s.properties.title);
}

/**
 * Doc NHIEU sheet trong 1 lan goi API (giam do tre khi client poll dinh ky).
 * batchGet se loi TOAN BO (khong tra ve gi ca) neu chi 1 sheet trong danh sach
 * khong ton tai, nen phai loc truoc theo danh sach tab thuc te — 1 tab bi
 * thieu/doi ten chi lam rong muc do, khong lam sap ca dashboard.
 * @param {string[]} sheetNames
 * @returns {Promise<Object<string, any[][]>>} map ten sheet -> mang 2 chieu (rong neu sheet khong co du lieu hoac khong ton tai)
 */
async function getMultipleSheetValues(sheetNames) {
  const sheets = await getSheetsApi();
  const result = {};
  sheetNames.forEach(name => { result[name] = []; });

  const existingTitles = new Set(await listSheetTitles());
  const namesToFetch = sheetNames.filter(name => existingTitles.has(name));
  if (namesToFetch.length === 0) return result;

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CONFIG.SPREADSHEET_ID,
    ranges: namesToFetch.map(quoteSheetName)
  });

  const valueRanges = res.data.valueRanges || [];
  valueRanges.forEach((vr, i) => {
    const name = sheetNameFromRange(vr.range) || namesToFetch[i];
    result[name] = vr.values || [];
  });
  return result;
}

module.exports = { getValues, getMultipleSheetValues, listSheetTitles };
