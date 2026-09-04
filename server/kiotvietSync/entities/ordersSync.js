'use strict';

const { parseKiotVietDateTime } = require('../vietnamTime');
const { upsertStaffFromEntity, upsertStaffBatch } = require('./staffSync');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function resolveCustomerId(client, branch, kiotvietCustomerId) {
  if (!kiotvietCustomerId) return null;
  const result = await client.query(
    'SELECT id FROM customers WHERE branch_id = $1 AND kiotviet_id = $2',
    [branch.id, kiotvietCustomerId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

// Dung cho ca 1 trang (~100 dong) truoc khi xu ly tung don hang -- xem ghi
// chu tuong ung trong invoicesSync.js.
async function batchResolveByKiotvietId(pool, branchId, table, kiotvietIds) {
  const distinct = [...new Set(kiotvietIds.filter((v) => v !== null && v !== undefined))];
  if (distinct.length === 0) return new Map();
  const result = await pool.query(
    `SELECT kiotviet_id, id FROM ${table} WHERE branch_id = $1 AND kiotviet_id = ANY($2::bigint[])`,
    [branchId, distinct]
  );
  const map = new Map();
  for (const row of result.rows) map.set(String(row.kiotviet_id), row.id);
  return map;
}

// maps (tuy chon) = { customerMap, staffMap } da resolve san theo trang (xem
// upsertOrdersPage). Khi khong truyen maps, giu nguyen hanh vi cu (tra
// cuu/upsert truc tiep tung query) -- dung cho cac loi goi truc tiep khac
// ngoai syncOrders neu co trong tuong lai.
async function upsertOrder(pool, branch, order, maps = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kiotvietId = pick(order, ['id', 'Id', 'orderId', 'OrderId']);
    const orderCode = pick(order, ['code', 'Code', 'orderCode', 'OrderCode']);
    const orderDate = parseModifiedDate(pick(order, ['purchaseDate', 'PurchaseDate', 'orderDate', 'OrderDate']));
    const kiotvietCustomerId = pick(order, ['customerId', 'CustomerId']);
    const customerId = maps
      ? (kiotvietCustomerId ? (maps.customerMap.get(String(kiotvietCustomerId)) || null) : null)
      : await resolveCustomerId(client, branch, kiotvietCustomerId);
    const customerCodeSnapshot = pick(order, ['customerCode', 'CustomerCode']);
    const customerNameSnapshot = pick(order, ['customerName', 'CustomerName']);
    const customerContactSnapshot = pick(order, ['customerContactNumber', 'CustomerContactNumber', 'contactNumber', 'ContactNumber']);
    const createdById = pick(order, ['soldById', 'SoldById', 'createdById', 'CreatedById']);
    const createdByName = pick(order, ['soldByName', 'SoldByName', 'createdByName', 'CreatedByName']);
    const createdByStaffId = maps
      ? (createdById ? (maps.staffMap.get(String(createdById)) || null) : null)
      : await upsertStaffFromEntity(client, branch, { kiotvietId: createdById, fullName: createdByName, discoveredVia: 'order' });
    const kiotvietBranchId = pick(order, ['branchId', 'BranchId']);
    const kiotvietBranchName = pick(order, ['branchName', 'BranchName']);
    const totalAmount = pick(order, ['total', 'Total']);
    const totalPayment = pick(order, ['totalPayment', 'TotalPayment']) || 0;
    const discountAmount = pick(order, ['discount', 'Discount']) || 0;
    const discountRatio = pick(order, ['discountRatio', 'DiscountRatio']);
    const status = pick(order, ['status', 'Status']);
    const description = pick(order, ['description', 'Description']);
    const usingCod = pick(order, ['usingCod', 'UsingCod']);
    const modifiedAt = parseModifiedDate(pick(order, ['modifiedDate', 'ModifiedDate']));

    await client.query(
      `INSERT INTO orders (
         branch_id, kiotviet_id, order_code, order_date, customer_id, kiotviet_customer_id,
         customer_code_snapshot, customer_name_snapshot, customer_contact_snapshot, created_by_staff_id,
         kiotviet_branch_id, kiotviet_branch_name, total_amount, total_payment, discount_amount,
         discount_ratio, status, description, using_cod, kiotviet_modified_at, kiotviet_synced_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now(), now())
       ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
         order_code = EXCLUDED.order_code,
         order_date = EXCLUDED.order_date,
         customer_id = EXCLUDED.customer_id,
         kiotviet_customer_id = EXCLUDED.kiotviet_customer_id,
         customer_code_snapshot = EXCLUDED.customer_code_snapshot,
         customer_name_snapshot = EXCLUDED.customer_name_snapshot,
         customer_contact_snapshot = EXCLUDED.customer_contact_snapshot,
         created_by_staff_id = EXCLUDED.created_by_staff_id,
         kiotviet_branch_id = EXCLUDED.kiotviet_branch_id,
         kiotviet_branch_name = EXCLUDED.kiotviet_branch_name,
         total_amount = EXCLUDED.total_amount,
         total_payment = EXCLUDED.total_payment,
         discount_amount = EXCLUDED.discount_amount,
         discount_ratio = EXCLUDED.discount_ratio,
         status = EXCLUDED.status,
         description = EXCLUDED.description,
         using_cod = EXCLUDED.using_cod,
         kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
         kiotviet_synced_at = now(),
         updated_at = now()`,
      [
        branch.id, kiotvietId, orderCode, orderDate, customerId, kiotvietCustomerId,
        customerCodeSnapshot, customerNameSnapshot, customerContactSnapshot, createdByStaffId,
        kiotvietBranchId, kiotvietBranchName, totalAmount, totalPayment, discountAmount,
        discountRatio, status, description, usingCod === null ? false : usingCod, modifiedAt
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

// Resolve customer/staff 1 lan cho ca trang truoc khi ghi -- tung don hang
// van transaction rieng (upsertOrder), giu dung tinh chat 1 don loi khong
// lam hong don khac trong cung trang (ordersSync.test.js).
async function upsertOrdersPage(pool, branch, orders) {
  if (orders.length === 0) return 0;

  const customerKiotIds = orders.map((order) => pick(order, ['customerId', 'CustomerId']));
  const customerMap = await batchResolveByKiotvietId(pool, branch.id, 'customers', customerKiotIds);

  const staffEntries = orders.map((order) => ({
    kiotvietId: pick(order, ['soldById', 'SoldById', 'createdById', 'CreatedById']),
    fullName: pick(order, ['soldByName', 'SoldByName', 'createdByName', 'CreatedByName'])
  }));
  const staffMap = await upsertStaffBatch(pool, branch, staffEntries, 'order');

  let upserted = 0;
  for (const order of orders) {
    upserted += await upsertOrder(pool, branch, order, { customerMap, staffMap });
  }
  return upserted;
}

function buildQuery(sinceIso) {
  // Live probe 2026-08-30 xac nhan fromOrderDate bi API bo qua hoan toan;
  // lastModifiedFrom la tham so duy nhat hoat dong cho /orders (khac giả
  // định ban đầu ở PlanDB-Phase1-Spec.md §9.1) — xem kiotviet/API_ENDPOINTS.md.
  const query = { includePayment: 'true', includeOrderDelivery: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncOrders(pool, kiotVietClient, branch, sinceIso, options = {}) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('orders', buildQuery(sinceIso), async (items, meta) => {
    fetched += items.length;
    upserted += await upsertOrdersPage(pool, branch, items);
    if (options.onProgress && meta && typeof meta.nextItem === 'number') {
      await options.onProgress(meta.nextItem);
    }
  }, { startItem: options.startItem || 0 });

  return { fetched, upserted };
}

module.exports = { syncOrders, upsertOrder };
