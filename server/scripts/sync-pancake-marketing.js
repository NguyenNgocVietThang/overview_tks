'use strict';
const fs=require('node:fs');const {PAGE_IDS}=require('../marketingReport/marketingRepository');const {safeError}=require('../marketingReport/pancakeClient');const {latestDueSlot}=require('../marketingReport/pancakeScheduler');
function dateOfSlot(slot){return new Date(slot+7*3600000).toISOString().slice(0,10);}
async function main(args,{run,stdout=console.log,stderr=console.error,now=()=>new Date()}={}) {
 try {const options={apply:false,dryRun:false,retry:false,date:dateOfSlot(latestDueSlot(now())),reportFile:null};
  for(let i=0;i<args.length;i++){const flag=args[i];if(flag==='--help'){stdout('Readonly Pancake marketing sync: node server/scripts/sync-pancake-marketing.js [--date YYYY-MM-DD] [--dry-run | --apply] [--retry] [--report-file PATH]\nDefault dry-run performs no API or DB access. --apply deliberately commits six page results; --retry permits one extra attempt per daily slot.');return 0;}if(flag==='--apply')options.apply=true;else if(flag==='--dry-run')options.dryRun=true;else if(flag==='--retry')options.retry=true;else if(flag==='--date'||flag==='--report-file'){const value=args[++i];if(!value||value.startsWith('--'))throw safeError('INVALID_MARKETING_INPUT');options[flag==='--date'?'date':'reportFile']=value;}else throw safeError('INVALID_MARKETING_INPUT');}
  if(options.apply&&options.dryRun||options.retry&&!options.apply||!/^\d{4}-\d{2}-\d{2}$/.test(options.date)||!Number.isFinite(+new Date(options.date+'T00:00:00Z'))||new Date(options.date+'T00:00:00Z').toISOString().slice(0,10)!==options.date)throw safeError('INVALID_MARKETING_INPUT');
  let summary;
  if(!options.apply)summary={mode:'dry-run',slotDate:options.date,pageIds:PAGE_IDS,schedule:'23:55 Asia/Ho_Chi_Minh',requiresApply:true};
  else {if(!run){require('../config');run=require('../marketingReport/pancakeSync').createPancakeSync().run;}const result=await run({slotDate:options.date,retry:options.retry});summary={mode:'apply',id:result.id,status:result.status,runKey:result.runKey,replayed:result.replayed||false,skipped:result.skipped,pages:result.pages?.map(p=>({pageId:p.pageId,status:p.status,errorCode:p.errorCode,inputCount:p.inputCount,newFacts:p.newFacts,newObservations:p.newObservations})),unresolved:result.unresolved||[],unlinkedHistoricalRows:result.unlinkedHistoricalRows||[],baselineSkipped:result.baselineSkipped||[]};}
  const text=JSON.stringify(summary,null,2);if(options.reportFile)fs.writeFileSync(options.reportFile,text+'\n','utf8');stdout(text);return options.apply&&(summary.status==='error'||summary.skipped)?2:0;
 }catch(error){stderr(safeError(error.code).code);return 1;}
}
if(require.main===module)main(process.argv.slice(2)).then(async code=>{process.exitCode=code;if(process.argv.includes('--apply')){try{await require('../db/pool').getPool().end();}catch{}}});
module.exports={main};
