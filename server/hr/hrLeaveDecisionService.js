'use strict';

const leaveRepo = require('./hrLeaveRepository');
const leaveService = require('./hrLeaveService');
const { allowedBranches } = require('../branch/branches');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('./hrLeaveEvents');
const localUserStore = require('../auth/localUserStore');
const notificationRepo = require('../notifications/notificationRepository');

function createHrLeaveDecisionService({
  repo = leaveRepo,
  broadcast = broadcastLeaveEvent,
  notifyManagers = leaveService.notifyOtherManagers,
  findEmployee = username => localUserStore.getUserByUsername(username),
  notifyEmployee = payload => notificationRepo.createNotification(payload),
  logger = console
} = {}) {
  async function notifyDecision(updated, userId, note) {
    try {
      await notifyManagers(userId, updated.co_so, {
        type: 'leave_request_decision', title: 'Đơn nghỉ phép đã được cập nhật',
        message: `Đơn nghỉ phép của ${updated.ho_ten} đã chuyển sang trạng thái "${updated.trang_thai}".`,
        relatedType: 'leaveRequest', relatedId: updated.request_id
      });
      if (updated.web_username) {
        const employee = await findEmployee(updated.web_username);
        if (employee) await notifyEmployee({
          recipientUserId: employee.id, type: 'leave_request_decision',
          title: 'Đơn nghỉ phép của bạn đã được cập nhật',
          message: `Đơn nghỉ phép của bạn đã được ${updated.trang_thai}${note ? ` (${note})` : ''}.`,
          relatedType: 'leaveRequest', relatedId: updated.request_id
        });
      }
    } catch (err) {
      logger.error('[HR] Không thể gửi thông báo quyết định:', err.code || 'NOTIFICATION_FAILED');
    }
  }

  async function decide({ requestId, user, status, note, channel = 'web', expectedVersion }, { notify = true, broadcast: shouldBroadcast = true } = {}) {
    if (!status) throw new leaveRepo.HrError('Thiếu trường "status".', 400, 'INVALID_REQUEST');
    if (note != null && typeof note !== 'string') throw new leaveRepo.HrError('Lý do phải là chuỗi ký tự.', 400, 'INVALID_NOTE');
    const cleanNote = note == null ? undefined : note.trim();
    if (cleanNote && cleanNote.length > 500) throw new leaveRepo.HrError('Lý do tối đa 500 ký tự.', 400, 'INVALID_NOTE');
    if (channel === 'telegram' && !/^\d+$/.test(String(expectedVersion ?? ''))) {
      throw new leaveRepo.HrError('Phiên bản quyết định không hợp lệ.', 400, 'INVALID_DECISION_VERSION');
    }
    const data = { status, note: cleanNote, approver: leaveService.resolveApproverName(user), approverUserId: user && user.id };
    if (channel === 'telegram') Object.assign(data, { expectedVersion: String(expectedVersion), lockFinal: true });
    const updated = await repo.updateLeaveRequestStatus(requestId, data, allowedBranches(user));
    if (shouldBroadcast) broadcast(LEAVE_EVENT_TYPES.STATUS_CHANGED, updated, updated.co_so);
    if (notify) await notifyDecision(updated, user && user.id, cleanNote);
    return updated;
  }
  return { decide, notifyDecision };
}

module.exports = { createHrLeaveDecisionService };
