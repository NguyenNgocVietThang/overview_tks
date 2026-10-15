'use strict';
// SQL cho yeu cau chuyen tien (migration 0053). Moi thay doi trang thai/truong di qua
// updateWithEvent: khoa dong (FOR UPDATE), kiem version + trang thai, UPDATE roi ghi 1 su kien
// trong CUNG giao dich — trigger DB la rao chan cuoi cung.

const { getPool } = require('../db/pool');

const COLUMNS = Object.freeze({
  customerName: 'customer_name',
  amountVnd: 'amount_vnd',
  bankAccount: 'bank_account',
  accountType: 'account_type',
  accountHolder: 'account_holder',
  bankBin: 'bank_bin',
  bankNameRaw: 'bank_name_raw',
  note: 'note',
  accountantNote: 'accountant_note',
  status: 'status',
  approvedAt: 'approved_at',
  approvedByUserId: 'approved_by_user_id',
  approvedByName: 'approved_by_name',
  paidAt: 'paid_at',
  paidByUserId: 'paid_by_user_id',
  paidByName: 'paid_by_name',
  canceledAt: 'canceled_at',
  canceledByType: 'canceled_by_type',
  canceledByUserId: 'canceled_by_user_id',
  canceledByName: 'canceled_by_name',
  cancelReason: 'cancel_reason'
});

// Ten sale: lay tu tai khoan web da gan Telegram ID (app_users.telegram_id), khong thi dung ten
// sale tu go trong bot. Gan ID xong thi cac dong cu tu hien ten dung.
const SELECT_REQUEST = `
  SELECT t.*, b.short_name AS bank_short_name, b.name AS bank_full_name,
         COALESCE(NULLIF(u.ho_ten, ''), t.sale_name_bot) AS sale_name,
         (u.id IS NOT NULL) AS sale_linked
    FROM transfer_requests t
    LEFT JOIN bank_bins b ON b.bin = t.bank_bin
    LEFT JOIN LATERAL (
      SELECT id, ho_ten FROM app_users
       WHERE telegram_id = t.sale_telegram_id AND telegram_id <> '' AND NOT is_deleted
       LIMIT 1
    ) u ON true`;

const iso = v => (v == null ? null : new Date(v).toISOString());

function mapRequest(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    requestCode: row.request_code,
    source: row.source,
    inputKind: row.input_kind,
    saleTelegramId: row.sale_telegram_id,
    saleNameBot: row.sale_name_bot,
    saleName: row.sale_name != null ? row.sale_name : row.sale_name_bot,
    saleLinked: !!row.sale_linked,
    customerName: row.customer_name,
    amountVnd: Number(row.amount_vnd),
    bankAccount: row.bank_account,
    accountType: row.account_type,
    accountHolder: row.account_holder,
    bankBin: row.bank_bin,
    bankShortName: row.bank_short_name || null,
    bankFullName: row.bank_full_name || null,
    bankNameRaw: row.bank_name_raw,
    note: row.note,
    accountantNote: row.accountant_note,
    qrPayload: row.qr_payload,
    fieldSources: row.field_sources || {},
    status: row.status,
    version: Number(row.version),
    createdAt: iso(row.created_at),
    receivedAt: iso(row.received_at),
    updatedAt: iso(row.updated_at),
    approvedAt: iso(row.approved_at),
    approvedByUserId: row.approved_by_user_id,
    approvedByName: row.approved_by_name,
    paidAt: iso(row.paid_at),
    paidByUserId: row.paid_by_user_id,
    paidByName: row.paid_by_name,
    canceledAt: iso(row.canceled_at),
    canceledByType: row.canceled_by_type,
    canceledByUserId: row.canceled_by_user_id,
    canceledByName: row.canceled_by_name,
    cancelReason: row.cancel_reason
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    requestId: Number(row.request_id),
    version: Number(row.version),
    type: row.event_type,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    changes: row.changes || [],
    reason: row.reason,
    at: iso(row.created_at)
  };
}

function conflict(code, current, message) {
  const error = new Error(message || code);
  error.statusCode = 409;
  error.code = code;
  error.current = current;
  return error;
}

function createRepository({ pool = getPool() } = {}) {
  async function withTx(fn) {
    const client = await pool.connect();
    const q = (sql, args) => client.query(sql, args);
    try {
      await q('BEGIN');
      const result = await fn(q);
      await q('COMMIT');
      return result;
    } catch (error) {
      try { await q('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function query(sql, args) {
    const client = await pool.connect();
    try {
      return await client.query(sql, args);
    } finally {
      client.release();
    }
  }

  async function getById(id, q = query) {
    const { rows } = await q(`${SELECT_REQUEST} WHERE t.id = $1`, [id]);
    return mapRequest(rows[0]);
  }

  async function getByCode(code, q = query) {
    const { rows } = await q(`${SELECT_REQUEST} WHERE t.request_code = $1`, [code]);
    return mapRequest(rows[0]);
  }

  async function insertEvent(q, requestId, version, event) {
    await q(
      `INSERT INTO transfer_request_events
         (request_id, version, event_type, actor_type, actor_user_id, actor_name, changes, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [requestId, version, event.type, event.actorType, event.actorUserId || null,
        event.actorName || '', JSON.stringify(event.changes || []), event.reason || null]
    );
  }

  /** Tao tu bot. Trung idempotency_key -> tra lai dong cu (duplicate); trung ma khac khoa -> CODE_CLASH. */
  async function insertFromBot(input) {
    return withTx(async (q) => {
      let inserted;
      try {
        ({ rows: [inserted] } = await q(
          `INSERT INTO transfer_requests
             (request_code, idempotency_key, source, input_kind, sale_telegram_id, sale_name_bot,
              customer_name, amount_vnd, bank_account, account_type, account_holder, bank_bin,
              bank_name_raw, note, accountant_note, qr_payload, field_sources, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [input.requestCode, input.idempotencyKey, input.source, input.inputKind, input.saleTelegramId,
            input.saleNameBot, input.customerName, input.amountVnd, input.bankAccount, input.accountType,
            input.accountHolder, input.bankBin, input.bankNameRaw, input.note, input.accountantNote || '',
            input.qrPayload || null, JSON.stringify(input.fieldSources || {}), input.createdAt]
        ));
      } catch (error) {
        if (error && error.code === '23505') throw conflict('CODE_CLASH', null, 'Mã yêu cầu đã tồn tại với nội dung khác.');
        throw error;
      }
      if (!inserted) {
        const { rows: [existing] } = await q('SELECT id, request_code, sale_telegram_id FROM transfer_requests WHERE idempotency_key = $1', [input.idempotencyKey]);
        if (existing.request_code !== input.requestCode || existing.sale_telegram_id !== input.saleTelegramId) {
          throw conflict('CODE_CLASH', null, 'Khóa idempotency đã dùng cho yêu cầu khác.');
        }
        return { duplicate: true, request: await getById(existing.id, q) };
      }
      const id = inserted.id;
      await insertEvent(q, id, 1, {
        type: input.source === 'cutover' ? 'IMPORTED' : 'CREATED',
        actorType: input.source === 'cutover' ? 'SYSTEM' : 'SALE',
        actorName: input.saleNameBot,
        reason: input.importNote || null
      });
      if (input.canceled) {
        const { rows: [row] } = await q(
          `UPDATE transfer_requests SET status = 'DA_HUY', canceled_at = $2, canceled_by_type = 'SALE',
                  canceled_by_name = $3, cancel_reason = $4
            WHERE id = $1 RETURNING version`,
          [id, input.canceled.at, input.saleNameBot, input.canceled.reason || null]
        );
        await insertEvent(q, id, Number(row.version), {
          type: 'CANCELED', actorType: 'SALE', actorName: input.saleNameBot, reason: input.canceled.reason || null
        });
      }
      return { duplicate: false, request: await getById(id, q) };
    });
  }

  /**
   * Doi trang thai/truong co ghi su kien. `set`/`event` co the la ham nhan ban ghi hien tai.
   * expectedVersion = null: khong kiem version (vd sale huy tu bot).
   */
  async function updateWithEvent(id, { expectedVersion = null, allowedStatuses, set, event }) {
    return withTx(async (q) => {
      const { rows: [locked] } = await q('SELECT id FROM transfer_requests WHERE id = $1 FOR UPDATE', [id]);
      const current = locked ? await getById(id, q) : null;
      if (!current) {
        const error = new Error('Không tìm thấy yêu cầu.');
        error.statusCode = 404;
        error.code = 'NOT_FOUND';
        throw error;
      }
      if (expectedVersion != null && current.version !== Number(expectedVersion)) {
        throw conflict('STALE', current, 'Yêu cầu vừa được người khác cập nhật. Vui lòng tải lại.');
      }
      if (!allowedStatuses.includes(current.status)) {
        throw conflict('INVALID_STATE', current, 'Trạng thái yêu cầu không cho phép thao tác này.');
      }
      const values = typeof set === 'function' ? set(current) : set;
      const entries = Object.entries(values).filter(([key]) => COLUMNS[key]);
      if (!entries.length) throw new Error('updateWithEvent: nothing to update');
      const assignments = entries.map(([key], index) => `${COLUMNS[key]} = $${index + 2}`);
      const { rows: [row] } = await q(
        `UPDATE transfer_requests SET ${assignments.join(', ')} WHERE id = $1 RETURNING version`,
        [id, ...entries.map(([, value]) => value)]
      );
      await insertEvent(q, id, Number(row.version), typeof event === 'function' ? event(current) : event);
      return { before: current, after: await getById(id, q) };
    });
  }

  async function list({ status = null, q: search = '', from = null, to = null, saleTelegramId = null, page = 1, pageSize = 100 } = {}) {
    const args = [];
    const conds = [];
    const add = (sqlFn, value) => { args.push(value); conds.push(sqlFn(`$${args.length}`)); };
    if (saleTelegramId != null) add(p => `t.sale_telegram_id = ${p}`, saleTelegramId);
    if (from) add(p => `t.created_at >= (${p}::date)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`, from);
    if (to) add(p => `t.created_at < ((${p}::date) + 1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh'`, to);
    if (search) {
      add(p => `(t.request_code ILIKE ${p} OR t.customer_name ILIKE ${p} OR t.bank_account ILIKE ${p}
        OR t.account_holder ILIKE ${p} OR COALESCE(NULLIF(u.ho_ten, ''), t.sale_name_bot) ILIKE ${p})`,
      `%${search.replace(/[\\%_]/g, c => `\\${c}`)}%`);
    }
    const baseWhere = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const countRows = (await query(
      `SELECT t.status, count(*)::int AS n
         FROM transfer_requests t
         LEFT JOIN LATERAL (
           SELECT ho_ten FROM app_users
            WHERE telegram_id = t.sale_telegram_id AND telegram_id <> '' AND NOT is_deleted
            LIMIT 1
         ) u ON true
        ${baseWhere}
        GROUP BY t.status`,
      args
    )).rows;
    const counts = Object.fromEntries(['CHO_DUYET', 'DA_DUYET', 'DA_CHUYEN', 'DA_HUY'].map(s => [s, 0]));
    for (const r of countRows) counts[r.status] = Number(r.n);
    const statusConds = [...conds];
    const listArgs = [...args];
    if (status) {
      listArgs.push(status);
      statusConds.push(`t.status = $${listArgs.length}`);
    }
    const where = statusConds.length ? `WHERE ${statusConds.join(' AND ')}` : '';
    const total = status ? counts[status] || 0 : Object.values(counts).reduce((a, b) => a + b, 0);
    const size = Math.min(Math.max(Number(pageSize) || 100, 1), 500);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * size;
    listArgs.push(size, offset);
    const { rows } = await query(
      `${SELECT_REQUEST} ${where} ORDER BY t.created_at DESC, t.id DESC LIMIT $${listArgs.length - 1} OFFSET $${listArgs.length}`,
      listArgs
    );
    return { requests: rows.map(mapRequest), total, counts, page: Math.max(Number(page) || 1, 1), pageSize: size };
  }

  async function listEvents(requestId) {
    const { rows } = await query('SELECT * FROM transfer_request_events WHERE request_id = $1 ORDER BY id', [requestId]);
    return rows.map(mapEvent);
  }

  /** Su kien bot chua nhan, kem anh chup hien tai cua yeu cau (de bot cap nhat ban sao). */
  async function listUndeliveredEvents(limit = 100) {
    const size = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const { rows } = await query(
      `SELECT e.* FROM transfer_request_events e WHERE e.bot_delivered_at IS NULL ORDER BY e.id LIMIT $1`,
      [size]
    );
    const ids = [...new Set(rows.map(r => Number(r.request_id)))];
    const snapshots = new Map();
    if (ids.length) {
      const { rows: requests } = await query(`${SELECT_REQUEST} WHERE t.id = ANY($1::bigint[])`, [ids]);
      // Kem idempotency_key: bot doi chieu dung yeu cau cua minh (trung ma YC sau khi khoi phuc DB cu
      // khong duoc ap su kien cua yeu cau khac).
      for (const r of requests) snapshots.set(Number(r.id), { ...mapRequest(r), idempotencyKey: r.idempotency_key });
    }
    return rows.map(r => {
      const event = mapEvent(r);
      const snap = snapshots.get(event.requestId);
      return { ...event, requestCode: snap.requestCode, saleTelegramId: snap.saleTelegramId, snapshot: snap };
    });
  }

  async function ackEvents(ids) {
    const clean = [...new Set((ids || []).map(Number).filter(n => Number.isSafeInteger(n) && n > 0))];
    if (!clean.length) return 0;
    const { rows } = await query(
      `UPDATE transfer_request_events SET bot_delivered_at = now()
        WHERE id = ANY($1::bigint[]) AND bot_delivered_at IS NULL RETURNING id`,
      [clean]
    );
    return rows.length;
  }

  async function listBanks() {
    const { rows } = await query('SELECT bin, code, short_name, name FROM bank_bins WHERE is_active ORDER BY short_name');
    return rows.map(r => ({ bin: r.bin, code: r.code, shortName: r.short_name, name: r.name }));
  }

  async function getBank(bin) {
    if (!bin) return null;
    const { rows: [r] } = await query('SELECT bin, code, short_name, name, is_active FROM bank_bins WHERE bin = $1', [bin]);
    return r ? { bin: r.bin, code: r.code, shortName: r.short_name, name: r.name, isActive: r.is_active } : null;
  }

  return {
    getById, getByCode, insertFromBot, updateWithEvent, list, listEvents,
    listUndeliveredEvents, ackEvents, listBanks, getBank
  };
}

module.exports = { createRepository, mapRequest, COLUMNS };
