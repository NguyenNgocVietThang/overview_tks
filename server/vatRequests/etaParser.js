'use strict';

// Doc cot "Ngay ve" (product_container_lines.eta) ra ngay that. Sheet CONT ghi tay kieu
// "DK 14-16/10", "DK 10/10", "14/10/2026", khong co nam -> suy nam gan ngay tham chieu nhat
// (ETA lech qua 6 thang ve truoc thi la nam sau, ve sau thi la nam truoc). Khoang ngay lay
// ngay DAU. Khong doc duoc thi tra date=null va giu nguyen van de giao dien hien chu.

const DATE_RE = /(\d{1,2})(?:\s*[-–~]\s*\d{1,2})?\s*[/.]\s*(\d{1,2})(?:\s*[/.]\s*(\d{2,4}))?/;

function vietnamToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: Number(part.value) }), {});
  return { year: parts.year, month: parts.month, day: parts.day };
}

function isValidDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function iso(year, month, day) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** parseEta('DK 14-16/10', { now }) -> { date: '2026-10-14', raw: 'DK 14-16/10' } */
function parseEta(rawValue, { now = new Date() } = {}) {
  const raw = String(rawValue == null ? '' : rawValue).trim();
  const match = DATE_RE.exec(raw);
  if (!match) return { date: null, raw };
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year;
  if (match[3]) {
    year = Number(match[3]);
    if (year < 100) year += 2000;
  } else {
    const today = vietnamToday(now);
    year = today.year;
    const diffMonths = (month - today.month);
    if (diffMonths < -6) year += 1;
    else if (diffMonths > 6) year -= 1;
  }
  if (!isValidDate(year, month, day)) return { date: null, raw };
  return { date: iso(year, month, day), raw };
}

// "Lich / Trang thai" = cot B + cot C cua dong nhan CONT, ghep y nhu expectedRefresh.js.
function scheduleLabel(statusLabel, eta) {
  return [statusLabel, eta].map(value => String(value == null ? '' : value).trim()).filter(Boolean).join(' ');
}

/**
 * Cont ve som nhat trong cac dong CONT chua ve (lines theo thu tu sheet): dong co ngay doc
 * duoc som nhat; khong dong nao doc duoc thi dong dau tien co ghi ngay ve, roi dong dau tien.
 * -> { containerName, scheduleLabel, date } (date chi de sap xep; null khi khong doc duoc).
 */
function nearestContainer(lines, options) {
  let best = null;
  let firstWithEta = null;
  for (const line of lines) {
    const parsed = parseEta(line.eta, options);
    if (!firstWithEta && parsed.raw) firstWithEta = line;
    if (parsed.date && (!best || parsed.date < best.date)) best = { line, date: parsed.date };
  }
  const line = best ? best.line : (firstWithEta || lines[0]);
  if (!line) return { line: null, containerName: '', scheduleLabel: '', date: null };
  return { line, containerName: String(line.containerName || '').trim(), scheduleLabel: scheduleLabel(line.statusLabel, line.eta), date: best ? best.date : null };
}

/**
 * Cont "4. Da ve" gan nhat (dung khi ma khong con cont chua ve): dong co ngay doc duoc muon nhat;
 * khong dong nao doc duoc thi dong dau tien (sheet xep cont moi ve len tren). -> { line, date } | null.
 */
function latestArrived(lines, options) {
  let best = null;
  for (const line of lines) {
    const parsed = parseEta(line.eta, options);
    if (parsed.date && (!best || parsed.date > best.date)) best = { line, date: parsed.date };
  }
  if (best) return best;
  return lines.length ? { line: lines[0], date: null } : null;
}

module.exports = { parseEta, nearestContainer, latestArrived, scheduleLabel, vietnamToday };
