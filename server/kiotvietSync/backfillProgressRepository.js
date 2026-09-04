'use strict';

// Namespace rieng voi syncCheckpointRepository.js: day la checkpoint theo
// TRANG (currentItem) cho tung buoc backfill (log_name = "<entity>:backfill"
// hoac "<entity>:backfill:<YYYY-MM>[:receipt|:expense]"), khong phai theo
// thoi gian cho vong lap incremental.

async function getOffset(pool, branchId, logName) {
  const result = await pool.query(
    'SELECT next_offset FROM backfill_progress WHERE branch_id = $1 AND log_name = $2',
    [branchId, logName]
  );
  return result.rows.length ? result.rows[0].next_offset : 0;
}

async function saveOffset(pool, branchId, logName, nextOffset) {
  await pool.query(
    `INSERT INTO backfill_progress (branch_id, log_name, next_offset, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (branch_id, log_name) DO UPDATE SET
       next_offset = EXCLUDED.next_offset,
       updated_at = now()`,
    [branchId, logName, nextOffset]
  );
}

async function clearOffset(pool, branchId, logName) {
  await pool.query('DELETE FROM backfill_progress WHERE branch_id = $1 AND log_name = $2', [branchId, logName]);
}

module.exports = { getOffset, saveOffset, clearOffset };
