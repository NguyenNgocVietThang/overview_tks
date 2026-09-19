'use strict';

const { toVnDateKey } = require('./timelineBuilder');

// Doc toan bo hang hoa cua co so tu Postgres (bang products do
// kiotvietSync dong bo, xem stockoutPgSource.js) thay vi goi KiotViet API — ton
// kho hien tai la tong `onHand` qua cac chi nhanh trong `inventories`. Do tre
// so voi KiotViet chinh la do tre dong bo (webhook + polling), duoc canh bao o
// stockoutEventLoader.js khi lan dong bo cuoi da cu.
async function loadActiveCandidates(source) {
  const candidates = [];
  let totalProductsScanned = 0;

  for (const product of await source.listProducts()) {
    const code = String(product.code || '').trim();
    if (!code) continue;
    totalProductsScanned++;
    if (product.isActive === false) continue;
    candidates.push({
      code,
      name: product.name || undefined,
      currentOnHand: Number(product.onHand) || 0,
      createdDateKey: product.createdDate ? toVnDateKey(product.createdDate) : null
    });
  }

  return { candidates, totalProductsScanned };
}

module.exports = { loadActiveCandidates };
