'use strict';
// ==========================================
// TRA NCC TU FILE EXCEL KIOTVIET — thay the viec doc tab Google Sheet "Tra NCC"
// dan tay. Nguoi dung tu xuat Excel tu man hinh "Tra hang nhap" cua KiotViet
// (KiotViet khong public API cho nghiep vu nay) roi upload len day.
//
// LUU Y THU VIEN: dung `xlsx` (SheetJS) de doc file, KHONG dung `exceljs` —
// exceljs 4.4.0 loi "Cannot read properties of undefined (reading 'styles')"
// tren file KiotViet xuat that (style index vuot pham vi styles.xml, loi cua
// exceljs voi file phan mem khac sinh ra, da kiem chung truc tiep). exceljs
// van dung binh thuong cho cac cho XUAT excel khac trong repo nay.
//
// LUU Y MUI GIO: cot "Thoi gian" doc bang SheetJS voi { raw: true } tra ve
// serial number Excel — dung XLSX.SSF.parse_date_code() de lay thang {y,m,d}
// TRUC TIEP, KHONG di qua doi tuong Date (dodge dung loi lech ngay do offset
// gio VN, giong ly do sheetTimelineBuilder.js cu tranh dung Date).
// ==========================================
const XLSX = require('xlsx');
const { parseNullableNumber } = require('../debtManagement');

const REQUIRED_COLUMNS = Object.freeze(['Thời gian', 'Mã hàng', 'Số lượng']);
const OPTIONAL_COLUMNS = Object.freeze(['Tên hàng', 'Trạng thái']);
const COMPLETED_STOCK_MOVEMENT_STATUSES = new Set(['hoàn thành', 'đã nhập hàng', 'đã trả hàng']);

function isCompletedStockMovementStatus(value) {
  if (Number(value) === 3) return true;
  return COMPLETED_STOCK_MOVEMENT_STATUSES.has(String(value || '').trim().toLocaleLowerCase('vi-VN'));
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Chap nhan ca serial number Excel (file that tu KiotViet) lan chuoi ngay
// dd/MM/yyyy hoac ISO yyyy-MM-dd (phong khi file duoc chinh sua/luu lai bang
// cong cu khac lam mat dinh dang so). Tra null neu khong doc duoc.
function parseCellDateKey(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = XLSX.SSF.parse_date_code(raw);
    if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
    return `${parsed.y}-${pad2(parsed.m)}-${pad2(parsed.d)}`;
  }
  const str = String(raw).trim();
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) {
    const [, dd, MM, yyyy] = dmy;
    return `${yyyy}-${pad2(MM)}-${pad2(dd)}`;
  }
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, yyyy, MM, dd] = iso;
    return `${yyyy}-${pad2(MM)}-${pad2(dd)}`;
  }
  return null;
}

function buildColumnIndex(headerRow) {
  const index = {};
  (headerRow || []).forEach((name, i) => {
    const key = String(name || '').trim();
    if (key && !(key in index)) index[key] = i;
  });
  return index;
}

/**
 * Doc buffer file Excel Tra NCC xuat tu KiotViet, tra ve cac dong hop le da
 * chuan hoa + danh sach dong bi bo qua kem ly do (khong am tham quy ve 0).
 * @param {Buffer} buffer
 * @returns {{ rows: Array<{code:string, name:string, dateKey:string, quantity:number}>,
 *             skipped: Array<{row:number, reason:string}>, totalDataRows: number }}
 */
function parseSupplierReturnWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    const err = new Error('File Excel không có sheet dữ liệu nào.');
    err.code = 'SUPPLIER_RETURN_IMPORT_EMPTY_FILE';
    throw err;
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  if (rows.length === 0) {
    const err = new Error('File Excel không có dữ liệu.');
    err.code = 'SUPPLIER_RETURN_IMPORT_EMPTY_FILE';
    throw err;
  }

  const columnIndex = buildColumnIndex(rows[0]);
  const missingColumns = REQUIRED_COLUMNS.filter((name) => !(name in columnIndex));
  if (missingColumns.length > 0) {
    const err = new Error(`File thiếu cột bắt buộc: ${missingColumns.join(', ')}.`);
    err.code = 'SUPPLIER_RETURN_IMPORT_MISSING_COLUMNS';
    throw err;
  }

  const hasStatusColumn = 'Trạng thái' in columnIndex;
  const hasNameColumn = 'Tên hàng' in columnIndex;

  const parsedRows = [];
  const skipped = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) continue;
    const rowNumber = r + 1; // so dong thuc te trong Excel (1-based, ke ca header)

    if (hasStatusColumn && !isCompletedStockMovementStatus(row[columnIndex['Trạng thái']])) {
      skipped.push({ row: rowNumber, reason: 'Trạng thái chưa hoàn tất' });
      continue;
    }

    const code = String(row[columnIndex['Mã hàng']] || '').trim();
    if (!code) {
      skipped.push({ row: rowNumber, reason: 'Thiếu Mã hàng' });
      continue;
    }

    const dateKey = parseCellDateKey(row[columnIndex['Thời gian']]);
    if (!dateKey) {
      skipped.push({ row: rowNumber, reason: 'Không đọc được Thời gian' });
      continue;
    }

    const quantity = parseNullableNumber(row[columnIndex['Số lượng']]);
    if (quantity === null) {
      skipped.push({ row: rowNumber, reason: 'Không đọc được Số lượng' });
      continue;
    }

    parsedRows.push({
      code,
      name: hasNameColumn ? String(row[columnIndex['Tên hàng']] || '').trim() : '',
      dateKey,
      quantity
    });
  }

  return { rows: parsedRows, skipped, totalDataRows: rows.length - 1 };
}

const REPLACE_SQL_DELETE = 'DELETE FROM supplier_return_imports WHERE branch = $1';
const REPLACE_SQL_INSERT = `
  INSERT INTO supplier_return_imports
    (branch, product_code, product_name, return_date, quantity, imported_by, source_file)
  SELECT $1, u.code, u.name, u.dt, u.qty, $6, $7
  FROM UNNEST($2::text[], $3::text[], $4::date[], $5::numeric[]) AS u(code, name, dt, qty)`;

/**
 * Thay the toan bo du lieu Tra NCC cua 1 co so bang danh sach dong moi (xoa +
 * chen trong 1 transaction) — giu dung ban chat "dan de" cua tab Sheet cu.
 */
async function replaceSupplierReturnImport({ pool, branch, rows, sourceFile = '', importedBy = '' }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(REPLACE_SQL_DELETE, [branch]);
    if (rows.length > 0) {
      await client.query(REPLACE_SQL_INSERT, [
        branch,
        rows.map((r) => r.code),
        rows.map((r) => r.name),
        rows.map((r) => r.dateKey),
        rows.map((r) => r.quantity),
        importedBy,
        sourceFile
      ]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// to_char(...) tra ve chuoi 'YYYY-MM-DD' truc tiep tu DATE column — tranh doi
// tuong Date/timezone khong can thiet (return_date la DATE, khong gio, khong
// lech mui gio nao ca).
const STATUS_SQL = `
  SELECT count(*)::int AS row_count,
         to_char(min(return_date), 'YYYY-MM-DD') AS earliest_date,
         to_char(max(return_date), 'YYYY-MM-DD') AS latest_date,
         max(imported_at) AS imported_at,
         (array_agg(imported_by ORDER BY imported_at DESC))[1] AS imported_by,
         (array_agg(source_file ORDER BY imported_at DESC))[1] AS source_file
  FROM supplier_return_imports
  WHERE branch = $1`;

/** Trang thai import hien tai cua 1 co so — dung de hien thi UI + canh bao thieu lich su. */
async function getSupplierReturnImportStatus({ pool, branch }) {
  const result = await pool.query(STATUS_SQL, [branch]);
  const row = result.rows[0];
  return {
    branch,
    rowCount: row.row_count || 0,
    earliestDate: row.earliest_date || null,
    latestDate: row.latest_date || null,
    importedAt: row.imported_at || null,
    importedBy: row.imported_by || '',
    sourceFile: row.source_file || ''
  };
}

module.exports = {
  parseSupplierReturnWorkbook,
  replaceSupplierReturnImport,
  getSupplierReturnImportStatus,
  parseCellDateKey,
  isCompletedStockMovementStatus
};
