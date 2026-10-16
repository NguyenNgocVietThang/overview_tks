'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '../../public/telegram/leave-reject.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../../public/telegram/leave-reject.js'), 'utf8');
test('Telegram rejection context displays stored timing and deadline separately from the rejection action', async () => {
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://example.test/telegram/leave-reject?requestId=OWN&expectedVersion=7' });
  try {
    const w = dom.window;
    w.Telegram = { WebApp: { initData: 'synthetic', ready() {}, expand() {} } };
    w.fetch = async () => ({ ok: true, json: async () => ({ request: { ho_ten: 'A', trang_thai: 'Chưa duyệt', timing_status: 'Vi phạm', registration_deadline_date: '2026-10-04' } }) });
    w.eval(script);
    await new Promise(resolve => setImmediate(resolve));
    const context = w.document.getElementById('context').textContent;
    assert.match(context, /Nhãn thời hạn.*Vi phạm/);
    assert.match(context, /04\/10\/2026.*23:59:59/);
    assert.equal(w.document.getElementById('submit').disabled, false);
  } finally { dom.window.close(); }
});
