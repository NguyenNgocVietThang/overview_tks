'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
module.exports = createSimpleEntity({
  entity: 'customers', listQuery: { includeTotal: 'true', includeCustomerGroup: 'true', includeCustomerSocial: 'true' },
  columns: ['branch','id','code','name','phone','group_id','debt','total_revenue','created_date','modified_date','raw'],
  updateColumns: ['code','name','phone','group_id','debt','total_revenue','created_date','modified_date'],
  map: (x) => [value(x,'Id','id','CustomerId','customerId'), value(x,'Code','code','CustomerCode','customerCode'), value(x,'Name','name','CustomerName','customerName'), value(x,'ContactNumber','contactNumber','Phone','phone'), value(x,'GroupId','groupId'), value(x,'Debt','debt','TotalDebt','totalDebt'), value(x,'TotalRevenue','totalRevenue'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')]
});
