#!/usr/bin/env node
// ==========================================
// SETUP HR SHEET — Khoi tao / Cap nhat Spreadsheet nhan su (nghi phep)
// Ten sheet va ten cot duoc Viet hoa truc quan, de su dung
//
// Cach dung:
//   node scripts/setupHrSheet.js
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* optional */ }
}
const { google } = require('googleapis');
const CONFIG = require('../config');

// ---- Schema 2 tab Nhan su ---------------------------------------------------
const HR_SCHEMAS = [
  {
    name: CONFIG.HR_SHEET_LEAVE_REQUESTS,
    headers: [
      'Mã yêu cầu', 'Telegram chat_id', 'Telegram username', 'Tài khoản web',
      'Họ tên', 'Chức vụ', 'Lý do nghỉ', 'Loại yêu cầu',
      'Thời gian nhắn', 'Thời gian bắt đầu nghỉ', 'Thời gian kết thúc nghỉ',
      'Tổng giờ nghỉ', 'Tổng ngày nghỉ (quy đổi)', 'Người bàn giao',
      'Trạng thái phê duyệt', 'Người phê duyệt', 'Thời điểm phê duyệt', 'Ghi chú/lý do từ chối',
      'Cờ nghỉ gấp', 'Cờ tự ý nghỉ', 'Thời gian tạo', 'Cập nhật lần cuối'
    ],
    fieldKeys: [
      'request_id', 'telegram_chat_id', 'telegram_username', 'web_username',
      'ho_ten', 'chuc_vu', 'ly_do', 'loai_yeu_cau',
      'thoi_gian_nhan', 'thoi_gian_bat_dau', 'thoi_gian_ket_thuc',
      'tong_gio_nghi', 'tong_ngay_nghi', 'nguoi_ban_giao',
      'trang_thai', 'nguoi_duyet', 'thoi_diem_duyet', 'ghi_chu_duyet',
      'co_nghi_gap', 'co_tu_y_nghi', 'created_at', 'updated_at'
    ],
    hidden: false,
    description: 'Danh sách yêu cầu nghỉ phép gửi qua bot Telegram và ghi nhận thủ công'
  },
  {
    name: CONFIG.HR_SHEET_TELEGRAM_LINKS,
    headers: [
      'Mã liên kết', 'Tài khoản web', 'Trạng thái', 'Telegram chat_id',
      'Telegram username', 'Thời gian tạo', 'Thời gian hết hạn', 'Thời gian liên kết'
    ],
    fieldKeys: [
      'link_code', 'web_username', 'status', 'telegram_chat_id',
      'telegram_username', 'created_at', 'expires_at', 'linked_at'
    ],
    hidden: true,
    description: 'Bảng liên kết Telegram chat_id với tài khoản web (nội bộ, ẩn)'
  }
];

// ---- Auth -------------------------------------------------------------------

async function getSheetsApi() {
  const credentials = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const authClient = await auth.getClient();
  return google.sheets({ version: 'v4', auth: authClient });
}

// ---- Main -------------------------------------------------------------------

async function main() {
  console.log('='.repeat(65));
  console.log('TOKOSI — Khởi tạo/Cập nhật Spreadsheet Nhân sự (Nghỉ phép)');
  console.log('='.repeat(65));

  const spreadsheetId = CONFIG.HR_SPREADSHEET_ID;

  if (!spreadsheetId) {
    console.error('\n[ERROR] HR_SPREADSHEET_ID chua duoc dat trong .env.');
    process.exit(1);
  }

  console.log(`\n[OK] HR_SPREADSHEET_ID: ${spreadsheetId}`);

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
  existingSheets.forEach(s => {
    titleToSheet[s.properties.title] = s.properties.sheetId;
  });

  const batchRequests = [];

  console.log('\n---- 1. Tạo tab còn thiếu ----');
  for (const schema of HR_SCHEMAS) {
    if (titleToSheet.hasOwnProperty(schema.name)) {
      console.log(`  [=] Tab đã tồn tại: "${schema.name}" (sheetId=${titleToSheet[schema.name]})`);
      continue;
    }
    batchRequests.push({ addSheet: { properties: { title: schema.name } } });
    console.log(`  [+] Tạo tab mới: "${schema.name}"`);
  }

  if (titleToSheet.hasOwnProperty('Sheet1') && Object.keys(titleToSheet).length > 1) {
    batchRequests.push({ deleteSheet: { sheetId: titleToSheet['Sheet1'] } });
    console.log('  [-] Xóa tab mặc định "Sheet1"');
  }

  if (batchRequests.length > 0) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: batchRequests }
    });
    // Cap nhat lai titleToSheet voi sheetId cua tab vua tao (can de an tab)
    (res.data.replies || []).forEach(reply => {
      if (reply.addSheet) {
        const props = reply.addSheet.properties;
        titleToSheet[props.title] = props.sheetId;
      }
    });
    console.log('[OK] Đã cập nhật xong cấu trúc tab.');
  }

  console.log('\n---- 2. Cập nhật Header cho từng tab ----');
  for (const schema of HR_SCHEMAS) {
    const { name, headers } = schema;
    const range = `'${name}'!A1:${columnIndexToLetter(headers.length)}1`;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] }
    });
    console.log(`  [OK] "${name}": ${headers.length} cột:`);
    console.log(`       -> ${headers.join(' | ')}`);
  }

  console.log('\n---- 3. Ẩn tab nội bộ ----');
  const hideRequests = [];
  for (const schema of HR_SCHEMAS) {
    if (!schema.hidden) continue;
    const sheetId = titleToSheet[schema.name];
    if (sheetId === undefined) continue;
    hideRequests.push({
      updateSheetProperties: {
        properties: { sheetId, hidden: true },
        fields: 'hidden'
      }
    });
    console.log(`  [OK] Ẩn tab "${schema.name}"`);
  }
  if (hideRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: hideRequests }
    });
  }

  console.log('\n' + '='.repeat(65));
  console.log('HOÀN TẤT KHỞI TẠO SHEET NHÂN SỰ!');
  console.log(`  URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  console.log('  Nhớ: share Spreadsheet này cho email service account (quyền Editor).');
  console.log('='.repeat(65));
}

function columnIndexToLetter(colIndex) {
  let letter = '';
  while (colIndex > 0) {
    const mod = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

main().catch(err => {
  console.error('\n[ERROR]', err.message);
  if (err.response && err.response.data) {
    console.error('  Google API Error:', JSON.stringify(err.response.data, null, 2));
  }
  process.exit(1);
});
