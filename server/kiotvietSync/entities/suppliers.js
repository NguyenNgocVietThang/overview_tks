'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
module.exports = createSimpleEntity({
  entity: 'suppliers', listQuery: { includeTotal: 'true', includeSupplierGroup: 'true' },
  columns: ['branch','id','code','name','phone','group_id','debt','created_date','modified_date','raw'],
  updateColumns: ['code','name','phone','group_id','debt','created_date','modified_date'],
  map: (x) => [value(x,'Id','id','SupplierId','supplierId'), value(x,'Code','code','SupplierCode','supplierCode'), value(x,'Name','name','SupplierName','supplierName'), value(x,'ContactNumber','contactNumber','Phone','phone'), value(x,'GroupId','groupId'), value(x,'Debt','debt'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')]
});
