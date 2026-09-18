'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
module.exports = createSimpleEntity({
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
