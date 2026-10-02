'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHrLeaveDecisionService } = require('./hrLeaveDecisionService');

test('shared decision trims optional reason and Telegram passes optimistic final guard', async () => {
  let input;
  const service = createHrLeaveDecisionService({
    repo: { updateLeaveRequestStatus: async (...args) => { input = args; return { request_id: 'NP-1', co_so: 'Hà Nội' }; } }
  });
  await service.decide({ requestId: 'NP-1', user: { id: 'manager', hoTen: 'An', vaiTro: 'Quản lý' }, status: 'Từ chối', note: '  hết người trực  ', channel: 'telegram', expectedVersion: '3' }, { notify: false, broadcast: false });
  assert.equal(input[1].note, 'Người duyệt: An - Quản lý\nLý do từ chối: hết người trực');
  assert.equal(input[1].approver, 'An');
  assert.equal(input[1].expectedVersion, '3');
  assert.equal(input[1].lockFinal, true);
});

test('shared decision preserves unrestricted web editing and rejects invalid notes before writing', async () => {
  let writes = 0;
  const service = createHrLeaveDecisionService({ repo: { updateLeaveRequestStatus: async (_id, data) => {
    writes++;
    assert.equal(data.lockFinal, undefined);
    return { request_id: 'NP-1' };
  } } });
  await service.decide({ requestId: 'NP-1', user: { username: 'm' }, status: 'Chưa duyệt' }, { notify: false, broadcast: false });
  for (const note of [123, 'x'.repeat(501)]) {
    await assert.rejects(service.decide({ requestId: 'NP-1', user: {}, status: 'Từ chối', note }), err => err.code === 'INVALID_NOTE');
  }
  assert.equal(writes, 1);
});

test('decision notifications use request_id and survive notification failures', async () => {
  const events = [];
  const notes = [];
  const service = createHrLeaveDecisionService({
    repo: { updateLeaveRequestStatus: async () => ({ request_id: 'NP-1', co_so: 'Sài Gòn', ho_ten: 'Lan', web_username: 'lan' }) },
    broadcast: (...args) => events.push(args),
    notifyManagers: async (_id, _branch, payload) => notes.push(payload),
    findEmployee: async () => ({ id: 'employee' }),
    notifyEmployee: async payload => { notes.push(payload); throw new Error('unavailable'); },
    logger: { error() {} }
  });
  const updated = await service.decide({ requestId: 'NP-1', user: { id: 'm' }, status: 'Đã duyệt' });
  assert.equal(updated.request_id, 'NP-1');
  assert.equal(events[0][0], 'LEAVE_STATUS_CHANGED');
  assert.ok(notes.every(n => n.relatedId === 'NP-1'));
});
