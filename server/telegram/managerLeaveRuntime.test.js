'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerLeaveRuntime, validateManagerTelegramConfig, loadManagersFromDb } = require('./managerLeaveRuntime');

test('one conflicting linked account does not stop notifications for valid managers', async () => {
  const good = { id: 'good', telegramId: '100', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động', coSo: 'Hà Nội',assignedCoSo:'Hà Nội',leaveApprovalDepartments:['Kho'] };
  const managers = await loadManagersFromDb({ selectAll: async () => [{ id: 'conflict', telegramId: '101' }, good],
    resolve: async user => { if (user.id === 'conflict') throw Object.assign(new Error('identity conflict'), { code: 'HR_IDENTITY_CONFLICT' }); return user; },
    logger: { error() {} }
  });
  assert.deepEqual(managers, [good]);
});

test('default manager loader preserves assigned DB scope and live account revocations without HR writes', async () => {
  const base = { id: 'manager', telegramId: '100', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động', coSo: 'Hà Nội', hrManaged: true, sheetCoSo: 'Cả hai' };
  const locked = { ...base, id: 'locked', telegramId: '101', trangThai: 'Khóa' };
  const revoked = { ...base, id: 'revoked', telegramId: '102', featurePermissions: { 'hr.leave.manage': false } };
  const unassigned = { ...base, id: 'unassigned', telegramId: '103', coSo: '' };
  const rows = [base, locked, revoked, unassigned];
  const managers = await loadManagersFromDb({ selectAll: async () => rows });
  assert.deepEqual(managers.map(m => m.id), ['manager', 'unassigned']);
  assert.equal(managers[0].coSo, 'Hà Nội');
  assert.equal(managers[1].coSo, '', 'scope matcher will exclude this unchanged blank scope');
  assert.equal(locked.trangThai, 'Khóa');
  assert.equal(revoked.featurePermissions['hr.leave.manage'], false);
});

test('permanently blocked Telegram effects finish so deferred web notifications still run', async () => {
  let notified = 0;
  let completed = false;
  const runtime = createManagerLeaveRuntime({ store: {
    handleUpdate: async () => [{ method: 'sendMessage', params: { chat_id: '100', text: 'done' } }, { method: 'notifyDecision', request: { request_id: 'NP-1' } }],
    completeEffect: async () => true, completeUpdate: async () => { completed = true; },
    retryUpdate: async () => assert.fail('permanent 403 should not retry forever')
  }, telegram: { call: async () => { throw Object.assign(new Error('blocked'), { code: 403 }); } },
  notifyDecision: async () => { notified++; }, logger: { error() {} } });
  await runtime.processUpdate({ update_id: '1', effects_done: 0 });
  assert.equal(notified, 1);
  assert.equal(completed, true);
});

test('enabled bot requires HTTPS origin, dedicated token and a valid webhook secret', () => {
  assert.throws(() => validateManagerTelegramConfig({ HR_MANAGER_TELEGRAM_ENABLED: true }), /cấu hình/);
  assert.equal(validateManagerTelegramConfig({ HR_MANAGER_TELEGRAM_ENABLED: false }), false);
  assert.equal(validateManagerTelegramConfig({ HR_MANAGER_TELEGRAM_ENABLED: true, HR_MANAGER_TELEGRAM_BOT_TOKEN: 'test', HR_MANAGER_TELEGRAM_WEBHOOK_SECRET: 'valid-secret', HR_MANAGER_TELEGRAM_WEB_URL: 'https://example.com' }), true);
});

test('runtime retries Telegram effect without applying the decision twice', async () => {
  let executions = 0;
  let sends = 0;
  let retries = 0;
  const job = { update_id: 1, payload: { update_id: 1 }, effects_done: 0 };
  let effects;
  const store = {
    handleUpdate: async (_job, handler) => effects || (effects = await handler({ store: {}, leaveRepo: {} })),
    completeEffect: async (_job, count) => { job.effects_done = count; return true; },
    completeUpdate: async () => { job.done = true; },
    retryUpdate: async () => { retries++; }
  };
  const runtime = createManagerLeaveRuntime({ store, telegram: { call: async () => { if (++sends === 1) throw Object.assign(new Error('rate limit'), { code: 429, retryAfter: 1 }); return {}; } },
    botFactory: () => ({ handleUpdate: async () => { executions++; return [{ method: 'sendMessage', params: { chat_id: '1', text: 'done' } }]; } }),
    logger: { error() {} }
  });
  await runtime.processUpdate(job);
  assert.equal(retries, 1);
  await runtime.processUpdate(job);
  assert.equal(executions, 1);
  assert.equal(sends, 2);
  assert.equal(job.done, true);
});

test('delivery retries message edits after network failure, but rejects revoked recipients', async () => {
  const queued = [];
  const job = { id: '1', request_id: 'NP-1', user_id: 'm', telegram_chat_id: '123', message_id: '5', desired_version: '1' };
  let user = { id: 'm', telegramId: '123', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động', coSo: 'Hà Nội' };
  const runtime = createManagerLeaveRuntime({
    store: { finishDelivery: async (_job, data) => queued.push(data), retryDelivery: async () => queued.push('retry') },
    getManager: async () => user, loadManagers:async()=>user ? [user] : [],
    leaveRepo: { getLeaveRequestById: async () => ({ request_id: 'NP-1', co_so: 'Hà Nội', bo_phan:'Kho', loai_yeu_cau: 'Xin nghỉ phép', decision_version: '1', trang_thai: 'Đã duyệt' }) },
    telegram: { call: async method => { assert.equal(method, 'editMessageText'); throw Object.assign(new Error('network'), { code: 'TELEGRAM_UNAVAILABLE' }); } },
    logger: { error() {} }
  });
  await runtime.processDelivery(job);
  assert.equal(queued[0], 'retry');
  user = null;
  // Revoked recipients get no new details; only remove old buttons.
  runtime.telegram.call = async (method, params) => { assert.equal(method, 'editMessageReplyMarkup'); assert.deepEqual(params.reply_markup.inline_keyboard, []); return {}; };
  await runtime.processDelivery(job);
  assert.equal(queued[1].blocked, true);
});

test('slow outbound card delivery never blocks a freshly enqueued callback decision',async()=>{
 let deliveryStarted, releaseDelivery;const started=new Promise(r=>deliveryStarted=r),blocked=new Promise(r=>releaseDelivery=r);let handled=false,update;
 const user={id:'m',telegramId:'123',vaiTro:'Quản lý',trangThai:'Đang hoạt động',coSo:'Hà Nội',assignedCoSo:'Hà Nội',leaveApprovalDepartments:['Kho']};
 let first=true;const store={activate:async()=>new Date(),requeueStaleCards:async()=>{},claimUpdates:async()=>update ? [Object.assign({},update, {payload:{callback_query:{id:'cb',message:{chat:{id:123}}}}})].splice(0,1).map(j=>{update=null;return j;}) : [],handleUpdate:async(_job,handler)=>{handled=true;return [];},completeUpdate:async()=>{},retryUpdate:async()=>{},claimEvents:async()=>[],enqueueDelivery:async()=>{},claimDeliveries:async()=>first?(first=false,[{request_id:'NP-1',user_id:'m',telegram_chat_id:'123',desired_version:'1'}]):[],finishDelivery:async()=>{}};
 const runtime=createManagerLeaveRuntime({store,getManager:async()=>user,loadManagers:async()=>[user],authorization:{canDecide:async()=>true},leaveRepo:{getLeaveRequests:async()=>[],getLeaveRequestById:async()=>({request_id:'NP-1',co_so:'Hà Nội',bo_phan:'Kho',loai_yeu_cau:'Xin nghỉ phép',decision_version:'1'})},telegram:{call:async()=>{deliveryStarted();await blocked;return {message_id:1};}},logger:{error(){}}});
 const draining=runtime.drain();await started;update={update_id:'2'};const inbox=runtime.drainInbox();await inbox;assert.equal(handled,true);releaseDelivery();await draining;
});
test('all active web approvers participate before Telegram linkage filtering',async()=>{
 const user={id:'staff',vaiTro:'Nhân viên kho',trangThai:'Đang hoạt động',featurePermissions:{'hr.leave.manage':true},assignedCoSo:'Hà Nội',leaveApprovalDepartments:['Kho']};
 const managers=await loadManagersFromDb({selectAll:async()=>[user]});assert.deepEqual(managers,[user]);
});
