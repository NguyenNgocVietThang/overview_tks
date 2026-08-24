'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  maskEmail,
  maskPhone,
  getAvailableChannels,
  generateResetOtp,
  verifyResetOtp,
  clearResetOtp,
  clearAllOtp,
  MAX_OTP_ATTEMPTS
} = require('./otpService');

test('otpService: maskEmail che mo dung dinh dang', () => {
  assert.equal(maskEmail('nguyenvana@gmail.com'), 'ng***a@gmail.com');
  assert.equal(maskEmail('ab@domain.vn'), 'a***@domain.vn');
  assert.equal(maskEmail(''), '');
  assert.equal(maskEmail(null), '');
});

test('otpService: maskPhone che mo dung dinh dang', () => {
  assert.equal(maskPhone('0912345678'), '09****678');
  assert.equal(maskPhone('+84912345678'), '+8****678');
  assert.equal(maskPhone('123'), '123');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone(null), '');
});

test('otpService: getAvailableChannels tra ve day du cac kenh cua user', () => {
  const user = {
    username: 'testuser',
    email: 'main@gmail.com',
    soDienThoai: '0912345678',
    emailKhoiPhuc: 'recovery@gmail.com',
    sdtKhoiPhuc: '0987654321'
  };
  const channels = getAvailableChannels(user);
  assert.equal(channels.length, 4);
  assert.equal(channels[0].channel, 'email');
  assert.equal(channels[1].channel, 'recovery_email');
  assert.equal(channels[2].channel, 'phone');
  assert.equal(channels[3].channel, 'recovery_phone');
});

test('otpService: sinh ma OTP, kiem tra dung ma va xoa ma', () => {
  clearAllOtp();
  const res = generateResetOtp('testuser', 'test@example.com', 'email');
  assert.equal(res.success, true);
  assert.match(res.code, /^[0-9]{6}$/);

  // Kiem tra sai ma
  const wrongRes = verifyResetOtp('testuser', '000000');
  assert.equal(wrongRes.valid, false);
  assert.match(wrongRes.error, /Mã OTP không chính xác/);

  // Kiem tra dung ma
  const okRes = verifyResetOtp('testuser', res.code);
  assert.equal(okRes.valid, true);
  assert.equal(okRes.identifier, 'testuser');

  // Xoa ma sau khi dung
  clearResetOtp('testuser');
  const deletedRes = verifyResetOtp('testuser', res.code);
  assert.equal(deletedRes.valid, false);
});

test('otpService: khoa khi nhap sai qua so lan MAX_OTP_ATTEMPTS', () => {
  clearAllOtp();
  const res = generateResetOtp('user-lock', 'user@example.com', 'email');
  for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
    verifyResetOtp('user-lock', '111111');
  }
  const lockedRes = verifyResetOtp('user-lock', res.code);
  assert.equal(lockedRes.valid, false);
  assert.match(lockedRes.error, /nhập sai mã OTP quá 5 lần/);
});

test('otpService: gui lai OTP ngay lap tuc bi chan boi cooldown', () => {
  clearAllOtp();
  const first = generateResetOtp('user-cooldown', 'user@example.com', 'email');
  assert.equal(first.success, true);
  assert.match(first.code, /^[0-9]{6}$/);

  const second = generateResetOtp('user-cooldown', 'user@example.com', 'email');
  assert.equal(second.success, false);
  assert.equal(second.cooldown, true);
  assert.ok(second.waitSeconds > 0 && second.waitSeconds <= 60);

  // Ma cu van con hieu luc, chua bi ghi de boi lan goi bi chan
  const verifyRes = verifyResetOtp('user-cooldown', first.code);
  assert.equal(verifyRes.valid, true);
});
