'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const read=f=>fs.readFileSync(path.join(__dirname,f),'utf8');
const LOCATIONS=[
  {id:'a',branch:'HN',code:'P1',name:'Hàng 1',location:'A01',notes:'5T x 100',arrivalDate:'4/10'},
  {id:'b',branch:'HN',code:'P1',name:'Hàng 1',location:'B02',notes:'2T x 50',arrivalDate:'4/10'},
  {id:'c',branch:'HN',code:'P2',name:'Hàng 2',location:'C03',notes:'1T x 10',arrivalDate:'4/10'},
  {id:'s',branch:'SG',code:'P1',name:'Hàng 1',location:'A01',notes:'3T x 20',arrivalDate:'4/10'}
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
const tab=(d,b)=>d.querySelector(`[data-loc-branch="${b}"]`).click();
const row=(d,id)=>d.querySelector(`#locBody tr.loc-row[data-loc-id="${id}"]`);
const detailRows=d=>[...d.querySelectorAll('#locBody .loc-detail-table tbody tr')];
const edit=(w,d,id,value)=>{const input=d.querySelector(`[data-loc-notes="${id}"]`);input.value=value;input.dispatchEvent(new w.Event('change',{bubbles:true}));};
const esc=(w,d)=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
const cell=(d,id)=>row(d,id).querySelector('td.loc-updated');
test('bấm một dòng hiện lịch sử của đúng mã hàng trong đúng cơ sở, khu vừa bấm nổi bật và xếp đầu; bấm lại hoặc Esc thì đóng',t=>{
  const {w,d}=setup(t);
  edit(w,d,'a','4T x 100');edit(w,d,'b','3T x 50');edit(w,d,'c','2T x 10');tab(d,'SG');edit(w,d,'s','2T x 20');tab(d,'HN');
  row(d,'b').cells[0].click();
  assert.ok(d.querySelector('#locBody .loc-detail'),'panel mở ngay dưới dòng');assert.equal(row(d,'b').getAttribute('aria-expanded'),'true');
  let rows=detailRows(d);
  assert.equal(rows.length,2,'chỉ 2 bản ghi của P1 ở HN: không lẫn P2 hay SG');
  assert.deepEqual(rows.map(r=>r.cells[1].textContent),['B02','A01'],'khu vừa bấm xếp lên đầu');
  assert.ok(rows[0].classList.contains('loc-hist-here'));assert.equal(rows[1].classList.contains('loc-hist-here'),false);
  assert.match(rows[0].cells[2].textContent,/2T x 50 → 3T x 50/);assert.match(rows[0].cells[3].textContent,/100 → 150/);assert.match(rows[0].cells[4].textContent,/Sửa tay/);
  assert.match(d.querySelector('.loc-detail-head strong').textContent,/P1 · Hàng 1 · Vị trí HN/);
  row(d,'b').cells[0].click();assert.equal(d.querySelector('#locBody .loc-detail'),null,'bấm lại thì đóng');
  row(d,'a').cells[0].click();assert.equal(detailRows(d)[0].cells[1].textContent,'A01');
  esc(w,d);assert.equal(d.querySelector('#locBody .loc-detail'),null,'Esc đóng panel');assert.equal(d.querySelector('#pickingLocationsDialog').open,true,'Esc lần đầu chỉ đóng panel, không đóng sổ vị trí');
  esc(w,d);assert.equal(d.querySelector('#pickingLocationsDialog').open,false,'Esc lần hai đóng sổ vị trí');
});
test('chip "Chỉ khu này" chỉ giữ bản ghi của khu đã bấm; tab SG chỉ có lịch sử của SG',t=>{
  const {w,d}=setup(t);
  edit(w,d,'a','4T x 100');edit(w,d,'b','3T x 50');tab(d,'SG');edit(w,d,'s','2T x 20');
  row(d,'s').cells[0].click();assert.equal(detailRows(d).length,1);assert.equal(detailRows(d)[0].cells[1].textContent,'A01');assert.match(detailRows(d)[0].cells[2].textContent,/3T x 20 → 2T x 20/);
  tab(d,'HN');assert.equal(d.querySelector('#locBody .loc-detail'),null,'đổi tab thì đóng panel');
  row(d,'a').cells[0].click();assert.equal(detailRows(d).length,2);
  d.querySelector('[data-detail-here]').click();
  assert.deepEqual(detailRows(d).map(r=>r.cells[1].textContent),['A01']);assert.equal(d.querySelector('[data-detail-here]').getAttribute('aria-pressed'),'true');
  assert.ok(d.querySelector('#locBody .loc-detail'),'bấm chip không đóng panel');
  d.querySelector('[data-detail-close]').click();assert.equal(d.querySelector('#locBody .loc-detail'),null);
});
test('bấm vào ô đang sửa (ghi chú, nút) không mở panel',t=>{
  const {w,d}=setup(t);
  edit(w,d,'a','4T x 100');
  d.querySelector('[data-loc-notes="a"]').click();assert.equal(d.querySelector('#locBody .loc-detail'),null);
  d.querySelector('[data-loc-notes="a"]').dispatchEvent(new w.Event('focus',{bubbles:true}));assert.equal(d.querySelector('#locBody .loc-detail'),null);
  row(d,'a').cells[4].click();assert.ok(d.querySelector('#locBody .loc-detail'),'bấm ô khác của dòng mở panel');
  d.querySelector('[data-loc-notes="a"]').click();assert.ok(d.querySelector('#locBody .loc-detail'),'bấm ô ghi chú không đóng panel');
  const header=d.querySelector('#locBody .loc-detail');header.querySelector('td').click();assert.ok(d.querySelector('#locBody .loc-detail'),'bấm trong panel không đóng');
});
test('cột "Cập nhật lần cuối": trống khi chưa đổi, đổi sau sửa tay và sau xác nhận nhặt, không đổi khi giá trị không đổi',t=>{
  const {w,d,inv}=setup(t);
  assert.equal(d.querySelector('#locBody').closest('table').querySelector('thead th:last-child').textContent,'Cập nhật lần cuối');
  assert.equal(cell(d,'a').textContent,'','chưa từng đổi thì để trống');assert.equal(cell(d,'a').title,'');
  edit(w,d,'a','4T x 100');
  const first=inv.lastChanges('HN').get(inv.lastChangeKey(LOCATIONS[0]));
  const v=new Date(Date.parse(first.at)+7*3600e3).toISOString(),short=v.slice(8,10)+'/'+v.slice(5,7)+' '+v.slice(11,16);
  assert.match(cell(d,'a').textContent,new RegExp('^'+short.replace('/','\\/')));assert.match(cell(d,'a').querySelector('small').textContent,/^Sửa tay$/);
  assert.match(cell(d,'a').title,/Sửa tay/);assert.equal(cell(d,'a').dataset.updated,first.at,'cùng nguồn với bản ghi lịch sử mới nhất');
  assert.equal(cell(d,'b').textContent,'','dòng khác không bị ảnh hưởng');
  edit(w,d,'a','4T x 100');assert.equal(inv.history('HN').length,1,'giá trị không đổi thì không ghi');assert.equal(cell(d,'a').dataset.updated,first.at);
  const order={branch:'HN',orderCode:'O7',lines:[{productCode:'P1',quantity:100}]};
  inv.reserve(order,{0:[{id:'a',quantity:100}]});assert.equal(cell(d,'a').dataset.updated,first.at,'Đang nhặt chưa đổi ghi chú/SL nên chưa đổi cột');
  inv.confirmPick(order);tab(d,'SG');tab(d,'HN');
  const second=inv.lastChanges('HN').get(inv.lastChangeKey(LOCATIONS[0]));
  assert.notEqual(second,first);assert.equal(cell(d,'a').dataset.updated,second.at);
  assert.equal(cell(d,'a').querySelector('small').textContent,'Tự trừ · đơn O7','xác nhận nhặt: hệ thống tự trừ');
  assert.match(cell(d,'a').title,/Tự trừ · đơn O7/);
  inv.cancelPick(order);tab(d,'SG');tab(d,'HN');
  assert.equal(cell(d,'a').querySelector('small').textContent,'Tự cộng lại · đơn O7','hủy nhặt: tự cộng lại');
  tab(d,'SG');assert.equal(cell(d,'s').textContent,'','SG riêng, chưa từng đổi');
});
