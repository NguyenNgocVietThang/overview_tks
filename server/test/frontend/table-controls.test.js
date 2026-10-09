'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const sourcePath = path.join(__dirname, '../../public/shared/table-controls.js');
const fixture = '<div class="table-wrap"><table id="orders"><thead><tr><th data-column-key="code" style="width:130px">Mã hàng</th><th data-column-key="name" style="width:240px">Tên hàng</th><th data-column-key="qty" style="width:112px">Số lượng</th></tr></thead><tbody><tr><td>A</td><td>Tên rất dài</td><td>12</td></tr><tr><td colspan="3">Tổng</td></tr></tbody><tfoot><tr><td colspan="2">Tổng cộng</td><td>12</td></tr></tfoot></table></div>';
function setup(t, html = fixture) {
  const dom = new JSDOM(html, { url:'https://tables.test/', runScripts:'outside-only', pretendToBeVisual:true });
  t.after(() => dom.window.close());
  // jsdom has no layout; declared widths and event behaviour are tested here,
  // pixel geometry and overflow are checked in a real browser separately.
  if (fs.existsSync(sourcePath)) dom.window.eval(fs.readFileSync(sourcePath, 'utf8'));
  return { window:dom.window, doc:dom.window.document, table:dom.window.document.querySelector('table'), api:dom.window.TKSTables };
}
function state(ctx) { return JSON.parse(JSON.stringify(ctx.api.getState(ctx.table))); }
function open(ctx) { ctx.doc.querySelector('.tks-columns-button').click(); return ctx.doc.querySelector('.tks-columns-picker'); }
function toggle(ctx,key) { const picker=open(ctx); const input=picker.querySelector('[data-column-key="'+key+'"]'); input.checked=!input.checked; input.dispatchEvent(new ctx.window.Event('change',{bubbles:true})); picker.querySelector('[data-action="close"]').click(); }

test('column controls initialize once and hold declared widths after rows and headers are rebuilt', t => {
  const ctx=setup(t);
  assert.ok(ctx.api, 'shared table controls must be available');
  ctx.api.enhance(ctx.table);
  assert.deepEqual(state(ctx).columns.map(c=>c.width),[130,240,112]);
  const head=ctx.table.tHead.innerHTML;
  ctx.table.tBodies[0].innerHTML='<tr><td>Z</td><td>'+('Long '.repeat(100))+'</td><td>1000000</td></tr>';
  ctx.table.tHead.innerHTML=head;
  ctx.api.refresh(ctx.table); ctx.api.refresh(ctx.table);
  assert.deepEqual(state(ctx).columns.map(c=>c.width),[130,240,112]);
  assert.equal(ctx.doc.querySelectorAll('.tks-columns-button').length,1);
  assert.equal(ctx.table.querySelectorAll('.tks-column-resizer').length,3);
  ctx.table.querySelector('.tks-column-resizer').dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.equal(state(ctx).columns[0].width,140,'Recreated handle must still work');
});

test('hiding a column preserves logical cells, remaining widths and merged-cell coverage', t => {
  const ctx=setup(t); assert.ok(ctx.api);
  ctx.api.enhance(ctx.table); toggle(ctx,'name');
  assert.equal(ctx.table.tHead.rows[0].cells.length,3);
  assert.equal(ctx.table.tHead.rows[0].cells[1].classList.contains('tks-column-hidden'),true);
  assert.equal(ctx.table.tBodies[0].rows[0].cells[1].classList.contains('tks-column-hidden'),true);
  assert.equal(ctx.table.tBodies[0].rows[1].cells[0].colSpan,2);
  assert.equal(ctx.table.tFoot.rows[0].cells[0].colSpan,1);
  assert.deepEqual(state(ctx).columns.map(c=>c.width),[130,240,112]);
  toggle(ctx,'name');
  assert.equal(ctx.table.tBodies[0].rows[1].cells[0].colSpan,3);
  assert.equal(ctx.table.tFoot.rows[0].cells[0].colSpan,2);
});

test('keyboard resizing changes only selected column and cannot fire header sorting', t => {
  const ctx=setup(t); assert.ok(ctx.api); ctx.api.enhance(ctx.table);
  let sorts=0; ctx.table.tHead.addEventListener('keydown',()=>sorts++);
  const handle=ctx.table.querySelectorAll('.tks-column-resizer')[1];
  handle.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  assert.deepEqual(state(ctx).columns.map(c=>c.width),[130,250,112]); assert.equal(sorts,0);
  for(let i=0;i<30;i++) handle.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
  assert.equal(state(ctx).columns[1].width,64);
  toggle(ctx,'name'); toggle(ctx,'name'); assert.equal(state(ctx).columns[1].width,64);
});

test('pointer resize keeps neighbouring widths and clears drag state after cancellation', t => {
  const ctx=setup(t); assert.ok(ctx.api); ctx.api.enhance(ctx.table);
  const handle=ctx.table.querySelector('.tks-column-resizer'); let clicks=0;
  ctx.table.tHead.addEventListener('click',()=>clicks++);
  const pointer=(type,x)=>{const e=new ctx.window.MouseEvent(type,{clientX:x,button:0,bubbles:true,cancelable:true});Object.defineProperty(e,'pointerId',{value:7});return e;};
  handle.dispatchEvent(pointer('pointerdown',100));
  ctx.doc.dispatchEvent(pointer('pointermove',180));
  ctx.doc.dispatchEvent(pointer('pointercancel',180));
  handle.dispatchEvent(new ctx.window.MouseEvent('click',{bubbles:true}));
  assert.deepEqual(state(ctx).columns.map(c=>c.width),[210,240,112]);
  assert.equal(ctx.doc.body.classList.contains('tks-table-resizing'),false);
  assert.equal(clicks,0);
});

test('picker locks required columns, never hides the last column, and restores focus on Escape', t => {
  const ctx=setup(t); assert.ok(ctx.api);
  ctx.api.enhance(ctx.table,{columns:[{key:'code',locked:true},{key:'name'},{key:'qty'}]});
  const picker=open(ctx); assert.equal(picker.querySelector('[data-column-key="code"]').disabled,true);
  picker.querySelector('[data-action="hide-all"]').click();
  assert.deepEqual(state(ctx).columns.map(c=>c.hidden),[false,true,true]);
  picker.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(picker.hidden,true);
  assert.equal(ctx.doc.activeElement,ctx.doc.querySelector('.tks-columns-button'));
  open(ctx).querySelector('[data-action="show-all"]').click();
  assert.deepEqual(state(ctx).columns.map(c=>c.hidden),[false,false,false]);
});

test('same table can switch sheets and restore width and visibility per stable column key', t => {
  const ctx=setup(t); assert.ok(ctx.api); ctx.api.enhance(ctx.table,{key:'sheet-a'});
  toggle(ctx,'name');
  ctx.table.querySelector('.tks-column-resizer').dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  ctx.api.enhance(ctx.table,{key:'sheet-b'});
  assert.deepEqual(state(ctx).columns.map(c=>c.hidden),[false,false,false]);
  assert.equal(state(ctx).columns[0].width,130);
  ctx.api.enhance(ctx.table,{key:'sheet-a'});
  assert.deepEqual(state(ctx).columns.map(c=>c.hidden),[false,true,false]);
  assert.equal(state(ctx).columns[0].width,140);
});

test('fresh page starts from defaults regardless of old persisted column settings', t => {
  const ctx=setup(t); assert.ok(ctx.api); ctx.window.localStorage.setItem('tks-lifecycle-hidden-columns','["name"]');
  ctx.api.enhance(ctx.table); toggle(ctx,'name');
  const fresh=setup(t); fresh.api.enhance(fresh.table);
  assert.deepEqual(state(fresh).columns.map(c=>c.hidden),[false,false,false]);
  assert.equal(ctx.window.localStorage.length,1);
});

test('rowspan and colspan preserve original logical grid when columns are hidden', t => {
  const ctx=setup(t,'<div><table id="grouped"><thead><tr><th rowspan="2" data-column-key="name">Tên</th><th colspan="2">Số liệu</th></tr><tr><th data-column-key="hn">HN</th><th data-column-key="sg">SG</th></tr></thead><tbody><tr><td rowspan="2">A</td><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody></table></div>');
  assert.ok(ctx.api); ctx.api.enhance(ctx.table); toggle(ctx,'hn');
  assert.equal(ctx.table.tHead.rows[0].cells[1].colSpan,1);
  assert.equal(ctx.table.tBodies[0].rows[1].cells[0].classList.contains('tks-column-hidden'),true);
  assert.equal(ctx.table.tBodies[0].rows[1].cells[1].classList.contains('tks-column-hidden'),false);
  toggle(ctx,'hn'); assert.equal(ctx.table.tHead.rows[0].cells[1].colSpan,2);
});

test('dynamically added tables and replaced body rows are enhanced automatically', async t => {
  const ctx=setup(t,'<div id="host"></div>'); assert.ok(ctx.api);
  ctx.doc.getElementById('host').innerHTML=fixture; ctx.table=ctx.doc.querySelector('table');
  await new Promise(r=>ctx.window.setTimeout(r,60));
  assert.equal(ctx.doc.querySelectorAll('.tks-columns-button').length,1);
  toggle(ctx,'name'); ctx.table.tBodies[0].innerHTML='<tr><td>New</td><td>Full name</td><td>2</td></tr>';
  await new Promise(r=>ctx.window.setTimeout(r,60));
  assert.equal(ctx.table.tBodies[0].rows[0].cells[1].classList.contains('tks-column-hidden'),true);
});

test('replacing the table in a retained toolbar binds the picker to the new schema', t => {
  const ctx=setup(t); assert.ok(ctx.api); ctx.api.enhance(ctx.table);
  const wrapper=ctx.table.parentElement;
  wrapper.innerHTML='<table id="orders"><thead><tr><th data-column-key="code">Mã hàng</th><th data-column-key="name">Tên hàng</th><th data-column-key="qty">Số lượng</th><th data-column-key="notes">Ghi chú</th></tr></thead><tbody><tr><td>A</td><td>B</td><td>1</td><td>New</td></tr></tbody></table>';
  ctx.table=wrapper.querySelector('table');ctx.api.enhance(ctx.table);
  const picker=open(ctx);
  assert.equal(picker.querySelectorAll('input[data-column-key]').length,4);
  const input=picker.querySelector('[data-column-key="notes"]');input.checked=false;input.dispatchEvent(new ctx.window.Event('change',{bubbles:true}));
  assert.equal(ctx.table.tHead.rows[0].cells[3].classList.contains('tks-column-hidden'),true);
});
