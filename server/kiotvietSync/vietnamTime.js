'use strict';

// KiotViet tra ve/nhan chuoi gio khong kem offset mui gio, nhung thuc te la
// gio Viet Nam (+07:00). Quen buoc cong offset nay se lech 7 tieng trong moi
// bao cao/checkpoint bucket theo ngay — xem PlanDB.md §3.6 va §9.3 cua
// PlanDB-Phase1-Spec.md. Moi noi convert giua KiotViet <-> Postgres TIMESTAMPTZ
// phai di qua day, khong tu cong offset rieng trong tung entity module.

const VIETNAM_OFFSET_HOURS = 7;
const VIETNAM_OFFSET_SUFFIX = '+07:00';
const VIETNAM_OFFSET_MS = VIETNAM_OFFSET_HOURS * 60 * 60 * 1000;

function parseKiotVietDateTime(naiveDateTimeString) {
  return new Date(`${naiveDateTimeString}${VIETNAM_OFFSET_SUFFIX}`);
}

function toKiotVietDateTimeParam(date) {
  const shifted = new Date(date.getTime() + VIETNAM_OFFSET_MS);
  return shifted.toISOString().slice(0, 19);
}

function todayInVietnam(now = new Date()) {
  const shifted = new Date(now.getTime() + VIETNAM_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

module.exports = { parseKiotVietDateTime, toKiotVietDateTimeParam, todayInVietnam };
