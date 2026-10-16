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

// otpService chỉ giới hạn 5 lần sai TRONG 1 mã rồi xóa bản ghi -> xin mã mới
// là đoán tiếp vô hạn. Đếm sai theo user qua MỌI challenge trong cửa sổ trượt,
// và giới hạn số lần gửi mã theo user (chống spam thư). Lưu trong bộ nhớ (1 instance).
const WRONG_OTP_WINDOW_MS = 60 * 60 * 1000;
const MAX_WRONG_OTP_PER_WINDOW = 10;
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 5;

function normalizeEmailValue(value) {
  return String(value || '').trim().toLowerCase();
}

function createContactChangeService(options = {}) {
  const directory = options.directory || employeeDirectory;
  const findEmployeeByIdentifier = options.findEmployeeByIdentifier || employeeDirectory.findEmployeeByIdentifier;
  const store = options.store || localUserStore;
  const otp = options.otp || otpService;
  const randomUUID = options.randomUUID || crypto.randomUUID;
  const now = options.now || (() => Date.now());
  const challenges = new Map();
  const wrongOtpByUser = new Map(); // Map<userId, number[]> mốc thời gian nhập sai
  const sendsByUser = new Map(); // Map<userId, number[]> mốc thời gian gửi mã
  const sendingUsers = new Set(); // user đang trong lượt begin (chống gọi song song)

  // Cửa sổ trượt: bỏ mốc quá hạn, xóa key rỗng để Map không phình.
  function recentHits(map, userId, windowMs) {
    const current = now();
    const hits = (map.get(userId) || []).filter(at => current - at < windowMs);
    if (hits.length) map.set(userId, hits); else map.delete(userId);
    return hits;
  }

  function waitSecondsFor(hits, max, windowMs) {
    const oldest = hits[hits.length - max];
    return Math.max(1, Math.ceil((oldest + windowMs - now()) / 1000));
  }

  function assertNotLockedOut(userId) {
    const hits = recentHits(wrongOtpByUser, userId, WRONG_OTP_WINDOW_MS);
    if (hits.length >= MAX_WRONG_OTP_PER_WINDOW) {
      const waitSeconds = waitSecondsFor(hits, MAX_WRONG_OTP_PER_WINDOW, WRONG_OTP_WINDOW_MS);
      const err = new ContactChangeError(
        `Bạn đã nhập sai mã OTP quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(waitSeconds / 60)} phút.`,
        'OTP_TOO_MANY_ATTEMPTS',
        429
      );
      err.waitSeconds = waitSeconds;
      throw err;
    }
  }

  function assertSendQuota(userId) {
    const hits = recentHits(sendsByUser, userId, SEND_WINDOW_MS);
    if (hits.length >= MAX_SENDS_PER_WINDOW) {
      const waitSeconds = waitSecondsFor(hits, MAX_SENDS_PER_WINDOW, SEND_WINDOW_MS);
      const err = new ContactChangeError(
        `Bạn đã yêu cầu gửi mã quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(waitSeconds / 60)} phút.`,
        'OTP_SEND_LIMIT',
        429
      );
      err.waitSeconds = waitSeconds;
      throw err;
    }
  }

  function normalize(field, value) {
    if (field === 'email') {
      const email = String(value || '').trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ContactChangeError('Email không hợp lệ.', 'INVALID_CONTACT');
      }
      return email;
    }
    if (field === 'phone') {
      const phone = localUserStore.normalizePhone(value);
      if (!/^[0-9]{10}$/.test(phone)) {
        throw new ContactChangeError('Số điện thoại không hợp lệ.', 'INVALID_CONTACT');
      }
      return phone;
    }
    throw new ContactChangeError('Trường liên hệ không hợp lệ.', 'INVALID_CONTACT_FIELD');
  }

  // TK khác (chưa xóa) đang dùng giá trị này làm email/SĐT/tên đăng nhập.
  function findDuplicate(users, user, field, value) {
    return users.find(candidate => {
      if (!candidate || candidate.isDeleted || String(candidate.id) === String(user.id)) return false;
      if (field === 'email') {
        return [candidate.email, candidate.username, candidate.emailKhoiPhuc]
          .some(raw => raw && normalizeEmailValue(raw) === value);
      }
      return [candidate.soDienThoai, candidate.username, candidate.sdtKhoiPhuc]
        .some(raw => raw && localUserStore.normalizePhone(raw) === value);
    });
  }

  async function assertNotTaken(user, field, value) {
    const users = await store.getAllUsers();
    if (findDuplicate(users, user, field, value)) {
      throw new ContactChangeError('Thông tin liên hệ đã được sử dụng.', 'USER_EXISTS', 409);
    }
    return users;
  }

  // TK khác (chưa xóa) đã gắn dòng nhân sự này (hrRowIndex), hoặc chưa gắn nhưng
  // email/SĐT/tên đăng nhập khớp dòng -> resolver sẽ báo "nhân sự khớp TK khác".
  function employeeTakenByOther(users, user, employee) {
    const rowIndex = String(employee.rowIndex);
    return users.some(candidate => {
      if (!candidate || candidate.isDeleted || String(candidate.id) === String(user.id)) return false;
      const bound = candidate.hrRowIndex === undefined || candidate.hrRowIndex === null
        ? '' : String(candidate.hrRowIndex).trim();
      if (bound) {
        return bound === rowIndex &&
          (!candidate.hrSourceBranch || !employee.sourceBranch || candidate.hrSourceBranch === employee.sourceBranch);
      }
      const username = String(candidate.username || '').trim();
      const emails = [candidate.email, username.includes('@') ? username : '']
        .map(normalizeEmailValue).filter(Boolean);
      const phones = [candidate.soDienThoai, !username.includes('@') ? username : '']
        .map(raw => (raw ? localUserStore.normalizePhone(raw) : '')).filter(Boolean);
      return (employee.email && emails.includes(normalizeEmailValue(employee.email))) ||
        (employee.soDienThoai && phones.includes(localUserStore.normalizePhone(employee.soDienThoai)));
    });
  }

  // Chạy TRƯỚC khi ghi: nếu không, email mới được lưu rồi resolveUser mới ném
  // HR_IDENTITY_CONFLICT -> TK tự khóa 409 ở mọi request. Danh bạ CHỈ ĐỌC.
  // Không đọc được danh bạ thì từ chối (fail closed) thay vì ghi mù.
  async function assertNoHrConflict(user, email, users, { forceRefresh = false } = {}) {
    let snapshot;
    try {
      snapshot = await directory.getSnapshot(forceRefresh ? { forceRefresh: true } : undefined);
    } catch (err) {
      throw new ContactChangeError('Không đối chiếu được danh sách nhân sự, vui lòng thử lại sau.', 'HR_DIRECTORY_UNAVAILABLE', 503);
    }
    const employees = (snapshot && snapshot.employees) || [];
    let employee;
    try {
      employee = findEmployeeByIdentifier(employees, { email, phone: user.soDienThoai || '' });
    } catch (err) {
      if (err && err.code === 'HR_IDENTITY_CONFLICT') {
        throw new ContactChangeError('Email mới và số điện thoại của tài khoản đang trỏ tới hai nhân sự khác nhau. Vui lòng liên hệ Quản lý.', 'HR_IDENTITY_CONFLICT', 409);
      }
      throw err;
    }
    if (employee && employeeTakenByOther(users, user, employee)) {
      throw new ContactChangeError('Thông tin liên hệ đã được sử dụng.', 'USER_EXISTS', 409);
    }
  }

  // TK gắn nhân sự lấy vai trò từ hr_employees theo email/SĐT -> tự đổi email
  // là đường chiếm vai trò. Chỉ Quản lý đổi qua trang quản trị (adminChange).
  function assertSelfServiceAllowed(user) {
    if (user && user.hrManaged) {
      throw new ContactChangeError('Email của tài khoản nhân sự chỉ Quản lý được đổi. Vui lòng liên hệ Quản lý.', 'EMAIL_CHANGE_LOCKED', 403);
    }
  }

  // Ưu tiên đúng dòng đã gắn (hrRowIndex = hr_employees.id); chỉ khi thiếu mới dò theo email/SĐT cũ.
  async function findCurrentEmployee(user) {
    const snapshot = await directory.getSnapshot({ forceRefresh: true });
    const employees = (snapshot && snapshot.employees) || [];
    let employee = null;
    if (user.hrRowIndex !== undefined && user.hrRowIndex !== null && user.hrRowIndex !== '') {
      employee = employees.find(candidate => (
        String(candidate.rowIndex) === String(user.hrRowIndex) &&
        (!user.hrSourceBranch || !candidate.sourceBranch || candidate.sourceBranch === user.hrSourceBranch)
      )) || null;
    }
    if (!employee) {
      employee = findEmployeeByIdentifier(employees, { email: user.email, phone: user.soDienThoai });
    }
    if (!employee) throw new ContactChangeError('Không tìm thấy dòng nhân sự hiện tại.', 'HR_EMPLOYEE_NOT_FOUND', 409);
    return employee;
  }

  async function beginChange(user, field, rawValue) {
    if (!user || user.id === undefined || user.id === null) {
      throw new ContactChangeError('Phiên đăng nhập không hợp lệ.', 'AUTH_REQUIRED', 401);
    }
    if (field === 'phone') {
      throw new ContactChangeError('Số điện thoại chỉ Quản lý được đổi. Vui lòng liên hệ Quản lý.', 'PHONE_CHANGE_LOCKED', 403);
    }
    if (field !== 'email') {
      throw new ContactChangeError('Trường liên hệ không hợp lệ.', 'INVALID_CONTACT_FIELD');
    }
    assertSelfServiceAllowed(user);
    const value = normalize(field, rawValue);
    if (value === String(user.email || '').trim().toLowerCase()) {
      throw new ContactChangeError('Email mới trùng email hiện tại.', 'CONTACT_UNCHANGED');
    }
    const userId = String(user.id);
    assertNotLockedOut(userId);
    // Cờ "đang gửi" đặt ĐỒNG BỘ (không có await giữa kiểm và đặt): cooldown của
    // otpService chỉ ghi sau khi gửi thư xong nên các lời gọi song song đều lọt.
    if (sendingUsers.has(userId)) {
      const err = new ContactChangeError('Đang gửi mã OTP, vui lòng đợi giây lát.', 'OTP_IN_PROGRESS', 429);
      err.waitSeconds = 5;
      throw err;
    }
    assertSendQuota(userId);
    sendingUsers.add(userId);
    let sent;
    try {
      const users = await assertNotTaken(user, field, value);
      await assertNoHrConflict(user, value, users);

      // Khóa OTP theo user (không theo challenge) để cooldown gửi lại 60 giây của
      // otpService áp cho từng tài khoản; mỗi user chỉ giữ 1 challenge còn hiệu lực.
      const sendAt = now();
      const hits = sendsByUser.get(userId) || [];
      hits.push(sendAt);
      sendsByUser.set(userId, hits);
      sent = await otp.generateResetOtp(`contact-change:${userId}`, value, 'email');
      // Bị cooldown thì không có thư nào được gửi -> trả lại lượt.
      if (!sent.success && sent.cooldown) {
        const index = hits.indexOf(sendAt);
        if (index >= 0) hits.splice(index, 1);
      }
    } finally {
      sendingUsers.delete(userId);
    }
    const otpKey = `contact-change:${userId}`;
    if (!sent.success) {
      const err = new ContactChangeError(sent.error || 'Không gửi được OTP.', sent.cooldown ? 'OTP_COOLDOWN' : 'OTP_DELIVERY_FAILED', sent.cooldown ? 429 : 502);
      if (sent.waitSeconds) err.waitSeconds = sent.waitSeconds;
      throw err;
    }
    for (const [id, existing] of challenges) {
      if (existing.userId === userId || now() > existing.expiresAt) challenges.delete(id);
    }
    const challengeId = randomUUID();
    challenges.set(challengeId, {
      id: challengeId,
      userId,
      otpKey,
      field,
      value,
      expiresAt: now() + (otp.OTP_TTL_MS || 5 * 60 * 1000)
    });
    return {
      challengeId,
      field,
      targetMasked: otp.maskEmail(value),
      expiresInSeconds: sent.expiresInSeconds
    };
  }

  async function confirmChange(user, challengeId, inputOtp) {
    const challenge = challenges.get(String(challengeId || ''));
    if (!challenge || challenge.userId !== String(user && user.id) || now() > challenge.expiresAt) {
      throw new ContactChangeError('Phiên đổi thông tin đã hết hạn.', 'CONTACT_CHALLENGE_EXPIRED');
    }
    assertSelfServiceAllowed(user);
    const userId = challenge.userId;
    const dropChallenge = () => {
      challenges.delete(challenge.id);
      otp.clearResetOtp(challenge.otpKey);
    };
    try {
      assertNotLockedOut(userId);
    } catch (err) {
      dropChallenge();
      throw err;
    }
    const verified = otp.verifyResetOtp(challenge.otpKey, inputOtp);
    if (!verified.valid) {
      const hits = wrongOtpByUser.get(userId) || [];
      hits.push(now());
      wrongOtpByUser.set(userId, hits);
      try {
        assertNotLockedOut(userId);
      } catch (err) {
        dropChallenge();
        throw err;
      }
      throw new ContactChangeError(verified.error, 'INVALID_OTP');
    }

    // Dùng 1 lần: xóa trước khi ghi để không thể xác nhận lại dù bước ghi lỗi.
    dropChallenge();

    // Kiểm lại ngay trước khi ghi (dữ liệu mới nhất): email có thể đã bị TK khác
    // chiếm, hoặc danh bạ nhân sự đã đổi trong lúc chờ OTP.
    const users = await assertNotTaken(user, challenge.field, challenge.value);
    await assertNoHrConflict(user, challenge.value, users, { forceRefresh: true });
    // Chỉ ghi app_users; KHÔNG đụng hr_employees (TK thường không gắn nhân sự).
    return store.updateUser(user.id, {
      email: challenge.value,
      verifiedEmail: true
    });
  }

  async function adminChange(user, field, rawValue) {
    if (!user || !user.hrManaged) {
      throw new ContactChangeError('Tài khoản không được quản lý bởi danh sách nhân sự.', 'HR_ACCOUNT_REQUIRED', 409);
    }
    const value = normalize(field, rawValue);
    await assertNotTaken(user, field, value);
    const employee = await findCurrentEmployee(user);
    // Ghi hr_employees trước: lỗi ở đây thì app_users giữ nguyên.
    await directory.updateEmployeeContact(employee, field, value);
    // Giá trị do Quản lý gõ, chủ TK chưa xác minh -> cờ xác minh = false.
    // TK hrManaged đã gắn không phụ thuộc cờ này (resolver bỏ qua kiểm xác minh).
    const changes = field === 'email'
      ? { email: value, verifiedEmail: false }
      : { soDienThoai: value, verifiedPhone: false };
    return store.updateUser(user.id, changes);
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
