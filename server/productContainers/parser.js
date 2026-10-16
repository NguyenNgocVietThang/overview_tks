'use strict';

const SHEET_NAMES = Object.freeze(['YIWU', 'VK-DUNG', 'HÀ BẮC', 'SD', 'GDONG', 'KHÁC']);
const INTERVAL_MS = 2 * 60 * 60 * 1000;
const text = value => String(value ?? '').trim();
const normalizeCode = value => text(value).toLowerCase();

// Google UNFORMATTED_VALUE supplies numbers for numeric/formula cells. Accept
// plain numeric text as well, never guess locale-dependent separators.
function numeric(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\s*\d+(?:\.\d+)?\s*$/.test(value))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseContainerSheet(sheetName, values, formattedValues = values) {
  const rows = [];
  const warnings = [];
  let current = null;
  let blankCount = 0;
  for (let index = 0; index < values.length; index++) {
    const row = values[index] || [];
    const display = formattedValues[index] || [];
    const code = text(display[0]) || text(row[0]);
    if (/^END$/i.test(code)) break;
    if (/^CONT\b/i.test(code)) {
      const statusText = text(row[1]);
      const match = /^([1-5])(?=\s|\.|$)/.exec(statusText);
      current = match ? { containerName: code, status: Number(match[1]), statusLabel: text(display[1]) || statusText, eta: text(display[2]), containerRow: index + 1 } : null;
      if (!current) warnings.push({ sheetName, row: index + 1, reason: 'Trạng thái CONT không hợp lệ' });
      blankCount = 0;
      continue;
    }
    if (!Array.from({ length: 24 }, (_, col) => text(display[col])).some(Boolean)) {
      if (++blankCount >= 20) current = null;
      continue;
    }
    blankCount = 0;
    if (!current || !code || /^m[aã]\s*(?:sp|sản phẩm|hàng)$/i.test(code)) continue;
    const quantity = numeric(row[14]);
    if (quantity === null) {
      warnings.push({ sheetName, row: index + 1, reason: 'Tổng số lượng O không hợp lệ' });
      continue;
    }
    rows.push({
      ...current, sheetName, sourceRow: index + 1,
      productCode: code, productKey: normalizeCode(code),
      color: text(display[4]), saleNote: text(display[5]),
      orderedBy: text(display[7]), listedAt: text(display[11]),
      unitsPerPackage: numeric(row[12]), packageCount: numeric(row[13]),
      quantity, vietnamPrice: numeric(row[23])
    });
  }
  return { rows, warnings };
}

module.exports = { SHEET_NAMES, INTERVAL_MS, normalizeCode, numeric, parseContainerSheet };
