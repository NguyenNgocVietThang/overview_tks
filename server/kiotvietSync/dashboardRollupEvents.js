'use strict';

// EventEmitter dung chung giua dashboardRollupRefresh.js (noi phat su kien
// 'updated' moi lan rollup refresh xong, 5 phut/lan) va route SSE
// /api/dashboard/events trong routes.js (noi lang nghe de day tin hieu xuong
// trinh duyet). Tach rieng file de tranh vong lap require giua 2 noi tren.
const { EventEmitter } = require('events');

const CHANNEL = 'tks_events';
const localEmit = EventEmitter.prototype.emit;

const dashboardRollupEvents = new EventEmitter();
// Nhieu tab trinh duyet cung mo -> nhieu SSE client dang ky 'updated' cung
// luc; nang gioi han mac dinh (10) de Node khong canh bao MaxListeners.
dashboardRollupEvents.setMaxListeners(0);

// ── Cau noi giua 2 tien trinh (web + worker.js, xem BACKGROUND_JOBS) ─────────
// Worker goi publishToPostgres(): moi emit con gui pg_notify. Web goi
// listenToPostgres(): nhan NOTIFY roi emit lai tai cho, payload gan remote:true
// de listener biet su kien den tu tien trinh khac (vd khong chay lai job nen).
// Mat ket noi -> cache web van tu het han theo TTL du phong (dashboardData.js).
function publishToPostgres(pool) {
  dashboardRollupEvents.emit = function emit(event, payload) {
    const result = localEmit.apply(this, arguments);
    let message = JSON.stringify({ event, payload: payload === undefined ? null : payload });
    if (message.length > 7000) message = JSON.stringify({ event, payload: null }); // NOTIFY toi da 8000 byte
    pool.query('SELECT pg_notify($1, $2)', [CHANNEL, message]).catch(error => {
      console.error(`[Events] Khong gui duoc '${event}' sang web:`, error.message);
    });
    return result;
  };
}

function listenToPostgres(createClient, { retryMs = 5000, log = console } = {}) {
  let client = null;
  let stopped = false;
  let retryTimer = null;

  function onNotification(msg) {
    let parsed;
    try { parsed = JSON.parse(msg.payload); } catch { return; }
    if (!parsed || typeof parsed.event !== 'string') return;
    const payload = parsed.payload && typeof parsed.payload === 'object' ? { ...parsed.payload, remote: true } : { remote: true };
    localEmit.call(dashboardRollupEvents, parsed.event, payload);
  }

  function scheduleRetry(error) {
    if (client) { client.removeAllListeners(); client.end().catch(() => {}); client = null; }
    if (stopped || retryTimer) return;
    log.error('[Events] Mat ket noi LISTEN, thu lai sau', retryMs, 'ms:', error && error.message);
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
    retryTimer.unref();
  }

  async function connect() {
    const next = createClient();
    client = next;
    next.on('notification', onNotification);
    next.on('error', scheduleRetry);
    next.on('end', () => scheduleRetry(new Error('connection ended')));
    try {
      await next.connect();
      await next.query(`LISTEN ${CHANNEL}`);
      log.log('[Events] Dang nghe su kien tu worker qua Postgres');
    } catch (error) {
      if (client === next) scheduleRetry(error);
    }
  }

  connect();
  return {
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      if (client) { client.removeAllListeners(); client.end().catch(() => {}); client = null; }
    }
  };
}

module.exports = { dashboardRollupEvents, publishToPostgres, listenToPostgres, CHANNEL };
