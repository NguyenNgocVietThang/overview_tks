'use strict';

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmployeeRows,
  roleForDepartment,
  DEPARTMENT_FOR_ROLE,
  findEmployeeByIdentifier,
  createEmployeeDirectory,
  HrDirectoryError
} = require('./employeeDirectory');
const { createFakeHrEmployeesRepository } = require('./testHelpers/fakeHrEmployeesRepository');

const HEADERS = ['HỌ VÀ TÊN', 'BỘ PHẬN', 'SĐT', 'EMAIL', 'ID TELEGRAM'];

test('parseEmployeeRows maps headers, normalizes identifiers and remembers source row', () => {
  const rows = [
    HEADERS,
    ['Nguyễn Ngọc Việt Thắng', 'TRỢ LÝ', '0974 089 295', ' ThangNNV2003@Gmail.com ', 6205968899]
  ];

  const [employee] = parseEmployeeRows(rows, 'Hà Nội');
  assert.deepEqual(employee, {
    sourceBranch: 'Hà Nội',
    rowIndex: 2,
    hoTen: 'Nguyễn Ngọc Việt Thắng',
    boPhan: 'TRỢ LÝ',
    email: 'thangnnv2003@gmail.com',
    soDienThoai: '0974089295',
    telegramId: '6205968899',
    sheetVaiTro: 'Trợ lý',
    sheetCoSo: 'Cả hai'
  });
});

test('roleForDepartment implements the approved department matrix', () => {
  const expected = new Map([
    ['BAN QUẢN LÝ', 'Quản lý'],
    ['TRƯỞNG CHI NHÁNH', 'Quản lý'],
    ['KẾ TOÁN', 'Kế toán'],
    ['TRƯỞNG KHO', 'Trưởng kho'],
    ['KHO', 'Nhân viên kho'],
    ['TRỢ LÝ', 'Trợ lý'],
    ['LÁI XE', 'Lái xe'],
    ['SALE', 'Nhân viên sale'],
    ['MUA HÀNG', 'Nhân viên mua hàng'],
    ['ĐẶT HÀNG', 'Nhân viên mua hàng'],
    ['MARKETING', 'Nhân viên marketing'],
    ['HẬU CẦN', 'Khách'],
    ['BẢO VỆ', 'Khách'],
    ['BỘ PHẬN MỚI', 'Khách']
  ]);
  for (const [department, role] of expected) {
    assert.equal(roleForDepartment(department), role, department);
  }
});

test('findEmployeeByIdentifier accepts email or normalized Vietnamese phone', () => {
  const employees = parseEmployeeRows([
    HEADERS,
    ['A', 'KHO', '0912 345 678', 'a@example.com', '']
  ], 'Hà Nội');

  assert.equal(findEmployeeByIdentifier(employees, ' A@EXAMPLE.COM ').hoTen, 'A');
  assert.equal(findEmployeeByIdentifier(employees, '+84 912 345 678').hoTen, 'A');
});

test('findEmployeeByIdentifier rejects duplicate or split identity matches', () => {
  const duplicate = parseEmployeeRows([
    HEADERS,
    ['A', 'KHO', '0912345678', 'a@example.com', ''],
    ['B', 'SALE', '0987654321', 'a@example.com', '']
  ], 'Hà Nội');
  assert.throws(
    () => findEmployeeByIdentifier(duplicate, 'a@example.com'),
    err => err instanceof HrDirectoryError && err.code === 'HR_IDENTITY_CONFLICT'
  );

  assert.throws(
    () => findEmployeeByIdentifier(duplicate, { email: 'a@example.com', phone: '0987654321' }),
    err => err instanceof HrDirectoryError && err.code === 'HR_IDENTITY_CONFLICT'
  );
});

test('directory cache is fresh for 10 seconds and stale-on-error for 15 minutes', async () => {
  let now = 1_000;
  const repo = createFakeHrEmployeesRepository([
    { id: 1, branch: 'hanoi', hoTen: 'A', boPhan: 'KHO', soDienThoai: '0912345678', email: 'a@example.com', telegramId: '' }
  ]);
  const directory = createEmployeeDirectory({ now: () => now, repo });

  assert.equal((await directory.getSnapshot()).employees.length, 1);
  now += 9_000;
  await directory.getSnapshot();
  assert.equal(repo.calls, 1);

  repo.setShouldFail(true);
  now += 2_000;
  const stale = await directory.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(repo.calls, 2);

  now += 15 * 60 * 1000;
  await assert.rejects(
    directory.getSnapshot(),
    err => err.code === 'HR_DIRECTORY_UNAVAILABLE' && err.statusCode === 503
  );
});

test('updateEmployeeContact writes one verified field to the source HR row and preserves other cells', async () => {
  const repo = createFakeHrEmployeesRepository([
    { id: 1, branch: 'hanoi', hoTen: 'A', boPhan: 'KHO', soDienThoai: '0912345678', email: 'a@example.com', telegramId: '123' }
  ]);
  const directory = createEmployeeDirectory({ repo });
  const employee = (await directory.getSnapshot()).employees[0];
  const updated = await directory.updateEmployeeContact(employee, 'email', 'new@example.com');
  assert.equal(updated.email, 'new@example.com');

  const refreshed = (await directory.getSnapshot({ forceRefresh: true })).employees[0];
  assert.equal(refreshed.email, 'new@example.com');
  assert.equal(refreshed.soDienThoai, '0912345678', 'các cột khác không bị đụng tới');
});

test('updateEmployeeContact rejects a value already used by another HR row', async () => {
  const repo = createFakeHrEmployeesRepository([
    { id: 1, branch: 'hanoi', hoTen: 'A', boPhan: 'KHO', soDienThoai: '0912345678', email: 'a@example.com', telegramId: '' },
    { id: 2, branch: 'hanoi', hoTen: 'B', boPhan: 'SALE', soDienThoai: '0987654321', email: 'b@example.com', telegramId: '' }
  ]);
  const directory = createEmployeeDirectory({ repo });
  const employee = (await directory.getSnapshot()).employees[0];
  await assert.rejects(
    directory.updateEmployeeContact(employee, 'phone', '0987654321'),
    err => err.code === 'HR_IDENTITY_CONFLICT'
  );
});

test('writeDepartmentForRole overwrites BỘ PHẬN with the canonical department for the new role', async () => {
  const repo = createFakeHrEmployeesRepository([
    { id: 1, branch: 'hanoi', hoTen: 'A', boPhan: 'KHO', soDienThoai: '0912345678', email: 'a@example.com', telegramId: '' }
  ]);
  const directory = createEmployeeDirectory({ repo });

  const result = await directory.writeDepartmentForRole('Hà Nội', 1, 'Kế toán');

  assert.equal(result, true);
  const refreshed = (await directory.getSnapshot({ forceRefresh: true })).employees[0];
  assert.equal(refreshed.boPhan, 'KẾ TOÁN');
});

test('writeDepartmentForRole is a no-op for the Khách role (no unique department to write back)', async () => {
  const repo = createFakeHrEmployeesRepository([
    { id: 1, branch: 'hanoi', hoTen: 'A', boPhan: 'KHO', soDienThoai: '0912345678', email: 'a@example.com', telegramId: '' }
  ]);
  const directory = createEmployeeDirectory({ repo });

  const result = await directory.writeDepartmentForRole('Hà Nội', 1, 'Khách');

  assert.equal(result, false);
  const unchanged = (await directory.getSnapshot({ forceRefresh: true })).employees[0];
  assert.equal(unchanged.boPhan, 'KHO');
});

test('writeDepartmentForRole is a no-op when branch or row index is missing', async () => {
  const repo = createFakeHrEmployeesRepository([]);
  const directory = createEmployeeDirectory({ repo });

  assert.equal(await directory.writeDepartmentForRole('', 2, 'Kế toán'), false);
  assert.equal(await directory.writeDepartmentForRole('Hà Nội', 0, 'Kế toán'), false);
});

test('bo phan MARKETING anh xa hai chieu sang vai tro Nhan vien marketing', () => {
  for (const variant of ['MARKETING', 'Marketing', ' marketing ']) {
    assert.equal(roleForDepartment(variant), 'Nhân viên marketing', variant);
  }
  assert.equal(DEPARTMENT_FOR_ROLE['Nhân viên marketing'], 'MARKETING');
  assert.equal(roleForDepartment(DEPARTMENT_FOR_ROLE['Nhân viên marketing']), 'Nhân viên marketing');
});
