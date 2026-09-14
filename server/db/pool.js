'use strict';

const { Pool } = require('pg');
const CONFIG = require('../config');

let pool;

function missingDatabaseError() {
  return new Error('SUPABASE_DB_URL chưa được cấu hình');
}

function createUnavailablePool() {
  return Object.freeze({
    query: async () => { throw missingDatabaseError(); },
    connect: async () => { throw missingDatabaseError(); },
    end: async () => {}
  });
}

function getPool() {
  if (pool) return pool;

  if (!CONFIG.SUPABASE_DB_URL) {
    pool = createUnavailablePool();
    return pool;
  }

  pool = new Pool({
    connectionString: CONFIG.SUPABASE_DB_URL,
    max: 5,
    ssl: CONFIG.PGSSL ? { rejectUnauthorized: false } : false
  });

  return pool;
}

module.exports = { getPool };
