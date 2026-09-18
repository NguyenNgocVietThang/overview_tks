'use strict';

// Refresh dinh ky 4 bang rollup theo ngay dung cho trang "Bao cao tong hop"
// cua Dashboard (xem server/db/migrations/0013_dashboard_rollups.sql va ke
// hoach da duyet "melodic-juggling-karp"). Theo dung pattern
// webhookEventsCleanup.js: ham thuan (refreshDashboardRollups) tach khoi ham
// dang ky lich (startDashboardRollupSchedule), setIntervalFn injectable de
// test khong phai cho interval that.
//
// Idempotent: moi bang dung INSERT ... ON CONFLICT DO UPDATE nen chay lai
// nhieu lan (polling 5 phut, hoac chay tay lai) deu an toan.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const { getConfiguredBranches } = require('./config');
const { getPool } = require('../db/pool');
const { DETAIL_AMOUNT_SQL } = require('../dashboard/customerProductTopRepository');

const DEFAULT_WINDOW_DAYS = 400;

// LUU Y MUI GIO (khac voi dashboardPgReader.js): `now()` la TIMESTAMPTZ THAT,
// gan dung nhan mui gio, KHAC voi cac cot purchase_date/sale_date (luu "gio
// treo tuong VN mang nhan UTC" — doc dung phai qua `AT TIME ZONE 'UTC'`, xem
// dau file dashboardPgReader.js). Vi vay de tinh moc "N ngay truoc, theo lich
// VN" tu THOI DIEM THAT (`now()`), phai doi no ve gio VN bang
// `AT TIME ZONE 'Asia/Ho_Chi_Minh'` (dung 'UTC' o day se lech den +7h vao
// khoang 00h-07h gio VN) — roi moi so sanh voi cac cot da quy doi qua
// `AT TIME ZONE 'UTC'` (2 phep doi khac nhau nhung cung tra ra "ngay lich VN").
//
// LUU Y VE MA TRANG THAI: KHONG duoc gia dinh y nghia so status (vd "3 =
// Hoan thanh") - da doi chieu truc tiep du lieu that tren Supabase 2026-09-18
// (ca 2 co so) va phat hien so KHONG co y nghia co dinh giua cac entity:
// invoices status=1 la "Hoan thanh" (status=3 la "Dang xu ly", CHI 7 dong o
// Ha Noi) - nguoc hoan toan voi gia dinh ban dau (status=3="Hoan thanh") tung
// khien ban dau cua file nay loc SAI, lam daily_invoice_summary gan nhu rong.
// Luon loc theo `raw->>'statusValue'` (chuoi that tu KiotViet, xem
// dashboardPgReader.js statusLabel()), khong loc theo so.
//
// $1 branch, $2 so ngay cua so (int) - chi tinh lai hoa don trong N ngay gan
// nhat. revenue/invoice_count CHI tinh statusValue='Hoàn thành'; cancelled_count
// la statusValue='Đã hủy', rieng cho KPI "hom nay" - KHONG duoc tron 2 dieu
// kien nay voi daily_product_sales (dieu kien khac nhau, xem SCHEMA.md).
const INVOICE_SUMMARY_SQL = `
  INSERT INTO daily_invoice_summary (branch, sale_date, revenue, invoice_count, cancelled_count)
  SELECT
    $1,
    (purchase_date AT TIME ZONE 'UTC')::date AS sale_date,
    COALESCE(SUM(total) FILTER (WHERE raw->>'statusValue' = 'Hoàn thành'), 0) AS revenue,
    COUNT(*) FILTER (WHERE raw->>'statusValue' = 'Hoàn thành') AS invoice_count,
    COUNT(*) FILTER (WHERE raw->>'statusValue' = 'Đã hủy') AS cancelled_count
  FROM invoices
  WHERE branch = $1
    AND purchase_date IS NOT NULL
    AND (purchase_date AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - $2::int
  GROUP BY (purchase_date AT TIME ZONE 'UTC')::date
  ON CONFLICT (branch, sale_date) DO UPDATE SET
    revenue = EXCLUDED.revenue,
    invoice_count = EXCLUDED.invoice_count,
    cancelled_count = EXCLUDED.cancelled_count,
    updated_at = now()`;

// "Thanh tien" tren tung dong = DETAIL_AMOUNT_SQL (tai dung chinh xac tu
// customerProductTopRepository.js, alias "d" cho invoice_details). Dieu kien
// hoa don statusValue != 'Đã hủy' (gom ca "Hoàn thành" lan "Đang xử lý"/"Phiếu
// tạm"), khac han dieu kien cua daily_invoice_summary o tren - dung THEO
// TEXT, khong dung so (xem ghi chu mui gio/trang thai o tren).
const PRODUCT_SALES_SQL = `
  INSERT INTO daily_product_sales (branch, sale_date, product_id, qty, revenue)
  SELECT
    $1,
    (i.purchase_date AT TIME ZONE 'UTC')::date AS sale_date,
    d.product_id,
    COALESCE(SUM(COALESCE(d.quantity, 0)::float8), 0) AS qty,
    COALESCE(SUM(${DETAIL_AMOUNT_SQL}), 0) AS revenue
  FROM invoice_details d
  JOIN invoices i ON i.branch = d.branch AND i.id = d.invoice_id
  WHERE d.branch = $1
    AND COALESCE(i.raw->>'statusValue', '') != 'Đã hủy'
    AND d.product_id IS NOT NULL
    AND i.purchase_date IS NOT NULL
    AND (i.purchase_date AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - $2::int
  GROUP BY (i.purchase_date AT TIME ZONE 'UTC')::date, d.product_id
  ON CONFLICT (branch, sale_date, product_id) DO UPDATE SET
    qty = EXCLUDED.qty,
    revenue = EXCLUDED.revenue,
    updated_at = now()`;

// Gop THANG tren bang purchases - KHONG join purchase_details (khong can cho
// "tong tien nhap theo NCC theo ngay", va join se keo lai dung join nang da
// gay ra van de hieu nang ban dau). 0 = "(Khong xac dinh)" cho supplier_id NULL.
const PURCHASE_SUMMARY_SQL = `
  INSERT INTO daily_purchase_summary (branch, purchase_date, supplier_id, order_count, total)
  SELECT
    $1,
    (purchase_date AT TIME ZONE 'UTC')::date AS purchase_date,
    COALESCE(supplier_id, 0) AS supplier_id,
    COUNT(*) AS order_count,
    COALESCE(SUM(total), 0) AS total
  FROM purchases
  WHERE branch = $1
    AND purchase_date IS NOT NULL
    AND (purchase_date AT TIME ZONE 'UTC')::date >= (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date - $2::int
  GROUP BY (purchase_date AT TIME ZONE 'UTC')::date, COALESCE(supplier_id, 0)
  ON CONFLICT (branch, purchase_date, supplier_id) DO UPDATE SET
    order_count = EXCLUDED.order_count,
    total = EXCLUDED.total,
    updated_at = now()`;

// $1 branch CHI - khong gioi han cua so ngay (ngay nhap dau tien co the xa
// hon 400 ngay va van can dung cho "Hang moi nhap"). LEAST() khi conflict de
// khong mat moc cu hon neu du lieu duoc backfill them sau.
const FIRST_PURCHASE_SQL = `
  INSERT INTO product_first_purchase (branch, product_id, first_purchase_date)
  SELECT $1, d.product_id, MIN(pu.purchase_date) AS first_purchase_date
  FROM purchase_details d
  JOIN purchases pu ON pu.branch = d.branch AND pu.id = d.purchase_id
  WHERE d.branch = $1
    AND d.product_id IS NOT NULL
    AND pu.purchase_date IS NOT NULL
  GROUP BY d.product_id
  ON CONFLICT (branch, product_id) DO UPDATE SET
    first_purchase_date = LEAST(product_first_purchase.first_purchase_date, EXCLUDED.first_purchase_date),
    updated_at = now()`;

/**
 * Chay lai toan bo 4 bang rollup cho tung co so da cau hinh credentials.
 * Idempotent (UPSERT), an toan chay lai nhieu lan/gap loi giua duong.
 * @returns {Promise<Array<{branch, dailyInvoiceSummary, dailyProductSales, dailyPurchaseSummary, productFirstPurchase}>>}
 */
async function refreshDashboardRollups(pool, {
  windowDays = DEFAULT_WINDOW_DAYS,
  getConfiguredBranches: getBranches = getConfiguredBranches,
  log = console.log
} = {}) {
  const branches = getBranches().map((item) => item.branch);
  const results = [];

  for (const branch of branches) {
    const invoiceSummary = await pool.query(INVOICE_SUMMARY_SQL, [branch, windowDays]);
    const productSales = await pool.query(PRODUCT_SALES_SQL, [branch, windowDays]);
    const purchaseSummary = await pool.query(PURCHASE_SUMMARY_SQL, [branch, windowDays]);
    const firstPurchase = await pool.query(FIRST_PURCHASE_SQL, [branch]);

    const row = {
      branch,
      dailyInvoiceSummary: invoiceSummary.rowCount || 0,
      dailyProductSales: productSales.rowCount || 0,
      dailyPurchaseSummary: purchaseSummary.rowCount || 0,
      productFirstPurchase: firstPurchase.rowCount || 0
    };
    results.push(row);
    log(`[dashboardRollupRefresh] ${branch}: daily_invoice_summary=${row.dailyInvoiceSummary}, ` +
      `daily_product_sales=${row.dailyProductSales}, daily_purchase_summary=${row.dailyPurchaseSummary}, ` +
      `product_first_purchase=${row.productFirstPurchase}`);
  }

  return results;
}

function startDashboardRollupSchedule(pool, {
  intervalMs = 5 * 60 * 1000, windowDays = DEFAULT_WINDOW_DAYS,
  setIntervalFn = setInterval, log = console.log,
  getConfiguredBranches: getBranches = getConfiguredBranches
} = {}) {
  return setIntervalFn(() => {
    refreshDashboardRollups(pool, { windowDays, log, getConfiguredBranches: getBranches }).catch((error) => {
      log(`[dashboardRollupRefresh] Loi khi refresh: ${error.message}`);
    });
  }, intervalMs);
}

async function main() {
  const pool = getPool();
  const results = await refreshDashboardRollups(pool);
  console.log(`[dashboardRollupRefresh] Hoan tat, ${results.length} co so.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[dashboardRollupRefresh] That bai: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  refreshDashboardRollups,
  startDashboardRollupSchedule,
  DEFAULT_WINDOW_DAYS,
  __sql__: { INVOICE_SUMMARY_SQL, PRODUCT_SALES_SQL, PURCHASE_SUMMARY_SQL, FIRST_PURCHASE_SQL }
};
