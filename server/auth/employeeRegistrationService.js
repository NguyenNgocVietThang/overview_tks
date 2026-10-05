'use strict';

// Lien ket tai khoan voi dong nhan su (HR) khi dang nhap Google bang email da xac minh.
// Luong dang ky nhan su bang OTP (/api/auth/register/{channels,send-otp,verify}) da go
// vi khong con giao dien nao goi.

const crypto = require('crypto');
const employeeDirectory = require('../hr/employeeDirectory');
const effectiveUserResolver = require('./effectiveUserResolver');
const localUserStore = require('./localUserStore');

// Cac email cua TK: truong email + username neu la email (chuan hoa trim/lowercase).
function accountEmails(user) {
  const username = String(user.username || '').trim();
  return [user.email, username.includes('@') ? username : '']
    .map(value => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function createEmployeeRegistrationService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
  const resolver = options.resolver || effectiveUserResolver;
  const store = options.store || localUserStore;
  const randomUUID = options.randomUUID || crypto.randomUUID;

  // allowCreate=false: chi lien ket voi tai khoan DA CO, khong tao tai khoan moi cho nhan su
  // (tu dang ky dang bi khoa — xem ALLOW_SELF_REGISTRATION trong config.js).
  async function linkVerifiedGoogleIdentity({ email, hoTen, allowCreate = true }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return null;
    const snapshot = await directory.getSnapshot();
    const employee = findEmployeeByIdentifier(snapshot.employees, normalizedEmail);
    if (!employee) return null;

    let user = await resolver.findAccountForEmployee(employee);
    // TK da gan (hrRowIndex) mot dong nhan su KHAC: khong ghi email/SĐT cua
    // nhan su nay vao do va khong dang nhap vao TK do (se mang vai tro nguoi khac).
    const boundRow = user && user.hrManaged && user.hrRowIndex !== undefined && user.hrRowIndex !== null
      ? String(user.hrRowIndex).trim()
      : '';
    if (boundRow && boundRow !== String(employee.rowIndex)) {
      throw new effectiveUserResolver.EffectiveUserError(
        'Email/SĐT của nhân sự này đang thuộc một tài khoản đã gắn nhân sự khác.',
        'HR_IDENTITY_CONFLICT',
        409
      );
    }
    // TK CHUA GAN chi duoc nhan email Google khi chinh TK do khop EMAIL nay.
    // Khop qua SĐT/username thi tu choi: ke co quyen tao TK co the dung san TK
    // chua gan mang SĐT/username cua nhan su (vd Quan ly) de chiem vai tro khi
    // nhan su that dang nhap Google. TK da gan dung dong (boundRow) giu nhu cu.
    if (user && !boundRow && !accountEmails(user).includes(normalizedEmail)) {
      throw new effectiveUserResolver.EffectiveUserError(
        'Tài khoản khớp nhân sự này chưa được gắn với email Google của bạn. Vui lòng liên hệ Quản lý để gắn tài khoản.',
        'HR_IDENTITY_CONFLICT',
        409
      );
    }
    if (!user && !allowCreate) return null;
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

  return { linkVerifiedGoogleIdentity };
}

const defaultService = createEmployeeRegistrationService();

module.exports = {
  createEmployeeRegistrationService,
  linkVerifiedGoogleIdentity: defaultService.linkVerifiedGoogleIdentity
};
