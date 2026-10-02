'use strict';

// May chu GIA cho test trang Vong doi don hang: tra loi GET /api/shipment/lifecycle?... bang CHINH module loc /
// sap xep / cat trang cua may chu that (shipment/orderLifecycleQuery.js) nen test kiem tra duoc ca vong
// "giao dien gui bo loc -> may chu loc -> giao dien ve trang" ma khong can DB / Google Sheet.
const query = require('../../shipment/orderLifecycleQuery');

/** Phan hoi cua GET '/' cho `orders` (cac dong da gop, hinh dang nhu service.mergeRows tra ve). */
function lifecycleResponse(url, orders, kiot) {
  const search = new URL(url, 'https://tokosi.example').searchParams;
  const params = query.parseParams(Object.fromEntries(search));
  const scope = query.rowsInBranch(orders, params.branch);
  const selected = query.selectRows(orders, params);
  const paged = query.paginate(selected, params.page, params.pageSize);
  return {
    orders: paged.items,
    page: paged.page,
    pageSize: paged.pageSize,
    totalPages: paged.totalPages,
    total: scope.length,
    filteredTotal: selected.length,
    kiotStatuses: query.distinctKiotStatuses(scope),
    kiot
  };
}

/** true neu day la lenh goi LAY DANH SACH (khong phai order-detail / export / ghi de). */
function isListUrl(url) {
  return String(url).startsWith('/api/shipment/lifecycle?') || String(url) === '/api/shipment/lifecycle';
}

module.exports = { lifecycleResponse, isListUrl };
