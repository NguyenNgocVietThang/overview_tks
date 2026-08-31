'use strict';
// Kiem tra nut chon co so tren thanh dieu huong (shared-nav.js):
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
    '<!doctype html><html><body><nav id="sidebar" data-tks-active-top="reports"></nav></body></html>',
    { runScripts: 'outside-only', url: 'https://tokosi.example/' }
  );
  dom.window.eval(navCode);
  return dom;
}

function renderFor(user) {
  const dom = loadNav();
  const { window } = dom;
  const sidebar = window.document.getElementById('sidebar');
  window.TKSNav.renderTopSidebar(sidebar, 'reports', user);
  return { window, sidebar };
}

test('tai khoan phu trach ca hai co so thay o chon co so, dung co so hien tai', () => {
  const { sidebar } = renderFor({
    vaiTro: 'Quản lý', hoTen: 'Quản trị', branches: ['Hà Nội', 'Sài Gòn'], branch: 'Sài Gòn'
  });

  const select = sidebar.querySelector('#tksBranchSelect');
  assert.ok(select, 'phai co o chon co so');
  assert.deepEqual([...select.options].map(o => o.value), ['Hà Nội', 'Sài Gòn']);
  assert.equal(select.value, 'Sài Gòn');
});

test('tai khoan mot co so chi thay nhan tinh, khong doi duoc co so', () => {
  const { sidebar } = renderFor({
    vaiTro: 'Kế toán', branches: ['Hà Nội'], branch: 'Hà Nội'
  });

  assert.equal(sidebar.querySelector('#tksBranchSelect'), null, 'khong duoc co o chon co so');
  const label = sidebar.querySelector('.tks-branch--fixed');
  assert.ok(label);
  assert.match(label.textContent, /Hà Nội/);
});

test('tai khoan chua duoc gan co so thay canh bao', () => {
  const { sidebar } = renderFor({ vaiTro: 'Lái xe', branches: [], branch: null });

  assert.equal(sidebar.querySelector('#tksBranchSelect'), null);
  assert.match(sidebar.querySelector('.tks-branch--none').textContent, /Chưa được gán cơ sở/);
});

test('doi co so goi POST /api/branch roi tai lai trang', async () => {
  const { window, sidebar } = renderFor({
    vaiTro: 'Quản lý', branches: ['Hà Nội', 'Sài Gòn'], branch: 'Hà Nội'
  });

  const calls = [];
  let reloaded = false;
  window.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ current: 'Sài Gòn' }) };
  };
  window.TKSNav._reload = () => { reloaded = true; };

  const select = sidebar.querySelector('#tksBranchSelect');
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

test('renderTopSidebar: kiem tra hien thi menu cho 3 vai tro moi', () => {
  const { sidebar: sbKho } = renderFor({ vaiTro: 'Nhân viên kho', branches: ['Hà Nội'], branch: 'Hà Nội' });
  assert.match(sbKho.innerHTML, /Quản lý vận chuyển/);
  assert.match(sbKho.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbKho.innerHTML, /Báo cáo tổng hợp/);

  const { sidebar: sbSale } = renderFor({ vaiTro: 'Nhân viên sale', branches: ['Hà Nội'], branch: 'Hà Nội' });
  assert.match(sbSale.innerHTML, /Quản lý vận chuyển/);
  assert.match(sbSale.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbSale.innerHTML, /Báo cáo tổng hợp/);

  const { sidebar: sbMuaHang } = renderFor({ vaiTro: 'Nhân viên mua hàng', branches: ['Hà Nội'], branch: 'Hà Nội' });
  assert.doesNotMatch(sbMuaHang.innerHTML, /Quản lý vận chuyển/);
  assert.match(sbMuaHang.innerHTML, /Quản lý nhân sự/);
  assert.doesNotMatch(sbMuaHang.innerHTML, /Báo cáo tổng hợp/);
});
