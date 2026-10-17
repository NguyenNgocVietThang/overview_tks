'use strict';

const STATUS_CODES = Object.freeze({
  a: 'Đã duyệt', r: 'Từ chối'
});
const FINAL_STATUSES = new Set(['Đã duyệt', 'Từ chối']);

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

// Budget escaped characters, so truncation cannot cut an HTML entity or tag.
function escapedValue(value, budget) {
  const raw = value == null || value === '' ? '—' : String(value);
  let result = '';
  for (const character of raw) {
    const escaped = escapeHtml(character);
    if (result.length + escaped.length > budget - 1) return result + '…';
    result += escaped;
  }
  return result;
}

function safeWebUrl(value) {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ?
      new URL('/humanresources/#leave', parsed.origin).href : null;
  } catch { return null; }
}

function vietnamTimestamp(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year} ${values.hour}:${values.minute}`;
}

const WEEKDAYS = ['chủ nhật', 'thứ hai', 'thứ ba', 'thứ tư', 'thứ năm', 'thứ sáu', 'thứ bảy'];
const MAX_FALLBACK_DAYS = 62;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(value) {
  const text = String(value || '').slice(0, 10);
  return ISO_DATE.test(text) && Number.isFinite(Date.parse(`${text}T00:00:00Z`)) ? text : '';
}

// Các thứ trong tuần của những ngày thực sự nghỉ: ưu tiên danh sách buổi đã chọn,
// đơn cũ chưa có danh sách thì lấy mọi ngày từ ngày bắt đầu đến ngày kết thúc.
function leaveWeekdays(row) {
  let days = Array.isArray(row.leave_sessions) ? row.leave_sessions.map(item => isoDay(item && item.date)).filter(Boolean) : [];
  if (!days.length) {
    const start = isoDay(row.start_date);
    const end = isoDay(row.end_date);
    if (start && end && start <= end) {
      const last = Date.parse(`${end}T00:00:00Z`);
      for (let time = Date.parse(`${start}T00:00:00Z`), count = 0; time <= last && count < MAX_FALLBACK_DAYS; time += 86400000, count++) {
        days.push(new Date(time).toISOString().slice(0, 10));
      }
    }
  }
  const names = [...new Set(days)].sort().map(day => WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]);
  if (!names.length) return '';
  const text = names.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function buildManagerLeaveMessage(request, { webUrl, canManage = true } = {}) {
  const row = request || {};
  const fields = [
    ['Họ tên', row.ho_ten, 2], ['Chức vụ', row.chuc_vu], ['Lý do nghỉ', row.ly_do, 4],
    ['Thời gian gửi', vietnamTimestamp(row.thoi_gian_gui)], ['Bắt đầu', row.thoi_gian_bat_dau], ['Kết thúc', row.thoi_gian_ket_thuc],
    ['Thời gian nghỉ', leaveWeekdays(row)],
    ['Tổng buổi nghỉ', row.tong_buoi_nghi], ['Tổng ngày nghỉ', row.tong_ngay_nghi], ['Người bàn giao', row.nguoi_ban_giao, 2],
    ['Trạng thái', row.trang_thai], ['Thời hạn đăng ký', row.timing_status || 'Chưa phân loại'],
    ['Thời điểm duyệt', vietnamTimestamp(row.thoi_diem_duyet)],
    ['Ghi chú duyệt', row.ghi_chu_duyet, 4]
  ];
  const heading = '<b>Yêu cầu nghỉ phép</b>\n';
  const overhead = heading.length + fields.reduce((total, [label]) => total + label.length + '<b></b>: \n'.length, 0);
  const weights = fields.reduce((total, field) => total + (field[2] || 1), 0);
  const available = 4095 - overhead;
  const text = heading + fields.map(([label, value, weight = 1]) =>
    `<b>${label}</b>: ${escapedValue(value, Math.floor(available * weight / weights))}`
  ).join('\n');

  const inline_keyboard = [];
  const requestId = String(row.request_id || '');
  const version = String(row.decision_version == null ? '' : row.decision_version);
  if (canManage && row.loai_yeu_cau === 'Xin nghỉ phép' && !FINAL_STATUSES.has(row.trang_thai) &&
      /^[A-Za-z0-9_-]+$/.test(requestId) && /^(0|[1-9]\d*)$/.test(version)) {
    const approve = { text: 'Phê duyệt', callback_data: `d|${requestId}|${version}|a` };
    const buttons = [];
    if (Buffer.byteLength(approve.callback_data, 'utf8') <= 64) buttons.push(approve);
    try {
      const origin = new URL(webUrl);
      if (origin.protocol === 'https:' && !origin.username && !origin.password) {
        const rejectUrl = new URL('/telegram/leave-reject.html', origin.origin);
        rejectUrl.searchParams.set('requestId', requestId);
        rejectUrl.searchParams.set('expectedVersion', version);
        buttons.push({ text: 'Từ chối', web_app: { url: rejectUrl.href } });
      }
    } catch { /* Invalid origin: never issue a MiniApp button. */ }
    if (buttons.length) inline_keyboard.push(buttons);
  }
  const url = safeWebUrl(webUrl);
  if (url) inline_keyboard.push([{ text: 'Mở trên web', url }]);
  return { text, parse_mode: 'HTML', reply_markup: { inline_keyboard } };
}
module.exports = { buildManagerLeaveMessage, STATUS_CODES, FINAL_STATUSES };
