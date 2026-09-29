'use strict';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./accountPolicy');
const featureRegistry = require('./featureRegistry');

// Tro ly + duoc Quan ly cap quyen quan tri tai khoan (nhu tinh huong that).
const ADMIN_GRANTS = { 'account.users.manage': true, 'account.permissions': true };
function troLy(extra = {}) {
  return { id: 'a', username: 'troly', vaiTro: 'Trợ lý', featurePermissions: { ...ADMIN_GRANTS, ...extra } };
}
function user(vaiTro, featurePermissions = {}, extra = {}) {
  return { id: `u-${vaiTro}`, username: `user-${vaiTro}`, vaiTro, featurePermissions, ...extra };
}
const manager = { id: 'm', username: 'ql', vaiTro: 'Quản lý' };

test('isManagerClass nhan ra vai tro Quan ly va admin cung', () => {
  assert.equal(policy.isManagerClass(manager), true);
  assert.equal(policy.isManagerClass({ vaiTro: 'Trợ lý', email: 'thangnnv2003@gmail.com' }), true);
  assert.equal(policy.isManagerClass({ vaiTro: 'Trợ lý', username: 'admin' }), true);
  assert.equal(policy.isManagerClass(troLy()), false);
  assert.equal(policy.isManagerClass(null), false);
});

test('Quan ly khong bi rang buoc boi bat ky luat nao', () => {
  assert.equal(policy.checkTargetWritable(manager, user('Quản lý')), null);
  assert.equal(policy.checkGrant(manager, null, user('Quản lý')), null);
  assert.equal(policy.checkTakeover(manager, user('Quản lý'), 'đặt lại mật khẩu'), null);
});

test('checkTargetWritable: nguoi khong phai Quan ly khong ghi len Quan ly / admin cung', () => {
  assert.match(policy.checkTargetWritable(troLy(), user('Quản lý')), /Quản lý/);
  assert.ok(policy.checkTargetWritable(troLy(), { vaiTro: 'Trợ lý', email: 'thangnnv2003@gmail.com' }));
  assert.equal(policy.checkTargetWritable(troLy(), user('Nhân viên kho')), null);
});

test('checkGrant: khong gan vai tro Quan ly du actor co du moi quyen', () => {
  const allPerms = Object.fromEntries(featureRegistry.FEATURE_KEYS.map(k => [k, true]));
  const almostManager = { id: 'a', username: 'gan-ql', vaiTro: 'Trợ lý', featurePermissions: allPerms };
  assert.ok(policy.checkGrant(almostManager, null, user('Quản lý')));
  assert.ok(policy.checkGrant(almostManager, user('Khách'), { ...user('Khách'), vaiTro: 'Quản lý' }));
});

test('checkGrant: chi duoc THEM quyen ma chinh actor co', () => {
  const actor = troLy();
  // Tro ly khong co shipment.override -> khong cap duoc.
  const denied = policy.checkGrant(actor, user('Nhân viên kho'), user('Nhân viên kho', { 'shipment.override': true }));
  assert.match(denied, /Ghi đè trạng thái đơn/);
  // Quyen actor co (reports.overview la mac dinh cua Tro ly) thi cap duoc.
  assert.equal(policy.checkGrant(actor, user('Nhân viên kho'), user('Nhân viên kho', { 'reports.overview': true })), null);
  // Tu cap them cho chinh minh cung bi chan.
  assert.ok(policy.checkGrant(actor, actor, { ...actor, featurePermissions: { ...ADMIN_GRANTS, 'system.syncStatus': true } }));
});

test('checkGrant: doi sang vai tro co quyen mac dinh vuot actor bi chan, vai tro thap hon thi duoc', () => {
  const actor = troLy();
  // Ke toan co shipment.override (Tro ly khong co).
  assert.ok(policy.checkGrant(actor, user('Khách'), user('Kế toán')));
  assert.equal(policy.checkGrant(actor, null, user('Khách')), null);
  assert.equal(policy.checkGrant(actor, null, user('Nhân viên kho')), null);
});

test('checkGrant: duoc RUT BOT quyen cua dich co quyen cao hon actor', () => {
  const actor = troLy();
  const ketoan = user('Kế toán');
  const reduced = { ...ketoan, featurePermissions: { 'shipment.override': false } };
  assert.equal(policy.checkGrant(actor, ketoan, reduced), null);
  // Giu nguyen (khong them gi) cung khong bi chan.
  assert.equal(policy.checkGrant(actor, ketoan, { ...ketoan }), null);
});

test('checkTakeover: dich co quyen vuot actor bi chan, dich <= actor duoc phep', () => {
  const actor = troLy();
  assert.match(policy.checkTakeover(actor, user('Kế toán'), 'đặt lại mật khẩu'), /đặt lại mật khẩu/);
  assert.ok(policy.checkTakeover(actor, user('Quản lý'), 'đặt lại mật khẩu'));
  assert.equal(policy.checkTakeover(actor, user('Nhân viên kho'), 'đặt lại mật khẩu'), null);
  assert.equal(policy.checkTakeover(actor, user('Khách'), 'đặt lại mật khẩu'), null);
});

test('actorPermissions uu tien mang permissions da giai o requireAuth', () => {
  const actor = { ...troLy(), permissions: ['account.profile'] };
  assert.ok(policy.checkTakeover(actor, user('Nhân viên kho'), 'đặt lại mật khẩu'));
});

test('sendDenied tra 403 kem ma ACCOUNT_POLICY_DENIED', () => {
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  policy.sendDenied(res, 'ly do');
  assert.equal(res.code, 403);
  assert.deepEqual(res.body, { error: 'ly do', code: 'ACCOUNT_POLICY_DENIED' });
});
