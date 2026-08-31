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

async function insertLineItems(client, purchaseId, branch, details) {
  await client.query('DELETE FROM purchase_line_items WHERE purchase_id = $1', [purchaseId]);

  let lineNo = 0;
  for (const detail of details) {
    const kiotvietProductId = pick(detail, ['productId', 'ProductId']);
    const productId = await resolveByKiotvietId(client, 'products', branch, kiotvietProductId);
    const quantity = pick(detail, ['quantity', 'Quantity']);
    const price = pick(detail, ['price', 'Price']);
    const discount = pick(detail, ['discount', 'Discount']) || 0;
    const subTotal = pick(detail, ['subTotal', 'SubTotal']);
    const lineAmount = subTotal !== null ? subTotal : (Number(price) || 0) * (Number(quantity) || 0) - Number(discount || 0);

    await client.query(
      `INSERT INTO purchase_line_items (
         purchase_id, branch_id, line_no, product_id, kiotviet_product_id,
         product_code_snapshot, product_name_snapshot, quantity, price, discount, line_amount, note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        purchaseId, branch.id, lineNo, productId, kiotvietProductId,
        pick(detail, ['productCode', 'ProductCode']), pick(detail, ['productName', 'ProductName']),
        quantity, price, discount, lineAmount, pick(detail, ['note', 'Note'])
      ]
    );
    lineNo++;
  }
}

async function upsertPurchase(pool, branch, purchase) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kiotvietId = pick(purchase, ['id', 'Id', 'purchaseOrderId', 'PurchaseOrderId']);
    const purchaseCode = pick(purchase, ['code', 'Code', 'purchaseOrderCode', 'PurchaseOrderCode']);
    const purchaseDate = parseModifiedDate(pick(purchase, ['purchaseDate', 'PurchaseDate']));
    const kiotvietSupplierId = pick(purchase, ['supplierId', 'SupplierId']);
    const supplierId = await resolveByKiotvietId(client, 'suppliers', branch, kiotvietSupplierId);
    const supplierCodeSnapshot = pick(purchase, ['supplierCode', 'SupplierCode']);
    const supplierNameSnapshot = pick(purchase, ['supplierName', 'SupplierName']);
    const createdById = pick(purchase, ['purchaseById', 'PurchaseById']);
    const createdByName = pick(purchase, ['purchaseName', 'PurchaseName', 'createdByName', 'CreatedByName']);
    const createdByStaffId = await upsertStaffFromEntity(client, branch, {
      kiotvietId: createdById, fullName: createdByName, discoveredVia: 'purchase'
    });
    const totalAmount = pick(purchase, ['total', 'Total']);
    const discountAmount = pick(purchase, ['discount', 'Discount']) || 0;
    const totalPayment = pick(purchase, ['totalPayment', 'TotalPayment']) || 0;
    const supplierDebtAmount = pick(purchase, ['supplierDebt', 'SupplierDebt', 'needToPay', 'NeedToPay']);
    const status = pick(purchase, ['status', 'Status']);
    const description = pick(purchase, ['description', 'Description']);
    const modifiedAt = parseModifiedDate(pick(purchase, ['modifiedDate', 'ModifiedDate']));

    const result = await client.query(
      `INSERT INTO purchases (
         branch_id, kiotviet_id, purchase_code, purchase_date, supplier_id, kiotviet_supplier_id,
         supplier_code_snapshot, supplier_name_snapshot, created_by_staff_id, total_amount,
         discount_amount, supplier_debt_amount, paid_amount, status, note,
         kiotviet_modified_at, kiotviet_synced_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now(), now())
       ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
         purchase_code = EXCLUDED.purchase_code,
         purchase_date = EXCLUDED.purchase_date,
         supplier_id = EXCLUDED.supplier_id,
         kiotviet_supplier_id = EXCLUDED.kiotviet_supplier_id,
         supplier_code_snapshot = EXCLUDED.supplier_code_snapshot,
         supplier_name_snapshot = EXCLUDED.supplier_name_snapshot,
         created_by_staff_id = EXCLUDED.created_by_staff_id,
         total_amount = EXCLUDED.total_amount,
         discount_amount = EXCLUDED.discount_amount,
         supplier_debt_amount = EXCLUDED.supplier_debt_amount,
         paid_amount = EXCLUDED.paid_amount,
         status = EXCLUDED.status,
         note = EXCLUDED.note,
         kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
         kiotviet_synced_at = now(),
         updated_at = now()
       RETURNING id`,
      [
        branch.id, kiotvietId, purchaseCode, purchaseDate, supplierId, kiotvietSupplierId,
        supplierCodeSnapshot, supplierNameSnapshot, createdByStaffId, totalAmount,
        discountAmount, supplierDebtAmount === null ? Number(totalAmount || 0) - Number(totalPayment || 0) : supplierDebtAmount,
        totalPayment, status, description, modifiedAt
      ]
    );
    const purchaseId = result.rows[0].id;

    const details = pick(purchase, ['purchaseOrderDetails', 'PurchaseOrderDetails', 'productDetails', 'ProductDetails']) || [];
    await insertLineItems(client, purchaseId, branch, details);

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
  const query = { includePayment: 'true', includeOrderDelivery: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncPurchases(pool, kiotVietClient, branch, sinceIso) {
  let fetched = 0;
  let upserted = 0;

  // Endpoint la "purchaseorders", KHONG phai "/purchases" -- bay da ghi ro o
  // PlanDB.md §11 va kiotviet/API_ENDPOINTS.md.
  await kiotVietClient.fetchAllPages('purchaseorders', buildQuery(sinceIso), async (items) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertPurchase(pool, branch, item);
    }
  });

  return { fetched, upserted };
}

module.exports = { syncPurchases, upsertPurchase };
