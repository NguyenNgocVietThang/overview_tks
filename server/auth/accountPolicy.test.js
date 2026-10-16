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

test('Quan ly khong bi rang buoc boi luat 1-3 (nhom tac dong len tai khoan thuong va gan quyen)', () => {
  assert.equal(policy.checkTargetWritable(manager, user('Quản lý')), null);
  assert.equal(policy.checkGrant(manager, null, user('Quản lý')), null);
  assert.equal(policy.checkTakeover(manager, user('Quản lý'), 'đặt lại mật khẩu'), null);
});

// ---- Luat 4 (2026-10-01): Quan ly THUONG khong tac dong len Quan ly KHAC; cap cao (admin cung) thi duoc ----
const seniorOwner = { id: 'owner', username: 'thangnnv2003@gmail.com', email: 'thangnnv2003@gmail.com', vaiTro: 'Quản lý' };
const seniorDefaultAdmin = { id: 'adm', username: 'admin', vaiTro: 'Quản lý' };
const otherManager = { id: 'm2', username: 'ql2', vaiTro: 'Quản lý' };

test('isSeniorAdmin chi nhan ra admin cung, KHONG nhan ra Quan ly thuong', () => {
  assert.equal(policy.isSeniorAdmin(seniorOwner), true);
  assert.equal(policy.isSeniorAdmin(seniorDefaultAdmin), true);
  assert.equal(policy.isSeniorAdmin({ vaiTro: 'Trợ lý', email: 'thangnnv2003@gmail.com' }), true, 'nhan dien theo dinh danh, khong theo vai tro');
  assert.equal(policy.isSeniorAdmin(manager), false);
  assert.equal(policy.isSeniorAdmin(troLy()), false);
  assert.equal(policy.isSeniorAdmin(null), false);
});

test('checkProtectedManager: Quan ly thuong bi chan voi Quan ly khac va admin cung', () => {
  const denied = policy.checkProtectedManager(manager, otherManager, 'đặt lại mật khẩu');
  assert.match(denied, /Chỉ Quản lý cấp cao mới được đặt lại mật khẩu của Quản lý khác/);
  assert.ok(policy.checkProtectedManager(manager, seniorOwner, 'hạ vai trò'));
  assert.ok(policy.checkProtectedManager(manager, { vaiTro: 'Trợ lý', username: 'admin' }, 'khóa tài khoản'));
});

test('checkProtectedManager: Quan ly thuong van thao tac thoai mai voi nhan vien thuong va chinh minh', () => {
  assert.equal(policy.checkProtectedManager(manager, user('Nhân viên kho'), 'đặt lại mật khẩu'), null);
  assert.equal(policy.checkProtectedManager(manager, user('Trợ lý'), 'rút quyền'), null);
  assert.equal(policy.checkProtectedManager(manager, manager, 'đổi email'), null, 'cung id');
  assert.equal(policy.checkProtectedManager(manager, { id: 'khac', username: 'QL', vaiTro: 'Quản lý' }, 'đổi email'), null, 'cung username (khong phan biet hoa/thuong)');
});

test('checkProtectedManager: Quan ly cap cao khong bi chan voi bat ky ai', () => {
  assert.equal(policy.checkProtectedManager(seniorOwner, otherManager, 'xóa tài khoản'), null);
  assert.equal(policy.checkProtectedManager(seniorDefaultAdmin, otherManager, 'hạ vai trò'), null);
  assert.equal(policy.checkProtectedManager(seniorDefaultAdmin, seniorOwner, 'đổi email'), null);
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
  // Tro ly khong co shipment.override (tu 2026-10-03 chi Quan ly co mac dinh) -> khong cap duoc.
  // Dich phai co Vong doi don hang (Ke toan) thi quyen nay moi co hieu luc.
  const denied = policy.checkGrant(actor, user('Kế toán'), user('Kế toán', { 'shipment.override': true }));
  assert.match(denied, /Ghi đè trạng thái đơn/);
  // Quyen actor co (reports.overview la mac dinh cua Tro ly) thi cap duoc.
  assert.equal(policy.checkGrant(actor, user('Nhân viên kho'), user('Nhân viên kho', { 'reports.overview': true })), null);
  // Tu cap them cho chinh minh cung bi chan.
  assert.ok(policy.checkGrant(actor, actor, { ...actor, featurePermissions: { ...ADMIN_GRANTS, 'system.syncStatus': true } }));
});

test('checkGrant: doi sang vai tro co quyen mac dinh vuot actor bi chan, vai tro thap hon thi duoc', () => {
  const actor = troLy();
  // Quan ly co shipment.override va nhieu quyen khac (Tro ly khong co); Ke toan nay <= Tro ly.
  assert.ok(policy.checkGrant(actor, user('Khách'), user('Quản lý')));
  assert.equal(policy.checkGrant(actor, user('Khách'), user('Kế toán')), null);
  assert.equal(policy.checkGrant(actor, null, user('Khách')), null);
  assert.equal(policy.checkGrant(actor, null, user('Nhân viên kho')), null);
});

test('checkGrant: duoc RUT BOT quyen cua dich co quyen cao hon actor', () => {
  const actor = troLy();
  const ketoan = user('Kế toán', { 'shipment.override': true });
  const reduced = { ...ketoan, featurePermissions: { 'shipment.override': false } };
  assert.equal(policy.checkGrant(actor, ketoan, reduced), null);
  // Giu nguyen (khong them gi) cung khong bi chan.
  assert.equal(policy.checkGrant(actor, ketoan, { ...ketoan }), null);
});

test('checkTakeover: dich co quyen vuot actor bi chan, dich <= actor duoc phep', () => {
  const actor = troLy();
  assert.match(policy.checkTakeover(actor, user('Kế toán', { 'shipment.override': true }), 'đặt lại mật khẩu'), /đặt lại mật khẩu/);
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

// ---- Luat 5 (2026-10-05): chan leo thang qua dinh danh (email / SDT / username) ----

test('checkProtectedIdentity: chi Quan ly cap cao moi dat duoc dinh danh admin cung', () => {
  for (const id of ['thangnnv2003@gmail.com', ' ADMIN@tokosi.vn ', 'admin', 'Thangnnv2003']) {
    assert.ok(policy.checkProtectedIdentity(manager, [id]), id);
    assert.ok(policy.checkProtectedIdentity(troLy(), ['', id]), id);
    assert.equal(policy.checkProtectedIdentity(seniorDefaultAdmin, [id]), null, id);
  }
  assert.equal(policy.checkProtectedIdentity(manager, ['nv@tokosi.vn', '0912345678', '', null]), null);
});

test('checkSelfContactChange: chan tu doi email/SDT cua chinh minh, tru cap cao', () => {
  assert.ok(policy.checkSelfContactChange(manager, manager));
  assert.ok(policy.checkSelfContactChange(manager, { id: 'khac', username: 'QL' }), 'cung username');
  assert.equal(policy.checkSelfContactChange(manager, user('Nhân viên kho')), null);
  assert.equal(policy.checkSelfContactChange(seniorDefaultAdmin, seniorDefaultAdmin), null);
});

test('hrIdentitiesOf: giong localUserMatchesEmployee — dò CẢ username lẫn email/SĐT, đã chuẩn hóa', () => {
  assert.deepEqual(policy.hrIdentitiesOf({ username: 'a@x.vn' }), { emails: ['a@x.vn'], phones: [] });
  assert.deepEqual(policy.hrIdentitiesOf({ username: '0912345678' }), { emails: [], phones: ['0912345678'] });
  // Co email/SĐT van phai do username (truoc day bi bo qua => vong qua bang username).
  assert.deepEqual(policy.hrIdentitiesOf({ username: ' Sep@X.vn ', email: 'vohai@x.vn' }),
    { emails: ['vohai@x.vn', 'sep@x.vn'], phones: [] });
  assert.deepEqual(policy.hrIdentitiesOf({ username: '+84911000111', email: 'E@x.vn', soDienThoai: '0911 999 888' }),
    { emails: ['e@x.vn'], phones: ['0911999888', '0911000111'] });
  // Trung lap / rong bi loai.
  assert.deepEqual(policy.hrIdentitiesOf({ username: 'e@x.vn', email: 'E@X.VN' }), { emails: ['e@x.vn'], phones: [] });
  assert.deepEqual(policy.hrIdentitiesOf({ username: 'nhanvien' }), { emails: [], phones: [] });
  assert.deepEqual(policy.hrIdentitiesOf(null), { emails: [], phones: [] });
});

test('checkHrRoleEscalation: dong nhan su vai tro vuot quyen actor bi chan; Quan ly thi duoc', () => {
  const qlRow = { rowIndex: 1, sheetVaiTro: 'Quản lý' };
  const khoRow = { rowIndex: 2, sheetVaiTro: 'Nhân viên kho' };
  assert.match(policy.checkHrRoleEscalation(troLy(), [qlRow]), /Quản lý/);
  assert.ok(policy.checkHrRoleEscalation(troLy(), [khoRow, qlRow]));
  assert.equal(policy.checkHrRoleEscalation(troLy(), [khoRow]), null);
  assert.equal(policy.checkHrRoleEscalation(troLy(), []), null);
  assert.equal(policy.checkHrRoleEscalation(manager, [qlRow]), null);
});

test('sendDenied nhan ma rieng', () => {
  const res = { status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  policy.sendDenied(res, 'x', policy.PROTECTED_IDENTITY_CODE);
  assert.deepEqual(res.body, { error: 'x', code: 'PROTECTED_IDENTITY' });
});
