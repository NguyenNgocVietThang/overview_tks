'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  estimateStorageMb, compareFieldSets, fetchSampleAndTotal, estimateAllEntities, parseArgs
} = require('./preflightCheck');

test('estimateStorageMb: uoc luong ty le thuan voi total va kich thuoc trung binh mau', () => {
  const sample = [{ a: 1, b: 'xx' }, { a: 2, b: 'yy' }];
  const mb = estimateStorageMb(sample, 1000);
  const avgBytes = (JSON.stringify(sample[0]).length + JSON.stringify(sample[1]).length) / 2;
  assert.equal(mb, (avgBytes * 1000) / (1024 * 1024));
});

test('estimateStorageMb: mau rong hoac total=0 tra ve 0, khong throw', () => {
  assert.equal(estimateStorageMb([], 1000), 0);
  assert.equal(estimateStorageMb([{ a: 1 }], 0), 0);
  assert.equal(estimateStorageMb(null, 1000), 0);
});

test('compareFieldSets: phat hien field co o ban ghi gan day nhung thieu o ban ghi cu', () => {
  const oldItem = { Id: 1, Code: 'A' };
  const recentItem = { Id: 2, Code: 'B', SaleChannelId: 9 };
  const { missingInOld } = compareFieldSets(oldItem, recentItem);
  assert.deepEqual(missingInOld, ['SaleChannelId']);
});

test('compareFieldSets: field giong nhau tra ve mang rong', () => {
  const { missingInOld } = compareFieldSets({ a: 1 }, { a: 2 });
  assert.deepEqual(missingInOld, []);
});

test('fetchSampleAndTotal: dung ngay sau trang dau, khong tai het entity (client gia)', () => {
  return (async () => {
    let pagesRequested = 0;
    const fakeClient = {
      async fetchAllPages(endpoint, query, onPage) {
        pagesRequested += 1;
        await onPage([{ Id: 1 }, { Id: 2 }], { total: 500, nextItem: 100 });
        // Neu fetchSampleAndTotal khong dung dung cach, vong lap gia lap nay
        // se tiep tuc goi onPage nhieu lan - dam bao no chi goi 1 lan.
        pagesRequested += 1;
      }
    };
    const { sample, total } = await fetchSampleAndTotal(fakeClient, 'invoices', {});
    assert.deepEqual(sample, [{ Id: 1 }, { Id: 2 }]);
    assert.equal(total, 500);
    assert.equal(pagesRequested, 1, 'onPage phai throw ngay sau trang dau, khong chay tiep code sau no');
  })();
});

test('estimateAllEntities: tong hop dung total + MB cho nhieu entity, khong ghi gi ngoai log', async () => {
  const fakeClient = {
    async fetchAllPages(endpoint, query, onPage) {
      await onPage([{ Id: 1, big: 'x'.repeat(1000) }], { total: 10000 });
    }
  };
  const entities = [
    { entity: 'categories', endpoint: 'categories', listQuery: {} },
    { entity: 'products', endpoint: 'products', listQuery: {} }
  ];
  const logs = [];
  const { report, totalMb } = await estimateAllEntities(fakeClient, entities, { log: (msg) => logs.push(msg) });
  assert.equal(report.length, 2);
  assert.equal(report[0].total, 10000);
  assert.ok(totalMb > 0);
  assert.ok(logs.some((line) => line.includes('Tong uoc luong')));
});

test('parseArgs: doc --branch tu argv, mac dinh hanoi', () => {
  assert.equal(parseArgs([]).branch, 'hanoi');
  assert.equal(parseArgs(['--branch=saigon']).branch, 'saigon');
});
