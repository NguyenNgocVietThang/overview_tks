// ==========================================
// QUET DUT HANG O "Cả hai" — chay LAI dung service quet mot co so cho tung co
// so vat ly nhu cac JOB CON, roi gop ket qua lai vao job cha kem nhan co so.
//
// KHONG doi hanh vi mot co so: service quet giu nguyen, "Cả hai" chi la lop
// dieu phoi ben ngoai. Chay TUAN TU (khong song song) de khong nhan doi tai
// cung luc len Postgres/Google Sheets.
// ==========================================
'use strict';

const { BRANCH_BOTH } = require('../../branch/branches');

/**
 * Job con: tien do day THANG len job cha (nguoi dung van thay thanh tien
 * trinh chay), con ket qua/loi giu rieng de gop/xu ly sau.
 */
function createChildJobSink(parentStore, parentJobId) {
  const state = { result: null, error: null };
  return {
    state,
    store: {
      updateProgress: (_jobId, patch) => parentStore.updateProgress(parentJobId, patch),
      setResult: (_jobId, result) => { state.result = result; },
      setError: (_jobId, error) => { state.error = error; }
    }
  };
}

/**
 * Gop ket qua quet cua nhieu co so thanh MOT ket qua dung hinh dang cu:
 * - moi dong duoc gan them `branch` (cung ma hang o 2 co so la 2 dong rieng);
 * - so lieu tong cong don; canh bao ghi ro co so phat sinh;
 * - `branch` cua ca ket qua = 'Cả hai' (ten file Excel/khoi phuc phien dua vao).
 * @param {{branch: string, result: Object}[]} parts
 */
function mergeBranchStockoutResults(parts) {
  const first = (parts[0] && parts[0].result) || {};
  const merged = { asOfDate: first.asOfDate };
  // "Hàng đứt gần đây" khong co fromDate, "90 ngày" thi co — giu nguyen bo
  // khoa cua tung loai ket qua thay vi tu sinh them khoa moi.
  if (first.fromDate !== undefined) merged.fromDate = first.fromDate;
  merged.branch = BRANCH_BOTH;
  merged.totalProductsScanned = 0;
  merged.totalCandidates = 0;
  merged.sources = {};
  merged.warnings = [];
  merged.rows = [];

  parts.forEach(({ branch, result }) => {
    const part = result || {};
    merged.totalProductsScanned += Number(part.totalProductsScanned) || 0;
    merged.totalCandidates += Number(part.totalCandidates) || 0;
    // Nguon du lieu la cung mot bo khoa co dinh cho moi co so (hoa don/nhap
    // hang/... tu DB, Tra NCC tu Sheet) nen gop de len nhau la dung.
    Object.assign(merged.sources, part.sources || {});
    (part.warnings || []).forEach(warning => merged.warnings.push(`${branch}: ${warning}`));
    (part.rows || []).forEach(row => merged.rows.push(Object.assign({}, row, { branch })));
  });

  return merged;
}

/**
 * @param {Object} jobStore Job store cua job cha
 * @param {string} jobId Job cha
 * @param {Object} options
 * @param {Object[]} options.deps Tham so quet cho tung co so (moi phan tu co `branch`)
 * @param {Function} options.runScanJob Service quet mot co so (jobStore, jobId, deps)
 */
async function runBothBranchesScan(jobStore, jobId, { deps, runScanJob }) {
  const parts = [];
  for (const branchDeps of deps) {
    const child = createChildJobSink(jobStore, jobId);
    await runScanJob(child.store, jobId, branchDeps);
    if (child.state.error) {
      // Mot co so loi thi ca ket qua gop khong con day du — bao loi that, kem
      // ten co so, thay vi tra ve nua danh sach nhu the la du.
      jobStore.setError(jobId, Object.assign({}, child.state.error, {
        message: `Cơ sở ${branchDeps.branch}: ${child.state.error.message}`
      }));
      return;
    }
    parts.push({ branch: branchDeps.branch, result: child.state.result });
  }
  jobStore.setResult(jobId, mergeBranchStockoutResults(parts));
}

module.exports = { runBothBranchesScan, mergeBranchStockoutResults };
