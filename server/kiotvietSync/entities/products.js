'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
module.exports = createSimpleEntity({
  entity: 'products',
  listQuery: { includeInventory: 'true', includeQuantity: 'true', IncludeProductShelves: 'true', includePricebook: 'true', IncludeSerials: 'true', IncludeBatchExpires: 'true', includeWarranties: 'true', includeMaterial: 'true', includeSoftDeletedAttribute: 'false' },
  columns: ['branch','id','code','name','category_id','base_price','unit','is_active','created_date','modified_date','raw'],
  updateColumns: ['code','name','category_id','base_price','unit','is_active','created_date','modified_date'],
  map: (x) => [value(x,'Id','id','ProductId','productId'), value(x,'Code','code'), value(x,'Name','name'), value(x,'CategoryId','categoryId'), value(x,'BasePrice','basePrice'), value(x,'Unit','unit'), value(x,'IsActive','isActive'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')]
});
