'use strict';

const { value, array } = require('./entityUtils');
const { upsertStaffFromEntity } = require('../staffSync');

function createDocumentEntity(options) {
  const {
    entity, endpoint = entity, listQuery, hasUpperBound = true, parentColumns,
    parentUpdateColumns, mapParent, detailTable, parentIdColumn, detailKeys,
    detailColumns, mapDetail, payment, backfillRangeParam
  } = options;
  const parentSql = `INSERT INTO ${entity} (${parentColumns.join(',')}) VALUES (${parentColumns.map((_, i) => `$${i + 1}`).join(',')})
    ON CONFLICT (branch, id) DO UPDATE SET ${parentUpdateColumns.map((c) => `${c}=EXCLUDED.${c}`).join(', ')}, raw=EXCLUDED.raw, synced_at=now()`;
  const detailSql = `INSERT INTO ${detailTable} (${detailColumns.join(',')}) VALUES (${detailColumns.map((_, i) => `$${i + 1}`).join(',')})`;

  return {
    entity, endpoint, listQuery, incrementalParam: 'lastModifiedFrom', hasUpperBound,
    ...(backfillRangeParam ? { backfillRangeParam } : {}),
    async upsertPage(pgClient, branch, items) {
      for (const item of items) {
        const parentValues = mapParent(item);
        const id = parentValues[0];
        await pgClient.query(parentSql, [branch, ...parentValues, item]);
        const staffId = value(item, 'SoldById', 'soldById', 'CreatedById', 'createdById', 'UserId', 'userId', 'ReceivedById', 'receivedById');
        const staffName = value(item, 'SoldByName', 'soldByName', 'CreatedByName', 'createdByName', 'UserName', 'userName', 'ReceivedByName', 'receivedByName');
        await upsertStaffFromEntity(pgClient, branch, staffId, staffName);
        await pgClient.query(`DELETE FROM ${detailTable} WHERE branch=$1 AND ${parentIdColumn}=$2`, [branch, id]);
        const details = array(item, ...detailKeys);
        for (let lineNo = 0; lineNo < details.length; lineNo++) {
          await pgClient.query(detailSql, [branch, id, lineNo, ...mapDetail(details[lineNo]), details[lineNo]]);
        }
        if (payment) {
          await pgClient.query(`DELETE FROM ${payment.table} WHERE branch=$1 AND ${parentIdColumn}=$2`, [branch, id]);
          const payments = array(item, ...payment.keys);
          for (let lineNo = 0; lineNo < payments.length; lineNo++) {
            await pgClient.query(payment.sql, [branch, id, lineNo, ...payment.map(payments[lineNo]), payments[lineNo]]);
          }
        }
      }
    }
  };
}

module.exports = { createDocumentEntity, value };
