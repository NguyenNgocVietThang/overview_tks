'use strict';

// Quyen "Kiem tra gia ban" (muc 3.4 ke hoach 2026-10-20):
//   - xem:        reports.invoices.priceAudit
//   - giai thich: reports.invoices.priceAudit.explain VA ten tai khoan (hoTen) khop CHINH XAC nhom khach HIEN TAI
//                 (customers.raw.groups) sau chuan hoa NFKC / trim / gop khoang trang / khong phan biet hoa thuong.
//                 Khong fuzzy (thieu dau = khac ten). Nhom rong / ten rong -> khong sua duoc.
//                 Hau to ID Telegram " - <>=5 chu so>" (dashboard/saleName.js) duoc bo o CA HAI phia: ten nhan vien Kiot
//                 co dang do; nhom khach that hien khong co hau to (cac bao cao khac dung btrim(groups) thang), bo hau
//                 to chi de tranh lech neu ai do dat ten nhom theo ten nhan vien Kiot.
//   - Chot:       reports.invoices.priceAudit.decide (KHONG kem quyen giai thich); chi dong sai gia GOC.
// Moi ham doc req.user.permissions da giai lai moi request (requireAuth) -> thu hoi quyen co hieu luc ngay.

const { hasFeature } = require('../auth/featureRegistry');
const { stripTelegramId } = require('../dashboard/saleName');

const FEATURE_VIEW = 'reports.invoices.priceAudit';
const FEATURE_EXPLAIN = 'reports.invoices.priceAudit.explain';
const FEATURE_DECIDE = 'reports.invoices.priceAudit.decide';

function normalizeSaleName(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
  return stripTelegramId(text).toLowerCase();
}

function canView(viewer) {
  return Boolean(viewer) && hasFeature(viewer, FEATURE_VIEW);
}

function canExplain(viewer, currentCustomerGroup) {
  if (!viewer || !hasFeature(viewer, FEATURE_EXPLAIN)) return false;
  const name = normalizeSaleName(viewer.hoTen);
  const group = normalizeSaleName(currentCustomerGroup);
  return name !== '' && group !== '' && name === group;
}

function canDecide(viewer) {
  return Boolean(viewer) && hasFeature(viewer, FEATURE_DECIDE);
}

/** Dien canEditExplanation / canDecide cho 1 dong cua viewer va BO truong noi bo currentSaleGroup. */
function withCapabilities(viewer, row, flags = { decide: canDecide(viewer) }) {
  if (!row) return row;
  const { currentSaleGroup, ...rest } = row;
  return {
    ...rest,
    canEditExplanation: canExplain(viewer, currentSaleGroup),
    canDecide: Boolean(flags.decide) && row.originalStatus === 'wrong'
  };
}

module.exports = {
  FEATURE_VIEW,
  FEATURE_EXPLAIN,
  FEATURE_DECIDE,
  normalizeSaleName,
  canView,
  canExplain,
  canDecide,
  withCapabilities
};
