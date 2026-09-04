'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncInvoices } = require('./invoicesSync');

function makeSchemaName() {
  return 'test_invoices_' + Math.random().toString(36).slice(2, 10);
}

async function withTestPool(fn) {
  const schemaName = makeSchemaName();
  const setupPool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await setupPool.query(`CREATE SCHEMA "${schemaName}"`);

  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false,
    options: `-c search_path="${schemaName}"`
  });

  try {
    const setupClient = await pool.connect();
    try {
      await runMigrations(setupClient);
    } finally {
      setupClient.release();
    }
    const hanoi = (await pool.query(`SELECT id, code FROM branches WHERE code = 'hanoi'`)).rows[0];
    await fn(pool, { id: hanoi.id, code: hanoi.code });
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

function fakeClient(pages) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      for (const page of pages) {
        if (page instanceof Error) throw page;
        await onPage(page, {});
      }
    }
  };
}

function sampleInvoice(overrides = {}) {
  return {
    id: 217962948,
    code: 'HD022301',
    purchaseDate: '2026-08-30T09:52:21.7870000',
    orderCode: 'DH034717',
    customerId: 31770180,
    customerCode: 'KH008574',
    customerName: 'KH C',
    soldById: 1494955,
    soldByName: 'Pham Thi Phuong Anh',
    branchId: 1325349,
    branchName: 'Chi nhanh trung tam',
    total: 3150000,
    discount: 0,
    totalPayment: 3150000,
    status: 1,
    description: 'Ghi chu',
    usingCod: false,
    modifiedDate: '2026-08-30T09:52:21.8170000',
    invoiceDetails: [
      { productId: 48047322, productCode: 'GLNL11', productName: 'Gio luoi', quantity: 300, price: 11000, discount: 500, discountRatio: 0, subTotal: 3150000 }
    ],
    ...overrides
  };
}

test('syncInvoices: upsert lan dau tao header + line items dung field mapping', async () => {
  await withTestPool(async (pool, branch) => {
    const result = await syncInvoices(pool, fakeClient([[sampleInvoice()]]), branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const invoice = (await pool.query('SELECT * FROM invoices WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(invoice.kiotviet_id), 217962948);
    assert.equal(invoice.invoice_code, 'HD022301');
    assert.equal(Number(invoice.total_amount), 3150000);
    assert.equal(invoice.customer_id, null, 'chua co customer tuong ung thi customer_id la null');
    assert.equal(invoice.customer_code_snapshot, 'KH008574');

    const staff = (await pool.query('SELECT * FROM staff WHERE branch_id = $1 AND kiotviet_id = 1494955', [branch.id])).rows[0];
    assert.ok(staff, 'phai suy ra duoc nhan vien tu SoldById');
    assert.equal(invoice.sold_by_staff_id, staff.id);

    const lines = (await pool.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY line_no', [invoice.id])).rows;
    assert.equal(lines.length, 1);
    assert.equal(lines[0].line_no, 0);
    assert.equal(lines[0].product_code_snapshot, 'GLNL11');
    assert.equal(Number(lines[0].quantity), 300);
    assert.equal(Number(lines[0].line_amount), 3150000);
  });
});

test('syncInvoices: customer_id duoc resolve dung khi customer da ton tai', async () => {
  await withTestPool(async (pool, branch) => {
    const customer = await pool.query(
      `INSERT INTO customers (branch_id, kiotviet_id, customer_code, name) VALUES ($1, 31770180, 'KH008574', 'KH C') RETURNING id`,
      [branch.id]
    );
    await syncInvoices(pool, fakeClient([[sampleInvoice()]]), branch, null);
    const invoice = (await pool.query('SELECT customer_id FROM invoices WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(invoice.customer_id, customer.rows[0].id);
  });
});

test('syncInvoices: hoa don sua doi so luong line item -> sau lan 2 line items khop dung du lieu moi (xoa-chen-lai)', async () => {
  await withTestPool(async (pool, branch) => {
    await syncInvoices(pool, fakeClient([[sampleInvoice({
      invoiceDetails: [
        { productId: 1, productCode: 'SP1', quantity: 1, price: 1000, subTotal: 1000 },
        { productId: 2, productCode: 'SP2', quantity: 1, price: 2000, subTotal: 2000 }
      ]
    })]]), branch, null);

    await syncInvoices(pool, fakeClient([[sampleInvoice({
      invoiceDetails: [
        { productId: 1, productCode: 'SP1', quantity: 5, price: 1000, subTotal: 5000 }
      ]
    })]]), branch, null);

    const invoice = (await pool.query('SELECT id FROM invoices WHERE branch_id = $1', [branch.id])).rows[0];
    const lines = (await pool.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1', [invoice.id])).rows;
    assert.equal(lines.length, 1, 'dong SP2 cu phai bi xoa, chi con lai dung 1 dong theo du lieu moi');
    assert.equal(lines[0].product_code_snapshot, 'SP1');
    assert.equal(Number(lines[0].quantity), 5);
  });
});

test('syncInvoices: khong tao trung header khi sync lai cung kiotviet_id', async () => {
  await withTestPool(async (pool, branch) => {
    await syncInvoices(pool, fakeClient([[sampleInvoice()]]), branch, null);
    await syncInvoices(pool, fakeClient([[sampleInvoice({ total: 9999999 })]]), branch, null);

    const rows = (await pool.query('SELECT * FROM invoices WHERE branch_id = $1 AND kiotviet_id = 217962948', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].total_amount), 9999999);
  });
});

test('syncInvoices: loi giua chung (trang 2) thi rejects, du lieu trang 1 (header+lines) van con nguyen', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[sampleInvoice()], new Error('KiotViet 500')]);
    await assert.rejects(() => syncInvoices(pool, client, branch, null), /KiotViet 500/);

    const invoices = (await pool.query('SELECT * FROM invoices WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(invoices.length, 1);
    const lines = (await pool.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1', [invoices[0].id])).rows;
    assert.equal(lines.length, 1);
  });
});

test('syncInvoices: mot hoa don loi (thieu quantity NOT NULL) thi rollback toan bo header+lines cua chinh hoa don do, khong de lai trang thai nua voi', async () => {
  await withTestPool(async (pool, branch) => {
    await syncInvoices(pool, fakeClient([[sampleInvoice()]]), branch, null);

    const brokenInvoice = sampleInvoice({
      invoiceDetails: [{ productCode: 'SP-LOI', price: 1000, subTotal: 1000 /* thieu quantity */ }]
    });
    await assert.rejects(() => syncInvoices(pool, fakeClient([[brokenInvoice]]), branch, null));

    const invoice = (await pool.query('SELECT * FROM invoices WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(invoice.total_amount), 3150000, 'header cu phai giu nguyen, khong bi cap nhat mot phan');
    const lines = (await pool.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1', [invoice.id])).rows;
    assert.equal(lines.length, 1);
    assert.equal(lines[0].product_code_snapshot, 'GLNL11', 'line item cu phai con nguyen, khong bi xoa roi khong chen lai duoc');
  });
});
