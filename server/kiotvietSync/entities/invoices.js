'use strict';
const { createDocumentEntity, value } = require('./documentEntityFactory');
module.exports = createDocumentEntity({
  entity:'invoices', listQuery:{ includePayment:'true', includeInvoiceDelivery:'true', IncludeSaleChannel:'true' },
  backfillRangeParam:{ from:'fromPurchaseDate', to:'toPurchaseDate' },
  parentColumns:['branch','id','code','purchase_date','customer_id','sold_by_id','total','total_payment','status','created_date','modified_date','raw'],
  parentUpdateColumns:['code','purchase_date','customer_id','sold_by_id','total','total_payment','status','created_date','modified_date'],
  mapParent:x=>[value(x,'Id','id','InvoiceId','invoiceId'),value(x,'Code','code','InvoiceCode','invoiceCode'),value(x,'PurchaseDate','purchaseDate'),value(x,'CustomerId','customerId'),value(x,'SoldById','soldById'),value(x,'Total','total'),value(x,'TotalPayment','totalPayment','ActualPayment','actualPayment'),value(x,'Status','status'),value(x,'CreatedDate','createdDate'),value(x,'ModifiedDate','modifiedDate')],
  detailTable:'invoice_details',parentIdColumn:'invoice_id',detailKeys:['InvoiceDetails','invoiceDetails'],detailColumns:['branch','invoice_id','line_no','product_id','quantity','price','discount','raw'],
  mapDetail:x=>[value(x,'ProductId','productId'),value(x,'Quantity','quantity'),value(x,'Price','price'),value(x,'Discount','discount')],
  payment:{table:'invoice_payments',keys:['Payments','payments'],sql:'INSERT INTO invoice_payments (branch,invoice_id,line_no,method,amount,trans_date,raw) VALUES ($1,$2,$3,$4,$5,$6,$7)',map:x=>[value(x,'Method','method'),value(x,'Amount','amount'),value(x,'TransDate','transDate')]}
});
