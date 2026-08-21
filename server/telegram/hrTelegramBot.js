// ==========================================
// HR TELEGRAM BOT — nhan dien tin nhan xin nghi phep, ghi thang vao Google
// Sheet nhan su qua hrLeaveRepository (khong qua hang doi Apps Script).
//
// Che do: polling (khong can webhook cong khai/HTTPS moi).
// State hoi thoai: Map<chatId, state> trong bo nho — mat khi restart server,
// chap nhan duoc vi day chi la phien nhap lieu ngan (xem ke hoach).
// ==========================================
'use strict';

const CONFIG = require('../config');
const repo = require('../hr/hrLeaveRepository');
const { computeDurationHours, computeIsUrgent, resolveSenderIdentity } = require('../hr/hrLeaveService');
const conversationStore = require('./conversationStore');

let botInstance = null;

// ---- State machine hoi thoai -------------------------------------------------
// Trang thai duoc luu qua conversationStore (file server/data/telegram_conversations.json)
// de song sot qua restart server — truoc day chi luu trong Map o RAM nen bi mat
// giua chung, khien bot im lang khong tra loi nua sau khi server restart.

const STEP = Object.freeze({
  AWAITING_REASON: 'AWAITING_REASON',
  AWAITING_START: 'AWAITING_START',
  AWAITING_END: 'AWAITING_END',
  AWAITING_HANDOVER: 'AWAITING_HANDOVER',
  CONFIRM: 'CONFIRM'
});

function resetConversation(chatId) {
  conversationStore.deleteConversation(chatId);
}

// ---- Parse ngay theo dd/mm/yyyy hh:mm (chap nhan them dang ISO) -------------

function parseVietnameseDateTime(text) {
  const trimmed = String(text || '').trim();
  const vnMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})$/);
  if (vnMatch) {
    const [, d, m, y, h, min] = vnMatch;
    const date = new Date(Number(y), Number(m) - 1, Number(d), Number(h), Number(min));
    return isNaN(date.getTime()) ? null : date;
  }
  const iso = new Date(trimmed);
  return isNaN(iso.getTime()) ? null : iso;
}

function formatDateTime(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ---- Khoi tao bot -------------------------------------------------------------

function startHrTelegramBot() {
  if (botInstance) return botInstance;
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('[HR Telegram Bot] Thiếu TELEGRAM_BOT_TOKEN — bot không khởi động.');
    return null;
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
  botInstance = bot;

  bot.onText(/^\/start/, msg => {
    bot.sendMessage(msg.chat.id,
      'Chào bạn! Đây là bot xin nghỉ phép của TOKOSI.\n\n' +
      '1. Vào web Quản lý nhân sự > Liên kết Telegram để lấy mã 6 số.\n' +
      '2. Gõ /lienket <mã> để liên kết tài khoản.\n' +
      '3. Sau khi liên kết, gõ /xinnghi để bắt đầu xin nghỉ.\n' +
      'Dùng /huy để hủy phiên đang nhập.'
    );
  });

  bot.onText(/^\/lienket(?:\s+(\S+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match && match[1];
    if (!code) {
      return bot.sendMessage(chatId, 'Vui lòng nhập theo cú pháp: /lienket <mã 6 số>');
    }
    try {
      const link = await repo.consumeLinkCode(code, {
        chatId,
        telegramUsername: msg.from && msg.from.username ? '@' + msg.from.username : ''
      });
      bot.sendMessage(chatId, `Liên kết thành công với tài khoản "${link.web_username}". Bạn có thể dùng /xinnghi để xin nghỉ.`);
    } catch (err) {
      bot.sendMessage(chatId, `Liên kết thất bại: ${err.message}`);
    }
  });

  bot.onText(/^\/huy/, msg => {
    resetConversation(msg.chat.id);
    bot.sendMessage(msg.chat.id, 'Đã hủy phiên xin nghỉ hiện tại.');
  });

  bot.onText(/^\/xinnghi/, async msg => {
    const chatId = msg.chat.id;
    try {
      const link = await repo.findLinkByChatId(chatId);
      if (!link) {
        return bot.sendMessage(chatId, 'Bạn chưa liên kết tài khoản web. Vào web Quản lý nhân sự để lấy mã, sau đó gõ /lienket <mã>.');
      }
      const identity = await resolveSenderIdentity(link.web_username);
      if (!identity) {
        return bot.sendMessage(chatId, 'Không tìm thấy hồ sơ tài khoản đã liên kết, vui lòng liên hệ Quản lý.');
      }
      conversationStore.setConversation(chatId, {
        step: STEP.AWAITING_REASON,
        data: {
          link,
          identity,
          messageTime: new Date().toISOString()
        }
      });
      bot.sendMessage(chatId, `Xin chào ${identity.hoTen}. Lý do nghỉ là gì?`);
    } catch (err) {
      bot.sendMessage(chatId, `Có lỗi xảy ra: ${err.message}`);
    }
  });

  bot.on('message', async msg => {
    const text = msg.text || '';
    if (text.startsWith('/')) return; // da xu ly boi onText o tren
    const chatId = msg.chat.id;
    const conv = conversationStore.getConversation(chatId);
    if (!conv) return; // ngoai phien hoi thoai — bo qua, khong spam huong dan

    try {
      await handleConversationStep(bot, chatId, conv, text.trim());
      // handleConversationStep chi thay doi step/data tren doi tuong local (conv
      // tra ve tu getConversation la ban sao doc lap) — phai ghi lai xuong dia
      // sau moi buoc de song sot qua restart server.
      conversationStore.setConversation(chatId, conv);
    } catch (err) {
      bot.sendMessage(chatId, `Có lỗi xảy ra: ${err.message}. Gõ /huy để bắt đầu lại.`);
    }
  });

  bot.on('callback_query', async query => {
    const chatId = query.message.chat.id;
    const conv = conversationStore.getConversation(chatId);
    if (!conv || conv.step !== STEP.CONFIRM) {
      return bot.answerCallbackQuery(query.id);
    }
    if (query.data === 'confirm') {
      await submitLeaveRequest(bot, chatId, conv);
    } else {
      resetConversation(chatId);
      bot.sendMessage(chatId, 'Đã hủy yêu cầu.');
    }
    bot.answerCallbackQuery(query.id);
  });

  console.log('[HR Telegram Bot] Đã khởi động (polling).');
  return bot;
}

// ---- Xu ly tung buoc cua form -------------------------------------------------

async function handleConversationStep(bot, chatId, conv, text) {
  switch (conv.step) {
    case STEP.AWAITING_REASON: {
      conv.data.ly_do = text;
      conv.step = STEP.AWAITING_START;
      bot.sendMessage(chatId, 'Thời gian bắt đầu nghỉ? (vd: 25/08/2026 08:00)');
      return;
    }
    case STEP.AWAITING_START: {
      const start = parseVietnameseDateTime(text);
      if (!start) {
        bot.sendMessage(chatId, 'Không đọc được thời gian, vui lòng nhập lại theo dạng dd/mm/yyyy hh:mm.');
        return;
      }
      conv.data.start = start;
      conv.step = STEP.AWAITING_END;
      bot.sendMessage(chatId, 'Thời gian kết thúc nghỉ?');
      return;
    }
    case STEP.AWAITING_END: {
      const end = parseVietnameseDateTime(text);
      if (!end) {
        bot.sendMessage(chatId, 'Không đọc được thời gian, vui lòng nhập lại theo dạng dd/mm/yyyy hh:mm.');
        return;
      }
      const hours = computeDurationHours(conv.data.start, end);
      if (hours == null) {
        bot.sendMessage(chatId, 'Thời gian kết thúc phải sau thời gian bắt đầu. Vui lòng nhập lại thời gian kết thúc.');
        return;
      }
      conv.data.end = end;
      conv.data.tong_gio_nghi = hours;
      conv.step = STEP.AWAITING_HANDOVER;
      bot.sendMessage(chatId, 'Người bàn giao công việc thay thế là ai?');
      return;
    }
    case STEP.AWAITING_HANDOVER: {
      conv.data.nguoi_ban_giao = text;
      conv.step = STEP.CONFIRM;
      const d = conv.data;
      const urgent = computeIsUrgent(d.start, d.messageTime);
      d.co_nghi_gap = urgent;
      const summary =
        `Xác nhận yêu cầu nghỉ phép:\n` +
        `- Người gửi: ${d.identity.hoTen} (${d.identity.chucVu})\n` +
        `- Lý do: ${d.ly_do}\n` +
        `- Từ: ${formatDateTime(d.start)}\n` +
        `- Đến: ${formatDateTime(d.end)}\n` +
        `- Tổng giờ nghỉ: ${d.tong_gio_nghi}\n` +
        `- Người bàn giao: ${d.nguoi_ban_giao}` +
        (urgent ? `\n⚠️ Yêu cầu này được gửi khá sát giờ nghỉ (nghỉ gấp), sẽ được đánh dấu để Quản lý lưu ý.` : '');
      bot.sendMessage(chatId, summary, {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Xác nhận', callback_data: 'confirm' },
            { text: 'Hủy', callback_data: 'cancel' }
          ]]
        }
      });
      return;
    }
    default:
      return;
  }
}

async function submitLeaveRequest(bot, chatId, conv) {
  const d = conv.data;
  try {
    const record = await repo.createLeaveRequest({
      telegram_chat_id: chatId,
      telegram_username: d.link.telegram_username,
      web_username: d.link.web_username,
      ho_ten: d.identity.hoTen,
      chuc_vu: d.identity.chucVu,
      ly_do: d.ly_do,
      loai_yeu_cau: repo.LEAVE_TYPE.REQUEST,
      thoi_gian_nhan: d.messageTime,
      thoi_gian_bat_dau: d.start.toISOString(),
      thoi_gian_ket_thuc: d.end.toISOString(),
      tong_gio_nghi: d.tong_gio_nghi,
      nguoi_ban_giao: d.nguoi_ban_giao,
      trang_thai: repo.LEAVE_STATUS.PENDING,
      co_nghi_gap: d.co_nghi_gap
    });
    bot.sendMessage(chatId, `Đã gửi yêu cầu nghỉ phép, mã: ${record.request_id}. Chờ Quản lý phê duyệt.`);
  } catch (err) {
    bot.sendMessage(chatId, `Gửi yêu cầu thất bại: ${err.message}`);
  } finally {
    resetConversation(chatId);
  }
}

/**
 * Bao ket qua duyet/tu choi ve dung chat_id — best-effort, KHONG duoc phep
 * lam hong response cua API goi no (xem hrLeaveRoutes.js).
 */
async function notifyLeaveDecision(chatId, { status, note, requestId }) {
  if (!botInstance || !chatId) return;
  try {
    const lines = [`Yêu cầu nghỉ phép ${requestId ? '"' + requestId + '" ' : ''}của bạn đã được cập nhật trạng thái: ${status}.`];
    if (note) lines.push(`Ghi chú: ${note}`);
    await botInstance.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    console.error('[HR Telegram Bot] Không gửi được thông báo kết quả duyệt:', err.message);
  }
}

module.exports = { startHrTelegramBot, notifyLeaveDecision };
