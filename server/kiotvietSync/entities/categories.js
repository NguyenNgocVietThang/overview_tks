'use strict';

const { value, upsertRows } = require('./entityUtils');

module.exports = {
  entity: 'categories', endpoint: 'categories',
  listQuery: { hierachicalData: 'false' }, incrementalParam: 'lastModifiedFrom', hasUpperBound: true,
  async upsertPage(pgClient, branch, items) {
    await upsertRows(pgClient,
      `INSERT INTO categories (branch, id, parent_id, name, rank, modified_date, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (branch, id) DO UPDATE SET parent_id=EXCLUDED.parent_id,
       name=EXCLUDED.name, rank=EXCLUDED.rank, modified_date=EXCLUDED.modified_date,
       raw=EXCLUDED.raw, synced_at=now()`, branch, items, (item) => [
        value(item, 'Id', 'id', 'CategoryId', 'categoryId'), value(item, 'ParentId', 'parentId'),
        value(item, 'Name', 'name', 'CategoryName', 'categoryName'), value(item, 'Rank', 'rank'),
        value(item, 'ModifiedDate', 'modifiedDate')
      ]);
  }
};
