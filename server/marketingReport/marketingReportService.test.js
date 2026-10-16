'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketingReportService } = require('./marketingReportService');
const monthValues = total => [['SALE'], ['','','','','','','',total,'','','','','Page','Số khách chốt'], ['An','KH1','0912345678','Hữu Nghị','Chưa chốt','','',20,'','','','','Hữu Nghị',7]];
const ranking = [['NHÂN VIÊN','SỐ ĐƠN THÁNG 10','','','','','PAGE'], [], ['An',7,'','','','','Hữu Nghị']];
function setup() {
  let now=Date.UTC(2026,9,8), total=999, reads=0;
  const client={listSheetTitles:async()=>['BC Tháng 10','BẢNG XẾP HẠNG'],getValues:async name=>{reads++;return name==='BẢNG XẾP HẠNG'?ranking:monthValues(total);}};
  const denied={listSheetTitles:async()=>{throw new Error('secret upstream credential');}};
  const svc=createMarketingReportService({clients:{report:client,phones:denied,ads:denied},now:()=>now});
  return {svc,reads:()=>reads,advance:()=>{now+=300001;total=1000;}};
}
test('metadata allows sources to fail independently and month is Vietnam current month',async()=>{
  const {svc}=setup();const m=await svc.metadata(); assert.equal(m.currentMonth,10);assert.deepEqual(m.months.monthly,[10]);assert.ok(m.sources.phones.error);assert.ok(!JSON.stringify(m).includes('secret'));
});
test('source totals survive filters; cached reads coalesce and pin detail snapshot',async()=>{
 const f=setup();const [a,b]=await Promise.all([f.svc.report('monthly',{month:'10'}),f.svc.report('monthly',{month:'10'})]);
 assert.equal(a.kpis.find(k=>k.format==='money').value,999); assert.equal(f.reads(),2);
 const page=a.summaryRows.find(r=>r.kind==='page'); f.advance(); const newer=await f.svc.report('monthly',{month:'10'}); assert.notEqual(newer.snapshotId,a.snapshotId);
 const detail=await f.svc.detail({kind:'monthly',month:'10',key:page.key,snapshotId:a.snapshotId}); assert.equal(detail.groups[0].rows.length,1);assert.ok(detail.warnings.some(w=>w.includes('chênh lệch')));
 assert.equal(detail.snapshotId,a.snapshotId);assert.equal(b.kpis.find(k=>k.format==='money').value,999);
});
test('missing month is empty, malformed month and unknown detail are rejected',async()=>{
 const {svc}=setup();const empty=await svc.report('monthly',{month:'11'}); assert.equal(empty.rows.length,0);
 await assert.rejects(svc.report('monthly',{month:'99'}),e=>e.statusCode===400);
 await assert.rejects(svc.detail({kind:'monthly',month:'10',key:'unknown'}),e=>e.statusCode===404);
});

test('status filters only monthly details; cache reports actual source-read time',async()=>{
 const {svc}=setup();const base=await svc.report('monthly',{month:'10'});
 const filtered=await svc.report('monthly',{month:'10',status:'Chưa chốt'});
 assert.equal(filtered.summaryRows.length,base.summaryRows.length);
 assert.equal(filtered.kpis[1].value,7);
 assert.equal(filtered.computedAt,base.computedAt);
});

test('costs without monthly totals sum valid daily cells and disclose missing values',async()=>{
 const ads={listSheetTitles:async()=>['Chi phí Bắc Lãm'],getValues:async()=>[
  ['Ngày','Chi phí','Chi phí +VAT','SL mess','Chi phí /mess','SL SĐT','Chi phí /SĐT'],
  ['01/10',10,12,2,6,1,12],['02/10','#N/A','#N/A',3,'#N/A',2,'#N/A']
 ]};
 const svc=createMarketingReportService({clients:{ads},now:()=>Date.UTC(2026,9,8)});
 const data=await svc.report('costs',{month:'10'});
 assert.equal(data.summaryRows[0].totalCost,12);
 assert.equal(data.summaryRows[0].messages,5);
 assert.equal(data.rows[1].totalCost,null);
 assert.ok(data.warnings.some(w=>w.includes('hợp lệ')));
});

test('employee/page check detail uses source row and phone aliases within selected page/month',async()=>{
 const report={listSheetTitles:async()=>['CHECK Tỷ lệ nhận số T10','BC Tháng 10'],getValues:async title=>title.startsWith('BC')?monthValues(999):[
  ['BÁO CÁO','SĐT LẦN ĐẦU','SĐT CHÀO LẠI','QUY ĐỔI','PAGE','Tên NV','Khách chốt','Tỷ lệ chốt'],
  ['Alias',1,0,1,'Hữu Nghị','An',1,0.1],['Alias',8,0,8,'Bắc Lãm','An',0,0,'','','','','','','','','An',9,0,9,1,0.7]
 ]};
 const phones={listSheetTitles:async()=>['HỮU NGHỊ CHUẨN','BẮC LÃM CHUẨN'],getValues:async()=>[
  ['Số điện thoại','Nhân viên lần đầu','Nhân viên hiện tại','Tính chào lại','THỜI GIAN','THỜI GIAN','Tính chào lại'],
  ['0912345678','Alias','Alias','','01/10','01/10',''],['0922222222','Alias','Alias','','01/09','01/09','']
 ]};
 const svc=createMarketingReportService({clients:{report,phones},now:()=>Date.UTC(2026,9,8)});
 const data=await svc.report('receipt-check',{month:'10'});
 const detail=await svc.detail({kind:'receipt-check',key:data.rows[0].key,snapshotId:data.snapshotId});
 assert.equal(detail.groups[0].rows.length,1);
 assert.equal(detail.groups[0].rows[0].page,'Hữu Nghị');
 assert.equal(detail.groups[2].rows.length,1);
 assert.equal(detail.kpis[4].value,0.1);
});

function kiotSetup(writer) {
  const client={listSheetTitles:async()=>['BC Tháng 10'],getValues:async()=>[['SALE'],['','','','','','','',999],
    ['An MKT','KH A Khiêm','0912345678','Hữu Nghị','Đã chốt đơn','Mới','01/10/2026',5],
    ['Bình','KH Không Có','0900000000','Hữu Nghị','Đã chốt đơn','Mới','02/10/2026',6],
    ['Bình','KH Chưa Mua','0911111111','Hữu Nghị','Chưa chốt','Mới','',7]]};
  const revenue=async month=>({available:month===10,revenueOf:name=>({'kh a khiêm':1200000,'kh chưa mua':0})[String(name).toLowerCase()]??null});
  return createMarketingReportService({clients:{report:client},now:()=>Date.UTC(2026,9,8),revenue,writer});
}

test('doanh số lấy từ KiotViet theo tên khách; không khớp là — và được báo',async()=>{
  const data=await kiotSetup().report('monthly',{month:'10'});
  assert.deepEqual(data.rows.map(r=>r.revenue),[1200000,null,0]);
  const total=data.kpis.find(k=>k.format==='money');
  assert.equal(total.value,1200000);assert.ok(total.label.includes('KiotViet'));
  assert.ok(data.warnings.some(w=>w.includes('1 dòng')&&w.includes('KiotViet')));
});

test('tháng chưa có dữ liệu KiotViet: doanh số — kèm cảnh báo',async()=>{
  const svc=createMarketingReportService({clients:{report:{listSheetTitles:async()=>['BC Tháng 2'],getValues:async()=>[['SALE'],[],['An','KH A','0912345678','Hữu Nghị','','','',5]]}},now:()=>Date.UTC(2026,9,8),revenue:async()=>({available:false,revenueOf:()=>null})});
  const data=await svc.report('monthly',{month:'2'});
  assert.equal(data.rows[0].revenue,null);assert.ok(data.warnings.some(w=>w.includes('Chưa có dữ liệu doanh số KiotViet')));
});

test('ghi ngược Khách mới/Ghi chú: kiểm tra dòng, ghi đúng ô, từ chối khi dòng đã đổi',async()=>{
  const writes=[];let live=['An MKT','KH A Khiêm','0912345678'];
  const writer={readRow:async()=>live,writeCell:async(...a)=>{writes.push(a);}};
  const svc=kiotSetup(writer);
  const data=await svc.report('monthly',{month:'10'});
  const row=data.rows[0];
  const base={snapshotId:data.snapshotId,key:row.key};
  assert.deepEqual(await svc.updateRow({...base,field:'note',value:'  gọi lại  '}),{ok:true,field:'note',value:'gọi lại'});
  assert.deepEqual(writes,[['BC Tháng 10',3,'note','gọi lại']]);
  await assert.rejects(svc.updateRow({...base,field:'revenue',value:'1'}),e=>e.statusCode===400);
  await assert.rejects(svc.updateRow({...base,field:'note',value:'x'.repeat(501)}),e=>e.statusCode===400);
  await assert.rejects(svc.updateRow({snapshotId:'nope',key:row.key,field:'note',value:'x'}),e=>e.code==='MARKETING_SNAPSHOT_EXPIRED');
  await assert.rejects(svc.updateRow({...base,key:JSON.stringify(['BẢNG KHÁC',3,'']),field:'note',value:'x'}),e=>e.statusCode===404);
  live=['Ai Đó','KH Khác','0999'];
  await assert.rejects(svc.updateRow({...base,field:'note',value:'x'}),e=>e.code==='MARKETING_ROW_CHANGED'&&e.statusCode===409);
  assert.equal(writes.length,1);
});

test('không có writer thì không ghi được',async()=>{
  const svc=setup().svc;
  await assert.rejects(svc.updateRow({field:'note',value:'x'}),e=>e.code==='MARKETING_WRITE_UNAVAILABLE');
});
