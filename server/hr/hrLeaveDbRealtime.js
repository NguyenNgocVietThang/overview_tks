'use strict';

const repo = require('./hrLeaveRepository');
const { BRANCHES } = require('../branch/branches');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('./hrLeaveEvents');

// Compare committed snapshots rather than sequence cursors: transactions can
// commit out of order. Notification-marker writes are not decision changes.
function createLeaveDbRealtime({
  load = () => repo.getLeaveRequests({}, [BRANCHES.HANOI, BRANCHES.SAIGON]),
  broadcast = broadcastLeaveEvent, intervalMs = 5000, logger = console
} = {}) {
  let versions = null;
  let timer;
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const records = await load();
      const next = new Map();
      for (const record of records) {
        const version = String(record.decision_version || '0');
        next.set(record.request_id, version);
        if (!versions) continue;
        if (!versions.has(record.request_id)) broadcast(LEAVE_EVENT_TYPES.CREATED, record, record.co_so);
        else if (versions.get(record.request_id) !== version) broadcast(LEAVE_EVENT_TYPES.STATUS_CHANGED, record, record.co_so);
      }
      versions = next;
    } catch (err) {
      logger.error('[HR realtime] Không thể đọc thay đổi DB:', err.code || 'DB_UNAVAILABLE');
    } finally { polling = false; }
  }
  function start() {
    if (timer) return;
    void poll();
    timer = setInterval(poll, intervalMs);
    timer.unref();
  }
  function stop() { clearInterval(timer); timer = null; }
  return { poll, start, stop };
}

module.exports = { createLeaveDbRealtime };
