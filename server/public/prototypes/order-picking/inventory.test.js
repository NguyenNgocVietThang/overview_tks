'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
function setup(t,extra={}){const dom=new JSDOM('<body></body>',{runScripts:'outside-only',url:'http://localhost/'});t.after(()=>dom.window.close());const w=dom.window;w.structuredClone=structuredClone;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
for(const f of ['carton.js','rules.js'])w.eval(fs.readFileSync(path.join(__dirname,f),'utf8'));
const order={branch:'HN',orderCode:'TEST',customerName:'Mô phỏng',lines:[{productCode:'P1',quantity:100}]};
// SL của vị trí chỉ lấy từ ghi chú: A = 12T x 10 = 120, B = 4T x 10 = 40.
const locations=extra.locations||[{id:'A',branch:'HN',code:'P1',location:'A01',notes:'12T x 10'},{id:'B',branch:'HN',code:'P1',location:'B02',notes:'4T x 10'}];
w.PickingData={get:()=>({locations}),key:o=>o.branch+'|'+o.orderCode};w.eval(fs.readFileSync(path.join(__dirname,'stocktake.js'),'utf8'));w.eval(fs.readFileSync(path.join(__dirname,'inventory.js'),'utf8'));return {w,d:w.document,api:w.PickingInventory,ledger:w.PickingLedger,order,locations};}
const json=v=>JSON.parse(JSON.stringify(v));
const STOCKTAKE=[
  ['Mã hàng','Tên khách hàng','Ghi chú','Ghi chú hàng hóa','Số lượng'],
  ['P1','Khu A','A01','3T x 100','999'],
  ['P1','Khu A','A01','2T x 100','999'],
  ['P1','Khu B','B02','4T x 10','1']
];
test('SL của vị trí luôn suy ra từ ghi chú, số khả dụng của dữ liệu thử không phải nguồn chính',t=>{
const {api,locations}=setup(t);locations[0].available=7;
assert.equal(api.available(locations[0]),120,'12T x 10 = 120, bỏ qua available');
assert.deepEqual(json(api.summary('HN','P1')),{onHand:160,held:0,available:160});
api.setSpec(locations[0],'5T x 100');
assert.equal(api.available(locations[0]),500);assert.equal(api.specText(locations[0]),'5T x 100');
});
test('ghi chú rỗng hợp lệ (SL 0, không cảnh báo, không chỉ định được); ghi chú sai định dạng không tính được SL và không làm hỏng tổng của vị trí khác',t=>{
const {api,order,locations}=setup(t);
locations[1].notes='  ';assert.equal(api.available(locations[1]),0);assert.equal(api.row(locations[1]).quantity,0);assert.deepEqual(json(api.row(locations[1]).warnings),[]);
assert.throws(()=>api.reserve(order,{0:[{id:'B',quantity:10}]}),/không còn đủ/,'SL 0 thì không chỉ định nhặt được');
locations[1].notes='abc';assert.equal(api.available(locations[1]),null);
assert.deepEqual(json(api.row(locations[1]).warnings),['unreadable']);assert.equal(api.row(locations[1]).quantity,null);
locations[1].notes='0.5Tx100';assert.deepEqual(json(api.row(locations[1]).warnings),['badnumber']);
assert.throws(()=>api.reserve(order,{0:[{id:'B',quantity:10}]}),/không còn đủ/);
assert.deepEqual(json(api.summary('HN','P1')),{onHand:120,held:0,available:120},'vị trí lỗi bị loại khỏi tổng');
assert.throws(()=>api.setSpec(locations[1],'0.5Tx100'),/số nguyên dương/);
api.setSpec(locations[1],'1Tx50');assert.deepEqual(json(api.row(locations[1]).warnings),[]);assert.equal(api.available(locations[1]),50);
});
test('tồn đầu từ file kiểm kê lấy theo cột Ghi chú hàng hóa, không theo cột Số lượng; khu chưa chốt giờ thì chưa có tồn',t=>{
const {api,ledger,w,locations}=setup(t);
assert.equal(api.available(locations[0]),120,'chưa nạp kiểm kê thì dùng ghi chú của tab Vị trí hàng');
ledger.load(w.PickingStocktake.build(STOCKTAKE,{branch:'HN'}),{'Khu A':'2026-10-20T18:00:00+07:00'});
assert.equal(api.available(locations[0]),500,'3T x 100 + 2T x 100 = 5T x 100, cột Số lượng 999 không dùng');
assert.equal(api.specText(locations[0]),'5T x 100');
assert.equal(api.available(locations[1]),null,'B02 chưa chốt giờ nên chưa có tồn');
assert.equal(api.summary('HN','P1').available,null,'còn vị trí chưa xác minh thì tổng không được coi là đầy đủ');
ledger.setCutoff('HN','Khu B','2026-10-21T18:00:00+07:00');
ledger.load(w.PickingStocktake.build(STOCKTAKE,{branch:'HN'}),{'Khu B':'2026-10-21T18:00:00+07:00'});
assert.deepEqual(json(api.summary('HN','P1')),{onHand:540,held:0,available:540});
});
test('Đang nhặt giữ chỗ, Xác nhận nhặt trừ số thùng ở ghi chú: 5T x 100 lấy 200 còn 3T x 100',t=>{
const {api,order,locations}=setup(t);api.setSpec(locations[0],'5T x 100');
api.reserve(order,{0:[{id:'A',quantity:200}]});
assert.equal(api.status(order),'picking');assert.equal(api.available(locations[0]),300,'Nhặt được = tổng − đang nhặt');
assert.equal(api.specText(locations[0]),'5T x 100','chưa xác nhận thì chưa trừ ghi chú');
assert.equal(api.summary('HN','P1').onHand,540);
api.confirmPick(order);
assert.equal(api.status(order),'confirmed');assert.equal(api.specText(locations[0]),'3T x 100');
assert.equal(api.available(locations[0]),300);assert.equal(api.summary('HN','P1').held,0);
assert.throws(()=>api.confirmPick(order),/Đang nhặt/);
});
test('Hủy nhặt trả giữ chỗ về tồn gốc; chỉ định lại được sau Hủy nhặt',t=>{
const {api,order,locations}=setup(t);api.setSpec(locations[0],'5T x 100');
api.reserve(order,{0:[{id:'A',quantity:200}]});api.cancelPick(order);
assert.equal(api.status(order),'cancelled');assert.equal(api.available(locations[0]),500);assert.equal(api.specText(locations[0]),'5T x 100');
assert.throws(()=>api.cancelPick(order),/đã hủy/);
api.reserve(order,{0:[{id:'A',quantity:100}]});assert.equal(api.status(order),'picking','chỉ định lại sau hủy');assert.equal(api.available(locations[0]),400);
api.reopen(order);assert.equal(api.status(order),null);assert.equal(api.available(locations[0]),500);
});
test('Hủy nhặt hoặc chỉ định lại sau Xác nhận nhặt hoàn tác đúng chuỗi ghi chú trước đó',t=>{
const {api,order,locations}=setup(t);api.setSpec(locations[0],'5T x 100');
api.reserve(order,{0:[{id:'A',quantity:200}]});api.confirmPick(order);assert.equal(api.specText(locations[0]),'3T x 100');
api.cancelPick(order);assert.equal(api.status(order),'cancelled');assert.equal(api.specText(locations[0]),'5T x 100');assert.equal(api.available(locations[0]),500);
api.reserve(order,{0:[{id:'A',quantity:200}]});api.confirmPick(order);api.reopen(order);
assert.equal(api.status(order),null,'chỉ định lại xóa chỉ định cũ');assert.equal(api.specText(locations[0]),'5T x 100');
api.reserve(order,{0:[{id:'A',quantity:200}]});assert.equal(api.status(order),'picking');
});
test('bốc lẻ ghi vào phần trừ lẻ, không sinh số thùng thập phân; ST lẻ tính theo SL/thùng',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'D',branch:'HN',code:'P1',location:'D01',notes:'1Tx50'}]});
const o={...order,lines:[{productCode:'P1',quantity:25}]};
assert.equal(api.cartonsFor(locations[0],25),0.5,'ST 0.5 (hiện đỏ ở popup)');
api.reserve(o,{0:[{id:'D',quantity:25}]});api.confirmPick(o);
assert.equal(api.specText(locations[0]),'1T x 50 - 25');assert.equal(api.available(locations[0]),25);
assert.deepEqual(json(api.row(locations[0]).warnings),['loose'],'bốc lẻ ra 1T x 50 - 25: cảnh báo phần trừ lẻ, SL 25 vẫn tính đúng và chỉ định được');
api.cancelPick(o);assert.equal(api.specText(locations[0]),'1Tx50','khôi phục đúng chuỗi gốc, kể cả khoảng trắng');
});
test('khu nhiều quy cách: bốc lẻ 30 rồi hoàn tác; bốc nguyên thùng làm số hạng biến mất',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'M',branch:'HN',code:'P1',location:'M01',notes:'1Tx50 + 2Tx25'}]});
assert.equal(api.available(locations[0]),100);assert.deepEqual(json(api.row(locations[0]).warnings),['multi']);
const lines=n=>({...order,orderCode:'O'+n,lines:[{productCode:'P1',quantity:n}]});
const loose=lines(30);api.reserve(loose,{0:[{id:'M',quantity:30}]});api.confirmPick(loose);
assert.equal(api.specText(locations[0]),'1T x 50 + 2T x 25 - 30');assert.equal(api.available(locations[0]),70);
api.cancelPick(loose);assert.equal(api.specText(locations[0]),'1Tx50 + 2Tx25');assert.equal(api.available(locations[0]),100);
const whole=lines(50);api.reserve(whole,{0:[{id:'M',quantity:50}]});api.confirmPick(whole);
assert.equal(api.specText(locations[0]),'2T x 25','lấy nguyên thùng 50: số hạng 1T x 50 biến mất');assert.deepEqual(json(api.row(locations[0]).warnings),[],'còn một quy cách thì hết cảnh báo');
assert.equal(api.available(locations[0]),50);
});
test('hoàn tác khi vị trí đã bị đơn khác đổi tiếp: cộng trả lại thay vì ghi đè chuỗi',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'A',branch:'HN',code:'P1',location:'A01',notes:'5T x 100'}]});
const first={...order,orderCode:'F',lines:[{productCode:'P1',quantity:200}]},second={...order,orderCode:'S',lines:[{productCode:'P1',quantity:100}]};
api.reserve(first,{0:[{id:'A',quantity:200}]});api.confirmPick(first);
api.reserve(second,{0:[{id:'A',quantity:100}]});api.confirmPick(second);assert.equal(api.specText(locations[0]),'2T x 100');
api.cancelPick(first);assert.equal(api.specText(locations[0]),'4T x 100','đơn S vẫn giữ phần đã nhặt của nó');
});
test('một mã hàng ở hai cơ sở và nhiều khu khác quy cách: tính riêng từng cơ sở, từng khu',t=>{
const {api,locations,order}=setup(t,{locations:[
  {id:'hA',branch:'HN',code:'ABC',location:'A01',notes:'1Tx50'},{id:'hB',branch:'HN',code:'ABC',location:'B02',notes:'1Tx60'},
  {id:'sA',branch:'SG',code:'ABC',location:'A01',notes:'3Tx20'}]});
assert.deepEqual(json(api.summary('HN','ABC')),{onHand:110,held:0,available:110});
assert.deepEqual(json(api.summary('SG','ABC')),{onHand:60,held:0,available:60});
const o={...order,lines:[{productCode:'ABC',quantity:100}]};
api.reserve(o,{0:[{id:'hA',quantity:50},{id:'hB',quantity:60}]});
assert.deepEqual(json(api.summary('HN','ABC')),{onHand:110,held:110,available:0});
assert.equal(api.summary('SG','ABC').available,60,'đơn HN không giữ chỗ của SG');
assert.equal(api.cartonsFor(locations[0],50)+api.cartonsFor(locations[1],60),2,'ví dụ ABC: 110 thực nhặt = 2 thùng');
assert.deepEqual(json(api.rows('SG').map(r=>r.location)),['A01']);
});
test('lịch sử chỉnh sửa: sửa ghi chú ghi đúng một bản ghi trước/sau, không đổi thì không ghi, HN và SG tách riêng',t=>{
const {api,locations}=setup(t,{locations:[{id:'h',branch:'HN',code:'P1',location:'A01',notes:'5T x 100'},{id:'s',branch:'SG',code:'P1',location:'A01',notes:'2T x 50'}]});
assert.equal(api.history('HN').length,0);
api.setSpec(locations[0],'3T x 100');
const rec=api.history('HN');assert.equal(rec.length,1);
assert.deepEqual([rec[0].code,rec[0].location,rec[0].notesBefore,rec[0].notesAfter,rec[0].qtyBefore,rec[0].qtyAfter,rec[0].source,rec[0].user],['P1','A01','5T x 100','3T x 100',500,300,'Sửa tay','Người dùng demo']);
assert.ok(rec[0].at.endsWith('Z'));assert.equal(rec[0].orderCode,'');
api.setSpec(locations[0],'3T x 100');api.setSpec(locations[0],' 3T x 100 ');assert.equal(api.history('HN').length,1,'giá trị không đổi thì không ghi');
assert.equal(api.history('SG').length,0,'HN không lẫn SG');
api.setSpec(locations[1],'4T x 50');assert.equal(api.history('SG').length,1);assert.equal(api.history('HN').length,1);
api.setSpec(locations[0],'1Tx50 + 2Tx25');assert.deepEqual(json(api.history('HN')[0].warnings),['multi'],'mới nhất lên đầu, kèm cảnh báo của ghi chú sau');
assert.equal(api.history('HN')[1].notesAfter,'3T x 100');
});
test('lịch sử ghi cả Xác nhận nhặt, Hủy/hoàn tác nhặt và Chỉ định lại kèm mã đơn; Import có nguồn riêng',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'h',branch:'HN',code:'P1',location:'A01',notes:'5T x 100'}]});
const o={...order,orderCode:'DH9',lines:[{productCode:'P1',quantity:200}]};
api.reserve(o,{0:[{id:'h',quantity:200}]});assert.equal(api.history('HN').length,0,'Đang nhặt chưa đổi ghi chú/SL');
api.confirmPick(o);
let h=api.history('HN');assert.deepEqual([h[0].source,h[0].orderCode,h[0].notesBefore,h[0].notesAfter,h[0].qtyBefore,h[0].qtyAfter],['Xác nhận nhặt','DH9','5T x 100','3T x 100',500,300]);
api.cancelPick(o);h=api.history('HN');assert.deepEqual([h[0].source,h[0].orderCode,h[0].notesAfter,h[0].qtyAfter],['Hủy/hoàn tác nhặt','DH9','5T x 100',500]);
api.reserve(o,{0:[{id:'h',quantity:200}]});api.confirmPick(o);api.reopen(o);
assert.equal(api.history('HN')[0].source,'Chỉ định lại');assert.equal(api.history('HN').length,4,'xác nhận, hủy, xác nhận, chỉ định lại');
assert.equal(api.importSpecs('HN',[{code:'P1',location:'a01',spec:'7T x 100'}]),1);
assert.deepEqual([api.history('HN')[0].source,api.history('HN')[0].notesAfter],['Import','7T x 100']);
assert.equal(api.importSpecs('HN',[{code:'P1',location:'A01',spec:'7T x 100'}]),0,'import không đổi thì không ghi');
});
test('lịch sử giới hạn 500 dòng mỗi cơ sở và lưu thêm ở localStorage',t=>{
const {api,w,locations}=setup(t,{locations:[{id:'h',branch:'HN',code:'P1',location:'A01',notes:'1T x 1'}]});
for(let i=2;i<=520;i++)api.setSpec(locations[0],i+'T x 1');
assert.equal(api.history('HN').length,500);assert.equal(api.history('HN')[0].notesAfter,'520T x 1','giữ các dòng mới nhất');
const saved=JSON.parse(w.localStorage.getItem('tks-picking-location-history-v1'));assert.equal(saved.HN.length,500);assert.deepEqual(saved.SG,[]);
});
test('ghi chú có phần trừ lẻ bị cảnh báo nhưng SL vẫn đúng và chỉ định nhặt bình thường; sửa về dạng sạch thì hết cảnh báo',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'L',branch:'HN',code:'P1',location:'L01',notes:'1Tx100 - 30'}]});
assert.deepEqual(json(api.row(locations[0]).warnings),['loose']);assert.equal(api.row(locations[0]).quantity,70);assert.equal(api.available(locations[0]),70);
const o={...order,lines:[{productCode:'P1',quantity:70}]};api.reserve(o,{0:[{id:'L',quantity:70}]});assert.equal(api.status(o),'picking','vẫn chỉ định được');api.cancelPick(o);
api.setSpec(locations[0],'1Tx70');assert.deepEqual(json(api.row(locations[0]).warnings),[]);assert.equal(api.row(locations[0]).quantity,70);
});
test('giữ chỗ vượt tồn được báo xung đột, không bị clamp về 0 che mất',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'A',branch:'HN',code:'P1',location:'A01',notes:'5T x 100'}]});
api.reserve(order,{0:[{id:'A',quantity:100}]});
assert.deepEqual(api.conflicts('HN'),[],'giữ 100 trên tồn 500 thì không có xung đột');
assert.throws(()=>api.setSpec(locations[0],'1T x 50'),/đang nhặt/,'sửa tay không được hạ dưới số đang nhặt');
// Import kỳ kiểm kê mới có số thấp hơn lượng đã giữ chỗ.
api.importSpecs('HN',[{code:'P1',location:'A01',spec:'1T x 60'}]);
assert.equal(api.available(locations[0]),0,'cấp cho đơn mới vẫn là 0 vì không cấp được âm');
assert.equal(api.availableRaw(locations[0]),-40,'nhưng số thật là âm 40');
const conflicts=json(api.conflicts('HN'));
assert.equal(conflicts.length,1);
assert.deepEqual([conflicts[0].location,conflicts[0].onHand,conflicts[0].held,conflicts[0].excess],['A01',60,100,40]);
assert.deepEqual(json(api.orders('A')),[{key:'HN|TEST',orderCode:'TEST',reserved:100}],'biết đơn nào đang giữ để xử lý từng đơn');
});
test('other orders cannot reserve stock that is already held; total is shared by all orders',t=>{
const {api,order,locations}=setup(t);
assert.deepEqual(json(api.summary('HN','P1')),{onHand:160,held:0,available:160});
api.reserve(order,{0:[{id:'A',quantity:100}]});assert.equal(api.available(locations[0]),20);
assert.throws(()=>api.reserve({...order,orderCode:'OTHER'},{0:[{id:'A',quantity:30}]}),/không còn đủ/);
api.reserve({...order,orderCode:'SECOND'},{0:[{id:'B',quantity:20}]});
assert.deepEqual(json(api.summary('HN','p1')),{onHand:160,held:120,available:40});
});
test('hộp Kho nhặt hàng: thực nhặt trừ ghi chú, kết thúc giải phóng giữ chỗ, báo hết khóa và kiểm đếm mở khóa',t=>{
const {api,order,locations,d}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});api.open(order);
d.querySelector('#taken-0').value='70';d.querySelector('#finish-0').checked=true;d.querySelector('[data-take="0"]').click();
assert.equal(api.specText(locations[0]),'5T x 10','70 = 7 thùng nguyên');assert.equal(api.available(locations[0]),50);
assert.match(d.querySelector('#inventoryBody').textContent,/Cần chỉ định bù 30/);
d.querySelector('[data-fill="0"]').click();assert.equal(api.available(locations[0]),50);assert.equal(api.available(locations[1]),10);
d.querySelector('#taken-1').value='30';d.querySelector('#empty-1').checked=true;d.querySelector('[data-take="1"]').click();
assert.equal(api.available(locations[1]),0,'báo hết thì khóa');assert.equal(api.specText(locations[1]),'1T x 10');
d.querySelector('#count-B').value='0';d.querySelector('#reason-B').value='Kiểm đếm xác nhận đã hết';d.querySelector('[data-count="B"]').click();
assert.match(d.querySelector('#inventoryBody').textContent,/từ 10 → 0/);assert.equal(api.specText(locations[1]),'Hết hàng');
assert.deepEqual(json(api.row(locations[1]).warnings),[],'Hết hàng không cảnh báo');
});
test('over-picking in the dialog is refused and repeated confirmation does not subtract twice',t=>{
const {api,order,locations,d}=setup(t);api.reserve(order,{0:[{id:'A',quantity:100}]});api.open(order);d.querySelector('#taken-0').value='101';d.querySelector('[data-take="0"]').click();assert.match(d.querySelector('#inventoryError').textContent,/Số thực nhặt/);assert.equal(api.available(locations[0]),20);
d.querySelector('#taken-0').value='100';d.querySelector('[data-take="0"]').click();assert.equal(d.querySelector('[data-take="0"]'),null);assert.equal(api.available(locations[0]),20);assert.throws(()=>api.reserve(order,{0:[{id:'A',quantity:100}]}),/đã bắt đầu nhặt/);
});
test('lưu ghi chú chuẩn hóa: ghi lịch sử khi chuỗi đổi thật, không ghi khi chỉ khác khoảng trắng, hoàn tác khôi phục chuỗi gốc',t=>{
const {api,order,locations}=setup(t,{locations:[{id:'A',branch:'HN',code:'P1',location:'A01',notes:'5Tx100'}]});
api.setSpec(locations[0],'5T  x 100');assert.equal(api.specText(locations[0]),'5T x 100');assert.equal(api.history('HN').length,0,'chỉ khác khoảng trắng: không ghi lịch sử');
api.setSpec(locations[0],'1t 11');assert.equal(api.specText(locations[0]),'1T x 11');assert.equal(api.history('HN').length,1);
api.setSpec(locations[0],' 9tx14,5tx 14 ');assert.equal(api.specText(locations[0]),'9T x 14 + 5T x 14');
api.setSpec(locations[0],'5Tx100',undefined);
const row=api.addLocation('HN',{code:'P2',location:'B1',notes:'1t*11'});assert.equal(row.notes,'1T x 11');
const o={...order,lines:[{productCode:'P1',quantity:100}]};api.setSpec(locations[0],'1Tx100');api.reserve(o,{0:[{id:'A',quantity:100}]});api.confirmPick(o);api.cancelPick(o);
assert.equal(api.specText(locations[0]),'1T x 100','hoàn tác về chuỗi đã lưu (đã chuẩn hóa)');
});
