'use strict';
// ==========================================
// CHI TIET HOA DON 90 NGAY THEO KHACH — doc bang customer_invoice_lines_90d
// (migration 0022) do customerInvoiceLinesRefresh.js dung lai 1 lan/dem. Thay cho
// viec nap ca 3 sheet (khach hang, hoa don, chi tiet hoa don) roi duyet tung dong
// moi lan chon 1 khach o "Bao cao doanh thu theo khach".
// ==========================================
const { getPool } = require('../db/pool');

// 1 cau SQL duy nhat: cua so (bang state) va cac dong cua khach cung nam trong 1
// snapshot, nen job dung lai COMMIT giua chung khong the tra ve cua so cu kem dong
// moi. LEFT JOIN de khach khong co dong nao van thay duoc dong state (=> bang da
// dung, ket qua that su rong). Chua co dong state => 0 dong => tra null.
// `sold_date` doi sang chuoi ngay ngay trong SQL, tranh driver doi DATE thanh Date
// theo mui gio may chu.
const READ_SQL = `
  SELECT to_char(s.window_start, 'YYYY-MM-DD') AS window_start,
         to_char(s.window_end, 'YYYY-MM-DD')   AS window_end,
         s.computed_at,
         l.branch, l.customer_name, l.item_code, l.item_name, l.quantity, l.revenue,
         to_char(l.sold_date, 'DD/MM/YYYY')    AS date_key
  FROM customer_invoice_lines_state s
  LEFT JOIN customer_invoice_lines_90d l
    ON l.branch = ANY($1::text[]) AND l.customer_code = $2
  WHERE s.id = 1
  ORDER BY l.branch, l.invoice_id DESC, l.line_no`;

// Khach o "Cả hai" duoc gop theo TEN nen moi co so co MA KHACH RIENG: ghep (co so, ma)
// bang unnest 2 mang song song ($1 = co so, $2 = ma tuong ung).
const READ_BY_BRANCH_CODES_SQL = `
  SELECT to_char(s.window_start, 'YYYY-MM-DD') AS window_start,
         to_char(s.window_end, 'YYYY-MM-DD')   AS window_end,
         s.computed_at,
         l.branch, l.customer_name, l.item_code, l.item_name, l.quantity, l.revenue,
         to_char(l.sold_date, 'DD/MM/YYYY')    AS date_key
  FROM customer_invoice_lines_state s
  LEFT JOIN customer_invoice_lines_90d l
    ON (l.branch, l.customer_code) IN (SELECT * FROM unnest($1::text[], $2::text[]))
  WHERE s.id = 1
  ORDER BY l.branch, l.invoice_id DESC, l.line_no`;

function createCustomerInvoiceLinesRepository({ pool = getPool() } = {}) {
  /**
   * @param {Object} params
   * @param {string[]} params.branchCodes ma co so vat ly ('hanoi'/'saigon')
   * @param {string} params.customerCode ma khach hang da trim
   * @param {Object<string,string>} [params.customerCodesByBranch] ma khach RIENG tung co so
   *   ('hanoi'/'saigon' -> ma); co thi moi co so tra theo ma cua chinh no (khach gop theo ten)
   * @returns {Promise<null | {window: {start: string, end: string}, computedAt: Date,
   *   linesByBranch: Object<string, Array>}>} null neu bang chua tung duoc dung.
   *   Moi dong theo thu tu cu cua sheet chi tiet hoa don (hoa don moi nhat truoc).
   */
  async function readCustomerInvoiceLines({ branchCodes, customerCode, customerCodesByBranch }) {
    const pairedBranches = customerCodesByBranch
      ? branchCodes.filter(code => customerCodesByBranch[code])
      : [];
    const { rows } = pairedBranches.length
      ? await pool.query(READ_BY_BRANCH_CODES_SQL, [pairedBranches, pairedBranches.map(code => customerCodesByBranch[code])])
      : await pool.query(READ_SQL, [branchCodes, customerCode]);
    if (!rows.length) return null;

    const linesByBranch = {};
    branchCodes.forEach(code => { linesByBranch[code] = []; });
    rows.forEach(row => {
      if (!row.branch) return;
      linesByBranch[row.branch].push({
        dateKey: row.date_key,
        customerName: row.customer_name,
        itemCode: row.item_code,
        itemName: row.item_name,
        quantity: row.quantity,
        revenue: row.revenue
      });
    });
    return {
      window: { start: rows[0].window_start, end: rows[0].window_end },
      computedAt: rows[0].computed_at,
      linesByBranch
    };
  }

  return { readCustomerInvoiceLines };
}

const repository = createCustomerInvoiceLinesRepository();

module.exports = {
  createCustomerInvoiceLinesRepository,
  readCustomerInvoiceLines: (...args) => repository.readCustomerInvoiceLines(...args),
  __sql__: { READ_SQL, READ_BY_BRANCH_CODES_SQL }
};
