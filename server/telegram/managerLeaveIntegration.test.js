'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createManagerLeaveStore } = require('./managerLeaveStore');
const { createHrLeaveRepository } = require('../hr/hrLeaveRepository');
const { createManagerLeaveRuntime } = require('./managerLeaveRuntime');

test('real DB complete workflow: scoped backlog, Telegram rejection, duplicate updates, web reopening', async () => {
  const db = new PGlite();
  const managers = ['Hà Nội', 'Sài Gòn', 'Cả hai', ''].map((coSo, i) => ({
    id: `${i + 1}1111111-1111-1111-1111-111111111111`, telegramId: `${100 + i}`,
    username: `manager${i}`, hoTen: `Quản lý ${i}`, vaiTro: 'Quản lý', trangThai: 'Đang hoạt động', coSo
  }));
  try {
    await db.exec(`CREATE ROLE reporting_readonly;
      CREATE TABLE hr_employees(id BIGINT PRIMARY KEY, bo_phan TEXT);
      CREATE TABLE app_users(id UUID PRIMARY KEY, username TEXT, is_deleted BOOLEAN DEFAULT false,
        telegram_id TEXT DEFAULT '', updated_at TIMESTAMPTZ DEFAULT now(), hr_employee_id BIGINT);`);
    for (const user of managers) await db.query('INSERT INTO app_users(id, username) VALUES ($1, $2)', [user.id, user.username]);
    for (const name of ['0016_hr_leave_telegram.sql', '0029_hr_manager_telegram.sql']) await db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations', name), 'utf8'));
    for (const [requestId, branch, status, type] of [
      ['NP-HN', 'hanoi', 'Chưa duyệt', 'Xin nghỉ phép'], ['NP-SG', 'saigon', 'Tạm duyệt', 'Xin nghỉ phép'],
      ['NP-CLOSED', 'hanoi', 'Đã duyệt', 'Xin nghỉ phép'], ['NP-MANUAL', 'hanoi', 'Đã duyệt', 'Tự ý nghỉ (HR ghi nhận)']
    ]) await db.query(`INSERT INTO hr_leave_requests(request_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi,trang_thai,loai_yeu_cau)
      VALUES ($1,$2,'2026-10-02','Sáng','2026-10-02','Chiều',2,$3,$4)`, [requestId, branch, status, type]);
    const pool = { query: (sql, values) => db.query(sql, values), connect: async () => ({ query: (sql, values) => db.query(sql, values), release() {} }) };
    const store = createManagerLeaveStore({ pool });
    const leaveRepo = createHrLeaveRepository({ pool });
    const calls = [];
    const notifications = [];
    let messageId = 0;
    const makeRuntime = () => createManagerLeaveRuntime({ store, leaveRepo,
      telegram: { call: async (method, params) => { calls.push({ method, params }); return { message_id: ++messageId }; } },
      getManager: async id => managers.find(m => m.telegramId === String(id)), loadManagers: async () => managers,
      notifyDecision: async record => notifications.push(record.request_id), webUrl: 'https://example.com',
      logger: { error() {} }
    });
    let runtime = makeRuntime();
    await runtime.drain();
    assert.equal(calls.filter(c => c.method === 'sendMessage').length, 4, 'closed history and manual absences are not replayed');
    const deliveries = (await db.query('SELECT * FROM hr_leave_manager_messages')).rows;
    assert.deepEqual(deliveries.filter(d => d.request_id === 'NP-HN').map(d => d.telegram_chat_id).sort(), ['100', '102']);
    assert.deepEqual(deliveries.filter(d => d.request_id === 'NP-SG').map(d => d.telegram_chat_id).sort(), ['101', '102']);
    // A genuinely new request can be approved on web before its CREATE job
    // drains. Managers still receive its result, with Telegram actions locked.
    await db.query(`INSERT INTO hr_leave_requests(request_id,branch,start_date,start_session,end_date,end_session,tong_buoi_nghi,trang_thai)
      VALUES ('NP-NEW-FINAL','hanoi','2026-10-02','Sáng','2026-10-02','Chiều',2,'Đã duyệt')`);
    await runtime.drain();
    const freshCards = calls.filter(c => c.method === 'sendMessage' && c.params.text.includes('NP-NEW-FINAL'));
    assert.equal(freshCards.length, 2, 'new finalized request is sent even before first scan');
    assert.ok(freshCards.every(c => !c.params.reply_markup.inline_keyboard.flat().some(b => b.callback_data)));
    let updateId = 1;
    const sendAction = async (user, requestId, version, code) => {
      const delivery = await store.getDelivery(requestId, user.id, user.telegramId);
      const update = { update_id: updateId++, callback_query: { id: `q${updateId}`, from: { id: Number(user.telegramId) },
        message: { message_id: Number(delivery.message_id), chat: { id: Number(user.telegramId), type: 'private' } }, data: `d|${requestId}|${version}|${code}` } };
      assert.equal(await store.enqueueUpdate(update), true);
      assert.equal(await store.enqueueUpdate(update), false);
      await runtime.drain();
    };
    await sendAction(managers[0], 'NP-HN', '0', 't');
    let row = await leaveRepo.getLeaveRequestById('NP-HN', 'Hà Nội');
    assert.equal(row.trang_thai, 'Chưa duyệt', 'removed Telegram actions cannot decide');
    assert.equal(row.decision_version, '0');
    await leaveRepo.updateLeaveRequestStatus('NP-HN', { status: 'Tạm duyệt', approver: 'Web' }, 'Hà Nội');
    await runtime.drain();
    row = await leaveRepo.getLeaveRequestById('NP-HN', 'Hà Nội');
    assert.equal(row.trang_thai, 'Tạm duyệt');
    assert.equal(row.decision_version, '1');
    await sendAction(managers[2], 'NP-HN', '0', 'r');
    assert.equal(await store.getSession('102'), null, 'stale callback cannot start a rejection');
    await sendAction(managers[0], 'NP-HN', '1', 'r');
    const session = await store.getSession('100');
    assert.ok(session.prompt_message_id);
    assert.equal((await leaveRepo.getLeaveRequestById('NP-HN', 'Hà Nội')).trang_thai, 'Tạm duyệt');
    runtime = makeRuntime(); // Restart between requesting a reason and replying.
    await store.enqueueUpdate({ update_id: updateId++, message: { from: { id: 100 }, chat: { id: 100, type: 'private' },
      text: '  Thiếu người trực  ', reply_to_message: { message_id: Number(session.prompt_message_id) } } });
    await runtime.drain();
    row = await leaveRepo.getLeaveRequestById('NP-HN', 'Hà Nội');
    assert.equal(row.trang_thai, 'Từ chối');
    assert.equal(row.ghi_chu_duyet, 'Thiếu người trực');
    assert.equal(row.decision_version, '2');
    assert.equal(row.nguoi_duyet, managers[0].hoTen);
    assert.equal(await store.getSession('100'), null);
    await sendAction(managers[2], 'NP-HN', '2', 'a');
    assert.equal((await leaveRepo.getLeaveRequestById('NP-HN', 'Hà Nội')).decision_version, '2', 'final decisions cannot be overwritten by Telegram');
    await leaveRepo.updateLeaveRequestStatus('NP-HN', { status: 'Chưa duyệt', approver: 'Web' }, 'Hà Nội');
    await runtime.drain();
    const lastEdit = calls.filter(c => c.method === 'editMessageText').at(-1);
    assert.ok(lastEdit.params.reply_markup.inline_keyboard.some(row => row.some(button => button.callback_data === 'd|NP-HN|3|a')));
    assert.deepEqual(notifications, ['NP-HN']);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM hr_manager_telegram_updates WHERE completed_at IS NULL')).rows[0].n, 0);
  } finally { await db.close(); }
});
