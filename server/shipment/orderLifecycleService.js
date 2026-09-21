// ==========================================
// ORDER LIFECYCLE SERVICE — suy ra trang thai tom tat 6 muc tu 10 cot sheet
// "Vong doi don hang", theo dung dac ta muc 4 cua spec:
// docs/superpowers/specs/2026-09-04-order-lifecycle-status-lookup.md
// (cot K "Don da ky nhan" bo sung sau ngay 2026-09-14, khong nam trong spec goc)
// ==========================================
'use strict';

const repo = require('./orderLifecycleRepository');

function makeError(message, statusCode, code) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

const STATUS = Object.freeze({
  NOT_SENT: 'NOT_SENT',
  SENT_TO_ACCOUNTANT: 'SENT_TO_ACCOUNTANT',
  DELIVERING: 'DELIVERING',
  DELIVERED: 'DELIVERED',
  SHIP_RECEIVED: 'SHIP_RECEIVED',
  SIGNED: 'SIGNED',
  // 2 trang thai CHI dat duoc qua ghi de thu cong (Quan ly/Ke toan) — khong
  // co moc thoi gian tuong ung nen computeStatus() khong bao gio tra ve.
  EXCEPTION: 'EXCEPTION',
  CANCELLED: 'CANCELLED'
});

const STATUS_LABEL = Object.freeze({
  [STATUS.NOT_SENT]: 'Đơn chưa gửi kế toán',
  [STATUS.SENT_TO_ACCOUNTANT]: 'Đơn đã gửi kế toán',
  [STATUS.DELIVERING]: 'Đơn đang được giao',
  [STATUS.DELIVERED]: 'Đơn đã giao thành công',
  [STATUS.SHIP_RECEIVED]: 'Ship đã nhận đơn',
  [STATUS.SIGNED]: 'Đơn đã ký nhận',
  [STATUS.EXCEPTION]: 'Sự cố',
  [STATUS.CANCELLED]: 'Đã hủy'
});

// Thu tu tien do cua 6 trang thai TINH TOAN duoc (khong bao gom EXCEPTION/
// CANCELLED — 2 trang thai nay khong nam trong luong tien do binh thuong nen
// khong so sanh rank duoc, luon thang tuyet doi khi da ghi de — xem
// computeEffectiveStatus).
const STATUS_RANK = Object.freeze({
  [STATUS.NOT_SENT]: 0,
  [STATUS.SENT_TO_ACCOUNTANT]: 1,
  [STATUS.DELIVERING]: 2,
  [STATUS.DELIVERED]: 3,
  [STATUS.SHIP_RECEIVED]: 4,
  [STATUS.SIGNED]: 5
});

// Nhan TEN COT chinh xac (khac STATUS_LABEL la cau mo ta) — dung cho bang tra
// cuu nhieu ma o tab "Tong quan" (yeu cau: "trang thai (tuong ung ten cot)").
// Dung hang so co dinh theo SCHEMA_HEADERS, KHONG doc header that tu sheet vi
// tab HN/SG co the ghi khac chu (da xac minh: tab SG ghi "Ke toan duyet" thay
// vi "Ke toan duyet don" o cung vi tri cot) — dam bao nhan luon nhat quan.
const STATUS_COLUMN_LABEL = Object.freeze({
  [STATUS.NOT_SENT]: null,
  [STATUS.SENT_TO_ACCOUNTANT]: 'Sale gửi đơn cho kế toán',
  [STATUS.DELIVERING]: 'Tài xế gửi xác nhận giao hàng',
  [STATUS.DELIVERED]: 'Xác nhận đã giao/khách kí nhận',
  [STATUS.SHIP_RECEIVED]: 'Ship nhận đơn',
  [STATUS.SIGNED]: 'Đơn đã ký nhận',
  // Khong co cot moc thoi gian tuong ung (chi den tu ghi de thu cong) — dung
  // lai STATUS_LABEL lam nhan hien thi.
  [STATUS.EXCEPTION]: STATUS_LABEL[STATUS.EXCEPTION],
  [STATUS.CANCELLED]: STATUS_LABEL[STATUS.CANCELLED]
});

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * Trang thai hien tai = muc cao nhat ma cot moc tuong ung da co gia tri, xet
 * uu tien K > J > H > F > C — BO QUA D va G (chi theo sau C/F trong quy
 * trinh that, khong tao trang thai rieng). Cot K (Don da ky nhan) la moc SAU
 * CUNG trong quy trinh (sau khi ship da nhan don o cot J) nen luon uu tien
 * cao nhat. Edge case phong thu: D/G co gia tri nhung C/F tuong ung trong (du
 * lieu bot loi) van ap dung bang nay, KHONG doc D/G.
 */
function computeStatus(record) {
  if (record && hasValue(record.orderSignedAt)) {
    return { code: STATUS.SIGNED, label: STATUS_LABEL[STATUS.SIGNED], actor: null, at: record.orderSignedAt };
  }
  if (record && hasValue(record.shipReceivedAt)) {
    return { code: STATUS.SHIP_RECEIVED, label: STATUS_LABEL[STATUS.SHIP_RECEIVED], actor: null, at: record.shipReceivedAt };
  }
  if (record && hasValue(record.deliveryConfirmedAt)) {
    return { code: STATUS.DELIVERED, label: STATUS_LABEL[STATUS.DELIVERED], actor: null, at: record.deliveryConfirmedAt };
  }
  if (record && hasValue(record.driverConfirmedDeliveryAt)) {
    return {
      code: STATUS.DELIVERING,
      label: STATUS_LABEL[STATUS.DELIVERING],
      actor: record.driverName || '',
      at: record.driverConfirmedDeliveryAt
    };
  }
  if (record && hasValue(record.saleSentAt)) {
    return {
      code: STATUS.SENT_TO_ACCOUNTANT,
      label: STATUS_LABEL[STATUS.SENT_TO_ACCOUNTANT],
      actor: record.saleName || '',
      at: record.saleSentAt
    };
  }
  return { code: STATUS.NOT_SENT, label: STATUS_LABEL[STATUS.NOT_SENT], actor: null, at: null };
}

function normalizeCode(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

/**
 * Ap dung ghi de (neu co) len trang thai tinh toan tu moc thoi gian.
 * - Khong co override -> giu nguyen computed.
 * - Override EXCEPTION/CANCELLED -> luon thang (khong co rank de so sanh).
 * - Override la 1 trong 6 trang thai thuong -> dong vai "muc san": trang
 *   thai nao co rank cao hon thi thang, de du lieu bot tien xa hon khong bi
 *   ket o trang thai da ghi de truoc do.
 */
function computeEffectiveStatus(record, overrideEntry) {
  const computed = computeStatus(record);
  if (!overrideEntry) return computed;

  const overrideCode = overrideEntry.to_status_code;
  if (overrideCode === STATUS.EXCEPTION || overrideCode === STATUS.CANCELLED) {
    return {
      code: overrideCode,
      label: STATUS_LABEL[overrideCode],
      actor: overrideEntry.changed_by || null,
      at: overrideEntry.changed_at || null,
      isOverride: true
    };
  }

  const computedRank = STATUS_RANK[computed.code];
  const overrideRank = STATUS_RANK[overrideCode];
  if (overrideRank === undefined || computedRank >= overrideRank) return computed;

  return {
    code: overrideCode,
    label: STATUS_LABEL[overrideCode],
    actor: overrideEntry.changed_by || null,
    at: overrideEntry.changed_at || null,
    isOverride: true
  };
}

/**
 * Xay map ma don (da chuan hoa) -> dong ghi de MOI NHAT tu tab "Lich su cap
 * nhat". Sheets append luon theo thu tu thoi gian nen dong cuoi cung khop
 * ma don chinh la ghi de hien hanh — khong can so sanh timestamp.
 */
function latestOverrideByCode(historyRows) {
  const map = new Map();
  historyRows.forEach(row => {
    const key = normalizeCode(row.order_code);
    if (key) map.set(key, row);
  });
  return map;
}

/**
 * Chi tiet day du 10 cot, y het 1 hang trong Google Sheet (o trong hien "—" do
 * client dam nhiem hien thi, o day chi tra chuoi rong nguyen ban).
 */
function toDetail(record) {
  return {
    orderCode: record.orderCode,
    saleName: record.saleName,
    customerName: record.customerName,
    saleSentAt: record.saleSentAt,
    accountantApprovedOrderAt: record.accountantApprovedOrderAt,
    driverName: record.driverName,
    driverConfirmedDeliveryAt: record.driverConfirmedDeliveryAt,
    accountantApprovedDeliveryAt: record.accountantApprovedDeliveryAt,
    deliveryConfirmedAt: record.deliveryConfirmedAt,
    shipReceivedAt: record.shipReceivedAt,
    orderSignedAt: record.orderSignedAt
  };
}

/**
 * Tra cuu 1 don theo ma (trim, khong phan biet hoa/thuong). Ma khong ton tai
 * trong ca 2 tab -> found:false + summary "Đơn chưa gửi kế toán" (KHONG loi
 * 404 kho hieu, dung theo yeu cau Success Criteria cua spec).
 */
async function findOrder(orderCode) {
  const target = normalizeCode(orderCode);
  if (!target) {
    return { found: false, summary: computeStatus(null) };
  }
  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const record = records.find(r => normalizeCode(r.orderCode) === target);
  if (!record) {
    return { found: false, summary: computeStatus(null) };
  }
  const overrides = latestOverrideByCode(historyRows);
  return {
    found: true,
    branch: record._branch,
    summary: computeEffectiveStatus(record, overrides.get(target)),
    detail: toDetail(record)
  };
}

/**
 * Toan bo don tu ca 2 tab, giu nguyen thu tu hang trong sheet. branchFilter
 * tuy chon ('HN'|'SG') tu query string.
 */
async function listAllOrders(branchFilter) {
  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const overrides = latestOverrideByCode(historyRows);
  const filtered = branchFilter ? records.filter(r => r._branch === branchFilter) : records;
  return filtered.map(record => Object.assign(toDetail(record), {
    branch: record._branch,
    summary: computeEffectiveStatus(record, overrides.get(normalizeCode(record.orderCode)))
  }));
}

/**
 * Toan bo lich su ghi de trang thai (tab "Lich su cap nhat" tren Google Sheet
 * — truoc gio chi duoc doc noi bo de tinh trang thai hieu luc, chua co giao
 * dien xem). Moi nhat hien truoc: sheet ghi noi tiep theo thu tu thoi gian
 * (append-only) nen chi can dao nguoc mang, khong can parse/so sanh timestamp.
 * Kem branch (join theo ma don voi bang chinh) de UI loc theo co so giong
 * Khu B; don khong con trong bang chinh (vd ma go nham luc ghi de) -> branch null.
 */
async function listHistory() {
  const [historyRows, records] = await Promise.all([repo.readOverrideHistory(), repo.readAll()]);
  const branchByCode = new Map();
  records.forEach(record => {
    const key = normalizeCode(record.orderCode);
    if (!branchByCode.has(key)) branchByCode.set(key, record._branch);
  });
  return historyRows.slice().reverse().map(row => ({
    historyId: row.history_id,
    orderCode: row.order_code,
    branch: branchByCode.get(normalizeCode(row.order_code)) || null,
    statusCode: row.to_status_code,
    statusLabel: row.to_status_label,
    // Cac dong ghi TRUOC khi co cot nay (2026-09-14) -> rong, xem HISTORY_SCHEMA.
    fromStatusCode: row.from_status_code || '',
    fromStatusLabel: row.from_status_label || '',
    changedBy: row.changed_by,
    changedByRole: row.changed_by_role,
    changedAt: row.changed_at,
    note: row.note,
    message: row.message
  }));
}

const MAX_LOOKUP_CODES = 50;

function validateLookupCodes(rawCodes) {
  if (!Array.isArray(rawCodes)) {
    const err = new Error('Danh sách mã đơn hàng không hợp lệ.');
    err.statusCode = 400;
    err.code = 'INVALID_CODES';
    throw err;
  }
  if (rawCodes.length > MAX_LOOKUP_CODES) {
    const err = new Error(`Chỉ được tra cứu tối đa ${MAX_LOOKUP_CODES} mã đơn hàng mỗi lần.`);
    err.statusCode = 400;
    err.code = 'TOO_MANY_CODES';
    throw err;
  }
  const seen = new Set();
  const codes = [];
  rawCodes.forEach(rawCode => {
    if (typeof rawCode !== 'string' && typeof rawCode !== 'number') {
      const err = new Error('Mỗi mã đơn hàng phải là chuỗi hoặc số.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const code = String(rawCode).trim();
    if (!code) return;
    if (code.length > 100) {
      const err = new Error('Mã đơn hàng không được dài quá 100 ký tự.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const key = normalizeCode(code);
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({ code, key });
    }
  });
  return codes;
}

/**
 * Tra cuu NHIEU ma don cung luc (tab "Tong quan"). Voi moi ma: tra ve sale,
 * khach hang, TEN COT co thoi gian moi nhat (bo qua 2 cot ke toan duyet —
 * dung STATUS_COLUMN_LABEL, khong tao trang thai rieng cho D/G, giu dung logic
 * computeStatus da co) + thoi gian tuong ung. Ma khong ton tai -> found:false.
 */
async function findOrdersBulk(rawCodes) {
  const codes = validateLookupCodes(rawCodes);
  if (!codes.length) return [];

  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const overrides = latestOverrideByCode(historyRows);
  const byKey = new Map();
  records.forEach(record => {
    const key = normalizeCode(record.orderCode);
    if (!byKey.has(key)) byKey.set(key, record);
  });

  return codes.map(({ code, key }) => {
    const record = byKey.get(key);
    if (!record) return { code, found: false };
    const summary = computeEffectiveStatus(record, overrides.get(key));
    return {
      code,
      found: true,
      // Nhan co so nguon ('HN'|'SG'): ket qua tra cuu luon gom ca 2 tab nen
      // moi dong phai tu noi no den tu co so nao.
      branch: record._branch,
      saleName: record.saleName || '',
      customerName: record.customerName || '',
      statusLabel: STATUS_COLUMN_LABEL[summary.code],
      at: summary.at
    };
  });
}

/**
 * Danh sach don de xuat Excel — dung chung logic voi listAllOrders nhung theo
 * dung THU TU cac ma duoc truyen vao (khop voi bang da loc/sap xep tren UI).
 * Khong truyen codes (hoac mang rong) -> xuat toan bo (giu thu tu trong sheet).
 */
async function exportOrdersByCodes(codes) {
  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const overrides = latestOverrideByCode(historyRows);
  if (!Array.isArray(codes) || codes.length === 0) {
    return records.map(record => Object.assign(toDetail(record), {
      branch: record._branch,
      summary: computeEffectiveStatus(record, overrides.get(normalizeCode(record.orderCode)))
    }));
  }
  const byKey = new Map();
  records.forEach(record => {
    const key = normalizeCode(record.orderCode);
    if (!byKey.has(key)) byKey.set(key, record);
  });
  return codes
    .map(code => byKey.get(normalizeCode(code)))
    .filter(Boolean)
    .map(record => Object.assign(toDetail(record), {
      branch: record._branch,
      summary: computeEffectiveStatus(record, overrides.get(normalizeCode(record.orderCode)))
    }));
}

/**
 * Ghi de trang thai thu cong (Quan ly/Ke toan). Validate ma don co that (nam
 * trong 2 tab DonHang_HN/SG) truoc khi ghi — tranh tao lich su cho ma khong
 * ton tai. Tra ve trang thai hieu luc MOI NHAT sau khi ghi.
 */
async function overrideStatus(orderCode, { code, changedBy, changedByRole, note = '' }) {
  if (!STATUS_LABEL[code]) {
    throw makeError(`Trạng thái "${code}" không hợp lệ.`, 400, 'INVALID_STATUS');
  }

  const target = normalizeCode(orderCode);
  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const record = records.find(r => normalizeCode(r.orderCode) === target);
  if (!record) {
    throw makeError(`Không tìm thấy đơn hàng "${orderCode}" trong bảng vòng đời đơn hàng.`, 404, 'ORDER_NOT_FOUND');
  }

  // Trang thai hieu luc NGAY TRUOC lan ghi de nay — luu lai de hien "trang
  // thai cu" tren tab Lich su cap nhat (khong the suy nguoc tu cac dong lich
  // su SAU nay vi override la mot "muc san", khong phai always-overwrite).
  const overrides = latestOverrideByCode(historyRows);
  const fromStatus = computeEffectiveStatus(record, overrides.get(target));

  const message = `${changedBy} - ${changedByRole} đã cập nhật đơn hàng sang trạng thái ${STATUS_LABEL[code]}.`;
  const entry = await repo.appendOverride({
    order_code: record.orderCode,
    to_status_code: code,
    to_status_label: STATUS_LABEL[code],
    from_status_code: fromStatus.code,
    from_status_label: fromStatus.label,
    changed_by: changedBy,
    changed_by_role: changedByRole,
    note,
    message
  });

  return {
    orderCode: record.orderCode,
    branch: record._branch,
    summary: computeEffectiveStatus(record, entry)
  };
}

module.exports = {
  STATUS, STATUS_LABEL, STATUS_COLUMN_LABEL, STATUS_RANK,
  computeStatus, computeEffectiveStatus, findOrder, listAllOrders, findOrdersBulk,
  exportOrdersByCodes, overrideStatus, listHistory,
  MAX_LOOKUP_CODES
};
