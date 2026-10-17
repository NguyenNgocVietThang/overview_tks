'use strict';

// Chung tu cho trang Nhap VAT: hoa don (invoices) va don dat hang CHUA len hoa don
// (orders) doc thang tu Postgres, thay cho file "Danh sach chi tiet hoa don" xuat tu KiotViet.
// Gio trong DB la "gio treo tuong" VN mang nhan UTC -> loc/format voi AT TIME ZONE 'UTC'
// (xem dau dashboardPgReader.js). Ma chung tu chi duy nhat trong 1 co so.

const { getPool } = require('../db/pool');
const { INVOICE_STATUS_SQL } = require('../kiotvietSync/salesSqlFragments');
const { stripDiacritics } = require('./normalization');

const DATE_FORMAT = 'DD/MM/YYYY HH24:MI';
const MAX_PAGE_SIZE = 100;
const CANCELLED = 'Đã hủy';
const COMPLETED = 'Hoàn thành';

// Bo dau tieng Viet trong SQL (khong phu thuoc extension unaccent).
const VN_FROM = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const VN_TO = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';
const foldSql = expression => `translate(lower(${expression}), '${VN_FROM}', '${VN_TO}')`;

// Cot sap xep cua bang chon chung tu (khoa tu trang -> bieu thuc SQL tren CTE docs "d"). Chi nhan khoa
// trong danh sach nay (khong ghep chuoi nguoi dung vao SQL).
const SORT_COLUMNS = Object.freeze({
  code: 'd.code',
  kind: 'd.kind',
  branch: 'd.branch',
  date: 'd.doc_ts',
  customer: 'lower(d.customer_name)',
  note: 'lower(d.note)',
  status: 'd.status',
  total: 'd.total',
  lines: `CASE d.kind WHEN 'invoice' THEN (SELECT count(*) FROM invoice_details x WHERE x.branch = d.branch AND x.invoice_id = d.id)
           ELSE (SELECT count(*) FROM order_details x WHERE x.branch = d.branch AND x.order_id = d.id) END`
});

const statusSql = alias => INVOICE_STATUS_SQL.replace(/\bi\./g, `${alias}.`);
const orderStatusSql = alias => `COALESCE(NULLIF(${alias}.raw->>'statusValue', ''), ${alias}.status::text, '')`;

function badRequest(message, code = 'VAT_DRAFT_INVALID') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
}

/** Tu khoa tim khach: chu thuong + bo dau, giong foldSql. */
function foldSearch(text) {
  return stripDiacritics(String(text || '').trim()).toLowerCase();
}

/** 'YYYY-MM-DD' hop le hoac null. */
function parseDate(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === text ? text : null;
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapHead(row) {
  return {
    kind: row.kind,
    branch: row.branch,
    code: row.code,
    date: row.doc_date || '',
    customerName: row.customer_name || '',
    customerCode: row.customer_code || '',
    note: row.note || '',
    status: row.status || '',
    orderCode: row.order_code || '',
    total: n(row.total),
    lineCount: row.line_count === undefined ? undefined : n(row.line_count),
    invoicedBy: row.invoiced_by || ''
  };
}

const HEAD_COLUMNS = alias => `
  ${alias}.branch, ${alias}.id, ${alias}.code,
  COALESCE(NULLIF(${alias}.raw->>'customerName', ''), 'Khách lẻ') AS customer_name,
  COALESCE(${alias}.raw->>'customerCode', '') AS customer_code,
  COALESCE(${alias}.raw->>'description', '') AS note,
  COALESCE(${alias}.total, 0)::float8 AS total`;

function createDocumentsRepository({ query = (sql, params) => getPool().query(sql, params) } = {}) {
  /**
   * Danh sach chung tu de tick chon: hoa don (tru Da huy) + don dat hang chua len hoa don
   * (khong Hoan thanh / Da huy, chua co hoa don khong huy tro toi). Moi nhat truoc.
   */
  async function listDocuments({ branchCodes, kind = 'all', from, to, q = '', page = 1, pageSize = 50, sort = '', dir = 'desc' } = {}) {
    // Sap xep tren TOAN BO ket qua (khong chi trang hien tai). Cot ngoai danh sach -> moi nhat truoc.
    const sortExpr = SORT_COLUMNS[sort];
    const direction = dir === 'asc' ? 'ASC' : 'DESC';
    const orderBy = sortExpr
      ? `${sortExpr} ${direction} NULLS LAST, d.doc_ts DESC NULLS LAST, d.code DESC`
      : 'd.doc_ts DESC NULLS LAST, d.code DESC';
    if (!Array.isArray(branchCodes) || !branchCodes.length) throw badRequest('Chưa chọn cơ sở.');
    if (!['all', 'invoice', 'order'].includes(kind)) throw badRequest('Loại chứng từ không hợp lệ.');
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (!fromDate || !toDate) throw badRequest('Khoảng ngày không hợp lệ.');
    if (fromDate > toDate) throw badRequest('Từ ngày phải trước hoặc bằng Đến ngày.');
    const size = Math.min(Math.max(Number.parseInt(pageSize, 10) || 50, 1), MAX_PAGE_SIZE);
    const pageNo = Math.max(Number.parseInt(page, 10) || 1, 1);
    // Thoat ky tu dai dien cua LIKE (mac dinh ESCAPE la dau gach nguoc).
    const search = foldSearch(q).replace(/[\\%_]/g, ch => `\\${ch}`);

    const { rows } = await query(
      `WITH invoiced AS MATERIALIZED (
         -- Ma don dat hang da co hoa don khong huy. Hoa don cua 1 don khong the lap truoc
         -- ngay dat don (>= Tu ngay - 1) nen chi quet doan index purchase_date, 1 lan.
         SELECT DISTINCT i2.branch, i2.raw->>'orderCode' AS order_code
         FROM invoices i2
         WHERE $4 IN ('all', 'order') AND i2.branch = ANY($1::text[])
           AND i2.purchase_date >= ($2::date - 1)::timestamp AT TIME ZONE 'UTC'
           AND COALESCE(i2.raw->>'orderCode', '') <> '' AND ${statusSql('i2')} <> '${CANCELLED}'
       ), inv AS (
         SELECT 'invoice'::text AS kind, ${HEAD_COLUMNS('i')}, i.purchase_date AS doc_ts,
                ${statusSql('i')} AS status, COALESCE(i.raw->>'orderCode', '') AS order_code
         FROM invoices i
         WHERE $4 IN ('all', 'invoice') AND i.branch = ANY($1::text[])
           AND i.purchase_date >= ($2::date)::timestamp AT TIME ZONE 'UTC'
           AND i.purchase_date < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
       ), ord AS (
         SELECT 'order'::text AS kind, ${HEAD_COLUMNS('o')}, o.order_date AS doc_ts,
                ${orderStatusSql('o')} AS status, ''::text AS order_code
         FROM orders o
         WHERE $4 IN ('all', 'order') AND o.branch = ANY($1::text[])
           AND o.order_date >= ($2::date)::timestamp AT TIME ZONE 'UTC'
           AND o.order_date < ($3::date + 1)::timestamp AT TIME ZONE 'UTC'
           AND COALESCE(o.raw->>'statusValue', '') NOT IN ('${CANCELLED}', '${COMPLETED}')
           AND NOT EXISTS (SELECT 1 FROM invoiced v WHERE v.branch = o.branch AND v.order_code = o.code)
       ), docs AS (
         SELECT * FROM inv WHERE status <> '${CANCELLED}'
         UNION ALL
         SELECT * FROM ord
       ), page AS (
         SELECT d.*, count(*) OVER () AS total_count, row_number() OVER (ORDER BY ${orderBy}) AS rn
         FROM docs d
         WHERE $5 = ''
            OR ${foldSql('d.customer_name')} LIKE '%' || $5 || '%'
            OR lower(d.customer_code) LIKE '%' || $5 || '%'
            OR lower(d.code) LIKE '%' || $5 || '%'
         ORDER BY ${orderBy}
         LIMIT $6 OFFSET $7
       )
       SELECT p.*, COALESCE(to_char(p.doc_ts AT TIME ZONE 'UTC', '${DATE_FORMAT}'), '') AS doc_date,
              CASE p.kind
                WHEN 'invoice' THEN (SELECT count(*) FROM invoice_details d WHERE d.branch = p.branch AND d.invoice_id = p.id)
                ELSE (SELECT count(*) FROM order_details d WHERE d.branch = p.branch AND d.order_id = p.id)
              END AS line_count
       FROM page p
       ORDER BY p.rn`,
      [branchCodes, fromDate, toDate, kind, search, size, (pageNo - 1) * size]
    );
    return {
      rows: rows.map(mapHead),
      total: rows.length ? n(rows[0].total_count) : 0,
      page: pageNo,
      pageSize: size
    };
  }

  /**
   * Tra danh sach ma da dan (HD.../DH...) trong cac co so dang xem, khong loc ngay.
   * -> { found[], notFound[], ambiguous[] } (ambiguous = ma co o ca HN lan SG).
   */
  async function resolveCodes({ branchCodes, codes }) {
    if (!Array.isArray(branchCodes) || !branchCodes.length) throw badRequest('Chưa chọn cơ sở.');
    if (!codes.length) return { found: [], notFound: [], ambiguous: [] };
    const { rows } = await query(
      `WITH input AS (SELECT code, ord::int FROM unnest($2::text[]) WITH ORDINALITY AS t(code, ord))
       SELECT 'invoice'::text AS kind, input.ord, ${HEAD_COLUMNS('i')},
              COALESCE(to_char(i.purchase_date AT TIME ZONE 'UTC', '${DATE_FORMAT}'), '') AS doc_date,
              ${statusSql('i')} AS status, COALESCE(i.raw->>'orderCode', '') AS order_code, ''::text AS invoiced_by
       FROM input JOIN invoices i ON i.code = input.code AND i.branch = ANY($1::text[])
       UNION ALL
       SELECT 'order'::text, input.ord, ${HEAD_COLUMNS('o')},
              COALESCE(to_char(o.order_date AT TIME ZONE 'UTC', '${DATE_FORMAT}'), ''),
              ${orderStatusSql('o')}, ''::text,
              COALESCE((SELECT string_agg(i2.code, ', ' ORDER BY i2.code) FROM invoices i2
                        WHERE i2.branch = o.branch AND i2.purchase_date >= o.order_date - interval '1 day'
                          AND i2.raw->>'orderCode' = o.code
                          AND ${statusSql('i2')} <> '${CANCELLED}'), '')
       FROM input JOIN orders o ON o.code = input.code AND o.branch = ANY($1::text[])
       ORDER BY 2, 3`,
      [branchCodes, codes]
    );
    const byCode = new Map();
    for (const row of rows) {
      const head = mapHead(row);
      head.selectable = head.status !== CANCELLED;
      head.warning = head.status === CANCELLED
        ? 'Chứng từ đã hủy'
        : head.kind === 'order' && head.invoicedBy
          ? `Đơn đã xuất hóa đơn: ${head.invoicedBy}`
          : head.kind === 'order' && head.status === COMPLETED
            ? 'Đơn đặt hàng đã Hoàn thành'
            : '';
      if (!byCode.has(head.code)) byCode.set(head.code, []);
      byCode.get(head.code).push(head);
    }
    const found = [];
    const ambiguous = [];
    const notFound = [];
    for (const code of codes) {
      const matches = byCode.get(code) || [];
      if (!matches.length) notFound.push(code);
      else if (matches.length > 1) ambiguous.push({ code, matches });
      else found.push(matches[0]);
    }
    return { found, notFound, ambiguous };
  }

  /**
   * Dong hang cua cac chung tu da chon, dung thu tu chon roi thu tu dong.
   * Moi dong mang dung cac truong cua file KiotViet ma app cu doc: Ma hang, Ten hang,
   * So luong, Gia ban (= don gia - giam gia / don vi, tinh bang NUMERIC), Ghi chu hang hoa,
   * Ma hoa don, Thanh tien — cong them Ghi chu tong (ghi chu ca don).
   */
  async function readDocumentLines(selections) {
    if (!Array.isArray(selections) || !selections.length) throw badRequest('Chưa chọn chứng từ nào.');
    const seenCodes = new Map();
    for (const s of selections) {
      if (!['invoice', 'order'].includes(s.kind) || !['hanoi', 'saigon'].includes(s.branch) || !s.code) {
        throw badRequest('Chứng từ không hợp lệ.');
      }
      const previous = seenCodes.get(s.code);
      if (previous && previous !== s.branch) {
        throw badRequest(`Mã ${s.code} có ở cả Hà Nội lẫn Sài Gòn — chỉ chọn một trong hai cho mỗi lần xử lý.`, 'VAT_DRAFT_DUPLICATE_CODE');
      }
      seenCodes.set(s.code, s.branch);
    }

    const run = (kind) => {
      const picked = selections.map((s, ord) => ({ ...s, ord })).filter(s => s.kind === kind);
      if (!picked.length) return Promise.resolve({ rows: [] });
      const head = kind === 'invoice' ? 'invoices' : 'orders';
      const detail = kind === 'invoice' ? 'invoice_details' : 'order_details';
      const fk = kind === 'invoice' ? 'invoice_id' : 'order_id';
      // Hoa don co subTotal dung; don dat hang subTotal luon 0 -> tinh lai (xem documentDetailRepository.js).
      const lineTotal = kind === 'invoice'
        ? "COALESCE(NULLIF(d.raw->>'subTotal', ''), ((d.price - COALESCE(d.discount, 0)) * d.quantity)::text)"
        : '((d.price - COALESCE(d.discount, 0)) * d.quantity)::text';
      const status = kind === 'invoice' ? statusSql('h') : orderStatusSql('h');
      return query(
        `SELECT s.ord::int AS ord, h.code, h.branch, ${status} AS status,
                COALESCE(h.raw->>'description', '') AS doc_note,
                d.line_no,
                COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
                COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
                d.quantity::text AS quantity,
                CASE WHEN d.price IS NULL THEN NULL ELSE (d.price - COALESCE(d.discount, 0))::text END AS unit_price,
                ${lineTotal} AS line_total,
                COALESCE(d.raw->>'note', '') AS line_note
         FROM unnest($1::text[], $2::text[], $3::int[]) AS s(branch, code, ord)
         JOIN ${head} h ON h.branch = s.branch AND h.code = s.code
         LEFT JOIN ${detail} d ON d.branch = h.branch AND d.${fk} = h.id
         LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
         ORDER BY s.ord, d.line_no`,
        [picked.map(s => s.branch), picked.map(s => s.code), picked.map(s => s.ord)]
      );
    };

    const [invoiceResult, orderResult] = await Promise.all([run('invoice'), run('order')]);
    const byOrd = new Map();
    for (const row of [...invoiceResult.rows, ...orderResult.rows]) {
      if (!byOrd.has(row.ord)) {
        byOrd.set(row.ord, { code: row.code, branch: row.branch, status: row.status || '', docNote: row.doc_note || '', lines: [] });
      }
      if (row.line_no !== null && row.line_no !== undefined) {
        byOrd.get(row.ord).lines.push({
          productCode: row.product_code || '',
          productName: row.product_name || '',
          quantity: row.quantity === null ? '' : String(row.quantity),
          unitPrice: row.unit_price === null ? '' : String(row.unit_price),
          lineTotal: row.line_total === null ? '' : String(row.line_total),
          note: row.line_note || ''
        });
      }
    }

    return selections.map((s, ord) => {
      const doc = byOrd.get(ord);
      if (!doc) throw badRequest(`Không tìm thấy chứng từ ${s.code} (có thể chưa đồng bộ).`, 'VAT_DRAFT_NOT_FOUND');
      if (doc.status === CANCELLED) throw badRequest(`Chứng từ ${s.code} đã hủy.`, 'VAT_DRAFT_CANCELLED');
      if (!doc.lines.length) throw badRequest(`Chứng từ ${s.code} không có dòng hàng nào.`, 'VAT_DRAFT_EMPTY');
      return { kind: s.kind, ...doc };
    });
  }

  /** Moc dong bo KiotViet gan nhat cua hoa don / don dat hang. */
  async function syncStatus() {
    const { rows } = await query(
      `SELECT branch, entity, last_synced_at FROM sync_checkpoints
       WHERE entity IN ('invoices', 'orders') ORDER BY branch, entity`
    );
    return rows.map(r => ({ branch: r.branch, entity: r.entity, syncedAt: r.last_synced_at || null }));
  }

  return { listDocuments, resolveCodes, readDocumentLines, syncStatus };
}

module.exports = { createDocumentsRepository, foldSearch, parseDate, MAX_PAGE_SIZE };
