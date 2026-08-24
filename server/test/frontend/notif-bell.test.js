'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const MODULE_PATH = path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js');
const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');

function createEnv(user, fetchImpl) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
      '<div class="status-line">' +
        '<div class="account-chip" id="accountChip"></div>' +
      '</div>' +
    '</body></html>',
    { runScripts: 'dangerously', url: 'https://tokosi.example/humanresources/' }
  );
  const { window } = dom;
  window.fetch = fetchImpl;
  window.eval(moduleSource);
  return { dom, window, document: window.document };
}

test('renderNotifBell chèn nút chuông ngay trước #accountChip', () => {
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Trợ lý' }, async () => ({
    ok: true, json: async () => ({ count: 0 })
  }));
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Trợ lý' });
  const bell = document.getElementById('tksNotifBell');
  assert.ok(bell, 'phải có phần tử #tksNotifBell');
  assert.equal(bell.nextElementSibling.id, 'accountChip', 'chuông phải nằm ngay trước #accountChip');
  window.close();
});

test('renderNotifBell hiển thị badge đúng số thông báo chưa đọc', async () => {
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Trợ lý' }, async (url) => {
    if (String(url).includes('/unread-count')) {
      return { ok: true, json: async () => ({ count: 3 }) };
    }
    return { ok: true, json: async () => ({ notifications: [] }) };
  });
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Trợ lý' });
  await new Promise(resolve => setTimeout(resolve, 0));
  const badge = document.getElementById('tksNotifBadge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '3');
  window.close();
});

test('click vào chuông mở dropdown và tải danh sách thông báo', async () => {
  const requestedUrls = [];
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Trợ lý' }, async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'role_change_decision', title: 'Đã duyệt', message: 'OK', isRead: false, relatedId: 'r1' }
      ] })
    };
  });
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Trợ lý' });
  await new Promise(resolve => setTimeout(resolve, 0));

  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  const dropdown = document.getElementById('tksNotifDropdown');
  assert.equal(dropdown.hidden, false);
  assert.ok(requestedUrls.some(u => u === '/api/notifications'));
  assert.ok(document.getElementById('tksNotifList').textContent.includes('Đã duyệt'));
  window.close();
});

test('Quản lý thấy nút Duyệt/Từ chối trên thông báo yêu cầu đổi vai trò chưa đọc, và click Duyệt gọi đúng API', async () => {
  const patchCalls = [];
  const { window, document } = createEnv({ id: 'm1', vaiTro: 'Quản lý' }, async (url, opts) => {
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (opts && opts.method === 'PATCH' && String(url).includes('/api/role-requests/')) {
      patchCalls.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ request: { id: 'r1', status: 'Đã duyệt' } }) };
    }
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'role_change_request', title: 'Yêu cầu mới', message: 'A yêu cầu đổi vai trò', isRead: false, relatedId: 'r1' }
      ] })
    };
  });
  window.TKSNav.renderNotifBell({ id: 'm1', vaiTro: 'Quản lý' });
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  const approveBtn = document.querySelector('.tks-notif-approve');
  assert.ok(approveBtn, 'phải có nút Duyệt cho thông báo yêu cầu đổi vai trò chưa đọc');
  approveBtn.click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(patchCalls.length, 1);
  assert.equal(patchCalls[0].url, '/api/role-requests/r1/status');
  assert.equal(patchCalls[0].body.status, 'Đã duyệt');
  window.close();
});

test('click vào thông báo có relatedType đánh dấu đã đọc rồi điều hướng đúng URL', async () => {
  const calledUrls = [];
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Quản lý' }, async (url, opts) => {
    calledUrls.push({ url: String(url), method: opts && opts.method });
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (opts && opts.method === 'PATCH' && String(url).includes('/read')) {
      return { ok: true, json: async () => ({ notification: { id: 'n1', isRead: true } }) };
    }
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'leave_request_created', title: 'Có nhân sự nghỉ phép', message: 'A nghỉ phép', isRead: false, relatedType: 'leaveRequest', relatedId: 'lv1' }
      ] })
    };
  });
  let navigatedTo = null;
  window.TKSNav._navigate = url => { navigatedTo = url; };
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Quản lý' });
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.querySelector('.tks-notif-item').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'PATCH' && c.url.includes('/api/notifications/n1/read')));
  assert.equal(navigatedTo, '/humanresources/#leave');
  window.close();
});

test('click icon xóa trên thông báo gọi DELETE /api/notifications/:id', async () => {
  const calledUrls = [];
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Trợ lý' }, async (url, opts) => {
    calledUrls.push({ url: String(url), method: opts && opts.method });
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (opts && opts.method === 'DELETE') return { ok: true, json: async () => ({ deleted: true }) };
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'role_change_decision', title: 'Đã duyệt', message: 'OK', isRead: false, relatedId: 'r1' }
      ] })
    };
  });
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Trợ lý' });
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.querySelector('.tks-notif-delete').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'DELETE' && c.url === '/api/notifications/n1'));
  window.close();
});

test('click "Xóa tất cả" gọi DELETE /api/notifications', async () => {
  const calledUrls = [];
  const { window, document } = createEnv({ id: 'u1', vaiTro: 'Trợ lý' }, async (url, opts) => {
    calledUrls.push({ url: String(url), method: opts && opts.method });
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (opts && opts.method === 'DELETE') return { ok: true, json: async () => ({ deleted: 1 }) };
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'role_change_decision', title: 'Đã duyệt', message: 'OK', isRead: false, relatedId: 'r1' }
      ] })
    };
  });
  window.TKSNav.renderNotifBell({ id: 'u1', vaiTro: 'Trợ lý' });
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.getElementById('tksNotifClearAll').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'DELETE' && c.url === '/api/notifications'));
  window.close();
});
