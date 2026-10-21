'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { createVatRequestWorkbook, COLUMNS } = require('./export');

async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.getWorksheet('ORDER VAT');
}

const ROW = {
  id: 7, createdAt: '2026-10-19T03:05:00Z', createdByName: 'Khánh Thịnh', customerName: '=HYPERLINK("x")',
  productCode: '014XOAN', productKey: '014xoan', productName: 'Bát inox', quantity: 400, unitPrice: 11400, totalAmount: 4560000,
  fullVat: true, saleNote: 'VAT1', status: '2', statusLabel: '2. Đã khai chờ về', accountantNote: 'CONT 10-6V', arrivalDate: '2026-10-28'
};

test('xuat du moi cot cua bang, so / ngay la o that, gio theo VN, chan cong thuc', async () => {
  const file = await createVatRequestWorkbook({
    rows: [ROW, { ...ROW, id: 8, productKey: 'khac', fullVat: false, arrivalDate: null }],
    metrics: { '014xoan': { vatStock: { total: 1500 }, pendingInsertQty: 200, incomingQty: 150, nearestArrivalDate: null, nearestArrivalText: 'Chưa có ETA' } }
  }, { now: new Date('2026-10-21T17:30:00Z') });
  assert.equal(file.fileName, 'order_vat_20261022_0030.xlsx');
  const sheet = await readSheet(file.buffer);
  assert.deepEqual(sheet.getRow(1).values.slice(1), COLUMNS.map(c => c.header));
  assert.equal(COLUMNS.length, 17);
  const first = sheet.getRow(2).values.slice(1);
  assert.equal(first[0].toISOString(), '2026-10-19T10:05:00.000Z', 'gio dong ho VN');
  assert.equal(first[2], `'=HYPERLINK("x")`);
  assert.equal(first[5], 400);
  assert.equal(first[7], 4560000);
  assert.equal(first[8], 'Full VAT');
  assert.equal(first[10], '2. Đã khai chờ về');
  assert.equal(first[12].toISOString(), '2026-10-28T00:00:00.000Z');
  assert.deepEqual(first.slice(13), [1500, 200, 150, 'Chưa có ETA']);
  const second = sheet.getRow(3).values.slice(1);
  assert.equal(second[8], 'Không full VAT');
  assert.equal(second[12], undefined, 'chua co ngay ve -> o trong');
  assert.equal(second[13], undefined, 'khong co so lieu ton -> o trong');
  assert.equal(sheet.rowCount, 3);
});

test('danh sach rong van co dong tieu de', async () => {
  const sheet = await readSheet((await createVatRequestWorkbook({ rows: [], metrics: {} })).buffer);
  assert.equal(sheet.rowCount, 1);
  assert.equal(sheet.getRow(1).getCell(1).value, 'Thời gian');
});
