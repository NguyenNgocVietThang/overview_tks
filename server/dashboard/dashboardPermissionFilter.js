// ==========================================
// LOC PAYLOAD BAO CAO THEO QUYEN.
//
// Sau tab cua "Bao cao tong hop" dung CHUNG mot endpoint /api/dashboard, nen
// chi an muc menu la chua du: tai khoan bi chan tab "Quan ly cong no" van co
// the goi thang API va doc du lieu cong no. Module nay cat payload ve dung
// nhung phan tai khoan duoc xem.
//
// CANH BAO: getDashboardData() co cache ket qua (dashboardResultCache) tra ve
// CUNG MOT object cho nhieu request. Vi vay o day luon dung object MOI —
// tuyet doi khong delete/ghi de trực tiep len object dau vao, neu khong se
// dau doc cache cho moi nguoi dung khac.
// ==========================================
'use strict';

const { permissionsHave } = require('../auth/featureRegistry');

// Khoa top-level cua payload /api/dashboard luon duoc giu lai: `kpi` la cac so
// tong hop cua chinh tab Tong quan, `filters`/`updatedAt` la sieu du lieu.
const ALWAYS_KEPT_KEYS = Object.freeze(['updatedAt', 'filters', 'kpi']);

// Khoa top-level -> quyen can co de nhan duoc khoa do.
const SECTION_FEATURE = Object.freeze({
  overview: 'reports.overview',
  products: 'reports.products',
  allProducts: 'reports.products',
  invoices: 'reports.invoices',
  customers: 'reports.customers',
  debtManagement: 'reports.debt'
});

/**
 * Tra ve mot object MOI chi chua cac phan `permissions` cho phep.
 * Object dau vao khong bi sua doi.
 */
function filterDashboardForUser(data, permissions) {
  if (!data || typeof data !== 'object') return data;
  const filtered = {};
  for (const key of Object.keys(data)) {
    const feature = SECTION_FEATURE[key];
    if (!feature || ALWAYS_KEPT_KEYS.includes(key)) {
      filtered[key] = data[key];
      continue;
    }
    if (permissionsHave(permissions, feature)) filtered[key] = data[key];
  }
  return filtered;
}

module.exports = {
  ALWAYS_KEPT_KEYS,
  SECTION_FEATURE,
  filterDashboardForUser
};
