'use strict';

const { toVnDateKey } = require('./timelineBuilder');

// KiotViet /products tra ve field da xac nhan qua san xuat (xem
// kiotVietApiClient.js::fetchProductOnHand va src-dashboard Helpers.gs) —
// giu vai key du phong vi tung endpoint/hydrate path co the khac casing.
const CODE_KEYS = ['productCode', 'code'];
const NAME_KEYS = ['fullName', 'name'];
const CREATED_DATE_KEYS = ['createdDate'];

const PRODUCTS_QUERY = { includeInventory: 'true' };

function pickField(item, keys) {
  for (const key of keys) {
    const value = item[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function sumOnHand(inventories) {
  if (!Array.isArray(inventories)) return 0;
  return inventories.reduce((sum, inv) => sum + (Number(inv.onHand ?? inv.onhand) || 0), 0);
}

// Quet toan bo hang hoa tu KiotViet API (khong con doc Sheet "Hang hoa" —
// sheet do phu thuoc webhook stock.update/product.update, co the dung yen
// hang gio/ngay neu webhook loi hoac het quota UrlFetch ma khong co co che
// tu sua). API goi truc tiep luon phan anh dung ton kho tai thoi diem quet.
async function loadActiveCandidates(client) {
  const candidates = [];
  let totalProductsScanned = 0;

  await client.fetchAllPages('products', PRODUCTS_QUERY, async (items) => {
    for (const item of items) {
      const code = String(pickField(item, CODE_KEYS) || '').trim();
      if (!code) continue;
      totalProductsScanned++;
      if (pickField(item, ['isActive']) === false) continue;
      const createdDateRaw = pickField(item, CREATED_DATE_KEYS);
      candidates.push({
        code,
        name: pickField(item, NAME_KEYS),
        currentOnHand: sumOnHand(item.inventories),
        createdDateKey: createdDateRaw ? toVnDateKey(createdDateRaw) : null
      });
    }
  });

  return { candidates, totalProductsScanned };
}

module.exports = { loadActiveCandidates };
