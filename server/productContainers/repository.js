'use strict';
const { getPool } = require('../db/pool');
const { INTERVAL_MS, normalizeCode } = require('./parser');

function syncMetadata(row = {}, now = Date.now()) {
  const available = Boolean(row.version && row.last_success_at);
  return {
    version: row.version || null, available,
    lastSuccessAt: row.last_success_at || null,
    lastAttemptAt: row.last_attempt_at || null,
    lastError: row.last_error ? 'Không cập nhật được dữ liệu CONT. Đang giữ lần thành công gần nhất.' : null,
    stale: available && (Boolean(row.last_error) || now - new Date(row.last_success_at).getTime() > INTERVAL_MS)
  };
}

async function readContainerSummary(pool = getPool()) {
  try {
    // Totals and version are read in ONE statement, so a concurrent snapshot
    // replacement cannot mix quantities from one version with another's date.
    const { rows } = await pool.query(`SELECT to_jsonb(s) AS sync,
      COALESCE((SELECT jsonb_object_agg(product_key, jsonb_build_object('unloadedQty',unloaded,'loadedQty',loaded))
        FROM (SELECT product_key,
          COALESCE(sum(quantity) FILTER (WHERE status IN (1,2)),0) AS unloaded,
          COALESCE(sum(quantity) FILTER (WHERE status = 3),0) AS loaded
          FROM product_container_lines WHERE status IN (1,2,3) GROUP BY product_key) totals), '{}'::jsonb) AS totals
      FROM product_container_sync s WHERE singleton = true`);
    return { containerSync: syncMetadata(rows[0]?.sync), totals: rows[0]?.totals || {} };
  } catch (error) {
    // The old report remains usable while migration 0053 awaits deployment.
    if (error.code !== '42P01') throw error;
    return { containerSync: syncMetadata(), totals: {} };
  }
}

async function getContainerMeta({ pool = getPool() } = {}) {
  try {
    const { rows } = await pool.query('SELECT * FROM product_container_sync WHERE singleton = true');
    return { containerSync: syncMetadata(rows[0]) };
  } catch (error) {
    if (error.code !== '42P01') throw error;
    return { containerSync: syncMetadata() };
  }
}

function detailError(statusCode, message, code) {
  return Object.assign(new Error(message), { statusCode, code });
}

async function getContainerDetails({ code, fullAccess = false, pool = getPool() } = {}) {
  if (typeof code !== 'string' || !code.trim()) throw detailError(400,'Thiếu mã hàng.','CONTAINER_CODE_REQUIRED');
  const key = normalizeCode(code);
  const { rows: eligible } = await pool.query(`SELECT 1 FROM product_report pr
    WHERE lower(btrim(pr.product_code)) = $1 AND EXISTS (
      SELECT 1 FROM products p WHERE p.code = pr.product_code
      AND p.branch IN ('hanoi','saigon') AND p.is_active IS NOT FALSE) LIMIT 1`,[key]);
  if (!eligible.length) throw detailError(404,'Mã hàng không có trong báo cáo hiện hành.','CONTAINER_PRODUCT_NOT_FOUND');
  let snapshot;
  try {
    const extra = fullAccess ? `, 'orderedBy', ordered_by, 'listedAt', listed_at,
      'unitsPerPackage',units_per_package,'packageCount',package_count,'vietnamPrice',vietnam_price` : '';
    const { rows } = await pool.query(`SELECT to_jsonb(s) ${fullAccess ? '' : "- 'warnings'"} AS sync,
      COALESCE((SELECT jsonb_agg(item ORDER BY sheet_order,source_row) FROM (
        SELECT sheet_order,source_row,jsonb_build_object('containerName',container_name,
          'status',status,'statusLabel',status_label,'eta',eta,'color',color,
          'saleNote',sale_note,'quantity',quantity ${extra}) AS item
        FROM product_container_lines WHERE product_key = $1 ${fullAccess ? '' : 'AND status IN (1,2,3)'}
      ) lines), '[]'::jsonb) AS items
      FROM product_container_sync s WHERE singleton = true`,[key]);
    snapshot = rows[0];
  } catch (error) {
    if (error.code !== '42P01') throw error;
  }
  const containerSync = syncMetadata(snapshot?.sync);
  if (!containerSync.available) {
    throw Object.assign(detailError(503,'Dữ liệu Hàng dự kiến chưa sẵn sàng.','CONTAINER_SNAPSHOT_UNAVAILABLE'),{containerSync});
  }
  return {
    code: code.trim(), fullAccess, rows: snapshot.items || [], containerSync,
    ...(fullAccess ? { warnings: snapshot.sync.warnings || [] } : {})
  };
}

module.exports = { syncMetadata, readContainerSummary, getContainerMeta, getContainerDetails };
