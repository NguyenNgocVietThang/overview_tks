'use strict';
const crypto = require('node:crypto');

function value(source, ...keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined) return source[key];
  }
  return null;
}

function array(source, ...keys) {
  const found = value(source, ...keys);
  return Array.isArray(found) ? found : [];
}

async function upsertRows(pgClient, sql, branch, items, map) {
  for (const item of items) await pgClient.query(sql, [branch, ...map(item), item]);
}

function createSimpleEntity({ entity, endpoint = entity, listQuery, columns, updateColumns, map, hasUpperBound = true }) {
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
  const updates = updateColumns.map((column) => `${column}=EXCLUDED.${column}`).join(', ');
  const sql = `INSERT INTO ${entity} (${columns.join(',')}) VALUES (${placeholders})
    ON CONFLICT (branch, id) DO UPDATE SET ${updates}, raw=EXCLUDED.raw, synced_at=now()`;
  return {
    entity, endpoint, listQuery, incrementalParam: 'lastModifiedFrom', hasUpperBound,
    async upsertPage(pgClient, branch, items) {
      await upsertRows(pgClient, sql, branch, items, map);
    }
  };
}

// Dau van tay on dinh (khoa sap xep) cua 1 ban ghi API — de doi soat voi cot raw_hash
// ma khong phai tai lai ca JSON raw tu Supabase (nguon Egress lon, xem purchases.js).
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const rawHash = item => crypto.createHash('sha1').update(stableStringify(item)).digest('hex');

module.exports = { value, array, upsertRows, createSimpleEntity, stableStringify, rawHash };
