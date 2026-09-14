'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshRepository({ hn, sg, historyRows, historyClientOverrides }) {
  const clientPath = require.resolve('../sheets/orderLifecycleSheetsClient');
  const historyClientPath = require.resolve('../sheets/orderLifecycleHistoryClient');
  const configPath = require.resolve('../config');
  const repoPath = require.resolve('./orderLifecycleRepository');
  const previousClient = require.cache[clientPath];
  const previousHistoryClient = require.cache[historyClientPath];

  const CONFIG = require(configPath);
  const values = { [CONFIG.ORDER_LIFECYCLE_SHEET_HN]: hn || [], [CONFIG.ORDER_LIFECYCLE_SHEET_SG]: sg || [] };

  const clientExports = {
    getValues: async sheetName => values[sheetName] || []
  };

  const appendedRows = [];
  const historyClientExports = Object.assign({
    getValues: async () => historyRows || [],
    appendRow: async (sheetName, row) => { appendedRows.push({ sheetName, row }); }
  }, historyClientOverrides || {});

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: clientExports
  };
  require.cache[historyClientPath] = {
    id: historyClientPath,
    filename: historyClientPath,
    loaded: true,
    exports: historyClientExports
  };
  delete require.cache[repoPath];
  const repo = require('./orderLifecycleRepository');

  return {
    repo,
    appendedRows,
    restore() {
      delete require.cache[repoPath];
      if (previousClient) require.cache[clientPath] = previousClient;
      else delete require.cache[clientPath];
      if (previousHistoryClient) require.cache[historyClientPath] = previousHistoryClient;
      else delete require.cache[historyClientPath];
    }
  };
}

const HEADERS = [
  'Mã đơn hàng', 'Nhân viên bán hàng', 'Khách hàng', 'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn',
  'Lái xe', 'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng', 'Xác nhận đã giao/khách ký nhận',
  'Ship nhận đơn', 'Đơn đã ký nhận'
];

test('SCHEMA_HEADERS/SCHEMA_FIELD_KEYS khớp đúng 11 cột theo sheet thật', () => {
  const ctx = freshRepository({});
  try {
    assert.deepEqual(ctx.repo.SCHEMA_HEADERS, HEADERS);
    assert.deepEqual(ctx.repo.SCHEMA_FIELD_KEYS, [
      'orderCode', 'saleName', 'customerName', 'saleSentAt', 'accountantApprovedOrderAt',
      'driverName', 'driverConfirmedDeliveryAt', 'accountantApprovedDeliveryAt', 'deliveryConfirmedAt',
      'shipReceivedAt', 'orderSignedAt'
    ]);
  } finally {
    ctx.restore();
  }
});

test('rowToObject ánh xạ đúng vị trí cột, thiếu cột trả rỗng', () => {
  const ctx = freshRepository({});
  try {
    const obj = ctx.repo.rowToObject(['HD001', 'Sale A', 'KH A'], ctx.repo.SCHEMA_FIELD_KEYS);
    assert.equal(obj.orderCode, 'HD001');
    assert.equal(obj.saleName, 'Sale A');
    assert.equal(obj.customerName, 'KH A');
    assert.equal(obj.saleSentAt, '');
    assert.equal(obj.deliveryConfirmedAt, '');
  } finally {
    ctx.restore();
  }
});

test('readAll đọc cả 2 tab, gộp lại và gắn đúng _branch', async () => {
  const ctx = freshRepository({
    hn: [HEADERS, ['HD001', 'Sale A', 'KH A', '01/09/2026', '', '', '', '', '', '', '']],
    sg: [HEADERS, ['HD002', 'Sale B', 'KH B', '02/09/2026', '', '', '', '', '', '', '']]
  });
  try {
    const rows = await ctx.repo.readAll();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].orderCode, 'HD001');
    assert.equal(rows[0]._branch, ctx.repo.LIFECYCLE_BRANCH.HN);
    assert.equal(rows[1].orderCode, 'HD002');
    assert.equal(rows[1]._branch, ctx.repo.LIFECYCLE_BRANCH.SG);
  } finally {
    ctx.restore();
  }
});

test('readAll bỏ hàng trống (mọi cột rỗng)', async () => {
  const ctx = freshRepository({
    hn: [HEADERS, ['HD001', 'Sale A', 'KH A', '', '', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '', '', '', '']],
    sg: []
  });
  try {
    const rows = await ctx.repo.readAll();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].orderCode, 'HD001');
  } finally {
    ctx.restore();
  }
});

test('readAll đọc đúng theo TÊN cột kể cả khi cột bị xóa/đảo vị trí trên sheet thật (bug 2026-09-14: tab SG mất cột "Xác nhận đã giao/khách ký nhận", lệch hết cột phía sau)', async () => {
  const SHIFTED_HEADERS_MISSING_DELIVERY_CONFIRMED = [
    'Mã đơn hàng', 'Nhân Viên Bán Hàng', 'Khách hàng', 'Sale gửi đơn cho kế toán', 'Kế toán duyệt',
    'Lái Xe', 'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng',
    'Ship nhận đơn', 'Đơn đã ký nhận'
  ];
  const ctx = freshRepository({
    sg: [
      SHIFTED_HEADERS_MISSING_DELIVERY_CONFIRMED,
      ['HD000005', 'Dương', 'ANH PHONG HÀ ĐÔNG', '14/09/2026 15:22', '14/09/2026 15:22',
        'Tuấn Anh', '14/09/2026 15:20', '14/09/2026 15:21', '', '16/09/2026 15:21']
    ]
  });
  try {
    const rows = await ctx.repo.readAll();
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.orderCode, 'HD000005');
    assert.equal(row.accountantApprovedOrderAt, '14/09/2026 15:22'); // alias "Kế toán duyệt"
    assert.equal(row.accountantApprovedDeliveryAt, '14/09/2026 15:21');
    assert.equal(row.deliveryConfirmedAt, ''); // cột đã bị xóa khỏi sheet -> rỗng, không đọc nhầm cột khác
    assert.equal(row.shipReceivedAt, ''); // cột "Ship nhận đơn" đúng vị trí thật, không bị lệch
    assert.equal(row.orderSignedAt, '16/09/2026 15:21'); // "Đơn đã ký nhận" đọc đúng dù đã dịch trái 1 cột
  } finally {
    ctx.restore();
  }
});

test('readAll trả mảng rỗng khi tab không có dữ liệu (chỉ header hoặc trống hẳn)', async () => {
  const ctx = freshRepository({ hn: [HEADERS], sg: [] });
  try {
    const rows = await ctx.repo.readAll();
    assert.deepEqual(rows, []);
  } finally {
    ctx.restore();
  }
});

const HISTORY_HEADERS = [
  'Mã lịch sử', 'Mã đơn hàng', 'Mã trạng thái', 'Trạng thái mới',
  'Người thực hiện', 'Vai trò', 'Thời gian cập nhật', 'Ghi chú', 'Nội dung cập nhật'
];

test('readOverrideHistory: đọc và ánh xạ đúng cột tab "Lịch sử cập nhật"', async () => {
  const ctx = freshRepository({
    historyRows: [
      HISTORY_HEADERS,
      ['OVR-1', 'HD001', 'DELIVERING', 'Đơn đang được giao', 'Nguyễn Văn A', 'Kế toán', '2026-09-12 09:00:00', '', 'Nguyễn Văn A - Kế toán đã cập nhật đơn hàng sang trạng thái Đơn đang được giao.']
    ]
  });
  try {
    const rows = await ctx.repo.readOverrideHistory();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].order_code, 'HD001');
    assert.equal(rows[0].to_status_code, 'DELIVERING');
    assert.equal(rows[0].changed_by_role, 'Kế toán');
  } finally {
    ctx.restore();
  }
});

test('readOverrideHistory: tab "Lịch sử cập nhật" chưa tồn tại (BRANCH_NOT_CONFIGURED) -> mảng rỗng, không throw', async () => {
  const ctx = freshRepository({
    historyClientOverrides: {
      getValues: async () => { const err = new Error('chưa cấu hình'); err.code = 'BRANCH_NOT_CONFIGURED'; throw err; }
    }
  });
  try {
    const rows = await ctx.repo.readOverrideHistory();
    assert.deepEqual(rows, []);
  } finally {
    ctx.restore();
  }
});

test('readOverrideHistory: lỗi bất kỳ khác (vd tab chưa được setup script tạo, thiếu quyền Editor) -> mảng rỗng, KHÔNG throw', async () => {
  const ctx = freshRepository({
    historyClientOverrides: {
      getValues: async () => { throw new Error('Unable to parse range: \'Lịch sử cập nhật\'!A:Z'); }
    }
  });
  try {
    const rows = await ctx.repo.readOverrideHistory();
    assert.deepEqual(rows, []);
  } finally {
    ctx.restore();
  }
});

test('appendOverride: ghi đúng thứ tự cột theo HISTORY_SCHEMA_FIELD_KEYS', async () => {
  const ctx = freshRepository({});
  try {
    const entry = await ctx.repo.appendOverride({
      order_code: 'HD001',
      to_status_code: 'CANCELLED',
      to_status_label: 'Đã hủy',
      changed_by: 'Nguyễn Văn A',
      changed_by_role: 'Quản lý',
      note: 'khách huỷ đơn',
      message: 'Nguyễn Văn A - Quản lý đã cập nhật đơn hàng sang trạng thái Đã hủy.'
    });
    assert.equal(ctx.appendedRows.length, 1);
    const row = ctx.appendedRows[0].row;
    assert.equal(row[ctx.repo.HISTORY_SCHEMA_FIELD_KEYS.indexOf('order_code')], 'HD001');
    assert.equal(row[ctx.repo.HISTORY_SCHEMA_FIELD_KEYS.indexOf('to_status_code')], 'CANCELLED');
    assert.ok(entry.history_id);
    assert.ok(entry.changed_at);
  } finally {
    ctx.restore();
  }
});
