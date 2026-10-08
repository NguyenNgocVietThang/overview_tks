'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rules = fs.existsSync(__dirname + '/hrLeaveTiming.js') ? require('./hrLeaveTiming') : {};
const range = (start, end = start) => ({start_date:start,start_session:'Sáng',end_date:end,end_session:'Chiều'});
test('calendar deadline uses actual selected sessions, weekends and Vietnam exclusive midnight', () => {
  assert.equal(typeof rules.normalizeCalendar, 'function');
  const tuesday = rules.normalizeCalendar(range('2026-10-06'));
  const timing = rules.calculateTiming(tuesday, {morningStart:'08:15',version:'2'}, '2026-10-04T16:59:59.999Z');
  assert.equal(timing.deadlineDate,'2026-10-04'); assert.equal(timing.deadlineExclusiveAt,'2026-10-04T17:00:00.000Z');
  assert.equal(timing.timingStatus,'Đúng hạn');
  assert.equal(rules.calculateTiming(tuesday,{morningStart:'08:15',version:'2'},'2026-10-04T17:00:00Z').timingStatus,'Xin muộn');
  assert.equal(rules.calculateTiming(tuesday,{morningStart:'08:15',version:'2'},'2026-10-06T01:15:00Z').timingStatus,'Vi phạm');
  assert.equal(rules.calculateTiming(rules.normalizeCalendar(range('2026-10-08','2026-10-09')),{morningStart:'08:15',version:'2'},'2026-10-01').deadlineDate,'2026-10-05');
  const selected=rules.normalizeCalendar({leave_sessions:[{date:'2026-10-09',session:'Chiều'},{date:'2026-10-06',session:'Sáng'}]});
  assert.equal(selected.totalSessions,2);assert.equal(rules.calculateTiming(selected,{morningStart:'08:15',version:'2'},'2026-10-01').deadlineDate,'2026-10-04');
});
test('calendar validation rejects duplicates, empty and impossible dates; missing schedule never defaults',()=>{
  assert.equal(typeof rules.normalizeCalendar,'function');
  for(const body of [{leave_sessions:[]},{leave_sessions:[{date:'2026-02-30',session:'Sáng'}]},{leave_sessions:[{date:'2026-10-06',session:'Sáng'},{date:'2026-10-06',session:'Sáng'}]},range('2026-02-30')]) assert.throws(()=>rules.normalizeCalendar(body));
  assert.throws(()=>rules.calculateTiming(rules.normalizeCalendar(range('2026-10-06')),null,'2026-10-01'),{code:'LEAVE_SCHEDULE_REQUIRED'});
  assert.equal(rules.calculateTiming(rules.normalizeCalendar(range('2028-03-01')),{morningStart:'00:01',version:1},'2028-02-01').deadlineDate,'2028-02-28');
  assert.equal(rules.calculateTiming(rules.normalizeCalendar(range('2027-01-01')),{morningStart:'00:01',version:1},'2026-12-01').deadlineDate,'2026-12-30');
});
