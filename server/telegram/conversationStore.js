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

// ---- Ban sao du phong tren Google Sheets (chi Render) --------------------
// Dia cuc bo tren Render la ephemeral, mat sach moi khi container
// restart/redeploy (xem localUserStore.js). Neu dieu do xay ra giua luc mot
// nhan vien dang xin nghi phep do dang, cache RAM + file dia cung mat, khien
// bot xu ly tin nhan tiep theo nhu mo dau hoi thoai moi (vd: hoi lai danh
// tinh dang giua chung tra loi Ly do/Ban giao). Cung quy uoc voi
// isTelegramBotRuntimeEnabled/isUsersSheetSyncRuntimeEnabled: mac dinh CHI
// bat tren Render, tranh may local/test ghi de len spreadsheet that.
function isTelegramSessionSheetSyncEnabled(env = process.env) {
  if (env.TELEGRAM_SESSION_SHEET_SYNC_ENABLED != null) {
    return String(env.TELEGRAM_SESSION_SHEET_SYNC_ENABLED).toLowerCase() === 'true';
  }
  return String(env.RENDER).toLowerCase() === 'true';
}

let hrLeaveRepositoryModule = null;
function getHrLeaveRepository() {
  if (!hrLeaveRepositoryModule) hrLeaveRepositoryModule = require('../hr/hrLeaveRepository');
  return hrLeaveRepositoryModule;
}

// Ghi/xoa ban sao tren Sheet chi la best-effort, chay ngam (khong await) —
// KHONG duoc lam cham hoac lam hong luong tra loi Telegram chinh neu Sheets
// API cham/loi.
function mirrorSetToSheet(chatId, conv) {
  if (!isTelegramSessionSheetSyncEnabled()) return;
  getHrLeaveRepository().upsertTelegramSession(chatId, JSON.stringify(conv)).catch(err => {
    console.error('[Telegram Conversation Store] Không đồng bộ được phiên lên Sheet:', err.message);
  });
}

function mirrorDeleteToSheet(chatId) {
  if (!isTelegramSessionSheetSyncEnabled()) return;
  getHrLeaveRepository().deleteTelegramSession(chatId).catch(err => {
    console.error('[Telegram Conversation Store] Không xoá được bản sao phiên trên Sheet:', err.message);
  });
}

/**
 * Goi 1 lan khi bot khoi dong — khoi phuc cac hoi thoai con hieu luc tu ban
 * sao tren Sheet vao cache RAM/file cuc bo, phong truong hop container vua
 * duoc tao moi (redeploy) va da mat sach du lieu cuc bo. KHONG ghi de hoi
 * thoai da co san cuc bo (uu tien du lieu local moi hon).
 */
async function hydrateFromSheet() {
  if (!isTelegramSessionSheetSyncEnabled()) return;
  try {
    const sessions = await getHrLeaveRepository().findAllTelegramSessions();
    const all = load();
    let changed = false;
    for (const session of sessions) {
      const chatId = String(session.telegram_chat_id || '').trim();
      if (!chatId || !session.conv_json || all[chatId]) continue;
      const updatedAtMs = Date.parse(session.updated_at);
      if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > EXPIRE_MS) continue;
      let conv;
      try {
        conv = JSON.parse(session.conv_json);
      } catch (_parseErr) {
        continue;
      }
      all[chatId] = { conv, updatedAt: updatedAtMs };
      changed = true;
    }
    if (changed) persist();
  } catch (err) {
    console.error('[Telegram Conversation Store] Không khôi phục được phiên từ Sheet:', err.message);
  }
}

function ensureDataDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Cac field kieu Date bi JSON.stringify thanh chuoi ISO khi ghi xuong dia —
// can hoi phuc lai thanh Date khi doc len de cac ham nhu formatDate,
// computeIsUrgent... hoat dong dung.
function reviveDates(conv) {
  if (conv && conv.data) {
    // Cac field moi (Sang/Chieu flow): startDate, endDate
    if (typeof conv.data.startDate === 'string') conv.data.startDate = new Date(conv.data.startDate);
    if (typeof conv.data.endDate === 'string') conv.data.endDate = new Date(conv.data.endDate);
    // Cac field cu (gio cu, giu tuong thich nguoc): start, end
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
  mirrorSetToSheet(chatId, conv);
}

function deleteConversation(chatId) {
  const all = load();
  if (all[String(chatId)]) {
    delete all[String(chatId)];
    persist();
    mirrorDeleteToSheet(chatId);
  }
}

module.exports = {
  initStore,
  getConversation,
  setConversation,
  deleteConversation,
  hydrateFromSheet,
  isTelegramSessionSheetSyncEnabled,
  EXPIRE_MS
};
