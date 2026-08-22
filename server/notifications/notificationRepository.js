// ==========================================
// NOTIFICATION REPOSITORY — Lưu trữ thông báo chuông cho mọi tài khoản tại
// server/data/notifications.json. Dùng chung cho MỌI loại thông báo trong hệ
// thống (hiện tại: yêu cầu đổi vai trò) — thêm loại mới bằng cách truyền
// `type` khác khi gọi createNotification(), không cần đổi schema.
// ==========================================
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'notifications.json');

let currentStorePath = DEFAULT_STORE_PATH;
let inMemoryNotifications = null;
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
        inMemoryNotifications = parsed;
        lastLoadedMtime = stats.mtimeMs;
        return inMemoryNotifications;
      }
    } catch (err) {
      console.error('Lỗi khi đọc file notifications.json, khởi tạo lại bộ nhớ:', err.message);
    }
  }
  inMemoryNotifications = [];
  saveToDisk(inMemoryNotifications);
  return inMemoryNotifications;
}

function saveToDisk(notifications) {
  ensureDataDir(currentStorePath);
  const tempPath = `${currentStorePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(notifications, null, 2), 'utf8');
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
  if (!isInitialized || !inMemoryNotifications) {
    initStore();
    return inMemoryNotifications;
  }
  try {
    if (fs.existsSync(currentStorePath)) {
      const currentMtime = fs.statSync(currentStorePath).mtimeMs;
      if (currentMtime > lastLoadedMtime) {
        loadFromDisk();
      }
    }
  } catch (e) {}
  return inMemoryNotifications;
}

/**
 * Tạo 1 thông báo mới cho 1 người nhận.
 */
async function createNotification({ recipientUserId, type, title, message, relatedType, relatedId }) {
  if (!recipientUserId) throw new Error('Thiếu recipientUserId khi tạo thông báo.');
  if (!type) throw new Error('Thiếu type khi tạo thông báo.');
  const notifications = ensureLoaded();
  const notification = {
    id: crypto.randomUUID(),
    recipientUserId: String(recipientUserId),
    type,
    title: title || '',
    message: message || '',
    relatedType: relatedType || null,
    relatedId: relatedId || null,
    isRead: false,
    createdAt: new Date().toISOString()
  };
  notifications.push(notification);
  saveToDisk(notifications);
  return { ...notification };
}

/**
 * Tạo cùng 1 thông báo cho nhiều người nhận (vd: toàn bộ Quản lý).
 */
async function createNotificationForUsers(recipientUserIds, payload) {
  const created = [];
  for (const recipientUserId of recipientUserIds) {
    created.push(await createNotification({ ...payload, recipientUserId }));
  }
  return created;
}

async function listForUser(userId, { unreadOnly } = {}) {
  const notifications = ensureLoaded();
  const target = String(userId);
  return notifications
    .filter(n => n.recipientUserId === target && (!unreadOnly || !n.isRead))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(n => ({ ...n }));
}

async function getUnreadCount(userId) {
  const notifications = ensureLoaded();
  const target = String(userId);
  return notifications.filter(n => n.recipientUserId === target && !n.isRead).length;
}

async function markRead(id, userId) {
  const notifications = ensureLoaded();
  const target = String(userId);
  const index = notifications.findIndex(n => String(n.id) === String(id) && n.recipientUserId === target);
  if (index < 0) return null;
  notifications[index] = { ...notifications[index], isRead: true };
  saveToDisk(notifications);
  return { ...notifications[index] };
}

async function markAllRead(userId) {
  const notifications = ensureLoaded();
  const target = String(userId);
  let changed = 0;
  const updated = notifications.map(n => {
    if (n.recipientUserId === target && !n.isRead) {
      changed++;
      return { ...n, isRead: true };
    }
    return n;
  });
  if (changed > 0) {
    inMemoryNotifications = updated;
    saveToDisk(updated);
  }
  return changed;
}

function setInMemoryNotifications(notifications) {
  inMemoryNotifications = notifications.map(n => ({ ...n }));
  isInitialized = true;
  lastLoadedMtime = Infinity;
}

module.exports = {
  initStore,
  createNotification,
  createNotificationForUsers,
  listForUser,
  getUnreadCount,
  markRead,
  markAllRead,
  setInMemoryNotifications
};
