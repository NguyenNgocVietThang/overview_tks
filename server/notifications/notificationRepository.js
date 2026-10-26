// ==========================================
// NOTIFICATION REPOSITORY — Lưu trữ thông báo chuông cho mọi tài khoản ở bảng
// Postgres `notifications` (migration 0093). Trước đây lưu ở file
// server/data/notifications.json, nhưng đĩa của Render bị xóa mỗi lần deploy /
// khởi động lại nên mất hết lịch sử chuông. Dùng chung cho MỌI loại thông báo
// trong hệ thống — thêm loại mới bằng cách truyền `type` khác khi gọi
// createNotification(), không cần đổi schema.
// ==========================================
'use strict';

const crypto = require('crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = 'id, recipient_user_id, type, title, message, related_type, related_id, is_read, created_at';

let injectedPool = null;

/** Test thay pool gia (PGlite) — null = quay ve mac dinh. */
function setPool(pool) {
  injectedPool = pool || null;
}

function resolvePool() {
  if (injectedPool) return injectedPool;
  // node --test nap .env (config.js) nen co the tro vao DB that: test khong tiem
  // pool thi bao loi, tranh ghi rac vao chuong production.
  if (process.env.NODE_TEST_CONTEXT) {
    throw new Error('notificationRepository: test chưa gọi setPool().');
  }
  return require('../db/pool').getPool();
}

function rowToNotification(row) {
  return {
    id: String(row.id),
    recipientUserId: row.recipient_user_id,
    type: row.type,
    title: row.title,
    message: row.message,
    relatedType: row.related_type,
    relatedId: row.related_id,
    isRead: row.is_read === true,
    createdAt: new Date(row.created_at).toISOString()
  };
}

/**
 * Tạo 1 thông báo mới cho 1 người nhận.
 */
async function createNotification({ recipientUserId, type, title, message, relatedType, relatedId }) {
  if (!recipientUserId) throw new Error('Thiếu recipientUserId khi tạo thông báo.');
  const [created] = await createNotificationForUsers([recipientUserId], { type, title, message, relatedType, relatedId });
  return created;
}

/**
 * Tạo cùng 1 thông báo cho nhiều người nhận (vd: toàn bộ Quản lý) — 1 câu INSERT cho cả lô.
 * `db` (tùy chọn): client đang mở transaction, để ghi chuông cùng transaction với việc khác.
 */
async function createNotificationForUsers(recipientUserIds, payload, { db } = {}) {
  const ids = Array.from(recipientUserIds || []);
  if (!ids.length) return [];
  if (!payload || !payload.type) throw new Error('Thiếu type khi tạo thông báo.');
  if (ids.some(id => !id)) throw new Error('Thiếu recipientUserId khi tạo thông báo.');
  const { rows } = await (db || resolvePool()).query(
    `INSERT INTO notifications (id, recipient_user_id, type, title, message, related_type, related_id, created_at)
     SELECT r.id, r.recipient_user_id, $3, $4, $5, $6, $7, $8
     FROM unnest($1::uuid[], $2::text[]) WITH ORDINALITY AS r(id, recipient_user_id, ord)
     ORDER BY r.ord
     RETURNING ${COLUMNS}`,
    [
      ids.map(() => crypto.randomUUID()),
      ids.map(String),
      payload.type,
      payload.title || '',
      payload.message || '',
      payload.relatedType || null,
      payload.relatedId == null ? null : String(payload.relatedId),
      new Date().toISOString()
    ]
  );
  return rows.map(rowToNotification);
}

async function listForUser(userId, { unreadOnly } = {}) {
  const { rows } = await resolvePool().query(
    `SELECT ${COLUMNS} FROM notifications
     WHERE recipient_user_id = $1 AND ($2::boolean IS NOT TRUE OR NOT is_read)
     ORDER BY created_at DESC, seq DESC`,
    [String(userId), unreadOnly === true]
  );
  return rows.map(rowToNotification);
}

async function getUnreadCount(userId) {
  const { rows } = await resolvePool().query(
    'SELECT count(*)::int AS n FROM notifications WHERE recipient_user_id = $1 AND NOT is_read',
    [String(userId)]
  );
  return Number(rows[0].n);
}

async function markRead(id, userId) {
  if (!UUID_RE.test(String(id))) return null;
  const { rows } = await resolvePool().query(
    `UPDATE notifications SET is_read = true WHERE id = $1 AND recipient_user_id = $2 RETURNING ${COLUMNS}`,
    [String(id), String(userId)]
  );
  return rows.length ? rowToNotification(rows[0]) : null;
}

async function markAllRead(userId) {
  const { rows } = await resolvePool().query(
    'UPDATE notifications SET is_read = true WHERE recipient_user_id = $1 AND NOT is_read RETURNING id',
    [String(userId)]
  );
  return rows.length;
}

async function deleteNotification(id, userId) {
  if (!UUID_RE.test(String(id))) return false;
  const { rows } = await resolvePool().query(
    'DELETE FROM notifications WHERE id = $1 AND recipient_user_id = $2 RETURNING id',
    [String(id), String(userId)]
  );
  return rows.length > 0;
}

async function deleteAllForUser(userId) {
  const { rows } = await resolvePool().query(
    'DELETE FROM notifications WHERE recipient_user_id = $1 RETURNING id',
    [String(userId)]
  );
  return rows.length;
}

module.exports = {
  setPool,
  createNotification,
  createNotificationForUsers,
  listForUser,
  getUnreadCount,
  markRead,
  markAllRead,
  deleteNotification,
  deleteAllForUser
};
