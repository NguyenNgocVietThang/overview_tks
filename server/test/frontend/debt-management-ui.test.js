'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const indexPath = path.join(__dirname, '..', '..', 'public', 'index.html');
const navPath = path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js');

function html() {
  return fs.readFileSync(indexPath, 'utf8');
}

function createDashboard(payload) {
  const source = html();
  const dom = new JSDOM(source, { runScripts: 'outside-only', url: 'https://tokosi.example/#debt' });
  if (payload) {
    dom.window.sessionStorage.setItem('tksDashboardCache', JSON.stringify({
      data: { debtManagement: payload },
      days: 30,
      filters: {
        overview: { mode: 'days', days: 30 },
        products: { mode: 'days', days: 30 },
        invoices: { mode: 'days', days: 30 },
        customers: { mode: 'all' }
      },
      productStatus: 'all'
    }));
  }
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({});
  dom.window.Chart = class FakeChart {
    static instances = [];
    static defaults = { font: {}, animation: {}, plugins: { tooltip: {} } };
    constructor(context, config) { this.config = config; FakeChart.instances.push(this); }
    destroy() {}
  };
  dom.window.setInterval = () => 1;
  dom.window.requestAnimationFrame = callback => callback();
  dom.window.TKSNav = {
    authGuard: () => new Promise(() => {}),
    // Trang bao cao goi TKSNav.can('reports.<tab>') de biet tab nao duoc xem
    // (nguon: user.permissions tu /api/auth/me) — test nay khong kiem tra phan
    // quyen nen mo het.
    can: () => true,
    handleBranchError: () => false,
    renderTopSidebar() {}
  };
  dom.window.fetch = () => new Promise(() => {});
  ['pagination.js', 'table-explorer.js'].forEach(file => {
    dom.window.eval(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', file), 'utf8'));
  });
  [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => dom.window.eval(script));
  return dom;
}

function debtPayload() {
  const base = {
    sale: 'Lan', paymentSchedule: '7', openingDebt: 0,
    currentDebtToSalesRatio: 0.5, overdueToSalesRatio: 0,
    alertCodes: ['overdue'], dataIssues: [], workflowStatus: 'Chưa xử lý',
    needsAction: true, canEditStatus: true, alertSignature: 'a'.repeat(64),
    updatedBy: '', updatedAt: null
  };
  return {
    available: true, sourceSheet: 'Công nợ HN', dataWarnings: [],
    kpi: { totalCurrentDebt: 1200000, totalOverdueDebt: 500000, actionCustomerCount: 1, overdueToSalesRatio: 0.25 },
    bySale: [{ sale: 'Lan', totalCurrentDebt: 1200000, totalOverdueDebt: 500000 }],
    byPaymentSchedule: [{ paymentSchedule: '7', totalCurrentDebt: 1200000, totalOverdueDebt: 500000 }],
    topCurrentDebt: [], topOverdueDebt: [],
    customers: [
      { ...base, customerKey: 'b'.repeat(64), customerName: 'Khách A', currentDebt: 500000, overdueDebt: 0 },
      { ...base, customerKey: 'c'.repeat(64), customerName: 'Khách B', currentDebt: 700000, overdueDebt: 500000, workflowStatus: 'Đã xử lý', needsAction: false }
    ]
  };
}

test('sidebar và tiêu đề thay Công nợ kỳ cũ bằng Quản lý công nợ', () => {
  const dashboard = html();
  const nav = fs.readFileSync(navPath, 'utf8');
  assert.match(nav, /view: 'debt', label: 'Quản lý công nợ'/);
  assert.match(dashboard, /<div class="view-title">Quản lý công nợ<\/div>/);
  assert.doesNotMatch(dashboard, /id="debtPeriodToggle"|setDebtPeriod\(|toggleDebtDetail\(|debt\.period/);
});

test('dashboard công nợ có đủ 4 KPI, 4 biểu đồ và bảng 10 cột', () => {
  const dashboard = html();
  ['dm-current', 'dm-overdue', 'dm-action-count', 'dm-overdue-ratio'].forEach(id => {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  });
  ['chartDebtBySale', 'chartDebtBySchedule', 'chartTopCurrentDebt', 'chartTopOverdueDebt'].forEach(id => {
    assert.match(dashboard, new RegExp(`id="${id}"`));
  });
  const table = dashboard.match(/<table[^>]*data-debt-management-table[\s\S]*?<\/table>/);
  assert.ok(table);
  assert.equal((table[0].match(/<th(?:\s[^>]*)?>/g) || []).length, 10);
  assert.match(table[0], /Khách hàng/);
  assert.match(table[0], /Cảnh báo tự động/);
  assert.match(table[0], /Trạng thái xử lý/);
});

test('bộ lọc local mặc định Cần xử lý và hỗ trợ sale, lịch, tìm khách/sale', () => {
  const dashboard = html();
  assert.match(dashboard, /id="debtQueueFilter"[\s\S]*?<option value="needsAction" selected>Cần xử lý<\/option>/);
  assert.match(dashboard, /id="debtSaleFilter"/);
  assert.match(dashboard, /id="debtScheduleFilter"/);
  assert.match(dashboard, /id="debtManagementSearch"/);
  assert.match(dashboard, /function getFilteredDebtCustomers\(/);
  assert.match(dashboard, /function sortDebtCustomers\(/);
});

test('click biểu đồ nối vào bộ lọc và cập nhật trạng thái dùng PATCH có rollback', () => {
  const dashboard = html();
  assert.match(dashboard, /function setDebtDimensionFilter\(/);
  assert.match(dashboard, /onClick:[\s\S]*setDebtDimensionFilter/);
  assert.match(dashboard, /fetch\('\/api\/debt-management\/status'/);
  assert.match(dashboard, /selectEl\.value = previousStatus/);
  assert.match(dashboard, /row-highlight-update/);
  assert.match(dashboard, /customer\.canEditStatus/);
});

test('hover biểu đồ công nợ bám toàn bộ trục tương ứng cho cột dọc và ngang', () => {
  const dom = createDashboard(debtPayload());

  dom.window.renderDebtTopChart(
    'chartTopCurrentDebt',
    'topCurrentDebt',
    [{ customerName: 'Khách A', currentDebt: 1200000 }],
    'currentDebt'
  );

  const chartConfigs = dom.window.Chart.instances.map(chart => chart.config);
  const verticalChart = chartConfigs.find(config => config.options.indexAxis !== 'y');
  const horizontalChart = chartConfigs.find(config => config.options.indexAxis === 'y');

  assert.deepEqual(
    JSON.parse(JSON.stringify(verticalChart.options.interaction)),
    { mode: 'index', intersect: false, axis: 'x' }
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(horizontalChart.options.interaction)),
    { mode: 'index', intersect: false, axis: 'y' }
  );
  dom.window.close();
});

test('script inline của dashboard vẫn biên dịch sau khi thay giao diện', () => {
  const scripts = [...html().matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(match => match[1])
    .filter(script => script.trim());
  scripts.forEach(script => assert.doesNotThrow(() => new Function(script)));
});

test('lọc mặc định, sort toàn tập và PATCH thành công cập nhật hàng chờ ngay', async () => {
  const dom = createDashboard(debtPayload());
  const document = dom.window.document;
  assert.equal(document.querySelectorAll('#debtManagementRows tr[data-customer-key]').length, 1, 'mặc định chỉ hiện khách cần xử lý');

  document.getElementById('debtQueueFilter').value = 'all';
  dom.window.handleDebtFilterChange();
  const currentDebtHeader = document.querySelectorAll('[data-debt-management-table] thead th')[4].querySelector('button');
  currentDebtHeader.click();
  currentDebtHeader.click();
  assert.equal(document.querySelector('#debtManagementRows tr[data-customer-key] .name-cell').textContent, 'Khách B');

  document.getElementById('debtQueueFilter').value = 'needsAction';
  dom.window.handleDebtFilterChange();
  const select = document.querySelector('#debtManagementRows .debt-status-select');
  dom.window.fetch = async () => ({ ok: true, json: async () => ({ status: 'Đã xử lý', updatedBy: 'Quản lý' }) });
  select.value = 'Đã xử lý';
  await dom.window.handleDebtStatusChange(select);
  assert.equal(document.querySelectorAll('#debtManagementRows tr[data-customer-key]').length, 0, 'đã xử lý phải rời hàng chờ mặc định');
  assert.equal(document.getElementById('dm-action-count').textContent, '0');
  dom.window.close();
});
