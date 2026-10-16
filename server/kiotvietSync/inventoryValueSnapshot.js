'use strict';

// Chup GIA TRI TON KHO hang ngay vao bang inventory_value_snapshots (migration 0025) -
// nguon cua bieu do cot "Gia tri ton kho theo ngay" (tab Tong quan, muc 1 Xu huong).
// Ton kho trong DB chi la trang thai hien tai nen khong dung lai duoc qua khu: moi
// ngay phai chup dung 1 lan, luc 23:59 gio VN. Bat dau tu toi 2026-09-30.
//
// Theo mau customerInvoiceLinesRefresh.js (takeSnapshot / takeSnapshotIfDue /
// startInventoryValueSnapshotSchedule), nhung kiem tra moi 1 PHUT (thay vi 5 phut) de
// khong truot qua 23:59; moi lan chi la 1 SELECT MAX(snapshot_date) re roi bo qua.
//
// Cong thuc giu NGUYEN nhu KPI "Gia tri ton kho" cua tab Hang hoa (dashboardData.js:
// stockValue = max(ton,0) * max(gia von,0)): moi ma hang cua co so, ton = tong
// inventories[].onHand, gia von = trung binh inventories[].cost; chi hang dang kinh
// doanh (is_active IS NOT FALSE), bo ma bat dau bang VAT. Tong 2 co so = so "Ca hai"
// (gia von binh quan theo ton khi gop ma cua 2 co so cho ra cung ket qua).
//
// Khong goi getDashboardData vi no co cache va phu thuoc quyen nguoi xem.
//
// LOCK: codebase khong co khoa lien tien trinh (gia dinh 1 instance); chay trung van
// vo hai vi INSERT ... ON CONFLICT DO NOTHING.

if (process.env.NODE_ENV !== 'production') {
  try { require('dotenv').config(); } catch (e) { /* dotenv là tùy chọn trong môi trường production */ }
}

const { getPool } = require('../db/pool');
const { INVENTORY_ONHAND_SQL, INVENTORY_COST_SQL } = require('../dashboard/dashboardPgReader');
const { vnDateKey, vnMinutesOfDay, addDaysToKey } = require('./vnTime');

const BRANCH_CODES = Object.freeze(['hanoi', 'saigon']);
// 23:59 gio VN, tinh bang phut trong ngay.
const SNAPSHOT_MINUTE_OF_DAY = 23 * 60 + 59;
// Bu ban chup bi lo cua HOM QUA chi khi con truoc 12:00 - qua trua ton kho da lech
// nhieu so voi luc 23:59, thoi thi de trong con hon ghi so sai.
const CATCH_UP_UNTIL_MINUTE = 12 * 60;

const SNAPSHOT_SQL = `INSERT INTO inventory_value_snapshots (snapshot_date, branch, stock_value)
  SELECT $1::date, p.branch,
         COALESCE(SUM(GREATEST(p.on_hand, 0) * GREATEST(COALESCE(p.cost, 0), 0)), 0)
  FROM (
    SELECT branch,
           ${INVENTORY_ONHAND_SQL} AS on_hand,
           ${INVENTORY_COST_SQL}   AS cost
    FROM products
    WHERE branch = ANY($2::text[])
      AND is_active IS NOT FALSE
      AND btrim(COALESCE(code, '')) <> ''
      AND upper(btrim(code)) NOT LIKE 'VAT%'
  ) p
  GROUP BY p.branch
  ON CONFLICT (snapshot_date, branch) DO NOTHING`;

const LAST_SNAPSHOT_SQL = 'SELECT MAX(snapshot_date)::text AS last_date FROM inventory_value_snapshots';

/**
 * Ngay (YYYY-MM-DD) can chup ngay bay gio, hoac null neu chua den han.
 * lastDate = snapshot_date lon nhat da co ('YYYY-MM-DD') hoac null khi bang rong.
 *  - >= 23:59 VN va chua co ban chup hom nay  -> chup cho HOM NAY.
 *  - Bang da co du lieu, thieu ban chup HOM QUA, va < 12:00 VN -> chup bu, gan HOM QUA.
 *  - Bang rong: chi chup theo quy tac dau (khong dung lai ngay truoc ngay bat dau).
 */
function snapshotDateDue(lastDate, now) {
  const today = vnDateKey(now);
  if (lastDate && lastDate >= today) return null;
  const minutes = vnMinutesOfDay(now);
  if (minutes >= SNAPSHOT_MINUTE_OF_DAY) return today;
  if (!lastDate) return null;
  const yesterday = addDaysToKey(today, -1);
  if (lastDate < yesterday && minutes < CATCH_UP_UNTIL_MINUTE) return yesterday;
  return null;
}

/** Chup ngay cho snapshotDate ('YYYY-MM-DD'); tra ve so dong da chen (0 neu da co). */
async function takeInventoryValueSnapshot(pool, snapshotDate, { log = console.log } = {}) {
  const result = await pool.query(SNAPSHOT_SQL, [snapshotDate, BRANCH_CODES]);
  const inserted = result.rowCount || 0;
  log(`[inventoryValueSnapshot] Ngay ${snapshotDate}: chup ${inserted} co so.`);
  return { snapshotDate, inserted };
}

async function takeInventoryValueSnapshotIfDue(pool, { log = console.log, now = () => new Date() } = {}) {
  const { rows } = await pool.query(LAST_SNAPSHOT_SQL);
  const snapshotDate = snapshotDateDue(rows[0] && rows[0].last_date, now());
  if (!snapshotDate) return { skipped: true };
  const result = await takeInventoryValueSnapshot(pool, snapshotDate, { log });
  return { skipped: false, ...result };
}

function startInventoryValueSnapshotSchedule(pool, {
  intervalMs = 60 * 1000,
  setIntervalFn = setInterval,
  scheduleImmediate = queueMicrotask,
  log = console.log
} = {}) {
  scheduleImmediate(() => {
    takeInventoryValueSnapshotIfDue(pool, { log }).catch((error) => {
      log(`[inventoryValueSnapshot] Loi khi kiem tra lan dau: ${error.message}`);
    });
  });
  return setIntervalFn(() => {
    takeInventoryValueSnapshotIfDue(pool, { log }).catch((error) => {
      log(`[inventoryValueSnapshot] Loi khi chup: ${error.message}`);
    });
  }, intervalMs);
}

// Chay tay: chup cho ngay VN hien tai (DO NOTHING neu da co).
async function main() {
  const result = await takeInventoryValueSnapshot(getPool(), vnDateKey(new Date()));
  console.log(`[inventoryValueSnapshot] Hoan tat, chen ${result.inserted} dong.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[inventoryValueSnapshot] That bai: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => getPool().end && getPool().end());
}

module.exports = {
  takeInventoryValueSnapshot,
  takeInventoryValueSnapshotIfDue,
  startInventoryValueSnapshotSchedule,
  __sql__: { SNAPSHOT_SQL, LAST_SNAPSHOT_SQL },
  __test__: { snapshotDateDue }
};
