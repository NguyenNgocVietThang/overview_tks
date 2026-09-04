'use strict';

const { parseKiotVietDateTime } = require('../vietnamTime');
const { upsertStaffFromEntity } = require('./staffSync');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function resolveByKiotvietId(client, table, branch, kiotvietId) {
  if (!kiotvietId) return null;
  const result = await client.query(
    `SELECT id FROM ${table} WHERE branch_id = $1 AND kiotviet_id = $2`,
    [branch.id, kiotvietId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

async function upsertReturn(pool, branch, returnItem) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kiotvietId = pick(returnItem, ['id', 'Id', 'returnId', 'ReturnId']);
    const returnCode = pick(returnItem, ['code', 'Code', 'returnCode', 'ReturnCode']);
    const returnDate = parseModifiedDate(pick(returnItem, ['returnDate', 'ReturnDate']));
    const kiotvietOriginalInvoiceId = pick(returnItem, ['invoiceId', 'InvoiceId']);
    const originalInvoiceId = await resolveByKiotvietId(client, 'invoices', branch, kiotvietOriginalInvoiceId);
    const kiotvietCustomerId = pick(returnItem, ['customerId', 'CustomerId']);
    const customerId = await resolveByKiotvietId(client, 'customers', branch, kiotvietCustomerId);
    const soldById = pick(returnItem, ['soldById', 'SoldById']);
    const soldByName = pick(returnItem, ['soldByName', 'SoldByName']);
    const soldByStaffId = await upsertStaffFromEntity(client, branch, {
      kiotvietId: soldById, fullName: soldByName, discoveredVia: 'return'
    });
    const receivedById = pick(returnItem, ['receivedById', 'ReceivedById']);
    const receivedByName = pick(returnItem, ['receivedByName', 'ReceivedByName']);
    const receivedByStaffId = await upsertStaffFromEntity(client, branch, {
      kiotvietId: receivedById, fullName: receivedByName, discoveredVia: 'return'
    });
    const returnTotal = pick(returnItem, ['returnTotal', 'ReturnTotal']) || 0;
    const returnDiscount = pick(returnItem, ['returnDiscount', 'ReturnDiscount']) || 0;
    const returnFee = pick(returnItem, ['returnFee', 'ReturnFee']) || 0;
    const totalPayment = pick(returnItem, ['totalPayment', 'TotalPayment']) || 0;
    const status = pick(returnItem, ['status', 'Status']);
    const modifiedAt = parseModifiedDate(pick(returnItem, ['modifiedDate', 'ModifiedDate']));

    await client.query(
      `INSERT INTO returns (
         branch_id, kiotviet_id, return_code, return_date, original_invoice_id, kiotviet_original_invoice_id,
         customer_id, sold_by_staff_id, received_by_staff_id, return_total, return_discount, return_fee,
         total_payment, status, kiotviet_modified_at, kiotviet_synced_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
       ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
         return_code = EXCLUDED.return_code,
         return_date = EXCLUDED.return_date,
         original_invoice_id = EXCLUDED.original_invoice_id,
         kiotviet_original_invoice_id = EXCLUDED.kiotviet_original_invoice_id,
         customer_id = EXCLUDED.customer_id,
         sold_by_staff_id = EXCLUDED.sold_by_staff_id,
         received_by_staff_id = EXCLUDED.received_by_staff_id,
         return_total = EXCLUDED.return_total,
         return_discount = EXCLUDED.return_discount,
         return_fee = EXCLUDED.return_fee,
         total_payment = EXCLUDED.total_payment,
         status = EXCLUDED.status,
         kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
         kiotviet_synced_at = now(),
         updated_at = now()`,
      [
        branch.id, kiotvietId, returnCode, returnDate, originalInvoiceId, kiotvietOriginalInvoiceId,
        customerId, soldByStaffId, receivedByStaffId, returnTotal, returnDiscount, returnFee,
        totalPayment, status, modifiedAt
      ]
    );

    await client.query('COMMIT');
    return 1;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function buildQuery(sinceIso) {
  const query = { includePayment: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncReturns(pool, kiotVietClient, branch, sinceIso, options = {}) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('returns', buildQuery(sinceIso), async (items, meta) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertReturn(pool, branch, item);
    }
    if (options.onProgress && meta && typeof meta.nextItem === 'number') {
      await options.onProgress(meta.nextItem);
    }
  }, { startItem: options.startItem || 0 });

  return { fetched, upserted };
}

module.exports = { syncReturns, upsertReturn };
