// ==========================================
// KIOT PENDING ORDERS — doc don dat hang "Phieu tam" cua KiotViet (bang orders/order_details,
// 2 co so hanoi/saigon) de GOP vao trang "Vong doi don hang" cung cac don tu Google Sheet, kem
// "Gia tri co ban" tung don. Chi DOC; khong bao gio ghi vao DB hay Sheet.
//
// GIA TRI CO BAN (quyet dinh cua nguoi dung 2026-10-01): voi moi mat hang trong don,
//   so ban duoc = min(SL dat, max(0, TON THUC cua dung Kiot cua don + HANG DANG VAN CHUYEN))
//   gia tri     = so ban duoc x don gia sau chiet khau dong (price - discount)
// va cong tat ca mat hang. KHONG tru cac don Phieu tam khac (chinh don dang xet cung la Phieu
// tam). Ton thuc = tong `inventories[].onHand` cua san pham trong retailer cua don; hang dang van
// chuyen = cung 1 so theo ma cho ca HN va SG (inTransitSource.js, chi co phieu cua Kiot SG).
// Dong ma "VAT..." la dong thue, khong phai hang ton kho — bo khoi phep tinh (nhu dashboardData).
//
// Noi dung nay chay moi lan trang tai (tu lam moi 60s) nen:
//   - cache TTL 60s + single-flight (nhieu nguoi mo trang cung luc chi 1 lan doc DB);
//   - FAIL-SOFT: loi Postgres KHONG duoc lam hong trang (van hien du lieu Sheet): tra {ok:false},
//     hoac ban cu (toi da staleMs) neu co.
// Cot Phieu tam khong co index cho den khi ap migration 0028 (index mot phan) — chay van dung, chi cham.
// ==========================================
'use strict';

const { getPool } = require('../db/pool');
const { readInTransitByCode } = require('../dashboard/inTransitSource');
const { saleNameSql } = require('../dashboard/saleName');
const { getOrderDetail } = require('../dashboard/documentDetailRepository');

// Nhan co so cua Vong doi don hang ('HN'|'SG', nhan tab nguon Sheets) <-> ma co so trong DB.
// RIENG cho tinh nang nay, KHONG tron voi branch/branches.js (xem memory ve 3 he dinh danh co so).
const LIFECYCLE_TO_DB_BRANCH = Object.freeze({ HN: 'hanoi', SG: 'saigon' });
const DB_TO_LIFECYCLE_BRANCH = Object.freeze({ hanoi: 'HN', saigon: 'SG' });

const PHIEU_TAM = 'Phiếu tạm';
const DEFAULT_TTL_MS = 60 * 1000;
const DEFAULT_STALE_MS = 10 * 60 * 1000;

function makeError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/** Dong ma VAT* la dong thue, khong phai hang ton kho. */
function isServiceProductKey(productKey) {
  return String(productKey || '').startsWith('vat');
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Ma hang duoc so khop theo chu thuong da trim (giong IN_TRANSIT_SQL / product_report).
function productKeyOf(code) {
  return String(code == null ? '' : code).trim().toLowerCase();
}

/**
 * HAM THUAN. Chia "so ban duoc" cho tung dong don.
 * @param lines [{ orderKey, productKey, quantity, amount }] — amount = (price - discount) * quantity
 * @param availableOf (line) => so luong CO THE CAP (ton thuc + dang van chuyen, co the am)
 * @returns mang song song voi `lines`: { sellableQty, sellableAmount } (null voi dong thue/khong co ma)
 *
 * Cung 1 san pham xuat hien nhieu dong trong cung 1 don thi gop lai de TON CHI BI TINH 1 LAN:
 * ti le co ban = min(1, ton cap / tong SL cua san pham do trong don), chia deu cho cac dong.
 */
function allocateSellable(lines, availableOf) {
  const out = lines.map(() => ({ sellableQty: null, sellableAmount: null }));
  const groups = new Map(); // orderKey + productKey -> { quantity, indexes[] }
  lines.forEach((line, index) => {
    if (!line.productKey || isServiceProductKey(line.productKey)) return;
    const key = `${line.orderKey}\u0000${line.productKey}`;
    let group = groups.get(key);
    if (!group) { group = { quantity: 0, indexes: [] }; groups.set(key, group); }
    group.quantity += toNumber(line.quantity);
    group.indexes.push(index);
  });
  groups.forEach(group => {
    const available = Math.max(0, toNumber(availableOf(lines[group.indexes[0]])));
    const ratio = group.quantity > 0 ? Math.min(1, available / group.quantity) : 0;
    group.indexes.forEach(index => {
      out[index] = {
        sellableQty: toNumber(lines[index].quantity) * ratio,
        sellableAmount: toNumber(lines[index].amount) * ratio
      };
    });
  });
  return out;
}

// Don Phieu tam + dong hang. LEFT JOIN de don khong co dong van xuat hien (gia tri co ban = 0).
// Bieu thuc loc statusValue GIU NGUYEN (khong COALESCE) de trung dieu kien index mot phan 0028.
// Ngay dat doc bang AT TIME ZONE 'UTC' ("gio treo tuong VN mang nhan UTC", xem dashboardPgReader.js).
const PENDING_ORDERS_SQL = `
  SELECT
    o.branch,
    o.id AS order_id,
    o.code,
    COALESCE(o.total, 0)::float8 AS total,
    COALESCE(to_char(o.order_date AT TIME ZONE 'UTC', 'DD/MM/YYYY HH24:MI'), '') AS order_date_text,
    COALESCE(to_char(o.order_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS order_date_key,
    COALESCE(NULLIF(o.raw->>'customerName', ''), 'Khách lẻ') AS customer_name,
    ${saleNameSql(`COALESCE(NULLIF(o.raw->>'soldByName', ''), s.name, '')`)} AS sale_name,
    btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '')) AS product_code,
    COALESCE(d.quantity, 0)::float8 AS quantity,
    (COALESCE(d.price, 0)::float8 - COALESCE(d.discount, 0)::float8) * COALESCE(d.quantity, 0)::float8 AS amount
  FROM orders o
  LEFT JOIN staff s ON s.branch = o.branch AND s.id = o.sold_by_id
  LEFT JOIN order_details d ON d.branch = o.branch AND d.order_id = o.id
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  WHERE o.raw->>'statusValue' = 'Phiếu tạm'
  ORDER BY o.branch, o.id, d.line_no`;

// Ton thuc theo ma hang cua 1 co so (retailer): tong `inventories[].onHand` (moi retailer chi co 1 kho
// "Chi nhanh trung tam"). Loc bang `p.code = ANY(...)` de dung unique index (branch, code).
const ON_HAND_BY_CODE_SQL = `
  SELECT p.code AS code, COALESCE(SUM((inv->>'onHand')::numeric), 0)::float8 AS on_hand
  FROM products p
  LEFT JOIN LATERAL jsonb_array_elements(COALESCE(p.raw->'inventories', '[]'::jsonb)) inv ON true
  WHERE p.branch = $1 AND p.code = ANY($2::text[])
  GROUP BY p.code`;

async function readOnHandByKey(db, dbBranch, productCodes) {
  const codes = [...new Set(productCodes.filter(Boolean))];
  const byKey = new Map();
  if (codes.length === 0) return byKey;
  const result = await db.query(ON_HAND_BY_CODE_SQL, [dbBranch, codes]);
  for (const row of (result && result.rows) || []) byKey.set(productKeyOf(row.code), toNumber(row.on_hand));
  return byKey;
}

/**
 * @param {object} [options]
 * @param {object|function} [options.pool] pool (hoac ham tra pool); mac dinh getPool() luc goi.
 * @param {function} [options.now] dong ho (ms) — test tiem vao.
 * @param {number} [options.ttlMs] thoi gian cache; {number} [options.staleMs] toi da dung ban cu khi loi.
 * @param {function} [options.readInTransit] doc hang dang van chuyen (mac dinh inTransitSource).
 * @param {function} [options.fetchOrderDetail] doc 1 don (mac dinh documentDetailRepository.getOrderDetail).
 */
function createKiotPendingOrdersRepository({
  pool,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  staleMs = DEFAULT_STALE_MS,
  readInTransit = readInTransitByCode,
  fetchOrderDetail = getOrderDetail
} = {}) {
  const getDb = () => (typeof pool === 'function' ? pool() : (pool || getPool()));
  let cache = null; // { result, at }
  let inflight = null;

  async function queryPendingOrders() {
    const db = getDb();
    const [ordersResult, inTransitByCode] = await Promise.all([
      db.query(PENDING_ORDERS_SQL),
      readInTransit(db)
    ]);
    const rows = (ordersResult && ordersResult.rows) || [];

    // Ton thuc theo (co so, ma) — chi cho cac san pham co trong dong don.
    const codesByBranch = new Map();
    for (const row of rows) {
      if (!row.product_code) continue;
      if (!codesByBranch.has(row.branch)) codesByBranch.set(row.branch, []);
      codesByBranch.get(row.branch).push(row.product_code);
    }
    const onHandByBranch = new Map();
    await Promise.all([...codesByBranch.entries()].map(async ([dbBranch, codes]) => {
      onHandByBranch.set(dbBranch, await readOnHandByKey(db, dbBranch, codes));
    }));

    // Gom theo don + dong hang.
    const orders = new Map(); // `${branch}|${orderId}` -> don
    const lines = [];
    for (const row of rows) {
      const orderKey = `${row.branch}|${row.order_id}`;
      if (!orders.has(orderKey)) {
        orders.set(orderKey, {
          branch: DB_TO_LIFECYCLE_BRANCH[row.branch] || '',
          code: String(row.code || ''),
          customerName: row.customer_name || '',
          saleName: row.sale_name || '',
          orderDate: row.order_date_text || '',
          orderDateKey: row.order_date_key || '',
          total: toNumber(row.total),
          dbBranch: row.branch
        });
      }
      if (row.product_code) {
        lines.push({
          orderKey,
          dbBranch: row.branch,
          productKey: productKeyOf(row.product_code),
          quantity: toNumber(row.quantity),
          amount: toNumber(row.amount)
        });
      }
    }

    const allocation = allocateSellable(lines, line => {
      const onHand = (onHandByBranch.get(line.dbBranch) || new Map()).get(line.productKey) || 0;
      return onHand + (inTransitByCode.get(line.productKey) || 0);
    });
    const sellableByOrder = new Map();
    lines.forEach((line, index) => {
      const part = allocation[index];
      if (!part || part.sellableAmount === null) return;
      sellableByOrder.set(line.orderKey, (sellableByOrder.get(line.orderKey) || 0) + part.sellableAmount);
    });

    const list = [...orders.entries()].map(([orderKey, order]) => {
      const { dbBranch, ...rest } = order;
      return { ...rest, sellableValue: Math.round(sellableByOrder.get(orderKey) || 0) };
    });
    // Moi nhat truoc (theo ngay dat that, khong theo chuoi hien thi), cung ngay thi theo ma.
    list.sort((a, b) => (a.orderDateKey < b.orderDateKey ? 1 : a.orderDateKey > b.orderDateKey ? -1 : a.code.localeCompare(b.code)));
    return { ok: true, stale: false, fetchedAt: new Date(now()).toISOString(), orders: list };
  }

  /**
   * Don Phieu tam cua ca 2 co so kem gia tri co ban. KHONG BAO GIO throw:
   * { ok, stale, fetchedAt, orders[] } — loi DB: ban cu (<= staleMs) danh dau stale, khong co thi { ok:false, orders:[] }.
   */
  async function readPendingOrders() {
    const current = now();
    if (cache && current - cache.at < ttlMs) return cache.result;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const result = await queryPendingOrders();
        cache = { result, at: now() };
        return result;
      } catch (error) {
        console.warn('[Lifecycle] Không đọc được đơn Phiếu tạm từ Kiot (hiển thị dữ liệu Sheet):', error.message);
        if (cache && now() - cache.at < staleMs) return { ...cache.result, stale: true };
        return { ok: false, stale: false, fetchedAt: null, orders: [], error: error.message };
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  function invalidate() { cache = null; }

  /**
   * Chi tiet 1 don cho hop thoai: dau chung + dong hang (documentDetailRepository.getOrderDetail), voi
   * don dang Phieu tam them ton thuc / dang van chuyen / so co ban tung dong. Don khac trang thai Phieu
   * tam: cac cot ton = null (ton hien tai khong co y nghia voi don da xuat). Nem loi 400/404 cua getOrderDetail.
   */
  async function readOrderDetail({ branch, code }) {
    const dbBranch = LIFECYCLE_TO_DB_BRANCH[branch];
    if (!dbBranch) throw makeError('Cơ sở không hợp lệ (HN hoặc SG).', 400, 'INVALID_BRANCH');
    const db = getDb();
    let detail;
    try {
      detail = await fetchOrderDetail({ code, branchCode: dbBranch, pool: db });
    } catch (error) {
      // getOrderDetail nem 400/404 khong kem `code`; gan ma de route tra {error, code} nhat quan.
      if (error && error.statusCode === 404 && !error.code) error.code = 'ORDER_NOT_FOUND';
      if (error && error.statusCode === 400 && !error.code) error.code = 'INVALID_REQUEST';
      throw error;
    }
    const isPending = detail.status === PHIEU_TAM;
    const orderLines = Array.isArray(detail.lines) ? detail.lines : [];

    let stock = null;
    if (isPending) {
      const [onHandByKey, inTransitByCode] = await Promise.all([
        readOnHandByKey(db, dbBranch, orderLines.map(line => String(line.productCode || '').trim())),
        readInTransit(db)
      ]);
      stock = { onHandByKey, inTransitByCode };
    }
    const allocation = isPending
      ? allocateSellable(
        orderLines.map(line => ({
          orderKey: 'detail', productKey: productKeyOf(line.productCode), quantity: line.quantity, amount: line.amount
        })),
        line => (stock.onHandByKey.get(line.productKey) || 0) + (stock.inTransitByCode.get(line.productKey) || 0)
      )
      : [];

    let sellableValue = 0;
    const lines = orderLines.map((line, index) => {
      const key = productKeyOf(line.productCode);
      const part = allocation[index] || { sellableQty: null, sellableAmount: null };
      const isService = isServiceProductKey(key);
      if (part.sellableAmount !== null) sellableValue += part.sellableAmount;
      return {
        ...line,
        isService,
        onHand: isPending && !isService ? (stock.onHandByKey.get(key) || 0) : null,
        inTransit: isPending && !isService ? (stock.inTransitByCode.get(key) || 0) : null,
        sellableQty: part.sellableQty,
        sellableAmount: part.sellableAmount === null ? null : Math.round(part.sellableAmount)
      };
    });
    return {
      ...detail,
      branch,
      phieuTam: isPending,
      lines,
      sellableValue: isPending ? Math.round(sellableValue) : null
    };
  }

  return { readPendingOrders, readOrderDetail, invalidate };
}

// Instance mac dinh dung pool that (getPool() duoc goi luc can, khong luc nap module).
const kiotPendingOrders = createKiotPendingOrdersRepository();

module.exports = {
  createKiotPendingOrdersRepository,
  kiotPendingOrders,
  LIFECYCLE_TO_DB_BRANCH,
  DB_TO_LIFECYCLE_BRANCH,
  __test__: { allocateSellable, productKeyOf, isServiceProductKey, PENDING_ORDERS_SQL, ON_HAND_BY_CODE_SQL }
};
