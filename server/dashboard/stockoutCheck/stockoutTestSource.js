'use strict';
// Helper CHI DUNG CHO TEST: dung nguon du lieu dut hang gia (cung giao dien voi
// stockoutPgSource.js) tu cac fixture co dang payload KiotViet — de test cac
// dich vu quet khong phai viet lai fixture theo dang dong SQL.
const { toVnDateKey, isCompletedPurchaseOrder } = require('./timelineBuilder');

const MOVEMENT_ENDPOINTS = {
  invoices: {
    endpoint: 'invoices', dateField: 'purchaseDate', detailsField: 'invoiceDetails',
    isCompleted: (item) => Number(item.status) === 1
  },
  purchases: {
    endpoint: 'purchaseorders', dateField: 'purchaseDate', detailsField: 'purchaseOrderDetails',
    isCompleted: isCompletedPurchaseOrder
  },
  customerReturns: {
    endpoint: 'returns', dateField: 'returnDate', detailsField: 'returnDetails',
    isCompleted: (item) => Number(item.status) === 1
  }
};

function flattenPages(pagesByEndpoint, endpoint) {
  const pages = pagesByEndpoint[endpoint] || [[]];
  const items = [];
  for (const page of pages) {
    if (page instanceof Error) throw page;
    items.push(...page);
  }
  return items;
}

function sumOnHand(inventories) {
  return (inventories || []).reduce((sum, inv) => sum + (Number(inv.onHand) || 0), 0);
}

function fakeStockoutSource(pagesByEndpoint = {}, { syncStatus, calls = [] } = {}) {
  return {
    calls,
    async listProducts() {
      calls.push({ method: 'listProducts' });
      return flattenPages(pagesByEndpoint, 'products').map((item) => ({
        code: item.productCode || item.code,
        name: item.fullName || item.name,
        isActive: item.isActive,
        onHand: sumOnHand(item.inventories),
        createdDate: item.createdDate || null
      }));
    },
    async listStockMovements({ kind, codes, fromDate, toDate }) {
      const spec = MOVEMENT_ENDPOINTS[kind];
      calls.push({ method: 'listStockMovements', kind, endpoint: spec.endpoint, fromDate, toDate });
      const totals = new Map();
      for (const item of flattenPages(pagesByEndpoint, spec.endpoint)) {
        if (!spec.isCompleted(item)) continue;
        const dateKey = toVnDateKey(item[spec.dateField]);
        if (dateKey < fromDate || dateKey > toDate) continue;
        for (const detail of item[spec.detailsField] || []) {
          const code = String(detail.productCode || '').trim();
          if (!codes.has(code)) continue;
          const key = `${code}|${dateKey}`;
          const current = totals.get(key) || { code, dateKey, quantity: 0 };
          current.quantity += Number(detail.quantity) || 0;
          totals.set(key, current);
        }
      }
      return Array.from(totals.values());
    },
    async getSyncStatus() {
      calls.push({ method: 'getSyncStatus' });
      const now = new Date().toISOString();
      return syncStatus || ['products', 'invoices', 'purchases', 'returns']
        .map((entity) => ({ entity, lastSuccessAt: now }));
    }
  };
}

module.exports = { fakeStockoutSource };
