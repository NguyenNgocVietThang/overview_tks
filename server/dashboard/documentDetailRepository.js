'use strict';

// Chi tiet 1 don DAT HANG / 1 phieu TRA HANG cho panel bam vao dong o tab Hoa don.
// Doc thang order_details / return_details (+ dong dau chung tu bang cha); ma
// chi duy nhat trong 1 co so nen bat buoc truyen co so vat ly ('hanoi'/'saigon').
// Gio trong DB la "gio treo tuong" VN mang nhan UTC nen format voi AT TIME ZONE 'UTC'
// (xem ghi chu o dau dashboardPgReader.js).
const { getPool } = require('../db/pool');

const DATE_FORMAT = 'DD/MM/YYYY HH24:MI';

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function notFound(message) {
  const error = new Error(message);
  error.statusCode = 404;
  return error;
}

function cleanCode(code) {
  const trimmed = typeof code === 'string' ? code.trim() : '';
  if (!trimmed) throw badRequest('Thiếu mã chứng từ.');
  return trimmed;
}

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Thanh tien 1 dong. Phieu tra: dung `subTotal` cua KiotViet (so tuyet doi). Don dat hang:
// `subTotal` trong order_details LUON bang 0 (da kiem tra tren DB that) nen tinh lai
// (don gia - giam gia) * so luong - giam gia la theo TUNG don vi, khop tong don.
function mapLine(row, { fromSubTotal = false } = {}) {
  const quantity = n(row.quantity);
  const price = n(row.price);
  const discount = n(row.discount);
  const hasSubTotal = fromSubTotal && row.sub_total !== null && row.sub_total !== undefined;
  const amount = hasSubTotal ? Math.abs(n(row.sub_total)) : (price - discount) * quantity;
  return {
    productCode: row.product_code || '',
    productName: row.product_name || '',
    quantity,
    price,
    discount,
    amount,
    note: row.note || ''
  };
}

function summarize(lines) {
  return {
    lineCount: lines.length,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0)
  };
}

async function getOrderDetail({ code, branchCode, pool = getPool() } = {}) {
  const orderCode = cleanCode(code);
  const { rows: heads } = await pool.query(
    `SELECT o.id,
            o.code,
            COALESCE(to_char(o.order_date AT TIME ZONE 'UTC', '${DATE_FORMAT}'), '') AS order_date,
            COALESCE(NULLIF(o.raw->>'customerName', ''), 'Khách lẻ') AS customer_name,
            COALESCE(o.raw->>'customerCode', '')                     AS customer_code,
            COALESCE(NULLIF(o.raw->>'soldByName', ''), s.name, '')   AS seller,
            COALESCE(o.raw->>'branchName', '')                       AS warehouse,
            COALESCE(NULLIF(o.raw->>'statusValue', ''), o.status::text, '') AS status,
            COALESCE(o.total, 0)::float8                             AS total,
            COALESCE(NULLIF(o.raw->>'discount', ''), '0')::float8    AS discount,
            COALESCE(NULLIF(o.raw->>'totalPayment', ''), '0')::float8 AS paid,
            COALESCE(o.raw->>'description', '')                      AS note
     FROM orders o
     LEFT JOIN staff s ON s.branch = o.branch AND s.id = o.sold_by_id
     WHERE o.branch = $1 AND o.code = $2`,
    [branchCode, orderCode]
  );
  if (!heads.length) throw notFound('Không tìm thấy đơn đặt hàng này.');
  const head = heads[0];

  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
            COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
            d.quantity, d.price, d.discount,
            d.raw->>'subTotal'                                     AS sub_total,
            COALESCE(d.raw->>'note', '')                           AS note
     FROM order_details d
     LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
     WHERE d.branch = $1 AND d.order_id = $2
     ORDER BY d.line_no`,
    [branchCode, head.id]
  );
  const lines = rows.map((row) => mapLine(row));
  return {
    kind: 'order',
    code: head.code,
    date: head.order_date,
    customerName: head.customer_name,
    customerCode: head.customer_code,
    seller: head.seller,
    warehouse: head.warehouse,
    status: head.status,
    total: n(head.total),
    discount: n(head.discount),
    paid: n(head.paid),
    note: head.note,
    lines,
    ...summarize(lines)
  };
}

async function getReturnDetail({ code, branchCode, pool = getPool() } = {}) {
  const returnCode = cleanCode(code);
  const { rows: heads } = await pool.query(
    `SELECT r.id,
            r.code,
            COALESCE(to_char(r.return_date AT TIME ZONE 'UTC', '${DATE_FORMAT}'), '') AS return_date,
            COALESCE(NULLIF(r.raw->>'customerName', ''), 'Khách lẻ') AS customer_name,
            COALESCE(r.raw->>'customerCode', '')                     AS customer_code,
            COALESCE(NULLIF(r.raw->>'soldByName', ''), s.name, '')   AS seller,
            COALESCE(r.raw->>'branchName', '')                       AS warehouse,
            COALESCE(NULLIF(r.raw->>'statusValue', ''), r.status::text, '') AS status,
            COALESCE(r.total, 0)::float8                             AS total,
            COALESCE(NULLIF(r.raw->>'returnDiscount', ''), '0')::float8 AS return_discount,
            COALESCE(NULLIF(r.raw->>'returnFee', ''), '0')::float8   AS return_fee,
            COALESCE(NULLIF(r.raw->>'totalPayment', ''), '0')::float8 AS paid,
            COALESCE(i.code, '')                                     AS invoice_code
     FROM returns r
     LEFT JOIN staff s ON s.branch = r.branch AND s.id = r.sold_by_id
     LEFT JOIN invoices i ON i.branch = r.branch AND i.id = r.invoice_id
     WHERE r.branch = $1 AND r.code = $2`,
    [branchCode, returnCode]
  );
  if (!heads.length) throw notFound('Không tìm thấy phiếu trả hàng này.');
  const head = heads[0];

  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
            COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
            d.quantity, d.price, 0 AS discount,
            d.raw->>'subTotal'                                     AS sub_total,
            COALESCE(d.raw->>'note', '')                           AS note
     FROM return_details d
     LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
     WHERE d.branch = $1 AND d.return_id = $2
     ORDER BY d.line_no`,
    [branchCode, head.id]
  );
  const lines = rows.map((row) => mapLine(row, { fromSubTotal: true }));
  return {
    kind: 'return',
    code: head.code,
    date: head.return_date,
    customerName: head.customer_name,
    customerCode: head.customer_code,
    seller: head.seller,
    warehouse: head.warehouse,
    status: head.status,
    invoiceCode: head.invoice_code,
    total: n(head.total),
    returnDiscount: n(head.return_discount),
    returnFee: n(head.return_fee),
    // KiotViet luu tien hoan tra khach la so am ("-1590000") - hien thi so duong cho de doc.
    paid: Math.abs(n(head.paid)),
    lines,
    ...summarize(lines)
  };
}

module.exports = { getOrderDetail, getReturnDetail, __test__: { mapLine } };
