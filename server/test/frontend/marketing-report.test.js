const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname,'../../public/marketing-report.js'),'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function page(customFetch) {
  const dom = new JSDOM('<div id="view-marketing" class="active"><button id="marketingRefresh"></button><div id="marketingSourceStatus"></div><div id="marketingSections"></div></div><dialog id="marketingDetailDialog"><h2 id="marketingDetailTitle"></h2><p id="marketingDetailSubtitle"></p><p id="marketingDetailStatus"></p><button id="marketingDetailRefresh"></button><button id="marketingDetailClose"></button><div id="marketingDetailBody"></div></dialog>',{runScripts:'outside-only',url:'https://example.test/reports/#marketing',pretendToBeVisual:true});
  const window = dom.window, urls = [];
  window.TKSNav = {can:() => true};
  window.matchMedia = () => ({matches:true});
  window.setInterval = () => 0;
  window.HTMLDialogElement.prototype.showModal = function() { this.open=true; };
  window.HTMLDialogElement.prototype.close = function() { this.open=false; this.dispatchEvent(new window.Event('close')); };
  window.fetch = async url => {
    urls.push(url);
    if(customFetch) { const custom = await customFetch(url); if(custom) return custom; }
    const endpoint = url.split('/').pop().split('?')[0];
    const json = endpoint==='metadata' ? {currentMonth:10,months:{monthly:[9,10],check:[10],costs:[10]}} : endpoint==='detail' ? {title:'Chi tiết page',snapshotId:'snapshot-new',groups:[],kpis:[],computedAt:'2026-10-08T10:00:00Z'} : {snapshotId:'snapshot-1',computedAt:'2026-10-08T09:00:00Z',kpis:[],charts:[],warnings:[],filters:{pages:['Hữu Nghị']},summaryRows:[{key:'page:hn',label:'Hữu Nghị',employee:'Tâm MKT',count:101}],rows:Array.from({length:101},(_,i) => ({key:'phone:'+i,phone:'0'+i,page:'Hữu Nghị',sale:i===100?'Đặng An':'Sale '+i,revenue:101-i}))};
    return {ok:true,status:200,json:async()=>json};
  };
  window.eval(source);
  return {dom,window,doc:window.document,urls};
}
test('Marketing tables search without accents, sort before 100-row pagination and offer export instead of column toggles',async()=>{
  const p=page(); await p.window.TKSMarketing.load();
  const host=p.doc.getElementById('marketing-monthly-rows');
  assert.equal(host.querySelectorAll('tbody tr').length,100);
  host.querySelector('[data-sort="revenue"]').click();
  assert.match(host.querySelector('tbody tr').textContent,/Đặng An/);
  const search=host.querySelector('input[type="search"]'); search.value='dang an'; search.dispatchEvent(new p.window.Event('input'));
  assert.equal(host.querySelectorAll('tbody tr').length,1);
  assert.equal(host.querySelector('[data-column]'),null);
  assert.equal(p.doc.querySelector('.marketing-columns, .marketing-toc'),null);
  let opened;
  p.window.exportFetch=(url)=>url; p.window.startExportDialog=async(payload,source)=>{opened={payload,source};};
  host.querySelector('.export-button').click();
  const query=new URLSearchParams(opened.payload.query);
  assert.deepEqual([query.get('kind'),query.get('table'),query.get('q'),query.get('month')],['monthly','rows','dang an','10']);
  const fileUrl=opened.source.file({...opened.payload,columns:{rows:['sale','revenue']},format:'html'},{});
  assert.match(fileUrl,/^\/api\/marketing-report\/export\?/);
  assert.equal(new URL(fileUrl,'https://example.test').searchParams.get('columns'),'sale,revenue');
  p.dom.window.close();
});
test('Keyboard detail pins snapshot, refresh repins and close returns focus',async()=>{
  const p=page(); await p.window.TKSMarketing.load();
  const row=p.doc.querySelector('#marketing-phones-rows tr[data-detail-key]');
  row.dispatchEvent(new p.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await settle();
  let detail=p.urls.filter(url=>url.includes('/detail?')).pop();
  assert.equal(new URL(detail,'https://example.test').searchParams.get('snapshotId'),'snapshot-1');
  assert.equal(p.doc.getElementById('marketingDetailDialog').open,true);
  p.doc.getElementById('marketingDetailRefresh').click(); await settle();
  detail=p.urls.filter(url=>url.includes('/detail?')).pop();
  const params=new URL(detail,'https://example.test').searchParams;
  assert.equal(params.get('refresh'),'1'); assert.equal(params.has('snapshotId'),false);
  p.doc.getElementById('marketingDetailClose').click(); assert.equal(p.doc.activeElement,row);
  p.dom.window.close();
});
test('Source failure keeps other reports available; closing discards pending detail',async()=>{
  let resolveDetail;
  const p=page(async url=>{
    if(url.includes('/costs?')) return {ok:false,status:503,json:async()=>({error:'Nguồn chi phí chưa sẵn sàng'})};
    if(url.includes('/detail?')) return new Promise(resolve=>{resolveDetail=resolve;});
  });
  await p.window.TKSMarketing.load();
  assert.match(p.doc.getElementById('marketing-costs-status').textContent,/Nguồn chi phí/);
  assert.ok(p.doc.querySelector('#marketing-phones-rows tbody tr'));
  p.doc.querySelector('#marketing-phones-rows tr[data-detail-key]').click(); await settle();
  p.doc.getElementById('marketingDetailClose').click();
  resolveDetail({ok:true,status:200,json:async()=>({title:'Phản hồi cũ',groups:[]})}); await settle();
  assert.notEqual(p.doc.getElementById('marketingDetailTitle').textContent,'Phản hồi cũ');
  p.dom.window.close();
});
test('Changing month discards an older response that arrives after the current selection',async()=>{
  let resolveOld;
  const p=page(async url=>{
    if(url.includes('/monthly?month=9')) return new Promise(resolve=>{resolveOld=resolve;});
  });
  await p.window.TKSMarketing.load();
  const select=p.doc.getElementById('marketing-monthly-month');
  select.value='9'; select.dispatchEvent(new p.window.Event('change')); await settle();
  select.value='10'; select.dispatchEvent(new p.window.Event('change')); await settle();
  resolveOld({ok:true,status:200,json:async()=>({computedAt:'2026-09-01',snapshotId:'old',rows:[{sale:'Phản hồi tháng cũ'}],summaryRows:[],kpis:[],charts:[],warnings:[]})}); await settle();
  assert.doesNotMatch(p.doc.getElementById('marketing-monthly-rows').textContent,/Phản hồi tháng cũ/);
  assert.equal(p.doc.getElementById('marketing-monthly-month').value,'10');
  p.dom.window.close();
});
test('Source ratios display as percentages and fractional conversion counts stay precise',async()=>{
  const p=page(async url=>{
    if(url.includes('/receipt-check?')) return {ok:true,status:200,json:async()=>({snapshotId:'ratio',computedAt:'2026-10-08',rows:[{key:'check:1',name:'Sale',equivalent:147.4,rate:.040705}],summaryRows:[],kpis:[{label:'Tỷ lệ',value:.040705,format:'percent'},{label:'Quy đổi',value:147.4,format:'number'}],charts:[],warnings:[],filters:{}})};
  });
  await p.window.TKSMarketing.load();
  const rows=p.doc.getElementById('marketing-receipt-check-rows').textContent;
  assert.match(rows,/4,07%/); assert.match(rows,/147,4/);
  const cards=p.doc.getElementById('marketing-receipt-check-kpis').textContent;
  assert.match(cards,/4,07%/); assert.match(cards,/147,4/);
  p.dom.window.close();
});
test('Filter/status IDs are unique and KPI cards occupy real report-grid columns',async()=>{
  const p=page(async url=>{
    if(url.includes('/monthly?')) return {ok:true,status:200,json:async()=>({snapshotId:'unique',computedAt:'2026-10-08',rows:[],summaryRows:[],kpis:[{label:'Doanh số',value:28000751,format:'money'},{label:'Số khách',value:100,format:'number'},{label:'Page',value:6,format:'number'}],charts:[],warnings:[],filters:{statuses:['Đã chốt đơn']}})};
  });
  await p.window.TKSMarketing.load();
  const ids=Array.from(p.doc.querySelectorAll('[id]'),element=>element.id);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(p.doc.getElementById('marketing-monthly-filter-status').options.length,2);
  assert.match(p.doc.getElementById('marketing-monthly-status').textContent,/Đọc nguồn lúc/);
  assert.ok(Array.from(p.doc.querySelectorAll('#marketing-monthly-kpis .kpi-card')).every(card=>card.classList.contains('col-4')));
  p.dom.window.close();
});
test('Receipt-check employee/page detail rows open the pinned source detail',async()=>{
  const p=page(async url=>{
    if(url.includes('/receipt-check?')) return {ok:true,status:200,json:async()=>({snapshotId:'check-snapshot',computedAt:'2026-10-08',rows:[{key:'check:employee-page',name:'Mai',page:'Hữu Nghị',first:20}],summaryRows:[],kpis:[],charts:[],warnings:[],filters:{}})};
  });
  await p.window.TKSMarketing.load();
  p.doc.querySelector('#marketing-receipt-check-rows tr[data-detail-key]').dispatchEvent(new p.window.KeyboardEvent('keydown',{key:' ',bubbles:true})); await settle();
  const params=new URL(p.urls.filter(url=>url.includes('/detail?')).pop(),'https://example.test').searchParams;
  assert.equal(params.get('kind'),'receipt-check'); assert.equal(params.get('key'),'check:employee-page'); assert.equal(params.get('snapshotId'),'check-snapshot');
  p.dom.window.close();
});
test('Phone summary detail drills into a record in the same dialog and returns focus to the page',async()=>{
  const p=page(async url=>{
    if(url.includes('/detail?')) {
      const params=new URL(url,'https://example.test').searchParams;
      const rows=params.get('key')==='page:hn' ? [{key:'phone:1',phone:'09001',page:'Hữu Nghị'},{key:'phone:2',phone:'09002',page:'Hữu Nghị'}] : [{key:'phone:1',phone:'09001',page:'Hữu Nghị',firstEmployee:'Mai'}];
      return {ok:true,status:200,json:async()=>({snapshotId:'phone-pinned',title:'SĐT',computedAt:'2026-10-08',groups:[{kind:'phones',title:'Danh sách SĐT',rows}],kpis:[],warnings:[]})};
    }
  });
  await p.window.TKSMarketing.load();
  const original=p.doc.querySelector('#marketing-phones-rows tr[data-detail-key]'); original.click(); await settle();
  p.doc.querySelector('#marketingDetailBody tr[data-detail-key]').dispatchEvent(new p.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})); await settle();
  const params=new URL(p.urls.filter(url=>url.includes('/detail?')).pop(),'https://example.test').searchParams;
  assert.equal(params.get('key'),'phone:1'); assert.equal(params.get('snapshotId'),'phone-pinned');
  assert.equal(p.doc.querySelectorAll('dialog[open]').length,1);
  assert.match(p.doc.getElementById('marketingDetailBody').textContent,/Mai/);
  p.doc.getElementById('marketingDetailClose').click(); assert.equal(p.doc.activeElement,original);
  p.dom.window.close();
});

const monthlyJson = rows => ({ok:true,status:200,json:async()=>({snapshotId:'s1',computedAt:'2026-10-08T09:00:00Z',kpis:[],charts:[],warnings:[],filters:{},summaryRows:[],rows})});

test('tên sale đuôi MKT được tô vàng, tên khác thì không',async()=>{
  const p=page(url=>url.includes('/monthly?')?monthlyJson([
    {key:'a',sale:'Hoàng MKT',customer:'KH A',phone:'0912345678',newCustomer:'',note:''},
    {key:'b',sale:'Uyên SG',customer:'KH B',phone:'0900000000',newCustomer:'',note:''}]):null);
  p.window.TKSNav={can:name=>name!=='reports.marketing.edit'};
  await p.window.TKSMarketing.load();
  const cells=[...p.doc.querySelectorAll('#marketing-monthly-rows tbody tr')].map(tr=>tr.querySelector('td').innerHTML);
  assert.match(cells[0],/<span class="mkt-name">Hoàng MKT<\/span>/);
  assert.doesNotMatch(cells[1],/mkt-name/);
  assert.equal(p.doc.querySelector('#marketing-monthly-rows [data-edit]'),null,'không có quyền sửa thì không có ô nhập');
  p.dom.window.close();
});

test('sửa Ghi chú gửi PUT kèm snapshot, lỗi thì trả lại giá trị cũ',async()=>{
  const puts=[];let fail=false;
  const p=page(url=>url.includes('/monthly?')?monthlyJson([{key:'a',sale:'Hoàng MKT',customer:'KH A',phone:'0912345678',newCustomer:'',note:'cũ'}]):null);
  const base=p.window.fetch;
  p.window.fetch=async(url,init)=>{
    if(String(url).includes('/monthly/row')){puts.push({url,init});return fail?{ok:false,status:409,json:async()=>({error:'Dòng đã đổi'})}:{ok:true,status:200,json:async()=>({ok:true,field:'note',value:JSON.parse(init.body).value})};}
    return base(url,init);
  };
  await p.window.TKSMarketing.load();
  const input=p.doc.querySelector('#marketing-monthly-rows input[data-edit="note"]');
  assert.equal(input.value,'cũ');
  input.value='gọi lại ngày mai';input.dispatchEvent(new p.window.Event('change'));await settle();
  assert.equal(puts[0].init.method,'PUT');
  assert.deepEqual(JSON.parse(puts[0].init.body),{snapshotId:'s1',key:'a',field:'note',value:'gọi lại ngày mai'});
  fail=true;
  input.value='lỗi';input.dispatchEvent(new p.window.Event('change'));await settle();
  assert.equal(input.value,'gọi lại ngày mai');
  assert.match(p.doc.getElementById('marketing-monthly-status').textContent,/Dòng đã đổi/);
  p.dom.window.close();
});
