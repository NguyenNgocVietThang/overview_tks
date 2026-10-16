'use strict';

const { createHash } = require('node:crypto');
const { isActiveApprover, normalizeDepartments, createHrLeaveAuthorization } = require('../hr/hrLeaveAuthorization');
const { buildManagerLeaveMessage } = require('./managerLeaveMessage');
const { normalizeCoSo, BRANCHES, BRANCH_BOTH, branchCodeToLabel } = require('../branch/branches');
const { STATUS_CODES } = require('./managerLeaveMessage');

const PHYSICAL_BRANCHES = [BRANCHES.HANOI, BRANCHES.SAIGON];
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SESSION_ACTION = new RegExp(`^([sk])\\|(${UUID})$`, 'i');
const STALE_MESSAGE = 'Yêu cầu đã thay đổi. Xem tin nhắn mới nhất và chọn lại.';
const FINAL_MESSAGE = 'Yêu cầu đã kết thúc trên Telegram (Đã duyệt/Từ chối). Có thể thay đổi trên web.';

function isEligibleManager(user, telegramId = user && user.telegramId) {
  return !!(isActiveApprover(user) && /^[1-9]\d*$/.test(String(user.telegramId || '')) && String(user.telegramId) === String(telegramId));
}

function managerMatchesBranch(user, requestBranch) {
  const scope = normalizeCoSo(user && (user.assignedCoSo !== undefined ? user.assignedCoSo : user.coSo));
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

function createManagerLeaveBot({ store, leaveRepo, decide, getManager, webUrl, authorization = createHrLeaveAuthorization() }) {
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
    await authorization.authorize(user, row);
    if (!['Chưa duyệt', 'Vi phạm'].includes(row.trang_thai)) throw businessError(FINAL_MESSAGE);
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

  async function showList(user, chatId, page = 0, departmentToken = '0', query) {
    const rows = await leaveRepo.getLeaveRequests({}, PHYSICAL_BRANCHES);
    const authorized = [];
    const described=authorization.describeRequests ? await authorization.describeRequests(user,rows) : null;
    for (const row of (described || rows)) if (row.loai_yeu_cau === 'Xin nghỉ phép' && ['Chưa duyệt', 'Vi phạm'].includes(row.trang_thai) && (described ? row.canManage : await authorization.canDecide(user, row))) authorized.push(row);
    const departments = normalizeDepartments(authorized.map(row => row.bo_phan).filter(Boolean)).sort((a,b)=>a.localeCompare(b,'vi'));
    const token=value=>createHash('sha256').update(value).digest('hex').slice(0,32);
    const department=departmentToken==='0' ? null : departments.find(value=>token(value)===departmentToken);
    if(departmentToken!=='0' && !department)throw businessError('Bộ lọc đã thay đổi. Hãy dùng /donnghi lại.',400);
    const filtered = department ? authorized.filter(row => normalizeDepartments([row.bo_phan])[0] === department) : authorized;
    const pages = Math.max(1, Math.ceil(filtered.length / 10)); page = Math.min(page,pages-1);
    const selected = filtered.slice(page*10,page*10+10);
    const keyboard = selected.map(row => [{text: String(row.ho_ten || row.request_id).slice(0,80),callback_data:`o|${row.request_id}|${row.decision_version}`}]).filter(buttons => Buffer.byteLength(buttons[0].callback_data)<=64);
    const filters = [{text:department ? 'Tất cả phòng ban' : '✓ Tất cả phòng ban',callback_data:'l|0|0'},...departments.map(value=>({text:(department===value?'✓ ':'')+value,callback_data:`l|0|${token(value)}`}))];
    for(let i=0;i<filters.length;i+=2)keyboard.push(filters.slice(i,i+2));
    const navigation=[];if(page>0)navigation.push({text:'← Trước',callback_data:`l|${page-1}|${departmentToken}`});if(page+1<pages)navigation.push({text:'Sau →',callback_data:`l|${page+1}|${departmentToken}`});if(navigation.length)keyboard.push(navigation);
    const params={chat_id:chatId,text:`Đơn cần xử lý — ${department || 'Tất cả phòng ban'}\nTrang ${page+1}/${pages} · ${filtered.length} đơn\n${selected.length ? 'Chọn tên để xem và xử lý đơn.' : 'Không có đơn cần xử lý.'}`,reply_markup:{inline_keyboard:keyboard}};
    return query ? [{method:'editMessageText',params:{...params,message_id:query.message.message_id}},answer(query,'Đã cập nhật danh sách.')] : [{method:'sendMessage',params}];
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
          [send(chatId, 'Bot dành cho tài khoản đang hoạt động có quyền quản lý nghỉ phép và Telegram ID đã liên kết.')];
      }

      if (query) {
        const data = typeof query.data === 'string' ? query.data : '';
        if (Buffer.byteLength(data, 'utf8') > 64) return [answer(query, 'Thao tác không hợp lệ.', true)];
        const listAction = data.match(/^l\|(0|[1-9]\d{0,5})\|(0|[a-f0-9]{32})$/);
        if(listAction) return await showList(user,chatId,Number(listAction[1]),listAction[2],query);
        const openAction = data.match(/^o\|([A-Za-z0-9_-]+)\|(0|[1-9]\d*)$/);
        if(openAction) {
          const row = await currentRequest(openAction[1],user,openAction[2],chatId);
          return [{method:'sendMessage',params:{chat_id:chatId,...buildManagerLeaveMessage(row,{webUrl})},delivery:{requestId:row.request_id,userId:user.id,chatId,version:row.decision_version}},answer(query,'Đã mở đơn.')];
        }
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
        const action = data.match(/^d\|([A-Za-z0-9_-]+)\|(0|[1-9]\d*)\|([ar])$/);
        if (!action) return [answer(query, 'Thao tác không hợp lệ.', true)];
        const [, requestId, expectedVersion, code] = action;
        const delivery = await store.getDelivery(requestId, user.id, chatId, message.message_id);
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
            text: `Từ chối yêu cầu ${requestId}: nhấn chuột phải hoặc chạm giữ tin nhắn này, chọn Trả lời (Reply), rồi gửi lý do (tối đa 500 ký tự). Phiên có hiệu lực 15 phút. Chọn Bỏ qua để không ghi lý do hoặc Hủy để giữ nguyên trạng thái.`,
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
      const command = (text.match(/^\/(start|help|huy|donnghi)(?:@[A-Za-z0-9_]+)?(?:\s|$)/) || [])[1];
      if (command === 'donnghi') return await showList(user,chatId);
      if (command === 'start') {
        await store.wakeDeliveries(chatId);
        return [send(chatId, `Bot quản lý nghỉ phép đã sẵn sàng. Phạm vi của bạn: ${normalizeCoSo(user.coSo)}. Các yêu cầu mới sẽ được gửi tại đây. Dùng /donnghi để lọc đơn cần xử lý, /help để xem hướng dẫn.`)];
      }
      if (command === 'help') {
        return [send(chatId, 'Chọn Phê duyệt hoặc Từ chối trên thông báo nghỉ phép. Phê duyệt lưu trạng thái Đã duyệt. Từ chối mở biểu mẫu lý do (tối đa 500 ký tự, có thể để trống), có Hủy. Phiên chat cũ vẫn nhận Reply trong 15 phút. /donnghi lọc đơn theo phòng ban. /huy hủy phiên nhập lý do. Đã duyệt và Từ chối kết thúc thao tác trên Telegram; muốn thay đổi tiếp hãy mở trên web.' + (webUrl ? `\n${webUrl}` : ''))];
      }
      const session = await store.getSession(chatId);
      if (command === 'huy') {
        if (ownsSession(session, user, chatId)) effects.push(...await removeSession(chatId, session));
        effects.push(send(chatId, 'Đã hủy nhập lý do. Trạng thái yêu cầu được giữ nguyên.'));
        return effects;
      }
      if (!ownsSession(session, user, chatId) || session.prompt_message_id == null) return [];
      if (sessionExpired(session)) {
        effects.push(...await removeSession(chatId, session));
        throw businessError('Phiên nhập lý do đã hết hạn sau 15 phút. Hãy chọn Từ chối lại.');
      }
      if (!message.reply_to_message || String(message.reply_to_message.message_id) !== String(session.prompt_message_id)) {
        return [{ method: 'sendMessage', params: {
          chat_id: chatId,
          text: `Chưa lưu lý do cho yêu cầu ${session.request_id}. Nhấn chuột phải hoặc chạm giữ tin nhắn hỏi lý do, chọn Trả lời (Reply), rồi gửi lại lý do. Bạn cũng có thể chọn Bỏ qua hoặc Hủy trên tin nhắn đó.`,
          reply_parameters: { message_id: Number(session.prompt_message_id), allow_sending_without_reply: true }
        } }];
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
