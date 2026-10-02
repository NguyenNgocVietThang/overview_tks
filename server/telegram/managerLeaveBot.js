'use strict';

const { hasFeature } = require('../auth/featureRegistry');
const { ROLES, ACTIVE_STATUS } = require('../auth/userRepository');
const { normalizeCoSo, BRANCHES, BRANCH_BOTH, branchCodeToLabel } = require('../branch/branches');
const { STATUS_CODES, FINAL_STATUSES } = require('./managerLeaveMessage');

const PHYSICAL_BRANCHES = [BRANCHES.HANOI, BRANCHES.SAIGON];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_ACTION = new RegExp(`^([sk])\\|(${UUID})$`, 'i');
const STALE_MESSAGE = 'Yêu cầu đã thay đổi. Xem tin nhắn mới nhất và chọn lại.';
const FINAL_MESSAGE = 'Yêu cầu đã kết thúc trên Telegram (Đã duyệt/Từ chối). Có thể thay đổi trên web.';

function isEligibleManager(user, telegramId = user && user.telegramId) {
  return !!(user && user.id && !user.isDeleted && user.vaiTro === ROLES.QUAN_LY &&
    user.trangThai === ACTIVE_STATUS && /^[1-9]\d*$/.test(String(user.telegramId || '')) &&
    String(user.telegramId) === String(telegramId) && hasFeature(user, 'hr.leave.manage'));
}

function managerMatchesBranch(user, requestBranch) {
  const scope = normalizeCoSo(user && user.coSo);
  const branch = normalizeCoSo(requestBranch) || branchCodeToLabel(requestBranch);
  return PHYSICAL_BRANCHES.includes(branch) && (scope === BRANCH_BOTH || scope === branch);
}

function businessError(text, statusCode = 409) {
  return Object.assign(new Error(text), { statusCode });
}

function isBusinessError(error) {
  return !!(error && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500);
}

function isForwarded(message) {
  return !!(message && (message.forward_origin || message.forward_from || message.forward_from_chat ||
    message.forward_sender_name || message.forward_date || message.is_automatic_forward));
}

function sessionExpired(session) {
  const expiresAt = new Date(session.expires_at).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function createManagerLeaveBot({ store, leaveRepo, decide, getManager, webUrl }) {
  // All mutations and returned effects belong to the caller's transaction.
  // The runtime sends effects only after commit and persists prompt message IDs.
  const send = (chatId, text) => ({ method: 'sendMessage', params: { chat_id: chatId, text } });
  const answer = (query, text, showAlert = false) => ({ method: 'answerCallbackQuery', params: {
    callback_query_id: query.id, text: String(text).slice(0, 200), ...(showAlert ? { show_alert: true } : {})
  } });
  const clearPrompt = session => session && session.prompt_message_id != null ? [{
    method: 'editMessageReplyMarkup', params: {
      chat_id: session.telegram_chat_id, message_id: session.prompt_message_id, reply_markup: { inline_keyboard: [] }
    }
  }] : [];

  async function removeSession(chatId, session) {
    await store.deleteSession(chatId, session.session_id);
    return clearPrompt(session);
  }

  function ownsSession(session, user, chatId) {
    return !!(session && String(session.user_id) === String(user.id) && String(session.telegram_chat_id) === String(chatId));
  }

  async function currentRequest(requestId, user, expectedVersion, chatId) {
    const row = await leaveRepo.getLeaveRequestById(requestId, PHYSICAL_BRANCHES);
    if (!row) throw businessError('Không tìm thấy yêu cầu nghỉ phép này.', 404);
    if (row.loai_yeu_cau !== 'Xin nghỉ phép') throw businessError('Bot chỉ xử lý yêu cầu Xin nghỉ phép.', 400);
    if (!managerMatchesBranch(user, row.co_so || row.branch)) throw businessError('Yêu cầu nằm ngoài cơ sở bạn quản lý.', 403);
    if (FINAL_STATUSES.has(row.trang_thai)) throw businessError(FINAL_MESSAGE);
    if (String(row.decision_version) !== String(expectedVersion)) {
      await store.wakeDeliveries(chatId);
      throw businessError(STALE_MESSAGE);
    }
    return row;
  }

  async function completeRejection(session, user, chatId, note, effects) {
    try {
      if (sessionExpired(session)) {
        throw businessError('Phiên nhập lý do đã hết hạn sau 15 phút. Hãy chọn Từ chối lại.');
      }
      const delivery = await store.getDelivery(session.request_id, user.id, chatId);
      if (!delivery) throw businessError('Bạn không còn nhận thông báo cho yêu cầu này.', 403);
      await currentRequest(session.request_id, user, session.expected_version, chatId);
      await decide({ requestId: session.request_id, user, status: STATUS_CODES.r, note, channel: 'telegram', expectedVersion: String(session.expected_version) });
      effects.push(...await removeSession(chatId, session));
    } catch (error) {
      if (isBusinessError(error)) effects.push(...await removeSession(chatId, session));
      throw error;
    }
  }

  async function handleUpdate(update) {
    const query = update && update.callback_query;
    const message = query ? query.message : update && update.message;
    const sender = query ? query.from : message && message.from;
    const chat = message && message.chat;
    const effects = [];
    if (!chat || chat.type !== 'private' || !sender || isForwarded(message)) {
      return query ? [answer(query, 'Hãy thao tác trong cuộc trò chuyện riêng với bot.', true)] : [];
    }
    const chatId = chat.id;
    try {
      const user = await getManager(sender.id);
      if (!isEligibleManager(user, sender.id) || String(chatId) !== String(user.telegramId)) {
        return query ? [answer(query, 'Tài khoản Telegram chưa có quyền quản lý nghỉ phép.', true)] :
          [send(chatId, 'Bot dành cho tài khoản Quản lý đang hoạt động có quyền quản lý nghỉ phép và Telegram ID đã liên kết.')];
      }
      if (!normalizeCoSo(user.coSo)) throw businessError('Tài khoản chưa được gán cơ sở quản lý. Hãy cập nhật hồ sơ trên web.', 403);

      if (query) {
        const data = typeof query.data === 'string' ? query.data : '';
        if (Buffer.byteLength(data, 'utf8') > 64) return [answer(query, 'Thao tác không hợp lệ.', true)];
        const sessionAction = data.match(SESSION_ACTION);
        if (sessionAction) {
          const session = await store.getSession(chatId);
          if (!ownsSession(session, user, chatId) || session.session_id !== sessionAction[2] ||
              session.prompt_message_id == null || String(session.prompt_message_id) !== String(message.message_id)) {
            return [answer(query, 'Phiên nhập lý do không còn hiệu lực. Hãy chọn Từ chối lại.', true)];
          }
          if (sessionAction[1] === 'k') {
            effects.push(...await removeSession(chatId, session), answer(query, 'Đã hủy. Trạng thái yêu cầu được giữ nguyên.'));
          } else {
            await completeRejection(session, user, chatId, '', effects);
            effects.push(answer(query, 'Đã từ chối yêu cầu.'));
          }
          return effects;
        }
        const action = data.match(/^d\|([A-Za-z0-9_-]+)\|(0|[1-9]\d*)\|([ptarv])$/);
        if (!action) return [answer(query, 'Thao tác không hợp lệ.', true)];
        const [, requestId, expectedVersion, code] = action;
        const delivery = await store.getDelivery(requestId, user.id, chatId);
        if (!delivery || String(delivery.message_id) !== String(message.message_id)) {
          return [answer(query, 'Hãy dùng thông báo gốc bot đã gửi cho bạn.', true)];
        }
        const row = await currentRequest(requestId, user, expectedVersion, chatId);
        if (row.trang_thai === STATUS_CODES[code]) {
          return [answer(query, `Trạng thái hiện tại là ${row.trang_thai}. Yêu cầu được giữ nguyên.`)];
        }
        if (code === 'r') {
          const previous = await store.getSession(chatId);
          if (previous) effects.push(...await removeSession(chatId, previous));
          const session = await store.saveSession({ chatId, userId: user.id, requestId, expectedVersion });
          effects.push({ method: 'sendMessage', params: {
            chat_id: chatId,
            text: `Từ chối yêu cầu ${requestId}: trả lời trực tiếp tin nhắn này bằng lý do (tối đa 500 ký tự). Phiên có hiệu lực 15 phút. Chọn Bỏ qua để không ghi lý do hoặc Hủy để giữ nguyên trạng thái.`,
            reply_markup: { inline_keyboard: [[
              { text: 'Bỏ qua', callback_data: `s|${session.session_id}` },
              { text: 'Hủy', callback_data: `k|${session.session_id}` }
            ]] }
          }, session: { chatId, sessionId: session.session_id } });
          effects.push(answer(query, 'Hãy nhập lý do hoặc chọn Bỏ qua.'));
        } else {
          await decide({ requestId, user, status: STATUS_CODES[code], note: '', channel: 'telegram', expectedVersion });
          effects.push(answer(query, `Đã cập nhật: ${STATUS_CODES[code]}.`));
        }
        return effects;
      }

      const text = typeof message.text === 'string' ? message.text.trim() : '';
      const command = (text.match(/^\/(start|help|huy)(?:@[A-Za-z0-9_]+)?(?:\s|$)/) || [])[1];
      if (command === 'start') {
        await store.wakeDeliveries(chatId);
        return [send(chatId, `Bot quản lý nghỉ phép đã sẵn sàng. Phạm vi của bạn: ${normalizeCoSo(user.coSo)}. Các yêu cầu mới sẽ được gửi tại đây. Dùng /help để xem hướng dẫn.`)];
      }
      if (command === 'help') {
        return [send(chatId, 'Chọn trạng thái trên thông báo nghỉ phép: Chưa duyệt, Tạm duyệt, Đã duyệt, Từ chối hoặc Vi phạm. Từ chối sẽ hỏi lý do (tối đa 500 ký tự), có Bỏ qua và Hủy; trả lời đúng tin nhắn hỏi lý do trong 15 phút. /huy hủy phiên nhập lý do. Đã duyệt và Từ chối kết thúc thao tác trên Telegram; muốn thay đổi tiếp hãy mở trên web.' + (webUrl ? `\n${webUrl}` : ''))];
      }
      const session = await store.getSession(chatId);
      if (command === 'huy') {
        if (ownsSession(session, user, chatId)) effects.push(...await removeSession(chatId, session));
        effects.push(send(chatId, 'Đã hủy nhập lý do. Trạng thái yêu cầu được giữ nguyên.'));
        return effects;
      }
      if (!ownsSession(session, user, chatId) || session.prompt_message_id == null ||
          !message.reply_to_message || String(message.reply_to_message.message_id) !== String(session.prompt_message_id)) return [];
      if (sessionExpired(session)) {
        effects.push(...await removeSession(chatId, session));
        throw businessError('Phiên nhập lý do đã hết hạn sau 15 phút. Hãy chọn Từ chối lại.');
      }
      if (!text || text.length > 500) return [send(chatId, 'Lý do phải có từ 1 đến 500 ký tự. Trả lời lại tin nhắn hỏi lý do hoặc chọn Bỏ qua.')];
      await completeRejection(session, user, chatId, text, effects);
      effects.push(send(chatId, 'Đã từ chối yêu cầu và lưu lý do.'));
      return effects;
    } catch (error) {
      if (!isBusinessError(error)) throw error;
      effects.push(query ? answer(query, error.message, true) : send(chatId, error.message));
      return effects;
    }
  }

  return { handleUpdate };
}

module.exports = { createManagerLeaveBot, isEligibleManager, managerMatchesBranch };
