'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const registry = require('./featureRegistry');
const { ROLES, INTERNAL_ROLES, REPORTS_ROLES } = require('./userRepository');

// Cac tap hop vai tro CU (truoc khi co featureRegistry) — giu lai nguyen van o
// day de test bat duoc moi thay doi hanh vi ngoai y muon khi sua bang mac dinh.
const LEGACY_NO_REPORTS_ROLES = [
  'Khách', 'Lái xe', 'Kế toán', 'Trưởng kho',
  'Nhân viên kho', 'Nhân viên sale', 'Nhân viên mua hàng'
];

test('mac dinh theo vai tro: reports.* khop dung REPORTS_ROLES cu', () => {
  for (const role of REPORTS_ROLES) {
    const defaults = registry.defaultsForRole(role);
    for (const key of registry.ANY_REPORTS_FEATURES) {
      assert.ok(defaults.includes(key), `${role} phai co ${key}`);
    }
  }
  for (const role of LEGACY_NO_REPORTS_ROLES) {
    const defaults = registry.defaultsForRole(role);
    const reportKeys = defaults.filter(key => key.startsWith('reports.'));
    assert.deepEqual(reportKeys, [], `${role} khong duoc co quyen reports.* nao`);
  }
});

test('mac dinh theo vai tro: hr.* va account.users danh cho moi vai tro noi bo', () => {
  for (const role of INTERNAL_ROLES) {
    const defaults = registry.defaultsForRole(role);
    assert.ok(defaults.includes('hr.rules'), role);
    assert.ok(defaults.includes('hr.employees'), role);
    assert.ok(defaults.includes('hr.leave'), role);
    assert.ok(defaults.includes('account.users'), role);
  }
  const guest = registry.defaultsForRole(ROLES.KHACH);
  assert.deepEqual(guest, ['shipment.lookup', 'account.profile']);
});

test('chi Quan ly moi co cac quyen quan tri mac dinh', () => {
  const managerOnly = ['hr.leave.manage', 'account.users.manage', 'account.permissions', 'system.syncStatus'];
  for (const key of managerOnly) {
    assert.ok(registry.defaultsForRole(ROLES.QUAN_LY).includes(key), `Quản lý phai co ${key}`);
    for (const role of Object.values(ROLES)) {
      if (role === ROLES.QUAN_LY) continue;
      assert.ok(!registry.defaultsForRole(role).includes(key), `${role} khong duoc co ${key}`);
    }
  }
});

test('ghi de trang thai don hang chi danh cho Quan ly va Ke toan', () => {
  for (const role of Object.values(ROLES)) {
    const expected = role === ROLES.QUAN_LY || role === ROLES.KE_TOAN;
    assert.equal(registry.defaultsForRole(role).includes('shipment.override'), expected, role);
  }
});

test('Nhan vien marketing co quyen mac dinh Y HET Nhan vien sale', () => {
  assert.deepEqual(
    registry.defaultsForRole(ROLES.NHAN_VIEN_MARKETING),
    registry.defaultsForRole(ROLES.NHAN_VIEN_SALE)
  );
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
  assert.deepEqual(permissions, registry.FEATURE_KEYS);
});

test('hasFeature/permissionsHave dung ngu nghia HOAC', () => {
  const user = { vaiTro: ROLES.KHACH };
  assert.equal(registry.hasFeature(user, 'reports.debt', 'shipment.lookup'), true);
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
  assert.equal(registry.landingPathFor(registry.defaultsForRole(ROLES.KHACH)), '/shipment/lifecycle/');
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
