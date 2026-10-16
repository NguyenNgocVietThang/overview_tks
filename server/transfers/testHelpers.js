'use strict';
// Dung DB PGlite co migration 0054 + bang app_users toi thieu cho test module transfers.

const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const MIGRATION = fs.readFileSync(path.join(__dirname, '../db/migrations/0054_transfer_requests.sql'), 'utf8');

async function createTransferDb() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE reporting_readonly;
    CREATE TABLE app_users (id UUID PRIMARY KEY, ho_ten TEXT NOT NULL DEFAULT '', telegram_id TEXT NOT NULL DEFAULT '', is_deleted BOOLEAN NOT NULL DEFAULT false);`);
  await db.exec(MIGRATION);
  const pool = { async connect() { return { query: (sql, args) => db.query(sql, args), release() {} }; } };
  return { db, pool };
}

let counter = 0;
function botRequest(overrides = {}) {
  counter += 1;
  const n = String(counter).padStart(4, '0');
  return {
    requestCode: `YC-20261015-${n}`,
    idempotencyKey: `bot-create-${n}-abcdef`,
    createdAt: '2026-10-15T03:24:00Z',
    source: 'telegram',
    inputKind: 'text',
    sale: { telegramId: '8870151609', name: 'Uyên' },
    customerName: 'C Tuyết Bắc Lãm',
    amountVnd: 6350000,
    bankAccount: '3024018888',
    accountHolder: 'NGUYEN THI NAM',
    bankBin: '970436',
    bankNameRaw: 'Vietcombank',
    note: 'Khách chuyển khoản thừa',
    ...overrides
  };
}

const PERMS = Object.freeze({
  accountant: ['transfers.view', 'transfers.review'],
  manager: ['transfers.view', 'transfers.markPaid'],
  sale: ['transfers.own'],
  none: []
});

function user(kind, extra = {}) {
  return { id: `${kind}-id`, username: kind, hoTen: `${kind} name`, vaiTro: 'x', permissions: PERMS[kind] || [], ...extra };
}

module.exports = { createTransferDb, botRequest, user, PERMS };
