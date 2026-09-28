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
    // Tung la 5 — qua thap khi 1 request /api/dashboard can toi 14 cau cung
    // luc (7 tab "core" + 7 rollup, xem dashboardData.js fetchDashboardRollups()):
    // voi max:5 phai xep hang cho ket noi ranh, request cham hon han (do that
    // 2026-09-18: 11.4s vs <6s). Sau do tang 12, nhung khi deploy 2 instance
    // chay chong nhau (2 x 12 = 24) vuot pool_size 15 cua Supabase ->
    // EMAXCONNSESSION (2026-09-28). Nay mac dinh 7 (2 x 7 = 14), chinh bang
    // PG_POOL_MAX, xem config.js.
    max: CONFIG.PG_POOL_MAX,
    ssl: CONFIG.PGSSL ? { rejectUnauthorized: false } : false
  });

  return pool;
}

module.exports = { getPool };
