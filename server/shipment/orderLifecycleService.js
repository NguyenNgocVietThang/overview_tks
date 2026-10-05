// ==========================================
// ORDER LIFECYCLE SERVICE — suy ra trang thai tom tat 6 muc tu 10 cot sheet
// "Vong doi don hang", theo dung dac ta muc 4 cua spec:
// docs/superpowers/specs/2026-09-04-order-lifecycle-status-lookup.md
// (cot K "Don da ky nhan" bo sung sau ngay 2026-09-14, khong nam trong spec goc)
// ==========================================
'use strict';

const repo = require('./orderLifecycleRepository');
const query = require('./orderLifecycleQuery');

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
  [STATUS.SHIP_RECEIVED]: 'Đã nhận (Tại kho)',
  [STATUS.SIGNED]: 'Đã nhận (Đi giao xong)',
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
  // 2026-10-02: cot H (deliveryConfirmedAt) khong con quyet dinh trang thai o bang tong quan;
  // gia tri van nam trong toDetail() de hop chi tiet hien nhu cu. DELIVERED chi con qua ghi de thu cong.
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

// ---------------------------------------------------------------------------
// Canh bao qua 24h: tu luc Sale ra don (cot "Sale gui don cho ke toan") den luc
// don dang van chuyen (cot "Tai xe gui xac nhan giao hang").
// ---------------------------------------------------------------------------
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const VN_UTC_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh, khong co gio mua he

/**
 * Doi 1 o thoi gian cua sheet ("dd/MM/yyyy HH:mm[:ss]", "dd/MM/yyyy", ma "15,35"
 * thay vi "15:35", hoac "YYYY-MM-DD HH:mm:ss" cua tab Lich su cap nhat) thanh
 * moc UTC (ms), coi gio tren sheet la gio Viet Nam nen ket qua khong phu thuoc
 * mui gio may chu. Khong doc duoc -> null.
 */
function parseSheetTimeMs(value) {
  const text = String(value == null ? '' : value).trim();
  let parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2})[:,h.](\d{2})(?:[:.](\d{2}))?)?/);
  let day, month, year;
  if (parts) {
    [day, month, year] = [parts[1], parts[2], parts[3]];
  } else {
    parts = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!parts) return null;
    [year, month, day] = [parts[1], parts[2], parts[3]];
  }
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day),
    Number(parts[4] || 0), Number(parts[5] || 0), Number(parts[6] || 0));
  return Number.isNaN(ms) ? null : ms - VN_UTC_OFFSET_MS;
}

/**
 * true = phai hien "Canh bao" (qua 24h ke tu luc Sale ra don ma:
 *   - don da van chuyen nhung luc do da cach luc ra don > 24h, hoac
 *   - don CHUA van chuyen ma hien tai da cach luc ra don > 24h).
 * Khong bao gio canh bao khi chua co "Sale gui don cho ke toan" (du cac cot sau
 * da co gia tri: dang van chuyen, hoan thanh, su co...) hoac don da huy/su co
 * ma chua tung van chuyen (khong con cho giao).
 */
function computeOverdueWarning(record, summary, now = Date.now()) {
  const sentAt = parseSheetTimeMs(record && record.saleSentAt);
  if (sentAt === null) return false;

  // Moc "dang van chuyen": uu tien cot Tai xe, neu bot loi bo trong thi lay moc
  // som nhat cua cac cot sau no (don chac chan da qua khau van chuyen).
  let transitAt = null;
  ['driverConfirmedDeliveryAt', 'deliveryConfirmedAt', 'shipReceivedAt', 'orderSignedAt'].some(key => {
    transitAt = parseSheetTimeMs(record[key]);
    return transitAt !== null;
  });
  if (transitAt === null && summary && summary.isOverride && STATUS_RANK[summary.code] >= STATUS_RANK[STATUS.DELIVERING]) {
    transitAt = parseSheetTimeMs(summary.at);
  }

  if (transitAt !== null) return transitAt - sentAt > OVERDUE_MS;
  if (summary && (summary.code === STATUS.CANCELLED || summary.code === STATUS.EXCEPTION)) return false;
  return now - sentAt > OVERDUE_MS;
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

/** 1 dong cua bang "Toan bo don hang": chi tiet + co so + trang thai hieu luc + canh bao. */
function toOrderRow(record, overrideEntry) {
  const summary = computeEffectiveStatus(record, overrideEntry);
  return Object.assign(toDetail(record), {
    branch: record._branch,
    summary,
    warning: computeOverdueWarning(record, summary)
  });
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

// ---------------------------------------------------------------------------
// GOP don cua KiotViet vao bang "Toan bo don hang" (2026-10-01; mo rong MOI trang thai 2026-10-02)
//
// Khi doc duoc Kiot, bang gom MOI don dat hang tren Kiot (Phieu tam, Da xac nhan, Dang giao hang, Hoan
// thanh, Da huy; ~60 nghin don) — dong sheet khong khop don Kiot nao bi bo; Sale/Khach/Ghi chu lay tu Kiot.
// Khoa gop = (co so HN/SG, ma don chuan hoa) — cung ma DH ton tai o ca 2 co so (18.222 ma trung
// ve toan bo lich su vi ca 2 cung dem tu DH000001) nen KHONG duoc khop theo ma don thuan.
// Dong Google Sheet THANG khi trung (giu nguyen trang thai tu cac moc thoi gian + ghi de); don chi
// co o Kiot -> trang thai san co NOT_SENT "Đơn chưa gửi kế toán" (thap nhat), khong ap ghi de
// (ghi de chi chay voi ma co trong sheet, va lich su ghi de khoa theo ma don thuan khong theo co so).
// Truong them: source ('sheet'|'kiotviet'), kiotStatus (trang thai tren Kiot; '' neu khong co don Kiot),
// note (ghi chu cua don Kiot), sellableValue (Gia tri co ban; chi don Phieu tam, con lai null), orderTotal,
// orderDate. Danh sach ~60 nghin dong KHONG bao gio gui nguyen xuong trinh duyet: queryOrders loc/sap
// xep/cat trang tren may chu (orderLifecycleQuery.js).
// ---------------------------------------------------------------------------

function kiotKey(branch, code) {
  return `${branch}|${normalizeCode(code)}`;
}

/**
 * Don "chua gui ke toan" chua co moc thoi gian nao (summary.at = null) nen lay THOI GIAN DAT HANG tren Kiot
 * lam moc "Cap nhat gan nhat" — khong sinh them cot. Don da sang trang thai khac giu nguyen moc cua no.
 */
function withOrderDateAsUpdate(row, orderDate) {
  if (!orderDate || !row.summary || row.summary.code !== STATUS.NOT_SENT || hasValue(row.summary.at)) return row;
  return Object.assign(row, { summary: Object.assign({}, row.summary, { at: orderDate }) });
}

/**
 * Dong cho don chi co o Kiot (khong co dong sheet): "Don chua gui ke toan", cac moc sheet de trong, khong canh bao.
 * Dong GON (khong tao 11 truong chuoi rong nhu dong sheet) vi co toi ~60 nghin dong trong bo nho.
 */
function kiotOnlyRow(order) {
  return {
    orderCode: order.code,
    branch: order.branch,
    saleName: order.saleName || '',
    customerName: order.customerName || '',
    saleSentAt: '',
    summary: { code: STATUS.NOT_SENT, label: STATUS_LABEL[STATUS.NOT_SENT], actor: null, at: order.orderDate || null },
    warning: false,
    source: 'kiotviet',
    kiotStatus: order.kiotStatus || '',
    sellableValue: order.sellableValue,
    orderTotal: order.total,
    orderDate: order.orderDate,
    note: order.note || ''
  };
}

/**
 * HAM THUAN. Gop dong sheet + don Kiot (moi trang thai) thanh danh sach dong cho bang.
 * `kiotResult` = ket qua readOrders() ({ok, orders}); khong ok/khong co thi chi con dong sheet (khong co du lieu Kiot).
 * Thu tu: dong sheet nhu cu, sau do don chi-Kiot (da sap moi nhat truoc boi kiotOrdersRepository).
 */
function mergeRows({ records, overrides, kiotResult }) {
  const kiotOk = !!(kiotResult && kiotResult.ok && Array.isArray(kiotResult.orders));
  const kiotOrders = kiotOk ? kiotResult.orders : [];
  const kiotByKey = new Map(kiotOrders.map(order => [kiotKey(order.branch, order.code), order]));
  const matched = new Set();

  const rows = [];
  records.forEach(record => {
    const key = kiotKey(record._branch, record.orderCode);
    const kiotOrder = normalizeCode(record.orderCode) ? kiotByKey.get(key) : undefined;
    // Doc duoc Kiot: bang CHI gom don co tren Kiot — dong sheet khong khop (khong co tren Kiot) bi bo; moi don
    // chi 1 dong (sheet trung ma thi lay dong dau). Kiot loi: giu dong sheet nhu cu (giao dien hien canh bao).
    if (kiotOk && (!kiotOrder || matched.has(key))) return;
    const row = toOrderRow(record, overrides.get(normalizeCode(record.orderCode)));
    if (kiotOrder) matched.add(key);
    Object.assign(row, {
      source: 'sheet',
      kiotStatus: kiotOrder ? (kiotOrder.kiotStatus || '') : '',
      sellableValue: kiotOrder ? kiotOrder.sellableValue : null,
      orderTotal: kiotOrder ? kiotOrder.total : null,
      orderDate: kiotOrder ? kiotOrder.orderDate : '',
      note: kiotOrder ? (kiotOrder.note || '') : ''
    });
    // Sale + khach hang lay tu don Kiot (khong doc o sheet); sheet chi cung cap cac moc thoi gian/trang thai.
    if (kiotOrder) Object.assign(row, { saleName: kiotOrder.saleName || '', customerName: kiotOrder.customerName || '' });
    rows.push(withOrderDateAsUpdate(row, row.orderDate));
  });

  kiotOrders.forEach(order => {
    if (matched.has(kiotKey(order.branch, order.code))) return;
    rows.push(kiotOnlyRow(order));
  });
  return rows;
}

/** Tom tat tinh trang nguon Kiot de giao dien hien thong bao khi loi (null = khong gop Kiot). */
function kiotMeta(kiotResult) {
  if (!kiotResult) return null;
  return {
    ok: !!kiotResult.ok,
    stale: !!kiotResult.stale,
    fetchedAt: kiotResult.fetchedAt || null,
    count: Array.isArray(kiotResult.orders) ? kiotResult.orders.length : 0
  };
}

// Danh sach dong da gop duoc DUNG LAI giua cac request khi du lieu nguon khong doi (ban gop ~60 nghin dong).
// Khoa: noi dung sheet + lich su ghi de, danh sach don Kiot (theo THAM CHIEU mang — repository chi doi mang
// khi doc lai DB) va PHUT hien tai (canh bao qua 24h phu thuoc dong ho, khong chi du lieu).
const WARNING_BUCKET_MS = 60 * 1000;
let mergedCache = null; // { sheetKey, kiotRef, bucket, rows }
const selectionCache = query.createSelectionCache(); // tu bo het khi mang dong nguon doi (xem createSelectionCache)

async function loadMergedRows(kiot) {
  const [records, historyRows, kiotResult] = await Promise.all([
    repo.readAll(),
    repo.readOverrideHistory(),
    kiot ? kiot.readOrders() : Promise.resolve(null)
  ]);
  const sheetKey = JSON.stringify([records, historyRows]);
  const kiotRef = !kiotResult ? 'none' : (kiotResult.ok && Array.isArray(kiotResult.orders) ? kiotResult.orders : 'failed');
  const bucket = Math.floor(Date.now() / WARNING_BUCKET_MS);
  if (mergedCache && mergedCache.sheetKey === sheetKey && mergedCache.kiotRef === kiotRef && mergedCache.bucket === bucket) {
    return { rows: mergedCache.rows, kiotResult };
  }
  const overrides = latestOverrideByCode(historyRows);
  const rows = mergeRows({ records, overrides, kiotResult });
  mergedCache = { sheetKey, kiotRef, bucket, rows };
  return { rows, kiotResult };
}

/**
 * Mot TRANG cua bang "Toan bo don hang". `rawParams` la query string cua GET (branch, status, kiotStatus,
 * dateField, from, to, mode, q, sort, dir, page, pageSize — xem orderLifecycleQuery.parseParams; tham so sai
 * -> loi 400). `kiot` (repository co readOrders(), khong bao gio throw) tuy chon: khong truyen thi chi co dong sheet.
 * Tra { orders (cac dong cua trang), page, pageSize, totalPages, total (don trong co so da chon, chua loc),
 * filteredTotal (sau loc), kiotStatuses (cho o loc), kiot (tom tat nguon Kiot | null) }.
 */
async function queryOrders(rawParams, { kiot } = {}) {
  const params = query.parseParams(rawParams);
  const { rows, kiotResult } = await loadMergedRows(kiot);
  const scope = query.rowsInBranch(rows, params.branch);
  const selected = selectionCache.select(rows, params);
  const paged = query.paginate(selected, params.page, params.pageSize);
  return {
    orders: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
    total: scope.length,
    filteredTotal: selected.length,
    kiotStatuses: query.distinctKiotStatuses(scope),
    kiot: kiotMeta(kiotResult)
  };
}

/**
 * Toan bo dong DA LOC + SAP XEP (moi trang, khong cat trang) de xuat Excel — cung bo tham so voi queryOrders
 * nen file khop dung bang tren man hinh. Khong truyen bo loc nao -> toan bo (don moi dat nhat truoc).
 */
async function exportOrders(rawParams, { kiot } = {}) {
  const params = query.parseParams(rawParams);
  const { rows } = await loadMergedRows(kiot);
  return selectionCache.select(rows, params);
}

/**
 * Toan bo don tu ca 2 tab, giu nguyen thu tu hang trong sheet. branchFilter
 * tuy chon ('HN'|'SG'). CHI doc Google Sheet (khong gop Kiot) — bang "Toan bo don
 * hang" dung queryOrders.
 */
async function listAllOrders(branchFilter) {
  const [records, historyRows] = await Promise.all([repo.readAll(), repo.readOverrideHistory()]);
  const overrides = latestOverrideByCode(historyRows);
  const filtered = branchFilter ? records.filter(r => r._branch === branchFilter) : records;
  return filtered.map(record => toOrderRow(record, overrides.get(normalizeCode(record.orderCode))));
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

  const summary = computeEffectiveStatus(record, entry);
  return {
    orderCode: record.orderCode,
    branch: record._branch,
    summary,
    warning: computeOverdueWarning(record, summary)
  };
}

module.exports = {
  STATUS, STATUS_LABEL, STATUS_RANK,
  computeStatus, computeEffectiveStatus, computeOverdueWarning, parseSheetTimeMs, findOrder, listAllOrders, queryOrders,
  exportOrders, overrideStatus, listHistory,
  mergeRows
};
