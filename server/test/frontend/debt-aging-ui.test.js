'use strict';

// Muc 3 tab Cong no "Tuoi no theo hoa don": doc /api/debt-management/aging (bang tinh san), loc,
// sap xep, phan trang va bo do Con han <= 0.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const publicDir = path.join(__dirname, '..', '..', 'public');

const AGING = {
  available: true, asOfDay: '2026-10-17', refreshedAt: '2026-10-17T03:05:00.000Z',
  customers: [
    { customerKey: 'hanoi:1', branch: 'HN', customerName: 'Anh Bình', sale: 'Duy Thái', paymentSchedule: '5', scheduleDays: 5,
      currentDebt: 600000, overdueDebt: 300000, payoffDay: '2026-10-10', beyondHistory: false, equivalentDays: 7, remainingDays: -2 },
    { customerKey: 'hanoi:2', branch: 'HN', customerName: 'Chị An', sale: 'Duy Thái', paymentSchedule: '1', scheduleDays: 1,
      currentDebt: 0, overdueDebt: 0, payoffDay: null, beyondHistory: false, equivalentDays: null, remainingDays: null },
    { customerKey: 'saigon:1', branch: 'SG', customerName: 'Anh Sài', sale: 'Tú Uyên', paymentSchedule: '7', scheduleDays: 7,
      currentDebt: 50000, overdueDebt: 0, payoffDay: '2026-10-15', beyondHistory: false, equivalentDays: 2, remainingDays: 5 },
    { customerKey: 'saigon:2', branch: 'SG', customerName: 'Chị Xa', sale: 'Tú Uyên', paymentSchedule: '3', scheduleDays: 3,
      currentDebt: 9000000, overdueDebt: 9000000, payoffDay: '2025-10-18', beyondHistory: true, equivalentDays: 364, remainingDays: -361 }
  ]
};

function createDashboard(agingPayload) {
  const source = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#debt' });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => { if (dom.window.document) callback(); };
  dom.window.TKSNav = { authGuard: () => new Promise(() => {}), can: () => true, handleBranchError: () => false, renderTopSidebar() {} };
  const requests = [];
  dom.window.fetch = url => {
    requests.push(String(url));
    if (String(url).startsWith('/api/debt-management/aging')) {
      return Promise.resolve({ ok: true, json: async () => agingPayload });
    }
    return new Promise(() => {});
  };
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(publicDir, 'js', file), 'utf8'));
  });
  [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return { dom, requests };
}

function rowTexts(document) {
  return [...document.querySelectorAll('#debtAgingRows tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()));
}

test('muc 3 co du 9 cot, Ngay het no mac dinh an, nut Xuat file debt.aging', () => {
  const source = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const { dom } = createDashboard(AGING);
  const table = dom.window.document.querySelector('[data-debt-aging-table]');
  const headers = [...table.tHead.rows[0].cells];
  assert.deepEqual(headers.map(cell => cell.dataset.columnKey), [
    'co-so', 'khach-hang', 'sale', 'lich-tt', 'no-hien-tai', 'no-qua-han', 'ngay-het-no', 'ngay-no-tuong-duong', 'con-han'
  ]);
  assert.deepEqual(headers.filter(cell => cell.dataset.columnDefaultHidden === 'true').map(cell => cell.dataset.columnKey), ['ngay-het-no']);
  assert.match(source, /openExportDialog\('debt\.aging'\)/);
});

test('tai bang tinh san, hien so, bo do Con han <= 0 va dau ≥/≤ khi vuot lich su', async () => {
  const { dom, requests } = createDashboard(AGING);
  const { window } = dom;
  await window.loadDebtAging();
  assert.ok(requests.includes('/api/debt-management/aging'));
  const document = window.document;
  assert.equal(document.getElementById('tagDebtAging').textContent, '4');
  const rows = rowTexts(document);
  assert.deepEqual(rows[0].slice(0, 2), ['HN', 'Anh Bình']);
  assert.deepEqual(rows[0].slice(6), ['10/10/2026', '7', '-2']);
  assert.deepEqual(rows[1].slice(6), ['—', '—', '—']);
  assert.deepEqual(rows[3].slice(6), ['trước 18/10/2025', '≥ 364', '≤ -361']);
  const expired = [...document.querySelectorAll('#debtAgingRows .debt-aging-expired')].map(el => el.textContent);
  assert.deepEqual(expired, ['-2', '≤ -361']);
  assert.match(document.getElementById('debtAgingSourceLabel').textContent, /^tính lúc /);
});

test('loc Sale / Lich / Tim va sap xep Con han tang dan', async () => {
  const { dom } = createDashboard(AGING);
  const { window } = dom;
  const document = window.document;
  await window.loadDebtAging();
  document.getElementById('debtAgingSaleFilter').value = 'Tú Uyên';
  window.handleDebtAgingFilterChange();
  assert.deepEqual(rowTexts(document).map(row => row[1]), ['Anh Sài', 'Chị Xa']);
  document.getElementById('debtAgingSaleFilter').value = '';
  document.getElementById('debtAgingSearch').value = 'bình';
  window.handleDebtAgingFilterChange();
  assert.deepEqual(rowTexts(document).map(row => row[1]), ['Anh Bình']);
  document.getElementById('debtAgingSearch').value = '';
  window.handleDebtAgingFilterChange();
  window.setTableSort('debtAgingRows', 8);
  // Con han trong (khach het no) xep cuoi.
  assert.deepEqual(rowTexts(document).map(row => row[1]), ['Chị Xa', 'Anh Bình', 'Anh Sài', 'Chị An']);
  const payload = window.buildExportPayload('debt.aging');
  assert.deepEqual(JSON.parse(JSON.stringify(payload.context.debtAgingSort)), { columnIndex: 8, direction: 'asc' });
});

test('chua tinh lan nao -> canh bao, bang trong', async () => {
  const { dom } = createDashboard({ available: false, customers: [] });
  await dom.window.loadDebtAging();
  const document = dom.window.document;
  assert.equal(document.getElementById('debtAgingWarning').hidden, false);
  assert.match(document.getElementById('debtAgingRows').textContent, /Chưa có số liệu tuổi nợ/);
});
