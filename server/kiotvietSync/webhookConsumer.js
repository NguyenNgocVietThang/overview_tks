'use strict';

// Ap dung payload webhook KiotViet vao bang nghiep vu that trong Postgres.
// Truoc day (2026-09) endpoint webhook chi luu payload tho vao
// webhook_events_raw ma KHONG co gi doc lai bang do de cap nhat orders/
// invoices/products/customers/categories - phat hien khi kiem tra lai
// pipeline truoc khi bat dong bo that. Module nay la phan con thieu.
//
// Cau truc thong bao va logic hydrate-neu-thieu du lieu PORT LAI tu
// src-dashboard/sync/UpdateHandlers.gs + WebhookQueue.gs (da chay that,
// on dinh nhieu thang cho ban Google Sheets) - khong thiet ke lai tu dau.

function normalizeNotifications(payload, eventType) {
  const normalizedType = String(eventType || '').toLowerCase();
  if (!payload || typeof payload !== 'object') return [];

  const sourceNotifications = Array.isArray(payload.Notifications)
    ? payload.Notifications
    : (Array.isArray(payload.notifications) ? payload.notifications : null);
  if (sourceNotifications) {
    return sourceNotifications.map((notification) => {
      const copy = { ...(notification || {}) };
      if (!copy.Action && !copy.action && normalizedType) copy.Action = normalizedType;
      return copy;
    });
  }
  if (payload.Action || payload.action) return [payload];

  const removedIds = payload.RemoveId || payload.removeId || payload.RemovedId || payload.removedId;
  if (normalizedType.indexOf('.delete') !== -1 && Array.isArray(removedIds)) {
    return [{
      Action: normalizedType,
      Data: removedIds.map((id) => (id && typeof id === 'object' ? id : { Id: id, id }))
    }];
  }
  if (normalizedType && (payload.Data !== undefined || payload.data !== undefined)) {
    return [{ Action: normalizedType, Data: payload.Data !== undefined ? payload.Data : payload.data }];
  }
  return [];
}

// Loai su kien KiotViet thuc su ho tro qua Webhook (xem
// src-dashboard/kiotviet/WebhookAdmin.gs: KIOTVIET_AUTO_SYNC_EVENT_TYPES).
// returns/purchases/cash_flows/suppliers KHONG co webhook - dua hoan toan
// vao polling (dung thiet ke, khong phai thieu sot).
const ENTITY_ROUTES = Object.freeze({
  product: { entity: 'products', hasDelete: true },
  stock: { entity: 'products', hasDelete: false },
  customer: { entity: 'customers', hasDelete: true },
  category: { entity: 'categories', hasDelete: true },
  invoice: { entity: 'invoices', hasDelete: false },
  order: { entity: 'orders', hasDelete: false }
});

function resolveRoute(action) {
  const normalized = String(action || '').toLowerCase();
  const key = normalized.split('.')[0];
  const route = ENTITY_ROUTES[key];
  if (!route) return null;
  return { entity: route.entity, isDelete: route.hasDelete && normalized.indexOf('.delete') !== -1 };
}

function extractId(item) {
  if (!item || typeof item !== 'object') return null;
  const id = item.Id ?? item.id;
  return id === undefined ? null : id;
}

// KiotViet webhook thuong chi gui cac truong VUA THAY DOI, khong kem day du
// OrderDetails/InvoiceDetails/CategoryId... - upsert thang se lam NULL cac
// cot con lai (ON CONFLICT DO UPDATE SET column=EXCLUDED.column, khong co
// COALESCE). Luon lay lai ban ghi day du truoc khi ghi, dung chung
// entityModule.listQuery de query dung param (includePayment, includeInventory...)
// nhu backfill/polling da dung.
async function hydrateItems(kiotVietClient, entityModule, items, { log = console.log } = {}) {
  const hydrated = [];
  for (const item of items) {
    const id = extractId(item);
    if (id === null) { hydrated.push(item); continue; }
    const full = await kiotVietClient.fetchById(entityModule.endpoint, id, entityModule.listQuery || {});
    // Payload webhook uu tien neu trung truong, vi day la thay doi moi nhat
    // (cung logic da chung minh o UpdateHandlers.gs).
    hydrated.push({ ...(full || {}), ...(item || {}) });
  }
  return hydrated;
}

async function deleteItems(pgClient, branch, entity, items, { log = console.log } = {}) {
  for (const item of items) {
    const id = extractId(item);
    if (id === null) continue;
    await pgClient.query(`DELETE FROM ${entity} WHERE branch=$1 AND id=$2`, [branch, id]);
    log(`[webhookConsumer] Da xoa ${entity} branch=${branch} id=${id} (theo su kien delete).`);
  }
}

function loadDefaultEntityModules() {
  return {
    products: require('./entities/products'),
    customers: require('./entities/customers'),
    categories: require('./entities/categories'),
    invoices: require('./entities/invoices'),
    orders: require('./entities/orders')
  };
}

async function processWebhookEvent({
  branch, eventType, payload, pool, kiotVietClient,
  entityModules = loadDefaultEntityModules(), log = console.log
}) {
  const notifications = normalizeNotifications(payload, eventType);
  if (!notifications.length) {
    log(`[webhookConsumer] Khong nhan dien duoc notification hop le (branch=${branch}, eventType=${eventType}).`);
    return { processed: 0 };
  }

  let processed = 0;
  for (const notification of notifications) {
    const action = String(notification.Action || notification.action || eventType || '').toLowerCase();
    const route = resolveRoute(action);
    if (!route) {
      log(`[webhookConsumer] Bo qua loai su kien chua ho tro: ${action}`);
      continue;
    }

    const rawData = notification.Data !== undefined ? notification.Data : notification.data;
    const items = Array.isArray(rawData) ? rawData : (rawData === undefined || rawData === null ? [] : [rawData]);
    if (!items.length) continue;

    const entityModule = entityModules[route.entity];
    const itemsToWrite = route.isDelete ? items : await hydrateItems(kiotVietClient, entityModule, items, { log });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (route.isDelete) await deleteItems(client, branch, route.entity, itemsToWrite, { log });
      else await entityModule.upsertPage(client, branch, itemsToWrite);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    processed += itemsToWrite.length;
  }
  return { processed };
}

module.exports = {
  normalizeNotifications, resolveRoute, extractId, hydrateItems, deleteItems,
  processWebhookEvent, ENTITY_ROUTES, loadDefaultEntityModules
};
