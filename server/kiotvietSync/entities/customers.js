'use strict';
const { value, createSimpleEntity } = require('./entityUtils');
const columns = ['branch','id','code','name','phone','group_id','debt','total_revenue','created_date','modified_date','raw'];
const updateColumns = columns.filter(column => !['branch','id','raw'].includes(column));
const mapCustomer = x => [value(x,'Id','id','CustomerId','customerId'), value(x,'Code','code','CustomerCode','customerCode'), value(x,'Name','name','CustomerName','customerName'), value(x,'ContactNumber','contactNumber','Phone','phone'), value(x,'GroupId','groupId'), value(x,'Debt','debt','TotalDebt','totalDebt'), value(x,'TotalRevenue','totalRevenue'), value(x,'CreatedDate','createdDate'), value(x,'ModifiedDate','modifiedDate')];
const base = createSimpleEntity({
  entity: 'customers', listQuery: { includeTotal: 'true', includeCustomerGroup: 'true', includeCustomerSocial: 'true', includeRemoveIds: 'true' },
  columns, updateColumns, map: mapCustomer
});

module.exports = {
  ...base,
  reconcileIntervalMs: 24 * 60 * 60 * 1000,
  // Khoa/nhan/su kien cho syncDriver.pollReconciled (giu nguyen ten khoa cu trong checkpoint.note).
  reconcileMarkerKey: 'activeCustomersReconciledAt',
  snapshotLabel: 'customer',
  changeEvent: 'customersChanged',
  async upsertPage(client, branch, items) {
    // API khach khong tra trang thai: khach da danh dau ngung hoat dong tu DS khach (raw.inactiveSource='ds-khach') giu nguyen
    // cho den khi KiotViet doi modifiedDate (SQL ON CONFLICT ben duoi), tranh bi lan quet day du ghi lai thanh hoat dong.
    const normalized = items.map(item => {
      const active = item.isActive ?? item.IsActive ?? true;
      return { ...item, isActive: active !== false && active !== 'false' && active !== 0 && active !== '0' };
    });
    for (let offset = 0; offset < normalized.length; offset += 100) {
      const batch = normalized.slice(offset, offset + 100);
      const params = batch.flatMap(item => [branch, ...mapCustomer(item), item]);
      const values = batch.map((_, row) => '(' + columns.map((_, col) => '$' + (row * columns.length + col + 1)).join(',') + ')').join(',');
      await client.query(`INSERT INTO customers (${columns.join(',')}) VALUES ${values}
        ON CONFLICT (branch, id) DO UPDATE SET ${updateColumns.map(column => `${column}=EXCLUDED.${column}`).join(',')},
        raw=CASE WHEN customers.raw->>'inactiveSource'='ds-khach' AND EXCLUDED.modified_date IS NOT DISTINCT FROM customers.modified_date
          THEN EXCLUDED.raw || '{"isActive":false,"inactiveSource":"ds-khach"}'::jsonb ELSE EXCLUDED.raw END, synced_at=now()`, params);
    }
  },
  async applyPageMetadata(client, branch, info = {}) {
    const ids = info.removedIds || [];
    if (!ids.length) return;
    await client.query(`UPDATE customers SET raw=COALESCE(raw,'{}'::jsonb) || '{"isActive":false}'::jsonb, synced_at=now()
      WHERE branch=$1 AND id=ANY($2::bigint[]) AND raw->>'isActive' IS DISTINCT FROM 'false'`, [branch, ids]);
  },
  async markMissing(client, branch, ids, before) {
    if (!ids.length) throw new Error('Empty customer snapshot cannot mark missing records');
    await client.query(`UPDATE customers SET raw=COALESCE(raw,'{}'::jsonb) || '{"isActive":false}'::jsonb, synced_at=now()
      WHERE branch=$1 AND NOT(id=ANY($2::bigint[])) AND synced_at<=$3::timestamptz
      AND raw->>'isActive' IS DISTINCT FROM 'false'`, [branch, ids, before]);
  }
};
