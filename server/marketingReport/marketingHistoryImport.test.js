'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PGlite } = require('@electric-sql/pglite');
const HN = '1184366971419195', TT = '1144127138790204';
const phoneBook = '1cAOmY4WC2tIE0-OMwvy43PTR9dNK72k2d4DUDrB2swk';
const reportBook = '14MaEMfPCyfxPx-HfJMJ1gcwIpKVbuhx3FIBCSnLSWl8';
const rawTabs = ['HN THÔ','TT THÔ','BL THÔ','PL THÔ','HS THÔ','DN THÔ'];
const standardTabs = ['HỮU NGHỊ CHUẨN','TÂN THANH CHUẨN','BẮC LÃM CHUẨN','Phú lương CHUẨN','HN-SG Chuẩn','Dương nội Chuẩn'];
function api() {
  const file = path.join(__dirname,'marketingHistoryImport.js');
  const m = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof m.prepareHistoryImport,'function','history importer must exist');
  return m;
}
function aggregate() {
  const file = path.join(__dirname,'marketingAggregation.js');
  const m = fs.existsSync(file) ? require(file) : {};
  assert.equal(typeof m.aggregatePhones,'function','source-order phone aggregation must exist');
  return m;
}
function raw(phone, employee='Raw A', credited='1/10', created='27/09/2026 10:20:30') {
  const r = Array(21).fill(''); Object.assign(r,{15:created,18:employee,19:phone,20:credited}); return r;
}
function snapshot() {
  const sheets = {};
  for(let i=0;i<6;i++) { sheets[rawTabs[i]]=[raw('Số điện thoại','Nhân viên được phân công','Ngày','Tạo lúc')]; sheets[standardTabs[i]]=[['Số điện thoại']]; }
  return {capturedAt:'2026-10-09T00:00:00Z',workbooks:{phones:{workbookId:phoneBook,titles:Object.keys(sheets),sheets},report:{workbookId:reportBook,titles:['Tên','BC Tháng 6','BC Tháng 10'],sheets:{'Tên':[['Nguồn','Tên NV'],['Raw A','Sale']], 'BC Tháng 6':[[' ','ID khách','SĐT','Tình trạng','DATA','Ngày','Tiền',''],[]], 'BC Tháng 10':[['SALE','ID khách','SĐT','PAGE','Tình trạng','DATA','Ngày','Tiền'],[]]}}}};
}
test('history keeps phone cell text/type, missing employee, invalid dates and exact source row provenance',()=>{
  const s=snapshot(); s.workbooks.phones.sheets['HN THÔ'].push(raw(912345678,'','31/2',''),raw('0912345678','Raw A','1/10'),raw('0901, 0902','Raw B','bad'));
  const p=api().prepareHistoryImport(s,{year:2026}); const rows=p.batches[0].rawRows;
  assert.equal(rows.length,3); assert.deepEqual(rows.map(r=>[r.phone,r.phoneKey]),[['912345678','912345678'],['0912345678','0912345678'],['0901, 0902','0901, 0902']]);
  assert.equal(rows[0].employeeRaw,''); assert.equal(rows[0].sourceCreatedAt,null); assert.equal(rows[0].creditedDate,null); assert.equal(rows[1].creditedDate,'2026-10-01'); assert.equal(rows[1].sourceCreatedAt,'2026-09-27T03:20:30.000Z');
  assert.equal(rows[0].raw[19],912345678); assert.equal(rows[0].rowNumber,2); assert.equal(p.batches[0].workbookId,phoneBook); assert.equal(p.batches[1].workbookId,reportBook);
  assert.equal(p.summary.unresolved.creditedDate.length,2); assert.equal(p.summary.unresolved.createdAt.length,1);
});
test('numeric/string same cell text uses explicit exact-text policy and reports mixed types for review',()=>{
  const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw(912345678),raw('912345678'));
  const p=api().prepareHistoryImport(s,{year:2026});assert.equal(p.batches[0].rawRows.length,2);assert.equal(p.summary.uniquePhones,1);assert.deepEqual(p.summary.raw[0].mixedPhoneTypeKeys,[['HN THÔ!2','HN THÔ!3']]);
});
test('calendar parsing rejects overflow and uses explicit year including leap years and Excel serials',()=>{
  const {parseHistoricalDate,parseCreatedTimestamp}=api();
  assert.equal(parseHistoricalDate('29/2',2024),'2024-02-29'); assert.equal(parseHistoricalDate('29/2',2026),null); assert.equal(parseHistoricalDate('31/04/2026',2026),null);
  assert.equal(parseHistoricalDate(46296,2026),'2026-10-01'); assert.equal(parseHistoricalDate('2026-10-01junk',2026),null);
  assert.equal(parseCreatedTimestamp('31/02/2026 10:00:00'),null); assert.equal(parseCreatedTimestamp('01/10/2026 24:00:00'),null);
  assert.throws(()=>api().prepareHistoryImport(snapshot(),{}),{code:'INVALID_MARKETING_IMPORT'});
});
test('June legacy schema preserves notes without inferring page and monthly date comes from tab',()=>{
  const s=snapshot();s.workbooks.report.sheets['BC Tháng 6'].push(['Sale','Customer',912345678,'Chốt','Mới',46296,100,'legacy note','Side rank',5]);
  s.workbooks.report.sheets['BC Tháng 10'].push(['Sale','Customer','0900000001','Hữu Nghị','Chốt','Mới','30/9/2026',999,'Có','note'],Array(10).fill('').concat(['Formula',100]));
  const rows=api().prepareHistoryImport(s,{year:2026}).batches[1].monthlyRows;
  assert.equal(rows.length,2); const june=rows.find(r=>r.reportMonth===6),oct=rows.find(r=>r.reportMonth===10);
  assert.equal(june.pageId,null); assert.equal(june.page,'');assert.equal(june.newCustomer,'');assert.equal(june.note,'legacy note');assert.equal(june.closedAt,'2026-10-01');
  assert.equal(oct.pageId,HN);assert.equal(oct.reportMonth,10);assert.equal(oct.closedAt,'2026-09-30');assert.equal(oct.raw[7],999);assert.equal(Object.hasOwn(oct,'revenue'),false);
});
test('equal duplicate aliases collapse and conflicting aliases reject with safe row references',()=>{
  const s=snapshot();s.workbooks.report.sheets['Tên'].push(['Raw A','Sale'],['Raw B','Sale']);
  let p=api().prepareHistoryImport(s,{year:2026});assert.equal(p.batches[1].aliases.length,2);assert.equal(p.summary.aliases.filledRows,3);
  s.workbooks.report.sheets['Tên'].push(['Raw A','Other']);assert.throws(()=>api().prepareHistoryImport(s,{year:2026}),e=>e.code==='INVALID_MARKETING_IMPORT'&&e.rowReferences.includes('Tên!5')&&!e.message.includes('Raw A'));
  s.workbooks.report.workbookId='wrong';assert.throws(()=>api().prepareHistoryImport(s,{year:2026}),{code:'INVALID_MARKETING_IMPORT'});
});
test('first and last use BigInt stored order per page and alias after raw repeat selection',()=>{
  const rows=[{id:'3',origin:'pancake',pageId:HN,phone:'x',phoneKey:'x',sourceOrder:'9007199254740994',employeeRaw:'Raw B',creditedDate:'2026-10-01',sourceCreatedAt:'2026-01-01T00:00:00Z'},
    {id:'2',origin:'sheet',pageId:TT,phone:'x',phoneKey:'x',sourceOrder:'2',employeeRaw:'Raw A',creditedDate:'2026-09-30'},
    {id:'1',origin:'sheet',pageId:HN,phone:'x',phoneKey:'x',sourceOrder:'9007199254740993',employeeRaw:'Raw A',creditedDate:'2026-09-30',sourceCreatedAt:'2026-12-01T00:00:00Z'}];
  const phones=aggregate().aggregatePhones(rows,[{rawName:'Raw A',reportEmployee:'Sale'},{rawName:'Raw B',reportEmployee:'Sale'}]);
  assert.equal(phones.length,2);const hn=phones.find(r=>r.pageId===HN);
  assert.deepEqual([hn.firstEmployee,hn.currentEmployee,hn.repeatEmployee],['Raw A','Raw B','Raw B']);assert.equal(hn.repeatAt,'2026-10-01');assert.equal(hn.mappedRepeatEmployee,'Sale');
  assert.deepEqual(hn.trace.map(r=>[r.origin,r.id]),[['sheet','1'],['pancake','3']]);assert.equal(hn.firstRow.id,'1');assert.equal(hn.lastRow.id,'3');
  const changed=aggregate().aggregatePhones([...rows,{...rows[0],id:'4',sourceOrder:'9007199254740995',employeeRaw:'Raw A',creditedDate:'2026-11-01'}]).find(r=>r.pageId===HN);
  assert.equal(changed.repeatEmployee,'');assert.equal(changed.repeatAt,'2026-11-01');
});
test('same-day assignment change has no repeat date and created date never selects report month',()=>{
  const rows=[{id:'1',origin:'sheet',pageId:HN,phone:'x',sourceOrder:'1',employeeRaw:'A',creditedDate:'2026-10-01',sourceCreatedAt:'2026-09-27T00:00:00Z'},
  {id:'2',origin:'sheet',pageId:HN,phone:'x',sourceOrder:'2',employeeRaw:'B',creditedDate:'2026-10-01'}];
  const {aggregatePhones,countPhoneKpis}=aggregate();const phones=aggregatePhones(rows);
  assert.equal(phones[0].repeatEmployee,'B');assert.equal(phones[0].repeatAt,null);
  assert.equal(countPhoneKpis(phones,{year:2026,month:10})[0].first,1);assert.equal(countPhoneKpis(phones,{year:2026,month:9}).length,0);
});
test('closed numerator counts sale/page report rows regardless status or closed date',()=>{
  const {countMonthlyClosures}=aggregate();assert.equal(typeof countMonthlyClosures,'function');
  const rows=[{reportYear:2026,reportMonth:10,pageId:HN,sale:'Sale',status:'Đang tìm',closedAt:'2026-09-01'},
    {reportYear:2026,reportMonth:10,pageId:HN,sale:'Sale',status:'Chốt',closedAt:'2026-10-01'},
    {reportYear:2026,reportMonth:9,pageId:HN,sale:'Sale',status:'Chốt',closedAt:'2026-10-01'}];
  assert.deepEqual(countMonthlyClosures(rows,{year:2026,month:10}),[{pageId:HN,employee:'Sale',closed:2}]);
});
test('repeated source header remains imported but is excluded like CHUAN UNIQUE header; invalid created facts remain countable',()=>{
  const s=snapshot();s.workbooks.phones.sheets['BL THÔ'].push(raw('Số điện thoại','Nhân viên được phân công','27/8','Tạo lúc'),raw('0900000001','Raw A','27/8','unknown'));
  s.workbooks.phones.sheets['BẮC LÃM CHUẨN'].push(['0900000001','Raw A','Raw A','','27/8','27/8','']);
  const p=api().prepareHistoryImport(s,{year:2026});assert.equal(p.batches[0].rawRows.length,2);assert.equal(p.summary.uniquePhones,1);assert.deepEqual(p.summary.unresolved.sourceHeader,['BL THÔ!2']);assert.equal(p.summary.standard[2].matched,1);assert.equal(p.summary.standard[2].extraSourceRows.length,0);
});
test('CHECK closed and rate use one mapped sale/page numerator and grouped equivalent denominator',()=>{
  const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw('0900000001','Raw A','1/10'),raw('0900000001','Raw B','2/10'));
  s.workbooks.report.sheets['Tên'].push(['Raw B','Sale']);s.workbooks.report.sheets['BC Tháng 10'].push(['Sale','Customer','0900000001','Hữu Nghị','Đang tìm','Mới','30/9/2026']);
  s.workbooks.report.sheets['CHECK Tỷ lệ nhận số T10']=[['BÁO CÁO SĐT T10'],['Raw A',1,0,1,'Hữu Nghị','Sale',1,5/6],['Raw B',0,1,0.2,'Hữu Nghị','Sale',1,5/6]];
  const check=api().prepareHistoryImport(s,{year:2026}).summary.checks[0];assert.equal(check.mismatchedRows,0);assert.equal(check.mappedTotals[0].closed,1);assert.equal(check.mappedTotals[0].rate,5/6);
  s.workbooks.report.sheets['CHECK Tỷ lệ nhận số T10'][2][6]=2;
  assert.ok(api().prepareHistoryImport(s,{year:2026}).summary.checks[0].differences.some(d=>d.row==='CHECK Tỷ lệ nhận số T10!3'&&d.field==='closed'&&d.found===1));
});
test('CHECK structurally unresolved rows are never reported matched',()=>{
  const s=snapshot();s.workbooks.report.sheets['CHECK Tỷ lệ nhận số T8']=[['BÁO CÁO SĐT T8'],['',0,0,0,'Hữu Nghị',''],['Raw A',0,0,0,'Unknown','Sale']];
  const check=api().prepareHistoryImport(s,{year:2026}).summary.checks[0];assert.equal(check.matchedRows,0);assert.equal(check.unresolvedRows,2);assert.equal(check.phoneMismatchedRows,0);
});
test('reconciliation reports safe CHUAN field/type discrepancies and CHECK count/formula/header differences',()=>{
  const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw('0900000001','Raw A','1/10'),raw('0900000001','Raw B','2/10'));
  s.workbooks.phones.sheets['HỮU NGHỊ CHUẨN'].push(['0900000001','Raw A','Raw B','Raw B','1/10','2/10','2/10']);
  s.workbooks.report.sheets['Tên'].push(['Raw B','Sale']);s.workbooks.report.sheets['CHECK Tỷ lệ nhận số T10']=[['BÁO CÁO SĐT T9','SĐT LẦN ĐẦU','SĐT CHÀO LẠI'],['Raw A',1,0,1,'Hữu Nghị','Sale'],['Raw B',0,9,99,'Hữu Nghị','Sale']];
  let p=api().prepareHistoryImport(s,{year:2026});assert.equal(p.summary.standard[0].matched,1);const check=p.summary.checks[0];
  assert.equal(check.mismatchedRows,1);assert.equal(check.headerMonth,9);assert.ok(check.differences.some(d=>d.row==='CHECK Tỷ lệ nhận số T10!3'&&d.field==='repeat'&&d.found===1));
  assert.ok(check.differences.some(d=>d.field==='equivalent'));assert.equal(check.mappedTotals[0].first,1);assert.equal(check.mappedTotals[0].repeat,1);
  const safe=JSON.stringify(p.summary);assert.equal(safe.includes('0900000001'),false);assert.equal(safe.includes('Raw A'),false);assert.equal(safe.includes('Sale'),false);
  s.workbooks.phones.sheets['HỮU NGHỊ CHUẨN'][1][0]=900000001;p=api().prepareHistoryImport(s,{year:2026});assert.equal(p.summary.standard[0].matched,0);
});
test('complete importer batches replay through PostgreSQL without duplicate raw rows/monthly audits',async t=>{
  const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw('0900000001'));s.workbooks.report.sheets['BC Tháng 10'].push(['Sale','Customer','0900000001','Hữu Nghị']);
  const m=api();const db=new PGlite();t.after(()=>db.close());await db.exec(fs.readFileSync(path.join(__dirname,'../db/migrations/0044_pancake_marketing.sql'),'utf8'));
  const pool={query:(...a)=>db.query(...a),connect:async()=>({query:(...a)=>db.query(...a),release(){}})};const repo=require('./marketingRepository').createMarketingRepository({pool});
  const prepared=m.prepareHistoryImport(s,{year:2026});await m.applyHistoryImport(prepared,repo,{userId:'7'});const replay=await m.applyHistoryImport(prepared,repo,{userId:'7'});
  assert.equal(replay.every(r=>r.replayed),true);const stored=await repo.readSnapshot();assert.equal(stored.rawRows.length,1);assert.equal(stored.monthlyRows.length,1);assert.equal(stored.monthlyRows[0].workbookId,reportBook);
  assert.equal((await repo.listMonthlyAudit(stored.monthlyRows[0].id)).length,1);assert.equal(stored.aliases.length,1);
  const updatedCapture={...s,capturedAt:'2026-11-01T00:00:00Z'};assert.equal(m.prepareHistoryImport(updatedCapture,{year:2026}).batches[0].batchKey,prepared.batches[0].batchKey);
});
test('readonly snapshot capture keeps selected tabs, workbook provenance and original cell types',async()=>{
  const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw(912345678));const calls=[];
  const clients=Object.fromEntries(Object.entries(s.workbooks).map(([kind,w])=>[kind,{listSheetTitles:async()=>[...Object.keys(w.sheets),'Ignore'],getValues:async(title,options)=>{calls.push({title,options});return w.sheets[title];}}]));
  const captured=await api().captureHistorySnapshot({clients,now:()=>new Date('2026-10-09T00:00:00Z')});assert.equal(captured.workbooks.phones.workbookId,phoneBook);assert.equal(captured.workbooks.phones.sheets['HN THÔ'][1][19],912345678);
  assert.equal(captured.workbooks.report.sheets.Ignore,undefined);assert.equal(calls.every(c=>c.options.valueRenderOption==='UNFORMATTED_VALUE'),true);
});
test('CLI defaults dry-run without environment or writes and invalid CLI input never echoes PII',t=>{
  api();const tmp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'marketing-import-test-'));t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));const input=path.join(tmp,'source.json');const output=path.join(tmp,'summary.json');const s=snapshot();s.workbooks.phones.sheets['HN THÔ'].push(raw('0900000001'));fs.writeFileSync(input,JSON.stringify(s));
  const cli=path.join(__dirname,'../scripts/import-marketing-history.js');const env={...process.env,GOOGLE_SERVICE_ACCOUNT_JSON:'',JWT_SECRET:'',SUPABASE_DB_URL:''};
  let run=spawnSync(process.execPath,[cli,'--input',input,'--year','2026','--report-file',output],{encoding:'utf8',env});assert.equal(run.status,0,run.stderr);assert.equal(JSON.parse(run.stdout).mode,'dry-run');assert.equal(JSON.parse(fs.readFileSync(output)).rawRows,1);assert.equal(run.stdout.includes('0900000001'),false);
  run=spawnSync(process.execPath,[cli,'--input',input,'--year','2026','--apply'],{encoding:'utf8',env});assert.equal(run.status,1);assert.equal(run.stderr.includes('0900000001'),false);
  fs.writeFileSync(input,'{"phone":"PRIVATE');run=spawnSync(process.execPath,[cli,'--input',input,'--year','2026'],{encoding:'utf8',env});assert.equal(run.status,1);assert.equal(run.stderr.includes('PRIVATE'),false);
});
