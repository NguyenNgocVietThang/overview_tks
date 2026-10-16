// ==========================================
// MARKETING SHEETS WRITER — ghi nguoc 2 cot "Khach moi" (I) va "Ghi chu" (J) cua tab
// "BC Thang N" trong workbook Bao cao truc page (MARKETING_REPORT_SPREADSHEET_ID).
//
// Tach khoi sheetsClient.js (scope readonly). Can scope "spreadsheets" day du va service
// account phai duoc cap quyen Editor (khong chi Viewer) tren workbook nay.
// ==========================================
'use strict';

const { google } = require('googleapis');
const CONFIG = require('../config');

const COLUMNS = Object.freeze({ newCustomer: 'I', note: 'J' });
let apiPromise = null;

function getApi() {
  if (!apiPromise) {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    apiPromise = auth.getClient().then(client => google.sheets({ version: 'v4', auth: client }));
  }
  return apiPromise;
}

const quote = title => `'${String(title).replace(/'/g, "''")}'`;

function mapError(error) {
  const status = error?.code || error?.response?.status;
  const out = new Error(status === 403
    ? 'Tài khoản dịch vụ chưa có quyền Editor trên workbook Báo cáo trực page.'
    : 'Không ghi được vào Google Sheets. Vui lòng thử lại.');
  out.statusCode = status === 403 ? 403 : 503;
  out.code = status === 403 ? 'MARKETING_WRITE_FORBIDDEN' : 'MARKETING_WRITE_FAILED';
  return out;
}

function createMarketingSheetsWriter() {
  const spreadsheetId = () => CONFIG.MARKETING_REPORT_SPREADSHEET_ID;
  return {
    // Doc lai dong A:J (gia tri hien thi) de doi chieu truoc khi ghi.
    async readRow(title, row) {
      try {
        const api = await getApi();
        const res = await api.spreadsheets.values.get({
          spreadsheetId: spreadsheetId(), range: `${quote(title)}!A${row}:J${row}`, valueRenderOption: 'FORMATTED_VALUE'
        });
        return res.data.values?.[0] || [];
      } catch (error) { throw mapError(error); }
    },
    async writeCell(title, row, field, value) {
      const column = COLUMNS[field];
      try {
        const api = await getApi();
        await api.spreadsheets.values.update({
          spreadsheetId: spreadsheetId(), range: `${quote(title)}!${column}${row}`,
          valueInputOption: 'RAW', requestBody: { values: [[value]] }
        });
      } catch (error) { throw mapError(error); }
    }
  };
}

module.exports = { createMarketingSheetsWriter, COLUMNS };
