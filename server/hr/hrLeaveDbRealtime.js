'use strict';

const repo = require('./hrLeaveRepository');
const { BRANCHES } = require('../branch/branches');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('./hrLeaveEvents');

// Compare committed snapshots rather than sequence cursors: transactions can
// commit out of order. Notification-marker writes are not decision changes.
function createLeaveDbRealtime({
  loadVersions = () => repo.getLeaveVersions([BRANCHES.HANOI, BRANCHES.SAIGON]),
  loadRecord = id => repo.getLeaveRequestById(id, [BRANCHES.HANOI, BRANCHES.SAIGON]),
  broadcast = broadcastLeaveEvent, intervalMs = 5000, logger = console
} = {}) {
  let versions = null;
  let timer;
  let polling = false;
  // Chỉ đọc (id, phiên bản); bản ghi đầy đủ chỉ tải cho đơn mới/đổi để phát sự kiện.
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const rows = await loadVersions();
      const next = new Map();
      const changed = [];
      for (const row of rows) {
        const version = String(row.decision_version || '0');
        next.set(row.request_id, version);
        if (!versions) continue;
        if (!versions.has(row.request_id)) changed.push([LEAVE_EVENT_TYPES.CREATED, row.request_id]);
        else if (versions.get(row.request_id) !== version) changed.push([LEAVE_EVENT_TYPES.STATUS_CHANGED, row.request_id]);
      }
      for (const [type, id] of changed) {
        const record = await loadRecord(id);
        if (record) broadcast(type, record, record.co_so);
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
