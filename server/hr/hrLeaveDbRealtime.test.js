'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeaveDbRealtime } = require('./hrLeaveDbRealtime');

test('DB bridge preserves deleted record branch and owner for scoped deletion events',async()=>{
 let rows=[{request_id:'SG',decision_version:'1',branch:'saigon',user_id:'owner'}];const events=[];
 const bridge=createLeaveDbRealtime({loadVersions:async()=>rows,broadcast:(...args)=>events.push(args)});
 await bridge.poll();rows=[];await bridge.poll();await bridge.poll();
 assert.equal(events.length,1);assert.equal(events[0][0],'LEAVE_REQUEST_DELETED');
 assert.deepEqual(events[0][1],{request_id:'SG',user_id:'owner',co_so:'Sài Gòn'});assert.equal(events[0][2],'Sài Gòn');
});

test('DB bridge detects external inserts and decisions, ignoring employee notification marker updates', async () => {
  let rows = [{ request_id: 'NP-1', decision_version: '0', co_so: 'Hà Nội' }];
  const events = [];
  const bridge = createLeaveDbRealtime({ loadVersions: async () => rows.map(x => ({ request_id: x.request_id, decision_version: x.decision_version })), loadRecord: async id => ({ ...rows.find(x => x.request_id === id) }), broadcast: (...args) => events.push(args), logger: { error() {} } });
  await bridge.poll();
  assert.equal(events.length, 0);
  rows[0].updated_at = 'new';
  await bridge.poll();
  assert.equal(events.length, 0);
  rows[0].decision_version = '1';
  rows[0].trang_thai = 'Đã duyệt';
  rows.push({ request_id: 'NP-2', decision_version: '0', co_so: 'Sài Gòn' });
  await bridge.poll();
  assert.deepEqual(events.map(x => x[0]), ['LEAVE_STATUS_CHANGED', 'LEAVE_REQUEST_CREATED']);
  await bridge.poll();
  assert.equal(events.length, 2);
});

test('DB bridge polling loads full records only for new or changed ids', async () => {
  let rows = [{ request_id: 'A', decision_version: '0' }, { request_id: 'B', decision_version: '0' }];
  const fetched = [];
  const events = [];
  const bridge = createLeaveDbRealtime({
    loadVersions: async () => rows.map(x => ({ ...x })),
    loadRecord: async id => { fetched.push(id); return { request_id: id, co_so: 'Hà Nội' }; },
    broadcast: (...a) => events.push(a), logger: { error() {} }
  });
  await bridge.poll(); await bridge.poll();
  assert.deepEqual(fetched, []);
  rows = [{ request_id: 'A', decision_version: '1' }, { request_id: 'B', decision_version: '0' }, { request_id: 'C', decision_version: '0' }];
  await bridge.poll();
  assert.deepEqual(fetched, ['A', 'C']);
  assert.deepEqual(events.map(e => e[0]), ['LEAVE_STATUS_CHANGED', 'LEAVE_REQUEST_CREATED']);
});
