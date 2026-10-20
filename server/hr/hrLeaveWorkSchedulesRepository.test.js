'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('schedule repository reads absent rows and validates time/date before writing',async()=>{
 const filename=__dirname+'/hrLeaveWorkSchedulesRepository.js';assert.ok(fs.existsSync(filename),'schedule repository exists');
 const {createHrLeaveWorkSchedulesRepository}=require('./hrLeaveWorkSchedulesRepository');
 const calls=[];const repo=createHrLeaveWorkSchedulesRepository({pool:{query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}}});
 assert.deepEqual(await repo.getSchedule('1','2026-10-08'),{employeeId:'1',date:'2026-10-08',morningStart:'07:45',afternoonStart:'12:30',version:'0'});
 for(const patch of [{date:'2026-02-30',morningStart:'08:00',afternoonStart:null},{date:'2026-10-08',morningStart:'24:00',afternoonStart:null},{date:'2026-10-08',morningStart:null,afternoonStart:'12:99'}]) await assert.rejects(repo.setSchedule('1',patch));
 assert.equal(calls.length,1);
});

test('schedule repository reads and writes schedules by account user_id',async()=>{
 const {createHrLeaveWorkSchedulesRepository}=require('./hrLeaveWorkSchedulesRepository');
 const calls=[];
 const pool={query:async(sql,params)=>{calls.push({sql,params});return {rows:[]};}};
 const repo=createHrLeaveWorkSchedulesRepository({pool});
 const userId='11111111-1111-4111-8111-111111111111';
 const schedule=await repo.getScheduleForUser(userId,'2026-10-08');
 assert.equal(schedule.userId,userId);
 assert.match(calls[0].sql,/WHERE user_id=\$1/);
 await repo.setScheduleForUser(userId,{date:'2026-10-08',morningStart:'08:00',afternoonStart:'13:00'});
 assert.match(calls[1].sql,/ON CONFLICT\(user_id,work_date\)/);
});
