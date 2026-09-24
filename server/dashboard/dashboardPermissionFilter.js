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
  lowStock: 'reports.products',
  stockValueByCategory: 'reports.products',
  allProducts: 'reports.products',
  stockByCategory: 'reports.products',
  invoices: 'reports.invoices',
  customers: 'reports.customers',
  suppliers: 'reports.suppliers',
  newPurchases: 'reports.suppliers',
  debtManagement: 'reports.debt'
});

// view cua /api/search -> quyen tuong ung.
const SEARCH_VIEW_FEATURE = Object.freeze({
  overview: 'reports.overview',
  products: 'reports.products',
  invoices: 'reports.invoices',
  customers: 'reports.customers',
  suppliers: 'reports.suppliers'
});

// Nhom du lieu ma /api/search quet (SEARCH_SCOPES trong dashboardData.js)
// -> quyen tuong ung. Dung cho view 'overview' vi no quet MOI nhom: nguoi chi
// co quyen Tong quan khong duoc tim thay du lieu cua tab ho bi chan.
const SEARCH_ENTITY_FEATURE = Object.freeze({
  products: 'reports.products',
  invoices: 'reports.invoices',
  orders: 'reports.invoices',
  returns: 'reports.invoices',
  customers: 'reports.customers',
  suppliers: 'reports.suppliers',
  purchases: 'reports.suppliers'
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

/** Quyen can co de dung /api/search voi `view` nay (mac dinh: Tong quan). */
function searchFeatureForView(view) {
  return SEARCH_VIEW_FEATURE[String(view || '')] || SEARCH_VIEW_FEATURE.overview;
}

/**
 * Danh sach nhom du lieu ma tai khoan duoc phep tim kiem. Truyen xuong
 * searchDashboardRecords de giao cat voi SEARCH_SCOPES cua view.
 */
function allowedSearchEntities(permissions) {
  return Object.keys(SEARCH_ENTITY_FEATURE)
    .filter(entity => permissionsHave(permissions, SEARCH_ENTITY_FEATURE[entity]));
}

module.exports = {
  ALWAYS_KEPT_KEYS,
  SECTION_FEATURE,
  SEARCH_VIEW_FEATURE,
  SEARCH_ENTITY_FEATURE,
  filterDashboardForUser,
  searchFeatureForView,
  allowedSearchEntities
};
