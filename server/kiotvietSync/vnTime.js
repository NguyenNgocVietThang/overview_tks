'use strict';

// Ngay/gio theo lich VN cho cac job chay theo dem. Server khong dat TZ nen KHONG
// dung getHours()/toISOString() de biet "hom nay" - luon quy doi qua Intl.
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const VN_PARTS_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23'
});

function vnParts(date) {
  return Object.fromEntries(
    VN_PARTS_FORMATTER.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );
}

/** 'YYYY-MM-DD' theo lich VN (khong phai ngay UTC). */
function vnDateKey(date) {
  const { year, month, day } = vnParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function vnMinutesOfDay(date) {
  const { hour, minute } = vnParts(date);
  return hour * 60 + minute;
}

function addDaysToKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

module.exports = { VN_TIME_ZONE, vnDateKey, vnMinutesOfDay, addDaysToKey };
