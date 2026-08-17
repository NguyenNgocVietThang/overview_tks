// ==========================================
// ORDER STATE MACHINE — logic chuyen trang thai don van chuyen.
//
// Module nay THUAN TIEN ich (khong goi Sheets API, khong goi mang) de
// de unit-test doc lap. Moi hanh dong ghi / doc spreadsheet nam o
// vcOrderRepository.js.
//
// Xem phase1b_backend_state_machine_api.md muc 4 de biet day du dac ta
// bao gom transition table, guard flow, va nhanh ngoai le SU_CO.
// ==========================================
'use strict';

// ---------------------------------------------------------------------------
// 4.1 — Trang thai don hang (luu chinh xac chuoi tieng Viet nay vao sheet)
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const ORDER_STATUS = Object.freeze({
  MOI_TAO:          'Mới tạo',
  DA_IN:            'Đã in',
  DA_NHAT_HANG:     'Đã nhặt hàng',
  DANG_CHUYEN_KHO:  'Đang chuyển kho',
  DANG_GIAO:        'Đang giao',
  DA_GIAO:          'Đã giao',
  HOAN_THANH:       'Hoàn thành',
  SU_CO:            'Sự cố',
  DA_HUY:           'Đã hủy'
});

// ---------------------------------------------------------------------------
// Luong giao hang (xem muc 5 Plan Process Automation.md)
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, number>>} */
const FLOWS = Object.freeze({
  HN_XE_CTY:   1,  // Ha Noi — xe cong ty, kho An Khanh
  SG_XE_CTY:   2,  // Sai Gon — xe cong ty, kho Tan Phu
  HN_TAU_HOA:  3,  // Ha Noi — tau hoa, kho An Khanh (trung chuyen)
  SG_SHIPPER:  4   // Sai Gon — shipper, kho Tan Phu
});

// ---------------------------------------------------------------------------
// Kho xuat hang
// ---------------------------------------------------------------------------

/** @type {Readonly<Record<string, string>>} */
const WAREHOUSES = Object.freeze({
  AN_KHANH: 'An Khánh',
  TAN_PHU:  'Tân Phú'
});

// ---------------------------------------------------------------------------
// 4.3 — Tap trang thai duoc phep chuyen sang SU_CO (Exception branch)
// ---------------------------------------------------------------------------

/**
 * Cac trang thai ma don duoc phep chuyen sang SU_CO.
 * Khong bao gom MOI_TAO/DA_IN (chua phat sinh van chuyen thuc te)
 * va HOAN_THANH/DA_HUY (trang thai cuoi).
 */
const EXCEPTION_ELIGIBLE_STATUSES = Object.freeze(new Set([
  ORDER_STATUS.DA_NHAT_HANG,
  ORDER_STATUS.DANG_CHUYEN_KHO,
  ORDER_STATUS.DANG_GIAO,
  ORDER_STATUS.DA_GIAO
]));

// ---------------------------------------------------------------------------
// 4.2 — Bang chuyen trang thai hop le (transition table)
//
// Moi entry: [fromStatus, toStatus, flowCondition|null]
//   - flowCondition === null  => khong co rang buoc luong
//   - flowCondition === 3     => chi hop le khi flow === 3
//   - flowCondition === '!3'  => chi hop le khi flow !== 3
// ---------------------------------------------------------------------------

const TRANSITION_TABLE = [
  // from               to                    flowCondition
  [ORDER_STATUS.MOI_TAO,         ORDER_STATUS.DA_IN,            null],
  [ORDER_STATUS.DA_IN,           ORDER_STATUS.DA_NHAT_HANG,     null],
  [ORDER_STATUS.DA_NHAT_HANG,    ORDER_STATUS.DANG_CHUYEN_KHO,  3   ],  // chi flow 3
  [ORDER_STATUS.DA_NHAT_HANG,    ORDER_STATUS.DANG_GIAO,        '!3'],  // chi flow khac 3
  [ORDER_STATUS.DANG_CHUYEN_KHO, ORDER_STATUS.DANG_GIAO,        3   ],  // chi flow 3
  [ORDER_STATUS.DANG_GIAO,       ORDER_STATUS.DA_GIAO,          null],
  [ORDER_STATUS.DA_GIAO,         ORDER_STATUS.HOAN_THANH,       null]
];

// ---------------------------------------------------------------------------
// canTransition — tra ve true/false (khong throw)
// ---------------------------------------------------------------------------

/**
 * Kiem tra lien ket chuyen trang thai co hop le khong.
 *
 * @param {string} fromStatus  Trang thai hien tai (chuoi tieng Viet, vd 'Đang giao')
 * @param {string} toStatus    Trang thai dich (chuoi tieng Viet)
 * @param {{ flow?: number }}  [opts]  flow la so nguyen tu FLOWS
 * @returns {boolean}
 */
function canTransition(fromStatus, toStatus, opts = {}) {
  return describeTransition(fromStatus, toStatus, opts).allowed;
}

// ---------------------------------------------------------------------------
// describeTransition — nhu canTransition nhung tra ve them ly do khi false,
// de tang goi (vd vcOrderRepository) chon dung ma loi ma khong can doan qua
// noi dung chuoi trang thai tieng Viet.
// ---------------------------------------------------------------------------

/**
 * @param {string} fromStatus
 * @param {string} toStatus
 * @param {{ flow?: number }} [opts]
 * @returns {{ allowed: boolean, reason: null|'NO_SUCH_TRANSITION'|'FLOW_MISMATCH' }}
 */
function describeTransition(fromStatus, toStatus, opts = {}) {
  const { flow } = opts;

  // Nhanh ngoai le SU_CO: kiem tra rieng (khong co trong TRANSITION_TABLE)
  if (toStatus === ORDER_STATUS.SU_CO) {
    const allowed = EXCEPTION_ELIGIBLE_STATUSES.has(fromStatus);
    return { allowed, reason: allowed ? null : 'NO_SUCH_TRANSITION' };
  }
  // DA_HUY chi den tu SU_CO qua resolve 'CANCEL' (xu ly o repository, khong
  // can xuat hien o day vi canTransition khong duoc goi cho buoc do).

  const match = TRANSITION_TABLE.find(([from, to]) => from === fromStatus && to === toStatus);
  if (!match) return { allowed: false, reason: 'NO_SUCH_TRANSITION' };

  const [, , flowCond] = match;
  if (flowCond === null) return { allowed: true, reason: null };
  if (flowCond === 3)    return { allowed: flow === 3,  reason: flow === 3  ? null : 'FLOW_MISMATCH' };
  if (flowCond === '!3') return { allowed: flow !== 3,  reason: flow !== 3  ? null : 'FLOW_MISMATCH' };
  return { allowed: false, reason: 'NO_SUCH_TRANSITION' };
}

// ---------------------------------------------------------------------------
// assertValidFlowWarehouse — throw loi 400 neu cap flow/warehouse sai
// ---------------------------------------------------------------------------

/**
 * Kiem tra rang buoc luong <-> kho:
 *   - flow 1, 3 => warehouse phai la 'An Khanh'
 *   - flow 2, 4 => warehouse phai la 'Tan Phu'
 *
 * @param {number} flow        Gia tri tu FLOWS
 * @param {string} warehouse   Gia tri tu WAREHOUSES
 * @throws {{ statusCode: 400, code: 'INVALID_FLOW_WAREHOUSE' }}
 */
function assertValidFlowWarehouse(flow, warehouse) {
  const validFlows = new Set(Object.values(FLOWS));
  if (!validFlows.has(flow)) {
    const err = new Error(`Luồng giao hàng không hợp lệ: ${flow}. Phải là một trong: ${[...validFlows].join(', ')}.`);
    err.statusCode = 400;
    err.code = 'INVALID_FLOW_WAREHOUSE';
    throw err;
  }

  const isHanoi = flow === FLOWS.HN_XE_CTY || flow === FLOWS.HN_TAU_HOA; // 1 hoac 3
  const expected = isHanoi ? WAREHOUSES.AN_KHANH : WAREHOUSES.TAN_PHU;

  if (warehouse !== expected) {
    const err = new Error(
      `Luồng ${flow} yêu cầu kho "${expected}", nhưng nhận được "${warehouse}".`
    );
    err.statusCode = 400;
    err.code = 'INVALID_FLOW_WAREHOUSE';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  ORDER_STATUS,
  FLOWS,
  WAREHOUSES,
  EXCEPTION_ELIGIBLE_STATUSES,
  canTransition,
  describeTransition,
  assertValidFlowWarehouse
};
