'use strict';

// Bao chuong cho SALE khi ke toan sua yeu cau ORDER VAT cua ho (2026-10-22).
// Khong ghi gi them luc sua: moi lan sua (PATCH /:id, /bulk, keo cham, dan, hoan tac) da nam trong
// vat_request_history. Job doc lich su moi hon CON TRO cua tung sale (vat_request_notice_state, 0080),
// gom theo sale; sale nao KT ngung sua du `quietMs` (10 phut) thi so gia tri DAU dot voi gia tri HIEN TAI
// tung truong — giong nhau (sua roi hoan tac) thi bo — roi gui 1 thong bao tom tat.
//
// Thu tu: don con tro + COMMIT truoc, roi moi ghi chuong -> khong bao gio gui trung; ghi chuong loi
// dung luc do thi dot do mat thong bao (ghi log). Chuong luu o bang Postgres `notifications` (0091).
// Khoa advisory chong 2 tien trinh quet cung luc.

const notificationRepository = require('../notifications/notificationRepository');
const localUserStore = require('../auth/localUserStore');
const { STATUS_LABELS } = require('./service');

const TYPE = 'vatRequestUpdated';
const RELATED_TYPE = 'vatRequest';
const QUIET_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;
const MAX_LINES = 5;
const ACTIVE_STATUS = 'Đang hoạt động';
// Khoa advisory rieng cua tinh nang (20531080 ~ migration 0080), khac cac khoa 205310xx da dung.
const LOCK_KEY = 20531080;
const FIELDS = ['status', 'accountant_note', 'arrival_date'];

// Lich su moi hon con tro cua sale (chua co con tro rieng thi theo moc '*'); chi lan sua cua nguoi
// KHAC nguoi tao yeu cau, tren yeu cau chua xoa, co gan tai khoan sale. Dong he thong (changed_by NULL,
// vd migration 0083 doi 0 -> 5 hang loat) khong bao.
const PENDING_SQL = `
  SELECT h.id, h.request_id, h.changed_at, h.field, h.old_value, r.created_by AS sale_id
  FROM vat_request_history h
  JOIN vat_requests r ON r.id = h.request_id
  LEFT JOIN vat_request_notice_state s ON s.sale_id = r.created_by
  WHERE h.action = 'update' AND h.field = ANY($1::text[])
    AND r.created_by IS NOT NULL AND NOT r.is_deleted
    AND h.changed_by IS NOT NULL AND h.changed_by IS DISTINCT FROM r.created_by
    AND h.id > COALESCE(s.last_history_id, (SELECT last_history_id FROM vat_request_notice_state WHERE sale_id = '*'), 0)
  ORDER BY h.id`;
const CURRENT_SQL = `
  SELECT id, customer_name, product_code, status, accountant_note, to_char(arrival_date, 'YYYY-MM-DD') AS arrival_date
  FROM vat_requests WHERE id = ANY($1::bigint[])`;
const ADVANCE_SQL = `
  INSERT INTO vat_request_notice_state (sale_id, last_history_id, updated_at) VALUES ($1, $2, now())
  ON CONFLICT (sale_id) DO UPDATE SET last_history_id = GREATEST(vat_request_notice_state.last_history_id, EXCLUDED.last_history_id), updated_at = now()`;

function plainDate(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function describe(field, value) {
  if (field === 'status') return STATUS_LABELS[value] || value || '';
  if (field === 'accountant_note') return value ? `note: ${value}` : '(xóa note)';
  return value ? `ngày về ${plainDate(value)}` : '(xóa ngày về)';
}

/**
 * changes: [{ request: { customer_name, product_code }, fields: [{ field, value }] }] -> { title, message }.
 * Moi yeu cau 1 dong (chuong hien xuong dong bang white-space:pre-line), toi da MAX_LINES dong.
 */
function formatDigest(changes) {
  const title = `Kế toán đã cập nhật ${changes.length} yêu cầu ORDER VAT`;
  const lines = changes.slice(0, MAX_LINES).map(({ request, fields }) => {
    const who = [request.customer_name, request.product_code].filter(Boolean).join(' · ') || 'Yêu cầu';
    return `${who}: ${fields.map(({ field, value }) => describe(field, value)).join(', ')}`;
  });
  if (changes.length > MAX_LINES) lines.push(`… và ${changes.length - MAX_LINES} yêu cầu khác`);
  return { title, message: lines.join('\n') };
}

function createSaleNotifier(options = {}) {
  const getPool = options.getPool || (() => require('../db/pool').getPool());
  const notificationRepo = options.notificationRepo || notificationRepository;
  const userStore = options.userStore || localUserStore;
  const now = options.now || (() => new Date());
  const quietMs = options.quietMs ?? QUIET_MS;
  const log = options.log || console.log;
  let warnedMissingTable = false;

  /** Gom lich su cua 1 sale -> danh sach yeu cau con thay doi that su (so gia tri dau dot vs hien tai). */
  function netChanges(events, currentById) {
    const firstOld = new Map(); // `${request}:${field}` -> old_value cua lan sua dau dot
    for (const event of events) {
      const key = `${event.request_id}:${event.field}`;
      if (!firstOld.has(key)) firstOld.set(key, event.old_value ?? '');
    }
    const byRequest = new Map();
    for (const [key, oldValue] of firstOld) {
      const [requestId, field] = key.split(':');
      const current = currentById.get(Number(requestId));
      if (!current) continue;
      const value = current[field] ?? '';
      if (String(value) === String(oldValue)) continue; // sua roi tra ve nhu cu
      if (!byRequest.has(current.id)) byRequest.set(current.id, { request: current, fields: [] });
      byRequest.get(current.id).fields.push({ field, value });
    }
    for (const entry of byRequest.values()) entry.fields.sort((a, b) => FIELDS.indexOf(a.field) - FIELDS.indexOf(b.field));
    return [...byRequest.values()];
  }

  /** 1 luot quet. Khong bao gio throw. Tra { sent: [{ saleId, count }], waiting } de test / log. */
  async function runOnce() {
    const result = { sent: [], waiting: 0 };
    const digests = [];
    let client;
    try {
      client = await getPool().connect();
    } catch (err) {
      console.error('[vatRequestNotify] Không kết nối được DB:', err.message);
      return result;
    }
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [LOCK_KEY]);
      if (!lock.rows[0].locked) { await client.query('ROLLBACK'); return result; }
      const { rows } = await client.query(PENDING_SQL, [FIELDS]);
      const bySale = new Map();
      for (const row of rows) {
        if (!bySale.has(row.sale_id)) bySale.set(row.sale_id, []);
        bySale.get(row.sale_id).push(row);
      }
      const cutoff = now().getTime() - quietMs;
      const due = [...bySale].filter(([, events]) => Math.max(...events.map(e => new Date(e.changed_at).getTime())) <= cutoff);
      result.waiting = bySale.size - due.length;
      if (due.length) {
        const ids = [...new Set(due.flatMap(([, events]) => events.map(e => Number(e.request_id))))];
        const current = await client.query(CURRENT_SQL, [ids]);
        const currentById = new Map(current.rows.map(row => [Number(row.id), { ...row, id: Number(row.id) }]));
        for (const [saleId, events] of due) {
          const changes = netChanges(events, currentById).sort((a, b) => a.request.id - b.request.id);
          await client.query(ADVANCE_SQL, [saleId, Math.max(...events.map(e => Number(e.id)))]);
          if (changes.length) digests.push({ saleId, changes });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '42P01') {
        if (!warnedMissingTable) log('[vatRequestNotify] Chưa áp migration 0080, bỏ qua thông báo ORDER VAT.');
        warnedMissingTable = true;
      } else {
        console.error('[vatRequestNotify] Lỗi quét thông báo ORDER VAT:', err.message);
      }
      return result;
    } finally {
      client.release();
    }

    // Sau COMMIT: con tro da tien -> ghi chuong (best-effort, khong gui trung).
    for (const { saleId, changes } of digests) {
      try {
        const user = await userStore.getUserById(saleId);
        if (!user || user.trangThai !== ACTIVE_STATUS) continue;
        const { title, message } = formatDigest(changes);
        await notificationRepo.createNotification({
          recipientUserId: saleId, type: TYPE, title, message, relatedType: RELATED_TYPE, relatedId: String(changes[0].request.id)
        });
        result.sent.push({ saleId, count: changes.length });
        log(`[vatRequestNotify] Báo ${changes.length} yêu cầu cho sale ${saleId}.`);
      } catch (err) {
        console.error(`[vatRequestNotify] Không ghi được thông báo cho sale ${saleId}:`, err.message);
      }
    }
    return result;
  }

  return { runOnce };
}

/** Chay ngay luc khoi dong roi quet moi phut (timer unref, khong giu tien trinh). */
function startSaleNotifySchedule({
  notifier = createSaleNotifier(),
  intervalMs = POLL_INTERVAL_MS,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask
} = {}) {
  let running = false;
  const tick = async () => {
    if (running) return; // luot truoc chua xong (DB cham) thi bo qua luot nay
    running = true;
    try { await notifier.runOnce(); } finally { running = false; }
  };
  scheduleImmediate(tick);
  const timer = setIntervalFn(tick, intervalMs);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { TYPE, RELATED_TYPE, QUIET_MS, POLL_INTERVAL_MS, MAX_LINES, formatDigest, createSaleNotifier, startSaleNotifySchedule };
