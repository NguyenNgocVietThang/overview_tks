'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHrRuleDocumentNotifier } = require('./hrRuleDocumentNotifier');
const { hasFeature } = require('../auth/featureRegistry');

const USERS = [
  { id: 'm1', vaiTro: 'Quản lý', username: 'manager' },
  { id: 'm2', vaiTro: 'Quản lý', username: 'manager2' },
  { id: 's1', vaiTro: 'Nhân viên kho', username: 'staff' },
  { id: 'g1', vaiTro: 'Khách', username: 'guest' }
];

function setup(overrides = {}) {
  const created = [];
  const notifier = createHrRuleDocumentNotifier({
    userStore: { getAllUsers: async () => USERS },
    notificationRepo: { createNotificationForUsers: async (ids, payload) => { created.push({ ids, payload }); } },
    hasFeature,
    ...overrides
  });
  return { notifier, created };
}

test('người nhận = tài khoản có quyền hr.rules, bỏ người thao tác và Khách', async () => {
  const { notifier, created } = setup();
  await notifier.documentAdded({ id: 'm1', hoTen: 'Quản lý A' }, { title: 'Nội quy kho', slug: 'pdf-7' });

  assert.deepEqual(created[0].ids, ['m2', 's1']);
  assert.equal(created[0].payload.type, 'rule_document_added');
  assert.equal(created[0].payload.relatedType, 'ruleDocument');
  assert.equal(created[0].payload.relatedId, 'pdf-7');
  assert.match(created[0].payload.message, /Quản lý A vừa thêm tài liệu "Nội quy kho"/);
});

test('gỡ và khôi phục: nội dung + relatedId', async () => {
  const { notifier, created } = setup();
  await notifier.documentRemoved({ id: 'm1', username: 'manager' }, { title: 'Nội quy kho', slug: 'pdf-7' });
  await notifier.defaultsRestored({ id: 'm1', username: 'manager' }, [
    { title: 'Giờ giấc làm việc', slug: 'gio-giac' }, { title: 'Quy định nghỉ phép', slug: 'nghi-phep' }
  ]);

  assert.equal(created[0].payload.type, 'rule_document_removed');
  assert.equal(created[0].payload.relatedId, null);
  assert.match(created[0].payload.message, /vừa gỡ tài liệu "Nội quy kho"/);
  assert.equal(created[1].payload.type, 'rule_document_added');
  assert.equal(created[1].payload.relatedId, 'gio-giac');
  assert.match(created[1].payload.message, /"Giờ giấc làm việc", "Quy định nghỉ phép"/);
});

test('lỗi kho tài khoản hoặc kho thông báo bị nuốt, không throw', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const a = setup({ userStore: { getAllUsers: async () => { throw new Error('db down'); } } });
    await a.notifier.documentAdded({ id: 'm1' }, { title: 'X', slug: 'pdf-1' });
    const b = setup({ notificationRepo: { createNotificationForUsers: async () => { throw new Error('disk'); } } });
    await b.notifier.documentRemoved({ id: 'm1' }, { title: 'X', slug: 'pdf-1' });
  } finally {
    console.error = originalError;
  }
});
