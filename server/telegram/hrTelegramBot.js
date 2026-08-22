// ==========================================
// HR TELEGRAM BOT -- nhan dien tin nhan xin nghi phep, ghi thang vao Google
// Sheet nhan su qua hrLeaveRepository (khong qua hang doi Apps Script).
//
// Che do: polling (khong can webhook cong khai/HTTPS moi).
// State hoi thoai: Map<chatId, state> trong bo nho.
// ==========================================
'use strict';

const CONFIG = require('../config');
const repo = require('../hr/hrLeaveRepository');
const {
  computeDurationSessions,
  computeIsUrgent,
  computeSubmissionViolation,
  getSessionStartTime,
  formatVietnameseDate,
  formatLeaveBoundary,
  resolveSenderIdentity
} = require('../hr/hrLeaveService');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('../hr/hrLeaveEvents');
const conversationStore = require('./conversationStore');

let botInstance = null;

function isTelegramBotRuntimeEnabled(env = process.env) {
  if (env.TELEGRAM_BOT_ENABLED != null) {
    return String(env.TELEGRAM_BOT_ENABLED).toLowerCase() === 'true';
  }
  return String(env.RENDER).toLowerCase() === 'true';
}
const messageQueues = new Map();

// Dedup: tranh xu ly cung 1 message_id 2 lan.
const processedMessageIds = new Set();
function markProcessed(chatId, msgId) {
  if (chatId == null || msgId == null) return false;
  const key = `${chatId}:${msgId}`;
  if (processedMessageIds.has(key)) return true;
  processedMessageIds.add(key);
  if (processedMessageIds.size > 1000) {
    const first = processedMessageIds.values().next().value;
    processedMessageIds.delete(first);
  }
  return false;
}

function clearProcessedMessageIds() {
  processedMessageIds.clear();
}

// ---- State machine hoi thoai -------------------------------------------------
const STEP = Object.freeze({
  AWAITING_REASON:        'AWAITING_REASON',
  AWAITING_START_DATE:    'AWAITING_START_DATE',
  AWAITING_START_SESSION: 'AWAITING_START_SESSION',
  AWAITING_END_DATE:      'AWAITING_END_DATE',
  AWAITING_END_SESSION:   'AWAITING_END_SESSION',
  AWAITING_HANDOVER:      'AWAITING_HANDOVER',
  CONFIRM:                'CONFIRM'
});

function resetConversation(chatId) {
  conversationStore.deleteConversation(chatId);
}

function enqueueMessage(chatId, task) {
  const previous = messageQueues.get(chatId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  messageQueues.set(chatId, current);
  return current.finally(() => {
    if (messageQueues.get(chatId) === current) messageQueues.delete(chatId);
  });
}

// ---- Parse va normalize -------------------------------------------------------

/**
 * Parse ngay theo dinh dang dd/mm/yyyy. Tra ve Date (00:00 local) hoac null.
 */
function parseVietnameseDate(text) {
  const trimmed = String(text || '').trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (date.getFullYear() !== Number(m[3]) ||
        date.getMonth() !== Number(m[2]) - 1 ||
        date.getDate() !== Number(m[1])) return null;
    return date;
  }
  return null;
}

/**
 * Normalize buoi nguoi dung nhap thanh 'Sang' hoac 'Chieu' (Unicode).
 * Chap nhan: sang, morning, am, s  ->  Sang
 *            chieu, afternoon, pm, c  ->  Chieu
 */
function normalizeSession(text) {
  const t = String(text || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  if (/^(sang|s|morning|am)$/.test(t)) return 'S\u00e1ng';
  if (/^(chieu|c|afternoon|pm)$/.test(t)) return 'Chi\u1ec1u';
  return null;
}

/**
 * Dinh dang ngay theo dd/mm/yyyy.
 */
function formatDate(date) {
  return formatVietnameseDate(date);
}

// ---- Khoi tao bot -------------------------------------------------------------

function startHrTelegramBot() {
  if (botInstance) return botInstance;
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('[HR Telegram Bot] Thi\u1ebfu TELEGRAM_BOT_TOKEN -- bot kh\u00f4ng kh\u1edfi \u0111\u1ed9ng.');
    return null;
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
  botInstance = bot;

  bot.on('polling_error', (err) => {
    console.warn('[HR Telegram Bot] Polling warning/error:', err.code || err.message);
  });
  bot.on('error', (err) => {
    console.warn('[HR Telegram Bot] General error:', err.code || err.message);
  });

  bot.onText(/^\/start/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    try {
      await bot.sendMessage(msg.chat.id,
        'Ch\u00e0o b\u1ea1n! \u0110\u00e2y l\u00e0 bot xin ngh\u1ec9 ph\u00e9p c\u1ee7a TOKOSI.\n\n' +
        '1. N\u1ebfu t\u00e0i kho\u1ea3n ch\u01b0a li\u00ean k\u1ebft v\u1edbi Bot V\u00e0o web Qu\u1ea3n l\u00fd nh\u00e2n s\u1ef1 > Li\u00ean k\u1ebft Telegram \u0111\u1ec3 l\u1ea5y m\u00e3 6 s\u1ed1.\n' +
        '2. G\u00f5 /lienket <m\u00e3> \u0111\u1ec3 li\u00ean k\u1ebft t\u00e0i kho\u1ea3n.\n' +
        '3. Sau khi li\u00ean k\u1ebft, g\u00f5 /xinnghi \u0111\u1ec3 b\u1eaft \u0111\u1ea7u xin ngh\u1ec9.\n' +
        'D\u00f9ng /huy \u0111\u1ec3 h\u1ee7y phi\u00ean \u0111ang nh\u1eadp.'
      );
    } catch (err) {
      console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c h\u01b0\u1edbng d\u1eabn:', err.message);
    }
  });

  bot.onText(/^\/lienket(?:\s+(\S+))?/, async (msg, match) => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    const chatId = msg.chat.id;
    const code = match && match[1];
    if (!code) {
      try {
        await bot.sendMessage(chatId, 'Vui l\u00f2ng nh\u1eadp theo c\u00fa ph\u00e1p: /lienket <m\u00e3 6 s\u1ed1>');
      } catch (err) {
        console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c h\u01b0\u1edbng d\u1eabn li\u00ean k\u1ebft:', err.message);
      }
      return;
    }
    try {
      const link = await repo.consumeLinkCode(code, {
        chatId,
        telegramUsername: msg.from && msg.from.username ? '@' + msg.from.username : ''
      });
      await bot.sendMessage(chatId, `Li\u00ean k\u1ebft th\u00e0nh c\u00f4ng v\u1edbi t\u00e0i kho\u1ea3n "${link.web_username}". B\u1ea1n c\u00f3 th\u1ec3 d\u00f9ng /xinnghi \u0111\u1ec3 xin ngh\u1ec9.`);
    } catch (err) {
      try {
        await bot.sendMessage(chatId, `Li\u00ean k\u1ebft th\u1ea5t b\u1ea1i: ${err.message}`);
      } catch (sendErr) {
        console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c k\u1ebft qu\u1ea3 li\u00ean k\u1ebft:', sendErr.message);
      }
    }
  });

  bot.onText(/^\/huy/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    resetConversation(msg.chat.id);
    try {
      await bot.sendMessage(msg.chat.id, '\u0110\u00e3 h\u1ee7y phi\u00ean xin ngh\u1ec9 hi\u1ec7n t\u1ea1i.');
    } catch (err) {
      console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c x\u00e1c nh\u1eadn h\u1ee7y:', err.message);
    }
  });

  bot.onText(/^\/xinnghi/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    const chatId = msg.chat.id;
    try {
      const link = await repo.findLinkByChatId(chatId);
      if (!link) {
        await bot.sendMessage(chatId, 'B\u1ea1n ch\u01b0a li\u00ean k\u1ebft t\u00e0i kho\u1ea3n web. V\u00e0o web Qu\u1ea3n l\u00fd nh\u00e2n s\u1ef1 \u0111\u1ec3 l\u1ea5y m\u00e3, sau \u0111\u00f3 g\u00f5 /lienket <m\u00e3>.');
        return;
      }
      const identity = await resolveSenderIdentity(link.web_username);
      if (!identity) {
        await bot.sendMessage(chatId, 'Kh\u00f4ng t\u00ecm th\u1ea5y h\u1ed3 s\u01a1 t\u00e0i kho\u1ea3n \u0111\u00e3 li\u00ean k\u1ebft, vui l\u00f2ng li\u00ean h\u1ec7 Qu\u1ea3n l\u00fd.');
        return;
      }
      conversationStore.setConversation(chatId, {
        step: STEP.AWAITING_REASON,
        data: {
          link,
          identity,
          messageTime: Number.isFinite(Number(msg.date))
            ? new Date(Number(msg.date) * 1000).toISOString()
            : new Date().toISOString()
        }
      });
      await bot.sendMessage(chatId, `Xin ch\u00e0o ${identity.hoTen}. L\u00fd do ngh\u1ec9 l\u00e0 g\u00ec?`);
    } catch (err) {
      try {
        await bot.sendMessage(chatId, `C\u00f3 l\u1ed7i x\u1ea3y ra: ${err.message}`);
      } catch (sendErr) {
        console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c l\u1ed7i kh\u1edfi t\u1ea1o phi\u00ean:', sendErr.message);
      }
    }
  });

  bot.on('message', msg => {
    const text = msg.text || '';
    if (text.startsWith('/')) return; // da xu ly boi onText o tren
    const chatId = msg.chat.id;
    if (markProcessed(chatId, msg.message_id)) return;
    return enqueueMessage(chatId, async () => {
      const conv = conversationStore.getConversation(chatId);
      if (!conv) return; // ngoai phien hoi thoai
      try {
        await handleConversationStep(bot, chatId, conv, text.trim());
        conversationStore.setConversation(chatId, conv);
      } catch (err) {
        console.error('[HR Telegram Bot] L\u1ed7i x\u1eed l\u00fd b\u01b0\u1edbc h\u1ed9i tho\u1ea1i:', err.message);
        try {
          await bot.sendMessage(chatId, `C\u00f3 l\u1ed7i x\u1ea3y ra: ${err.message}. B\u1ea1n c\u00f3 th\u1ec3 g\u1eedi l\u1ea1i c\u00e2u tr\u1ea3 l\u1eddi ho\u1eb7c g\u00f5 /huy \u0111\u1ec3 b\u1eaft \u0111\u1ea7u l\u1ea1i.`);
        } catch (sendErr) {
          console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c th\u00f4ng b\u00e1o l\u1ed7i h\u1ed9i tho\u1ea1i:', sendErr.message);
        }
      }
    });
  });

  bot.on('callback_query', query => {
    const chatId = query.message.chat.id;
    return enqueueMessage(chatId, async () => {
      try {
        if (markProcessed(`callback:${chatId}`, query.id)) {
          await bot.answerCallbackQuery(query.id);
          return;
        }
        const conv = conversationStore.getConversation(chatId);
        if (!conv || conv.step !== STEP.CONFIRM) {
          await bot.answerCallbackQuery(query.id);
          return;
        }
        if (query.data === 'confirm') {
          await submitLeaveRequest(bot, chatId, conv);
        } else {
          resetConversation(chatId);
          await bot.sendMessage(chatId, '\u0110\u00e3 h\u1ee7y y\u00eau c\u1ea7u.');
        }
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error('[HR Telegram Bot] L\u1ed7i x\u1eed l\u00fd n\u00fat x\u00e1c nh\u1eadn:', err.message);
      }
    });
  });

  console.log('[HR Telegram Bot] \u0110\u00e3 kh\u1edfi \u0111\u1ed9ng (polling).');
  return bot;
}

// ---- Xu ly tung buoc cua form -------------------------------------------------

async function handleConversationStep(bot, chatId, conv, text) {
  switch (conv.step) {
    case STEP.AWAITING_REASON: {
      conv.data.ly_do = text;
      conv.step = STEP.AWAITING_START_DATE;
      await bot.sendMessage(chatId, 'Ng\u00e0y b\u1eaft \u0111\u1ea7u ngh\u1ec9? (vd: 22/08/2026)');
      return;
    }
    case STEP.AWAITING_START_DATE: {
      const date = parseVietnameseDate(text);
      if (!date) {
        await bot.sendMessage(chatId, 'Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c ng\u00e0y, vui l\u00f2ng nh\u1eadp l\u1ea1i theo d\u1ea1ng dd/mm/yyyy (vd: 22/08/2026).');
        return;
      }
      conv.data.startDate = date;
      conv.step = STEP.AWAITING_START_SESSION;
      await bot.sendMessage(chatId, 'B\u1eaft \u0111\u1ea7u ngh\u1ec9 bu\u1ed5i S\u00e1ng hay Chi\u1ec1u?');
      return;
    }
    case STEP.AWAITING_START_SESSION: {
      const session = normalizeSession(text);
      if (!session) {
        await bot.sendMessage(chatId, 'Vui l\u00f2ng nh\u1eadp "S\u00e1ng" ho\u1eb7c "Chi\u1ec1u".');
        return;
      }
      conv.data.startSession = session;
      conv.step = STEP.AWAITING_END_DATE;
      await bot.sendMessage(chatId,
        'Ng\u00e0y k\u1ebft th\u00fac ngh\u1ec9? (vd: 25/08/2026)\n\u0110\u1ec3 tr\u1ed1ng ho\u1eb7c g\u00f5 "-" n\u1ebfu ngh\u1ec9 c\u00f9ng ng\u00e0y.'
      );
      return;
    }
    case STEP.AWAITING_END_DATE: {
      const isEmpty = !text || text === '-' || text === '\u2014';
      let date;
      if (isEmpty) {
        date = conv.data.startDate;
      } else {
        date = parseVietnameseDate(text);
        if (!date) {
          await bot.sendMessage(chatId, 'Kh\u00f4ng \u0111\u1ecdc \u0111\u01b0\u1ee3c ng\u00e0y, vui l\u00f2ng nh\u1eadp l\u1ea1i theo d\u1ea1ng dd/mm/yyyy ho\u1eb7c \u0111\u1ec3 tr\u1ed1ng n\u1ebfu c\u00f9ng ng\u00e0y.');
          return;
        }
      }
      const startMidnight = new Date(
        conv.data.startDate.getFullYear(),
        conv.data.startDate.getMonth(),
        conv.data.startDate.getDate()
      );
      const endMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      if (endMidnight < startMidnight) {
        await bot.sendMessage(chatId, 'Ng\u00e0y k\u1ebft th\u00fac kh\u00f4ng \u0111\u01b0\u1ee3c tr\u01b0\u1edbc ng\u00e0y b\u1eaft \u0111\u1ea7u. Vui l\u00f2ng nh\u1eadp l\u1ea1i.');
        return;
      }
      conv.data.endDate = date;
      conv.step = STEP.AWAITING_END_SESSION;
      await bot.sendMessage(chatId, 'K\u1ebft th\u00fac ngh\u1ec9 bu\u1ed5i S\u00e1ng hay Chi\u1ec1u?');
      return;
    }
    case STEP.AWAITING_END_SESSION: {
      const session = normalizeSession(text);
      if (!session) {
        await bot.sendMessage(chatId, 'Vui l\u00f2ng nh\u1eadp "S\u00e1ng" ho\u1eb7c "Chi\u1ec1u".');
        return;
      }
      const buoi = computeDurationSessions(
        conv.data.startDate, conv.data.startSession,
        conv.data.endDate, session
      );
      if (buoi == null || buoi <= 0) {
        await bot.sendMessage(chatId,
          'Th\u1eddi gian k\u1ebft th\u00fac ph\u1ea3i sau th\u1eddi gian b\u1eaft \u0111\u1ea7u.\n' +
          'V\u00ed d\u1ee5: kh\u00f4ng th\u1ec3 ngh\u1ec9 Chi\u1ec1u r\u1ed3i k\u1ebft th\u00fac S\u00e1ng c\u00f9ng ng\u00e0y.\n' +
          'Vui l\u00f2ng nh\u1eadp l\u1ea1i bu\u1ed5i k\u1ebft th\u00fac.'
        );
        return;
      }
      conv.data.endSession = session;
      conv.data.tong_buoi_nghi = buoi;
      conv.step = STEP.AWAITING_HANDOVER;
      await bot.sendMessage(chatId, 'Ng\u01b0\u1eddi b\u00e0n giao c\u00f4ng vi\u1ec7c thay th\u1ebf l\u00e0 ai?');
      return;
    }
    case STEP.AWAITING_HANDOVER: {
      conv.data.nguoi_ban_giao = text;
      conv.step = STEP.CONFIRM;
      const d = conv.data;
      const sessionStartsAt = getSessionStartTime(d.startDate, d.startSession);
      const urgent = computeIsUrgent(sessionStartsAt, d.messageTime);
      const violation = computeSubmissionViolation(d.messageTime, d.startDate, d.startSession);
      d.co_nghi_gap = urgent;
      d.co_vi_pham = violation;
      const totalDays = d.tong_buoi_nghi / 2;
      const summary =
        'X\u00e1c nh\u1eadn y\u00eau c\u1ea7u ngh\u1ec9 ph\u00e9p:\n' +
        `- Ng\u01b0\u1eddi g\u1eedi: ${d.identity.hoTen} (${d.identity.chucVu})\n` +
        `- L\u00fd do: ${d.ly_do}\n` +
        `- T\u1eeb: ${d.startSession} ${formatDate(d.startDate)}\n` +
        `- \u0110\u1ebfn: ${d.endSession} ${formatDate(d.endDate)}\n` +
        `- T\u1ed5ng bu\u1ed5i ngh\u1ec9: ${d.tong_buoi_nghi} bu\u1ed5i (${totalDays} ng\u00e0y)\n` +
        `- Ng\u01b0\u1eddi b\u00e0n giao: ${d.nguoi_ban_giao}` +
        (urgent ? '\n\u26a0\ufe0f Y\u00eau c\u1ea7u n\u00e0y \u0111\u01b0\u1ee3c g\u1eedi kh\u00e1 s\u00e1t gi\u1edd ngh\u1ec9 (ngh\u1ec9 g\u1ea5p), s\u1ebd \u0111\u01b0\u1ee3c \u0111\u00e1nh d\u1ea5u \u0111\u1ec3 Qu\u1ea3n l\u00fd l\u01b0u \u00fd.' : '') +
        (violation
          ? `\n\u274c Xin ngh\u1ec9 ph\u00e9p kh\u00f4ng h\u1ee3p l\u1ec7: th\u1eddi gian g\u1eedi sau m\u1ed1c b\u1eaft \u0111\u1ea7u ${d.startSession === 'S\u00e1ng' ? '07:45' : '12:30'}. N\u1ebfu v\u1eabn x\u00e1c nh\u1eadn, \u0111\u01a1n s\u1ebd \u0111\u01b0\u1ee3c ghi v\u1edbi tr\u1ea1ng th\u00e1i "Vi ph\u1ea1m".`
          : '');
      await bot.sendMessage(chatId, summary, {
        reply_markup: {
          inline_keyboard: [[
            { text: 'X\u00e1c nh\u1eadn', callback_data: 'confirm' },
            { text: 'H\u1ee7y', callback_data: 'cancel' }
          ]]
        }
      });
      return;
    }
    default:
      resetConversation(chatId);
      await bot.sendMessage(chatId, 'Phiên xin nghỉ không hợp lệ hoặc đã hết hạn. Vui lòng gõ /xinnghi để bắt đầu lại.');
      return;
  }
}

async function submitLeaveRequest(bot, chatId, conv) {
  const d = conv.data;
  let record;
  try {
    record = await repo.createLeaveRequest({
      telegram_chat_id: chatId,
      telegram_username: d.link.telegram_username,
      web_username: d.link.web_username,
      ho_ten: d.identity.hoTen,
      chuc_vu: d.identity.chucVu,
      ly_do: d.ly_do,
      loai_yeu_cau: repo.LEAVE_TYPE.REQUEST,
      thoi_gian_gui: d.messageTime,
      thoi_gian_bat_dau: formatLeaveBoundary(d.startDate, d.startSession),
      thoi_gian_ket_thuc: formatLeaveBoundary(d.endDate, d.endSession),
      tong_buoi_nghi: d.tong_buoi_nghi,
      nguoi_ban_giao: d.nguoi_ban_giao,
      trang_thai: d.co_vi_pham ? repo.LEAVE_STATUS.VIOLATION : repo.LEAVE_STATUS.PENDING,
      co_nghi_gap: d.co_nghi_gap
    });
  } catch (err) {
    try {
      await bot.sendMessage(chatId, `G\u1eedi y\u00eau c\u1ea7u th\u1ea5t b\u1ea1i: ${err.message}`);
    } catch (sendErr) {
      console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c l\u1ed7i t\u1ea1o y\u00eau c\u1ea7u:', sendErr.message);
    }
    return false;
  }

  // Sheet da ghi thanh cong: dong phien ngay de nut xac nhan cu khong the tao
  // them dong trung neu Telegram tam thoi khong gui duoc tin thong bao.
  resetConversation(chatId);

  // Phat tin hieu realtime toi tat ca cac client web dang mo
  broadcastLeaveEvent(LEAVE_EVENT_TYPES.CREATED, record);

  const statusText = d.co_vi_pham
    ? 'Tr\u1ea1ng th\u00e1i: Vi ph\u1ea1m.'
    : 'Ch\u1edd Qu\u1ea3n l\u00fd ph\u00ea duy\u1ec7t.';
  try {
    await bot.sendMessage(chatId, `\u0110\u00e3 g\u1eedi y\u00eau c\u1ea7u ngh\u1ec9 ph\u00e9p, m\u00e3: ${record.request_id}. ${statusText}`);
  } catch (err) {
    console.error('[HR Telegram Bot] Da ghi yeu cau nhung khong gui duoc xac nhan:', err.message);
  }
  return true;
}

/**
 * Bao ket qua duyet/tu choi ve dung chat_id -- best-effort.
 */
async function notifyLeaveDecision(chatId, { status, note, requestId }) {
  if (!botInstance || !chatId) return;
  try {
    const lines = [`Y\u00eau c\u1ea7u ngh\u1ec9 ph\u00e9p ${requestId ? '"' + requestId + '" ' : ''}\u0111\u00e3 \u0111\u01b0\u1ee3c c\u1eadp nh\u1eadt tr\u1ea1ng th\u00e1i: ${status}.`];
    if (note) lines.push(`Ghi ch\u00fa: ${note}`);
    await botInstance.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    console.error('[HR Telegram Bot] Kh\u00f4ng g\u1eedi \u0111\u01b0\u1ee3c th\u00f4ng b\u00e1o k\u1ebft qu\u1ea3 duy\u1ec7t:', err.message);
  }
}

module.exports = {
  startHrTelegramBot,
  notifyLeaveDecision,
  isTelegramBotRuntimeEnabled,
  __test__: {
    parseVietnameseDate,
    normalizeSession,
    markProcessed,
    clearProcessedMessageIds,
    handleConversationStep,
    submitLeaveRequest
  }
};
