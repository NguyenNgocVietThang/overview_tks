// ==========================================
// HR SHEETS CLIENT — doc/ghi Spreadsheet nhan su rieng (HR_*)
//
// Sao chep tu vcSheetsClient.js, doi VC -> HR:
//   - Dung HR_SPREADSHEET_ID (spreadsheet nhan su doc lap, tach khoi VC vi
//     du lieu nhay cam hon: ly do nghi, thong tin ca nhan)
//   - Scope "spreadsheets" (doc + GHI) vi bot Telegram va web deu can ghi
//   - Export cac ham tien ich: hrGetValues, hrAppendRow, hrUpdateRow,
//     hrBatchUpdate, hrGetMultipleSheetValues
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

const HR_API_TIMEOUT_MS = 15000; // 15s

// ---- Auth singleton (read + write scope) --------------------------------

let hrSheetsApiPromise = null;

function getHrSheetsApi() {
  if (!hrSheetsApiPromise) {
    if (!CONFIG.HR_SPREADSHEET_ID) {
      return Promise.reject(
        new Error(
          '[hrSheetsClient] HR_SPREADSHEET_ID chua duoc dat. ' +
          'Chay: node scripts/setupHrSheet.js de tao Spreadsheet nhan su, ' +
          'sau do them HR_SPREADSHEET_ID vao file .env.'
        )
      );
    }
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    hrSheetsApiPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return hrSheetsApiPromise;
}

// ---- Utility ----------------------------------------------------------------

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

// ---- Cache danh sach tab -----------------------------------------------------

const HR_SHEET_TITLES_CACHE_TTL_MS = 5 * 60 * 1000;
let hrSheetTitlesCache = { data: null, expiresAt: 0, loading: null };

async function hrListSheetTitles() {
  if (hrSheetTitlesCache.data && Date.now() < hrSheetTitlesCache.expiresAt) {
    return hrSheetTitlesCache.data;
  }
  if (hrSheetTitlesCache.loading) return hrSheetTitlesCache.loading;

  const sheets = await getHrSheetsApi();
  const loading = sheets.spreadsheets.get({
    spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
    fields: 'sheets.properties.title'
  }, { timeout: HR_API_TIMEOUT_MS })
    .then(res => {
      const titles = (res.data.sheets || []).map(s => s.properties.title);
      hrSheetTitlesCache.data = titles;
      hrSheetTitlesCache.expiresAt = Date.now() + HR_SHEET_TITLES_CACHE_TTL_MS;
      return titles;
    })
    .finally(() => {
      if (hrSheetTitlesCache.loading === loading) hrSheetTitlesCache.loading = null;
    });
  hrSheetTitlesCache.loading = loading;
  return loading;
}

// ---- Cache sheetId SO theo ten tab (xem giai thich chi tiet trong vcSheetsClient.js) ----

const HR_SHEET_IDS_CACHE_TTL_MS = 5 * 60 * 1000;
let hrSheetIdsCache = { data: null, expiresAt: 0, loading: null };

function fetchHrSheetIds() {
  if (hrSheetIdsCache.loading) return hrSheetIdsCache.loading;
  const cacheAtStart = hrSheetIdsCache;

  const loading = getHrSheetsApi()
    .then(sheets => sheets.spreadsheets.get({
      spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
      fields: 'sheets.properties(sheetId,title)'
    }, { timeout: HR_API_TIMEOUT_MS }))
    .then(res => {
      const map = new Map();
      (res.data.sheets || []).forEach(s => {
        const props = s && s.properties;
        if (props && typeof props.sheetId === 'number' && props.title != null) {
          map.set(props.title, props.sheetId);
        }
      });
      if (hrSheetIdsCache === cacheAtStart) {
        hrSheetIdsCache.data = map;
        hrSheetIdsCache.expiresAt = Date.now() + HR_SHEET_IDS_CACHE_TTL_MS;
      }
      return map;
    })
    .finally(() => {
      if (hrSheetIdsCache.loading === loading) hrSheetIdsCache.loading = null;
    });

  hrSheetIdsCache.loading = loading;
  return loading;
}

async function hrGetSheetId(sheetName) {
  let map;
  let fromCache = false;

  if (hrSheetIdsCache.data && Date.now() < hrSheetIdsCache.expiresAt) {
    map = hrSheetIdsCache.data;
    fromCache = true;
  } else if (hrSheetIdsCache.loading) {
    map = await hrSheetIdsCache.loading;
  } else {
    map = await fetchHrSheetIds();
  }

  if (map.has(sheetName)) return map.get(sheetName);

  if (fromCache) {
    const fresh = await fetchHrSheetIds();
    if (fresh.has(sheetName)) return fresh.get(sheetName);
  }

  throw new Error(`[hrSheetsClient] Khong tim thay sheetId cho tab "${sheetName}"`);
}

function hrInvalidateSheetTitlesCache() {
  hrSheetTitlesCache = { data: null, expiresAt: 0, loading: null };
  hrSheetIdsCache = { data: null, expiresAt: 0, loading: null };
}

// ---- Cache ngan han theo tab (generation-guard, xem vcSheetsClient.js) -------

const HR_SHEET_CACHE_TTL_MS = 10 * 1000; // 10s
const hrSheetCache = new Map(); // sheetName -> { data, expiresAt, loading }
const hrSheetGeneration = new Map(); // sheetName -> generation counter

function getHrSheetGeneration(sheetName) {
  return hrSheetGeneration.get(sheetName) || 0;
}

function invalidateHrSheetCache(sheetName) {
  hrSheetGeneration.set(sheetName, getHrSheetGeneration(sheetName) + 1);
  hrSheetCache.delete(sheetName);
}

// ---- Read -------------------------------------------------------------------

async function hrGetValues(sheetName) {
  const cached = hrSheetCache.get(sheetName);
  if (cached && cached.data && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  if (cached && cached.loading) return cached.loading;

  const generationAtStart = getHrSheetGeneration(sheetName);

  const loading = getHrSheetsApi().then(sheets => sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
    range: quoteSheetName(sheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  }, { timeout: HR_API_TIMEOUT_MS })).then(res => {
    const values = res.data.values || [];
    if (getHrSheetGeneration(sheetName) === generationAtStart) {
      hrSheetCache.set(sheetName, { data: values, expiresAt: Date.now() + HR_SHEET_CACHE_TTL_MS, loading: null });
    }
    return values;
  }).catch(err => {
    if (getHrSheetGeneration(sheetName) === generationAtStart) {
      hrSheetCache.delete(sheetName);
    }
    throw err;
  });

  hrSheetCache.set(sheetName, { data: cached ? cached.data : null, expiresAt: 0, loading });
  return loading;
}

async function hrGetMultipleSheetValues(sheetNames) {
  const sheets = await getHrSheetsApi();
  const result = {};
  sheetNames.forEach(name => { result[name] = []; });

  const existingTitles = new Set(await hrListSheetTitles());
  const namesToFetch = sheetNames.filter(name => existingTitles.has(name));
  if (namesToFetch.length === 0) return result;

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
    ranges: namesToFetch.map(quoteSheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  }, { timeout: HR_API_TIMEOUT_MS });

  const valueRanges = res.data.valueRanges || [];
  valueRanges.forEach((vr, i) => {
    const rangeStr = vr.range || '';
    const namePart = rangeStr.split('!')[0];
    const name = (namePart.startsWith("'") && namePart.endsWith("'"))
      ? namePart.slice(1, -1).replace(/''/g, "'")
      : (namePart || namesToFetch[i]);
    result[name] = vr.values || [];
  });
  return result;
}

// ---- Write ------------------------------------------------------------------

async function hrAppendRow(sheetName, row) {
  const sheets = await getHrSheetsApi();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
      range: quoteSheetName(sheetName),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    }, { timeout: HR_API_TIMEOUT_MS });
  } finally {
    invalidateHrSheetCache(sheetName);
  }
}

async function hrUpdateRow(sheetName, rowIndex, row) {
  const sheets = await getHrSheetsApi();
  const lastColLetter = columnIndexToLetter(row.length);
  const range = `${quoteSheetName(sheetName)}!A${rowIndex}:${lastColLetter}${rowIndex}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    }, { timeout: HR_API_TIMEOUT_MS });
  } finally {
    invalidateHrSheetCache(sheetName);
  }
}

async function hrBatchUpdate(requests) {
  const sheets = await getHrSheetsApi();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.HR_SPREADSHEET_ID,
      requestBody: { requests }
    }, { timeout: HR_API_TIMEOUT_MS });
  } finally {
    for (const trackedSheetName of hrSheetCache.keys()) {
      hrSheetGeneration.set(trackedSheetName, getHrSheetGeneration(trackedSheetName) + 1);
    }
    hrSheetCache.clear();
  }
}

// ---- Utility ----------------------------------------------------------------

function columnIndexToLetter(colIndex) {
  let letter = '';
  while (colIndex > 0) {
    const mod = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

module.exports = {
  hrGetValues,
  hrGetMultipleSheetValues,
  hrAppendRow,
  hrUpdateRow,
  hrBatchUpdate,
  hrListSheetTitles,
  hrGetSheetId,
  hrInvalidateSheetTitlesCache,
  invalidateHrSheetCache
};
