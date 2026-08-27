const fs = require('fs');
const path = require('path');
const { google } = require('../server/node_modules/googleapis');
require('../server/node_modules/dotenv').config({ path: path.join(__dirname, '../server/.env') });

const spreadsheetId = process.env.SPREADSHEET_ID;
const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

const requested = {
  'Hàng hóa': [
    ['Hình ảnh'], ['Liên kết kênh bán'], ['Thương hiệu'], ['Dự kiến hết hàng'],
    ['Định mức tồn thấp nhất', 'Định mức tồn ít nhất'],
    ['Định mức tồn cao nhất', 'Định mức tồn nhiều nhất'],
    ['Mã vạch'], ['Đơn vị tính'], ['ID đơn vị cơ bản'], ['ID hàng cùng loại'],
    ['Giá trước thuế'], ['Giá sau thuế'], ['Trọng lượng']
  ],
  'Nhà cung cấp': [
    ['Email'], ['Khu vực'], ['Phường/Xã'], ['Công ty'], ['Mã số thuế'],
    ['Ghi chú'], ['Nhóm nhà cung cấp']
  ],
  'Khách hàng': [
    ['Giới tính'], ['Email'], ['Loại khách hàng'], ['Ngày sinh'], ['CCCD/CMND'],
    ['Khu vực'], ['Phường/Xã'], ['Ghi chú'], ['Mã số thuế'], ['Tổng điểm'],
    ['Điểm hiện tại'], ['Ngày cập nhật'], ['PSID Facebook', 'PSID facebook']
  ],
  'Hóa đơn': [['ID gian hàng'], ['Tổng thuế'], ['Ngày cập nhật']],
  'Chi tiết hóa đơn': [['Là dòng chính'], ['Serial/IMEI']],
  'Đặt hàng': [['Tổng thuế']],
  'Trả hàng': [
    ['Mã hóa đơn gốc'], ['ID gian hàng'], ['Tổng thuế'], ['Chế độ tính thuế'],
    ['Giảm giá sau thuế']
  ],
  'Nhập hàng': [
    ['Ngày cập nhật'], ['Điện thoại'], ['Địa chỉ'], ['Số hóa đơn đầu vào'],
    ['Thương hiệu'], ['ĐVT'], ['Ghi chú hàng hóa']
  ],
  'Hàng ngừng kinh doanh': [
    ['Thời gian phát hiện'], ['Mã vạch'], ['ID thương hiệu'], ['Đơn vị'],
    ['ID đơn vị', 'ID đơn vị cơ bản'], ['ID hàng cùng loại'], ['Thuộc tính'],
    ['Vị trí hàng'], ['Công thức/combo'], ['Mẫu ghi chú'], ['Tích điểm'],
    ['Quản lý serial/IMEI'], ['Quản lý hạn sử dụng'],
    ['Dữ liệu API đầy đủ (JSON)']
  ],
  HN1: [['VAT bán hàng'], ['VAT hoàn lại'], ['Thu khác']],
  HN3: [['VAT bán hàng'], ['VAT hoàn lại'], ['Thu khác']],
  HN7: [['VAT bán hàng'], ['VAT hoàn lại'], ['Thu khác']]
};

function quoteSheet(name) {
  return `'${String(name).replace(/'/g, "''")}'`;
}

function columnLetter(index) {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('vi');
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'properties(title),sheets(properties(sheetId,title,gridProperties))'
  });

  const targetNames = Object.keys(requested);
  const headerResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: targetNames.map(name => `${quoteSheet(name)}!1:1`),
    valueRenderOption: 'UNFORMATTED_VALUE'
  });

  const audit = [];
  const countRanges = [];
  const countTargets = [];
  for (let i = 0; i < targetNames.length; i++) {
    const sheetName = targetNames[i];
    const headers = (headerResponse.data.valueRanges[i].values || [[]])[0];
    for (const aliases of requested[sheetName]) {
      const normalizedAliases = aliases.map(normalize);
      const columnIndex = headers.findIndex(header => normalizedAliases.includes(normalize(header)));
      if (columnIndex < 0) {
        audit.push({ sheet: sheetName, requested: aliases[0], status: 'missing' });
        continue;
      }
      const letter = columnLetter(columnIndex);
      const item = {
        sheet: sheetName,
        requested: aliases[0],
        header: headers[columnIndex],
        columnIndex: columnIndex + 1,
        columnLetter: letter,
        status: 'found'
      };
      audit.push(item);
      countTargets.push(item);
      countRanges.push(`${quoteSheet(sheetName)}!${letter}2:${letter}`);
    }
  }

  const countResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: countRanges,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  (countResponse.data.valueRanges || []).forEach((range, index) => {
    const values = range.values || [];
    countTargets[index].nonEmptyRows = values.reduce((count, row) => {
      const value = row[0];
      return count + (value !== '' && value !== null && value !== undefined ? 1 : 0);
    }, 0);
  });

  const sheetRanges = metadata.data.sheets.map(sheet => {
    const props = sheet.properties;
    const rows = props.gridProperties.rowCount;
    const cols = props.gridProperties.columnCount;
    return `${quoteSheet(props.title)}!A1:${columnLetter(cols - 1)}${rows}`;
  });

  let formulaSheets = [];
  try {
    const formulaResponse = await sheets.spreadsheets.get({
      spreadsheetId,
      ranges: sheetRanges,
      includeGridData: true,
      fields: 'sheets(properties(title),data(startRow,startColumn,rowData(values(userEnteredValue/formulaValue))))'
    });
    formulaSheets = formulaResponse.data.sheets || [];
  } catch (error) {
    formulaSheets = [{ formulaAuditError: error.message }];
  }

  const formulas = [];
  for (const sheet of formulaSheets) {
    if (!sheet.properties) continue;
    for (const block of sheet.data || []) {
      const startRow = block.startRow || 0;
      const startColumn = block.startColumn || 0;
      (block.rowData || []).forEach((row, rowOffset) => {
        (row.values || []).forEach((cell, colOffset) => {
          const formula = cell.userEnteredValue && cell.userEnteredValue.formulaValue;
          if (formula) {
            formulas.push({
              sheet: sheet.properties.title,
              cell: `${columnLetter(startColumn + colOffset)}${startRow + rowOffset + 1}`,
              formula
            });
          }
        });
      });
    }
  }

  for (const item of audit.filter(entry => entry.status === 'found')) {
    const sheetToken = item.sheet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const col = item.columnLetter;
    const sheetRef = new RegExp(`(?:'${sheetToken}'|${sheetToken})!\\$?${col}(?:\\$?\\d+|\\s*:\\s*\\$?${col})`, 'i');
    const headerRef = normalize(item.header);
    item.formulaReferences = formulas
      .filter(entry => sheetRef.test(entry.formula) || normalize(entry.formula).includes(headerRef))
      .map(entry => `${entry.sheet}!${entry.cell}: ${entry.formula}`);
  }

  const output = {
    spreadsheetId,
    title: metadata.data.properties.title,
    sheetCount: metadata.data.sheets.length,
    formulaCount: formulas.length,
    formulaAuditError: formulaSheets[0] && formulaSheets[0].formulaAuditError,
    audit
  };
  fs.writeFileSync(path.join(__dirname, 'column-audit.json'), JSON.stringify(output, null, 2));
  process.stdout.write(JSON.stringify({
    title: output.title,
    formulaCount: output.formulaCount,
    formulaAuditError: output.formulaAuditError || null,
    found: audit.filter(item => item.status === 'found').length,
    missing: audit.filter(item => item.status === 'missing')
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
