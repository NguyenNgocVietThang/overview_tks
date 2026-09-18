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
    // Tung la 5 — qua thap sau khi dashboardPgReader/dashboardRollupRepository
    // tach nho query de chay song song (1 request /api/dashboard can toi 14
    // cau cung luc: 7 tab "core" + 7 rollup, xem dashboardData.js
    // fetchDashboardRollups()) - voi max:5, phan lon phai xep hang cho ket
    // noi ranh, lam tong thoi gian request cham hon han tung cau rieng le do
    // duoc (do that 2026-09-18: 11.4s ca request vs <6s neu khong nghen pool).
    // 12 van an toan so voi han muc direct connection cua Supabase free-tier
    // (con job dong bo/refresh khac cung dung chung pool nay).
    max: 12,
    ssl: CONFIG.PGSSL ? { rejectUnauthorized: false } : false
  });

  return pool;
}

module.exports = { getPool };
