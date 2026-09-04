'use strict';

const crypto = require('crypto');
const employeeDirectory = require('../hr/employeeDirectory');
const localUserStore = require('./localUserStore');
const otpService = require('./otpService');

class ContactChangeError extends Error {
  constructor(message, code, statusCode = 400) {
    super(message);
    this.name = 'ContactChangeError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function createContactChangeService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
  const store = options.store || localUserStore;
  const otp = options.otp || otpService;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => Date.now());
  const challenges = new Map();

  function normalize(field, value) {
    if (field === 'email') {
      const email = String(value || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ContactChangeError('Email không hợp lệ.', 'INVALID_CONTACT');
      }
      return email;
    }
    if (field === 'phone') {
      const phone = localUserStore.normalizePhone(value);
      if (!/^0[35789][0-9]{8}$/.test(phone)) {
        throw new ContactChangeError('Số điện thoại không hợp lệ.', 'INVALID_CONTACT');
      }
      return phone;
    }
    throw new ContactChangeError('Trường liên hệ không hợp lệ.', 'INVALID_CONTACT_FIELD');
  }

  async function beginChange(user, field, rawValue) {
    if (!user || !user.hrManaged) {
      throw new ContactChangeError('Chỉ tài khoản nhân sự mới cập nhật liên hệ qua Sheet.', 'HR_ACCOUNT_REQUIRED', 409);
    }
    const value = normalize(field, rawValue);
    const users = await store.getAllUsers();
    const duplicate = users.find(candidate => {
      if (String(candidate.id) === String(user.id)) return false;
      if (field === 'email') {
        return String(candidate.email || '').trim().toLowerCase() === value ||
          String(candidate.username || '').trim().toLowerCase() === value;
      }
      return localUserStore.normalizePhone(candidate.soDienThoai || candidate.username) === value;
    });
    if (duplicate) throw new ContactChangeError('Thông tin liên hệ đã được sử dụng.', 'USER_EXISTS', 409);

    const challengeId = randomUUID();
    const channel = field === 'email' ? 'email' : 'phone';
    const key = `hr-contact:${challengeId}`;
    const sent = await otp.generateResetOtp(key, value, channel);
    if (!sent.success) {
      const err = new ContactChangeError(sent.error || 'Không gửi được OTP.', sent.cooldown ? 'OTP_COOLDOWN' : 'OTP_DELIVERY_FAILED', sent.cooldown ? 429 : 502);
      if (sent.waitSeconds) err.waitSeconds = sent.waitSeconds;
      throw err;
    }
    challenges.set(challengeId, {
      id: challengeId,
      userId: String(user.id),
      field,
      value,
      expiresAt: now() + (otp.OTP_TTL_MS || 5 * 60 * 1000)
    });
    return {
      challengeId,
      field,
      targetMasked: field === 'email' ? otp.maskEmail(value) : otp.maskPhone(value),
      expiresInSeconds: sent.expiresInSeconds
    };
  }

  async function confirmChange(user, challengeId, inputOtp) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || challenge.userId !== String(user && user.id) || now() > challenge.expiresAt) {
      throw new ContactChangeError('Phiên đổi thông tin đã hết hạn.', 'CONTACT_CHALLENGE_EXPIRED');
    }
    const otpKey = `hr-contact:${challenge.id}`;
    const verified = otp.verifyResetOtp(otpKey, inputOtp);
    if (!verified.valid) throw new ContactChangeError(verified.error, 'INVALID_OTP');

    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const employee = findEmployeeByIdentifier(snapshot.employees, {
      email: user.email,
      phone: user.soDienThoai
    });
    if (!employee) throw new ContactChangeError('Không tìm thấy dòng nhân sự hiện tại.', 'HR_EMPLOYEE_NOT_FOUND', 409);

    await directory.updateEmployeeContact(employee, challenge.field, challenge.value);
    const localField = challenge.field === 'email' ? 'email' : 'soDienThoai';
    const verifiedField = challenge.field === 'email' ? 'verifiedEmail' : 'verifiedPhone';
    const updated = await store.updateUser(user.id, {
      [localField]: challenge.value,
      [verifiedField]: true
    });
    otp.clearResetOtp(otpKey);
    challenges.delete(challenge.id);
    return updated;
  }

  async function adminChange(user, field, rawValue) {
    if (!user || !user.hrManaged) {
      throw new ContactChangeError('Tài khoản không được quản lý bởi HR Sheet.', 'HR_ACCOUNT_REQUIRED', 409);
    }
    const value = normalize(field, rawValue);
    const users = await store.getAllUsers();
    const duplicate = users.find(candidate => {
      if (String(candidate.id) === String(user.id)) return false;
      return field === 'email'
        ? String(candidate.email || candidate.username || '').trim().toLowerCase() === value
        : localUserStore.normalizePhone(candidate.soDienThoai || candidate.username) === value;
    });
    if (duplicate) throw new ContactChangeError('Thông tin liên hệ đã được sử dụng.', 'USER_EXISTS', 409);
    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const employee = findEmployeeByIdentifier(snapshot.employees, { email: user.email, phone: user.soDienThoai });
    if (!employee) throw new ContactChangeError('Không tìm thấy dòng nhân sự hiện tại.', 'HR_EMPLOYEE_NOT_FOUND', 409);
    await directory.updateEmployeeContact(employee, field, value);
    const localField = field === 'email' ? 'email' : 'soDienThoai';
    const verifiedField = field === 'email' ? 'verifiedEmail' : 'verifiedPhone';
    return store.updateUser(user.id, { [localField]: value, [verifiedField]: true });
  }

  return { beginChange, confirmChange, adminChange };
}

const defaultService = createContactChangeService();

module.exports = {
  ContactChangeError,
  createContactChangeService,
  beginChange: defaultService.beginChange,
  confirmChange: defaultService.confirmChange,
  adminChange: defaultService.adminChange
};
