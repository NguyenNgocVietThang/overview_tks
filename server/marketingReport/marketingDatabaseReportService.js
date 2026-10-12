'use strict';
const {
  randomUUID
}=require('node:crypto');
const {
  aggregatePhones,countPhoneKpis,countMonthlyClosures
}=require('./marketingAggregation');
const {
  norm
}=require('./marketingParsers');
const fail=(statusCode,code,message)=>Object.assign(new Error(message),{
  statusCode,code
});
const unique=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'vi'));
const names=v=>String(v??'').split(/\s*,\s*/).filter(Boolean);
const matches=(r,q)=>!((q.page&&norm(r.page)!==norm(q.page))||(q.employee&&![r.employee,r.sale,r.firstEmployee,r.currentEmployee,r.repeatEmployee].some(v=>names(v).some(n=>norm(n)===norm(q.employee))))||(q.status&&r.status!==q.status)||(q.dataSource&&r.dataSource!==q.dataSource));
const kpi=(label,value,format='number')=>({
  label,value,format
});
const sum=(rows,key)=>rows.reduce((n,r)=>n+(typeof r[key]==='number'?r[key]:0),0);
function createDatabaseMarketingReportService({
  repository,legacy,revenue, businessRepository,now=Date.now
}={
}){
  repository ||= require('./marketingRepository').createMarketingRepository();
  revenue ||= require('./marketingRevenue').createRevenueProvider({
    now
  });
  const business=()=>businessRepository ||= require('../businessReport/businessReportRepository').createRepository();
  const snapshots=new Map();
  async function directorySnapshot(){try{return await business().snapshot();}catch{throw fail(503,'MARKETING_CUSTOMERS_UNAVAILABLE','Không đọc được danh sách khách KiotViet. Vui lòng thử lại.');}}
  function period(q={
  }){
    const d=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Saigon',year:'numeric',month:'numeric'
    }).formatToParts(new Date(now()));
    const current=Object.fromEntries(d.map(x=>[x.type,x.value]));
    const month=q.month===undefined||q.month===''?+current.month:Number(q.month),year=q.year===undefined||q.year===''?+current.year:Number(q.year);
    if(!Number.isInteger(month)||month<1||month>12)throw fail(400,'MARKETING_INVALID_MONTH','Tháng phải từ 1 đến 12.');
    if(!Number.isInteger(year)||year<1900||year>9999)throw fail(400,'MARKETING_INVALID_YEAR','Năm không hợp lệ.');
    return {
      month,year
    };
  }
  const displayPhones=s=>aggregatePhones(s.rawRows,s.aliases).map(r=>({
    key:r.key,pageId:r.pageId,page:s.pages.find(p=>p.pageId===r.pageId)?.name||r.pageId,phone:r.phone,firstEmployee:r.mappedFirstEmployee||r.firstEmployee,currentEmployee:r.mappedCurrentEmployee||r.currentEmployee,repeatEmployee:r.mappedRepeatEmployee||r.repeatEmployee,firstAt:r.firstAt,currentAt:r.currentAt,repeatAt:r.repeatAt,unresolved:r.unresolved,trace:r.trace
  }));
  async function metadata(){
    const s=await repository.readSnapshot({
      includeRaw:false
    }),current=period();
    let ads;
    try{
      ads=await legacy.metadata();
    }catch{
    }const periods=unique([...s.monthlyRows.map(r=>`${r.reportYear}-${String(r.reportMonth).padStart(2,'0')}`),...s.rawRows.map(r=>r.creditedDate?.slice(0,7))]);
    return {
      sourceMode:'database',periods:periods.map(p=>({year:Number(p.slice(0,4)),month:Number(p.slice(5,7))})),pages:s.pages.map(p=>({
        pageId:p.pageId,name:p.name
      })),currentMonth:current.month,currentYear:current.year,years:unique([String(current.year),...periods.map(p=>p.slice(0,4))]).map(Number).sort((a,b)=>b-a),months:{
        monthly:unique(s.monthlyRows.map(r=>String(r.reportMonth))).map(Number).sort((a,b)=>b-a),check:Array.from({
          length:12
        },(_,i)=>12-i),costs:ads?.months?.costs||Array.from({
          length:12
        },(_,i)=>12-i)
      },sources:{
        report:{
          available:true
        },phones:{
          available:true
        },ads:ads?.sources?.ads||{
          available:false
        }
      }
    };
  }
  async function report(kind,q={
  }){
    if(kind==='costs'){
      const result=await legacy.report(kind,q);
      
      return result;
    }
    if(!['monthly','receipt-check','phones'].includes(kind))throw fail(400,'MARKETING_INVALID_KIND','Loại báo cáo không hợp lệ.');
    const {
      month,year
    }=period(q),s=await repository.readSnapshot({
      includeRaw:false
    }),phones=displayPhones(s),warnings=[];
    const monthly=s.monthlyRows.filter(r=>r.reportYear===year&&r.reportMonth===month).map(({
      sourceRaw,workbookId,sourceTab,sourceRow,...r
    })=>({
      ...r,key:JSON.stringify(['monthly-db',r.id]),revenue:null
    }));
    if(kind==='monthly'){
      let lookup;
      try{
        lookup=await revenue(month,year);
      }catch{
        warnings.push('Không đọc được doanh số KiotViet; cột Doanh số hiển thị —.');
      }for(const row of monthly)row.revenue=lookup?.available?lookup.revenueOf(row.customer):null;
      if(!lookup?.available&&!warnings.length)warnings.push('Chưa có dữ liệu doanh số KiotViet cho tháng này; cột Doanh số hiển thị —.');
    }
    let rows=[],summaryRows=[],kpis=[];
    const aggregate=(records,field,kind)=>unique(records.map(r=>r[field])).map(label=>{
      const group=records.filter(r=>r[field]===label);
      return {
        key:JSON.stringify([kind,label,year,month]),kind,label,...(field==='page'?{
          page:label
        }:{
          employee:label
        }),closed:group.length,revenue:group.some(r=>typeof r.revenue==='number')?sum(group,'revenue'):null
      };
    });
    if(kind==='monthly'){
      rows=monthly;
      const selected=rows.filter(r=>matches(r,q));
      summaryRows=[...aggregate(selected,'page','page'),...aggregate(selected,'sale','sale')];
      kpis=[kpi('Doanh số tháng (KiotViet)',selected.some(r=>typeof r.revenue==='number')?sum(selected,'revenue'):null,'money'),kpi('Khách chốt',selected.length),kpi('Số nhân viên',unique(selected.map(r=>r.sale)).length)];
    }
    if(kind==='phones'){
      rows=phones;
      const selected=rows.filter(r=>matches(r,q));
      summaryRows=[...unique(selected.map(r=>r.page)).map(page=>({
        key:JSON.stringify(['phones-page',page]),kind:'page',label:page,page,count:selected.filter(r=>r.page===page).length
      })),...unique(selected.flatMap(r=>[r.firstEmployee,r.currentEmployee].flatMap(names))).map(employee=>({
        key:JSON.stringify(['phones-employee',employee]),kind:'employee',label:employee,employee,count:selected.filter(r=>matches(r,{
          employee
        })).length
      }))];
      kpis=[kpi('Dòng SĐT',selected.length),kpi('Page',unique(selected.map(r=>r.page)).length)];
    }
    if(kind==='receipt-check'){
      const counts=countPhoneKpis(aggregatePhones(s.rawRows,[...s.aliases,...unique(s.rawRows.map(r=>r.employeeRaw)).filter(n=>!s.aliases.some(a=>a.rawName===n)).map(n=>({
        rawName:n,reportEmployee:n
      }))]),{
        year,month,mapped:true
      }),closed=countMonthlyClosures(s.monthlyRows,{
        year,month
      });
      const groups=new Map();
      for(const r of [...counts,...closed]){
        const employee=r.employee||'',key=JSON.stringify([r.pageId,employee]);
        if(!groups.has(key))groups.set(key,{
          key,pageId:r.pageId,page:s.pages.find(p=>p.pageId===r.pageId)?.name||r.pageId,employee,name:employee,label:employee||'Chưa ánh xạ',first:0,repeat:0,closed:0
        });
        const target=groups.get(key);
        target.first+=r.first||0;
        target.repeat+=r.repeat||0;
        target.closed+=r.closed||0;
      }
      const ratio=r=>({
        ...r,equivalent:r.first+r.repeat/5,rate:r.first+r.repeat/5?r.closed/(r.first+r.repeat/5):null
      });
      rows=[...groups.values()].map(ratio);
      const selected=rows.filter(r=>matches(r,q));
      const totals=new Map();
      for(const r of selected){
        if(!totals.has(r.employee))totals.set(r.employee,{
          key:JSON.stringify(['check-employee',r.employee]),label:r.label,name:r.employee,employee:r.employee,kind:'employee',first:0,repeat:0,closed:0
        });
        const t=totals.get(r.employee);
        for(const f of ['first','repeat','closed'])t[f]+=r[f];
      }summaryRows=q.page?selected:[...totals.values()].map(ratio);
      const t=ratio({
        first:sum(selected,'first'),repeat:sum(selected,'repeat'),closed:sum(selected,'closed')
      });
      kpis=[kpi('SĐT lần đầu',t.first),kpi('SĐT chào lại',t.repeat),kpi('Quy đổi',t.equivalent),kpi('Khách chốt',t.closed),kpi('Tỷ lệ chốt',t.rate,'percent')];
    }
    const all=rows;
    rows=rows.filter(r=>matches(r,q));
    if(phones.some(r=>Object.values(r.unresolved).some(Boolean)))warnings.push('Một số SĐT thiếu nhân viên, ngày ghi nhận hoặc ánh xạ; dữ liệu vẫn được lưu.');
    const result={
      sourceMode:'database',kind,month:kind==='phones'?null:month,year,snapshotId:randomUUID(),computedAt:new Date(now()).toISOString(),rows,summaryRows,kpis,charts:[],warnings,filters:{
        pages:unique(all.map(r=>r.page)),employees:unique(all.flatMap(r=>[r.employee,r.sale,r.firstEmployee,r.currentEmployee,r.repeatEmployee].flatMap(names))),statuses:unique(all.map(r=>r.status)),dataSources:unique(all.map(r=>r.dataSource))
      }
    };
    for(const [id,snap]of snapshots)if(now()-snap.at>1800000)snapshots.delete(id);
    while(snapshots.size>=64)snapshots.delete(snapshots.keys().next().value);
    snapshots.set(result.snapshotId,{
      at:now(),result,phones,monthly,sourceRows:s.rawRows,q:{
        ...q,month,year
      }
    });
    return result;
  }
  async function detail(q={
  }){
    if(q.kind==='costs')return legacy.detail(q);
    let snap;
    if(q.snapshotId&&q.refresh!=='1'){
      snap=snapshots.get(q.snapshotId);
      if(!snap||now()-snap.at>1800000)throw fail(409,'MARKETING_SNAPSHOT_EXPIRED','Dữ liệu chi tiết đã hết hạn. Bấm Cập nhật chi tiết.');
      if(snap.result.kind!==q.kind)throw fail(400,'MARKETING_INVALID_SNAPSHOT','Snapshot không thuộc báo cáo này.');
    }else{
      const r=await report(q.kind,q);
      snap=snapshots.get(r.snapshotId);
    }const {
      result,phones,monthly,sourceRows
    }=snap,selected=[...result.summaryRows,...result.rows].find(r=>r.key===q.key);
    if(!selected)throw fail(404,'MARKETING_DETAIL_NOT_FOUND','Không tìm thấy dòng trong phạm vi báo cáo.');
    const scoped=rows=>rows.filter(r=>matches(r,snap.q)&&matches(r,{
      page:selected.page,employee:selected.employee
    }));
    const inSelectedPage=r=>!Object.prototype.hasOwnProperty.call(selected,'pageId')||r.pageId===selected.pageId;
    let groups=[];
    if(q.kind==='receipt-check'){
      const prefix=`${result.year}-${String(result.month).padStart(2,'0')}-`;
      const employee=selected.employee;
      const by=(field,date)=>phones.filter(r=>inSelectedPage(r)&&r[field]===employee&&r[date]?.startsWith(prefix));
      groups=[{
        title:'SĐT lần đầu',kind:'phones',rows:by('firstEmployee','firstAt')
      },{
        // Totals skip a repeat whose current employee is blank (countPhoneKpis); the detail must follow the same rule.
        title:'SĐT chào lại',kind:'phones',rows:by('repeatEmployee','repeatAt').filter(r=>r.repeatEmployee)
      },{
        title:'Khách chốt theo BC tháng',kind:'monthly',rows:monthly.filter(r=>matches(r,snap.q)&&inSelectedPage(r)&&norm(r.sale)===norm(employee))
      }];
    }else groups=[{
      title:q.kind==='phones'?'SĐT':'Các dòng BC tháng',kind:q.kind,rows:selected.phone?result.rows.filter(r=>r.key===selected.key):scoped(q.kind==='phones'?phones:monthly)
    }];
    if(q.kind==='phones'||q.kind==='receipt-check'){
      const visible=groups.filter(g=>g.kind==='phones').flatMap(g=>g.rows);
      const selectedKeys=new Set(visible.flatMap(r=>r.trace.map(t=>t.sourceOrder)));
      const raw=sourceRows.filter(r=>selectedKeys.has(String(r.sourceOrder))).map(({raw,...r})=>({id:r.id,pageId:r.pageId,page:phones.find(p=>p.pageId===r.pageId)?.page||r.pageId,phone:r.phone,employeeRaw:r.employeeRaw,sourceCreatedAt:r.sourceCreatedAt,sourceCreatedText:r.sourceCreatedText,creditedDate:r.creditedDate,origin:r.origin,sourceOrder:r.sourceOrder,workbookId:r.workbookId,tab:r.tab,rowNumber:r.rowNumber,factId:r.factId,runId:r.runId,sourceKey:r.sourceKey}));
      groups.push({title:'Lịch sử nhân viên và ngày nguồn',kind:'phone-source',rows:raw});
    }
    const found=q.kind==='receipt-check'?{
      first:groups[0].rows.length,repeat:groups[1].rows.length,closed:groups[2].rows.length
    }:{
      rows:groups[0].rows.length
    };
    const source=q.kind==='receipt-check'?{
      first:selected.first,repeat:selected.repeat,closed:selected.closed
    }:{
      rows:selected.count??selected.closed??1
    };
    return {
      title:selected.label||selected.phone,subtitle:`Tháng ${result.month||''}/${result.year} · ${selected.page||(Object.prototype.hasOwnProperty.call(selected,'pageId')&&selected.pageId==null?'Page chưa xác định':'Tất cả page')}`,computedAt:result.computedAt,snapshotId:result.snapshotId,kpis:q.kind==='receipt-check'?[kpi('SĐT lần đầu',selected.first),kpi('SĐT chào lại',selected.repeat),kpi('Quy đổi',selected.equivalent),kpi('Khách chốt',selected.closed),kpi('Tỷ lệ chốt',selected.rate,'percent')]:[kpi('Dòng chi tiết',groups[0].rows.length)],groups,reconciliation:{
        status:Object.keys(source).every(k=>source[k]===found[k])?'matched':'mismatch',source,found
      },formula:q.kind==='receipt-check'?'SĐT lần đầu + SĐT chào lại ÷ 5':undefined,warnings:result.warnings
    };
  }
  async function customers(q={
  }){
    const s=await directorySnapshot(),needle=norm(String(q.q||'').slice(0,200));
    return {
      customers:s.directory.filter(r=>!needle||norm(`${r.name} ${r.code} ${r.branch}`).includes(needle)).slice(0,100).map(r=>({
        ...r,id:`${r.branch}:${r.code}`
      }))
    };
  }
  function validateInput(body,create=false){
    const fields=new Set(['reportYear','reportMonth','sale','customer','customerDirectoryId','phone','pageId','page','status','dataSource','closedAt','newCustomer','note',...(create?[]:['version'])]);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields.has(k)))throw fail(400,'MARKETING_INVALID_FIELD','Trường dữ liệu không hợp lệ.');
    for(const [key,value]of Object.entries(body))if(typeof value==='string'&&value.length>(key==='note'?500:200))throw fail(400,'MARKETING_INVALID_VALUE','Giá trị vượt quá độ dài cho phép.');
    if(create&&['customerDirectoryId','customer','sale','phone','status','dataSource','closedAt'].some(k=>typeof body[k]!=='string'||!body[k].trim()))throw fail(400,'MARKETING_INVALID_VALUE','Vui lòng nhập đầy đủ thông tin BC tháng và chọn khách KiotViet.');
  }
  async function validateCustomer(body,rowId){
    const snap=await repository.readSnapshot({
      includeRaw:false
    });
    const page=snap.pages.find(p=>p.pageId===body.pageId||(!body.pageId&&p.name===body.page));
    const old=rowId?snap.monthlyRows.find(r=>r.id===String(rowId)):null;
    const preservedMissing=old&&old.pageId==null&&body.pageId==null&&old.page===body.page;
    if(!page&&!preservedMissing)throw fail(400,'MARKETING_INVALID_PAGE','Page không hợp lệ.');
    if(page){body.pageId=page.pageId;body.page=page.name;}
    if(body.customerDirectoryId==null){
      if(rowId){
        const old=snap.monthlyRows.find(r=>r.id===String(rowId));
        if(old&&old.customer!==body.customer)throw fail(400,'MARKETING_INVALID_CUSTOMER','Vui lòng chọn khách KiotViet khi thay đổi tên khách.');
      }return;
    }const s=await directorySnapshot(),r=s.directory.find(r=>`${r.branch}:${r.code}`===body.customerDirectoryId);
    if(!r||r.name!==body.customer)throw fail(400,'MARKETING_INVALID_CUSTOMER','Khách KiotViet không hợp lệ.');
  }
  return {
    metadata,report,detail,customers,async syncStatus(){
      const s=await repository.readSnapshot({
        includeRaw:false
      });
      return {
        sourceMode:'database',pages:s.pages,latestRun:s.latestRun
      };
    },async aliases(){
      const s=await repository.readSnapshot({
        includeRaw:false
      });
      const mapped=new Set(s.aliases.map(a=>a.rawName));
      return {
        aliases:s.aliases,unmapped:unique(s.rawRows.map(r=>r.employeeRaw).filter(n=>!mapped.has(n)))
      };
    },async upsertAlias(body,actor){
      return {
        alias:await repository.upsertAlias(body,actor)
      };
    },async createRow(body,actor){
      validateInput(body,true);
      await validateCustomer(body);
      return {
        row:await repository.createMonthlyRow(body,actor)
      };
    },async updateMonthlyRow(id,body,actor){
      validateInput(body);
      const snap=await repository.readSnapshot({includeRaw:false});
      const old=snap.monthlyRows.find(r=>r.id===String(id));
      if(!old||String(old.version)!==String(body.version))throw fail(409,'MARKETING_VERSION_CONFLICT','Dòng đã thay đổi. Vui lòng tải lại trước khi lưu.');
      const keys=['reportYear','reportMonth','sale','customer','customerDirectoryId','phone','pageId','page','status','dataSource','closedAt','newCustomer','note'];
      body={...Object.fromEntries(keys.map(k=>[k,old[k]])),...body};
      await validateCustomer(body,id);
      return {
        row:await repository.updateMonthlyRow(id,body.version,body,actor)
      };
    },async audit(id){
      return {
        audit:await repository.listMonthlyAudit(id)
      };
    },async updateRow(){
      throw fail(400,'MARKETING_DATABASE_ROW_REQUIRED','Dùng ID và phiên bản để sửa BC tháng.');
    }
  };
}
module.exports={
  createDatabaseMarketingReportService
};



