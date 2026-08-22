'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');

test('cột Trạng thái và Hành động được gộp thành 1 cột Trạng thái ở cuối bảng (tổng 9 cột)', async () => {
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
          request_id: 'NP-20260822-001',
          ho_ten: 'Nguyễn Văn A',
          chuc_vu: 'Trưởng kho',
          ly_do: 'Việc gia đình',
          thoi_gian_gui: '2026-08-22T08:00:00.000Z',
          thoi_gian_bat_dau: 'Sáng 23/08/2026',
          thoi_gian_ket_thuc: 'Chiều 23/08/2026',
          tong_buoi_nghi: 2,
          tong_ngay_nghi: 1,
          nguoi_ban_giao: 'Trần B',
          trang_thai: 'Chưa duyệt',
          nguoi_duyet: ''
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

  const headers = [...window.document.querySelectorAll('#leaveTable thead th')].map(th => th.textContent.replace('↕', '').replace('↑', '').replace('↓', '').trim());
  assert.equal(headers.length, 9, 'Bảng phải có đúng 9 cột sau khi gộp');
  assert.equal(headers[headers.length - 1], 'Trạng thái', 'Cột cuối cùng phải là Trạng thái');
  assert.ok(!headers.includes('Hành động'), 'Không còn cột Hành động riêng biệt');
  assert.equal(headers[7], 'Người duyệt', 'Cột thứ 8 là Người duyệt');

  // Kiểm tra Quản lý thấy dropdown select trạng thái
  const statusSelect = window.document.querySelector('#leaveTableBody select.status-select');
  assert.ok(statusSelect, 'Quản lý phải thấy select dropdown ở cột Trạng thái');
  assert.equal(statusSelect.value, 'Chưa duyệt', 'Trạng thái ban đầu là Chưa duyệt');

  const options = [...statusSelect.options].map(o => o.value);
  assert.ok(options.includes('Chưa duyệt'), 'Dropdown có tùy chọn Chưa duyệt');
  assert.ok(options.includes('Đã duyệt'), 'Dropdown có tùy chọn Đã duyệt');
  assert.ok(options.includes('Từ chối'), 'Dropdown có tùy chọn Từ chối');

  dom.window.close();
});

test('tài khoản không phải Quản lý chỉ thấy badge nhãn trạng thái tĩnh', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.Chart = class FakeChart { destroy() {} };
  window.TKSNav = {
    authGuard: async () => ({ username: 'nhanvien', vaiTro: 'Nhân viên' }),
    renderTopSidebar() {}
  };
  window.fetch = async url => {
    const text = String(url);
    const payload = text.includes('/summary/') ? { summary: [] }
      : text.includes('/link-status') ? { linked: false }
        : { requests: [{
          request_id: 'NP-20260822-002',
          ho_ten: 'Lê C',
          chuc_vu: 'Kho',
          ly_do: 'Ốm',
          thoi_gian_gui: '2026-08-22T08:00:00.000Z',
          thoi_gian_bat_dau: 'Sáng 23/08/2026',
          thoi_gian_ket_thuc: 'Chiều 23/08/2026',
          tong_buoi_nghi: 2,
          tong_ngay_nghi: 1,
          nguoi_ban_giao: 'Trần B',
          trang_thai: 'Chưa duyệt',
          nguoi_duyet: ''
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

  const select = window.document.querySelector('#leaveTableBody select.status-select');
  assert.equal(select, null, 'Nhân viên không được hiển thị dropdown sửa trạng thái');

  const pill = window.document.querySelector('#leaveTableBody .status-pill.leave-pending');
  assert.ok(pill, 'Nhân viên thấy badge trạng thái tĩnh');
  assert.equal(pill.textContent.trim(), 'Chưa duyệt');

  dom.window.close();
});

test('Quản lý thay đổi trạng thái gọi API PATCH và cập nhật Người duyệt ngay trên giao diện', async () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://tokosi.example/humanresources/'
  });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => ({});
  window.Chart = class FakeChart { destroy() {} };
  window.TKSNav = {
    authGuard: async () => ({ username: 'manager1', hoTen: 'Nguyễn Quản Lý', vaiTro: 'Quản lý' }),
    renderTopSidebar() {}
  };

  let patchCalled = false;
  let patchBody = null;

  window.fetch = async (url, options) => {
    const text = String(url);
    if (options && options.method === 'PATCH') {
      patchCalled = true;
      patchBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          request: {
            request_id: 'NP-20260822-003',
            trang_thai: patchBody.status,
            nguoi_duyet: 'Nguyễn Quản Lý'
          }
        }),
        text: async () => JSON.stringify({})
      };
    }
    const payload = text.includes('/summary/') ? { summary: [] }
      : text.includes('/link-status') ? { linked: false }
        : { requests: [{
          request_id: 'NP-20260822-003',
          ho_ten: 'Phạm D',
          chuc_vu: 'Kế toán',
          ly_do: 'Đi khám',
          thoi_gian_gui: '2026-08-22T08:00:00.000Z',
          thoi_gian_bat_dau: 'Sáng 23/08/2026',
          thoi_gian_ket_thuc: 'Chiều 23/08/2026',
          tong_buoi_nghi: 2,
          tong_ngay_nghi: 1,
          nguoi_ban_giao: 'Lê E',
          trang_thai: 'Chưa duyệt',
          nguoi_duyet: ''
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

  const select = window.document.querySelector('#leaveTableBody select.status-select');
  assert.ok(select);
  select.value = 'Đã duyệt';
  await window.handleStatusSelectChange(select, 'NP-20260822-003');

  assert.equal(patchCalled, true, 'Phải gọi API PATCH khi thay đổi trạng thái');
  assert.equal(patchBody.status, 'Đã duyệt', 'Body gửi lên phải có status: Đã duyệt');

  const row = window.document.getElementById('leave-row-NP-20260822-003');
  const approverCell = row.querySelector('.approver-cell');
  assert.equal(approverCell.textContent.trim(), 'Nguyễn Quản Lý', 'Cột Người duyệt phải được cập nhật tên quản lý vừa duyệt');

  dom.window.close();
});
