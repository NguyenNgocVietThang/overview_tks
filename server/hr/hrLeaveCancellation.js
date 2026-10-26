'use strict';
const { getPool } = require('../db/pool');
const { HrError } = require('./hrLeaveRepository');
const { BRANCHES } = require('../branch/branches');

function cancellationEligibility(user, row, now = new Date()) {
  let reason = '';
  if (!row || !user?.id || String(row.user_id) !== String(user.id)) reason = 'Chỉ người xin nghỉ mới được hủy đơn của mình.';
  else if (row.loai_yeu_cau !== 'Xin nghỉ phép') reason = 'Chỉ được hủy đơn xin nghỉ phép.';
  else if (!row.first_session_start_at || !Number.isFinite(Date.parse(row.first_session_start_at))) reason = 'Đơn chưa có thời điểm bắt đầu buổi nghỉ hợp lệ.';
  else if (now.getTime() >= Date.parse(row.first_session_start_at)) reason = 'Đã đến thời điểm bắt đầu buổi nghỉ đầu tiên, không thể hủy đơn.';
  return { canCancel: !reason, cancelBlockedReason: reason };
}

function createHrLeaveCancellation({ pool, repo = require('./hrLeaveRepository'), authorization } = {}) {
  async function cancel(user, id, expectedVersion) {
    const version = String(expectedVersion ?? '');
    if (!/^(0|[1-9]\d*)$/.test(version) || version.length > 19 || BigInt(version) > 9223372036854775807n) throw new HrError('Phiên bản đơn không hợp lệ.',400,'INVALID_DECISION_VERSION');
    const request = await repo.getLeaveRequestById(id,[BRANCHES.HANOI,BRANCHES.SAIGON]);
    if (!request) throw new HrError('Không tìm thấy đơn nghỉ phép.',404,'LEAVE_REQUEST_NOT_FOUND');
    if (String(request.user_id) !== String(user.id)) throw new HrError('Chỉ người xin nghỉ mới được hủy đơn của mình.',403,'LEAVE_CANCEL_FORBIDDEN');
    // Only collect routing here. The SQL function rechecks every deletion condition under a lock.
    const routing = await authorization.routingFor(request);
    const recipients = routing.users.map(person => String(person.id));
    let rows;
    try { ({rows} = await (pool || getPool()).query('SELECT * FROM hr_cancel_own_leave($1,$2::text,$3::bigint,$4::text[])',[id,String(user.id),version,recipients])); }
    catch(error) {
      if (error.code === 'P0001' && error.message.includes('LEAVE_CANCEL_EXPIRED')) throw new HrError('Đã đến thời điểm bắt đầu buổi nghỉ đầu tiên, không thể hủy đơn.',409,'LEAVE_CANCEL_EXPIRED');
      throw error;
    }
    const result = rows[0];
    const errors = {
      NOT_FOUND:[404,'Không tìm thấy đơn nghỉ phép.','LEAVE_REQUEST_NOT_FOUND'],
      FORBIDDEN:[403,'Chỉ người xin nghỉ đang hoạt động mới được hủy đơn của mình.','LEAVE_CANCEL_FORBIDDEN'],
      TYPE:[403,'Chỉ được hủy đơn xin nghỉ phép.','LEAVE_CANCEL_TYPE_FORBIDDEN'],
      CONFLICT:[409,'Đơn đã thay đổi. Vui lòng tải lại và xác nhận hủy lần nữa.','LEAVE_DECISION_CONFLICT'],
      MISSING_START:[409,'Đơn chưa có thời điểm bắt đầu buổi nghỉ hợp lệ.','LEAVE_CANCEL_START_REQUIRED'],
      EXPIRED:[409,'Đã đến thời điểm bắt đầu buổi nghỉ đầu tiên, không thể hủy đơn.','LEAVE_CANCEL_EXPIRED']
    };
    if (errors[result.outcome]) { const [status,message,code] = errors[result.outcome]; throw new HrError(message,status,code); }
    if (result.outcome !== 'DELETED') throw new Error('Unexpected leave cancellation outcome');
    return {request_id:id,co_so:result.branch === 'saigon' ? BRANCHES.SAIGON : BRANCHES.HANOI,user_id:user.id};
  }
  return {cancel};
}
module.exports = {cancellationEligibility,createHrLeaveCancellation};
