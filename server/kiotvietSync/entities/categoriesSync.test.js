'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { syncCategories } = require('./categoriesSync');

function makeSchemaName() {
  return 'test_categories_' + Math.random().toString(36).slice(2, 10);
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
    const hanoi = (await pool.query(`SELECT id, code, kiotviet_retailer FROM branches WHERE code = 'hanoi'`)).rows[0];
    await fn(pool, { id: hanoi.id, code: hanoi.code, kiotvietRetailer: hanoi.kiotviet_retailer });
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

test('syncCategories: upsert lan dau tao dong moi dung field mapping', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([[{
      categoryId: 100,
      categoryName: 'Do gia dung',
      parentId: null,
      hasChild: true,
      modifiedDate: '2026-08-30T10:00:00.0000000'
    }]]);

    const result = await syncCategories(pool, client, branch, null);
    assert.deepEqual(result, { fetched: 1, upserted: 1 });

    const row = (await pool.query('SELECT * FROM categories WHERE branch_id = $1', [branch.id])).rows[0];
    assert.equal(Number(row.kiotviet_id), 100);
    assert.equal(row.name, 'Do gia dung');
    assert.equal(row.has_child, true);
    assert.equal(row.kiotviet_modified_at.toISOString(), '2026-08-30T03:00:00.000Z');
  });
});

test('syncCategories: upsert lan 2 cung kiotviet_id -> update, khong tao dong trung', async () => {
  await withTestPool(async (pool, branch) => {
    const clientV1 = fakeClient([[{ categoryId: 100, categoryName: 'Ten cu', hasChild: false, modifiedDate: '2026-08-30T10:00:00' }]]);
    await syncCategories(pool, clientV1, branch, null);

    const clientV2 = fakeClient([[{ categoryId: 100, categoryName: 'Ten moi', hasChild: true, modifiedDate: '2026-08-30T11:00:00' }]]);
    await syncCategories(pool, clientV2, branch, null);

    const rows = (await pool.query('SELECT * FROM categories WHERE branch_id = $1 AND kiotviet_id = 100', [branch.id])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Ten moi');
    assert.equal(rows[0].has_child, true);
  });
});

test('syncCategories: dong kiotviet_id=NULL tu truoc (manual) khong bi anh huong boi upsert khac', async () => {
  await withTestPool(async (pool, branch) => {
    await pool.query(`INSERT INTO categories (branch_id, name, kiotviet_id) VALUES ($1, 'Nhap tay', NULL)`, [branch.id]);

    const client = fakeClient([[{ categoryId: 100, categoryName: 'Tu KiotViet', hasChild: false, modifiedDate: '2026-08-30T10:00:00' }]]);
    await syncCategories(pool, client, branch, null);

    const rows = (await pool.query('SELECT name, kiotviet_id FROM categories WHERE branch_id = $1 ORDER BY name', [branch.id])).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.kiotviet_id === null).name, 'Nhap tay');
  });
});

test('syncCategories: loi giua chung (trang thu 2) thi rejects va giu nguyen du lieu trang 1 da upsert', async () => {
  await withTestPool(async (pool, branch) => {
    const client = fakeClient([
      [{ categoryId: 1, categoryName: 'Trang 1', hasChild: false, modifiedDate: '2026-08-30T10:00:00' }],
      new Error('KiotViet 500')
    ]);

    await assert.rejects(() => syncCategories(pool, client, branch, null), /KiotViet 500/);

    const rows = (await pool.query('SELECT * FROM categories WHERE branch_id = $1', [branch.id])).rows;
    assert.equal(rows.length, 1, 'du lieu trang 1 da upsert truoc khi loi phai duoc giu lai, khong rollback');
    assert.equal(rows[0].name, 'Trang 1');
  });
});

test('syncCategories: gui lastModifiedFrom trong query khi co sinceIso', async () => {
  await withTestPool(async (pool, branch) => {
    let capturedQuery = null;
    const client = {
      async fetchAllPages(endpoint, query, onPage) {
        capturedQuery = query;
        await onPage([], {});
      }
    };
    await syncCategories(pool, client, branch, '2026-08-01T00:00:00');
    assert.equal(capturedQuery.lastModifiedFrom, '2026-08-01T00:00:00');
    assert.equal(capturedQuery.hierachicalData, 'false');
  });
});
