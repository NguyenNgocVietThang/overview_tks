'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const {makeOrderSnapshot} = require('../../pickAssignments/pickOrderSnapshot');
const dir = path.join(__dirname, '../../public/shipment/lifecycle/pick');

async function invoice(order, record) {
  const dom = new JSDOM('<dialog id="pickingPrintDialog"></dialog><div id="pickingPrintTitle"></div><div id="pickingPrintSheet"></div>', {runScripts:'outside-only'});
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  w.PickingInvoiceTemplate = fs.readFileSync(path.join(dir,'order-template.tpl'),'utf8');
  w.PickingPrintCSS = fs.readFileSync(path.join(dir,'invoice-a4.css'),'utf8');
  w.eval(fs.readFileSync(path.join(dir,'invoice.js'),'utf8'));
  await w.PickingInvoice.show(order, record);
  return dom;
}

test('v2 print uses original amounts, keeps ST and prints placement once per code', async () => {
  const order = {...makeOrderSnapshot({invoiceDiscount:0, lines:[
    {productCode:'A', productName:'Hàng A', quantity:10000, price:10, discount:0},
    {productCode:'a', productName:'Hàng A', quantity:1, price:11, discount:0}
  ]}), orderCode:'DH1', branch:'HN'};
  const dom = await invoice(order, {status:'picking', lines:[{productCode:'A',location:'A07',plannedQty:10001,stText:'101Tx100-99',stCartons:100.01}]});
  try {
    const d=dom.window.document;
    assert.equal(d.querySelectorAll('.invoice-goods thead td').length,9);
    assert.match(d.querySelector('.invoice-goods thead').textContent,/ST/);
    assert.equal(d.querySelectorAll('.invoice-goods tbody tr').length,2);
    assert.equal(d.querySelectorAll('.invoice-goods tbody .invoice-st')[0].textContent.trim(),'101Tx100-99');
    assert.equal(d.querySelectorAll('.invoice-goods tbody .invoice-st')[1].textContent.trim(),'');
    assert.match(d.querySelectorAll('.invoice-location')[1].textContent,/dòng 1/);
    assert.match(d.querySelector('.invoice-summary').textContent,/100,011/);
    assert.equal(d.querySelectorAll('.invoice-qr img').length,3);
    assert.equal(d.querySelector('.invoice-brand').textContent,'KHO SỈ TOKOSI');
    assert.equal(d.querySelector('.tokosi-invoice').getAttribute('contenteditable'),'true');
  } finally {dom.window.close();}
});

test('legacy print warns that original lines cannot be recovered; cancelled ST blank', async () => {
  const dom = await invoice({orderCode:'DH1', lines:[{productCode:'A',productName:'A',quantity:1,price:10}],invoiceDiscount:0}, {status:'cancelled',lines:[{productCode:'A',location:'A01',stText:'1Tx100'}]});
  try {
    assert.match(dom.window.document.querySelector('.invoice-legacy').textContent,/dòng gốc/);
    assert.equal(dom.window.document.querySelector('tbody .invoice-st').textContent.trim(),'');
  } finally {dom.window.close();}
});
