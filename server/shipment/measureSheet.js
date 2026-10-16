'use strict';

// ==========================================
// MEASURE SHEET — doc sheet "CAN DO" (kich thuoc + can nang thung) tu Google Sheets, CHI DOC.
// Dung de tinh the tich (m3) / can nang (kg) cua dong hang trong hop chi tiet Vong doi don.
//   m3 moi cai = (Dai x Rong x Cao / 1.000.000) / SL-moi-thung ; kg moi cai = kg-thung / SL-moi-thung.
// Chi doc cac cot goc (SL/T, Can nang, D, R, C), tu tinh bang JS, khong doc cot cong thuc.
// Ma trung: lay hang DAU (giong XLOOKUP cua sheet "Hoa"), khong phan biet hoa/thuong.
// "Thoi gian thuc" = doc lai khi mo hop; cache ngan + gop request dang chay de khong cham quota Sheets.
// ==========================================

const CONFIG = require('../config');
const { createReadOnlyClient } = require('../sheets/sheetsClient');

const HEADERS = Object.freeze({ code: 'MÃ SP', perCarton: 'SL/T', cartonKg: 'Cân nặng', length: 'D', width: 'R', height: 'C' });
const DEFAULT_TTL_MS = 30 * 1000;

function sourceError(code, message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  return error;
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('vi');
}

function codeKey(code) {
  return String(code ?? '').trim().toLowerCase();
}

function toPositive(value) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Rows -> Map<codeKey, { perCarton, m3PerUnit, kgPerUnit, missingVolume, missingWeight }>; unavailable measurements are null. */
function parseMeasureRows(values) {
  const fields = Object.entries(HEADERS);
  let indexes;
  const headerRow = values.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    const found = fields.map(([, title]) => normalized.indexOf(normalizeHeader(title)));
    if (found.some(index => index < 0)) return false;
    indexes = found;
    return true;
  });
  if (headerRow < 0) {
    throw sourceError('MEASURE_HEADERS_MISSING', `Sheet CÂN ĐO không có hàng tiêu đề đủ các cột: ${fields.map(([, title]) => title).join(', ')}.`);
  }
  const [iCode, iPer, iKg, iL, iW, iH] = indexes;
  const table = new Map();
  for (const row of values.slice(headerRow + 1)) {
    const key = codeKey(row[iCode]);
    if (!key || table.has(key)) continue;
    const perCarton = toPositive(row[iPer]);
    const kg = toPositive(row[iKg]);
    const l = toPositive(row[iL]);
    const w = toPositive(row[iW]);
    const h = toPositive(row[iH]);
    const m3PerUnit = perCarton && l && w && h ? (l * w * h / 1000000) / perCarton : null;
    const kgPerUnit = perCarton && kg ? kg / perCarton : null;
    table.set(key, { perCarton, m3PerUnit, kgPerUnit, missingVolume: m3PerUnit === null, missingWeight: kgPerUnit === null });
  }
  return table;
}

function createMeasureSheet({
  getSpreadsheetId = () => CONFIG.SHIPPING_MEASURE_SPREADSHEET_ID,
  sheetName = CONFIG.SHIPPING_MEASURE_SHEET,
  client = createReadOnlyClient(getSpreadsheetId, 'Cân đo'),
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS
} = {}) {
  let cache = null; // { table, at }
  let inflight = null;

  async function load() {
    if (!getSpreadsheetId()) throw sourceError('MEASURE_NOT_CONFIGURED', 'Chưa cấu hình nguồn dữ liệu CÂN ĐO.');
    try {
      const titles = await client.listSheetTitles();
      const actual = titles.find(title => title === sheetName) ||
        titles.find(title => normalizeHeader(title) === normalizeHeader(sheetName));
      if (!actual) throw sourceError('MEASURE_SHEET_MISSING', `Không tìm thấy sheet ${sheetName}.`);
      const values = await client.getValues(actual, { valueRenderOption: 'UNFORMATTED_VALUE' });
      return parseMeasureRows(values);
    } catch (error) {
      if (error.statusCode === 503) throw error;
      // Khong chuyen loi Google tho (metadata request/auth) ve trinh duyet.
      console.error('[MeasureSheet] Sheets read failed:', error.response?.status || error.code || 'UNKNOWN');
      throw sourceError('MEASURE_SOURCE_UNAVAILABLE', 'Không đọc được sheet CÂN ĐO. Vui lòng kiểm tra nguồn Google Sheets và quyền truy cập.');
    }
  }

  async function getTable() {
    if (cache && now() - cache.at < ttlMs) return cache.table;
    if (!inflight) {
      inflight = load().then(table => { cache = { table, at: now() }; return table; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  /** Tra cuu nhieu ma -> Map<codeKey, entry>. Ma khong co trong sheet khong xuat hien trong Map. */
  async function lookup(codes) {
    const table = await getTable();
    const result = new Map();
    for (const code of codes) {
      const key = codeKey(code);
      if (table.has(key)) result.set(key, table.get(key));
    }
    return result;
  }

  return { lookup };
}

module.exports = { parseMeasureRows, createMeasureSheet, codeKey, ...createMeasureSheet() };
