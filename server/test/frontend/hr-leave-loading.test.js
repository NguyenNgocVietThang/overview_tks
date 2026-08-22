'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');

test('trang nhân sự tải toàn bộ yêu cầu khi mở lần đầu', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  const requestedUrls = [];

  window.TKSNav = {
    authGuard: async () => ({ username: 'manager', vaiTro: 'Quản lý' }),
    renderTopSidebar() {}
  };
  window.fetch = async url => {
    requestedUrls.push(String(url));
    const payload = String(url).includes('/summary/') ? { summary: [] }
      : String(url).includes('/link-status') ? { linked: false }
        : { requests: [] };
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };

  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(script => script.trim());
  inlineScripts.forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  const initialListUrl = requestedUrls.find(url => url.startsWith('/api/hr/leave-requests?'));
  assert.ok(initialListUrl, 'frontend phải gọi API danh sách yêu cầu nghỉ phép');
  const query = new URL(initialListUrl, window.location.origin).searchParams;
  assert.equal(query.has('from'), false, 'không tự giới hạn ngày bắt đầu vào hôm nay');
  assert.equal(query.has('to'), false, 'không tự giới hạn ngày kết thúc vào hôm nay');

  dom.window.close();
});

test('tab nghỉ phép hiển thị thời gian gửi, dữ liệu theo buổi và trạng thái Vi phạm', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.Chart = class FakeChart { destroy() {} };
  window.TKSNav = {
    authGuard: async () => ({ username: 'manager', vaiTro: 'Quản lý' }),
    renderTopSidebar() {}
  };
  window.fetch = async url => {
    const text = String(url);
    const payload = text.includes('/summary/') ? { summary: [] }
      : text.includes('/link-status') ? { linked: false }
        : { requests: [{
          request_id: 'NP-TEST',
          ho_ten: 'Nguyễn A',
          chuc_vu: 'Nhân viên',
          ly_do: 'Việc gia đình',
          thoi_gian_gui: '2026-08-22T01:00:00.000Z',
          thoi_gian_bat_dau: 'Sáng 22/08/2026',
          thoi_gian_ket_thuc: 'Chiều 22/08/2026',
          tong_buoi_nghi: 2,
          tong_ngay_nghi: 1,
          trang_thai: 'Vi phạm'
        }] };
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => payload,
      text: async () => JSON.stringify(payload)
    };
  };

  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(script => script.trim());
  inlineScripts.forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  const headers = [...window.document.querySelectorAll('#leaveTable thead th')].map(th => th.textContent.trim());
  assert.ok(headers.some(header => header.includes('Thời gian gửi')));
  assert.ok(headers.some(header => header.includes('Tổng buổi / ngày')));
  assert.match(window.document.querySelector('.date-range-group').textContent, /Thời gian gửi/);
  assert.equal(window.document.getElementById('maStartDate').type, 'date');
  assert.equal(window.document.getElementById('maStartSession').tagName, 'SELECT');

  const rowText = window.document.querySelector('#leaveTableBody tr').textContent;
  assert.match(rowText, /22\/08\/2026 08:00/);
  assert.match(rowText, /Sáng 22\/08\/2026/);
  assert.match(rowText, /2 buổi \(1 ngày\)/);
  assert.match(rowText, /Vi phạm/);
  assert.doesNotMatch(rowText, /Mở lại|Tạm duyệt|Duyệt|Từ chối/);
  assert.ok(window.document.querySelector('.status-pill.leave-violation'));

  dom.window.close();
});
