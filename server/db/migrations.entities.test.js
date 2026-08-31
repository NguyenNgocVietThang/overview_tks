'use strict';

// Test cho migrations 0002-0011 (cac bang nghiep vu con lai). Tap trung vao
// nhung co che de sai nhat: partial unique index (branch_id, kiotviet_id)
// khong ap dung cho dong kiotviet_id=NULL, ON DELETE CASCADE cho line items,
// va cac unique index/default dac biet (product_inventory, inventory_daily_snapshot).
// Danh sach cot day du cho tung bang se duoc kiem chung gian tiep khi cac
// entity sync module (task #9) upsert that vao day.

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const config = require('../config');
const { runMigrations } = require('./migrate');

function makeSchemaName() {
  return 'test_entities_' + Math.random().toString(36).slice(2, 10);
}

async function withMigratedSchema(fn) {
  const schemaName = makeSchemaName();
  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: config.PGSSL ? { rejectUnauthorized: false } : false
  });
  await client.connect();
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}"`);
  await runMigrations(client);
  const hanoi = (await client.query(`SELECT id FROM branches WHERE code = 'hanoi'`)).rows[0];
  try {
    await fn(client, hanoi.id);
  } finally {
    await client.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await client.end();
  }
}

async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
    [tableName]
  );
  return result.rows.length === 1;
}

test('tat ca bang nghiep vu con lai (0002-0011) ton tai sau migrate', async () => {
  await withMigratedSchema(async (client) => {
    const expectedTables = [
      'staff', 'categories', 'products', 'product_inventory', 'inventory_daily_snapshot',
      'customers', 'suppliers', 'invoices', 'invoice_line_items', 'orders', 'returns',
      'purchases', 'purchase_line_items', 'cash_flows'
    ];
    for (const table of expectedTables) {
      assert.ok(await tableExists(client, table), `bang ${table} phai ton tai`);
    }
  });
});

test('categories: partial unique (branch_id, kiotviet_id) khong chan nhieu dong kiotviet_id=NULL', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO categories (branch_id, name, kiotviet_id) VALUES ($1, 'A', NULL)`, [branchId]);
    await client.query(`INSERT INTO categories (branch_id, name, kiotviet_id) VALUES ($1, 'B', NULL)`, [branchId]);
    const count = await client.query('SELECT COUNT(*)::int AS c FROM categories WHERE branch_id = $1', [branchId]);
    assert.equal(count.rows[0].c, 2);
  });
});

test('categories: partial unique (branch_id, kiotviet_id) CHAN 2 dong cung kiotviet_id', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO categories (branch_id, name, kiotviet_id) VALUES ($1, 'A', 100)`, [branchId]);
    await assert.rejects(
      () => client.query(`INSERT INTO categories (branch_id, name, kiotviet_id) VALUES ($1, 'B', 100)`, [branchId]),
      /duplicate key value violates unique constraint/
    );
  });
});

test('products: unique (branch_id, product_code) khong phai partial - luon ap dung ke ca kiotviet_id NULL', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'Hang A')`, [branchId]);
    await assert.rejects(
      () => client.query(`INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'Hang B')`, [branchId]),
      /duplicate key value violates unique constraint/
    );
  });
});

test('products: category_id FK tro dung ve categories(id)', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const category = await client.query(
      `INSERT INTO categories (branch_id, name) VALUES ($1, 'Nhom A') RETURNING id`, [branchId]
    );
    await client.query(
      `INSERT INTO products (branch_id, product_code, name, category_id) VALUES ($1, 'SP001', 'Hang A', $2)`,
      [branchId, category.rows[0].id]
    );
    await assert.rejects(
      () => client.query(`INSERT INTO products (branch_id, product_code, name, category_id) VALUES ($1, 'SP002', 'Hang B', 999999)`, [branchId]),
      /violates foreign key constraint/
    );
  });
});

test('product_inventory: unique (product_id, kiotviet_branch_id) LUON ap dung (khong phai partial), mac dinh kiotviet_branch_id=0', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const product = await client.query(
      `INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'Hang A') RETURNING id`, [branchId]
    );
    const productId = product.rows[0].id;

    await client.query(`INSERT INTO product_inventory (product_id, on_hand) VALUES ($1, 10)`, [productId]);
    const row = await client.query('SELECT kiotviet_branch_id FROM product_inventory WHERE product_id = $1', [productId]);
    assert.equal(Number(row.rows[0].kiotviet_branch_id), 0);

    await assert.rejects(
      () => client.query(`INSERT INTO product_inventory (product_id, kiotviet_branch_id, on_hand) VALUES ($1, 0, 20)`, [productId]),
      /duplicate key value violates unique constraint/
    );
  });
});

test('product_inventory: xoa product thi CASCADE xoa luon dong ton kho', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const product = await client.query(
      `INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'Hang A') RETURNING id`, [branchId]
    );
    const productId = product.rows[0].id;
    await client.query(`INSERT INTO product_inventory (product_id, on_hand) VALUES ($1, 10)`, [productId]);

    await client.query('DELETE FROM products WHERE id = $1', [productId]);

    const remaining = await client.query('SELECT * FROM product_inventory WHERE product_id = $1', [productId]);
    assert.equal(remaining.rows.length, 0);
  });
});

test('inventory_daily_snapshot: unique (product_id, kiotviet_branch_id, snapshot_date)', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const product = await client.query(
      `INSERT INTO products (branch_id, product_code, name) VALUES ($1, 'SP001', 'Hang A') RETURNING id`, [branchId]
    );
    const productId = product.rows[0].id;

    await client.query(
      `INSERT INTO inventory_daily_snapshot (product_id, snapshot_date, on_hand) VALUES ($1, '2026-08-30', 10)`,
      [productId]
    );
    await assert.rejects(
      () => client.query(`INSERT INTO inventory_daily_snapshot (product_id, snapshot_date, on_hand) VALUES ($1, '2026-08-30', 99)`, [productId]),
      /duplicate key value violates unique constraint/
    );
  });
});

test('invoices + invoice_line_items: unique (invoice_id, line_no), CASCADE khi xoa invoice', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const invoice = await client.query(
      `INSERT INTO invoices (branch_id, invoice_code, purchase_date, total_amount) VALUES ($1, 'HD001', now(), 100000) RETURNING id`,
      [branchId]
    );
    const invoiceId = invoice.rows[0].id;

    await client.query(
      `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, quantity, price, line_amount) VALUES ($1, $2, 0, 1, 50000, 50000)`,
      [invoiceId, branchId]
    );
    await assert.rejects(
      () => client.query(
        `INSERT INTO invoice_line_items (invoice_id, branch_id, line_no, quantity, price, line_amount) VALUES ($1, $2, 0, 2, 20000, 40000)`,
        [invoiceId, branchId]
      ),
      /duplicate key value violates unique constraint/
    );

    await client.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
    const remaining = await client.query('SELECT * FROM invoice_line_items WHERE invoice_id = $1', [invoiceId]);
    assert.equal(remaining.rows.length, 0);
  });
});

test('invoices: unique (branch_id, invoice_code) khong phai partial', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO invoices (branch_id, invoice_code, purchase_date, total_amount) VALUES ($1, 'HD001', now(), 1)`, [branchId]);
    await assert.rejects(
      () => client.query(`INSERT INTO invoices (branch_id, invoice_code, purchase_date, total_amount) VALUES ($1, 'HD001', now(), 2)`, [branchId]),
      /duplicate key value violates unique constraint/
    );
  });
});

test('purchases + purchase_line_items: unique (purchase_id, line_no), CASCADE khi xoa purchase', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const purchase = await client.query(
      `INSERT INTO purchases (branch_id, purchase_code, purchase_date, total_amount) VALUES ($1, 'PN001', now(), 100000) RETURNING id`,
      [branchId]
    );
    const purchaseId = purchase.rows[0].id;

    await client.query(
      `INSERT INTO purchase_line_items (purchase_id, branch_id, line_no, quantity, price, line_amount) VALUES ($1, $2, 0, 1, 50000, 50000)`,
      [purchaseId, branchId]
    );
    await client.query('DELETE FROM purchases WHERE id = $1', [purchaseId]);
    const remaining = await client.query('SELECT * FROM purchase_line_items WHERE purchase_id = $1', [purchaseId]);
    assert.equal(remaining.rows.length, 0);
  });
});

test('orders/returns/customers/suppliers: partial unique (branch_id, kiotviet_id) cho phep nhieu dong NULL', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO orders (branch_id, order_code, order_date, total_amount, kiotviet_id) VALUES ($1, 'DH001', now(), 1, NULL)`, [branchId]);
    await client.query(`INSERT INTO orders (branch_id, order_code, order_date, total_amount, kiotviet_id) VALUES ($1, 'DH002', now(), 1, NULL)`, [branchId]);

    await client.query(`INSERT INTO returns (branch_id, return_code, return_date, kiotviet_id) VALUES ($1, 'TH001', now(), NULL)`, [branchId]);
    await client.query(`INSERT INTO returns (branch_id, return_code, return_date, kiotviet_id) VALUES ($1, 'TH002', now(), NULL)`, [branchId]);

    await client.query(`INSERT INTO customers (branch_id, customer_code, name, kiotviet_id) VALUES ($1, 'KH001', 'A', NULL)`, [branchId]);
    await client.query(`INSERT INTO customers (branch_id, customer_code, name, kiotviet_id) VALUES ($1, 'KH002', 'B', NULL)`, [branchId]);

    await client.query(`INSERT INTO suppliers (branch_id, supplier_code, name, kiotviet_id) VALUES ($1, 'NCC001', 'A', NULL)`, [branchId]);
    await client.query(`INSERT INTO suppliers (branch_id, supplier_code, name, kiotviet_id) VALUES ($1, 'NCC002', 'B', NULL)`, [branchId]);

    const counts = await Promise.all([
      client.query('SELECT COUNT(*)::int AS c FROM orders WHERE branch_id = $1', [branchId]),
      client.query('SELECT COUNT(*)::int AS c FROM returns WHERE branch_id = $1', [branchId]),
      client.query('SELECT COUNT(*)::int AS c FROM customers WHERE branch_id = $1', [branchId]),
      client.query('SELECT COUNT(*)::int AS c FROM suppliers WHERE branch_id = $1', [branchId])
    ]);
    counts.forEach((result) => assert.equal(result.rows[0].c, 2));
  });
});

test('staff: source CHECK constraint chi cho phep kiotviet/manual/import', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(`INSERT INTO staff (branch_id, full_name, source) VALUES ($1, 'Nguyen Van A', 'kiotviet')`, [branchId]);
    await assert.rejects(
      () => client.query(`INSERT INTO staff (branch_id, full_name, source) VALUES ($1, 'B', 'khong_hop_le')`, [branchId]),
      /violates check constraint/
    );
  });
});

test('cash_flows: is_receipt NOT NULL, phan biet duoc phieu thu/chi', async () => {
  await withMigratedSchema(async (client, branchId) => {
    await client.query(
      `INSERT INTO cash_flows (branch_id, code, trans_date, amount, is_receipt) VALUES ($1, 'PT001', now(), 100000, true)`,
      [branchId]
    );
    await client.query(
      `INSERT INTO cash_flows (branch_id, code, trans_date, amount, is_receipt) VALUES ($1, 'PC001', now(), 50000, false)`,
      [branchId]
    );
    await assert.rejects(
      () => client.query(`INSERT INTO cash_flows (branch_id, code, trans_date, amount) VALUES ($1, 'PT002', now(), 1)`, [branchId]),
      /null value in column "is_receipt"/
    );
  });
});

test('returns: original_invoice_id FK tro ve invoices(id)', async () => {
  await withMigratedSchema(async (client, branchId) => {
    const invoice = await client.query(
      `INSERT INTO invoices (branch_id, invoice_code, purchase_date, total_amount) VALUES ($1, 'HD001', now(), 1) RETURNING id`,
      [branchId]
    );
    await client.query(
      `INSERT INTO returns (branch_id, return_code, return_date, original_invoice_id) VALUES ($1, 'TH001', now(), $2)`,
      [branchId, invoice.rows[0].id]
    );
    const row = await client.query('SELECT original_invoice_id FROM returns WHERE return_code = $1', ['TH001']);
    assert.equal(row.rows[0].original_invoice_id, invoice.rows[0].id);
  });
});
