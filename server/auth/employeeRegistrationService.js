'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const employeeDirectory = require('../hr/employeeDirectory');
const effectiveUserResolver = require('./effectiveUserResolver');
const localUserStore = require('./localUserStore');
const otpService = require('./otpService');

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

class EmployeeRegistrationError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'EmployeeRegistrationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createEmployeeRegistrationService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
  const resolver = options.resolver || effectiveUserResolver;
  const store = options.store || localUserStore;
  const otp = options.otp || otpService;
  const hashPassword = options.hashPassword || (password => bcrypt.hash(password, 10));
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => Date.now());
  const challenges = new Map();

  function getChallenge(challengeId) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || now() > challenge.expiresAt) {
      if (challenge) challenges.delete(challenge.id);
      throw new EmployeeRegistrationError('Phiên xác minh đã hết hạn.', 'REGISTRATION_CHALLENGE_EXPIRED', 400);
    }
    return challenge;
  }

  async function createChallenge(identifier) {
    const normalized = String(identifier || '').trim();
    if (!normalized) throw new EmployeeRegistrationError('Thiếu email hoặc số điện thoại.', 'INVALID_IDENTIFIER');
    const snapshot = await directory.getSnapshot();
    const employee = findEmployeeByIdentifier(snapshot.employees, normalized);
    if (!employee) return { employeeMatch: false };

    const channels = [];
    if (employee.email) channels.push({ channel: 'email', targetMasked: otp.maskEmail(employee.email) });
    if (employee.soDienThoai) channels.push({ channel: 'phone', targetMasked: otp.maskPhone(employee.soDienThoai) });
    if (!channels.length) {
      throw new EmployeeRegistrationError('Dòng nhân sự chưa có email hoặc số điện thoại.', 'HR_CONTACT_MISSING', 409);
    }

    const challengeId = randomUUID();
    challenges.set(challengeId, {
      id: challengeId,
      employee,
      expiresAt: now() + CHALLENGE_TTL_MS,
      selectedChannel: ''
    });
    return { employeeMatch: true, challengeId, channels, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  async function sendOtp(challengeId, channel) {
    const challenge = getChallenge(challengeId);
    const target = channel === 'email'
      ? challenge.employee.email
      : (channel === 'phone' ? challenge.employee.soDienThoai : '');
    if (!target) throw new EmployeeRegistrationError('Kênh OTP không hợp lệ.', 'INVALID_OTP_CHANNEL');
    const key = `hr-register:${challenge.id}`;
    const result = await otp.generateResetOtp(key, target, channel);
    if (!result.success) {
      const error = new EmployeeRegistrationError(
        result.error || 'Không gửi được OTP.',
        result.cooldown ? 'OTP_COOLDOWN' : 'OTP_DELIVERY_FAILED',
        result.cooldown ? 429 : 502
      );
      if (result.waitSeconds) error.waitSeconds = result.waitSeconds;
      throw error;
    }
    challenge.selectedChannel = channel;
    return {
      ok: true,
      channel,
      targetMasked: channel === 'email' ? otp.maskEmail(target) : otp.maskPhone(target),
      expiresInSeconds: result.expiresInSeconds
    };
  }

  async function verifyAndRegister({ challengeId, otp: inputOtp, hoTen, password }) {
    const challenge = getChallenge(challengeId);
    if (!challenge.selectedChannel) {
      throw new EmployeeRegistrationError('Bạn chưa gửi mã OTP.', 'OTP_NOT_SENT');
    }
    const cleanPassword = String(password || '');
    if (cleanPassword.length < 8 || cleanPassword.length > 128) {
      throw new EmployeeRegistrationError('Mật khẩu phải từ 8 đến 128 ký tự.', 'INVALID_PASSWORD');
    }
    const otpKey = `hr-register:${challenge.id}`;
    const verification = otp.verifyResetOtp(otpKey, inputOtp);
    if (!verification.valid) {
      throw new EmployeeRegistrationError(verification.error, 'INVALID_OTP');
    }

    const freshSnapshot = await directory.getSnapshot({ forceRefresh: true });
    const lookup = challenge.employee.email || challenge.employee.soDienThoai;
    const employee = findEmployeeByIdentifier(freshSnapshot.employees, lookup);
    if (!employee) {
      throw new EmployeeRegistrationError('Nhân sự không còn trong danh sách.', 'HR_EMPLOYEE_NOT_FOUND', 409);
    }

    const passwordHash = await hashPassword(cleanPassword);
    let user = await resolver.findAccountForEmployee(employee);
    if (!user) {
      user = await store.createUser({
        id: randomUUID(),
        username: employee.email || employee.soDienThoai,
        hoTen: employee.hoTen || String(hoTen || '').trim(),
        email: employee.email,
        soDienThoai: employee.soDienThoai,
        passwordHash,
        vaiTro: localUserStore.ROLES.KHACH,
        coSo: '',
        trangThai: localUserStore.ACTIVE_STATUS
      });
    }

    const verifiedFields = challenge.selectedChannel === 'email'
      ? { verifiedEmail: true }
      : { verifiedPhone: true };
    user = await store.updateUser(user.id, {
      email: employee.email,
      soDienThoai: employee.soDienThoai,
      hoTen: employee.hoTen || user.hoTen || String(hoTen || '').trim(),
      passwordHash,
      ...verifiedFields
    });
    user = await resolver.resolveUser(user);
    otp.clearResetOtp(otpKey);
    challenges.delete(challenge.id);
    return user;
  }

  async function linkVerifiedGoogleIdentity({ email, hoTen }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return null;
    const snapshot = await directory.getSnapshot();
    const employee = findEmployeeByIdentifier(snapshot.employees, normalizedEmail);
    if (!employee) return null;

    let user = await resolver.findAccountForEmployee(employee);
    if (!user) {
      user = await store.createUser({
        id: randomUUID(),
        username: employee.email,
        hoTen: employee.hoTen || hoTen || employee.email,
        email: employee.email,
        soDienThoai: employee.soDienThoai,
        passwordHash: '',
        vaiTro: localUserStore.ROLES.KHACH,
        coSo: '',
        trangThai: localUserStore.ACTIVE_STATUS
      });
    }
    user = await store.updateUser(user.id, {
      email: employee.email,
      soDienThoai: employee.soDienThoai,
      hoTen: employee.hoTen || user.hoTen || hoTen || employee.email,
      verifiedEmail: true
    });
    return resolver.resolveUser(user);
  }

  return { createChallenge, sendOtp, verifyAndRegister, linkVerifiedGoogleIdentity };
}

const defaultService = createEmployeeRegistrationService();

module.exports = {
  CHALLENGE_TTL_MS,
  EmployeeRegistrationError,
  createEmployeeRegistrationService,
  createChallenge: defaultService.createChallenge,
  sendOtp: defaultService.sendOtp,
  verifyAndRegister: defaultService.verifyAndRegister,
  linkVerifiedGoogleIdentity: defaultService.linkVerifiedGoogleIdentity
};
