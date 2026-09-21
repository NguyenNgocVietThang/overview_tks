'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function freshService(rows, historyRows) {
  const repoPath = require.resolve('./orderLifecycleRepository');
  const servicePath = require.resolve('./orderLifecycleService');
  const previousRepo = require.cache[repoPath];

  const appended = [];
  const repoExports = {
    readAll: async () => rows,
    readOverrideHistory: async () => historyRows || [],
    appendOverride: async (entry) => {
      const full = Object.assign({ history_id: 'OVR-TEST', changed_at: '2026-09-12 10:00:00' }, entry);
      appended.push(full);
      return full;
    }
  };

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
    appended,
    restore() {
      delete require.cache[servicePath];
      if (previousRepo) require.cache[repoPath] = previousRepo;
      else delete require.cache[repoPath];
    }
  };
}

function overrideRow(overrides) {
  return Object.assign({
    history_id: 'OVR-1',
    order_code: 'HD001',
    to_status_code: 'DELIVERING',
    to_status_label: 'Đơn đang được giao',
    changed_by: 'Nguyễn Văn A',
    changed_by_role: 'Kế toán',
    changed_at: '2026-09-12 09:00:00',
    note: '',
    message: 'Nguyễn Văn A - Kế toán đã cập nhật đơn hàng sang trạng thái Đơn đang được giao.',
    from_status_code: '',
    from_status_label: ''
  }, overrides);
}

function record(overrides) {
  return Object.assign({
    orderCode: 'HD001',
    saleName: '',
    customerName: '',
    saleSentAt: '',
    accountantApprovedOrderAt: '',
    driverName: '',
    driverConfirmedDeliveryAt: '',
    accountantApprovedDeliveryAt: '',
    deliveryConfirmedAt: '',
    shipReceivedAt: '',
    orderSignedAt: '',
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

test('computeStatus: cột Ship nhận đơn có giá trị -> SHIP_RECEIVED (trạng thái cuối cùng)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      saleSentAt: '01/09/2026', driverConfirmedDeliveryAt: '02/09/2026',
      deliveryConfirmedAt: '03/09/2026 10:00', shipReceivedAt: '04/09/2026 08:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.SHIP_RECEIVED);
    assert.equal(status.label, 'Ship đã nhận đơn');
    assert.equal(status.at, '04/09/2026 08:00');
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột Ship nhận đơn ưu tiên cao hơn cột H (Xác nhận đã giao)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      deliveryConfirmedAt: '03/09/2026 10:00', shipReceivedAt: '04/09/2026 08:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.SHIP_RECEIVED);
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột Đơn đã ký nhận có giá trị -> SIGNED (trạng thái cuối cùng)', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      saleSentAt: '01/09/2026', driverConfirmedDeliveryAt: '02/09/2026',
      deliveryConfirmedAt: '03/09/2026 10:00', shipReceivedAt: '04/09/2026 08:00',
      orderSignedAt: '05/09/2026 09:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.SIGNED);
    assert.equal(status.label, 'Đơn đã ký nhận');
    assert.equal(status.at, '05/09/2026 09:00');
  } finally {
    ctx.restore();
  }
});

test('computeStatus: cột Đơn đã ký nhận ưu tiên cao hơn cột Ship nhận đơn', () => {
  const ctx = freshService([]);
  try {
    const status = ctx.service.computeStatus(record({
      shipReceivedAt: '04/09/2026 08:00', orderSignedAt: '05/09/2026 09:00'
    }));
    assert.equal(status.code, ctx.service.STATUS.SIGNED);
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

test('toDetail (qua findOrder) trả kèm customerName', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', saleName: 'Sale A', customerName: 'KH A', saleSentAt: '01/09/2026' })]);
  try {
    const result = await ctx.service.findOrder('HD001');
    assert.equal(result.detail.customerName, 'KH A');
  } finally {
    ctx.restore();
  }
});

test('findOrdersBulk: mã tồn tại -> trả sale/khách hàng/tên cột trạng thái/thời gian, bỏ qua cột kế toán duyệt', async () => {
  const ctx = freshService([record({
    orderCode: 'HD001', saleName: 'Sale A', customerName: 'KH A',
    saleSentAt: '01/09/2026 08:00', accountantApprovedOrderAt: '01/09/2026 09:00'
  })]);
  try {
    const results = await ctx.service.findOrdersBulk(['HD001']);
    assert.equal(results.length, 1);
    assert.equal(results[0].found, true);
    assert.equal(results[0].saleName, 'Sale A');
    assert.equal(results[0].customerName, 'KH A');
    assert.equal(results[0].statusLabel, 'Sale gửi đơn cho kế toán');
    assert.equal(results[0].at, '01/09/2026 08:00');
  } finally {
    ctx.restore();
  }
});

test('findOrdersBulk: mã không tồn tại -> found:false', async () => {
  const ctx = freshService([record({ orderCode: 'HD001' })]);
  try {
    const results = await ctx.service.findOrdersBulk(['HD999']);
    assert.deepEqual(results, [{ code: 'HD999', found: false }]);
  } finally {
    ctx.restore();
  }
});

test('findOrdersBulk: quá 50 mã -> ném lỗi 400 TOO_MANY_CODES', async () => {
  const ctx = freshService([]);
  try {
    const tooMany = Array.from({ length: 51 }, (_, i) => 'HD' + i);
    await assert.rejects(
      () => ctx.service.findOrdersBulk(tooMany),
      err => err.statusCode === 400 && err.code === 'TOO_MANY_CODES'
    );
  } finally {
    ctx.restore();
  }
});

test('findOrdersBulk: dedupe mã trùng (không phân biệt hoa/thường)', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', saleSentAt: '01/09/2026' })]);
  try {
    const results = await ctx.service.findOrdersBulk(['HD001', 'hd001', ' HD001 ']);
    assert.equal(results.length, 1);
  } finally {
    ctx.restore();
  }
});

test('exportOrdersByCodes: không truyền codes -> xuất toàn bộ, giữ thứ tự trong sheet', async () => {
  const ctx = freshService([
    record({ orderCode: 'HD001', _branch: 'HN' }),
    record({ orderCode: 'HD002', _branch: 'SG' })
  ]);
  try {
    const all = await ctx.service.exportOrdersByCodes();
    assert.deepEqual(all.map(o => o.orderCode), ['HD001', 'HD002']);
    assert.equal(all[0].branch, 'HN');
    assert.ok(all[0].summary);
  } finally {
    ctx.restore();
  }
});

test('exportOrdersByCodes: truyền codes -> xuất đúng thứ tự đã yêu cầu (khớp bảng đã lọc/sắp xếp trên UI)', async () => {
  const ctx = freshService([
    record({ orderCode: 'HD001', _branch: 'HN' }),
    record({ orderCode: 'HD002', _branch: 'SG' }),
    record({ orderCode: 'HD003', _branch: 'HN' })
  ]);
  try {
    const result = await ctx.service.exportOrdersByCodes(['HD003', 'hd001']);
    assert.deepEqual(result.map(o => o.orderCode), ['HD003', 'HD001']);
  } finally {
    ctx.restore();
  }
});

test('exportOrdersByCodes: mã không tồn tại bị bỏ qua', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', _branch: 'HN' })]);
  try {
    const result = await ctx.service.exportOrdersByCodes(['HD001', 'HD999']);
    assert.deepEqual(result.map(o => o.orderCode), ['HD001']);
  } finally {
    ctx.restore();
  }
});

// ---------------------------------------------------------------------------
// computeEffectiveStatus — ghi de trang thai thu cong
// ---------------------------------------------------------------------------

test('computeEffectiveStatus: không có override -> giữ nguyên computed', () => {
  const ctx = freshService([]);
  try {
    const rec = record({ saleName: 'Sale A', saleSentAt: '01/09/2026' });
    const status = ctx.service.computeEffectiveStatus(rec, undefined);
    assert.equal(status.code, ctx.service.STATUS.SENT_TO_ACCOUNTANT);
    assert.equal(status.isOverride, undefined);
  } finally {
    ctx.restore();
  }
});

test('computeEffectiveStatus: override thấp hơn computed -> computed thắng (không kẹt)', () => {
  const ctx = freshService([]);
  try {
    const rec = record({
      saleSentAt: '01/09/2026', driverConfirmedDeliveryAt: '02/09/2026',
      deliveryConfirmedAt: '03/09/2026', shipReceivedAt: '04/09/2026'
    });
    const status = ctx.service.computeEffectiveStatus(rec, overrideRow({ to_status_code: 'DELIVERING' }));
    assert.equal(status.code, ctx.service.STATUS.SHIP_RECEIVED);
    assert.equal(status.isOverride, undefined);
  } finally {
    ctx.restore();
  }
});

test('computeEffectiveStatus: override cao hơn computed -> override thắng (mức sàn)', () => {
  const ctx = freshService([]);
  try {
    const rec = record({ saleName: 'Sale A', saleSentAt: '01/09/2026' }); // computed = SENT_TO_ACCOUNTANT
    const status = ctx.service.computeEffectiveStatus(rec, overrideRow({ to_status_code: 'SHIP_RECEIVED', changed_by: 'Nguyễn Văn A' }));
    assert.equal(status.code, ctx.service.STATUS.SHIP_RECEIVED);
    assert.equal(status.isOverride, true);
    assert.equal(status.actor, 'Nguyễn Văn A');
  } finally {
    ctx.restore();
  }
});

test('computeEffectiveStatus: override EXCEPTION luôn thắng bất kể computed', () => {
  const ctx = freshService([]);
  try {
    const rec = record({ shipReceivedAt: '04/09/2026' }); // computed = SHIP_RECEIVED, cao nhat
    const status = ctx.service.computeEffectiveStatus(rec, overrideRow({ to_status_code: 'EXCEPTION' }));
    assert.equal(status.code, ctx.service.STATUS.EXCEPTION);
    assert.equal(status.isOverride, true);
  } finally {
    ctx.restore();
  }
});

test('computeEffectiveStatus: override CANCELLED luôn thắng bất kể computed', () => {
  const ctx = freshService([]);
  try {
    const rec = record({ shipReceivedAt: '04/09/2026' });
    const status = ctx.service.computeEffectiveStatus(rec, overrideRow({ to_status_code: 'CANCELLED' }));
    assert.equal(status.code, ctx.service.STATUS.CANCELLED);
    assert.equal(status.isOverride, true);
  } finally {
    ctx.restore();
  }
});

// ---------------------------------------------------------------------------
// findOrder/listAllOrders ap dung override tu tab "Lich su cap nhat"
// ---------------------------------------------------------------------------

test('findOrder: áp dụng override mới nhất từ lịch sử cập nhật', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({ order_code: 'HD001', to_status_code: 'SHIP_RECEIVED' })]
  );
  try {
    const result = await ctx.service.findOrder('HD001');
    assert.equal(result.summary.code, ctx.service.STATUS.SHIP_RECEIVED);
    assert.equal(result.summary.isOverride, true);
  } finally {
    ctx.restore();
  }
});

test('listAllOrders: dùng dòng override CUỐI CÙNG khớp mã đơn (append theo thời gian)', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [
      overrideRow({ order_code: 'HD001', to_status_code: 'DELIVERING' }),
      overrideRow({ order_code: 'HD001', to_status_code: 'EXCEPTION' })
    ]
  );
  try {
    const all = await ctx.service.listAllOrders();
    assert.equal(all[0].summary.code, ctx.service.STATUS.EXCEPTION);
  } finally {
    ctx.restore();
  }
});

// ---------------------------------------------------------------------------
// overrideStatus
// ---------------------------------------------------------------------------

test('overrideStatus: mã đơn không tồn tại -> lỗi 404 ORDER_NOT_FOUND', async () => {
  const ctx = freshService([record({ orderCode: 'HD001' })]);
  try {
    await assert.rejects(
      () => ctx.service.overrideStatus('HD999', { code: 'CANCELLED', changedBy: 'A', changedByRole: 'Kế toán' }),
      err => err.statusCode === 404 && err.code === 'ORDER_NOT_FOUND'
    );
  } finally {
    ctx.restore();
  }
});

test('overrideStatus: trạng thái không hợp lệ -> lỗi 400 INVALID_STATUS', async () => {
  const ctx = freshService([record({ orderCode: 'HD001' })]);
  try {
    await assert.rejects(
      () => ctx.service.overrideStatus('HD001', { code: 'KHONG_TON_TAI', changedBy: 'A', changedByRole: 'Kế toán' }),
      err => err.statusCode === 400 && err.code === 'INVALID_STATUS'
    );
  } finally {
    ctx.restore();
  }
});

test('overrideStatus: ghi đúng câu tường thuật + trả về trạng thái hiệu lực mới', async () => {
  const ctx = freshService([record({ orderCode: 'HD001' })]);
  try {
    const result = await ctx.service.overrideStatus('HD001', {
      code: 'DELIVERED', changedBy: 'Nguyễn Văn A', changedByRole: 'Kế toán'
    });
    assert.equal(ctx.appended.length, 1);
    assert.equal(
      ctx.appended[0].message,
      'Nguyễn Văn A - Kế toán đã cập nhật đơn hàng sang trạng thái Đơn đã giao thành công.'
    );
    assert.equal(ctx.appended[0].order_code, 'HD001');
    assert.equal(result.summary.code, ctx.service.STATUS.DELIVERED);
    assert.equal(result.summary.isOverride, true);
  } finally {
    ctx.restore();
  }
});

test('overrideStatus: ghi kèm trạng thái cũ = trạng thái tính từ mốc thời gian (chưa có override trước đó)', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', saleName: 'Sale A', saleSentAt: '01/09/2026' })]);
  try {
    await ctx.service.overrideStatus('HD001', { code: 'SHIP_RECEIVED', changedBy: 'A', changedByRole: 'Quản lý' });
    assert.equal(ctx.appended[0].from_status_code, ctx.service.STATUS.SENT_TO_ACCOUNTANT);
    assert.equal(ctx.appended[0].from_status_label, ctx.service.STATUS_LABEL[ctx.service.STATUS.SENT_TO_ACCOUNTANT]);
  } finally {
    ctx.restore();
  }
});

test('overrideStatus: ghi kèm trạng thái cũ = override GẦN NHẤT trước đó (không phải trạng thái tính từ mốc thời gian)', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({ order_code: 'HD001', to_status_code: 'EXCEPTION' })]
  );
  try {
    await ctx.service.overrideStatus('HD001', { code: 'CANCELLED', changedBy: 'A', changedByRole: 'Quản lý' });
    assert.equal(ctx.appended[0].from_status_code, 'EXCEPTION');
  } finally {
    ctx.restore();
  }
});

// ---------------------------------------------------------------------------
// listHistory — tab "Lich su cap nhat" hien thi tren web (truoc gio chi doc
// noi bo de tinh trang thai hieu luc)
// ---------------------------------------------------------------------------

test('listHistory: mới nhất hiển thị trước (sheet ghi nối tiếp -> đảo ngược mảng)', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [
      overrideRow({ history_id: 'OVR-1', order_code: 'HD001', to_status_code: 'DELIVERING' }),
      overrideRow({ history_id: 'OVR-2', order_code: 'HD001', to_status_code: 'SHIP_RECEIVED' })
    ]
  );
  try {
    const history = await ctx.service.listHistory();
    assert.deepEqual(history.map(h => h.historyId), ['OVR-2', 'OVR-1']);
  } finally {
    ctx.restore();
  }
});

test('listHistory: kèm branch join theo mã đơn từ bảng chính', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001', _branch: 'HN' }), record({ orderCode: 'HD002', _branch: 'SG' })],
    [
      overrideRow({ history_id: 'OVR-1', order_code: 'HD001' }),
      overrideRow({ history_id: 'OVR-2', order_code: 'HD002' })
    ]
  );
  try {
    const history = await ctx.service.listHistory();
    const byId = Object.fromEntries(history.map(h => [h.historyId, h.branch]));
    assert.equal(byId['OVR-1'], 'HN');
    assert.equal(byId['OVR-2'], 'SG');
  } finally {
    ctx.restore();
  }
});

test('listHistory: mã đơn không còn trong bảng chính -> branch null (không throw)', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({ history_id: 'OVR-1', order_code: 'HD_DA_XOA' })]
  );
  try {
    const history = await ctx.service.listHistory();
    assert.equal(history[0].branch, null);
  } finally {
    ctx.restore();
  }
});

test('listHistory: giữ nguyên statusLabel/changedBy/note/message từ dòng lịch sử', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({
      history_id: 'OVR-1', order_code: 'HD001', to_status_code: 'CANCELLED', to_status_label: 'Đã hủy',
      changed_by: 'Trần Thị B', changed_by_role: 'Quản lý', note: 'Khách hủy đơn'
    })]
  );
  try {
    const [entry] = await ctx.service.listHistory();
    assert.equal(entry.statusCode, 'CANCELLED');
    assert.equal(entry.statusLabel, 'Đã hủy');
    assert.equal(entry.changedBy, 'Trần Thị B');
    assert.equal(entry.changedByRole, 'Quản lý');
    assert.equal(entry.note, 'Khách hủy đơn');
  } finally {
    ctx.restore();
  }
});

test('listHistory: trả kèm trạng thái cũ (from_status_code/label) từ dòng lịch sử', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({
      history_id: 'OVR-1', order_code: 'HD001', to_status_code: 'CANCELLED',
      from_status_code: 'DELIVERING', from_status_label: 'Đơn đang được giao'
    })]
  );
  try {
    const [entry] = await ctx.service.listHistory();
    assert.equal(entry.fromStatusCode, 'DELIVERING');
    assert.equal(entry.fromStatusLabel, 'Đơn đang được giao');
  } finally {
    ctx.restore();
  }
});

test('listHistory: dòng lịch sử cũ chưa có cột trạng thái cũ -> trả rỗng thay vì undefined', async () => {
  const ctx = freshService(
    [record({ orderCode: 'HD001' })],
    [overrideRow({ history_id: 'OVR-1', order_code: 'HD001', from_status_code: undefined, from_status_label: undefined })]
  );
  try {
    const [entry] = await ctx.service.listHistory();
    assert.equal(entry.fromStatusCode, '');
    assert.equal(entry.fromStatusLabel, '');
  } finally {
    ctx.restore();
  }
});

test('findOrdersBulk: mỗi dòng tìm thấy kèm nhãn cơ sở nguồn của đơn', async () => {
  const ctx = freshService([
    record({ orderCode: 'HD001', _branch: 'HN' }),
    record({ orderCode: 'HD002', _branch: 'SG' })
  ]);
  try {
    const results = await ctx.service.findOrdersBulk(['HD001', 'HD002', 'HD999']);
    assert.equal(results[0].branch, 'HN');
    assert.equal(results[1].branch, 'SG');
    assert.equal(results[2].found, false);
    assert.equal(results[2].branch, undefined, 'mã không tồn tại không gán cơ sở');
  } finally {
    ctx.restore();
  }
});
