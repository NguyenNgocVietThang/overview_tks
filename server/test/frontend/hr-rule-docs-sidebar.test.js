'use strict';

// Sidebar khong co nhanh con tai lieu + dieu huong tu thong bao chuong toi dung tai lieu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole, PAGE_FEATURES } = require('../../auth/featureRegistry');

const navCode = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js'), 'utf8');

function render(url, vaiTro, activeTop = 'hr') {
  const dom = new JSDOM(
    '<!doctype html><html><body><header><div id="accountChip"></div></header><nav id="sidebar"></nav></body></html>',
    { runScripts: 'outside-only', url }
  );
  dom.window.eval(navCode);
  const sidebar = dom.window.document.getElementById('sidebar');
  const user = { vaiTro, branches: ['Hà Nội'], branch: 'Hà Nội', permissions: defaultsForRole(vaiTro), pageFeatures: PAGE_FEATURES };
  dom.window.TKSNav.renderTopSidebar(sidebar, activeTop, user);
  return { dom, window: dom.window, sidebar };
}

test('sidebar không có nhánh con tài liệu dưới "Quy định công ty"; hash #quydinh/<slug> vẫn chỉ sáng mục cha', () => {
  const rules = render('https://tokosi.example/humanresources/#quydinh/pdf-7', 'Quản lý');
  assert.equal(rules.sidebar.querySelectorAll('.nav-sublist, .nav-subitem').length, 0);
  assert.equal(rules.sidebar.querySelector('[data-hr-subtab="quydinh"]').classList.contains('active'), true);
  assert.equal(rules.sidebar.querySelector('[data-hr-subtab="leave"]').classList.contains('active'), false);
  assert.equal(typeof rules.window.TKSNav.setHrRuleDocuments, 'undefined');
  rules.window.close();
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
