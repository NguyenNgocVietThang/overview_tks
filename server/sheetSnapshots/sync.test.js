'use strict';
process.env.JWT_SECRET ||= 'test-secret';
process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '{}';

// Chay SQL THAT cua migration 0064 + job dong bo (sync.js) + 2 service doc tren PGlite.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { SOURCES, refreshSource, startSheetSnapshotSchedule, __test__ } = require('./sync');
const { createStockLocationsService } = require('../stockLocations/stockLocationsService');
const { createMeasureSheet } = require('../shipment/measureSheet');

const MIGRATION = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '0064_sheet_snapshots.sql'), 'utf8');
const HN = SOURCES.find(source => source.id === 'stock_locations_hn');
const SG = SOURCES.find(source => source.id === 'stock_locations_sg');
const MEASURES = SOURCES.find(source => source.id === 'shipping_measures');
const quiet = { info() {}, error() {} };
const hnHeader = ['MÃ SẢN PHẨM', 'TÊN SẢN PHẨM', 'TỔNG SL', 'MÔ TẢ', 'KHU', 'NGÀY VỀ'];
const sgHeader = ['Mã hàng', 'Tên hàng', 'TỔNG SL đã đi', 'Ghi chú hàng hóa', 'Vị trí', 'NGÀY VỀ'];
const measureHeader = ['MÃ SP', 'TÊN SP', 'Mô tả', 'SL/T', 'Cân nặng', 'D', 'R', 'C'];

// Nguon co cau hinh gia de khong phu thuoc .env.
const withId = source => ({ ...source, spreadsheetId: () => 'fixture' });
const hn = withId(HN);
const sg = withId(SG);
const measures = withId(MEASURES);

async function setup() {
  const db = new PGlite();
  await db.exec(MIGRATION);
  const pool = { query: (sql, params) => db.query(sql, params), connect: async () => ({ query: (sql, params) => db.query(sql, params), release() {} }) };
  return { db, pool };
}

function sheet(valuesByTitle) {
  const reads = [];
  return {
    reads,
    listSheetTitles: async () => Object.keys(valuesByTitle),
    getValues: async (title, options) => { reads.push({ title, options }); return valuesByTitle[title]; }
  };
}

let clock = Date.parse('2026-10-17T03:00:00Z');
const at = minutes => () => new Date(clock + minutes * 60 * 1000);

test('lan dau ghi du lieu, lan hai khong doi thi 0 dong ghi; sua/xoa/them dong chi dong do doi', async () => {
  __test__.pendingShrink.clear();
  const { db, pool } = await setup();
  const rows = [hnHeader, ['A1', 'Đèn', '10', 'm1', 'K1', '01/10'], ['A2', 'Quạt', '0', '', 'K2', ''], ['A1', 'Đèn', '5', '', '', '']];
  const first = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': rows }), now: at(0), logger: quiet });
  assert.deepEqual([first.status, first.inserted, first.deleted], ['updated', 3, 0]);

  const same = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': rows }), now: at(10), logger: quiet });
  assert.deepEqual([same.status, same.inserted, same.deleted], ['unchanged', 0, 0]);

  const edited = [hnHeader, ['A1', 'Đèn', '10', 'm1', 'K1', '01/10'], ['A2', 'Quạt', '7', '', 'K2', ''], ['A1', 'Đèn', '5', '', '', ''], ['A3', 'Bơm', '1', '', '', '']];
  const changed = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': edited }), now: at(20), logger: quiet });
  assert.deepEqual([changed.status, changed.inserted, changed.deleted], ['updated', 2, 1]);

  const service = createStockLocationsService({ getDb: () => pool, now: () => clock + 21 * 60 * 1000 });
  const result = await service.getLocations('HN');
  assert.deepEqual(result.rows.map(row => [row.code, row.totalQuantity]), [['A1', '10'], ['A2', '7'], ['A1', '5'], ['A3', '1']]);
  assert.equal(result.rows[0].arrivalDate, '01/10');
  assert.equal(result.stale, false); // lan thanh cong cuoi cach 1 phut
});

test('dong bo HN khong dung toi du lieu SG; moi co so co moc dong bo rieng', async () => {
  __test__.pendingShrink.clear();
  const { pool } = await setup();
  await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': [hnHeader, ['H1', 'Hà Nội', '1', '', '', '']] }), now: at(0), logger: quiet });
  await refreshSource(sg, { pool, client: sheet({ 'Vị trí SG': [sgHeader, ['S1', 'Sài Gòn', '2', '', '', '']] }), now: at(0), logger: quiet });
  // HN doi thanh sheet moi hoan toan: SG phai nguyen ven.
  await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': [hnHeader, ['H2', 'Mới', '3', '', '', '']] }), now: at(20), logger: quiet });
  const service = createStockLocationsService({ getDb: () => pool, now: () => clock });
  assert.deepEqual((await service.getLocations('HN')).rows.map(row => row.code), ['H2']);
  assert.deepEqual((await service.getLocations('SG')).rows.map(row => row.code), ['S1']);
});

test('cho phep ten tab khac hoa/thuong va doc o che do FORMATTED_VALUE', async () => {
  __test__.pendingShrink.clear();
  const { pool } = await setup();
  const client = sheet({ 'VỊ TRÍ HN': [hnHeader, ['A', 'B', '1', '', '', '']] });
  const result = await refreshSource(hn, { pool, client, now: at(0), logger: quiet });
  assert.equal(result.status, 'updated');
  assert.deepEqual(client.reads, [{ title: 'VỊ TRÍ HN', options: { valueRenderOption: 'FORMATTED_VALUE' } }]);
});

test('chua den han hoac khoa dang giu thi KHONG goi Google', async () => {
  __test__.pendingShrink.clear();
  const { db, pool } = await setup();
  await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': [hnHeader, ['A', 'B', '1', '', '', '']] }), now: at(0), logger: quiet });
  let reads = 0;
  const spy = { listSheetTitles: async () => { reads++; return ['Vị trí HN']; }, getValues: async () => [] };
  const early = await refreshSource(hn, { pool, client: spy, now: at(1), logger: quiet });
  assert.equal(early.status, 'not-due');
  const busyPool = { connect: async () => ({ query: async (sql, params) => (sql.includes('pg_try_advisory_lock') ? { rows: [{ locked: false }] } : db.query(sql, params)), release() {} }) };
  assert.equal((await refreshSource(hn, { pool: busyPool, client: spy, now: at(60), logger: quiet })).status, 'busy');
  assert.equal(reads, 0);
});

test('loi Google/sheet mat: giu nguyen du lieu cu, ghi thong bao an toan (khong lo chi tiet) va mo khoa', async () => {
  __test__.pendingShrink.clear();
  const { db, pool } = await setup();
  await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': [hnHeader, ['A', 'B', '1', '', '', '']] }), now: at(0), logger: quiet });
  const boom = { listSheetTitles: async () => { throw Object.assign(new Error('secret token abc'), { code: 403 }); }, getValues: async () => [] };
  assert.equal((await refreshSource(hn, { pool, client: boom, now: at(20), logger: quiet })).status, 'failed');
  const missing = await refreshSource(hn, { pool, client: sheet({ 'Khác': [] }), now: at(40), logger: quiet });
  assert.equal(missing.status, 'failed');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM stock_location_lines')).rows[0].n, 1);
  const state = (await db.query('SELECT last_error, last_success_at FROM sheet_snapshot_sync WHERE source = $1', ['stock_locations_hn'])).rows[0];
  assert.ok(state.last_error && !/secret/.test(state.last_error));
  const service = createStockLocationsService({ getDb: () => pool, now: () => clock + 41 * 60 * 1000 });
  assert.equal((await service.getLocations('HN')).stale, true);
  // Khoa advisory da duoc nha: lan chay sau van lay duoc khoa.
  const retry = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': [hnHeader, ['A', 'B', '2', '', '', '']] }), now: at(60), logger: quiet });
  assert.equal(retry.status, 'updated');
  assert.equal((await service.getLocations('HN')).stale, false);
});

test('so dong tut >30%: giu ban cu o lan dau, chi chap nhan khi lan doc ke tiep cho cung ket qua', async () => {
  __test__.pendingShrink.clear();
  const { pool } = await setup();
  const big = [hnHeader, ...Array.from({ length: 10 }, (_, index) => [`C${index}`, 'x', '1', '', '', ''])];
  await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': big }), now: at(0), logger: quiet });
  const small = [hnHeader, ['C0', 'x', '1', '', '', '']];
  const held = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': small }), now: at(20), logger: quiet });
  assert.equal(held.status, 'held');
  const service = createStockLocationsService({ getDb: () => pool, now: () => clock });
  assert.equal((await service.getLocations('HN')).rows.length, 10);
  const accepted = await refreshSource(hn, { pool, client: sheet({ 'Vị trí HN': small }), now: at(40), logger: quiet });
  assert.equal(accepted.status, 'updated');
  assert.equal((await service.getLocations('HN')).rows.length, 1);
});

test('CAN DO: luu m3/kg moi cai, lay hang dau khi trung ma, doc lai qua createMeasureSheet', async () => {
  __test__.pendingShrink.clear();
  const { pool } = await setup();
  const values = [measureHeader, ['10GFED', 'Đèn', '', 280, 30.5, 81, 60, 70], ['10gfed', 'Trùng', '', 1, 1, 1, 1, 1], ['THIEU', '', '', 10, 5, 40, 30, '']];
  const client = sheet({ 'CÂN ĐO': values });
  const first = await refreshSource(measures, { pool, client, now: at(0), logger: quiet });
  assert.deepEqual([first.status, first.inserted], ['updated', 2]);
  assert.deepEqual(client.reads, [{ title: 'CÂN ĐO', options: { valueRenderOption: 'UNFORMATTED_VALUE' } }]);
  assert.equal((await refreshSource(measures, { pool, client, now: at(10), logger: quiet })).status, 'unchanged');
  const lookup = await createMeasureSheet({ getDb: () => pool, now: () => clock }).lookup(['10GFED', 'thieu', 'khong']);
  assert.deepEqual([...lookup.keys()].sort(), ['10gfed', 'thieu']);
  const lamp = lookup.get('10gfed');
  assert.equal(lamp.perCarton, 280);
  assert.ok(Math.abs(lamp.m3PerUnit - (81 * 60 * 70 / 1e6) / 280) < 1e-12);
  assert.ok(Math.abs(lamp.kgPerUnit - 30.5 / 280) < 1e-12);
  assert.deepEqual([lookup.get('thieu').m3PerUnit, lookup.get('thieu').missingVolume, lookup.get('thieu').kgPerUnit], [null, true, 0.5]);
});

test('khong cau hinh spreadsheet thi bo qua, khong ket noi DB', async () => {
  let connected = 0;
  const result = await refreshSource({ ...hn, spreadsheetId: () => null }, { pool: { connect: async () => { connected++; } }, logger: quiet });
  assert.equal(result.status, 'disabled');
  assert.equal(connected, 0);
});

test('scheduler chay moi nguon rieng theo intervalMs, bo nguon chua cau hinh, co the dung', async () => {
  const calls = [];
  const timers = [];
  let cleared = 0;
  const runtime = startSheetSnapshotSchedule({
    sources: [hn, measures, { ...sg, spreadsheetId: () => null }],
    refresh: async source => { calls.push(source.id); },
    setTimeoutFn: (callback, ms) => { timers.push({ callback, ms }); return { unref() {} }; },
    clearTimeoutFn: () => { cleared++; },
    logger: quiet
  });
  await runtime.ready;
  assert.deepEqual(calls, ['stock_locations_hn', 'shipping_measures']);
  assert.deepEqual(timers.map(timer => timer.ms), [hn.intervalMs, measures.intervalMs]);
  await timers[0].callback();
  assert.equal(calls.length, 3);
  runtime.stop();
  assert.equal(cleared, 2);
});

test('scheduler tiep tuc theo nextAttemptAt da luu thay vi cho tron mot chu ky', async () => {
  let delay;
  const runtime = startSheetSnapshotSchedule({
    sources: [hn], now: () => 1000,
    refresh: async () => ({ status: 'not-due', nextAttemptAt: 1600 }),
    setTimeoutFn: (callback, ms) => { delay = ms; return {}; }, clearTimeoutFn() {}, logger: quiet
  });
  await runtime.ready;
  assert.equal(delay, 600);
  runtime.stop();
});
