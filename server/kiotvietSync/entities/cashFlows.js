'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
const { upsertStaffFromEntity } = require('../staffSync');
const base=createSimpleEntity({entity:'cash_flows',endpoint:'cashflow',listQuery:{includeAccount:'true',includeBranch:'true',includeUser:'true'},columns:['branch','id','code','is_receipt','amount','method','customer_id','supplier_id','user_id','description','trans_date','created_date','raw'],updateColumns:['code','is_receipt','amount','method','customer_id','supplier_id','user_id','description','trans_date','created_date'],map:x=>[value(x,'Id','id'),value(x,'Code','code'),value(x,'IsReceipt','isReceipt'),value(x,'Amount','amount'),value(x,'Method','method'),value(x,'CustomerId','customerId'),value(x,'SupplierId','supplierId'),value(x,'UserId','userId'),value(x,'Description','description'),value(x,'TransDate','transDate'),value(x,'CreatedDate','createdDate')]});
module.exports={...base,incrementalParam:null,hasUpperBound:true,backfillRangeParam:{from:'startDate',to:'endDate'},async upsertPage(pgClient,branch,items){
  await base.upsertPage(pgClient,branch,items);
  for(const item of items) await upsertStaffFromEntity(pgClient,branch,value(item,'UserId','userId'),value(item,'UserName','userName'));
}};
