'use strict';
/**
 * Trang Tài khoản: email không còn đổi qua "Lưu thay đổi" (POST /api/auth/profile).
 * - TK nhân sự (hrManaged): ô email chỉ đọc + gợi ý liên hệ Quản lý, không có nút "Đổi email".
 * - TK thường: nút "Đổi email" mở hộp 2 bước contact-change -> verify (OTP).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../../public/account/index.html'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const base = { hoTen: 'A', email: 'a@example.com', telegramId: '', telegramEditable: false };

/** Dựng trang account với fetch giả; `routes[url]` trả { status, body } cho POST. */
async function boot(profile, routes = {}) {
  const calls = [];
  const chips = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/' });
  const { window } = dom;
  window.fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      const route = routes[url];
      const res = typeof route === 'function' ? route(body) : (route || { status: 200, body });
      return { ok: res.status < 400, status: res.status, json: async () => res.body };
    }
    return { ok: true, status: 200, json: async () => ({ ...profile }) };
  };
  window.TKSNav = { authGuard: async () => ({ id: 'u1' }), renderTopSidebar() {}, renderAccountChip(u) { chips.push({ ...u }); } };
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) window.eval(match[1]);
  }
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await flush();
  return { window, doc: window.document, calls, chips };
}

test('Lưu thay đổi hồ sơ không gửi email trong body POST /api/auth/profile', async () => {
  const { window, doc, calls } = await boot({ ...base });
  try {
    doc.getElementById('profEmail').value = 'evil@example.com';
    window.handleSaveProfile({ preventDefault() {} });
    await flush();
    const posts = calls.filter(c => c.url === '/api/auth/profile');
    assert.equal(posts.length, 1);
    assert.equal('email' in posts[0].body, false);
    assert.deepEqual(posts[0].body, { hoTen: 'A' });
  } finally { window.close(); }
});

test('TK hrManaged: ô email chỉ đọc, hiện gợi ý liên hệ Quản lý, không có nút Đổi email', async () => {
  const { window, doc } = await boot({ ...base, hrManaged: true });
  try {
    const field = doc.getElementById('profEmail');
    assert.equal(field.value, 'a@example.com');
    assert.equal(field.readOnly, true);
    const hint = doc.getElementById('profEmailHint');
    assert.notEqual(hint.style.display, 'none');
    assert.match(hint.textContent, /chỉ Quản lý được đổi/);
    assert.equal(doc.getElementById('btnOpenEmailChange').style.display, 'none');
  } finally { window.close(); }
});

test('TK thường: Đổi email qua 2 bước contact-change -> verify, cập nhật ô email + chip', async () => {
  const { window, doc, calls, chips } = await boot({ ...base, hrManaged: false }, {
    '/api/auth/profile/contact-change': { status: 200, body: { challengeId: 'ch-1', field: 'email', targetMasked: 'n***@<b>x</b>.com', expiresInSeconds: 300 } },
    '/api/auth/profile/contact-change/verify': { status: 200, body: { hoTen: 'A', email: 'new@example.com' } }
  });
  try {
    assert.equal(doc.getElementById('profEmail').readOnly, true);
    assert.equal(doc.getElementById('profEmailHint').style.display, 'none');
    const openBtn = doc.getElementById('btnOpenEmailChange');
    assert.notEqual(openBtn.style.display, 'none');
    assert.match(openBtn.getAttribute('onclick'), /openEmailChangeModal\(\)/);
    window.openEmailChangeModal(); // runScripts 'outside-only' không chạy onclick inline
    assert.equal(doc.getElementById('emailChangeModal').hidden, false);

    doc.getElementById('emailChangeNew').value = ' new@example.com ';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    assert.equal(doc.getElementById('btnEmailChangeSubmit').disabled, true, 'nút bị khóa khi đang gửi');
    await flush();
    assert.deepEqual(calls.at(-1), { url: '/api/auth/profile/contact-change', body: { field: 'email', value: 'new@example.com' } });
    assert.equal(doc.getElementById('emailChangeStep2').hidden, false);
    const note = doc.getElementById('emailChangeSentNote');
    assert.equal(note.textContent, 'Đã gửi mã tới n***@<b>x</b>.com');
    assert.equal(note.querySelector('b'), null, 'chuỗi từ server không được chèn dạng HTML');

    doc.getElementById('emailChangeOtp').value = '123456';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    await flush();
    assert.deepEqual(calls.at(-1), { url: '/api/auth/profile/contact-change/verify', body: { challengeId: 'ch-1', otp: '123456' } });
    assert.equal(doc.getElementById('profEmail').value, 'new@example.com');
    assert.equal(chips.at(-1).email, 'new@example.com');
    assert.equal(doc.getElementById('emailChangeModal').hidden, true);
    assert.match(doc.getElementById('toastContainer').textContent, /Đã đổi email thành công/);
    assert.equal(calls.some(c => c.url === '/api/auth/profile'), false, 'không đổi email qua POST /api/auth/profile');
  } finally { window.close(); }
});

test('TK thường: lỗi OTP_COOLDOWN hiện lỗi từ server và khóa nút kèm số giây chờ', async () => {
  const { window, doc } = await boot({ ...base }, {
    '/api/auth/profile/contact-change': { status: 429, body: { error: 'Vui lòng chờ trước khi gửi lại mã.', code: 'OTP_COOLDOWN', waitSeconds: 42 } }
  });
  try {
    window.openEmailChangeModal();
    doc.getElementById('emailChangeNew').value = 'new@example.com';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    await flush();
    const err = doc.getElementById('emailChangeError');
    assert.equal(err.style.display, 'block');
    assert.equal(err.textContent, 'Vui lòng chờ trước khi gửi lại mã.');
    const submit = doc.getElementById('btnEmailChangeSubmit');
    assert.equal(submit.disabled, true);
    assert.match(submit.textContent, /42 giây/);
    assert.equal(doc.getElementById('emailChangeStep2').hidden, true);
  } finally { window.close(); }
});

test('TK thường: OTP sai giữ ở bước 2 và hiện lỗi; phiên hết hạn quay về bước 1', async () => {
  let verifyCode = 'INVALID_OTP';
  const { window, doc } = await boot({ ...base }, {
    '/api/auth/profile/contact-change': { status: 200, body: { challengeId: 'ch-2', field: 'email', targetMasked: 'n***@example.com', expiresInSeconds: 300 } },
    '/api/auth/profile/contact-change/verify': () => ({ status: 400, body: { error: verifyCode === 'INVALID_OTP' ? 'Mã OTP không đúng.' : 'Mã đã hết hạn.', code: verifyCode } })
  });
  try {
    window.openEmailChangeModal();
    doc.getElementById('emailChangeNew').value = 'new@example.com';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    await flush();
    doc.getElementById('emailChangeOtp').value = '000000';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    await flush();
    assert.equal(doc.getElementById('emailChangeError').textContent, 'Mã OTP không đúng.');
    assert.equal(doc.getElementById('emailChangeStep2').hidden, false);
    assert.equal(doc.getElementById('profEmail').value, 'a@example.com');

    verifyCode = 'CONTACT_CHALLENGE_EXPIRED';
    window.handleEmailChangeSubmit({ preventDefault() {} });
    await flush();
    assert.equal(doc.getElementById('emailChangeError').textContent, 'Mã đã hết hạn.');
    assert.equal(doc.getElementById('emailChangeStep1').hidden, false);
    assert.equal(doc.getElementById('emailChangeNew').value, 'new@example.com');
  } finally { window.close(); }
});

/* ---------- Modal hồ sơ dùng chung (shared-nav.js) ---------- */
const navJs = fs.readFileSync(path.join(__dirname, '../../public/shared/shared-nav.js'), 'utf8');

async function bootModal(profile, extra) {
  const posted = [];
  const dom = new JSDOM('<html><head></head><body><div id="accountChip"></div></body></html>', { runScripts: 'outside-only', url: 'https://tokosi.example/' });
  const { window } = dom;
  window.fetch = async (url, options = {}) => {
    if (url === '/api/auth/profile' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      posted.push(body);
      return { ok: true, json: async () => ({ ...profile, ...body }) };
    }
    return { ok: true, json: async () => ({ ...profile }) };
  };
  if (extra) extra(window);
  window.eval(navJs);
  window.TKSNav.openProfileModal();
  await flush();
  return { window, doc: window.document, posted };
}

test('modal hồ sơ: email chỉ đọc, Lưu không gửi email', async () => {
  const { window, doc, posted } = await bootModal({ ...base });
  try {
    const field = doc.getElementById('tksProfileEmail');
    assert.equal(field.value, 'a@example.com');
    assert.equal(field.readOnly, true);
    field.value = 'evil@example.com';
    doc.getElementById('tksProfileSave').click();
    await flush();
    assert.deepEqual(posted[0], { hoTen: 'A' });
  } finally { window.close(); }
});

test('modal hồ sơ: TK hrManaged thấy gợi ý liên hệ Quản lý, không có liên kết Đổi email', async () => {
  const { window, doc } = await bootModal({ ...base, hrManaged: true });
  try {
    const hint = doc.getElementById('tksProfileEmailHint');
    assert.equal(hint.hidden, false);
    assert.match(hint.textContent, /chỉ Quản lý được đổi/);
    assert.equal(doc.getElementById('tksProfileEmailChangeRow').hidden, true);
  } finally { window.close(); }
});

test('modal hồ sơ: TK thường có liên kết Đổi email tới /account/; ở trang Tài khoản thì mở hộp OTP', async () => {
  let opened = 0;
  const { window, doc } = await bootModal({ ...base, hrManaged: false }, w => { w.openEmailChangeModal = () => { opened += 1; }; });
  try {
    assert.equal(doc.getElementById('tksProfileEmailHint').hidden, true);
    assert.equal(doc.getElementById('tksProfileEmailChangeRow').hidden, false);
    const link = doc.getElementById('tksProfileEmailChange');
    assert.equal(link.getAttribute('href'), '/account/#profile');
    link.click();
    assert.equal(opened, 1);
    assert.equal(doc.querySelector('.tks-profile-overlay').hidden, true, 'đóng modal hồ sơ trước khi mở hộp OTP');
  } finally { window.close(); }
});
