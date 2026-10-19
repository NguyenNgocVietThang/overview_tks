'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole } = require('../../auth/featureRegistry');

const hrHtmlPath = path.join(__dirname, '..', '..', 'public', 'humanresources', 'index.html');
const accountHtmlPath = path.join(__dirname, '..', '..', 'public', 'account', 'index.html');

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('Bảng nhân sự: có thanh trượt has-pager, cụm phân trang <<, <, >, >> và sắp xếp toàn bộ dữ liệu', async () => {
  const html = fs.readFileSync(hrHtmlPath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/humanresources/' });
  const { window } = dom;
  const doc = window.document;

  // Tạo 120 nhân viên mẫu
  const mockEmployees = Array.from({ length: 120 }, (_, i) => {
    const num = String(i + 1).padStart(3, '0');
    // Đặt tên đảo ngược để kiểm tra sort
    const reverseNum = String(120 - i).padStart(3, '0');
    return {
      id: String(i + 1),
      hoTen: `Nhân viên ${reverseNum}`,
      boPhan: 'KHO',
      coSo: 'Hà Nội',
      soDienThoai: `0900000${num}`,
      email: `nv${num}@tokosi.vn`,
      trangThai: 'Đang làm việc',
      ngayThem: '2026-03-01T00:00:00.000Z'
    };
  });

  const permissions = defaultsForRole('Quản lý');
  window.TKSNav = {
    authGuard: async () => ({ username: 'manager', vaiTro: 'Quản lý', branches: ['Hà Nội', 'Sài Gòn'] }),
    can: (...keys) => keys.some(key => permissions.includes(key)),
    renderTopSidebar() {}
  };
  window.fetch = async (url) => {
    const text = String(url);
    if (text.startsWith('/api/hr/employees')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ employees: mockEmployees, canManage: true }) };
    }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ requests: [], summary: [] }) };
  };

  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim()).forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  await tick();

  // 1. Kiểm tra cấu trúc thanh trượt dọc has-pager
  const scrollWrapper = doc.querySelector('#employeeDirectoryTable').parentElement;
  assert.ok(scrollWrapper.classList.contains('users-table-scroll'), 'khung bảng có class users-table-scroll');
  assert.ok(scrollWrapper.classList.contains('has-pager'), 'khung bảng có class has-pager để cuộn dọc');

  // 2. Kiểm tra bộ điều khiển phân trang
  const pager = doc.getElementById('employeeDirectoryPagination');
  assert.ok(pager, 'tồn tại phần tử #employeeDirectoryPagination');
  assert.equal(pager.hidden, false, 'bộ phân trang được hiển thị');

  const firstBtn = doc.getElementById('employeeDirectoryFirst');
  const prevBtn = doc.getElementById('employeeDirectoryPrev');
  const nextBtn = doc.getElementById('employeeDirectoryNext');
  const lastBtn = doc.getElementById('employeeDirectoryLast');
  const pageLabel = doc.getElementById('employeeDirectoryPageLabel');

  assert.equal(firstBtn.textContent, '<<');
  assert.equal(prevBtn.textContent, '<');
  assert.equal(nextBtn.textContent, '>');
  assert.equal(lastBtn.textContent, '>>');
  assert.equal(pageLabel.textContent, 'Trang 1/3', '120 nhân viên với cỡ trang 50 = 3 trang');

  assert.equal(firstBtn.disabled, true, 'ở trang 1 thì nút << bị vô hiệu hóa');
  assert.equal(prevBtn.disabled, true, 'ở trang 1 thì nút < bị vô hiệu hóa');
  assert.equal(nextBtn.disabled, false, 'ở trang 1 thì nút > có thể bấm');
  assert.equal(lastBtn.disabled, false, 'ở trang 1 thì nút >> có thể bấm');

  // Kiểm tra 50 dòng trang đầu hiển thị
  const allRows = [...doc.querySelectorAll('#employeeDirectoryTableBody tr')];
  assert.equal(allRows.length, 120, 'toàn bộ 120 dòng đều ở trong DOM');
  const visiblePage1 = allRows.filter(r => !r.hidden);
  assert.equal(visiblePage1.length, 50, 'trang 1 hiển thị đúng 50 dòng');
  assert.equal(visiblePage1[0].cells[2].textContent, 'Nhân viên 120');

  // 3. Bấm Next sang trang 2
  nextBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 2/3');
  const visiblePage2 = allRows.filter(r => !r.hidden);
  assert.equal(visiblePage2.length, 50, 'trang 2 hiển thị 50 dòng tiếp theo');
  assert.equal(visiblePage2[0].cells[2].textContent, 'Nhân viên 070');
  assert.equal(firstBtn.disabled, false);
  assert.equal(prevBtn.disabled, false);

  // 4. Bấm Last sang trang 3
  lastBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 3/3');
  const visiblePage3 = allRows.filter(r => !r.hidden);
  assert.equal(visiblePage3.length, 20, 'trang 3 hiển thị 20 dòng còn lại');
  assert.equal(nextBtn.disabled, true, 'ở trang cuối nút > bị vô hiệu hóa');
  assert.equal(lastBtn.disabled, true, 'ở trang cuối nút >> bị vô hiệu hóa');

  // 5. Kiểm tra sắp xếp: Bấm sort cột "Họ và tên" (cột 0)
  // Ban đầu tên là Nhân viên 120 -> Nhân viên 001 (giảm dần). Sort tăng dần sẽ đưa Nhân viên 001 lên đầu.
  const sortBtn = doc.querySelector('#employeeDirectoryTable thead th[data-column-key="ho-va-ten"] button.sort-button');
  assert.ok(sortBtn, 'tiêu đề cột có nút sắp xếp');
  sortBtn.click(); // Sắp xếp tăng dần theo họ tên

  // Sau khi sort: toàn bộ 120 nhân viên được sắp xếp lại, trang quay về 1
  assert.equal(pageLabel.textContent, 'Trang 1/3');
  const sortedVisiblePage1 = [...doc.querySelectorAll('#employeeDirectoryTableBody tr')].filter(r => !r.hidden);
  assert.equal(sortedVisiblePage1.length, 50);
  assert.equal(sortedVisiblePage1[0].cells[2].textContent, 'Nhân viên 001', 'sort tăng dần đưa Nhân viên 001 lên đầu trang 1');
  assert.equal(sortedVisiblePage1[49].cells[2].textContent, 'Nhân viên 050', 'dòng thứ 50 là Nhân viên 050');

  // Bấm Next ở danh sách đã sort: trang 2 phải có Nhân viên 051
  nextBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 2/3');
  const sortedVisiblePage2 = [...doc.querySelectorAll('#employeeDirectoryTableBody tr')].filter(r => !r.hidden);
  assert.equal(sortedVisiblePage2[0].cells[2].textContent, 'Nhân viên 051', 'trang 2 tiếp nối chính xác thứ tự đã sắp xếp');

  window.close();
});

test('Bảng tài khoản người dùng: có thanh trượt dọc, cụm phân trang <<, <, >, >> và sắp xếp toàn bộ dữ liệu', async () => {
  const html = fs.readFileSync(accountHtmlPath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://tokosi.example/account/#users' });
  const { window } = dom;
  const doc = window.document;

  // Tạo 110 người dùng mẫu
  const mockUsers = Array.from({ length: 110 }, (_, i) => {
    const num = String(i + 1).padStart(3, '0');
    const reverseNum = String(110 - i).padStart(3, '0');
    return {
      id: String(i + 1),
      username: `user${reverseNum}`,
      hoTen: `Người dùng ${reverseNum}`,
      vaiTro: i % 2 === 0 ? 'Kế toán' : 'Nhân viên kho',
      coSo: 'Hà Nội',
      trangThai: 'Đang hoạt động',
      ngayTao: '01/03/2026 10:00:00'
    };
  });

  const permissions = defaultsForRole('Quản lý');
  window.TKSNav = {
    authGuard: async () => ({ id: '999', username: 'manager', vaiTro: 'Quản lý', branches: ['Hà Nội', 'Sài Gòn'] }),
    can: (...keys) => keys.some(key => permissions.includes(key)),
    renderTopSidebar() {}
  };
  window.fetch = async (url) => {
    const text = String(url);
    if (text.startsWith('/api/admin/users')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ users: mockUsers }) };
    }
    if (text.includes('/permissions/catalog')) {
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ features: [] }) };
    }
    return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({}) };
  };

  [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(script => script.trim() && !script.includes('src=')).forEach(script => window.eval(script));
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  await tick();
  await tick();

  // 1. Kiểm tra wrapper và phân trang
  const scrollWrapper = doc.querySelector('#usersTable').parentElement;
  assert.ok(scrollWrapper.classList.contains('users-table-scroll'), 'khung bảng có class users-table-scroll');

  const pager = doc.getElementById('usersPagination');
  assert.ok(pager, 'tồn tại phần tử #usersPagination');
  assert.equal(pager.hidden, false, 'bộ phân trang được hiển thị');

  const firstBtn = doc.getElementById('usersFirst');
  const prevBtn = doc.getElementById('usersPrev');
  const nextBtn = doc.getElementById('usersNext');
  const lastBtn = doc.getElementById('usersLast');
  const pageLabel = doc.getElementById('usersPageLabel');

  assert.equal(firstBtn.textContent, '<<');
  assert.equal(prevBtn.textContent, '<');
  assert.equal(nextBtn.textContent, '>');
  assert.equal(lastBtn.textContent, '>>');
  assert.equal(pageLabel.textContent, 'Trang 1/3', '110 người dùng với cỡ trang 50 = 3 trang');

  // Trang 1 hiển thị 50 người dùng
  const page1Rows = [...doc.querySelectorAll('#usersTableBody tr')];
  assert.equal(page1Rows.length, 50, 'trang 1 render đúng 50 dòng');
  assert.equal(firstBtn.disabled, true);
  assert.equal(prevBtn.disabled, true);
  assert.equal(nextBtn.disabled, false);

  // 2. Bấm Next sang trang 2
  nextBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 2/3');
  const page2Rows = [...doc.querySelectorAll('#usersTableBody tr')];
  assert.equal(page2Rows.length, 50, 'trang 2 render 50 dòng tiếp theo');
  assert.equal(firstBtn.disabled, false);

  // 3. Bấm Last sang trang 3
  lastBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 3/3');
  const page3Rows = [...doc.querySelectorAll('#usersTableBody tr')];
  assert.equal(page3Rows.length, 10, 'trang 3 render 10 dòng còn lại');
  assert.equal(nextBtn.disabled, true);
  assert.equal(lastBtn.disabled, true);

  // 4. Kiểm tra Sắp xếp không bị ảnh hưởng bởi phân trang
  // Gọi handleSort('hoTen'): sort toàn bộ 110 người dùng theo Họ và tên tăng dần
  window.handleSort('hoTen');
  assert.equal(pageLabel.textContent, 'Trang 1/3', 'khi sắp xếp, trang tự động quay về trang 1');
  const sortedPage1Rows = [...doc.querySelectorAll('#usersTableBody tr')];
  assert.equal(sortedPage1Rows.length, 50);
  assert.match(sortedPage1Rows[0].textContent, /Người dùng 001/, 'người dùng 001 được xếp đầu trang 1');
  assert.match(sortedPage1Rows[49].textContent, /Người dùng 050/, 'người dùng 050 xếp ở vị trí 50');

  // Chuyển sang trang 2 của danh sách đã sắp xếp
  nextBtn.click();
  assert.equal(pageLabel.textContent, 'Trang 2/3');
  const sortedPage2Rows = [...doc.querySelectorAll('#usersTableBody tr')];
  assert.match(sortedPage2Rows[0].textContent, /Người dùng 051/, 'trang 2 tiếp nối người dùng 051');

  window.close();
});
