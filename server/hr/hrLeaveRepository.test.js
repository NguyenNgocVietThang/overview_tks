'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshRepository(sheetValues) {
  const clientPath = require.resolve('../sheets/hrSheetsClient');
  const repoPath = require.resolve('./hrLeaveRepository');
  const previousClient = require.cache[clientPath];
  const appendedRows = [];
  const updatedRows = [];

  // Mock day du contract cua hrSheetsClient, ke ca getHrClient(branch): repo
  // luon lay client theo co so truoc khi doc/ghi. Mock tra ve chinh no cho moi
  // co so — test nay khong quan tam co so, chi quan tam schema/loc du lieu.
  const clientExports = {
    hrGetValues: async () => sheetValues,
    hrAppendRow: async (_sheet, row) => { appendedRows.push(row); },
    hrUpdateRow: async (_sheet, rowIndex, row) => { updatedRows.push({ rowIndex, row }); },
    invalidateHrSheetCache() {},
    getHrClient: () => clientExports
  };

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: clientExports
  };
  delete require.cache[repoPath];
  const repo = require('./hrLeaveRepository');

  return {
    repo,
    appendedRows,
    updatedRows,
    restore() {
      delete require.cache[repoPath];
      if (previousClient) require.cache[clientPath] = previousClient;
      else delete require.cache[clientPath];
    }
  };
}

test('schema nghỉ phép chỉ dùng thời gian gửi và tổng buổi/ngày quy đổi', () => {
  const ctx = freshRepository([]);
  try {
    assert.deepEqual(ctx.repo.LEAVE_SCHEMA_HEADERS.slice(8, 13), [
      'Thời gian gửi',
      'Thời gian bắt đầu',
      'Thời gian kết thúc',
      'Tổng buổi nghỉ',
      'Tổng ngày nghỉ quy đổi'
    ]);
    assert.deepEqual(ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.slice(8, 13), [
      'thoi_gian_gui',
      'thoi_gian_bat_dau',
      'thoi_gian_ket_thuc',
      'tong_buoi_nghi',
      'tong_ngay_nghi'
    ]);
    assert.equal(ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.includes('tong_gio_nghi'), false);
    assert.equal(ctx.repo.LEAVE_STATUS.VIOLATION, 'Vi phạm');
  } finally {
    ctx.restore();
  }
});

test('Telegram link schema appends immutable User ID without shifting legacy columns', () => {
  const ctx = freshRepository([]);
  try {
    assert.equal(ctx.repo.LINK_SCHEMA_HEADERS.at(-1), 'User ID');
    assert.equal(ctx.repo.LINK_SCHEMA_FIELD_KEYS.at(-1), 'user_id');
    assert.deepEqual(ctx.repo.LINK_SCHEMA_FIELD_KEYS.slice(0, 3), ['link_code', 'web_username', 'status']);
  } finally {
    ctx.restore();
  }
});

test('upsertAutomaticLink creates a one-to-one Telegram link with immutable user ID', async () => {
  const ctx = freshRepository([ctxHeaders()]);
  try {
    const link = await ctx.repo.upsertAutomaticLink({
      userId: 'u1', webUsername: 'a@example.com', chatId: '123456', telegramUsername: '@a'
    });
    assert.equal(link.user_id, 'u1');
    assert.equal(link.telegram_chat_id, '123456');
    assert.equal(ctx.appendedRows.length, 1);
    assert.equal(ctx.appendedRows[0].at(-1), 'u1');
  } finally {
    ctx.restore();
  }
});

test('upsertAutomaticLink refuses a Telegram ID already linked to another account', async () => {
  const ctx = freshRepository([
    ctxHeaders(),
    ['', 'other@example.com', 'DA_LIEN_KET', '123456', '@other', '', '', '', 'u2']
  ]);
  try {
    await assert.rejects(
      ctx.repo.upsertAutomaticLink({ userId: 'u1', webUsername: 'a@example.com', chatId: '123456' }),
      err => err.code === 'TELEGRAM_LINK_CONFLICT'
    );
    assert.equal(ctx.appendedRows.length, 0);
  } finally {
    ctx.restore();
  }
});

function ctxHeaders() {
  return ['Mã liên kết', 'Tài khoản web', 'Trạng thái', 'Telegram chat_id', 'Telegram username', 'Thời gian tạo', 'Thời gian hết hạn', 'Thời gian liên kết', 'User ID'];
}

test('createLeaveRequest ghi số buổi và tự quy đổi số ngày', async () => {
  const ctx = freshRepository([]);
  try {
    const record = await ctx.repo.createLeaveRequest({
      ho_ten: 'Nguyễn A',
      thoi_gian_gui: '2026-08-22T08:00:00.000Z',
      thoi_gian_bat_dau: 'Sáng 22/08/2026',
      thoi_gian_ket_thuc: 'Chiều 24/08/2026',
      tong_buoi_nghi: 4,
      trang_thai: ctx.repo.LEAVE_STATUS.VIOLATION
    });

    assert.equal(record.tong_buoi_nghi, 4);
    assert.equal(record.tong_ngay_nghi, 2);
    assert.equal(record.trang_thai, 'Vi phạm');
    const row = ctx.appendedRows[0];
    assert.equal(row[ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.indexOf('tong_buoi_nghi')], 4);
    assert.equal(row[ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.indexOf('tong_ngay_nghi')], 2);
  } finally {
    ctx.restore();
  }
});

test('tin_nhan là cột cuối cùng, thêm vào không xáo trộn vị trí cột cũ', () => {
  const ctx = freshRepository([]);
  try {
    assert.equal(ctx.repo.LEAVE_SCHEMA_HEADERS.at(-1), 'Tin nhắn');
    assert.equal(ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.at(-1), 'tin_nhan');
    assert.equal(ctx.repo.LEAVE_SCHEMA_HEADERS.length, 23);
    assert.equal(ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.length, 23);
    assert.equal(ctx.repo.LEAVE_SCHEMA_FIELD_KEYS.indexOf('updated_at'), 21);
  } finally {
    ctx.restore();
  }
});

test('createLeaveRequest ghi tin_nhan và mặc định rỗng nếu không truyền', async () => {
  const ctx = freshRepository([]);
  try {
    const record = await ctx.repo.createLeaveRequest({
      ho_ten: 'Nguyễn A',
      tong_buoi_nghi: 2,
      tin_nhan: 'Em xin nghỉ ngày mai vì việc gia đình'
    });
    assert.equal(record.tin_nhan, 'Em xin nghỉ ngày mai vì việc gia đình');
    const row = ctx.appendedRows[0];
    assert.equal(row.at(-1), 'Em xin nghỉ ngày mai vì việc gia đình');

    const withoutMessage = await ctx.repo.createLeaveRequest({ ho_ten: 'Nguyễn B', tong_buoi_nghi: 1 });
    assert.equal(withoutMessage.tin_nhan, '');
    assert.equal(ctx.appendedRows[1].at(-1), '');
  } finally {
    ctx.restore();
  }
});

test('createLeaveRequest trung hòa công thức trong tin_nhan trước khi ghi Sheet', async () => {
  const ctx = freshRepository([]);
  try {
    const rawMessage = '=IMPORTDATA("https://example.invalid")';
    const record = await ctx.repo.createLeaveRequest({
      ho_ten: 'Nguyễn A',
      tong_buoi_nghi: 1,
      tin_nhan: rawMessage
    });

    assert.equal(record.tin_nhan, rawMessage);
    assert.equal(ctx.appendedRows[0].at(-1), `'${rawMessage}`);
  } finally {
    ctx.restore();
  }
});

test('updateLeaveRequestStatus tiếp tục trung hòa công thức trong tin_nhan', async () => {
  const schemaCtx = freshRepository([]);
  const keys = schemaCtx.repo.LEAVE_SCHEMA_FIELD_KEYS;
  schemaCtx.restore();
  const rawMessage = '=IMPORTDATA("https://example.invalid")';
  const existingRow = keys.map(key => ({
    request_id: 'NP-FORMULA',
    trang_thai: 'Chờ duyệt',
    tin_nhan: rawMessage
  })[key] || '');
  const ctx = freshRepository([keys, existingRow]);
  try {
    await ctx.repo.updateLeaveRequestStatus('NP-FORMULA', {
      status: ctx.repo.LEAVE_STATUS.APPROVED,
      approver: 'Quản lý',
      note: ''
    });

    assert.equal(ctx.updatedRows[0].row.at(-1), `'${rawMessage}`);
  } finally {
    ctx.restore();
  }
});

test('createLeaveRequest từ chối tổng buổi không hợp lệ', async () => {
  const ctx = freshRepository([]);
  try {
    await assert.rejects(
      () => ctx.repo.createLeaveRequest({ ho_ten: 'Nguyễn A', tong_buoi_nghi: 'không phải số' }),
      err => err.code === 'INVALID_TOTAL_SESSIONS'
    );
    assert.equal(ctx.appendedRows.length, 0);
  } finally {
    ctx.restore();
  }
});

test('getLeaveRequests lọc from/to theo ngày xin nghỉ thực tế', async () => {
  const ctxForSchema = freshRepository([]);
  const keys = ctxForSchema.repo.LEAVE_SCHEMA_FIELD_KEYS;
  ctxForSchema.restore();
  const row = values => keys.map(key => values[key] == null ? '' : values[key]);
  const rows = [
    keys,
    row({ request_id: 'NP-1', thoi_gian_gui: '2026-08-20T17:30:00.000Z', thoi_gian_bat_dau: 'Sáng 22/08/2026', thoi_gian_ket_thuc: 'Chiều 24/08/2026', created_at: '2026-08-20T17:30:00.000Z' }),
    row({ request_id: 'NP-2', thoi_gian_gui: '2026-08-22T10:00:00.000Z', thoi_gian_bat_dau: 'Sáng 21/08/2026', thoi_gian_ket_thuc: 'Chiều 21/08/2026', created_at: '2026-08-22T10:00:00.000Z' }),
    row({ request_id: 'NP-3', thoi_gian_gui: '2026-08-22T17:30:00.000Z', thoi_gian_bat_dau: 'Sáng 25/08/2026', thoi_gian_ket_thuc: 'Chiều 26/08/2026', created_at: '2026-08-22T17:30:00.000Z' })
  ];
  const ctx = freshRepository(rows);
  try {
    const items = await ctx.repo.getLeaveRequests({ from: '2026-08-22', to: '2026-08-22' });
    assert.deepEqual(items.map(item => item.request_id), ['NP-1']);
  } finally {
    ctx.restore();
  }
});
