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

async function resolveProductId(client, branch, kiotvietProductId) {
  if (!kiotvietProductId) return null;
  const result = await client.query(
    'SELECT id FROM products WHERE branch_id = $1 AND kiotviet_id = $2',
    [branch.id, kiotvietProductId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

// Dung cho ca 1 trang (~100 dong) truoc khi xu ly tung hoa don -- gop N query
// tra cuu rieng le thanh 1 query duy nhat theo bang, tranh N round-trip toi
// Postgres o xa (Render). table la hang so noi bo ('customers'|'products'),
// khong bao gio nhan tu input ben ngoai.
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

async function insertLineItems(client, invoiceId, branch, details) {
  await client.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [invoiceId]);

  let lineNo = 0;
  for (const detail of details) {
    const kiotvietProductId = pick(detail, ['productId', 'ProductId']);
    const productId = await resolveProductId(client, branch, kiotvietProductId);
    const quantity = pick(detail, ['quantity', 'Quantity']);
    const price = pick(detail, ['price', 'Price']);
    const discount = pick(detail, ['discount', 'Discount']) || 0;
    const discountRatio = pick(detail, ['discountRatio', 'DiscountRatio']);
    const subTotal = pick(detail, ['subTotal', 'SubTotal']);
    const lineAmount = subTotal !== null ? subTotal : (Number(price) || 0) * (Number(quantity) || 0) - Number(discount || 0);

    await client.query(
      `INSERT INTO invoice_line_items (
         invoice_id, branch_id, line_no, product_id, kiotviet_product_id,
         product_code_snapshot, product_name_snapshot, quantity, price, discount,
         discount_ratio, line_amount, note
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        invoiceId, branch.id, lineNo, productId, kiotvietProductId,
        pick(detail, ['productCode', 'ProductCode']), pick(detail, ['productName', 'ProductName']),
        quantity, price, discount, discountRatio, lineAmount, pick(detail, ['note', 'Note'])
      ]
    );
    lineNo++;
  }
}

// Ban bulk cua insertLineItems -- dung khi da co san productMap (resolve
// truoc theo trang). Van XOA-CHEN-LAI nhu ban goc, nhung CHEN bang 1 cau
// INSERT ... unnest() duy nhat thay vi loop N cau rieng.
async function insertLineItemsBulk(client, invoiceId, branch, details, productMap) {
  await client.query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [invoiceId]);
  if (details.length === 0) return;

  const lineNos = [];
  const productIds = [];
  const kiotvietProductIds = [];
  const productCodes = [];
  const productNames = [];
  const quantities = [];
  const prices = [];
  const discounts = [];
  const discountRatios = [];
  const lineAmounts = [];
  const notes = [];

  details.forEach((detail, lineNo) => {
    const kiotvietProductId = pick(detail, ['productId', 'ProductId']);
    const productId = kiotvietProductId ? (productMap.get(String(kiotvietProductId)) || null) : null;
    const quantity = pick(detail, ['quantity', 'Quantity']);
    const price = pick(detail, ['price', 'Price']);
    const discount = pick(detail, ['discount', 'Discount']) || 0;
    const discountRatio = pick(detail, ['discountRatio', 'DiscountRatio']);
    const subTotal = pick(detail, ['subTotal', 'SubTotal']);
    const lineAmount = subTotal !== null ? subTotal : (Number(price) || 0) * (Number(quantity) || 0) - Number(discount || 0);

    lineNos.push(lineNo);
    productIds.push(productId);
    kiotvietProductIds.push(kiotvietProductId);
    productCodes.push(pick(detail, ['productCode', 'ProductCode']));
    productNames.push(pick(detail, ['productName', 'ProductName']));
    quantities.push(quantity);
    prices.push(price);
    discounts.push(discount);
    discountRatios.push(discountRatio);
    lineAmounts.push(lineAmount);
    notes.push(pick(detail, ['note', 'Note']));
  });

  await client.query(
    `INSERT INTO invoice_line_items (
       invoice_id, branch_id, line_no, product_id, kiotviet_product_id,
       product_code_snapshot, product_name_snapshot, quantity, price, discount,
       discount_ratio, line_amount, note
     )
     SELECT $1, $2, u.*
     FROM unnest(
       $3::int[], $4::bigint[], $5::bigint[], $6::text[], $7::text[],
       $8::numeric[], $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[], $13::text[]
     ) AS u(line_no, product_id, kiotviet_product_id, product_code_snapshot, product_name_snapshot,
            quantity, price, discount, discount_ratio, line_amount, note)`,
    [
      invoiceId, branch.id, lineNos, productIds, kiotvietProductIds, productCodes, productNames,
      quantities, prices, discounts, discountRatios, lineAmounts, notes
    ]
  );
}

// maps (tuy chon) = { customerMap, productMap, staffMap } da resolve san theo
// trang (xem upsertInvoicesPage). Khi KHONG truyen maps (vd backfill.js goi
// truc tiep tung hoa don rieng le, khong theo trang), giu nguyen hanh vi cu:
// tra cuu/upsert truc tiep tung query -- cham hon nhung dung 100% nhu truoc,
// khong lam hong backfill.
async function upsertInvoice(pool, branch, invoice, maps = null) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const kiotvietId = pick(invoice, ['id', 'Id', 'invoiceId', 'InvoiceId']);
    const invoiceCode = pick(invoice, ['code', 'Code', 'invoiceCode', 'InvoiceCode']);
    const purchaseDate = parseModifiedDate(pick(invoice, ['purchaseDate', 'PurchaseDate']));
    const orderCode = pick(invoice, ['orderCode', 'OrderCode']);
    const kiotvietCustomerId = pick(invoice, ['customerId', 'CustomerId']);
    const customerId = maps
      ? (kiotvietCustomerId ? (maps.customerMap.get(String(kiotvietCustomerId)) || null) : null)
      : await resolveCustomerId(client, branch, kiotvietCustomerId);
    const customerCodeSnapshot = pick(invoice, ['customerCode', 'CustomerCode']);
    const customerNameSnapshot = pick(invoice, ['customerName', 'CustomerName']);
    const customerContactSnapshot = pick(invoice, ['customerContactNumber', 'CustomerContactNumber', 'contactNumber', 'ContactNumber']);
    const soldById = pick(invoice, ['soldById', 'SoldById']);
    const soldByName = pick(invoice, ['soldByName', 'SoldByName']);
    const soldByStaffId = maps
      ? (soldById ? (maps.staffMap.get(String(soldById)) || null) : null)
      : await upsertStaffFromEntity(client, branch, { kiotvietId: soldById, fullName: soldByName, discoveredVia: 'invoice' });
    const kiotvietBranchId = pick(invoice, ['branchId', 'BranchId']);
    const kiotvietBranchName = pick(invoice, ['branchName', 'BranchName']);
    const totalAmount = pick(invoice, ['total', 'Total']);
    const discountAmount = pick(invoice, ['discount', 'Discount']) || 0;
    const totalPayment = pick(invoice, ['totalPayment', 'TotalPayment']) || 0;
    const status = pick(invoice, ['status', 'Status']);
    const description = pick(invoice, ['description', 'Description']);
    const usingCod = pick(invoice, ['usingCod', 'UsingCod']);
    const modifiedAt = parseModifiedDate(pick(invoice, ['modifiedDate', 'ModifiedDate']));

    const result = await client.query(
      `INSERT INTO invoices (
         branch_id, kiotviet_id, invoice_code, purchase_date, order_code, customer_id,
         kiotviet_customer_id, customer_code_snapshot, customer_name_snapshot, customer_contact_snapshot,
         sold_by_staff_id, kiotviet_branch_id, kiotviet_branch_name, total_amount, discount_amount,
         total_payment, status, description, using_cod, kiotviet_modified_at, kiotviet_synced_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now(), now())
       ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
         invoice_code = EXCLUDED.invoice_code,
         purchase_date = EXCLUDED.purchase_date,
         order_code = EXCLUDED.order_code,
         customer_id = EXCLUDED.customer_id,
         kiotviet_customer_id = EXCLUDED.kiotviet_customer_id,
         customer_code_snapshot = EXCLUDED.customer_code_snapshot,
         customer_name_snapshot = EXCLUDED.customer_name_snapshot,
         customer_contact_snapshot = EXCLUDED.customer_contact_snapshot,
         sold_by_staff_id = EXCLUDED.sold_by_staff_id,
         kiotviet_branch_id = EXCLUDED.kiotviet_branch_id,
         kiotviet_branch_name = EXCLUDED.kiotviet_branch_name,
         total_amount = EXCLUDED.total_amount,
         discount_amount = EXCLUDED.discount_amount,
         total_payment = EXCLUDED.total_payment,
         status = EXCLUDED.status,
         description = EXCLUDED.description,
         using_cod = EXCLUDED.using_cod,
         kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
         kiotviet_synced_at = now(),
         updated_at = now()
       RETURNING id`,
      [
        branch.id, kiotvietId, invoiceCode, purchaseDate, orderCode, customerId,
        kiotvietCustomerId, customerCodeSnapshot, customerNameSnapshot, customerContactSnapshot,
        soldByStaffId, kiotvietBranchId, kiotvietBranchName, totalAmount, discountAmount,
        totalPayment, status, description, usingCod === null ? false : usingCod, modifiedAt
      ]
    );
    const invoiceId = result.rows[0].id;

    const details = pick(invoice, ['invoiceDetails', 'InvoiceDetails']) || [];
    if (maps) {
      await insertLineItemsBulk(client, invoiceId, branch, details, maps.productMap);
    } else {
      await insertLineItems(client, invoiceId, branch, details);
    }

    await client.query('COMMIT');
    return 1;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Resolve customer/product/staff 1 lan cho ca trang (~100 hoa don) truoc khi
// ghi -- xem ghi chu o upsertInvoice. Tung hoa don van transaction rieng
// (upsertInvoice), giu dung tinh chat "1 hoa don loi khong lam hong hoa don
// khac trong cung trang" (invoicesSync.test.js).
async function upsertInvoicesPage(pool, branch, invoices) {
  if (invoices.length === 0) return 0;

  const customerKiotIds = invoices.map((inv) => pick(inv, ['customerId', 'CustomerId']));
  const customerMap = await batchResolveByKiotvietId(pool, branch.id, 'customers', customerKiotIds);

  const productKiotIds = [];
  for (const inv of invoices) {
    const details = pick(inv, ['invoiceDetails', 'InvoiceDetails']) || [];
    for (const detail of details) productKiotIds.push(pick(detail, ['productId', 'ProductId']));
  }
  const productMap = await batchResolveByKiotvietId(pool, branch.id, 'products', productKiotIds);

  const staffEntries = invoices.map((inv) => ({
    kiotvietId: pick(inv, ['soldById', 'SoldById']),
    fullName: pick(inv, ['soldByName', 'SoldByName'])
  }));
  const staffMap = await upsertStaffBatch(pool, branch, staffEntries, 'invoice');

  let upserted = 0;
  for (const invoice of invoices) {
    upserted += await upsertInvoice(pool, branch, invoice, { customerMap, productMap, staffMap });
  }
  return upserted;
}

function buildQuery(sinceIso) {
  const query = { includePayment: 'true', includeInvoiceDelivery: 'true', IncludeSaleChannel: 'true' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncInvoices(pool, kiotVietClient, branch, sinceIso) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('invoices', buildQuery(sinceIso), async (items) => {
    fetched += items.length;
    upserted += await upsertInvoicesPage(pool, branch, items);
  });

  return { fetched, upserted };
}

module.exports = { syncInvoices, upsertInvoice };
