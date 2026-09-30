'use strict';
// ==========================================
// DASHBOARD PG READER — dung lai dung shape `[header, ...rows]` cua 7 tab
// Google Sheets KiotViet, nhung doc tu Supabase Postgres (bang do
// server/kiotvietSync/ dong bo) thay vi Google Sheets API.
//
// Muc tieu: KHONG doi logic nghiep vu trong dashboardData.js/exportService.js
// (van tra cuu theo TEN COT tieng Viet, doi khi theo VI TRI cot), nen:
//   - Ten header giu shape tuong thich voi dashboardData.js — KHONG duoc doi
//     ten/thu tu neu chua cap nhat cac consumer.
//   - Cach dung gia tri giu quy uoc cu: nhan trang thai lay tu
//     `statusValue`, ngay dinh dang "dd/MM/yyyy HH:mm", tien/so luong la so.
//
// LUU Y QUAN TRONG VE MUI GIO: cac cot TIMESTAMPTZ duoc engine dong bo ghi tu
// chuoi ISO KHONG kem offset cua KiotViet ("2026-08-10T11:10:19.463"), nen
// Postgres da hieu chung la UTC. Gia tri luu trong DB vi vay la "gio treo
// tuong" cua KiotViet (gio Viet Nam) mang nhan UTC. Muon doc lai dung gio goc
// phai format voi `AT TIME ZONE 'UTC'` — dung 'Asia/Ho_Chi_Minh' se lech +7h.
// ==========================================
const CONFIG = require('../config');
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode, resolveBranchScope } = require('../branch/branches');

// Dinh dang tuong thich shape du lieu dashboard.
const SHEET_DATE_FORMAT = 'DD/MM/YYYY HH24:MI';

/** Format 1 cot TIMESTAMPTZ ve chuoi ngay kieu Sheets (xem ghi chu mui gio o dau file). */
function fmtTs(column) {
  return `COALESCE(to_char(${column} AT TIME ZONE 'UTC', '${SHEET_DATE_FORMAT}'), '')`;
}

/** Format 1 chuoi ISO nam trong `raw` (khong co offset) ve chuoi ngay kieu Sheets. */
function fmtRawTs(expression) {
  return `COALESCE(to_char(NULLIF(${expression}, '')::timestamp, '${SHEET_DATE_FORMAT}'), '')`;
}

/** Giong kiotVietText_: null/undefined -> chuoi rong. */
function text(expression) {
  return `COALESCE(${expression}, '')`;
}

/** Giong kiotVietNumber_ voi defaultValue = 0. */
function num(expression) {
  return `COALESCE((${expression})::float8, 0)`;
}

/** Giong kiotVietBooleanText_: true -> 'Có', false -> 'Không', thieu -> ''. */
function boolText(jsonExpression) {
  return `CASE
      WHEN ${jsonExpression} IS NULL OR ${jsonExpression} = '' THEN ''
      WHEN ${jsonExpression} = 'true' THEN 'Có'
      WHEN ${jsonExpression} = 'false' THEN 'Không'
      ELSE ${jsonExpression}
    END`;
}

/**
 * Giong kiotVietStatus_: uu tien `statusValue` cua API, chi dung bang tra ma
 * khi payload khong co truong do (bang tra lay tu SheetSchemas.gs).
 */
function statusLabel(fallbackByCode, prefix = '') {
  const statusColumn = `${prefix}status`;
  const whens = Object.entries(fallbackByCode)
    .map(([code, label]) => `WHEN ${Number(code)} THEN '${label}'`)
    .join(' ');
  const fallback = whens
    ? `CASE ${statusColumn} ${whens} ELSE COALESCE(${statusColumn}::text, '') END`
    : `COALESCE(${statusColumn}::text, '')`;
  return `COALESCE(NULLIF(${prefix}raw->>'statusValue', ''), ${fallback})`;
}

// Da doi chieu truc tiep voi du lieu that tren Supabase (2026-09-18, ca 2 co
// so) qua `raw->>'statusValue'` — cac bang tra ma nay CHI dung khi payload
// thieu statusValue (hiem, thuc te chua gap), nen sai truoc day khong lam
// hong hien thi (statusLabel() luon uu tien statusValue that). Invoice/Return
// da sua theo dung so lieu that; Order moi kiem chung status 1/3/4, giu
// nguyen 2/5 (chua co du lieu that de xac nhan) — CAN THAN neu dua vao truc
// tiep, uu tien statusValue nhu statusLabel() dang lam.
const INVOICE_STATUS_FALLBACK = { 1: 'Hoàn thành', 2: 'Đã hủy', 3: 'Đang xử lý' };
const ORDER_STATUS_FALLBACK = {
  1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Hoàn thành', 4: 'Đã hủy', 5: 'Hoàn thành'
};
const RETURN_STATUS_FALLBACK = { 1: 'Đã trả', 2: 'Đã hủy' };

// Cac cot Sheets KHONG co nguon trong Postgres hien tai. Giu chuoi rong (dung
// khi payload thieu truong) thay vi bia du lieu:
//   - "SĐT khách" (Hóa đơn): payload /invoices khong tra so dien thoai khach
//     (cot nay cung RONG trong Sheets san xuat — da doi chieu truc tiep).
//   - "Nhóm khách hàng" (Khách hàng): `customers.raw` khong co `groups`/
//     `customerGroupDetails`.
//   - "Có nhóm con" (Nhóm hàng): `categories.raw` khong co `hasChild`.
const MISSING = `''`;

// "Giá vốn"/"Tồn kho"/"Khách đặt"/"Vị trí" (Hàng hóa): nam trong mang
// `inventories`/`productShelves` cua payload KiotViet (co that khi goi API
// voi includeInventory/IncludeProductShelves — da xac minh truc tiep tren
// KiotViet 2026-09-16). Truoc day `products.raw` trong Postgres thieu 2 mang
// nay do bug backfillPlan.js khong gop entityModule.listQuery vao chunk
// backfill (da sua, xem kiotvietSync/backfillPlan.js) — sau khi backfill lai
// products, cac bieu thuc duoi day se doc dung du lieu; truoc do van an toan
// (tra 0/rong vi jsonb_array_elements tren mang rong).
const INVENTORY_ONHAND_SQL = `(SELECT COALESCE(SUM((inv->>'onHand')::float8), 0)
  FROM jsonb_array_elements(COALESCE(raw->'inventories', '[]'::jsonb)) inv)`;
const INVENTORY_RESERVED_SQL = `(SELECT COALESCE(SUM((inv->>'reserved')::float8), 0)
  FROM jsonb_array_elements(COALESCE(raw->'inventories', '[]'::jsonb)) inv)`;
const INVENTORY_COST_SQL = `(SELECT AVG((inv->>'cost')::float8)
  FROM jsonb_array_elements(COALESCE(raw->'inventories', '[]'::jsonb)) inv)`;
const PRODUCT_SHELVES_SQL = `(SELECT string_agg(NULLIF(shelf->>'productShelves', ''), ', ')
  FROM jsonb_array_elements(COALESCE(raw->'productShelves', '[]'::jsonb)) shelf)`;

// "Đang vận chuyển" (Hàng hóa): tong so luong hang trong cac phieu "Dat hang nhap"
// (KiotViet: Mua hang -> Dat hang nhap) co trang thai 'Đã xác nhận NCC' cua Kiot SAI GON
// (bang order_suppliers, migration 0024) — CO DINH 'saigon' ke ca khi doc tab cua Ha Noi:
// hang ve theo ma nen moi dong hang hoa (Ha Noi hay Sai Gon) mang cung 1 so theo ma.
// Chi dong chi tiet co productId (khong co productCode) nen noi products cua Sai Gon
// de lay ma. Loc theo chuoi `statusValue` (khong theo so `status` — xem ghi chu bay
// trang thai trong memory du an). Phieu doi sang 'Nhập một phần'/'Hoàn thành'/'Đã hủy'
// tu roi khoi tong.
const IN_TRANSIT_STATUS = 'Đã xác nhận NCC';
const IN_TRANSIT_SQL = `-- in-transit: Đặt hàng nhập ${IN_TRANSIT_STATUS} (Sài Gòn)
      SELECT
        lower(btrim(COALESCE(NULLIF(d.raw->>'productCode', ''), sp.code, ''))) AS product_key,
        SUM(COALESCE(d.quantity, 0))::float8 AS qty
      FROM order_suppliers o
      JOIN order_supplier_details d ON d.branch = o.branch AND d.order_supplier_id = o.id
      LEFT JOIN products sp ON sp.branch = o.branch AND sp.id = d.product_id
      WHERE o.branch = 'saigon' AND o.raw->>'statusValue' = $1
      GROUP BY 1`;

/**
 * Map ma hang (chu thuong, da trim) -> so luong dang van chuyen. Fail-soft: bang chua co
 * (chua chay migration 0024) hoac loi DB thi tra Map rong — cot "Đang vận chuyển" = 0, cac
 * cot khac cua tab Hang hoa van doc binh thuong (khong lam trang ca Dashboard).
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

/** Dien cot `Đang vận chuyển` vao cac dong (object khoa theo alias) cua tab Hang hoa. */
function applyInTransit(rows, byCode, column) {
  for (const row of rows) {
    row[column] = byCode.get(String(row.ma_hang == null ? '' : row.ma_hang).trim().toLowerCase()) || 0;
  }
}

// Chi hang "Đang kinh doanh": tab Hang hoa loai hang co is_active = false (NULL van tinh).

// LOC THEO MA (chi readRowsByCodes dung): `$2` la MANG text[] cac ma, THAM SO
// HOA HOAN TOAN — tuyet doi khong noi chuoi ma vao SQL. Khi khong loc theo ma
// (byCode falsy) cac helper duoi day tra chuoi rong nen SQL cua tab y het ban
// goc (readDashboardSheets/readCoreDashboardSheets khong doi). `column` la
// bieu thuc cot ma cua bang goc (vd 'i.code'), KHONG phai alias trong SELECT.
function codeFilter(byCode, column) {
  return byCode ? `\n        AND ${column} = ANY($2::text[])` : '';
}

// Cot "Cơ sở" (cuoi moi tab): nhan co so vat ly cua dong ('Hà Nội'/'Sài Gòn') suy
// tu tham so $1 ('hanoi'/'saigon'). Khac cot "Chi nhánh" (ten KHO KiotViet).
const BRANCH_HEADER = 'Cơ sở';
const BRANCH_COLUMN = 'co_so';
const BRANCH_SQL = `CASE $1::text WHEN 'saigon' THEN '${BRANCHES.SAIGON}' ELSE '${BRANCHES.HANOI}' END`;

const TABS = [
  {
    sheetName: CONFIG.SHEET_CATEGORIES,
    headers: [
      'Mã nhóm hàng', 'Tên nhóm hàng', 'Mã nhóm cha', 'ID gian hàng',
      'Có nhóm con', 'Ngày sửa cuối', 'Ngày tạo'
    ],
    columns: [
      'ma_nhom_hang', 'ten_nhom_hang', 'ma_nhom_cha', 'id_gian_hang',
      'co_nhom_con', 'ngay_sua_cuoi', 'ngay_tao'
    ],
    sql: `-- tab: Nhóm hàng
      SELECT
        COALESCE(id::text, '')                       AS ma_nhom_hang,
        ${text('name')}                              AS ten_nhom_hang,
        COALESCE(parent_id::text, '')                AS ma_nhom_cha,
        ${text(`raw->>'retailerId'`)}                AS id_gian_hang,
        ${MISSING}                                   AS co_nhom_con,
        ${fmtTs('modified_date')}                    AS ngay_sua_cuoi,
        ${fmtRawTs(`raw->>'createdDate'`)}           AS ngay_tao,
        ${BRANCH_SQL}                              AS co_so
      FROM categories
      WHERE branch = $1
      ORDER BY id`
  },
  {
    sheetName: CONFIG.SHEET_PRODUCTS,
    headers: [
      'Mã hàng', 'Tên hàng', 'Nhóm hàng', 'Loại hàng', 'Giá vốn', 'Giá bán',
      'Tồn kho', 'Khách đặt', 'Trạng thái', 'Ngày sửa cuối', 'Mã nhóm hàng',
      'Vị trí', 'ID hàng hóa', 'ID gian hàng', 'Được phép bán', 'Tên gốc',
      'Mô tả', 'Giá trị quy đổi', 'Có thuộc tính', 'Đang hoạt động',
      'Ngày tạo', 'Ngày cập nhật', 'Mã loại hàng', 'Đang vận chuyển'
    ],
    columns: [
      'ma_hang', 'ten_hang', 'nhom_hang', 'loai_hang', 'gia_von', 'gia_ban',
      'ton_kho', 'khach_dat', 'trang_thai', 'ngay_sua_cuoi', 'ma_nhom_hang',
      'vi_tri', 'id_hang_hoa', 'id_gian_hang', 'duoc_phep_ban', 'ten_goc',
      'mo_ta', 'gia_tri_quy_doi', 'co_thuoc_tinh', 'dang_hoat_dong',
      'ngay_tao', 'ngay_cap_nhat', 'ma_loai_hang', 'dang_van_chuyen'
    ],
    codeColumn: 'ma_hang',
    // Cot `dang_van_chuyen` KHONG nam trong SQL nay: readInTransitByCode() tinh rieng va
    // applyInTransit() dien vao sau, de tab Hang hoa van doc duoc khi bang order_suppliers
    // (migration 0024) chua ton tai.
    inTransitColumn: 'dang_van_chuyen',
    buildSql: byCode => `-- tab: Hàng hóa
      SELECT
        ${text('code')}                                        AS ma_hang,
        COALESCE(NULLIF(raw->>'fullName', ''), name, '')       AS ten_hang,
        ${text(`raw->>'categoryName'`)}                        AS nhom_hang,
        CASE (raw->>'type')
          WHEN '1' THEN 'Combo'
          WHEN '3' THEN 'Dịch vụ'
          ELSE 'Hàng hóa'
        END                                                    AS loai_hang,
        COALESCE(${INVENTORY_COST_SQL}, 0)                     AS gia_von,
        ${num('base_price')}                                   AS gia_ban,
        ${INVENTORY_ONHAND_SQL}                                AS ton_kho,
        ${INVENTORY_RESERVED_SQL}                               AS khach_dat,
        CASE WHEN is_active IS FALSE THEN 'Ngừng kinh doanh' ELSE 'Đang kinh doanh' END AS trang_thai,
        ${fmtTs('COALESCE(modified_date, created_date)')}      AS ngay_sua_cuoi,
        COALESCE(category_id::text, '')                        AS ma_nhom_hang,
        COALESCE(${PRODUCT_SHELVES_SQL}, '')                   AS vi_tri,
        COALESCE(id::text, '')                                 AS id_hang_hoa,
        ${text(`raw->>'retailerId'`)}                          AS id_gian_hang,
        ${boolText(`raw->>'allowsSale'`)}                      AS duoc_phep_ban,
        ${text('name')}                                        AS ten_goc,
        ${text(`raw->>'description'`)}                         AS mo_ta,
        ${num(`raw->>'conversionValue'`)}                      AS gia_tri_quy_doi,
        ${boolText(`raw->>'hasVariants'`)}                     AS co_thuoc_tinh,
        ${boolText(`raw->>'isActive'`)}                        AS dang_hoat_dong,
        ${fmtTs('created_date')}                               AS ngay_tao,
        ${fmtTs('modified_date')}                              AS ngay_cap_nhat,
        ${text(`raw->>'type'`)}                                AS ma_loai_hang,
        ${BRANCH_SQL}                              AS co_so
      FROM products
      WHERE branch = $1
        AND is_active IS NOT FALSE${codeFilter(byCode, 'code')}
      ORDER BY code`
  },
  {
    sheetName: CONFIG.SHEET_INVOICES,
    headers: [
      'Mã hóa đơn', 'Ngày bán', 'Khách hàng', 'SĐT khách', 'Nhân viên bán',
      'Chi nhánh', 'Tổng tiền hàng', 'Giảm giá', 'Khách đã trả', 'Trạng thái',
      'ID hóa đơn', 'Mã đặt hàng', 'ID chi nhánh', 'ID nhân viên bán',
      'ID khách hàng', 'Mã khách hàng', 'Mã trạng thái', 'Tên trạng thái API',
      'Ghi chú', 'Thu hộ COD', 'Ngày tạo'
    ],
    columns: [
      'ma_hoa_don', 'ngay_ban', 'khach_hang', 'sdt_khach', 'nhan_vien_ban',
      'chi_nhanh', 'tong_tien_hang', 'giam_gia', 'khach_da_tra', 'trang_thai',
      'id_hoa_don', 'ma_dat_hang', 'id_chi_nhanh', 'id_nhan_vien_ban',
      'id_khach_hang', 'ma_khach_hang', 'ma_trang_thai', 'ten_trang_thai_api',
      'ghi_chu', 'thu_ho_cod', 'ngay_tao'
    ],
    codeColumn: 'ma_hoa_don',
    buildSql: byCode => `-- tab: Hóa đơn
      SELECT
        ${text('i.code')}                                          AS ma_hoa_don,
        ${fmtTs('i.purchase_date')}                                AS ngay_ban,
        COALESCE(NULLIF(i.raw->>'customerName', ''), 'Khách lẻ')   AS khach_hang,
        ${MISSING}                                                 AS sdt_khach,
        COALESCE(NULLIF(i.raw->>'soldByName', ''), s.name, '')     AS nhan_vien_ban,
        ${text(`i.raw->>'branchName'`)}                            AS chi_nhanh,
        ${num('i.total')}                                          AS tong_tien_hang,
        ${num(`i.raw->>'discount'`)}                               AS giam_gia,
        ${num('i.total_payment')}                                  AS khach_da_tra,
        ${statusLabel(INVOICE_STATUS_FALLBACK, 'i.')}              AS trang_thai,
        COALESCE(i.id::text, '')                                   AS id_hoa_don,
        ${text(`i.raw->>'orderCode'`)}                             AS ma_dat_hang,
        ${text(`i.raw->>'branchId'`)}                              AS id_chi_nhanh,
        COALESCE(i.sold_by_id::text, '')                           AS id_nhan_vien_ban,
        COALESCE(i.customer_id::text, '')                          AS id_khach_hang,
        ${text(`i.raw->>'customerCode'`)}                          AS ma_khach_hang,
        COALESCE(i.status::text, '')                               AS ma_trang_thai,
        ${text(`i.raw->>'statusValue'`)}                           AS ten_trang_thai_api,
        ${text(`i.raw->>'description'`)}                           AS ghi_chu,
        ${boolText(`i.raw->>'usingCod'`)}                          AS thu_ho_cod,
        ${fmtTs('i.created_date')}                                 AS ngay_tao,
        ${BRANCH_SQL}                              AS co_so
      FROM invoices i
      LEFT JOIN staff s ON s.branch = i.branch AND s.id = i.sold_by_id
      WHERE i.branch = $1${codeFilter(byCode, 'i.code')}
      ORDER BY i.purchase_date DESC NULLS LAST, i.id DESC`
  },
  {
    sheetName: CONFIG.SHEET_INVOICE_DETAILS,
    headers: [
      'Mã hóa đơn', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Đơn giá', 'Giảm giá',
      'Thành tiền', 'ID hóa đơn', 'ID hàng hóa', 'Giảm giá (%)', 'Ghi chú'
    ],
    columns: [
      'ma_hoa_don', 'ma_hang', 'ten_hang', 'so_luong', 'don_gia', 'giam_gia',
      'thanh_tien', 'id_hoa_don', 'id_hang_hoa', 'giam_gia_pct', 'ghi_chu'
    ],
    // "Thành tiền" giong buildInvoiceDetailSheetRow_: uu tien `subTotal` cua
    // KiotViet, chi tu tinh price*quantity-discount khi payload khong co.
    sql: `-- tab: Chi tiết hóa đơn
      SELECT
        ${text('i.code')}                                       AS ma_hoa_don,
        COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '') AS ma_hang,
        COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '') AS ten_hang,
        ${num('d.quantity')}                                    AS so_luong,
        ${num('d.price')}                                       AS don_gia,
        ${num('d.discount')}                                    AS giam_gia,
        CASE WHEN d.raw ? 'subTotal'
          THEN ${num(`d.raw->>'subTotal'`)}
          ELSE ${num('d.price')} * ${num('d.quantity')} - ${num('d.discount')}
        END                                                     AS thanh_tien,
        COALESCE(d.invoice_id::text, '')                        AS id_hoa_don,
        COALESCE(d.product_id::text, '')                        AS id_hang_hoa,
        ${num(`d.raw->>'discountRatio'`)}                       AS giam_gia_pct,
        ${text(`d.raw->>'note'`)}                               AS ghi_chu,
        ${BRANCH_SQL}                              AS co_so
      FROM invoice_details d
      JOIN invoices i ON i.branch = d.branch AND i.id = d.invoice_id
      LEFT JOIN products p ON p.branch = d.branch AND p.id = d.product_id
      WHERE d.branch = $1
      ORDER BY d.invoice_id DESC, d.line_no`
  },
  {
    sheetName: CONFIG.SHEET_ORDERS,
    headers: [
      'Mã đặt hàng', 'Ngày đặt', 'Khách hàng', 'Nhân viên lập', 'Chi nhánh',
      'Tổng tiền', 'Trạng thái', 'ID đặt hàng', 'ID gian hàng', 'ID chi nhánh',
      'ID nhân viên lập', 'ID khách hàng', 'Mã khách hàng', 'Khách đã trả',
      'Giảm giá (%)', 'Giảm giá', 'Mã trạng thái', 'Tên trạng thái API',
      'Ghi chú', 'Thu hộ COD', 'Ngày tạo', 'Ngày cập nhật'
    ],
    columns: [
      'ma_dat_hang', 'ngay_dat', 'khach_hang', 'nhan_vien_lap', 'chi_nhanh',
      'tong_tien', 'trang_thai', 'id_dat_hang', 'id_gian_hang', 'id_chi_nhanh',
      'id_nhan_vien_lap', 'id_khach_hang', 'ma_khach_hang', 'khach_da_tra',
      'giam_gia_pct', 'giam_gia', 'ma_trang_thai', 'ten_trang_thai_api',
      'ghi_chu', 'thu_ho_cod', 'ngay_tao', 'ngay_cap_nhat'
    ],
    codeColumn: 'ma_dat_hang',
    buildSql: byCode => `-- tab: Đặt hàng
      SELECT
        ${text('code')}                                        AS ma_dat_hang,
        ${fmtTs('order_date')}                                 AS ngay_dat,
        COALESCE(NULLIF(raw->>'customerName', ''), 'Khách lẻ') AS khach_hang,
        ${text(`raw->>'soldByName'`)}                          AS nhan_vien_lap,
        ${text(`raw->>'branchName'`)}                          AS chi_nhanh,
        ${num('total')}                                        AS tong_tien,
        ${statusLabel(ORDER_STATUS_FALLBACK)}                  AS trang_thai,
        COALESCE(id::text, '')                                 AS id_dat_hang,
        ${text(`raw->>'retailerId'`)}                          AS id_gian_hang,
        ${text(`raw->>'branchId'`)}                            AS id_chi_nhanh,
        COALESCE(sold_by_id::text, '')                         AS id_nhan_vien_lap,
        COALESCE(customer_id::text, '')                        AS id_khach_hang,
        ${text(`raw->>'customerCode'`)}                        AS ma_khach_hang,
        ${num(`raw->>'totalPayment'`)}                         AS khach_da_tra,
        ${num(`raw->>'discountRatio'`)}                        AS giam_gia_pct,
        ${num(`raw->>'discount'`)}                             AS giam_gia,
        COALESCE(status::text, '')                             AS ma_trang_thai,
        ${text(`raw->>'statusValue'`)}                         AS ten_trang_thai_api,
        ${text(`raw->>'description'`)}                         AS ghi_chu,
        ${boolText(`raw->>'usingCod'`)}                        AS thu_ho_cod,
        ${fmtTs('created_date')}                               AS ngay_tao,
        ${fmtTs('modified_date')}                              AS ngay_cap_nhat,
        ${BRANCH_SQL}                              AS co_so
      FROM orders
      WHERE branch = $1${codeFilter(byCode, 'code')}
      ORDER BY order_date DESC NULLS LAST, id DESC`
  },
  {
    sheetName: CONFIG.SHEET_RETURNS,
    headers: [
      'Mã trả hàng', 'Ngày trả', 'Khách hàng', 'Tổng tiền trả', 'Trạng thái',
      'ID trả hàng', 'ID hóa đơn gốc', 'ID chi nhánh', 'Chi nhánh',
      'ID người nhận trả', 'Nhân viên bán', 'ID khách hàng', 'Mã khách hàng',
      'Giảm giá trả hàng', 'Phí trả hàng', 'Tổng thanh toán', 'Mã trạng thái',
      'Tên trạng thái API', 'Ngày tạo', 'Ngày cập nhật'
    ],
    columns: [
      'ma_tra_hang', 'ngay_tra', 'khach_hang', 'tong_tien_tra', 'trang_thai',
      'id_tra_hang', 'id_hoa_don_goc', 'id_chi_nhanh', 'chi_nhanh',
      'id_nguoi_nhan_tra', 'nhan_vien_ban', 'id_khach_hang', 'ma_khach_hang',
      'giam_gia_tra_hang', 'phi_tra_hang', 'tong_thanh_toan', 'ma_trang_thai',
      'ten_trang_thai_api', 'ngay_tao', 'ngay_cap_nhat'
    ],
    codeColumn: 'ma_tra_hang',
    buildSql: byCode => `-- tab: Trả hàng
      SELECT
        ${text('code')}                                        AS ma_tra_hang,
        ${fmtTs('return_date')}                                AS ngay_tra,
        COALESCE(NULLIF(raw->>'customerName', ''), 'Khách lẻ') AS khach_hang,
        ${num('total')}                                        AS tong_tien_tra,
        ${statusLabel(RETURN_STATUS_FALLBACK)}                 AS trang_thai,
        COALESCE(id::text, '')                                 AS id_tra_hang,
        COALESCE(invoice_id::text, '')                         AS id_hoa_don_goc,
        ${text(`raw->>'branchId'`)}                            AS id_chi_nhanh,
        ${text(`raw->>'branchName'`)}                          AS chi_nhanh,
        ${text(`raw->>'receivedById'`)}                        AS id_nguoi_nhan_tra,
        ${text(`raw->>'soldByName'`)}                          AS nhan_vien_ban,
        COALESCE(customer_id::text, '')                        AS id_khach_hang,
        ${text(`raw->>'customerCode'`)}                        AS ma_khach_hang,
        ${num(`raw->>'returnDiscount'`)}                       AS giam_gia_tra_hang,
        ${num(`raw->>'returnFee'`)}                            AS phi_tra_hang,
        ${num(`raw->>'totalPayment'`)}                         AS tong_thanh_toan,
        COALESCE(status::text, '')                             AS ma_trang_thai,
        ${text(`raw->>'statusValue'`)}                         AS ten_trang_thai_api,
        ${fmtTs('created_date')}                               AS ngay_tao,
        ${fmtTs('modified_date')}                              AS ngay_cap_nhat,
        ${BRANCH_SQL}                              AS co_so
      FROM returns
      WHERE branch = $1${codeFilter(byCode, 'code')}
      ORDER BY return_date DESC NULLS LAST, id DESC`
  },
  {
    sheetName: CONFIG.SHEET_CUSTOMERS,
    headers: [
      'Mã khách hàng', 'Tên khách hàng', 'Điện thoại', 'Nhóm khách hàng',
      'Địa chỉ', 'Nợ hiện tại', 'Tổng bán', 'ID khách hàng', 'Điện thoại phụ',
      'Công ty', 'Tổng doanh thu', 'ID gian hàng', 'Ngày tạo'
    ],
    columns: [
      'ma_khach_hang', 'ten_khach_hang', 'dien_thoai', 'nhom_khach_hang',
      'dia_chi', 'no_hien_tai', 'tong_ban', 'id_khach_hang', 'dien_thoai_phu',
      'cong_ty', 'tong_doanh_thu', 'id_gian_hang', 'ngay_tao'
    ],
    codeColumn: 'ma_khach_hang',
    buildSql: byCode => `-- tab: Khách hàng
      SELECT
        ${text('code')}                          AS ma_khach_hang,
        ${text('name')}                          AS ten_khach_hang,
        ${text('phone')}                         AS dien_thoai,
        ${MISSING}                               AS nhom_khach_hang,
        ${text(`raw->>'address'`)}               AS dia_chi,
        ${num('debt')}                           AS no_hien_tai,
        ${num(`raw->>'totalInvoiced'`)}          AS tong_ban,
        COALESCE(id::text, '')                   AS id_khach_hang,
        ${text(`raw->>'subNumber'`)}             AS dien_thoai_phu,
        ${text(`raw->>'organization'`)}          AS cong_ty,
        ${num('total_revenue')}                  AS tong_doanh_thu,
        ${text(`raw->>'retailerId'`)}            AS id_gian_hang,
        ${fmtTs('created_date')}                 AS ngay_tao,
        ${BRANCH_SQL}                              AS co_so
      FROM customers
      WHERE branch = $1${codeFilter(byCode, 'code')}
      ORDER BY code`
  }
];

TABS.forEach(tab => {
  tab.headers.push(BRANCH_HEADER);
  tab.columns.push(BRANCH_COLUMN);
});

// Cac tab co `buildSql(byCode)`: `sql` = ban KHONG loc (y het ban goc, dung cho
// readDashboardSheets/readCoreDashboardSheets), `sqlByCodes` = ban loc theo ma
// (chi readRowsByCodes dung, can them tham so `$2` = text[]). 2 tab con lai
// ("Nhóm hàng", "Chi tiết hóa đơn") khong xuat Excel nen giu `sql` co san.
TABS.forEach(tab => {
  if (!tab.buildSql) return;
  tab.sql = tab.buildSql(false);
  tab.sqlByCodes = tab.buildSql(true);
});

const SHEET_NAMES = TABS.map(tab => tab.sheetName);

// "Chi tiết hóa đơn" (~51K dong) la tab nang nhat (do luong that ~8.8s/lan) —
// /api/dashboard (getDashboardData) khong con can doc thang tab nay nua vi cac
// khoi lien quan da chuyen sang doc server/dashboard/dashboardRollupRepository.js
// (ke hoach "melodic-juggling-karp"). Tab nay van con can cho /api/search +
// /api/export (readDashboardSheets() day du, KHONG doi) — CORE_TABS chi dung
// rieng cho readCoreDashboardSheets() ben duoi.
const CORE_EXCLUDED_SHEET_NAMES = new Set([CONFIG.SHEET_INVOICE_DETAILS]);
const CORE_TABS = TABS.filter(tab => !CORE_EXCLUDED_SHEET_NAMES.has(tab.sheetName));
const CORE_SHEET_NAMES = CORE_TABS.map(tab => tab.sheetName);

// 5 tab xuat duoc Excel = cac tab co `codeColumn` (alias cot ma, xem TABS):
// Hàng hóa, Hóa đơn, Đặt hàng, Trả hàng, Khách hàng.
// KHONG gom "Nhóm hàng" va "Chi tiết hóa đơn". Dung cho readRowsByCodes().
const EXPORT_TABS = TABS.filter(tab => tab.codeColumn);
const EXPORT_SHEET_NAMES = EXPORT_TABS.map(tab => tab.sheetName);
const EXPORT_TABS_BY_NAME = new Map(EXPORT_TABS.map(tab => [tab.sheetName, tab]));

// readRowsByCodes(): danh sach ma > CODE_BATCH_THRESHOLD thi chia lo
// CODE_BATCH_SIZE ma/cau truy van, chay TUAN TU (de 1 lan xuat khong chiem het
// pool 12 ket noi cua cac API khac). <= nguong thi chay dung 1 cau truy van.
const CODE_BATCH_THRESHOLD = 20000;
const CODE_BATCH_SIZE = 5000;

/** Nhan co so ('Hà Nội'/'Sài Gòn', mac dinh Hà Nội khi bo trong) -> ma Postgres ('hanoi'/'saigon'). */
function resolveBranchCode(branch) {
  const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
  if (!branchCode) {
    const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
    error.code = 'INVALID_BRANCH';
    error.statusCode = 400;
    throw error;
  }
  return branchCode;
}

/**
 * Chuan hoa danh sach ma dau vao: khu trung lap (giu thu tu xuat hien dau
 * tien), bo phan tu khong phai chuoi / rong / chi gom khoang trang / chua ky
 * tu NUL (Postgres `text` khong luu duoc NUL — de lot vao se lam LOI CA cau
 * truy van). KHONG trim: ma duoc so khop chinh xac tung ky tu.
 */
function normalizeCodes(codes) {
  const list = Array.isArray(codes) ? codes : (codes instanceof Set ? Array.from(codes) : []);
  const seen = new Set();
  const unique = [];
  for (const code of list) {
    if (typeof code !== 'string' || !code.trim() || code.includes('\x00') || seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }
  return unique;
}

async function queryTabs(pool, tabs, branch) {
  const requestedBranch = branch || BRANCHES.HANOI;
  const scope = resolveBranchScope(requestedBranch);
  if (!scope.length) resolveBranchCode(requestedBranch);

  // Hang dang van chuyen theo ma: 1 truy van nho dung chung cho moi co so, chay song song voi cac tab.
  const inTransitPromise = tabs.some(tab => tab.inTransitColumn) ? readInTransitByCode(pool) : null;
  const resultsByBranch = await Promise.all(scope.map(async physicalBranch => ({
    branch: physicalBranch,
    results: await Promise.all(tabs.map(tab => pool.query(tab.sql, [resolveBranchCode(physicalBranch)])))
  })));
  const inTransitByCode = inTransitPromise ? await inTransitPromise : null;

  const sheets = Object.fromEntries(tabs.map(tab => [tab.sheetName, [tab.headers.slice()]]));
  resultsByBranch.forEach(({ branch: physicalBranch, results }) => {
    tabs.forEach((tab, index) => {
      const rows = (results[index] && results[index].rows) || [];
      if (tab.inTransitColumn && inTransitByCode) applyInTransit(rows, inTransitByCode, tab.inTransitColumn);
      const branchIndex = tab.headers.indexOf('Chi nhánh');
      rows.forEach(row => {
        const values = tab.columns.map(column => row[column]);
        if (scope.length > 1 && branchIndex >= 0) values[branchIndex] = physicalBranch;
        sheets[tab.sheetName].push(values);
      });
    });
  });
  return sheets;
}

function createDashboardPgReader({ pool = getPool() } = {}) {
  /**
   * Doc 7 tab bao cao cua 1 co so tu Postgres.
   * @param {string} branch nhan hien thi ('Hà Nội'/'Sài Gòn'), xem branches.js
   * @returns {Promise<Object<string, any[][]>>} map ten sheet -> [header, ...rows]
   */
  async function readDashboardSheets(branch) {
    return queryTabs(pool, TABS, branch);
  }

  /**
   * Doc 6/7 tab (bo "Chi tiết hóa đơn") — CHI chay 6 cau SQL nhe,
   * KHONG chay cau SQL nang nhat roi bo ket qua trong JS (vay se khong tiet
   * kiem duoc gi). Dung cho getCachedDashboardCoreSheets() trong
   * dashboardData.js — nguon cho /api/dashboard.
   */
  async function readCoreDashboardSheets(branch, sheetNames) {
    // `sheetNames` (tuy chon): CHI doc cac tab core duoc chon (ten khong thuoc
    // CORE_SHEET_NAMES bi bo qua) — moi tab cua "Bao cao tong hop" chi doc dung
    // nhung bang no can (vd tab Dat hang ~23K dong chi Hoa don can). Bo trong
    // = doc du 6 tab core.
    const tabs = Array.isArray(sheetNames)
      ? CORE_TABS.filter(tab => sheetNames.includes(tab.sheetName))
      : CORE_TABS;
    return queryTabs(pool, tabs, branch);
  }

  /**
   * Doc CHI cac dong cua 1 tab (trong 5 tab xuat duoc, xem EXPORT_SHEET_NAMES)
   * co ma nam trong `codes` — 1 cau SQL loc theo ma o phia Postgres thay vi nap
   * ca tab roi loc trong JS. Ma truyen bang THAM SO ($2 = text[]), khong noi
   * chuoi vao SQL.
   *
   * @param {string} sheetName ten tab (CONFIG.SHEET_*), phai thuoc EXPORT_SHEET_NAMES
   * @param {string} branch nhan co so ('Hà Nội'/'Sài Gòn'), bo trong = Hà Nội (giong queryTabs)
   * @param {string[]} codes ma can lay (khu trung lap, bo rong/khong phai chuoi;
   *   khong con ma hop le => KHONG query, tra rows [])
   * @param {{signal?: AbortSignal}} [options] `signal` da huy -> dung TRUOC moi lo
   *   (throw code EXPORT_ABORTED, statusCode 499) de khong chay not cac lo con lai
   * @returns {Promise<{columns: string[], rows: Object[]}>} `columns` = alias cot
   *   theo dung thu tu tab; moi row la object khoa theo alias (gia tri y het
   *   readDashboardSheets: ngay 'DD/MM/YYYY HH24:MI', so la number...). Thu tu
   *   dong = ORDER BY cua tab; > CODE_BATCH_THRESHOLD ma thi chia lo nen thu tu
   *   la theo lo roi moi theo ORDER BY trong tung lo.
   * @throws statusCode 400 + code EXPORT_SOURCE_NOT_ALLOWED (tab khong xuat duoc)
   *   hoac INVALID_BRANCH (co so khong hop le) — kiem tra TRUOC khi xet `codes`.
   */
  async function readRowsByCodes(sheetName, branch, codes, options = {}) {
    const signal = options && options.signal;
    const tab = EXPORT_TABS_BY_NAME.get(sheetName);
    if (!tab) {
      const error = new Error(`Nguồn dữ liệu không hỗ trợ xuất Excel: ${String(sheetName)}`);
      error.code = 'EXPORT_SOURCE_NOT_ALLOWED';
      error.statusCode = 400;
      throw error;
    }
    const branchCode = resolveBranchCode(branch);
    const columns = tab.columns.slice();
    const uniqueCodes = normalizeCodes(codes);
    if (!uniqueCodes.length) return { columns, rows: [] };

    const batchSize = uniqueCodes.length > CODE_BATCH_THRESHOLD ? CODE_BATCH_SIZE : uniqueCodes.length;
    let inTransitByCode = null;
    const rows = [];
    for (let start = 0; start < uniqueCodes.length; start += batchSize) {
      if (signal && signal.aborted) {
        const error = new Error('Yêu cầu xuất file đã bị hủy.');
        error.code = 'EXPORT_ABORTED';
        error.statusCode = 499;
        throw error;
      }
      const batch = uniqueCodes.slice(start, start + batchSize);
      // Sau khi da kiem tra huy: yeu cau bi huy truoc lo dau thi KHONG chay truy van nao.
      if (tab.inTransitColumn && !inTransitByCode) inTransitByCode = await readInTransitByCode(pool);
      const result = await pool.query(tab.sqlByCodes, [branchCode, batch]);
      if (inTransitByCode) applyInTransit((result && result.rows) || [], inTransitByCode, tab.inTransitColumn);
      for (const row of (result && result.rows) || []) {
        const projected = {};
        for (const column of columns) projected[column] = row[column];
        rows.push(projected);
      }
    }
    return { columns, rows };
  }

  return { readDashboardSheets, readCoreDashboardSheets, readRowsByCodes };
}

const reader = createDashboardPgReader();

module.exports = {
  createDashboardPgReader,
  readDashboardSheets: (...args) => reader.readDashboardSheets(...args),
  readCoreDashboardSheets: (...args) => reader.readCoreDashboardSheets(...args),
  readRowsByCodes: (...args) => reader.readRowsByCodes(...args),
  SHEET_NAMES,
  CORE_SHEET_NAMES,
  // Bieu thuc SQL ton kho / gia von cua 1 dong products - job chup gia tri ton kho hang
  // ngay (inventoryValueSnapshot.js) dung lai de khong lech cong thuc voi tab Hang hoa.
  INVENTORY_ONHAND_SQL,
  INVENTORY_COST_SQL,
  // 5 tab xuat duoc Excel (readRowsByCodes chi nhan cac ten nay).
  EXPORT_SHEET_NAMES,
  // Chi dung cho test/doi chieu: header phai y het Sheets that.
  __headers__: Object.fromEntries(TABS.map(tab => [tab.sheetName, tab.headers])),
  // Metadata tung tab (BAN SAO, sua khong anh huong TABS): headers (nhan hien
  // thi cu), columns (alias SQL, cung thu tu voi headers) va codeColumn (alias
  // cot ma; null voi 2 tab khong xuat duoc: "Nhóm hàng", "Chi tiết hóa đơn").
  __tabs__: Object.fromEntries(TABS.map(tab => [tab.sheetName, {
    headers: tab.headers.slice(),
    columns: tab.columns.slice(),
    codeColumn: tab.codeColumn || null
  }])),
  // Xuat de tai dung y het logic map trang thai hoa don (uu tien statusValue
  // cua API, fallback bang ma) o noi khac (vd invoiceStatusService.js) —
  // tranh viet trung 1 bang tra ma o 2 file.
  statusLabel,
  INVOICE_STATUS_FALLBACK,
  ORDER_STATUS_FALLBACK,
  RETURN_STATUS_FALLBACK
};
