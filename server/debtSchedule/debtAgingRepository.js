'use strict';

// DOC bang ket qua "Tuoi no theo hoa don" (migration 0059) — da tinh san boi debtAgingRefresh.js
// sau moi luot dong bo KiotViet; o day khong tinh toan gi, chi SELECT.
//
// Cache: giu ket qua theo co so trong 60 giay; job tinh xong co thay doi thi xoa cache ngay
// (onDebtAgingChanged, cung 1 instance nhu toan codebase).

const { getPool } = require('../db/pool');
const { onDebtAgingChanged } = require('./debtAgingRefresh');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
const CACHE_TTL_MS = 60 * 1000;

const STATE_SQL = `SELECT as_of_day::text AS as_of_day, refreshed_at, customers_synced_at, version
  FROM debt_aging_state WHERE id = 1`;

// Thu tu mac dinh: co so, ten khach (sap lai theo tieng Viet o service).
const ROWS_SQL = `
  SELECT branch, customer_id::text AS customer_id, customer_code, customer_name, sale, schedule_days,
         has_stored_schedule, current_debt::text AS current_debt, overdue_debt::text AS overdue_debt,
         payoff_day::text AS payoff_day, beyond_history, equivalent_days, remaining_days
  FROM debt_aging_customers
  WHERE branch = ANY($1::text[])`;

function mapRow(row) {
  return {
    branchCode: row.branch,
    customerId: row.customer_id,
    customerCode: row.customer_code,
    customerName: row.customer_name || row.customer_code || `Khách #${row.customer_id}`,
    sale: row.sale,
    scheduleDays: Number(row.schedule_days),
    hasStoredSchedule: Boolean(row.has_stored_schedule),
    currentDebt: Number(row.current_debt) || 0,
    overdueDebt: Number(row.overdue_debt) || 0,
    payoffDay: row.payoff_day || null,
    beyondHistory: Boolean(row.beyond_history),
    equivalentDays: row.equivalent_days === null || row.equivalent_days === undefined ? null : Number(row.equivalent_days),
    remainingDays: row.remaining_days === null || row.remaining_days === undefined ? null : Number(row.remaining_days)
  };
}

function createDebtAgingRepository({ pool = getPool(), now = Date.now } = {}) {
  const cache = new Map(); // branchesKey -> { expiresAt, data }

  /** { state: { asOfDay, refreshedAt, customersSyncedAt } | null, rows: [...] } */
  async function readAging(branches) {
    const scope = (branches || []).filter(code => BRANCH_CODES.includes(code));
    const key = scope.slice().sort().join(',');
    const cached = cache.get(key);
    if (cached && now() < cached.expiresAt) return cached.data;
    const [state, rows] = await Promise.all([pool.query(STATE_SQL), pool.query(ROWS_SQL, [scope])]);
    const stateRow = state.rows[0];
    const data = {
      state: stateRow ? {
        asOfDay: stateRow.as_of_day,
        refreshedAt: stateRow.refreshed_at ? new Date(stateRow.refreshed_at).toISOString() : null,
        customersSyncedAt: stateRow.customers_synced_at ? new Date(stateRow.customers_synced_at).toISOString() : null
      } : null,
      rows: rows.rows.map(mapRow)
    };
    cache.set(key, { expiresAt: now() + CACHE_TTL_MS, data });
    return data;
  }

  return { readAging, clearCache: () => cache.clear() };
}

let defaultRepository = null;

function getDebtAgingRepository() {
  if (!defaultRepository) {
    defaultRepository = createDebtAgingRepository();
    onDebtAgingChanged(() => defaultRepository.clearCache());
  }
  return defaultRepository;
}

module.exports = { createDebtAgingRepository, getDebtAgingRepository };
