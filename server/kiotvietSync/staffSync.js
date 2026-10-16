'use strict';

async function upsertStaffFromEntity(pgClient, branch, staffId, staffName) {
  if (staffId === null || staffId === undefined || staffId === '') return;
  // Moi hoa don/don hang/phieu thu chi deu goi ham nay nen truoc day `staff`
  // (~240 dong) bi UPDATE ~42.000 lan/34 ngay (+ ~1.000 lan autovacuum) chi de
  // dat lai last_seen_at. Chi ghi khi ten doi hoac last_seen_at da cu hon 1
  // ngay - du cho muc dich "nhan vien xuat hien lan cuoi" (kiotvietSyncStatusRoutes).
  await pgClient.query(
    `INSERT INTO staff (branch, id, name) VALUES ($1,$2,$3)
     ON CONFLICT (branch, id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, staff.name), last_seen_at = now()
     WHERE staff.name IS DISTINCT FROM COALESCE(EXCLUDED.name, staff.name)
        OR staff.last_seen_at < now() - interval '1 day'`,
    [branch, staffId, staffName || null]
  );
}

module.exports = { upsertStaffFromEntity };
