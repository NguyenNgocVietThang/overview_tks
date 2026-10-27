'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions } = require('../../auth/featureRegistry');

const nav = fs.readFileSync(path.join(__dirname, '../../public/shared/shared-nav.js'), 'utf8');

function sidebarFor(user, url = 'https://tokosi.test/vt-positions/#hn') {
  const dom = new JSDOM('<nav id="sidebar"></nav>', { url, runScripts: 'outside-only' });
  dom.window.eval(nav);
  user.permissions = resolvePermissions(user);
  dom.window.TKSNav.renderTopSidebar(dom.window.document.getElementById('sidebar'), 'stockLocations', user);
  return dom;
}

const vtTabs = dom => [...dom.window.document.querySelectorAll('[data-vt-position-tab]')];

test('Quản lý thấy VT Hà Nội / VT Sài Gòn cạnh hai mục Vị trí cũ; mục theo hash đang mở được đánh dấu', () => {
  const dom = sidebarFor({ vaiTro: 'Quản lý', branch: 'Cả hai' }, 'https://tokosi.test/vt-positions/#sg');
  const doc = dom.window.document;
  assert.deepEqual(vtTabs(dom).map(link => link.dataset.vtPositionTab), ['hn', 'sg']);
  assert.deepEqual(vtTabs(dom).map(link => link.textContent.trim()), ['VT Hà Nội', 'VT Sài Gòn']);
  assert.deepEqual(vtTabs(dom).map(link => link.getAttribute('href')), ['/vt-positions/#hn', '/vt-positions/#sg']);
  assert.deepEqual(vtTabs(dom).map(link => link.getAttribute('aria-current') === 'page' || link.classList.contains('active')), [false, true]);
  // Hai mục cũ vẫn còn và không bị đánh dấu khi đang ở trang mới.
  assert.deepEqual([...doc.querySelectorAll('[data-stock-location-tab]')].map(link => link.dataset.stockLocationTab), ['hn', 'sg']);
  dom.window.close();
});

test('VT chỉ hiện tab của cơ sở người dùng', () => {
  for (const [branch, expected] of [['Hà Nội', ['hn']], ['Sài Gòn', ['sg']]]) {
    const dom = sidebarFor({ vaiTro: 'Quản lý', branch });
    assert.deepEqual(vtTabs(dom).map(link => link.dataset.vtPositionTab), expected);
    dom.window.close();
  }
});

test('Nhân viên chưa được cấp quyền không thấy mục VT; cấp quyền xem thì thấy; Khách không bao giờ thấy', () => {
  const staff = sidebarFor({ vaiTro: 'Nhân viên kho', branch: 'Cả hai' }, 'https://tokosi.test/stock-locations/#hn');
  assert.equal(vtTabs(staff).length, 0);
  assert.ok(staff.window.document.querySelector('[data-stock-location-tab]'));
  staff.window.close();
  const granted = sidebarFor({ vaiTro: 'Nhân viên kho', branch: 'Cả hai', featurePermissions: { 'stockLocationsV2.view': true } });
  assert.equal(vtTabs(granted).length, 2);
  granted.window.close();
  const guest = sidebarFor({ vaiTro: 'Khách', branch: 'Cả hai', featurePermissions: { 'stockLocationsV2.view': true } });
  assert.equal(vtTabs(guest).length, 0);
  guest.window.close();
});
