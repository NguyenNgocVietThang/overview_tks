'use strict';

// SQL cua Bao cao kinh doanh. Cung 1 cau SELECT dung cho (a) job chot thang
// (kiotvietSync/businessMonthlyRefresh.js, INSERT...SELECT) va (b) API tinh truc tiep
// thang chua chot (businessReportRepository.js) => so chot va so live khong lech cong thuc.
// $1 text[] co so, $2 date dau khung, $3 date cuoi khung (KHONG gom). Khung viet tren
// cot goc de dung duoc index (bai hoc su co IO 2026-09-28).

const {
  DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE
} = require('../kiotvietSync/salesSqlFragments');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);

const range = column => `${column} >= ($2::date::timestamp AT TIME ZONE 'UTC')
    AND ${column} < ($3::date::timestamp AT TIME ZONE 'UTC')`;
const customerCode = alias => `COALESCE(NULLIF(btrim(${alias}.raw->>'customerCode'), ''), cbn.code, '')`;
const nameKey = alias => normalizedNameSql(`COALESCE(NULLIF(${alias}.raw->>'customerName', ''), 'Khách lẻ')`);

// Chung tu trong khung + khach khop theo ten. Khoa ten (NFKC + regexp) tinh 1 LAN/chung tu
// trong subquery, roi join customer_by_name bang so bang thuan. OFFSET 0 la rao chan
// planner gop subquery: thieu no, planner keo phep chuan hoa vao Join Filter cua Merge Join
// chi theo branch (vi uoc tinh sai so hoa don do dieu kien trang thai la bieu thuc) va tinh
// lai cho MOI cap chung tu x khach => do that 2026-10-07: ~87s thang dang chay, >120s thang
// du; co rao: <1s / ~2s. KHONG bo OFFSET 0, KHONG dua normalizedNameSql lai vao ON.
const invoicesWithCustomer = `(SELECT i.branch, i.id, i.purchase_date, i.total, i.raw, ${nameKey('i')} AS name_key
      FROM invoices i
      WHERE i.branch = ANY($1::text[]) AND ${range('i.purchase_date')}
        AND ${INVOICE_STATUS_SQL} = 'Hoàn thành' AND btrim(i.code) <> ''
      OFFSET 0) i
    LEFT JOIN customer_by_name cbn ON cbn.branch = i.branch AND cbn.name_key = i.name_key`;
const returnsWithCustomer = `(SELECT r.branch, r.id, r.return_date, r.total, r.raw, ${nameKey('r')} AS name_key
      FROM returns r
      WHERE r.branch = ANY($1::text[]) AND ${range('r.return_date')}
        AND r.raw->>'statusValue' = 'Đã trả' AND btrim(r.code) <> ''
      OFFSET 0) r
    LEFT JOIN customer_by_name cbn ON cbn.branch = r.branch AND cbn.name_key = r.name_key`;

const CUSTOMER_MONTH_SELECT_SQL = `${CUSTOMER_BY_NAME_CTE},
  docs AS (
    SELECT i.branch, ${customerCode('i')} AS customer_code,
           COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ') AS customer_name, i.purchase_date AS at,
           COALESCE(i.total, 0)::numeric AS invoice_amount, 0::numeric AS return_amount, 1 AS invoice_count, 0 AS return_count
    FROM ${invoicesWithCustomer}
    UNION ALL
    SELECT r.branch, ${customerCode('r')},
           COALESCE(NULLIF(r.raw->>'customerName', ''), 'Khách lẻ'), r.return_date,
           0::numeric, abs(COALESCE(r.total, 0))::numeric, 0, 1
    FROM ${returnsWithCustomer}
  )
  SELECT branch, customer_code,
         (array_agg(customer_name ORDER BY at DESC))[1] AS customer_name,
         SUM(invoice_amount) AS invoice_amount, SUM(return_amount) AS return_amount,
         SUM(invoice_amount) - SUM(return_amount) AS net_revenue,
         SUM(invoice_count)::int AS invoice_count, SUM(return_count)::int AS return_count
  FROM docs
  GROUP BY branch, customer_code`;

// Phan bo tong chung tu (da tru giam gia ca don / giam gia tra) cho tung dong theo ty le
// thanh tien dong => tong theo ma hang = tong theo khach. Chung tu co tong thanh tien
// dong = 0 thi khong phan bo (dong = 0).
const CUSTOMER_PRODUCT_MONTH_SELECT_SQL = `${CUSTOMER_BY_NAME_CTE},
  lines AS (
    SELECT i.branch, ${customerCode('i')} AS customer_code,
           COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
           COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
           COALESCE(d.quantity, 0)::numeric AS qty,
           (${DETAIL_AMOUNT_SQL})::numeric AS line_amount,
           COALESCE(i.total, 0)::numeric AS doc_total,
           'i:' || i.branch || ':' || i.id AS doc_key
    FROM ${invoicesWithCustomer}
    JOIN invoice_details d ON d.branch = i.branch AND d.invoice_id = i.id
    LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
    UNION ALL
    SELECT r.branch, ${customerCode('r')},
           COALESCE(NULLIF(rd.raw->>'productCode', ''), p.code, ''),
           COALESCE(NULLIF(rd.raw->>'productName', ''), p.name, ''),
           -abs(COALESCE(rd.quantity, 0))::numeric,
           (${RETURN_AMOUNT_SQL})::numeric,
           -abs(COALESCE(r.total, 0))::numeric,
           'r:' || r.branch || ':' || r.id
    FROM ${returnsWithCustomer}
    JOIN return_details rd ON rd.branch = r.branch AND rd.return_id = r.id
    LEFT JOIN products p ON p.branch = rd.branch AND p.id = rd.product_id
  ),
  allocated AS (
    SELECT branch, customer_code, product_code, product_name, qty,
           CASE WHEN SUM(line_amount) OVER w = 0 THEN 0
                ELSE doc_total * line_amount / SUM(line_amount) OVER w END AS amount
    FROM lines
    WINDOW w AS (PARTITION BY doc_key)
  )
  SELECT branch, customer_code, product_code, MAX(product_name) AS product_name,
         round(SUM(amount), 2) AS net_revenue, SUM(qty) AS net_qty
  FROM allocated
  WHERE product_code <> ''
  GROUP BY branch, customer_code, product_code`;

// Khach hien tai: cung quy tac canonical voi directory (co so, ma trim, id moi nhat).
const CURRENT_CUSTOMER_GROUPS_SQL = `
  SELECT DISTINCT ON (branch, btrim(code)) branch, btrim(code) AS code, id,
         COALESCE(NULLIF(btrim(raw->>'groups'), ''), 'Chưa phân nhóm') AS sale_name
  FROM customers
  WHERE btrim(COALESCE(code, '')) <> ''
  ORDER BY branch, btrim(code), id DESC`;

// JSON giu ranh gioi branch/code/nhom, ORDER BY cho hash on dinh qua restart.
const GROUP_HASH_SQL = `SELECT md5(COALESCE(jsonb_agg(jsonb_build_array(branch, code, sale_name)
  ORDER BY branch, code)::text, '[]')) AS group_hash FROM (${CURRENT_CUSTOMER_GROUPS_SQL}) g`;

const FREEZE_CUSTOMER_SQL = `
  INSERT INTO business_monthly_customer_sales
    (month, branch, customer_code, customer_id, customer_name, invoice_amount, return_amount, net_revenue, invoice_count, return_count)
  SELECT $2::date, q.branch, q.customer_code, c.id, q.customer_name, q.invoice_amount, q.return_amount,
         q.net_revenue, q.invoice_count, q.return_count
  FROM (${CUSTOMER_MONTH_SELECT_SQL}) q
  LEFT JOIN (${CURRENT_CUSTOMER_GROUPS_SQL}) c ON c.branch = q.branch AND c.code = q.customer_code`;

const FREEZE_CUSTOMER_PRODUCT_SQL = `
  INSERT INTO business_monthly_customer_product_sales
    (month, branch, customer_code, product_code, product_name, net_revenue, net_qty)
  SELECT $2::date, q.branch, q.customer_code, q.product_code, q.product_name, q.net_revenue, q.net_qty
  FROM (${CUSTOMER_PRODUCT_MONTH_SELECT_SQL}) q`;

const FREEZE_PRODUCT_SQL = `
  INSERT INTO business_monthly_product_sales (month, product_code, product_name, net_revenue, net_qty)
  SELECT month, product_code, MAX(product_name), SUM(net_revenue), SUM(net_qty)
  FROM business_monthly_customer_product_sales
  WHERE month = $1::date
  GROUP BY month, product_code`;

// Dung lai bang sale tu bang khach x thang theo nhom HIEN TAI. Chi ghi dong THAT SU doi
// (loc o SELECT, khong dua vao ON CONFLICT ... WHERE - van khoa + ghi WAL).
const REBUILD_SALE_SQL = `
  WITH grp AS (
    ${CURRENT_CUSTOMER_GROUPS_SQL}
  ),
  target AS (
    SELECT m.month, COALESCE(g.sale_name, 'Chưa phân nhóm') AS sale_name,
           SUM(m.net_revenue) AS net_revenue,
           COUNT(*) FILTER (WHERE m.net_revenue <> 0)::int AS customer_count
    FROM business_monthly_customer_sales m
    LEFT JOIN grp g ON g.branch = m.branch AND g.code = m.customer_code
    GROUP BY 1, 2
  ),
  changed AS (
    SELECT t.* FROM target t
    LEFT JOIN business_monthly_sale_sales s ON s.month = t.month AND s.sale_name = t.sale_name
    WHERE s.month IS NULL OR s.net_revenue IS DISTINCT FROM t.net_revenue
       OR s.customer_count IS DISTINCT FROM t.customer_count
  ),
  upserted AS (
    INSERT INTO business_monthly_sale_sales (month, sale_name, net_revenue, customer_count, refreshed_at)
    SELECT month, sale_name, net_revenue, customer_count, now() FROM changed
    ON CONFLICT (month, sale_name) DO UPDATE
      SET net_revenue = EXCLUDED.net_revenue, customer_count = EXCLUDED.customer_count, refreshed_at = now()
    RETURNING 1
  ),
  deleted AS (
    DELETE FROM business_monthly_sale_sales s
    WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.month = s.month AND t.sale_name = s.sale_name)
    RETURNING 1
  )
  SELECT (SELECT COUNT(*) FROM upserted)::int AS upserted, (SELECT COUNT(*) FROM deleted)::int AS deleted`;

module.exports = {
  CURRENT_CUSTOMER_GROUPS_SQL, GROUP_HASH_SQL, BRANCH_CODES, CUSTOMER_MONTH_SELECT_SQL, CUSTOMER_PRODUCT_MONTH_SELECT_SQL,
  FREEZE_CUSTOMER_SQL, FREEZE_CUSTOMER_PRODUCT_SQL, FREEZE_PRODUCT_SQL, REBUILD_SALE_SQL
};
