'use strict';
const test = require('node:test');
const { assertChildReplacement } = require('./entityTestUtils');
const entity = require('./invoices');
test('invoices replaces details and payments after upserting the parent', async () => {
  await assertChildReplacement(entity, {
    Id: 10, Code: 'HD10', SoldById: 7, SoldByName: 'An',
    InvoiceDetails: [{ ProductId: 1, Quantity: 2, Price: 3, Discount: 1 }, { ProductId: 2 }],
    Payments: [{ Method: 'Cash', Amount: 5, TransDate: 't' }]
  }, 'invoice_details', 2, 'invoice_payments');
});
