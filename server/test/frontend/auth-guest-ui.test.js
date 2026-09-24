'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'public', relativePath), 'utf8');
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}

function loadPageWithSharedStyles(relativePath) {
  const sharedCss = readPublic('shared/shared.css');
  const html = readPublic(relativePath).replace(
    /<link[^>]+shared\.css[^>]*>/i,
    `<style>${sharedCss}</style>`
  );
  return new JSDOM(html, { runScripts: 'outside-only' });
}

test('login co nut dang ky rieng va giu nut Google', () => {
  const html = readPublic('login/index.html');
  assert.match(html, /href="\/register\/"/);
  assert.match(html, /googleBtnWrap/);
});

test('trang dang ky va trang account co script inline hop le', () => {
  for (const page of ['register/index.html', 'account/index.html']) {
    const html = readPublic(page);
    inlineScripts(html).forEach(script => assert.doesNotThrow(() => new Function(script)));
  }
});

// shared-nav.js khong con mang vai tro nao: menu va dieu huong deu dua tren
// `permissions` + `pageFeatures` do /api/auth/me tra ve (nguon:
// server/auth/featureRegistry.js). Cac test duoi day nap script that trong
// jsdom thay vi do chuoi nguon.
const { PAGE_FEATURES } = require('../../auth/featureRegistry');
const { defaultsForRole } = require('../../auth/featureRegistry');

function loadSharedNav(url) {
  const dom = new JSDOM(
    '<html><body><header><div id="accountChip"></div></header><div id="sidebar" data-tks-active-top="reports"></div></body></html>',
    { runScripts: 'outside-only', url }
  );
  dom.window.eval(readPublic('shared/shared-nav.js'));
  return dom;
}

test('shared nav khong con mang vai tro cung — menu dung tu danh sach quyen', () => {
  const script = readPublic('shared/shared-nav.js');
  assert.doesNotThrow(() => new Function(script));
  assert.doesNotMatch(script, /NO_REPORTS_ROLES/);
  assert.doesNotMatch(script, /NO_SHIPMENT_ROLES/);
  assert.doesNotMatch(script, /'Nhân viên mua hàng'/);
  assert.match(script, /TKSNav\.can/);
});

test('sidebar cua Khach: chi con tra cuu don hang va ho so ca nhan', () => {
  const dom = loadSharedNav('https://tokosi.example/account/');
  const { window } = dom;
  const sidebar = window.document.getElementById('sidebar');
  window.TKSNav.renderTopSidebar(sidebar, 'account', {
    vaiTro: 'Khách',
    permissions: defaultsForRole('Khách'),
    pageFeatures: PAGE_FEATURES
  });

  assert.doesNotMatch(sidebar.innerHTML, /Báo cáo tổng hợp/);
  assert.doesNotMatch(sidebar.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sidebar.innerHTML, /Quản lý người dùng/);
  assert.match(sidebar.innerHTML, /Vòng đời đơn hàng/);
  assert.match(sidebar.innerHTML, /Quản lý hồ sơ/);
});

test('bang PAGE_FEATURES: Khach chi vao duoc trang tra cuu don va trang tai khoan', () => {
  const dom = loadSharedNav('https://tokosi.example/account/');
  const { window } = dom;
  window.TKSNav.setPermissions({ permissions: defaultsForRole('Khách'), pageFeatures: PAGE_FEATURES });

  const allowed = pathname => {
    const rule = window.TKSNav._pageRuleFor(pathname);
    return !rule || window.TKSNav.can(rule.anyOf);
  };

  assert.equal(allowed('/account/'), true);
  assert.equal(allowed('/account/index.html'), true);
  assert.equal(allowed('/shipment/lifecycle/'), true);

  assert.equal(allowed('/'), false);
  assert.equal(allowed('/index.html'), false);
  assert.equal(allowed('/reports/'), false);
  assert.equal(allowed('/humanresources/'), false);

  assert.equal(window.TKSNav._landingPath(), '/shipment/lifecycle/');
});

test('trang bao cao duoc phuc vu o ca "/" lan "/reports/" nen ca hai cung mot quy tac quyen', () => {
  const dom = loadSharedNav('https://tokosi.example/');
  const { window } = dom;
  window.TKSNav.setPermissions({ permissions: defaultsForRole('Kế toán'), pageFeatures: PAGE_FEATURES });

  for (const pathname of ['/', '/index.html', '/reports', '/reports/']) {
    const rule = window.TKSNav._pageRuleFor(pathname);
    assert.ok(rule, `${pathname} phai co quy tac quyen`);
    assert.equal(rule.path, '/reports', pathname);
    assert.equal(window.TKSNav.can(rule.anyOf), false, `Kế toán khong duoc xem ${pathname}`);
  }

  for (const pathname of ['/account', '/humanresources', '/shipment/lifecycle']) {
    assert.notEqual(window.TKSNav._pageRuleFor(pathname).path, '/reports', pathname);
  }

  // Tro ly co quyen bao cao -> vao duoc chinh trang do.
  window.TKSNav.setPermissions({ permissions: defaultsForRole('Trợ lý'), pageFeatures: PAGE_FEATURES });
  assert.equal(window.TKSNav.can(window.TKSNav._pageRuleFor('/').anyOf), true);
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

test('trang register chi cho phep dang ky bang email', () => {
  const html = readPublic('register/index.html');
  const dom = new JSDOM(html);
  const document = dom.window.document;
  assert.ok(document.querySelector('#email'));
  assert.equal(document.querySelector('#tabRegisterPhone'), null);
  assert.equal(document.querySelector('#fieldPhoneWrap'), null);
  assert.equal(document.querySelector('#soDienThoai'), null);
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
  assert.match(html, /id="recoveryConfirmPass"/);
  assert.match(html, /handleSaveRecovery/);
});

test('dong bo logo cong ty va favicon tren tat ca cac trang/tab', () => {
  const pages = [
    'index.html',
    'login/index.html',
    'register/index.html',
    'account/index.html'
  ];
  for (const page of pages) {
    const html = readPublic(page);
    assert.match(html, /<link rel="icon" type="image\/jpeg" href="\/Logo\.jpg">/, `Trang ${page} thieu favicon Logo.jpg`);
    assert.match(html, /<img [^>]*src="\/Logo\.jpg"/, `Trang ${page} thieu anh logo Logo.jpg`);
  }
});

test('header dung chung co cung kich thuoc dieu khien tren bon tab chinh', () => {
  const pages = ['index.html', 'humanresources/index.html', 'account/index.html'];

  for (const page of pages) {
    const dom = loadPageWithSharedStyles(page);
    const { document } = dom.window;
    const profile = document.createElement('button');
    profile.className = 'profile-trigger';
    document.querySelector('#accountChip').appendChild(profile);

    const themeStyle = dom.window.getComputedStyle(document.querySelector('.theme-toggle'));
    const profileStyle = dom.window.getComputedStyle(profile);
    const brandStyle = dom.window.getComputedStyle(document.querySelector('.brand-mark'));

    assert.equal(themeStyle.minHeight, '40px', `${page}: nut theme sai chieu cao`);
    assert.equal(themeStyle.borderRadius, '9999px', `${page}: nut theme sai bo goc`);
    assert.equal(profileStyle.minHeight, '40px', `${page}: nut ho so sai chieu cao`);
    assert.equal(profileStyle.borderRadius, '10px', `${page}: nut ho so sai bo goc`);
    assert.equal(brandStyle.width, '44px', `${page}: logo sai chieu rong`);
    assert.equal(brandStyle.height, '44px', `${page}: logo sai chieu cao`);
    assert.equal(brandStyle.borderRadius, '12px', `${page}: logo sai bo goc`);
  }
});

test('ba tab chinh cung khai bao viewport de header responsive giong nhau', () => {
  const pages = ['index.html', 'humanresources/index.html', 'account/index.html'];

  for (const page of pages) {
    const dom = new JSDOM(readPublic(page));
    const viewport = dom.window.document.querySelector('meta[name="viewport"]');
    assert.ok(viewport, `${page}: thieu viewport meta`);
    assert.equal(viewport.getAttribute('content'), 'width=device-width, initial-scale=1');
  }
});

