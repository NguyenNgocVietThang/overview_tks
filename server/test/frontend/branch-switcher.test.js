'use strict';
// Kiem tra nut chon co so tren Header (shared-nav.js):
//  - >= 2 co so  -> hien <select> de doi co so
//  - dung 1 co so -> hien nhan tinh (khong doi duoc)
//  - chua gan co so -> hien canh bao
// Day chi la lop UX; ranh gioi bao mat that su nam o branchMiddleware phia server.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const navPath = path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js');
const navCode = fs.readFileSync(navPath, 'utf8');

function loadNav() {
  const dom = new JSDOM(
    '<!doctype html><html><body><header><div class="status-line"><div id="accountChip"></div></div></header><nav id="sidebar" data-tks-active-top="reports"></nav></body></html>',
    { runScripts: 'outside-only', url: 'https://tokosi.example/' }
  );
  dom.window.eval(navCode);
  return dom;
}

const { defaultsForRole, resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

/** Tien ich: dung sidebar cho mot vai tro voi QUYEN MAC DINH cua vai tro do. */
function renderForRole(vaiTro) {
  return renderFor({
    vaiTro,
    branches: ['Hà Nội'],
    branch: 'Hà Nội',
    permissions: defaultsForRole(vaiTro),
    pageFeatures: PAGE_FEATURES
  });
}

function renderFor(user) {
  const dom = loadNav();
  const { window } = dom;
  const sidebar = window.document.getElementById('sidebar');
  window.TKSNav.renderTopSidebar(sidebar, 'reports', user);
  window.TKSNav.renderHeaderBranch(user);
  const header = window.document.querySelector('header');
  return { window, sidebar, header };
}

test('tai khoan phu trach ca hai co so thay o chon Ca hai tren header, dung lua chon hien tai', () => {
  const { sidebar, header } = renderFor({
    vaiTro: 'Quản lý', hoTen: 'Quản trị', branches: ['Hà Nội', 'Sài Gòn', 'Cả hai'], branch: 'Cả hai'
  });

  const select = header.querySelector('#tksBranchSelect');
  assert.ok(select, 'phai co o chon co so');
  assert.equal(sidebar.querySelector('.tks-branch'), null, 'khong con hien o chon co so trong sidebar');
  assert.deepEqual([...select.options].map(o => o.value), ['Hà Nội', 'Sài Gòn', 'Cả hai']);
  assert.equal(select.value, 'Cả hai');
});

test('tai khoan mot co so chi thay nhan tinh tren header, khong doi duoc co so', () => {
  const { header } = renderFor({
    vaiTro: 'Kế toán', branches: ['Hà Nội'], branch: 'Hà Nội'
  });

  assert.equal(header.querySelector('#tksBranchSelect'), null, 'khong duoc co o chon co so');
  const label = header.querySelector('.tks-branch--fixed');
  assert.ok(label);
  assert.match(label.textContent, /Hà Nội/);
});

test('tai khoan chua duoc gan co so thay canh bao tren header', () => {
  const { header } = renderFor({ vaiTro: 'Lái xe', branches: [], branch: null });

  assert.equal(header.querySelector('#tksBranchSelect'), null);
  assert.match(header.querySelector('.tks-branch--none').textContent, /Chưa được gán cơ sở/);
});

test('doi co so goi POST /api/branch roi tai lai trang', async () => {
  const { window, header } = renderFor({
    vaiTro: 'Quản lý', branches: ['Hà Nội', 'Sài Gòn'], branch: 'Hà Nội'
  });

  const calls = [];
  let reloaded = false;
  window.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ current: 'Sài Gòn' }) };
  };
  window.TKSNav._reload = () => { reloaded = true; };

  const select = header.querySelector('#tksBranchSelect');
  select.value = 'Sài Gòn';
  select.dispatchEvent(new window.Event('change'));
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/branch');
  assert.deepEqual(calls[0].body, { branch: 'Sài Gòn' });
  assert.equal(reloaded, true, 'phai tai lai trang de khong tron du lieu hai co so');
});

test('handleBranchError hien bang thong bao rieng cho hai ma loi co so', () => {
  const { window } = renderFor({ vaiTro: 'Quản lý', branches: ['Hà Nội'], branch: 'Hà Nội' });
  const TKSNav = window.TKSNav;

  assert.equal(TKSNav.handleBranchError({ code: 'BRANCH_UNASSIGNED', error: 'Chưa gán cơ sở.' }), true);
  assert.match(window.document.getElementById('tksBranchBanner').textContent, /Chưa gán cơ sở/);

  assert.equal(TKSNav.handleBranchError({ code: 'BRANCH_NOT_CONFIGURED', error: 'Chưa cấu hình.' }), true);
  assert.match(window.document.getElementById('tksBranchBanner').textContent, /Chưa cấu hình/);

  assert.equal(TKSNav.handleBranchError({ code: 'ORDER_NOT_FOUND' }), false, 'loi khac phai de trang tu xu ly');
  assert.equal(TKSNav.handleBranchError(null), false);
});

test('renderTopSidebar: menu dung theo QUYEN, khong theo vai tro cung', () => {
  const sbKho = renderForRole('Nhân viên kho').sidebar;
  assert.match(sbKho.innerHTML, /Quản lý đơn hàng/);
  assert.match(sbKho.innerHTML, /Vòng đời đơn hàng/);
  assert.doesNotMatch(sbKho.innerHTML, />Tổng quan<\/a>/);
  assert.match(sbKho.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbKho.innerHTML, /Báo cáo tổng hợp/);

  const sbSale = renderForRole('Nhân viên sale').sidebar;
  assert.match(sbSale.innerHTML, /Quản lý đơn hàng/);
  assert.match(sbSale.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbSale.innerHTML, /Báo cáo tổng hợp/);

  // Nhan vien marketing: quyen y het Nhan vien sale -> menu phai giong het.
  const sbMarketing = renderForRole('Nhân viên marketing').sidebar;
  assert.equal(sbMarketing.innerHTML, sbSale.innerHTML);

  // Nhan vien mua hang nay DUOC xem Vong doi don hang (truoc day UI giau nhung
  // API van cho) — mo giao dien theo API de hai ben khop nhau.
  const sbMuaHang = renderForRole('Nhân viên mua hàng').sidebar;
  assert.match(sbMuaHang.innerHTML, /Quản lý đơn hàng/);
  assert.match(sbMuaHang.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbMuaHang.innerHTML, /Báo cáo tổng hợp/);

  const sbQuanLy = renderForRole('Quản lý').sidebar;
  assert.match(sbQuanLy.innerHTML, /Báo cáo tổng hợp/);
  assert.match(sbQuanLy.innerHTML, /Quản lý người dùng/);
});

test('renderTopSidebar: ghi de quyen theo tai khoan an/hien dung muc menu', () => {
  // Tro ly bi chan rieng tab "Quan ly cong no".
  const { sidebar } = renderFor({
    vaiTro: 'Trợ lý', branches: ['Hà Nội'], branch: 'Hà Nội',
    permissions: resolvePermissions({ vaiTro: 'Trợ lý', featurePermissions: { 'reports.debt': false } }),
    pageFeatures: PAGE_FEATURES
  });
  assert.match(sidebar.innerHTML, /Báo cáo tổng hợp/);
  assert.match(sidebar.innerHTML, /Tổng quan/);
  assert.doesNotMatch(sidebar.innerHTML, /Quản lý công nợ/);

  // Ke toan duoc cap them quyen xem Tong quan -> nhom Bao cao hien ra.
  const { sidebar: sbKeToan } = renderFor({
    vaiTro: 'Kế toán', branches: ['Hà Nội'], branch: 'Hà Nội',
    permissions: resolvePermissions({ vaiTro: 'Kế toán', featurePermissions: { 'reports.overview': true } }),
    pageFeatures: PAGE_FEATURES
  });
  assert.match(sbKeToan.innerHTML, /Báo cáo tổng hợp/);
  assert.match(sbKeToan.innerHTML, /Tổng quan/);
  assert.doesNotMatch(sbKeToan.innerHTML, /Hóa đơn/);
});

test('renderTopSidebar: an ca NHOM khi khong con muc con nao duoc phep', () => {
  const { sidebar } = renderFor({
    vaiTro: 'Nhân viên kho', branches: ['Hà Nội'], branch: 'Hà Nội',
    permissions: resolvePermissions({
      vaiTro: 'Nhân viên kho',
      featurePermissions: { 'hr.rules': false, 'hr.employees': false, 'hr.leave': false }
    }),
    pageFeatures: PAGE_FEATURES
  });
  assert.doesNotMatch(sidebar.innerHTML, /Quản lý nhân sự/);
  assert.match(sidebar.innerHTML, /Quản lý đơn hàng/);
});
