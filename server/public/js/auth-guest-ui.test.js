'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}

test('login co nut dang ky rieng va giu nut Google', () => {
  const html = readPublic('login/index.html');
  assert.match(html, /href="\/register\/"/);
  assert.match(html, /googleBtnWrap/);
});

test('trang dang ky va trang van chuyen co script inline hop le', () => {
  for (const page of ['register/index.html', 'shipment/index.html', 'account/index.html']) {
    const html = readPublic(page);
    inlineScripts(html).forEach(script => assert.doesNotThrow(() => new Function(script)));
  }
});

test('trang van chuyen mac dinh an ket qua va chi co hai cot cong khai', () => {
  const html = readPublic('shipment/index.html');
  assert.match(html, /class="panel results-panel"/);
  assert.match(html, /<th>Mã hóa đơn<\/th><th>Trạng thái<\/th>/);
  assert.doesNotMatch(html, /SĐT khách|Tổng tiền hàng|Khách hàng<\/th>/);
});

test('shared nav an Bao cao tong hop voi Khach va chuyen Khach ve shipment khi vao trang cam', () => {
  const script = readPublic('shared/shared-nav.js');
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /user\.vaiTro === 'Khách'/);
  assert.match(script, /window\.location\.href = '\/shipment\/'/);
  assert.match(script, /\/account/);
});

test('logic route guard cho phep Khach vao /shipment va /account nhung chan cac trang khac', () => {
  function checkGuestAllowed(pathname) {
    const path = pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
    return (path === '/shipment' || path === '/account');
  }

  assert.equal(checkGuestAllowed('/shipment/'), true);
  assert.equal(checkGuestAllowed('/shipment'), true);
  assert.equal(checkGuestAllowed('/shipment/index.html'), true);
  assert.equal(checkGuestAllowed('/account/'), true);
  assert.equal(checkGuestAllowed('/account'), true);
  assert.equal(checkGuestAllowed('/account/index.html'), true);

  assert.equal(checkGuestAllowed('/'), false);
  assert.equal(checkGuestAllowed('/index.html'), false);
  assert.equal(checkGuestAllowed('/shipment/dispatch/'), false);
  assert.equal(checkGuestAllowed('/shipment/mobile/'), false);
});

test('shared nav logout co xac nhan confirm va khong de nut dang xuat roi rac tren topbar', () => {
  const script = readPublic('shared/shared-nav.js');
  assert.match(script, /confirm\(['"]Bạn có chắc chắn muốn đăng xuất\?['"]\)/);
  assert.doesNotMatch(script, /<button type="button" class="logout-btn-standalone" id="tksLogoutBtn">Đăng xuất<\/button>/);
  assert.match(script, /id="tksProfileLogout"/);
});

test('trang account co khoi va nut dang xuat trong tab ho so ca nhan', () => {
  const html = readPublic('account/index.html');
  assert.match(html, /id="btnAccountLogout"/);
  assert.match(html, /handleLogout\(\)/);
  assert.match(html, /function handleLogout/);
});

test('cac trang login, register, account co nut an hien mat khau password-toggle-btn', () => {
  for (const page of ['login/index.html', 'register/index.html', 'account/index.html']) {
    const html = readPublic(page);
    assert.match(html, /password-toggle-btn/);
    assert.match(html, /togglePassword/);
  }
});

test('trang register co tab va input dang ky bang so dien thoai', () => {
  const html = readPublic('register/index.html');
  assert.match(html, /id="tabRegisterPhone"/);
  assert.match(html, /id="fieldPhoneWrap"/);
  assert.match(html, /id="soDienThoai"/);
});

test('trang login co banner dem nguoc lockout 5 phut va modal reset mat khau OTP', () => {
  const html = readPublic('login/index.html');
  assert.match(html, /id="loginLockoutAlert"/);
  assert.match(html, /id="lockoutCountdown"/);
  assert.match(html, /id="forgotPasswordModal"/);
  assert.match(html, /Quên mật khẩu\?/);
  assert.match(html, /api\/auth\/forgot-password/);
});

test('trang account co khu vuc thong tin khoi phuc voi mat khau xac nhan', () => {
  const html = readPublic('account/index.html');
  assert.match(html, /Thông tin khôi phục/);
  assert.match(html, /id="profRecoveryEmail"/);
  assert.match(html, /id="profRecoveryPhone"/);
  assert.match(html, /id="recoveryConfirmPass"/);
  assert.match(html, /handleSaveRecovery/);
});

test('dong bo logo cong ty va favicon tren tat ca cac trang/tab', () => {
  const pages = [
    'index.html',
    'login/index.html',
    'register/index.html',
    'account/index.html',
    'shipment/index.html',
    'shipment/dispatch/index.html',
    'shipment/mobile/index.html'
  ];
  for (const page of pages) {
    const html = readPublic(page);
    assert.match(html, /<link rel="icon" type="image\/jpeg" href="\/Logo\.jpg">/, `Trang ${page} thieu favicon Logo.jpg`);
    assert.match(html, /<img [^>]*src="\/Logo\.jpg"/, `Trang ${page} thieu anh logo Logo.jpg`);
  }
});

