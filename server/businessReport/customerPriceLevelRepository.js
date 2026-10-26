'use strict';

const { getPool } = require('../db/pool');
const { nameKey, PRICE_LEVEL_LABELS, RETAIL_NAME, UNGROUPED_SALE } = require('./businessMonths');
const { buildCustomerReport } = require('./businessReportService');
const { customerLevelFromEmail } = require('../invoicePriceAudit/priceAuditRules');
const { httpError } = require('./customerProfileRules');

const pending = () => httpError(503, 'MIGRATION_PENDING', 'Level giá nội bộ chưa sẵn sàng. Cần sao lưu và khởi tạo level giá trước.');
const fromLabel = label => Object.keys(PRICE_LEVEL_LABELS).find(k => PRICE_LEVEL_LABELS[k] === label);

async function assertInitialized(client) {
  const { rows } = await client.query('SELECT initialized_at FROM customer_price_level_state WHERE id');
  if (!rows[0]?.initialized_at) throw pending();
}

// Capture supplies its own repeatable-read client so all invoices see the same level versions.
// `createMissingAs`: khach chua co dong trong customer_price_levels (khach moi tren Kiot) duoc tao dong voi level nay
// (ON CONFLICT DO NOTHING nen khong de nguoi da set tay). Can client dang trong giao dich ghi duoc.
async function readCustomerPriceLevels(client, keys, { createMissingAs = null, withNewCustomer = false } = {}) {
  try {
    await assertInitialized(client);
    const unique = [...new Set(keys)];
    const { rows } = await client.query(`SELECT customer_key, level, version${withNewCustomer ? ', new_customer' : ''} FROM customer_price_levels WHERE customer_key = ANY($1::text[])`, [unique]);
    const extra = r => (withNewCustomer ? { newCustomer: (r && r.new_customer) || '' } : {});
    const result = Object.fromEntries(unique.map(key => [key, { level: createMissingAs || 'large', version: 0, ...extra() }]));
    for (const r of rows) result[r.customer_key] = { level: r.level, version: Number(r.version), ...extra(r) };
    const missing = unique.filter(key => !rows.some(r => r.customer_key === key));
    if (createMissingAs && missing.length) {
      const ins = await client.query(`INSERT INTO customer_price_levels(customer_key, level, updated_by_name)
        SELECT k, $2, 'Hệ thống (khách mới)' FROM unnest($1::text[]) AS k
        ON CONFLICT (customer_key) DO NOTHING RETURNING customer_key, version`, [missing, createMissingAs]);
      for (const r of ins.rows) result[r.customer_key] = { level: createMissingAs, version: Number(r.version) };
    }
    return result;
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') throw pending();
    throw err;
  }
}

// undefined = khong doi; con lai: bo ky tu dieu khien, trim, toi da 50 ky tu.
function normalizeNewCustomer(value) {
  if (value === undefined) return undefined;
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (s.length > 50) throw httpError(400, 'INVALID_NEW_CUSTOMER', 'Nhãn "Khách mới" tối đa 50 ký tự.');
  return s;
}

function createCustomerPriceLevelRepository({ pool = null } = {}) {
  const db = () => pool || getPool();
  async function transaction(fn) {
    const client = await db().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '42P01' || err.code === '42703') throw pending();
      if (err.code === '40001' || err.code === '23505') throw httpError(409, 'PRICE_LEVEL_CONFLICT', 'Level giá đã thay đổi. Vui lòng tải lại bảng.');
      throw err;
    } finally { client.release(); }
  }
  // Revenue snapshot is used only to preserve the merged level selection. Directory/email are
  // re-read and archived inside this transaction; a completed initialization is never repeated.
  async function initialize(snapshot) {
    return transaction(async client => {
      const state = (await client.query('SELECT initialized_at FROM customer_price_level_state WHERE id FOR UPDATE')).rows[0];
      if (state?.initialized_at) return { alreadyInitialized: true };
      // Prevent a source sync from changing the directory between archive and cutover.
      await client.query('LOCK TABLE customers IN SHARE MODE');
      const { rows } = await client.query(`SELECT branch, id::text AS id, code, COALESCE(name,'') AS name,
        COALESCE(raw->>'email', raw->>'Email','') AS email, COALESCE(NULLIF(btrim(raw->>'groups'),''),$1) AS sale_name,
        COALESCE(raw->>'isActive',raw->>'IsActive','true') <> 'false' AS is_active
        FROM customers ORDER BY branch, id DESC`, [UNGROUPED_SALE]);
      const directory = [], seen = new Set(), candidates = new Map(), sources = [];
      for (const r of rows) {
        const key = nameKey(r.name) || nameKey(RETAIL_NAME);
        const level = customerLevelFromEmail(r.email);
        sources.push({ branch:r.branch, customer_id:r.id, customer_code:r.code, customer_name:r.name,
          customer_key:key, source_email:r.email, source_level:level });
        if (!candidates.has(key) || candidates.get(key) === 'medium') candidates.set(key, level);
        const ref = JSON.stringify([r.branch, String(r.code || '').trim()]);
        if (!seen.has(ref)) {
          seen.add(ref);
          if (r.is_active && r.code) directory.push({ branch:r.branch, code:String(r.code).trim(), name:r.name, saleName:r.sale_name, priceLevel:PRICE_LEVEL_LABELS[level] });
        }
      }
      // Active report rows follow precisely the existing aggregation/selection rule.
      for (const row of buildCustomerReport({ ...snapshot, directory }).rows) {
        candidates.set(row.key, fromLabel(row.priceLevel) || 'medium');
      }
      await client.query(`INSERT INTO customer_price_level_sources
        (branch,customer_id,customer_code,customer_name,customer_key,source_email,source_level)
        SELECT branch,customer_id::bigint,customer_code,customer_name,customer_key,source_email,source_level
        FROM jsonb_to_recordset($1::jsonb) AS x(branch text,customer_id text,customer_code text,
          customer_name text,customer_key text,source_email text,source_level text) ON CONFLICT DO NOTHING`, [JSON.stringify(sources)]);
      await client.query(`INSERT INTO customer_price_levels(customer_key,level)
        SELECT customer_key,level FROM jsonb_to_recordset($1::jsonb) AS x(customer_key text,level text)
        ON CONFLICT DO NOTHING`, [JSON.stringify([...candidates].map(([customer_key,level]) => ({ customer_key,level })))]);
      await client.query('UPDATE customer_price_level_state SET initialized_at = now() WHERE id');
      return { archivedSources: rows.length, customerLevels: candidates.size };
    });
  }
  // newCustomer undefined = giu nguyen nhan "Khach moi"; chuoi (ke ca rong) = dat gia tri moi.
  async function saveLevel(key, level, version, actor = {}, newCustomer) {
    if (!Object.hasOwn(PRICE_LEVEL_LABELS, level) || !Number.isSafeInteger(version) || version < 0) {
      throw httpError(400, 'INVALID_PRICE_LEVEL', 'Level giá hoặc phiên bản không hợp lệ.');
    }
    const tag = normalizeNewCustomer(newCustomer);
    return transaction(async client => {
      await assertInitialized(client);
      const existing = (await client.query('SELECT level,version,new_customer FROM customer_price_levels WHERE customer_key=$1 FOR UPDATE', [key])).rows[0];
      if ((existing ? Number(existing.version) : 0) !== version) throw httpError(409, 'PRICE_LEVEL_CONFLICT', 'Level giá đã thay đổi. Vui lòng tải lại bảng.');
      const oldTag = existing?.new_customer || '';
      const nextTag = tag === undefined ? oldTag : tag;
      if (existing?.level === level && nextTag === oldTag) return { level, version, newCustomer: oldTag };
      const nextVersion = version + 1;
      const actorId = actor.id == null ? null : String(actor.id), actorName = String(actor.name || '');
      await client.query(`INSERT INTO customer_price_levels(customer_key,level,version,updated_by_id,updated_by_name,new_customer)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(customer_key) DO UPDATE SET level=EXCLUDED.level,
        version=EXCLUDED.version,updated_by_id=EXCLUDED.updated_by_id,updated_by_name=EXCLUDED.updated_by_name,
        new_customer=EXCLUDED.new_customer,updated_at=now()`,
      [key,level,nextVersion,actorId,actorName,nextTag]);
      await client.query(`INSERT INTO customer_price_level_history(customer_key,old_level,new_level,version,actor_id,actor_name,old_new_customer,new_new_customer)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [key,existing?.level || 'large',level,nextVersion,actorId,actorName,oldTag,nextTag]);
      return { level, version: nextVersion, newCustomer: nextTag };
    });
  }
  return { initialize, getLevels: keys => transaction(client => readCustomerPriceLevels(client,keys,{ withNewCustomer:true })), saveLevel, normalizeNewCustomer };
}

module.exports = { createCustomerPriceLevelRepository, normalizeNewCustomer, readCustomerPriceLevels };
