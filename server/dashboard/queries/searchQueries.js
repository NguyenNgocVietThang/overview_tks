'use strict';

// dashboardData.js:348-354 SEARCH_SCOPES - view -> danh sach bang duoc tim.
const SEARCH_SCOPES = {
  overview: ['products', 'invoices', 'orders', 'returns', 'customers', 'suppliers', 'purchases'],
  products: ['products'],
  invoices: ['invoices', 'orders', 'returns'],
  customers: ['customers'],
  suppliers: ['suppliers', 'purchases']
};

// Moi nguon: bang, cot ma, cot ten (dung cho ORDER BY/label), nhan hien thi.
const SOURCES = {
  products: { table: 'products', codeCol: 'product_code', nameCol: 'name', label: 'Hàng hóa' },
  invoices: { table: 'invoices', codeCol: 'invoice_code', nameCol: 'customer_name_snapshot', label: 'Hóa đơn' },
  orders: { table: 'orders', codeCol: 'order_code', nameCol: 'customer_name_snapshot', label: 'Đặt hàng' },
  returns: { table: 'returns', codeCol: 'return_code', nameCol: 'return_code', label: 'Trả hàng' },
  customers: { table: 'customers', codeCol: 'customer_code', nameCol: 'name', label: 'Khách hàng' },
  suppliers: { table: 'suppliers', codeCol: 'supplier_code', nameCol: 'name', label: 'Nhà cung cấp' },
  purchases: { table: 'purchases', codeCol: 'purchase_code', nameCol: 'supplier_name_snapshot', label: 'Nhập hàng' }
};

function scopeFor(view) {
  return SEARCH_SCOPES[view] || SEARCH_SCOPES.overview;
}

async function searchByCodes(pool, branchId, view, codes) {
  const scope = scopeFor(view);
  const normalizedCodes = codes.map((c) => String(c).trim()).filter(Boolean);
  if (!normalizedCodes.length) {
    return { view, mode: 'codes', requestedCount: 0, matchedCount: 0, missingCount: 0, total: 0, results: [] };
  }

  const results = [];
  const matchedCodes = new Set();
  for (const sourceKey of scope) {
    const source = SOURCES[sourceKey];
    const { rows } = await pool.query(
      `SELECT ${source.codeCol} AS code, ${source.nameCol} AS name
       FROM ${source.table}
       WHERE branch_id = $1 AND ${source.codeCol} = ANY($2::text[])`,
      [branchId, normalizedCodes]
    );
    rows.forEach((r) => {
      matchedCodes.add(r.code);
      results.push({ source: sourceKey, sourceLabel: source.label, code: r.code, name: r.name });
    });
  }

  return {
    view,
    mode: 'codes',
    requestedCount: normalizedCodes.length,
    matchedCount: matchedCodes.size,
    missingCount: normalizedCodes.length - matchedCodes.size,
    total: results.length,
    results
  };
}

// Xep hang don gian: khop dung ma > khop dung ten > ma bat dau bang > ten bat
// dau bang - tuong duong voi getSearchMatchRank (dashboardData.js:564-574),
// KHONG bao gom chuan hoa bo dau tieng Viet (compactCode/compactName) - Sheets
// ban co lam viec nay, Postgres ban nay chua co ham unaccent tuong duong,
// ghi nhan la gioi han da biet trong PHASE2_PG_MODULES.md.
async function searchByText(pool, branchId, view, queryText, limit) {
  const scope = scopeFor(view);
  const q = String(queryText || '').trim();
  if (!q) return { view, query: q, total: 0, results: [] };

  const results = [];
  for (const sourceKey of scope) {
    const source = SOURCES[sourceKey];
    const { rows } = await pool.query(
      `SELECT ${source.codeCol} AS code, ${source.nameCol} AS name,
              CASE
                WHEN ${source.codeCol} = $2 THEN 0
                WHEN ${source.nameCol} = $2 THEN 1
                WHEN ${source.codeCol} ILIKE $3 THEN 2
                WHEN ${source.nameCol} ILIKE $3 THEN 3
                ELSE 9
              END AS rank
       FROM ${source.table}
       WHERE branch_id = $1
         AND (${source.codeCol} ILIKE $3 OR ${source.nameCol} ILIKE $3)`,
      [branchId, q, `${q}%`]
    );
    rows.forEach((r) => results.push({ source: sourceKey, sourceLabel: source.label, code: r.code, name: r.name, _rank: Number(r.rank) }));
  }

  results.sort((a, b) => a._rank - b._rank || a.code.localeCompare(b.code));
  const limited = (limit == null ? results : results.slice(0, limit)).map(({ _rank, ...rest }) => rest);

  return { view, query: q, total: results.length, results: limited };
}

module.exports = { SEARCH_SCOPES, SOURCES, searchByCodes, searchByText };
