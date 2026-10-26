'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t){const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());const w=dom.window;w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.eval(fs.readFileSync(path.join(__dirname,'rules.js'),'utf8'));
const order={branch:'HN',orderCode:'TEST',customerName:'Mô phỏng',lines:[{productCode:'P1',quantity:100}]};
const locations=[{id:'A',branch:'HN',code:'P1',location:'A01',available:120},{id:'B',branch:'HN',code:'P1',location:'B02',available:40}];
w.PickingData={get:()=>({locations}),key:o=>o.orderCode};w.eval(fs.readFileSync(path.join(__dirname,'stocktake.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'inventory.js'),'utf8'));return {w,d:w.document,api:w.PickingInventory,ledger:w.PickingLedger,order,locations};}
const STOCKTAKE=[
  ['Mã hàng','Tên khách hàng','Ghi chú','Số lượng'],
  ['P1','Khu A','A01','300'],
  ['P1','Khu A','A01','200'],
  ['P1','Khu B','B02','40']
];
test('opening stock comes from the stocktake ledger, not from the location module quantity',t=>{
const {api,ledger,w,order,locations}=setup(t);
assert.equal(api.available(locations[0]),120,'chưa nạp kiểm kê thì dùng số khả dụng đã xác nhận của dữ liệu thử');
ledger.load(w.PickingStocktake.build(STOCKTAKE,{branch:'HN'}),{'Khu A':'2026-10-20T18:00:00+07:00'});
// A01 lấy 300+200 từ file kiểm kê, không phải 120 của module Vị trí hàng; B02 chưa chốt giờ nên chưa có tồn.
assert.equal(api.available(locations[0]),500);
assert.equal(api.available(locations[1]),null);
assert.equal(api.summary('HN','P1').available,null,'còn vị trí chưa xác minh thì tổng không được coi là đầy đủ');
ledger.setCutoff('HN','Khu B','2026-10-21T18:00:00+07:00');
ledger.load(w.PickingStocktake.build(STOCKTAKE,{branch:'HN'}),{'Khu B':'2026-10-21T18:00:00+07:00'});
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:540,held:0,available:540});
});
test('actual pickup writes a post-cutoff movement into the stocktake ledger',t=>{
const {api,ledger,w,order,locations}=setup(t);
ledger.load(w.PickingStocktake.build(STOCKTAKE,{branch:'HN'}),{'Khu A':'2026-10-20T18:00:00+07:00','Khu B':'2026-10-21T18:00:00+07:00'});
api.reserve(order,{0:[{id:'A',quantity:100}]});
assert.equal(api.available(locations[0]),400,'giữ chỗ chưa trừ tồn thực');
api.confirmActual(order,[{value:'100',outcome:'end'}]);
assert.equal(ledger.onHand('HN','P1','A01'),400,'tồn thực trừ theo số thực nhặt');
assert.deepEqual(JSON.parse(JSON.stringify(ledger.movements({branch:'HN'}).map(m=>[m.type,m.quantity,m.counted]))),[['pick',100,false]]);
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:440,held:0,available:440});
});
test('reservation reduces availability, partial pickup subtracts actual and releases unfinished reservation',t=>{
const {api,order,locations,d}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});assert.equal(api.available(locations[0]),20);api.open(order);
d.querySelector('#taken-0').value='70';d.querySelector('#finish-0').checked=true;d.querySelector('[data-take="0"]').click();
assert.equal(api.available(locations[0]),50);assert.match(d.querySelector('#inventoryBody').textContent,/Cần chỉ định bù 30/);
d.querySelector('[data-fill="0"]').click();assert.equal(api.available(locations[0]),50);assert.equal(api.available(locations[1]),10);
});
test('empty report locks stock, replacement reserves elsewhere and counted correction unlocks stock',t=>{
const {api,order,locations,d}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});api.open(order);
d.querySelector('#taken-0').value='70';d.querySelector('#empty-0').checked=true;d.querySelector('[data-take="0"]').click();assert.equal(api.available(locations[0]),0);
d.querySelector('[data-fill="0"]').click();assert.equal(api.available(locations[1]),10);
d.querySelector('#count-A').value='0';d.querySelector('#reason-A').value='Kiểm đếm xác nhận đã hết';d.querySelector('[data-count="A"]').click();assert.match(d.querySelector('#inventoryBody').textContent,/từ 50 → 0/);
d.querySelector('#taken-1').value='30';d.querySelector('[data-take="1"]').click();assert.equal(api.available(locations[1]),10);assert.match(d.querySelector('#inventoryBody').textContent,/Đã nhặt đủ/);
});
test('over-picking and repeated confirmation do not subtract twice',t=>{
const {api,order,locations,d}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});api.open(order);d.querySelector('#taken-0').value='101';d.querySelector('[data-take="0"]').click();assert.match(d.querySelector('#inventoryError').textContent,/Số thực nhặt/);assert.equal(api.available(locations[0]),20);
d.querySelector('#taken-0').value='100';d.querySelector('[data-take="0"]').click();assert.equal(d.querySelector('[data-take="0"]'),null);assert.equal(api.available(locations[0]),20);assert.throws(()=>api.reserve(order,{0:[{id:'A',quantity:100}]}),/đã bắt đầu nhặt/);
});
test('other orders cannot reserve stock that is already held',t=>{
const {api,order,locations}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});assert.throws(()=>api.reserve({...order,orderCode:'OTHER'},{0:[{id:'A',quantity:30}]}),/không còn đủ/);assert.equal(api.available(locations[0]),20);
});
test('a single product stock source is shared by all orders: 150 minus 30 equals 120',t=>{
const {api,order,locations}=setup(t);locations[0].available=110;
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:150,held:0,available:150});
api.reserve(order,{0:[{id:'A',quantity:30}]});
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','p1'))),{onHand:150,held:30,available:120});
api.reserve({...order,orderCode:'SECOND'},{0:[{id:'B',quantity:20}]});
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:150,held:50,available:100});
});
test('cumulative actual is idempotent, blank is pending and explicit zero is reported',t=>{
const {api,order,locations}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});
api.confirmActual(order,[{value:''}]);assert.equal(api.record(order).jobs[0].reported,undefined);
api.confirmActual(order,[{value:'0',outcome:'continue'}]);assert.equal(api.record(order).jobs[0].reported,true);
api.confirmActual(order,[{value:'70',outcome:'continue'}]);const before=api.summary('HN','P1');
api.confirmActual(order,[{value:'70',outcome:'continue'}]);assert.deepEqual(api.summary('HN','P1'),before);
assert.throws(()=>api.confirmActual(order,[{value:'60',outcome:'end'}]),/Sửa giảm/);
assert.equal(api.record(order).jobs[0].taken,70);assert.equal(api.available(locations[0]),20);
});
test('all actual rows are validated before stock is modified',t=>{
const {api,order}=setup(t);api.reserve(order,{0:[{id:'A',quantity:70},{id:'B',quantity:30}]});const before=api.summary('HN','P1');
assert.throws(()=>api.confirmActual(order,[{value:'50',outcome:'end'},{value:'40',outcome:'end'}]),/Thực nhặt/);
assert.deepEqual(api.summary('HN','P1'),before);assert.equal(api.record(order).jobs[0].taken,0);
});
test('completed full pickup reduces stock exactly once and preserves the next order reservation',t=>{
const {api,order,locations}=setup(t),second={...order,orderCode:'SECOND'};
api.reserve(order,{0:[{id:'A',quantity:100}]});
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:160,held:100,available:60});
api.confirmActual(order,[{value:'100',outcome:'end'}]);
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:60,held:0,available:60});
assert.equal(api.available(locations[0]),20);assert.equal(api.available(locations[1]),40);
api.reserve(second,{0:[{id:'B',quantity:40}]});
api.confirmActual(order,[{value:'100',outcome:'end'}]);
assert.deepEqual(JSON.parse(JSON.stringify(api.summary('HN','P1'))),{onHand:60,held:40,available:20});
});

test('giữ chỗ vượt tồn được báo xung đột, không bị clamp về 0 che mất',t=>{
const {api,ledger,w,order,locations}=setup(t);
const snap=q=>w.PickingStocktake.build([['Mã hàng','Tên khách hàng','Ghi chú','Số lượng'],['P1','Khu A','A01',String(q)]],{branch:'HN'});
ledger.load(snap(500),{'Khu A':'2026-10-20T18:00:00+07:00'});
api.reserve(order,{0:[{id:'A',quantity:100}]});
assert.deepEqual(api.conflicts('HN'),[],'giữ 100 trên tồn 500 thì không có xung đột');
// Kỳ kiểm kê mới hạ tồn xuống dưới mức đang giữ chỗ.
ledger.load(snap(60),{'Khu A':'2026-10-21T18:00:00+07:00'});
assert.equal(api.available(locations[0]),0,'cấp cho đơn mới vẫn là 0 vì không cấp được âm');
assert.equal(api.availableRaw(locations[0]),-40,'nhưng số thật là âm 40');
const conflicts=JSON.parse(JSON.stringify(api.conflicts('HN')));
assert.equal(conflicts.length,1);
assert.deepEqual([conflicts[0].location,conflicts[0].onHand,conflicts[0].held,conflicts[0].excess],['A01',60,100,40]);
assert.deepEqual(JSON.parse(JSON.stringify(api.orders('A'))),[{key:'TEST',orderCode:'TEST',reserved:100}],'biết đơn nào đang giữ để xử lý từng đơn');
// Tồn âm sau điều chỉnh cũng phải hiện, không che thành 0.
ledger.record({branch:'HN',code:'P1',location:'A01',type:'adjust',quantity:'-200',at:'2026-10-22T08:00:00+07:00'});
const negative=JSON.parse(JSON.stringify(api.conflicts('HN')));
assert.equal(negative[0].onHand,-140);
assert.equal(negative[0].negative,true);
assert.equal(negative[0].excess,240);
});
