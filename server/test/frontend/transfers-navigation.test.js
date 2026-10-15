'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const registry = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const navSource = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(publicDir, 'transfers/index.html'), 'utf8');
const pageJs = fs.readFileSync(path.join(publicDir, 'transfers/transfers.js'), 'utf8');

function sidebar(t, user, url = '/transfers/') {
  const dom = new JSDOM('<nav id="sidebar"></nav>', { runScripts: 'outside-only', url: 'https://tokosi.test' + url });
  t.after(() => dom.window.close());
  dom.window.eval(navSource);
  const mount = dom.window.document.getElementById('sidebar');
  dom.window.TKSNav.renderTopSidebar(mount, 'transfers', { ...user, permissions: registry.resolvePermissions(user) });
  return mount;
}

test('Yêu cầu chuyển tiền hiện cho Kế toán, Quản lý và Sale; active trên trang của nó', t => {
  for (const vaiTro of ['Kế toán', 'Quản lý', 'Nhân viên sale']) {
    const link = sidebar(t, { vaiTro }).querySelector('a[href="/transfers/"]');
    assert.ok(link, vaiTro);
    assert.equal(link.textContent, 'Yêu cầu chuyển tiền');
    assert.ok(link.classList.contains('has-active'));
  }
});

test('Yêu cầu chuyển tiền ẩn với Kho/Khách và khi Sale bị thu hồi quyền xem của mình', t => {
  for (const user of [{ vaiTro: 'Nhân viên kho' }, { vaiTro: 'Khách' }, { vaiTro: 'Nhân viên sale', featurePermissions: { 'transfers.own': false } }]) {
    assert.equal(sidebar(t, user).querySelector('a[href="/transfers/"]'), null, user.vaiTro);
  }
});

test('trang dùng table-controls, có bảng phân trang và hộp chi tiết; không tự dựng QR phía trình duyệt', () => {
  assert.match(pageHtml, /table-controls\.js/);
  assert.match(pageHtml, /data-tks-active-top="transfers"/);
  assert.match(pageHtml, /id="detailOverlay"/);
  // Mã VietQR luôn do máy chủ tạo từ dữ liệu DB (GET /api/transfers/:id/vietqr).
  assert.match(pageJs, /\/vietqr/);
  assert.doesNotMatch(pageJs, /img\.vietqr\.io|api\.vietqr\.io/);
});
