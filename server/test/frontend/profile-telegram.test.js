'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../../public', file), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const initial = { hoTen: 'A', email: 'a@example.com', telegramId: '9007199254740993', telegramEditable: true };

for (const surface of ['account', 'modal']) {
  test(`${surface} profile (Quan ly) loads, updates and clears the DB Telegram ID as a string`, async () => {
    const posted = [];
    const html = surface === 'account' ? read('account/index.html') : '<html><head></head><body><div id="accountChip"></div></body></html>';
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/' });
    const { window } = dom;
    try {
      window.fetch = async (url, options = {}) => {
        if (url === '/api/auth/profile' && options.method === 'POST') {
          const body = JSON.parse(options.body);
          posted.push(body);
          return { ok: true, json: async () => body };
        }
        return { ok: true, json: async () => ({ ...initial }) };
      };
      if (surface === 'account') {
        window.TKSNav = { authGuard: async () => ({ id: 'u1' }), renderTopSidebar() {}, renderAccountChip() {} };
        for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
          if (match[1].trim()) window.eval(match[1]);
        }
        window.dispatchEvent(new window.Event('DOMContentLoaded'));
      } else {
        window.eval(read('shared/shared-nav.js'));
        window.TKSNav.openProfileModal();
      }
      await flush();
      const field = window.document.getElementById(surface === 'account' ? 'profTelegramId' : 'tksProfileTelegramId');
      assert.ok(field, 'profile must expose an editable Telegram ID field');
      assert.equal(field.value, '9007199254740993');
      assert.equal(field.disabled, false);
      assert.equal(field.type, 'text');
      const save = () => surface === 'account' ? window.handleSaveProfile({ preventDefault() {} }) : window.document.getElementById('tksProfileSave').click();
      field.value = ' 6205968899 ';
      save();
      await flush();
      // Không gửi email nữa (đổi email đi qua OTP, xem profile-email-change.test.js).
      assert.deepEqual(posted[0], { hoTen: 'A', telegramId: '6205968899' });
      field.value = '';
      save();
      await flush();
      assert.equal(posted[1].telegramId, '');
    } finally { window.close(); }
  });
}

for (const surface of ['account', 'modal']) {
  test(`${surface} profile: nhan vien thay o ID Telegram bi khoa, khong gui telegramId khi luu`, async () => {
    const posted = [];
    const locked = { ...initial, telegramEditable: false };
    const html = surface === 'account' ? read('account/index.html') : '<html><head></head><body><div id="accountChip"></div></body></html>';
    const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/' });
    const { window } = dom;
    try {
      window.fetch = async (url, options = {}) => {
        if (url === '/api/auth/profile' && options.method === 'POST') {
          const body = JSON.parse(options.body);
          posted.push(body);
          return { ok: true, json: async () => ({ ...locked, ...body }) };
        }
        return { ok: true, json: async () => ({ ...locked }) };
      };
      if (surface === 'account') {
        window.TKSNav = { authGuard: async () => ({ id: 'u1' }), renderTopSidebar() {}, renderAccountChip() {} };
        for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
          if (match[1].trim()) window.eval(match[1]);
        }
        window.dispatchEvent(new window.Event('DOMContentLoaded'));
      } else {
        window.eval(read('shared/shared-nav.js'));
        window.TKSNav.openProfileModal();
      }
      await flush();
      const field = window.document.getElementById(surface === 'account' ? 'profTelegramId' : 'tksProfileTelegramId');
      const hint = window.document.getElementById(surface === 'account' ? 'profTelegramIdHint' : 'tksProfileTelegramIdHint');
      assert.equal(field.value, '9007199254740993', 'van hien ID hien tai');
      assert.equal(field.disabled, true);
      assert.match(hint.textContent, /Chỉ Quản lý/);
      if (surface === 'account') window.handleSaveProfile({ preventDefault() {} });
      else window.document.getElementById('tksProfileSave').click();
      await flush();
      assert.deepEqual(posted[0], { hoTen: 'A' });
    } finally { window.close(); }
  });
}
