'use strict';
// ==========================================
// CUSTOMER DEBT REPORT COMPUTE — port lai dung thuat toan cua
// src-dashboard/kiotviet/CustomerDebtReport.gs (Apps Script, tung sinh 3 tab
// HN1/HN3/HN7 tren Google Sheets) sang Postgres/Node.
//
// HN1/HN3/HN7 KHONG PHAI "no qua han N ngay" — la SO CHI TIET cong no tung
// khach hang trong N ngay gan day (du dau ky, ghi no/co tung giao dich ban
// hang/tra hang/thu chi, du cuoi ky), giong file KiotViet xuat
// "BaoCaoCongNoTheoKhachHang". Toan bo du lieu nguon (invoices, returns,
// invoice_payments, cash_flows, customers) da co san trong Postgres qua
// server/kiotvietSync/ nen khong can goi lai KiotViet API — chi doc lai va
// tinh toan giong het Apps Script.
//
// Module nay CHI TINH va TRA VE cac dong da tong hop (dung boi
// customerDebtReportRefresh.js de ghi xuong bang customer_debt_report_lines,
// xem 0014_customer_debt_report_lines.sql) — KHONG doc/ghi gi khac. Web
// KHONG goi thang module nay; server/dashboard/customerDebtPgReader.js moi la
// noi /api/dashboard doc (doc lai bang da tinh san, rat nhanh).
//
// LUU Y MUI GIO: giong dashboardPgReader.js, cac cot TIMESTAMPTZ trong DB la
// "gio treo tuong" cua KiotViet (VN) mang nhan UTC. Moi bien window
// start/end trong file nay deu duoc dung Date.UTC() voi cac thanh phan
// ngay/gio/thang cua GIO VIET NAM — de so sanh dung voi cot DB.
// ==========================================
const { statusLabel, INVOICE_STATUS_FALLBACK, RETURN_STATUS_FALLBACK } = require('../dashboard/dashboardPgReader');

const PERIODS = Object.freeze([{ days: 1 }, { days: 3 }, { days: 7 }]);
const MAX_PERIOD_DAYS = 7;

// ---------- Thoi gian: lam viec theo lich VN, nhan Date la UTC-labeled ----------
function vnTodayUtcLabeled() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => Number(parts.find(p => p.type === type).value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day'), 0, 0, 0, 0));
}

function addDaysUtc(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

// ---------- So hoc: giong customerDebtNumber_ ----------
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeText(value) {
  return value === null || value === undefined ? '' : String(value);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

// ---------- SQL ----------
const INVOICES_SQL = `-- HN1/HN3/HN7: hoa don "Hoan thanh" co khach hang trong cua so toi da 7 ngay
  SELECT id, code, purchase_date, customer_id, total::float8 AS total,
         COALESCE(raw->>'customerName', '') AS customer_name
  FROM invoices
  WHERE branch = $1 AND customer_id IS NOT NULL
    AND purchase_date >= $2 AND purchase_date < $3
    AND ${statusLabel(INVOICE_STATUS_FALLBACK)} = 'Hoàn thành'
  ORDER BY purchase_date`;

const RETURNS_SQL = `-- HN1/HN3/HN7: phieu tra "Da tra" co khach hang trong cua so toi da 7 ngay
  SELECT id, code, return_date, customer_id, total::float8 AS total,
         COALESCE(raw->>'customerName', '') AS customer_name
  FROM returns
  WHERE branch = $1 AND customer_id IS NOT NULL
    AND return_date >= $2 AND return_date < $3
    AND ${statusLabel(RETURN_STATUS_FALLBACK)} = 'Đã trả'
  ORDER BY return_date`;

const CASH_FLOWS_SQL = `-- HN1/HN3/HN7: phieu thu/chi voi khach hang (partnerType 'C') trong cua so
  SELECT id, code, is_receipt, amount::float8 AS amount, customer_id, trans_date,
         COALESCE(raw->>'status', '') AS status,
         COALESCE(raw->>'partnerName', '') AS partner_name
  FROM cash_flows
  WHERE branch = $1 AND customer_id IS NOT NULL
    AND trans_date >= $2 AND trans_date < $3`;

const CUSTOMERS_SQL = `-- Ho so day du cho khach xuat hien trong giao dich, cong khach moi tao
  -- trong cua so (can cho but toan khoi tao no dau ky, xem
  -- addInitializationAdjustments()).
  SELECT id, code, name, phone, debt::float8 AS debt, created_date, modified_date
  FROM customers
  WHERE branch = $1 AND (id = ANY($2::bigint[]) OR created_date >= $3)`;

const INVOICE_DETAILS_SQL = `-- Dong hang cua cac hoa don trong cua so, tra ten/nhom hang giong "Hàng hóa"
  SELECT d.invoice_id,
         COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '')     AS product_code,
         COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '')     AS product_name,
         COALESCE(NULLIF(d.raw->>'categoryName', ''), c.name, '')    AS category_name,
         d.price::float8    AS price,
         d.quantity::float8 AS quantity,
         d.discount::float8 AS discount,
         CASE WHEN d.raw ? 'subTotal' THEN (d.raw->>'subTotal')::float8
              ELSE d.price::float8 * d.quantity::float8 - d.discount::float8 END AS sub_total
  FROM invoice_details d
  LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
  LEFT JOIN categories c ON c.branch = p.branch AND c.id = p.category_id
  WHERE d.branch = $1 AND d.invoice_id = ANY($2::bigint[])
  ORDER BY d.invoice_id, d.line_no`;

const INVOICE_PAYMENTS_SQL = `-- Thanh toan cua cac hoa don trong cua so
  SELECT invoice_id, amount::float8 AS amount, trans_date,
         COALESCE(raw->>'code', '') AS code,
         COALESCE(raw->>'status', '') AS status
  FROM invoice_payments
  WHERE branch = $1 AND invoice_id = ANY($2::bigint[])`;

const RETURN_DETAILS_SQL = `-- Dong hang cua cac phieu tra trong cua so
  SELECT rd.return_id,
         COALESCE(NULLIF(rd.raw->>'productCode', ''), p.code, '')  AS product_code,
         COALESCE(NULLIF(rd.raw->>'productName', ''), p.name, '')  AS product_name,
         COALESCE(NULLIF(rd.raw->>'categoryName', ''), c.name, '') AS category_name,
         rd.price::float8    AS price,
         rd.quantity::float8 AS quantity,
         COALESCE((rd.raw->>'discount')::float8, 0) AS discount,
         CASE WHEN rd.raw ? 'subTotal' THEN (rd.raw->>'subTotal')::float8
              ELSE rd.price::float8 * rd.quantity::float8 - COALESCE((rd.raw->>'discount')::float8, 0) END AS sub_total
  FROM return_details rd
  LEFT JOIN products p ON p.branch = rd.branch AND p.id = rd.product_id
  LEFT JOIN categories c ON c.branch = p.branch AND c.id = p.category_id
  WHERE rd.branch = $1 AND rd.return_id = ANY($2::bigint[])
  ORDER BY rd.return_id, rd.line_no`;

// ---------- Xay dung profile khach hang (giong buildCustomerDebtProfile_) ----------
function buildProfile(row) {
  const id = String(row.id);
  return {
    key: 'id:' + id,
    id,
    code: safeText(row.code),
    name: safeText(row.name) || 'Khách lẻ',
    contactNumber: safeText(row.phone),
    group: '', // customers.raw khong co customerGroupDetails, giong dashboardPgReader.js
    closingDebt: num(row.debt),
    createdTimeMs: row.created_date ? row.created_date.getTime() : 0,
    modifiedTimeMs: row.modified_date ? row.modified_date.getTime() : 0
  };
}

// Ho so tam cho khach hang co giao dich nhung khong (con) co trong customers
// (hiem — vi du cache dong bo tre hon giao dich moi nhat).
function fallbackProfile(customerId, fallbackName) {
  const id = String(customerId);
  return {
    key: 'id:' + id, id, code: '', name: safeText(fallbackName) || 'Khách hàng',
    contactNumber: '', group: '', closingDebt: 0, createdTimeMs: 0, modifiedTimeMs: 0
  };
}

// ---------- Xay dung danh sach giao dich (giong buildCustomerDebtTransactions_) ----------
function buildTransactions({ customersById, invoices, invoiceDetailsByInvoice, invoicePaymentsByInvoice,
  returns, returnDetailsByReturn, cashFlows }) {
  const transactions = [];
  const transactionCodes = new Set();

  function resolveProfile(customerId, fallbackName) {
    return customersById.get(String(customerId)) || fallbackProfile(customerId, fallbackName);
  }

  function codeKey(customerKey, code) {
    const c = safeText(code).toLowerCase();
    return c ? customerKey + '|' + c : '';
  }

  function remember(t) {
    const k = codeKey(t.customerKey, t.code);
    if (k) transactionCodes.add(k);
  }

  function hasCode(t) {
    const k = codeKey(t.customerKey, t.code);
    return k ? transactionCodes.has(k) : false;
  }

  function toProductLines(details, isReturn) {
    const sign = isReturn ? -1 : 1;
    return details.map(d => ({
      productCode: d.product_code, productName: d.product_name, category: d.category_name,
      price: num(d.price), quantity: sign * num(d.quantity),
      amount: sign * num(d.sub_total), discount: sign * num(d.discount)
    }));
  }

  for (const inv of invoices) {
    const profile = resolveProfile(inv.customer_id, inv.customer_name);
    const customerKey = profile.key;
    const timeMs = inv.purchase_date ? inv.purchase_date.getTime() : 0;
    const productLines = toProductLines(invoiceDetailsByInvoice.get(inv.id) || [], false);
    const invoiceTxn = {
      customerKey, profile, code: safeText(inv.code), time: inv.purchase_date, timeMs,
      type: 'Bán hàng', value: num(inv.total), total: num(inv.total), productLines
    };
    transactions.push(invoiceTxn);
    remember(invoiceTxn);

    for (const payment of invoicePaymentsByInvoice.get(inv.id) || []) {
      if (Number(payment.status) === 1) continue; // 1 = da huy, giong Apps Script
      const time = payment.trans_date || inv.purchase_date;
      const paymentTxn = {
        customerKey, profile, code: safeText(payment.code), time, timeMs: time ? time.getTime() : 0,
        type: 'Thanh toán', value: -Math.abs(num(payment.amount)), total: 0, productLines: []
      };
      if (!hasCode(paymentTxn)) { transactions.push(paymentTxn); remember(paymentTxn); }
    }
  }

  for (const ret of returns) {
    const profile = resolveProfile(ret.customer_id, ret.customer_name);
    const returnTotal = num(ret.total);
    const productLines = toProductLines(returnDetailsByReturn.get(ret.id) || [], true);
    const returnTxn = {
      customerKey: profile.key, profile, code: safeText(ret.code), time: ret.return_date,
      timeMs: ret.return_date ? ret.return_date.getTime() : 0,
      type: 'Trả hàng', value: -returnTotal, total: -returnTotal, productLines
    };
    transactions.push(returnTxn);
    remember(returnTxn);
  }

  for (const cf of cashFlows) {
    // status rong hoac '0' = hop le; khac 0 (vd phieu bi huy) thi bo qua, giong Apps Script.
    if (cf.status !== '' && Number(cf.status) !== 0) continue;
    const profile = resolveProfile(cf.customer_id, cf.partner_name);
    const amount = Math.abs(num(cf.amount));
    const code = safeText(cf.code);
    const time = cf.trans_date;
    const cashFlowTxn = {
      customerKey: profile.key, profile, code, time, timeMs: time ? time.getTime() : 0,
      type: /^CB-/i.test(code) ? 'Điều chỉnh' : 'Thanh toán',
      value: cf.is_receipt ? -amount : amount, total: 0, productLines: []
    };
    if (!hasCode(cashFlowTxn)) { transactions.push(cashFlowTxn); remember(cashFlowTxn); }
  }

  return transactions;
}

// But toan khoi tao cho khach moi tao trong cua so, giong
// addCustomerDebtInitializationAdjustments_.
function addInitializationAdjustments(profiles, transactions, windowStartMs) {
  const byCustomer = new Map();
  for (const t of transactions) {
    if (!byCustomer.has(t.customerKey)) byCustomer.set(t.customerKey, []);
    byCustomer.get(t.customerKey).push(t);
  }

  for (const profile of profiles) {
    if (!profile.createdTimeMs || profile.createdTimeMs < windowStartMs) continue;
    const custTxns = byCustomer.get(profile.key) || [];
    if (custTxns.some(t => t.type === 'Điều chỉnh')) continue;
    const netMovement = custTxns.reduce((sum, t) => sum + t.value, 0);
    const initValue = profile.closingDebt - netMovement;
    if (Math.abs(initValue) < 0.0001) continue;
    const initTimeMs = profile.modifiedTimeMs >= profile.createdTimeMs ? profile.modifiedTimeMs : profile.createdTimeMs;
    transactions.push({
      customerKey: profile.key, profile, code: 'CB-KHOITAO-' + profile.code,
      time: new Date(initTimeMs), timeMs: initTimeMs, type: 'Điều chỉnh',
      value: initValue, total: 0, productLines: []
    });
  }
}

// ---------- Tong hop theo ky (giong aggregateCustomerDebtReport_) ----------
function aggregateForPeriod(transactions, periodStartMs, periodEndExclusiveMs) {
  const states = new Map();
  for (const t of transactions) {
    if (t.timeMs < periodStartMs || t.timeMs >= periodEndExclusiveMs) continue;
    if (!states.has(t.customerKey)) {
      states.set(t.customerKey, {
        profile: t.profile, openingDebt: 0, debit: 0, credit: 0,
        closingDebt: t.profile.closingDebt, transactions: []
      });
    }
    const state = states.get(t.customerKey);
    if (t.value >= 0) state.debit += t.value; else state.credit += Math.abs(t.value);
    state.transactions.push(t);
  }

  const rows = [];
  for (const state of states.values()) {
    state.openingDebt = state.closingDebt - state.debit + state.credit;
    state.transactions.sort((a, b) => (a.timeMs !== b.timeMs ? a.timeMs - b.timeMs : String(a.code).localeCompare(String(b.code))));
    let running = state.openingDebt;
    for (const t of state.transactions) {
      running += t.value;
      t.runningDebt = running;
    }
    rows.push(state);
  }
  rows.sort((a, b) => (b.closingDebt !== a.closingDebt ? b.closingDebt - a.closingDebt : String(a.profile.code).localeCompare(String(b.profile.code))));
  return rows;
}

// Tach gia tri 1 giao dich nhieu mat hang thanh nhieu dong (giong
// buildCustomerDebtTransactionReportLines_): dong cuoi nhan phan con lai de
// tong cac dong luon khop chinh xac gia tri/du no cua giao dich.
function buildTransactionReportLines(t) {
  const productLines = (t.productLines && t.productLines.length) ? t.productLines : [];
  const value = num(t.value);
  const runningDebt = num(t.runningDebt);
  if (!productLines.length) return [{ productLine: null, value, runningDebt }];

  let running = runningDebt - value;
  let allocated = 0;
  return productLines.map((pl, index) => {
    const isLast = index === productLines.length - 1;
    const lineValue = isLast ? value - allocated : num(pl.amount);
    allocated += lineValue;
    running += lineValue;
    return { productLine: pl, value: lineValue, runningDebt: running };
  });
}

// Chuyen 1 khach hang (state tra ve tu aggregateForPeriod) thanh cac dong
// phang de ghi xuong customer_debt_report_lines, giong het thu tu/cau truc
// buildCustomerDebtReportValues_ cua Apps Script nhung tra ve OBJECT (kieu du
// lieu that) thay vi mang gia tri hien thi — dinh dang hien thi (dd/MM/yyyy,
// lam tron) chuyen sang luc DOC (customerDebtPgReader.js), giong quy uoc
// dashboardPgReader.js.
function buildReportRows(rows, periodStartMs) {
  const out = [];
  for (const row of rows) {
    const opening = {
      code: '---', time: new Date(periodStartMs), type: 'Dư nợ đầu kỳ',
      value: row.openingDebt, runningDebt: row.openingDebt, total: 0, productLines: []
    };
    const base = {
      customerCode: row.profile.code, customerName: row.profile.name, phone: row.profile.contactNumber,
      customerGroup: row.profile.group, openingDebt: row.openingDebt, debit: row.debit,
      credit: row.credit, closingDebt: row.closingDebt
    };

    for (const t of [opening, ...row.transactions]) {
      for (const line of buildTransactionReportLines(t)) {
        const pl = line.productLine;
        out.push({
          ...base,
          txnCode: t.code, txnTime: t.time instanceof Date ? t.time : null, txnType: t.type,
          txnValue: line.value, runningDebt: line.runningDebt,
          productCode: pl ? pl.productCode : null, productName: pl ? pl.productName : null,
          categoryName: pl ? pl.category : null,
          price: pl ? pl.price : null, quantity: pl ? pl.quantity : null,
          amount: pl ? pl.amount : null, discount: pl ? pl.discount : null,
          total: num(t.total)
        });
      }
    }
  }
  return out;
}

/**
 * Tinh 3 ky HN1/HN3/HN7 cho 1 co so tu Postgres.
 * @param {string} branchCode dinh danh noi bo ('hanoi'/'saigon', xem server/db/SCHEMA.md)
 * @param {import('pg').Pool} pool
 * @returns {Promise<Array<{days:number, rows: object[]}>>}
 */
async function computeCustomerDebtReports(branchCode, pool) {
  if (branchCode !== 'hanoi' && branchCode !== 'saigon') {
    throw new Error(`Cơ sở không hợp lệ: ${branchCode}`);
  }

  const today = vnTodayUtcLabeled();
  const tomorrow = addDaysUtc(today, 1);
  const maxWindowStart = addDaysUtc(today, -(MAX_PERIOD_DAYS - 1));

  const [invoicesRes, returnsRes, cashFlowsRes] = await Promise.all([
    pool.query(INVOICES_SQL, [branchCode, maxWindowStart, tomorrow]),
    pool.query(RETURNS_SQL, [branchCode, maxWindowStart, tomorrow]),
    pool.query(CASH_FLOWS_SQL, [branchCode, maxWindowStart, tomorrow])
  ]);

  const invoiceIds = invoicesRes.rows.map(r => r.id);
  const returnIds = returnsRes.rows.map(r => r.id);
  const customerIds = [...new Set([
    ...invoicesRes.rows.map(r => r.customer_id),
    ...returnsRes.rows.map(r => r.customer_id),
    ...cashFlowsRes.rows.map(r => r.customer_id)
  ].filter(id => id !== null && id !== undefined))];

  const [customersRes, detailsRes, paymentsRes, returnDetailsRes] = await Promise.all([
    pool.query(CUSTOMERS_SQL, [branchCode, customerIds, maxWindowStart]),
    invoiceIds.length ? pool.query(INVOICE_DETAILS_SQL, [branchCode, invoiceIds]) : Promise.resolve({ rows: [] }),
    invoiceIds.length ? pool.query(INVOICE_PAYMENTS_SQL, [branchCode, invoiceIds]) : Promise.resolve({ rows: [] }),
    returnIds.length ? pool.query(RETURN_DETAILS_SQL, [branchCode, returnIds]) : Promise.resolve({ rows: [] })
  ]);

  const profiles = customersRes.rows.map(buildProfile);
  const customersById = new Map(profiles.map(p => [p.id, p]));

  const transactions = buildTransactions({
    customersById,
    invoices: invoicesRes.rows,
    invoiceDetailsByInvoice: groupBy(detailsRes.rows, 'invoice_id'),
    invoicePaymentsByInvoice: groupBy(paymentsRes.rows, 'invoice_id'),
    returns: returnsRes.rows,
    returnDetailsByReturn: groupBy(returnDetailsRes.rows, 'return_id'),
    cashFlows: cashFlowsRes.rows
  });
  addInitializationAdjustments(profiles, transactions, maxWindowStart.getTime());
  const validTransactions = transactions.filter(t => t.customerKey && t.timeMs > 0);

  return PERIODS.map(period => {
    const periodStart = addDaysUtc(today, -(period.days - 1));
    const aggregated = aggregateForPeriod(validTransactions, periodStart.getTime(), tomorrow.getTime());
    return { days: period.days, rows: buildReportRows(aggregated, periodStart.getTime()) };
  });
}

module.exports = { computeCustomerDebtReports, PERIODS };
