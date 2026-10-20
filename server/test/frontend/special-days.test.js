'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sd = require('../../public/shared/special-days');

function key(dateKey) {
  const day = sd.getSpecialDay(dateKey);
  return day && day.key;
}

test('âm lịch: mùng 1 Tết 2024–2028 khớp lịch thật', () => {
  assert.equal(key('2024-02-10'), 'tet_1');
  assert.equal(key('2025-01-29'), 'tet_1');
  assert.equal(key('2026-02-17'), 'tet_1');
  assert.equal(key('2027-02-06'), 'tet_1');
  assert.equal(key('2028-01-26'), 'tet_1');
});

test('Giao thừa là ngày liền trước mùng 1, cả năm tháng Chạp 29 và 30 ngày', () => {
  assert.equal(key('2024-02-09'), 'tet_eve'); // 30 tháng Chạp
  assert.equal(key('2025-01-28'), 'tet_eve'); // 29 tháng Chạp
  assert.equal(key('2026-02-16'), 'tet_eve'); // 29 tháng Chạp
  assert.equal(key('2026-02-15'), null); // 28 tháng Chạp không phải
});

test('mùng 2, mùng 3 Tết; mùng 4 thì không', () => {
  assert.equal(key('2026-02-18'), 'tet_2');
  assert.equal(key('2026-02-19'), 'tet_3');
  assert.equal(key('2026-02-20'), null);
});

test('Giỗ Tổ Hùng Vương 10/3 và Trung thu 15/8 âm lịch', () => {
  assert.equal(key('2024-04-18'), 'hung_kings');
  assert.equal(key('2025-04-07'), 'hung_kings');
  assert.equal(key('2026-04-26'), 'hung_kings');
  assert.equal(key('2024-09-17'), 'mid_autumn');
  assert.equal(key('2025-10-06'), 'mid_autumn');
  assert.equal(key('2026-09-25'), 'mid_autumn');
});

test('ngày lễ dương lịch cố định', () => {
  assert.equal(key('2026-01-01'), 'new_year');
  assert.equal(key('2026-03-08'), 'womens_day');
  assert.equal(key('2026-04-30'), 'reunification_day');
  assert.equal(key('2026-05-01'), 'labour_day');
  assert.equal(key('2026-09-02'), 'national_day');
  assert.equal(key('2026-10-20'), 'vn_womens_day');
  assert.equal(key('2026-11-20'), 'teachers_day');
  assert.equal(key('2026-12-25'), 'christmas');
});

test('27/10 là sinh nhật (notify: false, không gửi thông báo chuông, chỉ giữ hiệu ứng)', () => {
  for (const y of [2026, 2027, 2030]) {
    const day = sd.getSpecialDay(`${y}-10-27`);
    assert.equal(day.type, 'birthday');
    assert.equal(day.notify, false);
    assert.equal(day.message, undefined);
    assert.match(day.title, /Sinh nhật/);
  }
});

test('ngày thường, ngày sai định dạng và tháng nhuận không phải ngày đặc biệt', () => {
  assert.equal(sd.getSpecialDay('2026-10-09'), null);
  assert.equal(sd.getSpecialDay('2026-10-28'), null);
  assert.equal(sd.getSpecialDay('abc'), null);
  assert.equal(sd.getSpecialDay(''), null);
  assert.equal(sd.getSpecialDay(null), null);
});

test('mọi mục đều có title, type hợp lệ và message (ngoại trừ birthday không thông báo)', () => {
  const seen = new Set();
  for (let y = 2026; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const k = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (new Date(`${k}T00:00:00Z`).getUTCDate() !== d) continue;
        const day = sd.getSpecialDay(k);
        if (!day) continue;
        seen.add(day.key);
        assert.ok(day.title, k);
        if (day.type !== 'birthday') {
          assert.ok(day.message, k);
        }
        assert.ok(['holiday', 'birthday'].includes(day.type), k);
        assert.equal(day.dateKey, k);
      }
    }
  }
  // 9 lễ dương + sinh nhật + Giao thừa + 3 mùng + Giỗ Tổ + Trung thu = đủ trong 2 năm
  for (const k of ['new_year', 'birthday_thang', 'tet_eve', 'tet_1', 'tet_2', 'tet_3', 'hung_kings', 'mid_autumn', 'christmas']) {
    assert.ok(seen.has(k), `thiếu ${k}`);
  }
});

test('todayKey tính theo giờ Việt Nam, không theo múi giờ máy', () => {
  assert.equal(sd.todayKey(new Date('2026-10-26T16:59:00Z')), '2026-10-26'); // 23:59 VN
  assert.equal(sd.todayKey(new Date('2026-10-26T17:00:00Z')), '2026-10-27'); // 00:00 VN
  assert.equal(sd.getSpecialToday(new Date('2026-10-26T17:00:00Z')).key, 'birthday_thang');
  assert.equal(sd.getSpecialToday(new Date('2026-10-26T16:59:00Z')), null);
});
