'use strict';

// Ma trang thai hoa don, lay tu src-dashboard/kiotviet/SheetSchemas.gs:361
// (ham kiotVietStatus_, fallback map khi KiotViet khong tra StatusValue text):
// { 1: 'Phieu tam', 2: 'Da huy', 3: 'Hoan thanh' }. Postgres luu nguyen ma so
// (xem PlanDB.md §3.6), khong suy dien nhan moi - day la doi chieu tu code
// GAS hien co, khong phai gia dinh moi.
const INVOICE_STATUS = { DRAFT: 1, CANCELLED: 2, COMPLETED: 3 };

async function getRevenueToday(pool, branchId, todayDateStr) {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(total_amount) FILTER (WHERE status = $2), 0) AS revenue_today,
       COUNT(*) FILTER (WHERE status = $2) AS invoices_today,
       COUNT(*) FILTER (WHERE status = $3) AS cancelled_today
     FROM invoices
     WHERE branch_id = $1
       AND (purchase_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date = $4::date`,
    [branchId, INVOICE_STATUS.COMPLETED, INVOICE_STATUS.CANCELLED, todayDateStr]
  );
  const row = rows[0];
  return {
    revenueToday: Number(row.revenue_today),
    invoicesToday: Number(row.invoices_today),
    cancelledToday: Number(row.cancelled_today)
  };
}

// Dung to_char() de Postgres tra ve chuoi TEXT 'YYYY-MM-DD' truc tiep, KHONG
// tra ve kieu DATE roi xu ly bang Date.toISOString() phia client - pg-types
// (dependency ghim cung cua pg@8.23.0, xem server/package-lock.json) dang ke
// hoach oid 1082 (DATE) toi `parseDate` cua goi `postgres-date` (lib/textParsers.js:174,
// verified via node_modules/pg-types@2.2.0). Ham do (postgres-date/index.js:74-75,
// comment goc "YYYY-MM-DD will be parsed as local time") dung
// `new Date(year, month-1, day)` - constructor 3-tham-so nay LUON theo
// timezone LOCAL cua tien trinh Node (khong phai UTC), day KHONG phai hanh vi
// rieng cua pg. Goi toISOString() (quy ve UTC) tren gia tri do se lech ngay
// neu may chay o timezone +07:00 (vi du VN). Khong duoc document chinh thuc o
// node-postgres.com (trang /apis/types tu nhan "these docs are incomplete");
// day la ket luan doc truc tiep tu source code da cai, khong phai suy dien.
// Tra chuoi da format san (to_char) tranh hoan toan van de nay.
async function getRevenueByDay(pool, branchId, range) {
  const { rows } = await pool.query(
    `SELECT to_char(purchase_date AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') AS day,
            SUM(total_amount) AS revenue,
            COUNT(*) AS invoice_count
     FROM invoices
     WHERE branch_id = $1 AND status = $2
       AND ($3::timestamptz IS NULL OR purchase_date >= $3)
       AND ($4::timestamptz IS NULL OR purchase_date <= $4)
     GROUP BY 1
     ORDER BY 1`,
    [branchId, INVOICE_STATUS.COMPLETED, range.from, range.to]
  );
  return rows.map((r) => ({
    date: r.day,
    revenue: Number(r.revenue),
    count: Number(r.invoice_count)
  }));
}

async function getRecentInvoices(pool, branchId, range, limit) {
  const { rows } = await pool.query(
    `SELECT invoice_code AS code, customer_name_snapshot AS customer, total_amount AS total, status, purchase_date
     FROM invoices
     WHERE branch_id = $1
       AND ($2::timestamptz IS NULL OR purchase_date >= $2)
       AND ($3::timestamptz IS NULL OR purchase_date <= $3)
     ORDER BY purchase_date DESC
     LIMIT $4`,
    [branchId, range.from, range.to, limit]
  );
  return rows.map((r) => ({
    code: r.code,
    customer: r.customer,
    total: Number(r.total),
    status: r.status,
    time: r.purchase_date.toISOString()
  }));
}

async function getCancelledCount(pool, branchId, range) {
  const { rows } = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM invoices
     WHERE branch_id = $1 AND status = $2
       AND ($3::timestamptz IS NULL OR purchase_date >= $3)
       AND ($4::timestamptz IS NULL OR purchase_date <= $4)`,
    [branchId, INVOICE_STATUS.CANCELLED, range.from, range.to]
  );
  return Number(rows[0].cnt);
}

// Chi loai tru hoa don DA HUY (status=2), GIU LAI Phieu tam (status=1) -
// dung y het dieu kien "!invoiceEntry.isCancelled" o dashboardData.js:1721,
// khac voi getRevenueToday/getRevenueByDay chi tinh status=3.
async function getTopSellingProducts(pool, branchId, range, limit) {
  const { rows } = await pool.query(
    `SELECT ili.product_code_snapshot AS code, ili.product_name_snapshot AS name,
            SUM(ili.quantity) AS qty, SUM(ili.line_amount) AS revenue
     FROM invoice_line_items ili
     JOIN invoices i ON i.id = ili.invoice_id
     WHERE i.branch_id = $1 AND i.status <> $2
       AND ($3::timestamptz IS NULL OR i.purchase_date >= $3)
       AND ($4::timestamptz IS NULL OR i.purchase_date <= $4)
     GROUP BY ili.product_code_snapshot, ili.product_name_snapshot
     ORDER BY revenue DESC
     LIMIT $5`,
    [branchId, INVOICE_STATUS.CANCELLED, range.from, range.to, limit]
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    qty: Number(r.qty),
    revenue: Number(r.revenue)
  }));
}

// Quy moi san pham ve nhom cha GOC (parent_category_id IS NULL), di theo dung
// thuat toan findRoot() cua buildParentCategoryResolver o dashboardData.js:228
// (khong phai chi 1 cap cha-con - co the nhieu cap).
async function getTopSellingParentCategories(pool, branchId, range, limit) {
  const { rows } = await pool.query(
    `WITH RECURSIVE cat_root AS (
       SELECT id, name, parent_category_id, id AS start_id
       FROM categories
       WHERE branch_id = $1
       UNION ALL
       SELECT c.id, c.name, c.parent_category_id, cr.start_id
       FROM categories c
       JOIN cat_root cr ON c.id = cr.parent_category_id
     ),
     roots AS (
       SELECT start_id, name AS root_name
       FROM cat_root
       WHERE parent_category_id IS NULL
     )
     SELECT COALESCE(r.root_name, 'Chưa xác định') AS name,
            SUM(ili.quantity) AS qty,
            SUM(ili.line_amount) AS revenue,
            COUNT(DISTINCT p.id) AS product_count
     FROM invoice_line_items ili
     JOIN invoices i ON i.id = ili.invoice_id
     LEFT JOIN products p ON p.id = ili.product_id
     LEFT JOIN roots r ON r.start_id = p.category_id
     WHERE i.branch_id = $1 AND i.status <> $2
       AND ($3::timestamptz IS NULL OR i.purchase_date >= $3)
       AND ($4::timestamptz IS NULL OR i.purchase_date <= $4)
     GROUP BY COALESCE(r.root_name, 'Chưa xác định')
     ORDER BY revenue DESC
     LIMIT $5`,
    [branchId, INVOICE_STATUS.CANCELLED, range.from, range.to, limit]
  );
  return rows.map((r) => ({
    name: r.name,
    qty: Number(r.qty),
    revenue: Number(r.revenue),
    productCount: Number(r.product_count)
  }));
}

module.exports = {
  INVOICE_STATUS,
  getRevenueToday,
  getRevenueByDay,
  getRecentInvoices,
  getCancelledCount,
  getTopSellingProducts,
  getTopSellingParentCategories
};
