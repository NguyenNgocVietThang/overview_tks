'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const LOCATIONS=[
  {id:'h1',branch:'HN',code:'P1',name:'Hàng 1',location:'A01',notes:'5T x 100',arrivalDate:'4/10'},
  {id:'h2',branch:'HN',code:'P2',name:'Hàng 2',location:'B02',notes:'1Tx50 + 2Tx25',arrivalDate:'4/10'},
  {id:'h4',branch:'HN',code:'P4',name:'Hàng 4',location:'D04',notes:'Dãy cửa kho',arrivalDate:'4/10'},
  {id:'s1',branch:'SG',code:'P1',name:'Hàng 1',location:'A01',notes:'3T x 20',arrivalDate:'4/10'}
];
function setup(t){
  const dom=new JSDOM('<div id="lcDetailBody"></div>'+read('panel.html'),{url:'http://localhost/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window;w.structuredClone=structuredClone;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
  for(const f of ['../../shared/carton.js','rules.js'])w.eval(read(f));
  const data={orders:[],locations:structuredClone(LOCATIONS)};
  w.PickingData={get:()=>data,key:o=>o.branch+'|'+o.orderCode};
  for(const f of ['stocktake.js','inventory.js','locations-ui.js'])w.eval(read(f));
  const d=w.document;d.querySelector('#pickingLocationsBtn').click();
  return {w,d,data,inv:w.PickingInventory};
}
const json=v=>JSON.parse(JSON.stringify(v));
const tab=(d,b)=>d.querySelector(`[data-loc-branch="${b}"]`).click();
const fill=(w,d,code,notes,location)=>{for(const [id,value] of [['locEntryCode',code],['locEntryNotes',notes],['locEntryLocation',location]]){const input=d.querySelector('#'+id);input.value=value;input.dispatchEvent(new w.Event('input',{bubbles:true}));}};
const save=(w,d)=>d.querySelector('#locEntry').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
const rowOf=(d,id)=>[...d.querySelectorAll('#locBody tr')].find(el=>el.dataset.locId===id);
const today=()=>new Date(Date.now()+7*3600e3).toISOString().slice(0,10).split('-').reverse().join('/');
test('nhập tay: gõ mã + ghi chú + vị trí thì Tên hàng và SL tự nhảy, Lưu thêm đúng dòng vào cơ sở của tab đang mở',t=>{
  const {w,d,data,inv}=setup(t);
  fill(w,d,'P1','5T x 100','Z09');
  assert.equal(d.querySelector('#locEntryName').textContent,'Tên hàng: Hàng 1','tên tra theo mã hàng đã có trong prototype');
  assert.equal(d.querySelector('#locEntryQty').textContent,'SL: 500');assert.equal(d.querySelector('#locEntryWarn').hidden,true);
  fill(w,d,'P1','1Tx50c + 2Tx25 - 30','Z09');assert.equal(d.querySelector('#locEntryQty').textContent,'SL: 70','cộng thùng × SL/thùng, trừ - N, nhận hậu tố c');
  fill(w,d,'P1','5T x 100','Z09');save(w,d);
  const added=data.locations.find(r=>r.location==='Z09');
  assert.ok(added);assert.equal(added.branch,'HN');assert.equal(added.arrivalDate,today(),'ngày về mặc định hôm nay theo giờ Việt Nam');
  const tr=rowOf(d,added.id);
  assert.ok(tr);assert.equal(tr.cells[1].textContent,'Hàng 1');assert.match(tr.cells[2].querySelector('strong').textContent,/500/);assert.equal(tr.classList.contains('loc-warning'),false);
  assert.equal(d.querySelector('#locEntryCode').value,'','form được xóa sau khi lưu');
  const h=inv.history('HN');
  assert.equal(h.length,1);assert.deepEqual([h[0].source,h[0].notesBefore,h[0].notesAfter,h[0].qtyAfter],['Sửa tay','','5T x 100',500]);
  tab(d,'SG');assert.equal(rowOf(d,added.id),undefined,'không lẫn sang SG');
  assert.equal(d.querySelector('#locEntryTitle').textContent,'Thêm dòng · Vị trí SG');
  fill(w,d,'P1','3T x 20','Z09');save(w,d);
  assert.equal(data.locations.filter(r=>r.location==='Z09').length,2,'cùng mã và vị trí ở SG là khóa khác');assert.equal(inv.history('SG').length,1);assert.equal(inv.history('HN').length,1);
});
test('nhập tay: ghi chú gõ dở cập nhật cảnh báo tức thì, vẫn lưu được nhưng không chỉ định nhặt được; ghi chú trống lưu được với SL 0',t=>{
  const {w,d,data,inv}=setup(t);
  fill(w,d,'P1','5T x','Z10');
  assert.equal(d.querySelector('#locEntryWarn').hidden,false);assert.equal(d.querySelector('#locEntryWarn').textContent,'Ghi chú sai định dạng');assert.equal(d.querySelector('#locEntryQty').textContent,'SL: 0');
  fill(w,d,'P1','5T x 1','Z10');assert.equal(d.querySelector('#locEntryWarn').hidden,true,'gõ xong thì hết cảnh báo');
  fill(w,d,'P1','5T x','Z10');save(w,d);
  const row=data.locations.find(r=>r.location==='Z10');assert.ok(row);
  assert.ok(rowOf(d,row.id).classList.contains('loc-warning'),'dòng cảnh báo lưu được và hiện đỏ');
  assert.equal(inv.available(row),null,'không chỉ định nhặt được');
  fill(w,d,'P2','','Z11');assert.equal(d.querySelector('#locEntryWarn').hidden,true);save(w,d);
  const blank=data.locations.find(r=>r.location==='Z11');assert.equal(inv.row(blank).quantity,0);assert.deepEqual(json(inv.row(blank).warnings),[]);
  assert.equal(inv.available(blank),0,'SL 0 chưa có hàng để nhặt');
});
test('nhập tay: mã hàng không tra được tên để trống Tên hàng và vào cảnh báo "Mã hàng chưa có trong danh mục"',t=>{
  const {w,d,data}=setup(t);
  fill(w,d,'KHONGCO','1T x 10','Z12');
  assert.equal(d.querySelector('#locEntryName').textContent,'Tên hàng: —');assert.equal(d.querySelector('#locEntryWarn').textContent,'Mã hàng chưa có trong danh mục');
  save(w,d);
  const row=data.locations.find(r=>r.code==='KHONGCO'),tr=rowOf(d,row.id);
  assert.ok(tr.classList.contains('loc-warning'));assert.equal(tr.cells[1].textContent,'—');assert.equal(tr.querySelector('.loc-badge').textContent,'Mã hàng chưa có trong danh mục');
  assert.match(tr.cells[2].querySelector('strong').textContent,/10/,'vẫn tính SL từ ghi chú');
  assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (3)','HN: h2, h4 và dòng mã lạ');
});
test('nhập tay: trùng khóa (cơ sở, mã hàng, vị trí) bị chặn, báo trùng và nhảy tới dòng sẵn có; sửa ghi chú dòng đó cập nhật SL',t=>{
  const {w,d,data,inv}=setup(t);
  d.querySelector('#locWarnFilter').click();
  fill(w,d,'p1','9T x 10','a01');
  assert.equal(d.querySelector('#locEntryWarn').textContent,'Đã có dòng này, Lưu để nhảy tới dòng đó','xem trước đã báo trùng, không phân biệt hoa thường');
  const before=data.locations.length;save(w,d);
  assert.equal(data.locations.length,before,'không tạo dòng thứ hai');assert.equal(inv.history('HN').length,0);
  assert.match(d.querySelector('#locError').textContent,/Đã có dòng P1 tại A01 ở HN/);
  assert.equal(d.querySelector('#locWarnFilter').getAttribute('aria-pressed'),'false','bộ lọc được bỏ để thấy dòng sẵn có');
  assert.ok(rowOf(d,'h1').classList.contains('loc-focus'),'nhảy tới dòng trùng');
  const input=d.querySelector('[data-loc-notes="h1"]');input.value='9T x 10';input.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.match(rowOf(d,'h1').cells[2].querySelector('strong').textContent,/90/,'sửa ghi chú dòng sẵn có tự cập nhật SL');
  assert.deepEqual([inv.history('HN')[0].source,inv.history('HN').length],['Sửa tay',1]);
});
test('import và nhập tay cùng dùng một parser: cùng ghi chú ra cùng SL và cảnh báo',t=>{
  const {inv,data}=setup(t);
  ['1Tx50c + 2Tx25 - 30','5T x 100','0.5Tx100','abc','1T x 50c'].forEach((note,i)=>{
    const manual=inv.addLocation('HN',{code:'P1',location:'M'+i,notes:note});
    inv.importSpecs('HN',[{code:'P1',location:'A01',spec:note}]);
    const imported=data.locations.find(r=>r.id==='h1');
    const a=inv.row(manual),b=inv.row(imported);
    assert.equal(a.quantity,b.quantity,note);assert.deepEqual(json(a.warnings),json(b.warnings),note);
  });
});
