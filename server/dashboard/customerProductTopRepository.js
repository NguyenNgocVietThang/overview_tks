'use strict';
// ==========================================
// KHACH THEO HANG HOA — top khach mua nhieu nhat cho tung ma hang, tinh
// truc tiep bang SQL tren Supabase Postgres thay cho sheet tong hop
// "Khách theo hàng hóa" truoc day.
//
// Ngu nghia bao cao duoc giu nguyen:
//   - Chi tinh hoa don `status = 1` (da doi chieu du lieu that: status 1 <->
//     statusValue "Hoàn thành") va phieu tra `status = 1` ("Đã trả").
//   - "Thành tiền" = `subTotal` cua KiotViet neu co, neu khong thi
//     price * quantity - discount (giong buildInvoiceDetailSheetRow_).
//   - Khach hang duoc gom theo ma khach; khach le (khong co ma) gom theo ten.
//
// LUU Y MUI GIO: cot TIMESTAMPTZ trong Postgres dang giu "gio treo tuong" cua
// KiotViet nhung mang nhan UTC (xem dashboardPgReader.js). Vi vay moc loc ngay
// tu dashboard (Date thuc, gio VN) phai duoc doi sang cung quy uoc truoc khi
// so sanh — xem toWallClockInstant().
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, BRANCH_BOTH, branchLabelToCode, resolveBranchScope } = require('../branch/branches');

const DEFAULT_TOP_LIMIT = 3;
const WALL_CLOCK_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const WALL_CLOCK_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: WALL_CLOCK_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23'
});

/**
 * Doi 1 moc thoi gian thuc sang dung quy uoc dang luu trong DB: lay gio treo
 * tuong o Viet Nam roi coi no nhu UTC.
 */
function toWallClockInstant(date) {
  if (!date) return null;
  const parts = Object.fromEntries(
    WALL_CLOCK_FORMATTER.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
  return new Date(Date.UTC(
    parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second
  ));
}

/** Nguoc lai toWallClockInstant: doi gia tri doc tu DB ve moc thoi gian thuc. */
function fromWallClockInstant(date) {
  if (!date) return null;
  const wall = new Date(date);
  const iso = wall.toISOString().slice(0, 19);
  return new Date(`${iso}+07:00`);
}

const PRODUCT_CODE_SQL = `COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '')`;
const PRODUCT_NAME_SQL = `COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '')`;
const RETURN_PRODUCT_CODE_SQL = `COALESCE(NULLIF(rd.raw->>'productCode', ''), rp.code, '')`;

function customerCodeSql(alias) {
  return `COALESCE(NULLIF(${alias}.raw->>'customerCode', ''), c.code, '')`;
}

function customerNameSql(alias) {
  return `COALESCE(NULLIF(${alias}.raw->>'customerName', ''), NULLIF(c.name, ''), 'Khách lẻ')`;
}

function customerKeySql(alias) {
  return `CASE
      WHEN ${customerCodeSql(alias)} <> '' THEN 'code:' || lower(${customerCodeSql(alias)})
      ELSE 'name:' || lower(${customerNameSql(alias)})
    END`;
}

const DETAIL_AMOUNT_SQL = `CASE
    WHEN d.raw ? 'subTotal' THEN COALESCE((d.raw->>'subTotal')::float8, 0)
    ELSE COALESCE(d.price, 0)::float8 * COALESCE(d.quantity, 0)::float8 - COALESCE(d.discount, 0)::float8
  END`;

const RETURN_AMOUNT_SQL = `CASE
    WHEN rd.raw ? 'subTotal' THEN abs(COALESCE((rd.raw->>'subTotal')::float8, 0))
    ELSE abs(COALESCE(rd.price, 0)::float8 * COALESCE(rd.quantity, 0)::float8)
  END`;

// Thu tu uu tien co so khi gop ten hien thi qua cac co so ("Cả hai"): Ha Noi truoc.
const BRANCH_RANK_SQL = `CASE branch WHEN 'hanoi' THEN 0 WHEN 'saigon' THEN 1 ELSE 2 END`;

/**
 * $1 branch (aggregate: text[] cac co so vat ly), $2 danh sach ma hang (da
 * lower), $3 tu ngay, $4 den ngay, $5 so khach toi da moi ma hang.
 *
 * aggregate = true ("Cả hai"): ban ghi ban/tra cua CA hai co so duoc gom theo
 * (hang, khach) TRUOC khi xep hang top-N — khong the gop hai top-N rieng cua tung
 * co so vi khach hang co the chi vao top khi cong ca hai co so.
 */
function buildTopCustomersQuery(rankBy, aggregate = false) {
  const rankOrder = rankBy === 'revenue'
    ? 'revenue DESC, qty DESC'
    : 'qty DESC, revenue DESC';
  const branchPredicate = column => (aggregate ? `${column} = ANY($1::text[])` : `${column} = $1`);
  const firstByBranch = (column, avoid) => (aggregate
    ? `(array_agg(${column} ORDER BY ${avoid ? `(${column} = ${avoid}), ` : ''}${BRANCH_RANK_SQL}, ${column}))[1]`
    : `min(${column})`);

  return `
    WITH sales AS (
      SELECT
        lower(${PRODUCT_CODE_SQL})                   AS product_key,
        ${PRODUCT_CODE_SQL}                          AS product_code,
        ${PRODUCT_NAME_SQL}                          AS product_name,
        ${customerKeySql('i')}                       AS customer_key,
        ${customerCodeSql('i')}                      AS customer_code,
        ${customerNameSql('i')}                      AS customer_name,
        COALESCE(d.quantity, 0)::float8              AS quantity,
        ${DETAIL_AMOUNT_SQL}                         AS amount,
        i.purchase_date                              AS purchase_date${aggregate ? ', d.branch AS branch' : ''}
      FROM invoice_details d
      JOIN invoices i ON i.branch = d.branch AND i.id = d.invoice_id
      LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
      LEFT JOIN customers c ON c.branch = i.branch AND c.id = i.customer_id
      WHERE ${branchPredicate('d.branch')}
        AND i.status = 1
        AND lower(${PRODUCT_CODE_SQL}) = ANY($2)
        AND ($3::timestamptz IS NULL OR i.purchase_date >= $3)
        AND ($4::timestamptz IS NULL OR i.purchase_date <= $4)
    ),
    sales_agg AS (
      SELECT
        product_key,
        ${firstByBranch('product_code')}   AS product_code,
        ${firstByBranch('product_name', "''")}   AS product_name,
        customer_key,
        ${firstByBranch('customer_code')}  AS customer_code,
        ${firstByBranch('customer_name', "'Khách lẻ'")}  AS customer_name,
        sum(quantity)       AS qty,
        sum(amount)         AS revenue,
        max(purchase_date)  AS last_purchase_date
      FROM sales
      GROUP BY product_key, customer_key
    ),
    returns_agg AS (
      SELECT
        lower(${RETURN_PRODUCT_CODE_SQL})  AS product_key,
        ${customerKeySql('r')}             AS customer_key,
        sum(abs(COALESCE(rd.quantity, 0)::float8)) AS returned_quantity,
        sum(${RETURN_AMOUNT_SQL})          AS return_value
      FROM return_details rd
      JOIN returns r ON r.branch = rd.branch AND r.id = rd.return_id
      LEFT JOIN products rp ON rp.branch = rd.branch AND rp.id = rd.product_id
      LEFT JOIN customers c ON c.branch = r.branch AND c.id = r.customer_id
      WHERE ${branchPredicate('rd.branch')}
        AND r.status = 1
        AND lower(${RETURN_PRODUCT_CODE_SQL}) = ANY($2)
        AND ($3::timestamptz IS NULL OR r.return_date >= $3)
        AND ($4::timestamptz IS NULL OR r.return_date <= $4)
      GROUP BY 1, 2
    ),
    ranked AS (
      SELECT
        s.product_key, s.product_code, s.product_name,
        s.customer_code, s.customer_name, s.qty, s.revenue, s.last_purchase_date,
        COALESCE(rt.returned_quantity, 0) AS returned_quantity,
        COALESCE(rt.return_value, 0)      AS return_value,
        ROW_NUMBER() OVER (
          PARTITION BY s.product_key
          ORDER BY ${rankOrder}, s.last_purchase_date DESC NULLS LAST,
                   s.customer_code ASC, s.customer_name ASC
        ) AS rn
      FROM sales_agg s
      LEFT JOIN returns_agg rt
        ON rt.product_key = s.product_key AND rt.customer_key = s.customer_key
    )
    SELECT product_key, product_code, product_name, customer_code, customer_name,
           qty, revenue, returned_quantity, return_value, last_purchase_date
    FROM ranked
    WHERE rn <= $5
    ORDER BY product_key, rn`;
}

const TOP_BY_QUANTITY_SQL = buildTopCustomersQuery('quantity');
const TOP_BY_REVENUE_SQL = buildTopCustomersQuery('revenue');
const TOP_BY_QUANTITY_AGGREGATE_SQL = buildTopCustomersQuery('quantity', true);
const TOP_BY_REVENUE_AGGREGATE_SQL = buildTopCustomersQuery('revenue', true);

function normalizeCodes(codes) {
  return (codes || [])
    .map(code => String(code == null ? '' : code).trim().toLocaleLowerCase('vi-VN'))
    .filter(Boolean);
}

function mapRow(row) {
  return {
    productCode: row.product_code || '',
    productName: row.product_name || row.product_code || '',
    customerCode: row.customer_code || '',
    customerName: row.customer_name || 'Khách lẻ',
    purchasedQuantity: Number(row.qty) || 0,
    purchaseRevenue: Number(row.revenue) || 0,
    returnedQuantity: Number(row.returned_quantity) || 0,
    returnValue: Number(row.return_value) || 0,
    lastPurchaseDate: fromWallClockInstant(row.last_purchase_date)
  };
}

function createCustomerProductTopRepository({ pool = getPool() } = {}) {
  function resolveBranchCode(branch) {
    const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }
    return branchCode;
  }

  /**
   * "Cả hai" -> mang ma co so VAT LY (chi qua branchLabelToCode tung co so vat
   * ly, khong bao gio chuyen "Cả hai" nhu mot co so) + SQL gop; co so vat ly ->
   * 1 ma vo huong + SQL cu.
   */
  function resolveScope(branch, sqlPair) {
    if (branch === BRANCH_BOTH) {
      return {
        branchParam: resolveBranchScope(BRANCH_BOTH).map(resolveBranchCode),
        sql: sqlPair.aggregate
      };
    }
    return { branchParam: resolveBranchCode(branch), sql: sqlPair.physical };
  }

  /**
   * Top khach mua NHIEU NHAT (theo so luong) cho tung ma hang trong khoang
   * `range` — thay cho sheet "Khách theo hàng hóa" o searchTopCustomersByProducts.
   * @param {Object} params
   * @param {string} params.branch nhan co so ('Hà Nội'/'Sài Gòn')
   * @param {string[]} params.codes danh sach ma hang nguoi dung nhap
   * @param {{mode: string, start?: Date, end?: Date}} params.range bo loc thoi gian
   * @param {number} [params.limit] so khach toi da moi ma hang
   */
  async function findTopCustomersByProducts({ branch, codes, range, limit = DEFAULT_TOP_LIMIT }) {
    const normalizedCodes = normalizeCodes(codes);
    if (!normalizedCodes.length) return [];
    const isAll = !range || range.mode === 'all';
    const scope = resolveScope(branch, { physical: TOP_BY_QUANTITY_SQL, aggregate: TOP_BY_QUANTITY_AGGREGATE_SQL });
    const params = [
      scope.branchParam,
      normalizedCodes,
      isAll ? null : toWallClockInstant(range.start),
      isAll ? null : toWallClockInstant(range.end),
      limit
    ];
    const result = await pool.query(scope.sql, params);
    return result.rows.map(mapRow);
  }

  /**
   * Top khach theo DOANH SO tren toan bo lich su cho 1 ma hang — thay cho
   * computeTopCustomersByRevenueForProduct (phan "Chi tiết" cua bao cao doanh
   * thu theo hang).
   */
  async function findTopCustomersByRevenueForProduct({ branch, code, limit = DEFAULT_TOP_LIMIT }) {
    const normalizedCodes = normalizeCodes([code]);
    if (!normalizedCodes.length) return [];
    const scope = resolveScope(branch, { physical: TOP_BY_REVENUE_SQL, aggregate: TOP_BY_REVENUE_AGGREGATE_SQL });
    const params = [scope.branchParam, normalizedCodes, null, null, limit];
    const result = await pool.query(scope.sql, params);
    return result.rows.map(mapRow);
  }

  return { findTopCustomersByProducts, findTopCustomersByRevenueForProduct };
}

const repository = createCustomerProductTopRepository();

module.exports = {
  createCustomerProductTopRepository,
  findTopCustomersByProducts: (...args) => repository.findTopCustomersByProducts(...args),
  findTopCustomersByRevenueForProduct: (...args) => repository.findTopCustomersByRevenueForProduct(...args),
  DEFAULT_TOP_LIMIT,
  // "Thanh tien" tren 1 dong invoice_details — dashboardRollupRefresh.js tai
  // dung CHINH XAC cong thuc nay khi tinh daily_product_sales.revenue, tranh
  // viet trung logic o 2 noi va lech so lieu.
  DETAIL_AMOUNT_SQL,
  __test__: { toWallClockInstant, fromWallClockInstant }
};
