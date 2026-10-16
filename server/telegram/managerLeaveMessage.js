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

function buildManagerLeaveMessage(request, { webUrl, canManage = true } = {}) {
  const row = request || {};
  const fields = [
    ['Mã yêu cầu', row.request_id], ['Họ tên', row.ho_ten, 2], ['Tài khoản web', row.web_username],
    ['Phòng ban', row.bo_phan], ['Chức vụ', row.chuc_vu], ['Cơ sở', row.co_so],
    ['Loại yêu cầu', row.loai_yeu_cau], ['Lý do nghỉ', row.ly_do, 4],
    ['Thời gian gửi', vietnamTimestamp(row.thoi_gian_gui)], ['Bắt đầu', row.thoi_gian_bat_dau], ['Kết thúc', row.thoi_gian_ket_thuc],
    ['Tổng buổi nghỉ', row.tong_buoi_nghi], ['Tổng ngày nghỉ', row.tong_ngay_nghi], ['Người bàn giao', row.nguoi_ban_giao, 2],
    ['Trạng thái', row.trang_thai], ['Thời hạn đăng ký', row.timing_status || 'Chưa phân loại'], ['Hạn đăng ký', row.registration_deadline_date],
    ['Người duyệt', row.nguoi_duyet], ['Thời điểm duyệt', vietnamTimestamp(row.thoi_diem_duyet)],
    ['Ghi chú duyệt', row.ghi_chu_duyet, 4], ['Nghỉ gấp', row.co_nghi_gap ? 'Có' : 'Không'],
    ['Tự ý nghỉ', row.co_tu_y_nghi ? 'Có' : 'Không']
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
