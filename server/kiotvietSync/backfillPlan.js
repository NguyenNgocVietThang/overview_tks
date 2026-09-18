'use strict';

// Ham thuan, khong I/O: tinh danh sach chunk backfill can chay cho 1 entity
// module (Giai doan 2), theo dung 3 chien luoc da chot o phase3-plan muc
// "Nguyen tac thiet ke". Nhan `now`/`fromDate` qua tham so (khong tu goi
// Date.now()) de test khong phu thuoc dong ho that, dung pattern da dung o
// kiotVietApiClient.js/syncDriver.js.

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function startOfMonthUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function buildBackfillPlan(entityModule, { fromDate, now }) {
  // entityModule.listQuery mang cac tham so KHONG doi theo chunk (vd
  // includeInventory/includeQuantity cua products) - phai gop vao MOI chunk,
  // giong het cach syncDriver.js lam cho polling. Truoc day ham nay tra query
  // rong/chi co tham so ngay, lam mat toan bo listQuery khi backfill (bug:
  // KiotViet tra ve object thieu inventories/productShelves/pricebook... du
  // entity module co khai bao yeu cau - da xac minh bang API that 2026-09-16).
  const baseQuery = entityModule.listQuery || {};

  if (entityModule.backfillRangeParam) {
    const { from, to } = entityModule.backfillRangeParam;
    const chunks = [];
    let cursor = startOfMonthUtc(fromDate);
    while (cursor <= now) {
      const nextMonthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const chunkEnd = nextMonthStart < now ? nextMonthStart : now;
      chunks.push({
        chunkKey: monthKey(cursor),
        query: { ...baseQuery, [from]: cursor.toISOString(), [to]: chunkEnd.toISOString() }
      });
      cursor = nextMonthStart;
    }
    return chunks;
  }

  if (entityModule.hasUpperBound === false) {
    return [{ chunkKey: 'full', query: { ...baseQuery, [entityModule.incrementalParam]: fromDate.toISOString() } }];
  }

  // Du lieu nen (categories, products, customers, suppliers): 1 lan chay day
  // du, khong loc theo ngay - day la "hien trang", khong phai log giao dich.
  return [{ chunkKey: 'full', query: { ...baseQuery } }];
}

module.exports = { buildBackfillPlan };
