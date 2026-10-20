'use strict';

// Goi y cho form VAT: danh ba KiotViet + ten trong ORDER VAT, va gia tham khao
// tu yeu cau VAT gan nhat. Khong tu ghi vao yeu cau.
const { getPool } = require('../db/pool');
const { getCustomerDirectory } = require('../dashboard/dashboardData');
const { normalizeDiacriticsInsensitive } = require('../vatDraft/normalization');
const repository = require('./repository');

function searchKey(value) {
  return normalizeDiacriticsInsensitive(value).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function matchRank(customer, query) {
  const name = searchKey(customer.name);
  const code = searchKey(customer.code);
  const compact = query.replace(/ /g, '');
  const words = query.split(' ');
  if (code === query) return 0;
  if (name === query) return 1;
  if (code.startsWith(query)) return 2;
  if (name.startsWith(query)) return 3;
  if (code.replace(/ /g, '').startsWith(compact)) return 4;
  if (name.replace(/ /g, '').startsWith(compact)) return 5;
  if (name.includes(query)) return 6;
  if (words.length > 1 && words.every(word => name.includes(word))) return 7;
  if (code.includes(query)) return 8;
  return -1;
}

function rankCustomerSuggestions(directory, history, rawQuery, rawLimit) {
  const query = searchKey(String(rawQuery || '').slice(0, 120));
  if (!query) return { query: String(rawQuery || '').trim(), results: [] };
  const limit = Math.min(Math.max(Number(rawLimit) || 10, 1), 30);
  const byName = new Map();
  for (const row of history) {
    const name = String(row.customer_name || '').trim();
    const key = searchKey(name);
    if (!key) continue;
    const current = byName.get(key);
    const lastOrderAt = row.last_order_at ? new Date(row.last_order_at).toISOString() : null;
    if (!current || (lastOrderAt || '') > (current.lastOrderAt || '')) {
      byName.set(key, { name, code: row.customer_code || '', source: 'order-vat', lastOrderAt, orderCount: Number(row.order_count) || 0 });
    }
  }
  for (const row of directory) {
    const name = String(row.name || row.code || '').trim();
    const key = searchKey(name);
    if (!key) continue;
    const previous = byName.get(key);
    if (previous?.source === 'kiotviet') continue; // danh ba sap HN truoc SG
    byName.set(key, { name, code: row.code || previous?.code || '', source: 'kiotviet',
      lastOrderAt: previous?.lastOrderAt || null, orderCount: previous?.orderCount || 0 });
  }
  const results = [...byName.values()]
    .map(customer => ({ ...customer, rank: matchRank(customer, query) }))
    .filter(customer => customer.rank >= 0)
    .sort((a, b) => a.rank - b.rank || b.orderCount - a.orderCount ||
      (b.lastOrderAt || '').localeCompare(a.lastOrderAt || '') || a.name.localeCompare(b.name, 'vi'))
    .slice(0, limit)
    .map(({ rank, ...customer }) => customer);
  return { query: String(rawQuery || '').trim(), results };
}

function createVatRequestSuggestions({ pool = getPool(), directoryReader = getCustomerDirectory,
  now = () => Date.now() } = {}) {
  let historyCache = null;
  async function customers(branch, query, limit) {
    if (!searchKey(query)) return { query: String(query || '').trim(), results: [] };
    const directory = await directoryReader(branch); // cache + invalidation khi KiotViet sync nam trong dashboardData
    if (!historyCache || historyCache.expiresAt <= now()) {
      historyCache = { rows: await repository.recentCustomers(pool), expiresAt: now() + 30 * 1000 };
    }
    return rankCustomerSuggestions(directory, historyCache.rows, query, limit);
  }
  async function prices(code) {
    const recent = await repository.latestProductPrice(pool, code);
    return { latestOrder: recent ? { price: Number(recent.price), customerName: recent.customer_name,
      createdAt: recent.created_at ? new Date(recent.created_at).toISOString() : null } : null };
  }
  return { customers, prices };
}

module.exports = { searchKey, matchRank, rankCustomerSuggestions, createVatRequestSuggestions };
