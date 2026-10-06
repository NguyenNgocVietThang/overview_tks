'use strict';
// Dữ liệu thực đã xác minh: chi âm, thu dương. Không đổi dấu lần nữa.
function balanceAt(accountId, checkpoints, entries, at) {
  const match = (x) =>
    String(x.accountId ?? 'cash') === String(accountId ?? 'cash');
  const cps = checkpoints
    .filter(match)
    .sort(
      (a, b) =>
        +new Date(a.checkpointAt) - +new Date(b.checkpointAt) ||
        Number(a.id || 0) - Number(b.id || 0),
    );
  const cp =
    cps.filter((c) => +new Date(c.checkpointAt) <= +new Date(at)).at(-1) ||
    cps[0];
  if (!cp) return null;
  const target = +new Date(at),
    anchor = +new Date(cp.checkpointAt);
  const delta = entries
    .filter(
      (e) =>
        match(e) &&
        e.status !== 1 &&
        +new Date(e.transDate) > Math.min(target, anchor) &&
        +new Date(e.transDate) <= Math.max(target, anchor),
    )
    .reduce((s, e) => s + Number(e.amount || 0), 0);
  return Number(cp.balance) + (target >= anchor ? delta : -delta);
}
// Khi tra thời điểm trước lần chốt đầu, tính lùi từ mốc đầu tiên.
function anchorSql(accountExpr, atExpr) {
  return `(SELECT cp.* FROM cash_book_checkpoints cp WHERE cp.account_id IS NOT DISTINCT FROM ${accountExpr}
 ORDER BY (cp.checkpoint_at<=${atExpr}) DESC,
 CASE WHEN cp.checkpoint_at<=${atExpr} THEN cp.checkpoint_at END DESC,
 CASE WHEN cp.checkpoint_at>${atExpr} THEN cp.checkpoint_at END ASC, cp.id DESC LIMIT 1)`;
}
function balanceSql(accountExpr, atExpr, checkpointAlias = 'cp') {
  return `CASE WHEN ${checkpointAlias}.id IS NULL THEN NULL ELSE ${checkpointAlias}.balance+
 COALESCE((SELECT SUM(COALESCE(c.amount,0)) FROM cash_flows c
 WHERE c.account_id IS NOT DISTINCT FROM ${accountExpr} AND c.status IS DISTINCT FROM 1
 AND c.trans_date>LEAST(${atExpr},${checkpointAlias}.checkpoint_at)
 AND c.trans_date<=GREATEST(${atExpr},${checkpointAlias}.checkpoint_at)),0)*
 CASE WHEN ${atExpr}>=${checkpointAlias}.checkpoint_at THEN 1 ELSE -1 END END`;
}
module.exports = { balanceAt, anchorSql, balanceSql };
