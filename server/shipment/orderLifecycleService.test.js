'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshService(rows) {
  const repoPath = require.resolve('./orderLifecycleRepository');
  const servicePath = require.resolve('./orderLifecycleService');
  const previousRepo = require.cache[repoPath];

  const repoExports = { readAll: async () => rows };

  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: repoExports
  };
  delete require.cache[servicePath];
  const service = require('./orderLifecycleService');

  return {
    service,
    restore() {
      delete require.cache[servicePath];
      if (previousRepo) require.cache[repoPath] = previousRepo;
      else delete require.cache[repoPath];
    }
  };
}

function record(overrides) {
  return Object.assign({
    orderCode: 'HD001',
    saleName: '',
    saleSentAt: '',
    accountantApprovedOrderAt: '',
    driverName: '',
    driverConfirmedDeliveryAt: '',
    accountantApprovedDeliveryAt: '',
    deliveryConfirmedAt: '',
    _branch: 'HN'
  }, overrides);
}

test('computeStatus: không có gì -> NOT_SENT (Đơn chưa gửi kế toán)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({}));
    assert.equal(status.code, ctx.service.STATUS.NOT_SENT);
    assert.equal(status.label, 'Đơn chưa gửi kế toán');
    assert.equal(status.at, null);
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột C có giá trị, F trống -> SENT_TO_ACCOUNTANT kèm sale + thời gian', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({ saleName: 'Sale A', saleSentAt: '01/09/2026 08:00' }));
    assert.equal(status.code, ctx.service.STATUS.SENT_TO_ACCOUNTANT);
    assert.equal(status.label, 'Đơn đã gửi kế toán');
    assert.equal(status.actor, 'Sale A');
    assert.equal(status.at, '01/09/2026 08:00');
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột F có giá trị, H trống -> DELIVERING kèm lái xe + thời gian', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      saleName: 'Sale A', saleSentAt: '01/09/2026 08:00',
      driverName: 'Lái xe B', driverConfirmedDeliveryAt: '02/09/2026 09:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.DELIVERING);
    assert.equal(status.label, 'Đơn đang được giao');
    assert.equal(status.actor, 'Lái xe B');
    assert.equal(status.at, '02/09/2026 09:00');
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột H có giá trị -> DELIVERED kèm thời gian', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      saleSentAt: '01/09/2026', driverConfirmedDeliveryAt: '02/09/2026',
      deliveryConfirmedAt: '03/09/2026 10:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.DELIVERED);
    assert.equal(status.label, 'Đơn đã giao thành công');
    assert.equal(status.at, '03/09/2026 10:00');
  } finally {
    ctx.restore();
  }
});

test('computeStatus edge case: D có giá trị nhưng C trống -> vẫn NOT_SENT (không đọc D)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({ accountantApprovedOrderAt: '01/09/2026' }));
    assert.equal(status.code, ctx.service.STATUS.NOT_SENT);
  } finally {
    ctx.restore();
  }
});

test('computeStatus edge case: G có giá trị nhưng F trống -> vẫn SENT_TO_ACCOUNTANT (không đọc G)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      saleName: 'Sale A', saleSentAt: '01/09/2026',
      accountantApprovedDeliveryAt: '02/09/2026'
    }));
    assert.equal(status.code, ctx.service.STATUS.SENT_TO_ACCOUNTANT);
  } finally {
    ctx.restore();
  }
});

test('findOrder: mã không tồn tại trong sheet -> found:false, summary NOT_SENT', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', saleSentAt: '01/09/2026' })]);
  try {
    const result = await ctx.service.findOrder('HD999');
    assert.equal(result.found, false);
    assert.equal(result.summary.code, ctx.service.STATUS.NOT_SENT);
    assert.equal(result.detail, undefined);
  } finally {
    ctx.restore();
  }
});

test('findOrder: mã rỗng -> found:false, không gọi readAll thất bại', async () => {
  const ctx = freshService([record({})]);
  try {
    const result = await ctx.service.findOrder('   ');
    assert.equal(result.found, false);
  } finally {
    ctx.restore();
  }
});

test('findOrder: khớp mã không phân biệt hoa/thường và khoảng trắng, trả đủ chi tiết + branch', async () => {
  const ctx = freshService([record({
    orderCode: 'HD001', saleName: 'Sale A', saleSentAt: '01/09/2026', _branch: 'SG'
  })]);
  try {
    const result = await ctx.service.findOrder('  hd001  ');
    assert.equal(result.found, true);
    assert.equal(result.branch, 'SG');
    assert.equal(result.summary.code, ctx.service.STATUS.SENT_TO_ACCOUNTANT);
    assert.equal(result.detail.orderCode, 'HD001');
    assert.equal(result.detail.saleName, 'Sale A');
  } finally {
    ctx.restore();
  }
});

test('listAllOrders: lọc theo branch và giữ nguyên thứ tự hàng trong sheet', async () => {
  const ctx = freshService([
    record({ orderCode: 'HD001', _branch: 'HN' }),
    record({ orderCode: 'HD002', _branch: 'SG' }),
    record({ orderCode: 'HD003', _branch: 'HN' })
  ]);
  try {
    const all = await ctx.service.listAllOrders();
    assert.deepEqual(all.map(o => o.orderCode), ['HD001', 'HD002', 'HD003']);

    const hnOnly = await ctx.service.listAllOrders('HN');
    assert.deepEqual(hnOnly.map(o => o.orderCode), ['HD001', 'HD003']);
  } finally {
    ctx.restore();
  }
});
