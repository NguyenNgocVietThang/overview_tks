'use strict';
// "Dat hang nhap" (PDN..., KiotViet: Mua hang -> Dat hang nhap) -> endpoint
// /ordersuppliers (KHAC /purchaseorders = "Nhap hang"). Xem kiotviet/API_ENDPOINTS.md.
// Nguon cho cot "Hang dang van chuyen" (phieu 'Đã xác nhận NCC' cua Kiot Sai Gon).
const { isDeepStrictEqual } = require('node:util');
const { createDocumentEntity, value } = require('./documentEntityFactory');

const entity = createDocumentEntity({
  entity: 'order_suppliers',
  endpoint: 'ordersuppliers',
  // /ordersuppliers KHONG co modifiedDate va dong chi tiet chi co productId
  // (khong co productCode) - da kiem chung bang live probe 2026-09-29.
  syncStaff: false,
  parentColumns: ['branch', 'id', 'code', 'order_date', 'supplier_id', 'total', 'status', 'created_date', 'raw'],
  parentUpdateColumns: ['code', 'order_date', 'supplier_id', 'total', 'status', 'created_date'],
  mapParent: x => [
    value(x, 'id', 'Id'), value(x, 'code', 'Code'), value(x, 'orderDate', 'OrderDate'),
    value(x, 'supplierId', 'SupplierId'), value(x, 'total', 'Total'), value(x, 'status', 'Status'),
    value(x, 'createdDate', 'CreatedDate')
  ],
  detailTable: 'order_supplier_details',
  parentIdColumn: 'order_supplier_id',
  detailKeys: ['orderSupplierDetails', 'OrderSupplierDetails'],
  detailColumns: ['branch', 'order_supplier_id', 'line_no', 'product_id', 'quantity', 'price', 'raw'],
  mapDetail: x => [value(x, 'productId', 'ProductId'), value(x, 'quantity', 'Quantity'), value(x, 'price', 'Price')]
});

module.exports = entity;

// Live probe 2026-09-29: `lastModifiedFrom` bi API BO QUA (total van 348 khi dat
// ngay tuong lai) va phieu doi trang thai ("Đã xác nhận NCC" -> "Hoàn thành"/"Đã hủy")
// khong co modifiedDate de bat. Danh sach chi ~350 phieu (4 trang/co so) nen doi soat
// toan bo moi luot va chi ghi phieu moi/thay doi (so raw, khong phu thuoc thu tu khoa).
module.exports.pollFullSnapshot = true;
module.exports.reconcilePage = async function reconcilePage(client, branch, items) {
  if (!items.length) return;
  const idOf = item => value(item, 'id', 'Id');
  const result = await client.query(
    'SELECT id, raw FROM order_suppliers WHERE branch = $1 AND id = ANY($2::bigint[])',
    [branch, items.map(idOf)]
  );
  const existing = new Map(result.rows.map(row => [String(row.id), row.raw]));
  const changed = items.filter(item => !isDeepStrictEqual(existing.get(String(idOf(item))), item));
  await module.exports.upsertPage(client, branch, changed);
};
