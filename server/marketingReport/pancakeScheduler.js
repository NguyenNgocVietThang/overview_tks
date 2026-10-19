'use strict';
const {createPancakeSync}=require('./pancakeSync');
const {safeError}=require('./pancakeClient');
const DAY=86400000,OFFSET=7*3600000;
function latestDueSlot(date){const local=new Date(+date+OFFSET);const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());const today=midnight+(23*60+55)*60000-OFFSET;return +date>=today?today:today-DAY;}
function slotDate(slot){return new Date(slot+OFFSET).toISOString().slice(0,10);}
// Chi phí ADS (Google Sheets -> bảng marketing_ads_costs) chạy cùng vòng đời với job Pancake, không phụ thuộc lịch 23:55.
// Chỉ tự tạo khi chạy thật (không inject sync) để test lịch Pancake không bị timer phụ làm nhiễu.
function lazyAdsJob(){let handle=null;return {start(){handle=require('./marketingAdsSync').startAdsSchedule();},stop(){handle?.stop();handle=null;}};}
function createPancakeScheduler({enabled=process.env.PANCAKE_MARKETING_SYNC_ENABLED==='true',sync,ads,now=()=>new Date(),setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,logger=console}={}) {
 let timer=null,started=false,stopped=false,lastSlot=null;
 const adsJob=ads!==undefined?ads:(sync===undefined?lazyAdsJob():null);
 function schedule(){if(stopped)return;let next=lastSlot+DAY;if(next<=+now())next=latestDueSlot(now());timer=setTimeoutFn(()=>tick(next),Math.max(0,next-+now()));timer.unref?.();}
 async function tick(slot){if(stopped)return;lastSlot=slot;try{sync??=createPancakeSync();await sync.run({slotDate:slotDate(slot)});}catch(error){logger.error('[Pancake Marketing] '+safeError(error.code).code);}finally{schedule();}}
 async function start(){if(!enabled||started)return;started=true;stopped=false;try{adsJob?.start();}catch{logger.error('[Pancake Marketing] ADS_SYNC_START_FAILED');}await tick(latestDueSlot(now()));}
 function stop(){stopped=true;if(timer!==null)clearTimeoutFn(timer);timer=null;try{adsJob?.stop();}catch{}}
 return {start,stop};
}
module.exports={createPancakeScheduler,latestDueSlot};
