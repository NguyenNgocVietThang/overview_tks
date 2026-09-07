'use strict';

function addDaysToDateKey(dateKey, days) {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayVnDateKey() {
  const vnNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return vnNow.toISOString().slice(0, 10);
}

module.exports = { addDaysToDateKey, todayVnDateKey };
