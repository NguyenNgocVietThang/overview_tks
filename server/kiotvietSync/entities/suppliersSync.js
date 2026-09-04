'use strict';

const { parseKiotVietDateTime } = require('../vietnamTime');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function upsertSupplier(pool, branch, supplier) {
  const kiotvietId = pick(supplier, ['id', 'Id', 'supplierId', 'SupplierId']);
  const supplierCode = pick(supplier, ['code', 'Code', 'supplierCode', 'SupplierCode']);
  const name = pick(supplier, ['name', 'Name', 'supplierName', 'SupplierName']);
  const contactNumber = pick(supplier, ['contactNumber', 'ContactNumber']);
  const address = pick(supplier, ['address', 'Address']);
  const isActive = pick(supplier, ['isActive', 'IsActive']);
  const debt = pick(supplier, ['debt', 'Debt']) || 0;
  const totalPurchased = pick(supplier, ['totalInvoiced', 'TotalInvoiced']) || 0;
  const totalPurchasedNetOfReturns = pick(supplier, ['totalInvoicedWithoutReturn', 'TotalInvoicedWithoutReturn']) || 0;
  const modifiedAt = parseModifiedDate(pick(supplier, ['modifiedDate', 'ModifiedDate']));

  await pool.query(
    `INSERT INTO suppliers (
       branch_id, kiotviet_id, supplier_code, name, contact_number, address,
       debt_amount, is_active, total_purchased, total_purchased_net_of_returns,
       kiotviet_modified_at, kiotviet_synced_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       supplier_code = EXCLUDED.supplier_code,
       name = EXCLUDED.name,
       contact_number = EXCLUDED.contact_number,
       address = EXCLUDED.address,
       debt_amount = EXCLUDED.debt_amount,
       is_active = EXCLUDED.is_active,
       total_purchased = EXCLUDED.total_purchased,
       total_purchased_net_of_returns = EXCLUDED.total_purchased_net_of_returns,
       kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
       kiotviet_synced_at = now(),
       updated_at = now()`,
    [
      branch.id, kiotvietId, supplierCode, name, contactNumber, address,
      debt, isActive === null ? true : isActive, totalPurchased, totalPurchasedNetOfReturns, modifiedAt
    ]
  );
  return 1;
}

function buildQuery(sinceIso) {
  const query = { includeTotal: 'true', includeSupplierGroup: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncSuppliers(pool, kiotVietClient, branch, sinceIso, options = {}) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('suppliers', buildQuery(sinceIso), async (items, meta) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertSupplier(pool, branch, item);
    }
    if (options.onProgress && meta && typeof meta.nextItem === 'number') {
      await options.onProgress(meta.nextItem);
    }
  }, { startItem: options.startItem || 0 });

  return { fetched, upserted };
}

module.exports = { syncSuppliers, upsertSupplier };
