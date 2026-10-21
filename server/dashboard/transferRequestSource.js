// ==========================================
// TRANSFER REQUEST SOURCE — "YC điều chuyển" theo mã hàng (Báo cáo hàng hóa).
// Sai Gon tao don dat hang o trang thai 'Phiếu tạm' tai Kiot HA NOI cho khach "Điều chuyển SG"
// (KH010020); Ha Noi chua xuat kho nen chua vao cot "Điều chuyển SG". Cot nay = tong so luong
// theo ma hang cua cac don do, MOI THOI GIAN (khong loc ngay).
// Doc truc tiep tu orders/order_details luc compose() (khong migration), cache o repository.
// statusValue viet nguyen van de khop idx_orders_phieu_tam (migration 0028).
// Do that 2026-10-21: raw->>'customerCode' co o 471/471 don Phieu tam Ha Noi, KH010020 = 1 don.
// ==========================================
'use strict';

const TRANSFER_REQUEST_STATUS = 'Phiếu tạm';
const TRANSFER_REQUEST_BRANCH = 'hanoi';
const TRANSFER_REQUEST_CUSTOMER_CODE = 'KH010020';

// Chuoi `-- transfer-request:` o dau cau lenh de test/mock nhan ra.
const TRANSFER_REQUEST_SQL = `-- transfer-request: YC điều chuyển (Phiếu tạm, Hà Nội, khách ${TRANSFER_REQUEST_CUSTOMER_CODE})
      SELECT
        lower(btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, ''))) AS product_key,
        SUM(COALESCE(d.quantity, 0))::float8 AS qty
      FROM (
        SELECT branch, id FROM orders
        WHERE branch = $1
          AND (raw->>'statusValue') = $2
          AND raw->>'customerCode' = $3
        OFFSET 0
      ) o
      JOIN order_details d ON d.branch = o.branch AND d.order_id = o.id
      LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
      GROUP BY 1`;

/**
 * Map ma hang (chu thuong, da trim) -> so luong yeu cau dieu chuyen. Fail-soft: loi DB thi tra Map
 * rong (cot = 0), cac cot khac van doc binh thuong.
 */
let transferRequestWarned = false;
async function readTransferRequestByCode(pool) {
  try {
    const result = await pool.query(TRANSFER_REQUEST_SQL,
      [TRANSFER_REQUEST_BRANCH, TRANSFER_REQUEST_STATUS, TRANSFER_REQUEST_CUSTOMER_CODE]);
    const byCode = new Map();
    for (const row of (result && result.rows) || []) {
      if (row.product_key) byCode.set(row.product_key, Number(row.qty) || 0);
    }
    return byCode;
  } catch (error) {
    if (!transferRequestWarned) {
      transferRequestWarned = true;
      console.warn('[Dashboard] Không đọc được YC điều chuyển (orders):', error.message);
    }
    return new Map();
  }
}

module.exports = {
  TRANSFER_REQUEST_STATUS,
  TRANSFER_REQUEST_BRANCH,
  TRANSFER_REQUEST_CUSTOMER_CODE,
  TRANSFER_REQUEST_SQL,
  readTransferRequestByCode
};
