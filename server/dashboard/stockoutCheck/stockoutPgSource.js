'use strict';
// ==========================================
// NGUON DU LIEU DUT HANG TREN SUPABASE POSTGRES — thay cho viec goi truc tiep
// KiotViet API (products, invoices, purchaseorders, returns) moi lan quet. Cac
// bang nay do server/kiotvietSync/ dong bo (webhook + polling), nen quet dut
// hang khong con ton quota/thoi gian phan trang cua KiotViet. NGOAI LE:
// supplier_return_imports (Tra NCC) KHONG do sync engine ghi — do nguoi dung
// upload Excel KiotViet qua supplierReturnImportService.js, vi KiotViet khong
// public API cho nghiep vu tra hang nhap.
//
// Ngu nghia giu nguyen so voi ban goi API:
//   - Hoa don tinh khi status = 1 (Hoan thanh), phieu nhap khi status = 3,
//     phieu tra khach khi status = 1 (Da tra).
//   - Ma hang lay tu payload chi tiet (`raw->>'productCode'`), fallback ma
//     trong bang products — cung quy uoc voi customerProductTopRepository.js.
//   - Ton kho hien tai = tong `onHand` cua mang `inventories` trong products.raw.
//
// LUU Y MUI GIO: cot TIMESTAMPTZ giu "gio treo tuong" cua KiotViet (gio Viet
// Nam) mang nhan UTC (xem dashboardPgReader.js) nen ngay giao dich phai lay
// bang `AT TIME ZONE 'UTC'` — dung 'Asia/Ho_Chi_Minh' se lech +7h. Do la cung
// ket qua voi toVnDateKey() ben timelineBuilder.js khi chuoi KiotViet khong kem
// offset.
// ==========================================
const { getPool } = require('../../db/pool');
const { BRANCHES, branchLabelToCode } = require('../../branch/branches');

// Cac thuc the phai duoc dong bo gan day thi ket qua quet moi dang tin cay.
const REQUIRED_SYNC_ENTITIES = Object.freeze(['products', 'invoices', 'purchases', 'returns']);

const PRODUCT_CODE_SQL = (detailAlias, productAlias) =>
  `btrim(COALESCE(NULLIF(${detailAlias}.raw->>'productCode', ''), ${productAlias}.code, ''))`;

const MOVEMENT_KINDS = Object.freeze({
  invoices: {
    parentTable: 'invoices', detailTable: 'invoice_details', parentIdColumn: 'invoice_id',
    dateColumn: 'purchase_date', completedStatus: 1
  },
  purchases: {
    parentTable: 'purchases', detailTable: 'purchase_details', parentIdColumn: 'purchase_id',
    dateColumn: 'purchase_date', completedStatus: 3
  },
  customerReturns: {
    parentTable: 'returns', detailTable: 'return_details', parentIdColumn: 'return_id',
    dateColumn: 'return_date', completedStatus: 1
  }
});

// Tra NCC khong co bang parent+detail nhu 3 loai tren (day la du lieu nguoi
// dung IMPORT tu Excel KiotViet, xem supplierReturnImportService.js), nen
// dung 1 cau SQL rieng thay vi buildMovementsQuery — nhung van giu dung 4 tham
// so ($1 branch, $2 danh sach ma, $3 tu ngay, $4 den ngay) de dung chung code
// path ben duoi voi cac kind con lai.
const SUPPLIER_RETURNS_QUERY = `
  SELECT
    btrim(product_code)                                AS code,
    to_char(return_date, 'YYYY-MM-DD')                 AS date_key,
    SUM(quantity)::float8                               AS quantity
  FROM supplier_return_imports
  WHERE branch = $1
    AND return_date >= $3::date
    AND return_date <  ($4::date + 1)
    AND btrim(product_code) = ANY($2::text[])
  GROUP BY 1, 2`;

// $1 branch, $2 danh sach ma hang, $3 tu ngay (YYYY-MM-DD), $4 den ngay
// (YYYY-MM-DD, tinh het ngay do). Tong hop san theo (ma, ngay) — bang ton kho
// chi can tong bien dong moi ngay, khong can tung dong chi tiet.
function buildMovementsQuery({ parentTable, detailTable, parentIdColumn, dateColumn, completedStatus }) {
  const codeSql = PRODUCT_CODE_SQL('d', 'p');
  return `
    SELECT
      ${codeSql}                                                    AS code,
      to_char(h.${dateColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD')      AS date_key,
      SUM(COALESCE(d.quantity, 0))::float8                           AS quantity
    FROM ${detailTable} d
    JOIN ${parentTable} h ON h.branch = d.branch AND h.id = d.${parentIdColumn}
    LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
    WHERE d.branch = $1
      AND h.status = ${completedStatus}
      AND h.${dateColumn} >= ($3::date::timestamp AT TIME ZONE 'UTC')
      AND h.${dateColumn} <  (($4::date + 1)::timestamp AT TIME ZONE 'UTC')
      AND ${codeSql} = ANY($2::text[])
    GROUP BY 1, 2`;
}

const MOVEMENT_QUERIES = Object.freeze({
  ...Object.fromEntries(Object.entries(MOVEMENT_KINDS).map(([kind, spec]) => [kind, buildMovementsQuery(spec)])),
  supplierReturns: SUPPLIER_RETURNS_QUERY
});

const PRODUCTS_QUERY = `
  SELECT
    p.code,
    COALESCE(NULLIF(p.raw->>'fullName', ''), p.name)  AS name,
    p.is_active,
    p.raw->>'createdDate'                             AS created_date,
    (SELECT COALESCE(SUM(COALESCE((inv->>'onHand')::float8, 0)), 0)
       FROM jsonb_array_elements(COALESCE(p.raw->'inventories', '[]'::jsonb)) inv) AS on_hand
  FROM products p
  WHERE p.branch = $1`;

const SYNC_STATUS_QUERY = `
  SELECT entity, last_success_at
  FROM sync_checkpoints
  WHERE branch = $1 AND entity = ANY($2::text[])`;

// Tra NCC khong co checkpoint dong bo (khong phai KiotViet sync) — do phu du
// lieu bang chinh ngay som nhat da IMPORT cho co so nay, xem sheetTimelineBuilder
// cu (findEarliestSheetDateKey) ma ham nay thay the.
const SUPPLIER_RETURN_COVERAGE_QUERY = `
  SELECT count(*)::int AS row_count, to_char(min(return_date), 'YYYY-MM-DD') AS earliest_date
  FROM supplier_return_imports
  WHERE branch = $1`;

function createStockoutPgSource({ pool = getPool(), branch } = {}) {
  const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
  if (!branchCode) {
    const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
    error.code = 'INVALID_BRANCH';
    error.statusCode = 400;
    throw error;
  }

  /** Toan bo hang hoa cua co so: { code, name, isActive, onHand, createdDate }. */
  async function listProducts() {
    const result = await pool.query(PRODUCTS_QUERY, [branchCode]);
    return result.rows.map(row => ({
      code: row.code,
      name: row.name,
      isActive: row.is_active,
      onHand: Number(row.on_hand) || 0,
      createdDate: row.created_date || null
    }));
  }

  /**
   * Bien dong ton kho da cong don theo (ma hang, ngay) cho 1 loai chung tu.
   * @param {'invoices'|'purchases'|'customerReturns'|'supplierReturns'} kind
   * @returns {Promise<Array<{code: string, dateKey: string, quantity: number}>>}
   */
  async function listStockMovements({ kind, codes, fromDate, toDate }) {
    const sql = MOVEMENT_QUERIES[kind];
    if (!sql) throw new Error(`Loại chứng từ không hợp lệ: ${kind}`);
    const codeList = Array.from(codes || []);
    if (!codeList.length) return [];
    const result = await pool.query(sql, [branchCode, codeList, fromDate, toDate]);
    return result.rows.map(row => ({
      code: row.code,
      dateKey: row.date_key,
      quantity: Number(row.quantity) || 0
    }));
  }

  /** Lan dong bo thanh cong gan nhat cua cac thuc the dut hang can: { entity, lastSuccessAt|null }. */
  async function getSyncStatus() {
    const result = await pool.query(SYNC_STATUS_QUERY, [branchCode, REQUIRED_SYNC_ENTITIES]);
    const byEntity = new Map(result.rows.map(row => [row.entity, row.last_success_at]));
    return REQUIRED_SYNC_ENTITIES.map(entity => ({
      entity,
      lastSuccessAt: byEntity.get(entity) || null
    }));
  }

  /** Do phu du lieu Tra NCC da import cho co so nay: { rowCount, earliestDate|null }. */
  async function getSupplierReturnCoverage() {
    const result = await pool.query(SUPPLIER_RETURN_COVERAGE_QUERY, [branchCode]);
    const row = result.rows[0];
    return { rowCount: row.row_count || 0, earliestDate: row.earliest_date || null };
  }

  return { listProducts, listStockMovements, getSyncStatus, getSupplierReturnCoverage };
}

module.exports = {
  createStockoutPgSource,
  REQUIRED_SYNC_ENTITIES,
  MOVEMENT_KINDS,
  MOVEMENT_QUERIES,
  PRODUCTS_QUERY
};
