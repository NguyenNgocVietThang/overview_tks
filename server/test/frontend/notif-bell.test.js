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

test('header popovers highlight only the open control and Escape clears the bell state', async t => {
  const user = fakeUser('u1', 'Trợ lý');
  const { window, document } = createEnv(t, user, async () => ({
    ok: true, json: async () => ({ count: 2, notifications: [], requests: [] })
  }));
  window.TKSNav.renderLeaveCalendar(user);
  window.TKSNav.renderNotifBell(user);
  await new Promise(resolve => setTimeout(resolve, 0));
  const bell = document.getElementById('tksNotifBellBtn');
  const calendar = document.getElementById('tksLeaveCalBtn');
  calendar.click();
  assert.equal(calendar.getAttribute('aria-expanded'), 'true');
  bell.click();
  assert.equal(calendar.getAttribute('aria-expanded'), 'false');
  assert.equal(bell.getAttribute('aria-expanded'), 'true');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  assert.equal(document.getElementById('tksNotifDropdown').hidden, true);
  bell.click();
  calendar.click();
  assert.equal(bell.getAttribute('aria-expanded'), 'false');
  assert.equal(calendar.getAttribute('aria-expanded'), 'true');
  await new Promise(resolve => setTimeout(resolve, 0));
  document.body.click();
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

test('thong bao ORDER VAT cho sale: noi dung nhieu dong giu xuong dong, bam vao mo /vat-request/', async t => {
  const message = 'KH A · 014XOAN: 2. Đã khai chờ về\nKH B · 26DAQUAN: ngày về 28/10/2026';
  const { window, document } = createEnv(t, fakeUser('s1', 'Nhân viên sale'), async (url, opts) => {
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: 1 }) };
    if (opts && opts.method === 'PATCH') return { ok: true, json: async () => ({ notification: { id: 'n9', isRead: true } }) };
    return { ok: true, json: async () => ({ notifications: [
      { id: 'n9', type: 'vatRequestUpdated', title: 'Kế toán đã cập nhật 2 yêu cầu ORDER VAT', message, isRead: false, relatedType: 'vatRequest', relatedId: '12' }
    ] }) };
  });
  let navigatedTo = null;
  window.TKSNav._navigate = url => { navigatedTo = url; };
  window.TKSNav.renderNotifBell(fakeUser('s1', 'Nhân viên sale'));
  await new Promise(resolve => setTimeout(resolve, 0));
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.querySelector('.tks-notif-item-msg').textContent, message, 'giu ky tu xuong dong (CSS pre-line hien thanh nhieu dong)');
  document.querySelector('.tks-notif-item').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(navigatedTo, '/vat-request/');
  window.close();
});

test('shared.css: noi dung thong bao chuong xuong dong theo \\n (white-space:pre-line)', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../public/shared/shared.css'), 'utf8');
  assert.match(css, /\.tks-notif-item-msg\{[^}]*white-space:pre-line/);
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

const settleAll = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

function toastEnv(t, unread, extra = () => null) {
  const env = createEnv(t, fakeUser('u1', 'Trợ lý'), async (url, opts) => {
    const handled = extra(String(url), opts);
    if (handled) return handled;
    if (String(url).includes('/unread-count')) return { ok: true, json: async () => ({ count: unread.length }) };
    return { ok: true, json: async () => ({ notifications: unread }) };
  });
  // JSDOM mac dinh coi tab dang an (toast se bi hoan) — gia lap tab dang hien thi.
  Object.defineProperty(env.document, 'hidden', { configurable: true, get: () => false });
  return env;
}

test('toast góc màn hình: lần đầu chỉ ghi nhớ thông báo cũ, không bung toast', async t => {
  const unread = [{ id: 'n1', title: 'Cũ', message: 'x', isRead: false }];
  const { window, document } = toastEnv(t, unread);
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 0);
  assert.deepEqual(JSON.parse(window.localStorage.getItem('tksNotifToastSeen:u1')), ['n1']);
});

test('toast góc màn hình: chỉ bung thông báo chưa từng thấy, bấm vào đánh dấu đã đọc và điều hướng', async t => {
  const calls = [];
  const unread = [
    { id: 'n2', title: 'Kế toán đã cập nhật ORDER VAT', message: 'KH A', isRead: false, relatedType: 'vatRequest', relatedId: '12' },
    { id: 'n1', title: 'Cũ', message: 'x', isRead: false }
  ];
  const { window, document } = toastEnv(t, unread, (url, opts) => {
    calls.push({ url, method: opts && opts.method });
    return null;
  });
  window.localStorage.setItem('tksNotifToastSeen:u1', JSON.stringify(['n1']));
  let navigatedTo = null;
  window.TKSNav._navigate = url => { navigatedTo = url; };
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();

  const toasts = document.querySelectorAll('#tksNotifToasts .tks-notif-toast');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].querySelector('.tks-notif-toast-title').textContent, 'Kế toán đã cập nhật ORDER VAT');
  assert.ok(calls.some(c => c.url === '/api/notifications?unreadOnly=true'));
  assert.deepEqual(JSON.parse(window.localStorage.getItem('tksNotifToastSeen:u1')), ['n2', 'n1']);

  toasts[0].click();
  await settleAll();
  assert.ok(calls.some(c => c.method === 'PATCH' && c.url === '/api/notifications/n2/read'));
  assert.equal(navigatedTo, '/vat-request/');
});

test('toast góc màn hình: mở dropdown chuông thì đóng hết toast', async t => {
  const unread = [{ id: 'n2', title: 'Mới', message: '', isRead: false }];
  const { window, document } = toastEnv(t, unread);
  window.localStorage.setItem('tksNotifToastSeen:u1', '[]');
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 1);
  document.getElementById('tksNotifBellBtn').click();
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 0);
});

test('toast góc màn hình: quá 3 thông báo mới thì gom phần còn lại vào 1 toast tổng', async t => {
  const unread = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, title: 'T ' + id, message: '', isRead: false }));
  const { window, document } = toastEnv(t, unread);
  window.localStorage.setItem('tksNotifToastSeen:u1', '[]');
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  const titles = [...document.querySelectorAll('.tks-notif-toast-title')].map(el => el.textContent);
  assert.deepEqual(titles, ['T a', 'T b', 'T c', 'Bạn có thêm 2 thông báo mới']);
});

test('toast góc màn hình: tab đang ẩn thì hoãn, quay lại tab mới bung', async t => {
  const unread = [{ id: 'n2', title: 'Mới', message: '', isRead: false }];
  const { window, document } = toastEnv(t, unread);
  let hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  window.localStorage.setItem('tksNotifToastSeen:u1', '[]');
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 0);
  hidden = false;
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 1);
});

function installFakeNotification(window, permission) {
  const created = [];
  class FakeNotification {
    constructor(title, options) { this.title = title; this.options = options; this.closed = false; created.push(this); }
    close() { this.closed = true; }
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = () => { FakeNotification.permission = 'granted'; return Promise.resolve('granted'); };
  window.Notification = FakeNotification;
  return created;
}

test('thông báo màn hình: tab ẩn + đã cho phép thì bung Notification, không xếp hàng toast, bấm vào điều hướng', async t => {
  const calls = [];
  const unread = [{ id: 'n2', title: 'Kế toán đã cập nhật ORDER VAT', message: 'KH A', isRead: false, relatedType: 'vatRequest', relatedId: '12' }];
  const { window, document } = toastEnv(t, unread, (url, opts) => { calls.push({ url, method: opts && opts.method }); return null; });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  const created = installFakeNotification(window, 'granted');
  window.localStorage.setItem('tksNotifToastSeen:u1', '[]');
  let navigatedTo = null;
  window.TKSNav._navigate = url => { navigatedTo = url; };
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();

  assert.equal(created.length, 1);
  assert.equal(created[0].title, 'Kế toán đã cập nhật ORDER VAT');
  assert.equal(created[0].options.body, 'KH A');
  assert.equal(created[0].options.tag, 'tks-notif-n2');

  // Quay lai tab: da bung ra man hinh roi thi khong bung toast lap lai.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 0);

  created[0].onclick();
  await settleAll();
  assert.equal(created[0].closed, true);
  assert.ok(calls.some(c => c.method === 'PATCH' && c.url === '/api/notifications/n2/read'));
  assert.equal(navigatedTo, '/vat-request/');
});

test('thông báo màn hình: chưa cho phép thì không gọi Notification, vẫn hoãn toast tới khi quay lại tab', async t => {
  const unread = [{ id: 'n2', title: 'Mới', message: '', isRead: false }];
  const { window, document } = toastEnv(t, unread);
  let hidden = true;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  const created = installFakeNotification(window, 'default');
  window.localStorage.setItem('tksNotifToastSeen:u1', '[]');
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  assert.equal(created.length, 0);
  hidden = false;
  document.dispatchEvent(new window.Event('visibilitychange'));
  assert.equal(document.querySelectorAll('.tks-notif-toast').length, 1);
});

test('dropdown chuông: nút "Bật" xin quyền thông báo màn hình rồi ẩn dòng nhắc', async t => {
  const { window, document } = toastEnv(t, []);
  const created = installFakeNotification(window, 'default');
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  document.getElementById('tksNotifBellBtn').click();
  const prompt = document.getElementById('tksNotifDesktop');
  assert.equal(prompt.hidden, false);
  document.getElementById('tksNotifDesktopEnable').click();
  await settleAll();
  assert.equal(window.Notification.permission, 'granted');
  assert.equal(prompt.hidden, true);
  assert.equal(created.length, 1, 'bung 1 thong bao xac nhan da bat');
  assert.equal(document.getElementById('tksNotifDropdown').hidden, false, 'bam Bat khong dong dropdown');
});

test('dropdown chuông: Edge không bung hộp hỏi quyền (vẫn default) thì hướng dẫn bấm icon thanh địa chỉ, có nút Thử lại', async t => {
  const { window, document } = toastEnv(t, []);
  installFakeNotification(window, 'default');
  let resolvePermission;
  window.Notification.requestPermission = () => new Promise(resolve => { resolvePermission = resolve; });
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  document.getElementById('tksNotifBellBtn').click();
  document.getElementById('tksNotifDesktopEnable').click();
  const prompt = document.getElementById('tksNotifDesktop');
  assert.match(prompt.textContent, /thanh địa chỉ/, 'hien huong dan ngay khi dang cho');
  assert.equal(document.getElementById('tksNotifDropdown').hidden, false);
  resolvePermission('default');
  await settleAll();
  assert.match(prompt.textContent, /thanh địa chỉ/);
  assert.equal(document.getElementById('tksNotifDesktopEnable').textContent, 'Thử lại');
});

async function renderWithAsk(t, permission, setup = () => {}) {
  const env = toastEnv(t, []);
  const created = installFakeNotification(env.window, permission);
  setup(env);
  env.window.TKSNav.notifAskDelayMs = 0;
  env.window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  await settleAll();
  await new Promise(resolve => env.window.setTimeout(resolve, 20));
  return { ...env, created };
}

test('popup mời bật thông báo: tự hiện khi vào web, bấm "Bật thông báo" xin quyền rồi đóng', async t => {
  const { window, document, created } = await renderWithAsk(t, 'default');
  const popup = document.getElementById('tksNotifAsk');
  assert.ok(popup, 'phai tu hien popup, khong can bam chuong');
  assert.equal(document.getElementById('tksNotifDropdown').hidden, true);
  popup.querySelector('.tks-notif-ask-enable').click();
  await settleAll();
  assert.equal(window.Notification.permission, 'granted');
  assert.equal(document.getElementById('tksNotifAsk'), null);
  assert.equal(created.length, 1, 'bung thong bao xac nhan');
});

test('popup mời bật thông báo: Edge không bung hộp (vẫn default) thì giữ popup, hướng dẫn thanh địa chỉ + nút Thử lại', async t => {
  const { window, document } = await renderWithAsk(t, 'default', ({ window }) => {
    window.Notification.requestPermission = () => Promise.resolve('default');
  });
  document.querySelector('.tks-notif-ask-enable').click();
  await settleAll();
  const popup = document.getElementById('tksNotifAsk');
  assert.ok(popup);
  assert.match(popup.textContent, /thanh địa chỉ/);
  assert.equal(popup.querySelector('.tks-notif-ask-enable').textContent, 'Thử lại');
  assert.equal(window.Notification.permission, 'default');
});

test('popup mời bật thông báo: chỉ hỏi một lần, "Để sau" hay đã từng hiện thì không hỏi lại (kể cả tài khoản khác)', async t => {
  const { window, document } = await renderWithAsk(t, 'default');
  assert.ok(window.localStorage.getItem('tksNotifDesktopAsked'), 'ghi nho ngay khi hien popup');
  document.querySelector('.tks-notif-ask-later').click();
  assert.equal(document.getElementById('tksNotifAsk'), null);
  await new Promise(resolve => window.setTimeout(resolve, 1150));
  assert.equal(document.getElementById('tksNotifAsk'), null, 'khong tu hien lai');

  const again = await renderWithAsk(t, 'default', ({ window }) => {
    window.localStorage.setItem('tksNotifDesktopAsked', String(Date.now() - 365 * 86400000));
  });
  assert.equal(again.document.getElementById('tksNotifAsk'), null, 'da hoi tu truoc: khong hoi lai');
});

test('popup mời bật thông báo: không hiện khi đã cho phép, đã chặn, hoặc trên điện thoại', async t => {
  for (const permission of ['granted', 'denied']) {
    const { document } = await renderWithAsk(t, permission);
    assert.equal(document.getElementById('tksNotifAsk'), null, permission);
  }
  const mobile = await renderWithAsk(t, 'default', ({ window }) => {
    Object.defineProperty(window.navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Linux; Android 14) Mobile Safari' });
  });
  assert.equal(mobile.document.getElementById('tksNotifAsk'), null, 'dien thoai');
});

test('dropdown chuông: đã chặn quyền thì hướng dẫn mở lại, không có nút Bật; trình duyệt không hỗ trợ thì ẩn hẳn', async t => {
  const { window, document } = toastEnv(t, []);
  window.TKSNav.renderNotifBell(fakeUser('u1', 'Trợ lý'));
  document.getElementById('tksNotifBellBtn').click();
  assert.equal(document.getElementById('tksNotifDesktop').hidden, true, 'JSDOM khong co Notification');
  document.getElementById('tksNotifBellBtn').click();
  installFakeNotification(window, 'denied');
  document.getElementById('tksNotifBellBtn').click();
  const prompt = document.getElementById('tksNotifDesktop');
  assert.equal(prompt.hidden, false);
  assert.equal(document.getElementById('tksNotifDesktopEnable'), null);
  assert.match(prompt.textContent, /bị chặn/);
});

test('shared.css: toast thong bao nam goc duoi trai, mobile len mep tren tran 2 ben 16px', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../public/shared/shared.css'), 'utf8');
  assert.match(css, /\.tks-notif-toasts\{[^}]*position:fixed;[^}]*left:20px;[^}]*bottom:20px/);
  assert.match(css, /@media \(max-width:640px\)\{\s*\.tks-notif-toasts\{ left:16px; right:16px; top:12px; bottom:auto;/);
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
