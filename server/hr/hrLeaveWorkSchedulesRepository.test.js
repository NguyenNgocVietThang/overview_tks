'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('schedule repository reads absent rows and validates time/date before writing',async()=>{
 const filename=__dirname+'/hrLeaveWorkSchedulesRepository.js';assert.ok(fs.existsSync(filename),'schedule repository exists');
 const {createHrLeaveWorkSchedulesRepository}=require('./hrLeaveWorkSchedulesRepository');
 const calls=[];const repo=createHrLeaveWorkSchedulesRepository({pool:{query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}}});
 assert.equal(await repo.getSchedule('1','2026-10-08'),null);
 for(const patch of [{date:'2026-02-30',morningStart:'08:00',afternoonStart:null},{date:'2026-10-08',morningStart:'24:00',afternoonStart:null},{date:'2026-10-08',morningStart:null,afternoonStart:'12:99'}]) await assert.rejects(repo.setSchedule('1',patch));
 assert.equal(calls.length,1);
});
