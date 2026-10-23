'use strict';

// Nguon du lieu Tra cuu VAT: 3 tab CONG KHAI cua file VAT TKS (Gộp VAT gid 0, Khớp mã,
// DK về 2) doc qua URL export CSV — dung lai fetchSheetCsv cua Nhap VAT nhung cache RIENG
// vi Nhap VAT parse theo chu cai cot, khong co cot TÊN HÀNG va bo dong ton khong hop le.
// Cache 10 phut; Sheets loi tam thoi thi tra ban cu (stale) toi da 6 gio.

const { parseCsv } = require('../vatDraft/csv');
const { fetchSheetCsv } = require('../vatDraft/sheetsSource');
const { createTtlSnapshotCache } = require('../lib/ttlSnapshotCache');
const vatDraftConfig = require('../vatDraft/vatDraftConfig');
const { SHEET_TARGETS, rowsToObjects, buildModel } = require('./lookupModel');

// "DK về 2" (thay sheet DK VỀ cu dung IMPORTRANGE hay tra #REF!).
const GID_DK_VE = 1150116423;

function defaultLookupConfig() {
  return {
    sheetId: vatDraftConfig.sheetId,
    gids: { gop: vatDraftConfig.gidGopVat, khop: vatDraftConfig.gidKhopMa, dkve: GID_DK_VE }
  };
}

function sourceError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 503;
  return error;
}

/** CSV chi con 1 o loi cong thuc (#REF!, #N/A...) = IMPORTRANGE mat quyen: bao ro thay vi hien trong. */
function isFormulaErrorSheet(records) {
  const cells = records.flat().map(value => String(value || '').trim()).filter(Boolean);
  return cells.length === 1 && /^#[A-Z/0!?]+!?$/.test(cells[0]);
}

/** 3 CSV -> model; sheet thieu dong header / loi cong thuc -> loi 503 co code. */
function parseLookupCsvs(csvByKey) {
  const rowsBySheet = {};
  for (const target of SHEET_TARGETS) {
    const records = parseCsv(csvByKey[target.key]);
    if (isFormulaErrorSheet(records)) {
      throw sourceError(`Sheet '${target.label}' chỉ trả về lỗi công thức ${records.flat().find(Boolean)} (thường do IMPORTRANGE mất quyền). Báo người quản lý sheet kiểm tra.`, target.key === 'dkve' ? 'DK_VE_REF_ERROR' : 'SHEET_REF_ERROR');
    }
    rowsBySheet[target.key] = rowsToObjects(records, target.headerAnchors);
  }
  if (!rowsBySheet.gop.length && !rowsBySheet.khop.length) {
    throw sourceError('Không đọc được dữ liệu từ sheet Khớp mã hoặc Gộp VAT. Hãy kiểm tra lại tên cột trong Google Sheet.', 'SHEET_COLUMNS');
  }
  return buildModel(rowsBySheet);
}

function createLookupSource({ fetchImpl = globalThis.fetch, config = defaultLookupConfig(), now } = {}) {
  const cache = createTtlSnapshotCache({
    freshTtlMs: 10 * 60 * 1000,
    staleTtlMs: 6 * 60 * 60 * 1000,
    ...(now ? { now } : {}),
    fetch: async () => {
      const csvs = await Promise.all(SHEET_TARGETS.map(target => fetchSheetCsv({
        gid: config.gids[target.key], sheetName: target.label, sheetId: config.sheetId, fetchImpl
      })));
      return parseLookupCsvs(Object.fromEntries(SHEET_TARGETS.map((target, i) => [target.key, csvs[i]])));
    }
  });
  return {
    get: options => cache.get(options),
    refresh: () => cache.get({ forceRefresh: true })
  };
}

module.exports = { GID_DK_VE, defaultLookupConfig, isFormulaErrorSheet, parseLookupCsvs, createLookupSource };
