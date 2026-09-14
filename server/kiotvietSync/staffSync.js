'use strict';

async function upsertStaffFromEntity(pgClient, branch, staffId, staffName) {
  if (staffId === null || staffId === undefined || staffId === '') return;
  await pgClient.query(
    `INSERT INTO staff (branch, id, name) VALUES ($1,$2,$3)
     ON CONFLICT (branch, id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, staff.name), last_seen_at = now()`,
    [branch, staffId, staffName || null]
  );
}

module.exports = { upsertStaffFromEntity };
