'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const repo = require('./notificationRepository');

const testDbPath = path.join(os.tmpdir(), `test-notifications-${Date.now()}.json`);
repo.initStore(testDbPath);

test.after(() => {
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (e) {}
  }
});

test('createNotification tạo bản ghi mới với isRead=false', async () => {
  repo.setInMemoryNotifications([]);
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
  assert.equal(n.isRead, false);
  assert.ok(n.createdAt);
});

test('createNotificationForUsers tạo 1 bản ghi cho mỗi người nhận', async () => {
  repo.setInMemoryNotifications([]);
  const created = await repo.createNotificationForUsers(['m-1', 'm-2'], {
    type: 'role_change_request',
    title: 'T',
    message: 'M',
    relatedType: 'roleChangeRequest',
    relatedId: 'req-2'
  });
  assert.equal(created.length, 2);
  const list1 = await repo.listForUser('m-1');
  const list2 = await repo.listForUser('m-2');
  assert.equal(list1.length, 1);
  assert.equal(list2.length, 1);
});

test('listForUser chỉ trả bản ghi của đúng người nhận, mới nhất trước', async () => {
  repo.setInMemoryNotifications([]);
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: 'first', message: '' });
  await repo.createNotification({ recipientUserId: 'b', type: 't', title: 'other', message: '' });
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: 'second', message: '' });
  const list = await repo.listForUser('a');
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'second');
  assert.equal(list[1].title, 'first');
});

test('getUnreadCount + markRead + markAllRead hoạt động đúng', async () => {
  repo.setInMemoryNotifications([]);
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

test('markRead trả về null nếu id không thuộc userId', async () => {
  repo.setInMemoryNotifications([]);
  const n = await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  const result = await repo.markRead(n.id, 'someone-else');
  assert.equal(result, null);
});

test('deleteNotification xóa đúng bản ghi thuộc user, trả false nếu không thuộc/không tồn tại', async () => {
  repo.setInMemoryNotifications([]);
  const n = await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  assert.equal(await repo.deleteNotification(n.id, 'someone-else'), false);
  assert.equal(await repo.deleteNotification(n.id, 'a'), true);
  assert.equal((await repo.listForUser('a')).length, 0);
  assert.equal(await repo.deleteNotification(n.id, 'a'), false);
});

test('deleteAllForUser xóa toàn bộ thông báo của đúng user, không đụng người khác', async () => {
  repo.setInMemoryNotifications([]);
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: '1', message: '' });
  await repo.createNotification({ recipientUserId: 'a', type: 't', title: '2', message: '' });
  await repo.createNotification({ recipientUserId: 'b', type: 't', title: '3', message: '' });
  const deleted = await repo.deleteAllForUser('a');
  assert.equal(deleted, 2);
  assert.equal((await repo.listForUser('a')).length, 0);
  assert.equal((await repo.listForUser('b')).length, 1);
});
