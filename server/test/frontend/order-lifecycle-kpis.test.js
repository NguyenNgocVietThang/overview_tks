'use strict';

// Chi so tong quat dau trang Vong doi don hang (2026-10-12): 3 the trang thai (Chua gui KT chi tinh Phieu tam, Da gui KT,
// Dang giao) + the canh bao theo tung loai. May chu tinh theo bo loc hien tai (lifecycleFakeServer goi chinh
// orderLifecycleQuery.countSummary); bam the = loc nhanh bang. Chay trang that trong JSDOM voi fetch gia.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const { defaultsForRole } = require('../../auth/featureRegistry');
const { lifecycleResponse, isListUrl } = require('./lifecycleFakeServer');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shipment', 'lifecycle', 'index.html'), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function fakeCan(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  return (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k)));
}

function order(code, summaryCode, extra = {}) {
  return {
    orderCode: code, branch: 'HN', saleName: 'Sale', customerName: 'KH', saleSentAt: '01/10/2026 08:00', warning: false, warnings: [],
    summary: { code: summaryCode, label: summaryCode, at: '01/10/2026 09:00' },
    source: 'sheet', kiotStatus: 'Đã xác nhận', sellableValue: null, orderTotal: 1000, orderDate: '01/10/2026 08:00', note: '',
    ...extra
  };
}

const ORDERS = [
  order('P1', 'NOT_SENT', { kiotStatus: 'Phiếu tạm', source: 'kiotviet' }),
  order('P2', 'NOT_SENT', { kiotStatus: 'Phiếu tạm', source: 'kiotviet' }),
  order('X1', 'NOT_SENT', { kiotStatus: 'Hoàn thành', source: 'kiotviet' }),
  order('S1', 'SENT_TO_ACCOUNTANT', { warnings: ['ACCOUNTANT_LATE'], warning: true }),
  order('D1', 'DELIVERING', { kiotStatus: 'Đang giao hàng', warnings: ['NOT_SIGNED_6H', 'DRIVER_NO_PHOTO'], warning: true }),
  order('D2', 'DELIVERING', { kiotStatus: 'Đang giao hàng' })
];

async function renderPage(orders = ORDERS) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/shipment/lifecycle/' });
  const { window } = dom;
  const calls = [];
  window.setInterval = () => 1;
  window.TKSNav = { authGuard: () => Promise.resolve({ vaiTro: 'Quản lý' }), can: fakeCan('Quản lý'), handleBranchError: () => false };
  window.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (isListUrl(url)) {
      const body = lifecycleResponse(String(url), orders, { ok: true, stale: false, fetchedAt: null, count: 0 });
      return { ok: true, status: 200, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  window.HTMLDialogElement.prototype.showModal = function() { this.setAttribute('open', ''); };
  window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  window.eval(fs.readFileSync(path.join(__dirname, '../../public/shared/table-controls.js'), 'utf8'));
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).forEach(script => window.eval(script));
  await settle();
  return { dom, window, document: window.document, calls };
}

const card = (document, kind, code) => document.querySelector(`.lc-kpi[data-kpi-kind="${kind}"][data-kpi-code="${code}"]`);
const valueOf = (document, kind, code) => card(document, kind, code).querySelector('.lc-kpi-value').textContent;
const lastParams = page => new URL(page.calls.filter(c => isListUrl(c.url)).at(-1).url, 'https://tokosi.example').searchParams;
const codesOf = document => [...document.querySelectorAll('#bulkBody tr')].map(row => row.cells[0].textContent);

test('chỉ số đầu trang: 3 thẻ trạng thái (Chưa gửi KT chỉ tính Phiếu tạm) + thẻ vi phạm theo từng loại cảnh báo', async () => {
  const page = await renderPage();
  assert.equal(page.document.getElementById('lcKpis').hidden, false);
  assert.equal(valueOf(page.document, 'status', 'NOT_SENT'), '2', 'đơn Hoàn thành chưa có dòng sheet không tính');
  assert.equal(valueOf(page.document, 'status', 'SENT_TO_ACCOUNTANT'), '1');
  assert.equal(valueOf(page.document, 'status', 'DELIVERING'), '2');
  assert.equal(valueOf(page.document, 'warning', 'any'), '2', 'đơn có nhiều cảnh báo chỉ đếm 1 lần ở tổng');
  assert.equal(valueOf(page.document, 'warning', 'ACCOUNTANT_LATE'), '1');
  assert.equal(valueOf(page.document, 'warning', 'NOT_SIGNED_6H'), '1');
  assert.equal(valueOf(page.document, 'warning', 'DRIVER_NO_PHOTO'), '1');
  assert.equal(valueOf(page.document, 'warning', 'NO_TRAIN_BILL'), '0');
  assert.ok(card(page.document, 'warning', 'NO_TRAIN_BILL').classList.contains('is-zero'));
  assert.equal(card(page.document, 'warning', 'ACCOUNTANT_LATE').querySelector('.lc-kpi-label').textContent, 'Kế toán sót đơn');
  page.window.close();
});

test('bấm thẻ "Chưa gửi KT" lọc bảng đúng tập đơn Phiếu tạm (status + kiotStatus); bấm lại bỏ lọc', async () => {
  const page = await renderPage();
  card(page.document, 'status', 'NOT_SENT').click();
  await settle();
  const params = lastParams(page);
  assert.equal(params.get('status'), 'NOT_SENT');
  assert.equal(params.get('kiotStatus'), 'Phiếu tạm');
  assert.deepEqual(codesOf(page.document).sort(), ['P1', 'P2'], 'số dòng bảng khớp số trên thẻ');
  assert.equal(card(page.document, 'status', 'NOT_SENT').getAttribute('aria-pressed'), 'true');
  assert.equal(page.document.getElementById('bulkStatusFilter').value, 'NOT_SENT');

  card(page.document, 'status', 'NOT_SENT').click();
  await settle();
  assert.equal(lastParams(page).get('status'), null);
  assert.equal(lastParams(page).get('kiotStatus'), null);
  page.window.close();
});

test('bấm thẻ cảnh báo lọc theo mã; đang lọc "Đang giao" thì thẻ Chưa gửi KT vẫn ra số đúng (không về 0)', async () => {
  const page = await renderPage();
  card(page.document, 'warning', 'NOT_SIGNED_6H').click();
  await settle();
  assert.equal(lastParams(page).get('warning'), 'NOT_SIGNED_6H');
  assert.deepEqual(codesOf(page.document), ['D1']);
  assert.equal(page.document.getElementById('bulkWarningFilter').value, 'NOT_SIGNED_6H');
  card(page.document, 'warning', 'NOT_SIGNED_6H').click();
  await settle();

  card(page.document, 'status', 'DELIVERING').click();
  await settle();
  assert.equal(lastParams(page).get('status'), 'DELIVERING');
  assert.equal(valueOf(page.document, 'status', 'NOT_SENT'), '2');
  assert.equal(valueOf(page.document, 'status', 'DELIVERING'), '2');
  page.window.close();
});

test('đổi bộ lọc Trạng thái KiotViet thì chỉ số đếm lại theo bộ lọc', async () => {
  const page = await renderPage();
  const select = page.document.getElementById('bulkKiotStatusFilter');
  select.value = 'Hoàn thành';
  select.dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await settle();
  assert.equal(valueOf(page.document, 'status', 'NOT_SENT'), '0');
  assert.equal(valueOf(page.document, 'status', 'DELIVERING'), '0');
  page.window.close();
});
