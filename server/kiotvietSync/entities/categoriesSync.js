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

async function upsertCategory(pool, branch, category) {
  const kiotvietId = pick(category, ['categoryId', 'CategoryId', 'id', 'Id']);
  const kiotvietParentId = pick(category, ['parentId', 'ParentId']);
  const name = pick(category, ['categoryName', 'CategoryName', 'name', 'Name']);
  const hasChild = Boolean(pick(category, ['hasChild', 'HasChild']));
  const modifiedAt = parseModifiedDate(pick(category, ['modifiedDate', 'ModifiedDate']));

  await pool.query(
    `INSERT INTO categories (branch_id, kiotviet_id, kiotviet_parent_id, name, has_child, kiotviet_modified_at, kiotviet_synced_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       kiotviet_parent_id = EXCLUDED.kiotviet_parent_id,
       name = EXCLUDED.name,
       has_child = EXCLUDED.has_child,
       kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
       kiotviet_synced_at = now(),
       updated_at = now()`,
    [branch.id, kiotvietId, kiotvietParentId, name, hasChild, modifiedAt]
  );
  return 1;
}

function buildQuery(sinceIso) {
  const query = { hierachicalData: 'false' };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncCategories(pool, kiotVietClient, branch, sinceIso) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('categories', buildQuery(sinceIso), async (items) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertCategory(pool, branch, item);
    }
  });

  return { fetched, upserted };
}

module.exports = { syncCategories, upsertCategory };
