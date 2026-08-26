'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  normalizeHeaderKey,
  findCodeColumnIndex,
  extractCodesFromRows,
  parseProductCodesFromWorkbookBuffer
} = require('./excelParser');

test('normalizeHeaderKey bỏ dấu, lowercase, gộp khoảng trắng', () => {
  assert.equal(normalizeHeaderKey('  Mã   Hàng  '), 'ma hang');
  assert.equal(normalizeHeaderKey('Mã Hàng Hóa'), 'ma hang hoa');
  assert.equal(normalizeHeaderKey('SKU'), 'sku');
});

test('findCodeColumnIndex khớp các alias thường gặp', () => {
  assert.equal(findCodeColumnIndex(['STT', 'Mã hàng', 'Tên hàng']), 1);
  assert.equal(findCodeColumnIndex(['SKU', 'Ghi chú']), 0);
  assert.equal(findCodeColumnIndex(['Mã SP', 'Số lượng']), 0);
  assert.equal(findCodeColumnIndex(['Cột A', 'Cột B']), -1);
});

test('extractCodesFromRows trim, bỏ rỗng, unique giữ thứ tự xuất hiện đầu', () => {
  const rows = [['  SP001  '], ['SP002'], [''], [null], ['SP001'], ['SP003']];
  assert.deepEqual(extractCodesFromRows(rows, 0), ['SP001', 'SP002', 'SP003']);
});

async function buildWorkbookBuffer(headerRow, dataRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Mã hàng');
  if (headerRow) sheet.addRow(headerRow);
  for (const row of dataRows) sheet.addRow(row);
  return workbook.xlsx.writeBuffer();
}

test('parseProductCodesFromWorkbookBuffer đọc đúng mã hàng khi có header', async () => {
  const buffer = await buildWorkbookBuffer(['Mã hàng', 'Tên hàng'], [
    ['SP001', 'Bánh gạo lứt'],
    ['SP002', 'Nước suối'],
    ['SP001', 'Trùng lặp']
  ]);
  const codes = await parseProductCodesFromWorkbookBuffer(buffer);
  assert.deepEqual(codes, ['SP001', 'SP002']);
});

test('parseProductCodesFromWorkbookBuffer fallback cột A khi không dò được header', async () => {
  const buffer = await buildWorkbookBuffer(['Cột lạ 1', 'Cột lạ 2'], [
    ['SP010', 'x'],
    ['SP011', 'y']
  ]);
  const codes = await parseProductCodesFromWorkbookBuffer(buffer);
  assert.deepEqual(codes, ['Cột lạ 1', 'SP010', 'SP011']);
});
