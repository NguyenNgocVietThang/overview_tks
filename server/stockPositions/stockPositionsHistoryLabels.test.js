'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTION_LABELS, summaryText } = require('./stockPositionsHistoryLabels');

test('nhãn + tóm tắt cho ack / unack / history_purged', () => {
  assert.equal(ACTION_LABELS.ack, 'Đánh dấu Đã sửa');
  assert.equal(ACTION_LABELS.unack, 'Bỏ Đã sửa');
  assert.equal(ACTION_LABELS.history_purged, 'Xóa lịch sử');
  assert.equal(summaryText({ warnings: ['unreadable', 'unknowncode'] }), 'Sai định dạng, Mã SP lạ');
  assert.equal(summaryText({ deleted: 5, from: '2026-10-01', to: '2026-10-05' }), 'Xóa 5 · 01/10/2026 – 05/10/2026');
  assert.equal(summaryText({ deleted: 5, from: '2026-10-01', to: null }), 'Xóa 5 · từ 01/10/2026');
  assert.equal(summaryText({ deleted: 5, from: null, to: '2026-10-05' }), 'Xóa 5 · đến 05/10/2026');
  assert.equal(summaryText({ deleted: 5, from: null, to: null }), 'Xóa 5 · toàn bộ');
});
