'use strict';

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createContactChangeService } = require('./contactChangeService');
const { findEmployeeByIdentifier: realFindEmployeeByIdentifier } = require('../hr/employeeDirectory');

const hrEmployee = {
  sourceBranch: 'Hà Nội', rowIndex: 7, email: 'hr@example.com', soDienThoai: '0912345678'
};

function fixture({ writeFails = false, otpValid = true, employees = [hrEmployee], extraUsers = [], otpDelay = false } = {}) {
  const events = [];
  const otpKeys = [];
  const clock = { now: Date.UTC(2026, 9, 5, 3, 0, 0) };
  let uuidSeq = 0;
  const users = [
    { id: 'g1', username: 'guest@example.com', email: 'guest@example.com', soDienThoai: '', vaiTro: 'Khách' },
    {
      id: 'h1', username: 'hr@example.com', email: 'hr@example.com', soDienThoai: '0912345678',
      hrManaged: true, hrSourceBranch: 'Hà Nội', hrRowIndex: 7
    },
    { id: 'o1', username: 'other@example.com', email: 'other@example.com', soDienThoai: '0987654321' },
    ...extraUsers
  ];
  const directory = {
    employees,
    getSnapshot: async () => { events.push('snapshot'); return { employees: directory.employees }; },
    updateEmployeeContact: async (current, field, value) => {
      events.push(`directory:${current.rowIndex}:${field}:${value}`);
      if (writeFails) throw new Error('directory failed');
      return { ...current, [field === 'email' ? 'email' : 'soDienThoai']: value };
    }
  };
  const service = createContactChangeService({
    directory,
    findEmployeeByIdentifier: realFindEmployeeByIdentifier,
    now: () => clock.now,
    store: {
      getAllUsers: async () => users.map(user => ({ ...user })),
      updateUser: async (id, changes) => {
        events.push(`local:${Object.keys(changes).join(',')}`);
        const index = users.findIndex(user => user.id === id);
        users[index] = { ...users[index], ...changes };
        return { ...users[index] };
      }
    },
    otp: {
      OTP_TTL_MS: 5 * 60 * 1000,
      maskEmail: value => `masked:${value}`,
      generateResetOtp: async (key, target, channel) => {
        otpKeys.push({ key, target, channel });
        if (otpDelay) await new Promise(resolve => setTimeout(resolve, 5));
        return { success: true, expiresInSeconds: 300 };
      },
      verifyResetOtp: () => (otpValid ? { valid: true } : { valid: false, error: 'Mã OTP không chính xác.' }),
      clearResetOtp: key => events.push(`clear:${key}`)
    },
    randomUUID: () => (++uuidSeq === 1 ? 'change-1' : `change-${uuidSeq}`)
  });
  const byId = id => users.find(user => user.id === id);
  return { service, users, byId, events, otpKeys, clock, directory };
}

test('beginChange cho TK thường gửi OTP tới email MỚI', async () => {
  const { service, byId, otpKeys } = fixture();
  const result = await service.beginChange(byId('g1'), 'email', 'NEW@EXAMPLE.COM');
  assert.deepEqual(result, {
    challengeId: 'change-1', field: 'email', targetMasked: 'masked:new@example.com', expiresInSeconds: 300
  });
  assert.equal(otpKeys.length, 1);
  assert.equal(otpKeys[0].target, 'new@example.com');
  assert.equal(otpKeys[0].channel, 'email');
});

test('TK Khách: beginChange -> confirmChange đổi email, verifiedEmail true, không đụng danh bạ nhân sự', async () => {
  const { service, byId, events } = fixture();
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  const updated = await service.confirmChange(byId('g1'), 'change-1', '123456');
  assert.equal(updated.email, 'new@example.com');
  assert.equal(updated.verifiedEmail, true);
  assert.equal(byId('g1').email, 'new@example.com');
  // Danh bạ chỉ được ĐỌC (kiểm xung đột nhân sự), không ghi.
  assert.ok(!events.some(e => e.startsWith('directory:')), 'không ghi danh bạ nhân sự');
  assert.ok(events.includes('local:email,verifiedEmail'));
});

test('challenge dùng xong bị xóa: xác nhận lần 2 báo hết hạn', async () => {
  const { service, byId } = fixture();
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  await service.confirmChange(byId('g1'), 'change-1', '123456');
  await assert.rejects(
    service.confirmChange(byId('g1'), 'change-1', '123456'),
    err => err.code === 'CONTACT_CHALLENGE_EXPIRED'
  );
});

test('TK nhân sự (hrManaged) beginChange -> 403 EMAIL_CHANGE_LOCKED, không gửi OTP', async () => {
  const { service, byId, otpKeys } = fixture();
  await assert.rejects(
    service.beginChange(byId('h1'), 'email', 'new@example.com'),
    err => err.code === 'EMAIL_CHANGE_LOCKED' && err.statusCode === 403
  );
  assert.equal(otpKeys.length, 0);
});

test('confirmChange kiểm lại: TK đã thành hrManaged sau khi bắt đầu -> 403, email không đổi', async () => {
  const { service, byId } = fixture();
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  await assert.rejects(
    service.confirmChange({ ...byId('g1'), hrManaged: true }, 'change-1', '123456'),
    err => err.code === 'EMAIL_CHANGE_LOCKED' && err.statusCode === 403
  );
  assert.equal(byId('g1').email, 'guest@example.com');
});

test('OTP sai -> INVALID_OTP, email không đổi', async () => {
  const { service, byId } = fixture({ otpValid: false });
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  await assert.rejects(
    service.confirmChange(byId('g1'), 'change-1', '000000'),
    err => err.code === 'INVALID_OTP'
  );
  assert.equal(byId('g1').email, 'guest@example.com');
});

test('challenge của user khác -> hết hạn', async () => {
  const { service, byId } = fixture();
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  await assert.rejects(
    service.confirmChange(byId('o1'), 'change-1', '123456'),
    err => err.code === 'CONTACT_CHALLENGE_EXPIRED'
  );
  assert.equal(byId('o1').email, 'other@example.com');
  assert.equal(byId('g1').email, 'guest@example.com');
});

test('beginChange từ chối email trùng email/username của TK khác', async () => {
  const { service, byId } = fixture();
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'other@example.com'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
});

test('beginChange từ chối email trùng email hiện tại', async () => {
  const { service, byId } = fixture();
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'Guest@Example.com'),
    err => err.code === 'CONTACT_UNCHANGED'
  );
});

test('beginChange không cho tự đổi SĐT (chỉ Quản lý)', async () => {
  const { service, byId } = fixture();
  await assert.rejects(
    service.beginChange(byId('g1'), 'phone', '0911111111'),
    err => err.code === 'PHONE_CHANGE_LOCKED' && err.statusCode === 403
  );
});

test('confirmChange kiểm trùng lại ngay trước khi ghi (email bị TK khác chiếm giữa chừng) -> 409', async () => {
  const { service, byId, users } = fixture();
  await service.beginChange(byId('g1'), 'email', 'new@example.com');
  users.push({ id: 'late', username: 'late', email: 'new@example.com' });
  await assert.rejects(
    service.confirmChange(byId('g1'), 'change-1', '123456'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.equal(byId('g1').email, 'guest@example.com');
});

test('adminChange email cho TK nhân sự ghi danh bạ trước rồi app_users', async () => {
  const { service, byId, events } = fixture();
  const updated = await service.adminChange(byId('h1'), 'email', 'admin-change@example.com');
  assert.deepEqual(events.filter(e => !e.startsWith('snapshot')), [
    'directory:7:email:admin-change@example.com', 'local:email,verifiedEmail'
  ]);
  assert.equal(updated.email, 'admin-change@example.com');
  // Giá trị do Quản lý gõ, chủ TK chưa xác minh -> không đánh dấu đã xác minh.
  assert.equal(updated.verifiedEmail, false);
});

test('adminChange phone cho TK nhân sự cập nhật SĐT ở danh bạ + app_users (không đụng email)', async () => {
  const { service, byId, events } = fixture();
  const updated = await service.adminChange(byId('h1'), 'phone', '+84 911 222 333');
  assert.deepEqual(events.filter(e => !e.startsWith('snapshot')), [
    'directory:7:phone:0911222333', 'local:soDienThoai,verifiedPhone'
  ]);
  assert.equal(updated.soDienThoai, '0911222333');
  assert.equal(updated.verifiedPhone, false);
  assert.equal(updated.email, 'hr@example.com');
});

test('TK nhân sự đã gắn sau adminChange (cờ xác minh = false) vẫn được resolver giữ vai trò theo dòng nhân sự', async () => {
  const { createEffectiveUserResolver } = require('./effectiveUserResolver');
  const hrEmployee = {
    sourceBranch: 'Hà Nội', rowIndex: 7, hoTen: 'NV', email: 'admin-change@example.com',
    soDienThoai: '0911222333', sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
  };
  const account = {
    id: 'h1', username: 'hr@example.com', email: 'admin-change@example.com', soDienThoai: '0911222333',
    verifiedEmail: false, verifiedPhone: false, hrManaged: true, hrRowIndex: 7, hrSourceBranch: 'Hà Nội',
    vaiTro: 'Kế toán', coSo: 'Cả hai', trangThai: 'Đang hoạt động'
  };
  const store = {
    getAllUsers: async () => [{ ...account }],
    updateUser: async (id, data) => ({ ...account, ...data })
  };
  const resolver = createEffectiveUserResolver({ store, directory: { getSnapshot: async () => ({ employees: [hrEmployee] }) } });
  const resolved = await resolver.resolveUser(account);
  assert.equal(resolved.hrVerificationRequired, undefined);
  assert.equal(resolved.hrManaged, true);
  assert.equal(resolved.vaiTro, 'Kế toán');
  assert.equal(resolved.coSo, 'Cả hai');
});

test('adminChange phone trùng SĐT của TK khác -> 409, không ghi gì', async () => {
  const { service, byId, events } = fixture();
  await assert.rejects(
    service.adminChange(byId('h1'), 'phone', '0987654321'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.ok(!events.some(e => e.startsWith('directory:') || e.startsWith('local:')));
});

test('adminChange phone sai định dạng -> 400 INVALID_CONTACT', async () => {
  const { service, byId } = fixture();
  await assert.rejects(
    service.adminChange(byId('h1'), 'phone', '12ab'),
    err => err.code === 'INVALID_CONTACT' && err.statusCode === 400
  );
});

// ---------------------------------------------------------------------------
// F3: chống dò OTP qua nhiều challenge + giới hạn gửi + chống gửi song song
// ---------------------------------------------------------------------------

test('OTP sai lặp qua nhiều challenge: tới ngưỡng thì 429 OTP_TOO_MANY_ATTEMPTS, begin cũng bị chặn tới hết cửa sổ', async () => {
  const { service, byId, otpKeys, clock } = fixture({ otpValid: false });
  const user = byId('g1');
  let lastErr = null;
  let wrong = 0;
  // Mỗi challenge thử 5 lần (otpService xóa ở lần 6) rồi xin mã mới ngay.
  outer: for (let round = 0; round < 5; round++) {
    const { challengeId } = await service.beginChange(user, 'email', 'victim@example.com');
    for (let i = 0; i < 5; i++) {
      try {
        await service.confirmChange(user, challengeId, String(100000 + wrong));
      } catch (err) {
        lastErr = err;
        if (err.code === 'OTP_TOO_MANY_ATTEMPTS') break outer;
        assert.equal(err.code, 'INVALID_OTP');
        wrong++;
      }
    }
    clock.now += 61 * 1000;
  }
  assert.equal(lastErr && lastErr.code, 'OTP_TOO_MANY_ATTEMPTS');
  assert.equal(lastErr.statusCode, 429);
  assert.ok(lastErr.waitSeconds > 0);
  assert.ok(wrong <= 10, `tối đa 10 lần sai, thực tế ${wrong}`);
  const sentBefore = otpKeys.length;

  await assert.rejects(
    service.beginChange(user, 'email', 'victim@example.com'),
    err => err.code === 'OTP_TOO_MANY_ATTEMPTS' && err.statusCode === 429 && err.waitSeconds > 0
  );
  assert.equal(otpKeys.length, sentBefore, 'không gửi thêm OTP khi đang bị chặn');

  clock.now += 61 * 60 * 1000;
  await service.beginChange(user, 'email', 'victim@example.com');
  assert.equal(otpKeys.length, sentBefore + 1);
});

test('giới hạn số lần gửi OTP đổi email theo user: quá ngưỡng -> 429 OTP_SEND_LIMIT, hết cửa sổ thì gửi lại được', async () => {
  const { service, byId, otpKeys, clock } = fixture();
  for (let i = 0; i < 5; i++) {
    await service.beginChange(byId('g1'), 'email', `new${i}@example.com`);
    clock.now += 61 * 1000;
  }
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'new9@example.com'),
    err => err.code === 'OTP_SEND_LIMIT' && err.statusCode === 429 && err.waitSeconds > 0
  );
  assert.equal(otpKeys.length, 5);
  // User khác không bị ảnh hưởng.
  await service.beginChange(byId('o1'), 'email', 'o-new@example.com');
  clock.now += 60 * 60 * 1000;
  await service.beginChange(byId('g1'), 'email', 'new9@example.com');
  assert.equal(otpKeys.length, 7);
});

test('begin song song cùng user: chỉ 1 OTP được gửi, lời gọi còn lại 429', async () => {
  const { service, byId, otpKeys } = fixture({ otpDelay: true });
  const results = await Promise.allSettled([
    service.beginChange(byId('g1'), 'email', 'a1@example.com'),
    service.beginChange(byId('g1'), 'email', 'a2@example.com'),
    service.beginChange(byId('g1'), 'email', 'a3@example.com')
  ]);
  assert.equal(otpKeys.length, 1);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  for (const r of results.filter(item => item.status === 'rejected')) {
    assert.equal(r.reason.statusCode, 429);
  }
  // Xong lượt gửi thì cờ "đang gửi" được nhả (không kẹt vĩnh viễn).
  await service.beginChange(byId('g1'), 'email', 'a4@example.com');
  assert.equal(otpKeys.length, 2);
});

// ---------------------------------------------------------------------------
// F6/F7: kiểm xung đột nhân sự + trùng email khôi phục TRƯỚC khi ghi
// ---------------------------------------------------------------------------

const empA = { sourceBranch: 'Hà Nội', rowIndex: 1, email: 'a@hr.example.com', soDienThoai: '0900000001' };
const empB = { sourceBranch: 'Hà Nội', rowIndex: 2, email: 'b@hr.example.com', soDienThoai: '0900000002' };

test('begin: email mới trỏ nhân sự A còn SĐT trỏ nhân sự B -> 409 HR_IDENTITY_CONFLICT, không gửi OTP', async () => {
  const { service, byId, otpKeys } = fixture({
    employees: [empA, empB],
    extraUsers: [{ id: 'g2', username: '0900000002', email: 'g2@example.com', soDienThoai: '0900000002' }]
  });
  await assert.rejects(
    service.beginChange(byId('g2'), 'email', 'A@HR.example.com'),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(otpKeys.length, 0);
});

test('confirm kiểm lại xung đột nhân sự (danh bạ đổi giữa chừng) -> 409, không ghi', async () => {
  const { service, byId, events, directory } = fixture({
    employees: [empA],
    extraUsers: [{ id: 'g2', username: 'g2@example.com', email: 'g2@example.com', soDienThoai: '0900000002' }]
  });
  const { challengeId } = await service.beginChange(byId('g2'), 'email', 'a@hr.example.com');
  directory.employees = [empA, empB];
  await assert.rejects(
    service.confirmChange(byId('g2'), challengeId, '123456'),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(byId('g2').email, 'g2@example.com');
  assert.ok(!events.some(e => e.startsWith('local:')));
});

test('email mới khớp nhân sự đã gắn TK khác (hrRowIndex) -> 409 USER_EXISTS, không gửi/không ghi', async () => {
  // Danh bạ đã đổi email dòng 7 sang hr-new@ nhưng TK h1 (gắn dòng 7) chưa đồng bộ.
  const moved = { ...hrEmployee, email: 'hr-new@example.com' };
  const { service, byId, otpKeys, events, directory } = fixture({ employees: [moved] });
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'hr-new@example.com'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.equal(otpKeys.length, 0);

  // Kiểm lại ở confirm: lúc begin chưa trùng, lúc confirm dòng đã đổi email.
  directory.employees = [hrEmployee];
  const { challengeId } = await service.beginChange(byId('g1'), 'email', 'hr-new@example.com');
  directory.employees = [moved];
  await assert.rejects(
    service.confirmChange(byId('g1'), challengeId, '123456'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.equal(byId('g1').email, 'guest@example.com');
  assert.ok(!events.some(e => e.startsWith('local:')));
});

test('email mới khớp nhân sự mà SĐT của nhân sự đó thuộc TK khác (chưa gắn) -> 409 USER_EXISTS', async () => {
  const { service, byId, otpKeys } = fixture({
    employees: [empA],
    extraUsers: [{ id: 'p1', username: '0900000001', email: '', soDienThoai: '0900000001' }]
  });
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'a@hr.example.com'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.equal(otpKeys.length, 0);
});

test('email mới trùng email khôi phục của TK khác (chuẩn hóa hoa/thường, khoảng trắng) -> 409 USER_EXISTS', async () => {
  const { service, byId, otpKeys } = fixture({
    extraUsers: [{ id: 'r1', username: 'r1', email: 'r1@example.com', emailKhoiPhuc: '  Recovery@Example.COM ' }]
  });
  await assert.rejects(
    service.beginChange(byId('g1'), 'email', 'recovery@example.com'),
    err => err.code === 'USER_EXISTS' && err.statusCode === 409
  );
  assert.equal(otpKeys.length, 0);
});

test('email mới khớp nhân sự CHƯA có TK nào gắn: vẫn đổi được (resolver sẽ xử lý gắn sau)', async () => {
  const { service, byId } = fixture({ employees: [empA] });
  const { challengeId } = await service.beginChange(byId('g1'), 'email', 'a@hr.example.com');
  const updated = await service.confirmChange(byId('g1'), challengeId, '123456');
  assert.equal(updated.email, 'a@hr.example.com');
});

test('adminChange: lỗi ghi danh bạ thì app_users giữ nguyên', async () => {
  const { service, byId, events } = fixture({ writeFails: true });
  await assert.rejects(service.adminChange(byId('h1'), 'phone', '0911222333'));
  assert.ok(!events.some(e => e.startsWith('local:')));
  assert.equal(byId('h1').soDienThoai, '0912345678');
});
