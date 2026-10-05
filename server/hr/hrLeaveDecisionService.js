'use strict';

const leaveRepo = require('./hrLeaveRepository');
const leaveService = require('./hrLeaveService');
const { allowedBranches } = require('../branch/branches');
const { broadcastLeaveEvent, LEAVE_EVENT_TYPES } = require('./hrLeaveEvents');
const localUserStore = require('../auth/localUserStore');
const notificationRepo = require('../notifications/notificationRepository');
const { createHrLeaveAuthorization } = require('./hrLeaveAuthorization');

function buildDecisionNote(status, approverName, role, reason) {
  if (status !== 'Đã duyệt' && status !== 'Từ chối') return reason;
  const lines = [`Người duyệt: ${[approverName, role].filter(Boolean).join(' - ')}`];
  if (status === 'Từ chối' && reason) lines.push(`Lý do từ chối: ${reason}`);
  return lines.join('\n');
}

function createHrLeaveDecisionService({
  repo = leaveRepo, authorization = createHrLeaveAuthorization(),
  broadcast = broadcastLeaveEvent, notifyManagers,
  findEmployee = username => localUserStore.getUserByUsername(username),
  notifyEmployee = payload => notificationRepo.createNotification(payload),
  logger = console
} = {}) {
  async function notifyDecision(updated, userId, note) {
    try {
      const payload = {type:'leave_request_decision',title:'Đơn nghỉ phép đã được cập nhật',
        message:`Đơn nghỉ phép của ${updated.ho_ten} đã chuyển sang trạng thái "${updated.trang_thai}".`,
        relatedType:'leaveRequest',relatedId:updated.request_id};
      if (notifyManagers) await notifyManagers(userId,updated.co_so,payload);
      else {
        const routing=await authorization.routingFor(updated);
        const recipients=routing.users.filter(user=>String(user.id)!==String(userId)).map(user=>user.id);
        if(recipients.length) await notificationRepo.createNotificationForUsers(recipients,payload);
      }
      if (updated.web_username) {
        const employee=await findEmployee(updated.web_username);
        if(employee) await notifyEmployee({recipientUserId:employee.id,type:'leave_request_decision',
          title:'Đơn nghỉ phép của bạn đã được cập nhật',message:`Đơn nghỉ phép của bạn đã được ${updated.trang_thai}${note ? ` (${note})` : ''}.`,
          relatedType:'leaveRequest',relatedId:updated.request_id});
      }
    } catch(err) {logger.error('[HR] Không thể gửi thông báo quyết định:',err.code||'NOTIFICATION_FAILED');}
  }
  async function decide({requestId,user,status,note,channel='web',expectedVersion},{notify=true,broadcast:shouldBroadcast=true}={}) {
    if(!Object.values(leaveRepo.LEAVE_STATUS).includes(status)) throw new leaveRepo.HrError('Trạng thái không hợp lệ.',400,'INVALID_STATUS');
    if(note!=null && typeof note!=='string') throw new leaveRepo.HrError('Lý do phải là chuỗi ký tự.',400,'INVALID_NOTE');
    const cleanNote=note==null ? undefined : note.trim();
    if(cleanNote && cleanNote.length>500) throw new leaveRepo.HrError('Lý do tối đa 500 ký tự.',400,'INVALID_NOTE');
    const version=String(expectedVersion ?? '');
    if(!/^(0|[1-9]\d*)$/.test(version) || version.length>19 || BigInt(version)>9223372036854775807n)
      throw new leaveRepo.HrError('Phiên bản quyết định không hợp lệ.',400,'INVALID_DECISION_VERSION');
    const request=await repo.getLeaveRequestById(requestId,allowedBranches(user));
    if(!request) throw new leaveRepo.HrError('Không tìm thấy yêu cầu nghỉ phép.',404,'LEAVE_REQUEST_NOT_FOUND');
    const currentUser=await authorization.authorize(user,request);
    const approverName=leaveService.resolveApproverName(currentUser);
    const finalNote=buildDecisionNote(status,approverName,currentUser.vaiTro,cleanNote);
    const updated=await repo.updateLeaveRequestStatus(requestId,{
      status,note:finalNote,approver:approverName,approverUserId:currentUser.id,
      expectedVersion:version,lockFinal:channel==='telegram'
    },allowedBranches(currentUser));
    if(shouldBroadcast) broadcast(LEAVE_EVENT_TYPES.STATUS_CHANGED,updated,updated.co_so);
    if(notify) await notifyDecision(updated,currentUser.id,finalNote);
    return updated;
  }
  return {decide,notifyDecision};
}
module.exports={createHrLeaveDecisionService};
