'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t){
  const panel=fs.readFileSync(path.join(__dirname,'panel.html'),'utf8');
  const dom=new JSDOM('<div id="lcDetailTitle">DH-DEMO-001</div><div id="lcDetailBody"><div id="lcDetailKiot"><div class="dp-section-head">Hàng hóa trong đơn</div></div></div>'+panel,{url:'http://localhost/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window;w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const f of ['rules.js','demo.js'])w.eval(fs.readFileSync(path.join(__dirname,f),'utf8'));
  const data=structuredClone(w.PickingDemo);data.orders.forEach(o=>o.summary=o.status);data.locations.forEach((r,i)=>r.id='loc-'+i);
  // Small, controlled fixture for selection/shortage tests, independent of wholesale demo volumes.
  [100,35,20,25,30,15,12].forEach((qty,i)=>data.locations[i].available=qty);
  w.PickingData={get:()=>data,key:o=>o.branch+'|'+o.orderCode,source:'MÔ PHỎNG'};
  w.eval(fs.readFileSync(path.join(__dirname,'app.js'),'utf8'));w.PickingPopup.attach();return {w,d:w.document,data};
}
test('eligible order has action above goods and popup includes the remaining total stock column',t=>{
  const {d}=setup(t);d.querySelector('#openPickingBtn').click();
  assert.equal(d.querySelector('#pickingDialog').open,true);
  assert.deepEqual([...d.querySelectorAll('.picking-table th')].map(e=>e.textContent),['Mã hàng','Tên hàng','SL đơn','Tổng tồn chung','Vị trí kho']);
  assert.equal(d.querySelectorAll('[data-line="0"][data-location]').length,3);
  assert.equal(d.querySelector('[data-line="0"][data-location="loc-1"]').getAttribute('aria-pressed'),'true','need 30 must suggest B02 stock 35');
  assert.equal(d.querySelector('[data-line="0"][data-location="loc-0"]').getAttribute('aria-pressed'),'false','stock 100 must not be the initial selection');
  assert.equal(d.querySelector('#pickingConfirm').disabled,false);
  assert.equal(d.querySelector('#openPickingPrint'),null);
});
test('remaining total subtracts draft selections, restores on deselect and excludes other branches',t=>{
  const {d,data}=setup(t);data.locations.push({id:'other',branch:'SG',code:'ADN3LYU',location:'X',available:1000});
  d.querySelector('#openPickingBtn').click();
  const total=()=>d.querySelector('[data-total-code="ADN3LYU"]').dataset.remaining;
  assert.equal(total(),'125');
  d.querySelector('[data-line="0"][data-location="loc-1"]').click();assert.equal(total(),'155');
  d.querySelector('[data-line="0"][data-location="loc-0"]').click();assert.equal(total(),'125');
});
test('duplicate code lines share a single total and unknown quantity is never shown as zero',t=>{
  const {w,d,data}=setup(t);data.orders[0].lines.push({productCode:'ADN3LYU',productName:'Trùng mã',quantity:5});
  w.PickingPopup.open(data.orders[0]);
  assert.deepEqual([...d.querySelectorAll('[data-total-code="ADN3LYU"]')].map(e=>e.dataset.remaining),['120','120']);
  d.querySelector('#pickingClose').click();w.PickingPopup.open(data.orders[2]);
  assert.equal(d.querySelector('[data-total-code="ADN3LYU"]').dataset.remaining,'unknown');
});
test('clicking a location changes selection; confirmation enables printing from detail',t=>{
  const {w,d}=setup(t);d.querySelector('#openPickingBtn').click();
  d.querySelector('[data-line="0"][data-location="loc-0"]').click();
  assert.equal(d.querySelector('[data-line="0"][data-location="loc-0"]').getAttribute('aria-pressed'),'true');
  assert.equal(d.querySelector('[data-line="0"][data-location="loc-1"]').getAttribute('aria-pressed'),'false');
  d.querySelector('#pickingNote').value='Nhặt theo phiếu đã xác nhận';d.querySelector('#pickingConfirm').click();
  assert.equal(d.querySelector('#pickingDialog').open,false);
  assert.equal(d.querySelector('#openPickingPrint'),null,'printing is inside the picking popup, not order detail');
  assert.match(w.localStorage.getItem('tks-picking-popup-v2'),/Nhặt theo phiếu/);
  assert.match(w.localStorage.getItem('tks-picking-popup-v2'),/loc-0/);
});
test('deselecting a location blocks confirmation until every product is allocated',t=>{
  const {d}=setup(t);d.querySelector('#openPickingBtn').click();
  d.querySelector('[data-line="0"][data-location="loc-1"]').click();
  assert.equal(d.querySelector('#pickingConfirm').disabled,true);
  d.querySelector('#pickingSuggest').click();assert.equal(d.querySelector('#pickingConfirm').disabled,false);
});
test('not-sent orders have no picking action and unknown/insufficient stock cannot confirm',t=>{
  const {w,d,data}=setup(t);
  d.querySelector('#lcDetailTitle').textContent='DH-DEMO-004';w.PickingPopup.attach();
  assert.equal(d.querySelector('#openPickingBtn'),null);
  w.PickingPopup.open(data.orders[3]);assert.equal(d.querySelector('#pickingDialog').open,false);
  for(const i of [1,2]){w.PickingPopup.open(data.orders[i]);assert.equal(d.querySelector('#pickingConfirm').disabled,true);d.querySelector('#pickingClose').click();}
});
test('original lifecycle template is reused without modifying its table or detail markup',()=>{
  const {build}=require('../../../prototype-build.cjs');
  const original=fs.readFileSync(path.join(__dirname,'../../shipment/lifecycle/index.html'),'utf8');
  const result=build();
  assert.ok(result.includes(original.match(/<table[^>]*id="bulkTable"[\s\S]*?<\/table>/)[0]));
  assert.ok(result.includes('id="lcDetailOverlay"'));
  assert.ok(result.includes('lifecycle-data.js'));
});
