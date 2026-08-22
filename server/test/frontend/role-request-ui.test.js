'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'account', 'index.html');

function loadPage(fetchImpl) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/' });
  const { window } = dom;
  window.TKSNav = {
    authGuard: async () => ({ id: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A', vaiTro: 'Trợ lý' }),
    renderTopSidebar() {},
    renderAccountChip() {},
    logout() {}
  };
  window.fetch = fetchImpl;
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(m => m[1]).filter(s => s.trim() && !s.includes('src='));
  inlineScripts.forEach(script => window.eval(script));
  return dom;
}

test('nút "Yêu cầu đổi vai trò" mở modal', async () => {
  const dom = loadPage(async (url) => {
    if (String(url).includes('/api/auth/profile')) {
      return { ok: true, json: async () => ({ hoTen: 'Nguyễn Văn A', username: 'nva', vaiTro: 'Trợ lý', coSo: '' }) };
    }
    if (String(url).includes('/api/role-requests')) {
      return { ok: true, json: async () => ({ requests: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  const { window } = dom;
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));

  window.openRoleRequestModal();
  const modal = window.document.getElementById('roleRequestModal');
  assert.equal(modal.hidden, false);
  dom.window.close();
});

test('gửi form yêu cầu đổi vai trò gọi đúng POST /api/role-requests với body chính xác', async () => {
  const postedBodies = [];
  const dom = loadPage(async (url, opts) => {
    if (String(url).includes('/api/auth/profile')) {
      return { ok: true, json: async () => ({ hoTen: 'Nguyễn Văn A', username: 'nva', vaiTro: 'Trợ lý', coSo: '' }) };
    }
    if (opts && opts.method === 'POST' && String(url) === '/api/role-requests') {
      postedBodies.push(JSON.parse(opts.body));
      return { ok: true, json: async () => ({ request: { id: 'r1', status: 'Chờ duyệt', requestedRole: 'Kế toán' } }) };
    }
    if (String(url).includes('/api/role-requests')) {
      return { ok: true, json: async () => ({ requests: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
  const { window } = dom;
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));

  window.document.getElementById('roleRequestTarget').value = 'Kế toán';
  window.document.getElementById('roleRequestReason').value = 'Muốn chuyển bộ phận';
  window.handleSubmitRoleRequest({ preventDefault(){} });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0].requestedRole, 'Kế toán');
  assert.equal(postedBodies[0].reason, 'Muốn chuyển bộ phận');
  dom.window.close();
});
