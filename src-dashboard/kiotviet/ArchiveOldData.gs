/**
 * CHI DOC — in ra cac Script Properties dieu khien tien do dong bo (chuoi
 * master, cac chunk rieng le, job bao cao) de biet chinh xac cai gi dang
 * chan cac trigger tu dong tiep tuc chay.
 */
function previewSyncBlockers() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const keysOfInterest = Object.keys(props).filter(function(key) {
    return key.indexOf('SYNC_') === 0 ||
      key.indexOf('MASTER_CHAIN') === 0 ||
      key.indexOf('POLLING_ONLY') === 0 ||
      key.indexOf('CUSTOMER_REPORT') === 0 ||
      key.indexOf('CUSTOMER_PRODUCT_REPORT') === 0 ||
      key.indexOf('CUSTOMER_BY_PRODUCT_REPORT') === 0;
  });
  const report = {};
  keysOfInterest.forEach(function(key) { report[key] = props[key]; });

  const triggerNames = ScriptApp.getProjectTriggers().map(function(trigger) {
    return trigger.getHandlerFunction();
  });

  Logger.log(
    '=== SCRIPT PROPERTIES LIEN QUAN DONG BO ===\n' + JSON.stringify(report, null, 2) +
    '\n=== TRIGGER DANG CO ===\n' + JSON.stringify(triggerNames, null, 2)
  );
  return { properties: report, triggers: triggerNames };
}

/**
 * Xoa co CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE cu (danh dau "da xong hom
 * nay" tu lan chay code CU truoc khi gioi han 90 ngay), de syncCustomerReportIfDue_
 * (goi qua processWebhookQueue moi phut) nhan dung job "Khach theo hang hoa"
 * dang do dang (CUSTOMER_REPORT_JOB_STATE_byProduct con checkpoint) va tu
 * dong tiep tuc thay vi bi bo qua vi tuong da xong hom nay roi.
 */
function clearStaleByProductReportSyncFlag() {
  PropertiesService.getScriptProperties().deleteProperty('CUSTOMER_BY_PRODUCT_REPORT_LAST_SYNC_DATE');
  Logger.log('Da xoa co dong bo cu. Job "Khach theo hang hoa" se duoc processWebhookQueue tu tiep tuc trong vong 1 phut toi.');
}

// ==========================================
// TACH DU LIEU CU SANG SPREADSHEET LUU TRU
// ==========================================
// Sheet chinh da cham gioi han 10 trieu o cua Google Sheets (xem
// SPREADSHEET_GRID_CELL_LIMIT_ trong utils/Helpers.gs), khien dong bo Hoa
// don/Chi tiet hoa don/Nhap hang khong the ghi them du lieu moi. Ham nay
// chuyen du lieu cu hon ARCHIVE_CUTOFF_DATE_ sang mot Spreadsheet luu tru
// rieng (tao tu dong lan dau, ID luu trong Script Properties de tai su
// dung o cac lan chay sau) de giai phong o tren Sheet chinh; du lieu cu
// van xem duoc binh thuong o file luu tru do, chi khong con nam chung voi
// du lieu dang van hanh.
//
// CACH DUNG (BAT BUOC theo dung thu tu):
//   1. Chay previewArchiveOldKiotVietData() truoc — CHI DOC, khong ghi/xoa
//      gi ca. Mo Nhat ky thuc thi (Executions) de kiem tra so dong se
//      chuyen va mau ngay da doc duoc (mauNgayDaDoc) co dung khong.
//   2. Chi sau khi xac nhan ket qua xem truoc dung, moi chay
//      archiveOldKiotVietData() de thuc thi that.
const ARCHIVE_CUTOFF_DATE_ = new Date(2026, 1, 1); // 01/02/2026, gio dia phuong
const ARCHIVE_SPREADSHEET_ID_PROPERTY_ = 'KIOTVIET_ARCHIVE_SPREADSHEET_ID';

/**
 * Doc chuoi ngay da ghi boi formatDate() (utils/Helpers.gs) va tra ve Date.
 * Chi rut cac chu so (ngay/thang/nam roi gio/phut neu co), bo qua ky tu phan
 * cach o giua — tranh phu thuoc vao dinh dang chinh xac cua chuoi da luu.
 */
function parseKiotVietSheetDate_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const text = String(value || '').trim();
  if (!text) return null;
  const digitsOnly = text.replace(/\D/g, '');
  if (digitsOnly.length < 8) return null;
  const day = Number(digitsOnly.slice(0, 2));
  const month = Number(digitsOnly.slice(2, 4));
  const year = Number(digitsOnly.slice(4, 8));
  const rest = digitsOnly.slice(8);
  const hour = rest.length >= 2 ? Number(rest.slice(0, 2)) : 0;
  const minute = rest.length >= 4 ? Number(rest.slice(2, 4)) : 0;
  if (!day || month < 1 || month > 12 || !year) return null;
  const parsed = new Date(year, month - 1, day, hour, minute);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function findHeaderIndex_(header, name) {
  return header.indexOf(name);
}

/**
 * Chia cac dong cua mot sheet (theo cot ngay chi dinh) thanh "cu" (truoc
 * ARCHIVE_CUTOFF_DATE_) va "giu lai". Khong ghi gi ca — chi doc va tinh toan.
 */
function partitionSheetRowsByDate_(sheet, dateHeaderName) {
  if (sheet.getLastRow() === 0) return { header: [], oldRows: [], keepRows: [], dateIdx: -1 };
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const dateIdx = findHeaderIndex_(header, dateHeaderName);
  if (dateIdx === -1) {
    throw new Error('[' + sheet.getName() + '] Khong tim thay cot "' + dateHeaderName + '".');
  }
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { header: header, oldRows: [], keepRows: [], dateIdx: dateIdx };

  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  const oldRows = [];
  const keepRows = [];
  values.forEach(function(row) {
    const parsedDate = parseKiotVietSheetDate_(row[dateIdx]);
    if (parsedDate && parsedDate < ARCHIVE_CUTOFF_DATE_) {
      oldRows.push(row);
    } else {
      keepRows.push(row);
    }
  });
  return { header: header, oldRows: oldRows, keepRows: keepRows, dateIdx: dateIdx };
}

/**
 * Chia cac dong Chi tiet hoa don theo tap "Ma hoa don" da duoc xac dinh la cu
 * (tinh truoc do tu partitionSheetRowsByDate_ tren sheet Hoa don).
 */
function partitionSheetRowsByCodes_(sheet, codeHeaderName, oldCodesSet) {
  if (sheet.getLastRow() === 0) return { header: [], oldRows: [], keepRows: [] };
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const codeIdx = findHeaderIndex_(header, codeHeaderName);
  if (codeIdx === -1) {
    throw new Error('[' + sheet.getName() + '] Khong tim thay cot "' + codeHeaderName + '".');
  }
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return { header: header, oldRows: [], keepRows: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  const oldRows = [];
  const keepRows = [];
  values.forEach(function(row) {
    if (oldCodesSet[String(row[codeIdx])]) {
      oldRows.push(row);
    } else {
      keepRows.push(row);
    }
  });
  return { header: header, oldRows: oldRows, keepRows: keepRows };
}

function buildOldInvoiceCodeSet_(oldInvoiceRows, header) {
  const codeIdx = findHeaderIndex_(header, 'Mã hóa đơn');
  const set = {};
  oldInvoiceRows.forEach(function(row) { set[String(row[codeIdx])] = true; });
  return set;
}

/**
 * CHI DOC — khong ghi/xoa gi ca. Chay ham nay truoc, kiem tra Nhat ky thuc
 * thi, roi moi chay archiveOldKiotVietData() that su.
 */
function previewArchiveOldKiotVietData() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const report = {};

  const invoiceSheet = spreadsheet.getSheetByName(CONFIG.SHEET_INVOICES);
  let oldCodes = {};
  if (invoiceSheet) {
    const partition = partitionSheetRowsByDate_(invoiceSheet, 'Ngày bán');
    oldCodes = buildOldInvoiceCodeSet_(partition.oldRows, partition.header);
    report['Hóa đơn'] = {
      tongSoDong: partition.oldRows.length + partition.keepRows.length,
      soDongSeChuyen: partition.oldRows.length,
      mauNgayDaDoc: partition.oldRows.slice(0, 5).map(function(row) { return row[partition.dateIdx]; })
    };
  }

  const detailSheet = spreadsheet.getSheetByName(CONFIG.SHEET_INVOICE_DETAILS);
  if (detailSheet) {
    const partition = partitionSheetRowsByCodes_(detailSheet, 'Mã hóa đơn', oldCodes);
    report['Chi tiết hóa đơn'] = {
      tongSoDong: partition.oldRows.length + partition.keepRows.length,
      soDongSeChuyen: partition.oldRows.length
    };
  }

  const purchaseSheet = spreadsheet.getSheetByName(CONFIG.SHEET_PURCHASES);
  if (purchaseSheet) {
    const partition = partitionSheetRowsByDate_(purchaseSheet, 'Thời gian');
    report['Nhập hàng'] = {
      tongSoDong: partition.oldRows.length + partition.keepRows.length,
      soDongSeChuyen: partition.oldRows.length,
      mauNgayDaDoc: partition.oldRows.slice(0, 5).map(function(row) { return row[partition.dateIdx]; })
    };
  }

  Logger.log(
    '=== XEM TRUOC TACH DU LIEU CU (moc: truoc ' + ARCHIVE_CUTOFF_DATE_.toDateString() +
    ', CHUA THAY DOI GI) ===\n' + JSON.stringify(report, null, 2)
  );
  return report;
}

function getOrCreateArchiveSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(ARCHIVE_SPREADSHEET_ID_PROPERTY_);
  if (existingId) {
    try {
      return SpreadsheetApp.openById(existingId);
    } catch (e) {
      Logger.log('Khong mo duoc Spreadsheet luu tru cu (' + existingId + '), se tao file moi: ' + e);
    }
  }
  const activeName = SpreadsheetApp.getActiveSpreadsheet().getName();
  const archive = SpreadsheetApp.create(activeName + ' - Luu tru');
  props.setProperty(ARCHIVE_SPREADSHEET_ID_PROPERTY_, archive.getId());
  Logger.log('Da tao Spreadsheet luu tru moi: ' + archive.getUrl());
  return archive;
}

function getOrCreateArchiveSheet_(archiveSpreadsheet, sheetName, header) {
  let sheet = archiveSpreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = archiveSpreadsheet.insertSheet(sheetName);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    const defaultSheet = archiveSpreadsheet.getSheetByName('Sheet1');
    if (defaultSheet && defaultSheet.getSheetId() !== sheet.getSheetId() && defaultSheet.getLastRow() === 0) {
      archiveSpreadsheet.deleteSheet(defaultSheet);
    }
  }
  return sheet;
}

function appendRowsToArchive_(archiveSheet, header, rows) {
  if (rows.length === 0) return;
  const startRow = archiveSheet.getLastRow() + 1;
  const chunkSize = 2000;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    archiveSheet.getRange(startRow + offset, 1, chunk.length, header.length).setValues(chunk);
  }
}

function rewriteLiveSheetKeepingRows_(liveSheet, header, keepRows) {
  liveSheet.clearContents();
  liveSheet.getRange(1, 1, 1, header.length).setValues([header]);
  const chunkSize = 2000;
  for (let offset = 0; offset < keepRows.length; offset += chunkSize) {
    const chunk = keepRows.slice(offset, offset + chunkSize);
    liveSheet.getRange(2 + offset, 1, chunk.length, header.length).setValues(chunk);
  }
}

/**
 * THUC THI THAT: chuyen du lieu cu hon ARCHIVE_CUTOFF_DATE_ tu Hoa don, Chi
 * tiet hoa don va Nhap hang sang Spreadsheet luu tru, roi ghi de Sheet chinh
 * chi con du lieu tu moc do tro di. LUON chay previewArchiveOldKiotVietData()
 * truoc de kiem tra ket qua se ra sao.
 *
 * Ghi vao file luu tru xong moi ghi de Sheet chinh (khong xoa truoc-doc sau),
 * nen neu lan chay bi gian doan giua chung, du lieu tren Sheet chinh van con
 * nguyen ven; chi can chay lai (co the tao vai dong trung o file luu tru,
 * kiem tra lai bang "Mã hóa đơn"/"Mã nhập hàng" neu can).
 */
function archiveOldKiotVietData() {
  const dataLock = getKiotVietDataLock_();
  dataLock.waitLock(30000);
  const invoiceLock = getKiotVietInvoiceLock_();
  invoiceLock.waitLock(30000);
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const archive = getOrCreateArchiveSpreadsheet_();
    const summary = {};

    const invoiceSheet = spreadsheet.getSheetByName(CONFIG.SHEET_INVOICES);
    let oldCodes = {};
    if (invoiceSheet) {
      const partition = partitionSheetRowsByDate_(invoiceSheet, 'Ngày bán');
      oldCodes = buildOldInvoiceCodeSet_(partition.oldRows, partition.header);
      if (partition.oldRows.length > 0) {
        const archiveSheet = getOrCreateArchiveSheet_(archive, CONFIG.SHEET_INVOICES, partition.header);
        appendRowsToArchive_(archiveSheet, partition.header, partition.oldRows);
        rewriteLiveSheetKeepingRows_(invoiceSheet, partition.header, partition.keepRows);
      }
      summary['Hóa đơn'] = partition.oldRows.length;
      Logger.log('[Hóa đơn] Da chuyen ' + partition.oldRows.length + ' dong, giu lai ' + partition.keepRows.length + ' dong.');
    }

    const detailSheet = spreadsheet.getSheetByName(CONFIG.SHEET_INVOICE_DETAILS);
    if (detailSheet && Object.keys(oldCodes).length > 0) {
      const partition = partitionSheetRowsByCodes_(detailSheet, 'Mã hóa đơn', oldCodes);
      if (partition.oldRows.length > 0) {
        const archiveSheet = getOrCreateArchiveSheet_(archive, CONFIG.SHEET_INVOICE_DETAILS, partition.header);
        appendRowsToArchive_(archiveSheet, partition.header, partition.oldRows);
        rewriteLiveSheetKeepingRows_(detailSheet, partition.header, partition.keepRows);
      }
      summary['Chi tiết hóa đơn'] = partition.oldRows.length;
      Logger.log('[Chi tiết hóa đơn] Da chuyen ' + partition.oldRows.length + ' dong, giu lai ' + partition.keepRows.length + ' dong.');
    }

    const purchaseSheet = spreadsheet.getSheetByName(CONFIG.SHEET_PURCHASES);
    if (purchaseSheet) {
      const partition = partitionSheetRowsByDate_(purchaseSheet, 'Thời gian');
      if (partition.oldRows.length > 0) {
        const archiveSheet = getOrCreateArchiveSheet_(archive, CONFIG.SHEET_PURCHASES, partition.header);
        appendRowsToArchive_(archiveSheet, partition.header, partition.oldRows);
        rewriteLiveSheetKeepingRows_(purchaseSheet, partition.header, partition.keepRows);
      }
      summary['Nhập hàng'] = partition.oldRows.length;
      Logger.log('[Nhập hàng] Da chuyen ' + partition.oldRows.length + ' dong, giu lai ' + partition.keepRows.length + ' dong.');
    }

    summary.archiveSpreadsheetUrl = archive.getUrl();
    Logger.log('=== HOAN TAT TACH DU LIEU CU ===\n' + JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    invoiceLock.releaseLock();
    dataLock.releaseLock();
  }
}

/**
 * CHI DOC — liet ke moi sheet (ke ca sheet an) cung so o dang dung (grid: maxRows
 * x maxColumns) va so o thuc su co du lieu (used: lastRow x lastColumn), sap
 * xep theo so o luoi giam dan. Dung de tim chinh xac sheet nao dang chiem
 * nhieu nhat trong gioi han 10 trieu o cua ca bang tinh.
 */
function previewSheetCellUsage() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets();
  let totalGridCells = 0;
  let totalUsedCells = 0;

  const rows = sheets.map(function(sheet) {
    const maxRows = sheet.getMaxRows();
    const maxColumns = sheet.getMaxColumns();
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const gridCells = maxRows * maxColumns;
    const usedCells = lastRow * lastColumn;
    totalGridCells += gridCells;
    totalUsedCells += usedCells;
    return {
      ten: sheet.getName(),
      an: sheet.isSheetHidden(),
      gridCells: gridCells,
      grid: maxRows + 'x' + maxColumns,
      usedCells: usedCells,
      used: lastRow + 'x' + lastColumn
    };
  }).sort(function(a, b) { return b.gridCells - a.gridCells; });

  const report = {
    gioiHan: 10000000,
    tongOLuoiHienTai: totalGridCells,
    tongODuLieuThucTe: totalUsedCells,
    conTrong: 10000000 - totalGridCells,
    cacSheet: rows
  };

  Logger.log('=== TOAN BO SHEET THEO SO O LUOI (giam dan) ===\n' + JSON.stringify(report, null, 2));
  return report;
}
