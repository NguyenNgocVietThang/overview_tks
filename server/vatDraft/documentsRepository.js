'use strict';

// Chung tu cho trang Nhap VAT: hoa don (invoices) va don dat hang CHUA len hoa don
// (orders) doc thang tu Postgres, thay cho file "Danh sach chi tiet hoa don" xuat tu KiotViet.
// Gio trong DB la "gio treo tuong" VN mang nhan UTC -> loc/format voi AT TIME ZONE 'UTC'
// (xem dau dashboardPgReader.js). Ma chung tu chi duy nhat trong 1 co so.

const { getPool } = require('../db/pool');
const { INVOICE_STATUS_SQL } = require('../kiotvietSync/salesSqlFragments');

const DATE_FORMAT = 'DD/MM/YYYY HH24:MI';
const CANCELLED = 'Đã hủy';
const COMPLETED = 'Hoàn thành';

const statusSql = alias => INVOICE_STATUS_SQL.replace(/\bi\./g, `${alias}.`);
const orderStatusSql = alias => `COALESCE(NULLIF(${alias}.raw->>'statusValue', ''), ${alias}.status::text, '')`;

function badRequest(message, code = 'VAT_DRAFT_INVALID') {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  return error;
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

  return { resolveCodes, readDocumentLines, syncStatus };
}

module.exports = { createDocumentsRepository };
