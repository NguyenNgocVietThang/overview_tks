'use strict';

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{}';
process.env.JWT_SECRET = 'test';
process.env.SUPABASE_DB_URL = '';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createManagerLeaveBot, isEligibleManager, managerMatchesBranch } = require('./managerLeaveBot');

const USER = {
  id: 'f4c46cbf-d763-47cc-83d3-bbddbdfdffed', vaiTro: 'Quản lý', trangThai: 'Đang hoạt động',
  hoTen: 'Quản lý A', username: 'manager', telegramId: '123', coSo: 'Hà Nội', featurePermissions: {}
};

function fixture({ user = USER, patch = {}, error } = {}) {
  const rows = new Map([['NP-20261002-001', { request_id: 'NP-20261002-001', loai_yeu_cau: 'Xin nghỉ phép', co_so: 'Hà Nội', trang_thai: 'Chưa duyệt', decision_version: '1', ghi_chu_duyet: '', ...patch }]]);
  const sessions = new Map();
  const deliveries = new Map([['NP-20261002-001', { request_id: 'NP-20261002-001', user_id: USER.id, telegram_chat_id: '123', message_id: 10 }]]);
  const changes = [];
  const wakes = [];
  let sessionSequence = 0;
  const store = {
    async getDelivery(requestId, userId, chatId) {
      const row = deliveries.get(requestId);
      return row && row.user_id === userId && String(row.telegram_chat_id) === String(chatId) ? row : null;
    },
    async getSession(chatId) { return sessions.get(String(chatId)) || null; },
    async saveSession({ chatId, userId, requestId, expectedVersion }) {
      const row = { session_id: `00000000-0000-4000-8000-${String(++sessionSequence).padStart(12, '0')}`,
        user_id: userId, request_id: requestId, expected_version: expectedVersion,
        telegram_chat_id: String(chatId), prompt_message_id: null, expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
      sessions.set(String(chatId), row);
      return row;
    },
    async deleteSession(chatId, sessionId) {
      const row = sessions.get(String(chatId));
      if (row && (!sessionId || row.session_id === sessionId)) sessions.delete(String(chatId));
    },
    async wakeDeliveries(chatId) { wakes.push(String(chatId)); }
  };
  const leaveRepo = {
    async getLeaveRequestById(id, branches) {
      assert.deepEqual(branches, ['Hà Nội', 'Sài Gòn']);
      return rows.get(id) || null;
    }
  };
  const decide = async input => {
    if (error) throw error;
    const row = rows.get(input.requestId);
    changes.push(input);
    row.trang_thai = input.status;
    row.ghi_chu_duyet = input.note;
    row.decision_version = String(BigInt(row.decision_version) + 1n);
    return row;
  };
  const makeBot = () => createManagerLeaveBot({ store, leaveRepo, decide, getManager: async () => user, webUrl: 'https://dashboard.example/hr' });
  return { bot: makeBot(), makeBot, rows, sessions, deliveries, changes, wakes };
}

function callback(data = 'd|NP-20261002-001|1|a', patch = {}) {
  return { callback_query: { id: 'cb1', from: { id: 123 }, data,
    message: { message_id: 10, chat: { id: 123, type: 'private' } }, ...patch } };
}

function message(text, patch = {}) {
  return { message: { message_id: 20, from: { id: 123 }, chat: { id: 123, type: 'private' }, text, ...patch } };
}

async function beginRejection(f) {
  const effects = await f.bot.handleUpdate(callback('d|NP-20261002-001|1|r'));
  const session = f.sessions.get('123');
  session.prompt_message_id = 11;
  return { effects, session };
}

test('only existing active managers with permission and matching Telegram ID are eligible', () => {
  assert.equal(isEligibleManager(USER, 123), true);
  for (const patch of [{ vaiTro: 'Nhân viên kho', permissions: ['hr.leave.manage'] }, { trangThai: 'Không hoạt động' },
    { isDeleted: true }, { telegramId: '999' }, { telegramId: '' }, { featurePermissions: { 'hr.leave.manage': false } }]) {
    assert.equal(isEligibleManager({ ...USER, ...patch }, 123), false);
  }
  assert.equal(isEligibleManager(null, 123), false);
});

test('manager scope is strict even though the web allows both branches', () => {
  for (const [scope, branch, want] of [['Hà Nội', 'Hà Nội', true], ['Hà Nội', 'Sài Gòn', false], ['Sài Gòn', 'Sài Gòn', true],
    ['Cả hai', 'Hà Nội', true], ['Cả hai', 'Sài Gòn', true], ['', 'Hà Nội', false], ['Cả hai', '', false]]) {
    assert.equal(managerMatchesBranch({ ...USER, coSo: scope }, branch), want);
  }
});

test('start wakes pending deliveries and explains branch scope; help explains final decisions', async () => {
  const f = fixture();
  const effects = await f.bot.handleUpdate(message('/start'));
  assert.deepEqual(f.wakes, ['123']);
  assert.ok(effects.some(effect => effect.method === 'sendMessage' && effect.params.text.includes('Hà Nội')));
  const help = await f.bot.handleUpdate(message('/help'));
  for (const text of ['Phê duyệt', 'Đã duyệt', 'Từ chối', 'web']) {
    assert.ok(help.some(effect => effect.params.text.includes(text)), text);
  }
  for (const text of ['Chưa duyệt', 'Tạm duyệt', 'Vi phạm']) {
    assert.ok(help.every(effect => !effect.params.text.includes(text)), text);
  }
});

test('unauthorized and group updates cannot start sessions or decisions', async () => {
  for (const user of [null, { ...USER, coSo: '' }, { ...USER, trangThai: 'Khóa' }, { ...USER, vaiTro: 'Nhân viên kho', permissions: ['hr.leave.manage'] }]) {
    const f = fixture({ user });
    await f.bot.handleUpdate(callback('d|NP-20261002-001|1|r'));
    assert.equal(f.sessions.size, 0);
    assert.equal(f.changes.length, 0);
  }
  const f = fixture();
  await f.bot.handleUpdate(callback(undefined, { message: { message_id: 10, chat: { id: -100, type: 'group' } } }));
  await f.bot.handleUpdate(message('/start', { chat: { id: -100, type: 'supergroup' } }));
  assert.equal(f.changes.length, 0);
  assert.equal(f.wakes.length, 0);
});

test('forged sender, chat and message IDs and forwarded leave cards cannot decide', async () => {
  for (const patch of [{ from: { id: 999 } }, { message: { message_id: 10, chat: { id: 999, type: 'private' } } },
    { message: { message_id: 99, chat: { id: 123, type: 'private' } } },
    { message: { message_id: 10, chat: { id: 123, type: 'private' }, forward_origin: { type: 'user' } } },
    { inline_message_id: 'inline', message: undefined }]) {
    const f = fixture();
    await f.bot.handleUpdate(callback(undefined, patch));
    assert.equal(f.changes.length, 0);
  }
});

test('manager from the other branch cannot decide', async () => {
  const f = fixture({ user: { ...USER, coSo: 'Sài Gòn' } });
  await f.bot.handleUpdate(callback());
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
});

test('approval finalizes pending and violation requests through the shared decision service', async () => {
  for (const status of ['Chưa duyệt', 'Vi phạm']) {
    const f = fixture({ patch: { trang_thai: status } });
    const effects = await f.bot.handleUpdate(callback());
    assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Đã duyệt');
    assert.deepEqual(f.changes[0], { requestId: 'NP-20261002-001', user: USER, status: 'Đã duyệt', note: '', channel: 'telegram', expectedVersion: '1' });
    assert.ok(effects.some(effect => effect.method === 'answerCallbackQuery'));
  }
});

test('removed status buttons from old messages cannot change a decision or start a session', async () => {
  for (const code of ['p', 't', 'v']) {
    const f = fixture();
    const effects = await f.bot.handleUpdate(callback(`d|NP-20261002-001|1|${code}`));
    assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
    assert.equal(f.rows.get('NP-20261002-001').decision_version, '1');
    assert.equal(f.changes.length, 0);
    assert.equal(f.sessions.size, 0);
    assert.ok(effects.some(effect => effect.method === 'answerCallbackQuery' && effect.params.show_alert));
  }
});

test('stale and final leave cards cannot mutate the DB', async () => {
  for (const patch of [{ decision_version: '2' }, { trang_thai: 'Đã duyệt' }, { trang_thai: 'Từ chối' }]) {
    const f = fixture({ patch });
    const effects = await f.bot.handleUpdate(callback());
    assert.equal(f.changes.length, 0);
    assert.ok(effects.some(effect => effect.method === 'answerCallbackQuery' && /mới|web|kết thúc/.test(effect.params.text)));
  }
});

test('malformed and unrecognized callback data cannot mutate records', async () => {
  for (const data of ['d|NP-20261002-001|1|x', 'd|NP-20261002-001|-1|a', 'd|NP-20261002-001|1|a|extra',
    'd|not-a-request|1|a', 'd|NP-20261002-001|Infinity|a', 'd|NP-20261002-001|9007199254740993|a', 'x|abc']) {
    const f = fixture();
    await f.bot.handleUpdate(callback(data));
    assert.equal(f.changes.length, 0);
  }
});

test('reject starts a persisted 15-minute prompt session without changing the leave decision', async () => {
  const f = fixture();
  const before = Date.now();
  const { effects, session } = await beginRejection(f);
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
  assert.ok(new Date(session.expires_at).getTime() >= before + 14 * 60 * 1000);
  assert.equal(session.expected_version, '1');
  const prompt = effects.find(effect => effect.method === 'sendMessage');
  assert.deepEqual(prompt.session, { chatId: 123, sessionId: session.session_id });
  assert.deepEqual(prompt.params.reply_markup.inline_keyboard.flat().map(button => button.callback_data), [`s|${session.session_id}`, `k|${session.session_id}`]);
  assert.deepEqual(prompt.params.reply_markup.inline_keyboard.flat().map(button => button.text), ['Bỏ qua', 'Hủy']);
});

test('replying to the persisted prompt after a process restart commits a trimmed rejection reason', async () => {
  const f = fixture();
  const { session } = await beginRejection(f);
  f.bot = f.makeBot();
  await f.bot.handleUpdate(message('  Chưa có người bàn giao  ', { reply_to_message: { message_id: session.prompt_message_id } }));
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Từ chối');
  assert.equal(f.rows.get('NP-20261002-001').ghi_chu_duyet, 'Chưa có người bàn giao');
  assert.equal(f.sessions.size, 0);
});

test('unrelated messages, another sender and forwarded reason messages do not become rejection notes', async () => {
  const f = fixture();
  await beginRejection(f);
  for (const update of [message('Tin nhắn khác'), message('Sai prompt', { reply_to_message: { message_id: 99 } }),
    message('Người khác', { from: { id: 999 }, reply_to_message: { message_id: 11 } }),
    message('Chuyển tiếp', { forward_origin: { type: 'user' }, reply_to_message: { message_id: 11 } })]) {
    await f.bot.handleUpdate(update);
  }
  assert.equal(f.changes.length, 0);
  assert.equal(f.sessions.size, 1);
});

test('a rejection reason sent without Reply explains how to reply and keeps the decision pending', async () => {
  const f = fixture();
  const { session } = await beginRejection(f);
  const effects = await f.bot.handleUpdate(message('Mai có nhiều người nghỉ rồi'));
  const feedback = effects.find(effect => effect.method === 'sendMessage');
  assert.ok(feedback, 'a manager must receive feedback instead of silence');
  assert.match(feedback.params.text, /Reply/);
  assert.match(feedback.params.text, /NP-20261002-001/);
  assert.equal(feedback.params.reply_parameters.message_id, session.prompt_message_id);
  assert.equal(f.changes.length, 0);
  assert.equal(f.sessions.get('123'), session);
  assert.equal(f.rows.get(session.request_id).trang_thai, 'Chưa duyệt');
});

test('replying to another prompt points back to the active request without recording its text', async () => {
  const f = fixture();
  const { session } = await beginRejection(f);
  const effects = await f.bot.handleUpdate(message('Lý do cho đơn cũ', { reply_to_message: { message_id: 99 } }));
  const feedback = effects.find(effect => effect.method === 'sendMessage');
  assert.ok(feedback);
  assert.equal(feedback.params.reply_parameters.message_id, session.prompt_message_id);
  assert.equal(f.changes.length, 0);
  assert.equal(f.sessions.get('123'), session);
});

test('empty, nontext and oversized reasons preserve the current prompt and leave status', async () => {
  const f = fixture();
  await beginRejection(f);
  for (const text of ['   ', 'a'.repeat(501), undefined]) {
    await f.bot.handleUpdate(message(text, { reply_to_message: { message_id: 11 } }));
  }
  assert.equal(f.changes.length, 0);
  assert.equal(f.sessions.size, 1);
  await f.bot.handleUpdate(message('  ' + 'a'.repeat(500) + '  ', { reply_to_message: { message_id: 11 } }));
  assert.equal(f.rows.get('NP-20261002-001').ghi_chu_duyet.length, 500);
});

test('Skip rejects with an empty note and removes the session', async () => {
  const f = fixture();
  const { session } = await beginRejection(f);
  await f.bot.handleUpdate(callback(`s|${session.session_id}`, { message: { message_id: 11, chat: { id: 123, type: 'private' } } }));
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Từ chối');
  assert.equal(f.rows.get('NP-20261002-001').ghi_chu_duyet, '');
  assert.equal(f.sessions.size, 0);
});

test('cancel and /huy remove the pending rejection without changing the decision', async () => {
  for (const viaButton of [true, false]) {
    const f = fixture();
    const { session } = await beginRejection(f);
    await f.bot.handleUpdate(viaButton ? callback(`k|${session.session_id}`, { message: { message_id: 11, chat: { id: 123, type: 'private' } } }) : message('/huy'));
    assert.equal(f.sessions.size, 0);
    assert.equal(f.changes.length, 0);
    assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
  }
});

test('old prompt buttons cannot reject a replaced session or an unrelated message', async () => {
  const f = fixture();
  const { session: old } = await beginRejection(f);
  const { session: current, effects } = await beginRejection(f);
  assert.notEqual(old.session_id, current.session_id);
  assert.ok(effects.some(effect => effect.method === 'editMessageReplyMarkup' && effect.params.message_id === 11));
  await f.bot.handleUpdate(callback(`s|${old.session_id}`, { message: { message_id: 11, chat: { id: 123, type: 'private' } } }));
  await f.bot.handleUpdate(callback(`s|${current.session_id}`, { message: { message_id: 99, chat: { id: 123, type: 'private' } } }));
  assert.equal(f.changes.length, 0);
});

test('expired, stale and final rejection prompts are removed without DB decisions', async () => {
  for (const mode of ['expired', 'stale', 'final']) {
    const f = fixture();
    const { session } = await beginRejection(f);
    if (mode === 'expired') session.expires_at = new Date(Date.now() - 1).toISOString();
    if (mode === 'stale') f.rows.get(session.request_id).decision_version = '2';
    if (mode === 'final') f.rows.get(session.request_id).trang_thai = 'Đã duyệt';
    await f.bot.handleUpdate(message('Lý do', { reply_to_message: { message_id: 11 } }));
    assert.equal(f.changes.length, 0);
    assert.equal(f.sessions.size, 0);
  }
});

test('rejection rechecks current branch and account authorization', async () => {
  const user = { ...USER };
  const f = fixture({ user });
  await beginRejection(f);
  user.coSo = 'Sài Gòn';
  await f.bot.handleUpdate(message('Lý do', { reply_to_message: { message_id: 11 } }));
  assert.equal(f.changes.length, 0);
});

test('business errors produce feedback while transient failures propagate for worker retry', async () => {
  const business = Object.assign(new Error('Yêu cầu đã thay đổi. Hãy chọn lại.'), { statusCode: 409, code: 'STALE_DECISION' });
  const f = fixture({ error: business });
  const effects = await f.bot.handleUpdate(callback());
  assert.ok(effects.some(effect => effect.method === 'answerCallbackQuery' && effect.params.text.includes('thay đổi')));
  assert.equal(f.changes.length, 0);
  const retry = fixture({ error: new Error('DB temporarily unavailable') });
  await assert.rejects(retry.bot.handleUpdate(callback()), /DB temporarily unavailable/);
});

test('a replacement prompt for another request does not ingest a reply to the previous prompt', async () => {
  const f = fixture();
  await beginRejection(f);
  const requestId = 'NP-20261002-002';
  f.rows.set(requestId, { request_id: requestId, loai_yeu_cau: 'Xin nghỉ phép', co_so: 'Hà Nội', trang_thai: 'Chưa duyệt', decision_version: '1', ghi_chu_duyet: '' });
  f.deliveries.set(requestId, { request_id: requestId, user_id: USER.id, telegram_chat_id: '123', message_id: 12 });
  await f.bot.handleUpdate(callback(`d|${requestId}|1|r`, { message: { message_id: 12, chat: { id: 123, type: 'private' } } }));
  f.sessions.get('123').prompt_message_id = 13;
  await f.bot.handleUpdate(message('Lý do của đơn trước', { reply_to_message: { message_id: 11 } }));
  assert.equal(f.changes.length, 0);
  await f.bot.handleUpdate(message('Lý do của đơn mới', { reply_to_message: { message_id: 13 } }));
  assert.equal(f.rows.get(requestId).ghi_chu_duyet, 'Lý do của đơn mới');
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
});

test('a revoked manager cannot complete the pending rejection', async () => {
  const user = { ...USER };
  const f = fixture({ user });
  await beginRejection(f);
  user.featurePermissions = { 'hr.leave.manage': false };
  await f.bot.handleUpdate(message('Lý do', { reply_to_message: { message_id: 11 } }));
  assert.equal(f.changes.length, 0);
  assert.equal(f.rows.get('NP-20261002-001').trang_thai, 'Chưa duyệt');
});

test('conflicting rejection removes its session but a transient rejection preserves it for retry', async () => {
  const conflict = fixture({ error: Object.assign(new Error('Yêu cầu đã thay đổi.'), { statusCode: 409 }) });
  await beginRejection(conflict);
  const effects = await conflict.bot.handleUpdate(message('Lý do', { reply_to_message: { message_id: 11 } }));
  assert.equal(conflict.sessions.size, 0);
  assert.ok(effects.some(effect => effect.method === 'sendMessage' && /thay đổi/.test(effect.params.text)));
  const retry = fixture({ error: new Error('DB temporarily unavailable') });
  await beginRejection(retry);
  await assert.rejects(retry.bot.handleUpdate(message('Lý do', { reply_to_message: { message_id: 11 } })), /DB temporarily unavailable/);
  assert.equal(retry.sessions.size, 1);
});

test('expired prompt is cancelled before validating an empty reason', async () => {
  const f = fixture();
  const { session } = await beginRejection(f);
  session.expires_at = new Date(Date.now() - 1).toISOString();
  const effects = await f.bot.handleUpdate(message(' ', { reply_to_message: { message_id: 11 } }));
  assert.equal(f.sessions.size, 0);
  assert.equal(f.changes.length, 0);
  assert.ok(effects.some(effect => /hết hạn/.test(effect.params.text)));
});

test('manual absence requests cannot be decided through an old Telegram delivery', async () => {
  const f = fixture({ patch: { loai_yeu_cau: 'Tự ý nghỉ (HR ghi nhận)' } });
  const effects = await f.bot.handleUpdate(callback());
  assert.equal(f.changes.length, 0);
  assert.ok(effects.some(effect => /Xin nghỉ phép|xin nghỉ phép/.test(effect.params.text)));
});

test('removed status actions preserve existing decision versions and notes', async () => {
  for (const [code, status] of [['p', 'Chưa duyệt'], ['t', 'Chưa duyệt'], ['v', 'Vi phạm']]) {
    const f = fixture({ patch: { trang_thai: status, ghi_chu_duyet: 'Ghi chú đang có' } });
    const effects = await f.bot.handleUpdate(callback(`d|NP-20261002-001|1|${code}`));
    assert.equal(f.changes.length, 0);
    assert.equal(f.rows.get('NP-20261002-001').decision_version, '1');
    assert.equal(f.rows.get('NP-20261002-001').ghi_chu_duyet, 'Ghi chú đang có');
    assert.ok(effects.some(effect => effect.method === 'answerCallbackQuery' && effect.params.show_alert));
  }
});
