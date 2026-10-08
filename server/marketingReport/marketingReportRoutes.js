'use strict';
const express = require('express');
const { requireAuth, requireFeature } = require('../auth/authMiddleware');
const { createMarketingReportService } = require('./marketingReportService');

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
  return router;
}
module.exports={createMarketingReportRouter};
