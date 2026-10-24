'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const notificationRepo = require('../notifications/notificationRepository');
const { useNotificationTestPool } = require('../notifications/testHelpers/notificationTestPool');
const { createLeaveBellNotifier, startLeaveBellSchedule, TYPE } = require('./hrLeaveBellNotifier');

let store;
test.before(async () => {
  store = await useNotificationTestPool();
  await store.db.exec(`CREATE TABLE hr_leave_requests (
    request_id TEXT PRIMARY KEY, source TEXT NOT NULL, trang_thai TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
});
test.after(() => store.close());
test.beforeEach(async () => {
  await store.reset();
  await store.db.exec('TRUNCATE hr_leave_requests');
});

const pool = () => ({ connect: async () => ({ query: (sql, params) => store.db.query(sql, params), release() {} }) });

async function addRequest(requestId, { source = 'telegram', status = 'Chưa duyệt', ageMs = 0 } = {}) {
  await store.db.query('INSERT INTO hr_leave_requests VALUES ($1, $2, $3, now() - ($4::bigint * interval \'1 millisecond\'))',
    [requestId, source, status, ageMs]);
}

function notifier({ approvers = ['quan', 'thang'], routingFor } = {}) {
  return createLeaveBellNotifier({
    pool: pool(),
    repo: { getLeaveRequestById: async id => ({ request_id: id, ho_ten: 'CHU MINH VŨ', thoi_gian_bat_dau: 'Sáng 25/10/2026', thoi_gian_ket_thuc: 'Chiều 25/10/2026' }) },
    authorization: { routingFor: routingFor || (async () => ({ users: approvers.map(id => ({ id })) })) },
    log: () => {}
  });
}

test('đơn Telegram chưa duyệt -> báo chuông cho người duyệt, lượt sau không báo trùng', async () => {
  await addRequest('NP-1');
  const job = notifier();
  assert.deepEqual((await job.runOnce()).sent, [{ requestId: 'NP-1', recipients: 2 }]);
  assert.deepEqual((await job.runOnce()).sent, []);

  const [bell] = await notificationRepo.listForUser('quan');
  assert.equal(bell.type, TYPE);
  assert.equal(bell.relatedType, 'leaveRequest');
  assert.equal(bell.relatedId, 'NP-1');
  assert.equal(bell.title, 'Có yêu cầu nghỉ phép mới');
  assert.equal(bell.message, 'CHU MINH VŨ vừa gửi yêu cầu nghỉ phép từ Sáng 25/10/2026 đến Chiều 25/10/2026.');
  assert.equal((await notificationRepo.listForUser('thang')).length, 1);
});

test('người gửi đơn cũng là người duyệt phòng mình thì không tự nhận chuông', async () => {
  await addRequest('NP-self');
  const job = createLeaveBellNotifier({
    pool: pool(),
    repo: { getLeaveRequestById: async id => ({ request_id: id, user_id: 'tho', ho_ten: 'VŨ THỊ THƠ' }) },
    authorization: { routingFor: async () => ({ users: [{ id: 'tho' }, { id: 'thang' }] }) },
    log: () => {}
  });
  assert.deepEqual((await job.runOnce()).sent, [{ requestId: 'NP-self', recipients: 1 }]);
  assert.equal((await notificationRepo.listForUser('tho')).length, 0);
  assert.equal((await notificationRepo.listForUser('thang'))[0].message, 'VŨ THỊ THƠ vừa gửi yêu cầu nghỉ phép.');
});

test('bỏ qua đơn gửi qua web, đơn đã duyệt và đơn quá 24 giờ', async () => {
  await addRequest('NP-web', { source: 'web' });
  await addRequest('NP-done', { status: 'Đã duyệt' });
  await addRequest('NP-old', { ageMs: 25 * 60 * 60 * 1000 });
  assert.deepEqual((await notifier().runOnce()).sent, []);
});

test('đơn đã có chuông leave_request_created (vd tạo từ route cũ) thì không báo lại', async () => {
  await addRequest('NP-2');
  await store.seed([{ recipientUserId: 'quan', type: TYPE, relatedType: 'leaveRequest', relatedId: 'NP-2' }]);
  assert.deepEqual((await notifier().runOnce()).sent, []);
});

test('chưa có người duyệt thì chờ, có người duyệt ở lượt sau thì báo', async () => {
  await addRequest('NP-3');
  assert.deepEqual((await notifier({ approvers: [] }).runOnce()).sent, []);
  assert.deepEqual((await notifier().runOnce()).sent, [{ requestId: 'NP-3', recipients: 2 }]);
});

test('lỗi giữa lượt thì rollback, không throw, không ghi chuông nửa chừng', async (t) => {
  t.mock.method(console, 'error', () => {});
  await addRequest('NP-4');
  await addRequest('NP-5');
  let calls = 0;
  const failing = notifier({ routingFor: async () => { if (++calls === 2) throw new Error('db down'); return { users: [{ id: 'quan' }] }; } });
  assert.deepEqual((await failing.runOnce()).sent, []);
  assert.equal((await notificationRepo.listForUser('quan')).length, 0);
  assert.equal((await notifier().runOnce()).sent.length, 2);
});

test('startLeaveBellSchedule chạy ngay rồi theo chu kỳ, bỏ lượt khi lượt trước chưa xong', async () => {
  let runs = 0;
  let release;
  const notifierStub = { runOnce: () => { runs++; return new Promise(resolve => { release = resolve; }); } };
  let tick;
  startLeaveBellSchedule({ notifier: notifierStub, setIntervalFn: fn => { tick = fn; return {}; }, scheduleImmediate: fn => fn() });
  assert.equal(runs, 1);
  await tick();
  assert.equal(runs, 1);
  release();
  await new Promise(resolve => setImmediate(resolve));
  tick();
  assert.equal(runs, 2);
  release();
});
