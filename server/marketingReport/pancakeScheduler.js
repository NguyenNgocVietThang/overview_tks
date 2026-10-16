'use strict';
const {createPancakeSync}=require('./pancakeSync');
const {safeError}=require('./pancakeClient');
const DAY=86400000,OFFSET=7*3600000;
function latestDueSlot(date){const local=new Date(+date+OFFSET);const midnight=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());const today=midnight+(23*60+55)*60000-OFFSET;return +date>=today?today:today-DAY;}
function slotDate(slot){return new Date(slot+OFFSET).toISOString().slice(0,10);}
function createPancakeScheduler({enabled=process.env.PANCAKE_MARKETING_SYNC_ENABLED==='true',sync,now=()=>new Date(),setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,logger=console}={}) {
 let timer=null,started=false,stopped=false,lastSlot=null;
 function schedule(){if(stopped)return;let next=lastSlot+DAY;if(next<=+now())next=latestDueSlot(now());timer=setTimeoutFn(()=>tick(next),Math.max(0,next-+now()));timer.unref?.();}
 async function tick(slot){if(stopped)return;lastSlot=slot;try{sync??=createPancakeSync();await sync.run({slotDate:slotDate(slot)});}catch(error){logger.error('[Pancake Marketing] '+safeError(error.code).code);}finally{schedule();}}
 async function start(){if(!enabled||started)return;started=true;stopped=false;await tick(latestDueSlot(now()));}
 function stop(){stopped=true;if(timer!==null)clearTimeoutFn(timer);timer=null;}
 return {start,stop};
}
module.exports={createPancakeScheduler,latestDueSlot};
