'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rowToUser } = require('./appUsersRepository');

test('rowToUser ánh xạ Telegram ID từ app_users', () => {
  const user = rowToUser({
    id: 'user-1',
    username: 'employee@example.com',
    telegram_id: '6205968899',
    co_so: '',
    hr_branch: null
  });

  assert.equal(user.telegramId, '6205968899');
});

test('rowToUser dùng chuỗi rỗng khi tài khoản chưa có Telegram ID', () => {
  const user = rowToUser({ id: 'user-2', username: 'employee-2', co_so: '' });
  assert.equal(user.telegramId, '');
});
