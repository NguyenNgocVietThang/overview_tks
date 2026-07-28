// ==========================================
// TIEN ICH DUNG CHUNG (Helper functions)
// ==========================================

/**
 * Chuyen doi chuoi hoac doi tuong Date sang dinh dang "dd/MM/yyyy HH:mm".
 * Tra ve "---" neu gia tri khong hop le.
 */
function formatDate(dateValue) {
  if (!dateValue) return '---';
  const d = new Date(dateValue);
  if (isNaN(d.getTime())) return '---';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Ham lay ban do Dong tuong ung voi Ma (code) de tim kiem nhanh.
 * @param {Array[][]} data - Mang 2 chieu lay tu sheetsClient.getValues()
 * @param {number} codeIndex - Chi so cot chua ma code (0-based)
 * @returns {Object} Map { code: rowNumber } voi rowNumber la 1-based
 */
function getCodeRowMap(data, codeIndex) {
  const map = {};
  for (let r = 1; r < data.length; r++) {
    const code = String((data[r] || [])[codeIndex] || '').trim();
    if (code) map[code] = r + 1;
  }
  return map;
}

module.exports = { formatDate, getCodeRowMap };
