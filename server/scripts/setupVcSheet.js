#!/usr/bin/env node
// ==========================================
// SETUP VC SHEET — Khoi tao / Cap nhat Spreadsheet van chuyen
// Ten sheet va ten cot duoc Viet hoa truc quan, de su dung
//
// Cach dung:
//   node scripts/setupVcSheet.js
// ==========================================
if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* optional */ }
}
const { google } = require('googleapis');
const CONFIG = require('../config');

// ---- Schema 6 tab Van chuyen voi ten Tieng Viet ro rang, de dung ----------
const VC_SCHEMAS = [
  {
    name: 'Đơn vận chuyển',
    oldNames: ['VC_Orders'],
    headers: [
      'Mã vận đơn', 'Mã hóa đơn KiotViet', 'Kho xuất', 'Luồng giao hàng',
      'Mã xe', 'Tên tài xế', 'Tên khách hàng', 'Số điện thoại',
      'Địa chỉ nhận hàng', 'Trạng thái hiện tại', 'Giữ hàng tàu hỏa',
      'Tiền cước', 'Ghi chú cước', 'Thời gian tạo', 'Cập nhật lần cuối'
    ],
    fieldKeys: [
      'order_id', 'kiotviet_code', 'warehouse', 'flow',
      'vehicle_id', 'driver_name', 'customer_name', 'customer_phone',
      'address', 'current_status', 'is_transit_held',
      'freight_amount', 'freight_note', 'created_at', 'updated_at'
    ],
    description: 'Bảng theo dõi đơn vận chuyển chính'
  },
  {
    name: 'Chi tiết vận chuyển',
    oldNames: ['VC_OrderItems'],
    headers: [
      'Mã vận đơn', 'Mã hàng', 'Tên hàng hóa',
      'Số lượng đặt', 'Số lượng đã nhặt', 'Đơn vị tính', 'Ghi chú'
    ],
    fieldKeys: [
      'order_id', 'product_code', 'product_name',
      'quantity_ordered', 'quantity_picked', 'unit', 'notes'
    ],
    description: 'Chi tiết từng mặt hàng cần giao'
  },
  {
    name: 'Lịch sử trạng thái',
    oldNames: ['VC_StatusHistory'],
    headers: [
      'Mã lịch sử', 'Mã vận đơn', 'Trạng thái trước', 'Trạng thái mới',
      'Người thực hiện', 'Thời gian cập nhật', 'Ghi chú'
    ],
    fieldKeys: [
      'history_id', 'order_id', 'from_status', 'to_status',
      'changed_by', 'changed_at', 'note'
    ],
    description: 'Nhật ký audit log đổi trạng thái đơn'
  },
  {
    name: 'Ảnh chứng từ',
    oldNames: ['VC_Attachments'],
    headers: [
      'Mã chứng từ', 'Mã vận đơn', 'Loại chứng từ',
      'Google Drive File ID', 'Link xem ảnh', 'Link thumbnail',
      'Người tải lên', 'Thời gian tải lên', 'Nội dung OCR'
    ],
    fieldKeys: [
      'attachment_id', 'order_id', 'type',
      'drive_file_id', 'drive_view_url', 'drive_thumbnail_url',
      'uploaded_by', 'uploaded_at', 'ocr_text'
    ],
    description: 'Quản lý ảnh hàng nhặt, ảnh giao và bill ký nhận'
  },
  {
    name: 'Sự cố vận chuyển',
    oldNames: ['VC_Exceptions'],
    headers: [
      'Mã sự cố', 'Mã vận đơn', 'Khâu phát sinh', 'Loại sự cố',
      'Mô tả chi tiết', 'Người xử lý', 'Trạng thái xử lý',
      'Thời gian báo cáo', 'Thời gian xử lý xong'
    ],
    fieldKeys: [
      'exception_id', 'order_id', 'stage', 'type',
      'description', 'resolver', 'status', 'created_at', 'resolved_at'
    ],
    description: 'Theo dõi sự cố nhặt/giao và trả hàng'
  },
  {
    name: 'Danh mục xe',
    oldNames: ['VC_Vehicles'],
    headers: [
      'Mã xe', 'Biển số xe', 'Loại xe',
      'Tài xế mặc định', 'Tải trọng tối đa (kg)', 'Ghi chú'
    ],
    fieldKeys: [
      'vehicle_id', 'plate_number', 'vehicle_type',
      'default_driver', 'max_weight', 'notes'
    ],
    description: 'Danh mục phương tiện và tài xế phụ trách'
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
  console.log('TOKOSI — Cập nhật Tên Tab & Tên Cột Spreadsheet Vận chuyển');
  console.log('='.repeat(65));

  const spreadsheetId = CONFIG.VC_SPREADSHEET_ID;

  if (!spreadsheetId) {
    console.error('\n[ERROR] VC_SPREADSHEET_ID chua duoc dat trong .env.');
    process.exit(1);
  }

  console.log(`\n[OK] VC_SPREADSHEET_ID: ${spreadsheetId}`);

  const sheets = await getSheetsApi();

  // 1. Kiem tra ket noi
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

  // 2. Kiem tra rename hoac tao moi tab
  console.log('\n---- 1. Cập nhật / Đổi tên các Tab ----');
  for (const schema of VC_SCHEMAS) {
    const targetName = schema.name;
    
    // Nếu tab với tên tiếng Việt đã tồn tại -> giữ nguyên
    if (titleToSheet.hasOwnProperty(targetName)) {
      console.log(`  [=] Tab đã đúng tên: "${targetName}" (sheetId=${titleToSheet[targetName]})`);
      continue;
    }

    // Kiểm tra xem có tab cũ (ví dụ VC_Orders) không -> đổi tên
    let renamed = false;
    for (const old of schema.oldNames) {
      if (titleToSheet.hasOwnProperty(old)) {
        const sheetId = titleToSheet[old];
        batchRequests.push({
          updateSheetProperties: {
            properties: {
              sheetId: sheetId,
              title: targetName
            },
            fields: 'title'
          }
        });
        titleToSheet[targetName] = sheetId;
        delete titleToSheet[old];
        console.log(`  [~] Đổi tên tab: "${old}" -> "${targetName}" (sheetId=${sheetId})`);
        renamed = true;
        break;
      }
    }

    // Nếu chưa có cả tab mới lẫn tab cũ -> tạo mới
    if (!renamed) {
      batchRequests.push({
        addSheet: {
          properties: { title: targetName }
        }
      });
      console.log(`  [+] Tạo tab mới: "${targetName}"`);
    }
  }

  // 3. Xóa Sheet1 nếu còn tồn tại
  if (titleToSheet.hasOwnProperty('Sheet1') && Object.keys(titleToSheet).length > 1) {
    batchRequests.push({
      deleteSheet: { sheetId: titleToSheet['Sheet1'] }
    });
    console.log(`  [-] Xóa tab mặc định "Sheet1"`);
  }

  if (batchRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: batchRequests }
    });
    console.log(`[OK] Đã cập nhật xong cấu trúc tab.`);
  }

  // 4. Ghi đè Header hàng 1 cho từng tab bằng Tiếng Việt
  console.log('\n---- 2. Cập nhật Header tiếng Việt cho các cột ----');
  for (const schema of VC_SCHEMAS) {
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

  console.log('\n' + '='.repeat(65));
  console.log('HOÀN TẤT CẬP NHẬT SHEET VẬN CHUYỂN!');
  console.log(`  URL: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
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
