'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// TKSNav that dung TKSNav.can(<quyen>) (nguon: user.permissions tu /api/auth/me)
// thay cho kiem tra vai tro cung — mock phai co ham do, lay dung quyen mac dinh
// cua vai tro tu server/auth/featureRegistry.js.
const { defaultsForRole } = require('../../auth/featureRegistry');
function fakeCan(vaiTro) {
  const permissions = defaultsForRole(vaiTro);
  return (...keys) => keys.some(key => (Array.isArray(key) ? key : [key]).some(k => permissions.includes(k)));
}


const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');

test('người dùng thường mặc định chỉ tải các lịch nghỉ giao với ngày hôm nay', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  const requestedUrls = [];

  window.TKSNav = {
    authGuard: async () => ({ username: 'nhanvien', vaiTro: 'Nhân viên kho' }),
    can: fakeCan('Nhân viên kho'),
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

  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  assert.equal(query.get('from'), today, 'mặc định ngày bắt đầu là hôm nay');
  assert.equal(query.get('to'), today, 'mặc định ngày kết thúc là hôm nay');
  assert.equal(window.document.getElementById('fromDateFilter').value, today);
  assert.equal(window.document.getElementById('toDateFilter').value, today);
  assert.equal(window.document.getElementById('statusFilter').value, '', 'người dùng thường không lọc trạng thái');

  dom.window.close();
});

test('Quản lý mặc định xem toàn thời gian, lọc client-side đơn Chưa duyệt và KPI vẫn đếm đủ', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  const requestedUrls = [];

  window.TKSNav = {
    authGuard: async () => ({ username: 'manager', vaiTro: 'Quản lý' }),
    can: fakeCan('Quản lý'),
    renderTopSidebar() {}
  };
  const base = {
    ho_ten: 'A', chuc_vu: 'NV', bo_phan: 'Kho', co_so: 'Hà Nội', ly_do: 'x',
    thoi_gian_gui: '2026-08-22T01:00:00.000Z', thoi_gian_bat_dau: 'Sáng 22/08/2026',
    thoi_gian_ket_thuc: 'Chiều 22/08/2026', tong_buoi_nghi: 2, tong_ngay_nghi: 1
  };
  window.fetch = async url => {
    requestedUrls.push(String(url));
    const text = String(url);
    const payload = text.includes('/summary/') ? { summary: [] }
      : text.includes('/link-status') ? { linked: false }
        : { requests: [
          { ...base, request_id: 'NP-1', trang_thai: 'Chưa duyệt' },
          { ...base, request_id: 'NP-2', trang_thai: 'Đã duyệt' },
          { ...base, request_id: 'NP-3', trang_thai: 'Đã duyệt' }
        ] };
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

  const listUrl = requestedUrls.find(url => url.startsWith('/api/hr/leave-requests?'));
  assert.ok(listUrl, 'frontend phải gọi API danh sách yêu cầu nghỉ phép');
  const query = new URL(listUrl, window.location.origin).searchParams;
  assert.equal(query.get('from'), null, 'quản lý không giới hạn ngày (toàn thời gian)');
  assert.equal(query.get('to'), null);
  assert.equal(query.get('status'), null, 'trạng thái lọc phía client, không gửi lên API');
  assert.equal(window.document.getElementById('statusFilter').value, 'Chưa duyệt');

  const rows = window.document.querySelectorAll('#leaveTableBody tr[data-request-id]');
  assert.equal(rows.length, 1, 'chỉ hiện đơn Chưa duyệt');
  assert.equal(rows[0].dataset.requestId, 'NP-1');
  assert.equal(window.document.getElementById('statApproved').textContent, '2', 'KPI vẫn đếm mọi trạng thái');

  dom.window.close();
});

// Dung trang voi 1 don "Vi phạm" cho vai tro cho truoc; tra ve { dom, window } sau khi trang tai xong.
async function loadPageWithViolation(vaiTro) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.Chart = class FakeChart { destroy() {} };
  window.TKSNav = {
    authGuard: async () => ({ username: 'user1', vaiTro }),
    can: fakeCan(vaiTro),
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
  return { dom, window };
}

test('tab nghỉ phép hiển thị thời gian gửi, dữ liệu theo buổi và trạng thái Vi phạm (người dùng thường)', async () => {
  const { dom, window } = await loadPageWithViolation('Nhân viên kho');

  const headers = [...window.document.querySelectorAll('#leaveTable thead th')].map(th => th.textContent.trim());
  assert.ok(headers.some(header => header.includes('Thời gian gửi')));
  assert.ok(headers.some(header => header.includes('Tổng buổi / ngày')));
  assert.match(window.document.querySelector('.date-range-group').textContent, /Thời gian nghỉ/);
  assert.equal(window.document.getElementById('maStartDate').type, 'date');
  assert.equal(window.document.getElementById('maStartSession').tagName, 'SELECT');

  const rowText = window.document.querySelector('#leaveTableBody tr').textContent;
  assert.match(rowText, /22\/08\/2026 08:00/);
  assert.match(rowText, /Sáng 22\/08\/2026/);
  assert.match(rowText, /2 buổi \(1 ngày\)/);
  assert.match(rowText, /Vi phạm/);
  assert.doesNotMatch(rowText, /Mở lại|Tạm duyệt|Duyệt|Từ chối/);
  assert.ok(window.document.querySelector('.status-pill.leave-violation'));
  assert.equal(window.document.querySelector('#leaveTableBody select.status-select'), null);

  dom.window.close();
});

test('Quản lý vẫn duyệt / từ chối được đơn Vi phạm, nhãn Vi phạm vẫn hiện', async () => {
  const { dom, window } = await loadPageWithViolation('Quản lý');

  // Mac dinh Quan ly chi thay "Chua duyet" -> bo loc trang thai de thay don Vi pham.
  window.document.getElementById('statusFilter').value = '';
  window.handleStatusFilterChange();

  const select = window.document.querySelector('#leaveTableBody select.status-select.leave-violation');
  assert.ok(select, 'Quản lý phải có dropdown ở đơn Vi phạm');
  assert.equal(select.value, 'Vi phạm');
  assert.deepEqual([...select.options].map(o => o.value), ['Vi phạm', 'Đã duyệt', 'Từ chối']);

  dom.window.close();
});
