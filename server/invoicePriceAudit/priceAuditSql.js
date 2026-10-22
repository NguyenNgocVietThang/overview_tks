'use strict';

// Bieu thuc SQL NUMERIC dung chung cho "Kiem tra gia ban": tinh gia khi CHUP hoa don
// (priceAuditRepository.captureUnseenInvoices) va trang thai/tien HIEN TAI khi DOC (readReport,
// ghi Chot o Task 5). Moi phep tien/so luong deu chay trong Postgres NUMERIC; JS chi truyen chuoi
// decimal tu parser (priceNoteParser.js), khong dung so thuc.
//
// Tham so cua cac ham builder la BIEU THUC SQL noi bo (ten cot / alias), khong bao gio la du lieu
// nguoi dung.

const LEVEL_LABELS = Object.freeze({ medium: 'Vừa', large: 'Lớn', vip: 'VIP' });
// Bac thu 1/2/3 cua mo ta = cap Vua/Lon/VIP; bac 4 chi la bac so luong.
const LEVEL_POSITIONS = Object.freeze({ medium: 1, large: 2, vip: 3 });

const REASONS = Object.freeze({
  priced: 'Theo giá quy định',
  approved: 'Được duyệt Ok',
  od: 'Không xét OD',
  pk: 'Không xét PK',
  noPrice: 'Không có giá quy định'
});

const WINNING_SOURCES = Object.freeze({ hn: 'HN', hnFreight: 'HN + cước', sg: 'SG', none: 'Không xét' });

// Gia theo tong so luong: bac co nguong (so thung x chiec/thung) cao nhat <= tong SL; duoi nguong
// dau tien van dung gia bac co nguong thap nhat. Thieu chiec/thung (NULL hoac 0) -> NULL (khong doan).
// tiers: jsonb [{position, cartons, unitPrice}] (chuoi decimal; bac trong da bi parser bo, khong bao gio = 0).
function quantityPriceSql(tiers, cartonSize, totalQuantity) {
  const cartons = "(t->>'cartons')::numeric";
  const qualifies = `(${cartons} * NULLIF(${cartonSize}, 0) <= ${totalQuantity})`;
  return `(CASE WHEN NULLIF(${cartonSize}, 0) IS NULL THEN NULL ELSE (
    SELECT (t->>'unitPrice')::numeric
    FROM jsonb_array_elements(COALESCE(${tiers}, '[]'::jsonb)) t
    ORDER BY ${qualifies} DESC,
             CASE WHEN ${qualifies} THEN -${cartons} ELSE ${cartons} END,
             CASE WHEN ${qualifies} THEN -(t->>'position')::int ELSE (t->>'position')::int END
    LIMIT 1) END)`;
}

// Gia theo cap khach: bac dung vi tri cap (1 Vua, 2 Lon, 3 VIP); o trong -> NULL.
function levelPriceSql(tiers, position) {
  return `(SELECT (t->>'unitPrice')::numeric
    FROM jsonb_array_elements(COALESCE(${tiers}, '[]'::jsonb)) t
    WHERE (t->>'position')::int = ${position}
    LIMIT 1)`;
}

// LEAST bo qua NULL: min cua cac ung vien hop le; ca hai NULL -> NULL (khong COALESCE thanh 0).
function basePriceSql(quantityPrice, levelPrice) {
  return `LEAST(${quantityPrice}, ${levelPrice})`;
}

// Trang thai / tien HIEN TAI tu ban goc + Chot (muc 1.3). alias = bang invoice_price_audit_lines.
function effectiveStatusSql(alias = 'l') {
  return `(CASE WHEN ${alias}.decision = 'ok' THEN 'correct' ELSE ${alias}.original_status END)`;
}
function effectiveAmountSql(alias = 'l') {
  return `(CASE WHEN ${alias}.decision = 'ok' THEN 0::numeric ELSE ${alias}.original_amount END)`;
}
function penaltyAmountSql(alias = 'l') {
  return `(CASE WHEN ${alias}.decision = 'penalty' THEN ${alias}.original_amount ELSE 0::numeric END)`;
}
// Tien chenh chua chot: sai goc va chua co quyet dinh.
function pendingAmountSql(alias = 'l') {
  return `(CASE WHEN ${alias}.decision IS NULL AND ${alias}.original_status = 'wrong' THEN ${alias}.original_amount ELSE 0::numeric END)`;
}
function effectiveReasonSql(alias = 'l') {
  return `(CASE WHEN ${alias}.decision = 'ok' THEN '${REASONS.approved}' ELSE ${alias}.reason END)`;
}

// Mien R (hn | sg) tu cot jsonb cung ten trong CTE `src`: NULL = khong tra mien do.
// {found, productId, cartonSize, tiers, vatPerUnit, updatedLabel}
function regionColumnsSql(r) {
  const tiers = `(s.${r}->'tiers')`;
  const carton = `NULLIF(s.${r}->>'cartonSize', '')::numeric`;
  const qp = quantityPriceSql(tiers, carton, 's.total_qty');
  const lp = levelPriceSql(tiers, 's.level_position');
  return `
    ${carton} AS carton_size_${r},
    ${qp} AS quantity_price_${r},
    ${lp} AS level_price_${r},
    CASE WHEN s.${r} IS NULL THEN NULL WHEN s.full_vat
      THEN COALESCE(NULLIF(s.${r}->>'vatPerUnit', '')::numeric, 0) ELSE 0::numeric END AS vat_${r}`;
}

// $1 = jsonb mang cac dong can chup (chi dong SL > 0 cua hoa don vua them so danh dau).
// Moi so tien/so luong trong jsonb la chuoi decimal; CAST NUMERIC tai day.
const CAPTURE_LINES_SQL = `
WITH src0 AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
    branch text, invoice_id text, source_line_no int, invoice_code text, sold_at timestamptz, sold_day date,
    customer_id text, customer_code text, customer_name text, customer_email text, customer_level text,
    level_position int, sale_name text, product_code text, code_key text, product_name text,
    quantity text, original_unit_price text, unit_discount text, full_vat boolean, excluded text,
    freight_eligible boolean, freight text, hn jsonb, sg jsonb,
    product_note_hn text, product_note_sg text, line_note text, invoice_note text, captured_at timestamptz)
),
src AS (
  SELECT x.*,
         x.quantity::numeric AS qty,
         SUM(x.quantity::numeric) OVER (PARTITION BY x.branch, x.invoice_id, x.code_key) AS total_qty,
         x.original_unit_price::numeric AS price_n,
         COALESCE(x.unit_discount::numeric, 0) AS discount_n
  FROM src0 x
),
regions AS (
  SELECT s.*, ${regionColumnsSql('hn')}, ${regionColumnsSql('sg')},
         CASE WHEN s.freight_eligible THEN COALESCE(NULLIF(s.freight, '')::numeric, 0) ELSE 0::numeric END AS freight_n
  FROM src s
),
mins AS (
  SELECT g.*,
         ${basePriceSql('g.quantity_price_hn', 'g.level_price_hn')} + g.vat_hn AS minimum_hn,
         ${basePriceSql('g.quantity_price_sg', 'g.level_price_sg')} + g.vat_sg AS minimum_sg,
         g.price_n - g.discount_n AS net_n
  FROM regions g
),
applied AS (
  SELECT m.*,
         CASE
           WHEN m.branch = 'saigon' THEN m.minimum_sg
           WHEN m.minimum_hn IS NULL THEN NULL
           WHEN m.freight_eligible THEN LEAST(m.minimum_hn + m.freight_n, m.minimum_sg)
           ELSE m.minimum_hn
         END AS applied_min,
         CASE
           WHEN m.branch = 'saigon' THEN '${WINNING_SOURCES.sg}'
           WHEN m.freight_eligible AND m.minimum_sg IS NOT NULL AND m.minimum_sg < m.minimum_hn + m.freight_n
             THEN '${WINNING_SOURCES.sg}'
           WHEN m.freight_eligible THEN '${WINNING_SOURCES.hnFreight}'
           ELSE '${WINNING_SOURCES.hn}'
         END AS source_raw
  FROM mins m
),
result AS (
  SELECT a.*,
         CASE WHEN a.applied_min IS NULL THEN NULL
              WHEN a.excluded IS NOT NULL THEN 0::numeric
              ELSE GREATEST(0::numeric, a.applied_min - a.net_n) END AS shortfall
  FROM applied a
)
INSERT INTO invoice_price_audit_lines (
  branch, invoice_id, source_line_no, invoice_code, sold_at, sold_day,
  customer_id, customer_code, customer_name, customer_email, customer_level, sale_name, product_code, product_name,
  quantity, total_code_quantity, original_unit_price, unit_discount, net_unit_price, full_vat,
  carton_size_hn, quantity_price_hn, level_price_hn, vat_hn, minimum_hn,
  freight_eligible, freight_per_unit,
  carton_size_sg, quantity_price_sg, level_price_sg, vat_sg, minimum_sg,
  winning_source, reason, minimum_unit_price, unit_shortfall, original_amount, original_status, calculation,
  product_note_hn, product_note_sg, line_note, invoice_note, captured_at)
SELECT r.branch, r.invoice_id::bigint, r.source_line_no, r.invoice_code, r.sold_at, r.sold_day,
  r.customer_id::bigint, r.customer_code, r.customer_name, r.customer_email, r.customer_level, r.sale_name,
  r.product_code, r.product_name,
  r.qty, r.total_qty, r.price_n, r.discount_n, r.net_n, r.full_vat,
  r.carton_size_hn, r.quantity_price_hn, r.level_price_hn, r.vat_hn, r.minimum_hn,
  r.freight_eligible, r.freight_n,
  r.carton_size_sg, r.quantity_price_sg, r.level_price_sg, r.vat_sg, r.minimum_sg,
  CASE WHEN r.applied_min IS NULL OR r.excluded IS NOT NULL THEN '${WINNING_SOURCES.none}' ELSE r.source_raw END,
  CASE r.excluded WHEN 'od' THEN '${REASONS.od}' WHEN 'pk' THEN '${REASONS.pk}'
    ELSE CASE WHEN r.applied_min IS NULL THEN '${REASONS.noPrice}' ELSE '${REASONS.priced}' END END,
  r.applied_min, r.shortfall, COALESCE(r.shortfall, 0) * r.qty,
  CASE WHEN r.applied_min IS NOT NULL AND r.excluded IS NULL AND COALESCE(r.shortfall, 0) * r.qty > 0
    THEN 'wrong' ELSE 'correct' END,
  jsonb_build_object(
    'level', r.customer_level, 'levelPosition', r.level_position, 'excluded', r.excluded,
    'appliedMinimum', r.applied_min::text, 'winningSource', r.source_raw,
    'freight', jsonb_build_object('eligible', r.freight_eligible, 'sourceValue', r.freight, 'added', r.freight_n::text),
    'hn', CASE WHEN r.hn IS NULL THEN NULL ELSE r.hn || jsonb_build_object(
      'quantityPrice', r.quantity_price_hn::text, 'levelPrice', r.level_price_hn::text,
      'vatAdded', r.vat_hn::text, 'minimum', r.minimum_hn::text) END,
    'sg', CASE WHEN r.sg IS NULL THEN NULL ELSE r.sg || jsonb_build_object(
      'quantityPrice', r.quantity_price_sg::text, 'levelPrice', r.level_price_sg::text,
      'vatAdded', r.vat_sg::text, 'minimum', r.minimum_sg::text) END),
  COALESCE(r.product_note_hn, ''), COALESCE(r.product_note_sg, ''), COALESCE(r.line_note, ''),
  COALESCE(r.invoice_note, ''), r.captured_at
FROM result r`;

module.exports = {
  LEVEL_LABELS,
  LEVEL_POSITIONS,
  REASONS,
  WINNING_SOURCES,
  quantityPriceSql,
  levelPriceSql,
  basePriceSql,
  effectiveStatusSql,
  effectiveAmountSql,
  penaltyAmountSql,
  pendingAmountSql,
  effectiveReasonSql,
  CAPTURE_LINES_SQL
};
