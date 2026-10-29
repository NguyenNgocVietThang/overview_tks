'use strict';
const CONFIG = require('../../config');
const { value, createSimpleEntity } = require('./entityUtils');

const mapProduct = (x) => [value(x,'Id','id','ProductId','productId'), value(x,'Code','code'), value(x,'Name','name'), value(x,'CategoryId','categoryId'), value(x,'BasePrice','basePrice'), value(x,'Unit','unit'), value(x,'IsActive','isActive'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')];
const base = createSimpleEntity({
  entity: 'products',
  // Chi xin dung field Dashboard thuc su doc (xem dashboard/dashboardPgReader.js:
  // "Ton kho"/"Khach dat"/"Gia von" tu inventories, "Vi tri" tu productShelves).
  // Truoc day con includePricebook/IncludeSerials/IncludeBatchExpires/
  // includeWarranties/includeMaterial — khong noi nao trong repo doc cac
  // field nay, chi lam payload `raw` moi san pham nang them (~2026-09-18:
  // bang products phinh len 35MB/13949 dong sau khi bat includeInventory,
  // lam cham moi truy van JOIN voi products) ma khong dung den. Bo di de
  // giam kich thuoc raw — neu sau nay can lai, them lai + backfill lai.
  listQuery: { includeInventory: 'true', includeQuantity: 'true', IncludeProductShelves: 'true', includeSoftDeletedAttribute: 'false' },
  columns: ['branch','id','code','name','category_id','base_price','unit','is_active','created_date','modified_date','raw'],
  updateColumns: ['code','name','category_id','base_price','unit','is_active','created_date','modified_date'],
  map: mapProduct
});

// KiotViet cho phep dung lai ma hang cua san pham da xoa cho san pham moi (id
// khac). Dong cu van con trong bang (sync khong nhan su kien xoa), nen upsert
// dong moi vi pham UNIQUE (branch, code) -> ca trang rollback, checkpoint
// products ket mai (su co 2026-09-26: hanoi/KCCK16, loi lap lai moi 5 phut).
// Truoc khi upsert, doi ma dong cu (id khac) dang giu ma trung thanh
// "<ma>#<id>" de nhuong ma cho san pham KiotViet hien tai.
const RELEASE_CODES_SQL = `
  UPDATE products p SET code = p.code || '#' || p.id::text, synced_at = now()
  FROM unnest($2::text[], $3::bigint[]) AS n(code, id)
  WHERE p.branch = $1 AND p.code = n.code AND p.id <> n.id`;

// ---- Doi soat day du (quet toan bo /products moi KIOTVIET_SYNC_PRODUCT_RECONCILE_INTERVAL_MS) ----
// Poll tang dan theo lastModifiedFrom co the bo sot: sua hang loat -> nhieu dong cung
// modifiedDate nen phan trang theo vi tri truot dong; sua rieng "Mo ta" (raw.description,
// nguon cua Kiem tra gia ban) co the khong bump modifiedDate. Lan quet day du (syncDriver.
// pollReconciled) ghi lai moi dong da doi, nhung voi 2 rang buoc:
// 1) KHONG ghi de raw->'inventories': ton kho/khach dat do productOnHands(+Snapshot) va rieng
//    (/products tra inventories loi thoi). Dong da co thi giu nguyen mang inventories hien co;
//    dong chua co inventories thi lay tu /products.
// 2) KHONG ghi dong khong doi (tranh WAL/Disk IO, xem project-tokosi-supabase-io-incident):
//    loc o SELECT (IS DISTINCT FROM), khong dung ON CONFLICT ... WHERE (van khoa tung dong).
// Gia tri duoc tach san tu JS bang cung ham `mapProduct` roi gui 1 JSON/trang; ep kieu
// ::numeric/::timestamptz o day cho ra dung gia tri nhu INSERT tham so cot.
const INCOMING_SQL = `
  incoming AS (
    SELECT (r->>'id')::bigint AS id, r->>'code' AS code, r->>'name' AS name,
           (r->>'category_id')::bigint AS category_id, (r->>'base_price')::numeric AS base_price,
           r->>'unit' AS unit, (r->>'is_active')::boolean AS is_active,
           (r->>'created_date')::timestamptz AS created_date, (r->>'modified_date')::timestamptz AS modified_date,
           r->'raw' AS raw
    FROM jsonb_array_elements($2::jsonb) r
  )`;

// Dong chua co trong DB: chen nguyen van /products (kem inventories). Loc NOT EXISTS truoc
// nen dong da ton tai khong bi khoa/ghi.
const INSERT_NEW_SQL = `
  WITH ${INCOMING_SQL}
  INSERT INTO products (branch, id, code, name, category_id, base_price, unit, is_active, created_date, modified_date, raw)
  SELECT $1::text, i.id, i.code, i.name, i.category_id, i.base_price, i.unit, i.is_active, i.created_date, i.modified_date, i.raw
  FROM incoming i
  WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.branch = $1::text AND p.id = i.id)
  ON CONFLICT (branch, id) DO NOTHING`;

// Dong da co: chi UPDATE khi cot first-class hoac raw (tru inventories) thuc su doi.
const UPDATE_CHANGED_SQL = `
  WITH ${INCOMING_SQL}
  UPDATE products p SET
    code = i.code, name = i.name, category_id = i.category_id, base_price = i.base_price, unit = i.unit,
    is_active = i.is_active, created_date = i.created_date, modified_date = i.modified_date,
    raw = (i.raw - 'inventories') || CASE
      WHEN p.raw->'inventories' IS NOT NULL THEN jsonb_build_object('inventories', p.raw->'inventories')
      WHEN i.raw->'inventories' IS NOT NULL THEN jsonb_build_object('inventories', i.raw->'inventories')
      ELSE '{}'::jsonb END,
    synced_at = now()
  FROM incoming i
  WHERE p.branch = $1::text AND p.id = i.id
    AND ((p.code, p.name, p.category_id, p.base_price, p.unit, p.is_active, p.created_date, p.modified_date)
           IS DISTINCT FROM (i.code, i.name, i.category_id, i.base_price, i.unit, i.is_active, i.created_date, i.modified_date)
         OR (p.raw - 'inventories') IS DISTINCT FROM (i.raw - 'inventories'))`;

// Hang da xoa o KiotViet khong con trong snapshot day du -> chi DANH DAU, khong xoa vat ly.
// Cac man hinh (Hang hoa, Bao cao hang hoa, Kiem tra gia...) deu loc `is_active IS NOT FALSE`
// nen dong da danh dau tu roi khoi danh sach; neu KiotViet dung lai id thi upsert tra lai
// is_active theo API. `synced_at <= before` bao ve dong moi duoc poll tang dan ghi SAU khi
// lan quet bat dau (chua kip co trong snapshot). Dong da is_active=false giu nguyen (khong ghi).
const MARK_MISSING_SQL = `
  UPDATE products
  SET is_active = false,
      raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('isActive', false, 'sourceMissingAt', now()),
      synced_at = now()
  WHERE branch = $1 AND NOT (id = ANY($2::bigint[])) AND synced_at <= $3::timestamptz
    AND is_active IS DISTINCT FROM false`;

async function releaseCodes(pgClient, branch, items) {
  const codes = items.map((x) => value(x, 'Code', 'code'));
  const ids = items.map((x) => String(value(x, 'Id', 'id', 'ProductId', 'productId')));
  await pgClient.query(RELEASE_CODES_SQL, [branch, codes, ids]);
}

module.exports = {
  ...base,
  // Cho syncDriver.pollReconciled (cung co che voi customers): quet day du moi 24 gio.
  reconcileIntervalMs: CONFIG.KIOTVIET_SYNC_PRODUCT_RECONCILE_INTERVAL_MS,
  reconcileMarkerKey: 'productsReconciledAt',
  snapshotLabel: 'product',
  async upsertPage(pgClient, branch, items) {
    if (!items.length) return;
    await releaseCodes(pgClient, branch, items);
    await base.upsertPage(pgClient, branch, items);
  },
  async reconcilePage(pgClient, branch, items) {
    if (!items.length) return;
    await releaseCodes(pgClient, branch, items);
    const payload = JSON.stringify(items.map((item) => {
      const [id, code, name, category_id, base_price, unit, is_active, created_date, modified_date] = mapProduct(item);
      return { id, code, name, category_id, base_price, unit, is_active, created_date, modified_date, raw: item };
    }));
    await pgClient.query(INSERT_NEW_SQL, [branch, payload]);
    await pgClient.query(UPDATE_CHANGED_SQL, [branch, payload]);
  },
  async markMissing(pgClient, branch, ids, before) {
    if (!ids.length) throw new Error('Empty product snapshot cannot mark missing records');
    await pgClient.query(MARK_MISSING_SQL, [branch, ids, before]);
  }
};
