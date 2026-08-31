'use strict';

// Thuat toan doi chieu tu src-dashboard/kiotviet/CustomerDebtReport.gs (ban
// GAS goc, van dang chay production - KHONG duoc sua). Cac hang so/dieu kien
// duoi day trich dan chinh xac dong tuong ung trong file do, doc truc tiep
// thay vi suy dien tu tom tat trong PlanDB-Phase2-Spec.md §6.1 (spec tu ghi
// ro yeu cau nay).

// CustomerDebtReport.gs:253, :285 - bao cao cong no CHI nhan invoice/return
// co status === 1. Luu y: day KHONG phai "Hoan thanh" theo nghia dashboard
// tong quan (status=3 cho invoices - xem overviewQueries.js) - day la 1 vi du
// cu the cho su khong nhat quan ma trang thai da duoc PlanDB.md §9 canh bao
// truoc (cung 1 con so status co the mang y nghia khac nhau o tung endpoint/
// bao cao). KHONG suy dien lai, dung dung gia tri code goc dang loc.
const DEBT_INVOICE_STATUS_VALID = 1;
const DEBT_RETURN_STATUS_VALID = 1;

// GHI CHU LECH VOI CustomerDebtReport.gs: ban .gs goc dung `invoice.total`
// (= total_amount) lam gia tri ghi no, VA CONG THEM 1 giao dich rieng
// 'Thanh toan' tu invoice.payments[] (khong co bang tuong duong trong schema
// Postgres Phase 1 - khong co invoice_payments). PlanDB-Phase2-Spec.md §6.1
// (hop dong duoc duyet cho module nay) thay the ca 2 thu do bang 1 gia tri
// duy nhat: ghi no = total_payment. Day la lua chon co chu dich cua spec (bu
// lai viec thieu invoice_payments), KHONG phai loi doc nham - xem
// PHASE2_PG_MODULES.md muc "Known gaps" de biet chi tiet va cach xac minh lai
// truoc khi cutover that.
const DEBT_INVOICE_VALUE_COLUMN = 'total_payment';

function toVietnamDateString(date) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

// CustomerDebtReport.gs:168-186 (getCustomerDebtReportRange_) - cua so la
// N ngay lich VN GAN NHAT bao gom ca hom nay, KHONG PHAI "N*24h truoc gio
// hien tai". start = 00:00 VN cua ngay (now - (N-1) ngay); endExclusive =
// 00:00 VN cua ngay hom sau "now".
function getDebtReportRange(now, days) {
  const d = Math.max(1, Number(days) || 1);
  const startCandidate = new Date(now.getTime() - (d - 1) * 86400000);
  const tomorrow = new Date(now.getTime() + 86400000);
  const startDateStr = toVietnamDateString(startCandidate);
  const tomorrowDateStr = toVietnamDateString(tomorrow);
  return {
    start: new Date(`${startDateStr}T00:00:00+07:00`),
    endExclusive: new Date(`${tomorrowDateStr}T00:00:00+07:00`)
  };
}

async function computeDebtReport(pool, branchId, days, now) {
  const range = getDebtReportRange(now, days);

  const { rows: invoiceRows } = await pool.query(
    `SELECT customer_id, invoice_code AS code, purchase_date AS time, ${DEBT_INVOICE_VALUE_COLUMN} AS value
     FROM invoices
     WHERE branch_id = $1 AND status = $2 AND customer_id IS NOT NULL
       AND purchase_date >= $3 AND purchase_date < $4`,
    [branchId, DEBT_INVOICE_STATUS_VALID, range.start, range.endExclusive]
  );
  const { rows: returnRows } = await pool.query(
    `SELECT customer_id, return_code AS code, return_date AS time, return_total AS value
     FROM returns
     WHERE branch_id = $1 AND status = $2 AND customer_id IS NOT NULL
       AND return_date >= $3 AND return_date < $4`,
    [branchId, DEBT_RETURN_STATUS_VALID, range.start, range.endExclusive]
  );
  const { rows: cashFlowRows } = await pool.query(
    `SELECT customer_id, code, trans_date AS time, amount, is_receipt
     FROM cash_flows
     WHERE branch_id = $1 AND customer_id IS NOT NULL AND (status IS NULL OR status = 0)
       AND trans_date >= $2 AND trans_date < $3`,
    [branchId, range.start, range.endExclusive]
  );

  const { rows: customerRows } = await pool.query(
    `SELECT id, customer_code AS code, name, debt_amount FROM customers WHERE branch_id = $1`,
    [branchId]
  );
  const customersById = new Map(customerRows.map((c) => [c.id, c]));

  const transactionsByCustomer = new Map();
  function push(customerId, transaction) {
    if (!transactionsByCustomer.has(customerId)) transactionsByCustomer.set(customerId, []);
    transactionsByCustomer.get(customerId).push(transaction);
  }

  invoiceRows.forEach((r) => push(r.customer_id, { code: r.code, time: r.time, type: 'Bán hàng', value: Number(r.value) }));
  returnRows.forEach((r) => push(r.customer_id, { code: r.code, time: r.time, type: 'Trả hàng', value: -Number(r.value) }));
  cashFlowRows.forEach((r) =>
    push(r.customer_id, { code: r.code, time: r.time, type: 'Thanh toán', value: r.is_receipt ? -Number(r.amount) : Number(r.amount) })
  );

  const customers = [];
  for (const [customerId, transactions] of transactionsByCustomer.entries()) {
    const customer = customersById.get(customerId);
    if (!customer) continue;

    // CustomerDebtReport.gs:507-510 - sap theo thoi gian tang dan, tie-break
    // bang so sanh chuoi ma giao dich.
    transactions.sort((a, b) => a.time.getTime() - b.time.getTime() || String(a.code).localeCompare(String(b.code)));

    const closingDebt = Number(customer.debt_amount);
    const debit = transactions.filter((t) => t.value >= 0).reduce((sum, t) => sum + t.value, 0);
    const credit = transactions.filter((t) => t.value < 0).reduce((sum, t) => sum + Math.abs(t.value), 0);
    const openingDebt = closingDebt - debit + credit;

    let runningDebt = openingDebt;
    const withRunning = transactions.map((t) => {
      runningDebt += t.value;
      return { ...t, time: t.time.toISOString(), runningDebt };
    });

    customers.push({
      code: customer.code,
      name: customer.name,
      openingDebt,
      debit,
      credit,
      closingDebt,
      transactions: withRunning
    });
  }

  customers.sort((a, b) => b.closingDebt - a.closingDebt || String(a.code).localeCompare(String(b.code)));

  const kpi = {
    totalClosingDebt: customers.reduce((sum, c) => sum + c.closingDebt, 0),
    totalDebit: customers.reduce((sum, c) => sum + c.debit, 0),
    totalCredit: customers.reduce((sum, c) => sum + c.credit, 0),
    customersWithDebt: customers.filter((c) => c.closingDebt > 0).length,
    customersCount: customers.length
  };

  return { customers, kpi };
}

module.exports = { computeDebtReport, getDebtReportRange };
