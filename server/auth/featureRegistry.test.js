'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('./featureRegistry');
const { ROLES, INTERNAL_ROLES, REPORTS_ROLES } = require('./userRepository');

test('Marketing defaults to manager, assistant and Marketing, supports per-user revoke', () => {
  for (const role of Object.values(ROLES)) {
    assert.equal(registry.defaultsForRole(role).includes('reports.marketing'),
      [ROLES.QUAN_LY, ROLES.TRO_LY, ROLES.NHAN_VIEN_MARKETING].includes(role), role);
  }
  assert.ok(!registry.resolvePermissions({vaiTro:ROLES.NHAN_VIEN_MARKETING,
    featurePermissions:{'reports.marketing':false}}).includes('reports.marketing'));
  assert.ok(registry.pageRuleFor('/reports').anyOf.includes('reports.marketing'));
});

test('Sổ quỹ mặc định chỉ cấp quyền xem cho Quản lý', () => {
  for (const role of Object.values(ROLES)) {
    const actual = registry.defaultsForRole(role).filter(key => key.startsWith('cashbook.'));
    assert.deepEqual(actual, role === ROLES.QUAN_LY ? ['cashbook.view'] : [], role);
  }
});

test('quyền chốt số dư cũ đã gỡ: ghi đè còn lưu trong tài khoản bị bỏ qua', () => {
  assert.equal(registry.FEATURES.some(f => f.key === 'cashbook.manage'), false);
  const sale = { vaiTro: ROLES.NHAN_VIEN_SALE, featurePermissions: { 'cashbook.manage': true, 'cashbook.view': true } };
  assert.deepEqual(registry.resolvePermissions(sale).filter(key => key.startsWith('cashbook.')), ['cashbook.view']);
});

test('admin cứng luôn giữ quyền Sổ quỹ khi có ghi đè thu hồi', () => {
  const permissions = registry.resolvePermissions({ username: 'admin', vaiTro: ROLES.KHACH,
    featurePermissions: { 'cashbook.view': false } });
  assert.ok(permissions.includes('cashbook.view'));
});

test('các đường dẫn Sổ quỹ dùng cùng quyền xem và có thể là trang đích', () => {
  for (const url of ['/cashbook', '/cashbook/', '/cashbook/index.html']) {
    assert.deepEqual(registry.pageRuleFor(url), {
      path: '/cashbook', href: '/cashbook/', anyOf: ['cashbook.view']
    });
  }
  assert.equal(registry.landingPathFor(['cashbook.view', 'account.profile']), '/cashbook/');
});

test('Vị trí hàng defaults for every internal role; guest grants are always forbidden', () => {
  for (const vaiTro of INTERNAL_ROLES) assert.ok(registry.defaultsForRole(vaiTro).includes('stockLocations.view'), vaiTro);
  const guest = { vaiTro: ROLES.KHACH, featurePermissions: { 'stockLocations.view': true } };
  assert.ok(!registry.resolvePermissions(guest).includes('stockLocations.view'));
  assert.equal(registry.hasFeature({ ...guest, permissions: ['stockLocations.view'] }, 'stockLocations.view'), false);
  assert.ok(!registry.resolvePermissions({ vaiTro: ROLES.NHAN_VIEN_KHO, featurePermissions: { 'stockLocations.view': false } }).includes('stockLocations.view'));
});

// Cac tap hop vai tro CU (truoc khi co featureRegistry) — giu lai nguyen van o
// day de test bat duoc moi thay doi hanh vi ngoai y muon khi sua bang mac dinh.
// (Nhan vien sale da duoc mo them 5 tab xem bao cao — xem test rieng ben duoi.)
const LEGACY_NO_REPORTS_ROLES = [
  'Khách', 'Lái xe', 'Kế toán', 'Trưởng kho',
  'Nhân viên kho', 'Nhân viên mua hàng'
];

test('mac dinh theo vai tro: reports.* khop dung REPORTS_ROLES cu', () => {
  for (const role of REPORTS_ROLES) {
    const defaults = registry.defaultsForRole(role);
    for (const key of registry.ANY_REPORTS_FEATURES) {
      // Tinh lai thang chot (2026-10-07) va sua Khach moi/Ghi chu Marketing (2026-10-08) chi danh cho Quan ly.
      if (['reports.business.refreeze', 'reports.marketing.edit'].includes(key) && role !== ROLES.QUAN_LY) continue;
      assert.ok(defaults.includes(key), `${role} phai co ${key}`);
    }
  }
  for (const role of LEGACY_NO_REPORTS_ROLES) {
    const defaults = registry.defaultsForRole(role);
    const reportKeys = defaults.filter(key => key.startsWith('reports.'));
    assert.deepEqual(reportKeys, [], `${role} khong duoc co quyen reports.* nao`);
  }
});

test('mac dinh theo vai tro: hr.* danh cho moi vai tro noi bo, account.users chi Quan ly', () => {
  for (const role of INTERNAL_ROLES) {
    const defaults = registry.defaultsForRole(role);
    assert.ok(defaults.includes('hr.rules'), role);
    assert.ok(defaults.includes('hr.employees'), role);
    assert.ok(defaults.includes('hr.leave'), role);
    assert.equal(defaults.includes('account.users'), role === ROLES.QUAN_LY, role);
  }
  const guest = registry.defaultsForRole(ROLES.KHACH);
  assert.deepEqual(guest, ['account.profile']);
});

test('chi Quan ly moi co cac quyen quan tri mac dinh', () => {
  const managerOnly = ['hr.leave.manage', 'hr.rules.manage', 'account.users', 'account.users.manage', 'account.permissions', 'system.syncStatus'];
  for (const key of managerOnly) {
    assert.ok(registry.defaultsForRole(ROLES.QUAN_LY).includes(key), `Quản lý phai co ${key}`);
    for (const role of Object.values(ROLES)) {
      if (role === ROLES.QUAN_LY) continue;
      assert.ok(!registry.defaultsForRole(role).includes(key), `${role} khong duoc co ${key}`);
    }
  }
});

test('xuat Excel don hang (Vong doi don hang) mac dinh chi danh cho Quan ly', () => {
  assert.ok(registry.defaultsForRole(ROLES.QUAN_LY).includes('shipment.export'));
  for (const role of Object.values(ROLES)) {
    if (role === ROLES.QUAN_LY) continue;
    assert.ok(!registry.defaultsForRole(role).includes('shipment.export'), `${role} khong duoc co shipment.export`);
  }
  // Quan ly van cap them duoc cho tung tai khoan (ghi de theo tai khoan).
  const granted = registry.resolvePermissions({ vaiTro: ROLES.KE_TOAN, featurePermissions: { 'shipment.export': true } });
  assert.ok(granted.includes('shipment.export'));
});

test('ghi de trang thai don hang mac dinh chi danh cho Quan ly (Ke toan khong con)', () => {
  for (const role of Object.values(ROLES)) {
    assert.equal(registry.defaultsForRole(role).includes('shipment.override'), role === ROLES.QUAN_LY, role);
  }
  // Quan ly van cap rieng cho Ke toan duoc (Ke toan co Vong doi don hang).
  const granted = registry.resolvePermissions({ vaiTro: ROLES.KE_TOAN, featurePermissions: { 'shipment.override': true } });
  assert.ok(granted.includes('shipment.override'));
});

test('Tra cuu / Lich su / Xuat / Ghi de GAN vao Vong doi don hang: thieu lifecycle thi mat het', () => {
  const LINKED = ['shipment.lookup', 'shipment.history', 'shipment.export', 'shipment.override'];
  // Mac dinh: ai co Vong doi don hang thi co Tra cuu + Lich su (cung nhom vai tro).
  for (const role of Object.values(ROLES)) {
    const keys = registry.defaultsForRole(role);
    for (const key of ['shipment.lookup', 'shipment.history']) {
      assert.equal(keys.includes(key), keys.includes('shipment.lifecycle'), `${role} ${key}`);
    }
  }
  // Cap rieng quyen phu cho tai khoan khong co Vong doi don hang -> van khong co.
  const noLifecycle = registry.resolvePermissions({
    vaiTro: ROLES.NHAN_VIEN_KHO,
    featurePermissions: Object.fromEntries(LINKED.map(key => [key, true]))
  });
  for (const key of LINKED) assert.ok(!noLifecycle.includes(key), key);
  // Thu hoi lifecycle cua Ke toan keo theo ca quyen phu da cap rieng.
  const revoked = registry.resolvePermissions({
    vaiTro: ROLES.KE_TOAN,
    featurePermissions: { 'shipment.lifecycle': false, 'shipment.override': true, 'shipment.export': true }
  });
  for (const key of ['shipment.lifecycle', ...LINKED]) assert.ok(!revoked.includes(key), key);
  // Cap lifecycle cho vai tro khong co -> Tra cuu/Lich su van phai cap them tung cai.
  const grantedOnlyLifecycle = registry.resolvePermissions({
    vaiTro: ROLES.NHAN_VIEN_KHO, featurePermissions: { 'shipment.lifecycle': true, 'shipment.lookup': true }
  });
  assert.ok(grantedOnlyLifecycle.includes('shipment.lifecycle'));
  assert.ok(grantedOnlyLifecycle.includes('shipment.lookup'));
  assert.ok(!grantedOnlyLifecycle.includes('shipment.history'));
});

const SALE_REPORT_VIEW_KEYS = ['reports.overview', 'reports.products', 'reports.invoices', 'reports.customers', 'reports.debt', 'reports.business'];

test('Nhan vien sale xem du 5 tab bao cao mac dinh, KHONG co xuat Excel / sua cong no', () => {
  const reportKeys = registry.defaultsForRole(ROLES.NHAN_VIEN_SALE).filter(key => key.startsWith('reports.'));
  assert.deepEqual(reportKeys, SALE_REPORT_VIEW_KEYS);
  assert.ok(!reportKeys.includes('reports.export'));
  assert.ok(!reportKeys.includes('reports.debt.edit'));
  // Cac vai tro con lai khong thuoc REPORTS_ROLES van KHONG co reports.overview.
  for (const role of LEGACY_NO_REPORTS_ROLES) {
    assert.ok(!registry.defaultsForRole(role).includes('reports.overview'), role);
  }
});

const SHIPMENT_LIFECYCLE_GROUP = ['shipment.lifecycle', 'shipment.lookup', 'shipment.history'];

test('Nhan vien marketing has own report, other permissions match sale excluding general reports and lifecycle', () => {
  assert.deepEqual(
    registry.defaultsForRole(ROLES.NHAN_VIEN_MARKETING).filter(key=>key!=='reports.marketing'),
    registry.defaultsForRole(ROLES.NHAN_VIEN_SALE).filter(key => !SALE_REPORT_VIEW_KEYS.includes(key) && !SHIPMENT_LIFECYCLE_GROUP.includes(key))
  );
});

test('Nhan vien kho + mua hang + marketing + Khach KHONG co Vong doi don hang va cac quyen gan kem', () => {
  for (const role of [ROLES.NHAN_VIEN_KHO, ROLES.NHAN_VIEN_MUA_HANG, ROLES.NHAN_VIEN_MARKETING, ROLES.KHACH]) {
    const keys = registry.defaultsForRole(role);
    for (const key of SHIPMENT_LIFECYCLE_GROUP) assert.ok(!keys.includes(key), `${role} ${key}`);
  }
});

test('ghi de theo tai khoan: true them quyen, false thu hoi, key vang mat = theo vai tro', () => {
  const base = registry.resolvePermissions({ vaiTro: ROLES.KE_TOAN });
  assert.ok(!base.includes('reports.overview'));
  assert.ok(base.includes('hr.leave'));

  const overridden = registry.resolvePermissions({
    vaiTro: ROLES.KE_TOAN,
    featurePermissions: { 'reports.overview': true, 'hr.leave': false }
  });
  assert.ok(overridden.includes('reports.overview'), 'quyen duoc cap them');
  assert.ok(!overridden.includes('hr.leave'), 'quyen bi thu hoi');
  assert.ok(overridden.includes('shipment.lifecycle'), 'quyen khong dong toi van theo mac dinh');
});

test('quyen alwaysOn khong the bi thu hoi', () => {
  const permissions = registry.resolvePermissions({
    vaiTro: ROLES.KHACH,
    featurePermissions: { 'account.profile': false }
  });
  assert.ok(permissions.includes('account.profile'));
  assert.deepEqual(registry.sanitizeOverrides({ 'account.profile': false }), {});
});

test('key la bi loai khoi ghi de va duoc bao cao lai', () => {
  assert.deepEqual(registry.sanitizeOverrides({ 'khong.ton.tai': true, 'hr.leave': false }), { 'hr.leave': false });
  assert.deepEqual(registry.unknownOverrideKeys({ 'khong.ton.tai': true, 'hr.leave': false }), ['khong.ton.tai']);
  assert.deepEqual(registry.sanitizeOverrides(null), {});
  assert.deepEqual(registry.sanitizeOverrides({ 'hr.leave': null }), {}, 'null = quay ve mac dinh');
});

test('Quan tri vien he thong (hardcoded admin) luon co du moi quyen', () => {
  const permissions = registry.resolvePermissions({
    username: 'thangnnv2003@gmail.com',
    vaiTro: ROLES.KHACH,
    featurePermissions: { 'account.permissions': false }
  });
  assert.deepEqual(permissions, registry.FEATURE_KEYS.filter(key => key !== 'hr.leave.submit'));
});

test('hasFeature/permissionsHave dung ngu nghia HOAC', () => {
  const user = { vaiTro: ROLES.KHACH };
  assert.equal(registry.hasFeature(user, 'reports.debt', 'account.profile'), true);
  assert.equal(registry.hasFeature(user, 'reports.debt', 'hr.leave'), false);
  assert.equal(registry.permissionsHave(['a', 'b'], 'b'), true);
  assert.equal(registry.permissionsHave(undefined, 'b'), false);
});

test('pageRuleFor chuan hoa duong dan, "/" tuong duong "/reports"', () => {
  assert.equal(registry.normalizePagePath('/'), '/reports');
  assert.equal(registry.normalizePagePath('/index.html'), '/reports');
  assert.equal(registry.normalizePagePath('/account/'), '/account');
  assert.equal(registry.normalizePagePath('/account/index.html'), '/account');
  assert.equal(registry.pageRuleFor('/reports/').path, '/reports');
  assert.equal(registry.pageRuleFor('/shipment/lifecycle').path, '/shipment/lifecycle');
  assert.equal(registry.pageRuleFor('/khong-ton-tai'), null);
});

test('landingPathFor tra ve trang dau tien tai khoan vao duoc', () => {
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.QUAN_LY)), '/reports/');
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.KE_TOAN)), '/shipment/lifecycle/');
  // Sale co quyen Tong quan nen trang dau tien vao duoc la bao cao (thu tu PAGE_FEATURES).
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.NHAN_VIEN_SALE)), '/reports/');
  // Marketing now has its own report; guest still only enters account.
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.NHAN_VIEN_MARKETING)), '/reports/');
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.KHACH)), '/account/');
  assert.equal(registry.landingPathFor([]), '/account/');
});

test('moi tinh nang co nhan tieng Viet va thuoc mot nhom da khai bao', () => {
  const groupKeys = registry.FEATURE_GROUPS.map(g => g.key);
  for (const feature of registry.FEATURES) {
    assert.ok(feature.label && feature.label.trim(), feature.key);
    assert.ok(groupKeys.includes(feature.groupKey), `${feature.key} thuoc nhom la: ${feature.groupKey}`);
  }
  assert.equal(new Set(registry.FEATURE_KEYS).size, registry.FEATURE_KEYS.length, 'khong duoc trung key');
});

test('absence permission defaults to managers and self submission follows active linked HR identity', () => {
  assert.ok(registry.defaultsForRole(ROLES.QUAN_LY).includes('hr.leave.absence.manage'));
  const linked = { vaiTro: ROLES.NHAN_VIEN_SALE, hrManaged: false, trangThai: 'Đang hoạt động' };
  assert.ok(registry.resolvePermissions(linked).includes('hr.leave.submit'), 'moi vai tro noi bo da gan nhan su deu xin nghi duoc');
  for (const role of registry.INTERNAL_ROLES || [ROLES.QUAN_LY, ROLES.KE_TOAN, ROLES.NHAN_VIEN_KHO, ROLES.NHAN_VIEN_MARKETING, ROLES.NHAN_VIEN_MUA_HANG, ROLES.TRO_LY, ROLES.TRUONG_KHO, ROLES.LAI_XE]) assert.ok(registry.resolvePermissions({ ...linked, vaiTro: role }).includes('hr.leave.submit'), role);
  assert.ok(!registry.resolvePermissions({ ...linked, vaiTro: ROLES.KHACH }).includes('hr.leave.submit'), 'Khach khong duoc xin nghi');
  assert.ok(!registry.resolvePermissions({ ...linked, trangThai: 'Khóa' }).includes('hr.leave.submit'));
  assert.ok(!registry.resolvePermissions({ vaiTro: ROLES.KHACH, featurePermissions: { 'hr.leave.submit': true } }).includes('hr.leave.submit'));
});



test('active account with inactive linked HR profile cannot get self submission capability', () => {
  assert.ok(!registry.resolvePermissions({ vaiTro: ROLES.NHAN_VIEN_SALE, hrManaged: true, hrRowIndex: 123, trangThai: 'Đang hoạt động', hrEmployeeActive: false }).includes('hr.leave.submit'));
});

test('reports.products.cost (don gia + gia tri ton tab Hang hoa): chi Quan ly + Tro ly, Nhan vien sale KHONG co, cap rieng duoc', () => {
  for (const role of Object.values(ROLES)) {
    assert.equal(
      registry.defaultsForRole(role).includes('reports.products.cost'),
      REPORTS_ROLES.includes(role),
      role
    );
  }
  const granted = registry.resolvePermissions({ vaiTro: ROLES.NHAN_VIEN_SALE, featurePermissions: { 'reports.products.cost': true } });
  assert.ok(granted.includes('reports.products.cost'));
  // Gan vao Hang hoa: mat reports.products thi quyen nay cung bi bo, du da duoc cap rieng.
  const revoked = registry.resolvePermissions({
    vaiTro: ROLES.NHAN_VIEN_SALE,
    featurePermissions: { 'reports.products': false, 'reports.products.cost': true }
  });
  assert.ok(!revoked.includes('reports.products'));
  assert.ok(!revoked.includes('reports.products.cost'));
});

test('bao cao kinh doanh: xem theo vai tro xem bao cao, tinh lai thang chi Quan ly', () => {
  const view = registry.FEATURES.find(f => f.key === 'reports.business');
  const refreeze = registry.FEATURES.find(f => f.key === 'reports.business.refreeze');
  assert.ok(view && refreeze);
  assert.equal(refreeze.requires, 'reports.business');
  assert.ok(registry.REPORT_VIEW_FEATURES.includes('reports.business'));
  assert.ok(registry.resolvePermissions({ vaiTro: ROLES.NHAN_VIEN_SALE }).includes('reports.business'));
  assert.ok(!registry.resolvePermissions({ vaiTro: ROLES.NHAN_VIEN_SALE }).includes('reports.business.refreeze'));
  assert.ok(registry.resolvePermissions({ vaiTro: ROLES.QUAN_LY }).includes('reports.business.refreeze'));
});

test('hr.employees.manage: mặc định chỉ Quản lý, cần hr.employees', () => {
  assert.ok(registry.defaultsForRole('Quản lý').includes('hr.employees.manage'));
  assert.ok(!registry.defaultsForRole('Kế toán').includes('hr.employees.manage'));
  assert.ok(!registry.defaultsForRole('Nhân viên kho').includes('hr.employees.manage'));
  const feature = registry.FEATURES.find(f => f.key === 'hr.employees.manage');
  assert.equal(feature.requires, 'hr.employees');
});
