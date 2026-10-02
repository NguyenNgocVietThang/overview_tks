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

// ---------------------------------------------------------------------------
// GOP don Phieu tam cua Kiot (2026-10-01): khoa (co so, ma don), sheet thang khi trung,
// don chi co o Kiot -> NOT_SENT; lookup/ghi de van chi doc sheet.
// ---------------------------------------------------------------------------

function kiotOrder(overrides) {
  return Object.assign({
    branch: 'HN', code: 'DH041173', customerName: 'KH Kiot', saleName: 'Nguyễn Văn A',
    orderDate: '01/10/2026 13:14', orderDateKey: '2026-10-01T13:14:00', total: 8091000, sellableValue: 6000000
  }, overrides);
}

function fakeKiot(result) {
  const calls = { reads: 0 };
  return {
    calls,
    readPendingOrders: async () => { calls.reads++; return result; }
  };
}

test('listOrdersMerged: dòng sheet thắng khi trùng (cơ sở, mã); đơn Phiếu tạm khớp được gắn giá trị có bán, không nhân đôi', async () => {
  const ctx = freshService([
    record({ orderCode: 'DH041173', _branch: 'HN', saleName: 'Sale Sheet', saleSentAt: '01/10/2026 08:00', driverConfirmedDeliveryAt: '01/10/2026 09:00' }),
    record({ orderCode: 'DH000999', _branch: 'HN' })
  ]);
  try {
    const { orders, kiot } = await ctx.service.listOrdersMerged(undefined, {
      kiot: fakeKiot({ ok: true, stale: false, fetchedAt: '2026-10-01T06:00:00.000Z', orders: [kiotOrder()] })
    });
    assert.equal(orders.length, 1, 'khong them dong trung; don sheet khong con Phieu tam (DH000999) bi bo khoi bang');
    assert.equal(orders.some(o => o.orderCode === 'DH000999'), false);
    const matched = orders.find(o => o.orderCode === 'DH041173');
    assert.equal(matched.source, 'sheet');
    assert.equal(matched.summary.code, 'DELIVERING', 'trang thai theo moc trong sheet, khong bi Kiot ghi de');
    assert.equal(matched.saleName, 'Nguyễn Văn A', 'ten sale theo don Kiot, khong theo sheet');
    assert.equal(matched.customerName, 'KH Kiot', 'khach hang theo don Kiot');
    assert.equal(matched.kiotPhieuTam, true);
    assert.equal(matched.sellableValue, 6000000);
    assert.equal(matched.orderTotal, 8091000);
    assert.equal(matched.orderDate, '01/10/2026 13:14');
    assert.deepEqual(kiot, { ok: true, stale: false, fetchedAt: '2026-10-01T06:00:00.000Z', count: 1 });
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: đơn chỉ có ở Kiot -> "Đơn chưa gửi kế toán" (NOT_SENT), cột mốc rỗng, không cảnh báo, chỉ gồm đơn Phiếu tạm', async () => {
  const ctx = freshService([record({ orderCode: 'DH000001', _branch: 'HN', saleSentAt: '01/10/2026 08:00' })]);
  try {
    const { orders } = await ctx.service.listOrdersMerged(undefined, {
      kiot: fakeKiot({ ok: true, orders: [kiotOrder({ code: 'DH041250' }), kiotOrder({ code: 'DH041249' })] })
    });
    assert.deepEqual(orders.map(o => o.orderCode), ['DH041250', 'DH041249'], 'chi don Phieu tam cua Kiot (moi nhat truoc); dong sheet khong khop bi bo');
    const kiotOnly = orders[0];
    assert.equal(kiotOnly.source, 'kiotviet');
    assert.equal(kiotOnly.summary.code, 'NOT_SENT');
    assert.equal(kiotOnly.summary.label, 'Đơn chưa gửi kế toán');
    assert.equal(kiotOnly.summary.at, '01/10/2026 13:14', 'don chua gui ke toan: thoi gian dat hang vao cot Cap nhat gan nhat');
    assert.equal(kiotOnly.warning, false);
    assert.equal(kiotOnly.branch, 'HN');
    assert.equal(kiotOnly.saleName, 'Nguyễn Văn A');
    assert.equal(kiotOnly.customerName, 'KH Kiot');
    assert.deepEqual(
      [kiotOnly.saleSentAt, kiotOnly.accountantApprovedOrderAt, kiotOnly.driverName, kiotOnly.driverConfirmedDeliveryAt,
        kiotOnly.accountantApprovedDeliveryAt, kiotOnly.deliveryConfirmedAt, kiotOnly.shipReceivedAt, kiotOnly.orderSignedAt],
      ['', '', '', '', '', '', '', '']
    );
    assert.equal(kiotOnly.kiotPhieuTam, true);
    assert.equal(kiotOnly.sellableValue, 6000000);
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: thời gian đặt hàng chỉ thay mốc "Cập nhật gần nhất" của đơn chưa gửi kế toán; đơn đã có mốc giữ nguyên', async () => {
  const ctx = freshService([
    record({ orderCode: 'DH000010', _branch: 'HN' }), // sheet, chua gui ke toan, khop Kiot
    record({ orderCode: 'DH000011', _branch: 'HN', saleSentAt: '01/10/2026 08:00' }) // da gui ke toan, khop Kiot
  ]);
  try {
    const { orders } = await ctx.service.listOrdersMerged(undefined, {
      kiot: fakeKiot({ ok: true, orders: [
        kiotOrder({ code: 'DH000010', orderDate: '30/09/2026 10:00' }),
        kiotOrder({ code: 'DH000011', orderDate: '30/09/2026 11:00' })
      ] })
    });
    const notSent = orders.find(o => o.orderCode === 'DH000010');
    assert.equal(notSent.summary.code, 'NOT_SENT');
    assert.equal(notSent.summary.at, '30/09/2026 10:00');
    const sent = orders.find(o => o.orderCode === 'DH000011');
    assert.equal(sent.summary.code, 'SENT_TO_ACCOUNTANT');
    assert.equal(sent.summary.at, '01/10/2026 08:00', 'khong bi thoi gian dat hang de len moc cua trang thai da gui');
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: KHÓA THEO CƠ SỞ — cùng mã DH ở HN và SG không bị coi là trùng', async () => {
  const ctx = freshService([record({ orderCode: 'DH018717', _branch: 'HN', saleSentAt: '01/10/2026 08:00' })]);
  try {
    const { orders } = await ctx.service.listOrdersMerged(undefined, {
      kiot: fakeKiot({ ok: true, orders: [kiotOrder({ branch: 'SG', code: 'DH018717' })] })
    });
    assert.equal(orders.length, 1, 'dong sheet HN KHONG khop don Phieu tam cua SG nen bi bo; don SG chi o Kiot van hien');
    assert.equal(orders[0].source, 'kiotviet');
    assert.equal(orders[0].branch, 'SG');
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: không áp ghi đè lịch sử (khoá theo mã) lên đơn chỉ có ở Kiot; dòng sheet vẫn áp ghi đè', async () => {
  const ctx = freshService(
    [record({ orderCode: 'DH000001', _branch: 'HN' })],
    [overrideRow({ order_code: 'DH000001', to_status_code: 'CANCELLED', to_status_label: 'Đã hủy' }),
      overrideRow({ history_id: 'OVR-2', order_code: 'DH041173', to_status_code: 'CANCELLED', to_status_label: 'Đã hủy' })]
  );
  try {
    const { orders } = await ctx.service.listOrdersMerged(undefined, { kiot: fakeKiot({ ok: true, orders: [kiotOrder(), kiotOrder({ code: 'DH000001' })] }) });
    assert.equal(orders.find(o => o.orderCode === 'DH000001').summary.code, 'CANCELLED');
    assert.equal(orders.find(o => o.orderCode === 'DH041173').summary.code, 'NOT_SENT', 'ghi de theo ma khong ap cho don Kiot');
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: lọc cơ sở áp cho cả đơn Kiot; dòng sheet mã trống không bao giờ khớp', async () => {
  const ctx = freshService([
    record({ orderCode: '', _branch: 'HN' }),
    record({ orderCode: 'DH000002', _branch: 'SG' })
  ]);
  try {
    const kiot = fakeKiot({ ok: true, orders: [kiotOrder({ branch: 'HN', code: 'DH041173' }), kiotOrder({ branch: 'SG', code: 'DH019082' })] });
    const sg = await ctx.service.listOrdersMerged('SG', { kiot });
    assert.deepEqual(sg.orders.map(o => o.orderCode), ['DH019082'], 'DH000002 (sheet) khong co Phieu tam tren Kiot nen bi bo');
    const hn = await ctx.service.listOrdersMerged('HN', { kiot });
    assert.deepEqual(hn.orders.map(o => [o.orderCode, o.source]), [['DH041173', 'kiotviet']], 'dong sheet ma trong khong bao gio khop');
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged: nguồn Kiot lỗi (ok:false) -> chỉ còn dòng sheet, meta báo ok:false; đọc đủ 2 nguồn song song', async () => {
  const ctx = freshService([record({ orderCode: 'DH000001', _branch: 'HN' })]);
  try {
    const kiot = fakeKiot({ ok: false, stale: false, fetchedAt: null, orders: [] });
    const { orders, kiot: meta } = await ctx.service.listOrdersMerged(undefined, { kiot });
    assert.deepEqual(orders.map(o => [o.orderCode, o.source, o.kiotPhieuTam]), [['DH000001', 'sheet', false]]);
    assert.deepEqual(meta, { ok: false, stale: false, fetchedAt: null, count: 0 });
    assert.equal(kiot.calls.reads, 1);
  } finally {
    ctx.restore();
  }
});

test('listOrdersMerged / listAllOrders KHÔNG truyền kiot: hình dạng cũ, không thêm trường mới, kiot=null', async () => {
  const ctx = freshService([record({ orderCode: 'HD001', _branch: 'HN' })]);
  try {
    const merged = await ctx.service.listOrdersMerged();
    assert.equal(merged.kiot, null);
    const row = merged.orders[0];
    for (const field of ['source', 'kiotPhieuTam', 'sellableValue', 'orderTotal', 'orderDate']) {
      assert.equal(field in row, false, `${field} chi co khi gop Kiot`);
    }
    assert.deepEqual(await ctx.service.listAllOrders(), merged.orders);
  } finally {
    ctx.restore();
  }
});

test('lookup (findOrder / findOrdersBulk) và ghi đè KHÔNG dùng dữ liệu Kiot: đơn chỉ có ở Kiot -> chưa gửi kế toán / 404', async () => {
  const ctx = freshService([record({ orderCode: 'DH000001', _branch: 'HN' })]);
  try {
    const found = await ctx.service.findOrder('DH041173');
    assert.equal(found.found, false);
    assert.equal(found.summary.code, 'NOT_SENT');
    const bulk = await ctx.service.findOrdersBulk(['DH041173']);
    assert.deepEqual(bulk, [{ code: 'DH041173', found: false }]);
    await assert.rejects(
      ctx.service.overrideStatus('DH041173', { code: 'CANCELLED', changedBy: 'X', changedByRole: 'Quản lý' }),
      { statusCode: 404, code: 'ORDER_NOT_FOUND' }
    );
  } finally {
    ctx.restore();
  }
});

test('exportOrdersByCodes có kiot: xuất cả đơn Kiot đã gộp (không codes = toàn bộ; có codes = đúng thứ tự, bỏ mã không có)', async () => {
  const ctx = freshService([record({ orderCode: 'DH000001', _branch: 'HN' })]);
  try {
    const kiot = fakeKiot({ ok: true, orders: [kiotOrder({ code: 'DH041250' }), kiotOrder({ code: 'DH041249' })] });
    const all = await ctx.service.exportOrdersByCodes(undefined, { kiot });
    assert.deepEqual(all.map(o => o.orderCode), ['DH041250', 'DH041249']);
    const some = await ctx.service.exportOrdersByCodes(['dh041249', 'DH041250', 'DH000001', 'KHONG-CO'], { kiot });
    assert.deepEqual(some.map(o => o.orderCode), ['DH041249', 'DH041250'], 'DH000001 chi co trong sheet nen khong xuat');
    assert.equal(some[0].sellableValue, 6000000);
    // Khong co kiot -> chi dong sheet nhu cu.
    const sheetOnly = await ctx.service.exportOrdersByCodes(['DH041249']);
    assert.deepEqual(sheetOnly, []);
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
