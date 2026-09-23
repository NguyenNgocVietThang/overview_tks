'use strict';
const { value, array } = require('./entityUtils');

// KiotViet co san endpoint /productOnHands chuyen ve ton kho: nhe hon /products
// (khong keo ten/gia/category) va modifiedDate cap nhat DOC LAP, dung luc
// bien dong ton kho thuc su (chuyen kho, tra NCC...) - xac nhan qua live
// probe 2026-09-23, xem server/kiotviet/API_ENDPOINTS.md. Truoc do /products
// la nguon duy nhat cho raw->'inventories' nhung modifiedDate cua no chi doi
// khi doi thong tin "san pham" (ten/gia...), nen ton kho co the ket cu vo
// thoi han cho ma hang chi bien dong ton kho.
//
// Poll rieng bang checkpoint entity 'product_on_hands' (khac 'products') de
// khong dung cham checkpoint /products hien co. CHI UPDATE raw->'inventories'
// cua dong products tuong ung (branch, id) - KHONG insert dong moi, vi
// response /productOnHands thieu name/code/gia... (INSERT se vi pham
// NOT NULL / thieu du lieu). Neu id chua co trong products (chua tung sync
// qua /products), UPDATE khong khop dong nao - bo qua, lan sync /products
// gan nhat se tao dong, lan poll productOnHands ke tiep se cap nhat lai.
module.exports = {
  entity: 'product_on_hands',
  endpoint: 'productOnHands',
  listQuery: {},
  incrementalParam: 'lastModifiedFrom',
  hasUpperBound: true,
  async upsertPage(pgClient, branch, items) {
    for (const item of items) {
      const id = value(item, 'Id', 'id', 'ProductId', 'productId');
      const inventories = array(item, 'Inventories', 'inventories');
      await pgClient.query(
        `UPDATE products SET raw = jsonb_set(raw, '{inventories}', $3::jsonb), synced_at = now()
         WHERE branch = $1 AND id = $2`,
        [branch, id, JSON.stringify(inventories)]
      );
    }
  }
};
