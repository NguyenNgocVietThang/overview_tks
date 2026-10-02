'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeaveDbRealtime } = require('./hrLeaveDbRealtime');

test('DB bridge detects external inserts and decisions, ignoring employee notification marker updates', async () => {
  let rows = [{ request_id: 'NP-1', decision_version: '0', co_so: 'Hà Nội' }];
  const events = [];
  const bridge = createLeaveDbRealtime({ load: async () => rows.map(x => ({ ...x })), broadcast: (...args) => events.push(args), logger: { error() {} } });
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
