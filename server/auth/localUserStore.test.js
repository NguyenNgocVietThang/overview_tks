'use strict';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const HEADERS = ['ID', 'Họ tên', 'Tài khoản đăng nhập', 'Mật khẩu (bcrypt hash)', 'Vai trò', 'Cơ sở phụ trách', 'Trạng thái tài khoản', 'Ngày tạo', 'Đăng nhập gần nhất', 'Email', 'Số điện thoại', 'Email khôi phục', 'SĐT khôi phục'];

// Mirror pattern trong hrLeaveRepository.test.js: thay require.cache cua
// usersSheetsClient TRUOC khi require lai localUserStore, roi initStore vao
// 1 file tam rieng cho tung test (cach ly hoan toan, khong dung chung state).
function freshStore(sheetValues, mockOverrides = {}) {
  const clientPath = require.resolve('../sheets/usersSheetsClient');
  const storePath = require.resolve('./localUserStore');
  const previousClient = require.cache[clientPath];

  const appendedRows = [];
  const updatedRows = [];

  const clientExports = {
    usersGetValues: async () => sheetValues,
    usersAppendRow: async (_sheet, row) => { appendedRows.push(row); },
    usersUpdateRow: async (_sheet, rowIndex, row) => { updatedRows.push({ rowIndex, row }); },
    ...mockOverrides
  };

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: clientExports
  };
  delete require.cache[storePath];
  const store = require('./localUserStore');

  const tempPath = path.join(os.tmpdir(), `test-localuserstore-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  store.initStore(tempPath);

  return {
    store,
    appendedRows,
    updatedRows,
    restore() {
      delete require.cache[storePath];
      if (previousClient) require.cache[clientPath] = previousClient;
      else delete require.cache[clientPath];
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch (e) {}
      }
    }
  };
}

function withSyncEnabled(fn) {
  const previous = process.env.USERS_SHEET_SYNC_ENABLED;
  process.env.USERS_SHEET_SYNC_ENABLED = 'true';
  return Promise.resolve(fn()).finally(() => {
    if (previous === undefined) delete process.env.USERS_SHEET_SYNC_ENABLED;
    else process.env.USERS_SHEET_SYNC_ENABLED = previous;
  });
}

test('hydrateFromSheets: nap dung du lieu tu Sheets va van giu bat bien admin cung', async () => {
  const { store, restore } = freshStore([
    HEADERS,
    ['u1', 'Kế Toán A', 'ketoan1', 'hash1', 'Kế toán', 'An Khánh', 'Đang hoạt động', '01/01/2026', '', '', '', '', '']
  ]);
  try {
    await withSyncEnabled(() => store.hydrateFromSheets());
    const users = await store.getAllUsers();
    const ketoan = users.find(u => u.username === 'ketoan1');
    assert.ok(ketoan);
    assert.equal(ketoan.vaiTro, 'Kế toán');

    const thang = users.find(u => u.email === 'thangnnv2003@gmail.com');
    assert.ok(thang, 'ensureHardcodedAdmins phai tu them lai admin cung neu Sheets khong co');
    assert.equal(thang.vaiTro, 'Quản lý');
  } finally {
    restore();
  }
});

test('hydrateFromSheets: khong bi tat khi USERS_SHEET_SYNC_ENABLED khong bat (mac dinh tat o local/test)', async () => {
  const { store, restore } = freshStore([
    HEADERS,
    ['u1', 'Kế Toán A', 'ketoan1', 'hash1', 'Kế toán', 'An Khánh', 'Đang hoạt động', '', '', '', '', '', '']
  ]);
  try {
    delete process.env.USERS_SHEET_SYNC_ENABLED;
    await store.hydrateFromSheets();
    const users = await store.getAllUsers();
    assert.ok(!users.some(u => u.username === 'ketoan1'), 'khong duoc goi Sheets khi flag tat');
  } finally {
    restore();
  }
});

test('hydrateFromSheets: Sheets loi -> khong throw, giu nguyen du lieu cuc bo', async () => {
  const { store, restore } = freshStore(null, {
    usersGetValues: async () => { throw new Error('gia lap mat mang'); }
  });
  try {
    const before = await store.getAllUsers();
    await withSyncEnabled(() => store.hydrateFromSheets());
    const after = await store.getAllUsers();
    assert.deepEqual(after.map(u => u.id).sort(), before.map(u => u.id).sort());
  } finally {
    restore();
  }
});

test('createUser: tai khoan moi -> day len Sheets (append) khi bat sync', async () => {
  const { store, appendedRows, restore } = freshStore([HEADERS]);
  try {
    await withSyncEnabled(() => store.createUser({
      username: 'nv_moi',
      hoTen: 'Nhân Viên Mới',
      vaiTro: 'Kế toán',
      coSo: 'An Khánh',
      passwordHash: 'hash-xyz'
    }));
    assert.equal(appendedRows.length, 1);
    const usernameCol = HEADERS.indexOf('Tài khoản đăng nhập');
    assert.equal(appendedRows[0][usernameCol], 'nv_moi');
  } finally {
    restore();
  }
});

test('createUser: khong day len Sheets khi tat sync (mac dinh o local/test)', async () => {
  const { store, appendedRows, restore } = freshStore([HEADERS]);
  try {
    delete process.env.USERS_SHEET_SYNC_ENABLED;
    await store.createUser({ username: 'nv_moi_2', hoTen: 'A', vaiTro: 'Kế toán' });
    assert.equal(appendedRows.length, 0);
  } finally {
    restore();
  }
});

test('updateUser: doi truong duoc theo doi (vaiTro) -> day update len Sheets', async () => {
  const { store, updatedRows, restore } = freshStore(null); // sheetValues khong dung toi vi mock rieng usersGetValues ben duoi
  try {
    const created = await store.createUser({ username: 'nv_role', hoTen: 'A', vaiTro: 'Trợ lý' });
    // Mock usersGetValues tra ve 1 hang co san khop ID de pushUserToSheet tim thay va update thay vi append.
    const clientPath = require.resolve('../sheets/usersSheetsClient');
    require.cache[clientPath].exports.usersGetValues = async () => [
      HEADERS,
      [created.id, 'A', 'nv_role', '', 'Trợ lý', '', 'Đang hoạt động', created.ngayTao, '', '', '', '', '']
    ];

    await withSyncEnabled(() => store.updateUser(created.id, { vaiTro: 'Kế toán' }));
    assert.equal(updatedRows.length, 1);
    const roleCol = HEADERS.indexOf('Vai trò');
    assert.equal(updatedRows[0].row[roleCol], 'Kế toán');
  } finally {
    restore();
  }
});

test('updateUser: chi doi dangNhapGanNhat -> KHONG day len Sheets', async () => {
  const { store, appendedRows, updatedRows, restore } = freshStore([HEADERS]);
  try {
    const created = await store.createUser({ username: 'nv_login', hoTen: 'A', vaiTro: 'Trợ lý' });
    appendedRows.length = 0; // bo qua lan append luc tao

    await withSyncEnabled(() => store.updateUser(created.id, { dangNhapGanNhat: '07/09/2026' }));
    assert.equal(appendedRows.length, 0);
    assert.equal(updatedRows.length, 0);
  } finally {
    restore();
  }
});
