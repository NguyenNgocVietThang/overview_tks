'use strict';

// Fixture dung chung cho test tinh san Marketing (migration 0069): PGlite voi cac migration that
// 0044/0045/0046/0056 (Pancake), 0036 + 0068 (doanh so kinh doanh), 1 bang customers toi thieu, roi 0069.
// Khong phai file test (node --test chi chay *.test.js).

const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATIONS = path.join(__dirname, '../db/migrations');
const migration = name => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8');

const CUSTOMERS_DDL = `CREATE TABLE customers (
  branch TEXT NOT NULL, id BIGINT NOT NULL, code TEXT, name TEXT, raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (branch, id))`;

// opts.migrations: danh sach file can ap (mac dinh: day du).
async function createDb(opts = {}) {
  const db = new PGlite();
  const names = opts.migrations || ['0044_pancake_marketing.sql', '0045_pancake_current_input.sql', '0046_pancake_history_identity.sql',
    '0056_pancake_independent.sql', '0036_business_monthly_sales.sql', '0068_business_current_month.sql'];
  if (!opts.noCustomers) await db.exec(CUSTOMERS_DDL);
  for (const name of names) await db.exec(migration(name));
  if (opts.precompute !== false) await db.exec(migration('0069_marketing_precompute.sql'));
  return db;
}

function createPool(db) {
  return {
    query: (...args) => db.query(...args),
    connect: async () => ({ query: (...args) => db.query(...args), release() {} })
  };
}

module.exports = { createDb, createPool, migration, CUSTOMERS_DDL };
