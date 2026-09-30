'use strict';

// Sidebar cap 3 (nhanh con tai lieu duoi "Quy dinh cong ty") + dieu huong tu thong bao chuong.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole, PAGE_FEATURES } = require('../../auth/featureRegistry');

const navCode = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js'), 'utf8');

function render(url, vaiTro, docs, activeTop = 'hr') {
  const dom = new JSDOM(
    '<!doctype html><html><body><header><div id="accountChip"></div></header><nav id="sidebar"></nav></body></html>',
    { runScripts: 'outside-only', url }
  );
  dom.window.eval(navCode);
  const sidebar = dom.window.document.getElementById('sidebar');
  const user = { vaiTro, branches: ['Hà Nội'], branch: 'Hà Nội', permissions: defaultsForRole(vaiTro), pageFeatures: PAGE_FEATURES };
  dom.window.TKSNav.renderTopSidebar(sidebar, activeTop, user);
  if (docs) dom.window.TKSNav.setHrRuleDocuments(docs);
  return { dom, window: dom.window, sidebar };
}

const DOCS = [
  { slug: 'gio-giac', title: 'Giờ giấc làm việc' },
  { slug: 'pdf-7', title: 'Nội quy <script>alert(1)</script>' }
];

test('nhánh con render dưới "Quy định công ty", tiêu đề bị escape', () => {
  const { window, sidebar } = render('https://tokosi.example/humanresources/#quydinh', 'Quản lý', DOCS);
  const items = [...sidebar.querySelectorAll('.nav-sublist .nav-subitem')];
  assert.deepEqual(items.map(a => a.dataset.hrRuleDoc), ['gio-giac', 'pdf-7']);
  assert.equal(items[1].getAttribute('href'), '/humanresources/#quydinh/pdf-7');
  assert.equal(sidebar.querySelector('script'), null, 'tiêu đề không được chèn thẻ script');
  assert.equal(items[1].textContent, 'Nội quy <script>alert(1)</script>');
  // Nhanh con nam ngay sau muc cha "Quy dinh cong ty".
  assert.equal(sidebar.querySelector('[data-hr-subtab="quydinh"]').nextElementSibling.className, 'nav-sublist');
  window.close();
});

test('nhánh con active theo hash; không có slug ⇒ tài liệu đầu; slug đã gỡ ⇒ tài liệu đầu', () => {
  const byHash = render('https://tokosi.example/humanresources/#quydinh/pdf-7', 'Quản lý', DOCS);
  assert.equal(byHash.sidebar.querySelector('.nav-subitem.active').dataset.hrRuleDoc, 'pdf-7');
  byHash.window.close();

  const noSlug = render('https://tokosi.example/humanresources/#quydinh', 'Quản lý', DOCS);
  assert.equal(noSlug.sidebar.querySelector('.nav-subitem.active').dataset.hrRuleDoc, 'gio-giac');
  noSlug.window.close();

  const gone = render('https://tokosi.example/humanresources/#quydinh/pdf-999', 'Quản lý', DOCS);
  assert.equal(gone.sidebar.querySelector('.nav-subitem.active').dataset.hrRuleDoc, 'gio-giac');
  gone.window.close();
});

test('hash #quydinh/<slug> không làm "Nghỉ phép" sáng nhầm; tab khác thì nhánh con không active', () => {
  const rules = render('https://tokosi.example/humanresources/#quydinh/pdf-7', 'Quản lý', DOCS);
  assert.equal(rules.sidebar.querySelector('[data-hr-subtab="leave"]').classList.contains('active'), false);
  assert.equal(rules.sidebar.querySelector('[data-hr-subtab="quydinh"]').classList.contains('active'), true);
  rules.window.close();

  const leave = render('https://tokosi.example/humanresources/#leave', 'Quản lý', DOCS);
  assert.equal(leave.sidebar.querySelectorAll('.nav-subitem.active').length, 0);
  leave.window.close();
});

test('trang khác / chưa nạp danh sách: không có nhánh con; danh sách rỗng thì bỏ nhánh con', () => {
  const other = render('https://tokosi.example/account/', 'Quản lý', null, 'account');
  assert.equal(other.sidebar.querySelectorAll('.nav-subitem').length, 0);
  other.window.close();

  const { window, sidebar } = render('https://tokosi.example/humanresources/#quydinh', 'Quản lý', DOCS);
  window.TKSNav.setHrRuleDocuments([]);
  assert.equal(sidebar.querySelectorAll('.nav-subitem').length, 0);
  window.TKSNav.setHrRuleDocuments('không phải mảng');
  assert.equal(sidebar.querySelectorAll('.nav-subitem').length, 0);
  window.close();
});

test('bấm thông báo ruleDocument: tới đúng tài liệu; không có relatedId ⇒ tab Quy định công ty', async () => {
  for (const [relatedId, expected] of [['pdf-9', '/humanresources/#quydinh/pdf-9'], [null, '/humanresources/#quydinh']]) {
    const dom = new JSDOM(
      '<!DOCTYPE html><html><body><div class="status-line"><div class="account-chip" id="accountChip"></div></div></body></html>',
      { runScripts: 'dangerously', url: 'https://tokosi.example/humanresources/' }
    );
    const { window } = dom;
    window.fetch = async (url, opts) => {
      if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
      if (opts && opts.method === 'PATCH') return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({ notifications: [
        { id: 'n1', type: 'rule_document_added', title: 'Có tài liệu quy định mới', message: 'A', isRead: false, relatedType: 'ruleDocument', relatedId }
      ] }) };
    };
    window.eval(navCode);
    let navigatedTo = null;
    window.TKSNav._navigate = url => { navigatedTo = url; };
    window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Nhân viên kho', permissions: defaultsForRole('Nhân viên kho') });
    await new Promise(resolve => setTimeout(resolve, 0));
    window.document.getElementById('tksNotifBellBtn').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    window.document.querySelector('.tks-notif-item').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(navigatedTo, expected);
    window.close();
  }
});
