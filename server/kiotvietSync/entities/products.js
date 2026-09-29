'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
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
  map: (x) => [value(x,'Id','id','ProductId','productId'), value(x,'Code','code'), value(x,'Name','name'), value(x,'CategoryId','categoryId'), value(x,'BasePrice','basePrice'), value(x,'Unit','unit'), value(x,'IsActive','isActive'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')]
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

module.exports = {
  ...base,
  async upsertPage(pgClient, branch, items) {
    if (!items.length) return;
    const codes = items.map((x) => value(x, 'Code', 'code'));
    const ids = items.map((x) => String(value(x, 'Id', 'id', 'ProductId', 'productId')));
    await pgClient.query(RELEASE_CODES_SQL, [branch, codes, ids]);
    await base.upsertPage(pgClient, branch, items);
  }
};
