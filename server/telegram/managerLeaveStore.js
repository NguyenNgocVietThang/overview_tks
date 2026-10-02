'use strict';

const { randomUUID } = require('node:crypto');
const { getPool } = require('../db/pool');
const { createHrLeaveRepository } = require('../hr/hrLeaveRepository');

const BIGINT_FIELDS = ['id', 'update_id', 'decision_version', 'desired_version', 'sent_version',
  'expected_version', 'message_id', 'prompt_message_id', 'telegram_chat_id'];

function normalizeRow(row) {
  if (!row) return null;
  const value = { ...row };
  for (const name of BIGINT_FIELDS) {
    if (value[name] != null) value[name] = String(value[name]);
  }
  return value;
}

function retryDelay(job, requested) {
  if (requested != null && Number.isFinite(Number(requested))) {
    return Math.min(3600, Math.max(1, Math.ceil(Number(requested))));
  }
  return Math.min(3600, 5 * (2 ** Math.min(10, Math.max(0, Number(job.attempts) || 0))));
}

function errorText(error) {
  return String(error && error.message || error || 'Unknown error').slice(0, 1000);
}

function isForbidden(error) {
  return [error && error.statusCode, error && error.status, error && error.error_code,
    error && error.response && error.response.status, error && error.code].some(code => Number(code) === 403);
}

function createManagerLeaveStore({ pool = getPool() } = {}) {
  async function activate() {
    await pool.query(`INSERT INTO hr_manager_telegram_state(singleton)
      VALUES (true) ON CONFLICT (singleton) DO NOTHING`);
    const { rows } = await pool.query('SELECT first_enabled_at FROM hr_manager_telegram_state WHERE singleton = true');
    // Refresh keyboards on existing open cards after a code update/restart.
    // Keep blocked chats and active delivery leases untouched.
    await pool.query(`UPDATE hr_leave_manager_messages m
      SET sent_version = -1, available_at = now(), updated_at = now()
      FROM hr_leave_requests r
      WHERE r.request_id = m.request_id AND r.loai_yeu_cau = 'Xin nghỉ phép'
        AND r.trang_thai NOT IN ('Đã duyệt', 'Từ chối')
        AND m.message_id IS NOT NULL AND NOT m.blocked
        AND (m.lease_until IS NULL OR m.lease_until <= now())`);
    return new Date(rows[0].first_enabled_at);
  }

  async function claim(table, key, pending, limit) {
    const size = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 1)));
    const { rows } = await pool.query(`WITH ready AS (
      SELECT q.${key} FROM ${table} q
       WHERE ${pending} AND available_at <= now()
         AND (lease_until IS NULL OR lease_until <= now())
       ORDER BY q.available_at, q.${key} FOR UPDATE OF q SKIP LOCKED LIMIT $1
    ) UPDATE ${table} q SET lease_token = gen_random_uuid(),
        lease_until = now() + interval '2 minutes', attempts = q.attempts + 1
      FROM ready WHERE q.${key} = ready.${key} RETURNING q.*`, [size]);
    return rows.map(normalizeRow);
  }

  async function enqueueUpdate(update) {
    const { rows } = await pool.query(`INSERT INTO hr_manager_telegram_updates(update_id, payload)
      VALUES ($1::bigint, $2::jsonb) ON CONFLICT (update_id) DO NOTHING RETURNING update_id`,
    [String(update.update_id), JSON.stringify(update)]);
    return rows.length > 0;
  }

  async function claimUpdates(limit = 10) {
    return claim('hr_manager_telegram_updates', 'update_id', `q.completed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM hr_manager_telegram_updates earlier
        WHERE earlier.chat_key = q.chat_key AND earlier.update_id < q.update_id
          AND earlier.completed_at IS NULL)`, limit);
  }

  async function handleUpdate(job, callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM hr_manager_telegram_updates
        WHERE update_id = $1::bigint AND lease_token = $2::uuid FOR UPDATE`, [job.update_id, job.lease_token]);
      const row = rows[0];
      if (!row) {
        const error = new Error('Telegram update lease is no longer owned.');
        error.code = 'TELEGRAM_LEASE_LOST';
        throw error;
      }
      let effects = row.effects;
      if (!row.handled_at) {
        effects = await callback({ store: createManagerLeaveStore({ pool: client }),
          leaveRepo: createHrLeaveRepository({ pool: client }) });
        if (!Array.isArray(effects)) throw new TypeError('Telegram update handler must return an effect array.');
        await client.query(`UPDATE hr_manager_telegram_updates SET effects = $3::jsonb, handled_at = now()
          WHERE update_id = $1::bigint AND lease_token = $2::uuid`, [job.update_id, job.lease_token, JSON.stringify(effects)]);
      }
      await client.query('COMMIT');
      return effects;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async function completeEffect(job, count) {
    if (!Number.isInteger(count) || count < 0) throw new TypeError('Completed effect count must be a nonnegative integer.');
    const { rows } = await pool.query(`UPDATE hr_manager_telegram_updates
      SET effects_done = GREATEST(effects_done, $3)
      WHERE update_id = $1::bigint AND lease_token = $2::uuid AND handled_at IS NOT NULL
        AND $3 <= jsonb_array_length(effects) RETURNING update_id`, [job.update_id, job.lease_token, count]);
    return rows.length > 0;
  }

  async function completeUpdate(job) {
    const { rows } = await pool.query(`UPDATE hr_manager_telegram_updates
      SET completed_at = now(), lease_token = NULL, lease_until = NULL, last_error = NULL
      WHERE update_id = $1::bigint AND lease_token = $2::uuid AND handled_at IS NOT NULL
        AND effects_done = jsonb_array_length(effects) RETURNING update_id`, [job.update_id, job.lease_token]);
    return rows.length > 0;
  }

  async function retryOwned(table, key, job, error, requested, blocked = false) {
    const { rows } = await pool.query(`UPDATE ${table}
      SET available_at = now() + ($3 * interval '1 second'), lease_token = NULL,
        lease_until = NULL, last_error = $4${table === 'hr_leave_manager_messages' ? ', blocked = $5' : ''}
      WHERE ${key} = $1::bigint AND lease_token = $2::uuid RETURNING ${key}`,
    [job[key], job.lease_token, retryDelay(job, requested), errorText(error),
      ...(table === 'hr_leave_manager_messages' ? [blocked] : [])]);
    return rows.length > 0;
  }

  async function retryUpdate(job, error, retryAfterSeconds) {
    return retryOwned('hr_manager_telegram_updates', 'update_id', job, error, retryAfterSeconds);
  }

  async function getSession(chatId) {
    const { rows } = await pool.query(`SELECT * FROM hr_manager_telegram_sessions
      WHERE telegram_chat_id = $1 AND expires_at > now()`, [String(chatId)]);
    return normalizeRow(rows[0]);
  }

  async function saveSession({ chatId, userId, requestId, expectedVersion }) {
    const { rows } = await pool.query(`INSERT INTO hr_manager_telegram_sessions
      (telegram_chat_id, session_id, user_id, request_id, expected_version, expires_at)
      VALUES ($1, $2::uuid, $3::uuid, $4, $5::bigint, now() + interval '15 minutes')
      ON CONFLICT (telegram_chat_id) DO UPDATE SET session_id = EXCLUDED.session_id,
        user_id = EXCLUDED.user_id, request_id = EXCLUDED.request_id,
        expected_version = EXCLUDED.expected_version, prompt_message_id = NULL,
        expires_at = EXCLUDED.expires_at, updated_at = now() RETURNING *`,
    [String(chatId), randomUUID(), userId, requestId, String(expectedVersion)]);
    return normalizeRow(rows[0]);
  }

  async function deleteSession(chatId, sessionId) {
    const { rows } = await pool.query(`DELETE FROM hr_manager_telegram_sessions
      WHERE telegram_chat_id = $1${sessionId == null ? '' : ' AND session_id = $2::uuid'} RETURNING session_id`,
    [String(chatId), ...(sessionId == null ? [] : [sessionId])]);
    return rows.length > 0;
  }

  async function setSessionPrompt(chatId, sessionId, messageId) {
    const { rows } = await pool.query(`UPDATE hr_manager_telegram_sessions
      SET prompt_message_id = $3::bigint, updated_at = now()
      WHERE telegram_chat_id = $1 AND session_id = $2::uuid AND expires_at > now() RETURNING session_id`,
    [String(chatId), sessionId, String(messageId)]);
    return rows.length > 0;
  }

  async function getDelivery(requestId, userId, chatId) {
    const { rows } = await pool.query(`SELECT * FROM hr_leave_manager_messages
      WHERE request_id = $1 AND user_id = $2::uuid AND telegram_chat_id = $3`, [requestId, userId, String(chatId)]);
    return normalizeRow(rows[0]);
  }

  async function enqueueDelivery({ requestId, userId, chatId, version }) {
    const { rows } = await pool.query(`INSERT INTO hr_leave_manager_messages
      (request_id, user_id, telegram_chat_id, desired_version) VALUES ($1, $2::uuid, $3, $4::bigint)
      ON CONFLICT (request_id, user_id, telegram_chat_id) DO UPDATE
        SET desired_version = GREATEST(hr_leave_manager_messages.desired_version, EXCLUDED.desired_version),
          updated_at = now() RETURNING *`, [requestId, userId, String(chatId), String(version)]);
    return normalizeRow(rows[0]);
  }

  async function queueExistingDeliveries(requestId, version) {
    const { rows } = await pool.query(`UPDATE hr_leave_manager_messages
      SET desired_version = GREATEST(desired_version, $2::bigint), updated_at = now()
      WHERE request_id = $1 RETURNING *`, [requestId, String(version)]);
    return rows.map(normalizeRow);
  }

  async function claimDeliveries(limit = 20) {
    return claim('hr_leave_manager_messages', 'id', 'NOT blocked AND desired_version > sent_version', limit);
  }

  async function finishDelivery(job, { messageId, version, blocked = false }) {
    const { rows } = await pool.query(`UPDATE hr_leave_manager_messages
      SET message_id = COALESCE($3::bigint, message_id), sent_version = GREATEST(sent_version, $4::bigint),
        blocked = $5, attempts = 0, available_at = now(), lease_token = NULL,
        lease_until = NULL, last_error = NULL, updated_at = now()
      WHERE id = $1::bigint AND lease_token = $2::uuid RETURNING id`,
    [job.id, job.lease_token, messageId == null ? null : String(messageId), String(version), !!blocked]);
    return rows.length > 0;
  }

  async function retryDelivery(job, error, retryAfterSeconds) {
    return retryOwned('hr_leave_manager_messages', 'id', job, error, retryAfterSeconds, isForbidden(error));
  }

  async function wakeDeliveries(chatId) {
    const { rows } = await pool.query(`UPDATE hr_leave_manager_messages
      SET sent_version = CASE WHEN blocked THEN -1 ELSE sent_version END,
        blocked = false, available_at = now(), attempts = 0, last_error = NULL, updated_at = now()
      WHERE telegram_chat_id = $1 RETURNING id`, [String(chatId)]);
    return rows.length;
  }

  async function claimEvents(limit = 20) {
    return claim('hr_leave_change_events', 'id', 'completed_at IS NULL', limit);
  }

  async function completeEvent(job) {
    const { rows } = await pool.query(`UPDATE hr_leave_change_events
      SET completed_at = now(), lease_token = NULL, lease_until = NULL, last_error = NULL
      WHERE id = $1::bigint AND lease_token = $2::uuid RETURNING id`, [job.id, job.lease_token]);
    return rows.length > 0;
  }

  async function retryEvent(job, error) {
    return retryOwned('hr_leave_change_events', 'id', job, error);
  }

  return { activate, enqueueUpdate, claimUpdates, handleUpdate, completeEffect, completeUpdate, retryUpdate,
    getSession, saveSession, deleteSession, setSessionPrompt, getDelivery, enqueueDelivery,
    queueExistingDeliveries, claimDeliveries, finishDelivery, retryDelivery, wakeDeliveries,
    claimEvents, completeEvent, retryEvent };
}

module.exports = { createManagerLeaveStore };
