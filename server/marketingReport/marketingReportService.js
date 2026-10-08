'use strict';
const { randomUUID } = require('node:crypto');
const CONFIG = require('../config');
const { createReadOnlyClient } = require('../sheets/sheetsClient');
const p = require('./marketingParsers');
const TTL = 300000;
const SNAPSHOT_TTL = 30 * 60000;
const PHONE_PAGES = { 'hữu nghị chuẩn':'Hữu Nghị', 'tân thanh chuẩn':'Tân Thanh', 'bắc lãm chuẩn':'Bắc Lãm', 'phú lương chuẩn':'Phú Lương', 'hn-sg chuẩn':'HN-SG', 'dương nội chuẩn':'Dương Nội' };
function fail(statusCode, code, message) { return Object.assign(new Error(message), {statusCode,code}); }
const unique = values => [...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
function sum(rows, field) { return rows.length && rows.every(r=>typeof r[field]==='number') ? rows.reduce((n,r)=>n+r[field],0) : null; }
function sumValid(rows, field) { const valid=rows.filter(r=>typeof r[field]==='number'); return valid.length?valid.reduce((n,r)=>n+r[field],0):null; }
const kpi = (label,value,format='number') => ({label,value,format});
function filters(rows) {
  return { pages:unique(rows.map(r=>r.page)), employees:unique(rows.flatMap(r=>[r.employee,r.sale,r.firstEmployee,r.currentEmployee,r.repeatEmployee])), statuses:unique(rows.map(r=>r.status)), dataSources:unique(rows.map(r=>r.dataSource)) };
}
function matches(row, query) {
  if (query.page && p.norm(row.page)!==p.norm(query.page)) return false;
  if (query.employee && ![row.employee,row.sale,row.firstEmployee,row.currentEmployee,row.repeatEmployee].some(v=>p.norm(v)===p.norm(query.employee))) return false;
  if (query.status && row.status!==query.status) return false;
  if (query.dataSource && row.dataSource!==query.dataSource) return false;
  return true;
}
function sourceWarning(rows) {
  return rows.some(r=>Object.values(r).some(v=>v===null)) ? ['Một số ô thiếu hoặc lỗi trong nguồn; các giá trị này hiển thị —, không quy về 0.'] : [];
}
function createMarketingReportService({clients, now=Date.now}={}) {
  clients ||= {
    report:createReadOnlyClient(()=>CONFIG.MARKETING_REPORT_SPREADSHEET_ID,'Báo cáo trực page'),
    phones:createReadOnlyClient(()=>CONFIG.MARKETING_PHONES_SPREADSHEET_ID,'Sao lưu SĐT'),
    ads:createReadOnlyClient(()=>CONFIG.MARKETING_ADS_SPREADSHEET_ID,'Chi phí ADS')
  };
  const cache=new Map(), pending=new Map(), snapshots=new Map();
  const sourceTime=(source,title)=>cache.get(`${source}:${title}`)?.at??now();
  function currentMonth() { return +new Intl.DateTimeFormat('en',{timeZone:'Asia/Saigon',month:'numeric'}).format(new Date(now())); }
  function month(query) {
    if (query.month===undefined || query.month==='') return currentMonth();
    if (!/^(?:[1-9]|1[0-2])$/.test(String(query.month))) throw fail(400,'MARKETING_INVALID_MONTH','Tháng phải từ 1 đến 12.');
    return +query.month;
  }
  async function read(source, title) {
    const cacheKey=`${source}:${title || '@titles'}`;
    const old=cache.get(cacheKey);
    if(old && now()-old.at<TTL) return old.data;
    if(pending.has(cacheKey)) return pending.get(cacheKey);
    const promise=(async()=>{
      try {
        const data=title ? await clients[source].getValues(title,{valueRenderOption:source==='phones'?'FORMATTED_VALUE':'UNFORMATTED_VALUE'}) : await clients[source].listSheetTitles();
        cache.set(cacheKey,{data,at:now()}); return data;
      } catch(e) { throw fail(503,'MARKETING_SOURCE_UNAVAILABLE',`Không đọc được nguồn ${source==='report'?'Báo cáo trực page':source==='phones'?'Sao lưu SĐT':'Chi phí ADS'}. Kiểm tra cấu hình và quyền Viewer.`); }
    })().finally(()=>pending.delete(cacheKey));
    pending.set(cacheKey,promise);return promise;
  }
  async function metadata() {
    const sources={}, titles={};
    await Promise.all(Object.keys(clients).map(async source=>{
      try {titles[source]=await read(source);sources[source]={available:true};}
      catch(e){titles[source]=[];sources[source]={available:false,error:e.message,code:e.code};}
    }));
    return { currentMonth:currentMonth(), months:{monthly:titles.report.filter(t=>/^bc tháng /i.test(t)).map(p.monthOfTitle).filter(Boolean).sort((a,b)=>b-a),check:titles.report.filter(t=>/^check tỷ lệ nhận số t/i.test(t)).map(p.monthOfTitle).filter(Boolean).sort((a,b)=>b-a),costs:Array.from({length:12},(_,i)=>i+1).reverse()}, sources };
  }
  async function readMonthly(m) {
    const titles=await read('report');const title=titles.find(t=>/^bc tháng /i.test(t)&&p.monthOfTitle(t)===m);
    if(!title)return {rows:[],pages:[],sales:[],totalRevenue:null,missing:true};
    try {
      const [values,rank]=await Promise.all([read('report',title), titles.includes('BẢNG XẾP HẠNG')?read('report','BẢNG XẾP HẠNG'):[]]);
      return {...p.parseMonthly(values,title),sales:p.parseRanking(rank,m),readAt:Math.min(sourceTime('report',title),titles.includes('BẢNG XẾP HẠNG')?sourceTime('report','BẢNG XẾP HẠNG'):now())};
    }catch(e){if(e.statusCode)throw e;throw fail(503,'MARKETING_HEADERS_MISSING','Nguồn BC tháng không có cấu trúc tiêu đề phù hợp.');}
  }
  async function readPhones() {
    const titles=await read('phones');
    const names=titles.filter(t=>PHONE_PAGES[p.norm(t)]);
    if(!names.length)throw fail(503,'MARKETING_HEADERS_MISSING','Không tìm thấy các tab SĐT CHUẨN.');
    const parts=await Promise.all(names.map(async title=>{
      try{return p.parsePhones(await read('phones',title),title,PHONE_PAGES[p.norm(title)]).rows;}
      catch(e){if(e.statusCode)throw e;throw fail(503,'MARKETING_HEADERS_MISSING',`Tab ${title} thiếu tiêu đề SĐT CHUẨN.`);}
    }));
    return {rows:parts.flat(),readAt:Math.min(...names.map(title=>sourceTime('phones',title))),warnings:names.length<6?['Nguồn SĐT chưa có đủ sáu tab CHUẨN.']:[]};
  }
  async function optional(fn,label,warnings) {try{return await fn();}catch(e){warnings.push(`${label}: ${e.message}`);return null;}}
  async function report(kind,query={}) {
    if(!['monthly','receipt-check','phones','costs'].includes(kind))throw fail(400,'MARKETING_INVALID_KIND','Loại báo cáo không hợp lệ.');
    const m=kind==='phones'?null:month(query), warnings=[];
    if(query.refresh==='1'){
      const sourceNames=kind==='receipt-check'?['report','phones']:[kind==='monthly'?'report':kind==='phones'?'phones':'ads'];
      for(const cacheKey of cache.keys())if(sourceNames.some(s=>cacheKey.startsWith(s+':')))cache.delete(cacheKey);
    }
    let readAt=now();
    let rows=[],summaryRows=[],kpis=[],charts=[],dependencies={},totalRevenue=null;
    if(kind==='monthly') {
      const data=await readMonthly(m);dependencies.monthly=data;rows=data.rows;
      readAt=data.readAt??now();
      summaryRows=[...data.pages,...data.sales].filter(r=>matches(r,{page:query.page,employee:query.employee}));
      totalRevenue=data.totalRevenue;
      if(data.missing)warnings.push(`Chưa có BC tháng ${m} trong workbook.`);
      if(query.status||query.dataSource)warnings.push('Số tổng nguồn theo sale/page không có bộ lọc tình trạng hoặc nguồn data; các bộ lọc này chỉ áp dụng danh sách chi tiết.');
      kpis=[kpi('Doanh số tổng tháng (theo sheet)',totalRevenue,'money'),kpi('Khách chốt theo page (theo sheet)',sum(summaryRows.filter(r=>r.kind==='page'),'closed'))];
      for(const type of ['page','sale']){const list=summaryRows.filter(r=>r.kind===type);charts.push({title:type==='page'?'Khách chốt theo page':'Khách chốt theo sale',labels:list.map(r=>r.kind==='sale'?`${r.label} · ${r.page}`:r.label),values:list.map(r=>r.closed)});}
    } else if(kind==='receipt-check') {
      const titles=await read('report');const title=titles.find(t=>/^check tỷ lệ nhận số t/i.test(t)&&p.monthOfTitle(t)===m);
      let data={rows:[],employees:[]};
      if(title){try{data=p.parseCheck(await read('report',title),title);}catch(e){if(e.statusCode)throw e;throw fail(503,'MARKETING_HEADERS_MISSING','Nguồn Check thiếu tiêu đề phù hợp.');}}
      else warnings.push(`Chưa có Check tỷ lệ nhận số tháng ${m} trong workbook.`);
      dependencies.check=data;
      if(title)readAt=sourceTime('report',title);
      [dependencies.monthly,dependencies.phones]=await Promise.all([optional(()=>readMonthly(m),'Chi tiết BC tháng',warnings),optional(readPhones,'Chi tiết SĐT',warnings)]);
      rows=data.rows;summaryRows=(query.page?data.rows:data.employees.length?data.employees:data.rows).filter(r=>matches(r,query));
      kpis=[kpi('SĐT lần đầu',sum(summaryRows,'first')),kpi('SĐT chào lại',sum(summaryRows,'repeat')),kpi('Quy đổi (theo sheet)',sum(summaryRows,'equivalent')),kpi('Khách chốt (theo sheet)',sum(summaryRows,'closed'))];
      charts=[{title:'SĐT quy đổi theo nhân viên',labels:summaryRows.map(r=>r.label),values:summaryRows.map(r=>r.equivalent)}];
    } else if(kind==='phones') {
      const data=await readPhones();dependencies.phones=data;rows=data.rows;warnings.push(...data.warnings);
      readAt=data.readAt;
      const selected=rows.filter(r=>matches(r,query));
      summaryRows=unique(selected.map(r=>r.page)).map(page=>({key:JSON.stringify(['phones-page',page]),label:page,page,count:selected.filter(r=>r.page===page).length,kind:'page'}));
      const employees=unique(selected.flatMap(r=>[r.firstEmployee,r.currentEmployee]));
      summaryRows.push(...employees.map(employee=>({key:JSON.stringify(['phones-employee',employee]),label:employee,employee,count:selected.filter(r=>matches(r,{employee})).length,kind:'employee'})));
      kpis=[kpi('Dòng SĐT CHUẨN',selected.length),kpi('Page',unique(selected.map(r=>r.page)).length)];
      charts=[{title:'SĐT CHUẨN theo page',labels:summaryRows.filter(r=>r.kind==='page').map(r=>r.label),values:summaryRows.filter(r=>r.kind==='page').map(r=>r.count)}];
    } else {
      const titles=await read('ads');const names=titles.filter(t=>p.COST_PAGES[p.norm(t)]);
      if(!names.length)throw fail(503,'MARKETING_HEADERS_MISSING','Không tìm thấy các tab chi phí ADS.');
      const blocks=await Promise.all(names.map(async title=>{try{return p.parseCosts(await read('ads',title),title);}catch(e){if(e.statusCode)throw e;throw fail(503,'MARKETING_HEADERS_MISSING',`Tab ${title} thiếu tiêu đề chi phí.`);}}));
      readAt=Math.min(...names.map(title=>sourceTime('ads',title)));
      rows=blocks.flatMap(b=>b.rows).filter(r=>r.month===m);
      const totals=blocks.flatMap(b=>b.totals).filter(r=>r.month===m);dependencies.costs={rows,totals};
      const pages=unique([...rows,...totals].map(r=>r.page));
      summaryRows=pages.map(page=>{
        const source=totals.filter(t=>t.page===page);const daily=rows.filter(r=>r.page===page);const sourceRows=source.length?source:daily;
        if(!source.length)warnings.push(`${page}: tổng tháng được cộng từ các giá trị ngày hợp lệ; ô thiếu/lỗi được bỏ qua và giữ — trong chi tiết.`);
        const total=source.length?sum:sumValid;
        return {key:JSON.stringify(['costs-page',page,m]),label:page,page,kind:'page',adCost:total(sourceRows,'adCost'),totalCost:total(sourceRows,'totalCost'),messages:total(sourceRows,'messages'),phones:total(sourceRows,'phones'),totalLabel:sourceRows[0]?.totalLabel||'Tổng chi phí',costPerMessage:source.length===1?source[0].costPerMessage:null,costPerPhone:source.length===1?source[0].costPerPhone:null};
      }).filter(r=>matches(r,query));
      if(!summaryRows.length)warnings.push(`Chưa có dữ liệu chi phí tháng ${m}.`);
      kpis=[kpi('Tổng chi phí (gồm phí thuê/VAT)',sum(summaryRows,'totalCost'),'money'),kpi('SL mess',sum(summaryRows,'messages')),kpi('SL SĐT',sum(summaryRows,'phones'))];
      charts=[{title:'Tổng chi phí theo page',labels:summaryRows.map(r=>r.label),values:summaryRows.map(r=>r.totalCost)}];
      const daily=rows.filter(r=>matches(r,query));const dates=unique(daily.map(r=>r.date)).sort((a,b)=>(p.dateParts(a)?.day||0)-(p.dateParts(b)?.day||0));
      charts.push({title:'Tổng chi phí theo ngày',labels:dates,values:dates.map(date=>sum(daily.filter(r=>r.date===date),'totalCost'))});
    }
    const allRows=rows;rows=rows.filter(r=>matches(r,query));warnings.push(...sourceWarning([...rows,...summaryRows]));
    const result={kind,month:m,snapshotId:randomUUID(),computedAt:new Date(readAt).toISOString(),rows,summaryRows,kpis,charts,warnings:[...new Set(warnings)],filters:filters(allRows)};
    for(const [id,s]of snapshots)if(now()-s.at>SNAPSHOT_TTL)snapshots.delete(id);
    while(snapshots.size>=64)snapshots.delete(snapshots.keys().next().value);
    snapshots.set(result.snapshotId,{at:now(),result,dependencies,query:{...query,month:m}});
    return result;
  }
  async function detail(query={}) {
    const kind=String(query.kind||'');
    let snapshot;
    if(query.snapshotId && query.refresh!=='1'){
      snapshot=snapshots.get(String(query.snapshotId));
      if(!snapshot||now()-snapshot.at>SNAPSHOT_TTL)throw fail(409,'MARKETING_SNAPSHOT_EXPIRED','Dữ liệu chi tiết đã hết hạn. Bấm Cập nhật chi tiết.');
      if(snapshot.result.kind!==kind)throw fail(400,'MARKETING_INVALID_SNAPSHOT','Snapshot không thuộc báo cáo này.');
    }else{const result=await report(kind,query);snapshot=snapshots.get(result.snapshotId);}
    const {result,dependencies}=snapshot;
    const selected=result.summaryRows.find(r=>r.key===query.key)||(['phones','receipt-check'].includes(kind)?result.rows.find(r=>r.key===query.key):null);
    if(!selected)throw fail(404,'MARKETING_DETAIL_NOT_FOUND','Không tìm thấy dòng trong phạm vi báo cáo.');
    const warnings=[],groups=[];
    const baseQuery=snapshot.query;
    const scoped=(rows)=>rows.filter(r=>matches(r,baseQuery)&&matches(r,{page:selected.page,employee:selected.employee}));
    let kpis=[],reconciliation={status:'unavailable',source:{},found:{}};
    if(kind==='monthly') {
      const records=scoped(dependencies.monthly.rows);
      groups.push({title:'Các dòng BC tháng',kind:'monthly',rows:records});
      kpis=[kpi('Khách chốt theo sheet',selected.closed),kpi('Dòng chi tiết tìm thấy',records.length)];
      reconciliation={status:selected.closed===null?'unavailable':selected.closed===records.length?'matched':'mismatch',source:{closed:selected.closed},found:{closed:records.length}};
      if(selected.closed!==records.length)warnings.push(`Có chênh lệch: nguồn tổng ${selected.closed??'—'}, chi tiết tìm thấy ${records.length} dòng. Giữ nguyên số liệu sheet.`);
    }else if(kind==='receipt-check'){
      const check=dependencies.check.rows.filter(r=>matches(r,baseQuery)&&matches(r,{page:selected.page,employee:selected.employee}));
      const names=unique(check.map(r=>r.name));
      const phoneRows=dependencies.phones?.rows||[];
      const inMonth=v=>p.dateParts(v)?.month===result.month;
      const first=phoneRows.filter(r=>(!selected.page||p.norm(r.page)===p.norm(selected.page))&&names.some(n=>p.norm(n)===p.norm(r.firstEmployee))&&inMonth(r.firstAt));
      const repeat=phoneRows.filter(r=>(!selected.page||p.norm(r.page)===p.norm(selected.page))&&names.some(n=>p.norm(n)===p.norm(r.repeatEmployee))&&inMonth(r.repeatAt));
      const closed=scoped(dependencies.monthly?.rows||[]);
      groups.push({title:'SĐT lần đầu',kind:'phones',rows:first},{title:'SĐT chào lại',kind:'phones',rows:repeat},{title:'Khách chốt theo BC tháng',kind:'monthly',rows:closed});
      kpis=[kpi('SĐT lần đầu',selected.first),kpi('SĐT chào lại',selected.repeat),kpi('Quy đổi',selected.equivalent),kpi('Khách chốt',selected.closed),kpi('Tỷ lệ chốt',selected.rate,'percent')];
      reconciliation={status:!dependencies.phones||!dependencies.monthly?'unavailable':selected.first===first.length&&selected.repeat===repeat.length&&selected.closed===closed.length?'matched':'mismatch',source:{first:selected.first,repeat:selected.repeat,closed:selected.closed},found:{first:first.length,repeat:repeat.length,closed:closed.length}};
      warnings.push('Quy đổi = SĐT lần đầu + SĐT chào lại ÷ 5. Tỷ lệ giữ nguyên kết quả sheet; chi tiết dùng ngày trong tháng đang chọn.');
      if(!dependencies.phones)warnings.push('Không đọc được nguồn SĐT CHUẨN để đối chiếu.');
      if(!dependencies.monthly)warnings.push('Không đọc được BC tháng để đối chiếu.');
      if(selected.first!==first.length||selected.repeat!==repeat.length||selected.closed!==closed.length)warnings.push(`Có chênh lệch với chi tiết: lần đầu ${first.length}, chào lại ${repeat.length}, BC tháng ${closed.length} dòng. Số tổng nguồn được giữ nguyên.`);
    }else if(kind==='phones'){
      const records=selected.phone?result.rows.filter(r=>r.key===selected.key):scoped(dependencies.phones.rows);
      groups.push({title:'SĐT CHUẨN',kind:'phones',rows:records});kpis=[kpi('Dòng SĐT',records.length)];
      reconciliation={status:'matched',source:{rows:selected.count??1},found:{rows:records.length}};
    }else{
      const daily=scoped(dependencies.costs.rows);groups.push({title:'Chi phí từng ngày',kind:'costs',rows:daily});
      kpis=[kpi(selected.totalLabel||'Tổng chi phí',selected.totalCost,'money'),kpi('Chi phí ADS',selected.adCost,'money'),kpi('SL mess',selected.messages),kpi('SL SĐT',selected.phones)];
      const hasTotal=dependencies.costs.totals.some(r=>r.page===selected.page);
      const dailyTotal=hasTotal?sum(daily,'totalCost'):sumValid(daily,'totalCost');
      reconciliation={status:dailyTotal===null||selected.totalCost===null?'unavailable':dailyTotal===selected.totalCost?'matched':'mismatch',source:{totalCost:selected.totalCost,origin:hasTotal?'monthly-total':'valid-daily-values'},found:{totalCost:dailyTotal,rows:daily.length}};
      if(dailyTotal!==selected.totalCost)warnings.push(`Có chênh lệch giữa tổng tháng nguồn và tổng dữ liệu ngày (${dailyTotal??'—'}). Giữ nguyên tổng nguồn.`);
    }
    return {title:selected.label||selected.phone,subtitle:result.month?`Tháng ${result.month} · ${selected.page||'Tất cả page'}`:selected.page||'Toàn bộ',computedAt:result.computedAt,snapshotId:result.snapshotId,kpis,groups,reconciliation,formula:kind==='receipt-check'?'SĐT lần đầu + SĐT chào lại ÷ 5':undefined,warnings:[...new Set([...result.warnings,...warnings])]};
  }
  return {metadata,report,detail};
}
module.exports={createMarketingReportService};
