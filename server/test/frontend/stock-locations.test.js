'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { resolvePermissions, PAGE_FEATURES } = require('../../auth/featureRegistry');

const publicDir = path.join(__dirname, '../../public');
const html = fs.readFileSync(path.join(publicDir, 'stock-locations/index.html'), 'utf8');
const code = fs.readFileSync(path.join(publicDir, 'stock-locations/stock-locations.js'), 'utf8');
const nav = fs.readFileSync(path.join(publicDir, 'shared/shared-nav.js'), 'utf8');
const row = (code, name = 'Hàng') => ({ code, name, totalQuantity: '0', notes: 'Dòng 1\nDòng 2', location: '' });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function setup(t, { branch = 'Cả hai', hash = '', data = { HN: [row('001')], SG: [row('SG01')] }, fetcher } = {}) {
  const dom = new JSDOM(html, { url: 'https://tokosi.test/stock-locations/' + hash, runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const window = dom.window;
  window.eval(nav);
  const user = { vaiTro: 'Nhân viên kho', branch, permissions: resolvePermissions({ vaiTro: 'Nhân viên kho' }), pageFeatures: PAGE_FEATURES };
  window.TKSNav.authGuard = async () => { window.TKSNav.setPermissions(user); return user; };
  const calls = [];
  window.fetch = async (url, options) => {
    const target = new URL(url, window.location.href).searchParams.get('branch');
    calls.push({ target, options });
    return fetcher ? fetcher(target) : { ok: true, json: async () => ({ branch: target, rows: data[target] }) };
  };
  window.eval(code);
  await window.TKSStockLocations.init();
  return {
    window, calls, doc: window.document,
    changeTab: async tab => {
      const event = new Promise(resolve => window.addEventListener('hashchange', resolve, { once: true }));
      window.location.hash = tab;
      await event;
      await tick();
    }
  };
}

test('branch selection filters page and sidebar tabs and normalizes incompatible/unknown hashes', async t => {
  for (const [branch, hash, expected] of [['Hà Nội', '#sg', ['hn']], ['Sài Gòn', '#hn', ['sg']], ['Cả hai', '#invalid', ['hn', 'sg']]]) {
    const { doc, calls, window } = await setup(t, { branch, hash });
    assert.deepEqual([...doc.querySelectorAll('[data-location-tab]')].filter(link => !link.hidden).map(link => link.dataset.locationTab), expected);
    assert.deepEqual([...doc.querySelectorAll('[data-stock-location-tab]')].map(link => link.dataset.stockLocationTab), expected);
    assert.equal(window.location.hash, '#' + expected[0]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].target, expected[0].toUpperCase());
    assert.equal(calls[0].options.cache, 'no-store');
  }
});

test('search is accent/case insensitive, includes rows beyond first page, and ignores notes/position', async t => {
  const data = { HN: [...Array.from({ length: 104 }, (_, i) => row('MA' + i, 'Thùng')), row('0009', 'ĐÈN điện')], SG: [] };
  const { doc } = await setup(t, { data });
  assert.equal(doc.querySelectorAll('#locationRows tr').length, 100);
  doc.getElementById('locationNext').click();
  assert.match(doc.getElementById('locationPage').textContent, /Trang 2/);
  const input = doc.getElementById('locationSearch');
  input.value = 'den DIEN';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelectorAll('#locationRows tr').length, 1);
  assert.equal(doc.querySelector('#locationRows td').textContent, '0009');
  assert.match(doc.getElementById('locationPage').textContent, /Trang 1/);
  assert.equal(doc.querySelectorAll('#locationRows td')[3].textContent, 'Dòng 1\nDòng 2');
  input.value = 'Dòng 1';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  assert.equal(doc.querySelectorAll('#locationRows tr').length, 0);
  assert.match(doc.getElementById('locationStatus').textContent, /Không tìm thấy/);
});

test('tab queries/pages are independent, reopening reads fresh and does not poll', async t => {
  const data = { HN: Array.from({ length: 105 }, (_, i) => row('HN' + i, 'Đèn')), SG: [row('SG01', 'Ấm')] };
  const { doc, changeTab, calls } = await setup(t, { data });
  const input = doc.getElementById('locationSearch');
  input.value = 'den';
  input.dispatchEvent(new doc.defaultView.Event('input'));
  doc.getElementById('locationNext').click();
  await changeTab('sg');
  assert.equal(input.value, '');
  assert.equal(doc.querySelector('#locationRows td').textContent, 'SG01');
  await changeTab('hn');
  assert.equal(input.value, 'den');
  assert.match(doc.getElementById('locationPage').textContent, /Trang 2/);
  assert.deepEqual(calls.map(call => call.target), ['HN', 'SG', 'HN']);
  assert.doesNotMatch(code, /setInterval|setTimeout/);
  assert.equal(doc.querySelector('[data-export], .export-btn'), null);
  assert.doesNotMatch(doc.querySelector('main').textContent, /Xuất/);
});

test('late HN response cannot overwrite SG, and sheet content is rendered as text', async t => {
  let releaseHN;
  let hnCalls = 0;
  const { doc, changeTab, window } = await setup(t, { fetcher: async branch => {
    if (branch === 'HN' && ++hnCalls > 1) return new Promise(resolve => { releaseHN = resolve; });
    return { ok: true, json: async () => ({ branch, rows: [row(branch === 'SG' ? '<img src=x onerror=alert(1)>' : 'HN')] }) };
  } });
  doc.querySelector('[data-location-tab="hn"]').click();
  await tick();
  assert.match(doc.getElementById('locationStatus').textContent, /Đang tải/);
  await changeTab('sg');
  releaseHN({ ok: true, json: async () => ({ branch: 'HN', rows: [row('HN-LATE')] }) });
  await tick();
  assert.equal(window.location.hash, '#sg');
  assert.equal(doc.querySelector('#locationRows td').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(doc.querySelector('#locationRows img'), null);
});

test('empty data, failed source and inconsistent response are visibly distinct', async t => {
  const empty = await setup(t, { data: { HN: [], SG: [] } });
  assert.match(empty.doc.getElementById('locationStatus').textContent, /Chưa có dữ liệu/);
  for (const response of [
    { ok: false, json: async () => ({ error: 'Không tìm thấy sheet Vị trí HN.' }) },
    { ok: true, json: async () => ({ branch: 'SG', rows: [row('wrong')] }) }
  ]) {
    const result = await setup(t, { fetcher: async () => response });
    assert.equal(result.doc.getElementById('locationStatus').dataset.error, 'true');
    assert.equal(result.doc.querySelectorAll('#locationRows tr').length, 0);
  }
});

test('guest sidebar never exposes location tabs even with account override', () => {
  const dom = new JSDOM('<nav id="sidebar"></nav>', { url: 'https://tokosi.test/account/', runScripts: 'outside-only' });
  dom.window.eval(nav);
  const user = { vaiTro: 'Khách', branch: 'Cả hai', featurePermissions: { 'stockLocations.view': true } };
  user.permissions = resolvePermissions(user);
  dom.window.TKSNav.renderTopSidebar(dom.window.document.getElementById('sidebar'), 'account', user);
  assert.equal(dom.window.document.querySelector('[data-stock-location-tab]'), null);
  dom.window.close();
});

test('account permissions form disables location grant for guest and permits staff configuration', () => {
  const accountHtml = fs.readFileSync(path.join(publicDir, 'account/index.html'), 'utf8');
  const dom = new JSDOM(accountHtml, { url: 'https://tokosi.test/account/', runScripts: 'outside-only' });
  const window = dom.window;
  window.TKSNav = { can: () => true, authGuard: () => new Promise(() => {}) };
  for (const script of window.document.querySelectorAll('script:not([src])')) {
    if (script.textContent.trim()) window.eval(script.textContent);
  }
  const catalog = { groups: [{ key: 'stockLocations', label: 'Vị trí hàng' }], features: [{ key: 'stockLocations.view', groupKey: 'stockLocations', label: 'Xem vị trí hàng', forbiddenRoles: ['Khách'] }] };
  window.renderPermissionsForm(catalog, { username: 'guest', vaiTro: 'Khách', defaults: [], overrides: { 'stockLocations.view': true } });
  assert.equal(window.document.querySelector('#permGroups select').disabled, true);
  assert.equal(window.document.querySelector('#permGroups .perm-select'), null);
  window.renderPermissionsForm(catalog, { username: 'staff', vaiTro: 'Nhân viên kho', defaults: ['stockLocations.view'], overrides: {} });
  const select = window.document.querySelector('#permGroups .perm-select');
  assert.ok(select);
  assert.equal(select.disabled, false);
  assert.equal(select.value, 'default');
  dom.window.close();
});
