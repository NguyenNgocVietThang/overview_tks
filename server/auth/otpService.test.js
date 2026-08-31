'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const emailSender = require('../notifications/emailSender');
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

emailSender.isConfigured = () => false;

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

test('otpService: sinh ma OTP, kiem tra dung ma va xoa ma', async () => {
  clearAllOtp();
  const res = await generateResetOtp('testuser', 'test@example.com', 'email');
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

test('otpService: khoa khi nhap sai qua so lan MAX_OTP_ATTEMPTS', async () => {
  clearAllOtp();
  const res = await generateResetOtp('user-lock', 'user@example.com', 'email');
  for (let i = 0; i < MAX_OTP_ATTEMPTS; i++) {
    verifyResetOtp('user-lock', '111111');
  }
  const lockedRes = verifyResetOtp('user-lock', res.code);
  assert.equal(lockedRes.valid, false);
  assert.match(lockedRes.error, /nhập sai mã OTP quá 5 lần/);
});

test('otpService: gui lai OTP ngay lap tuc bi chan boi cooldown', async () => {
  clearAllOtp();
  const first = await generateResetOtp('user-cooldown', 'user@example.com', 'email');
  assert.equal(first.success, true);
  assert.match(first.code, /^[0-9]{6}$/);

  const second = await generateResetOtp('user-cooldown', 'user@example.com', 'email');
  assert.equal(second.success, false);
  assert.equal(second.cooldown, true);
  assert.ok(second.waitSeconds > 0 && second.waitSeconds <= 60);

  // Ma cu van con hieu luc, chua bi ghi de boi lan goi bi chan
  const verifyRes = verifyResetOtp('user-cooldown', first.code);
  assert.equal(verifyRes.valid, true);
});

test('otpService: gui that bai (loi provider Email that) -> success false, khong luu OTP, khong tinh cooldown', async () => {
  clearAllOtp();
  const originalIsConfigured = emailSender.isConfigured;
  const originalSendOtpEmail = emailSender.sendOtpEmail;
  emailSender.isConfigured = () => true;
  emailSender.sendOtpEmail = async () => ({ ok: false, error: 'SMTP tam thoi khong ket noi duoc' });

  try {
    const res = await generateResetOtp('user-send-fail', 'fail@example.com', 'email');
    assert.equal(res.success, false);
    assert.equal(res.cooldown, undefined);
    assert.ok(res.error);

    // Khong luu OTP khi gui that bai -> verify bao "khong ton tai"
    const verifyRes = verifyResetOtp('user-send-fail', '123456');
    assert.equal(verifyRes.valid, false);
    assert.match(verifyRes.error, /không tồn tại hoặc đã hết hạn/);

    // Gui that bai KHONG duoc tinh vao cooldown -> thu lai ngay lap tuc phai duoc phep
    emailSender.sendOtpEmail = async () => ({ ok: true });
    const retryRes = await generateResetOtp('user-send-fail', 'fail@example.com', 'email');
    assert.equal(retryRes.success, true);
  } finally {
    emailSender.isConfigured = originalIsConfigured;
    emailSender.sendOtpEmail = originalSendOtpEmail;
  }
});
