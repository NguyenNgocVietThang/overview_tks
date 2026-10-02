'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildManagerLeaveMessage } = require('./managerLeaveMessage');

function request(patch = {}) {
  return {
    request_id: 'NP-20261002-001', decision_version: '17',
    telegram_chat_id: '123', telegram_username: 'employee', web_username: 'nhanvien',
    ho_ten: 'Nguyễn <A>', chuc_vu: 'Nhân viên kho', co_so: 'Hà Nội', bo_phan: 'Kho',
    loai_yeu_cau: 'Xin nghỉ phép', ly_do: 'Khám & chữa bệnh', tin_nhan: '<script>hi</script>',
    thoi_gian_gui: '2026-10-01T14:00:00.000Z',
    thoi_gian_bat_dau: 'Sáng 02/10/2026', thoi_gian_ket_thuc: 'Chiều 02/10/2026',
    tong_buoi_nghi: 2, tong_ngay_nghi: 1, nguoi_ban_giao: 'Trần B',
    trang_thai: 'Chưa duyệt', nguoi_duyet: '', thoi_diem_duyet: '', ghi_chu_duyet: '',
    co_nghi_gap: true, co_tu_y_nghi: false,
    created_at: '2026-10-01T14:00:00.000Z', updated_at: '2026-10-01T14:00:00.000Z',
    ...patch
  };
}

test('renderer escapes employee text and offers only approval and rejection actions', () => {
  const message = buildManagerLeaveMessage(request(), { webUrl: 'https://dashboard.example/humanresources/' });
  assert.equal(message.parse_mode, 'HTML');
  for (const text of ['NP-20261002-001', 'Nguyễn &lt;A&gt;', 'Khám &amp; chữa bệnh', 'Hà Nội', 'Kho',
    'Sáng 02/10/2026', 'Chiều 02/10/2026', 'Trần B', 'Chưa duyệt']) {
    assert.ok(message.text.includes(text), text);
  }
  const buttons = message.reply_markup.inline_keyboard.flat();
  assert.deepEqual(buttons.filter(button => button.callback_data).map(button => button.callback_data).sort(), [
    'd|NP-20261002-001|17|a', 'd|NP-20261002-001|17|r'
  ]);
  assert.deepEqual(buttons.filter(button => button.callback_data).map(button => button.text), ['Phê duyệt', 'Từ chối']);
  assert.ok(buttons.some(button => button.url === 'https://dashboard.example/humanresources/#leave'));
});

test('renderer preserves a valid HTML message below the Telegram limit with extreme escaped values', () => {
  const huge = '<&"😀'.repeat(4000);
  const row = request(Object.fromEntries(Object.keys(request()).filter(key => !['decision_version', 'trang_thai'].includes(key)).map(key => [key, huge])));
  const message = buildManagerLeaveMessage(row, { webUrl: 'https://dashboard.example/humanresources/' });
  assert.ok(message.text.length < 4096);
  assert.equal((message.text.match(/<b>/g) || []).length, (message.text.match(/<\/b>/g) || []).length);
  assert.doesNotMatch(message.text.replace(/<\/?b>/g, ''), /[<>]/);
  assert.doesNotMatch(message.text.replace(/&(?:amp|lt|gt|quot);/g, ''), /&/);
  for (const label of ['Mã yêu cầu', 'Phòng ban', 'Cơ sở', 'Bắt đầu', 'Kết thúc', 'Người bàn giao', 'Ghi chú duyệt', 'Nghỉ gấp', 'Tự ý nghỉ']) {
    assert.ok(message.text.includes(label), label);
  }
  assert.equal(message.reply_markup.inline_keyboard.flat().filter(button => button.callback_data).length, 0);
});

test('final decisions and read-only recipients retain the web link without decision buttons', () => {
  for (const [status, canManage] of [['Đã duyệt', true], ['Từ chối', true], ['Vi phạm', false]]) {
    const message = buildManagerLeaveMessage(request({ trang_thai: status }), { webUrl: 'https://dashboard.example/hr', canManage });
    const buttons = message.reply_markup.inline_keyboard.flat();
    assert.equal(buttons.filter(button => button.callback_data).length, 0);
    assert.equal(buttons[0].url, 'https://dashboard.example/humanresources/#leave');
  }
});

test('renderer keeps bigint versions lossless and every callback within 64 bytes', () => {
  const message = buildManagerLeaveMessage(request({ decision_version: '9007199254740993' }), { webUrl: 'https://dashboard.example/hr' });
  const buttons = message.reply_markup.inline_keyboard.flat().filter(button => button.callback_data);
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(button.callback_data, /\|9007199254740993\|/);
    assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  }
});

test('renderer supplies essential context including zero durations and escaped rejection notes', () => {
  const message = buildManagerLeaveMessage(request({ tong_buoi_nghi: 0, tong_ngay_nghi: 0,
    nguoi_duyet: 'Manager & B', ghi_chu_duyet: '<Không bàn giao>', thoi_diem_duyet: '2026-10-02T00:00:00Z' }),
  { webUrl: 'https://dashboard.example/hr' });
  for (const text of ['Tổng buổi nghỉ</b>: 0', 'Tổng ngày nghỉ</b>: 0', 'Manager &amp; B', '&lt;Không bàn giao&gt;',
    '02/10/2026 07:00', 'Tài khoản web</b>: nhanvien']) {
    assert.ok(message.text.includes(text), text);
  }
});

test('manager messages show Vietnam timestamps and omit technical Telegram fields and raw messages', () => {
  const message = buildManagerLeaveMessage(request({ thoi_gian_gui: '2026-10-02T17:30:00Z' }), { webUrl: 'https://dashboard.example' });
  assert.ok(message.text.includes('03/10/2026 00:30'));
  for (const text of ['Telegram chat ID', 'Telegram username', 'Tin nhắn gốc', 'Cập nhật lúc', 'Tạo lúc', '&lt;script&gt;']) {
    assert.ok(!message.text.includes(text), text);
  }
  assert.equal(message.reply_markup.inline_keyboard.flat().find(button => button.url).url, 'https://dashboard.example/humanresources/#leave');
});

test('manual absence renderer retains the web link without Telegram decision buttons', () => {
  const message = buildManagerLeaveMessage(request({ loai_yeu_cau: 'Tự ý nghỉ (HR ghi nhận)' }), { webUrl: 'https://dashboard.example' });
  const buttons = message.reply_markup.inline_keyboard.flat();
  assert.equal(buttons.filter(button => button.callback_data).length, 0);
  assert.equal(buttons[0].url, 'https://dashboard.example/humanresources/#leave');
});

test('renderer rejects unsafe web URLs and does not issue unversioned actions', () => {
  const message = buildManagerLeaveMessage(request({ decision_version: undefined }), { webUrl: 'javascript:alert(1)' });
  assert.deepEqual(message.reply_markup.inline_keyboard, []);
});
