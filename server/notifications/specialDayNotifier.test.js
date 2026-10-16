'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSpecialDayNotifier,
  startSpecialDayNotifySchedule,
  TYPE_HOLIDAY,
  TYPE_BIRTHDAY
} = require('./specialDayNotifier');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0043_special_day_notice_log.sql'), 'utf8');

// 27/10/2026 00:00 giờ VN = 26/10 17:00 UTC; 09/10/2026 là ngày thường.
const BIRTHDAY_NOW = new Date('2026-10-26T17:00:00Z');
const MID_BIRTHDAY = new Date('2026-10-27T05:00:00Z');
const LABOUR_NOW = new Date('2026-04-30T17:00:00Z'); // 01/05 giờ VN
const ORDINARY_NOW = new Date('2026-10-09T05:00:00Z');

const USERS = [
  { id: 'a', trangThai: 'Đang hoạt động', feats: ['hr.leave'] },
  { id: 'b', trangThai: 'Đang hoạt động', feats: ['hr.leave'] },
  { id: 'c', trangThai: 'Đang hoạt động', feats: [] },            // không có quyền lịch (Khách)
  { id: 'd', trangThai: 'Khóa', feats: ['hr.leave'] },             // bị khóa
  { id: 'e', trangThai: 'Chờ duyệt', feats: ['hr.leave'] },        // chờ duyệt
  { id: null, trangThai: 'Đang hoạt động', feats: ['hr.leave'] }   // thiếu id
];

async function setup({ users = USERS, repoOverride } = {}) {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(MIGRATION);
  const sent = [];
  const notificationRepo = repoOverride || {
    createNotificationForUsers: async (ids, payload) => { sent.push({ ids, payload }); return []; }
  };
  const notifier = createSpecialDayNotifier({
    getPool: () => db,
    userStore: { getAllUsers: async () => users },
    notificationRepo,
    hasFeature: (u, key) => key === 'hr.leave' && u.feats.includes('hr.leave'),
    log: () => {}
  });
  return { db, sent, notifier };
}

test('ngày thường: không gửi và không chạm DB', async () => {
  const { db, sent, notifier } = await setup();
  try {
    const result = await notifier.notifyIfDue(ORDINARY_NOW);
    assert.deepEqual(result, { skipped: true, reason: 'not-special' });
    assert.equal(sent.length, 0);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM special_day_notice_log');
    assert.equal(rows[0].n, 0);
  } finally { await db.close(); }
});

test('sinh nhật 27/10: đúng nguyên văn, chỉ gửi tài khoản đang hoạt động có hr.leave', async () => {
  const { db, sent, notifier } = await setup();
  try {
    const result = await notifier.notifyIfDue(BIRTHDAY_NOW);
    assert.equal(result.skipped, false);
    assert.equal(result.recipients, 2);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].ids, ['a', 'b']);
    assert.equal(sent[0].payload.type, TYPE_BIRTHDAY);
    assert.equal(sent[0].payload.message, 'Chúc mừng sinh nhật Nguyễn Ngọc Việt Thắng BA! Chúc bạn tuổi mới luôn tràn đầy năng lượng, đam mê sáng tạo, luôn là điểm tựa vững vàng và chạm tới những mục tiêu tuyệt vời nhất!');
    assert.equal(sent[0].payload.relatedType, null);
    assert.equal(sent[0].payload.relatedId, '2026-10-27:birthday_thang');
  } finally { await db.close(); }
});

test('ngày lễ dùng type special_day', async () => {
  const { db, sent, notifier } = await setup();
  try {
    await notifier.notifyIfDue(LABOUR_NOW);
    assert.equal(sent[0].payload.type, TYPE_HOLIDAY);
    assert.match(sent[0].payload.title, /1\/5/);
  } finally { await db.close(); }
});

test('quét lặp / restart trong cùng ngày không gửi trùng', async () => {
  const { db, sent, notifier } = await setup();
  try {
    await notifier.notifyIfDue(BIRTHDAY_NOW);
    const again = await notifier.notifyIfDue(MID_BIRTHDAY);
    assert.deepEqual(again, { skipped: true, reason: 'already-sent' });
    assert.equal(sent.length, 1);
    // một notifier mới (mô phỏng restart) dùng cùng DB cũng không gửi lại
    const restarted = createSpecialDayNotifier({
      getPool: () => db,
      userStore: { getAllUsers: async () => USERS },
      notificationRepo: { createNotificationForUsers: async () => { throw new Error('không được gọi'); } },
      hasFeature: () => true,
      log: () => {}
    });
    assert.equal((await restarted.notifyIfDue(MID_BIRTHDAY)).reason, 'already-sent');
  } finally { await db.close(); }
});

test('gửi lỗi: bỏ đánh dấu để lần quét sau thử lại, không throw', async () => {
  let fail = true;
  const sent = [];
  const { db, notifier } = await setup({
    repoOverride: {
      createNotificationForUsers: async (ids, payload) => {
        if (fail) throw new Error('đĩa đầy');
        sent.push({ ids, payload });
        return [];
      }
    }
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const first = await notifier.notifyIfDue(BIRTHDAY_NOW);
    assert.equal(first.reason, 'error');
    const { rows } = await db.query('SELECT count(*)::int AS n FROM special_day_notice_log');
    assert.equal(rows[0].n, 0);
    fail = false;
    const retry = await notifier.notifyIfDue(MID_BIRTHDAY);
    assert.equal(retry.skipped, false);
    assert.equal(sent.length, 1);
  } finally { console.error = originalError; await db.close(); }
});

test('chưa có người nhận: bỏ đánh dấu, lần sau gửi được khi đã có tài khoản', async () => {
  const users = [];
  const { db, sent, notifier } = await setup({ users });
  try {
    const first = await notifier.notifyIfDue(BIRTHDAY_NOW);
    assert.equal(first.reason, 'no-recipients');
    users.push({ id: 'z', trangThai: 'Đang hoạt động', feats: ['hr.leave'] });
    const second = await notifier.notifyIfDue(MID_BIRTHDAY);
    assert.equal(second.skipped, false);
    assert.deepEqual(sent[0].ids, ['z']);
  } finally { await db.close(); }
});

test('DB không sẵn sàng: nuốt lỗi, không throw', async () => {
  const notifier = createSpecialDayNotifier({
    getPool: () => ({ query: async () => { throw new Error('SUPABASE_DB_URL chưa được cấu hình'); } }),
    userStore: { getAllUsers: async () => USERS },
    notificationRepo: { createNotificationForUsers: async () => [] },
    hasFeature: () => true
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await notifier.notifyIfDue(BIRTHDAY_NOW);
    assert.equal(result.reason, 'error');
  } finally { console.error = originalError; }
});

test('startSpecialDayNotifySchedule chạy ngay rồi quét định kỳ và unref timer', () => {
  const calls = [];
  const notifier = { notifyIfDue: (now) => { calls.push(now); } };
  let intervalFn; let intervalMs; let unrefCalled = false;
  const fixed = new Date('2026-10-09T05:00:00Z');
  const timer = startSpecialDayNotifySchedule({
    notifier,
    intervalMs: 123,
    now: () => fixed,
    scheduleImmediate: (fn) => fn(),
    setIntervalFn: (fn, ms) => { intervalFn = fn; intervalMs = ms; return { unref() { unrefCalled = true; } }; }
  });
  assert.equal(calls.length, 1);
  assert.equal(intervalMs, 123);
  intervalFn();
  assert.equal(calls.length, 2);
  assert.equal(unrefCalled, true);
  assert.ok(timer);
});
