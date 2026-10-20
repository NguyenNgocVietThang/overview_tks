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

async function openPage({ canManage, employees = EMPLOYEES }) {
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
    const payload = text.startsWith('/api/hr/employees') ? { employees, canManage }
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
  assert.ok(doc.querySelector('#employeeDirectoryTableBody tr').cells[4].classList.contains('emp-status-active'));

  filter.value = 'resigned';
  window.renderEmployeeDirectoryTable();
  assert.deepEqual(names(doc), ['Bình Sale']);
  const resigned = doc.querySelector('#employeeDirectoryTableBody tr').cells[4];
  assert.equal(resigned.textContent, 'NV');
  assert.ok(resigned.classList.contains('emp-status-resigned'));

  filter.value = '';
  window.renderEmployeeDirectoryTable();
  assert.deepEqual(names(doc), ['An Kho', 'Bình Sale']);
  dom.window.close();
});

test('người không có quyền quản lý: giữ 5 cột công khai, không lộ email và bấm dòng không mở hộp', async () => {
  const { dom, window } = await openPage({ canManage: false });
  const doc = window.document;
  assert.equal(doc.getElementById('btnAddEmployee').hidden, true);
  assert.equal(doc.querySelectorAll('#employeeDirectoryTableHead th').length, 5);
  const row = doc.querySelector('#employeeDirectoryTableBody tr');
  assert.equal(row.hasAttribute('data-employee-id'), false);
  row.cells[0].dispatchEvent(new window.Event('click', { bubbles: true }));
  assert.equal(doc.getElementById('employeeModal').hidden, true);
  dom.window.close();
});

test('người có quyền quản lý: hiện bảng hồ sơ mở rộng, bấm dòng mở hộp chi tiết và lưu bằng PUT kèm trạng thái', async () => {
  const { dom, window, sent } = await openPage({ canManage: true });
  const doc = window.document;
  assert.equal(doc.getElementById('btnAddEmployee').hidden, false);
  assert.equal(doc.querySelectorAll('#employeeDirectoryTableHead th').length, 19);
  assert.equal(doc.getElementById('btnImportEmployeeDirectory').hidden, true, 'đã có danh sách thì không cho nhập đè');
  const row = doc.querySelector('#employeeDirectoryTableBody tr');

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


test('nhap danh sach nhan su co thanh tien do phan tram trong luc tai file len', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /employeeImportProgress/);
  assert.match(html, /XMLHttpRequest/);
  assert.match(html, /event\.loaded\s*\/\s*event\.total/);
});


test('form nhan su cho phep sua day du cac truong ho so mo rong', () => {
  const html = fs.readFileSync(htmlPath, 'utf8');
  for (const id of ['empChucVu','empNgayVaoLam','empNgaySinh','empSoCccd','empDiaChi','empNguoiThanQuanHe','empNguoiThanHoTen','empNguoiThanSdt','empGioiTinh','empHoSoDayDu','empVanTay','empNgayNghiViec']) assert.match(html, new RegExp(`id="${id}"`));
});


test('so ngay lam viec tinh bang hom nay tru ngay vao lam, khong cong them 1', async () => {
  const { dom, window } = await openPage({ canManage: true });
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(window.employeeWorkingDays({ ngayVaoLam: today }), '0');
  assert.doesNotMatch(window.employeeWorkingDays({ ngayVaoLam: '2026-01-01T00:00:00.000Z' }), /NaN/);
  assert.doesNotMatch(window.employeeWorkingDays({ ngayVaoLam: '01/01/2026' }), /NaN/);
  assert.equal(window.employeeWorkingDays({ ngayVaoLam: 'not-a-date' }), '—');
  dom.window.close();
});


test('cot trang thai hien LV va NV theo trang thai lam viec', async () => {
  const { dom, window } = await openPage({ canManage: false });
  const doc = window.document;
  assert.equal(doc.querySelector('#employeeDirectoryTableBody tr').cells[4].textContent.trim(), 'LV');
  doc.getElementById('employeeStatusFilter').value = 'resigned';
  window.renderEmployeeDirectoryTable();
  assert.equal(doc.querySelector('#employeeDirectoryTableBody tr').cells[4].textContent.trim(), 'NV');
  dom.window.close();
});


test('do rong cot nhan su dua theo gia tri dai nhat va co gioi han hop ly', async () => {
  const basic = await openPage({ canManage: false });
  const basicHeaders = basic.window.document.querySelectorAll('#employeeDirectoryTableHead th');
  assert.ok(parseInt(basicHeaders[0].style.width, 10) < 140, 'tên ngắn không bị ép rộng theo tên cột');
  assert.ok(parseInt(basicHeaders[4].style.width, 10) < 75, 'trạng thái ngắn không bị ép rộng theo tên cột');

  basic.dom.window.close();

  const longData = [{ id:'long', hoTen:'Nguyen Van A co ho ten rat dai de kiem tra do rong cot', boPhan:'Kinh doanh', coSo:'Ha Noi', soDienThoai:'0900000000', email:'dia-chi-email-rat-dai@example-company.vn', trangThai:'Dang lam viec' }];
  const long = await openPage({ canManage: false, employees: longData });
  const longHeaders = long.window.document.querySelectorAll('#employeeDirectoryTableHead th');
  assert.ok(parseInt(longHeaders[0].style.width, 10) > 260);
  assert.equal(longHeaders.length, 5, 'email không còn là cột hiển thị');
  long.dom.window.close();

  const manager = await openPage({ canManage: true });
  const managerHeaders = manager.window.document.querySelectorAll('#employeeDirectoryTableHead th');
  assert.equal(managerHeaders[0].style.width, '48px');
  assert.ok(parseInt(managerHeaders[17].style.width, 10) < 75);
  manager.dom.window.close();
});

test('quan ly xem danh sach theo thu tu file nhan su, an nut nhap khi da co du lieu, va hien ngay DD/MM/YYYY', async () => {
  const { dom, window } = await openPage({ canManage: true });
  const doc = window.document;
  const headers = [...doc.querySelectorAll('#employeeDirectoryTableHead th')]
    .map(th => th.textContent.replace(/[▲▼]/g, '').trim());
  assert.deepEqual(headers, [
    'STT', 'Họ và tên', 'Bộ phận', 'Chức vụ', 'Ngày vào làm', 'Số ngày LV', 'Ngày sinh', 'Số CCCD', 'SĐT',
    'Địa chỉ hiện tại', 'Giới tính', 'Hồ sơ', 'Vân tay', 'Cơ sở', 'QH người thân', 'Họ tên người thân',
    'SĐT người thân', 'Trạng thái', 'Ngày nghỉ việc'
  ]);
  assert.equal(doc.getElementById('btnImportEmployeeDirectory').hidden, true, 'đã có dữ liệu thì không hiện nhập lại');
  assert.equal(window.formatEmployeeDate('2026-01-02'), '02/01/2026');
  dom.window.close();
});

test('nut sap xep danh sach nhan su sap xep ngay va so theo gia tri thuc, khong theo chuoi hien thi', async () => {
  const employees = [
    { id:'1', hoTen:'A', boPhan:'KHO', coSo:'Ha Noi', ngayVaoLam:'2026-10-02', trangThai:'Dang lam viec' },
    { id:'2', hoTen:'B', boPhan:'KHO', coSo:'Ha Noi', ngayVaoLam:'2025-12-15', trangThai:'Dang lam viec' },
    { id:'3', hoTen:'C', boPhan:'KHO', coSo:'Ha Noi', ngayVaoLam:'2026-01-10', trangThai:'Dang lam viec' }
  ];
  const { dom, window } = await openPage({ canManage: true, employees });
  const doc = window.document;
  const dateSort = doc.querySelector('#employeeDirectoryTable th[data-column-key="ngay-vao-lam"] .sort-button');
  dateSort.click();
  assert.deepEqual(
    [...doc.querySelectorAll('#employeeDirectoryTableBody tr')].map(row => row.cells[1].textContent),
    ['B', 'C', 'A']
  );
  const firstDate = doc.querySelector('#employeeDirectoryTableBody tr').cells[4];
  assert.match(firstDate.getAttribute('data-sort-value'), /^\d+$/);
  assert.ok(firstDate.classList.contains('employee-date'));
  assert.ok(doc.querySelector('#employeeDirectoryTableBody tr').cells[5].classList.contains('employee-number'));
  dom.window.close();
});

test('form nhân sự ghi đúng Bộ phận và không cho sửa email liên kết đang có', async () => {
  const { dom, window, sent } = await openPage({ canManage: true });
  const doc = window.document;
  assert.equal(doc.querySelector('label[for="empBoPhan"]').textContent, 'Bộ phận *');
  assert.equal(doc.getElementById('empEmail'), null, 'email không nằm trong form hồ sơ');
  doc.querySelector('#employeeDirectoryTableBody tr').click();
  await window.saveEmployee({ preventDefault() {} });
  assert.equal(sent[0].body.email, 'a@x.com', 'sửa hồ sơ không làm trống email liên kết cũ');
  dom.window.close();
});
