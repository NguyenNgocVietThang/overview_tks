'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const LOCATIONS=[
  {id:'h1',branch:'HN',code:'P1',name:'Hàng 1',location:'A01',notes:'5T x 100',arrivalDate:'4/10'},
  {id:'h2',branch:'HN',code:'P2',name:'Hàng 2',location:'B02',notes:'1Tx50 + 2Tx25',arrivalDate:'4/10'},
  {id:'h3',branch:'HN',code:'P3',name:'Hàng 3',location:'C03',notes:'1Tx50 - 30',arrivalDate:'4/10'},
  {id:'h4',branch:'HN',code:'P4',name:'Hàng 4',location:'D04',notes:'Dãy cửa kho',arrivalDate:'4/10'},
  {id:'h5',branch:'HN',code:'P5',name:'Hàng 5',location:'E05',notes:'',arrivalDate:'4/10'},
  {id:'s1',branch:'SG',code:'P1',name:'Hàng 1',location:'A01',notes:'3T x 20',arrivalDate:'4/10'},
  {id:'s2',branch:'SG',code:'P2',name:'Hàng 2',location:'B02',notes:'1Tx50 + 1Tx60',arrivalDate:'4/10'}
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
const rowIds=d=>[...d.querySelectorAll('#locBody tr[data-loc-id]')].map(r=>r.dataset.locId);
const redIds=d=>[...d.querySelectorAll('#locBody tr.loc-warning')].map(r=>r.dataset.locId);
const edit=(w,d,id,value)=>{const input=d.querySelector(`[data-loc-notes="${id}"]`);input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));};
const tab=(d,b)=>d.querySelector(`[data-loc-branch="${b}"]`).click();
test('bảng Vị trí HN bôi đỏ đúng dòng cảnh báo (nhiều quy cách, phần trừ lẻ, sai định dạng) và không bôi dòng rỗng hay dòng sạch',t=>{
  const {d}=setup(t);
  assert.deepEqual(rowIds(d),['h1','h2','h3','h4','h5']);
  assert.deepEqual(redIds(d),['h2','h3','h4'],'h3 có phần trừ lẻ nên đỏ; h5 ghi chú rỗng và h1 sạch thì không');
  assert.deepEqual([...d.querySelectorAll('#locBody tr.loc-multi-spec')].map(r=>r.dataset.locId),['h2'],'class riêng chỉ cho nhiều quy cách');
  assert.equal(d.querySelector('[data-loc-id="h2"] .loc-badge').textContent,'Nhiều quy cách');
  assert.equal(d.querySelector('[data-loc-id="h4"] .loc-badge').textContent,'Ghi chú sai định dạng');
  assert.equal(d.querySelector('[data-loc-id="h3"] .loc-badge').textContent,'Có phần trừ lẻ');assert.match(d.querySelector('[data-loc-id="h3"] td.num strong').textContent,/20/,'1Tx50 - 30 vẫn tính SL = 20');
  assert.equal(d.querySelector('[data-loc-id="h5"] .loc-badge'),null);assert.equal(d.querySelector('[data-loc-id="h5"] td.num strong').textContent,'0','ghi chú rỗng: SL 0, không cảnh báo');
  assert.equal(d.querySelector('[data-loc-id="h1"] .loc-badge'),null);
  assert.equal(d.querySelector('[data-loc-id="h2"] .loc-badge').title,'Nhiều quy cách','có tooltip, không chỉ dựa vào màu');
});
test('tab SG bôi đỏ riêng, không lẫn dòng HN, và SL hiển thị tính từ ghi chú',t=>{
  const {d}=setup(t);tab(d,'SG');
  assert.deepEqual(rowIds(d),['s1','s2']);assert.deepEqual(redIds(d),['s2']);
  assert.equal(d.querySelector('#pickingLocationsTitle').textContent,'Vị trí SG');
  assert.match(d.querySelector('[data-loc-id="s2"] td.num strong').textContent,/110/,'1Tx50 + 1Tx60 = 110');
  assert.match(d.querySelector('[data-loc-id="s1"] td.num strong').textContent,/60/);
  tab(d,'HN');assert.match(d.querySelector('[data-loc-id="h2"] td.num strong').textContent,/100/,'1Tx50 + 2Tx25 = 100');
  assert.equal(d.querySelector('[data-loc-id="h4"] td.num strong').textContent,'0','ghi chú sai định dạng: SL hiển thị 0');
});
test('bộ lọc Cảnh báo: chip có số đếm riêng từng tab, bật chỉ hiện dòng cảnh báo, bỏ chọn về danh sách đầy đủ',t=>{
  const {d}=setup(t);
  const chip=()=>d.querySelector('#locWarnFilter');
  assert.equal(chip().textContent,'Cảnh báo (3)');
  chip().click();assert.equal(chip().getAttribute('aria-pressed'),'true');
  assert.deepEqual(rowIds(d),['h2','h3','h4']);assert.deepEqual(redIds(d),['h2','h3','h4'],'tất cả dòng trong bộ lọc đều đỏ');
  tab(d,'SG');assert.equal(chip().textContent,'Cảnh báo (1)','đếm độc lập theo tab');assert.deepEqual(rowIds(d),['s2']);
  chip().click();assert.equal(chip().getAttribute('aria-pressed'),'false');assert.deepEqual(rowIds(d),['s1','s2']);
  tab(d,'HN');assert.equal(chip().textContent,'Cảnh báo (3)');assert.deepEqual(rowIds(d),['h1','h2','h3','h4','h5']);
});
test('sửa ghi chú thành hợp lệ: dòng hết đỏ, rời bộ lọc Cảnh báo, số đếm giảm ngay; SG không bị ảnh hưởng',t=>{
  const {w,d}=setup(t);
  d.querySelector('#locWarnFilter').click();
  edit(w,d,'h2','1Tx50');
  assert.deepEqual(rowIds(d),['h3','h4'],'h2 rời bộ lọc');assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (2)');
  d.querySelector('#locWarnFilter').click();
  assert.deepEqual(redIds(d),['h3','h4']);assert.equal(d.querySelector('[data-loc-id="h2"] .loc-badge'),null);
  assert.match(d.querySelector('[data-loc-id="h2"] td.num strong').textContent,/50/,'SL nhảy theo ghi chú');
  edit(w,d,'h4','2Tx30');assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (1)');
  edit(w,d,'h3','1Tx20');assert.match(d.querySelector('[data-loc-id="h3"] td.num strong').textContent,/20/,'1Tx20 cho cùng SL 20 với 1Tx50 - 30, hết cảnh báo');
  assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (0)');assert.deepEqual(redIds(d),[]);
  tab(d,'SG');assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (1)');
});
test('ghi chú sửa sang số thùng thập phân được lưu nhưng dòng bị cảnh báo ngay; sửa sang rỗng thì SL 0 và không cảnh báo',t=>{
  const {w,d}=setup(t);
  edit(w,d,'h1','0.5Tx100');
  assert.deepEqual(redIds(d),['h1','h2','h3','h4']);assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (4)');
  assert.equal(d.querySelector('[data-loc-id="h1"] .loc-badge').textContent,'Số thùng và SL/thùng phải là số nguyên dương');
  edit(w,d,'h1','');assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (3)');assert.equal(d.querySelector('[data-loc-id="h1"] td.num strong').textContent,'0');
  edit(w,d,'h1','1Tx50');assert.equal(d.querySelector('#locWarnFilter').textContent,'Cảnh báo (3)');
});
test('Lịch sử chỉnh sửa: chỉ của cơ sở đang mở, mới nhất lên đầu, đủ cột, đóng bằng Esc',t=>{
  const {w,d}=setup(t);
  edit(w,d,'h1','3T x 100');edit(w,d,'h2','1Tx50');tab(d,'SG');edit(w,d,'s1','2T x 20');
  d.querySelector('#locHistoryBtn').click();
  assert.equal(d.querySelector('#pickingHistoryDialog').open,true);
  assert.equal(d.querySelector('#pickingHistoryTitle').textContent,'Lịch sử chỉnh sửa · Vị trí SG');
  let rows=[...d.querySelectorAll('#historyBody tr')];assert.equal(rows.length,1,'SG chỉ có một chỉnh sửa');
  assert.deepEqual([...rows[0].cells].map(c=>c.textContent.replace(/\s+/g,' ').trim()).slice(1),['P1','A01','3T x 20 → 2T x 20','60 → 40','Sửa tay','Người dùng demo']);
  assert.match(rows[0].cells[0].textContent,/\d{1,2}:\d{2}/,'có giờ Việt Nam');
  d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('#pickingHistoryDialog').open,false);
  tab(d,'HN');d.querySelector('#locHistoryBtn').click();
  rows=[...d.querySelectorAll('#historyBody tr')];
  assert.deepEqual(rows.map(r=>r.cells[1].textContent),['P2','P1'],'mới nhất (h2) lên đầu, không lẫn bản ghi SG');
  assert.match(rows[0].cells[3].textContent,/1Tx50 \+ 2Tx25 → 1T x 50/);
});
test('dòng lịch sử có ghi chú sau gây cảnh báo thì tô đỏ nhãn lý do',t=>{
  const {w,d}=setup(t);
  edit(w,d,'h1','0.5Tx100');d.querySelector('#locHistoryBtn').click();
  const cell=d.querySelector('#historyBody tr').cells[3];
  assert.ok(cell.querySelector('.loc-warning-text'));assert.equal(cell.querySelector('.loc-badge').textContent,'Số thùng và SL/thùng phải là số nguyên dương');
});
test('Tổng SL hiện Đang nhặt và Nhặt được dưới số tổng',t=>{
  const {d,inv,data}=setup(t);
  inv.reserve({branch:'HN',orderCode:'O1',lines:[{productCode:'P1',quantity:200}]},{0:[{id:'h1',quantity:200}]});
  d.querySelector('[data-loc-branch="HN"]').click();
  const cell=d.querySelector('[data-loc-id="h1"] td.num');
  assert.match(cell.querySelector('strong').textContent,/500/);assert.match(cell.querySelector('.loc-picking').textContent,/Đang nhặt 200/);assert.match(cell.querySelector('.loc-pickable').textContent,/Nhặt được 300/);
  assert.equal(d.querySelector('[data-loc-id="h3"] .loc-picking'),null);
});
