'use strict';
// Thiet lap bien moi truong truoc khi require bat ky module nao trong du an
process.env.SPREADSHEET_ID              = process.env.SPREADSHEET_ID              || 'test-spreadsheet-id';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET                  = process.env.JWT_SECRET                  || 'test-jwt-secret';

const test   = require('node:test');
const assert = require('node:assert/strict');

const {
  ORDER_STATUS,
  FLOWS,
  WAREHOUSES,
  EXCEPTION_ELIGIBLE_STATUSES,
  canTransition,
  describeTransition,
  assertValidFlowWarehouse
} = require('./orderStateMachine');

// ---------------------------------------------------------------------------
// Kiem tra hang so
// ---------------------------------------------------------------------------

test('ORDER_STATUS da duoc dinh nghia day du 9 trang thai', () => {
  const expected = [
    'Mới tạo', 'Đã in', 'Đã nhặt hàng', 'Đang chuyển kho',
    'Đang giao', 'Đã giao', 'Hoàn thành', 'Sự cố', 'Đã hủy'
  ];
  assert.deepEqual(Object.values(ORDER_STATUS), expected);
});

test('ORDER_STATUS bi freeze (khong the gan gia tri moi)', () => {
  assert.throws(() => { ORDER_STATUS.NEW_STATUS = 'test'; }, TypeError);
});

test('FLOWS co 4 luong dung gia tri so nguyen', () => {
  assert.equal(FLOWS.HN_XE_CTY,  1);
  assert.equal(FLOWS.SG_XE_CTY,  2);
  assert.equal(FLOWS.HN_TAU_HOA, 3);
  assert.equal(FLOWS.SG_SHIPPER, 4);
});

test('EXCEPTION_ELIGIBLE_STATUSES chua dung 4 trang thai hop le', () => {
  assert.ok(EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DA_NHAT_HANG));
  assert.ok(EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DANG_CHUYEN_KHO));
  assert.ok(EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DANG_GIAO));
  assert.ok(EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DA_GIAO));
  // Khong co trang thai cuoi/dau
  assert.ok(!EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.MOI_TAO));
  assert.ok(!EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DA_IN));
  assert.ok(!EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.HOAN_THANH));
  assert.ok(!EXCEPTION_ELIGIBLE_STATUSES.has(ORDER_STATUS.DA_HUY));
});

// ---------------------------------------------------------------------------
// canTransition — cac cap hop le trong bang 4.2
// ---------------------------------------------------------------------------

test('canTransition: MOI_TAO -> DA_IN hop le (moi flow)', () => {
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.DA_IN), true);
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.DA_IN, { flow: 1 }), true);
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.DA_IN, { flow: 3 }), true);
});

test('canTransition: DA_IN -> DA_NHAT_HANG hop le', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_IN, ORDER_STATUS.DA_NHAT_HANG), true);
});

test('canTransition: DA_NHAT_HANG -> DANG_CHUYEN_KHO chi hop le khi flow=3', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO, { flow: 3 }), true);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO, { flow: 1 }), false);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO, { flow: 2 }), false);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO, { flow: 4 }), false);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO),              false);
});

test('canTransition: DA_NHAT_HANG -> DANG_GIAO chi hop le khi flow != 3', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_GIAO, { flow: 1 }), true);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_GIAO, { flow: 2 }), true);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_GIAO, { flow: 4 }), true);
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_GIAO, { flow: 3 }), false);
});

test('canTransition: DANG_CHUYEN_KHO -> DANG_GIAO chi hop le khi flow=3', () => {
  assert.equal(canTransition(ORDER_STATUS.DANG_CHUYEN_KHO, ORDER_STATUS.DANG_GIAO, { flow: 3 }), true);
  assert.equal(canTransition(ORDER_STATUS.DANG_CHUYEN_KHO, ORDER_STATUS.DANG_GIAO, { flow: 1 }), false);
});

test('canTransition: DANG_GIAO -> DA_GIAO hop le', () => {
  assert.equal(canTransition(ORDER_STATUS.DANG_GIAO, ORDER_STATUS.DA_GIAO), true);
});

test('canTransition: DA_GIAO -> HOAN_THANH hop le', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_GIAO, ORDER_STATUS.HOAN_THANH), true);
});

// ---------------------------------------------------------------------------
// canTransition — cac cap KHONG hop le (phai tra false)
// ---------------------------------------------------------------------------

test('canTransition: MOI_TAO -> DA_GIAO khong hop le', () => {
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.DA_GIAO), false);
});

test('canTransition: MOI_TAO -> HOAN_THANH khong hop le', () => {
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.HOAN_THANH), false);
});

test('canTransition: HOAN_THANH -> DA_IN khong hop le (trang thai cuoi)', () => {
  assert.equal(canTransition(ORDER_STATUS.HOAN_THANH, ORDER_STATUS.DA_IN), false);
});

test('canTransition: DA_HUY -> DANG_GIAO khong hop le (trang thai cuoi)', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_HUY, ORDER_STATUS.DANG_GIAO), false);
});

test('canTransition: DA_IN -> DANG_GIAO khong hop le (bo qua buoc)', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_IN, ORDER_STATUS.DANG_GIAO), false);
});

// ---------------------------------------------------------------------------
// canTransition — nhanh SU_CO
// ---------------------------------------------------------------------------

test('canTransition: -> SU_CO hop le tu cac trang thai van hanh', () => {
  assert.equal(canTransition(ORDER_STATUS.DA_NHAT_HANG,    ORDER_STATUS.SU_CO), true);
  assert.equal(canTransition(ORDER_STATUS.DANG_CHUYEN_KHO, ORDER_STATUS.SU_CO), true);
  assert.equal(canTransition(ORDER_STATUS.DANG_GIAO,       ORDER_STATUS.SU_CO), true);
  assert.equal(canTransition(ORDER_STATUS.DA_GIAO,         ORDER_STATUS.SU_CO), true);
});

test('canTransition: -> SU_CO KHONG hop le tu trang thai dau/cuoi', () => {
  assert.equal(canTransition(ORDER_STATUS.MOI_TAO,    ORDER_STATUS.SU_CO), false);
  assert.equal(canTransition(ORDER_STATUS.DA_IN,      ORDER_STATUS.SU_CO), false);
  assert.equal(canTransition(ORDER_STATUS.HOAN_THANH, ORDER_STATUS.SU_CO), false);
  assert.equal(canTransition(ORDER_STATUS.DA_HUY,     ORDER_STATUS.SU_CO), false);
});

// ---------------------------------------------------------------------------
// assertValidFlowWarehouse
// ---------------------------------------------------------------------------

test('assertValidFlowWarehouse: flow 1 va 3 yeu cau An Khanh', () => {
  // Hop le
  assert.doesNotThrow(() => assertValidFlowWarehouse(1, WAREHOUSES.AN_KHANH));
  assert.doesNotThrow(() => assertValidFlowWarehouse(3, WAREHOUSES.AN_KHANH));
  // Khong hop le
  assert.throws(
    () => assertValidFlowWarehouse(1, WAREHOUSES.TAN_PHU),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
  assert.throws(
    () => assertValidFlowWarehouse(3, WAREHOUSES.TAN_PHU),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
});

test('assertValidFlowWarehouse: flow 2 va 4 yeu cau Tan Phu', () => {
  assert.doesNotThrow(() => assertValidFlowWarehouse(2, WAREHOUSES.TAN_PHU));
  assert.doesNotThrow(() => assertValidFlowWarehouse(4, WAREHOUSES.TAN_PHU));
  assert.throws(
    () => assertValidFlowWarehouse(2, WAREHOUSES.AN_KHANH),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
  assert.throws(
    () => assertValidFlowWarehouse(4, WAREHOUSES.AN_KHANH),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
});

// ---------------------------------------------------------------------------
// describeTransition — phan biet NO_SUCH_TRANSITION vs FLOW_MISMATCH
// (de repository khong phai doan qua noi dung chuoi trang thai)
// ---------------------------------------------------------------------------

test('describeTransition: FLOW_MISMATCH khi cap ton tai nhung sai dieu kien flow', () => {
  assert.deepEqual(
    describeTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_CHUYEN_KHO, { flow: 1 }),
    { allowed: false, reason: 'FLOW_MISMATCH' }
  );
  assert.deepEqual(
    describeTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.DANG_GIAO, { flow: 3 }),
    { allowed: false, reason: 'FLOW_MISMATCH' }
  );
});

test('describeTransition: NO_SUCH_TRANSITION khi cap khong ton tai (khong lien quan flow)', () => {
  // Bo qua buoc, khong dinh gi den flow — truoc day bi gan nham FLOW_MISMATCH
  // vi repository doan qua chuoi "Nhặt"/"Chuyển" trong fromStatus.
  assert.deepEqual(
    describeTransition(ORDER_STATUS.DA_NHAT_HANG, ORDER_STATUS.HOAN_THANH, { flow: 1 }),
    { allowed: false, reason: 'NO_SUCH_TRANSITION' }
  );
  assert.deepEqual(
    describeTransition(ORDER_STATUS.DANG_CHUYEN_KHO, ORDER_STATUS.HOAN_THANH, { flow: 3 }),
    { allowed: false, reason: 'NO_SUCH_TRANSITION' }
  );
  assert.deepEqual(
    describeTransition(ORDER_STATUS.MOI_TAO, ORDER_STATUS.DA_GIAO),
    { allowed: false, reason: 'NO_SUCH_TRANSITION' }
  );
});

test('describeTransition: allowed true khong co reason', () => {
  assert.deepEqual(
    describeTransition(ORDER_STATUS.DA_GIAO, ORDER_STATUS.HOAN_THANH),
    { allowed: true, reason: null }
  );
});

test('assertValidFlowWarehouse: flow khong hop le throw INVALID_FLOW_WAREHOUSE', () => {
  assert.throws(
    () => assertValidFlowWarehouse(99, WAREHOUSES.AN_KHANH),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
  assert.throws(
    () => assertValidFlowWarehouse(0, WAREHOUSES.TAN_PHU),
    err => err.statusCode === 400 && err.code === 'INVALID_FLOW_WAREHOUSE'
  );
});
