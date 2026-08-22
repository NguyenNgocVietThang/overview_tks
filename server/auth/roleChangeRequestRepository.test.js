'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const repo = require('./roleChangeRequestRepository');

const testDbPath = path.join(os.tmpdir(), `test-role-requests-${Date.now()}.json`);
repo.initStore(testDbPath);

test.after(() => {
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (e) {}
  }
});

test('createRequest tạo yêu cầu ở trạng thái Chờ duyệt', async () => {
  repo.setInMemoryRequests([]);
  const req = await repo.createRequest({
    userId: 'u1', username: 'nva', hoTen: 'Nguyễn Văn A',
    currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'Muốn học kế toán'
  });
  assert.ok(req.id);
  assert.equal(req.status, repo.ROLE_REQUEST_STATUS.PENDING);
  assert.equal(req.reviewedBy, null);
});

test('hasPendingRequest phát hiện đúng yêu cầu đang chờ duyệt', async () => {
  repo.setInMemoryRequests([]);
  assert.equal(await repo.hasPendingRequest('u1'), false);
  await repo.createRequest({ userId: 'u1', username: 'nva', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  assert.equal(await repo.hasPendingRequest('u1'), true);
  assert.equal(await repo.hasPendingRequest('u2'), false);
});

test('listRequests lọc theo status và userId', async () => {
  repo.setInMemoryRequests([]);
  await repo.createRequest({ userId: 'u1', username: 'a', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  await repo.createRequest({ userId: 'u2', username: 'b', hoTen: 'B', currentRole: 'Lái xe', requestedRole: 'Trưởng kho', reason: 'y' });

  const all = await repo.listRequests();
  assert.equal(all.length, 2);

  const onlyU1 = await repo.listRequests({ userId: 'u1' });
  assert.equal(onlyU1.length, 1);
  assert.equal(onlyU1[0].userId, 'u1');

  const onlyPending = await repo.listRequests({ status: repo.ROLE_REQUEST_STATUS.PENDING });
  assert.equal(onlyPending.length, 2);
});

test('updateRequestStatus cập nhật trạng thái + người duyệt', async () => {
  repo.setInMemoryRequests([]);
  const created = await repo.createRequest({ userId: 'u1', username: 'a', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  const updated = await repo.updateRequestStatus(created.id, {
    status: repo.ROLE_REQUEST_STATUS.APPROVED,
    reviewedBy: 'Quản trị viên',
    reviewedByUserId: 'admin-1',
    reviewNote: 'Đồng ý'
  });
  assert.equal(updated.status, repo.ROLE_REQUEST_STATUS.APPROVED);
  assert.equal(updated.reviewedBy, 'Quản trị viên');
  assert.equal(updated.reviewNote, 'Đồng ý');
});

test('updateRequestStatus ném lỗi 409 nếu yêu cầu đã được xử lý', async () => {
  repo.setInMemoryRequests([]);
  const created = await repo.createRequest({ userId: 'u1', username: 'a', hoTen: 'A', currentRole: 'Trợ lý', requestedRole: 'Kế toán', reason: 'x' });
  await repo.updateRequestStatus(created.id, { status: repo.ROLE_REQUEST_STATUS.APPROVED, reviewedBy: 'X', reviewedByUserId: 'y' });
  await assert.rejects(
    () => repo.updateRequestStatus(created.id, { status: repo.ROLE_REQUEST_STATUS.REJECTED, reviewedBy: 'X', reviewedByUserId: 'y' }),
    (err) => { assert.equal(err.statusCode, 409); return true; }
  );
});

test('updateRequestStatus ném lỗi 404 nếu không tìm thấy', async () => {
  repo.setInMemoryRequests([]);
  await assert.rejects(
    () => repo.updateRequestStatus('khong-ton-tai', { status: repo.ROLE_REQUEST_STATUS.APPROVED, reviewedBy: 'X', reviewedByUserId: 'y' }),
    (err) => { assert.equal(err.statusCode, 404); return true; }
  );
});
