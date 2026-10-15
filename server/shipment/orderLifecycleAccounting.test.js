'use strict';

// Luong don ke toan/chung tu (tab KeToan_ChungTu, 2026-10-15): co dong trong tab = "Hoàn thành"; phieu tam Kiot
// chua co trong tab nao = "Đơn chưa gửi kế toán". Tab dung chung HN+SG nen co so lay theo don Kiot cung ma.
const test = require('node:test');
const assert = require('node:assert/strict');

function freshService() {
  const repoPath = require.resolve('./orderLifecycleRepository');
  const servicePath = require.resolve('./orderLifecycleService');
  const previousRepo = require.cache[repoPath];
  require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: { readAll: async () => [], readOverrideHistory: async () => [] } };
  delete require.cache[servicePath];
  const service = require('./orderLifecycleService');
  return {
    service,
    setRows(rows) { require.cache[repoPath].exports.readAll = async () => rows; },
    restore() {
      delete require.cache[servicePath];
      if (previousRepo) require.cache[repoPath] = previousRepo;
      else delete require.cache[repoPath];
    }
  };
}

function record(overrides) {
  return Object.assign({
    orderCode: 'DH041173', saleName: '', customerName: '', saleSentAt: '', accountantApprovedOrderAt: '', driverName: '',
    driverConfirmedDeliveryAt: '', accountantApprovedDeliveryAt: '', deliveryConfirmedAt: '', shipReceivedAt: '', orderSignedAt: '',
    _branch: 'HN'
  }, overrides);
}

function accountingRecord(overrides) {
  return record(Object.assign({
    orderCode: 'DH041173', _branch: null, _flow: 'ACCOUNTING', accountingSender: 'Kế toán Lan', saleSentAt: '14/10/2026 10:30'
  }, overrides));
}

function kiotOrder(overrides) {
  return Object.assign({
    branch: 'HN', code: 'DH041173', customerName: 'KH Kiot', saleName: 'Nguyễn Văn A',
    orderDate: '01/10/2026 13:14', total: 8091000, kiotStatus: 'Phiếu tạm', note: '', sellableValue: 6000000
  }, overrides);
}

function fakeKiot(result) {
  return { readOrders: async () => result };
}

test('computeStatus: dòng luồng ACCOUNTING -> COMPLETED "Hoàn thành", người gửi + thời gian gửi, không cảnh báo', () => {
  const ctx = freshService();
  try {
    const status = ctx.service.computeStatus(accountingRecord());
    assert.equal(status.code, ctx.service.STATUS.COMPLETED);
    assert.equal(status.label, 'Hoàn thành');
    assert.equal(status.actor, 'Kế toán Lan');
    assert.equal(status.at, '14/10/2026 10:30');
    assert.deepEqual(ctx.service.computeWarnings(accountingRecord(), status, Date.parse('2026-10-20T00:00:00Z')), []);
  } finally {
    ctx.restore();
  }
});

test('queryOrders: mã trong KeToan_ChungTu -> Hoàn thành, cơ sở theo đơn Kiot (lọc HN/SG được); phiếu tạm chưa có trong tab -> chưa gửi kế toán', async () => {
  const ctx = freshService();
  ctx.setRows([
    accountingRecord({ orderCode: 'DH000010' }),
    accountingRecord({ orderCode: 'DH000020', accountingSender: 'Kế toán Hoa' })
  ]);
  try {
    const kiot = fakeKiot({ ok: true, orders: [
      kiotOrder({ code: 'DH000010', branch: 'HN', kiotStatus: 'Hoàn thành', sellableValue: null }),
      kiotOrder({ code: 'DH000020', branch: 'SG', kiotStatus: 'Hoàn thành', sellableValue: null }),
      kiotOrder({ code: 'DH000030', branch: 'SG', kiotStatus: 'Phiếu tạm' })
    ] });
    const all = await ctx.service.queryOrders({}, { kiot });
    const byCode = Object.fromEntries(all.orders.map(o => [o.orderCode, o]));
    assert.equal(byCode.DH000010.summary.code, 'COMPLETED');
    assert.equal(byCode.DH000010.branch, 'HN');
    assert.equal(byCode.DH000010.flow, 'ACCOUNTING');
    assert.equal(byCode.DH000010.accountingSender, 'Kế toán Lan');
    assert.equal(byCode.DH000020.branch, 'SG');
    assert.equal(byCode.DH000020.accountingSender, 'Kế toán Hoa');
    assert.equal(byCode.DH000030.summary.code, 'NOT_SENT');
    assert.equal(byCode.DH000030.summary.label, 'Đơn chưa gửi kế toán');

    const sg = await ctx.service.queryOrders({ branch: 'SG', status: 'COMPLETED' }, { kiot });
    assert.deepEqual(sg.orders.map(o => o.orderCode), ['DH000020']);
    const notSent = await ctx.service.queryOrders({ status: 'NOT_SENT' }, { kiot });
    assert.deepEqual(notSent.orders.map(o => o.orderCode), ['DH000030']);
  } finally {
    ctx.restore();
  }
});

test('mergeRows: cùng mã ở cả HN và SG -> ưu tiên đơn còn Phiếu tạm, rồi đơn đặt gần nhất; mã không có trên Kiot bị bỏ', () => {
  const ctx = freshService();
  try {
    const kiotOrders = [
      kiotOrder({ code: 'DH100', branch: 'HN', kiotStatus: 'Hoàn thành', orderDate: '01/10/2026 10:00' }),
      kiotOrder({ code: 'DH100', branch: 'SG', kiotStatus: 'Phiếu tạm', orderDate: '01/09/2026 10:00' }),
      kiotOrder({ code: 'DH200', branch: 'HN', kiotStatus: 'Hoàn thành', orderDate: '01/09/2026 10:00' }),
      kiotOrder({ code: 'DH200', branch: 'SG', kiotStatus: 'Hoàn thành', orderDate: '02/10/2026 10:00' })
    ];
    const rows = ctx.service.mergeRows({
      records: [accountingRecord({ orderCode: 'DH100' }), accountingRecord({ orderCode: 'DH200' }), accountingRecord({ orderCode: 'DH999' })],
      overrides: new Map(),
      kiotResult: { ok: true, orders: kiotOrders }
    });
    const accounting = rows.filter(r => r.flow === 'ACCOUNTING');
    assert.deepEqual(accounting.map(r => [r.orderCode, r.branch]), [['DH100', 'SG'], ['DH200', 'SG']]);
    assert.equal(rows.some(r => r.orderCode === 'DH999'), false);
  } finally {
    ctx.restore();
  }
});

test('mergeRows: mã đã có ở luồng giao hàng thì dòng KeToan_ChungTu cùng mã không nhân đôi; ghi đè thường không hạ Hoàn thành', () => {
  const ctx = freshService();
  try {
    const rows = ctx.service.mergeRows({
      records: [
        record({ orderCode: 'DH300', _branch: 'HN', saleSentAt: '01/10/2026 08:00' }),
        accountingRecord({ orderCode: 'DH300' }),
        accountingRecord({ orderCode: 'DH400' })
      ],
      overrides: new Map([['dh400', { order_code: 'DH400', to_status_code: 'SENT_TO_ACCOUNTANT', changed_by: 'A', changed_at: '2026-10-14 09:00:00' }]]),
      kiotResult: { ok: true, orders: [kiotOrder({ code: 'DH300', branch: 'HN' }), kiotOrder({ code: 'DH400', branch: 'HN', kiotStatus: 'Hoàn thành' })] }
    });
    assert.deepEqual(rows.map(r => [r.orderCode, r.flow, r.summary.code]), [
      ['DH300', 'DELIVERY', 'SENT_TO_ACCOUNTANT'], ['DH400', 'ACCOUNTING', 'COMPLETED']
    ]);
  } finally {
    ctx.restore();
  }
});

test('mergeRows: Kiot đọc lỗi -> vẫn giữ dòng KeToan_ChungTu, cơ sở rỗng (chỉ hiện ở "Cả hai")', () => {
  const ctx = freshService();
  try {
    const rows = ctx.service.mergeRows({ records: [accountingRecord()], overrides: new Map(), kiotResult: { ok: false } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, '');
    assert.equal(rows[0].summary.code, 'COMPLETED');
  } finally {
    ctx.restore();
  }
});
