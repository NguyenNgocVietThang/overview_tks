'use strict';
const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { createMarketingReportService } = require('./marketingReportService');
const { createExportFile, tableRows, exportFieldsFor, resolveColumnKeys } = require('./marketingReportExport');

function createMarketingReportRouter({service=createMarketingReportService()}={}) {
  const router=express.Router();
  router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use(requireAuth,requireFeature('reports.marketing'));
  const handle=fn=>async(req,res)=>{
    try{res.json(await fn(req));}catch(error){
      if(error.statusCode && error.code?.startsWith('MARKETING_'))return res.status(error.statusCode).json({error:error.message,code:error.code});
      console.error('[MarketingReport] Request failed:',error.code||'UNKNOWN');
      res.status(500).json({error:'Không tải được báo cáo Marketing. Vui lòng thử lại.',code:'MARKETING_REPORT_ERROR'});
    }
  };
  router.get('/metadata',handle(()=>service.metadata()));
  for(const kind of ['monthly','receipt-check','phones','costs'])router.get('/'+kind,handle(req=>service.report(kind,req.query)));
  router.get('/detail',handle(req=>service.detail(req.query)));
  // Xuất bảng ra Excel/HTML: cần đồng thời reports.marketing (router.use ở trên) và reports.export.
  const exportContext=async req=>{
    const kind=String(req.query.kind||''),table=String(req.query.table||'');
    if(!['monthly','receipt-check','phones','costs'].includes(kind)||!['summary','rows'].includes(table)){
      const e=new Error('Bảng xuất không hợp lệ.');e.statusCode=400;e.code='MARKETING_EXPORT_INVALID';throw e;
    }
    const {kind:_k,table:_t,q,columns,format,...filters}=req.query;
    const result=await service.report(kind,filters);
    return {kind,table,result,rows:tableRows(table,result,q)};
  };
  router.get('/export/fields',requireFeature('reports.export'),handle(async req=>{
    const {kind,table,result,rows}=await exportContext(req);
    return exportFieldsFor(kind,table,result,rows);
  }));
  router.get('/export',requireFeature('reports.export'),async(req,res)=>{
    try{
      const {kind,table,result,rows}=await exportContext(req);
      const keys=resolveColumnKeys(kind,table,result,req.query.columns);
      const file=await createExportFile(kind,table,String(req.query.format||'xlsx'),result,rows,keys);
      res.set('Content-Type',file.mimeType);
      res.set('Content-Disposition',`attachment; filename="${file.fileName}"`);
      res.send(file.buffer);
    }catch(error){
      if(error.statusCode&&error.code?.startsWith('MARKETING_'))return res.status(error.statusCode).json({error:error.message,code:error.code});
      console.error('[MarketingReport] Export failed:',error.code||'UNKNOWN');
      res.status(500).json({error:'Không xuất được báo cáo Marketing. Vui lòng thử lại.',code:'MARKETING_REPORT_ERROR'});
    }
  });
  return router;
}
module.exports={createMarketingReportRouter};
