'use strict';

// Test "duong noi" giua syncDriver + CAC ENTITY MODULE THAT (khong dung object
// entity gia lap nhu syncDriver.test.js). Muc tieu: bat loi tich hop chi lo ra
// khi ghep syncDriver.pollEntityOnce voi entities/cashFlows.js, entities/orders.js,
// entities/returns.js, entities/invoices.js that - vd neu ai do sua listQuery/
// incrementalParam trong 1 entity module ma khong cap nhat syncDriver tuong ung.
//
// Phat hien khi doc lai syncDriver.js: `hasUpperBound` CHI duoc backfillPlan.js
// doc (da co test rieng o backfillPlan.test.js) - syncDriver.js khong bao gio
// doc field nay khi poll. Vi vay o cap syncDriver, orders/returns (hasUpperBound:
// false) va invoices (hasUpperBound mac dinh true) deu nhan CUNG 1 kieu xu ly:
// chi duy nhat 1 tham so lastModifiedFrom, khong co tham so chan tren nao ca -
// khac mo ta ban dau trong ke hoach Phase4 Task 2 (gia dinh invoices co tham so
// chan tren o cap poll). Test duoi day xac nhan dung hanh vi THAT nay, de bao
// ve neu sau nay co ai vo tinh them logic hasUpperBound nham vao syncDriver.js.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSyncDriver } = require('./syncDriver');
const { createCheckpointRepository } = require('./checkpointRepository');
const ordersEntity = require('./entities/orders');
const returnsEntity = require('./entities/returns');
const invoicesEntity = require('./entities/invoices');
const cashFlowsEntity = require('./entities/cashFlows');

function createFakeSyncPool() {
  const checkpoints = new Map();
  const key = (branch, entity) => `${branch}::${entity}`;
  const businessWrites = [];

  async function apply(sql, params) {
    if (sql.startsWith('SELECT branch, entity')) {
      const [branch, entity] = params;
      const row = checkpoints.get(key(branch, entity));
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('INSERT INTO sync_checkpoints')) {
      const [branch, entity, syncedAt, note] = params;
      checkpoints.set(key(branch, entity), {
        branch, entity, last_synced_at: syncedAt, last_success_at: new Date().toISOString(), note: note ?? null
      });
      return { rows: [] };
    }
    businessWrites.push({ sql, params });
    return { rows: [] };
  }

  return {
    businessWrites,
    getCheckpointStore: () => checkpoints,
    async query(sql, params) { return apply(sql, params); },
    async connect() {
      let pending = [];
      return {
        async query(sql, params) {
          if (sql === 'BEGIN') { pending = []; return; }
          if (sql === 'COMMIT') { const staged = pending; pending = []; for (const [s, p] of staged) await apply(s, p); return; }
          if (sql === 'ROLLBACK') { pending = []; return; }
          pending.push([sql, params]);
        },
        release() {}
      };
    }
  };
}

function noopKiotVietClient(queries) {
  return {
    async fetchAllPages(endpoint, query, onPage) {
      queries.push({ endpoint, query });
      await onPage([]);
    }
  };
}

test('orders (hasUpperBound:false, entity module that) khong bi syncDriver gan them tham so chan tren khi poll', async () => {
  const pool = createFakeSyncPool();
  const checkpoints = createCheckpointRepository({ pool });
  const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T05:00:00Z') });
  const queries = [];
  await driver.pollEntityOnce(noopKiotVietClient(queries), 'hanoi', ordersEntity);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].query, {
    includePayment: 'true', includeOrderDelivery: 'true', lastModifiedFrom: '2026-09-14T04:00:00.000Z'
  });
});

test('returns (hasUpperBound:false, entity module that) khong bi syncDriver gan them tham so chan tren khi poll', async () => {
  const pool = createFakeSyncPool();
  const checkpoints = createCheckpointRepository({ pool });
  const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T05:00:00Z') });
  const queries = [];
  await driver.pollEntityOnce(noopKiotVietClient(queries), 'hanoi', returnsEntity);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].query, {
    includePayment: 'true', lastModifiedFrom: '2026-09-14T04:00:00.000Z'
  });
});

test('invoices (doi chung, hasUpperBound mac dinh true, entity module that): syncDriver van chi dung dung 1 tham so lastModifiedFrom, khong co tham so chan tren nao o cap poll', async () => {
  const pool = createFakeSyncPool();
  const checkpoints = createCheckpointRepository({ pool });
  const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T05:00:00Z') });
  const queries = [];
  await driver.pollEntityOnce(noopKiotVietClient(queries), 'hanoi', invoicesEntity);
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].query, {
    includePayment: 'true', includeInvoiceDelivery: 'true', IncludeSaleChannel: 'true', lastModifiedFrom: '2026-09-14T04:00:00.000Z'
  });
  const hasUpperBoundKey = Object.keys(queries[0].query).some((k) => /^(to|from)[A-Z]/.test(k) || k === 'endDate' || k === 'startDate');
  assert.equal(hasUpperBoundKey, false, 'khong co tham so kieu fromXDate/toXDate/startDate/endDate o cap poll cho invoices');
});

test('cash_flows (entity module that): syncDriver goi API dung 2 lan isReceipt=true roi false, gop upsert va staffSync that trong 1 transaction, luu cua so vao note', async () => {
  const pool = createFakeSyncPool();
  const checkpoints = createCheckpointRepository({ pool });
  const driver = createSyncDriver({ pool, checkpointRepository: checkpoints, now: () => Date.parse('2026-09-14T02:00:00Z') });

  const queries = [];
  const kiotVietClient = {
    async fetchAllPages(endpoint, query, onPage) {
      queries.push({ endpoint, query });
      if (query.isReceipt === 'true') {
        await onPage([{ Id: 501, Code: 'PT001', IsReceipt: true, Amount: 100000, UserId: 77, UserName: 'Nguyen Van A', TransDate: '2026-09-14T01:30:00Z', CreatedDate: '2026-09-14T01:30:00Z' }]);
      } else {
        await onPage([{ Id: 502, Code: 'PC001', IsReceipt: false, Amount: 50000, UserId: 78, UserName: 'Tran Thi B', TransDate: '2026-09-14T01:45:00Z', CreatedDate: '2026-09-14T01:45:00Z' }]);
      }
    }
  };

  await driver.pollEntityOnce(kiotVietClient, 'saigon', cashFlowsEntity);

  assert.equal(queries.length, 2, 'phai goi fetchAllPages dung 2 lan cho 1 lan pollEntityOnce');
  assert.equal(queries[0].query.isReceipt, 'true', 'lan goi dau tien phai la isReceipt=true');
  assert.equal(queries[1].query.isReceipt, 'false', 'lan goi thu hai phai la isReceipt=false');
  assert.equal(queries[0].endpoint, 'cashflow');

  const cashFlowWrites = pool.businessWrites.filter((w) => w.sql.startsWith('INSERT INTO cash_flows'));
  const staffWrites = pool.businessWrites.filter((w) => w.sql.startsWith('INSERT INTO staff'));
  assert.equal(cashFlowWrites.length, 2, 'ca 2 item (thu va chi) phai duoc upsert vao cash_flows trong 1 transaction duy nhat');
  assert.equal(staffWrites.length, 2, 'staffSync that phai duoc goi cho ca 2 nhan vien (UserId 77 va 78)');

  const checkpoint = await checkpoints.getCheckpoint('saigon', 'cash_flows');
  assert.equal(checkpoint.note, '2026-09-14T02:00:00.000Z', 'cua so da dung (endDate) phai duoc luu vao note, khong dung last_synced_at de tinh khoang ngay lan sau');
});
