'use strict';

const { getPool } = require('../db/pool');

const HEADERS = Object.freeze({
  HN: { code: 'MÃ SẢN PHẨM', name: 'TÊN SẢN PHẨM', totalQuantity: 'TỔNG SL', notes: 'MÔ TẢ', location: 'KHU', arrivalDate: 'NGÀY VỀ' },
  SG: { code: 'Mã hàng', name: 'Tên hàng', totalQuantity: 'TỔNG SL đã đi', notes: 'Ghi chú hàng hóa', location: 'Vị trí', arrivalDate: 'NGÀY VỀ' }
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

// Du lieu doc tu bang stock_location_lines do server/sheetSnapshots/sync.js dong bo tu Google Sheets
// (3 phut/lan). Web KHONG goi Google moi request. Qua 15 phut khong dong bo thanh cong => stale.
const STALE_AFTER_MS = 15 * 60 * 1000;

function createStockLocationsService({ getDb = getPool, now = () => Date.now() } = {}) {
  // Cache theo co so, khoa = last_success_at. Moi request chi doc 1 dong trang thai (vai tram byte);
  // ~10K dong chi duoc keo tu DB khi lan dong bo thanh cong ke tiep thay doi moc do (giam egress DB).
  const cache = new Map();

  async function getLocations(branch) {
    if (!Object.hasOwn(HEADERS, branch)) throw sourceError('INVALID_BRANCH', 'Cơ sở không hợp lệ.');
    let sync;
    let rows;
    try {
      const db = getDb();
      sync = (await db.query('SELECT last_success_at, last_error FROM sheet_snapshot_sync WHERE source = $1',
        ['stock_locations_' + branch.toLowerCase()])).rows[0];
      if (sync?.last_success_at) {
        const version = new Date(sync.last_success_at).getTime();
        const cached = cache.get(branch);
        if (cached && cached.version === version) rows = cached.rows;
        else {
          const lines = await db.query(`SELECT code, name, total_quantity, notes, location, arrival_date FROM stock_location_lines
            WHERE branch = $1 ORDER BY source_row`, [branch]);
          rows = lines.rows.map(row => ({
            code: row.code, name: row.name, totalQuantity: row.total_quantity,
            notes: row.notes, location: row.location, arrivalDate: row.arrival_date
          }));
          cache.set(branch, { version, rows });
        }
      }
    } catch (error) {
      console.error('[StockLocations] DB read failed:', error.code || 'UNKNOWN');
      throw sourceError('STOCK_LOCATIONS_SOURCE_UNAVAILABLE', `Không đọc được dữ liệu Vị trí ${branch}.`);
    }
    if (!sync?.last_success_at) {
      throw sourceError('STOCK_LOCATIONS_NOT_SYNCED', `Vị trí ${branch} chưa được đồng bộ từ Google Sheets. Vui lòng thử lại sau ít phút.`);
    }
    const syncedAt = new Date(sync.last_success_at);
    return {
      branch,
      rows,
      syncedAt: syncedAt.toISOString(),
      stale: Boolean(sync.last_error) || now() - syncedAt.getTime() > STALE_AFTER_MS
    };
  }

  return { getLocations };
}

module.exports = { parseLocationRows, normalizeHeader, createStockLocationsService, ...createStockLocationsService() };
