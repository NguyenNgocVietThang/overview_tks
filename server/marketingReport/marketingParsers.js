'use strict';

const norm = v => String(v ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('vi');
const text = v => v == null || String(v).startsWith('#') ? '' : String(v).trim();
function number(v) {
  if (v == null || !String(v).trim() || String(v).startsWith('#')) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const raw = String(v).trim();
  // Numbers normally arrive unformatted. Never coerce arbitrary strings to zero.
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
// Ô SĐT dạng số (UNFORMATTED_VALUE) mất số 0 đầu: 912345678 → 0912345678, 84912345678 → 0912345678.
function phoneText(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return text(v);
  const digits = String(Math.trunc(v));
  if (/^84\d{9}$/.test(digits)) return '0' + digits.slice(2);
  return digits.length === 9 ? '0' + digits : digits;
}
const key = (sheet, row, suffix = '') => JSON.stringify([sheet, row + 1, suffix]);
function dateParts(v) {
  if (typeof v === 'number') {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
  }
  const s = text(v);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { day: +m[3], month: +m[2], year: +m[1] };
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s|$)/.exec(s);
  return m ? { day: +m[1], month: +m[2], year: m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null } : null;
}
function dateText(v) {
  if (typeof v !== 'number') return text(v);
  const d = dateParts(v);
  return `${String(d.day).padStart(2, '0')}/${String(d.month).padStart(2, '0')}/${d.year}`;
}
function monthOfTitle(title) {
  const m = /(?:tháng|\bt)\s*(\d{1,2})(?:\D|$)/i.exec(title);
  return m && +m[1] >= 1 && +m[1] <= 12 ? +m[1] : null;
}
function parseMonthly(values, sheet) {
  if (!values.length || norm(values[0][0]) !== 'sale') throw new Error(`Thiếu tiêu đề BC tháng: ${sheet}`);
  const rows = values.slice(2).flatMap((r, i) => {
    if (![r[0], r[1], r[2], r[3]].some(text)) return [];
    return [{ key: key(sheet, i + 2), sale: text(r[0]), customer: text(r[1]), phone: phoneText(r[2]), page: text(r[3]), status: text(r[4]), dataSource: text(r[5]), closedAt: dateText(r[6]), revenue: number(r[7]), newCustomer: text(r[8]), note: text(r[9]) }];
  });
  const pages = values.slice(2).flatMap((r, i) => text(r[12]) ? [{ key: key(sheet, i + 2, 'page:'+text(r[12])), label: text(r[12]), page: text(r[12]), closed: number(r[13]), kind: 'page' }] : []);
  return { rows, pages, totalRevenue: number(values[1]?.[7]) };
}
function parseRanking(values, month) {
  const col = (values[0] || []).findIndex(v => /số đơn/i.test(text(v)) && monthOfTitle(text(v)) === month);
  if (col < 0) return [];
  return values.slice(2).flatMap((r, i) => text(r[0]) ? [{ key: key('BẢNG XẾP HẠNG', i + 2, `sale:${month}:${text(r[0])}:${text(r[6])}`), label: text(r[0]), employee: text(r[0]), page: text(r[6]), closed: number(r[col]), kind: 'sale' }] : []);
}
function parseCheck(values, sheet) {
  if (!values[0] || !norm(values[0][1]).includes('sđt lần đầu')) throw new Error(`Thiếu tiêu đề Check: ${sheet}`);
  const rows = values.slice(1).flatMap((r, i) => text(r[0]) && text(r[4]) ? [{ key: key(sheet, i + 1, `${text(r[0])}:${text(r[4])}:${text(r[5])}`), label: text(r[5]) || text(r[0]), name: text(r[0]), employee: text(r[5]), page: text(r[4]), first: number(r[1]), repeat: number(r[2]), equivalent: number(r[3]), closed: number(r[6]), rate: number(r[7]), kind: 'employee-page' }] : []);
  const employees = values.slice(2).flatMap((r, i) => text(r[16]) && !['nv', 'nhân viên'].includes(norm(r[16])) ? [{ key: key(sheet, i + 2, 'employee:'+text(r[16])), label: text(r[16]), employee: text(r[16]), first: number(r[17]), repeat: number(r[18]), equivalent: number(r[19]), closed: number(r[20]), rate: number(r[21]), kind: 'employee' }] : []);
  return { rows, employees };
}
function parsePhones(values, sheet, page) {
  const hi = values.findIndex(r => norm(r[0]) === 'số điện thoại');
  if (hi < 0) throw new Error(`Thiếu tiêu đề SĐT: ${sheet}`);
  return { rows: values.slice(hi + 1).flatMap((r, i) => text(r[0]) ? [{ key: key(sheet, hi + 1 + i, text(r[0])), phone: text(r[0]), firstEmployee: text(r[1]), currentEmployee: text(r[2]), repeatEmployee: text(r[3]), firstAt: dateText(r[4]), currentAt: dateText(r[5]), repeatAt: dateText(r[6]), page }] : []) };
}
const COST_PAGES = { 'chi phí hữu nghị+quảng châu': 'Hữu Nghị', 'chi phí bắc lãm': 'Bắc Lãm', 'chi phí tân thanh': 'Tân Thanh', 'chi phí phú lương': 'Phú Lương', 'chi phí dương nội': 'Dương Nội', 'chi phí ads-sg': 'HN-SG' };
function parseCosts(values, sheet) {
  const headers = values[0] || [];
  const starts = [];
  headers.forEach((v, i) => { if (/^(chi phí|tiền chạy trên fb)$/.test(norm(v))) starts.push(i - 1); });
  if (!starts.length) throw new Error(`Thiếu tiêu đề chi phí: ${sheet}`);
  const rows = [], totals = [];
  for (const [block, start] of starts.entries()) {
    const page = block === 1 && norm(sheet) === 'chi phí hữu nghị+quảng châu' ? 'Quảng Châu' : COST_PAGES[norm(sheet)] || sheet;
    let contextMonth = null, pending = [];
    const totalLabel = text(headers[start + 2]);
    values.slice(1).forEach((r, i) => {
      const v = r[start];
      const s = text(v);
      if (!s) return;
      const date = dateParts(v);
      const total = /^(?:tháng|tổng)/i.test(s);
      const m = /(?:tháng\s*|tổng\s*t)(\d{1,2})/i.exec(s);
      const record = { key: key(sheet, i + 1, String(block)), page, date: dateText(v), month: date?.month ?? (m ? +m[1] : contextMonth), adCost: number(r[start + 1]), totalCost: number(r[start + 2]), messages: number(r[start + 3]), costPerMessage: number(r[start + 4]), phones: number(r[start + 5]), costPerPhone: number(r[start + 6]), totalLabel };
      if (total) {
        if (m) contextMonth = +m[1];
        record.month = m ? +m[1] : contextMonth;
        totals.push(record);
        if (!record.month) pending.push(record);
      } else if (date && date.month >= 1 && date.month <= 12) {
        contextMonth = date.month;
        pending.forEach(t => { t.month = contextMonth; }); pending = [];
        rows.push(record);
      }
    });
  }
  return { rows, totals };
}
module.exports = { norm, text, phoneText, number, key, dateParts, dateText, monthOfTitle, parseMonthly, parseRanking, parseCheck, parsePhones, parseCosts, COST_PAGES };
