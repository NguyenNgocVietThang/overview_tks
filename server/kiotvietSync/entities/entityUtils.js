'use strict';

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

module.exports = { value, array, upsertRows, createSimpleEntity };
