'use strict';
const defaultRepo = require('./hrEmployeesRepository');
const { normalizePhone } = require('../auth/localUserStore');

function key(value) {
  return String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').toUpperCase();
}

async function importRows(rows, options = {}) {
  const repo = options.repo || defaultRepo;
  const existing = await repo.selectAllActive();
  const result = { total: rows.length, updated: 0, unmatched: [], ambiguous: [] };
  for (const row of rows) {
    let matches = existing.filter(e => e.branch === row.branch && normalizePhone(row.soDienThoai) && normalizePhone(e.soDienThoai) === normalizePhone(row.soDienThoai));
    if (!matches.length) matches = existing.filter(e => e.branch === row.branch && key(e.hoTen) === key(row.hoTen));
    if (matches.length === 1) {
      await repo.updateExtendedById(matches[0].id, row);
      result.updated += 1;
    } else {
      const item = { branch: row.branch, hoTen: row.hoTen, soDienThoai: row.soDienThoai };
      (matches.length ? result.ambiguous : result.unmatched).push(item);
    }
  }
  return result;
}

module.exports = { importRows };
