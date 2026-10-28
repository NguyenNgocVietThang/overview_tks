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
    assert.match(d.querySelector('.invoice-goods thead').textContent,/Thùng/);
    assert.doesNotMatch(d.querySelector('.invoice-goods thead').textContent,/\bST\b/,'cột ST cũ đã đổi tên thành Thùng');
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

const headers = d => [...d.querySelectorAll('.invoice-goods thead td')].map(td => td.textContent.replace(/\s+/g, ' ').trim());
const cells = (d, row = 0) => [...d.querySelectorAll('.invoice-goods tbody tr')[row].querySelectorAll('td')];

test('thứ tự cột phiếu: TT, Tên hàng, SL, Đơn giá, Thành tiền, Ghi chú, Vị trí, Thùng, Thực nhặt', async () => {
  const order = {...makeOrderSnapshot({invoiceDiscount:0, lines:[{productCode:'A', productName:'Hàng A', quantity:100, price:15400, discount:0, note:'full vat'}]}), orderCode:'DH2', branch:'HN'};
  const dom = await invoice(order, {status:'picking', lines:[{productCode:'A', location:'A07', plannedQty:100, stText:'2Tx50', stCartons:2}]});
  try {
    const d = dom.window.document;
    assert.deepEqual(headers(d), ['TT','Tên hàng','SL','Đơn giá','Thành tiền','Ghi chú','Vị trí','Thùng','Thực nhặt']);
    assert.equal(d.querySelectorAll('.invoice-goods colgroup col').length, 9);
    const c = cells(d);
    assert.equal(c.length, 9);
    assert.equal(c[0].textContent.trim(), '1');
    assert.match(c[1].textContent, /Hàng A \(A\)/);
    assert.equal(c[2].textContent.trim(), '100');
    assert.equal(c[3].textContent.trim(), '15,400');
    assert.equal(c[4].textContent.trim(), '1,540,000');
    assert.equal(c[5].textContent.trim(), 'full vat', 'Ghi chú đứng trước Vị trí');
    assert.ok(c[6].classList.contains('invoice-location'));
    assert.equal(c[7].textContent.trim(), '2Tx50');
    assert.ok(c[7].classList.contains('invoice-st'));
    assert.ok(c[8].classList.contains('invoice-actual'));
    assert.equal(c[8].textContent.trim(), '');
  } finally {dom.window.close();}
});

test('ô Vị trí: một vị trí chỉ ghi tên vị trí, không ghi số lượng', async () => {
  const order = {...makeOrderSnapshot({invoiceDiscount:0, lines:[{productCode:'A', productName:'Hàng A', quantity:300, price:10, discount:0}]}), orderCode:'DH3', branch:'HN'};
  const dom = await invoice(order, {status:'picking', lines:[{productCode:'A', location:'A01', plannedQty:300, stText:'3Tx100', stCartons:3}]});
  try {
    const cell = cells(dom.window.document)[6];
    assert.equal(cell.textContent.trim(), 'A01');
    assert.equal(cell.querySelectorAll('b,strong').length, 0);
  } finally {dom.window.close();}
});

test('ô Vị trí: từ hai vị trí mỗi vị trí một dòng "VT: SL" với SL in đậm; vị trí trùng tên cộng gộp', async () => {
  const order = {...makeOrderSnapshot({invoiceDiscount:0, lines:[{productCode:'A', productName:'Hàng A', quantity:200050, price:10, discount:0}]}), orderCode:'DH4', branch:'HN'};
  const dom = await invoice(order, {status:'picking', lines:[
    {productCode:'A', location:'A01', plannedQty:200000, stText:'2Tx100000', stCartons:2},
    {productCode:'A', location:'B02', plannedQty:30, stText:'', stCartons:null},
    {productCode:'A', location:'B02', plannedQty:20, stText:'', stCartons:null}
  ]});
  try {
    const cell = cells(dom.window.document)[6];
    const lines = [...cell.querySelectorAll('.invoice-loc-line')];
    assert.deepEqual(lines.map(l => l.textContent.replace(/\s+/g, ' ').trim()), ['A01:200000', 'B02:50']);
    assert.deepEqual([...cell.querySelectorAll('.invoice-loc-line b')].map(b => b.textContent), ['200000', '50'], 'chỉ số lượng in đậm, không thêm dấu phân cách hàng nghìn');
    assert.doesNotMatch(cell.textContent, /Tx/, 'số thùng không lặp ở ô Vị trí (đã có cột Thùng)');
  } finally {dom.window.close();}
});

test('CSS phiếu: cột Vị trí đủ rộng, mỗi dòng vị trí không xuống dòng; căn lề theo thứ tự cột mới', () => {
  const css = fs.readFileSync(path.join(dir, 'invoice-a4.css'), 'utf8');
  const tpl = fs.readFileSync(path.join(dir, 'order-template.tpl'), 'utf8');
  const widths = [...tpl.match(/<colgroup>.*?<\/colgroup>/s)[0].matchAll(/width:\s*(\d+)%/g)].map(m => Number(m[1]));
  assert.equal(widths.length, 9);
  assert.equal(widths.reduce((a, b) => a + b, 0), 100);
  assert.ok(widths[6] >= 13, 'cột Vị trí chứa "A01: 200,000"');
  assert.match(css, /\.invoice-loc-line\{[^}]*white-space:nowrap/);
  assert.match(css, /td:nth-child\(7\)/, 'Vị trí là cột thứ 7');
});
