// ==========================================
// TIEN ICH DUNG CHUNG (Helper functions)
// ==========================================

/**
 * Ham lay ban do Dong tuong ung voi Ma (code) de tim kiem nhanh.
 * Tranh viec scan toan bo sheet moi lan cap nhat.
 *
 * @param {Array[][]} data - Mang 2 chieu lay tu sheet.getDataRange().getValues()
 * @param {number} codeIndex - Chi so cot chua ma code (0-based)
 * @returns {Object} Map { code: rowNumber } voi rowNumber la 1-based
 */
function getCodeRowMap(data, codeIndex) {
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const code = String(data[r][codeIndex]).trim();
    if (code) map[code] = r + 1;
  }
  return map;
}

/**
 * Dinh dang nhanh cac cot so cua dong moi them vao sheet.
 * Goi ngay sau appendRow() de format tuc thi.
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Sheet dang lam viec
 * @param {number[]} colIndexes - Mang chi so cot can format (1-based)
 */
function formatLastRowNumbers(sheet, colIndexes) {
  const lastRow = sheet.getLastRow();
  colIndexes.forEach(col => {
    sheet.getRange(lastRow, col).setNumberFormat("#,##0");
  });
}

/**
 * Chuyen doi chuoi hoac doi tuong Date sang dinh dang "dd/MM/yyyy HH:mm".
 * Tra ve "---" neu gia tri khong hop le.
 *
 * @param {string|Date} dateString - Gia tri ngay can dinh dang
 * @returns {string} Chuoi ngay da dinh dang hoac "---"
 */
function formatDate(dateString) {
  if (!dateString) return "---";
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "---";
    return Utilities.formatDate(d, Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
  } catch (e) { return "---"; }
}
