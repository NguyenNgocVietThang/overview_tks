'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createJobStore } = require('./jobManager');
const { runBothBranchesScan, mergeBranchStockoutResults } = require('./bothBranchesScan');

function partResult(overrides) {
  return Object.assign({
    asOfDate: '2026-09-21',
    branch: 'Hà Nội',
    totalProductsScanned: 10,
    totalCandidates: 2,
    sources: { invoices: 'db', supplierReturns: 'sheet' },
    warnings: [],
    rows: []
  }, overrides);
}

test('mergeBranchStockoutResults: gắn nhãn cơ sở lên từng dòng và cộng dồn số liệu', () => {
  const merged = mergeBranchStockoutResults([
    { branch: 'Hà Nội', result: partResult({ totalProductsScanned: 10, totalCandidates: 2, rows: [{ code: 'SP001', daysOutOfStock: 6 }] }) },
    { branch: 'Sài Gòn', result: partResult({ branch: 'Sài Gòn', totalProductsScanned: 7, totalCandidates: 1, rows: [{ code: 'SP001', daysOutOfStock: 9 }] }) }
  ]);

  assert.equal(merged.branch, 'Cả hai');
  assert.equal(merged.totalProductsScanned, 17);
  assert.equal(merged.totalCandidates, 3);
  assert.deepEqual(merged.rows.map(row => [row.code, row.branch, row.daysOutOfStock]), [
    ['SP001', 'Hà Nội', 6],
    ['SP001', 'Sài Gòn', 9]
  ]);
});

test('mergeBranchStockoutResults: cảnh báo ghi rõ cơ sở phát sinh và giữ fromDate của kỳ quét', () => {
  const merged = mergeBranchStockoutResults([
    { branch: 'Hà Nội', result: partResult({ fromDate: '2026-06-23', warnings: ['Sheet Trả NCC thiếu dữ liệu.'] }) },
    { branch: 'Sài Gòn', result: partResult({ branch: 'Sài Gòn', fromDate: '2026-06-23', warnings: [] }) }
  ]);

  assert.equal(merged.fromDate, '2026-06-23');
  assert.deepEqual(merged.warnings, ['Hà Nội: Sheet Trả NCC thiếu dữ liệu.']);
  assert.deepEqual(merged.sources, { invoices: 'db', supplierReturns: 'sheet' });
});

test('mergeBranchStockoutResults: kết quả không có fromDate (quét gần đây) không tự sinh khóa fromDate', () => {
  const merged = mergeBranchStockoutResults([{ branch: 'Hà Nội', result: partResult() }]);
  assert.equal('fromDate' in merged, false);
});

test('runBothBranchesScan: chạy job con lần lượt từng cơ sở rồi gộp vào job cha', async () => {
  const jobStore = createJobStore();
  const jobId = jobStore.createJob();
  const seen = [];

  await runBothBranchesScan(jobStore, jobId, {
    deps: [{ branch: 'Hà Nội', source: 'pg-hn' }, { branch: 'Sài Gòn', source: 'pg-sg' }],
    runScanJob: async (childStore, childJobId, deps) => {
      seen.push(deps.branch);
      childStore.updateProgress(childJobId, { progress: { phase: 2, sourceLabel: deps.branch } });
      childStore.setResult(childJobId, partResult({
        branch: deps.branch,
        rows: [{ code: 'SP' + seen.length }]
      }));
    }
  });

  assert.deepEqual(seen, ['Hà Nội', 'Sài Gòn'], 'chạy tuần tự, không nhân đôi tải cùng lúc');
  const job = jobStore.getJob(jobId);
  assert.equal(job.status, 'done');
  assert.equal(job.result.branch, 'Cả hai');
  assert.deepEqual(job.result.rows.map(row => row.branch), ['Hà Nội', 'Sài Gòn']);
  assert.equal(job.progress.phase, 2, 'tiến độ job con đẩy thẳng lên job cha');
});

test('runBothBranchesScan: một cơ sở lỗi -> job cha lỗi kèm tên cơ sở, không trả kết quả một nửa', async () => {
  const jobStore = createJobStore();
  const jobId = jobStore.createJob();
  const seen = [];

  await runBothBranchesScan(jobStore, jobId, {
    deps: [{ branch: 'Hà Nội' }, { branch: 'Sài Gòn' }],
    runScanJob: async (childStore, childJobId, deps) => {
      seen.push(deps.branch);
      if (deps.branch === 'Hà Nội') {
        childStore.setError(childJobId, { message: 'Không đọc được dữ liệu.', code: 'DB_ERROR' });
        return;
      }
      childStore.setResult(childJobId, partResult({ branch: deps.branch }));
    }
  });

  assert.deepEqual(seen, ['Hà Nội'], 'dừng ngay khi một cơ sở lỗi');
  const job = jobStore.getJob(jobId);
  assert.equal(job.status, 'error');
  assert.equal(job.result, null);
  assert.equal(job.error.code, 'DB_ERROR');
  assert.match(job.error.message, /Hà Nội/);
});
