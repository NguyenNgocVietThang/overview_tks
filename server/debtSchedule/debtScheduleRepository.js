'use strict';

// Doc / ghi cong no theo lich TT (migration 0047). Ban chot moi nhat (debt_cycle_runs) la
// "chu ky hien tai": phan hoi, trang thai va lich su sua phan hoi chi ghi vao chu ky nay,
// nen ban chot 15:00 hom sau tu dong cho bang trong.
//
// Ten / ma / nhom khach (Sale) va lich TT doc TRUC TIEP tu customers +
// debt_payment_schedules moi lan xem — khong chot cung, luon khop KiotViet/ban sua moi.
//
// Cache: ket qua doc giu trong bo nho theo `version`; moi lan ghi (phan hoi, trang thai,
// lich TT) hoac co ban chot moi thi tang version -> lan doc sau doc lai DB. Gia dinh 1
// instance (nhu toan codebase).

const { getPool } = require('../db/pool');
const { parseScheduleDays, WORKFLOW_STATUSES } = require('./debtScheduleRules');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
const FEEDBACK_MAX_LENGTH = 1000;
const FEEDBACK_FIELDS = Object.freeze({
  sale: { column: 'sale_feedback', by: 'sale_feedback_by', at: 'sale_feedback_at' },
  manager: { column: 'manager_feedback', by: 'manager_feedback_by', at: 'manager_feedback_at' }
});

const LATEST_RUN_SQL = `SELECT cycle_date::text AS cycle_date, taken_at, customer_count, refreshed_at, refreshed_by_name
  FROM debt_cycle_runs ORDER BY cycle_date DESC LIMIT 1`;

// Ban chot cu duoc giu 7 ngay (RETENTION_DAYS o debtCycleSnapshot.js); chi cho xuat nhung ban con trong khoang nay.
const CYCLE_HISTORY_DAYS = 7;
const CYCLE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CYCLE_LIST_SQL = `SELECT cycle_date::text AS cycle_date, taken_at
  FROM debt_cycle_runs ORDER BY cycle_date DESC LIMIT $1`;
const CYCLE_BY_DATE_SQL = `SELECT cycle_date::text AS cycle_date, taken_at, customer_count, refreshed_at, refreshed_by_name
  FROM (SELECT * FROM debt_cycle_runs ORDER BY cycle_date DESC LIMIT $2) recent
  WHERE cycle_date = $1::date`;

const CUSTOMERS_SQL = `
  SELECT dc.branch, dc.customer_id::text AS customer_id, dc.current_debt, dc.opening_debt, dc.avg_revenue_4m,
         btrim(COALESCE(c.code, '')) AS customer_code,
         COALESCE(NULLIF(btrim(c.name), ''), '') AS customer_name,
         NULLIF(btrim(c.raw->>'groups'), '') AS sale,
         s.schedule_days, dc.overdue_streak,
         f.sale_feedback, f.sale_feedback_by, f.manager_feedback, f.manager_feedback_by,
         f.status, f.status_by, f.status_at,
         pen.amount AS penalty_amount, pen.updated_by_name AS penalty_by,
         pdc.customer_id IS NOT NULL AS has_prev, pdc.overdue_debt AS prev_overdue, pdc.overdue_streak AS prev_streak,
         pf.status AS prev_status, ppen.amount AS prev_penalty_amount
  FROM debt_cycle_customers dc
  LEFT JOIN customers c ON c.branch = dc.branch AND c.id = dc.customer_id
  LEFT JOIN debt_payment_schedules s ON s.branch = dc.branch AND s.customer_id = dc.customer_id
  LEFT JOIN debt_cycle_feedback f
    ON f.cycle_date = dc.cycle_date AND f.branch = dc.branch AND f.customer_id = dc.customer_id
  LEFT JOIN debt_cycle_penalties pen
    ON pen.cycle_date = dc.cycle_date AND pen.branch = dc.branch AND pen.customer_id = dc.customer_id
  LEFT JOIN debt_cycle_customers pdc
    ON pdc.cycle_date = (SELECT MAX(cycle_date) FROM debt_cycle_runs WHERE cycle_date < dc.cycle_date)
   AND pdc.branch = dc.branch AND pdc.customer_id = dc.customer_id
  LEFT JOIN debt_cycle_feedback pf
    ON pf.cycle_date = pdc.cycle_date AND pf.branch = pdc.branch AND pf.customer_id = pdc.customer_id
  LEFT JOIN debt_cycle_penalties ppen
    ON ppen.cycle_date = pdc.cycle_date AND ppen.branch = pdc.branch AND ppen.customer_id = pdc.customer_id
  WHERE dc.cycle_date = $1::date AND dc.branch = ANY($2::text[])`;

const AMOUNTS_SQL = `SELECT branch, customer_id::text AS customer_id, day::text AS day, invoice_amount, return_amount
  FROM debt_cycle_amounts WHERE cycle_date = $1::date AND branch = ANY($2::text[])`;

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const PENALTY_DAYS_SQL = `SELECT cycle_date::text AS cycle_date, sale, COUNT(*)::int AS penalized_customers, SUM(amount) AS amount
  FROM debt_penalty_daily
  WHERE cycle_date >= $1::date AND cycle_date < ($1::date + interval '1 month') AND branch = ANY($2::text[])
  GROUP BY cycle_date, sale ORDER BY cycle_date, sale`;

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function assertBranch(branch) {
  if (!BRANCH_CODES.includes(branch)) throw httpError(400, 'Cơ sở không hợp lệ.', 'INVALID_BRANCH');
  return branch;
}

function assertCustomerId(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,19}$/.test(text)) throw httpError(400, 'Mã khách hàng không hợp lệ.', 'INVALID_CUSTOMER');
  return text;
}

function normalizeFeedback(value) {
  const text = String(value ?? '').normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (text.length > FEEDBACK_MAX_LENGTH) {
    throw httpError(400, `Phản hồi tối đa ${FEEDBACK_MAX_LENGTH} ký tự.`, 'FEEDBACK_TOO_LONG');
  }
  return text;
}

function actorOf(user) {
  return {
    id: user && user.id ? String(user.id) : null,
    name: (user && (user.hoTen || user.username)) || ''
  };
}

function mapCustomerRow(row) {
  return {
    branch: row.branch,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name,
    sale: row.sale,
    scheduleDays: row.schedule_days,
    overdueStreak: Number(row.overdue_streak) || 0,
    penaltyOverride: row.penalty_amount === null || row.penalty_amount === undefined ? null : Number(row.penalty_amount),
    penaltyBy: row.penalty_by || '',
    previousCycle: row.has_prev ? {
      overdueDebt: Number(row.prev_overdue) || 0,
      overdueStreak: Number(row.prev_streak) || 0,
      status: row.prev_status || 'Chưa xử lý',
      penaltyOverride: row.prev_penalty_amount === null || row.prev_penalty_amount === undefined ? null : Number(row.prev_penalty_amount)
    } : null,
    currentDebt: Number(row.current_debt) || 0,
    openingDebt: row.opening_debt === null || row.opening_debt === undefined ? null : Number(row.opening_debt),
    avgRevenue4m: row.avg_revenue_4m === null || row.avg_revenue_4m === undefined ? null : Number(row.avg_revenue_4m),
    feedback: {
      saleFeedback: row.sale_feedback || '',
      saleFeedbackBy: row.sale_feedback_by || '',
      managerFeedback: row.manager_feedback || '',
      managerFeedbackBy: row.manager_feedback_by || '',
      status: row.status || 'Chưa xử lý',
      statusBy: row.status_by || '',
      statusAt: row.status_at || null
    }
  };
}

function createDebtScheduleRepository({ pool = getPool() } = {}) {
  let version = 0;
  let cache = null; // { version, branchesKey, data }

  function bumpVersion() {
    version += 1;
    cache = null;
    return version;
  }

  async function readCurrentCycle(db = pool) {
    const { rows } = await db.query(LATEST_RUN_SQL);
    if (!rows.length) return null;
    return { cycleDate: rows[0].cycle_date, takenAt: rows[0].taken_at, customerCount: Number(rows[0].customer_count) || 0,
      refreshedAt: rows[0].refreshed_at || null, refreshedBy: rows[0].refreshed_by_name || '' };
  }

  /** Cac ban chot con luu (toi da CYCLE_HISTORY_DAYS ngay), moi nhat truoc: [{ cycleDate, takenAt }]. */
  async function listCycles() {
    const { rows } = await pool.query(CYCLE_LIST_SQL, [CYCLE_HISTORY_DAYS]);
    return rows.map(row => ({ cycleDate: row.cycle_date, takenAt: row.taken_at }));
  }

  async function readCycleByDate(cycleDate) {
    const text = String(cycleDate || '').trim();
    if (!CYCLE_DATE_PATTERN.test(text)) throw httpError(400, 'Ngày chu kỳ công nợ không hợp lệ.', 'INVALID_CYCLE_DATE');
    const { rows } = await pool.query(CYCLE_BY_DATE_SQL, [text, CYCLE_HISTORY_DAYS]);
    if (!rows.length) throw httpError(404, 'Không có bản chốt công nợ của ngày này (chỉ lưu 7 ngày gần nhất).', 'DEBT_CYCLE_NOT_FOUND');
    return { cycleDate: rows[0].cycle_date, takenAt: rows[0].taken_at, customerCount: Number(rows[0].customer_count) || 0,
      refreshedAt: rows[0].refreshed_at || null, refreshedBy: rows[0].refreshed_by_name || '' };
  }

  /**
   * Du lieu tho cua mot chu ky cho cac co so: { cycle, rows, amountsByCustomer }.
   * Bo trong cycleDate = chu ky moi nhat (co cache); cycle = null khi chua co ban chot nao.
   * Co cycleDate = ban chot cu (toi da 7 ngay) — chi dung de xuat file nen khong cache.
   */
  async function readReport(branches, cycleDate) {
    const scope = (branches || []).map(assertBranch);
    const historical = Boolean(cycleDate);
    const branchesKey = scope.slice().sort().join(',');
    if (!historical && cache && cache.version === version && cache.branchesKey === branchesKey) return cache.data;
    const startedVersion = version;
    const cycle = historical ? await readCycleByDate(cycleDate) : await readCurrentCycle();
    let data = { cycle: null, rows: [], amountsByCustomer: new Map() };
    if (cycle) {
      const [customers, amounts] = await Promise.all([
        pool.query(CUSTOMERS_SQL, [cycle.cycleDate, scope]),
        pool.query(AMOUNTS_SQL, [cycle.cycleDate, scope])
      ]);
      const amountsByCustomer = new Map();
      for (const row of amounts.rows) {
        const key = `${row.branch}:${row.customer_id}`;
        if (!amountsByCustomer.has(key)) amountsByCustomer.set(key, []);
        amountsByCustomer.get(key).push({
          day: row.day, invoiceAmount: Number(row.invoice_amount) || 0, returnAmount: Number(row.return_amount) || 0
        });
      }
      data = { cycle, rows: customers.rows.map(mapCustomerRow), amountsByCustomer };
    }
    // Co ghi trong luc dang doc -> khong cache ban co the da cu.
    if (!historical && startedVersion === version) cache = { version, branchesKey, data };
    return data;
  }

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockCurrentCycleCustomer(client, branch, customerId, expectedCycleDate) {
    const { rows } = await client.query(
      `SELECT r.cycle_date::text AS cycle_date
       FROM debt_cycle_runs r
       WHERE r.cycle_date = (SELECT MAX(cycle_date) FROM debt_cycle_runs)
       FOR SHARE`
    );
    const cycleDate = rows[0] && rows[0].cycle_date;
    if (!cycleDate) throw httpError(409, 'Chưa có bản chốt công nợ.', 'DEBT_CYCLE_MISSING');
    if (expectedCycleDate && expectedCycleDate !== cycleDate) {
      throw httpError(409, 'Bảng công nợ đã sang chu kỳ mới (chốt 15:00). Vui lòng tải lại trang.', 'DEBT_CYCLE_CHANGED');
    }
    const finalized=await client.query('SELECT 1 FROM debt_penalty_cycles WHERE cycle_date=$1::date',[cycleDate]);
    if(finalized.rows.length) throw httpError(409,'Chu kỳ đã chốt phạt lúc 14:59. Vui lòng chờ bản chốt 15:00.','DEBT_CYCLE_FINALIZED');
    const exists = await client.query(
      'SELECT 1 FROM debt_cycle_customers WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint',
      [cycleDate, branch, customerId]
    );
    if (!exists.rowCount) throw httpError(404, 'Không tìm thấy khách này trong bản chốt công nợ.', 'DEBT_CUSTOMER_NOT_FOUND');
    await client.query(
      `INSERT INTO debt_cycle_feedback (cycle_date, branch, customer_id) VALUES ($1::date, $2, $3::bigint)
       ON CONFLICT (cycle_date, branch, customer_id) DO NOTHING`,
      [cycleDate, branch, customerId]
    );
    const locked = await client.query(
      `SELECT * FROM debt_cycle_feedback WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint FOR UPDATE`,
      [cycleDate, branch, customerId]
    );
    return { cycleDate, current: locked.rows[0] };
  }

  // Lich su moi thay doi tren giao dien cua chu ky (sale | manager | status | schedule).
  async function insertHistory(client, { cycleDate, branch, customerId, field, oldValue, newValue, actor }) {
    await client.query(
      `INSERT INTO debt_feedback_history (cycle_date, branch, customer_id, field, old_value, new_value, actor_user_id, actor_name)
       VALUES ($1::date, $2, $3::bigint, $4, $5, $6, $7, $8)`,
      [cycleDate, branch, customerId, field, oldValue == null ? '' : String(oldValue), newValue == null ? '' : String(newValue), actor.id, actor.name]
    );
  }

  /** Ghi Sale phan hoi / QL phan hoi + 1 dong lich su (neu noi dung doi), cung transaction. */
  async function saveFeedback({ field, branch, customerId, cycleDate, value, user }) {
    const spec = FEEDBACK_FIELDS[field];
    if (!spec) throw httpError(400, 'Loại phản hồi không hợp lệ.', 'INVALID_FEEDBACK_FIELD');
    const code = assertBranch(branch);
    const id = assertCustomerId(customerId);
    const text = normalizeFeedback(value);
    const actor = actorOf(user);
    const result = await withTransaction(async client => {
      const { cycleDate: current, current: row } = await lockCurrentCycleCustomer(client, code, id, cycleDate);
      const oldValue = row[spec.column] || '';
      if (oldValue === text) return { cycleDate: current, value: text, by: row[spec.by] || '', changed: false };
      await client.query(
        `UPDATE debt_cycle_feedback SET ${spec.column} = $4, ${spec.by} = $5, ${spec.at} = now()
         WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint`,
        [current, code, id, text, actor.name]
      );
      await insertHistory(client, { cycleDate: current, branch: code, customerId: id, field, oldValue, newValue: text, actor });
      return { cycleDate: current, value: text, by: actor.name, changed: true };
    });
    if (result.changed) bumpVersion();
    return result;
  }

  async function saveStatus({ branch, customerId, cycleDate, status, user }) {
    if (!WORKFLOW_STATUSES.includes(status)) throw httpError(400, 'Trạng thái xử lý không hợp lệ.', 'INVALID_DEBT_STATUS');
    const code = assertBranch(branch);
    const id = assertCustomerId(customerId);
    const actor = actorOf(user);
    const result = await withTransaction(async client => {
      const { cycleDate: current, current: row } = await lockCurrentCycleCustomer(client, code, id, cycleDate);
      if ((row.status || 'Chưa xử lý') !== status) {
        await insertHistory(client, { cycleDate: current, branch: code, customerId: id, field: 'status', oldValue: row.status || 'Chưa xử lý', newValue: status, actor });
      }
      const { rows } = await client.query(
        `UPDATE debt_cycle_feedback SET status = $4, status_by = $5, status_at = now()
         WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint
         RETURNING status, status_by, status_at`,
        [current, code, id, status, actor.name]
      );
      return { cycleDate: current, status: rows[0].status, updatedBy: rows[0].status_by, updatedAt: rows[0].status_at };
    });
    bumpVersion();
    return result;
  }

  /**
   * Tien phat phien nay do Quan ly dien (ghi de muc goi y). amount rong/null = xoa, ve lai muc
   * goi y. Chi ghi cho chu ky hien tai; ghi 1 dong lich su (field 'penalty') neu gia tri doi.
   */
  async function savePenalty({ branch, customerId, cycleDate, amount, user }) {
    const code = assertBranch(branch);
    const id = assertCustomerId(customerId);
    const clearing = amount === null || amount === undefined || String(amount).trim() === '';
    let value = null;
    if (!clearing) {
      const text = String(amount).trim();
      if (!/^\d{1,12}$/.test(text)) throw httpError(400, 'Tiền phạt phải là số nguyên không âm (VNĐ).', 'INVALID_PENALTY');
      value = Number(text);
    }
    const actor = actorOf(user);
    const result = await withTransaction(async client => {
      const { cycleDate: current } = await lockCurrentCycleCustomer(client, code, id, cycleDate);
      const previous = await client.query(
        'SELECT amount FROM debt_cycle_penalties WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint FOR UPDATE',
        [current, code, id]
      );
      const oldValue = previous.rowCount ? Number(previous.rows[0].amount) : null;
      if (oldValue === value) return { cycleDate: current, amount: value, by: actor.name, changed: false };
      if (value === null) {
        await client.query(
          'DELETE FROM debt_cycle_penalties WHERE cycle_date = $1::date AND branch = $2 AND customer_id = $3::bigint',
          [current, code, id]
        );
      } else {
        await client.query(
          `INSERT INTO debt_cycle_penalties (cycle_date, branch, customer_id, amount, updated_by_user_id, updated_by_name, updated_at)
           VALUES ($1::date, $2, $3::bigint, $4, $5, $6, now())
           ON CONFLICT (cycle_date, branch, customer_id) DO UPDATE SET
             amount = EXCLUDED.amount, updated_by_user_id = EXCLUDED.updated_by_user_id,
             updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
          [current, code, id, value, actor.id, actor.name]
        );
      }
      await insertHistory(client, {
        cycleDate: current, branch: code, customerId: id, field: 'penalty', oldValue, newValue: value, actor
      });
      return { cycleDate: current, amount: value, by: actor.name, changed: true };
    });
    if (result.changed) bumpVersion();
    return result;
  }

  async function listFeedbackHistory({ branches, cycleDate } = {}) {
    const scope = (branches || BRANCH_CODES).map(assertBranch);
    const cycle = cycleDate ? { cycleDate } : await readCurrentCycle();
    if (!cycle) return { cycleDate: null, entries: [] };
    const { rows } = await pool.query(
      `SELECT h.id::text AS id, h.created_at, h.branch, h.customer_id::text AS customer_id, h.field,
              h.old_value, h.new_value, h.actor_name,
              btrim(COALESCE(c.code, '')) AS customer_code, COALESCE(c.name, '') AS customer_name
       FROM debt_feedback_history h
       LEFT JOIN customers c ON c.branch = h.branch AND c.id = h.customer_id
       WHERE h.cycle_date = $1::date AND h.branch = ANY($2::text[])
       ORDER BY h.created_at DESC, h.id DESC
       LIMIT 1000`,
      [cycle.cycleDate, scope]
    );
    return {
      cycleDate: cycle.cycleDate,
      entries: rows.map(row => ({
        id: row.id, createdAt: row.created_at, branch: row.branch, customerId: row.customer_id,
        customerCode: row.customer_code, customerName: row.customer_name, field: row.field,
        oldValue: row.old_value, newValue: row.new_value, actorName: row.actor_name
      }))
    };
  }

  /**
   * Tien phat DA CHOT SO (debt_penalty_daily) cua thang `month` ('YYYY-MM') theo ngay + sale, cac co so trong
   * `branches`: [{ cycleDate, sale, penalizedCustomers, amount }]. Chu ky dang mo chua chot so nen khong co o day.
   */
  async function listPenaltyDays({ month, branches } = {}) {
    const text = String(month || '').trim();
    if (!MONTH_PATTERN.test(text)) throw httpError(400, 'Tháng không hợp lệ.', 'INVALID_MONTH');
    const scope = (branches || BRANCH_CODES).map(assertBranch);
    const { rows } = await pool.query(PENALTY_DAYS_SQL, [`${text}-01`, scope]);
    return rows.map(row => ({
      cycleDate: row.cycle_date, sale: row.sale, penalizedCustomers: Number(row.penalized_customers) || 0, amount: Number(row.amount) || 0
    }));
  }

  /**
   * Dat lich TT cho 1 khach (sua tren web hoac import). Ghi log neu gia tri doi.
   * `client` cho phep import nhieu dong trong 1 transaction.
   */
  async function setScheduleWith(client, { branch, customerId, days, user, source }) {
    const code = assertBranch(branch);
    const id = assertCustomerId(customerId);
    const scheduleDays = parseScheduleDays(days);
    if (!scheduleDays) throw httpError(400, 'Lịch TT phải là số ngày từ 1 đến 90.', 'INVALID_SCHEDULE');
    const actor = actorOf(user);
    const customer = await client.query(
      'SELECT btrim(COALESCE(code, \'\')) AS code, COALESCE(name, \'\') AS name FROM customers WHERE branch = $1 AND id = $2::bigint',
      [code, id]
    );
    if (!customer.rowCount) throw httpError(404, 'Không tìm thấy khách hàng trên KiotViet.', 'CUSTOMER_NOT_FOUND');
    const previous = await client.query(
      'SELECT schedule_days FROM debt_payment_schedules WHERE branch = $1 AND customer_id = $2::bigint FOR UPDATE',
      [code, id]
    );
    const oldDays = previous.rowCount ? previous.rows[0].schedule_days : null;
    if (oldDays === scheduleDays) return { branch: code, customerId: id, scheduleDays, changed: false };
    await client.query(
      `INSERT INTO debt_payment_schedules (branch, customer_id, schedule_days, updated_by_user_id, updated_by_name, updated_at)
       VALUES ($1, $2::bigint, $3, $4, $5, now())
       ON CONFLICT (branch, customer_id) DO UPDATE SET
         schedule_days = EXCLUDED.schedule_days, updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_by_name = EXCLUDED.updated_by_name, updated_at = now()`,
      [code, id, scheduleDays, actor.id, actor.name]
    );
    await client.query(
      `INSERT INTO debt_payment_schedule_log
         (branch, customer_id, customer_code, customer_name, old_days, new_days, source, actor_user_id, actor_name)
       VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9)`,
      [code, id, customer.rows[0].code, customer.rows[0].name, oldDays, scheduleDays, source, actor.id, actor.name]
    );
    return { branch: code, customerId: id, scheduleDays, oldDays, changed: true };
  }

  async function setSchedule(payload) {
    const result = await withTransaction(async client => {
      const changed = await setScheduleWith(client, { ...payload, source: 'web' });
      // Sua tren giao dien: ghi them vao lich su chinh sua cua chu ky hien tai (neu da co ban chot).
      const cycle = changed.changed ? await readCurrentCycle(client) : null;
      if (cycle) {
        await insertHistory(client, {
          cycleDate: cycle.cycleDate, branch: changed.branch, customerId: changed.customerId, field: 'schedule',
          oldValue: changed.oldDays == null ? '' : changed.oldDays, newValue: changed.scheduleDays, actor: actorOf(payload.user)
        });
      }
      return changed;
    });
    if (result.changed) bumpVersion();
    return result;
  }

  async function listScheduleLog({ branch, customerId } = {}) {
    const params = [];
    let where = '';
    if (branch && customerId) {
      params.push(assertBranch(branch), assertCustomerId(customerId));
      where = 'WHERE branch = $1 AND customer_id = $2::bigint';
    }
    const { rows } = await pool.query(
      `SELECT id::text AS id, created_at, branch, customer_id::text AS customer_id, customer_code, customer_name,
              old_days, new_days, source, actor_name
       FROM debt_payment_schedule_log ${where}
       ORDER BY created_at DESC, id DESC LIMIT 500`,
      params
    );
    return rows.map(row => ({
      id: row.id, createdAt: row.created_at, branch: row.branch, customerId: row.customer_id,
      customerCode: row.customer_code, customerName: row.customer_name,
      oldDays: row.old_days, newDays: row.new_days, source: row.source, actorName: row.actor_name
    }));
  }

  return {
    readReport,
    readCurrentCycle,
    listCycles,
    saveFeedback,
    saveStatus,
    savePenalty,
    listFeedbackHistory,
    listPenaltyDays,
    setSchedule,
    setScheduleWith,
    listScheduleLog,
    withTransaction,
    bumpVersion,
    getVersion: () => version
  };
}

let defaultRepository = null;
function getDebtScheduleRepository() {
  if (!defaultRepository) defaultRepository = createDebtScheduleRepository();
  return defaultRepository;
}

module.exports = {
  BRANCH_CODES,
  FEEDBACK_MAX_LENGTH,
  createDebtScheduleRepository,
  getDebtScheduleRepository,
  __test__: { normalizeFeedback, mapCustomerRow }
};
