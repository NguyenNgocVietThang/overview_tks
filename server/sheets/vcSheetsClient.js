// ==========================================
// VC SHEETS CLIENT — doc/ghi Spreadsheet van chuyen rieng (VC_*)
//
// Khac voi sheetsClient.js (chi doc sheet KiotViet), client nay:
//   - Dung VC_SPREADSHEET_ID (spreadsheet van chuyen doc lap)
//   - Scope "spreadsheets" (doc + GHI) vi Phase 1B can append/update dong
//   - Export cac ham tien ich: vcGetValues, vcAppendRow, vcUpdateRow,
//     vcBatchUpdate, vcGetMultipleSheetValues
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');

// ---- Auth singleton (read + write scope) --------------------------------

let vcSheetsApiPromise = null;

function getVcSheetsApi() {
  if (!vcSheetsApiPromise) {
    if (!CONFIG.VC_SPREADSHEET_ID) {
      return Promise.reject(
        new Error(
          '[vcSheetsClient] VC_SPREADSHEET_ID chua duoc dat. ' +
          'Chay: node scripts/setupVcSheet.js de tao Spreadsheet van chuyen, ' +
          'sau do them VC_SPREADSHEET_ID vao file .env.'
        )
      );
    }
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      // Scope day du de doc va GHI (append/update/batchUpdate)
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    vcSheetsApiPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return vcSheetsApiPromise;
}

// ---- Utility ----------------------------------------------------------------

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

// ---- Cache danh sach tab (tuong tu sheetsClient.js) -------------------------

const VC_SHEET_TITLES_CACHE_TTL_MS = 5 * 60 * 1000;
let vcSheetTitlesCache = { data: null, expiresAt: 0, loading: null };

/**
 * Lay danh sach ten tab hien co trong VC Spreadsheet.
 * Cache 5 phut de tranh goi API thua khi append/update lien tiep.
 * @returns {Promise<string[]>}
 */
async function vcListSheetTitles() {
  if (vcSheetTitlesCache.data && Date.now() < vcSheetTitlesCache.expiresAt) {
    return vcSheetTitlesCache.data;
  }
  if (vcSheetTitlesCache.loading) return vcSheetTitlesCache.loading;

  const sheets = await getVcSheetsApi();
  const loading = sheets.spreadsheets.get({
    spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
    fields: 'sheets.properties.title'
  })
    .then(res => {
      const titles = (res.data.sheets || []).map(s => s.properties.title);
      vcSheetTitlesCache.data = titles;
      vcSheetTitlesCache.expiresAt = Date.now() + VC_SHEET_TITLES_CACHE_TTL_MS;
      return titles;
    })
    .finally(() => {
      if (vcSheetTitlesCache.loading === loading) vcSheetTitlesCache.loading = null;
    });
  vcSheetTitlesCache.loading = loading;
  return loading;
}

/** Invalidate cache sau khi tao/doi tab moi */
function vcInvalidateSheetTitlesCache() {
  vcSheetTitlesCache = { data: null, expiresAt: 0, loading: null };
}

// ---- Cache ngan han theo tab (rieng biet voi cache danh sach tab o tren) ----

// Cache ngan han cho du lieu tho tung tab VC — van don can do tuoi cao hon
// dashboard (nhieu tai xe/dieu phoi vien poll 25-30s cung luc), nen TTL ngan
// hon nhieu so voi dashboardData.js (90s). Invalidate CHU DONG ngay sau moi
// lan ghi vao dung sheet do de tranh doc du lieu cu ngay sau khi user vua sua.
const VC_SHEET_CACHE_TTL_MS = 12 * 1000; // 12s — ngan hon POLL_MS=25-30s cua client de van bat kip 1 vong poll
const vcSheetCache = new Map(); // sheetName -> { data, expiresAt, loading }

// Bo dem generation TOAN CUC (khong phai theo tung sheet) — bump moi khi co
// BAT KY lan invalidate nao (targeted hoac clear toan bo). Muc dich: chan
// mot read dang bay (bat dau TRUOC 1 lan ghi) "hoi sinh" du lieu cu vao cache
// SAU KHI lan ghi do da invalidate xong. Neu khong co counter nay, .then()
// cua read cu se ghi de len cache bang snapshot tu-truoc-khi-ghi, va vi cac
// ham doc-sua-ghi (transitionOrderStatus, updateOrderMeta...) doc nguyen dong
// tu cache roi ghi ca dong tro lai, 1 cache entry "hoi sinh" co the bi GHI
// NGUOC vao sheet that — khong chi hien thi cu ma con lam mat du lieu.
// Dung 1 counter GLOBAL (khong phai Map theo sheet) de don gian va an toan
// tuyet doi: bat ky lan ghi nao o sheet nao cung bump counter, nen 1 read
// dang bay cho BAT KY sheet nao (ke ca sheet khac voi sheet vua ghi) deu bi
// chan khong duoc ghi vao cache neu no "vuot mat" 1 lan invalidate — cai gia
// phai tra la thinh thoang bo qua 1 lan cache-populate khong lien quan ngay
// sau 1 lan ghi bat ky (hiem, vo hai, chi mat 12s cache-hit tiep theo), doi
// lai la KHONG BAO GIO co the ghi du lieu cu vao cache.
let vcSheetGeneration = 0;

function invalidateVcSheetCache(sheetName) {
  vcSheetGeneration++;
  vcSheetCache.delete(sheetName);
}

// ---- Read -------------------------------------------------------------------

/**
 * Doc toan bo du lieu cua 1 tab.
 * @param {string} sheetName
 * @returns {Promise<any[][]>} Mang 2 chieu (giong getDataRange().getValues())
 */
async function vcGetValues(sheetName) {
  const cached = vcSheetCache.get(sheetName);
  if (cached && cached.data && Date.now() < cached.expiresAt) {
    return cached.data;
  }
  if (cached && cached.loading) return cached.loading;

  const generationAtStart = vcSheetGeneration;

  const loading = getVcSheetsApi().then(sheets => sheets.spreadsheets.values.get({
    spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
    range: quoteSheetName(sheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  })).then(res => {
    const values = res.data.values || [];
    // Chi cache neu KHONG co lan ghi nao xay ra trong luc dang doc (generation
    // khong doi) — tranh "hoi sinh" du lieu cu vao cache sau khi 1 request ghi
    // khac da invalidate trong luc read nay con dang bay. Neu generation da
    // doi, van tra ve `values` dung cho CALLER cua chinh lan doc nay (du lieu
    // vua doc tu Google, khong sai), chi khong luu vao cache.
    if (vcSheetGeneration === generationAtStart) {
      vcSheetCache.set(sheetName, { data: values, expiresAt: Date.now() + VC_SHEET_CACHE_TTL_MS, loading: null });
    }
    return values;
  }).catch(err => {
    // Tuong tu: chi xoa cache neu generation khong doi — tranh xoa nham 1
    // cache entry MOI HON (da duoc mot lan doc khac set sau khi request nay
    // bi vuot mat va that bai).
    if (vcSheetGeneration === generationAtStart) {
      vcSheetCache.delete(sheetName); // khong cache loi — lan sau thu lai ngay
    }
    throw err;
  });

  // Dang ky placeholder NGAY LAP TUC — dong bo, TRUOC ca getVcSheetsApi() —
  // de cac request trung sheet goi trong cung tick dedupe dung vao 1 lan goi
  // API duy nhat thay vi moi request tu goi rieng (vi vcGetValues la async
  // function nhung toan bo code phia tren khong co `await` nao, ham chay het
  // dong bo toi day truoc khi tra quyen dieu khien).
  vcSheetCache.set(sheetName, { data: cached ? cached.data : null, expiresAt: 0, loading });
  return loading;
}

/**
 * Doc nhieu tab trong 1 lan goi API.
 * Tab khong ton tai se tra ve mang rong thay vi lam loi ca request.
 * @param {string[]} sheetNames
 * @returns {Promise<Object<string, any[][]>>}
 */
async function vcGetMultipleSheetValues(sheetNames) {
  const sheets = await getVcSheetsApi();
  const result = {};
  sheetNames.forEach(name => { result[name] = []; });

  const existingTitles = new Set(await vcListSheetTitles());
  const namesToFetch = sheetNames.filter(name => existingTitles.has(name));
  if (namesToFetch.length === 0) return result;

  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
    ranges: namesToFetch.map(quoteSheetName),
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });

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

/**
 * Append 1 dong moi vao cuoi tab (sau dong du lieu cuoi cung).
 * Google Sheets Append API tu dong tim hang trong tiep theo sau du lieu.
 * @param {string} sheetName
 * @param {any[]} row  Mang gia tri theo dung thu tu cot header
 * @returns {Promise<void>}
 */
async function vcAppendRow(sheetName, row) {
  const sheets = await getVcSheetsApi();
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
      range: quoteSheetName(sheetName),
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });
  } finally {
    // Invalidate du thanh cong hay that bai: 1 loi (vd timeout) khong dam bao
    // ghi KHONG lam — co the da len sheet that o phia Google roi moi bao loi
    // ve client. Bo qua invalidate khi that bai se de lai du lieu cu trong
    // cache toi 12s du sheet that co the da thay doi.
    invalidateVcSheetCache(sheetName);
  }
}

/**
 * Cap nhat 1 dong theo chi so (1-based, row 1 = header).
 * Thuong dung de cap nhat trang thai don hang.
 * @param {string} sheetName
 * @param {number} rowIndex  Vi tri dong (1 = header, 2 = dong du lieu dau tien)
 * @param {any[]} row        Mang gia tri thay the toan bo dong
 * @returns {Promise<void>}
 */
async function vcUpdateRow(sheetName, rowIndex, row) {
  const sheets = await getVcSheetsApi();
  const lastColLetter = columnIndexToLetter(row.length);
  const range = `${quoteSheetName(sheetName)}!A${rowIndex}:${lastColLetter}${rowIndex}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });
  } finally {
    // Xem giai thich trong vcAppendRow: invalidate du thanh cong hay that bai.
    invalidateVcSheetCache(sheetName);
  }
}

/**
 * Thuc hien nhieu thao tac ghi trong 1 lan goi API (batch).
 * @param {Object[]} requests  Mang request theo dang Google Sheets batchUpdate
 * @returns {Promise<void>}
 */
async function vcBatchUpdate(requests) {
  const sheets = await getVcSheetsApi();
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: CONFIG.VC_SPREADSHEET_ID,
      requestBody: { requests }
    });
  } finally {
    // Du thanh cong hay that bai deu bump generation + xoa toan bo cache: batchUpdate
    // co the dung nhieu sheet khac nhau (khong biet truoc sheet nao), va 1 loi (vd
    // timeout) khong dam bao request chua toi Google — an toan hon la coi nhu co the
    // da ghi mot phan.
    vcSheetGeneration++;
    vcSheetCache.clear();
  }
}

// ---- Utility ----------------------------------------------------------------

/**
 * Chuyen chi so cot (1-based) thanh ky hieu chu cai (A, B, ..., Z, AA, AB...)
 * @param {number} colIndex  Chi so 1-based
 * @returns {string}
 */
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
  vcGetValues,
  vcGetMultipleSheetValues,
  vcAppendRow,
  vcUpdateRow,
  vcBatchUpdate,
  vcListSheetTitles,
  vcInvalidateSheetTitlesCache,
  invalidateVcSheetCache
};
