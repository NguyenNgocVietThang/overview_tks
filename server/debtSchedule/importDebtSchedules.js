'use strict';

// Import lich TT lan dau tu file Excel mau KiotViet (sheet co cot "Mã khách hàng" + "Lịch TT").
//   node debtSchedule/importDebtSchedules.js --branch=saigon "MauFileKhachHang sg.xlsx"          (chay thu)
//   node debtSchedule/importDebtSchedules.js --branch=hanoi  "MauFileKhachHang hn.xlsx" --apply  (ghi DB)
// Gia tri trong / khong phai so 1..30 thi bo qua (khach giu mac dinh 1 ngay). Moi dong doi
// gia tri ghi 1 dong debt_payment_schedule_log (source = 'import').

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv tuy chon */ }
}

const ExcelJS = require('exceljs');
const { getPool } = require('../db/pool');
const { parseScheduleDays } = require('./debtScheduleRules');
const { createDebtScheduleRepository } = require('./debtScheduleRepository');

function cellText(value) {
  if (value && typeof value === 'object') {
    if (value.result !== undefined) return value.result;
    if (value.richText) return value.richText.map(part => part.text).join('');
    if (value.text !== undefined) return value.text;
  }
  return value;
}

async function readScheduleFile(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  for (const sheet of workbook.worksheets) {
    const headers = (sheet.getRow(1).values || []).map(value => String(cellText(value) ?? '').trim());
    const codeIndex = headers.indexOf('Mã khách hàng');
    const scheduleIndex = headers.indexOf('Lịch TT');
    if (codeIndex < 0 || scheduleIndex < 0) continue;
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const code = String(cellText(row.getCell(codeIndex).value) ?? '').trim();
      if (!code) return;
      const raw = String(cellText(row.getCell(scheduleIndex).value) ?? '').trim();
      rows.push({ rowNumber, code, raw, days: parseScheduleDays(raw) });
    });
    return { sheetName: sheet.name, rows };
  }
  throw new Error('Không tìm thấy sheet có cột "Mã khách hàng" và "Lịch TT".');
}

async function importDebtSchedules({ pool = getPool(), branch, filePath, apply = false, log = console.log }) {
  if (!['hanoi', 'saigon'].includes(branch)) throw new Error('--branch phải là hanoi hoặc saigon.');
  const { sheetName, rows } = await readScheduleFile(filePath);
  const valid = rows.filter(row => row.days);
  const skipped = rows.filter(row => !row.days);
  const { rows: customers } = await pool.query(
    `SELECT DISTINCT ON (btrim(code)) btrim(code) AS code, id::text AS id
     FROM customers WHERE branch = $1 AND btrim(code) = ANY($2::text[])
       AND COALESCE(raw->>'isActive', raw->>'IsActive', 'true') <> 'false'
     ORDER BY btrim(code), id DESC`,
    [branch, valid.map(row => row.code)]
  );
  const idByCode = new Map(customers.map(row => [row.code, row.id]));
  const missing = valid.filter(row => !idByCode.has(row.code));
  log(`[importDebtSchedules] ${branch} · sheet "${sheetName}": ${rows.length} dòng, ${valid.length} hợp lệ, `
    + `${skipped.length} bỏ qua (trống/không phải số), ${missing.length} không có mã trên KiotViet.`);
  if (skipped.length) log(`  Bỏ qua: ${skipped.map(row => `${row.code}="${row.raw}"`).join(', ')}`);
  if (missing.length) log(`  Không tìm thấy: ${missing.map(row => row.code).join(', ')}`);
  if (!apply) {
    log('  Chạy thử — chưa ghi gì. Thêm --apply để ghi.');
    return { applied: false, valid: valid.length, skipped: skipped.length, missing: missing.length, changed: 0 };
  }
  const repository = createDebtScheduleRepository({ pool });
  const user = { id: null, hoTen: 'Import lịch TT' };
  const changed = await repository.withTransaction(async client => {
    let count = 0;
    for (const row of valid) {
      const customerId = idByCode.get(row.code);
      if (!customerId) continue;
      const result = await repository.setScheduleWith(client, { branch, customerId, days: row.days, user, source: 'import' });
      if (result.changed) count += 1;
    }
    return count;
  });
  log(`  Đã ghi ${changed} lịch TT (dòng trùng giá trị cũ không ghi lại).`);
  return { applied: true, valid: valid.length, skipped: skipped.length, missing: missing.length, changed };
}

async function main() {
  const args = process.argv.slice(2);
  const branch = (args.find(arg => arg.startsWith('--branch=')) || '').slice('--branch='.length);
  const filePath = args.find(arg => !arg.startsWith('--'));
  if (!filePath) throw new Error('Thiếu đường dẫn file Excel.');
  await importDebtSchedules({ branch, filePath, apply: args.includes('--apply') });
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[importDebtSchedules] Thất bại: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => getPool().end && getPool().end());
}

module.exports = { importDebtSchedules, readScheduleFile };
