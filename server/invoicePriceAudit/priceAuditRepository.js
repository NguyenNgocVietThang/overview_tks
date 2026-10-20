'use strict';

// "Kiem tra gia ban" (tab Hoa don): CHUP hoa don chua quet vao invoice_price_audit_* va DOC bang ket qua.
//
// captureUnseenInvoices: chay trong giao dich cua NGUOI GOI (job 23:00, Task 4) - khong BEGIN/COMMIT.
//   Chon hoa don "Hoan thanh" ngay ban trong [day-6, day] chua co so danh dau; tai DU cac dong (SL > 0),
//   khach, mo ta gia HN/SG va cuoc Can do trong cung ban doc; parse mo ta o JS (chuoi), tinh gia bang
//   NUMERIC trong SQL (priceAuditSql.CAPTURE_LINES_SQL). Them so danh dau truoc (ON CONFLICT DO NOTHING)
//   roi chi chup dong cua hoa don vua them -> khong bao gio cap nhat/nhan ban dong cu.
// readReport / readRow: chi doc ban da chup trong cua so cong bo (invoice_price_audit_state).

const crypto = require('node:crypto');
const { getPool } = require('../db/pool');
const { INVOICE_STATUS_SQL } = require('../kiotvietSync/salesSqlFragments');
const { parsePriceNote } = require('./priceNoteParser');
const { customerLevelFromEmail, hasFullVat, isExcludedProduct, isFreightCustomer } = require('./priceAuditRules');
const S = require('./priceAuditSql');

const SOURCE_NOT_READY = 'PRICE_AUDIT_SOURCE_NOT_READY';
const WINDOW_DAYS = 7;
const DEFAULT_PAGE_SIZE = 50;

function sourceNotReady(message) {
  const err = new Error(message);
  err.code = SOURCE_NOT_READY;
  return err;
}

const codeKey = code => String(code ?? '').trim().toLowerCase();

// ---------------------------------------------------------------- doc nguon

const MEASURES_READY_SQL = "SELECT last_success_at FROM sheet_snapshot_sync WHERE source = 'shipping_measures'";

// $1 ngay chay (YYYY-MM-DD). purchase_date = gio dia phuong Kiot gan nhan UTC -> moc ngay AT TIME ZONE 'UTC'.
const INVOICES_SQL = `
  SELECT i.branch, i.id::text AS invoice_id, i.code, i.purchase_date::text AS sold_at,
         (i.purchase_date AT TIME ZONE 'UTC')::date::text AS sold_day, i.modified_date::text AS modified_at,
         i.customer_id::text AS customer_id, COALESCE(i.raw->>'description', '') AS invoice_note,
         COALESCE(btrim(i.raw->>'customerCode'), '') AS raw_customer_code,
         COALESCE(btrim(i.raw->>'customerName'), '') AS raw_customer_name,
         (c.id IS NOT NULL) AS customer_found, COALESCE(btrim(c.code), '') AS customer_code,
         COALESCE(btrim(c.name), '') AS customer_name,
         COALESCE(c.raw->>'email', c.raw->>'Email', '') AS customer_email,
         COALESCE(btrim(c.raw->>'groups'), '') AS sale_name
  FROM invoices i
  LEFT JOIN customers c ON c.branch = i.branch AND c.id = i.customer_id
  WHERE i.purchase_date >= (($1::date - ${WINDOW_DAYS - 1})::timestamp AT TIME ZONE 'UTC')
    AND i.purchase_date <  (($1::date + 1)::timestamp AT TIME ZONE 'UTC')
    AND ${INVOICE_STATUS_SQL} = 'Hoàn thành'
    AND NOT EXISTS (SELECT 1 FROM invoice_price_audit_invoices m WHERE m.branch = i.branch AND m.invoice_id = i.id)
  ORDER BY i.branch, i.id`;

// $1 co so[], $2 id hoa don[] (cap). San pham theo (co so, product_id) cua chinh dong.
const LINES_SQL = `
  SELECT d.branch, d.invoice_id::text AS invoice_id, d.line_no, d.product_id::text AS product_id,
         d.quantity::text AS quantity, d.price::text AS price, d.discount::text AS discount,
         COALESCE(btrim(d.raw->>'productCode'), '') AS raw_code, COALESCE(d.raw->>'productName', '') AS raw_name,
         COALESCE(d.raw->>'note', '') AS line_note,
         (p.id IS NOT NULL) AS product_found, COALESCE(btrim(p.code), '') AS product_code,
         COALESCE(p.name, '') AS product_name, COALESCE(p.raw->>'description', '') AS description
  FROM invoice_details d
  JOIN unnest($1::text[], $2::bigint[]) AS k(branch, invoice_id) ON k.branch = d.branch AND k.invoice_id = d.invoice_id
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  ORDER BY d.branch, d.invoice_id, d.line_no`;

// Ma mien SG cho khach bao cuoc: trim + khong phan biet hoa/thuong, KHONG ghep product_id xuyen Kiot.
const SG_PRODUCTS_SQL = `
  SELECT DISTINCT ON (lower(btrim(code))) lower(btrim(code)) AS code_key, id::text AS product_id,
         COALESCE(raw->>'description', '') AS description
  FROM products
  WHERE branch = 'saigon' AND lower(btrim(code)) = ANY($1::text[])
  ORDER BY lower(btrim(code)), COALESCE(is_active, TRUE) DESC, id DESC`;
const SG_HAS_PRODUCTS_SQL = "SELECT EXISTS (SELECT 1 FROM products WHERE branch = 'saigon') AS ok";
const FREIGHT_SQL = 'SELECT code_key, freight_per_unit::text AS freight FROM shipping_measures WHERE code_key = ANY($1::text[])';

const INSERT_MARKERS_SQL = `
  INSERT INTO invoice_price_audit_invoices
    (branch, invoice_id, invoice_code, sold_day, captured_at, run_day, source_hash, source_modified_at)
  SELECT x.branch, x.invoice_id::bigint, x.invoice_code, x.sold_day, x.captured_at, x.run_day, x.source_hash, x.source_modified_at
  FROM jsonb_to_recordset($1::jsonb) AS x(branch text, invoice_id text, invoice_code text, sold_day date,
    captured_at timestamptz, run_day date, source_hash text, source_modified_at timestamptz)
  ON CONFLICT (branch, invoice_id) DO NOTHING
  RETURNING branch, invoice_id::text AS invoice_id`;

function sourceHash(invoice, lines) {
  const payload = JSON.stringify([invoice.invoice_note, invoice.customer_id, lines.map(l =>
    [l.line_no, l.product_id, l.raw_code, l.quantity, l.price, l.discount, l.line_note])]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// Mo ta -> jsonb mien (chuoi decimal). found=false: tra ma ma khong co hang (ung vien NULL hop le).
function regionInput(found, productId, description) {
  if (!found) return { found: false };
  const note = parsePriceNote(description);
  return { found: true, productId, cartonSize: note.cartonSize, tiers: note.tiers,
    vatPerUnit: note.vatPerUnit, updatedLabel: note.updatedLabel };
}

async function assertMeasuresReady(client) {
  let rows;
  try {
    ({ rows } = await client.query(MEASURES_READY_SQL));
  } catch (err) {
    if (err && err.code === '42P01') throw sourceNotReady('Chưa có bảng đồng bộ Cân đo (sheet_snapshot_sync).');
    throw err;
  }
  if (!rows[0] || !rows[0].last_success_at) {
    throw sourceNotReady('Cân đo (shipping_measures) chưa từng đồng bộ thành công; chưa thể chạy kiểm tra giá.');
  }
}

/**
 * Chup moi hoa don "Hoan thanh" chua quet co ngay ban trong [day-6, day].
 * @param {{ day: string, client: { query: Function }, now: Date|number|string }} args client DA o trong giao dich.
 * @returns {Promise<{ addedInvoices: number, addedLines: number }>}
 */
async function captureUnseenInvoices({ day, client, now }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) throw new Error('captureUnseenInvoices: day phải là YYYY-MM-DD');
  if (!client || typeof client.query !== 'function') throw new Error('captureUnseenInvoices: thiếu client giao dịch');
  const capturedAt = new Date(now ?? Date.now()).toISOString();
  await assertMeasuresReady(client);

  const invoices = (await client.query(INVOICES_SQL, [day])).rows;
  if (invoices.length === 0) return { addedInvoices: 0, addedLines: 0 };

  const missingCustomers = invoices.filter(i => i.customer_id && !i.customer_found);
  if (missingCustomers.length) {
    throw sourceNotReady(`Chưa đồng bộ khách hàng cho ${missingCustomers.length} hóa đơn (vd ${missingCustomers[0].branch}/${missingCustomers[0].code}).`);
  }

  const detailRows = (await client.query(LINES_SQL,
    [invoices.map(i => i.branch), invoices.map(i => i.invoice_id)])).rows;
  const missingProducts = detailRows.filter(l => l.product_id && !l.product_found);
  if (missingProducts.length) {
    const m = missingProducts[0];
    throw sourceNotReady(`Chưa đồng bộ sản phẩm cho ${missingProducts.length} dòng hóa đơn (vd ${m.branch}/${m.invoice_id} sản phẩm ${m.product_id}).`);
  }
  const linesByInvoice = new Map();
  for (const l of detailRows) {
    const key = `${l.branch}:${l.invoice_id}`;
    if (!linesByInvoice.has(key)) linesByInvoice.set(key, []);
    linesByInvoice.get(key).push(l);
  }

  // Khach bao cuoc (chi HN) -> can mo ta SG theo ma + cuoc theo ma.
  const freightInvoices = new Set(invoices
    .filter(i => i.branch === 'hanoi' && isFreightCustomer(i.customer_name || i.raw_customer_name))
    .map(i => `${i.branch}:${i.invoice_id}`));
  const freightKeys = [...new Set([...freightInvoices].flatMap(k => (linesByInvoice.get(k) || [])
    .map(l => codeKey(l.raw_code || l.product_code))).filter(Boolean))];
  const sgProducts = new Map();
  const freightByKey = new Map();
  if (freightKeys.length) {
    if (!(await client.query(SG_HAS_PRODUCTS_SQL)).rows[0].ok) {
      throw sourceNotReady('Chưa đồng bộ sản phẩm Sài Gòn để đối chiếu khách bao cước.');
    }
    for (const p of (await client.query(SG_PRODUCTS_SQL, [freightKeys])).rows) sgProducts.set(p.code_key, p);
    for (const f of (await client.query(FREIGHT_SQL, [freightKeys])).rows) freightByKey.set(f.code_key, f.freight);
  }

  const markers = [];
  const lineInputs = [];
  for (const inv of invoices) {
    const key = `${inv.branch}:${inv.invoice_id}`;
    const all = linesByInvoice.get(key) || [];
    markers.push({ branch: inv.branch, invoice_id: inv.invoice_id, invoice_code: inv.code, sold_day: inv.sold_day,
      captured_at: capturedAt, run_day: day, source_hash: sourceHash(inv, all), source_modified_at: inv.modified_at });
    const level = customerLevelFromEmail(inv.customer_email);
    const freightEligible = freightInvoices.has(key);
    all.forEach((l, index) => {
      // Chi dong SL duong; so dong = vi tri trong hoa don nguon (1..n), giu ca khi bo dong SL <= 0.
      if (!(Number(l.quantity) > 0)) return;
      const code = l.raw_code || l.product_code;
      const name = l.raw_name || l.product_name;
      const own = regionInput(l.product_found, l.product_id, l.description);
      const sg = freightEligible ? sgProducts.get(codeKey(code)) : null;
      lineInputs.push({
        branch: inv.branch, invoice_id: inv.invoice_id, source_line_no: index + 1, invoice_code: inv.code,
        sold_at: inv.sold_at, sold_day: inv.sold_day, customer_id: inv.customer_id,
        customer_code: inv.raw_customer_code || inv.customer_code, customer_name: inv.customer_name || inv.raw_customer_name,
        customer_email: inv.customer_email, customer_level: S.LEVEL_LABELS[level], level_position: S.LEVEL_POSITIONS[level],
        sale_name: inv.sale_name, product_code: code, code_key: codeKey(code), product_name: name,
        quantity: l.quantity, original_unit_price: l.price, unit_discount: l.discount,
        full_vat: hasFullVat(l.line_note, inv.invoice_note), excluded: isExcludedProduct(name),
        freight_eligible: freightEligible, freight: freightEligible ? (freightByKey.get(codeKey(code)) ?? null) : null,
        hn: inv.branch === 'hanoi' ? own : null,
        sg: inv.branch === 'saigon' ? own : (freightEligible ? regionInput(Boolean(sg), sg && sg.product_id, sg && sg.description) : null),
        product_note_hn: inv.branch === 'hanoi' ? l.description : '',
        product_note_sg: inv.branch === 'saigon' ? l.description : (sg ? sg.description : ''),
        line_note: l.line_note, invoice_note: inv.invoice_note, captured_at: capturedAt
      });
    });
  }

  const inserted = (await client.query(INSERT_MARKERS_SQL, [JSON.stringify(markers)])).rows;
  const insertedKeys = new Set(inserted.map(r => `${r.branch}:${r.invoice_id}`));
  const toInsert = lineInputs.filter(l => insertedKeys.has(`${l.branch}:${l.invoice_id}`));
  let addedLines = 0;
  if (toInsert.length) {
    const res = await client.query(S.CAPTURE_LINES_SQL, [JSON.stringify(toInsert)]);
    addedLines = res.affectedRows ?? res.rowCount ?? toInsert.length;
  }
  return { addedInvoices: inserted.length, addedLines };
}

// ---------------------------------------------------------------- doc ket qua

const STATE_SQL = `SELECT published_day::text AS published_day, window_from::text AS window_from, window_to::text AS window_to,
  last_success_at, last_attempt_at, last_error, added_invoice_count, version
  FROM invoice_price_audit_state WHERE id`;

const ROW_COLUMNS_SQL = `
  l.branch, l.invoice_id::text AS invoice_id, l.source_line_no, l.invoice_code,
  to_char(l.sold_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS sold_at, l.sold_day::text AS sold_day,
  l.customer_code, l.customer_name, l.customer_email, l.customer_level, l.sale_name, l.product_code, l.product_name,
  l.quantity::text AS quantity, l.total_code_quantity::text AS total_code_quantity,
  l.original_unit_price::text AS original_unit_price, l.unit_discount::text AS unit_discount,
  l.net_unit_price::text AS net_unit_price, l.full_vat,
  l.carton_size_hn::text AS carton_size_hn, l.quantity_price_hn::text AS quantity_price_hn,
  l.level_price_hn::text AS level_price_hn, l.vat_hn::text AS vat_hn, l.minimum_hn::text AS minimum_hn,
  l.freight_eligible, l.freight_per_unit::text AS freight_per_unit,
  l.carton_size_sg::text AS carton_size_sg, l.quantity_price_sg::text AS quantity_price_sg,
  l.level_price_sg::text AS level_price_sg, l.vat_sg::text AS vat_sg, l.minimum_sg::text AS minimum_sg,
  l.winning_source, l.reason AS original_reason, ${S.effectiveReasonSql('l')} AS reason,
  l.minimum_unit_price::text AS minimum_unit_price, l.unit_shortfall::text AS unit_shortfall,
  l.original_amount::text AS original_amount, l.original_status,
  ${S.effectiveStatusSql('l')} AS effective_status, ${S.effectiveAmountSql('l')}::text AS effective_amount,
  l.product_note_hn, l.product_note_sg, l.line_note, l.invoice_note,
  l.sale_explanation, l.explanation_by, l.explanation_at, l.decision, l.decided_by, l.decided_at, l.captured_at, l.version,
  (SELECT NULLIF(btrim(c.raw->>'groups'), '') FROM customers c
    WHERE c.branch = l.branch AND c.id = l.customer_id) AS current_sale_group`;

// Bo loc co dinh, moi gia tri qua tham so (NULL = khong loc). $1/$2 cua so cong bo.
const FILTER_SQL = `
  FROM invoice_price_audit_lines l
  WHERE l.sold_day BETWEEN GREATEST($1::date, COALESCE($3::date, $1::date)) AND LEAST($2::date, COALESCE($4::date, $2::date))
    AND ($5::text IS NULL OR l.branch = $5)
    AND ($6::text IS NULL OR l.sale_name = $6)
    AND ($7::text IS NULL OR ${S.effectiveStatusSql('l')} = $7)
    AND ($8::text IS NULL OR ($8 = 'pending' AND l.decision IS NULL) OR l.decision = $8)
    AND ($9::boolean IS NULL OR l.full_vat = $9)
    AND ($10::boolean IS NULL OR l.freight_eligible = $10)
    AND ($11::text IS NULL OR strpos(lower(normalize(concat_ws(' ', l.invoice_code, l.customer_code, l.customer_name,
          l.product_code, l.product_name), NFC)), lower(normalize($11, NFC))) > 0)`;

const ORDER_SQL = `ORDER BY (${S.effectiveStatusSql('l')} = 'wrong') DESC, l.sold_at DESC, l.branch, l.invoice_code, l.source_line_no`;

const KPI_SQL = `
  SELECT count(DISTINCT (l.branch, l.invoice_id))::int AS invoice_count,
         count(*) FILTER (WHERE ${S.effectiveStatusSql('l')} = 'correct')::int AS correct_lines,
         count(*) FILTER (WHERE ${S.effectiveStatusSql('l')} = 'wrong')::int AS wrong_lines,
         COALESCE(SUM(${S.pendingAmountSql('l')}), 0)::text AS pending_amount,
         COALESCE(SUM(${S.penaltyAmountSql('l')}), 0)::text AS penalty_amount,
         COALESCE(SUM(${S.effectiveAmountSql('l')}), 0)::text AS effective_amount,
         COALESCE(SUM(l.original_amount), 0)::text AS original_amount,
         COALESCE(SUM(l.quantity), 0)::text AS quantity,
         count(*)::int AS total_rows
  ${FILTER_SQL}`;

const ROWS_SQL = `SELECT ${ROW_COLUMNS_SQL} ${FILTER_SQL} ${ORDER_SQL} LIMIT $12 OFFSET $13`;
const SALES_SQL = `SELECT DISTINCT l.sale_name FROM invoice_price_audit_lines l
  WHERE l.sold_day BETWEEN $1::date AND $2::date AND l.sale_name <> '' ORDER BY 1`;
const ROW_BY_KEY_SQL = `SELECT ${ROW_COLUMNS_SQL} FROM invoice_price_audit_lines l
  WHERE l.branch = $1 AND l.invoice_id = $2::bigint AND l.source_line_no = $3::int`;

const iso = value => (value == null ? null : new Date(value).toISOString());

// canEditExplanation / canDecide: Task 5 (priceAuditAccess) dien theo viewer; o day luon false.
function mapRow(r) {
  return {
    soldAt: r.sold_at, branch: r.branch, invoiceCode: r.invoice_code, saleName: r.sale_name,
    customerName: r.customer_name, productCode: r.product_code, productName: r.product_name,
    customerLevel: r.customer_level, quantity: r.quantity, totalCodeQuantity: r.total_code_quantity,
    fullVat: r.full_vat, netUnitPrice: r.net_unit_price, minimumUnitPrice: r.minimum_unit_price,
    unitShortfall: r.unit_shortfall, effectiveAmount: r.effective_amount, effectiveStatus: r.effective_status,
    saleExplanation: r.sale_explanation, decision: r.decision,
    customerCode: r.customer_code, customerEmail: r.customer_email, sourceLineNo: r.source_line_no,
    originalUnitPrice: r.original_unit_price, unitDiscount: r.unit_discount,
    cartonSizeHn: r.carton_size_hn, quantityPriceHn: r.quantity_price_hn, levelPriceHn: r.level_price_hn,
    vatHn: r.vat_hn, minimumHn: r.minimum_hn,
    freightEligible: r.freight_eligible, freightPerUnit: r.freight_per_unit,
    cartonSizeSg: r.carton_size_sg, quantityPriceSg: r.quantity_price_sg, levelPriceSg: r.level_price_sg,
    vatSg: r.vat_sg, minimumSg: r.minimum_sg,
    winningSource: r.winning_source, reason: r.reason, originalReason: r.original_reason,
    productNoteHn: r.product_note_hn, productNoteSg: r.product_note_sg, lineNote: r.line_note, invoiceNote: r.invoice_note,
    originalStatus: r.original_status, originalAmount: r.original_amount,
    decidedBy: r.decided_by, decidedAt: iso(r.decided_at), capturedAt: iso(r.captured_at),
    explanationBy: r.explanation_by, explanationAt: iso(r.explanation_at),
    invoiceId: r.invoice_id, soldDay: r.sold_day, version: Number(r.version),
    currentSaleGroup: r.current_sale_group, canEditExplanation: false, canDecide: false
  };
}

function mapMeta(state) {
  if (!state || !state.published_day) {
    return { available: false, message: 'Chưa chạy kiểm tra giá', windowFrom: null, windowTo: null,
      lastSuccessAt: iso(state && state.last_success_at), lastAttemptAt: iso(state && state.last_attempt_at),
      lastError: (state && state.last_error) || null, addedInvoiceCount: 0 };
  }
  return { available: true, publishedDay: state.published_day, windowFrom: state.window_from, windowTo: state.window_to,
    lastSuccessAt: iso(state.last_success_at), lastAttemptAt: iso(state.last_attempt_at),
    lastError: state.last_error || null, addedInvoiceCount: Number(state.added_invoice_count) || 0,
    stateVersion: Number(state.version) };
}

const nil = value => (value === undefined || value === '' ? null : value);

function normalizeQuery(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(query.pageSize, 10) || DEFAULT_PAGE_SIZE);
  const bool = v => (v === true || v === false ? v : null);
  return { branch: nil(query.branch), from: nil(query.from), to: nil(query.to), sale: nil(query.sale),
    status: nil(query.status), decision: nil(query.decision), vat: bool(query.vat), freight: bool(query.freight),
    q: nil(typeof query.q === 'string' ? query.q.trim() : query.q), page, pageSize };
}

function createPriceAuditRepository({ pool = getPool() } = {}) {
  async function readState() {
    return (await pool.query(STATE_SQL)).rows[0] || null;
  }

  /**
   * GET /api/invoice-price-audit (tham so DA hop le, Task 5 kiem tra HTTP). viewer chua dung o day.
   * @returns {Promise<{ meta, filters, kpis, totals, rows, totalRows, page, pageSize }>}
   */
  async function readReport(query, viewer) { // eslint-disable-line no-unused-vars
    const q = normalizeQuery(query);
    const state = await readState();
    const meta = mapMeta(state);
    const applied = { branch: q.branch, from: q.from, to: q.to, sale: q.sale, status: q.status,
      decision: q.decision, vat: q.vat, freight: q.freight, q: q.q };
    if (!meta.available) {
      return { meta, filters: { applied, options: { sales: [] } }, kpis: null, totals: null,
        rows: [], totalRows: 0, page: q.page, pageSize: q.pageSize };
    }
    const params = [state.window_from, state.window_to, q.from, q.to, q.branch, q.sale, q.status, q.decision,
      q.vat, q.freight, q.q];
    const [kpi, rows, sales] = await Promise.all([
      pool.query(KPI_SQL, params),
      pool.query(ROWS_SQL, [...params, q.pageSize, (q.page - 1) * q.pageSize]),
      pool.query(SALES_SQL, [state.window_from, state.window_to])
    ]);
    const k = kpi.rows[0];
    return {
      meta,
      filters: { applied, options: { sales: sales.rows.map(r => r.sale_name) } },
      kpis: { invoiceCount: k.invoice_count, correctLines: k.correct_lines, wrongLines: k.wrong_lines,
        pendingAmount: k.pending_amount, penaltyAmount: k.penalty_amount, effectiveAmount: k.effective_amount },
      totals: { quantity: k.quantity, originalAmount: k.original_amount, effectiveAmount: k.effective_amount },
      rows: rows.rows.map(mapRow),
      totalRows: k.total_rows,
      page: q.page,
      pageSize: q.pageSize
    };
  }

  /** Mot dong theo khoa { branch, invoiceId (chuoi), sourceLineNo }, cung shape voi rows; khong co -> null. */
  async function readRow({ branch, invoiceId, sourceLineNo }, db = pool) {
    const { rows } = await db.query(ROW_BY_KEY_SQL, [branch, String(invoiceId), sourceLineNo]);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  return { readReport, readRow, readState };
}

let defaultRepository;
function getPriceAuditRepository() {
  if (!defaultRepository) defaultRepository = createPriceAuditRepository();
  return defaultRepository;
}

module.exports = {
  SOURCE_NOT_READY,
  captureUnseenInvoices,
  createPriceAuditRepository,
  getPriceAuditRepository,
  mapRow
};
