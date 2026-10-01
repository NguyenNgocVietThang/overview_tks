'use strict';

// Trang tai khoan: Quan ly THUONG (khong phai cap cao) mo dong cua Quan ly KHAC thi chi con sua
// ho ten/co so — an "Sua quyen", "Khoa tai khoan", khoa email/SDT va an doi mat khau (server
// accountPolicy.checkProtectedManager chan that; giao dien chi de khoi nham). Quan ly cap cao
// (isSeniorAdmin trong /api/auth/me) va thao tac tren nhan vien thuong / chinh minh khong bi anh huong.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'account', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

const USERS = [
  { id: 'ql-1', username: 'quanly1', hoTen: 'Quản lý 1', email: 'ql1@example.com', soDienThoai: '', vaiTro: 'Quản lý', coSo: 'Cả hai', trangThai: 'Đang hoạt động', ngayTao: '01/01/2026' },
  { id: 'ql-2', username: 'quanly2', hoTen: 'Quản lý 2', email: 'ql2@example.com', soDienThoai: '0912345678', vaiTro: 'Quản lý', coSo: 'Cả hai', trangThai: 'Đang hoạt động', ngayTao: '02/01/2026' },
  { id: 'nv-1', username: 'nhanvien1', hoTen: 'Nhân viên 1', email: 'nv1@example.com', soDienThoai: '', vaiTro: 'Nhân viên kho', coSo: 'Hà Nội', trangThai: 'Đang hoạt động', ngayTao: '03/01/2026' }
];

async function loadPage({ isSeniorAdmin }) {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/#users' });
  const { window } = dom;
  const permissions = ['account.profile', 'account.users', 'account.users.manage', 'account.permissions'];
  const me = { id: 'ql-1', username: 'quanly1', hoTen: 'Quản lý 1', vaiTro: 'Quản lý', isSeniorAdmin, permissions, branches: ['Hà Nội', 'Sài Gòn', 'Cả hai'] };
  window.TKSNav = {
    authGuard: async () => me,
    can: (...keys) => keys.some(key => permissions.includes(key)),
    renderTopSidebar() {},
    renderAccountChip() {},
    logout() {}
  };
  window.fetch = async url => {
    const target = String(url);
    if (target.includes('/api/admin/users')) return { ok: true, status: 200, json: async () => ({ users: USERS }) };
    if (target.includes('/api/admin/permissions/catalog')) return { ok: true, status: 200, json: async () => ({ groups: [], features: [], roleDefaults: {} }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim() && !script.includes('src='))
    .forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  return dom;
}

function actionLabels(window, userId) {
  window.openUserActionModal(userId);
  // Moi nut: <span>Nhan<small>goi y</small></span> — chi lay phan nhan (text node dau tien).
  return [...window.document.querySelectorAll('#userActionList .action-menu-item')]
    .map(button => button.querySelector('span').firstChild.textContent.trim());
}

test('Quản lý thường mở dòng Quản lý khác: chỉ còn "Sửa thông tin cá nhân" (ẩn Sửa quyền và Khóa tài khoản)', async () => {
  const dom = await loadPage({ isSeniorAdmin: false });
  const labels = actionLabels(dom.window, 'ql-2');
  assert.deepEqual(labels, ['Sửa thông tin cá nhân']);
  dom.window.close();
});

test('Quản lý thường với nhân viên thường: đủ Sửa quyền / Sửa thông tin / Khóa như cũ', async () => {
  const dom = await loadPage({ isSeniorAdmin: false });
  const labels = actionLabels(dom.window, 'nv-1');
  assert.deepEqual(labels, ['Sửa quyền', 'Sửa thông tin cá nhân', 'Khóa tài khoản']);
  dom.window.close();
});

test('Quản lý cấp cao mở dòng Quản lý khác: đủ mọi thao tác', async () => {
  const dom = await loadPage({ isSeniorAdmin: true });
  const labels = actionLabels(dom.window, 'ql-2');
  assert.deepEqual(labels, ['Sửa quyền', 'Sửa thông tin cá nhân', 'Khóa tài khoản']);
  dom.window.close();
});

test('Quản lý thường: hộp sửa thông tin của Quản lý khác khóa email/SĐT và ẩn đặt lại mật khẩu; tự sửa mình thì không', async () => {
  const dom = await loadPage({ isSeniorAdmin: false });
  const { window } = dom;
  const doc = window.document;
  const passwordGroupHidden = () => doc.getElementById('editNewPassword').closest('.form-group').style.display === 'none'
    && doc.getElementById('editConfirmPassword').closest('.form-group').style.display === 'none';

  window.openEditUserModal('ql-2');
  assert.equal(doc.getElementById('editEmail').disabled, true);
  assert.equal(doc.getElementById('editPhone').disabled, true);
  assert.equal(passwordGroupHidden(), true);
  assert.equal(doc.getElementById('editHoTen').disabled, false, 'van sua duoc ho ten');

  // Mo lai cho chinh minh (hoac nhan vien) phai tra ve trang thai binh thuong.
  window.openEditUserModal('ql-1');
  assert.equal(doc.getElementById('editEmail').disabled, false);
  assert.equal(passwordGroupHidden(), false);
  window.openEditUserModal('ql-2');
  window.openEditUserModal('nv-1');
  assert.equal(doc.getElementById('editPhone').disabled, false);
  assert.equal(passwordGroupHidden(), false);
  dom.window.close();
});

test('Quản lý cấp cao: hộp sửa thông tin của Quản lý khác vẫn đủ email/SĐT/mật khẩu', async () => {
  const dom = await loadPage({ isSeniorAdmin: true });
  const doc = dom.window.document;
  dom.window.openEditUserModal('ql-2');
  assert.equal(doc.getElementById('editEmail').disabled, false);
  assert.equal(doc.getElementById('editPhone').disabled, false);
  assert.notEqual(doc.getElementById('editNewPassword').closest('.form-group').style.display, 'none');
  dom.window.close();
});
