'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole } = require('../../auth/featureRegistry');

const htmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');

const EMPLOYEES = [
  { id: '1', hoTen: 'An Kho', boPhan: 'KHO', coSo: 'Hà Nội', soDienThoai: '0900000001', email: 'a@x.com', trangThai: 'Đang làm việc', ngayThem: '2026-03-05T05:00:00.000Z' },
  { id: '2', hoTen: 'Bình Sale', boPhan: 'SALE', coSo: 'Sài Gòn', soDienThoai: '0900000002', email: 'b@x.com', trangThai: 'Đã nghỉ việc', ngayThem: '2026-04-06T05:00:00.000Z' }
];

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function openPage({ canManage }) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/humanresources/' });
  const { window } = dom;
  const sent = [];
  const permissions = defaultsForRole('Quản lý').filter(key => canManage || key !== 'hr.employees.manage');
  window.TKSNav = {
    authGuard: async () => ({ username: 'manager', vaiTro: 'Quản lý', branches: ['Hà Nội', 'Sài Gòn'] }),
    can: (...keys) => keys.some(key => permissions.includes(key)),
    renderTopSidebar() {}
  };
  window.fetch = async (url, init = {}) => {
    const text = String(url);
    if (init.method === 'PUT' || init.method === 'POST') {
      sent.push({ url: text, method: init.method, body: JSON.parse(init.body) });
      const payload = { employee: EMPLOYEES[0], accounts: { locked: ['bs'], unlocked: [], skipped: [] } };
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload };
    }
    const payload = text.startsWith('/api/hr/employees') ? { employees: EMPLOYEES, canManage }
      : text.includes('/summary/') ? { summary: [] } : { requests: [] };
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => payload, text: async () => JSON.stringify(payload) };
  };
  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim()).forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  await tick();
  return { dom, window, sent };
}

const names = doc => [...doc.querySelectorAll('#employeeDirectoryTableBody tr')].map(tr => tr.cells[0].textContent);

test('danh sách nhân sự mặc định chỉ "Đang làm việc"; chữ xanh/đỏ theo trạng thái; có lựa chọn Đã nghỉ việc và Tất cả', async () => {
  const { dom, window } = await openPage({ canManage: false });
  const doc = window.document;
  const filter = doc.getElementById('employeeStatusFilter');
  assert.equal(filter.value, 'active');
  assert.deepEqual([...filter.options].map(o => o.value), ['active', 'resigned', '']);
  assert.deepEqual(names(doc), ['An Kho']);
  assert.ok(doc.querySelector('#employeeDirectoryTableBody tr').cells[5].classList.contains('emp-status-active'));

  filter.value = 'resigned';
  window.renderEmployeeDirectoryTable();
  assert.deepEqual(names(doc), ['Bình Sale']);
  const resigned = doc.querySelector('#employeeDirectoryTableBody tr').cells[5];
  assert.equal(resigned.textContent, 'Đã nghỉ việc');
  assert.ok(resigned.classList.contains('emp-status-resigned'));

  filter.value = '';
  window.renderEmployeeDirectoryTable();
  assert.deepEqual(names(doc), ['An Kho', 'Bình Sale']);
  dom.window.close();
});

test('người không có quyền quản lý: không có nút Thêm, cột Ngày thêm ẩn, bấm dòng không mở hộp', async () => {
  const { dom, window } = await openPage({ canManage: false });
  const doc = window.document;
  assert.equal(doc.getElementById('btnAddEmployee').hidden, true);
  assert.equal(doc.getElementById('employeeCreatedAtTh').hidden, true);
  const row = doc.querySelector('#employeeDirectoryTableBody tr');
  assert.equal(row.hasAttribute('data-employee-id'), false);
  assert.equal(row.cells[6].hidden, true);
  row.cells[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(doc.getElementById('employeeModal').hidden, true);
  dom.window.close();
});

test('người có quyền quản lý: hiện Ngày thêm, bấm dòng mở hộp chi tiết và lưu bằng PUT kèm trạng thái', async () => {
  const { dom, window, sent } = await openPage({ canManage: true });
  const doc = window.document;
  assert.equal(doc.getElementById('btnAddEmployee').hidden, false);
  assert.equal(doc.getElementById('employeeCreatedAtTh').hidden, false);
  const row = doc.querySelector('#employeeDirectoryTableBody tr');
  assert.equal(row.cells[6].hidden, false);
  assert.match(row.cells[6].textContent, /2026/);

  row.cells[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  const modal = doc.getElementById('employeeModal');
  assert.equal(modal.hidden, false);
  assert.equal(doc.getElementById('empHoTen').value, 'An Kho');
  assert.equal(doc.getElementById('empCoSo').value, 'Hà Nội');
  assert.equal(doc.getElementById('empCreatedAt').readOnly, true);
  assert.equal(doc.getElementById('empStatusHint').style.display, 'none');

  doc.getElementById('empTrangThai').value = 'resigned';
  window.updateEmployeeStatusHint();
  assert.equal(doc.getElementById('empStatusHint').style.display, 'block');

  await window.saveEmployee({ preventDefault() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].method, 'PUT');
  assert.equal(sent[0].url, '/api/hr/employees/1');
  assert.equal(sent[0].body.trangThai, 'resigned');
  assert.equal(sent[0].body.coSo, 'Hà Nội');
  assert.equal(modal.hidden, true);
  dom.window.close();
});

test('nút Thêm nhân sự mở form trống, mặc định Đang làm việc, gửi POST', async () => {
  const { dom, window, sent } = await openPage({ canManage: true });
  const doc = window.document;
  window.openEmployeeModal();
  assert.equal(doc.getElementById('employeeModal').hidden, false);
  assert.equal(doc.getElementById('employeeModalHeading').textContent, 'Thêm nhân sự');
  assert.equal(doc.getElementById('empHoTen').value, '');
  assert.equal(doc.getElementById('empTrangThai').value, 'active');
  assert.equal(doc.getElementById('empCreatedAtGroup').hidden, true, 'chưa có ngày thêm khi tạo mới');
  doc.getElementById('empHoTen').value = 'Chi Mới';
  doc.getElementById('empBoPhan').value = 'KHO';
  await window.saveEmployee({ preventDefault() {} });
  assert.equal(sent[0].method, 'POST');
  assert.equal(sent[0].url, '/api/hr/employees');
  assert.equal(sent[0].body.hoTen, 'Chi Mới');
  dom.window.close();
});
