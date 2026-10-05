'use strict';

// Tab "Quy dinh cong ty" cua trang Quan ly nhan su: danh sach tai lieu (dung san + PDF)
// tu /api/hr/rules/documents, xem PDF bang blob, Quan ly tai len / go / khoi phuc.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole } = require('../../auth/featureRegistry');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

function fakeCan(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  return (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k)));
}

const BUILTINS = [
  { id: 1, kind: 'builtin', slug: 'gio-giac', builtinKey: 'gio-giac', title: 'Giờ giấc làm việc' },
  { id: 2, kind: 'builtin', slug: 'nghi-phep', builtinKey: 'nghi-phep', title: 'Quy định nghỉ phép' }
];
const PDF = { id: 7, kind: 'pdf', slug: 'pdf-7', title: 'Nội quy kho', fileName: 'noi-quy-kho.pdf', sizeBytes: 2048, uploadedBy: 'Quản lý A', createdAt: '2026-09-30T03:00:00.000Z' };

function jsonResponse(payload, status = 200) {
  return {
    ok: status < 400, status, statusText: '',
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

/** Dung trang HR that trong JSDOM voi fetch gia; server gia giu danh sach tai lieu trong `server.docs`. */
async function openPage({ vaiTro = 'Quản lý', hash = '#quydinh', docs = [...BUILTINS, PDF], listPayload } = {}) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: `https://tokosi.example/humanresources/${hash}` });
  const { window } = dom;
  const server = { docs: [...docs], missingDefaults: [], requests: [], confirmed: true };

  window.TKSNav = {
    authGuard: async () => ({ username: 'u', vaiTro }),
    can: fakeCan(vaiTro),
    renderTopSidebar() {}
  };
  window.confirm = () => server.confirmed;
  window.URL.createObjectURL = () => `blob:test/${server.requests.length}`;
  window.URL.revokeObjectURL = () => {};
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = opts.method || 'GET';
    server.requests.push({ url: u, method, body: opts.body });
    if (u === '/api/hr/rules/documents' && method === 'GET') {
      return jsonResponse(listPayload || { documents: server.docs, missingDefaults: server.missingDefaults, degraded: false });
    }
    if (u === '/api/hr/rules/documents' && method === 'POST') {
      const created = { ...PDF, id: 9, slug: 'pdf-9', title: 'Bảng lương' };
      server.docs.push(created);
      return jsonResponse({ document: created }, 201);
    }
    const file = /^\/api\/hr\/rules\/documents\/(\d+)\/file$/.exec(u);
    if (file) {
      return { ok: true, status: 200, headers: { get: () => 'application/pdf' }, arrayBuffer: async () => new Uint8Array([37, 80, 68, 70]).buffer };
    }
    const del = /^\/api\/hr\/rules\/documents\/(\d+)$/.exec(u);
    if (del && method === 'DELETE') {
      server.docs = server.docs.filter(d => String(d.id) !== del[1]);
      return jsonResponse({ ok: true });
    }
    if (u === '/api/hr/rules/documents/restore-defaults' && method === 'POST') {
      server.docs = [...BUILTINS, ...server.docs.filter(d => d.kind === 'pdf')];
      server.missingDefaults = [];
      return jsonResponse({ restored: 1, documents: server.docs });
    }
    return jsonResponse({ requests: [] });
  };

  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim())
    .forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  return { dom, window, document: window.document, server };
}

async function settle() {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0));
}

const tabSlugs = document => [...document.querySelectorAll('.rule-doc-tab')].map(t => t.dataset.ruleDocTab);
const activeTab = document => (document.querySelector('.rule-doc-tab.active') || {}).dataset;
const visibleViews = document => [...document.querySelectorAll('.rule-doc-view')].filter(v => !v.hidden).map(v => v.dataset.ruleDoc || v.id);

test('dựng tab từ API: 2 tài liệu dựng sẵn + PDF, mặc định tài liệu đầu', async () => {
  const { window, document, server } = await openPage();

  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep', 'pdf-7']);
  assert.equal(activeTab(document).ruleDocTab, 'gio-giac');
  assert.deepEqual(visibleViews(document), ['gio-giac']);
  assert.equal(document.getElementById('ruleDocTitle').textContent, 'Giờ giấc làm việc');
  window.close();
});

test('nội dung tài liệu dựng sẵn: "Quy định nghỉ phép" đủ thời hạn xin nghỉ, bàn giao công việc, mức phạt và bot Telegram', async () => {
  const { window, document } = await openPage();
  const leaveDoc = document.getElementById('ruleDoc-nghi-phep').textContent;
  assert.match(leaveDoc, /@nghipheptks_bot/);
  assert.match(leaveDoc, /Nghỉ ≤ 1 ngày/);
  assert.match(leaveDoc, /trước 23h59 của 02 ngày trước/);
  assert.match(leaveDoc, /Nghỉ trên 1 ngày/);
  assert.match(leaveDoc, /trước 23h59 của 03 ngày trước/);
  assert.match(leaveDoc, /Bàn giao công việc/);
  assert.match(leaveDoc, /người nhận bàn giao/);
  assert.match(leaveDoc, /tạo đơn trên web/);
  assert.match(leaveDoc, /50\.000đ\/lần/);
  assert.match(leaveDoc, /500\.000đ\/lần/);
  assert.doesNotMatch(leaveDoc, /lienket|Tạm duyệt/);
  const hoursDoc = document.getElementById('ruleDoc-gio-giac').textContent;
  assert.match(hoursDoc, /Giờ làm việc chính thức/);
  assert.doesNotMatch(hoursDoc, /Quy tắc xin nghỉ phép/);
  window.close();
});

test('chọn tab PDF: tải blob về, iframe dùng blob URL, hash ghi #quydinh/pdf-7', async () => {
  const { window, document, server } = await openPage();
  document.querySelector('[data-rule-doc-tab="pdf-7"]').click();
  await settle();

  assert.ok(server.requests.some(r => r.url === '/api/hr/rules/documents/7/file'));
  const frame = document.getElementById('ruleDocFrame');
  assert.match(frame.getAttribute('src'), /^blob:/);
  assert.equal(frame.hidden, false);
  assert.deepEqual(visibleViews(document), ['ruleDocPdfView']);
  assert.match(document.getElementById('ruleDocMeta').textContent, /Tải lên bởi Quản lý A/);
  assert.equal(window.location.hash, '#quydinh/pdf-7');
  window.close();
});

test('mở thẳng #quydinh/pdf-7: đúng tài liệu; slug lạ rơi về tài liệu đầu (sau khi tải lại 1 lần)', async () => {
  const direct = await openPage({ hash: '#quydinh/pdf-7' });
  assert.equal(activeTab(direct.document).ruleDocTab, 'pdf-7');
  direct.window.close();

  const unknown = await openPage({ hash: '#quydinh/pdf-999' });
  assert.equal(activeTab(unknown.document).ruleDocTab, 'gio-giac');
  const listCalls = unknown.server.requests.filter(r => r.url === '/api/hr/rules/documents' && r.method === 'GET').length;
  assert.ok(listCalls <= 3, 'không được lặp vô hạn khi slug không tồn tại');
  unknown.window.close();
});

test('Quản lý thấy nút tải lên / gỡ; tài khoản thường thì không', async () => {
  const manager = await openPage();
  assert.equal(manager.document.getElementById('ruleDocManage').hidden, false);
  assert.equal(manager.document.getElementById('ruleDocDeleteBtn').hidden, false);
  manager.window.close();

  const staff = await openPage({ vaiTro: 'Nhân viên kho' });
  assert.equal(staff.document.getElementById('ruleDocManage').hidden, true);
  assert.equal(staff.document.getElementById('ruleDocDeleteBtn').hidden, true);
  assert.equal(staff.document.getElementById('ruleDocDownloadBtn').hidden, false, 'ai cũng có nút Tải về PDF');
  staff.window.close();
});

test('nút Khôi phục chỉ hiện khi thiếu tài liệu mặc định; bấm ⇒ POST restore-defaults', async () => {
  const { window, document, server } = await openPage({ docs: [BUILTINS[0], PDF] });
  server.missingDefaults = ['nghi-phep'];
  await window.loadRuleDocuments(true);
  const restoreBtn = document.getElementById('ruleDocRestoreBtn');
  assert.equal(restoreBtn.hidden, false);

  await window.restoreRuleDefaults(); // inline onclick khong chay trong JSDOM outside-only
  await settle();
  assert.ok(server.requests.some(r => r.url === '/api/hr/rules/documents/restore-defaults' && r.method === 'POST'));
  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep', 'pdf-7']);
  assert.equal(restoreBtn.hidden, true);
  window.close();
});

test('gỡ tài liệu: xác nhận → DELETE → tab biến mất, rơi về tài liệu đầu', async () => {
  const { window, document, server } = await openPage({ hash: '#quydinh/pdf-7' });
  assert.equal(activeTab(document).ruleDocTab, 'pdf-7');

  await window.deleteActiveRuleDoc();
  await settle();

  assert.ok(server.requests.some(r => r.method === 'DELETE' && r.url === '/api/hr/rules/documents/7'));
  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep']);
  assert.equal(activeTab(document).ruleDocTab, 'gio-giac');
  window.close();
});

test('hủy hộp xác nhận ⇒ không gọi DELETE', async () => {
  const { window, document, server } = await openPage({ hash: '#quydinh/pdf-7' });
  server.confirmed = false;
  await window.deleteActiveRuleDoc();
  await settle();
  assert.equal(server.requests.some(r => r.method === 'DELETE'), false);
  assert.equal(tabSlugs(document).length, 3);
  window.close();
});

test('tải lên: gửi FormData (file + title) rồi chọn tài liệu mới; sai đuôi/quá lớn bị chặn phía client', async () => {
  const { window, document, server } = await openPage();
  window.openRuleUploadModal();
  assert.equal(document.getElementById('ruleUploadModal').hidden, false);

  const fileInput = document.getElementById('ruleUploadFile');
  const setFile = file => Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });

  setFile(new window.File(['x'], 'anh.png', { type: 'image/png' }));
  await window.submitRuleUpload();
  assert.match(document.getElementById('ruleUploadError').textContent, /\.pdf/);
  assert.equal(server.requests.some(r => r.method === 'POST' && r.url === '/api/hr/rules/documents'), false);

  const good = new window.File(['%PDF-1.4'], 'Bảng lương.pdf', { type: 'application/pdf' });
  setFile(good);
  window.onRuleUploadFileChange();
  assert.equal(document.getElementById('ruleUploadName').value, 'Bảng lương');
  await window.submitRuleUpload();
  await settle();

  const post = server.requests.find(r => r.method === 'POST' && r.url === '/api/hr/rules/documents');
  assert.ok(post, 'phải POST tài liệu');
  assert.equal(post.body.get('title'), 'Bảng lương');
  assert.equal(post.body.get('file').name, 'Bảng lương.pdf');
  assert.equal(document.getElementById('ruleUploadModal').hidden, true);
  assert.deepEqual(tabSlugs(document), ['gio-giac', 'nghi-phep', 'pdf-7', 'pdf-9']);
  assert.equal(activeTab(document).ruleDocTab, 'pdf-9');
  window.close();
});

test('payload lạ / lỗi API: hiện trạng thái lỗi trong panel, không throw', async () => {
  const { window, document } = await openPage({ listPayload: { requests: [] } });
  const status = document.getElementById('ruleDocStatus');
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Không tải được danh sách tài liệu/);
  assert.equal(document.querySelectorAll('.rule-doc-tab').length, 0);
  window.close();
});
