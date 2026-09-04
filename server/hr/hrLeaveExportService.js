// ==========================================
// HR LEAVE EXPORT SERVICE — xuat file Excel danh sach yeu cau nghi phep
// dang duoc loc/sap xep tren trang Quan ly nhan su.
//
// Tach rieng khoi server/dashboard/exportService.js vi module do gan chat
// voi dashboardData (KiotViet) — khong phu hop tai su dung cho HR.
// ==========================================
'use strict';

const ExcelJS = require('exceljs');
const repo = require('./hrLeaveRepository');

const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// fieldKey -> do rong cot hop ly cho tung loai du lieu.
const COLUMN_WIDTHS = {
  request_id: 20, telegram_chat_id: 16, telegram_username: 18, web_username: 16,
  ho_ten: 22, chuc_vu: 28, ly_do: 30, loai_yeu_cau: 22,
  thoi_gian_gui: 20, thoi_gian_bat_dau: 20, thoi_gian_ket_thuc: 20,
  tong_buoi_nghi: 14, tong_ngay_nghi: 18, nguoi_ban_giao: 18,
  trang_thai: 14, nguoi_duyet: 16, thoi_diem_duyet: 18, ghi_chu_duyet: 26,
  co_nghi_gap: 10, co_tu_y_nghi: 10, created_at: 18, updated_at: 18,
  tin_nhan: 60
};

const SORTABLE_FIELDS = new Set(repo.LEAVE_SCHEMA_FIELD_KEYS);

/**
 * Sap xep lai mang ket qua theo dung cot/chieu dang duoc sort tren bang UI,
 * de file xuat ra khop voi thu tu nguoi dung dang xem.
 */
function applySort(items, sortField, sortDir) {
  if (!sortField || !SORTABLE_FIELDS.has(sortField)) return items;
  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = items.slice();
  sorted.sort((a, b) => {
    const av = a[sortField];
    const bv = b[sortField];
    const an = Number(av);
    const bn = Number(bv);
    let cmp;
    if (Number.isFinite(an) && Number.isFinite(bn) && av !== '' && bv !== '') {
      cmp = an - bn;
    } else {
      cmp = String(av || '').localeCompare(String(bv || ''), 'vi', { numeric: true, sensitivity: 'base' });
    }
    return cmp * dir;
  });
  return sorted;
}

function safeFileNamePart(str) {
  return String(str || '').replace(/[^0-9A-Za-z-]/g, '');
}

/**
 * @param {Object} filters { status, employee, from, to, sortField, sortDir }
 * @returns {Promise<{ buffer: Buffer, fileName: string, mime: string }>}
 */
async function buildLeaveRequestsWorkbook(filters, branch) {
  filters = filters || {};
  const items = applySort(
    await repo.getLeaveRequests({ status: filters.status, employee: filters.employee, from: filters.from, to: filters.to }, branch),
    filters.sortField,
    filters.sortDir
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TOKOSI Dashboard';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Nghỉ phép');

  const headers = repo.LEAVE_SCHEMA_HEADERS;
  const fieldKeys = repo.LEAVE_SCHEMA_FIELD_KEYS;

  sheet.columns = fieldKeys.map((key, i) => ({
    header: headers[i],
    key,
    width: COLUMN_WIDTHS[key] || 16
  }));
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: 'middle' };

  items.forEach(item => {
    const row = {};
    fieldKeys.forEach(key => {
      const v = item[key];
      row[key] = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : (v == null ? '' : v);
    });
    sheet.addRow(row);
  });

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fieldKeys.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  const fromPart = safeFileNamePart(filters.from) || 'tatca';
  const toPart = safeFileNamePart(filters.to) || 'tatca';
  const fileName = `nghi-phep_${fromPart}_${toPart}.xlsx`;

  return { buffer, fileName, mime: EXCEL_MIME };
}

module.exports = { buildLeaveRequestsWorkbook };
