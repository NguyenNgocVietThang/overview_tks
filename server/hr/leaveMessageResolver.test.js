'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const { formatLeaveBoundary } = require('./hrLeaveService');
const {
  resolveLeaveMessage,
  findFirstSessionAtOrAfter
} = require('./leaveMessageResolver');

const messageTime = '2026-08-22T10:00:00+07:00';

function extracted(overrides = {}) {
  return {
    intent: 'leave_request',
    start_date: null,
    start_session: null,
    end_date: null,
    end_session: null,
    duration_value: null,
    duration_unit: null,
    reason: null,
    handover: null,
    confidence: 0.99,
    ...overrides
  };
}

test('hôm nay không nêu buổi là trọn ngày gửi tin', () => {
  const result = resolveLeaveMessage(extracted({ start_date: '2026-08-22', confidence: 0.98 }),
    '2026-08-22T08:15:00+07:00');

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Chiều 22/08/2026');
  assert.equal(result.totalSessions, 2);
});

test('buổi sáng không nêu ngày mặc định là ngày gửi tin', () => {
  const result = resolveLeaveMessage(extracted({ start_session: 'Sáng', reason: '', handover: '', confidence: 0.95 }),
    '2026-08-22T23:30:00+07:00');

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 22/08/2026');
  assert.equal(result.totalSessions, 1);
  assert.equal(result.reason, '');
  assert.equal(result.handover, '');
});

test('khoảng ngày rõ ràng bao gồm cả hai buổi biên', () => {
  const result = resolveLeaveMessage(extracted({
    start_date: '2026-08-22', start_session: 'Chiều',
    end_date: '2026-08-24', end_session: 'Sáng',
    reason: 'khám bệnh', handover: 'bàn giao Lan'
  }), messageTime);

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Chiều 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 24/08/2026');
  assert.equal(result.totalSessions, 4);
  assert.equal(result.reason, 'khám bệnh');
  assert.equal(result.handover, 'bàn giao Lan');
});

test('ba ngày không nêu ngày bắt đầu tại session đầu tiên sau đủ 10 giờ', () => {
  const result = resolveLeaveMessage(extracted({
    duration_value: 3, duration_unit: 'day', reason: 'việc gia đình'
  }), messageTime, { noticeHours: 10 });

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 23/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Chiều 25/08/2026');
  assert.equal(result.totalSessions, 6);
});

test('ngày rõ ràng ưu tiên hơn mặc định 10 giờ', () => {
  const result = resolveLeaveMessage(extracted({
    start_date: '2026-08-22', start_session: 'Chiều',
    duration_value: 2, duration_unit: 'session', confidence: 0.91
  }), messageTime);

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Chiều 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 23/08/2026');
  assert.equal(result.totalSessions, 2);
});

test('duration theo session tiến qua nửa đêm', () => {
  const result = resolveLeaveMessage(extracted({
    start_date: '2026-08-22', start_session: 'Chiều', duration_value: 3, duration_unit: 'session'
  }), messageTime);

  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Chiều 23/08/2026');
  assert.equal(result.totalSessions, 3);
});

test('tìm session đầu tiên từ đúng thời điểm bắt đầu session', () => {
  const result = findFirstSessionAtOrAfter('2026-08-22T00:45:00.000Z', 0);

  assert.equal(formatLeaveBoundary(result.date, result.session), 'Sáng 22/08/2026');
});

test('timestamp Unix seconds Telegram giữ đúng ngày khi chỉ nêu buổi', () => {
  const result = resolveLeaveMessage(extracted({ start_session: 'Sáng' }), 1787367600);

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 22/08/2026');
  assert.equal(formatLeaveBoundary(result.endDate, result.endSession), 'Sáng 22/08/2026');
});

test('timestamp Unix seconds Telegram tính đúng mốc duration-only', () => {
  const result = resolveLeaveMessage(extracted({ duration_value: 1, duration_unit: 'session' }), 1787367600);

  assert.equal(formatLeaveBoundary(result.startDate, result.startSession), 'Sáng 23/08/2026');
  assert.equal(result.totalSessions, 1);
});

test('từ chối message time không hợp lệ', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ start_session: 'Sáng' }), Number.NaN),
    err => err.code === 'INVALID_MESSAGE_TIME'
  );
});

test('biên thông báo đúng 10 giờ chọn session Bangkok trên host UTC', () => {
  const resolverPath = require.resolve('./leaveMessageResolver');
  const output = execFileSync(process.execPath, ['-e', `
    const { resolveLeaveMessage } = require(${JSON.stringify(resolverPath)});
    const result = resolveLeaveMessage({
      intent: 'leave_request', start_date: null, start_session: null,
      end_date: null, end_session: null, duration_value: 1, duration_unit: 'session',
      reason: null, handover: null, confidence: 0.99
    }, '2026-08-21T14:45:00.000Z');
    process.stdout.write(JSON.stringify({
      date: result.startDate.toISOString().slice(0, 10), session: result.startSession
    }));
  `], { encoding: 'utf8', env: { ...process.env, TZ: 'UTC' } });

  assert.deepEqual(JSON.parse(output), { date: '2026-08-22', session: 'Sáng' });
});

test('từ chối ý định không phải nghỉ phép', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ intent: 'other' }), messageTime),
    err => err.code === 'NOT_LEAVE_REQUEST'
  );
});

test('từ chối confidence thấp', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ confidence: 0.4 }), messageTime),
    err => err.code === 'LOW_CONFIDENCE'
  );
});

test('từ chối ngày ISO không tồn tại', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ start_date: '2026-02-31', start_session: 'Sáng' }), messageTime),
    err => err.code === 'INVALID_DATE'
  );
});

test('từ chối khoảng ngày mâu thuẫn', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({
      start_date: '2026-08-23', start_session: 'Sáng',
      end_date: '2026-08-22', end_session: 'Chiều'
    }), messageTime),
    err => err.code === 'CONTRADICTORY_INTERVAL'
  );
});

test('từ chối đơn vị duration không hỗ trợ', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ duration_value: 2, duration_unit: 'hour' }), messageTime),
    err => err.code === 'UNSUPPORTED_DURATION_UNIT'
  );
});

test('từ chối duration session phân số', () => {
  assert.throws(
    () => resolveLeaveMessage(extracted({ duration_value: 1.5, duration_unit: 'session' }), messageTime),
    err => err.code === 'INVALID_DURATION'
  );
});
