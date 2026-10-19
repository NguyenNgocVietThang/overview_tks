'use strict';

// Doanh so tung khach trong thang (ban - tra hang) lay tu KiotViet qua bao cao kinh doanh.
// Noi voi dong BC thang theo TEN khach (cot "ID khach tren Kiot" la ten, ma khach HN va SG khong trung nhau),
// gop HN + SG khi cung ten.
//
// Hai duong, cung ket qua:
//   1. VIEW v_marketing_customer_revenue (migration 0069): thang da chot / thang hien tai tinh san
//      (business_monthly_customer_sales + business_current_month_customer_sales), ghep ten bang SQL
//      tks_name_key(). Chi hoi dung cac ten can tra => khong keo ca snapshot ve RAM.
//   2. Duong RAM cu: businessReportRepository.snapshot() roi ghep bang nameKey() trong JS. Dung khi thieu view /
//      bang, thang chua chot (khong phai thang hien tai), ban tinh san thang hien tai qua cu, hoac loi DB.

const { nameKey, FIRST_MONTH } = require('../businessReport/businessMonths');

// Ban tinh san thang hien tai (business_current_month_state.computed_at) cu hon moc nay thi bo qua view.
const CURRENT_MONTH_MAX_AGE_MS = 30 * 60 * 1000;

function vnMonthKey(nowMs) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Saigon', year: 'numeric', month: '2-digit' })
    .format(new Date(nowMs)).split('-').map(Number);
  return { year: y, month: m };
}

// Tab BC thang chi co so thang: thang lon hon thang hien tai (VN) thuoc nam truoc.
function resolveMonthKey(month, nowMs, explicitYear) {
  const { year: y, month: m } = vnMonthKey(nowMs);
  const year = explicitYear ?? (month > m ? y - 1 : y);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

const unavailable = key => ({ available: false, month: key, revenueOf: () => null });

function lookupFrom(key, byKey) {
  return {
    available: true, month: key,
    // Khach co trong KiotViet nhung khong phat sinh trong thang = 0; ten khong co = null.
    revenueOf(name) {
      const k = nameKey(name);
      if (!k) return null;
      return byKey.has(k) ? byKey.get(k) : null;
    }
  };
}

const VIEW_BY_NAMES_SQL = `SELECT v.name_key, v.net_revenue
  FROM v_marketing_customer_revenue v
  WHERE v.month = $1::date AND v.name_key IN (SELECT tks_name_key(n) FROM unnest($2::text[]) AS t(n))`;
const VIEW_MONTH_SQL = 'SELECT name_key, net_revenue FROM v_marketing_customer_revenue WHERE month = $1::date';

function createRevenueProvider({ repository, pool, now = Date.now } = {}) {
  // Co repository inject (test) ma khong co pool => chi dung duong RAM nhu truoc. Pool tao lazy luc dung lan dau.
  const getViewPool = () => pool ?? (repository ? null : require('../db/pool').getPool());
  let repo = repository;

  async function ramLookup(key) {
    repo ||= require('../businessReport/businessReportRepository').createRepository();
    const snap = await repo.snapshot();
    if (!snap.months.includes(key)) return unavailable(key);
    const totals = new Map();
    for (const r of snap.customers) {
      if (r.month !== key) continue;
      const k = nameKey(r.customerName);
      if (k) totals.set(k, (totals.get(k) || 0) + r.netRevenue);
    }
    const known = new Set(snap.directory.map(r => nameKey(r.name)).filter(Boolean));
    for (const k of known) if (!totals.has(k)) totals.set(k, 0);
    return lookupFrom(key, totals);
  }

  // null = khong dung duoc view cho thang nay (de duong RAM xu ly).
  async function viewLookup(key, names) {
    const viewPool = getViewPool();
    if (!viewPool) return null;
    const current = vnMonthKey(now());
    const currentKey = `${current.year}-${String(current.month).padStart(2, '0')}-01`;
    // Ngoai khoang FIRST_MONTH..thang hien tai: duong RAM cung tra "chua co du lieu".
    if (key < FIRST_MONTH || key > currentKey) return unavailable(key);
    if (key < currentKey) {
      const { rows } = await viewPool.query('SELECT 1 FROM business_monthly_state WHERE month = $1::date', [key]);
      if (!rows.length) return null;
    } else {
      const { rows } = await viewPool.query(
        'SELECT computed_at FROM business_current_month_state WHERE id = 1 AND month = $1::date', [key]);
      const computedAt = rows[0] ? new Date(rows[0].computed_at).getTime() : NaN;
      if (!Number.isFinite(computedAt) || now() - computedAt > CURRENT_MONTH_MAX_AGE_MS) return null;
    }
    const wanted = Array.isArray(names) ? [...new Set(names.filter(n => typeof n === 'string' && nameKey(n)))] : null;
    const { rows } = wanted
      ? (wanted.length ? await viewPool.query(VIEW_BY_NAMES_SQL, [key, wanted]) : { rows: [] })
      : await viewPool.query(VIEW_MONTH_SQL, [key]);
    return lookupFrom(key, new Map(rows.map(r => [r.name_key, Number(r.net_revenue)])));
  }

  // Tra ve { available, revenueOf(name) -> number|null }. options.names (tuy chon): cac ten khach se tra, de view
  // chi doc dung nhung ten do.
  return async function revenue(month, year, options = {}) {
    const key = resolveMonthKey(month, now(), year);
    let lookup = null;
    try { lookup = await viewLookup(key, options.names); } catch { lookup = null; }
    return lookup || ramLookup(key);
  };
}

module.exports = { createRevenueProvider, resolveMonthKey, CURRENT_MONTH_MAX_AGE_MS };
