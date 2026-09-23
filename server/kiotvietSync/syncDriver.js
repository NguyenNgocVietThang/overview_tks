'use strict';

const { getPool } = require('../db/pool');
const checkpointRepository = require('./checkpointRepository');

function createSyncDriver({ pool = getPool(), checkpointRepository: checkpoints = checkpointRepository, now = Date.now, logger = console } = {}) {
  async function inTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await work(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function pollCashFlows(kiotVietClient, branch, entityModule, checkpoint, runEndIso) {
    const noteDate = checkpoint?.note && Date.parse(checkpoint.note);
    const startDate = Number.isFinite(noteDate)
      ? new Date(noteDate).toISOString()
      : checkpoint?.last_synced_at
        ? new Date(checkpoint.last_synced_at).toISOString()
        : new Date(Date.parse(runEndIso) - 60 * 60 * 1000).toISOString();
    const items = [];
    for (const isReceipt of ['true', 'false']) {
      await kiotVietClient.fetchAllPages(entityModule.endpoint, {
        ...entityModule.listQuery, startDate, endDate: runEndIso, isReceipt
      }, async (pageItems) => {
        // API khong tra field phan biet thu/chi trong item - phai gan tu
        // query da dung de lay item nay, khong doc tu item.
        items.push(...pageItems.map((item) => ({ ...item, IsReceipt: isReceipt === 'true' })));
      });
    }
    await inTransaction(async (client) => {
      await entityModule.upsertPage(client, branch, items);
      await checkpoints.advanceCheckpoint(branch, entityModule.entity, runEndIso, { client, note: runEndIso });
    });
  }

  async function pollEntityOnce(kiotVietClient, branch, entityModule) {
    const checkpoint = await checkpoints.getCheckpoint(branch, entityModule.entity);
    const runEndIso = new Date(now()).toISOString();
    if (entityModule.entity === 'cash_flows') {
      return pollCashFlows(kiotVietClient, branch, entityModule, checkpoint, runEndIso);
    }
    const neverSynced = !checkpoint?.last_synced_at;
    // Entity CHUA TUNG dong bo thanh cong (checkpoint rong) va khong can
    // chunk theo thang (khong co backfillRangeParam - dang "snapshot" nhu
    // categories/products/customers/suppliers/product_on_hands, giong tieu
    // chi backfillPlan.js dung de goi 1 chunk 'full' khong loc ngay): quet
    // TOAN BO du lieu hien tai ngay trong lan poll dau tien, thay vi fallback
    // "1 gio gan nhat" (fallback nay chi hop ly cho truong hop da co checkpoint
    // cu, dung de bu khoang trong ngan do server restart/redeploy - ap dung
    // no cho entity moi hoan toan se bo sot toan bo du lieu cu, dung nguyen
    // nhan gay sai lech ton kho hang loat 2026-09-23, xem product_on_hands).
    // Entity co backfillRangeParam (vd invoices, log giao dich lon) van giu
    // fallback 1 gio - lan dau cho entity dang nay phai chay qua CLI
    // backfill.js (co chunk theo thang) de tranh 1 request khong gioi han.
    if (neverSynced && !entityModule.backfillRangeParam) {
      logger.log(`[KiotViet Sync] ${branch}/${entityModule.entity}: chua co checkpoint - quet toan bo lan dau.`);
      const query = { ...entityModule.listQuery };
      await kiotVietClient.fetchAllPages(entityModule.endpoint, query, async (items) => {
        await inTransaction(async (client) => {
          await entityModule.upsertPage(client, branch, items);
          await checkpoints.advanceCheckpoint(branch, entityModule.entity, runEndIso, { client });
        });
      });
      return;
    }
    const sinceIso = checkpoint?.last_synced_at
      ? new Date(checkpoint.last_synced_at).toISOString()
      : new Date(Date.parse(runEndIso) - 60 * 60 * 1000).toISOString();
    const query = { ...entityModule.listQuery, [entityModule.incrementalParam]: sinceIso };
    await kiotVietClient.fetchAllPages(entityModule.endpoint, query, async (items) => {
      await inTransaction(async (client) => {
        await entityModule.upsertPage(client, branch, items);
        await checkpoints.advanceCheckpoint(branch, entityModule.entity, runEndIso, { client });
      });
    });
  }

  return { pollEntityOnce };
}

const driver = createSyncDriver();
module.exports = { ...driver, createSyncDriver };
