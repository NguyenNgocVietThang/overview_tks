'use strict';

const { getPool } = require('../db/pool');
const checkpointRepository = require('./checkpointRepository');
const { dashboardRollupEvents } = require('./dashboardRollupEvents');

// Bao cho cache Dashboard (dashboardData.js) biet bang invoices vua thuc su co
// dong duoc ghi (SAU COMMIT) — cache Hoa don/Chi tiet hoa don chi het han khi
// co tin hieu nay + rollup 'updated' ke tiep, khong het han theo nhip timer.
function notifyInvoicesWritten(events, entityModule, branch, items) {
  if (entityModule.entity !== 'invoices' || !items || !items.length) return;
  events.emit('invoicesChanged', { branch, count: items.length });
}

function createSyncDriver({ pool = getPool(), checkpointRepository: checkpoints = checkpointRepository, now = Date.now, logger = console, events = dashboardRollupEvents } = {}) {
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
    if (entityModule.reconcileIntervalMs) {
      let lastReconciledAt;
      try { lastReconciledAt = JSON.parse(checkpoint?.note || '{}').reconciledAt; } catch (_) {}
      const lastMs = Date.parse(lastReconciledAt);
      const full = !Number.isFinite(lastMs) || Date.parse(runEndIso) - lastMs >= entityModule.reconcileIntervalMs;
      // startDate filters transaction time, not modification time. Replay recent
      // days between daily complete sweeps so old edits/cancellations are repaired.
      const range = full ? {startDate:'1970-01-01T00:00:00.000Z',endDate:runEndIso} : {
        startDate: new Date(Math.min(Date.parse(checkpoint.last_synced_at) || Date.parse(runEndIso), Date.parse(runEndIso) - entityModule.replayWindowMs)).toISOString(),
        endDate: runEndIso
      };
      const seenIds = new Set();
      for (const isReceipt of ['true','false']) {
        const streamIds = new Set();
        let expectedTotal;
        await kiotVietClient.fetchAllPages(entityModule.endpoint, {...entityModule.listQuery,...range,isReceipt}, async (page,info)=>{
          if (info?.total != null) expectedTotal = Number(info.total);
          for (const item of page) {
            const id = String(item.Id ?? item.id);
            streamIds.add(id);
            seenIds.add(id);
          }
          const items=page.map(item=>({...item,IsReceipt:isReceipt==='true'}));
          await inTransaction(client=>(entityModule.reconcilePage || entityModule.upsertPage)(client,branch,items));
        });
        if (Number.isFinite(expectedTotal) && streamIds.size !== expectedTotal)
          throw new Error(`Incomplete cash flow snapshot: ${branch}/${isReceipt}, ${streamIds.size}/${expectedTotal} unique IDs`);
      }
      // Preserve historical rows; only flag missing source IDs after a complete
      // sweep. Publish that flag and the completed marker in the same transaction.
      await inTransaction(async client=>{
        if (full && entityModule.markMissing)
          await entityModule.markMissing(client,branch,[...seenIds],runEndIso);
        await checkpoints.advanceCheckpoint(branch,entityModule.entity,runEndIso,{
          client,note:JSON.stringify({windowEnd:runEndIso,reconciledAt:full?runEndIso:lastReconciledAt})
        });
      });
      return;
    }
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

  async function pollCustomers(api, branch, entity, checkpoint, runEndIso) {
    let reconciledAt;
    try { reconciledAt = JSON.parse(checkpoint?.note || '{}').activeCustomersReconciledAt; } catch (_) {}
    const lastFullMs = Date.parse(reconciledAt);
    const full = !Number.isFinite(lastFullMs) || Date.parse(runEndIso) - lastFullMs >= entity.reconcileIntervalMs;
    const query = { ...entity.listQuery };
    if (!full) query[entity.incrementalParam] = new Date(checkpoint.last_synced_at).toISOString();
    const seenIds = new Set();
    let expectedTotal;
    await api.fetchAllPages(entity.endpoint, query, async (items, info) => {
      if (full) {
        const total = Number(info?.total);
        if (info?.total == null || !Number.isInteger(total) || total <= 0 || !items.length
          || (expectedTotal !== undefined && expectedTotal !== total)) {
          throw new Error(`Incomplete customer snapshot: ${branch}, invalid or empty page/total`);
        }
        expectedTotal = total;
        for (const item of items) {
          const id = String(item.Id ?? item.id ?? item.CustomerId ?? item.customerId ?? '');
          if (!/^[1-9]\d*$/.test(id) || seenIds.has(id)) throw new Error(`Incomplete customer snapshot: ${branch}, missing/duplicate ID`);
          seenIds.add(id);
        }
      }
      await inTransaction(async client => {
        await entity.upsertPage(client, branch, items);
        await entity.applyPageMetadata(client, branch, info);
      });
    }, { requireComplete: full });
    if (full && (expectedTotal === undefined || seenIds.size !== expectedTotal)) {
      throw new Error(`Incomplete customer snapshot: ${branch}, ${seenIds.size}/${expectedTotal} unique IDs`);
    }
    // Only a complete, validated scan may flag absences. The completion marker
    // commits with those flags, so failures retry the full scan on the next poll.
    await inTransaction(async client => {
      if (full) await entity.markMissing(client, branch, [...seenIds], runEndIso);
      await checkpoints.advanceCheckpoint(branch, entity.entity, runEndIso, {
        client, note: JSON.stringify({ windowEnd: runEndIso, activeCustomersReconciledAt: full ? runEndIso : reconciledAt })
      });
    });
    events.emit('customersChanged', { branch });
  }

  // Entity co minIntervalMs (vd product_on_hands_snapshot: quet toan bo, nang) chi
  // chay khi lan thanh cong truoc da du cu, va khong bao gio chay chong nhau.
  const inFlight = new Set();
  const customerInFlight = new Map();

  async function pollEntityOnce(kiotVietClient, branch, entityModule) {
    if (entityModule.entity === 'customers') {
      const key = `${branch}:customers`;
      if (customerInFlight.has(key)) return customerInFlight.get(key);
      const running = pollEntityNow(kiotVietClient, branch, entityModule);
      customerInFlight.set(key, running);
      try { return await running; }
      finally { customerInFlight.delete(key); }
    }
    if (!entityModule.minIntervalMs) return pollEntityNow(kiotVietClient, branch, entityModule);
    const key = `${branch}:${entityModule.entity}`;
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
      const checkpoint = await checkpoints.getCheckpoint(branch, entityModule.entity);
      const lastMs = checkpoint?.last_synced_at ? new Date(checkpoint.last_synced_at).getTime() : NaN;
      if (Number.isFinite(lastMs) && now() - lastMs < entityModule.minIntervalMs) return;
      return await pollEntityNow(kiotVietClient, branch, entityModule);
    } finally {
      inFlight.delete(key);
    }
  }

  async function pollEntityNow(kiotVietClient, branch, entityModule) {
    const checkpoint = await checkpoints.getCheckpoint(branch, entityModule.entity);
    const runEndIso = new Date(now()).toISOString();
    if (entityModule.entity === 'cash_flows') {
      return pollCashFlows(kiotVietClient, branch, entityModule, checkpoint, runEndIso);
    }
    if (entityModule.entity === 'customers' && entityModule.reconcileIntervalMs) {
      return pollCustomers(kiotVietClient, branch, entityModule, checkpoint, runEndIso);
    }
    const neverSynced = !checkpoint?.last_synced_at;
    // Entity CHUA TUNG dong bo thanh cong (checkpoint rong) va khong can
    // chunk theo thang (khong co backfillRangeParam - dang "snapshot" nhu
    // categories/products/customers/product_on_hands, giong tieu
    // chi backfillPlan.js dung de goi 1 chunk 'full' khong loc ngay): quet
    // TOAN BO du lieu hien tai ngay trong lan poll dau tien, thay vi fallback
    // "1 gio gan nhat" (fallback nay chi hop ly cho truong hop da co checkpoint
    // cu, dung de bu khoang trong ngan do server restart/redeploy - ap dung
    // no cho entity moi hoan toan se bo sot toan bo du lieu cu, dung nguyen
    // nhan gay sai lech ton kho hang loat 2026-09-23, xem product_on_hands).
    // Entity co backfillRangeParam (vd invoices, log giao dich lon) van giu
    // fallback 1 gio - lan dau cho entity dang nay phai chay qua CLI
    // backfill.js (co chunk theo thang) de tranh 1 request khong gioi han.
    if (entityModule.pollFullSnapshot || (neverSynced && !entityModule.backfillRangeParam)) {
      logger.log(`[KiotViet Sync] ${branch}/${entityModule.entity}: doi soat toan bo danh sach.`);
      const query = { ...entityModule.listQuery, ...entityModule.pollQuery };
      await kiotVietClient.fetchAllPages(entityModule.endpoint, query, async (items) => {
        await inTransaction(async (client) => {
          await (entityModule.reconcilePage || entityModule.upsertPage)(client, branch, items);
        });
        notifyInvoicesWritten(events, entityModule, branch, items);
      });
      await inTransaction(client => checkpoints.advanceCheckpoint(branch, entityModule.entity, runEndIso, { client }));
      return;
    }
    const sinceIso = checkpoint?.last_synced_at
      ? new Date(checkpoint.last_synced_at).toISOString()
      : new Date(Date.parse(runEndIso) - 60 * 60 * 1000).toISOString();
    const query = { ...entityModule.listQuery, [entityModule.incrementalParam]: sinceIso };
    await kiotVietClient.fetchAllPages(entityModule.endpoint, query, async (items) => {
      await inTransaction(async (client) => {
        await entityModule.upsertPage(client, branch, items);
      });
      notifyInvoicesWritten(events, entityModule, branch, items);
    });
    // A timestamp is a completed window, not a page cursor. If a later page
    // fails, replay the old window (upserts are idempotent) on the next poll.
    await inTransaction(client => checkpoints.advanceCheckpoint(branch, entityModule.entity, runEndIso, { client }));
  }

  return { pollEntityOnce };
}

const driver = createSyncDriver();
module.exports = { ...driver, createSyncDriver };
