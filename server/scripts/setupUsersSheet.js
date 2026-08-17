// ==========================================
// SETUP TAB "Users" — cong cu CLI chay TAY (khong phai runtime web) de:
//   --init                          : tao tab "Users" (kem header) neu chua co
//   --list                          : liet ke user hien co (KHONG in mat khau)
//   --add --username=... --password=... --hoTen="..." --vaiTro="Quản lý" [--coSo="Cả hai"]
//                                   : them moi hoac cap nhat (upsert theo username)
//   --lock --username=...           : khoa tai khoan (khong dang nhap duoc)
//   --unlock --username=...         : mo khoa tai khoan
//
// Vi day la thao tac ghi hiem/quan tri (khong phai duong chay web nong), no
// dung truc tiep Sheets API voi scope day du ("spreadsheets") thay vi
// server/sheets/sheetsClient.js (chi doc). Mirror pattern trong
// jobs/syncCustomerReport.js (getSheetsClient/ensureSheet).
//
// Vi du:
//   npm run setup:users-sheet -- --init
//   npm run setup:users-sheet -- --add --username=quanly1 --password=DoiNgay123 --hoTen="Nguyễn Văn A" --vaiTro="Quản lý"
//   npm run setup:users-sheet -- --list
// ==========================================
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const bcrypt = require('bcryptjs');

const SHEET_NAME = 'Users';
const BCRYPT_SALT_ROUNDS = 10;
const ACTIVE_STATUS = 'Đang hoạt động';
const LOCKED_STATUS = 'Khóa';
const VALID_ROLES = ['Quản lý', 'Kế toán', 'Trưởng kho', 'Trợ lý', 'Lái xe', 'Khách'];

// Phai khop CHINH XAC thu tu cot trong server/auth/userRepository.js (USER_COLUMNS).
// "Email" them sau cung (cot cuoi, cho dang nhap Google — server/auth/
// userWriteRepository.js) de khong lam lech vi tri cac cot cu.
const HEADERS = [
  'ID',
  'Họ tên',
  'Tài khoản đăng nhập',
  'Mật khẩu (bcrypt hash)',
  'Vai trò',
  'Cơ sở phụ trách',
  'Trạng thái tài khoản',
  'Ngày tạo',
  'Đăng nhập gần nhất',
  'Email'
];

function parseArgs(argv) {
  const args = { _: [] };
  argv.forEach(token => {
    if (token.startsWith('--')) {
      const [key, ...rest] = token.slice(2).split('=');
      args[key] = rest.length ? rest.join('=') : true;
    } else {
      args._.push(token);
    }
  });
  return args;
}

function requiredEnv() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || !process.env.SPREADSHEET_ID) {
    throw new Error('Thiếu GOOGLE_SERVICE_ACCOUNT_JSON hoặc SPREADSHEET_ID trong server/.env.');
  }
  return {
    spreadsheetId: process.env.SPREADSHEET_ID,
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
  };
}

async function getSheetsClient(credentials) {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureUsersSheet(sheets, spreadsheetId) {
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const existing = (metadata.data.sheets || [])
    .map(sheet => sheet.properties)
    .find(properties => properties.title === SHEET_NAME);

  if (existing) {
    await ensureHeadersUpToDate(sheets, spreadsheetId);
    return existing;
  }

  console.log(`Tab "${SHEET_NAME}" chưa tồn tại — đang tạo...`);
  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }
  });
  const properties = response.data.replies[0].addSheet.properties;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${String.fromCharCode(64 + HEADERS.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });
  console.log(`Đã tạo tab "${SHEET_NAME}" với header đúng schema.`);
  return properties;
}

/**
 * Sheet "Users" tao TU TRUOC khi co cot "Email" (dang nhap Google, xem
 * server/auth/userWriteRepository.js) se thieu cot nay — vá THEM vao CUOI
 * header thay vi bat admin sua tay Sheet dang chay that. Chi APPEND cot
 * thieu, khong dong lai/xoa cot da co.
 */
async function ensureHeadersUpToDate(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!1:1`
  });
  const currentHeaders = (res.data.values && res.data.values[0]) || [];
  const missing = HEADERS.filter(h => !currentHeaders.includes(h));
  if (!missing.length) return currentHeaders;

  const patched = currentHeaders.concat(missing);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A1:${String.fromCharCode(64 + patched.length)}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [patched] }
  });
  console.log(`Đã vá thêm cột còn thiếu cho tab "${SHEET_NAME}": ${missing.join(', ')}.`);
  return patched;
}

async function readAllRows(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'`
  });
  const values = res.data.values || [];
  if (!values.length) return { headers: HEADERS, rows: [] };
  const [headers, ...rows] = values;
  return { headers, rows };
}

function normalizeUsername(raw) {
  return String(raw || '').trim().toLowerCase();
}

function formatDateVN(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${d}/${m}/${date.getFullYear()}`;
}

async function cmdInit() {
  const { spreadsheetId, credentials } = requiredEnv();
  const sheets = await getSheetsClient(credentials);
  await ensureUsersSheet(sheets, spreadsheetId);
}

async function cmdList() {
  const { spreadsheetId, credentials } = requiredEnv();
  const sheets = await getSheetsClient(credentials);
  await ensureUsersSheet(sheets, spreadsheetId);
  const { rows } = await readAllRows(sheets, spreadsheetId);
  const usable = rows.filter(row => row.some(v => v !== '' && v !== undefined));
  if (!usable.length) {
    console.log('Chưa có user nào. Dùng --add để tạo tài khoản đầu tiên.');
    return;
  }
  console.log(`${usable.length} user:`);
  usable.forEach(row => {
    console.log(`  - ${row[2]} | ${row[1]} | ${row[4]} | ${row[5] || ''} | ${row[6]} | ${row[9] || ''}`);
  });
}

async function cmdAdd(args) {
  const username = args.username;
  const password = args.password;
  const hoTen = args.hoTen;
  const vaiTro = args.vaiTro;
  const coSo = args.coSo || '';
  const email = args.email || '';

  if (!username || !password || !hoTen || !vaiTro) {
    throw new Error('Cần đủ --username --password --hoTen --vaiTro.');
  }
  if (!VALID_ROLES.includes(vaiTro)) {
    throw new Error(`--vaiTro phải là một trong: ${VALID_ROLES.join(', ')}`);
  }
  if (String(password).length < 8) {
    throw new Error('Mật khẩu nên tối thiểu 8 ký tự.');
  }

  const { spreadsheetId, credentials } = requiredEnv();
  const sheets = await getSheetsClient(credentials);
  await ensureUsersSheet(sheets, spreadsheetId);
  const { rows } = await readAllRows(sheets, spreadsheetId);

  const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  const existingIndex = rows.findIndex(row => normalizeUsername(row[2]) === normalizeUsername(username));

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2; // +1 header, +1 vi Sheets 1-indexed
    const existingRow = rows[existingIndex];
    const existingId = existingRow[0] || crypto.randomUUID();
    const existingCreated = existingRow[7] || formatDateVN(new Date());
    // --email khong truyen -> giu nguyen email da co (vd tai khoan Google
    // tu dang ky duoc admin duyet bang --add de doi vai tro/trang thai).
    const resolvedEmail = args.email !== undefined ? email : (existingRow[9] || '');
    const newRow = [existingId, hoTen, username, passwordHash, vaiTro, coSo, ACTIVE_STATUS, existingCreated, existingRow[8] || '', resolvedEmail];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${SHEET_NAME}'!A${rowNumber}:${String.fromCharCode(64 + HEADERS.length)}${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [newRow] }
    });
    console.log(`Đã cập nhật user "${username}" (${vaiTro}).`);
  } else {
    const newRow = [crypto.randomUUID(), hoTen, username, passwordHash, vaiTro, coSo, ACTIVE_STATUS, formatDateVN(new Date()), '', email];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${SHEET_NAME}'`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] }
    });
    console.log(`Đã tạo user mới "${username}" (${vaiTro}).`);
  }
}

async function cmdSetStatus(args, status) {
  const username = args.username;
  if (!username) throw new Error('Cần --username.');

  const { spreadsheetId, credentials } = requiredEnv();
  const sheets = await getSheetsClient(credentials);
  await ensureUsersSheet(sheets, spreadsheetId);
  const { rows } = await readAllRows(sheets, spreadsheetId);
  const index = rows.findIndex(row => normalizeUsername(row[2]) === normalizeUsername(username));
  if (index < 0) throw new Error(`Không tìm thấy user "${username}".`);

  const rowNumber = index + 2;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${SHEET_NAME}'!G${rowNumber}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] }
  });
  console.log(`Đã đặt "${username}" thành trạng thái "${status}".`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.init) return cmdInit();
  if (args.list) return cmdList();
  if (args.add) return cmdAdd(args);
  if (args.lock) return cmdSetStatus(args, LOCKED_STATUS);
  if (args.unlock) return cmdSetStatus(args, ACTIVE_STATUS);

  console.log(`Cách dùng:
  npm run setup:users-sheet -- --init
  npm run setup:users-sheet -- --list
  npm run setup:users-sheet -- --add --username=<tk> --password=<mk> --hoTen="<Họ tên>" --vaiTro="Quản lý|Kế toán|Trưởng kho|Trợ lý|Khách" [--coSo="An Khánh|Tân Phú|Cả hai"] [--email=<email>]
  npm run setup:users-sheet -- --lock --username=<tk>
  npm run setup:users-sheet -- --unlock --username=<tk>

  # Chuyển tài khoản legacy còn "Chờ duyệt" sang hoạt động:
  npm run setup:users-sheet -- --unlock --username=<email>
  # ...hoặc duyệt kèm đổi vai trò/cơ sở phụ trách luôn:
  npm run setup:users-sheet -- --add --username=<email> --password=<mk-tam> --hoTen="<Họ tên>" --vaiTro="Kế toán"`);
}

main().catch(err => {
  console.error('Lỗi:', err.message);
  process.exit(1);
});
