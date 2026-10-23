'use strict';

// Cot O "Tồn VAT" cua Yeu cau xuat VAT: cot TỒN ĐẦU NGÀY cua tab GỘP MỚI (file VAT TKS).
// Tra ma SP -> sheet "Khớp mã" -> MÃ VAT KIOT -> cong moi cong ty (cot CTY) cung ma VAT.
// Doc bang service account (Sheets API, chi doc) giong Nhap VAT (vatDraft/sheetsSource.js),
// cache 10 phut, loi tam thoi tra ban cu toi da 6 gio. Chi DOC sheet; khong dung thuat
// toan phan bo cua Nhap VAT.
//
// Mac dinh doc tab GỘP MỚI (sheetId 1753209460) va Khớp mã cua file VAT TKS; van co the
// doi nguon qua bien moi truong (config.js): *_SHEET_ID = ID file, *_GID = sheetId cua tab.
// Doc theo chu cai cot nen doc ca tab. Bo cuc: A=CTY, B=Mã kiot đại diện, D=MÃ VAT KIOT,
// I=TỒN ĐẦU NGÀY.

const { fetchSheetRecords, columnLetterToIndex } = require('../vatDraft/sheetsSource');
const { normalizeCode, normalizeCodeForMatch, toFloatOrNone } = require('../vatDraft/normalization');
const { createTtlSnapshotCache } = require('../lib/ttlSnapshotCache');
const vatDraftConfig = require('../vatDraft/vatDraftConfig');
const appConfig = require('../config');

const GOP_MOI_SHEET_ID = 1753209460;

function defaultStockConfig() {
  return {
    stockSheet: {
      spreadsheetId: appConfig.VAT_REQUEST_STOCK_SHEET_ID || vatDraftConfig.spreadsheetId,
      sheetId: appConfig.VAT_REQUEST_STOCK_GID || GOP_MOI_SHEET_ID
    },
    stockSkipRows: 1,
    stockColumns: { company: 'A', representativeCode: 'B', vatCode: 'D', stock: appConfig.VAT_REQUEST_STOCK_COLUMN || 'I' },
    mappingSheet: {
      spreadsheetId: appConfig.VAT_REQUEST_MAPPING_SHEET_ID || vatDraftConfig.spreadsheetId,
      sheetId: appConfig.VAT_REQUEST_MAPPING_GID || vatDraftConfig.khopMaSheet.sheetId
    },
    mappingSkipRows: vatDraftConfig.khopMaSkipRows,
    mappingColumns: { productCode: vatDraftConfig.khopMaColumns['Mã SP'], vatCode: vatDraftConfig.khopMaColumns['Mã vat kiot'] }
  };
}

function cellReader(columns) {
  const indexes = Object.fromEntries(Object.entries(columns).map(([name, letter]) => [name, columnLetterToIndex(letter)]));
  return (row, name) => normalizeCode(row[indexes[name]] ?? '');
}

/** Tab ton (mang dong) -> Map(maVatNorm -> [{ company, stock }]) + Map(maKiotDaiDienNorm -> Set(maVatNorm)). */
function parseStockRecords(records, config) {
  const read = cellReader(config.stockColumns);
  const stockByVat = new Map();
  const vatByRepresentative = new Map();
  for (const row of records.slice(config.stockSkipRows)) {
    const vatKey = normalizeCodeForMatch(read(row, 'vatCode'));
    if (!vatKey) continue;
    const stock = toFloatOrNone(read(row, 'stock'));
    if (!stockByVat.has(vatKey)) stockByVat.set(vatKey, []);
    stockByVat.get(vatKey).push({ company: read(row, 'company'), vatCode: read(row, 'vatCode'), stock: stock === null ? 0 : stock });
    const repKey = normalizeCodeForMatch(read(row, 'representativeCode'));
    if (repKey) {
      if (!vatByRepresentative.has(repKey)) vatByRepresentative.set(repKey, new Set());
      vatByRepresentative.get(repKey).add(vatKey);
    }
  }
  return { stockByVat, vatByRepresentative };
}

/** Tab Khớp mã (mang dong) -> Map(maSpNorm -> Set(maVatNorm)). */
function parseMappingRecords(records, config) {
  const read = cellReader(config.mappingColumns);
  const vatByProduct = new Map();
  for (const row of records.slice(config.mappingSkipRows)) {
    const productKey = normalizeCodeForMatch(read(row, 'productCode'));
    const vatKey = normalizeCodeForMatch(read(row, 'vatCode'));
    if (!productKey || !vatKey) continue;
    if (!vatByProduct.has(productKey)) vatByProduct.set(productKey, new Set());
    vatByProduct.get(productKey).add(vatKey);
  }
  return vatByProduct;
}

/**
 * Ton VAT cua 1 ma SP: { total, byCompany: [{ company, vatCode, stock }] } hoac null khi ma
 * chua khop ma VAT nao. Uu tien sheet Khớp mã; khong co thi dung cot Mã kiot đại diện.
 */
function lookupStock(snapshot, productCode) {
  const key = normalizeCodeForMatch(productCode);
  if (!key || !snapshot) return null;
  const vatKeys = snapshot.vatByProduct.get(key) || snapshot.vatByRepresentative.get(key);
  if (!vatKeys || !vatKeys.size) return null;
  const byCompany = [];
  for (const vatKey of vatKeys) byCompany.push(...(snapshot.stockByVat.get(vatKey) || []));
  if (!byCompany.length) return null;
  const total = byCompany.reduce((sum, entry) => sum + entry.stock, 0);
  return { total, byCompany };
}

function createStockSource({ readValues, config = defaultStockConfig(), now } = {}) {
  const cache = createTtlSnapshotCache({
    freshTtlMs: 10 * 60 * 1000,
    staleTtlMs: 6 * 60 * 60 * 1000,
    ...(now ? { now } : {}),
    fetch: async () => {
      const [stockRecords, mappingRecords] = await Promise.all([
        fetchSheetRecords({ source: config.stockSheet, sheetName: 'Tồn VAT', readValues }),
        fetchSheetRecords({ source: config.mappingSheet, sheetName: 'Khớp mã', readValues })
      ]);
      return { ...parseStockRecords(stockRecords, config), vatByProduct: parseMappingRecords(mappingRecords, config) };
    }
  });
  return {
    get: options => cache.get(options),
    set: data => cache.set(data),
    clear: () => cache.clear()
  };
}

module.exports = { GOP_MOI_SHEET_ID, defaultStockConfig, parseStockRecords, parseMappingRecords, lookupStock, createStockSource };
