'use strict';

const { parseKiotVietDateTime, todayInVietnam } = require('../vietnamTime');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function resolveCategoryId(pool, branch, kiotvietCategoryId) {
  if (!kiotvietCategoryId) return null;
  const result = await pool.query(
    'SELECT id FROM categories WHERE branch_id = $1 AND kiotviet_id = $2',
    [branch.id, kiotvietCategoryId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

// product_inventory co unique key on dinh (product_id, kiotviet_branch_id) ->
// upsert truc tiep, khac chien luoc xoa-chen-lai cua line items. Bo qua khi
// Inventories[] rong/thieu -- KHONG xoa dong ton kho cu, tranh mat du lieu
// khi 1 luot poll tra thieu field (PlanDB-Phase1-Spec.md §9.2).
async function upsertProductInventory(pool, productId, inv) {
  const kiotvietBranchId = pick(inv, ['branchId', 'BranchId']) || 0;
  const kiotvietBranchName = pick(inv, ['branchName', 'BranchName']);
  const onHand = pick(inv, ['onHand', 'OnHand']);
  const reserved = pick(inv, ['reserved', 'Reserved']);
  const cost = pick(inv, ['cost', 'Cost']);
  const minQuantity = pick(inv, ['minQuantity', 'MinQuantity']);
  const maxQuantity = pick(inv, ['maxQuantity', 'MaxQuantity']);

  await pool.query(
    `INSERT INTO product_inventory (
       product_id, kiotviet_branch_id, kiotviet_branch_name, on_hand, reserved,
       cost, min_quantity, max_quantity, kiotviet_synced_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), now())
     ON CONFLICT (product_id, kiotviet_branch_id) DO UPDATE SET
       kiotviet_branch_name = EXCLUDED.kiotviet_branch_name,
       on_hand = EXCLUDED.on_hand,
       reserved = EXCLUDED.reserved,
       cost = EXCLUDED.cost,
       min_quantity = EXCLUDED.min_quantity,
       max_quantity = EXCLUDED.max_quantity,
       kiotviet_synced_at = now(),
       updated_at = now()`,
    [productId, kiotvietBranchId, kiotvietBranchName, onHand, reserved, cost, minQuantity, maxQuantity]
  );

  // DO NOTHING vi day la snapshot dau ngay -- luot poll sau trong cung ngay
  // khong ghi de (PlanDB-Phase1-Spec.md §9.2).
  await pool.query(
    `INSERT INTO inventory_daily_snapshot (product_id, kiotviet_branch_id, snapshot_date, on_hand, reserved)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (product_id, kiotviet_branch_id, snapshot_date) DO NOTHING`,
    [productId, kiotvietBranchId, todayInVietnam(), onHand, reserved]
  );
}

async function upsertProduct(pool, branch, product) {
  const kiotvietId = pick(product, ['id', 'Id', 'productId', 'ProductId']);
  const kiotvietCategoryId = pick(product, ['categoryId', 'CategoryId']);
  const categoryId = await resolveCategoryId(pool, branch, kiotvietCategoryId);
  const productCode = pick(product, ['code', 'Code', 'productCode', 'ProductCode']);
  const name = pick(product, ['name', 'Name']);
  // Khong co bang tra cuu ma type (1/2/3...) da xac minh trong repo hien co
  // (SheetSchemas.gs cung chi luu nguyen gia tri tho) -- luu nguyen chuoi so,
  // KHONG suy dien nhan 'hang_hoa'/'combo'/'dich_vu' khi chua xac minh.
  const rawType = pick(product, ['type', 'Type']);
  const productType = rawType === null ? null : String(rawType);
  const basePrice = pick(product, ['basePrice', 'BasePrice']);
  const allowsSale = pick(product, ['allowsSale', 'AllowsSale']);
  const isActive = pick(product, ['isActive', 'IsActive']);
  const unit = pick(product, ['unit', 'Unit']);
  const conversionValue = pick(product, ['conversionValue', 'ConversionValue']);
  const hasVariants = pick(product, ['hasVariants', 'HasVariants']);
  const description = pick(product, ['description', 'Description']);
  const modifiedAt = parseModifiedDate(pick(product, ['modifiedDate', 'ModifiedDate']));

  const result = await pool.query(
    `INSERT INTO products (
       branch_id, kiotviet_id, category_id, kiotviet_category_id, product_code, name,
       product_type, base_price, allows_sale, is_active, unit, conversion_value,
       has_variants, description, kiotviet_modified_at, kiotviet_synced_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       category_id = EXCLUDED.category_id,
       kiotviet_category_id = EXCLUDED.kiotviet_category_id,
       product_code = EXCLUDED.product_code,
       name = EXCLUDED.name,
       product_type = EXCLUDED.product_type,
       base_price = EXCLUDED.base_price,
       allows_sale = EXCLUDED.allows_sale,
       is_active = EXCLUDED.is_active,
       unit = EXCLUDED.unit,
       conversion_value = EXCLUDED.conversion_value,
       has_variants = EXCLUDED.has_variants,
       description = EXCLUDED.description,
       kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
       kiotviet_synced_at = now(),
       updated_at = now()
     RETURNING id`,
    [
      branch.id, kiotvietId, categoryId, kiotvietCategoryId, productCode, name,
      productType, basePrice, allowsSale === null ? true : allowsSale,
      isActive === null ? true : isActive, unit, conversionValue,
      hasVariants === null ? false : hasVariants, description, modifiedAt
    ]
  );
  const productId = result.rows[0].id;

  const inventories = pick(product, ['inventories', 'Inventories']) || [];
  for (const inv of inventories) {
    await upsertProductInventory(pool, productId, inv);
  }

  return 1;
}

function buildQuery(sinceIso) {
  const query = {
    includeInventory: 'true',
    includeQuantity: 'true',
    IncludeProductShelves: 'true',
    includePricebook: 'true',
    IncludeSerials: 'true',
    IncludeBatchExpires: 'true',
    includeWarranties: 'true',
    includeMaterial: 'true',
    includeSoftDeletedAttribute: 'false'
  };
  if (sinceIso) query.lastModifiedFrom = sinceIso;
  return query;
}

async function syncProducts(pool, kiotVietClient, branch, sinceIso, options = {}) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('products', buildQuery(sinceIso), async (items, meta) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertProduct(pool, branch, item);
    }
    if (options.onProgress && meta && typeof meta.nextItem === 'number') {
      await options.onProgress(meta.nextItem);
    }
  }, { startItem: options.startItem || 0 });

  return { fetched, upserted };
}

module.exports = { syncProducts, upsertProduct };
