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

const DOC_COLUMNS = ['Mã chứng từ', 'Loại', 'Cơ sở', 'Thời gian', 'Khách hàng', 'Ghi chú tổng', 'Trạng thái', 'Số dòng', 'Tổng tiền'];

test('view documents: header, hàng, định dạng số và độ rộng cột', async () => {
  assert.deepEqual(VIEWS.documents.columns, DOC_COLUMNS);
  const file = await createVatDraftWorkbook({
    view: 'documents',
    columns: DOC_COLUMNS,
    rows: [['CT001', 'Nhập', 'Hà Nội', '01/10/2026 08:00', 'Công ty A', 'Ghi chú', 'Đã lưu', '3', 1234567.8]]
  });
  assert.equal(file.fileName, 'danh_sach_chung_tu.xlsx');
  const sh = await load(file);
  assert.equal(sh.name, 'Danh sách chứng từ');
  assert.deepEqual(sh.getRow(1).values.slice(1), DOC_COLUMNS);
  assert.equal(sh.getCell('A2').value, 'CT001');
  assert.equal(sh.getCell('H2').value, 3);
  assert.equal(sh.getCell('I2').value, 1234567.8);
  assert.equal(sh.getColumn(8).numFmt, '#,##0');
  assert.equal(sh.getColumn(9).numFmt, '#,##0');
  assert.equal(sh.getColumn(5).width, 36);
  assert.equal(sh.getColumn(6).width, 36);
  assert.equal(sh.getColumn(1).width, 16);
  assert.equal(sh.getColumn(9).width, 16);
  assert.equal(sh.views[0].state, 'frozen');
});

test('view documents: cho phép tập cột con theo thứ tự client gửi', async () => {
  const file = await createVatDraftWorkbook({ view: 'documents', columns: ['Tổng tiền', 'Mã chứng từ'], rows: [[500, 'CT9']] });
  const sh = await load(file);
  assert.equal(sh.columnCount, 2);
  assert.equal(sh.getCell('A1').value, 'Tổng tiền');
  assert.equal(sh.getCell('A2').value, 500);
  assert.equal(sh.getCell('B2').value, 'CT9');
});

test('chặn công thức Excel ở ô văn bản', async () => {
  const file = await createVatDraftWorkbook({
    view: 'documents',
    columns: ['Mã chứng từ', 'Khách hàng', 'Ghi chú tổng', 'Trạng thái'],
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
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: ['password'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: ['Số dòng', 'Số dòng'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: [], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'lookup', columns: ['Số dòng'], rows: [] }), bad);
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: ['Số dòng'], rows: [[1, 2]] }), bad);
});

test('từ chối quá MAX_EXPORT_ROWS dòng', async () => {
  assert.equal(MAX_EXPORT_ROWS, 10000);
  const rows = Array.from({ length: MAX_EXPORT_ROWS + 1 }, () => ['CT']);
  await assert.rejects(createVatDraftWorkbook({ view: 'documents', columns: ['Mã chứng từ'], rows }), { statusCode: 400 });
  const ok = await createVatDraftWorkbook({ view: 'documents', columns: ['Mã chứng từ'], rows: rows.slice(0, 5) });
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
  assert.equal(sh.getColumn(1).numFmt, '#,##0.##');
  assert.equal(sh.getColumn(3).width, 36);
});
