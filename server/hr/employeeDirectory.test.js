'use strict';

process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseEmployeeRows,
  roleForDepartment,
  findEmployeeByIdentifier,
  createEmployeeDirectory,
  HrDirectoryError
} = require('./employeeDirectory');

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
    ['MARKETING', 'Khách'],
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
  let calls = 0;
  let shouldFail = false;
  const directory = createEmployeeDirectory({
    now: () => now,
    branches: () => ['Hà Nội'],
    getClient: () => ({
      hrGetValues: async () => {
        calls += 1;
        if (shouldFail) throw new Error('google down');
        return [HEADERS, ['A', 'KHO', '0912345678', 'a@example.com', '']];
      }
    })
  });

  assert.equal((await directory.getSnapshot()).employees.length, 1);
  now += 9_000;
  await directory.getSnapshot();
  assert.equal(calls, 1);

  shouldFail = true;
  now += 2_000;
  const stale = await directory.getSnapshot();
  assert.equal(stale.stale, true);
  assert.equal(calls, 2);

  now += 15 * 60 * 1000;
  await assert.rejects(
    directory.getSnapshot(),
    err => err.code === 'HR_DIRECTORY_UNAVAILABLE' && err.statusCode === 503
  );
});

test('updateEmployeeContact writes one verified field to the source HR row and preserves other cells', async () => {
  let values = [HEADERS, ['A', 'KHO', '0912345678', 'a@example.com', '123']];
  let written = null;
  const client = {
    hrGetValues: async () => values.map(row => [...row]),
    hrUpdateRow: async (sheet, rowIndex, row) => { written = { sheet, rowIndex, row }; values[rowIndex - 1] = row; },
    invalidateHrSheetCache: () => {}
  };
  const directory = createEmployeeDirectory({ branches: () => ['Hà Nội'], getClient: () => client });
  const employee = (await directory.getSnapshot()).employees[0];
  const updated = await directory.updateEmployeeContact(employee, 'email', 'new@example.com');
  assert.deepEqual(written, {
    sheet: 'Danh sách nhân sự', rowIndex: 2,
    row: ['A', 'KHO', '0912345678', 'new@example.com', '123']
  });
  assert.equal(updated.email, 'new@example.com');
});

test('updateEmployeeContact rejects a value already used by another HR row', async () => {
  const values = [
    HEADERS,
    ['A', 'KHO', '0912345678', 'a@example.com', ''],
    ['B', 'SALE', '0987654321', 'b@example.com', '']
  ];
  const directory = createEmployeeDirectory({
    branches: () => ['Hà Nội'],
    getClient: () => ({ hrGetValues: async () => values, hrUpdateRow: async () => assert.fail('must not write') })
  });
  const employee = (await directory.getSnapshot()).employees[0];
  await assert.rejects(
    directory.updateEmployeeContact(employee, 'phone', '0987654321'),
    err => err.code === 'HR_IDENTITY_CONFLICT'
  );
});
