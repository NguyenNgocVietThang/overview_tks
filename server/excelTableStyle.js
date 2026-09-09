'use strict';

// ==========================================
// EXCEL TABLE STYLE — quy tac dinh dang dung chung cho MOI bang xuat Excel
// cua du an (dashboard/exportService.js, hr/hrLeaveExportService.js,
// shipment/orderLifecycleExport.js): freeze header, khong to mau nen, chu
// den, tat gridline mac dinh, full border quanh tung o.
// ==========================================

const TABLE_BORDER = { style: 'thin', color: { argb: 'FFB8C4CE' } };

const HEADER_FONT = { bold: true, color: { argb: 'FF000000' } };

/**
 * View dong bang (frozen header) + tat gridline mac dinh cua Excel.
 * @param {number} ySplit So dong dong bang tinh tu tren xuong (thuong la 1).
 */
function frozenNoGridlinesView(ySplit = 1) {
  return [{ state: 'frozen', ySplit, showGridLines: false }];
}

/**
 * Ke full border (4 canh) cho toan bo vung bang (header + du lieu), thay vi
 * chi vien mot canh cua header — ap dung dong nhat cho moi bang xuat Excel.
 */
function applyFullTableBorder(worksheet, columnCount, rowCount) {
  for (let r = 1; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    for (let c = 1; c <= columnCount; c++) {
      row.getCell(c).border = { top: TABLE_BORDER, left: TABLE_BORDER, bottom: TABLE_BORDER, right: TABLE_BORDER };
    }
  }
}

module.exports = { TABLE_BORDER, HEADER_FONT, frozenNoGridlinesView, applyFullTableBorder };
