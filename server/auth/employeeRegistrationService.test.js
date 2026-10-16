'use strict';

process.env.GOOGLE_SERVICE_ACCOUNT_JSON = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '{}';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const employeeRegistrationService = require('./employeeRegistrationService');
const { createEmployeeRegistrationService } = employeeRegistrationService;

const employee = {
  sourceBranch: 'Hà Nội', rowIndex: 2, hoTen: 'Nhân viên A', boPhan: 'KẾ TOÁN',
  email: 'a@example.com', soDienThoai: '0912345678', telegramId: '123456',
  sheetVaiTro: 'Kế toán', sheetCoSo: 'Cả hai'
};

function makeService(overrides = {}) {
  const users = [];
  const store = {
    createUser: async data => { const user = { id: 'u1', ...data }; users.push(user); return { ...user }; },
    updateUser: async (id, data) => {
      const index = users.findIndex(user => user.id === id);
      users[index] = { ...users[index], ...data };
      return { ...users[index] };
    }
  };
  const service = createEmployeeRegistrationService({
    directory: { getSnapshot: async () => ({ employees: [employee] }) },
    findEmployeeByIdentifier: (_, identifier) => (
      String(identifier).includes('@') || String(identifier).replace(/\D/g, '').endsWith('912345678') ? employee : null
    ),
    resolver: {
      findAccountForEmployee: async () => users[0] || null,
      resolveUser: async user => ({ ...user, vaiTro: 'Kế toán', coSo: 'Cả hai', hrManaged: true })
    },
    store,
    randomUUID: () => 'uuid-1',
    ...overrides
  });
  return { service, users };
}

test('luong dang ky nhan su bang OTP da go: service chi con linkVerifiedGoogleIdentity', () => {
  assert.equal(employeeRegistrationService.createChallenge, undefined);
  assert.equal(employeeRegistrationService.sendOtp, undefined);
  assert.equal(employeeRegistrationService.verifyAndRegister, undefined);
  assert.deepEqual(Object.keys(makeService().service), ['linkVerifiedGoogleIdentity']);
});

test('TK CHUA GAN chi khop qua SĐT (username = SĐT nhan su) -> 409 HR_IDENTITY_CONFLICT, khong ghi gi', async () => {
  // Ke co quyen tao TK dung san TK chua gan co username/SĐT = dinh danh nhan su,
  // cho nhan su that dang nhap Google de TK gia duoc gan + nang quyen.
  let creates = 0;
  let updates = 0;
  const { service, users } = makeService();
  const fake = { id: 'old', username: '0912345678', soDienThoai: '0912345678', vaiTro: 'Khách' };
  users.push(fake);
  const store = {
    createUser: async () => { creates += 1; throw new Error('khong duoc tao TK'); },
    updateUser: async () => { updates += 1; throw new Error('khong duoc ghi'); }
  };
  const guarded = createEmployeeRegistrationService({
    directory: { getSnapshot: async () => ({ employees: [employee] }) },
    findEmployeeByIdentifier: () => employee,
    resolver: { findAccountForEmployee: async () => users[0], resolveUser: async u => u },
    store
  });
  for (const allowCreate of [true, false]) {
    await assert.rejects(
      guarded.linkVerifiedGoogleIdentity({ email: 'A@EXAMPLE.COM', hoTen: 'Google Name', allowCreate }),
      err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409 && /Quản lý/.test(err.message)
    );
  }
  assert.equal(creates, 0);
  assert.equal(updates, 0);
  assert.deepEqual(users[0], fake);
  // service mac dinh (store gia) cung tu choi
  await assert.rejects(
    service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' }),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(users[0].email, undefined);
  assert.equal(users[0].verifiedEmail, undefined);
});

test('TK CHUA GAN co email KHAC email Google (chi trung SĐT) -> 409, khong ghi de email', async () => {
  const { service, users } = makeService();
  users.push({ id: 'old', username: 'nguoikhac@example.com', email: 'nguoikhac@example.com', soDienThoai: '0912345678', vaiTro: 'Khách' });
  await assert.rejects(
    service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' }),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(users[0].email, 'nguoikhac@example.com');
  assert.equal(users[0].verifiedEmail, undefined);
});

test('TK CHUA GAN khop theo EMAIL (email hoac username co @, khong phan biet hoa/thuong, khoang trang) -> lien ket', async () => {
  for (const account of [
    { id: 'old', username: 'nva', email: ' A@Example.COM ', vaiTro: 'Khách' },
    { id: 'old', username: ' A@EXAMPLE.com ', vaiTro: 'Khách' },
    { id: 'old', username: 'a@example.com', email: '', soDienThoai: '0912345678', vaiTro: 'Khách' }
  ]) {
    const { service, users } = makeService();
    users.push({ ...account });
    const linked = await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G', allowCreate: false });
    assert.equal(linked.id, 'old', JSON.stringify(account));
    assert.equal(linked.email, 'a@example.com');
    assert.equal(linked.verifiedEmail, true);
    assert.equal(users.length, 1);
  }
});

test('TK DA GAN DUNG dong nhan su nhung chi khop qua SĐT -> van lien ket nhu cu', async () => {
  const { service, users } = makeService();
  users.push({ id: 'old', username: '0912345678', soDienThoai: '0912345678', email: 'cu@example.com', hrManaged: true, hrRowIndex: 2, vaiTro: 'Kế toán' });
  const linked = await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' });
  assert.equal(linked.id, 'old');
  assert.equal(linked.email, 'a@example.com');
  assert.equal(linked.verifiedEmail, true);
});

test('allowCreate=true: Google tao tai khoan moi cho nhan su HR chua co tai khoan', async () => {
  const { service, users } = makeService();
  const user = await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' });
  assert.equal(users.length, 1);
  assert.equal(user.id, 'uuid-1');
  assert.equal(user.passwordHash, '');
  assert.equal(user.verifiedEmail, true);
});

test('allowCreate=false: Google chi lien ket tai khoan DA CO, khong tao tai khoan moi cho nhan su HR', async () => {
  const { service, users } = makeService();
  assert.equal(await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G', allowCreate: false }), null);
  assert.equal(users.length, 0);

  users.push({ id: 'old', username: 'a@example.com', email: 'a@example.com', vaiTro: 'Khách' });
  const linked = await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G', allowCreate: false });
  assert.equal(linked.id, 'old');
  assert.equal(users.length, 1);
});

test('TK tim duoc da gan dong nhan su KHAC -> 409 HR_IDENTITY_CONFLICT, khong ghi de email/SĐT', async () => {
  const { service, users } = makeService();
  users.push({
    id: 'other', username: 'a@example.com', email: 'a@example.com', soDienThoai: '0900000000',
    hrManaged: true, hrRowIndex: 99, vaiTro: 'Quản lý'
  });
  await assert.rejects(
    service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' }),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(users[0].soDienThoai, '0900000000');
  assert.equal(users[0].verifiedEmail, undefined);
});

test('TK tim duoc da gan DUNG dong nhan su (hoac hrManaged cu chua co hrRowIndex) -> lien ket binh thuong', async () => {
  for (const hrRowIndex of [2, '2', '']) {
    const { service, users } = makeService();
    users.push({ id: 'old', username: 'a@example.com', email: 'a@example.com', hrManaged: true, hrRowIndex });
    const linked = await service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' });
    assert.equal(linked.id, 'old', `hrRowIndex=${hrRowIndex}`);
    assert.equal(linked.verifiedEmail, true);
  }
});

test('voi resolver that: TK duy nhat trung email nhung gan dong khac -> 409, khong dang nhap vao TK do', async () => {
  const { createEffectiveUserResolver } = require('./effectiveUserResolver');
  const state = [{
    id: 'V', username: 'a@example.com', email: 'a@example.com', soDienThoai: '0900000000',
    verifiedEmail: true, hrManaged: true, hrRowIndex: 77, vaiTro: 'Quản lý', coSo: 'Cả hai',
    trangThai: 'Đang hoạt động'
  }];
  let writes = 0;
  const store = {
    getAllUsers: async () => state.map(user => ({ ...user })),
    createUser: async () => { throw new Error('khong duoc tao TK'); },
    updateUser: async () => { writes += 1; throw new Error('khong duoc ghi'); }
  };
  const directory = { getSnapshot: async () => ({ employees: [employee] }) };
  const service = createEmployeeRegistrationService({
    directory,
    findEmployeeByIdentifier: () => employee,
    resolver: createEffectiveUserResolver({ store, directory }),
    store
  });
  await assert.rejects(
    service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G' }),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(writes, 0);
  assert.equal(state[0].soDienThoai, '0900000000');
});

function makeRealResolverService(state) {
  const { createEffectiveUserResolver } = require('./effectiveUserResolver');
  let writes = 0;
  const store = {
    getAllUsers: async () => state.map(user => ({ ...user })),
    createUser: async () => { writes += 1; throw new Error('khong duoc tao TK'); },
    updateUser: async (id, data) => {
      writes += 1;
      const index = state.findIndex(user => user.id === id);
      state[index] = { ...state[index], ...data };
      return { ...state[index] };
    }
  };
  const directory = { getSnapshot: async () => ({ employees: [employee] }) };
  const service = createEmployeeRegistrationService({
    directory,
    findEmployeeByIdentifier: () => employee,
    resolver: createEffectiveUserResolver({ store, directory }),
    store
  });
  return { service, writes: () => writes };
}

test('voi resolver that: TK gia CHUA GAN co username/SĐT = SĐT nhan su -> 409, khong ghi, khong nang quyen', async () => {
  const state = [{
    id: 'FAKE', username: '0912345678', soDienThoai: '0912345678', passwordHash: 'x',
    vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }];
  const { service, writes } = makeRealResolverService(state);
  await assert.rejects(
    service.linkVerifiedGoogleIdentity({ email: 'a@example.com', hoTen: 'G', allowCreate: false }),
    err => err.code === 'HR_IDENTITY_CONFLICT' && err.statusCode === 409
  );
  assert.equal(writes(), 0);
  assert.equal(state[0].vaiTro, 'Khách');
  assert.equal(state[0].hrManaged, undefined);
});

test('voi resolver that: Quan ly tao san TK bang email nhan su -> nhan su dang nhap Google lien ket duoc', async () => {
  const state = [{
    id: 'PRE', username: 'a@example.com', email: 'a@example.com', passwordHash: '',
    vaiTro: 'Khách', coSo: '', trangThai: 'Đang hoạt động'
  }];
  const { service } = makeRealResolverService(state);
  const linked = await service.linkVerifiedGoogleIdentity({ email: 'A@example.com', hoTen: 'G', allowCreate: false });
  assert.equal(linked.id, 'PRE');
  assert.equal(linked.verifiedEmail, true);
  assert.equal(linked.hrManaged, true);
  assert.equal(linked.hrRowIndex, 2);
  assert.equal(linked.vaiTro, 'Kế toán');
});

test('email khong thuoc nhan su HR -> null (de route di tiep luong Khach)', async () => {
  const { service } = makeService({ findEmployeeByIdentifier: () => null });
  assert.equal(await service.linkVerifiedGoogleIdentity({ email: 'guest@example.com' }), null);
});
