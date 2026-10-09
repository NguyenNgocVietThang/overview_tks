/**
 * ============================================================================
 * SPECIAL DAYS — TOKOSI DASHBOARD
 * Danh sách ngày lễ Việt Nam (dương lịch + âm lịch) và sinh nhật Nguyễn Ngọc
 * Việt Thắng. Một nguồn dữ liệu dùng chung:
 *   - Server: job thông báo chuông (notifications/specialDayNotifier.js)
 *   - Trình duyệt: shooting-star.js quyết định bắn pháo hoa thay sao băng
 * Dạng UMD (CommonJS + biến toàn cục TKSSpecialDays), không phụ thuộc thư viện.
 * Ngày luôn tính theo giờ Việt Nam (Asia/Ho_Chi_Minh), không theo múi giờ máy.
 * ============================================================================
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TKSSpecialDays = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
  var VN_OFFSET_HOURS = 7;

  // ---------------------------------------------------------------------------
  // Đổi dương lịch -> âm lịch (thuật toán Hồ Ngọc Đức, múi giờ +7)
  // ---------------------------------------------------------------------------
  function jdFromDate(dd, mm, yy) {
    var a = Math.floor((14 - mm) / 12);
    var y = yy + 4800 - a;
    var m = mm + 12 * a - 3;
    var jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4)
      - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
    if (jd < 2299161) {
      jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
    }
    return jd;
  }

  function getNewMoonDay(k, tz) {
    var T = k / 1236.85;
    var T2 = T * T;
    var T3 = T2 * T;
    var dr = Math.PI / 180;
    var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    var deltat;
    if (T < -11) {
      deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
    } else {
      deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
    }
    var JdNew = Jd1 + C1 - deltat;
    return Math.floor(JdNew + 0.5 + tz / 24);
  }

  function getSunLongitude(jdn, tz) {
    var T = (jdn - 2451545.5 - tz / 24) / 36525;
    var T2 = T * T;
    var dr = Math.PI / 180;
    var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    var DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
    var L = (L0 + DL) * dr;
    L = L - Math.PI * 2 * Math.floor(L / (Math.PI * 2));
    return Math.floor(L / Math.PI * 6);
  }

  function getLunarMonth11(yy, tz) {
    var off = jdFromDate(31, 12, yy) - 2415021;
    var k = Math.floor(off / 29.530588853);
    var nm = getNewMoonDay(k, tz);
    if (getSunLongitude(nm, tz) >= 9) nm = getNewMoonDay(k - 1, tz);
    return nm;
  }

  function getLeapMonthOffset(a11, tz) {
    var k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
    var last = 0;
    var i = 1;
    var arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
    do {
      last = arc;
      i++;
      arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
    } while (arc !== last && i < 14);
    return i - 1;
  }

  /** Trả { day, month, year, leap } âm lịch của ngày dương lịch (yy, mm, dd). */
  function solarToLunar(yy, mm, dd) {
    var tz = VN_OFFSET_HOURS;
    var dayNumber = jdFromDate(dd, mm, yy);
    var k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
    var monthStart = getNewMoonDay(k + 1, tz);
    if (monthStart > dayNumber) monthStart = getNewMoonDay(k, tz);
    var a11 = getLunarMonth11(yy, tz);
    var b11 = a11;
    var lunarYear;
    if (a11 >= monthStart) {
      lunarYear = yy;
      a11 = getLunarMonth11(yy - 1, tz);
    } else {
      lunarYear = yy + 1;
      b11 = getLunarMonth11(yy + 1, tz);
    }
    var lunarDay = dayNumber - monthStart + 1;
    var diff = Math.floor((monthStart - a11) / 29);
    var lunarLeap = 0;
    var lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
      var leapMonthDiff = getLeapMonthOffset(a11, tz);
      if (diff >= leapMonthDiff) {
        lunarMonth = diff + 10;
        if (diff === leapMonthDiff) lunarLeap = 1;
      }
    }
    if (lunarMonth > 12) lunarMonth -= 12;
    if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
    return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
  }

  // ---------------------------------------------------------------------------
  // Danh mục ngày đặc biệt
  // ---------------------------------------------------------------------------
  var BIRTHDAY_NAME = 'Nguyễn Ngọc Việt Thắng';

  // Dương lịch cố định, khoá "MM-DD".
  var SOLAR_DAYS = {
    '01-01': { key: 'new_year', type: 'holiday', title: '🎆 Chào năm mới', message: 'Hôm nay là Tết Dương lịch. TOKOSI chúc toàn thể anh chị em một năm mới sức khỏe, bình an và thật nhiều thành công!' },
    '03-08': { key: 'womens_day', type: 'holiday', title: '🌸 Quốc tế Phụ nữ 8/3', message: 'Hôm nay là Ngày Quốc tế Phụ nữ 8/3. TOKOSI gửi lời tri ân và chúc các chị em luôn xinh đẹp, hạnh phúc và tràn đầy năng lượng!' },
    '04-30': { key: 'reunification_day', type: 'holiday', title: '🇻🇳 Ngày Giải phóng miền Nam 30/4', message: 'Hôm nay là Ngày Giải phóng miền Nam, thống nhất đất nước 30/4. Chúc mọi người có kỳ nghỉ lễ thật vui, nạp đầy năng lượng bên gia đình!' },
    '05-01': { key: 'labour_day', type: 'holiday', title: '🛠️ Quốc tế Lao động 1/5', message: 'Hôm nay là Ngày Quốc tế Lao động 1/5. Cảm ơn mọi người đã cùng nhau nỗ lực mỗi ngày. Chúc cả nhà một ngày nghỉ thật thoải mái!' },
    '09-02': { key: 'national_day', type: 'holiday', title: '🇻🇳 Quốc khánh 2/9', message: 'Hôm nay là Quốc khánh 2/9. Chúc mọi người một kỳ nghỉ lễ vui vẻ, bình an bên người thân và bạn bè!' },
    '10-20': { key: 'vn_womens_day', type: 'holiday', title: '🌹 Ngày Phụ nữ Việt Nam 20/10', message: 'Hôm nay là Ngày Phụ nữ Việt Nam 20/10. Chúc các chị em luôn rạng rỡ, được yêu thương và trân trọng!' },
    '10-27': { key: 'birthday_thang', type: 'birthday', title: '🎂 Sinh nhật', message: 'Hôm nay là sinh nhật ' + BIRTHDAY_NAME + ' BA' },
    '11-20': { key: 'teachers_day', type: 'holiday', title: '📚 Ngày Nhà giáo Việt Nam 20/11', message: 'Hôm nay là Ngày Nhà giáo Việt Nam 20/11. Xin tri ân những người thầy, người cô đã dìu dắt chúng ta trưởng thành!' },
    '12-25': { key: 'christmas', type: 'holiday', title: '🎄 Giáng sinh', message: 'Hôm nay là Giáng sinh. Chúc mọi người một mùa Noel ấm áp, an lành bên gia đình và bạn bè!' }
  };

  // Âm lịch, khoá "tháng-ngày" (chỉ tháng thường, không tính tháng nhuận).
  var LUNAR_DAYS = {
    '1-1': { key: 'tet_1', type: 'holiday', title: '🧧 Mùng 1 Tết Nguyên đán', message: 'Mùng 1 Tết: TOKOSI chúc toàn thể anh chị em năm mới an khang, thịnh vượng, vạn sự như ý!' },
    '1-2': { key: 'tet_2', type: 'holiday', title: '🧧 Mùng 2 Tết Nguyên đán', message: 'Mùng 2 Tết: chúc mọi người một năm mới bình an, gặp nhiều may mắn và niềm vui bên gia đình!' },
    '1-3': { key: 'tet_3', type: 'holiday', title: '🧧 Mùng 3 Tết Nguyên đán', message: 'Mùng 3 Tết: chúc mọi người đủ đầy sức khỏe, công việc hanh thông, tài lộc dồi dào cả năm!' },
    '3-10': { key: 'hung_kings', type: 'holiday', title: '🏯 Giỗ Tổ Hùng Vương 10/3 âm lịch', message: 'Hôm nay là Giỗ Tổ Hùng Vương. "Dù ai đi ngược về xuôi, nhớ ngày Giỗ Tổ mùng mười tháng ba." Chúc mọi người một kỳ nghỉ lễ vui vẻ!' },
    '8-15': { key: 'mid_autumn', type: 'holiday', title: '🥮 Tết Trung thu', message: 'Hôm nay là Tết Trung thu 15/8 âm lịch. Chúc mọi người một đêm rằm sum vầy, ấm áp bên gia đình và các bé!' }
  };

  var TET_EVE = { key: 'tet_eve', type: 'holiday', title: '🧧 Giao thừa', message: 'Hôm nay là Giao thừa. Chúc mọi người đón năm mới sum vầy, bình an và khởi đầu một năm thật nhiều tài lộc!' };

  function parseKey(dateKey) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!m) return null;
    return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  }

  function nextDayParts(p) {
    var t = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }

  /**
   * Ngày đặc biệt của dateKey ('YYYY-MM-DD', đã là ngày VN) hoặc null.
   * Ưu tiên: dương lịch/sinh nhật trước, rồi âm lịch, cuối cùng Giao thừa.
   */
  function getSpecialDay(dateKey) {
    var p = parseKey(dateKey);
    if (!p) return null;
    var mm = ('0' + p.m).slice(-2);
    var dd = ('0' + p.d).slice(-2);
    var solar = SOLAR_DAYS[mm + '-' + dd];
    if (solar) return Object.assign({ dateKey: dateKey }, solar);

    var lunar = solarToLunar(p.y, p.m, p.d);
    if (!lunar.leap) {
      var hit = LUNAR_DAYS[lunar.month + '-' + lunar.day];
      if (hit) return Object.assign({ dateKey: dateKey }, hit);
    }

    // Giao thừa = ngày liền trước mùng 1 Tết (29 hoặc 30 tháng Chạp).
    var nx = nextDayParts(p);
    var nextLunar = solarToLunar(nx.y, nx.m, nx.d);
    if (nextLunar.month === 1 && nextLunar.day === 1 && !nextLunar.leap) {
      return Object.assign({ dateKey: dateKey }, TET_EVE);
    }
    return null;
  }

  /** 'YYYY-MM-DD' của thời điểm `now` theo giờ Việt Nam. */
  function todayKey(now) {
    var date = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: VN_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  }

  function getSpecialToday(now) {
    return getSpecialDay(todayKey(now));
  }

  return {
    VN_TIME_ZONE: VN_TIME_ZONE,
    BIRTHDAY_NAME: BIRTHDAY_NAME,
    solarToLunar: solarToLunar,
    getSpecialDay: getSpecialDay,
    getSpecialToday: getSpecialToday,
    todayKey: todayKey
  };
});
