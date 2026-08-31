'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const config = require('../../config');
const { runMigrations } = require('../../db/migrate');
const { upsertStaffFromEntity } = require('./staffSync');

function makeSchemaName() {
  return 'test_staff_' + Math.random().toString(36).slice(2, 10);
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

test('upsertStaffFromEntity: tra ve null neu khong co kiotvietId (vd hoa don khong ghi nhan nhan vien)', async () => {
  await withTestPool(async (pool, branch) => {
    const id = await upsertStaffFromEntity(pool, branch, { kiotvietId: null, fullName: '', discoveredVia: 'invoice' });
    assert.equal(id, null);
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM staff WHERE branch_id = $1', [branch.id]);
    assert.equal(count.rows[0].c, 0);
  });
});

test('upsertStaffFromEntity: tao moi nhan vien va tra ve id noi bo', async () => {
  await withTestPool(async (pool, branch) => {
    const id = await upsertStaffFromEntity(pool, branch, {
      kiotvietId: 1494955, fullName: 'Pham Thi Phuong Anh', phone: '0900000000', discoveredVia: 'invoice'
    });
    assert.ok(id);
    const row = (await pool.query('SELECT * FROM staff WHERE id = $1', [id])).rows[0];
    assert.equal(Number(row.kiotviet_id), 1494955);
    assert.equal(row.full_name, 'Pham Thi Phuong Anh');
    assert.equal(row.phone, '0900000000');
    assert.equal(row.discovered_via, 'invoice');
  });
});

test('upsertStaffFromEntity: goi lai voi cung kiotvietId -> cung 1 dong (khong tao trung), tra ve cung id', async () => {
  await withTestPool(async (pool, branch) => {
    const id1 = await upsertStaffFromEntity(pool, branch, { kiotvietId: 1, fullName: 'A', discoveredVia: 'invoice' });
    const id2 = await upsertStaffFromEntity(pool, branch, { kiotvietId: 1, fullName: 'A', discoveredVia: 'order' });
    assert.equal(id1, id2);
    const count = await pool.query('SELECT COUNT(*)::int AS c FROM staff WHERE branch_id = $1', [branch.id]);
    assert.equal(count.rows[0].c, 1);
  });
});

test('upsertStaffFromEntity: khong ghi de full_name/phone bang gia tri rong tu 1 entity thieu field', async () => {
  await withTestPool(async (pool, branch) => {
    await upsertStaffFromEntity(pool, branch, {
      kiotvietId: 1, fullName: 'Ten day du', phone: '0911111111', discoveredVia: 'invoice'
    });
    // Mot entity khac (vd return) co the khong co truong SoldByName/phone
    await upsertStaffFromEntity(pool, branch, {
      kiotvietId: 1, fullName: '', phone: '', discoveredVia: 'return'
    });

    const row = (await pool.query('SELECT full_name, phone FROM staff WHERE branch_id = $1 AND kiotviet_id = 1', [branch.id])).rows[0];
    assert.equal(row.full_name, 'Ten day du');
    assert.equal(row.phone, '0911111111');
  });
});
