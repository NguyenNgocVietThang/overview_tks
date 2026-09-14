'use strict';

const { getPool } = require('../db/pool');
const checkpointRepository = require('./checkpointRepository');

function createSyncDriver({ pool = getPool(), checkpointRepository: checkpoints = checkpointRepository, now = Date.now } = {}) {
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
      }, async (pageItems) => { items.push(...pageItems); });
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
