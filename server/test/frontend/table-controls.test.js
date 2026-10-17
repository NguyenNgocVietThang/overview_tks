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

test('dropdown columns keep enough room for every option on resize and after row replacement', t => {
  const ctx=setup(t);
  ctx.window.HTMLCanvasElement.prototype.getContext = () => ({ measureText: text => ({ width: text.length * 8 }) });
  const cell=ctx.table.tBodies[0].rows[0].cells[1];
  cell.style.padding='0 16px';
  cell.innerHTML='<select style="padding:0 4px"><option>Ngắn</option><option>Đơn đã gửi kế toán</option></select>';
  ctx.api.enhance(ctx.table);
  const shrink=()=>{
    const handle=ctx.table.querySelectorAll('.tks-column-resizer')[1];
    for(let i=0;i<40;i++) handle.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    return handle;
  };
  let handle=shrink();
  const minimum=state(ctx).columns[1].width;
  assert.ok(minimum >= 'Đơn đã gửi kế toán'.length*8+32+8+24, 'Include longest option, cell padding and native arrow');
  assert.equal(Number(handle.getAttribute('aria-valuemin')),minimum);
  assert.equal(state(ctx).columns[0].width,130,'Neighbouring columns keep their width');
  cell.querySelector('select').innerHTML='<option>Trạng thái có nội dung dài hơn trước</option>';
  ctx.api.refresh(ctx.table);
  assert.ok(state(ctx).columns[1].width>minimum,'New options raise the minimum immediately');
  cell.innerHTML='Văn bản có thể xuống dòng';
  ctx.api.refresh(ctx.table); handle=shrink();
  assert.equal(state(ctx).columns[1].width,64,'Text-only columns can still shrink');
});

test('declared picker is reused and direct panel export joins one top-right action group', t => {
  const ctx=setup(t, '<section class="panel"><div class="panel-head"><h2>Products</h2><button class="export-button" id="export">Xuất Excel</button><div class="table-search-tools">Search</div></div>'+fixture+'</section>');
  ctx.api.enhance(ctx.table); ctx.api.refresh(ctx.table);
  const actions=ctx.doc.querySelector('.panel-head-actions');
  assert.ok(actions,'Actions must be in the frame header, not a separate row below it');
  assert.equal(ctx.doc.getElementById('export').parentElement,actions);
  assert.equal(actions.querySelectorAll('.tks-columns-button').length,1);
  assert.equal(ctx.doc.querySelectorAll('.tks-table-tools').length,0);
  assert.equal(actions.lastElementChild.id,'export','Export belongs at the right edge');
});

test('static table binding prevents a second generated picker before application initialization', t => {
  const ctx=setup(t, '<div class="tks-table-tools"><button id="columns">Cột hiển thị</button><button id="export">Xuất Excel</button></div>'+fixture.replace('id="orders"','id="orders" data-columns-button="columns"'));
  ctx.api.enhance(ctx.table); ctx.api.refresh(ctx.table);
  assert.equal(ctx.doc.querySelectorAll('.tks-columns-button').length,1);
  assert.equal(ctx.doc.querySelector('.tks-columns-button').id,'columns');
  ctx.doc.getElementById('columns').click();
  assert.ok(!ctx.doc.querySelector('.tks-columns-picker').hidden);
});

test('formatted cell markup stays compact while actual multiline data keeps its newlines', t => {
  const ctx=setup(t, `<table><thead><tr><th>Name</th><th>Status</th><th>Notes</th></tr></thead><tbody><tr>
    <td>
      <div class="user-cell">
        <div class="user-avatar">A</div>
        <div>
          <div class="user-name">An</div>
          <div class="user-username">@an</div>
        </div>
      </div>
    </td>
    <td>
      <select><option>Chưa duyệt</option></select>
      <br><span>Đúng hạn</span>
    </td>
    <td>Dòng một\nDòng hai<br><span class="pill">Nhãn một\nNhãn hai</span><textarea>Dòng nhập một\nDòng nhập hai</textarea></td>
  </tr></tbody></table>`);
  const style=ctx.doc.createElement('style');
  style.textContent=fs.readFileSync(path.join(__dirname,'../../public/shared/table-controls.css'),'utf8');
  ctx.doc.head.appendChild(style);
  const originalText=ctx.table.tBodies[0].textContent;
  ctx.api.enhance(ctx.table);
  assert.equal(ctx.window.getComputedStyle(ctx.table.tBodies[0].rows[0].cells[0]).whiteSpace,'normal');
  assert.equal(ctx.window.getComputedStyle(ctx.doc.querySelector('.user-cell')).whiteSpace,'');
  assert.equal(ctx.window.getComputedStyle(ctx.table.tBodies[0].rows[0].cells[1]).whiteSpace,'normal');
  assert.equal(ctx.table.tBodies[0].textContent,originalText,'No data or markup whitespace is removed');
  const lines=ctx.table.querySelectorAll('.tks-cell-text');
  assert.deepEqual([...lines].map(el=>el.textContent),['Dòng một\nDòng hai','Nhãn một\nNhãn hai']);
  assert.ok([...lines].every(el=>ctx.window.getComputedStyle(el).whiteSpace==='pre-wrap'));
  assert.equal(ctx.doc.querySelector('textarea').value,'Dòng nhập một\nDòng nhập hai');
  ctx.api.refresh(ctx.table); ctx.api.refresh(ctx.table);
  assert.equal(ctx.table.querySelectorAll('.tks-cell-text').length,2,'Refresh never nests multiline wrappers');
});

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

// ---------- Bang trong hop chi tiet (.dp-table): sort tai cho + nut o dau khoi ----------
const dialogFixture = '<div class="dp-section"><div class="dp-section-head"><h3 class="dp-section-title">Hàng hóa</h3><span class="dp-section-note">3 dòng</span></div>' +
  '<div class="dp-table-wrap"><table class="dp-table" data-table-key="detail-lines"><thead><tr><th>Mã hàng</th><th class="num">Thành tiền</th><th>Ngày</th><th class="num" data-no-sort>Ghi chú</th></tr></thead><tbody>' +
  '<tr><td>B2</td><td class="num">1,200,000₫</td><td>30/09/2026</td><td class="num">x</td></tr>' +
  '<tr><td>A1</td><td class="num">95,000₫</td><td>01/10/2026</td><td class="num">y</td></tr>' +
  '<tr><td>C3</td><td class="num">—</td><td>—</td><td class="num">z</td></tr>' +
  '<tr><td>D4</td><td class="num">12.5%</td><td>05/01/2027</td><td class="num">w</td></tr>' +
  '</tbody><tfoot><tr><td>Cộng</td><td class="num">1,307,500₫</td><td></td><td></td></tr></tfoot></table></div></div>';
const colOf = (ctx, index) => [...ctx.table.tBodies[0].rows].map(row => row.cells[index].textContent);
const sortButton = (ctx, index) => ctx.table.tHead.rows[0].cells[index].querySelector('.sort-button');

test('dialog table: header sort cycles asc → desc → original, ▲▼ / ▼ / ▲ glyphs and aria-sort', t => {
  const ctx=setup(t,dialogFixture); assert.ok(ctx.api); ctx.api.enhance(ctx.table);
  const th=ctx.table.tHead.rows[0].cells[0], mark=()=>th.querySelector('.sort-indicator').textContent;
  assert.equal(mark(),'▲▼'); assert.equal(th.getAttribute('aria-sort'),'none');
  assert.ok(th.querySelector(':scope > .sort-button > .sort-label'),'label wrapped so the glyph is a separate flex column');
  assert.equal(ctx.table.tHead.rows[0].cells[3].querySelector('.sort-button'),null,'data-no-sort opts a column out');
  sortButton(ctx,0).click();
  assert.deepEqual(colOf(ctx,0),['A1','B2','C3','D4']); assert.equal(mark(),'▼'); assert.equal(th.getAttribute('aria-sort'),'ascending');
  assert.deepEqual(state(ctx).sort,{key:'Mã hàng',direction:'asc'});
  sortButton(ctx,0).click();
  assert.deepEqual(colOf(ctx,0),['D4','C3','B2','A1']); assert.equal(mark(),'▲'); assert.equal(th.getAttribute('aria-sort'),'descending');
  sortButton(ctx,0).click();
  assert.deepEqual(colOf(ctx,0),['B2','A1','C3','D4']); assert.equal(mark(),'▲▼'); assert.equal(state(ctx).sort,null);
  assert.match(ctx.table.tFoot.textContent,/Cộng/,'footer total stays out of the sort');
});

test('dialog table: money, percent and dd/MM/yyyy sort by value; empty cells stay last in both directions', t => {
  const ctx=setup(t,dialogFixture); ctx.api.enhance(ctx.table);
  sortButton(ctx,1).click();                         // 12.5% < 95,000 < 1,200,000, — last
  assert.deepEqual(colOf(ctx,0),['D4','A1','B2','C3']);
  sortButton(ctx,1).click();
  assert.deepEqual(colOf(ctx,0),['B2','A1','D4','C3']);
  sortButton(ctx,2).click();                         // 30/09/2026 < 01/10/2026 < 05/01/2027 (not string order)
  assert.deepEqual(colOf(ctx,0),['B2','A1','D4','C3']);
  sortButton(ctx,2).click();
  assert.deepEqual(colOf(ctx,0),['D4','A1','B2','C3']);
});

test('dialog table: Cột hiển thị button sits in the section head; re-rendered rows are re-sorted; no redraw loop', async t => {
  const ctx=setup(t,dialogFixture); ctx.api.enhance(ctx.table);
  const head=ctx.doc.querySelector('.dp-section-head');
  assert.equal(head.querySelectorAll('.tks-columns-button').length,1);
  assert.equal(head.lastElementChild.classList.contains('tks-columns-button'),true,'button joins the note on the right');
  assert.equal(ctx.doc.querySelectorAll('.tks-table-tools').length,0,'no extra tools row above the table');
  ctx.api.refresh(ctx.table); ctx.api.refresh(ctx.table);
  assert.equal(head.querySelectorAll('.tks-columns-button').length,1);
  sortButton(ctx,0).click();
  ctx.table.tBodies[0].innerHTML='<tr><td>Z</td><td class="num">1</td><td></td><td></td></tr><tr><td>M</td><td class="num">2</td><td></td><td></td></tr>';
  await new Promise(r=>ctx.window.setTimeout(r,60));
  assert.deepEqual(colOf(ctx,0),['M','Z'],'rows redrawn by the page are sorted again');
  // MutationObserver must settle: a second wait leaves the DOM untouched
  const snapshot=ctx.table.outerHTML; await new Promise(r=>ctx.window.setTimeout(r,60));
  assert.equal(ctx.table.outerHTML,snapshot);
});

test('dialog table: data-table-sort=off and data-table-controls=off opt out', t => {
  const noSort=setup(t,dialogFixture.replace('data-table-key="detail-lines"','data-table-key="detail-lines" data-table-sort="off"')); noSort.api.enhance(noSort.table);
  assert.equal(noSort.table.querySelector('.sort-button'),null);
  assert.equal(noSort.table.querySelectorAll('th > .tks-column-resizer').length,4,'resize + column picker remain');
  const off=setup(t,dialogFixture.replace('data-table-key="detail-lines"','data-table-controls="off"')); off.api.enhance(off.table);
  assert.equal(off.table.querySelector('.sort-button, .tks-column-resizer'),null);
  assert.equal(off.doc.querySelector('.tks-columns-button'),null);
});

test('pages with their own sorting keep their markup: a header that already has a .sort-button is left alone', t => {
  const ctx=setup(t,'<table class="dp-table"><thead><tr><th class="sortable" aria-sort="none"><button class="sort-button"><span class="sort-label">Mã</span><span class="sort-indicator">▲▼</span></button></th><th>Tên</th></tr></thead><tbody><tr><td>b</td><td>x</td></tr><tr><td>a</td><td>y</td></tr></tbody></table>');
  ctx.api.enhance(ctx.table);
  assert.equal(ctx.table.tHead.rows[0].cells[0].querySelectorAll('.sort-button').length,1);
  assert.equal(ctx.table.tHead.rows[0].cells[0].querySelector('[data-tks-sort]'),null);
  assert.equal(ctx.table.tHead.rows[0].cells[1].querySelectorAll('.sort-button').length,1);
});
