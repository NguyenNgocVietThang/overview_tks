'use strict';

// Cot "Con han" cua bang Tuoi no: am do / 0 vang / duong xanh la, o ca file Excel va file HTML.

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { JSDOM } = require('jsdom');
const exportService = require('./exportService');
const { renderHtmlReport } = require('./exportHtmlReport');
const debtScheduleService = require('../debtSchedule/debtScheduleService');

const CUSTOMERS = [
  { branch: 'HN', customerName: 'Âm', sale: 'S', paymentSchedule: '5', currentDebt: 10, overdueDebt: 0, payoffDay: '2026-10-10', beyondHistory: false, equivalentDays: 8, remainingDays: -3 },
  { branch: 'HN', customerName: 'Không', sale: 'S', paymentSchedule: '5', currentDebt: 10, overdueDebt: 0, payoffDay: '2026-10-13', beyondHistory: false, equivalentDays: 5, remainingDays: 0 },
  { branch: 'HN', customerName: 'Dương', sale: 'S', paymentSchedule: '5', currentDebt: 10, overdueDebt: 0, payoffDay: '2026-10-17', beyondHistory: false, equivalentDays: 1, remainingDays: 4 },
  { branch: 'HN', customerName: 'Hết nợ', sale: 'S', paymentSchedule: '5', currentDebt: 0, overdueDebt: 0, payoffDay: null, beyondHistory: false, equivalentDays: null, remainingDays: null }
];

test('Excel: chu cot Con han do/vang/xanh theo dau, o trong khong to mau', async () => {
  const original = debtScheduleService.buildDebtAging;
  debtScheduleService.buildDebtAging = async () => ({ available: true, customers: CUSTOMERS });
  try {
    const file = await exportService.createExportWorkbook({
      tableKey: 'debt.aging', context: {}, columns: { debt_aging: ['customerName', 'remainingDays'] }
    }, 'Cả hai');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.worksheets[0];
    const argb = row => sheet.getCell(`B${row}`).font && sheet.getCell(`B${row}`).font.color && sheet.getCell(`B${row}`).font.color.argb;
    assert.equal(argb(2), 'FFB91C1C');
    assert.equal(argb(3), 'FFB8860B');
    assert.equal(argb(4), 'FF047857');
    assert.equal(sheet.getCell('B5').value, null);
    assert.notEqual(argb(5), 'FFB91C1C');
    assert.equal(sheet.getCell('A2').font && sheet.getCell('A2').font.color && sheet.getCell('A2').font.color.argb, undefined, 'cot khac khong to mau');
  } finally {
    debtScheduleService.buildDebtAging = original;
  }
});

test('HTML: o Con han co lop zero/pos, cot khong co signTone thi khong', async () => {
  const columns = [
    { key: 'name', label: 'Khách hàng', type: 'text' },
    { key: 'remainingDays', label: 'Còn hạn', type: 'number', signTone: true },
    { key: 'other', label: 'Số khác', type: 'number' }
  ];
  const rows = [
    { name: 'Âm', remainingDays: -3, other: 1 },
    { name: 'Không', remainingDays: 0, other: 0 },
    { name: 'Dương', remainingDays: 4, other: 2 },
    { name: 'Trống', remainingDays: null, other: 3 }
  ];
  const html = (await renderHtmlReport({
    meta: { title: 'Tuổi nợ', fileBase: 'x', generatedAt: new Date('2026-10-17T00:00:00Z') },
    worksheets: [{ key: 'debt_aging', name: 'Tuổi nợ', columns, rows }]
  })).buffer.toString('utf8');
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'file:///offline-report.html',
    beforeParse(win) {
      win.DecompressionStream = DecompressionStream;
      win.Response = Response;
      win.HTMLCanvasElement.prototype.getContext = () => null;
      win.console.error = () => {};
      win.matchMedia = query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
    }
  });
  const doc = dom.window.document;
  for (let i = 0; i < 200 && /Đang mở dữ liệu/.test(doc.getElementById('tbody').textContent); i += 1) await new Promise(resolve => setTimeout(resolve, 5));
  const cellClasses = [...doc.querySelectorAll('#tbody tr')].map(row => [row.cells[1].className, row.cells[2].className]);
  const byName = new Map([...doc.querySelectorAll('#tbody tr')].map((row, index) => [row.cells[0].textContent.trim(), cellClasses[index]]));
  assert.match(byName.get('Âm')[0], /\bneg\b/);
  assert.match(byName.get('Âm')[0], /\btone\b/);
  assert.match(byName.get('Không')[0], /\bzero\b/);
  assert.match(byName.get('Dương')[0], /\bpos\b/);
  assert.doesNotMatch(byName.get('Trống')[0], /\b(zero|pos|tone)\b/);
  assert.doesNotMatch(byName.get('Dương')[1], /\b(zero|pos|tone)\b/, 'cot khong signTone khong to mau');
  assert.match(html, /td\.zero\{color:var\(--warn\)\}/);
});
