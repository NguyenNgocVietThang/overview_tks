'use strict';

// Du lieu nguon Nhap VAT: 2 Google Sheet CONG KHAI ("Gộp VAT", "Khớp mã") doc qua URL
// export CSV — dung duong doc cua vat-draft-app (requests + pandas.read_csv), khong
// dung service account. Parse theo CHU CAI cot (vatDraftConfig) va mo phong cach pandas
// doc o trong / "#N/A" (NaN -> chuoi 'nan' o cot chu, None o cot so) de ket qua khop app cu.

const { parseCsv } = require('./csv');
const { normalizeCode, normalizeCodeForMatch, toFloatOrNone } = require('./normalization');
const { createTtlSnapshotCache } = require('../lib/ttlSnapshotCache');
const vatDraftConfig = require('./vatDraftConfig');

const EXPORT_URL = 'https://docs.google.com/spreadsheets/d/{sheetId}/export?format=csv&gid={gid}';
const FETCH_TIMEOUT_MS = 15000;

// Chuoi pandas mac dinh coi la NA (khop nguyen van, khong strip).
const PANDAS_NA = new Set([
  '', '#N/A', '#N/A N/A', '#NA', '-1.#IND', '-1.#QNAN', '-NaN', '-nan', '1.#IND', '1.#QNAN',
  '<NA>', 'N/A', 'NA', 'NULL', 'NaN', 'None', 'n/a', 'nan', 'null'
]);
const PANDAS_INT_RE = /^[ \t]*[+-]?\d+[ \t]*$/;
const PANDAS_FLOAT_RE = /^[ \t]*[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?[ \t]*$/;
const INT64_MAX = 9223372036854775807n;

function columnLetterToIndex(letter) {
  const text = String(letter).trim().toUpperCase();
  if (!/^[A-Z]+$/.test(text)) throw new Error(`Tên cột Excel không hợp lệ: '${letter}'`);
  let index = 0;
  for (const ch of text) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Mo phong pd.read_csv(header=None, skiprows=N): bo N dong dau, dem cot theo dong dau
 * con lai, o NA -> NaN, suy kieu tung cot (toan so nguyen -> chuoi so chuan nhu str(int);
 * co NA/so thuc -> Number; con lai giu nguyen chuoi).
 */
function toPandasFrame(records, skipRows) {
  const rows = records.slice(skipRows);
  const width = rows.length ? rows[0].length : 0;
  const cells = rows.map(row => {
    if (row.length > width) {
      const error = new Error(`Dòng có ${row.length} cột, nhiều hơn ${width} cột của dòng đầu.`);
      error.code = 'CSV_WIDTH';
      throw error;
    }
    return Array.from({ length: width }, (_, i) => {
      const raw = i < row.length ? row[i] : '';
      return PANDAS_NA.has(raw) ? NaN : raw;
    });
  });

  for (let col = 0; col < width; col += 1) {
    const values = cells.map(row => row[col]);
    const present = values.filter(value => typeof value === 'string');
    const hasNa = present.length !== values.length;
    const allInt = present.every(value => PANDAS_INT_RE.test(value) && BigInt(value.trim()) <= INT64_MAX && BigInt(value.trim()) >= -INT64_MAX - 1n);
    if (present.length && allInt && !hasNa) {
      cells.forEach(row => { row[col] = BigInt(row[col].trim()).toString(); });
    } else if (present.length && (allInt || present.every(value => PANDAS_FLOAT_RE.test(value)))) {
      cells.forEach(row => { if (typeof row[col] === 'string') row[col] = Number(row[col].trim()); });
    }
  }
  return { width, rows: cells };
}

function buildColMap(frame, letters) {
  const colMap = {};
  const missing = [];
  for (const [canonical, letter] of Object.entries(letters)) {
    const idx = columnLetterToIndex(letter);
    if (idx < frame.width) colMap[canonical] = idx;
    else missing.push(`${canonical} (cột ${String(letter).trim().toUpperCase()})`);
  }
  return { colMap, missing };
}

const isNa = value => typeof value === 'number' && Number.isNaN(value);

/** _parse_gop_vat -> { stockRows, errors, warnings, summary }. */
function parseGopVat(frame, letters = vatDraftConfig.gopVatColumns) {
  const { colMap, missing } = buildColMap(frame, letters);
  const summary = { sheetName: 'Gộp VAT', totalDataRows: 0, blankMaVatCount: 0, invalidTonCount: 0, zeroOrNegativeTonCount: 0 };
  if (missing.length) {
    return { stockRows: [], summary, warnings: [], errors: [`Sheet 'Gộp VAT' thiếu cột (ngoài phạm vi sheet): ${missing.join(', ')}`] };
  }
  const stockRows = [];
  const warnings = [];
  frame.rows.forEach((row, position) => {
    const rowIdx = position + 2;
    if (row.every(isNa)) return; // bo dong trong hoan toan
    const gcol = canonical => (colMap[canonical] !== undefined ? row[colMap[canonical]] : null);
    summary.totalDataRows += 1;

    const maVatKiot = normalizeCode(gcol('MÃ VAT KIOT'));
    const tenKeToan = normalizeCode(gcol('TÊN KẾ TOÁN'));
    const donViTinh = normalizeCode(gcol('Đơn vị tính'));
    if (!maVatKiot) summary.blankMaVatCount += 1;

    const tonRaw = gcol('TỒN CÓ THỂ NHÁP');
    const ton = toFloatOrNone(tonRaw);
    // Nhu Python: o trong / #N/A (NaN, str -> 'nan') hoac chu -> dong khong hop le, bo qua.
    if (tonRaw !== null && (isNa(tonRaw) || String(tonRaw).trim() !== '') && ton === null) {
      summary.invalidTonCount += 1;
      warnings.push({
        rowIndex: rowIdx,
        warningType: 'ton_khong_hop_le',
        detail: `Dòng ${rowIdx}: TỒN CÓ THỂ NHÁP='${isNa(tonRaw) ? 'nan' : tonRaw}' không chuyển được thành số.`
      });
      return;
    }
    const tonFinal = ton !== null ? ton : 0.0;
    if (tonFinal <= 0) summary.zeroOrNegativeTonCount += 1;

    stockRows.push({
      rowIndex: rowIdx,
      nguon: normalizeCode(gcol('NGUỒN')),
      maKiotDaiDien: normalizeCode(gcol('Mã kiot đại diện')),
      tenKiotDaiDien: normalizeCode(gcol('Tên kiot đại diện')),
      maVatKiot,
      tenVatKiot: normalizeCode(gcol('TÊN VAT KIOT')),
      tenKeToan,
      donViTinh,
      tonDauNgay: toFloatOrNone(gcol('TỒN ĐẦU NGÀY')),
      giaBan: toFloatOrNone(gcol('GIÁ BÁN')),
      thueVat: toFloatOrNone(gcol('THUẾ VAT')),
      thueNk: toFloatOrNone(gcol('THUẾ NK')),
      tongThueMat: toFloatOrNone(gcol('TỔNG THUẾ MẤT')),
      tongDangNhap: toFloatOrNone(gcol('TỔNG ĐANG NHÁP')) || 0.0,
      tonCoTheNhap: tonFinal,
      maVatKiotNorm: normalizeCodeForMatch(maVatKiot),
      tenKeToanNorm: normalizeCodeForMatch(tenKeToan),
      donViTinhNorm: normalizeCodeForMatch(donViTinh)
    });
  });
  return { stockRows, summary, warnings, errors: [] };
}

/** _parse_khop_ma -> { mappingRows, errors, summary }. */
function parseKhopMa(frame, letters = vatDraftConfig.khopMaColumns) {
  const { colMap, missing } = buildColMap(frame, letters);
  const summary = { sheetName: 'Khớp mã', totalDataRows: 0, blankMaCount: 0, blankMaVatCount: 0, duplicateMaSpMultiVatCount: 0 };
  if (missing.length) {
    return { mappingRows: [], summary, errors: [`Sheet 'Khớp mã' thiếu cột (ngoài phạm vi sheet): ${missing.join(', ')}`] };
  }
  const mappingRows = [];
  frame.rows.forEach((row, position) => {
    const rowIdx = position + 2;
    if (row.every(isNa)) return;
    const gcol = canonical => (colMap[canonical] !== undefined ? row[colMap[canonical]] : null);
    summary.totalDataRows += 1;
    const maSp = normalizeCode(gcol('Mã SP'));
    const maVatKiot = normalizeCode(gcol('Mã vat kiot'));
    if (!maSp) summary.blankMaCount += 1;
    if (!maVatKiot) summary.blankMaVatCount += 1;
    mappingRows.push({
      rowIndex: rowIdx,
      maSp,
      tenSp: normalizeCode(gcol('Tên SP')),
      maVatKiot,
      tenTruocVat: normalizeCode(gcol('Tên trước (Giá đầu  - Giá cuối) (VAT)')),
      maSpNorm: normalizeCodeForMatch(maSp),
      maVatKiotNorm: normalizeCodeForMatch(maVatKiot)
    });
  });
  const vatByMaSp = new Map();
  for (const m of mappingRows) {
    if (!m.maSpNorm) continue;
    if (!vatByMaSp.has(m.maSpNorm)) vatByMaSp.set(m.maSpNorm, new Set());
    vatByMaSp.get(m.maSpNorm).add(m.maVatKiotNorm);
  }
  summary.duplicateMaSpMultiVatCount = [...vatByMaSp.values()].filter(set => set.size > 1).length;
  return { mappingRows, summary, errors: [] };
}

function sheetError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 503;
  return error;
}

/** Tai CSV 1 sheet; sheet het chia se cong khai thi Google tra HTML dang nhap -> bao loi ro. */
async function fetchSheetCsv({ gid, sheetName, sheetId = vatDraftConfig.sheetId, fetchImpl = globalThis.fetch }) {
  const url = EXPORT_URL.replace('{sheetId}', sheetId).replace('{gid}', String(gid));
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
  } catch (error) {
    if (error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw sheetError(`Tải sheet '${sheetName}' quá ${FETCH_TIMEOUT_MS / 1000} giây. Kiểm tra mạng rồi thử lại.`, 'SHEET_TIMEOUT');
    }
    throw sheetError(`Lỗi mạng khi tải sheet '${sheetName}': ${error.message}`, 'SHEET_NETWORK');
  }
  if (!response.ok) {
    throw sheetError(`Google Sheets trả lỗi ${response.status} khi tải sheet '${sheetName}'.`, 'SHEET_HTTP');
  }
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/csv')) {
    throw sheetError(`Sheet '${sheetName}' không còn chia sẻ công khai (Google không trả về CSV).`, 'SHEET_NOT_PUBLIC');
  }
  return response.text();
}

/** Parse 2 CSV -> { stockRows, mappingRows, errors, warnings, summaries }. */
function parseMasterData(gopVatCsv, khopMaCsv, config = vatDraftConfig) {
  const gopVat = parseGopVat(toPandasFrame(parseCsv(gopVatCsv), config.gopVatSkipRows), config.gopVatColumns);
  const khopMa = parseKhopMa(toPandasFrame(parseCsv(khopMaCsv), config.khopMaSkipRows), config.khopMaColumns);
  return {
    stockRows: gopVat.stockRows,
    mappingRows: khopMa.mappingRows,
    errors: [...gopVat.errors, ...khopMa.errors],
    warnings: gopVat.warnings,
    summaries: { gopVat: gopVat.summary, khopMa: khopMa.summary }
  };
}

/**
 * Nguon master data co cache: tuoi 10 phut, nut "Cập nhật" ep tai lai; Sheets loi tam
 * thoi thi tra ban cu (stale, toi da 6 gio) thay vi lam hong ca trang.
 */
function createMasterDataSource({ fetchImpl = globalThis.fetch, config = vatDraftConfig, now } = {}) {
  const cache = createTtlSnapshotCache({
    freshTtlMs: 10 * 60 * 1000,
    staleTtlMs: 6 * 60 * 60 * 1000,
    ...(now ? { now } : {}),
    fetch: async () => {
      const [gopVatCsv, khopMaCsv] = await Promise.all([
        fetchSheetCsv({ gid: config.gidGopVat, sheetName: 'Gộp VAT', sheetId: config.sheetId, fetchImpl }),
        fetchSheetCsv({ gid: config.gidKhopMa, sheetName: 'Khớp mã', sheetId: config.sheetId, fetchImpl })
      ]);
      const data = parseMasterData(gopVatCsv, khopMaCsv, config);
      if (data.errors.length) throw sheetError(data.errors.join(' '), 'SHEET_COLUMNS');
      return data;
    }
  });
  return {
    get: options => cache.get(options),
    refresh: () => cache.get({ forceRefresh: true }),
    set: data => cache.set(data),
    clear: () => cache.clear()
  };
}

module.exports = {
  PANDAS_NA,
  columnLetterToIndex,
  toPandasFrame,
  parseGopVat,
  parseKhopMa,
  parseMasterData,
  fetchSheetCsv,
  createMasterDataSource
};
