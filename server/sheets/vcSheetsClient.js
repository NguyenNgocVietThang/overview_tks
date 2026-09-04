// ==========================================
// VC SHEETS CLIENT — doc/ghi Spreadsheet van chuyen rieng (VC_*)
//
// Khac voi sheetsClient.js (chi doc sheet KiotViet), client nay:
//   - Dung VC_SPREADSHEET_ID (spreadsheet van chuyen doc lap)
//   - Scope "spreadsheets" (doc + GHI) vi Phase 1B can append/update dong
//   - Export cac ham tien ich: vcGetValues, vcAppendRow, vcUpdateRow,
//     vcBatchUpdate, vcGetMultipleSheetValues
//
// DA CO SO: moi co so co spreadsheet van chuyen RIENG (VC_SPREADSHEET_ID =
// Ha Noi, VC_SPREADSHEET_ID_SG = Sai Gon). Toan bo state (cache tab, cache
// sheetId, cache du lieu, bo dem generation) nam trong closure cua tung
// client — hai co so khong bao gio dung chung cache.
// ==========================================
const { google } = require('googleapis');
const CONFIG = require('../config');
const { BRANCHES } = require('../branch/branches');

// Gioi han tren cho moi lan goi Google Sheets API — tranh request Express bi
// treo vo thoi han neu Google API cham/khong phan hoi.
const VC_API_TIMEOUT_MS = 15000; // 15s

// ---- Singleton xác thực (phạm vi đọc + ghi) --------------------------------
// Dùng CHUNG cho mọi cơ sở — cùng service account ghi cả hai spreadsheet.

let vcSheetsApiPromise = null;

function getVcSheetsApi() {
  if (!vcSheetsApiPromise) {
    const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      // Scope đầy đủ để đọc và GHI (append/update/batchUpdate)
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    vcSheetsApiPromise = auth.getClient().then(authClient =>
      google.sheets({ version: 'v4', auth: authClient })
    );
  }
  return vcSheetsApiPromise;
}

// ---- Tiện ích ----------------------------------------------------------------

function quoteSheetName(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

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

function branchNotConfigured(branchLabel, envHint) {
  const err = new Error(`Cơ sở ${branchLabel} chưa được cấu hình nguồn dữ liệu vận chuyển.`);
  err.code = 'BRANCH_NOT_CONFIGURED';
  err.statusCode = 503;
  err.detail = `[vcSheetsClient] ${envHint} chua duoc dat trong .env`;
  return err;
}

const VC_SHEET_TITLES_CACHE_TTL_MS = 5 * 60 * 1000;
const VC_SHEET_IDS_CACHE_TTL_MS = 5 * 60 * 1000;
// Cache ngan han cho du lieu tho tung tab VC — van don can do tuoi cao hon
// dashboard (nhieu tai xe/dieu phoi vien poll 25-30s cung luc), nen TTL ngan
// hon nhieu so voi dashboardData.js (90s). Invalidate CHU DONG ngay sau moi
// lan ghi vao dung sheet do de tranh doc du lieu cu ngay sau khi user vua sua.
const VC_SHEET_CACHE_TTL_MS = 12 * 1000; // 12s — ngan hon POLL_MS=25-30s cua client de van bat kip 1 vong poll

/**
 * Tao client van chuyen gan voi spreadsheet cua 1 co so.
 * @param {() => (string|null)} getSpreadsheetId doc CONFIG tai thoi diem GOI.
 * @param {string} branchLabel ten co so, dung trong thong bao loi.
 * @param {string} envHint ten bien moi truong tuong ung, dung trong log.
 */
function createVcClient(getSpreadsheetId, branchLabel, envHint) {
  function requireSpreadsheetId() {
    const id = getSpreadsheetId();
    if (!id) throw branchNotConfigured(branchLabel, envHint);
    return id;
  }

  // ---- Cache danh sach tab (tuong tu sheetsClient.js) -------------------------

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

    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getVcSheetsApi();
    const loading = sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties.title'
    }, { timeout: VC_API_TIMEOUT_MS })
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

  // ---- Cache sheetId SO theo ten tab -----------------------------------------
  //
  // KHAC vcListSheetTitles: cac API ghi theo dang `spreadsheets.batchUpdate`
  // (updateCells, deleteDimension...) KHONG nhan ten tab ma nhan `sheetId` SO
  // (0-based grid id, on dinh suot doi cua tab, khong doi khi doi ten tab).
  // A1 notation (`spreadsheets.values.*`) thi nguoc lai chi nhan ten tab.
  //
  // 1 lan goi spreadsheets.get lay duoc sheetId cua TAT CA tab, nen cache ca map
  // title -> sheetId (khong cache rieng tung ten). TTL 5 phut giong cache ten tab:
  // sheetId cua 1 tab la vinh vien, nhung anh xa TEN -> sheetId co the doi neu ai
  // do doi ten tab tren Google Sheet, nen khong cache vinh vien.
  let vcSheetIdsCache = { data: null, expiresAt: 0, loading: null };

  /**
   * Goi Google API lay map title -> sheetId cho toan bo spreadsheet.
   * Dedupe: neu da co 1 lan fetch dang bay thi dung chung, khong goi API lan 2.
   * @returns {Promise<Map<string, number>>}
   */
  function fetchVcSheetIds() {
    if (vcSheetIdsCache.loading) return vcSheetIdsCache.loading;

    // Giu tham chieu toi object cache tai thoi diem bat dau fetch. vcInvalidate-
    // SheetTitlesCache() THAY THE ca object (khong sua tai cho), nen so sanh
    // identity la du de phat hien "fetch nay da bi mot lan invalidate vuot mat"
    // => khong duoc phep ghi ket qua (co the da cu) vao cache MOI. Cung ho tro
    // (khong "hoi sinh" du lieu cu) nhu generation-guard cua vcGetValues.
    const cacheAtStart = vcSheetIdsCache;

    const loading = Promise.resolve()
      .then(() => {
        const spreadsheetId = requireSpreadsheetId();
        return getVcSheetsApi().then(sheets => sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties(sheetId,title)'
        }, { timeout: VC_API_TIMEOUT_MS }));
      })
      .then(res => {
        const map = new Map();
        (res.data.sheets || []).forEach(s => {
          const props = s && s.properties;
          // sheetId cua tab dau tien thuong la 0 => phai check typeof, khong dung truthy
          if (props && typeof props.sheetId === 'number' && props.title != null) {
            map.set(props.title, props.sheetId);
          }
        });
        if (vcSheetIdsCache === cacheAtStart) {
          vcSheetIdsCache.data = map;
          vcSheetIdsCache.expiresAt = Date.now() + VC_SHEET_IDS_CACHE_TTL_MS;
        }
        // Van tra ve `map` cho caller cua chinh lan fetch nay (du lieu vua doc
        // tu Google, khong sai) — chi khong luu vao cache khi da bi vuot mat.
        return map;
      })
      .finally(() => {
        // Chi go loading neu van la promise cua chinh lan fetch nay (tranh go
        // nham 1 lan fetch moi hon da duoc dang ky sau do).
        if (vcSheetIdsCache.loading === loading) vcSheetIdsCache.loading = null;
      });

    vcSheetIdsCache.loading = loading;
    return loading;
  }

  /**
   * Lay sheetId SO cua 1 tab theo ten (dung cho spreadsheets.batchUpdate).
   * @param {string} sheetName
   * @returns {Promise<number>}
   * @throws neu khong tim thay tab (sau khi da thu doc lai truc tiep tu Google)
   */
  async function vcGetSheetId(sheetName) {
    let map;
    let fromCache = false;

    if (vcSheetIdsCache.data && Date.now() < vcSheetIdsCache.expiresAt) {
      map = vcSheetIdsCache.data;
      fromCache = true;
    } else if (vcSheetIdsCache.loading) {
      map = await vcSheetIdsCache.loading;
    } else {
      map = await fetchVcSheetIds();
    }

    if (map.has(sheetName)) return map.get(sheetName);

    // Miss tren du lieu CACHE co the chi la do tab vua duoc tao/doi ten sau lan
    // fetch truoc => thu doc lai 1 lan truc tiep tu Google truoc khi bao loi.
    // Neu map vua doc la du lieu TUOI (khong phai cache) thi khong fetch lai —
    // tranh goi API lien tuc khi ai do goi voi ten tab khong ton tai.
    if (fromCache) {
      const fresh = await fetchVcSheetIds();
      if (fresh.has(sheetName)) return fresh.get(sheetName);
    }

    throw new Error(`[vcSheetsClient] Khong tim thay sheetId cho tab "${sheetName}"`);
  }

  /** Invalidate cache sau khi tao/doi tab moi (ca danh sach ten tab lan map sheetId) */
  function vcInvalidateSheetTitlesCache() {
    vcSheetTitlesCache = { data: null, expiresAt: 0, loading: null };
    vcSheetIdsCache = { data: null, expiresAt: 0, loading: null };
  }

  // ---- Cache ngan han theo tab (rieng biet voi cache danh sach tab o tren) ----

  const vcSheetCache = new Map(); // sheetName -> { data, expiresAt, loading }

  // Bo dem generation THEO TUNG SHEET (Map<sheetName, number>) — bump generation
  // CUA DUNG SHEET DO moi khi invalidateVcSheetCache(sheetName) chay. Muc dich:
  // chan mot read dang bay (bat dau TRUOC 1 lan ghi vao CUNG sheet) "hoi sinh"
  // du lieu cu vao cache SAU KHI lan ghi do da invalidate xong. Neu khong co
  // counter nay, .then() cua read cu se ghi de len cache bang snapshot tu-truoc-
  // khi-ghi, va vi cac ham doc-sua-ghi (transitionOrderStatus, updateOrderMeta...)
  // doc nguyen dong tu cache roi ghi ca dong tro lai, 1 cache entry "hoi sinh"
  // co the bi GHI NGUOC vao sheet that — khong chi hien thi cu ma con lam mat
  // du lieu.
  //
  // QUAN TRONG — vi sao PER-SHEET (Map) chu KHONG phai 1 counter TOAN CUC:
  // Ban dau dung 1 `let` toan cuc, bump o MOI lan invalidate bat ke sheet nao.
  // Bug da phat hien: invalidateVcSheetCache(sheetName) chi xoa entry cua DUNG
  // sheet do trong vcSheetCache, nhung neu dung 1 counter toan cuc thi 1 lan
  // ghi vao sheet Y se bump generation dung cho CA sheet X (khong lien quan).
  // Read X dang bay se thay "generation da doi" (do Y gay ra) va dung khong
  // set() lai cache — dung — NHUNG entry cua X (placeholder {loading} da dang
  // ky truoc do) khong bi xoa boi lan ghi vao Y (invalidate chi xoa key Y).
  // Placeholder cu cua X bi "mac ket" vinh vien trong map: moi lan vcGetValues(X)
  // sau do deu roi vao nhanh `if (cached && cached.loading) return cached.loading`
  // va tra ve DUNG cai promise-da-settled-tu-lau do — MAI MAI, cho toi khi co ai
  // do ghi TRUC TIEP vao X hoac vcBatchUpdate() chay. Tuc la 1 lan ghi vao sheet
  // KHAC co the lam "dong bang" cache cua sheet nay vo thoi han — te hon ca bug
  // ban dau (bug ban dau chi ton tai toi da 12s).
  //
  // Dung Map PER-SHEET giu dung bat bien: "generation cua sheet S doi tuc la
  // entry cua DUNG sheet S da bi/roi se bi xoa" — vi ca 2 hanh dong (bump +
  // delete) chay dong bo trong CUNG 1 ham invalidateVcSheetCache(sheetName) cho
  // CUNG 1 sheetName, khong bao gio lech nhau. Sheet khac hoan toan khong bi
  // anh huong. Cai gia duy nhat: 1 read dang bay cho DUNG sheet vua bi ghi se
  // bo qua 1 lan cache-populate (dung nhu thiet ke ban dau) — chu KHONG con lam
  // "dong bang" cache cua sheet khac.
  const vcSheetGeneration = new Map(); // sheetName -> generation counter

  function getVcSheetGeneration(sheetName) {
    return vcSheetGeneration.get(sheetName) || 0;
  }

  function invalidateVcSheetCache(sheetName) {
    vcSheetGeneration.set(sheetName, getVcSheetGeneration(sheetName) + 1);
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

    const spreadsheetId = requireSpreadsheetId();
    const generationAtStart = getVcSheetGeneration(sheetName);

    const loading = getVcSheetsApi().then(sheets => sheets.spreadsheets.values.get({
      spreadsheetId,
      range: quoteSheetName(sheetName),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, { timeout: VC_API_TIMEOUT_MS })).then(res => {
      const values = res.data.values || [];
      // Chi cache neu KHONG co lan ghi nao vao DUNG sheet nay xay ra trong luc
      // dang doc (generation cua sheet nay khong doi) — tranh "hoi sinh" du lieu
      // cu vao cache sau khi 1 request ghi khac da invalidate trong luc read
      // nay con dang bay. Neu generation da doi, van tra ve `values` dung cho
      // CALLER cua chinh lan doc nay (du lieu vua doc tu Google, khong sai), chi
      // khong luu vao cache (entry cua sheet nay da bi invalidateVcSheetCache()
      // xoa dong bo cung luc bump generation, nen khong con gi de "don dep" o day).
      if (getVcSheetGeneration(sheetName) === generationAtStart) {
        vcSheetCache.set(sheetName, { data: values, expiresAt: Date.now() + VC_SHEET_CACHE_TTL_MS, loading: null });
      }
      return values;
    }).catch(err => {
      // Tuong tu: chi xoa cache neu generation khong doi — tranh xoa nham 1
      // cache entry MOI HON (da duoc mot lan doc khac set sau khi request nay
      // bi vuot mat va that bai).
      if (getVcSheetGeneration(sheetName) === generationAtStart) {
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getVcSheetsApi();
    const result = {};
    sheetNames.forEach(name => { result[name] = []; });

    const existingTitles = new Set(await vcListSheetTitles());
    const namesToFetch = sheetNames.filter(name => existingTitles.has(name));
    if (namesToFetch.length === 0) return result;

    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: namesToFetch.map(quoteSheetName),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }, { timeout: VC_API_TIMEOUT_MS });

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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getVcSheetsApi();
    try {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: quoteSheetName(sheetName),
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] }
      }, { timeout: VC_API_TIMEOUT_MS });
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getVcSheetsApi();
    const lastColLetter = columnIndexToLetter(row.length);
    const range = `${quoteSheetName(sheetName)}!A${rowIndex}:${lastColLetter}${rowIndex}`;
    try {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] }
      }, { timeout: VC_API_TIMEOUT_MS });
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
    const spreadsheetId = requireSpreadsheetId();
    const sheets = await getVcSheetsApi();
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      }, { timeout: VC_API_TIMEOUT_MS });
    } finally {
      // Du thanh cong hay that bai deu bump generation + xoa toan bo cache: batchUpdate
      // co the dung nhieu sheet khac nhau (khong biet truoc sheet nao), va 1 loi (vd
      // timeout) khong dam bao request chua toi Google — an toan hon la coi nhu co the
      // da ghi mot phan.
      //
      // Bump generation cho MOI sheet dang co entry trong cache (ca da-cache va dang
      // loading) TRUOC KHI clear() — vi blast radius cua batchUpdate khong biet truoc
      // (co the dung bat ky sheet nao trong requests), day la CACH DUY NHAT de dam bao
      // bat ky read dang bay nao (cho bat ky sheet nao dang co entry) cung bi phat hien
      // "vuot mat" khi no resolve xong va khong duoc phep set() lai cache — giu dung bat
      // bien "generation cua sheet S doi tuc la entry cua S da/roi se bi xoa" cho CA
      // truong hop batchUpdate, khong chi vcAppendRow/vcUpdateRow don-sheet.
      for (const trackedSheetName of vcSheetCache.keys()) {
        vcSheetGeneration.set(trackedSheetName, getVcSheetGeneration(trackedSheetName) + 1);
      }
      vcSheetCache.clear();
    }
  }

  return {
    vcGetValues,
    vcGetMultipleSheetValues,
    vcAppendRow,
    vcUpdateRow,
    vcBatchUpdate,
    vcListSheetTitles,
    vcGetSheetId,
    vcInvalidateSheetTitlesCache,
    invalidateVcSheetCache
  };
}

const hanoiVcClient = createVcClient(() => CONFIG.VC_SPREADSHEET_ID, BRANCHES.HANOI, 'VC_SPREADSHEET_ID');
const saigonVcClient = createVcClient(() => CONFIG.VC_SPREADSHEET_ID_SG, BRANCHES.SAIGON, 'VC_SPREADSHEET_ID_SG');

/**
 * Client van chuyen cua 1 co so. Mac dinh (branch khong xac dinh) = Ha Noi.
 * Ha Noi tra ve CHINH module.exports de test dang monkey-patch tung ham van
 * chan duoc loi goi (giong sheetsClient.getSheetsClient).
 */
function getVcClient(branch) {
  return branch === BRANCHES.SAIGON ? saigonVcClient : module.exports;
}

module.exports = {
  vcGetValues: (...args) => hanoiVcClient.vcGetValues(...args),
  vcGetMultipleSheetValues: (...args) => hanoiVcClient.vcGetMultipleSheetValues(...args),
  vcAppendRow: (...args) => hanoiVcClient.vcAppendRow(...args),
  vcUpdateRow: (...args) => hanoiVcClient.vcUpdateRow(...args),
  vcBatchUpdate: (...args) => hanoiVcClient.vcBatchUpdate(...args),
  vcListSheetTitles: (...args) => hanoiVcClient.vcListSheetTitles(...args),
  vcGetSheetId: (...args) => hanoiVcClient.vcGetSheetId(...args),
  vcInvalidateSheetTitlesCache: (...args) => hanoiVcClient.vcInvalidateSheetTitlesCache(...args),
  invalidateVcSheetCache: (...args) => hanoiVcClient.invalidateVcSheetCache(...args),
  getVcClient
};
