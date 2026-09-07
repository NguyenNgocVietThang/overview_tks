'use strict';

const sheetsClient = require('../../sheets/sheetsClient');
const CONFIG = require('../../config');

async function loadProductCatalogMap(branch) {
  const rows = await sheetsClient.getSheetsClient(branch).getValues(CONFIG.SHEET_PRODUCTS);
  const map = new Map();
  if (!rows.length) return map;

  const headers = rows[0];
  const codeIndex = headers.indexOf('Mã hàng');
  const nameIndex = headers.indexOf('Tên hàng');
  const stockIndex = headers.indexOf('Tồn kho');
  if (codeIndex === -1) return map;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const code = String(row[codeIndex] || '').trim();
    if (!code) continue;
    const name = nameIndex !== -1 ? String(row[nameIndex] || '').trim() : '';
    const currentOnHand = stockIndex !== -1 ? (Number(row[stockIndex]) || 0) : 0;
    map.set(code.toUpperCase(), { code, name, currentOnHand });
  }

  return map;
}

function validateCodes(rawCodes, catalogMap) {
  const validCodes = [];
  const invalidCodes = [];

  for (const rawCode of rawCodes) {
    const key = String(rawCode).trim().toUpperCase();
    const match = catalogMap.get(key);
    if (match) validCodes.push(match);
    else invalidCodes.push(rawCode);
  }

  return { validCodes, invalidCodes };
}

module.exports = { loadProductCatalogMap, validateCodes };
