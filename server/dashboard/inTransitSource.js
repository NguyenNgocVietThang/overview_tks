// ==========================================
// IN TRANSIT SOURCE — "Hàng đang vận chuyển" theo mã hàng. MỘT nguồn sự thật cho:
//   - tab Hang hoa (dashboardPgReader.js, cột `Đang vận chuyển`),
//   - Bao cao hang hoa dem (kiotvietSync/productReportRefresh.js, cong vao `available_to_sell`),
//   - Gia tri co ban cua Vong doi don hang (shipment/kiotPendingOrdersRepository.js).
//
// Dinh nghia: tong so luong hang trong cac phieu "Dat hang nhap" (KiotViet: Mua hang -> Dat hang
// nhap) co trang thai 'Đã xác nhận NCC' cua Kiot SAI GON (bang order_suppliers, migration 0024) —
// CO DINH 'saigon' ke ca khi doc cho Ha Noi: hang ve theo ma nen moi dong hang hoa (Ha Noi hay Sai
// Gon) mang cung 1 so theo ma. Kiot Ha Noi KHONG co phieu Dat hang nhap nao trong he thong
// (do that 2026-10-01: order_suppliers chi co saigon).
// Chi dong chi tiet co productId (khong co productCode) nen noi products cua Sai Gon de lay ma.
// Loc theo chuoi `statusValue` (khong theo so `status` — xem ghi chu bay trang thai trong memory
// du an). Phieu doi sang 'Nhập một phần'/'Hoàn thành'/'Đã hủy' tu roi khoi tong.
// ==========================================
'use strict';

const IN_TRANSIT_STATUS = 'Đã xác nhận NCC';

/** Gia tri SQL literal an toan cho 1 hang so (dung khi can nhung vao CTE khong co tham so). */
function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Cau SELECT chung: (product_key, qty). `statusRef` la tham chieu tham so ('$1') hoac literal
 * (sqlLiteral(IN_TRANSIT_STATUS)) de co the nhung vao CTE cua cau lenh lon (productReportRefresh).
 */
function inTransitSelectSql(statusRef) {
  return `SELECT
        lower(btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), sp.code, ''))) AS product_key,
        SUM(COALESCE(d.quantity, 0))::float8 AS qty
      FROM order_suppliers o
      JOIN order_supplier_details d ON d.branch = o.branch AND d.order_supplier_id = o.id
      LEFT JOIN products sp ON sp.branch = o.branch AND sp.id = d.product_id
      WHERE o.branch = 'saigon' AND o.raw->>'statusValue' = ${statusRef}
      GROUP BY 1`;
}

// Chuoi `-- in-transit` o dau cau lenh de test dem truy van cua pgReader nhan ra va bo qua.
const IN_TRANSIT_SQL = `-- in-transit: Đặt hàng nhập ${IN_TRANSIT_STATUS} (Sài Gòn)
      ${inTransitSelectSql('$1')}`;

/**
 * Map ma hang (chu thuong, da trim) -> so luong dang van chuyen. Fail-soft: bang chua co
 * (chua chay migration 0024) hoac loi DB thi tra Map rong — cot "Đang vận chuyển" = 0, cac
 * cot khac van doc binh thuong (khong lam trang ca Dashboard).
 */
let inTransitWarned = false;
async function readInTransitByCode(pool) {
  try {
    const result = await pool.query(IN_TRANSIT_SQL, [IN_TRANSIT_STATUS]);
    const byCode = new Map();
    for (const row of (result && result.rows) || []) {
      if (row.product_key) byCode.set(row.product_key, Number(row.qty) || 0);
    }
    return byCode;
  } catch (error) {
    if (!inTransitWarned) {
      inTransitWarned = true;
      console.warn('[Dashboard] Không đọc được hàng đang vận chuyển (order_suppliers):', error.message);
    }
    return new Map();
  }
}

module.exports = {
  IN_TRANSIT_STATUS,
  IN_TRANSIT_SQL,
  inTransitSelectSql,
  sqlLiteral,
  readInTransitByCode
};
