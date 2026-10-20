'use strict';

// Doc bang "Du kien hang ve" (migration 0075) cho /api/expected-arrivals. Chi SELECT bang tinh san;
// cache dong da map theo `version` cua product_container_expected_state (chi tang khi noi dung doi),
// moi request chi ton 1 truy van nho doc state. Chua migrate / chua co state => bang rong.

const { getPool } = require('../db/pool');

const STATE_SQL = 'SELECT version::text AS version, computed_at, row_count FROM product_container_expected_state WHERE id = 1';
const ROWS_SQL = `SELECT schedule_label, status_label, eta, container_name, product_code, product_name, color, sale_note,
    ordered_by, units_per_package, package_count, quantity, sheet_name, source_row
  FROM product_container_expected ORDER BY sheet_order, container_row, source_row`;

const num = value => (value == null ? null : Number(value));

function mapRow(row) {
  return {
    scheduleLabel: row.schedule_label || '',
    statusLabel: row.status_label || '',
    eta: row.eta || '',
    containerName: row.container_name || '',
    productCode: row.product_code || '',
    productName: row.product_name || '',
    color: row.color || '',
    saleNote: row.sale_note || '',
    orderedBy: row.ordered_by || '',
    unitsPerPackage: num(row.units_per_package),
    packageCount: num(row.package_count),
    quantity: num(row.quantity) || 0,
    sheetName: row.sheet_name,
    sourceRow: Number(row.source_row)
  };
}

// Danh sach loc: cont theo thu tu xuat hien; trang thai (cot B) distinct theo thu tu xuat hien.
function buildFilters(rows) {
  const containers = [];
  const statuses = [];
  const seenContainers = new Set();
  const seenStatuses = new Set();
  for (const row of rows) {
    if (row.containerName && !seenContainers.has(row.containerName)) { seenContainers.add(row.containerName); containers.push(row.containerName); }
    if (row.statusLabel && !seenStatuses.has(row.statusLabel)) { seenStatuses.add(row.statusLabel); statuses.push(row.statusLabel); }
  }
  return { containers, statuses };
}

function isMissingTable(error) {
  return error && error.code === '42P01';
}

/** Bo doc co cache rieng; moi lan truyen pool (test) la bo doc moi. */
function createExpectedRepository({ pool = getPool() } = {}) {
  let cache = null; // { version, rows, filters, computedAt }

  async function readState() {
    const { rows } = await pool.query(STATE_SQL);
    return rows[0] || null;
  }

  /** @returns {{ rows: object[], filters: {containers: string[], statuses: string[]}, meta: {computedAt, version, rowCount} }} */
  async function getExpected() {
    let state;
    try {
      state = await readState();
      if (!state) return empty();
      if (!cache || cache.version !== state.version) {
        const { rows } = await pool.query(ROWS_SQL);
        const mapped = rows.map(mapRow);
        cache = { version: state.version, rows: mapped, filters: buildFilters(mapped), computedAt: state.computed_at };
      }
    } catch (error) {
      if (isMissingTable(error)) return empty();
      throw error;
    }
    return {
      rows: cache.rows,
      filters: cache.filters,
      meta: { computedAt: cache.computedAt ? new Date(cache.computedAt).toISOString() : null, version: cache.version, rowCount: cache.rows.length }
    };
  }

  return { getExpected };
}

function empty() {
  return { rows: [], filters: { containers: [], statuses: [] }, meta: { computedAt: null, version: null, rowCount: 0 } };
}

let shared = null;
const getExpected = () => (shared || (shared = createExpectedRepository())).getExpected();

module.exports = { createExpectedRepository, getExpected, mapRow, buildFilters };
