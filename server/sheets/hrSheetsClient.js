// ==========================================
// HR SHEETS CLIENT — doc/ghi Spreadsheet nhan su rieng (HR_*)
//
// Sao chep tu vcSheetsClient.js, doi VC -> HR:
//   - Dung HR_SPREADSHEET_ID (spreadsheet nhan su doc lap, tach khoi VC vi
//     du lieu nhay cam hon: ly do nghi, thong tin ca nhan)
//   - Scope "spreadsheets" (doc + GHI) vi bot Telegram va web deu can ghi
//   - Export cac ham tien ich: hrGetValues, hrAppendRow, hrUpdateRow,
//     hrBatchUpdate, hrGetMultipleSheetValues
//
// DA CO SO: giong vcSheetsClient — moi co so co spreadsheet nhan su rieng
// (HR_SPREADSHEET_ID = Ha Noi, HR_SPREADSHEET_ID_SG = Sai Gon), toan bo cache
// nam trong closure cua tung client.
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');
const { BRANCHES } = require('../branch/branches');

const HR_API_TIMEOUT_MS = 15000; // 15s

// ---- Auth singleton (read + write scope) --------------------------------
// Dung CHUNG cho moi co so — cung service account ghi ca hai spreadsheet.

let hrSheetsApiPromise = null;

function getHrSheetsApi() {
  if (!hrSheetsApiPromise) {
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

function columnIndexToLetter(colIndex) {
  let letter = '';
  while (colIndex > 0) {
    const mod = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

function branchNotConfigured(branchLabel, envHint) {
  const err = new Error(`Cơ sở ${branchLabel} chưa được cấu hình nguồn dữ liệu nhân sự.`);
  err.code = 'BRANCH_NOT_CONFIGURED';
  err.statusCode = 503;
  err.detail = `[hrSheetsClient] ${envHint} chua duoc dat trong .env`;
  return err;
}

const HR_SHEET_TITLES_CACHE_TTL_MS = 5 * 60 * 1000;
const HR_SHEET_IDS_CACHE_TTL_MS = 5 * 60 * 1000;
const HR_SHEET_CACHE_TTL_MS = 10 * 1000; // 10s

/**
 * Tao client nhan su gan voi spreadsheet cua 1 co so.
 * @param {() => (string|null)} getSpreadsheetId doc CONFIG tai thoi diem GOI.
 * @param {string} branchLabel ten co so, dung trong thong bao loi.
 * @param {string} envHint ten bien moi truong tuong ung, dung trong log.
 */
function createHrClient(getSpreadsheetId, branchLabel, envHint) {
  function requireSpreadsheetId() {
    const id = getSpreadsheetId();
    if (!id) throw branchNotConfigured(branchLabel, envHint);
    return id;
  }

  // ---- Cache danh sach tab -----------------------------------------------------

  let hrSheetTitlesCache = { data: null, expiresAt: 0, loading: null };

  async function hrListSheetTitles() {
    if (hrSheetTitlesCache.data && Date.now() < hrSheetTitlesCache.expiresAt) {
      return hrSheetTitlesCache.data;
    }
    if (hrSheetTitlesCache.loading) return hrSheetTitlesCache.loading;

    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getHrSheetsApi();
    const loading = sheets.spreadsheets.get({
      spreadsheetId,
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

  let hrSheetIdsCache = { data: null, expiresAt: 0, loading: null };

  function fetchHrSheetIds() {
    if (hrSheetIdsCache.loading) return hrSheetIdsCache.loading;
    const cacheAtStart = hrSheetIdsCache;

    const loading = Promise.resolve()
      .then(() => {
        const spreadsheetId = requireSpreadsheetId();
        return getHrSheetsApi().then(sheets => sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties(sheetId,title)'
        }, { timeout: HR_API_TIMEOUT_MS }));
      })
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

    const spreadsheetId = requireSpreadsheetId();
    const generationAtStart = getHrSheetGeneration(sheetName);

    const loading = getHrSheetsApi().then(sheets => sheets.spreadsheets.values.get({
      spreadsheetId,
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getHrSheetsApi();
    const result = {};
    sheetNames.forEach(name => { result[name] = []; });

    const existingTitles = new Set(await hrListSheetTitles());
    const namesToFetch = sheetNames.filter(name => existingTitles.has(name));
    if (namesToFetch.length === 0) return result;

    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getHrSheetsApi();
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getHrSheetsApi();
    const lastColLetter = columnIndexToLetter(row.length);
    const range = `${quoteSheetName(sheetName)}!A${rowIndex}:${lastColLetter}${rowIndex}`;
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      }, { timeout: HR_API_TIMEOUT_MS });
    } finally {
      invalidateHrSheetCache(sheetName);
    }
  }

  async function hrBatchUpdate(requests) {
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getHrSheetsApi();
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      }, { timeout: HR_API_TIMEOUT_MS });
    } finally {
      for (const trackedSheetName of hrSheetCache.keys()) {
        hrSheetGeneration.set(trackedSheetName, getHrSheetGeneration(trackedSheetName) + 1);
      }
      hrSheetCache.clear();
    }
  }

  return {
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
}

const hanoiHrClient = createHrClient(() => CONFIG.HR_SPREADSHEET_ID, BRANCHES.HANOI, 'HR_SPREADSHEET_ID');
const saigonHrClient = createHrClient(() => CONFIG.HR_SPREADSHEET_ID_SG, BRANCHES.SAIGON, 'HR_SPREADSHEET_ID_SG');

/**
 * Client nhan su cua 1 co so. Mac dinh (branch khong xac dinh) = Ha Noi.
 * Ha Noi tra ve CHINH module.exports de test dang monkey-patch tung ham van
 * chan duoc loi goi.
 */
function getHrClient(branch) {
  return branch === BRANCHES.SAIGON ? saigonHrClient : module.exports;
}

module.exports = {
  hrGetValues: (...args) => hanoiHrClient.hrGetValues(...args),
  hrGetMultipleSheetValues: (...args) => hanoiHrClient.hrGetMultipleSheetValues(...args),
  hrAppendRow: (...args) => hanoiHrClient.hrAppendRow(...args),
  hrUpdateRow: (...args) => hanoiHrClient.hrUpdateRow(...args),
  hrBatchUpdate: (...args) => hanoiHrClient.hrBatchUpdate(...args),
  hrListSheetTitles: (...args) => hanoiHrClient.hrListSheetTitles(...args),
  hrGetSheetId: (...args) => hanoiHrClient.hrGetSheetId(...args),
  hrInvalidateSheetTitlesCache: (...args) => hanoiHrClient.hrInvalidateSheetTitlesCache(...args),
  invalidateHrSheetCache: (...args) => hanoiHrClient.invalidateHrSheetCache(...args),
  getHrClient
};
