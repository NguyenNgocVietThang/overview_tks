'use strict';

const ExcelJS = require('exceljs');

const CODE_COLUMN_ALIASES = [
  'ma hang', 'ma hang hoa', 'ma sp', 'ma san pham', 'sku', 'product code', 'code'
];

function normalizeHeaderKey(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function findCodeColumnIndex(headerRowCells) {
  const normalized = headerRowCells.map(normalizeHeaderKey);
  return normalized.findIndex((cell) => CODE_COLUMN_ALIASES.includes(cell));
}

function extractCodesFromRows(dataRows, colIndex) {
  const seen = new Set();
  const codes = [];
  for (const row of dataRows) {
    const raw = row[colIndex];
    if (raw === null || raw === undefined) continue;
    const code = String(raw).trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  return codes;
}

async function parseProductCodesFromWorkbookBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows = [];
  worksheet.eachRow((row) => {
    const values = row.values.slice(1).map((cell) => (cell && cell.text !== undefined ? cell.text : cell));
    rows.push(values);
  });
  if (rows.length === 0) return [];

  const headerRow = rows[0];
  const codeColumnIndex = findCodeColumnIndex(headerRow);

  if (codeColumnIndex === -1) {
    return extractCodesFromRows(rows, 0);
  }
  return extractCodesFromRows(rows.slice(1), codeColumnIndex);
}

module.exports = {
  normalizeHeaderKey,
  findCodeColumnIndex,
  extractCodesFromRows,
  parseProductCodesFromWorkbookBuffer
};
