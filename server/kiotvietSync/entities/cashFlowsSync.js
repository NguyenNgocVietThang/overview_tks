'use strict';

const { parseKiotVietDateTime } = require('../vietnamTime');
const { upsertStaffFromEntity } = require('./staffSync');

function pick(obj, keys) {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return null;
}

function parseModifiedDate(raw) {
  return raw ? parseKiotVietDateTime(raw) : null;
}

async function resolveByKiotvietId(pool, table, branch, kiotvietId) {
  if (!kiotvietId) return null;
  const result = await pool.query(
    `SELECT id FROM ${table} WHERE branch_id = $1 AND kiotviet_id = $2`,
    [branch.id, kiotvietId]
  );
  return result.rows[0] ? result.rows[0].id : null;
}

// Response cua /cashflow KHONG tra field isReceipt -- gia tri nay chi xac
// dinh duoc qua QUERY da goi (isReceipt=true hoac isReceipt=false la 2 luot
// goi rieng), khong phai tu payload. Da xac nhan qua CustomerDebtReport.gs
// (production) va live probe -- xem kiotviet/API_ENDPOINTS.md.
async function upsertCashFlow(pool, branch, cashFlow, isReceipt) {
  const kiotvietId = pick(cashFlow, ['id', 'Id']);
  const code = pick(cashFlow, ['code', 'Code']);
  const transDate = parseModifiedDate(pick(cashFlow, ['transDate', 'TransDate']));
  const amount = pick(cashFlow, ['amount', 'Amount']);
  const partnerType = pick(cashFlow, ['partnerType', 'PartnerType']);
  const kiotvietPartnerId = pick(cashFlow, ['partnerId', 'PartnerId']);
  const partnerNameSnapshot = pick(cashFlow, ['partnerName', 'PartnerName']);
  const contactNumber = pick(cashFlow, ['contactNumber', 'ContactNumber']);
  const status = pick(cashFlow, ['status', 'Status']);
  const description = pick(cashFlow, ['description', 'Description']);
  const modifiedAt = parseModifiedDate(pick(cashFlow, ['modifiedDate', 'ModifiedDate']));

  const customerId = partnerType === 'C' ? await resolveByKiotvietId(pool, 'customers', branch, kiotvietPartnerId) : null;
  const supplierId = partnerType === 'S' ? await resolveByKiotvietId(pool, 'suppliers', branch, kiotvietPartnerId) : null;

  // cash_flows khong co cot staff rieng, nhung van goi de bang staff duoc bo
  // sung tu nguon nay theo PlanDB-Phase1-Spec.md §9.2.
  const userId = pick(cashFlow, ['userId', 'UserId']);
  const userName = pick(cashFlow, ['user', 'User']);
  await upsertStaffFromEntity(pool, branch, { kiotvietId: userId, fullName: userName, discoveredVia: 'cashflow' });

  await pool.query(
    `INSERT INTO cash_flows (
       branch_id, kiotviet_id, code, trans_date, amount, is_receipt, kiotviet_partner_id,
       customer_id, supplier_id, partner_name_snapshot, contact_number, status, description,
       kiotviet_modified_at, kiotviet_synced_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now(), now())
     ON CONFLICT (branch_id, kiotviet_id) WHERE kiotviet_id IS NOT NULL DO UPDATE SET
       code = EXCLUDED.code,
       trans_date = EXCLUDED.trans_date,
       amount = EXCLUDED.amount,
       is_receipt = EXCLUDED.is_receipt,
       kiotviet_partner_id = EXCLUDED.kiotviet_partner_id,
       customer_id = EXCLUDED.customer_id,
       supplier_id = EXCLUDED.supplier_id,
       partner_name_snapshot = EXCLUDED.partner_name_snapshot,
       contact_number = EXCLUDED.contact_number,
       status = EXCLUDED.status,
       description = EXCLUDED.description,
       kiotviet_modified_at = EXCLUDED.kiotviet_modified_at,
       kiotviet_synced_at = now(),
       updated_at = now()`,
    [
      branch.id, kiotvietId, code, transDate, amount, isReceipt, kiotvietPartnerId,
      customerId, supplierId, partnerNameSnapshot, contactNumber, status, description, modifiedAt
    ]
  );
  return 1;
}

function buildQuery(sinceIso, isReceipt) {
  // Live probe 2026-08-30 xac nhan lastModifiedFrom bi API /cashflow bo qua
  // hoan toan -- chi startDate/endDate hoat dong (khac cac entity khac).
  const query = {
    includeAccount: 'true', includeBranch: 'true', includeUser: 'true',
    isReceipt: String(isReceipt)
  };
  if (sinceIso) {
    query.startDate = sinceIso;
    query.endDate = new Date().toISOString().slice(0, 19);
  }
  return query;
}

async function syncOneDirection(pool, kiotVietClient, branch, sinceIso, isReceipt) {
  let fetched = 0;
  let upserted = 0;

  await kiotVietClient.fetchAllPages('cashflow', buildQuery(sinceIso, isReceipt), async (items) => {
    fetched += items.length;
    for (const item of items) {
      upserted += await upsertCashFlow(pool, branch, item, isReceipt);
    }
  });

  return { fetched, upserted };
}

async function syncCashFlows(pool, kiotVietClient, branch, sinceIso) {
  const receipts = await syncOneDirection(pool, kiotVietClient, branch, sinceIso, true);
  const expenses = await syncOneDirection(pool, kiotVietClient, branch, sinceIso, false);

  return {
    fetched: receipts.fetched + expenses.fetched,
    upserted: receipts.upserted + expenses.upserted
  };
}

module.exports = { syncCashFlows, upsertCashFlow };
