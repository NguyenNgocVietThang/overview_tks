'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerLeaveRuntime, validateManagerTelegramConfig, loadManagersFromDb } = require('./managerLeaveRuntime');

test('one conflicting linked account does not stop notifications for valid managers', async () => {
  const good = { id: 'good', telegramId: '100', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động', coSo: 'Hà Nội' };
  const managers = await loadManagersFromDb({ selectAll: async () => [{ id: 'conflict', telegramId: '101' }, good],
    resolve: async user => { if (user.id === 'conflict') throw Object.assign(new Error('identity conflict'), { code: 'HR_IDENTITY_CONFLICT' }); return user; },
    logger: { error() {} }
  });
  assert.deepEqual(managers, [good]);
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
    getManager: async () => user,
    leaveRepo: { getLeaveRequestById: async () => ({ request_id: 'NP-1', co_so: 'Hà Nội', loai_yeu_cau: 'Xin nghỉ phép', decision_version: '1', trang_thai: 'Đã duyệt' }) },
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
