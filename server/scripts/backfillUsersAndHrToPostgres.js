// ==========================================
// BACKFILL USERS + HR EMPLOYEES -> POSTGRES — script CHAY MOT LAN, di kem
// migration 0009_app_users_hr_employees.sql. Doc noi dung HIEN TAI cua:
//   - tab "Users" (Google Sheets, tai khoan dang nhap) + server/data/users.json
//     (cache dia — nguon DUY NHAT cho cac field runtime-only khong nam tren
//     Sheet: hrManaged, hrRowIndex, verifiedEmail...)
//   - tab "Danh sách nhân sự" o ca 2 spreadsheet HR (Ha Noi + Sai Gon, neu co)
// roi ghi vao Postgres (app_users, hr_employees).
//
// Mac dinh CHAY DRY-RUN (khong ghi gi) — them --execute de ghi thuc su. Toan
// bo buoc ghi nam trong 1 transaction (BEGIN/COMMIT/ROLLBACK).
//
//   node scripts/backfillUsersAndHrToPostgres.js            # dry-run
//   node scripts/backfillUsersAndHrToPostgres.js --execute  # ghi thuc su
//
// Sau khi chay --execute thanh cong 1 lan, KHONG chay lai tren cung 1 CSDL —
// script khong idempotent (se insert trung id/username/email/dong nhan su).
// ==========================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const usersSheetsClient = require('../sheets/usersSheetsClient');
const hrSheetsClient = require('../sheets/hrSheetsClient');
const { buildColumnIndex, rowToUser } = require('../auth/userSheetColumns');
const { parseEmployeeRows } = require('../hr/employeeDirectory');
const { BRANCHES, branchLabelToCode } = require('../branch/branches');
const { coSoToDb } = require('../auth/appUsersRepository');

const USERS_JSON_PATH = path.join(__dirname, '..', 'data', 'users.json');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  return { execute: argv.includes('--execute') };
}

async function readUsersFromSheetAndDisk() {
  const rawRows = await usersSheetsClient.usersGetValues(CONFIG.SHEET_USERS);
  if (!rawRows || !rawRows.length) return [];
  const [headers, ...rows] = rawRows;
  const colIndex = buildColumnIndex(headers);
  const sheetUsers = rows
    .filter(row => row.some(cell => cell !== '' && cell !== undefined))
    .map(row => rowToUser(row, colIndex))
    .filter(u => u.username);

  let diskUsers = [];
  if (fs.existsSync(USERS_JSON_PATH)) {
    try {
      diskUsers = JSON.parse(fs.readFileSync(USERS_JSON_PATH, 'utf8'));
      if (!Array.isArray(diskUsers)) diskUsers = [];
    } catch (err) {
      console.warn(`[backfill] Không đọc được ${USERS_JSON_PATH}: ${err.message}`);
    }
  }
  const diskById = new Map(diskUsers.map(u => [String(u.id), u]));

  // Sheet la nguon dung cho cac cot co tren Sheet; users.json bo sung field
  // runtime-only (hrManaged, hrRowIndex, verifiedEmail...) khong ton tai tren
  // Sheet. Uu tien theo id, fallback theo username neu id lech (hiem).
  return sheetUsers.map(sheetUser => {
    const diskMatch = diskById.get(String(sheetUser.id)) ||
      diskUsers.find(u => String(u.username || '').trim().toLowerCase() === sheetUser.username.trim().toLowerCase());
    return { ...(diskMatch || {}), ...sheetUser };
  });
}

function remapInvalidIds(users) {
  const remaps = [];
  const result = users.map(u => {
    if (UUID_RE.test(String(u.id || ''))) return u;
    const newId = crypto.randomUUID();
    remaps.push({ oldId: u.id, newId, username: u.username });
    return { ...u, id: newId };
  });
  return { users: result, remaps };
}

async function readHrEmployees() {
  const branches = [];
  if (CONFIG.HR_SPREADSHEET_ID) branches.push(BRANCHES.HANOI);
  if (CONFIG.HR_SPREADSHEET_ID_SG) branches.push(BRANCHES.SAIGON);
  if (!branches.length) {
    console.warn('[backfill] Chưa cấu hình HR_SPREADSHEET_ID/HR_SPREADSHEET_ID_SG — bỏ qua Danh sách nhân sự.');
    return [];
  }
  const sheetName = CONFIG.HR_SHEET_EMPLOYEES || 'Danh sách nhân sự';
  const groups = await Promise.all(branches.map(async branch => {
    const values = await hrSheetsClient.getHrClient(branch).hrGetValues(sheetName);
    return parseEmployeeRows(values, branch);
  }));
  return groups.flat();
}

function findConflicts(users) {
  const conflicts = [];
  const seen = { username: new Map(), email: new Map(), phone: new Map() };
  for (const u of users) {
    const username = String(u.username || '').trim().toLowerCase();
    if (username) {
      if (seen.username.has(username)) conflicts.push(`username trùng: "${username}" (${seen.username.get(username)} vs ${u.id})`);
      else seen.username.set(username, u.id);
    }
    const email = String(u.email || '').trim().toLowerCase();
    if (email) {
      if (seen.email.has(email)) conflicts.push(`email trùng: "${email}" (${seen.email.get(email)} vs ${u.id})`);
      else seen.email.set(email, u.id);
    }
  }
  return conflicts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.execute) {
    console.log('[backfill] DRY-RUN (mặc định) — không ghi Postgres. Thêm --execute để ghi thật.');
  }
  if (!CONFIG.SUPABASE_DB_URL && args.execute) {
    console.error('[backfill] SUPABASE_DB_URL chưa được cấu hình — không thể ghi.');
    process.exitCode = 1;
    return;
  }

  const mergedUsers = await readUsersFromSheetAndDisk();
  const { users, remaps } = remapInvalidIds(mergedUsers);
  const employees = await readHrEmployees();

  console.log(`[backfill] Đọc được ${users.length} tài khoản (tab "Users") và ${employees.length} nhân sự (Danh sách nhân sự).`);
  if (remaps.length) {
    console.log(`[backfill] ${remaps.length} tài khoản có id không phải UUID hợp lệ, sẽ được sinh lại:`);
    remaps.forEach(r => console.log(`  - ${r.username}: "${r.oldId}" -> "${r.newId}"`));
  }
  const conflicts = findConflicts(users);
  if (conflicts.length) {
    console.log(`[backfill] CẢNH BÁO — ${conflicts.length} xung đột unique phát hiện trước khi ghi:`);
    conflicts.forEach(c => console.log(`  - ${c}`));
  }

  if (!args.execute) {
    console.log('[backfill] Dry-run xong. Chạy lại với --execute để ghi vào Postgres.');
    return;
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) hr_employees — giu map (sourceBranch, rowIndex-cu-tren-sheet) -> id moi.
    const employeeIdMap = new Map(); // key: `${sourceBranch}#${rowIndex}` -> new bigint id
    for (const employee of employees) {
      const branchCode = branchLabelToCode(employee.sourceBranch);
      const { rows } = await client.query(
        `INSERT INTO hr_employees (branch, ho_ten, bo_phan, so_dien_thoai, email, telegram_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [branchCode, employee.hoTen, employee.boPhan, employee.soDienThoai, employee.email, employee.telegramId]
      );
      employeeIdMap.set(`${employee.sourceBranch}#${employee.rowIndex}`, rows[0].id);
    }

    // 2) app_users — map hrSourceBranch/hrRowIndex cu sang hr_employee_id moi.
    let unmatchedHrPointers = 0;
    for (const u of users) {
      let hrEmployeeId = null;
      if (u.hrManaged && u.hrSourceBranch && u.hrRowIndex) {
        const key = `${u.hrSourceBranch}#${u.hrRowIndex}`;
        if (employeeIdMap.has(key)) {
          hrEmployeeId = employeeIdMap.get(key);
        } else {
          unmatchedHrPointers += 1;
        }
      }
      await client.query(
        `INSERT INTO app_users (
           id, ho_ten, username, password_hash, vai_tro, co_so, trang_thai,
           ngay_tao, dang_nhap_gan_nhat, email, so_dien_thoai, email_khoi_phuc, sdt_khoi_phuc,
           is_deleted, lock_reason, hr_managed, hr_employee_id, hr_matched_at,
           sheet_vai_tro, sheet_co_so, vai_tro_override, co_so_override, role_source,
           legacy_override, verified_email, verified_phone, hr_verification_required
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27
         )`,
        [
          u.id, u.hoTen || '', u.username, u.passwordHash || '', u.vaiTro || 'Khách',
          coSoToDb(u.coSo), u.trangThai || 'Đang hoạt động', u.ngayTao || '', u.dangNhapGanNhat || '',
          u.email || '', u.soDienThoai || '', u.emailKhoiPhuc || '', u.sdtKhoiPhuc || '',
          !!u.isDeleted, u.lockReason || '', !!u.hrManaged, hrEmployeeId,
          u.hrMatchedAt || null, u.sheetVaiTro || '', u.sheetCoSo || '', u.vaiTroOverride || '',
          u.coSoOverride || '', u.roleSource || '', !!u.legacyOverride, !!u.verifiedEmail,
          !!u.verifiedPhone, !!u.hrVerificationRequired
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`[backfill] Đã ghi ${employees.length} dòng hr_employees và ${users.length} dòng app_users.`);
    if (unmatchedHrPointers) {
      console.log(`[backfill] ${unmatchedHrPointers} tài khoản hrManaged trỏ tới dòng nhân sự không còn tồn tại — sẽ tự khớp lại ở lần đăng nhập sau (effectiveUserResolver).`);
    }

    const { rows: countRows } = await pool.query(
      "SELECT (SELECT count(*) FROM app_users) AS users, (SELECT count(*) FROM hr_employees WHERE is_active) AS employees"
    );
    console.log(`[backfill] Đối chiếu Postgres: ${countRows[0].users} app_users, ${countRows[0].employees} hr_employees (active).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('[backfill] Thất bại:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { main, remapInvalidIds, findConflicts };
