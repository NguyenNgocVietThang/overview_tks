'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createVatDraftWorkbook, MAX_EXPORT_ROWS, VIEWS } = require('./vatDraftExport');

async function load(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file.buffer);
  return wb.worksheets[0];
}

test('chỉ còn view allocation (bỏ view documents cùng bảng chọn chứng từ)', () => {
  assert.deepEqual(Object.keys(VIEWS), ['allocation']);
});

test('view allocation: cho phép tập cột con theo thứ tự client gửi', async () => {
  const file = await createVatDraftWorkbook({ view: 'allocation', columns: ['Thành tiền', 'MÃ SP'], rows: [[500, 'SP9']] });
  const sh = await load(file);
  assert.equal(sh.columnCount, 2);
  assert.equal(sh.getCell('A1').value, 'Thành tiền');
  assert.equal(sh.getCell('A2').value, 500);
  assert.equal(sh.getCell('B2').value, 'SP9');
});

test('chặn công thức Excel ở ô văn bản', async () => {
  const file = await createVatDraftWorkbook({
    view: 'allocation',
    columns: ['Mã hóa đơn', 'TÊN SP', 'Ghi chú tổng', 'Trạng thái'],
    rows: [['=CMD()', '+1', '-2', '@SUM(A1)']]
  });
  const sh = await load(file);
  assert.equal(sh.getCell('A2').value, "'=CMD()");
  assert.equal(sh.getCell('B2').value, "'+1");
  assert.equal(sh.getCell('C2').value, "'-2");
  assert.equal(sh.getCell('D2').value, "'@SUM(A1)");
});

test('từ chối cột lạ, view lạ, dữ liệu sai hình dạng', async () => {
  const bad = { statusCode: 400, code: 'VAT_DRAFT_EXPORT_INVALID' };
  await assert.rejects(createVatDraftWorkbook({ view: 'allocation', columns: ['password'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'allocation', columns: ['SL', 'SL'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'allocation', columns: [], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: ['SL'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'allocation', columns: ['SL'], rows: [[1, 2]] }), bad);
});

test('từ chối quá MAX_EXPORT_ROWS dòng', async () => {
  assert.equal(MAX_EXPORT_ROWS, 10000);
  const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ['CT']);
  await assert.rejects(createVatDraftWorkbook({ view: 'allocation', columns: ['MÃ SP'], rows }), { statusCode: 400 });
  const ok = await createVatDraftWorkbook({ view: 'allocation', columns: ['MÃ SP'], rows: rows.slice(0, 5) });
  assert.ok(ok.buffer.length > 0);
});

test('view allocation vẫn chạy', async () => {
  const file = await createVatDraftWorkbook({
    view: 'allocation',
    columns: ['SL', 'MÃ SP', 'TÊN SP'],
    rows: [[2, '=HYPERLINK("x")', 'A']]
  });
  assert.equal(file.fileName, 'ket_qua_xu_ly_hoa_don.xlsx');
  const sh = await load(file);
  assert.equal(sh.name, 'Xử lý hóa đơn');
  assert.equal(sh.getCell('A2').value, 2);
  assert.equal(sh.getCell('B2').value, '\'=HYPERLINK("x")');
  assert.equal(sh.getColumn(1).numFmt, '#,##0');
  assert.equal(sh.getColumn(3).width, 36);
});
