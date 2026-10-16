'use strict';

// Manh SQL dung chung cho cac job tinh doanh so tu invoices/invoice_details/customers
// (customerInvoiceLinesRefresh.js, businessMonthlyRefresh.js...). Chuyen nguyen van tu
// customerInvoiceLinesRefresh.js de moi noi dung CHUNG 1 dinh nghia, khong lech so lieu.

const { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL } = require('../dashboard/customerProductTopRepository');

// Cung dinh nghia voi normalizeSearchValue() cua dashboardData.js (NFKC, bo ky tu
// rong, gop khoang trang, trim, chu thuong) de doi chieu ten khach hang y nhu
// luong doc sheet cu.
function normalizedNameSql(expression) {
  return `lower(btrim(regexp_replace(regexp_replace(normalize(${expression}, NFKC), '[\\u200B-\\u200D\\uFEFF]', '', 'g'), '\\s+', ' ', 'g')))`;
}

// Y het cot "Trạng thái" cua tab Hoa don (dashboardPgReader.js statusLabel() voi
// INVOICE_STATUS_FALLBACK): uu tien statusValue that, bang tra so chi la du phong.
const INVOICE_STATUS_SQL = `COALESCE(NULLIF(i.raw->>'statusValue', ''),
    CASE i.status WHEN 1 THEN 'Hoàn thành' WHEN 2 THEN 'Đã hủy' WHEN 3 THEN 'Đang xử lý'
      ELSE COALESCE(i.status::text, '') END)`;

// $1 la danh sach co so (text[]).
//
// Luong doc sheet cu (computeCustomerProductRevenue) doi chieu ma khach nhu sau,
// va o day GIU NGUYEN: ma tren hoa don (customerCode); neu trong thi tim ma khach
// trong bang customers cung co so theo ten chuan hoa (ten trung => ma lon nhat,
// vi cu duyet theo thu tu ma va dong sau de dong truoc). Buoc doi chieu theo SDT
// cua luong cu KHONG co o day: cot "SĐT khách" cua tab Hoa don luon rong trong
// Postgres (dashboardPgReader.js, hang MISSING) nen buoc do khong bao gio khop.
const CUSTOMER_BY_NAME_CTE = `
  WITH customer_by_name AS (
    SELECT DISTINCT ON (branch, name_key) branch, name_key, code
    FROM (
      SELECT branch, btrim(code) AS code, code AS raw_code,
             ${normalizedNameSql('name')} AS name_key
      FROM customers
      WHERE branch = ANY($1::text[])
        AND btrim(COALESCE(code, '')) <> ''
        AND btrim(COALESCE(name, '')) <> ''
    ) named
    ORDER BY branch, name_key, raw_code DESC
  )`;

module.exports = { DETAIL_AMOUNT_SQL, RETURN_AMOUNT_SQL, INVOICE_STATUS_SQL, normalizedNameSql, CUSTOMER_BY_NAME_CTE };
