'use strict';

const { getCheckpoint, recordSuccess, recordError } = require('./syncCheckpointRepository');
const { toKiotVietDateTimeParam } = require('./vietnamTime');

// Dem tru an toan 2-5 phut chong lech gio/du lieu den muon truoc khi goi
// KiotViet tu mot checkpoint (PlanDB.md §7.2).
const CHECKPOINT_BUFFER_MS = 3 * 60 * 1000;

async function computeSinceIso(pool, branchId, entityName) {
  const checkpoint = await getCheckpoint(pool, branchId, entityName);
  if (!checkpoint || !checkpoint.lastCheckpointAt) return null;
  const buffered = new Date(checkpoint.lastCheckpointAt.getTime() - CHECKPOINT_BUFFER_MS);
  return toKiotVietDateTimeParam(buffered);
}

// Chay dung 1 entity: tinh sinceIso, goi syncFn, ghi nhan ket qua qua
// syncCheckpointRepository. KHONG BAO GIO throw ra ngoai -- loi 1 entity
// khong duoc chan cac entity/branch khac (PlanDB.md §5.2/§7.2).
async function runEntitySync(pool, kiotVietClient, branch, entityName, syncFn) {
  const startedAt = new Date();
  // checkpointAt la THOI DIEM BAT DAU request, khong phai ModifiedDate lon
  // nhat trong ket qua -- khong tin tuong mu quang vao ModifiedDate.
  const checkpointAt = startedAt;

  try {
    const sinceIso = await computeSinceIso(pool, branch.id, entityName);
    const { fetched, upserted } = await syncFn(pool, kiotVietClient, branch, sinceIso);
    const finishedAt = new Date();
    await recordSuccess(pool, branch.id, entityName, { checkpointAt, fetched, upserted, startedAt, finishedAt });
  } catch (error) {
    const finishedAt = new Date();
    await recordError(pool, branch.id, entityName, { error, startedAt, finishedAt });
  }
}

function startLoop(pool, kiotVietClient, branch, entities, intervalMs, startDelayMs) {
  let stopped = false;
  let timeoutHandle = null;

  async function tick() {
    if (stopped) return;
    for (const entity of entities) {
      if (stopped) break;
      await runEntitySync(pool, kiotVietClient, branch, entity.name, entity.sync);
    }
    if (!stopped) timeoutHandle = setTimeout(tick, intervalMs);
  }

  timeoutHandle = setTimeout(tick, startDelayMs);

  return function stop() {
    stopped = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
  };
}

// Moi branch co 2 vong lap (nhanh/cham) DOC LAP hoan toan, tu try/catch
// rieng, khong await lan nhau -- goi startBranchLoops 2 lan (1 lan/branch) o
// tang tren khong duoc await lan nhau de dam bao co lap giua 2 branch
// (PlanDB.md §5.2).
function startBranchLoops(pool, kiotVietClient, branch, {
  fastEntities, slowEntities, fastIntervalMs, slowIntervalMs, startDelayMs = 0
}) {
  const stopFast = startLoop(pool, kiotVietClient, branch, fastEntities, fastIntervalMs, startDelayMs);
  const stopSlow = startLoop(pool, kiotVietClient, branch, slowEntities, slowIntervalMs, startDelayMs);

  return function stop() {
    stopFast();
    stopSlow();
  };
}

module.exports = { startBranchLoops, runEntitySync, computeSinceIso };
