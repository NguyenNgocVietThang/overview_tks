// ==========================================
// HR LEAVE BELL NOTIFIER — báo chuông "Có yêu cầu nghỉ phép mới" cho người duyệt khi đơn
// KHÔNG gửi qua web (bot Telegram của nhân viên ghi thẳng vào hr_leave_requests, source
// 'telegram'). Đơn gửi qua web đã được route báo ngay lúc tạo (hrLeaveRoutes.js), nên ở đây bỏ qua.
//
// Quét đơn "Chưa duyệt" tạo trong WINDOW_MS gần nhất mà chưa có chuông leave_request_created
// (chống trùng bằng chính bảng notifications, 0093). Người nhận = routingFor() giống đơn web:
// đúng cơ sở + phòng ban được giao duyệt, không ai khớp thì quản trị cao nhất.
// Quét + ghi chuông trong 1 transaction có khóa advisory -> 2 tiến trình chạy chồng (lúc deploy)
// cũng không gửi trùng. Không bao giờ throw.
// ==========================================
'use strict';

const { getPool } = require('../db/pool');
const leaveRepo = require('./hrLeaveRepository');
const notificationRepository = require('../notifications/notificationRepository');
const { createHrLeaveAuthorization } = require('./hrLeaveAuthorization');
const { BRANCHES } = require('../branch/branches');

const TYPE = 'leave_request_created';
const RELATED_TYPE = 'leaveRequest';
const POLL_INTERVAL_MS = 15 * 1000;
// Đơn cũ hơn thì thôi không báo (lần đầu bật job, hoặc đơn kẹt không có người duyệt).
const WINDOW_MS = 24 * 60 * 60 * 1000;
const BATCH = 50;
// Khoa advisory rieng (20531093 ~ migration 0093), khac cac khoa 205310xx da dung.
const LOCK_KEY = 20531093;

const PENDING_SQL = `
  SELECT r.request_id FROM hr_leave_requests r
  WHERE r.source <> 'web' AND r.trang_thai = $1
    AND r.created_at > now() - ($2::bigint * interval '1 millisecond')
    AND NOT EXISTS (SELECT 1 FROM notifications n
      WHERE n.type = $3 AND n.related_type = $4 AND n.related_id = r.request_id)
  ORDER BY r.created_at
  LIMIT $5`;

function buildPayload(record) {
  const range = record.thoi_gian_bat_dau
    ? ` từ ${record.thoi_gian_bat_dau} đến ${record.thoi_gian_ket_thuc}` : '';
  return {
    type: TYPE,
    title: 'Có yêu cầu nghỉ phép mới',
    message: `${record.ho_ten} vừa gửi yêu cầu nghỉ phép${range}.`,
    relatedType: RELATED_TYPE,
    relatedId: record.request_id
  };
}

function createLeaveBellNotifier({
  pool = null,
  repo = leaveRepo,
  authorization = createHrLeaveAuthorization(),
  notificationRepo = notificationRepository,
  windowMs = WINDOW_MS,
  log = console.log
} = {}) {
  /** 1 lượt quét. Trả { sent: [{ requestId, recipients }] } để test / log. */
  async function runOnce() {
    const result = { sent: [] };
    let client;
    try {
      client = await (pool || getPool()).connect();
    } catch (err) {
      console.error('[leaveBell] Không kết nối được DB:', err.message);
      return result;
    }
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [LOCK_KEY]);
      if (!lock.rows[0].locked) { await client.query('ROLLBACK'); return result; }
      const { rows } = await client.query(PENDING_SQL,
        [leaveRepo.LEAVE_STATUS.PENDING, windowMs, TYPE, RELATED_TYPE, BATCH]);
      for (const { request_id: requestId } of rows) {
        const record = await repo.getLeaveRequestById(requestId, [BRANCHES.HANOI, BRANCHES.SAIGON]);
        if (!record) continue;
        const routing = await authorization.routingFor(record);
        // Nguoi gui cung duoc giao duyet phong ban minh thi khong tu bao cho minh.
        const ids = routing.users.map(user => user.id).filter(id => String(id) !== String(record.user_id || ''));
        // Chua co nguoi duyet thi luot sau thu lai (trong WINDOW_MS).
        if (!ids.length) continue;
        await notificationRepo.createNotificationForUsers(ids, buildPayload(record), { db: client });
        result.sent.push({ requestId, recipients: ids.length });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[leaveBell] Lỗi quét đơn nghỉ phép mới:', err.message);
      return { sent: [] };
    } finally {
      client.release();
    }
    for (const { requestId, recipients } of result.sent) {
      log(`[leaveBell] Báo đơn ${requestId} cho ${recipients} người duyệt.`);
    }
    return result;
  }
  return { runOnce };
}

/** Chạy ngay lúc khởi động rồi quét định kỳ (timer unref, không giữ tiến trình). */
function startLeaveBellSchedule({
  notifier = createLeaveBellNotifier(),
  intervalMs = POLL_INTERVAL_MS,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask
} = {}) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await notifier.runOnce(); } finally { running = false; }
  };
  scheduleImmediate(tick);
  const timer = setIntervalFn(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { TYPE, RELATED_TYPE, POLL_INTERVAL_MS, WINDOW_MS, buildPayload, createLeaveBellNotifier, startLeaveBellSchedule };
