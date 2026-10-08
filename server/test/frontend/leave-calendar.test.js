'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { defaultsForRole } = require('../../auth/featureRegistry');

const MODULE_PATH = path.join(__dirname, '..', '..', 'public', 'shared', 'shared-nav.js');
const moduleSource = fs.readFileSync(MODULE_PATH, 'utf8');

function fakeUser(vaiTro) {
  return { id: 'u1', vaiTro, permissions: defaultsForRole(vaiTro) };
}

// Hom nay gia lap = 02/10/2026.
function createEnv(t, fetchImpl) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="status-line">' +
      '<div class="account-chip" id="accountChip"></div>' +
    '</div></body></html>',
    { runScripts: 'dangerously', url: 'https://tokosi.example/' }
  );
  const { window } = dom;
  t.after(() => window.close());
  window.fetch = fetchImpl;
  window.eval(moduleSource);
  window.TKSNav._now = () => new Date(2026, 9, 2);
  return { window, document: window.document };
}

function leave(overrides) {
  return {
    request_id: 'NP-1', ho_ten: 'Nguyễn Văn A', bo_phan: 'KHO', co_so: 'Hà Nội',
    trang_thai: 'Đã duyệt', loai_yeu_cau: 'Xin nghỉ phép', ly_do: 'Việc gia đình',
    start_date: '2026-10-02', start_session: 'Sáng', end_date: '2026-10-02', end_session: 'Chiều',
    thoi_gian_bat_dau: 'Sáng 02/10/2026', thoi_gian_ket_thuc: 'Chiều 02/10/2026',
    tong_buoi_nghi: 2, tong_ngay_nghi: 1, nguoi_ban_giao: '', nguoi_duyet: 'Quản lý',
    co_nghi_gap: false,
    ...overrides
  };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function okFetch(requests, urls) {
  return async (url) => {
    if (urls) urls.push(String(url));
    return { ok: true, json: async () => ({ requests }) };
  };
}

test('lịch nằm giữa chip tài khoản và chuông, ẩn khi thiếu quyền hr.leave', t => {
  const a = createEnv(t, okFetch([]));
  a.window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  a.window.TKSNav.renderNotifBell(fakeUser('Trợ lý'));
  assert.deepEqual([...a.document.querySelector('.status-line').children].map(el => el.id),
    ['accountChip', 'tksLeaveCal', 'tksNotifBell']);
  a.window.close();

  const b = createEnv(t, okFetch([]));
  b.window.TKSNav.renderLeaveCalendar(fakeUser('Khách'));
  assert.equal(b.document.getElementById('tksLeaveCal'), null);
  b.window.close();
});

test('mở lịch: chọn sẵn hôm nay, gọi đúng from/to của tháng, lọc đơn Từ chối', async t => {
  const urls = [];
  const { window, document } = createEnv(t, okFetch([
    leave({ request_id: 'NP-1', ho_ten: 'An' }),
    leave({ request_id: 'NP-2', ho_ten: 'Bình', trang_thai: 'Từ chối' }),
    leave({ request_id: 'NP-3', ho_ten: 'Chi', trang_thai: 'Chưa duyệt', co_nghi_gap: true })
  ], urls));
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  document.getElementById('tksLeaveCalBtn').click();
  await tick();

  assert.deepEqual(urls, ['/api/hr/leave-requests?from=2026-10-01&to=2026-10-31']);
  const dropdown = document.getElementById('tksLeaveCalDropdown');
  assert.equal(dropdown.hidden, false);
  assert.equal(dropdown.querySelector('.is-selected').dataset.date, '2026-10-02');
  assert.match(dropdown.querySelector('.tks-cal-list-head').textContent, /02\/10\/2026 \(hôm nay\) · 2 người/);
  const names = [...dropdown.querySelectorAll('.tks-cal-item-name')].map(n => n.textContent.trim());
  assert.deepEqual(names, ['An', 'Chi Nghỉ gấp']);
  assert.equal(dropdown.querySelector('[data-date="2026-10-02"] .tks-cal-count').textContent, '2');
  assert.equal(dropdown.querySelector('[data-date="2026-10-03"] .tks-cal-count'), null);
  window.close();
});

test('chọn ngày khác đổi danh sách; bấm dòng mở chi tiết thời gian nghỉ', async t => {
  const { window, document } = createEnv(t, okFetch([
    leave({
      request_id: 'NP-9', ho_ten: 'Dũng',
      start_date: '2026-10-05', start_session: 'Chiều', end_date: '2026-10-07', end_session: 'Sáng',
      thoi_gian_bat_dau: 'Chiều 05/10/2026', thoi_gian_ket_thuc: 'Sáng 07/10/2026',
      tong_buoi_nghi: 4, tong_ngay_nghi: 2, ly_do: 'Đi khám'
    })
  ]));
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  document.getElementById('tksLeaveCalBtn').click();
  await tick();
  const dropdown = document.getElementById('tksLeaveCalDropdown');
  assert.match(dropdown.querySelector('.tks-cal-empty').textContent, /Không có ai nghỉ ngày này/);

  dropdown.querySelector('[data-date="2026-10-05"]').click();
  assert.equal(dropdown.querySelector('.tks-cal-when').textContent, 'Buổi chiều');
  dropdown.querySelector('[data-date="2026-10-06"]').click();
  assert.equal(dropdown.querySelector('.tks-cal-when').textContent, 'Cả ngày');
  dropdown.querySelector('[data-date="2026-10-07"]').click();
  assert.equal(dropdown.querySelector('.tks-cal-when').textContent, 'Buổi sáng');

  assert.equal(dropdown.querySelector('.tks-cal-detail').hidden, true);
  dropdown.querySelector('.tks-cal-item-head').click();
  const detail = dropdown.querySelector('.tks-cal-detail');
  assert.equal(detail.hidden, false);
  assert.match(detail.textContent, /Chiều 05\/10\/2026 → Sáng 07\/10\/2026/);
  assert.match(detail.textContent, /4 buổi \(2 ngày\)/);
  assert.match(detail.textContent, /Đi khám/);
  window.close();
});

test('đổi tháng gọi lại API đúng khoảng; lỗi API hiện thông báo', async t => {
  const urls = [];
  let fail = false;
  const { window, document } = createEnv(t, async (url) => {
    urls.push(String(url));
    if (fail) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => ({ requests: [] }) };
  });
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  document.getElementById('tksLeaveCalBtn').click();
  await tick();

  fail = true;
  document.querySelector('[data-nav="1"]').click();
  await tick();
  assert.equal(urls[1], '/api/hr/leave-requests?from=2026-11-01&to=2026-11-30');
  assert.match(document.querySelector('.tks-cal-title').textContent, /Tháng 11\/2026/);
  assert.match(document.querySelector('.tks-cal-empty').textContent, /Không tải được lịch nghỉ/);
  window.close();
});

test('đóng khi click ra ngoài hoặc nhấn Escape', async t => {
  const { window, document } = createEnv(t, okFetch([]));
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  const btn = document.getElementById('tksLeaveCalBtn');
  const dropdown = document.getElementById('tksLeaveCalDropdown');

  btn.click();
  await tick();
  assert.equal(dropdown.hidden, false);
  document.body.click();
  assert.equal(dropdown.hidden, true);

  btn.click();
  await tick();
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(dropdown.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  window.close();
});

test('dayCoverage: nghỉ đầu/giữa/cuối khoảng và nửa ngày', t => {
  const { window } = createEnv(t, okFetch([]));
  const { dayCoverage, coverageLabel } = window.TKSNav._leaveCalendar;
  const multi = { start_date: '2026-10-05', start_session: 'Chiều', end_date: '2026-10-07', end_session: 'Sáng' };
  assert.equal(coverageLabel(dayCoverage(multi, '2026-10-05')), 'Buổi chiều');
  assert.equal(coverageLabel(dayCoverage(multi, '2026-10-06')), 'Cả ngày');
  assert.equal(coverageLabel(dayCoverage(multi, '2026-10-07')), 'Buổi sáng');
  assert.equal(dayCoverage(multi, '2026-10-08'), null);
  const half = { start_date: '2026-10-05', start_session: 'Sáng', end_date: '2026-10-05', end_session: 'Sáng' };
  assert.equal(coverageLabel(dayCoverage(half, '2026-10-05')), 'Buổi sáng');
  window.close();
});

test('đơn kéo dài sang tháng khác chỉ gom phần trong tháng đang xem', t => {
  const { window } = createEnv(t, okFetch([]));
  const byDay = window.TKSNav._leaveCalendar.groupByDay([
    leave({ start_date: '2026-09-29', end_date: '2026-10-02' })
  ], 2026, 10);
  assert.deepEqual(Object.keys(byDay), ['2026-10-01', '2026-10-02']);
  window.close();
});

test('mở lại lịch sau khi đơn bị từ chối: không hiện trạng thái cũ, đơn Từ chối biến mất', async t => {
  let status = 'Chưa duyệt';
  let resolveSecond;
  let calls = 0;
  const init = [];
  const { window, document } = createEnv(t, (url, options) => {
    init.push(options);
    calls++;
    const body = { requests: [leave({ request_id: 'NP-5', ho_ten: 'Hà', trang_thai: status })] };
    if (calls === 1) return Promise.resolve({ ok: true, json: async () => body });
    // Lần mở thứ 2: giữ response lại để kiểm tra lúc chờ không lòi dữ liệu cũ.
    return new Promise(resolve => { resolveSecond = () => resolve({ ok: true, json: async () => body }); });
  });
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  const btn = document.getElementById('tksLeaveCalBtn');
  const dropdown = document.getElementById('tksLeaveCalDropdown');

  btn.click();
  await tick();
  assert.equal(dropdown.querySelector('.tks-cal-status').textContent, 'Chưa duyệt');
  btn.click(); // đóng

  status = 'Từ chối';
  btn.click(); // mở lại
  assert.equal(dropdown.querySelector('.tks-cal-status'), null);
  assert.match(dropdown.querySelector('.tks-cal-empty').textContent, /Đang tải/);
  resolveSecond();
  await tick();
  assert.equal(dropdown.querySelector('.tks-cal-status'), null);
  assert.match(dropdown.querySelector('.tks-cal-empty').textContent, /Không có ai nghỉ ngày này/);
  assert.ok(init.every(o => o.cache === 'no-store'));
  window.close();
});

test('lịch đang mở nghe SSE: có sự kiện thì cập nhật ngay, đóng lịch thì ngắt kết nối', async t => {
  let status = 'Chưa duyệt';
  let calls = 0;
  const { window, document } = createEnv(t, async () => {
    calls++;
    return { ok: true, json: async () => ({ requests: [leave({ request_id: 'NP-7', ho_ten: 'Khoa', trang_thai: status })] }) };
  });
  const sources = [];
  window.EventSource = class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
  };
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  const btn = document.getElementById('tksLeaveCalBtn');
  const dropdown = document.getElementById('tksLeaveCalDropdown');

  assert.equal(sources.length, 0);
  btn.click();
  await tick();
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, '/api/hr/leave-requests/stream');
  sources[0].onopen(); // lần nối đầu: không tải thêm
  await tick();
  assert.equal(calls, 1);
  assert.equal(dropdown.querySelector('.tks-cal-status').textContent, 'Chưa duyệt');

  status = 'Đã duyệt';
  sources[0].onmessage({ data: '{"type":"LEAVE_STATUS_CHANGED"}' });
  sources[0].onmessage({ data: '{"type":"LEAVE_STATUS_CHANGED"}' }); // gộp thành 1 lần tải
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(calls, 2);
  assert.equal(dropdown.querySelector('.tks-cal-status').textContent, 'Đã duyệt');

  status = 'Từ chối';
  sources[0].onopen(); // nối lại sau mất mạng: bù dữ liệu
  await tick();
  assert.equal(calls, 3);
  assert.equal(dropdown.querySelector('.tks-cal-status'), null);

  btn.click(); // đóng
  assert.equal(sources[0].closed, true);
  window.close();
});

test('phản hồi cũ về muộn không ghi đè dữ liệu mới (đơn đã từ chối không hiện lại)', async t => {
  const pending = [];
  const { window, document } = createEnv(t, () => new Promise(resolve => pending.push(resolve)));
  const sources = [];
  window.EventSource = class { constructor() { sources.push(this); } close() {} };
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  document.getElementById('tksLeaveCalBtn').click();
  const reply = (i, trang_thai) => pending[i]({
    ok: true, json: async () => ({ requests: [leave({ request_id: 'NP-8', ho_ten: 'Lan', trang_thai })] })
  });

  sources[0].onmessage({ data: '{"type":"LEAVE_STATUS_CHANGED"}' });
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(pending.length, 2); // [0] lần mở, [1] lần làm mới do sự kiện

  reply(1, 'Từ chối');   // phản hồi mới nhất về trước
  await tick();
  reply(0, 'Chưa duyệt'); // phản hồi cũ về sau
  await tick();
  const dropdown = document.getElementById('tksLeaveCalDropdown');
  assert.equal(dropdown.querySelector('.tks-cal-item'), null);
  window.close();
});

test('actual noncontiguous sessions leave gap dates empty in shared header calendar', t => {
  const { window } = createEnv(t, okFetch([]));
  const req = leave({ start_date: '2026-10-02', end_date: '2026-10-04', leave_sessions: [
    { date: '2026-10-02', session: 'Sáng' }, { date: '2026-10-04', session: 'Chiều' }
  ] });
  const calendar = window.TKSNav._leaveCalendar;
  assert.equal(calendar.dayCoverage(req, '2026-10-03'), null);
  assert.deepEqual(JSON.parse(JSON.stringify(calendar.dayCoverage(req, '2026-10-02'))), { morning: true, afternoon: false });
  assert.deepEqual(Object.keys(calendar.groupByDay([req], 2026, 10)), ['2026-10-02', '2026-10-04']);
});

test('shared leave calendar detail shows stored timing separately from approval', async t => {
  const { window, document } = createEnv(t, okFetch([leave({ timing_status: 'Xin muộn', registration_deadline_date: '2026-09-30' })]));
  window.TKSNav.renderLeaveCalendar(fakeUser('Trợ lý'));
  document.getElementById('tksLeaveCalBtn').click();
  await tick();
  document.querySelector('.tks-cal-item-head').click();
  const text = document.querySelector('.tks-cal-detail').textContent;
  assert.match(text, /Nhãn thời hạn khi gửiXin muộn/);
  assert.match(text, /30\/09\/2026 23:59:59/);
  assert.equal(document.querySelector('.tks-cal-status').textContent, 'Đã duyệt');
});
