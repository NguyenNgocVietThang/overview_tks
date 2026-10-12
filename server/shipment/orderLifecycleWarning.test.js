'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Service doc repo qua require.cache — thay bang ban gia de test khong can Google Sheets/.env.
function freshService(rows, historyRows) {
  const repoPath = require.resolve('./orderLifecycleRepository');
  const servicePath = require.resolve('./orderLifecycleService');
  const previousRepo = require.cache[repoPath];
  require.cache[repoPath] = {
    id: repoPath,
    filename: repoPath,
    loaded: true,
    exports: {
      readAll: async () => rows || [],
      readOverrideHistory: async () => historyRows || [],
      appendOverride: async entry => Object.assign({ history_id: 'OVR-TEST', changed_at: '2026-09-30 10:00:00' }, entry)
    }
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
    orderCode: 'HD001', saleName: '', customerName: '',
    saleSentAt: '', accountantApprovedOrderAt: '', driverName: '',
    driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '',
    shipReceivedAt: '', orderSignedAt: '', _branch: 'HN'
  }, overrides);
}

function warningFor(service, rec, nowText, summary) {
  const now = service.parseSheetTimeMs(nowText);
  return service.computeOverdueWarning(rec, summary || service.computeStatus(rec), now);
}

test('parseSheetTimeMs: đọc dd/MM/yyyy HH:mm(:ss), "15,35", chỉ ngày và YYYY-MM-DD HH:mm:ss theo giờ Việt Nam', () => {
  const ctx = freshService();
  try {
    const { parseSheetTimeMs } = ctx.service;
    assert.equal(parseSheetTimeMs('30/09/2026 10:47'), Date.UTC(2026, 8, 30, 3, 47));
    assert.equal(parseSheetTimeMs('30/09/2026 10:47:30'), Date.UTC(2026, 8, 30, 3, 47, 30));
    assert.equal(parseSheetTimeMs('30/09/2026 15,35'), Date.UTC(2026, 8, 30, 8, 35));
    assert.equal(parseSheetTimeMs('30/09/2026'), Date.UTC(2026, 8, 29, 17, 0));
    assert.equal(parseSheetTimeMs('2026-09-30 10:47:00'), parseSheetTimeMs('30/09/2026 10:47'));
    assert.equal(parseSheetTimeMs(''), null);
    assert.equal(parseSheetTimeMs(null), null);
    assert.equal(parseSheetTimeMs('không phải ngày'), null);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: chưa có "Sale gửi đơn cho kế toán" thì KHÔNG cảnh báo dù đã có các cột sau', () => {
  const ctx = freshService();
  try {
    const now = '30/09/2026 12:00';
    assert.equal(warningFor(ctx.service, record({ driverConfirmedDeliveryAt: '30/09/2026 10:47' }), now), false);
    assert.equal(warningFor(ctx.service, record({ orderSignedAt: '10/09/2026 10:47' }), now), false);
    assert.equal(warningFor(ctx.service, record({}), now), false);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: đã vận chuyển — chỉ cảnh báo khi từ Sale ra đơn đến đang vận chuyển QUÁ 24h', () => {
  const ctx = freshService();
  try {
    const now = '30/09/2026 12:00';
    const sent = '29/09/2026 10:00';
    assert.equal(warningFor(ctx.service, record({ saleSentAt: sent, driverConfirmedDeliveryAt: '30/09/2026 09:59' }), now), false);
    assert.equal(warningFor(ctx.service, record({ saleSentAt: sent, driverConfirmedDeliveryAt: '30/09/2026 10:00' }), now), false); // đúng 24h
    assert.equal(warningFor(ctx.service, record({ saleSentAt: sent, driverConfirmedDeliveryAt: '30/09/2026 10:01' }), now), true);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: đã vận chuyển đúng hạn rồi thì không bị cảnh báo lại theo thời gian hiện tại', () => {
  const ctx = freshService();
  try {
    const rec = record({
      saleSentAt: '01/09/2026 08:00', driverConfirmedDeliveryAt: '01/09/2026 09:00', orderSignedAt: '05/09/2026 09:00'
    });
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00'), false);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: chưa vận chuyển mà đã quá 24h kể từ lúc Sale ra đơn thì cảnh báo', () => {
  const ctx = freshService();
  try {
    const rec = record({ saleSentAt: '29/09/2026 10:00' });
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 09:59'), false);
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 10:01'), true);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: cột Tài xế bị bỏ trống nhưng các cột sau đã có -> dùng mốc sớm nhất của chúng, không cảnh báo mãi mãi', () => {
  const ctx = freshService();
  try {
    const rec = record({ saleSentAt: '01/09/2026 08:00', shipReceivedAt: '01/09/2026 15:00' });
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00'), false);
    const late = record({ saleSentAt: '01/09/2026 08:00', shipReceivedAt: '03/09/2026 15:00' });
    assert.equal(warningFor(ctx.service, late, '30/09/2026 12:00'), true);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: đơn đã hủy / sự cố (ghi đè thủ công) mà chưa từng vận chuyển thì không cảnh báo', () => {
  const ctx = freshService();
  try {
    const rec = record({ saleSentAt: '01/09/2026 08:00' });
    const cancelled = ctx.service.computeEffectiveStatus(rec, { to_status_code: 'CANCELLED', changed_at: '2026-09-02 09:00:00' });
    const exception = ctx.service.computeEffectiveStatus(rec, { to_status_code: 'EXCEPTION', changed_at: '2026-09-02 09:00:00' });
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00', cancelled), false);
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00', exception), false);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: ghi đè thủ công sang "Đang được giao" dùng thời điểm ghi đè làm mốc vận chuyển', () => {
  const ctx = freshService();
  try {
    const rec = record({ saleSentAt: '29/09/2026 10:00' });
    const early = ctx.service.computeEffectiveStatus(rec, { to_status_code: 'DELIVERING', changed_at: '2026-09-30 09:00:00' });
    const late = ctx.service.computeEffectiveStatus(rec, { to_status_code: 'DELIVERING', changed_at: '2026-09-30 11:00:00' });
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00', early), false);
    assert.equal(warningFor(ctx.service, rec, '30/09/2026 12:00', late), true);
  } finally {
    ctx.restore();
  }
});

test('cảnh báo: "Sale ra đơn" không đọc được thành thời gian thì không cảnh báo', () => {
  const ctx = freshService();
  try {
    assert.equal(warningFor(ctx.service, record({ saleSentAt: 'hôm qua' }), '30/09/2026 12:00'), false);
  } finally {
    ctx.restore();
  }
});

test('listAllOrders / queryOrders / exportOrders / overrideStatus trả kèm cờ warning', async () => {
  const ctx = freshService([
    record({ orderCode: 'HD001', saleSentAt: '01/01/2020 08:00' }), // rất cũ, chưa vận chuyển -> cảnh báo
    record({ orderCode: 'HD002' }) // chưa gửi kế toán -> không cảnh báo
  ]);
  try {
    const all = await ctx.service.listAllOrders();
    assert.deepEqual(all.map(o => o.warning), [true, false]);
    assert.equal(all[0].saleSentAt, '01/01/2020 08:00');

    const page = await ctx.service.queryOrders({});
    assert.deepEqual(page.orders.map(o => [o.orderCode, o.warning]), [['HD001', true], ['HD002', false]]);

    const exported = await ctx.service.exportOrders({ sort: 'orderCode', dir: 'desc' });
    assert.deepEqual(exported.map(o => [o.orderCode, o.warning]), [['HD002', false], ['HD001', true]]);

    const overridden = await ctx.service.overrideStatus('HD001', { code: 'CANCELLED', changedBy: 'A', changedByRole: 'Kế toán' });
    assert.equal(overridden.warning, false);
  } finally {
    ctx.restore();
  }
});

// ---------------------------------------------------------------------------
// Đơn Bắc-Nam (tab DonHang_MienNam, 2026-10-12): đơn Kiot HN, chỉ 3 trạng thái, không cảnh báo 24h
// ---------------------------------------------------------------------------

function northSouthRecord(overrides) {
  return record(Object.assign({ orderCode: 'DH043419', _branch: 'HN', _flow: 'NORTH_SOUTH' }, overrides));
}

function kiotOrder(overrides) {
  return Object.assign({
    code: 'DH043419', branch: 'HN', saleName: 'Quan Nguyen', customerName: 'KH Minh Long',
    kiotStatus: 'Phiếu tạm', sellableValue: 1000, total: 2000, orderDate: '2020-01-01 08:00', note: ''
  }, overrides);
}

function mergeFor(service, records, kiotOrders, overrides) {
  return service.mergeRows({
    records,
    overrides: overrides || new Map(),
    kiotResult: { ok: true, orders: kiotOrders }
  });
}

test('đơn Bắc-Nam: gửi kế toán quá 24h chưa ký nhận KHÔNG cảnh báo, đơn HN cùng điều kiện vẫn cảnh báo', () => {
  const ctx = freshService();
  try {
    const rows = mergeFor(ctx.service, [
      northSouthRecord({ saleSentAt: '01/01/2020 08:00' }),
      record({ orderCode: 'DH000002', saleSentAt: '01/01/2020 08:00' })
    ], [kiotOrder(), kiotOrder({ code: 'DH000002' })]);
    assert.deepEqual(rows.map(r => [r.orderCode, r.warning]), [['DH043419', false], ['DH000002', true]]);
  } finally {
    ctx.restore();
  }
});

test('đơn Bắc-Nam: chỉ 3 trạng thái — "Kế toán duyệt đơn" không đổi trạng thái, "Đơn đã ký nhận" -> Đã nhận (Đi giao xong)', () => {
  const ctx = freshService();
  try {
    const code = ctx.service.STATUS;
    const [none, sent, approved, signed] = mergeFor(ctx.service, [
      northSouthRecord({ orderCode: 'DH000001' }),
      northSouthRecord({ orderCode: 'DH000002', saleSentAt: '12/10/2026 08:52' }),
      northSouthRecord({ orderCode: 'DH000003', saleSentAt: '12/10/2026 08:52', accountantApprovedOrderAt: '12/10/2026 09:10' }),
      northSouthRecord({ orderCode: 'DH000004', saleSentAt: '12/10/2026 08:52', accountantApprovedOrderAt: '12/10/2026 09:10', orderSignedAt: '13/10/2026 08:00' })
    ], ['DH000001', 'DH000002', 'DH000003', 'DH000004'].map(c => kiotOrder({ code: c })));
    assert.equal(none.summary.code, code.NOT_SENT);
    assert.equal(sent.summary.code, code.SENT_TO_ACCOUNTANT);
    assert.equal(approved.summary.code, code.SENT_TO_ACCOUNTANT);
    assert.equal(approved.accountantApprovedOrderAt, '12/10/2026 09:10'); // vẫn có trong chi tiết
    assert.equal(signed.summary.code, code.SIGNED);
  } finally {
    ctx.restore();
  }
});

test('đơn Bắc-Nam: ghép với đơn Kiot HN (branch HN, Sale/Khách lấy từ Kiot); không có trên Kiot HN thì bị bỏ; không lọt sang SG', () => {
  const ctx = freshService();
  try {
    const rows = mergeFor(ctx.service, [
      northSouthRecord({ saleSentAt: '12/10/2026 08:52' }),
      northSouthRecord({ orderCode: 'DH999999', saleSentAt: '12/10/2026 08:52' })
    ], [kiotOrder(), kiotOrder({ code: 'DH043419', branch: 'SG', saleName: 'Khác' })]);
    const matched = rows.filter(r => r.orderCode === 'DH043419');
    const hn = matched.find(r => r.branch === 'HN');
    assert.equal(hn.source, 'sheet');
    assert.equal(hn.saleName, 'Quan Nguyen');
    assert.equal(hn.customerName, 'KH Minh Long');
    assert.equal(hn.saleSentAt, '12/10/2026 08:52');
    assert.equal(matched.find(r => r.branch === 'SG').source, 'kiotviet'); // đơn SG cùng mã chỉ là đơn Kiot SG thuần
    assert.equal(rows.some(r => r.orderCode === 'DH999999'), false);
  } finally {
    ctx.restore();
  }
});

test('đơn Bắc-Nam: ghi đè thủ công Đã hủy / Sự cố vẫn thắng', () => {
  const ctx = freshService();
  try {
    const overrides = new Map([['dh043419', { to_status_code: 'CANCELLED', changed_by: 'A', changed_at: '2026-10-12 10:00:00' }]]);
    const [row] = mergeFor(ctx.service, [northSouthRecord({ saleSentAt: '12/10/2026 08:52' })], [kiotOrder()], overrides);
    assert.equal(row.summary.code, ctx.service.STATUS.CANCELLED);
    assert.equal(row.warning, false);
  } finally {
    ctx.restore();
  }
});
