'use strict';

const RULE_VERSION = 'debt-reward-2026-10-v1';
const INVOICE_THRESHOLDS = [0, 1, 2, 5, 10, 20, 40];
const REVENUE_THRESHOLDS = [0, 5000000, 30000000, 100000000, 300000000, 1000000000, 3000000000, 6000000000, 9000000000];
const RANK_WEIGHTS = [19, 17, 15, 13, 11, 9, 7, 5, 3, 1];
const UNGROUPED = 'Chưa phân nhóm';
const saleOf = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim() || UNGROUPED;
const saleKey = value => saleOf(value).toLocaleLowerCase('vi');

function thresholdPoints(value, thresholds) {
  let points = 0;
  for (let i = 1; i < thresholds.length; i++) if (value >= thresholds[i]) points = i;
  return points;
}

function customerPoints(invoiceCount, netRevenue) {
  const invoicePoints = thresholdPoints(Number(invoiceCount) || 0, INVOICE_THRESHOLDS);
  const revenuePoints = Number(netRevenue) < 0 ? -1 : thresholdPoints(Number(netRevenue) || 0, REVENUE_THRESHOLDS);
  return { invoicePoints, revenuePoints, points: invoicePoints + revenuePoints };
}

// Recipients arrive in rank order; stable remainder ties therefore prefer the higher rank.
function allocateMoney(amount, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return weights.map(() => 0);
  const shares = weights.map(weight => amount * weight / total);
  const values = shares.map(Math.floor);
  const order = shares.map((share, i) => ({ i, remainder: share - values[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const remaining = amount - values.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < remaining; i++) values[order[i].i]++;
  return values;
}

function buildRewardBoard({ sales = [], penalties = [], lastDate = null } = {}) {
  const bySale = new Map();
  function entryOf(sale) {
    const key = saleKey(sale);
    if (!bySale.has(key)) bySale.set(key, { sale: saleOf(sale), branches: [], points: 0, ratio: null, rank: null,
      total: 0, grossPenalty: 0, payablePenalty: 0, rankReward: 0, pointsReward: 0, reward: 0,
      penaltyDays: 0, lastDayCustomers: 0, days: [], scoreCustomers: [], customerCount: 0,
      totalCurrentDebt: 0, totalOverdue: 0, overdueRatio: null, actionCount: 0 });
    return bySale.get(key);
  }
  for (const sale of sales) {
    const row = entryOf(sale.sale);
    row.points += Number(sale.points) || 0;
    row.branches = [...new Set([...row.branches, ...(sale.branches || [])])];
    row.scoreCustomers.push(...(sale.scoreCustomers || []));
    for (const field of ['customerCount', 'totalCurrentDebt', 'totalOverdue', 'actionCount']) row[field] += Number(sale[field]) || 0;
    row._average = (row._average || 0) + (Number(sale.totalAverage) || 0);
  }
  for (const item of penalties) {
    const row = entryOf(item.sale);
    if (item.branch) row.branches = [...new Set([...row.branches, item.branch])];
    const amount = Math.max(0, Number(item.amount) || 0);
    if (!amount) continue;
    let day = row.days.find(day => day.cycleDate === item.cycleDate);
    if (!day) { day = { cycleDate: item.cycleDate, customers: 0, amount: 0, live: Boolean(item.live) }; row.days.push(day); }
    day.customers += Number(item.customers) || 0;
    day.amount += amount;
  }
  const rows = [...bySale.values()];
  for (const row of rows) {
    row.days.sort((a, b) => b.cycleDate.localeCompare(a.cycleDate));
    row.grossPenalty = row.total = row.days.reduce((sum, day) => sum + day.amount, 0);
    row.ratio = row.points > 0 ? row.grossPenalty / row.points : null;
    row.penaltyDays = row.days.length;
    row.lastDayCustomers = (row.days.find(day => day.cycleDate === lastDate) || {}).customers || 0;
    row.overdueRatio = row._average > 0 ? row.totalOverdue / row._average : null;
    delete row._average;
  }
  const compareName = (a, b) => a.sale.localeCompare(b.sale, 'vi', { sensitivity: 'base' }) || a.sale.localeCompare(b.sale, 'vi');
  const ranked = rows.filter(row => row.points >= 30 && saleKey(row.sale) !== saleKey(UNGROUPED));
  ranked.sort((a, b) => a.grossPenalty * b.points - b.grossPenalty * a.points || b.points - a.points || compareName(a, b));
  ranked.forEach((row, i) => { row.rank = i + 1; });
  for (const row of rows) row.payablePenalty = row.rank && row.rank <= 20 ? 0 : row.grossPenalty;
  const grossPenalty = rows.reduce((sum, row) => sum + row.grossPenalty, 0);
  const payablePenalty = rows.reduce((sum, row) => sum + row.payablePenalty, 0);
  const penaltyFund = Math.round(payablePenalty * 0.8);
  const pool = Math.max(penaltyFund, 3000000);
  const recipients = ranked.slice(0, 10);
  const rankMoney = Math.floor(pool / 2);
  const rankRewards = allocateMoney(rankMoney, RANK_WEIGHTS.slice(0, recipients.length));
  const pointsRewards = allocateMoney(pool - rankMoney, recipients.map(row => row.points));
  recipients.forEach((row, i) => { row.rankReward = rankRewards[i]; row.pointsReward = pointsRewards[i]; row.reward = row.rankReward + row.pointsReward; });
  rows.sort((a, b) => (a.rank || Infinity) - (b.rank || Infinity) || b.points - a.points || compareName(a, b));
  return { rows, summary: { grossPenalty, payablePenalty, penaltyFund, pool, companyTopUp: pool - penaltyFund,
    allocatedReward: recipients.length ? pool : 0, recipientCount: recipients.length } };
}

module.exports = { RULE_VERSION, customerPoints, allocateMoney, buildRewardBoard, saleOf, saleKey };
