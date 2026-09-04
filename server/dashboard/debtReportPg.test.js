'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { withTestPool } = require('../db/testPool');
const { computeDebtReport } = require('./debtReportPg');

async function insertCustomer(pool, branchId, { code, name, debt }) {
  const { rows } = await pool.query(
    `INSERT INTO customers (branch_id, customer_code, name, debt_amount) VALUES ($1, $2, $3, $4) RETURNING id`,
    [branchId, code, name, debt]
  );
  return rows[0].id;
}

async function insertInvoice(pool, branchId, customerId, { code, dateIso, totalPayment, status }) {
  await pool.query(
    `INSERT INTO invoices (branch_id, invoice_code, purchase_date, customer_id, total_amount, total_payment, status)
     VALUES ($1, $2, $3, $4, $5, $5, $6)`,
    [branchId, code, dateIso, customerId, totalPayment, status]
  );
}

async function insertReturn(pool, branchId, customerId, { code, dateIso, total, status }) {
  await pool.query(
    `INSERT INTO returns (branch_id, return_code, return_date, customer_id, return_total, status)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [branchId, code, dateIso, customerId, total, status]
  );
}

async function insertCashFlow(pool, branchId, customerId, { code, dateIso, amount, isReceipt, status = null }) {
  await pool.query(
    `INSERT INTO cash_flows (branch_id, code, trans_date, customer_id, amount, is_receipt, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [branchId, code, dateIso, customerId, amount, isReceipt, status]
  );
}

// now = 2026-08-30T10:00:00Z = 17:00 gio VN, ngay VN = 2026-08-30.
// days=3 -> cua so [2026-08-28 00:00+07:00, 2026-08-31 00:00+07:00).
const NOW = new Date('2026-08-30T10:00:00Z');

test('computeDebtReport: tinh dung openingDebt/runningDebt tu 4 loai giao dich trong cua so 3 ngay', async () => {
  await withTestPool('debt_core', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const kh1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'Nguyen Van A', debt: 500000 });

    // Trong cua so [28/08, 31/08 VN):
    await insertCashFlow(pool, branchId, kh1, { code: 'PC1', dateIso: '2026-08-28T08:00:00Z', amount: 10000, isReceipt: false }); // 15:00 VN 28/8, phieu chi -> debit
    await insertInvoice(pool, branchId, kh1, { code: 'HD1', dateIso: '2026-08-29T03:00:00Z', totalPayment: 200000, status: 1 }); // 10:00 VN 29/8 -> debit
    await insertReturn(pool, branchId, kh1, { code: 'TH1', dateIso: '2026-08-29T05:00:00Z', total: 50000, status: 1 }); // 12:00 VN 29/8 -> credit
    await insertCashFlow(pool, branchId, kh1, { code: 'PT1', dateIso: '2026-08-30T02:00:00Z', amount: 30000, isReceipt: true }); // 09:00 VN 30/8 -> credit

    // Ngoai cua so (truoc 28/8 VN) -> khong duoc tinh
    await insertInvoice(pool, branchId, kh1, { code: 'HD_OLD', dateIso: '2026-08-20T03:00:00Z', totalPayment: 999999, status: 1 });
    // Trong cua so nhung status != 1 (Hoan thanh o nghia thong thuong, nhung bao cao cong no chi nhan status=1) -> loai
    await insertInvoice(pool, branchId, kh1, { code: 'HD_STATUS3', dateIso: '2026-08-29T03:00:00Z', totalPayment: 777777, status: 3 });

    const result = await computeDebtReport(pool, branchId, 3, NOW);

    assert.equal(result.customers.length, 1);
    const row = result.customers[0];
    assert.equal(row.code, 'KH001');
    assert.equal(row.closingDebt, 500000);
    assert.equal(row.debit, 210000); // 10000 (PC1) + 200000 (HD1)
    assert.equal(row.credit, 80000); // 50000 (TH1) + 30000 (PT1)
    assert.equal(row.openingDebt, 370000); // 500000 - 210000 + 80000

    assert.equal(row.transactions.length, 4);
    assert.deepEqual(row.transactions.map((t) => t.code), ['PC1', 'HD1', 'TH1', 'PT1']);
    assert.equal(row.transactions[0].runningDebt, 380000);
    assert.equal(row.transactions[1].runningDebt, 580000);
    assert.equal(row.transactions[2].runningDebt, 530000);
    assert.equal(row.transactions[3].runningDebt, 500000); // == closingDebt, invariant sanity check

    assert.equal(result.kpi.totalClosingDebt, 500000);
    assert.equal(result.kpi.totalDebit, 210000);
    assert.equal(result.kpi.totalCredit, 80000);
    assert.equal(result.kpi.customersWithDebt, 1);
    assert.equal(result.kpi.customersCount, 1);
  });
});

test('computeDebtReport: khach khong co giao dich nao trong cua so thi KHONG xuat hien, du con no', async () => {
  await withTestPool('debt_notx', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    await insertCustomer(pool, branchId, { code: 'KH_NO_TX', name: 'No cu khong phat sinh', debt: 999999 });

    const result = await computeDebtReport(pool, branchId, 3, NOW);
    assert.equal(result.customers.length, 0);
    assert.equal(result.kpi.customersCount, 0);
  });
});

test('computeDebtReport: days=1 chi lay dung 1 ngay VN hom nay (ca ngay, khong phai 24h truoc gio hien tai)', async () => {
  await withTestPool('debt_days1', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const kh1 = await insertCustomer(pool, branchId, { code: 'KH001', name: 'A', debt: 100000 });
    // 2026-08-30T00:30:00Z = 07:30 VN ngay 30/8 -> nam trong ngay VN hom nay du la truoc gio "now" (17:00 VN)
    await insertInvoice(pool, branchId, kh1, { code: 'HD_EARLY_TODAY', dateIso: '2026-08-30T00:30:00Z', totalPayment: 50000, status: 1 });
    // 2026-08-29T16:00:00Z = 23:00 VN ngay 29/8 -> ngay VN truoc, khong tinh cho days=1
    await insertInvoice(pool, branchId, kh1, { code: 'HD_YESTERDAY', dateIso: '2026-08-29T16:00:00Z', totalPayment: 999999, status: 1 });

    const result = await computeDebtReport(pool, branchId, 1, NOW);
    assert.equal(result.customers.length, 1);
    assert.equal(result.customers[0].debit, 50000);
    assert.equal(result.customers[0].transactions.length, 1);
    assert.equal(result.customers[0].transactions[0].code, 'HD_EARLY_TODAY');
  });
});

test('computeDebtReport: sap xep khach theo closingDebt giam dan', async () => {
  await withTestPool('debt_sort', async (pool, branches) => {
    const branchId = branches.hanoi.id;
    const khLow = await insertCustomer(pool, branchId, { code: 'KH_LOW', name: 'Thap', debt: 10000 });
    const khHigh = await insertCustomer(pool, branchId, { code: 'KH_HIGH', name: 'Cao', debt: 900000 });
    await insertInvoice(pool, branchId, khLow, { code: 'A1', dateIso: '2026-08-29T03:00:00Z', totalPayment: 1000, status: 1 });
    await insertInvoice(pool, branchId, khHigh, { code: 'A2', dateIso: '2026-08-29T03:00:00Z', totalPayment: 1000, status: 1 });

    const result = await computeDebtReport(pool, branchId, 3, NOW);
    assert.equal(result.customers[0].code, 'KH_HIGH');
    assert.equal(result.customers[1].code, 'KH_LOW');
  });
});
