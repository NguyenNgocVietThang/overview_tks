'use strict';

// Chi tiet 1 don DAT HANG (Vong doi don hang: kiotOrdersRepository.readOrderDetail) / 1 HOA DON
// (giao dich, tab Hoa don). Doc thang order_details / invoice_details (+ dong dau chung tu bang cha); ma
// chi duy nhat trong 1 co so nen bat buoc truyen co so vat ly ('hanoi'/'saigon'). (2026-10-01: bo chi tiet
// phieu TRA HANG cung bang Danh sach tra hang.)
// Gio trong DB la "gio treo tuong" VN mang nhan UTC nen format voi AT TIME ZONE 'UTC'
// (xem ghi chu o dau dashboardPgReader.js).
const { getPool } = require('../db/pool');
// Ten nhan vien ban tren Kiot co hau to "- <ID Telegram>": chi hien phan ten (saleName.js).
const { saleNameSql } = require('./saleName');

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
function mapLine(row, { fromSubTotal = false, keepSign = false } = {}) {
  const quantity = n(row.quantity);
  const price = n(row.price);
  const discount = n(row.discount);
  const hasSubTotal = fromSubTotal && row.sub_total !== null && row.sub_total !== undefined;
  const subTotal = keepSign ? n(row.sub_total) : Math.abs(n(row.sub_total));
  const amount = hasSubTotal ? subTotal : (price - discount) * quantity;
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
            ${saleNameSql(`COALESCE(NULLIF(o.raw->>'soldByName', ''), s.name, '')`)} AS seller,
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

async function getInvoiceDetail({ code, branchCode, pool = getPool() } = {}) {
  const invoiceCode = cleanCode(code);
  const { rows: heads } = await pool.query(
    `SELECT i.id,
            i.code,
            COALESCE(to_char(i.purchase_date AT TIME ZONE 'UTC', '${DATE_FORMAT}'), '') AS purchase_date,
            COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ') AS customer_name,
            COALESCE(i.raw->>'customerCode', '')                     AS customer_code,
            ${saleNameSql(`COALESCE(NULLIF(i.raw->>'soldByName', ''), s.name, '')`)} AS seller,
            COALESCE(i.raw->>'branchName', '')                       AS warehouse,
            COALESCE(NULLIF(i.raw->>'statusValue', ''), i.status::text, '') AS status,
            COALESCE(i.total, 0)::float8                             AS total,
            COALESCE(NULLIF(i.raw->>'discount', ''), '0')::float8    AS discount,
            COALESCE(i.total_payment, 0)::float8                     AS paid,
            COALESCE(i.raw->>'orderCode', '')                        AS order_code,
            COALESCE(i.raw->>'description', '')                      AS note
     FROM invoices i
     LEFT JOIN staff s ON s.branch = i.branch AND s.id = i.sold_by_id
     WHERE i.branch = $1 AND i.code = $2`,
    [branchCode, invoiceCode]
  );
  if (!heads.length) throw notFound('Không tìm thấy hóa đơn này.');
  const head = heads[0];

  const { rows } = await pool.query(
    `SELECT COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS product_code,
            COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS product_name,
            d.quantity, d.price, d.discount,
            d.raw->>'subTotal'                                     AS sub_total,
            COALESCE(d.raw->>'note', '')                           AS note
     FROM invoice_details d
     LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
     WHERE d.branch = $1 AND d.invoice_id = $2
     ORDER BY d.line_no`,
    [branchCode, head.id]
  );
  // Hoa don co `subTotal` dung (khac don dat hang); giu dau de dong hang tra ngoai le khong bi mat.
  const lines = rows.map((row) => mapLine(row, { fromSubTotal: true, keepSign: true }));
  return {
    kind: 'invoice',
    code: head.code,
    date: head.purchase_date,
    customerName: head.customer_name,
    customerCode: head.customer_code,
    seller: head.seller,
    warehouse: head.warehouse,
    status: head.status,
    orderCode: head.order_code,
    total: n(head.total),
    discount: n(head.discount),
    paid: n(head.paid),
    note: head.note,
    lines,
    ...summarize(lines)
  };
}

module.exports = { getOrderDetail, getInvoiceDetail, __test__: { mapLine } };
