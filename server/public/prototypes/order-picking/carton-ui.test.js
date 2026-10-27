'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const DETAIL='<div id="lcDetailTitle">DH-DEMO-013</div><div id="lcDetailBody"><div id="lcDetailKiot"><div class="dp-section-head">Hàng hóa trong đơn</div><table class="dp-table lc-lines"><thead><tr><th>Mã hàng</th><th>Tên hàng</th><th class="num">SL đặt</th><th class="num">Đơn giá</th></tr></thead><tbody><tr data-line-index="0"><td>ABC</td><td>ABC</td><td>100</td><td>5,000</td></tr><tr data-line-index="1"><td>DEF</td><td>DEF</td><td>25</td><td>7,000</td></tr></tbody></table></div></div>';
function setup(t,mutate){
  const LIST='<div class="table-wrap"><table id="bulkTable"><tbody id="bulkBody"><tr><td>DH-DEMO-013</td><td>Hà Nội</td></tr><tr><td>DH-DEMO-001</td><td>Hà Nội</td></tr><tr><td>DH-DEMO-003</td><td>Sài Gòn</td></tr></tbody></table></div>';
  const dom=new JSDOM(LIST+DETAIL+read('panel.html'),{url:'http://localhost/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window;w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const f of ['../../shared/carton.js','rules.js','demo.js','stocktake.js'])w.eval(read(f));
  const data=structuredClone(w.PickingDemo);data.orders.forEach(o=>o.summary=o.status);data.locations.forEach((r,i)=>r.id='loc-'+i);
  if(mutate)mutate(data);
  w.PickingData={get:()=>data,key:o=>o.branch+'|'+o.orderCode,source:'MÔ PHỎNG'};
  w.eval(read('app.js'));w.eval(read('inventory.js'));w.PickingPopup.attach();
  const order=data.orders.find(o=>o.orderCode==='DH-DEMO-013'),at=(branch,code,location)=>data.locations.find(r=>r.branch===branch&&r.code===code&&r.location===location);
  return {w,d:w.document,data,order,at,inv:w.PickingInventory};
}
const stCells=d=>[...d.querySelectorAll('#lcDetailKiot td[data-st-col]')];
const popupSt=d=>[...d.querySelectorAll('#pickingRows td.picking-st')];
const type=(w,d,line,id,value)=>{const input=d.querySelector(`[data-qty][data-qline="${line}"][data-qloc="${id}"]`);input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));};
test('cột ST nằm ngay bên phải cột SL và trống khi chưa chỉ định (không 0, không gạch)',t=>{
  const {d}=setup(t);
  assert.deepEqual([...d.querySelectorAll('#lcDetailKiot thead th')].map(e=>e.textContent),['Mã hàng','Tên hàng','SL đặt','ST','Đơn giá']);
  assert.deepEqual(stCells(d).map(e=>e.textContent),['','']);
  assert.deepEqual([...d.querySelectorAll('#lcDetailKiot tbody tr')[0].cells].map(e=>e.textContent),['ABC','ABC','100','','5,000'],'ST sau SL, trước Đơn giá');
});
test('gợi ý mặc định: không có tổ hợp tròn 100 thì làm tròn lên 50 + 60 = 110, ST 2; sửa DEF còn 25 thì ST 0.5 đỏ',t=>{
  const {w,d,at}=setup(t);d.querySelector('#openPickingBtn').click();
  const a=at('HN','ABC','A01'),b=at('HN','ABC','B02'),def=at('HN','DEF','D01');
  const qty=(line,id)=>d.querySelector(`[data-qty][data-qline="${line}"][data-qloc="${id}"]`).value;
  assert.equal(qty(0,a.id),'50');assert.equal(qty(0,b.id),'60');
  assert.equal(popupSt(d)[0].dataset.st,'2','110 thực nhặt = 2 thùng');assert.equal(popupSt(d)[0].querySelector('strong').classList.contains('picking-st-frac'),false);
  assert.equal(d.querySelector('#pickingConfirm').disabled,false,'110 cho đơn 100 hợp lệ vì chỉ vượt chưa đến một thùng');
  assert.equal(qty(1,def.id),'50','mặc định làm tròn lên 1 thùng');
  type(w,d,1,def.id,'25');
  assert.equal(popupSt(d)[1].dataset.st,'0.5');assert.ok(popupSt(d)[1].querySelector('strong').classList.contains('picking-st-frac'),'ST lẻ hiện đỏ');
  assert.equal(popupSt(d)[1].textContent,'0.5');
});
test('thiếu SL phân bổ của dòng thì ST của dòng đó trống',t=>{
  const {w,d,at}=setup(t);d.querySelector('#openPickingBtn').click();
  type(w,d,0,at('HN','ABC','B02').id,'0');
  assert.equal(popupSt(d)[0].dataset.st,'','ABC mới 50/100 nên ST trống');assert.equal(popupSt(d)[0].textContent,'');
  assert.equal(popupSt(d)[1].dataset.st,'1');
});
test('chỉ định xong đơn ở Đang nhặt; ST hiện ở chi tiết đơn, Hủy nhặt trả ST về trống, Xác nhận nhặt giữ ST',t=>{
  const {w,d,order,at,inv}=setup(t);d.querySelector('#openPickingBtn').click();
  type(w,d,1,at('HN','DEF','D01').id,'25');
  d.querySelector('#pickingConfirm').click();
  assert.equal(inv.status(order),'picking');
  assert.deepEqual(stCells(d).map(e=>e.textContent),['2','0.5'],'chi tiết đơn đã có ST sau khi chỉ định đủ SL');
  assert.ok(stCells(d)[1].classList.contains('picking-st-frac'));assert.ok(!stCells(d)[0].classList.contains('picking-st-frac'));
  assert.match(d.querySelector('.picking-confirmed').textContent,/Đang nhặt/);
  d.querySelector('#openPickingBtn').click();
  assert.equal(d.querySelector('#pickingOrderStatus').textContent,'Đang nhặt');
  assert.equal(d.querySelector('#pickingConfirmPick').hidden,false);assert.equal(d.querySelector('#pickingCancelPick').hidden,false);assert.equal(d.querySelector('#pickingReopen').hidden,true);
  d.querySelector('#pickingCancelPick').click();
  assert.equal(inv.status(order),'cancelled');assert.equal(d.querySelector('#pickingOrderStatus').textContent,'Hủy nhặt');
  assert.deepEqual(stCells(d).map(e=>e.textContent),['',''],'sau Hủy nhặt ST trống lại');
  assert.equal(d.querySelector('#pickingReopen').hidden,false);
  d.querySelector('#pickingReopen').click();assert.equal(inv.status(order),null);assert.equal(d.querySelector('#pickingOrderStatus').textContent,'Chưa chỉ định');
  assert.equal(d.querySelector('#pickingConfirm').disabled,false,'chỉ định lại sau Hủy nhặt');
  d.querySelector('#pickingConfirm').click();d.querySelector('#openPickingBtn').click();
  d.querySelector('#pickingConfirmPick').click();
  assert.equal(inv.status(order),'confirmed');assert.equal(d.querySelector('#pickingOrderStatus').textContent,'Xác nhận nhặt');
  assert.deepEqual(stCells(d).map(e=>e.textContent),['2','1'],'sau Xác nhận nhặt giữ số ST theo lượt nhặt (đề xuất 50 = 1 thùng)');
});
test('Xác nhận nhặt trừ ghi chú khu, chỉ định lại sau Xác nhận phải bấm hai lần và hoàn tác đúng chuỗi',t=>{
  const {d,order,at,inv}=setup(t);d.querySelector('#openPickingBtn').click();d.querySelector('#pickingConfirm').click();d.querySelector('#openPickingBtn').click();
  d.querySelector('#pickingConfirmPick').click();
  assert.equal(inv.specText(at('HN','ABC','A01')),'Hết hàng');assert.equal(inv.specText(at('HN','ABC','B02')),'Hết hàng');
  assert.equal(inv.specText(at('HN','DEF','D01')),'Hết hàng');
  const reopen=d.querySelector('#pickingReopen');reopen.click();
  assert.equal(inv.status(order),'confirmed','lần bấm đầu chỉ xin xác nhận hoàn tác');assert.match(reopen.textContent,/Bấm lại/);
  reopen.click();assert.equal(inv.status(order),null);
  assert.equal(inv.specText(at('HN','ABC','A01')),'1T x 50');assert.equal(inv.specText(at('HN','ABC','B02')),'1T x 60');assert.equal(inv.specText(at('HN','DEF','D01')),'1T x 50');
});
test('vị trí ghi chú sai định dạng không chọn được và hiện nhãn lý do; sửa ghi chú hợp lệ thì chọn được',t=>{
  const {w,d,at,inv}=setup(t,data=>{data.locations.find(r=>r.branch==='HN'&&r.code==='ABC'&&r.location==='B02').notes='0.5Tx60';});
  d.querySelector('#openPickingBtn').click();
  const bad=at('HN','ABC','B02'),button=d.querySelector(`[data-line="0"][data-location="${bad.id}"]`);
  assert.equal(button.disabled,true);assert.match(button.textContent,/Số thùng và SL\/thùng phải là số nguyên dương/);
  assert.equal(d.querySelector('#pickingConfirm').disabled,true,'ABC chỉ còn 50 nên không đủ 100');
  inv.setSpec(bad,'1Tx60');w.PickingPopup.refresh();
  assert.equal(d.querySelector(`[data-line="0"][data-location="${bad.id}"]`).disabled,false);
});
test('khu nhiều quy cách vẫn tính SL, gợi ý được và trừ thông minh trọn thùng từ nhiều quy cách (ST nguyên)',t=>{
  const {d,order,at,data}=setup(t,x=>{const o=x.orders.find(o=>o.orderCode==='DH-DEMO-013');o.lines.push({productCode:'GHI',productName:'GHI',quantity:75,price:1});x.locations.push({branch:'HN',code:'GHI',location:'M01',notes:'1Tx50 + 2Tx25',id:'loc-ghi'});});
  d.querySelector('#lcDetailTitle').textContent='DH-DEMO-013';d.querySelector('#openPickingBtn').click();
  assert.equal(d.querySelector('[data-qty][data-qline="2"][data-qloc="loc-ghi"]').value,'75');
  assert.equal(popupSt(d)[2].dataset.st,'2','75 = 1 thùng 50 + 1 thùng 25: ghép trọn thùng từ hai quy cách nên ST là số nguyên');
  assert.ok(!popupSt(d)[2].querySelector('strong').classList.contains('picking-st-frac'));
});
test('đơn của cơ sở nào chỉ thấy vị trí của cơ sở đó (HN không lẫn SG)',t=>{
  const {w,d,data,at}=setup(t,x=>{x.orders.push({branch:'SG',orderCode:'DH-DEMO-SG',customerName:'SG',saleName:'x',status:{code:'SENT_TO_ACCOUNTANT'},summary:{code:'SENT_TO_ACCOUNTANT'},lines:[{productCode:'ABC',productName:'ABC',quantity:100,price:1}]});});
  w.PickingPopup.open(data.orders.find(o=>o.orderCode==='DH-DEMO-SG'));
  const ids=[...d.querySelectorAll('[data-line="0"][data-location]')].map(e=>e.dataset.location);
  assert.deepEqual(ids,[at('SG','ABC','A01').id],'SG chỉ có khu A01 2T x 60 của SG');
  assert.equal(d.querySelector(`[data-qty][data-qline="0"][data-qloc="${ids[0]}"]`).value,'120','SG: 100 cần, 60/thùng nên làm tròn lên 2 thùng = 120');
  assert.equal(popupSt(d)[0].dataset.st,'2');
});
test('bộ lọc trạng thái nhặt của cả đơn ở danh sách vòng đời: chip kèm số đơn, lọc đúng dòng, bỏ chọn về đầy đủ',async t=>{
  const {d,order,inv,data}=setup(t);
  const chips=()=>[...d.querySelectorAll('#pickingStatusFilter [data-pick-status]')].map(b=>b.textContent);
  const visible=()=>[...d.querySelectorAll('#bulkBody tr')].filter(r=>!r.hidden).map(r=>r.cells[0]?.textContent);
  assert.deepEqual(chips(),['Tất cả','Đang nhặt (0)','Xác nhận nhặt (0)','Hủy nhặt (0)']);
  const other=data.orders.find(o=>o.orderCode==='DH-DEMO-001'),sg=data.orders.find(o=>o.orderCode==='DH-DEMO-003');
  d.querySelector('#openPickingBtn').click();d.querySelector('#pickingConfirm').click();
  inv.reserve(other,{0:[{id:'loc-0',quantity:20},{id:'loc-1',quantity:10}],1:[{id:'loc-3',quantity:45}]});inv.confirmPick(other);
  inv.reserve(sg,{});inv.cancelPick(sg);d.querySelector('#bulkBody').appendChild(d.createElement('tr'));await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(chips(),['Tất cả','Đang nhặt (1)','Xác nhận nhặt (1)','Hủy nhặt (1)']);
  const press=key=>d.querySelector(`[data-pick-status="${key}"]`).click();
  press('picking');assert.deepEqual(visible().filter(Boolean),['DH-DEMO-013']);assert.equal(d.querySelector('[data-pick-status="picking"]').getAttribute('aria-pressed'),'true');
  press('confirmed');assert.deepEqual(visible().filter(Boolean),['DH-DEMO-001']);
  press('cancelled');assert.deepEqual(visible().filter(Boolean),['DH-DEMO-003'],'SG lọc theo cơ sở của dòng');
  press('');assert.deepEqual(visible().filter(Boolean),['DH-DEMO-013','DH-DEMO-001','DH-DEMO-003']);
});
test('cột Số thùng khi in: lấy lẻ 100 từ 2Tx60 ra 2Tx60-20; lấy tròn 250 từ 7Tx50 ra 5Tx50; nhiều vị trí nối " + "',t=>{
  const {inv,order}=setup(t,x=>{const o=x.orders.find(o=>o.orderCode==='DH-DEMO-013');
    o.lines.push({productCode:'LE',productName:'LE',quantity:100,price:1},{productCode:'TRON',productName:'TRON',quantity:250,price:1},{productCode:'HAI',productName:'HAI',quantity:70,price:1});
    x.locations.push({branch:'HN',code:'LE',location:'M01',notes:'2Tx60',id:'loc-le'},{branch:'HN',code:'TRON',location:'M02',notes:'7Tx50',id:'loc-tron'},
      {branch:'HN',code:'HAI',location:'M03',notes:'2Tx60',id:'loc-hai1'},{branch:'HN',code:'HAI',location:'M04',notes:'1Tx50',id:'loc-hai2'});});
  inv.reserve(order,{2:[{id:'loc-le',quantity:100}],3:[{id:'loc-tron',quantity:250}],4:[{id:'loc-hai1',quantity:60},{id:'loc-hai2',quantity:10}]});
  assert.equal(inv.lineStText(order,2),'2Tx60-20');
  assert.equal(inv.lineStText(order,3),'5Tx50');
  assert.equal(inv.lineStText(order,4),'1Tx60 + 1Tx50-40');
  assert.equal(inv.lineStText(order,0),null,'dòng chưa chỉ định thì trống');
});
test('phiếu in: hàng lấy ở 2 khu trở lên ghi mỗi khu một dòng "Tên khu: số thùng"; một khu chỉ ghi tên khu',t=>{
  const {w,inv,order,data}=setup(t,x=>{const o=x.orders.find(o=>o.orderCode==='DH-DEMO-013');
    o.lines.push({productCode:'HAI',productName:'HAI',quantity:100,price:1},{productCode:'MOT',productName:'MOT',quantity:100,price:1});
    x.locations.push({branch:'HN',code:'HAI',location:'A07',notes:'1Tx50',id:'loc-a07'},{branch:'HN',code:'HAI',location:'B06',notes:'2Tx60',id:'loc-b06'},{branch:'HN',code:'MOT',location:'C01',notes:'2Tx60',id:'loc-c01'});});
  inv.reserve(order,{2:[{id:'loc-a07',quantity:50},{id:'loc-b06',quantity:50}],3:[{id:'loc-c01',quantity:100}]});
  w.PickingInvoiceTemplate=read('order-template.html');
  w.eval(read('invoice.js'));
  w.PickingInvoice.show(order,w.PickingInventory.record(order));
  const rows=[...w.document.querySelectorAll('#pickingPrintSheet .invoice-goods tbody tr')];
  const cellOf=code=>[...rows.find(r=>r.textContent.includes('('+code+')')).cells].find(td=>/A07|B06|C01/.test(td.textContent));
  assert.equal(cellOf('HAI').textContent.trim(),'A07: 1Tx50\nB06: 1Tx60-10');
  assert.equal(cellOf('HAI').style.whiteSpace,'pre-line');
  assert.equal(cellOf('MOT').textContent.trim(),'C01');
});
