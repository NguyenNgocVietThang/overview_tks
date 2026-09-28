'use strict';
const { createDocumentEntity, value } = require('./documentEntityFactory');
module.exports=createDocumentEntity({entity:'purchases',batchDetails:true,endpoint:'purchaseorders',listQuery:{includePayment:'true',includeOrderDelivery:'true'},backfillRangeParam:{from:'fromPurchaseDate',to:'toPurchaseDate'},parentColumns:['branch','id','code','purchase_date','supplier_id','total','status','created_date','modified_date','raw'],parentUpdateColumns:['code','purchase_date','supplier_id','total','status','created_date','modified_date'],mapParent:x=>[value(x,'Id','id','PurchaseOrderId','purchaseOrderId'),value(x,'Code','code','PurchaseOrderCode','purchaseOrderCode'),value(x,'PurchaseDate','purchaseDate'),value(x,'SupplierId','supplierId'),value(x,'Total','total'),value(x,'Status','status'),value(x,'CreatedDate','createdDate'),value(x,'ModifiedDate','modifiedDate')],detailTable:'purchase_details',parentIdColumn:'purchase_id',detailKeys:['PurchaseOrderDetails','purchaseOrderDetails','ProductDetails','productDetails','Details','details'],detailColumns:['branch','purchase_id','line_no','product_id','quantity','price','raw'],mapDetail:x=>[value(x,'ProductId','productId'),value(x,'Quantity','quantity','OrderQuantity','orderQuantity'),value(x,'Price','price')]});

// Live reconciliation 2026-09-28: lastModifiedFrom omits recreated, backdated
// receipts (e.g. Hanoi PN002517). Poll the complete list, including cancelled
// receipts in the supported stockout history, and only rewrite changed documents.
const { isDeepStrictEqual } = require('node:util');
const { STOCKOUT_DATA_FLOOR_DATE_KEY } = require('../../dashboard/stockoutCheck/stockoutEngine');
module.exports.pollFullSnapshot = true;
module.exports.pollQuery = { fromPurchaseDate: STOCKOUT_DATA_FLOOR_DATE_KEY };
module.exports.reconcilePage = async function reconcilePage(client, branch, items) {
  if (!items.length) return;
  const idOf = item => value(item, 'Id', 'id', 'PurchaseOrderId', 'purchaseOrderId');
  const result = await client.query(
    'SELECT id, raw FROM purchases WHERE branch = $1 AND id = ANY($2::bigint[])',
    [branch, items.map(idOf)]
  );
  const existing = new Map(result.rows.map(row => [String(row.id), row.raw]));
  const changed = items.filter(item => !isDeepStrictEqual(existing.get(String(idOf(item))), item));
  await module.exports.upsertPage(client, branch, changed);
};
