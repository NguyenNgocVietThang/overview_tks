'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshRepository(sheetValues) {
  const clientPath = require.resolve('../sheets/hrSheetsClient');
  const repoPath = require.resolve('./hrLeaveRepository');
  const previousClient = require.cache[clientPath];
  const appendedRows = [];

  // Mock day du contract cua hrSheetsClient, ke ca getHrClient(branch): repo
  // luon lay client theo co so truoc khi doc/ghi. Mock tra ve chinh no cho moi
  // co so — test nay khong quan tam co so, chi quan tam schema/loc du lieu.
  const clientExports = {
    hrGetValues: async () => sheetValues,
    hrAppendRow: async (_sheet, row) => { appendedRows.push(row); },
    hrUpdateRow: async () => {},
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

test('getLeaveRequests lọc from/to theo thời gian gửi, không theo ngày nghỉ', async () => {
  const ctxForSchema = freshRepository([]);
  const keys = ctxForSchema.repo.LEAVE_SCHEMA_FIELD_KEYS;
  ctxForSchema.restore();
  const row = values => keys.map(key => values[key] == null ? '' : values[key]);
  const rows = [
    keys,
    row({ request_id: 'NP-1', thoi_gian_gui: '2026-08-21T17:30:00.000Z', thoi_gian_bat_dau: 'Sáng 25/08/2026', created_at: '2026-08-21T17:30:00.000Z' }),
    row({ request_id: 'NP-2', thoi_gian_gui: '2026-08-22T10:00:00.000Z', thoi_gian_bat_dau: 'Sáng 21/08/2026', created_at: '2026-08-22T10:00:00.000Z' }),
    row({ request_id: 'NP-3', thoi_gian_gui: '2026-08-22T17:30:00.000Z', thoi_gian_bat_dau: 'Sáng 22/08/2026', created_at: '2026-08-22T17:30:00.000Z' })
  ];
  const ctx = freshRepository(rows);
  try {
    const items = await ctx.repo.getLeaveRequests({ from: '2026-08-22', to: '2026-08-22' });
    assert.deepEqual(items.map(item => item.request_id), ['NP-2', 'NP-1']);
  } finally {
    ctx.restore();
  }
});
