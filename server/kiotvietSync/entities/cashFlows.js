'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
const { isDeepStrictEqual } = require('node:util');
// Public API returns Vietnamese wall time without a zone. PostgreSQL must not
// interpret it using the server/session timezone. Preserve explicit offsets.
function localDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
    ? `${value}+07:00` : value;
}
const { upsertStaffFromEntity } = require('../staffSync');
const columns = ['branch','id','code','is_receipt','amount','method','customer_id','supplier_id','user_id','description','trans_date','created_date','account_id','status','raw'];
const updateColumns = columns.filter(key=>!['branch','id','raw'].includes(key));
const mapItem = x=>[value(x,'Id','id'),value(x,'Code','code'),value(x,'IsReceipt','isReceipt'),value(x,'Amount','amount'),value(x,'Method','method'),value(x,'CustomerId','customerId'),value(x,'SupplierId','supplierId'),value(x,'UserId','userId'),value(x,'Description','description'),localDate(value(x,'TransDate','transDate')),localDate(value(x,'CreatedDate','createdDate')),value(x,'AccountId','accountId'),value(x,'Status','status')];
const base=createSimpleEntity({entity:'cash_flows',endpoint:'cashflow',listQuery:{includeAccount:'true',includeBranch:'true',includeUser:'true',orderBy:'Id',orderDirection:'ASC'},columns,updateColumns,map:mapItem});
module.exports={...base,minIntervalMs:60000,reconcileIntervalMs:24*60*60*1000,replayWindowMs:7*24*60*60*1000,incrementalParam:null,hasUpperBound:true,backfillRangeParam:{from:'startDate',to:'endDate'},async upsertPage(pgClient,branch,items){
  // Reconciliation can repair every historical timestamp on the first run.
  // Batch writes to avoid one database round trip for each historical voucher.
  for (let offset=0;offset<items.length;offset+=100) {
    const batch=items.slice(offset,offset+100);
    const params=batch.flatMap(item=>[branch,...mapItem(item),item]);
    const values=batch.map((_,row)=>'('+columns.map((_,col)=>'$'+(row*columns.length+col+1)).join(',')+')').join(',');
    await pgClient.query(`INSERT INTO cash_flows (${columns.join(',')}) VALUES ${values}
      ON CONFLICT (branch,id) DO UPDATE SET ${updateColumns.map(key=>`${key}=EXCLUDED.${key}`).join(',')},raw=EXCLUDED.raw,source_missing_at=NULL,synced_at=now()`,params);
  }
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

// Repair old projections as well as changed API payloads. Older server builds
// continued writing rows without account/status and with UTC-interpreted dates.
module.exports.reconcilePage = async function reconcilePage(client, branch, items) {
  if (!items.length) return;
  const result = await client.query(
    'SELECT id,raw,account_id,status,trans_date,source_missing_at FROM cash_flows WHERE branch=$1 AND id=ANY($2::bigint[])',
    [branch, items.map(x=>value(x,'Id','id'))]
  );
  const existing = new Map(result.rows.map(r=>[String(r.id),r]));
  const changed = items.filter(item=>{
    const row=existing.get(String(value(item,'Id','id')));
    return !row || row.source_missing_at != null || !isDeepStrictEqual(row.raw,item)
      || String(row.account_id ?? '') !== String(value(item,'AccountId','accountId') ?? '')
      || row.status !== value(item,'Status','status')
      || +new Date(row.trans_date) !== +new Date(localDate(value(item,'TransDate','transDate')));
  });
  await module.exports.upsertPage(client,branch,changed);
};

// Retain every historical field and payload. A source ID replaced/deleted on
// KiotViet is excluded from calculations, and restored if it reappears later.
module.exports.markMissing = async function markMissing(client,branch,ids,before) {
  if (!ids.length) return;
  await client.query(
    'UPDATE cash_flows SET source_missing_at=$3::timestamptz WHERE branch=$1 AND trans_date<=$3::timestamptz AND NOT(id=ANY($2::bigint[])) AND source_missing_at IS NULL',
    [branch,ids,before]
  );
};
