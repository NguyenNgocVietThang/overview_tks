// ==========================================
// HR TELEGRAM BOT -- nhan dien tin nhan xin nghi phep bang AI (mot tin nhan
// tu nhien), ghi thang vao Google Sheet nhan su qua hrLeaveRepository (khong
// qua hang doi Apps Script).
//
// Che do: polling (khong can webhook cong khai/HTTPS moi).
// State hoi thoai: ben ngoai (conversationStore, song sot qua restart).
//
// Pipeline (xem docs/superpowers/specs/2026-08-31-telegram-ai-leave-message-recognition.md):
// moi tin nhan tu do tu chat da lien ket duoc goi qua leaveAiExtractor de
// trich xuat y dinh/thoi gian/ly do/ban giao, roi qua leaveMessageResolver
// (thuan tuy, khong goi AI) de tinh chinh xac khoang nghi. Bot chi hoi lai
// dung phan con thieu (thoi gian | ly do | ban giao) truoc khi hien 1 man
// hinh xac nhan duy nhat.
//
// TODO(branch): bot hien CHI phuc vu co so Ha Noi — moi loi goi repo o duoi
// khong truyen `branch` nen mac dinh dung HR_SPREADSHEET_ID (Ha Noi). Mo rong
// cho Sai Gon khi co HR_SPREADSHEET_ID_SG: can them cach xac dinh nhan vien
// thuoc co so nao (tu coSo cua tai khoan web da lien ket) truoc khi ghi.
// ==========================================
'use strict';

const CONFIG = require('../config');
const repo = require('../hr/hrLeaveRepository');
const {
  computeIsUrgent,
  formatLeaveBoundary,
  resolveSenderIdentity
} = require('../hr/hrLeaveService');
const { getBangkokSessionStartTime, resolveLeaveMessage } = require('../hr/leaveMessageResolver');
const leaveAiExtractor = require('./leaveAiConsensusExtractor');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('../hr/hrLeaveEvents');
const conversationStore = require('./conversationStore');
const { getUserByUsername, ROLES } = require('../auth/localUserStore');
const telegramIdentityService = require('./telegramIdentityService');

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

// ---- State hoi thoai (pipeline AI) --------------------------------------------
const STEP = Object.freeze({
  AWAITING_CLARIFICATION: 'AWAITING_CLARIFICATION', // da trich xuat mot phan, con thieu 1 trong 3 nhom
  CONFIRM: 'CONFIRM'                                 // du thong tin, cho bam Xac nhan/Huy
});

const FIELD = Object.freeze({ TIME: 'TIME', REASON: 'REASON', HANDOVER: 'HANDOVER' });

// So lan hoi lai toi da cho CUNG 1 nhom truoc khi bot dung hoi va goi y /huy.
const MAX_CLARIFICATION_ATTEMPTS = 3;

// Tu khoa xac nhan/huy bang loi khi dang o CONFIRM (thay the cho bam nut).
// So khop CHINH XAC toan bo tin nhan sau chuan hoa, khong phai substring, de
// khong nham cau chinh sua co chua chu "ok"/"huy" o giua cau.
const CONFIRM_TEXT_KEYWORDS = new Set(['ok', 'oke', 'oki', 'okay', 'dong y', 'xac nhan', 'confirm']);
const CANCEL_TEXT_KEYWORDS = new Set(['huy', 'cancel']);

function normalizeConfirmationReply(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd') // 'đ' khong tach dau qua normalize('NFD') nen phai thay tay
    .normalize('NFD').replace(/\p{Mn}/gu, '') // bo dau thanh/dau phu con lai
    .replace(/[!.,?]+$/g, '') // bo dau cau cuoi cau
    .replace(/\s+(a|nhe|nha|oi)$/g, '') // bo tieu tu lich su cuoi cau: a/nhe/nha/oi
    .trim();
}

function resetConversation(chatId) {
  conversationStore.deleteConversation(chatId);
}

async function stripConfirmationButtons(bot, chatId, conv) {
  const messageId = conv.data && conv.data.confirmationMessageId;
  if (messageId && typeof bot.editMessageReplyMarkup === 'function') {
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: chatId,
        message_id: messageId
      });
    } catch (_editErr) {
      // Khong anh huong neu khong sua duoc markup
    }
  }
}

function enqueueMessage(chatId, task) {
  const previous = messageQueues.get(chatId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  messageQueues.set(chatId, current);
  return current.finally(() => {
    if (messageQueues.get(chatId) === current) messageQueues.delete(chatId);
  });
}

function hasValue(value) {
  return value != null && value !== '';
}

function isBareDecline(value) {
  return /^(?:không|khong)\s+(?:có|co|cần|can)(?:\s+(?:ạ|a))?[.!]?$/i.test(String(value || '').trim());
}

function buildExtractionTranscript(data) {
  const labels = {
    [FIELD.TIME]: 'THỜI GIAN',
    [FIELD.REASON]: 'LÝ DO',
    [FIELD.HANDOVER]: 'BÀN GIAO'
  };
  return data.messages.map((message, index) => {
    const field = Array.isArray(data.messageFields) ? data.messageFields[index] : null;
    return field ? `[Trả lời cho ${labels[field]}] ${message}` : message;
  }).join('\n');
}

function applyBareDecline(extracted, data) {
  if (!data.declinedFields || typeof data.declinedFields !== 'object') data.declinedFields = {};
  let result = { ...extracted };
  if (hasValue(extracted.reason)) delete data.declinedFields[FIELD.REASON];
  else if (data.declinedFields[FIELD.REASON]) result = { ...result, reason: null, reason_declined: true };
  if (hasValue(extracted.handover)) delete data.declinedFields[FIELD.HANDOVER];
  else if (data.declinedFields[FIELD.HANDOVER]) result = { ...result, handover: null, handover_declined: true };

  const lastIndex = data.messages.length - 1;
  const field = Array.isArray(data.messageFields) ? data.messageFields[lastIndex] : null;
  if (!isBareDecline(data.messages[lastIndex])) return result;
  if (field === FIELD.REASON) {
    data.declinedFields[FIELD.REASON] = true;
    return { ...result, reason: null, reason_declined: true };
  }
  if (field === FIELD.HANDOVER) {
    data.declinedFields[FIELD.HANDOVER] = true;
    return { ...result, handover: null, handover_declined: true };
  }
  return result;
}

function messageTimestampIso(msg) {
  return Number.isFinite(Number(msg.date))
    ? new Date(Number(msg.date) * 1000).toISOString()
    : new Date().toISOString();
}

// ---- Khoi tao bot -------------------------------------------------------------

function startHrTelegramBot() {
  if (botInstance) return botInstance;
  if (!CONFIG.TELEGRAM_BOT_TOKEN) {
    console.warn('[HR Telegram Bot] Thiếu TELEGRAM_BOT_TOKEN -- bot không khởi động.');
    return null;
  }

  const TelegramBot = require('node-telegram-bot-api');
  const bot = new TelegramBot(CONFIG.TELEGRAM_BOT_TOKEN, { polling: true });
  botInstance = bot;

  let conflictRecoveryTimer = null;
  function scheduleConflictRecovery() {
    conflictRecoveryTimer = setTimeout(async () => {
      conflictRecoveryTimer = null;
      try {
        await bot.startPolling();
        console.log('[HR Telegram Bot] Đã kết nối lại polling sau xung đột 409.');
      } catch (startErr) {
        console.error('[HR Telegram Bot] Kết nối lại polling thất bại, thử lại sau 10s:', startErr.message);
        scheduleConflictRecovery();
      }
    }, 10000);
    if (typeof conflictRecoveryTimer.unref === 'function') conflictRecoveryTimer.unref();
  }
  bot.on('polling_error', async (err) => {
    const isConflict = err && (
      (err.response && err.response.statusCode === 409) ||
      /\b409\s+Conflict\b/i.test(String(err.message || ''))
    );
    if (isConflict) {
      if (conflictRecoveryTimer) return; // da co 1 lan thu ket noi lai dang cho, tranh chong lap
      console.error('[HR Telegram Bot] Phát hiện bot instance khác đang polling; tạm dừng và thử kết nối lại sau 10s.');
      try {
        await bot.stopPolling();
      } catch (stopErr) {
        console.error('[HR Telegram Bot] Không thể dừng polling sau xung đột:', stopErr.message);
      }
      scheduleConflictRecovery();
      return;
    }
    console.warn('[HR Telegram Bot] Polling warning/error:', err.code || err.message);
  });
  bot.on('error', (err) => {
    console.warn('[HR Telegram Bot] General error:', err.code || err.message);
  });

  bot.onText(/^\/start/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    try {
      await bot.sendMessage(msg.chat.id,
        'Chào bạn! Đây là bot xin nghỉ phép của TOKOSI.\n\n' +
        '1. Nếu tài khoản chưa liên kết với Bot Vào web Quản lý nhân sự > Liên kết Telegram để lấy mã 6 số.\n' +
        '2. Gõ /lienket <mã> để liên kết tài khoản.\n' +
        '3. Sau khi liên kết, gõ một câu tự nhiên để xin nghỉ, ví dụ: "Em xin nghỉ chiều mai vì khám bệnh, bàn giao cho Nguyễn B".\n' +
        'Dùng /huy để hủy yêu cầu đang chờ xác nhận.'
      );
    } catch (err) {
      console.error('[HR Telegram Bot] Không gửi được hướng dẫn:', err.message);
    }
  });

  bot.onText(/^\/lienket(?:\s+(\S+))?/, async (msg, match) => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    const chatId = msg.chat.id;
    const code = match && match[1];
    if (!code) {
      try {
        await bot.sendMessage(chatId, 'Vui lòng nhập theo cú pháp: /lienket <mã 6 số>');
      } catch (err) {
        console.error('[HR Telegram Bot] Không gửi được hướng dẫn liên kết:', err.message);
      }
      return;
    }
    try {
      const pendingLink = await repo.findPendingLinkByCode(code);
      if (pendingLink) {
        await telegramIdentityService.assertManualLinkAllowed(pendingLink.web_username, chatId);
      }
      const link = await repo.consumeLinkCode(code, {
        chatId,
        telegramUsername: msg.from && msg.from.username ? '@' + msg.from.username : ''
      });
      await bot.sendMessage(chatId, `Liên kết thành công với tài khoản "${link.web_username}". Bạn có thể gõ một câu tự nhiên để xin nghỉ.`);
    } catch (err) {
      try {
        await bot.sendMessage(chatId, `Liên kết thất bại: ${err.message}`);
      } catch (sendErr) {
        console.error('[HR Telegram Bot] Không gửi được kết quả liên kết:', sendErr.message);
      }
    }
  });

  bot.onText(/^\/huy/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    resetConversation(msg.chat.id);
    try {
      await bot.sendMessage(msg.chat.id, 'Đã hủy yêu cầu xin nghỉ phép.');
    } catch (err) {
      console.error('[HR Telegram Bot] Không gửi được xác nhận hủy:', err.message);
    }
  });

  bot.onText(/^\/xinnghi/, async msg => {
    if (markProcessed(msg.chat.id, msg.message_id)) return;
    try {
      await bot.sendMessage(msg.chat.id,
        'Bạn chỉ cần gõ một câu tự nhiên để xin nghỉ, ví dụ:\n' +
        '"Em xin nghỉ chiều mai vì khám bệnh, bàn giao cho Nguyễn B"\n' +
        'Bot sẽ tự hiểu và hỏi lại nếu còn thiếu thông tin.'
      );
    } catch (err) {
      console.error('[HR Telegram Bot] Không gửi được hướng dẫn xin nghỉ:', err.message);
    }
  });

  bot.on('message', msg => {
    const text = msg.text || '';
    if (text.startsWith('/')) return; // da xu ly boi onText o tren
    const chatId = msg.chat.id;
    if (markProcessed(chatId, msg.message_id)) return;
    return enqueueMessage(chatId, async () => {
      try {
        await handleFreeTextMessage(bot, chatId, msg, text.trim());
      } catch (err) {
        console.error('[HR Telegram Bot] Lỗi xử lý tin nhắn xin nghỉ:', err.message);
        try {
          await bot.sendMessage(chatId, 'Có lỗi xảy ra. Bạn có thể gửi lại tin nhắn hoặc gõ /huy để bắt đầu lại.');
        } catch (sendErr) {
          console.error('[HR Telegram Bot] Không gửi được thông báo lỗi hội thoại:', sendErr.message);
        }
      }
    });
  });

  bot.on('callback_query', query => {
    const chatId = query.message && query.message.chat ? query.message.chat.id : query.from.id;
    const messageId = query.message && query.message.message_id;
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
        const confirmationMessageId = conv.data && conv.data.confirmationMessageId;
        if (confirmationMessageId != null && messageId !== confirmationMessageId) {
          await bot.answerCallbackQuery(query.id);
          return;
        }

        await stripConfirmationButtons(bot, chatId, conv);

        if (query.data === 'confirm') {
          await submitLeaveRequest(bot, chatId, conv);
        } else {
          resetConversation(chatId);
          await bot.sendMessage(chatId, 'Đã hủy yêu cầu xin nghỉ phép.');
        }
        await bot.answerCallbackQuery(query.id);
      } catch (err) {
        console.error('[HR Telegram Bot] Lỗi xử lý nút xác nhận:', err.message);
      }
    });
  });

  console.log('[HR Telegram Bot] Đã khởi động (polling).');
  return bot;
}

// ---- Pipeline AI: 1 tin nhan tu nhien -> trich xuat -> resolve -> hoi neu thieu -> xac nhan ----

async function handleFreeTextMessage(bot, chatId, msg, text) {
  if (!text) return; // tin nhan khong co noi dung van ban (anh/sticker...) -> bo qua

  let conv = conversationStore.getConversation(chatId);

  if (conv && conv.step === STEP.CONFIRM) {
    const normalizedReply = normalizeConfirmationReply(text);
    if (CONFIRM_TEXT_KEYWORDS.has(normalizedReply)) {
      await stripConfirmationButtons(bot, chatId, conv);
      await submitLeaveRequest(bot, chatId, conv);
      return;
    }
    if (CANCEL_TEXT_KEYWORDS.has(normalizedReply)) {
      await stripConfirmationButtons(bot, chatId, conv);
      resetConversation(chatId);
      await bot.sendMessage(chatId, 'Đã hủy yêu cầu xin nghỉ phép.');
      return;
    }
  }

  if (!conv) {
    // Bat dau draft moi.
    const telegramUsername = msg.from && msg.from.username ? '@' + msg.from.username : '';
    const automaticIdentity = await telegramIdentityService.resolveChat(chatId, telegramUsername);
    if (automaticIdentity.status === 'account_required') {
      await bot.sendMessage(chatId, 'ID Telegram của bạn đã có trong danh sách nhân sự, nhưng chưa có tài khoản web. Vui lòng đăng ký bằng email hoặc số điện thoại trong danh sách.');
      return;
    }
    const link = automaticIdentity.status === 'linked'
      ? automaticIdentity.link
      : await repo.findLinkByChatId(chatId);
    if (!link) {
      await bot.sendMessage(chatId, 'Bạn chưa liên kết tài khoản web. Vào web Quản lý nhân sự để lấy mã, sau đó gõ /lienket <mã>.');
      return;
    }
    const identity = await resolveSenderIdentity(link.web_username);
    if (!identity) {
      await bot.sendMessage(chatId, 'Không tìm thấy hồ sơ tài khoản đã liên kết, vui lòng liên hệ Quản lý.');
      return;
    }
    conv = {
      step: STEP.AWAITING_CLARIFICATION,
      data: {
        link,
        identity,
        sourceBranch: automaticIdentity.status === 'linked' ? automaticIdentity.sourceBranch : undefined,
        messageTime: messageTimestampIso(msg),
        messages: [text],
        messageFields: [null],
        pendingField: null,
        declinedFields: {},
        lastAskedField: null,
        askCounts: { TIME: 0, REASON: 0, HANDOVER: 0 }
      }
    };
  } else {
    if (!Array.isArray(conv.data.messageFields)) {
      conv.data.messageFields = conv.data.messages.map(() => null);
    }
    conv.data.messages.push(text);
    conv.data.messageFields.push(conv.data.pendingField || null);
    conversationStore.setConversation(chatId, conv);
  }

  await runLeavePipeline(bot, chatId, conv);
}

async function runLeavePipeline(bot, chatId, conv) {
  const d = conv.data;

  let extracted;
  try {
    extracted = await leaveAiExtractor.extractLeaveMessage(
      buildExtractionTranscript(d),
      {
        messageTime: d.messageTime,
        timeZone: CONFIG.HR_TIME_ZONE,
        noticeHours: CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD
      }
    );
    extracted = applyBareDecline(extracted, d);
  } catch (err) {
    console.error('[HR Telegram Bot] Lỗi AI trích xuất tin nhắn xin nghỉ:', err.code || err.message);
    try {
      if (err && err.code === 'AI_LEAVE_NO_CONSENSUS') {
        await bot.sendMessage(chatId,
          'Bot chưa có đủ hai model đồng thuận về yêu cầu này. Bạn vui lòng diễn đạt lại thời gian nghỉ rõ hơn.'
        );
      } else {
        await bot.sendMessage(chatId, 'Bot chưa phân tích được tin nhắn lúc này. Bạn vui lòng gửi lại sau ít phút.');
      }
    } catch (sendErr) {
      console.error('[HR Telegram Bot] Không thể gửi phản hồi lỗi AI:', sendErr.message);
    }
    return;
  }

  if (extracted.intent !== 'leave_request') {
    resetConversation(chatId);
    await bot.sendMessage(chatId,
      'Mình chỉ hỗ trợ xin nghỉ phép thôi nhé. Bạn có thể nhắn một câu tự nhiên, ví dụ: "Em xin nghỉ chiều mai vì khám bệnh, bàn giao cho Nguyễn B".'
    );
    return;
  }

  let resolved;
  try {
    resolved = resolveLeaveMessage(extracted, d.messageTime, { noticeHours: CONFIG.HR_URGENT_NOTICE_HOURS_THRESHOLD });
  } catch (_err) {
    await askOrGiveUp(bot, chatId, conv, FIELD.TIME,
      'Mình chưa xác định chắc thời gian nghỉ. Bạn nhắn lại rõ hơn giúp mình, ví dụ: "nghỉ chiều mai", "nghỉ từ mai đến thứ 5", "nghỉ 3 ngày".'
    );
    return;
  }

  if (!hasValue(extracted.reason) && extracted.reason_declined !== true) {
    await askOrGiveUp(bot, chatId, conv, FIELD.REASON, "Lý do nghỉ là gì? (Nếu không có, trả lời 'không có')");
    return;
  }

  if (!hasValue(extracted.handover) && extracted.handover_declined !== true) {
    await askOrGiveUp(bot, chatId, conv, FIELD.HANDOVER, "Người bàn giao công việc là ai? (Nếu không cần, trả lời 'không có')");
    return;
  }

  await presentConfirmation(bot, chatId, conv, extracted, resolved);
}

async function askOrGiveUp(bot, chatId, conv, field, question) {
  const d = conv.data;
  d.askCounts[field] = d.lastAskedField === field ? (d.askCounts[field] || 0) + 1 : 1;
  d.lastAskedField = field;
  d.pendingField = field;
  conv.step = STEP.AWAITING_CLARIFICATION;
  conversationStore.setConversation(chatId, conv);

  if (d.askCounts[field] > MAX_CLARIFICATION_ATTEMPTS) {
    await bot.sendMessage(chatId,
      'Mình vẫn chưa hiểu rõ yêu cầu này sau vài lần hỏi lại. Bạn vui lòng gõ /huy để hủy và liên hệ trực tiếp Quản lý/nhân sự để được hỗ trợ.'
    );
    return;
  }
  await bot.sendMessage(chatId, question);
}

/**
 * Ghi chu nhung phan bot da tu suy ra mac dinh (khong nguoi dung neu ro), de
 * nhan vien phat hien sai sot truoc khi xac nhan (spec muc 6, buoc 5).
 */
function buildDefaultNotes(extracted) {
  const notes = [];
  const hasStartDate = hasValue(extracted.start_date);
  const hasStartSession = hasValue(extracted.start_session);
  const hasEndDate = hasValue(extracted.end_date);
  const hasEndSession = hasValue(extracted.end_session);
  const hasDuration = extracted.duration_value != null;

  if (hasStartDate && hasEndDate && (!hasStartSession || !hasEndSession)) {
    const inferredBoundaries = [];
    if (!hasStartSession) inferredBoundaries.push('bắt đầu buổi Sáng');
    if (!hasEndSession) inferredBoundaries.push('kết thúc buổi Chiều');
    notes.push(`(mặc định: ${inferredBoundaries.join(', ')})`);
  } else if (hasStartDate && !hasStartSession && hasDuration) {
    notes.push('(mặc định: bắt đầu buổi Sáng)');
  } else if (hasStartDate && !hasStartSession && !hasEndDate) {
    notes.push('(mặc định: nghỉ trọn ngày, Sáng đến Chiều)');
  } else if (!hasStartDate && hasStartSession) {
    notes.push('(mặc định: ngày hôm nay)');
  } else if (!hasStartDate && !hasStartSession && hasDuration) {
    notes.push('(mặc định: bắt đầu ở buổi gần nhất còn đủ thời gian báo trước)');
  }
  return notes;
}

async function presentConfirmation(bot, chatId, conv, extracted, resolved) {
  const d = conv.data;
  const sessionStartsAt = getBangkokSessionStartTime(resolved.startDate, resolved.startSession);
  const urgent = computeIsUrgent(sessionStartsAt, d.messageTime);
  const submittedAt = new Date(d.messageTime);
  const violation = Number.isFinite(submittedAt.getTime())
    && !!sessionStartsAt
    && submittedAt.getTime() > sessionStartsAt.getTime();
  const totalDays = resolved.totalSessions / 2;
  const isRetroactive = !!sessionStartsAt && sessionStartsAt.getTime() < new Date(d.messageTime).getTime();

  conv.step = STEP.CONFIRM;
  conv.data.pendingField = null;
  conv.data.resolved = {
    startDate: resolved.startDate,
    startSession: resolved.startSession,
    endDate: resolved.endDate,
    endSession: resolved.endSession,
    totalSessions: resolved.totalSessions,
    reason: resolved.reason,
    handover: resolved.handover,
    coNghiGap: urgent,
    coViPham: violation
  };

  const lines = [
    'Xác nhận yêu cầu nghỉ phép:',
    `- Người gửi: ${d.identity.hoTen} (${d.identity.chucVu})`,
    `- Lý do: ${resolved.reason || 'không có'}`,
    `- Từ: ${formatLeaveBoundary(resolved.startDate, resolved.startSession)}`,
    `- Đến: ${formatLeaveBoundary(resolved.endDate, resolved.endSession)}`,
    `- Tổng buổi nghỉ: ${resolved.totalSessions} buổi (${totalDays} ngày)`,
    `- Người bàn giao: ${resolved.handover || 'không có'}`
  ];
  buildDefaultNotes(extracted).forEach(note => lines.push(`  ${note}`));
  if (isRetroactive) {
    lines.push('⚠️ Thời gian nghỉ đã ở trong quá khứ so với lúc gửi tin. Vui lòng xác nhận lại nếu đây là xin nghỉ hồi tố.');
  }
  if (urgent) {
    lines.push(`⚠️ Yêu cầu này được gửi sau ${CONFIG.HR_URGENT_LATE_NIGHT_HOUR}h cho ca nghỉ ngày mai (nghỉ gấp), sẽ được đánh dấu để Quản lý lưu ý.`);
  }
  if (violation) {
    lines.push(`❌ Xin nghỉ phép không hợp lệ: thời gian gửi sau mốc bắt đầu ${resolved.startSession === 'Sáng' ? '07:45' : '12:30'}. Nếu vẫn xác nhận, đơn sẽ được ghi với trạng thái "Vi phạm".`);
  }

  const confirmationMessage = await bot.sendMessage(chatId, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Xác nhận', callback_data: 'confirm' },
        { text: 'Hủy', callback_data: 'cancel' }
      ]]
    }
  });
  conv.data.confirmationMessageId = confirmationMessage && confirmationMessage.message_id;
  conversationStore.setConversation(chatId, conv);
}

/**
 * Bao cho tat ca tai khoan da lien ket Telegram (tru tai khoan vai tro
 * "Khách") biet co nhan vien vua xin nghi phep. Best-effort: loi gui toi
 * tung nguoi khong lam hong luong tao don chinh.
 */
async function broadcastNewLeaveRequestToStaff(bot, record, branch) {
  let links;
  try {
    links = await repo.findAllLinkedAccounts(branch);
  } catch (err) {
    console.error('[HR Telegram Bot] Không lấy được danh sách liên kết để thông báo:', err.message);
    return;
  }

  const message = [
    '🔔 Có nhân viên vừa xin nghỉ phép:',
    `- Người gửi: ${record.ho_ten} (${record.chuc_vu})`,
    `- Lý do: ${record.ly_do || 'không có'}`,
    `- Từ: ${record.thoi_gian_bat_dau}`,
    `- Đến: ${record.thoi_gian_ket_thuc}`,
    `- Mã yêu cầu: ${record.request_id}`
  ].join('\n');

  const recipients = links.filter(link => (
    String(link.telegram_chat_id) !== String(record.telegram_chat_id)
  ));

  for (const link of recipients) {
    let user;
    try {
      user = await getUserByUsername(link.web_username);
    } catch (err) {
      console.error('[HR Telegram Bot] Không tra được tài khoản web để lọc thông báo:', err.message);
      continue;
    }
    if (!user || user.vaiTro === ROLES.KHACH) continue;

    try {
      await bot.sendMessage(link.telegram_chat_id, message);
    } catch (err) {
      console.error(`[HR Telegram Bot] Không gửi được thông báo nghỉ phép tới chat_id ${link.telegram_chat_id}:`, err.message);
    }
  }
}

async function submitLeaveRequest(bot, chatId, conv) {
  const d = conv.data;
  const r = d.resolved;
  let record;
  try {
    record = await repo.createLeaveRequest({
      telegram_chat_id: chatId,
      telegram_username: d.link.telegram_username,
      web_username: d.link.web_username,
      ho_ten: d.identity.hoTen,
      chuc_vu: d.identity.chucVu,
      ly_do: r.reason,
      loai_yeu_cau: repo.LEAVE_TYPE.REQUEST,
      thoi_gian_gui: d.messageTime,
      thoi_gian_bat_dau: formatLeaveBoundary(r.startDate, r.startSession),
      thoi_gian_ket_thuc: formatLeaveBoundary(r.endDate, r.endSession),
      tong_buoi_nghi: r.totalSessions,
      nguoi_ban_giao: r.handover,
      trang_thai: r.coViPham ? repo.LEAVE_STATUS.VIOLATION : repo.LEAVE_STATUS.PENDING,
      co_nghi_gap: r.coNghiGap,
      tin_nhan: d.messages.join(' | ')
    }, d.sourceBranch);
  } catch (err) {
    try {
      await bot.sendMessage(chatId, `Gửi yêu cầu thất bại: ${err.message}`);
    } catch (sendErr) {
      console.error('[HR Telegram Bot] Không gửi được lỗi tạo yêu cầu:', sendErr.message);
    }
    return false;
  }

  // Sheet da ghi thanh cong: dong phien ngay de nut xac nhan cu khong the tao
  // them dong trung neu Telegram tam thoi khong gui duoc tin thong bao.
  resetConversation(chatId);

  // Phat tin hieu realtime toi tat ca cac client web dang mo
  broadcastLeaveEvent(LEAVE_EVENT_TYPES.CREATED, record);

  // Bao cho tat ca tai khoan Telegram da lien ket (tru "Khách") biet co
  // nhan vien vua xin nghi phep. Khong chan luong chinh neu gui loi.
  broadcastNewLeaveRequestToStaff(bot, record, d.sourceBranch).catch(err => {
    console.error('[HR Telegram Bot] Lỗi khi broadcast thông báo nghỉ phép:', err.message);
  });

  const statusText = r.coViPham
    ? 'Trạng thái: Vi phạm.'
    : 'Chờ Quản lý phê duyệt.';
  try {
    await bot.sendMessage(chatId, `Đã gửi yêu cầu nghỉ phép, mã: ${record.request_id}. ${statusText}`);
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
    const lines = [`Yêu cầu nghỉ phép ${requestId ? '"' + requestId + '" ' : ''}đã được cập nhật trạng thái: ${status}.`];
    if (note) lines.push(`Ghi chú: ${note}`);
    await botInstance.sendMessage(chatId, lines.join('\n'));
  } catch (err) {
    console.error('[HR Telegram Bot] Không gửi được thông báo kết quả duyệt:', err.message);
  }
}

module.exports = {
  startHrTelegramBot,
  notifyLeaveDecision,
  isTelegramBotRuntimeEnabled,
  __test__: {
    STEP,
    FIELD,
    MAX_CLARIFICATION_ATTEMPTS,
    markProcessed,
    clearProcessedMessageIds,
    handleFreeTextMessage,
    submitLeaveRequest
  }
};
