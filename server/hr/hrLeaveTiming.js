'use strict';
const SESSIONS = ['Sáng', 'Chiều'];
const DAY = 86400000;
function invalid(message, code = 'INVALID_LEAVE_RANGE', statusCode = 400) {
  return Object.assign(new Error(message), {code, statusCode});
}
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
}
function normalizeCalendar(body = {}) {
  let selected;
  if (body.leave_sessions !== undefined) {
    if (!Array.isArray(body.leave_sessions) || !body.leave_sessions.length) throw invalid('Vui lòng chọn ít nhất một buổi nghỉ.');
    selected = body.leave_sessions.map(item => ({date:item && item.date,session:item && item.session}));
  } else {
    const start = body.start_date;
    const end = body.end_date || start;
    if (!validDate(start) || !validDate(end) || !SESSIONS.includes(body.start_session) || !SESSIONS.includes(body.end_session)) throw invalid('Ngày hoặc buổi nghỉ không hợp lệ.');
    const first = Date.parse(start)/DAY*2 + SESSIONS.indexOf(body.start_session);
    const last = Date.parse(end)/DAY*2 + SESSIONS.indexOf(body.end_session);
    if (last < first || last-first > 20000) throw invalid('Khoảng thời gian nghỉ không hợp lệ.');
    selected = Array.from({length:last-first+1},(_,i)=>({date:new Date(Math.floor((first+i)/2)*DAY).toISOString().slice(0,10),session:SESSIONS[(first+i)%2]}));
  }
  if (selected.length > 20001 || selected.some(item => !validDate(item.date) || !SESSIONS.includes(item.session))) throw invalid('Ngày hoặc buổi nghỉ không hợp lệ.');
  selected.sort((a,b)=>a.date.localeCompare(b.date) || SESSIONS.indexOf(a.session)-SESSIONS.indexOf(b.session));
  if (new Set(selected.map(item=>item.date+item.session)).size !== selected.length) throw invalid('Buổi nghỉ bị chọn trùng.');
  const first=selected[0], last=selected.at(-1);
  return {leave_sessions:selected,totalSessions:selected.length,start_date:first.date,start_session:first.session,end_date:last.date,end_session:last.session};
}
function calculateTiming(calendar, schedule, submittedAt) {
  const time = schedule && (calendar.start_session === 'Sáng' ? schedule.morningStart : schedule.afternoonStart);
  if (typeof time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw invalid(`Chưa cấu hình giờ bắt đầu ${calendar.start_session} ngày ${calendar.start_date}. Quản lý cần cập nhật lịch làm việc.`, 'LEAVE_SCHEDULE_REQUIRED', 409);
  const firstSessionStartAt = new Date(`${calendar.start_date}T${time}:00+07:00`).toISOString();
  const deadlineDate = new Date(Date.parse(calendar.start_date) - (calendar.totalSessions <= 2 ? 2 : 3)*DAY).toISOString().slice(0,10);
  const deadlineExclusiveAt = new Date(Date.parse(`${deadlineDate}T00:00:00+07:00`) + DAY).toISOString();
  const sent= new Date(submittedAt).getTime();
  if (!Number.isFinite(sent)) throw invalid('Thời gian gửi không hợp lệ.');
  return {totalSessions:calendar.totalSessions,deadlineDate,deadlineExclusiveAt,firstSessionStartAt,scheduleVersion:String(schedule.version),timingStatus:sent >= Date.parse(firstSessionStartAt) ? 'Vi phạm' : sent >= Date.parse(deadlineExclusiveAt) ? 'Xin muộn' : 'Đúng hạn'};
}
module.exports={normalizeCalendar,calculateTiming,validDate};
