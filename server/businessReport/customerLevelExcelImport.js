'use strict';

const { nameKey } = require('./businessMonths');

const LEVEL_MAP = { 'vừa': 'medium', 'mới': 'new', 'lớn': 'large', vip: 'vip' };
const LEVEL_LABELS = { medium: 'Vừa', new: 'Mới', large: 'Lớn', vip: 'VIP' };
const IMPORT_ACTOR = { id: 'import', name: 'Import DS khách' };

const text = v => {
  if (v == null) return '';
  if (typeof v === 'object') v = v.text != null ? v.text : v.result != null ? v.result : (v.richText ? v.richText.map(t => t.text).join('') : '');
  return String(v).trim();
};

function mapLevel(label) {
  return LEVEL_MAP[String(label == null ? '' : label).normalize('NFC').trim().toLowerCase()] || null;
}

// rows: [{name, levelLabel, newCustomer, phone, address, rowNumber}] -> {entries, invalid, duplicates}
// Trung ten (cung nameKey): dong cuoi thang; duplicates ghi lai dong bi bo va co khac gia tri hay khong.
function consolidate(rows) {
  const byKey = new Map(), invalid = [], duplicates = [], held = new Set();
  for (const r of rows) {
    const name = text(r.name), key = nameKey(name), level = mapLevel(text(r.levelLabel));
    if (!key || !level) { invalid.push({ row: r.rowNumber, name, level: text(r.levelLabel) }); continue; }
    const entry = { key, name, level, newCustomer: text(r.newCustomer), phone: text(r.phone), address: text(r.address), row: r.rowNumber };
    const prev = byKey.get(key);
    if (prev) {
      const conflict = prev.level !== entry.level || prev.newCustomer !== entry.newCustomer;
      if (conflict) held.add(key);
      duplicates.push({ name, keptRow: entry.row, droppedRow: prev.row, conflict, kept: entry.level, dropped: prev.level });
    }
    byKey.set(key, entry);
  }
  // Ten trung ma level/nhan khac nhau => khong tu quyet: giu lai (khong ghi), liet ke de nguoi dung chot.
  const heldBack = [...held].map(k => byKey.get(k).name);
  return { entries: [...byKey.values()].filter(e => !held.has(e.key)), invalid, duplicates, heldBack };
}

// existing: Map key -> {level, version, newCustomer} chi cho khach da co dong trong customer_price_levels.
function plan(entries, existing) {
  const matched = [], unmatched = [], changes = [];
  for (const e of entries) {
    const cur = existing.get(e.key);
    if (!cur) { unmatched.push(e.name); continue; }
    matched.push(e);
    if (cur.level !== e.level || (cur.newCustomer || '') !== e.newCustomer) changes.push({ ...e, version: cur.version });
  }
  return { matched, unmatched, changes };
}

function levelCounts(rows) {
  const out = {};
  for (const r of rows) { const l = mapLevel(text(r.levelLabel)); const k = l ? LEVEL_LABELS[l] : 'khác'; out[k] = (out[k] || 0) + 1; }
  return out;
}

async function readExcelRows(file) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    rows.push({ rowNumber: n, name: row.getCell(1).value, levelLabel: row.getCell(2).value, newCustomer: row.getCell(3).value, phone: row.getCell(4).value, address: row.getCell(5).value });
  });
  return rows.filter(r => text(r.name) || text(r.levelLabel));
}

const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

async function loadExisting(pool, keys) {
  const map = new Map();
  for (const part of chunks(keys, 2000)) {
    const { rows } = await pool.query('SELECT customer_key, level, version, new_customer FROM customer_price_levels WHERE customer_key = ANY($1::text[])', [part]);
    for (const r of rows) map.set(r.customer_key, { level: r.level, version: Number(r.version), newCustomer: r.new_customer || '' });
  }
  return map;
}

// Chi dien phone/address khi gia tri hien co dang rong; khong bao gio ghi de gia tri nhap tay.
async function upsertProfiles(pool, entries, actorName, size = 500) {
  let touched = 0;
  for (const part of chunks(entries.filter(e => e.phone || e.address), size)) {
    const r = await pool.query(`INSERT INTO customer_profiles(customer_key, customer_name, phone, address, updated_by_name)
      SELECT k, n, p, a, $5::text FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(k, n, p, a)
      ON CONFLICT (customer_key) DO UPDATE SET
        phone = CASE WHEN customer_profiles.phone = '' THEN EXCLUDED.phone ELSE customer_profiles.phone END,
        address = CASE WHEN customer_profiles.address = '' THEN EXCLUDED.address ELSE customer_profiles.address END,
        customer_name = CASE WHEN customer_profiles.customer_name = '' THEN EXCLUDED.customer_name ELSE customer_profiles.customer_name END,
        updated_by_name = $5::text, updated_at = now()
      WHERE (customer_profiles.phone = '' AND EXCLUDED.phone <> '') OR (customer_profiles.address = '' AND EXCLUDED.address <> '')`,
    [part.map(e => e.key), part.map(e => e.name), part.map(e => e.phone), part.map(e => e.address), actorName]);
    touched += r.rowCount || 0;
  }
  return touched;
}

async function runImport({ rows, pool, repo, apply }) {
  const { entries, invalid, duplicates, heldBack } = consolidate(rows);
  const initialized = (await pool.query('SELECT initialized_at FROM customer_price_level_state WHERE id')).rows[0]?.initialized_at;
  if (apply && !initialized) throw new Error('customer_price_level_state.initialized_at rỗng: chạy initialize-customer-price-levels.js --apply trước.');
  const existing = await loadExisting(pool, entries.map(e => e.key));
  const p = plan(entries, existing);
  const summary = {
    mode: apply ? 'applied' : 'preview', rows: rows.length, levelCounts: levelCounts(rows), uniqueCustomers: entries.length,
    invalidRows: invalid.length, invalidSample: invalid.slice(0, 20), duplicates: duplicates.length, duplicateConflicts: duplicates.filter(d => d.conflict), heldBack,
    matched: p.matched.length, unmatched: p.unmatched.length, unmatchedSample: p.unmatched.slice(0, 50), wouldChange: p.changes.length,
  };
  if (!apply) return summary;
  let changed = 0, conflicts = 0;
  for (const c of p.changes) {
    try { await repo.saveLevel(c.key, c.level, c.version, IMPORT_ACTOR, c.newCustomer); changed++; }
    catch (err) { if (err.statusCode === 409) conflicts++; else throw err; }
  }
  summary.changed = changed; summary.versionConflicts = conflicts;
  summary.profilesFilled = await upsertProfiles(pool, p.matched, IMPORT_ACTOR.name);
  return summary;
}

module.exports = { mapLevel, consolidate, plan, levelCounts, readExcelRows, runImport, upsertProfiles, IMPORT_ACTOR };
