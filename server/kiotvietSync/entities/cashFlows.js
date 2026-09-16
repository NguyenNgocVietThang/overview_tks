'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
const { upsertStaffFromEntity } = require('../staffSync');
const base=createSimpleEntity({entity:'cash_flows',endpoint:'cashflow',listQuery:{includeAccount:'true',includeBranch:'true',includeUser:'true'},columns:['branch','id','code','is_receipt','amount','method','customer_id','supplier_id','user_id','description','trans_date','created_date','raw'],updateColumns:['code','is_receipt','amount','method','customer_id','supplier_id','user_id','description','trans_date','created_date'],map:x=>[value(x,'Id','id'),value(x,'Code','code'),value(x,'IsReceipt','isReceipt'),value(x,'Amount','amount'),value(x,'Method','method'),value(x,'CustomerId','customerId'),value(x,'SupplierId','supplierId'),value(x,'UserId','userId'),value(x,'Description','description'),value(x,'TransDate','transDate'),value(x,'CreatedDate','createdDate')]});
module.exports={...base,incrementalParam:null,hasUpperBound:true,backfillRangeParam:{from:'startDate',to:'endDate'},async upsertPage(pgClient,branch,items){
  await base.upsertPage(pgClient,branch,items);
  // Thu tu id tang dan - tranh deadlock voi cac entity khac (invoices/orders/
  // returns/purchases) cung ghi dong thoi vao bang "staff" dung chung. Xem
  // ghi chu tuong tu o documentEntityFactory.js.
  const staffById = new Map();
  for (const item of items) {
    const staffId = value(item,'UserId','userId');
    if (staffId === null || staffId === undefined || staffId === '') continue;
    if (!staffById.has(staffId)) staffById.set(staffId, value(item,'UserName','userName'));
  }
  for (const staffId of [...staffById.keys()].sort((a,b)=>(a>b?1:a<b?-1:0))) {
    await upsertStaffFromEntity(pgClient,branch,staffId,staffById.get(staffId));
  }
}};
