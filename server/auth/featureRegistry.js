// ==========================================
// FEATURE REGISTRY — NGUON SU THAT DUY NHAT cho phan quyen theo tinh nang.
//
// Truoc day quyen duoc ma hoa bang nhieu mang vai tro roi rac o CA HAI phia
// (NO_REPORTS_ROLES trong shared-nav.js vs REPORTS_ROLES trong userRepository.js,
// BULK_VIEW_ROLES trong lifecycle/index.html vs ORDER_LIFECYCLE_BULK_ROLES
// trong orderLifecycleRoutes.js...) nen giao dien va API de lech nhau.
//
// Nay CHI con bang FEATURES o duoi:
//   - Server: requireFeature(...) trong authMiddleware.js doc tu day.
//   - Client: khong con mang vai tro nao; /api/auth/me tra ve `permissions`
//     (danh sach key da giai) + `pageFeatures`, shared-nav.js dung menu tu do.
//
// Quyen mac dinh tinh theo VAI TRO; moi tai khoan co the duoc Quan ly ghi de
// tung key mot (cot app_users.feature_permissions, chi luu DELTA so voi mac
// dinh — doi bang mac dinh o day thi tai khoan cu van huong theo).
// ==========================================
'use strict';

const { ROLES, INTERNAL_ROLES, REPORTS_ROLES, isHardcodedAdmin } = require('./userRepository');

const ALL_ROLES = Object.freeze(Object.values(ROLES));
const MANAGER_ONLY = Object.freeze([ROLES.QUAN_LY]);
// Cac tab XEM bao cao (Tong quan, Hang hoa, Hoa don, Khach hang, Cong no) mo them cho
// Nhan vien sale (2026-10-02). Xuat Excel + sua cong no van chi Quan ly + Tro ly
// (REPORTS_ROLES), nen KHONG nhet sale vao REPORTS_ROLES — mang do cap ca 7 key reports.*.
const REPORT_VIEW_ROLES = Object.freeze([...REPORTS_ROLES, ROLES.NHAN_VIEN_SALE]);
// Vong doi don hang (toan bo don): bo Nhan vien mua hang + Nhan vien marketing (2026-10-02)
// va Nhan vien kho (2026-10-03). Ba vai tro nay van con 'shipment.lookup' (tra cuu theo ma).
const NO_LIFECYCLE_ROLES = Object.freeze([ROLES.NHAN_VIEN_KHO, ROLES.NHAN_VIEN_MARKETING, ROLES.NHAN_VIEN_MUA_HANG]);
const LIFECYCLE_ROLES = Object.freeze(INTERNAL_ROLES.filter(r => !NO_LIFECYCLE_ROLES.includes(r)));

const FEATURE_GROUPS = Object.freeze([
  { key: 'reports', label: 'Báo cáo tổng hợp' },
  { key: 'shipment', label: 'Quản lý đơn hàng' },
  { key: 'stockLocations', label: 'Vị trí hàng' },
  { key: 'hr', label: 'Quản lý nhân sự' },
  { key: 'cashbook', label: 'Sổ quỹ' },
  { key: 'account', label: 'Quản lý tài khoản' },
  { key: 'system', label: 'Hệ thống' }
]);

/**
 * Thu tu trong mang nay = thu tu hien thi trong sidebar VA trong bang phan
 * quyen o /account/. `roles` la mac dinh theo vai tro; `alwaysOn` la quyen
 * khong ai tat duoc (tranh khoa chet nguoi dung ra khoi he thong).
 */
const FEATURES = Object.freeze([
  // --- Bao cao tong hop ---
  { key: 'reports.overview', groupKey: 'reports', label: 'Tổng quan', roles: REPORT_VIEW_ROLES },
  { key: 'reports.products', groupKey: 'reports', label: 'Hàng hóa (gồm Kiểm tra đứt hàng)', roles: REPORT_VIEW_ROLES },
  // 2026-10-06: giá vốn ("Đơn giá") và giá trị tồn của tab Hàng hóa không cho Nhân viên sale xem.
  // Máy chủ cắt các trường này khỏi payload (dashboardPermissionFilter.js); thiếu Hàng hóa thì bỏ luôn.
  { key: 'reports.products.cost', groupKey: 'reports', label: 'Hàng hóa: xem đơn giá & giá trị tồn (cần Hàng hóa)', roles: REPORTS_ROLES, requires: 'reports.products' },
  { key: 'reports.invoices', groupKey: 'reports', label: 'Hóa đơn', roles: REPORT_VIEW_ROLES },
  { key: 'reports.customers', groupKey: 'reports', label: 'Khách hàng', roles: REPORT_VIEW_ROLES },
  { key: 'reports.debt', groupKey: 'reports', label: 'Công nợ', roles: REPORT_VIEW_ROLES },
  { key: 'reports.debt.edit', groupKey: 'reports', label: 'Cập nhật trạng thái công nợ', roles: REPORTS_ROLES },
  { key: 'reports.export', groupKey: 'reports', label: 'Xuất Excel báo cáo', roles: REPORTS_ROLES },

  // --- Quan ly don hang ---
  // 2026-10-03: Tra cuu theo ma, Lich su, Xuat Excel, Ghi de deu GAN vao Vong doi don hang
  // (`requires`): thieu 'shipment.lifecycle' thi cac quyen nay bi bo du vai tro/ghi de co cap.
  { key: 'shipment.lifecycle', groupKey: 'shipment', label: 'Vòng đời đơn hàng (toàn bộ đơn)', roles: LIFECYCLE_ROLES },
  { key: 'shipment.lookup', groupKey: 'shipment', label: 'Tra cứu đơn theo mã (cần Vòng đời đơn hàng)', roles: LIFECYCLE_ROLES, requires: 'shipment.lifecycle' },
  { key: 'shipment.history', groupKey: 'shipment', label: 'Lịch sử cập nhật (cần Vòng đời đơn hàng)', roles: LIFECYCLE_ROLES, requires: 'shipment.lifecycle' },
  // 2026-10-02: chi Quan ly xuat duoc file (truoc day moi vai tro noi bo); Quan ly van cap them tung tai khoan duoc.
  { key: 'shipment.export', groupKey: 'shipment', label: 'Xuất Excel đơn hàng (cần Vòng đời đơn hàng)', roles: MANAGER_ONLY, requires: 'shipment.lifecycle' },
  // 2026-10-03: Ke toan khong con duoc ghi de mac dinh; Quan ly cap rieng tung tai khoan khi can.
  { key: 'shipment.override', groupKey: 'shipment', label: 'Ghi đè trạng thái đơn (cần Vòng đời đơn hàng)', roles: MANAGER_ONLY, requires: 'shipment.lifecycle' },

  { key: 'stockLocations.view', groupKey: 'stockLocations', label: 'Xem vị trí hàng HN / SG', roles: INTERNAL_ROLES, forbiddenRoles: [ROLES.KHACH] },

  // --- Quan ly nhan su ---
  { key: 'hr.rules', groupKey: 'hr', label: 'Quy định công ty', roles: INTERNAL_ROLES },
  { key: 'hr.rules.manage', groupKey: 'hr', label: 'Tải lên / gỡ tài liệu quy định', roles: MANAGER_ONLY },
  { key: 'hr.employees', groupKey: 'hr', label: 'Danh sách nhân sự', roles: INTERNAL_ROLES },
  { key: 'hr.leave', groupKey: 'hr', label: 'Nghỉ phép (xem)', roles: INTERNAL_ROLES },
  { key: 'hr.leave.manage', groupKey: 'hr', label: 'Duyệt nghỉ phép', roles: MANAGER_ONLY },

  { key: 'hr.leave.absence.manage', groupKey: 'hr', label: 'Ghi nhận tự ý nghỉ', roles: MANAGER_ONLY },
  { key: 'hr.leave.submit', groupKey: 'hr', label: 'Tự gửi đơn nghỉ phép', roles: [], dynamic: true },

  // --- Sổ quỹ: quyền chốt luôn cần quyền xem ---
  { key: 'cashbook.view', groupKey: 'cashbook', label: 'Xem sổ quỹ', roles: MANAGER_ONLY },
  { key: 'cashbook.manage', groupKey: 'cashbook', label: 'Chốt số dư sổ quỹ', roles: MANAGER_ONLY, requires: 'cashbook.view' },

  // --- Quan ly tai khoan ---
  { key: 'account.profile', groupKey: 'account', label: 'Quản lý hồ sơ', roles: ALL_ROLES, alwaysOn: true },
  { key: 'account.users', groupKey: 'account', label: 'Quản lý người dùng (xem)', roles: MANAGER_ONLY },
  { key: 'account.users.manage', groupKey: 'account', label: 'Thêm / sửa / khóa / xóa tài khoản', roles: MANAGER_ONLY },
  { key: 'account.permissions', groupKey: 'account', label: 'Phân quyền chi tiết', roles: MANAGER_ONLY },

  // --- He thong ---
  { key: 'system.syncStatus', groupKey: 'system', label: 'Trạng thái đồng bộ KiotViet', roles: MANAGER_ONLY }
]);

const FEATURE_KEYS = Object.freeze(FEATURES.map(f => f.key));
const FEATURE_BY_KEY = new Map(FEATURES.map(f => [f.key, f]));
const ALWAYS_ON_KEYS = Object.freeze(FEATURES.filter(f => f.alwaysOn).map(f => f.key));

/** Moi key `reports.*` — dung cho cac endpoint dung chung (/api/dashboard, /api/debug). */
const REPORT_VIEW_FEATURES = Object.freeze([
  'reports.overview', 'reports.products', 'reports.invoices',
  'reports.customers', 'reports.debt'
]);
const ANY_REPORTS_FEATURES = Object.freeze(FEATURE_KEYS.filter(k => k.startsWith('reports.')));

/**
 * Trang noi bo -> quyen can co de MO duoc trang. Dung chung boi pageGuard.js
 * (chan that o server) va shared-nav.js authGuard (dieu huong UX) — client
 * nhan bang nay qua /api/auth/me chu KHONG chep lai.
 *
 * Thu tu = thu tu uu tien khi phai chon "trang dau tien user vao duoc".
 */
const PAGE_FEATURES = Object.freeze([
  { path: '/reports', href: '/reports/', anyOf: ANY_REPORTS_FEATURES },
  { path: '/shipment/lifecycle', href: '/shipment/lifecycle/', anyOf: ['shipment.lifecycle'] },
  { path: '/humanresources', href: '/humanresources/', anyOf: ['hr.rules', 'hr.employees', 'hr.leave', 'hr.leave.submit'] },
  { path: '/stock-locations', href: '/stock-locations/', anyOf: ['stockLocations.view'] },
  { path: '/cashbook', href: '/cashbook/', anyOf: ['cashbook.view'] },
  { path: '/account', href: '/account/', anyOf: ['account.profile'] }
]);

/** '/' phuc vu chinh public/index.html giong '/reports' — xem server/index.js. */
const ROOT_PATH_ALIAS = '/reports';

function isFeatureKey(key) {
  return FEATURE_BY_KEY.has(String(key || ''));
}

/** Quyen mac dinh cua mot vai tro (khong tinh ghi de theo tai khoan). */
function defaultsForRole(vaiTro) {
  const role = String(vaiTro || '').trim();
  return FEATURES
    .filter(f => f.alwaysOn || f.roles.includes(role))
    .map(f => f.key);
}

/**
 * Loc object ghi de tho (tu DB hoac tu body request) ve dang { key: boolean }.
 * Key khong ton tai bi bo; gia tri null/undefined bi bo (nghia la "quay ve
 * mac dinh theo vai tro"); key alwaysOn khong cho ghi de.
 */
function sanitizeOverrides(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [key, value] of Object.entries(raw)) {
    if (!isFeatureKey(key)) continue;
    if (FEATURE_BY_KEY.get(key).alwaysOn || FEATURE_BY_KEY.get(key).dynamic) continue;
    if (value === null || value === undefined) continue;
    result[key] = !!value;
  }
  return result;
}

/** Key la (khong co trong registry) — de API tra loi 400 co ich. */
function unknownOverrideKeys(raw) {
  if (!raw || typeof raw !== 'object') return [];
  return Object.keys(raw).filter(key => !isFeatureKey(key));
}

/**
 * Quyen hieu luc cua mot tai khoan: mac dinh theo vai tro, ap ghi de rieng,
 * luon giu cac key alwaysOn. Tai khoan Quan tri vien he thong (hardcoded
 * admin) luon co du moi quyen — giong cach effectiveUserResolver.js luon ep
 * ho ve vai tro Quan ly.
 */
function resolvePermissions(user) {
  if (!user) return [];
  if (isHardcodedAdmin(user.email) || isHardcodedAdmin(user.username)) {
    return FEATURE_KEYS.filter(key => key !== 'hr.leave.submit' || canSubmitOwnLeave(user));
  }
  const granted = new Set(defaultsForRole(user.vaiTro));
  const overrides = sanitizeOverrides(user.featurePermissions);
  for (const [key, allowed] of Object.entries(overrides)) {
    if (allowed) granted.add(key);
    else granted.delete(key);
  }
  for (const key of ALWAYS_ON_KEYS) granted.add(key);
  if (canSubmitOwnLeave(user)) granted.add('hr.leave.submit');
  // Quyen phu thuoc (`requires`): thieu quyen goc thi bo luon, bat ke vai tro/ghi de.
  for (const f of FEATURES) {
    if (f.requires && !granted.has(f.requires)) granted.delete(f.key);
  }
  // Tra theo thu tu registry de output on dinh (de so sanh trong test/cache).
  return FEATURE_KEYS.filter(key => granted.has(key) && !isFeatureForbiddenForRole(key, user.vaiTro));
}

function canSubmitOwnLeave(user) {
  return !!(user && user.hrManaged && user.hrRowIndex && user.trangThai === 'Đang hoạt động' && !user.isDeleted && !user.hrVerificationRequired && user.hrEmployeeActive !== false);
}

function isFeatureForbiddenForRole(key, role) {
  return !!FEATURE_BY_KEY.get(key)?.forbiddenRoles?.includes(String(role || '').trim());
}

/** Kiem tra tren MANG quyen da giai (req.user.permissions). */
function permissionsHave(permissions, ...keys) {
  if (!Array.isArray(permissions)) return false;
  return keys.some(key => permissions.includes(key));
}

/** Kiem tra tren OBJECT user — dung lai req.user.permissions neu da co. */
function hasFeature(user, ...keys) {
  if (!user) return false;
  const permissions = Array.isArray(user.permissions) ? user.permissions : resolvePermissions(user);
  return permissionsHave(permissions, ...keys.filter(key => !isFeatureForbiddenForRole(key, user.vaiTro) && (key !== 'hr.leave.submit' || canSubmitOwnLeave(user))));
}

function normalizePagePath(pathname) {
  const cleaned = String(pathname || '')
    .split('?')[0]
    .split('#')[0]
    .replace(/\/index\.html$/, '')
    .replace(/\/+$/, '');
  if (!cleaned || cleaned === '') return ROOT_PATH_ALIAS;
  return cleaned;
}

/** Quy tac bao ve cua mot duong dan trang, hoac null neu trang khong can quyen. */
function pageRuleFor(pathname) {
  const normalized = normalizePagePath(pathname);
  return PAGE_FEATURES.find(rule => rule.path === normalized) || null;
}

/** Trang dau tien user co the vao — dung khi phai dieu huong ho di noi khac. */
function landingPathFor(permissions) {
  const rule = PAGE_FEATURES.find(r => permissionsHave(permissions, ...r.anyOf));
  return rule ? rule.href : '/account/';
}

module.exports = {
  FEATURE_GROUPS,
  FEATURES,
  FEATURE_KEYS,
  ALWAYS_ON_KEYS,
  ANY_REPORTS_FEATURES,
  REPORT_VIEW_FEATURES,
  PAGE_FEATURES,
  ROOT_PATH_ALIAS,
  isFeatureKey,
  defaultsForRole,
  sanitizeOverrides,
  unknownOverrideKeys,
  resolvePermissions,
  permissionsHave,
  hasFeature,
  isFeatureForbiddenForRole,
  normalizePagePath,
  pageRuleFor,
  landingPathFor
};
