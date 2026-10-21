'use strict';

// Truy van Postgres cho Yeu cau xuat VAT (bang vat_requests / vat_request_history, migration 0076).
// Luat phan quyen / khoa / version nam o service.js; file nay chi doc ghi.

const { createMatcher, fold } = require('../shared/fuzzySearch');

const SELECT_COLUMNS = `r.id, r.created_at, r.updated_at, r.created_by, r.created_by_name, r.created_by_email, r.is_legacy,
  r.customer_name, r.customer_code, r.product_code, r.product_key,
  COALESCE(NULLIF(pr.product_name, ''), r.product_name) AS product_name,
  r.quantity, r.unit_price_excl_vat, r.total_amount, r.full_vat, r.sale_note, r.status, r.accountant_note,
  to_char(r.arrival_date, 'YYYY-MM-DD') AS arrival_date, r.version`;
const FROM_REQUESTS = `FROM vat_requests r LEFT JOIN product_report pr ON lower(btrim(pr.product_code)) = r.product_key`;
const LIST_LIMIT = 5000;

async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** filters: { statuses[], createdBy, productKey, q, from, to } (from/to la ngay VN 'YYYY-MM-DD'). */
async function listRequests(db, filters = {}) {
  const where = ['NOT r.is_deleted'];
  const params = [];
  const add = value => { params.push(value); return `$${params.length}`; };
  if (filters.statuses && filters.statuses.length) where.push(`r.status = ANY(${add(filters.statuses)}::text[])`);
  if (filters.createdBy) where.push(`r.created_by = ${add(filters.createdBy)}`);
  if (filters.productKey) where.push(`r.product_key = ${add(filters.productKey)}`);
  if (filters.from) where.push(`r.created_at >= (${add(filters.from)}::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
  if (filters.to) where.push(`r.created_at < ((${add(filters.to)}::date + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')`);
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS} ${FROM_REQUESTS} WHERE ${where.join(' AND ')}
     ORDER BY r.created_at DESC NULLS LAST, r.id DESC LIMIT ${LIST_LIMIT + 1}`,
    params
  );
  const truncated = rows.length > LIST_LIMIT;
  const limited = rows.slice(0, LIST_LIMIT);
  if (!filters.q) return { rows: limited, truncated };
  // Tim gan dung (cung luat voi o tim tren man hinh): loc + xep theo diem sau khi lay du lieu theo bo loc.
  const matcher = createMatcher(filters.q);
  if (matcher.empty) return { rows: limited, truncated };
  const scored = [];
  limited.forEach((row, index) => {
    const text = fold([row.product_code, row.product_name, row.customer_code, row.customer_name, row.sale_note, row.accountant_note, row.created_by_name].join(' '));
    const score = matcher.score(text);
    if (score > 0) scored.push({ row, index, score });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { rows: scored.map(entry => entry.row), truncated };
}

async function getRequest(db, id, { forUpdate = false } = {}) {
  const { rows } = await db.query(
    `SELECT ${SELECT_COLUMNS} ${FROM_REQUESTS} WHERE r.id = $1 AND NOT r.is_deleted${forUpdate ? ' FOR UPDATE OF r' : ''}`,
    [id]
  );
  return rows[0] || null;
}

async function insertRequest(client, values) {
  const columns = Object.keys(values);
  const { rows } = await client.query(
    `INSERT INTO vat_requests (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    columns.map(column => values[column])
  );
  return rows[0].id;
}

/** Ghi thay doi + tang version; tra false khi version da doi (nguoi khac vua luu). */
async function updateRequest(client, id, changes, expectedVersion) {
  const columns = Object.keys(changes);
  const sets = columns.map((column, i) => `${column} = $${i + 3}`);
  const { rows } = await client.query(
    `UPDATE vat_requests SET ${[...sets, 'version = version + 1', 'updated_at = now()'].join(', ')}
     WHERE id = $1 AND version = $2 AND NOT is_deleted RETURNING id`,
    [id, expectedVersion, ...columns.map(column => changes[column])]
  );
  return rows.length > 0;
}

async function insertHistory(client, entries) {
  for (const entry of entries) {
    await client.query(
      `INSERT INTO vat_request_history (request_id, changed_by, changed_by_name, action, field, old_value, new_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [entry.requestId, entry.changedBy || null, entry.changedByName || '', entry.action, entry.field || null,
        entry.oldValue ?? null, entry.newValue ?? null]
    );
  }
}

async function listHistory(db, id) {
  const { rows } = await db.query(
    `SELECT id, changed_at, changed_by, changed_by_name, action, field, old_value, new_value
     FROM vat_request_history WHERE request_id = $1 ORDER BY changed_at DESC, id DESC`,
    [id]
  );
  return rows;
}

/** Ten SP hien tai theo ma (product_report gop 2 co so). */
async function findProduct(db, productCode) {
  const { rows } = await db.query(
    `SELECT product_code, product_name FROM product_report WHERE lower(btrim(product_code)) = lower(btrim($1)) LIMIT 1`,
    [productCode]
  );
  return rows[0] || null;
}

/** Tra nhieu ma SP cung luc (form nhieu dong) -> Map(lower(btrim(code)) -> { product_code, product_name }). */
async function findProducts(db, productCodes) {
  const keys = [...new Set(productCodes.map(code => String(code || '').trim().toLowerCase()).filter(Boolean))];
  if (!keys.length) return new Map();
  const { rows } = await db.query(
    `SELECT product_code, product_name, lower(btrim(product_code)) AS product_key FROM product_report
     WHERE lower(btrim(product_code)) = ANY($1::text[])`,
    [keys]
  );
  return new Map(rows.map(row => [row.product_key, row]));
}

/** Gia VAT gan nhat cua nhieu ma (goi y gia cho tung dong) -> Map(product_key -> { price, created_at, customer_name }). */
async function latestProductPrices(db, productKeys) {
  if (!productKeys.length) return new Map();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (product_key) product_key, unit_price_excl_vat AS price, created_at, customer_name
     FROM vat_requests
     WHERE NOT is_deleted AND product_key = ANY($1::text[]) AND unit_price_excl_vat > 0
     ORDER BY product_key, created_at DESC NULLS LAST, id DESC`,
    [productKeys]
  );
  return new Map(rows.map(row => [row.product_key, row]));
}

async function suggestProducts(db, query, limit) {
  const { rows } = await db.query(
    `SELECT product_code, product_name FROM product_report
     WHERE product_code ILIKE $1 OR product_name ILIKE $1
     ORDER BY (lower(product_code) = lower($2)) DESC, (product_code ILIKE $3) DESC, length(product_code), product_code
     LIMIT $4`,
    [`%${query}%`, query, `${query}%`, limit]
  );
  return rows;
}

/** Ten khach tung dung trong ORDER VAT, ke ca dong import khong co ma KiotViet. */
async function recentCustomers(db) {
  const { rows } = await db.query(
    `SELECT customer_name, customer_code, max(created_at) AS last_order_at, count(*)::int AS order_count
     FROM vat_requests WHERE NOT is_deleted AND btrim(customer_name) <> ''
     GROUP BY customer_name, customer_code
     ORDER BY max(created_at) DESC NULLS LAST LIMIT 5000`
  );
  return rows;
}

/** Gia cua yeu cau VAT gan nhat cho cung ma SP; bo gia trong cua dong import cu. */
async function latestProductPrice(db, productCode) {
  const { rows } = await db.query(
    `SELECT unit_price_excl_vat AS price, created_at, customer_name
     FROM vat_requests
     WHERE NOT is_deleted AND product_key = lower(btrim($1)) AND unit_price_excl_vat > 0
     ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1`,
    [productCode]
  );
  return rows[0] || null;
}

/** P: tong SL cac yeu cau cung ma dang 3 (cho khai chen) / 4 (cho cont ve). */
async function pendingInsertQuantities(db, productKeys) {
  if (!productKeys.length) return new Map();
  const { rows } = await db.query(
    `SELECT product_key, sum(quantity) AS qty FROM vat_requests
     WHERE NOT is_deleted AND status IN ('3', '4') AND product_key = ANY($1::text[]) GROUP BY product_key`,
    [productKeys]
  );
  return new Map(rows.map(row => [row.product_key, Number(row.qty) || 0]));
}

/** Q/R: dong CONT chua ve (1 chua lich, 2 chua boc, 3 da boc) — bang Hang du kien (0053), theo thu tu sheet. */
async function incomingContainers(db, productKeys) {
  if (!productKeys.length) return new Map();
  try {
    const { rows } = await db.query(
      `SELECT product_key, container_name, status_label, eta FROM product_container_lines
       WHERE status IN (1, 2, 3) AND product_key = ANY($1::text[])
       ORDER BY sheet_order, container_row, source_row`,
      [productKeys]
    );
    const result = new Map();
    for (const row of rows) {
      if (!result.has(row.product_key)) result.set(row.product_key, []);
      result.get(row.product_key).push({ containerName: row.container_name, statusLabel: row.status_label, eta: row.eta });
    }
    return result;
  } catch (error) {
    if (error.code !== '42P01') throw error;
    return new Map();
  }
}

async function listCreators(db) {
  const { rows } = await db.query(
    `SELECT created_by, max(created_by_name) AS name FROM vat_requests
     WHERE NOT is_deleted AND created_by IS NOT NULL GROUP BY created_by ORDER BY 2`
  );
  return rows.map(row => ({ id: row.created_by, name: row.name }));
}

module.exports = {
  LIST_LIMIT,
  withTransaction,
  listRequests,
  getRequest,
  insertRequest,
  updateRequest,
  insertHistory,
  listHistory,
  findProduct,
  findProducts,
  latestProductPrices,
  suggestProducts,
  recentCustomers,
  latestProductPrice,
  pendingInsertQuantities,
  incomingContainers,
  listCreators
};
