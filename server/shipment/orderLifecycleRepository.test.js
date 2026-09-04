'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshRepository({ hn, sg }) {
  const clientPath = require.resolve('../sheets/orderLifecycleSheetsClient');
  const configPath = require.resolve('../config');
  const repoPath = require.resolve('./orderLifecycleRepository');
  const previousClient = require.cache[clientPath];

  const CONFIG = require(configPath);
  const values = { [CONFIG.ORDER_LIFECYCLE_SHEET_HN]: hn || [], [CONFIG.ORDER_LIFECYCLE_SHEET_SG]: sg || [] };

  const clientExports = {
    getValues: async sheetName => values[sheetName] || []
  };

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: clientExports
  };
  delete require.cache[repoPath];
  const repo = require('./orderLifecycleRepository');

  return {
    repo,
    restore() {
      delete require.cache[repoPath];
      if (previousClient) require.cache[clientPath] = previousClient;
      else delete require.cache[clientPath];
    }
  };
}

const HEADERS = [
  'Mã đơn hàng', 'Nhân viên bán hàng', 'Sale gửi đơn cho kế toán', 'Kế toán duyệt đơn',
  'Lái xe', 'Tài xế gửi xác nhận giao hàng', 'Kế toán duyệt giao hàng', 'Xác nhận đã giao/khách ký nhận'
];

test('SCHEMA_HEADERS/SCHEMA_FIELD_KEYS khớp đúng 8 cột theo spec', () => {
  const ctx = freshRepository({});
  try {
    assert.deepEqual(ctx.repo.SCHEMA_HEADERS, HEADERS);
    assert.deepEqual(ctx.repo.SCHEMA_FIELD_KEYS, [
      'orderCode', 'saleName', 'saleSentAt', 'accountantApprovedOrderAt',
      'driverName', 'driverConfirmedDeliveryAt', 'accountantApprovedDeliveryAt', 'deliveryConfirmedAt'
    ]);
  } finally {
    ctx.restore();
  }
});

test('rowToObject ánh xạ đúng vị trí cột, thiếu cột trả rỗng', () => {
  const ctx = freshRepository({});
  try {
    const obj = ctx.repo.rowToObject(['HD001', 'Sale A'], ctx.repo.SCHEMA_FIELD_KEYS);
    assert.equal(obj.orderCode, 'HD001');
    assert.equal(obj.saleName, 'Sale A');
    assert.equal(obj.saleSentAt, '');
    assert.equal(obj.deliveryConfirmedAt, '');
  } finally {
    ctx.restore();
  }
});

test('readAll đọc cả 2 tab, gộp lại và gắn đúng _branch', async () => {
  const ctx = freshRepository({
    hn: [HEADERS, ['HD001', 'Sale A', '01/09/2026', '', '', '', '', '']],
    sg: [HEADERS, ['HD002', 'Sale B', '02/09/2026', '', '', '', '', '']]
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
    hn: [HEADERS, ['HD001', 'Sale A', '', '', '', '', '', ''], ['', '', '', '', '', '', '', '']],
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

test('readAll trả mảng rỗng khi tab không có dữ liệu (chỉ header hoặc trống hẳn)', async () => {
  const ctx = freshRepository({ hn: [HEADERS], sg: [] });
  try {
    const rows = await ctx.repo.readAll();
    assert.deepEqual(rows, []);
  } finally {
    ctx.restore();
  }
});
