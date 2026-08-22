// ==========================================
// ROLE CHANGE REQUEST REPOSITORY — Lưu trữ yêu cầu đổi vai trò tự thân của
// người dùng tại server/data/roleChangeRequests.json. Quản lý duyệt/từ chối
// qua PATCH /api/role-requests/:id/status (xem roleChangeRequestRoutes.js).
// ==========================================
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'roleChangeRequests.json');

const ROLE_REQUEST_STATUS = Object.freeze({
  PENDING: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối'
});

let currentStorePath = DEFAULT_STORE_PATH;
let inMemoryRequests = null;
let isInitialized = false;
let lastLoadedMtime = 0;

function ensureDataDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadFromDisk() {
  ensureDataDir(currentStorePath);
  if (fs.existsSync(currentStorePath)) {
    try {
      const stats = fs.statSync(currentStorePath);
      const raw = fs.readFileSync(currentStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        inMemoryRequests = parsed;
        lastLoadedMtime = stats.mtimeMs;
        return inMemoryRequests;
      }
    } catch (err) {
      console.error('Lỗi khi đọc file roleChangeRequests.json, khởi tạo lại bộ nhớ:', err.message);
    }
  }
  inMemoryRequests = [];
  saveToDisk(inMemoryRequests);
  return inMemoryRequests;
}

function saveToDisk(requests) {
  ensureDataDir(currentStorePath);
  const tempPath = `${currentStorePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(requests, null, 2), 'utf8');
  fs.renameSync(tempPath, currentStorePath);
  try {
    lastLoadedMtime = fs.statSync(currentStorePath).mtimeMs;
  } catch (e) {}
}

function initStore(customPath) {
  if (customPath) {
    currentStorePath = customPath;
  }
  loadFromDisk();
  isInitialized = true;
}

function ensureLoaded() {
  if (!isInitialized || !inMemoryRequests) {
    initStore();
    return inMemoryRequests;
  }
  try {
    if (fs.existsSync(currentStorePath)) {
      const currentMtime = fs.statSync(currentStorePath).mtimeMs;
      if (currentMtime > lastLoadedMtime) {
        loadFromDisk();
      }
    }
  } catch (e) {}
  return inMemoryRequests;
}

async function createRequest({ userId, username, hoTen, currentRole, requestedRole, reason }) {
  const requests = ensureLoaded();
  const now = new Date().toISOString();
  const request = {
    id: crypto.randomUUID(),
    userId: String(userId),
    username: username || '',
    hoTen: hoTen || '',
    currentRole,
    requestedRole,
    reason: reason || '',
    status: ROLE_REQUEST_STATUS.PENDING,
    reviewedBy: null,
    reviewedByUserId: null,
    reviewNote: '',
    createdAt: now,
    updatedAt: now
  };
  requests.push(request);
  saveToDisk(requests);
  return { ...request };
}

async function hasPendingRequest(userId) {
  const requests = ensureLoaded();
  const target = String(userId);
  return requests.some(r => r.userId === target && r.status === ROLE_REQUEST_STATUS.PENDING);
}

async function listRequests({ status, userId } = {}) {
  const requests = ensureLoaded();
  return requests
    .filter(r => (!status || r.status === status) && (!userId || r.userId === String(userId)))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(r => ({ ...r }));
}

async function getRequestById(id) {
  const requests = ensureLoaded();
  const found = requests.find(r => String(r.id) === String(id));
  return found ? { ...found } : null;
}

async function updateRequestStatus(id, { status, reviewedBy, reviewedByUserId, reviewNote }) {
  const requests = ensureLoaded();
  const index = requests.findIndex(r => String(r.id) === String(id));
  if (index < 0) {
    const err = new Error('Không tìm thấy yêu cầu đổi vai trò.');
    err.statusCode = 404;
    err.code = 'ROLE_REQUEST_NOT_FOUND';
    throw err;
  }
  const current = requests[index];
  if (current.status !== ROLE_REQUEST_STATUS.PENDING) {
    const err = new Error('Yêu cầu này đã được xử lý trước đó.');
    err.statusCode = 409;
    err.code = 'ROLE_REQUEST_ALREADY_HANDLED';
    throw err;
  }
  const updated = {
    ...current,
    status,
    reviewedBy: reviewedBy || null,
    reviewedByUserId: reviewedByUserId ? String(reviewedByUserId) : null,
    reviewNote: reviewNote || '',
    updatedAt: new Date().toISOString()
  };
  requests[index] = updated;
  saveToDisk(requests);
  return { ...updated };
}

function setInMemoryRequests(requests) {
  if (currentStorePath === DEFAULT_STORE_PATH) {
    // Test quen goi initStore(tempPath) truoc setInMemoryRequests se khong bi anh
    // huong (currentStorePath da doi). Neu ai quen initStore, tu dong chuyen sang file
    // tam de KHONG BAO GIO ghi de du lieu that trong server/data/roleChangeRequests.json.
    currentStorePath = path.join(os.tmpdir(), `role-requests-safety-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  }
  inMemoryRequests = requests.map(r => ({ ...r }));
  isInitialized = true;
  lastLoadedMtime = Infinity;
}

module.exports = {
  ROLE_REQUEST_STATUS,
  initStore,
  createRequest,
  hasPendingRequest,
  listRequests,
  getRequestById,
  updateRequestStatus,
  setInMemoryRequests
};
