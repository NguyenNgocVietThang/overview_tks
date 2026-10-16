'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// Nut Duyet/Tu choi tren thong bao doi vai tro gac bang quyen
// 'account.users.manage' (khong con kiem tra vaiTro === 'Quản lý') — user gia
// phai mang danh sach quyen giong /api/auth/me tra ve.
const { defaultsForRole } = require('../../auth/featureRegistry');
function fakeUser(id, vaiTro) {
  return { id, vaiTro, permissions: defaultsForRole(vaiTro) };
}

const MODULE_PATH = path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js');
const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');

function createEnv(t, user, fetchImpl) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
      '<div class="status-line">' +
        '<div class="account-chip" id="accountChip"></div>' +
      '</div>' +
    '</body></html>',
    { runScripts: 'dangerously', url: 'https://tokosi.example/humanresources/' }
  );
  const { window } = dom;
  t.after(() => window.close());
  window.fetch = fetchImpl;
  window.eval(moduleSource);
  return { dom, window, document: window.document };
}

test('renderNotifBell đặt chuông sau chip và lịch kể cả khi chuông được render trước', t => {
  const { window, document } = createEnv(t, fakeUser('u1', 'Trợ lý'), async () => ({
    ok: true, json: async () => ({ count: 0 })
  }));
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  window.TKSNav.renderLeaveCalendar(fakeUser('u1', 'Trợ lý'));
  const bell = document.getElementById('tksNotifBell');
  assert.ok(bell, 'phải có phần tử #tksNotifBell');
  assert.deepEqual([...document.querySelector('.status-line').children].map(el => el.id),
    ['accountChip', 'tksLeaveCal', 'tksNotifBell']);
  window.close();
});

test('renderNotifBell hiển thị badge đúng số thông báo chưa đọc', async t => {
  const { window, document } = createEnv(t, fakeUser('u1', 'Trợ lý'), async (url) => {
    if (String(url).includes('/unread-count')) {
      return { ok: true, json: async () => ({ count: 3 }) };
    }
    return { ok: true, json: async () => ({ notifications: [] }) };
  });
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const badge = document.getElementById('tksNotifBadge');
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '3');
  window.close();
});

test('click vào chuông mở dropdown và tải danh sách thông báo', async t => {
  const requestedUrls = [];
  const { window, document } = createEnv(t, fakeUser('u1', 'Trợ lý'), async (url) => {
    requestedUrls.push(String(url));
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'role_change_decision', title: 'Đã duyệt', message: 'OK', isRead: false, relatedId: 'r1' }
      ] })
    };
  });
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await new Promise(resolve => setTimeout(resolve, 0));

  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  const dropdown = document.getElementById('tksNotifDropdown');
  assert.equal(dropdown.hidden, false);
  assert.ok(requestedUrls.some(u => u === '/api/notifications'));
  assert.ok(document.getElementById('tksNotifList').textContent.includes('Đã duyệt'));
  window.close();
});

test('Quản lý thấy nút Duyệt/Từ chối trên thông báo yêu cầu đổi vai trò chưa đọc, và click Duyệt gọi đúng API', async t => {
  const patchCalls = [];
  const { window, document } = createEnv(t, fakeUser('m1', 'Quản lý'), async (url, opts) => {
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
  window.TKSNav.renderNotifBell(fakeUser('m1', 'Quản lý'));
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

test('người có quyền quản lý nghỉ phép duyệt đơn trực tiếp từ thông báo', async t => {
  const patchCalls = [];
  const { window, document } = createEnv(t, fakeUser('m1', 'Quản lý'), async (url, opts) => {
    const method = opts && opts.method;
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (String(url) === '/api/hr/leave-requests/lv1') return { ok: true, json: async () => ({ request: { id: 'lv1', canManage: true, decision_version: '2026-10-05T01:00:00.000Z' } }) };
    if (method === 'PATCH') {
      patchCalls.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
      return { ok: true, json: async () => ({ request: { id: 'lv1', trang_thai: 'Đã duyệt' } }) };
    }
    return {
      ok: true,
      json: async () => ({ notifications: [
        { id: 'n1', type: 'leave_request_created', title: 'Có nhân sự nghỉ phép', message: 'A nghỉ phép', isRead: false, relatedType: 'leaveRequest', relatedId: 'lv1' }
      ] })
    };
  });

  window.TKSNav.renderNotifBell(fakeUser('m1', 'Quản lý'));
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.querySelector('.tks-notif-approve').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(patchCalls[0].url, '/api/hr/leave-requests/lv1/status');
  assert.deepEqual(patchCalls[0].body, { status: 'Đã duyệt', expectedVersion: '2026-10-05T01:00:00.000Z' });
  assert.equal(patchCalls[1].url, '/api/notifications/n1/read');
  window.close();
});

test('click vào thông báo có relatedType đánh dấu đã đọc rồi điều hướng đúng URL', async t => {
  const calledUrls = [];
  const { window, document } = createEnv(t, fakeUser('u1', 'Quản lý'), async (url, opts) => {
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
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Quản lý'));
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.querySelector('.tks-notif-item').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'PATCH' && c.url.includes('/api/notifications/n1/read')));
  assert.equal(navigatedTo, '/humanresources/#leave');
  window.close();
});

test('click icon xóa trên thông báo gọi DELETE /api/notifications/:id', async t => {
  const calledUrls = [];
  const { window, document } = createEnv(t, fakeUser('u1', 'Trợ lý'), async (url, opts) => {
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
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.querySelector('.tks-notif-delete').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'DELETE' && c.url === '/api/notifications/n1'));
  window.close();
});

test('click "Xóa tất cả" gọi DELETE /api/notifications', async t => {
  const calledUrls = [];
  const { window, document } = createEnv(t, fakeUser('u1', 'Trợ lý'), async (url, opts) => {
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
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  document.getElementById('tksNotifClearAll').click();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.ok(calledUrls.some(c => c.method === 'DELETE' && c.url === '/api/notifications'));
  window.close();
});


test('leave notification hides quick decisions outside current persisted approval scope', async t => {
  const { window, document } = createEnv(t, fakeUser('m1', 'Quản lý'), async url => ({ ok: true, json: async () => String(url).includes('/api/hr/leave-requests/') ? { request: { canManage: false, decision_version: 'version' } } : { notifications: [{ id: 'n1', type: 'leave_request_created', relatedType: 'leaveRequest', relatedId: 'lv1' }] } }));
  try {
    window.TKSNav.renderNotifBell(fakeUser('m1', 'Quản lý'));
    document.getElementById('tksNotifBellBtn').click();
    for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('.tks-notif-approve'), null);
    assert.ok(document.querySelector('.tks-notif-item.clickable'));
  } finally { window.close(); }
});

test('manager promotion notification collects explicit department selection before submitting approval', async t => {
  const patches = [];
  const { window, document } = createEnv(t, fakeUser('m1', 'Quản lý'), async (url, options = {}) => {
    if (options.method === 'PATCH') { patches.push({ url, body: options.body && JSON.parse(options.body) }); return { ok: true, json: async () => ({}) }; }
    if (String(url).includes('/permissions/catalog')) return { ok: true, json: async () => ({ departments: ['KHO', 'KẾ TOÁN'] }) };
    if (String(url).includes('/api/role-requests/')) return { ok: true, json: async () => ({ request: { requestedRole: 'Quản lý' } }) };
    return { ok: true, json: async () => ({ notifications: [{ id: 'n1', type: 'role_change_request', relatedId: 'r1' }] }) };
  });
  try {
    window.TKSNav.renderNotifBell(fakeUser('m1', 'Quản lý'));
    document.getElementById('tksNotifBellBtn').click();
    const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };
    await settle();
    document.querySelector('.tks-notif-approve').click();
    await settle();
    assert.equal(patches.length, 0);
    const selection = document.querySelector('.tks-notif-departments input[value=KHO]');
    assert.ok(selection);
    document.querySelector('.tks-notif-approve').click();
    await settle();
    assert.equal(patches.length, 0);
    selection.checked = true;
    document.querySelector('.tks-notif-approve').click();
    await settle();
    assert.deepEqual(patches[0].body, { status: 'Đã duyệt', leaveApprovalDepartments: ['KHO'] });
  } finally { window.close(); }
});
