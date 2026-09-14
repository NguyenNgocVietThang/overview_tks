#!/usr/bin/env node
// ==========================================
// SETUP ORDER LIFECYCLE HISTORY SHEET — tao/cap nhat tab "Lich su cap nhat"
// trong spreadsheet "Vong doi don hang" (ORDER_LIFECYCLE_SPREADSHEET_ID).
//
// DIEU KIEN TIEN QUYET: service account (email trong GOOGLE_SERVICE_ACCOUNT_JSON)
// phai duoc chia se quyen EDITOR (khong chi Viewer) tren spreadsheet nay —
// script se bao loi permission neu chua doi quyen.
//
// Idempotent: neu tab da ton tai, chi ghi lai dung header hang 1, KHONG dong
// den 2 tab DonHang_HN/DonHang_SG do bot Telegram/Apps Script quan ly.
//
// Cach dung:
//   node server/scripts/setupOrderLifecycleHistorySheet.js
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* optional */ }
}
const { google } = require('googleapis');
const CONFIG = require('../config');

const SHEET_NAME = CONFIG.ORDER_LIFECYCLE_SHEET_HISTORY;
const HEADERS = [
  'Mã lịch sử', 'Mã đơn hàng', 'Mã trạng thái', 'Trạng thái mới',
  'Người thực hiện', 'Vai trò', 'Thời gian cập nhật', 'Ghi chú', 'Nội dung cập nhật'
];

function columnIndexToLetter(colIndex) {
  let letter = '';
  while (colIndex > 0) {
    const mod = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

async function getSheetsApi() {
  const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

async function main() {
  console.log('='.repeat(65));
  console.log('TOKOSI — Khởi tạo tab "Lịch sử cập nhật" (Vòng đời đơn hàng)');
  console.log('='.repeat(65));

  const spreadsheetId = CONFIG.ORDER_LIFECYCLE_SPREADSHEET_ID;
  if (!spreadsheetId) {
    console.error('\n[ERROR] ORDER_LIFECYCLE_SPREADSHEET_ID chua duoc dat trong .env.');
    process.exit(1);
  }
  console.log(`\n[OK] ORDER_LIFECYCLE_SPREADSHEET_ID: ${spreadsheetId}`);

  const sheets = await getSheetsApi();

  console.log('\n[...] Đang tải thông tin Spreadsheet...');
  const ssRes = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties.title,sheets.properties(sheetId,title)'
  });
  console.log(`[OK] Kết nối thành công: "${ssRes.data.properties.title}"`);
  console.log(`     URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);

  const existingSheets = ssRes.data.sheets || [];
  const titleToSheet = {};
  existingSheets.forEach(s => { titleToSheet[s.properties.title] = s.properties.sheetId; });

  if (!titleToSheet.hasOwnProperty(SHEET_NAME)) {
    console.log(`\n[+] Tạo tab mới: "${SHEET_NAME}"`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] }
    });
  } else {
    console.log(`\n[=] Tab đã tồn tại: "${SHEET_NAME}" (sheetId=${titleToSheet[SHEET_NAME]})`);
  }

  const range = `'${SHEET_NAME}'!A1:${columnIndexToLetter(HEADERS.length)}1`;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADERS] }
  });
  console.log(`[OK] "${SHEET_NAME}": ${HEADERS.length} cột:`);
  console.log(`     -> ${HEADERS.join(' | ')}`);

  console.log('\n' + '='.repeat(65));
  console.log('HOÀN TẤT!');
  console.log('='.repeat(65));
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  if (err.response && err.response.data) {
    console.error('  Google API Error:', JSON.stringify(err.response.data, null, 2));
  }
  if (err.message && /permission/i.test(err.message)) {
    console.error('\n  -> Kiểm tra: service account đã được cấp quyền EDITOR (không chỉ Viewer)');
    console.error('     trên spreadsheet "Vòng đời đơn hàng" chưa?');
  }
  process.exit(1);
});
