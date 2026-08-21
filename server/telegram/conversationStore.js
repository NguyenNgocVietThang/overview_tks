// ==========================================
// TELEGRAM CONVERSATION STORE — luu tien trinh hoi thoai xin nghi phep xuong
// server/data/telegram_conversations.json de song sot qua restart server
// (truoc day chi luu trong Map o RAM, mat trang thai giua chung moi khi
// server restart khien bot im lang khong tra loi nua — xem hrTelegramBot.js).
// Cung mo hinh atomic write nhu localUserStore.js.
// ==========================================
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_STORE_PATH = path.join(DATA_DIR, 'telegram_conversations.json');

// Phien qua han sau ngan nay coi nhu nguoi dung da bo do giua chung.
const EXPIRE_MS = 60 * 60 * 1000; // 60 phut

let currentStorePath = DEFAULT_STORE_PATH;
let cache = null;

function ensureDataDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Cac field kieu Date bi JSON.stringify thanh chuoi ISO khi ghi xuong dia —
// can hoi phuc lai thanh Date khi doc len de cac ham nhu formatDateTime,
// computeIsUrgent... hoat dong dung.
function reviveDates(conv) {
  if (conv && conv.data) {
    if (typeof conv.data.start === 'string') conv.data.start = new Date(conv.data.start);
    if (typeof conv.data.end === 'string') conv.data.end = new Date(conv.data.end);
  }
  return conv;
}

function load() {
  if (cache) return cache;
  ensureDataDir(currentStorePath);
  if (fs.existsSync(currentStorePath)) {
    try {
      const raw = fs.readFileSync(currentStorePath, 'utf8');
      const parsed = JSON.parse(raw);
      cache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
    } catch (err) {
      console.error('[Telegram Conversation Store] Lỗi đọc file, khởi tạo lại:', err.message);
      cache = {};
    }
  } else {
    cache = {};
  }
  return cache;
}

function persist() {
  ensureDataDir(currentStorePath);
  const tempPath = `${currentStorePath}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tempPath, currentStorePath);
}

/**
 * Doi duong dan file luu tru (dung cho test). Xoa sach cache RAM.
 */
function initStore(customPath) {
  currentStorePath = customPath || DEFAULT_STORE_PATH;
  cache = null;
}

function getConversation(chatId) {
  const all = load();
  const entry = all[String(chatId)];
  if (!entry) return null;
  if (Date.now() - (entry.updatedAt || 0) > EXPIRE_MS) {
    deleteConversation(chatId);
    return null;
  }
  // Tra ve ban sao doc lap voi cache — sua doi conv o noi goi phai di kem
  // setConversation() moi duoc ghi lai xuong dia.
  return reviveDates(JSON.parse(JSON.stringify(entry.conv)));
}

function setConversation(chatId, conv) {
  const all = load();
  all[String(chatId)] = { conv, updatedAt: Date.now() };
  persist();
}

function deleteConversation(chatId) {
  const all = load();
  if (all[String(chatId)]) {
    delete all[String(chatId)];
    persist();
  }
}

module.exports = {
  initStore,
  getConversation,
  setConversation,
  deleteConversation,
  EXPIRE_MS
};
