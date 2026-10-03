'use strict';

const CONFIG = require('../config');
const { createReadOnlyClient } = require('../sheets/sheetsClient');

const HEADERS = Object.freeze({
  HN: { code: 'MÃ SẢN PHẨM', name: 'TÊN SẢN PHẨM', totalQuantity: 'TỔNG SL', notes: 'MÔ TẢ', location: 'KHU' },
  SG: { code: 'Mã hàng', name: 'Tên hàng', totalQuantity: 'TỔNG SL đã đi', notes: 'Ghi chú hàng hóa', location: 'Vị trí' }
});

function sourceError(code, message) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code;
  return error;
}

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('vi');
}

function parseLocationRows(values, branch) {
  const fields = Object.entries(HEADERS[branch]);
  let indexes;
  const headerRow = values.findIndex(row => {
    const normalized = row.map(normalizeHeader);
    const candidates = fields.map(([, title]) => normalized.indexOf(normalizeHeader(title)));
    if (candidates.some(index => index < 0)) return false;
    indexes = candidates;
    return true;
  });
  if (headerRow < 0) {
    throw sourceError('STOCK_LOCATIONS_HEADERS_MISSING', `Sheet Vị trí ${branch} không có hàng tiêu đề đủ các cột: ${fields.map(([, title]) => title).join(', ')}.`);
  }
  return values.slice(headerRow + 1).flatMap(row => {
    const item = Object.fromEntries(fields.map(([key], index) => [key, String(row[indexes[index]] ?? '')]));
    return item.code.trim() || item.name.trim() ? [item] : [];
  });
}

function createStockLocationsService({
  getSpreadsheetId = () => CONFIG.STOCK_LOCATIONS_SPREADSHEET_ID,
  client = createReadOnlyClient(getSpreadsheetId, 'Vị trí hàng'),
  sheetNames = { HN: CONFIG.STOCK_LOCATIONS_SHEET_HN, SG: CONFIG.STOCK_LOCATIONS_SHEET_SG }
} = {}) {
  const inFlight = new Map();

  function getLocations(branch) {
    if (!Object.hasOwn(HEADERS, branch)) throw sourceError('INVALID_BRANCH', 'Cơ sở không hợp lệ.');
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) throw sourceError('STOCK_LOCATIONS_NOT_CONFIGURED', 'Vị trí hàng chưa được cấu hình nguồn dữ liệu.');
    const key = `${spreadsheetId}:${branch}`;
    if (inFlight.has(key)) return inFlight.get(key);

    const loading = (async () => {
      try {
        const titles = await client.listSheetTitles();
        const actualTitle = titles.find(title => title === sheetNames[branch]) ||
          titles.find(title => normalizeHeader(title) === normalizeHeader(sheetNames[branch]));
        if (!actualTitle) {
          throw sourceError('STOCK_LOCATIONS_SHEET_MISSING', `Không tìm thấy sheet ${sheetNames[branch]}.`);
        }
        const values = await client.getValues(actualTitle, { valueRenderOption: 'FORMATTED_VALUE' });
        return { branch, rows: parseLocationRows(values, branch) };
      } catch (error) {
        if (error.statusCode === 503) throw error;
        // Không chuyển lỗi Google thô (request/auth metadata) về trình duyệt.
        console.error('[StockLocations] Sheets read failed:', error.response?.status || error.code || 'UNKNOWN');
        throw sourceError('STOCK_LOCATIONS_SOURCE_UNAVAILABLE', `Không đọc được dữ liệu Vị trí ${branch}. Vui lòng kiểm tra nguồn Google Sheets và quyền truy cập.`);
      }
    })().finally(() => { inFlight.delete(key); });
    inFlight.set(key, loading);
    return loading;
  }

  return { getLocations };
}

module.exports = { parseLocationRows, createStockLocationsService, ...createStockLocationsService() };
