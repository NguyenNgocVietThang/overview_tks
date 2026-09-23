'use strict';

// Tinh lai bang product_report ("Bao cao hang hoa", tab Tong quan) - xem ke
// hoach da duyet "mutable-summit" va server/db/migrations/0018_product_report.sql.
// Khac voi refreshDashboardRollups (chay moi 5 phut, idempotent re per-branch
// window), bang nay CHI duoc phep tinh lai 1 LAN/DEM (quet 90 ngay hoa don ca
// 2 co so la truy van nang, khong nen chay lien tuc — vua ton tai nguyen
// Supabase vua khong dung yeu cau "cap nhat 1 lan luc 0h" cua nguoi dung).
// Pattern: ham thuan refreshProductReport tach khoi ham co dieu kien
// refreshProductReportIfDue, tach tiep khoi ham dang ky lich
// startProductReportSchedule (setIntervalFn injectable de test), dung dung
// pattern webhookEventsCleanup.js / dashboardRollupRefresh.js.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const { getPool } = require('../db/pool');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

// "Thanh tien" tren 1 dong invoice_details - dung LAI CHINH XAC dinh nghia da
// co o customerProductTopRepository.js/dashboardRollupRefresh.js (khong import
// truc tiep de tranh phu thuoc chuoi giua 2 module rollup doc lap - cong thuc
// da on dinh tu 2026-09).
const DETAIL_AMOUNT_SQL = `CASE
    WHEN d.raw ? 'subTotal' THEN COALESCE((d.raw->>'subTotal')::float8, 0)
    ELSE COALESCE(d.price, 0)::float8 * COALESCE(d.quantity, 0)::float8 - COALESCE(d.discount, 0)::float8
  END`;

// LUU Y MUI GIO / TRANG THAI: giong het quy uoc trong dashboardRollupRefresh.js
// - cot purchase_date/order_date/sale_date luu "gio treo tuong VN mang nhan
// UTC" (doc bang AT TIME ZONE 'UTC'), con moc "hom nay theo lich VN" phai lay
// tu now() THAT qua AT TIME ZONE 'Asia/Ho_Chi_Minh'. "Hoa don hop le" dung
// CHUNG 1 dinh nghia (statusValue != 'Đã hủy') cho ca doanh so 90 ngay (G) va
// doanh so khach lon nhat (I) de ty trong K = I/G khong bao gio vuot 100%
// (file Sheets cu dung 2 cong thuc khac nhau nen co dong K > 100%, xem ke
// hoach da duyet).
const REFRESH_SQL = `
  WITH vn_today AS (
    SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today
  ),
  hn_products AS (
    SELECT
      p.code,
      COALESCE(NULLIF(p.raw->>'fullName', ''), p.name) AS name,
      (SELECT COALESCE(SUM(COALESCE((inv->>'onHand')::float8, 0)), 0)
         FROM jsonb_array_elements(COALESCE(p.raw->'inventories', '[]'::jsonb)) inv) AS on_hand
    FROM products p
    WHERE p.branch = 'hanoi' AND COALESCE(p.code, '') <> ''
  ),
  sg_products AS (
    SELECT
      p.code,
      (SELECT COALESCE(SUM(COALESCE((inv->>'onHand')::float8, 0)), 0)
         FROM jsonb_array_elements(COALESCE(p.raw->'inventories', '[]'::jsonb)) inv) AS on_hand
    FROM products p
    WHERE p.branch = 'saigon' AND COALESCE(p.code, '') <> ''
  ),
  pending_orders AS (
    -- "Dat hang cua khach" (bang orders, KHONG PHAI purchases-NCC) dang o
    -- trang thai chua hoan tat - so nay bi tru khoi ton kha ban vi da bi giu
    -- cho, khac voi phieu nhap NCC (se CONG them khi ve, khong tru).
    SELECT
      lower(btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, ''))) AS product_key,
      SUM(COALESCE(d.quantity, 0))::float8 AS qty
    FROM order_details d
    JOIN orders o ON o.branch = d.branch AND o.id = d.order_id
    LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
    WHERE d.branch = ANY($1::text[])
      AND COALESCE(o.raw->>'statusValue', '') IN ('Phiếu tạm', 'Đang xử lý', 'Đã xác nhận')
    GROUP BY 1
  ),
  sales_30d AS (
    SELECT p.code AS product_code, SUM(dps.qty)::float8 AS qty
    FROM daily_product_sales dps
    JOIN products p ON p.branch = dps.branch AND p.id = dps.product_id
    CROSS JOIN vn_today
    WHERE dps.sale_date >= vn_today.today - 30 AND dps.sale_date <= vn_today.today - 1
    GROUP BY p.code
  ),
  sales_90d AS (
    SELECT p.code AS product_code, SUM(dps.revenue)::float8 AS revenue
    FROM daily_product_sales dps
    JOIN products p ON p.branch = dps.branch AND p.id = dps.product_id
    CROSS JOIN vn_today
    WHERE dps.sale_date >= vn_today.today - 90 AND dps.sale_date <= vn_today.today - 1
    GROUP BY p.code
  ),
  sales90_lines AS (
    SELECT
      lower(btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, ''))) AS product_key,
      CASE
        WHEN COALESCE(NULLIF(i.raw->>'customerCode', ''), c.code, '') <> ''
          THEN 'code:' || lower(COALESCE(NULLIF(i.raw->>'customerCode', ''), c.code, ''))
        ELSE 'name:' || lower(COALESCE(NULLIF(i.raw->>'customerName', ''), NULLIF(c.name, ''), 'Khách lẻ'))
      END AS customer_key,
      COALESCE(NULLIF(i.raw->>'customerName', ''), NULLIF(c.name, ''), 'Khách lẻ') AS customer_name,
      ${DETAIL_AMOUNT_SQL} AS amount
    FROM invoice_details d
    JOIN invoices i ON i.branch = d.branch AND i.id = d.invoice_id
    LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
    LEFT JOIN customers c ON c.branch = i.branch AND c.id = i.customer_id
    CROSS JOIN vn_today
    WHERE d.branch = ANY($1::text[])
      AND COALESCE(i.raw->>'statusValue', '') != 'Đã hủy'
      AND i.purchase_date >= ((vn_today.today - 90)::timestamp AT TIME ZONE 'UTC')
      AND i.purchase_date <  (vn_today.today::timestamp AT TIME ZONE 'UTC')
  ),
  customer_agg AS (
    SELECT product_key, customer_key, MIN(customer_name) AS customer_name, SUM(amount) AS revenue
    FROM sales90_lines
    WHERE product_key <> ''
    GROUP BY product_key, customer_key
  ),
  customer_ranked AS (
    SELECT
      product_key, customer_name, revenue,
      ROW_NUMBER() OVER (PARTITION BY product_key ORDER BY revenue DESC) AS rn,
      COUNT(*) OVER (PARTITION BY product_key) AS customer_count
    FROM customer_agg
  ),
  customer_top AS (
    SELECT product_key, customer_name AS top_customer_name, revenue AS top_customer_revenue, customer_count
    FROM customer_ranked
    WHERE rn = 1
  )
  INSERT INTO product_report (
    product_code, product_name, stock_hanoi, stock_saigon, available_to_sell,
    qty_sold_30d, revenue_90d, customer_count_90d, top_customer_revenue_90d,
    top_customer_name, top_customer_share, computed_at
  )
  SELECT
    hn.code,
    hn.name,
    hn.on_hand,
    COALESCE(sg.on_hand, 0),
    hn.on_hand + COALESCE(sg.on_hand, 0) - COALESCE(po.qty, 0),
    COALESCE(s30.qty, 0),
    COALESCE(s90.revenue, 0),
    COALESCE(ct.customer_count, 0),
    COALESCE(ct.top_customer_revenue, 0),
    ct.top_customer_name,
    CASE WHEN COALESCE(s90.revenue, 0) > 0 THEN COALESCE(ct.top_customer_revenue, 0) / s90.revenue ELSE NULL END,
    now()
  FROM hn_products hn
  LEFT JOIN sg_products sg ON sg.code = hn.code
  LEFT JOIN pending_orders po ON po.product_key = lower(btrim(hn.code))
  LEFT JOIN sales_30d s30 ON s30.product_code = hn.code
  LEFT JOIN sales_90d s90 ON s90.product_code = hn.code
  LEFT JOIN customer_top ct ON ct.product_key = lower(btrim(hn.code))`;

/**
 * Tinh lai TOAN BO bang product_report (khong theo tung co so - bang gom ca
 * 2 co so tren 1 dong/ma hang). Xoa trang roi nap lai trong 1 transaction de
 * khong co trang thai "nua vơi" neu loi giua chung.
 */
async function refreshProductReport(pool, { log = console.log } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE product_report');
    const result = await client.query(REFRESH_SQL, [BRANCH_CODES]);
    await client.query('COMMIT');
    log(`[productReportRefresh] Da tinh lai ${result.rowCount || 0} ma hang.`);
    return { rowCount: result.rowCount || 0 };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function vnDateKey(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  return formatter.format(date);
}

/**
 * Chi tinh lai neu CHUA tinh cho ngay lich VN hien tai - goi moi 5 phut (nhu
 * cac job dong bo khac) nhung hau het cac lan chi la 1 SELECT re roi bo qua,
 * dam bao truy van 90-ngay nang chi chay dung 1 lan/dem.
 */
async function refreshProductReportIfDue(pool, { log = console.log, now = () => new Date() } = {}) {
  const today = vnDateKey(now());
  const { rows } = await pool.query('SELECT MAX(computed_at) AS last_computed_at FROM product_report');
  const lastComputedAt = rows[0] && rows[0].last_computed_at;
  if (lastComputedAt && vnDateKey(new Date(lastComputedAt)) === today) {
    return { skipped: true };
  }
  const { rowCount } = await refreshProductReport(pool, { log });
  return { skipped: false, rowCount };
}

function startProductReportSchedule(pool, {
  intervalMs = 5 * 60 * 1000,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  log = console.log
} = {}) {
  scheduleImmediate(() => {
    refreshProductReportIfDue(pool, { log }).catch((error) => {
      log(`[productReportRefresh] Loi khi tinh lan dau: ${error.message}`);
    });
  });
  return setIntervalFn(() => {
    refreshProductReportIfDue(pool, { log }).catch((error) => {
      log(`[productReportRefresh] Loi khi kiem tra/tinh lai: ${error.message}`);
    });
  }, intervalMs);
}

async function main() {
  const pool = getPool();
  const result = await refreshProductReport(pool);
  console.log(`[productReportRefresh] Hoan tat, ${result.rowCount} ma hang.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[productReportRefresh] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  refreshProductReport,
  refreshProductReportIfDue,
  startProductReportSchedule,
  __sql__: { REFRESH_SQL },
  __test__: { vnDateKey }
};
