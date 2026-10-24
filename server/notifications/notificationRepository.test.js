'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const repo = require('./notificationRepository');
const { useNotificationTestPool } = require('./testHelpers/notificationTestPool');

let store;
test.before(async () => { store = await useNotificationTestPool(); });
test.after(() => store.close());
test.beforeEach(() => store.reset());

test('createNotification tạo bản ghi mới với isRead=false', async () => {
  const n = await repo.createNotification({
    recipientUserId: 'user-1',
    type: 'role_change_request',
    title: 'Tiêu đề',
    message: 'Nội dung',
    relatedType: 'roleChangeRequest',
    relatedId: 'req-1'
  });
  assert.ok(n.id);
  assert.equal(n.recipientUserId, 'user-1');
  assert.equal(n.type, 'role_change_request');
  assert.equal(n.relatedType, 'roleChangeRequest');
  assert.equal(n.relatedId, 'req-1');
  assert.equal(n.isRead, false);
  assert.ok(n.createdAt);
});

test('createNotification: thiếu recipientUserId/type thì throw', async () => {
  await assert.rejects(repo.createNotification({ type: 't' }), /recipientUserId/);
  await assert.rejects(repo.createNotification({ recipientUserId: 'a' }), /type/);
});

test('createNotificationForUsers tạo 1 bản ghi cho mỗi người nhận', async () => {
  const created = await repo.createNotificationForUsers(['m-1', 'm-2'], {
    type: 'role_change_request',
    title: 'T',
    message: 'M',
    relatedType: 'roleChangeRequest',
    relatedId: 'req-2'
  });
  assert.equal(created.length, 2);
  assert.equal((await repo.listForUser('m-1')).length, 1);
  assert.equal((await repo.listForUser('m-2')).length, 1);
});

test('createNotificationForUsers ghi cả lô người nhận bằng đúng 1 câu lệnh', async (t) => {
  const querySpy = t.mock.method(store.db, 'query');
  const ids = Array.from({ length: 25 }, (_, i) => `u-${i}`);
  const created = await repo.createNotificationForUsers(ids, { type: 'special_day', title: 'T', message: 'M' });
  assert.equal(querySpy.mock.callCount(), 1);
  assert.equal(created.length, 25);
  assert.equal(new Set(created.map(n => n.id)).size, 25);
  assert.deepEqual(created.map(n => n.recipientUserId), ids);
  assert.equal(created[0].relatedType, null);
  assert.equal(created[0].isRead, false);
  assert.equal((await repo.listForUser('u-24')).length, 1);
});

test('createNotificationForUsers: danh sách rỗng trả [] và không ghi; thiếu type/id thì throw', async (t) => {
  const querySpy = t.mock.method(store.db, 'query');
  assert.deepEqual(await repo.createNotificationForUsers([], { type: 't' }), []);
  await assert.rejects(repo.createNotificationForUsers(['x'], { title: 'no type' }), /type/);
  await assert.rejects(repo.createNotificationForUsers(['x', null], { type: 't' }), /recipientUserId/);
  assert.equal(querySpy.mock.callCount(), 0);
});

test('listForUser chỉ trả bản ghi của đúng người nhận, mới nhất trước', async () => {
  await store.seed([
    { recipientUserId: 'a', type: 't', title: 'first', createdAt: '2026-10-22T08:00:00.000Z' },
    { recipientUserId: 'b', type: 't', title: 'other', createdAt: '2026-10-22T08:00:01.000Z' },
    { recipientUserId: 'a', type: 't', title: 'second', createdAt: '2026-10-22T08:00:02.000Z' }
  ]);
  const list = await repo.listForUser('a');
  assert.deepEqual(list.map(n => n.title), ['second', 'first']);
});

test('listForUser ưu tiên bản ghi được thêm sau khi hai thông báo trùng mili-giây', async () => {
  const createdAt = '2026-10-22T08:00:00.000Z';
  await store.seed([
    { recipientUserId: 'a', type: 't', title: 'first', createdAt },
    { recipientUserId: 'a', type: 't', title: 'second', createdAt }
  ]);
  const list = await repo.listForUser('a');
  assert.deepEqual(list.map(item => item.title), ['second', 'first']);
});

test('listForUser unreadOnly chỉ trả thông báo chưa đọc', async () => {
  await store.seed([
    { recipientUserId: 'a', type: 't', title: 'read', isRead: true },
    { recipientUserId: 'a', type: 't', title: 'unread' }
  ]);
  assert.deepEqual((await repo.listForUser('a', { unreadOnly: true })).map(n => n.title), ['unread']);
  assert.equal((await repo.listForUser('a')).length, 2);
});

test('getUnreadCount + markRead + markAllRead hoạt động đúng', async () => {
  const n1 = await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: '2', message: '' });
  assert.equal(await repo.getUnreadCount('a'), 2);

  const marked = await repo.markRead(n1.id, 'a');
  assert.equal(marked.isRead, true);
  assert.equal(await repo.getUnreadCount('a'), 1);

  const changed = await repo.markAllRead('a');
  assert.equal(changed, 1);
  assert.equal(await repo.getUnreadCount('a'), 0);
});

test('markRead trả về null nếu id không thuộc userId hoặc không phải UUID', async () => {
  const n = await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  assert.equal(await repo.markRead(n.id, 'someone-else'), null);
  assert.equal(await repo.markRead('not-a-uuid', 'a'), null);
});

test('deleteNotification xóa đúng bản ghi thuộc user, trả false nếu không thuộc/không tồn tại', async () => {
  const n = await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  assert.equal(await repo.deleteNotification(n.id, 'someone-else'), false);
  assert.equal(await repo.deleteNotification('not-a-uuid', 'a'), false);
  assert.equal(await repo.deleteNotification(n.id, 'a'), true);
  assert.equal((await repo.listForUser('a')).length, 0);
  assert.equal(await repo.deleteNotification(n.id, 'a'), false);
});

test('deleteAllForUser xóa toàn bộ thông báo của đúng user, không đụng người khác', async () => {
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: '2', message: '' });
  await repo.createNotification({ recipientUserId: 'b', type: 't', title: '3', message: '' });
  assert.equal(await repo.deleteAllForUser('a'), 2);
  assert.equal((await repo.listForUser('a')).length, 0);
  assert.equal((await repo.listForUser('b')).length, 1);
});

test('chưa setPool trong test thì báo lỗi thay vì ghi vào DB thật', async () => {
  repo.setPool(null);
  try {
    await assert.rejects(repo.getUnreadCount('a'), /setPool/);
  } finally {
    repo.setPool(store.db);
  }
});
