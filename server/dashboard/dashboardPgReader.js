'use strict';
// ==========================================
// DASHBOARD PG READER — dung lai dung shape `[header, ...rows]` cua 9 tab
// Google Sheets KiotViet, nhung doc tu Supabase Postgres (bang do
// server/kiotvietSync/ dong bo) thay vi Google Sheets API.
//
// Muc tieu: KHONG doi logic nghiep vu trong dashboardData.js/exportService.js
// (van tra cuu theo TEN COT tieng Viet, doi khi theo VI TRI cot), nen:
//   - Ten header phai y het Sheets that (lay tu src-dashboard/kiotviet/
//     SheetSchemas.gs + xac minh truc tiep bang Sheets API tren spreadsheet
//     san xuat) — KHONG duoc doi ten/thu tu.
//   - Cach dung gia tri cung phai giong Apps Script: nhan trang thai lay tu
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
const { BRANCHES, branchLabelToCode } = require('../branch/branches');

// Dinh dang y het formatDate() trong src-dashboard/utils/Helpers.gs.
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

const INVOICE_STATUS_FALLBACK = { 1: 'Phiếu tạm', 2: 'Đã hủy', 3: 'Hoàn thành' };
const ORDER_STATUS_FALLBACK = {
  1: 'Phiếu tạm', 2: 'Đang xử lý', 3: 'Đã xác nhận', 4: 'Đã hủy', 5: 'Hoàn thành'
};
const RETURN_STATUS_FALLBACK = { 1: 'Hoàn thành', 2: 'Đã hủy' };

// Cac cot Sheets KHONG co nguon trong Postgres hien tai. Giu chuoi rong (dung
// nhu Apps Script lam khi payload thieu truong) thay vi bia du lieu:
//   - "Giá vốn"/"Tồn kho"/"Khách đặt"/"Vị trí" (Hàng hóa): nam trong mang
//     `inventories`/`productShelves` cua KiotViet, nhung `products.raw` trong
//     Postgres khong co hai mang nay (kiem tra 2026-09-16: 0/10525 dong co).
//   - "SĐT khách" (Hóa đơn): payload /invoices khong tra so dien thoai khach
//     (cot nay cung RONG trong Sheets san xuat — da doi chieu truc tiep).
//   - "Nhóm khách hàng" (Khách hàng): `customers.raw` khong co `groups`/
//     `customerGroupDetails`.
//   - "Có nhóm con" (Nhóm hàng): `categories.raw` khong co `hasChild`.
const MISSING = `''`;

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
        ${fmtRawTs(`raw->>'createdDate'`)}           AS ngay_tao
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
      'Ngày tạo', 'Ngày cập nhật', 'Mã loại hàng'
    ],
    columns: [
      'ma_hang', 'ten_hang', 'nhom_hang', 'loai_hang', 'gia_von', 'gia_ban',
      'ton_kho', 'khach_dat', 'trang_thai', 'ngay_sua_cuoi', 'ma_nhom_hang',
      'vi_tri', 'id_hang_hoa', 'id_gian_hang', 'duoc_phep_ban', 'ten_goc',
      'mo_ta', 'gia_tri_quy_doi', 'co_thuoc_tinh', 'dang_hoat_dong',
      'ngay_tao', 'ngay_cap_nhat', 'ma_loai_hang'
    ],
    sql: `-- tab: Hàng hóa
      SELECT
        ${text('code')}                                        AS ma_hang,
        COALESCE(NULLIF(raw->>'fullName', ''), name, '')       AS ten_hang,
        ${text(`raw->>'categoryName'`)}                        AS nhom_hang,
        CASE (raw->>'type')
          WHEN '1' THEN 'Combo'
          WHEN '3' THEN 'Dịch vụ'
          ELSE 'Hàng hóa'
        END                                                    AS loai_hang,
        ${MISSING}                                             AS gia_von,
        ${num('base_price')}                                   AS gia_ban,
        ${MISSING}                                             AS ton_kho,
        ${MISSING}                                             AS khach_dat,
        CASE WHEN is_active IS FALSE THEN 'Ngừng kinh doanh' ELSE 'Đang kinh doanh' END AS trang_thai,
        ${fmtTs('COALESCE(modified_date, created_date)')}      AS ngay_sua_cuoi,
        COALESCE(category_id::text, '')                        AS ma_nhom_hang,
        ${MISSING}                                             AS vi_tri,
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
        ${text(`raw->>'type'`)}                                AS ma_loai_hang
      FROM products
      WHERE branch = $1
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
    sql: `-- tab: Hóa đơn
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
        ${fmtTs('i.created_date')}                                 AS ngay_tao
      FROM invoices i
      LEFT JOIN staff s ON s.branch = i.branch AND s.id = i.sold_by_id
      WHERE i.branch = $1
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
        ${text(`d.raw->>'note'`)}                               AS ghi_chu
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
    sql: `-- tab: Đặt hàng
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
        ${fmtTs('modified_date')}                              AS ngay_cap_nhat
      FROM orders
      WHERE branch = $1
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
    sql: `-- tab: Trả hàng
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
        ${fmtTs('modified_date')}                              AS ngay_cap_nhat
      FROM returns
      WHERE branch = $1
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
    sql: `-- tab: Khách hàng
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
        ${fmtTs('created_date')}                 AS ngay_tao
      FROM customers
      WHERE branch = $1
      ORDER BY code`
  },
  {
    sheetName: CONFIG.SHEET_SUPPLIERS,
    headers: [
      'Mã NCC', 'Tên NCC', 'Điện thoại', 'Địa chỉ', 'Nợ cần trả',
      'ID nhà cung cấp', 'Trạng thái hoạt động', 'Ngày cập nhật', 'Ngày tạo',
      'ID gian hàng', 'ID chi nhánh tạo', 'Người tạo', 'Tổng mua',
      'Tổng mua trừ trả hàng'
    ],
    columns: [
      'ma_ncc', 'ten_ncc', 'dien_thoai', 'dia_chi', 'no_can_tra',
      'id_nha_cung_cap', 'trang_thai_hoat_dong', 'ngay_cap_nhat', 'ngay_tao',
      'id_gian_hang', 'id_chi_nhanh_tao', 'nguoi_tao', 'tong_mua',
      'tong_mua_tru_tra_hang'
    ],
    sql: `-- tab: Nhà cung cấp
      SELECT
        ${text('code')}                                    AS ma_ncc,
        ${text('name')}                                    AS ten_ncc,
        ${text('phone')}                                   AS dien_thoai,
        ${text(`raw->>'address'`)}                         AS dia_chi,
        ${num('debt')}                                     AS no_can_tra,
        COALESCE(id::text, '')                             AS id_nha_cung_cap,
        ${boolText(`raw->>'isActive'`)}                    AS trang_thai_hoat_dong,
        ${fmtTs('modified_date')}                          AS ngay_cap_nhat,
        ${fmtTs('created_date')}                           AS ngay_tao,
        ${text(`raw->>'retailerId'`)}                      AS id_gian_hang,
        ${text(`raw->>'branchId'`)}                        AS id_chi_nhanh_tao,
        ${text(`raw->>'createdBy'`)}                       AS nguoi_tao,
        ${num(`raw->>'totalInvoiced'`)}                    AS tong_mua,
        ${num(`raw->>'totalInvoicedWithoutReturn'`)}       AS tong_mua_tru_tra_hang
      FROM suppliers
      WHERE branch = $1
      ORDER BY code`
  },
  {
    sheetName: CONFIG.SHEET_PURCHASES,
    headers: [
      'Chi nhánh', 'Mã nhập hàng', 'Thời gian', 'Thời gian tạo',
      'Mã nhà cung cấp', 'Tên nhà cung cấp', 'Người nhập', 'Người tạo',
      'Tổng tiền hàng', 'Giảm giá phiếu nhập', 'Cần trả NCC', 'Tiền đã trả NCC',
      'Ghi chú', 'Tổng số lượng', 'Tổng số mặt hàng', 'Trạng thái', 'Mã hàng',
      'Tên hàng', 'Đơn giá', 'Giảm giá %', 'Giảm giá', 'Giá nhập', 'Thành tiền',
      'Số lượng'
    ],
    columns: [
      'chi_nhanh', 'ma_nhap_hang', 'thoi_gian', 'thoi_gian_tao',
      'ma_nha_cung_cap', 'ten_nha_cung_cap', 'nguoi_nhap', 'nguoi_tao',
      'tong_tien_hang', 'giam_gia_phieu_nhap', 'can_tra_ncc', 'tien_da_tra_ncc',
      'ghi_chu', 'tong_so_luong', 'tong_so_mat_hang', 'trang_thai', 'ma_hang',
      'ten_hang', 'don_gia', 'giam_gia_pct', 'giam_gia', 'gia_nhap',
      'thanh_tien', 'so_luong'
    ],
    // Sheet "Nhập hàng" la dang "flatten": moi dong = 1 mat hang, thong tin
    // phieu nhap duoc lap lai tren tung dong (xem buildPurchaseSheetRow_).
    // LEFT JOIN de phieu nhap khong co dong hang nao van con 1 dong tren sheet.
    sql: `-- tab: Nhập hàng
      WITH detail_totals AS (
        SELECT purchase_id,
               SUM(COALESCE(quantity, 0))::float8 AS total_quantity,
               COUNT(*)::float8                   AS line_count
        FROM purchase_details
        WHERE branch = $1
        GROUP BY purchase_id
      )
      SELECT
        ${text(`pu.raw->>'branchName'`)}                        AS chi_nhanh,
        ${text('pu.code')}                                      AS ma_nhap_hang,
        ${fmtTs('pu.purchase_date')}                            AS thoi_gian,
        ${fmtTs('pu.created_date')}                             AS thoi_gian_tao,
        COALESCE(NULLIF(pu.raw->>'supplierCode', ''), su.code, '') AS ma_nha_cung_cap,
        COALESCE(NULLIF(pu.raw->>'supplierName', ''), su.name, '') AS ten_nha_cung_cap,
        ${text(`pu.raw->>'purchaseName'`)}                      AS nguoi_nhap,
        COALESCE(
          NULLIF(pu.raw->>'createdByName', ''),
          NULLIF(pu.raw->>'creatorName', ''),
          NULLIF(pu.raw->>'purchaseName', ''),
          ''
        )                                                       AS nguoi_tao,
        ${num('pu.total')}                                      AS tong_tien_hang,
        ${num(`pu.raw->>'discount'`)}                           AS giam_gia_phieu_nhap,
        COALESCE(
          (pu.raw->>'supplierDebt')::float8,
          (pu.raw->>'needToPay')::float8,
          ${num('pu.total')} - ${num(`pu.raw->>'totalPayment'`)}
        )                                                       AS can_tra_ncc,
        ${num(`pu.raw->>'totalPayment'`)}                       AS tien_da_tra_ncc,
        ${text(`pu.raw->>'description'`)}                       AS ghi_chu,
        COALESCE(dt.total_quantity, 0)                          AS tong_so_luong,
        COALESCE(dt.line_count, 0)                              AS tong_so_mat_hang,
        ${statusLabel({}, 'pu.')}                               AS trang_thai,
        COALESCE(NULLIF(d.raw->>'productCode', ''), p.code, '')  AS ma_hang,
        COALESCE(NULLIF(d.raw->>'productName', ''), p.name, '')  AS ten_hang,
        ${num('d.price')}                                       AS don_gia,
        ${num(`d.raw->>'discountRatio'`)}                       AS giam_gia_pct,
        ${num(`d.raw->>'discount'`)}                            AS giam_gia,
        ${num('d.price')}                                       AS gia_nhap,
        CASE WHEN d.raw ? 'subTotal'
          THEN ${num(`d.raw->>'subTotal'`)}
          ELSE ${num('d.price')} * ${num('d.quantity')} - ${num(`d.raw->>'discount'`)}
        END                                                     AS thanh_tien,
        ${num('d.quantity')}                                    AS so_luong
      FROM purchases pu
      LEFT JOIN purchase_details d ON d.branch = pu.branch AND d.purchase_id = pu.id
      LEFT JOIN detail_totals dt ON dt.purchase_id = pu.id
      LEFT JOIN suppliers su ON su.branch = pu.branch AND su.id = pu.supplier_id
      LEFT JOIN products p ON p.branch = pu.branch AND p.id = d.product_id
      WHERE pu.branch = $1
      ORDER BY pu.purchase_date DESC NULLS LAST, pu.id DESC, d.line_no`
  }
];

const SHEET_NAMES = TABS.map(tab => tab.sheetName);

function createDashboardPgReader({ pool = getPool() } = {}) {
  /**
   * Doc 9 tab bao cao cua 1 co so tu Postgres.
   * @param {string} branch nhan hien thi ('Hà Nội'/'Sài Gòn'), xem branches.js
   * @returns {Promise<Object<string, any[][]>>} map ten sheet -> [header, ...rows]
   */
  async function readDashboardSheets(branch) {
    const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }

    const results = await Promise.all(
      TABS.map(tab => pool.query(tab.sql, [branchCode]))
    );

    const sheets = {};
    TABS.forEach((tab, index) => {
      const rows = (results[index] && results[index].rows) || [];
      sheets[tab.sheetName] = [
        tab.headers.slice(),
        ...rows.map(row => tab.columns.map(column => row[column]))
      ];
    });
    return sheets;
  }

  return { readDashboardSheets };
}

const reader = createDashboardPgReader();

module.exports = {
  createDashboardPgReader,
  readDashboardSheets: (...args) => reader.readDashboardSheets(...args),
  SHEET_NAMES,
  // Chi dung cho test/doi chieu: header phai y het Sheets that.
  __headers__: Object.fromEntries(TABS.map(tab => [tab.sheetName, tab.headers])),
  // Xuat de tai dung y het logic map trang thai hoa don (uu tien statusValue
  // cua API, fallback bang ma) o noi khac (vd invoiceStatusService.js) —
  // tranh viet trung 1 bang tra ma o 2 file.
  statusLabel,
  INVOICE_STATUS_FALLBACK,
  ORDER_STATUS_FALLBACK,
  RETURN_STATUS_FALLBACK
};
