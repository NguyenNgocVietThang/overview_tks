'use strict';

const { Pool } = require('pg');
const config = require('../config');
const { runMigrations } = require('./migrate');

function makeSchemaName(prefix) {
  return `test_${prefix}_` + Math.random().toString(36).slice(2, 10);
}

async function withTestPool(prefix, fn) {
  const schemaName = makeSchemaName(prefix);
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
    const branchRows = (await pool.query('SELECT id, code, name, kiotviet_retailer FROM branches ORDER BY code')).rows;
    const branches = {};
    for (const row of branchRows) {
      branches[row.code] = { id: row.id, code: row.code, name: row.name, kiotvietRetailer: row.kiotviet_retailer };
    }
    await fn(pool, branches);
  } finally {
    await pool.end();
    await setupPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
    await setupPool.end();
  }
}

module.exports = { withTestPool, makeSchemaName };
