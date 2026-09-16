// ==========================================
// INVOICE STATUS SERVICE — tra cuu chinh xac trang thai hoa don cho trang
// Quan ly van chuyen. Chi tra ma + trang thai, khong de lo du lieu khach hang.
//
// Nguon du lieu: Postgres (bang `invoices`, do server/kiotvietSync/ dong bo)
// thay vi Google Sheets — logic mapping trang thai TAI DUNG statusLabel()/
// INVOICE_STATUS_FALLBACK cua dashboardPgReader.js (dung 1 bang tra ma duy
// nhat trong repo, khong viet trung o day). Van giu cache 90s theo CO SO va
// so sanh ma khong phan biet hoa/thuong giong het hanh vi cu tren Sheets.
// ==========================================
const { getPool } = require('../db/pool');
const { BRANCHES, branchLabelToCode } = require('../branch/branches');
const { statusLabel, INVOICE_STATUS_FALLBACK } = require('../dashboard/dashboardPgReader');

const CACHE_TTL_MS = 90 * 1000;
const MAX_CODES = 50;

const INVOICE_STATUS_SQL = `SELECT code, ${statusLabel(INVOICE_STATUS_FALLBACK)} AS status FROM invoices WHERE branch = $1`;

function normalizeCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .normalize('NFKC')
    .trim();
}

function codeKey(value) {
  return normalizeCode(value).toLocaleLowerCase('vi-VN');
}

function validateCodes(rawCodes) {
  if (!Array.isArray(rawCodes)) {
    const err = new Error('Danh sách mã hóa đơn không hợp lệ.');
    err.statusCode = 400;
    err.code = 'INVALID_CODES';
    throw err;
  }
  if (rawCodes.length > MAX_CODES) {
    const err = new Error(`Chỉ được tra cứu tối đa ${MAX_CODES} mã hóa đơn mỗi lần.`);
    err.statusCode = 400;
    err.code = 'TOO_MANY_CODES';
    throw err;
  }

  const seen = new Set();
  const codes = [];
  rawCodes.forEach(rawCode => {
    if (typeof rawCode !== 'string' && typeof rawCode !== 'number') {
      const err = new Error('Mỗi mã hóa đơn phải là chuỗi hoặc số.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const code = normalizeCode(rawCode);
    if (!code) return;
    if (code.length > 100) {
      const err = new Error('Mã hóa đơn không được dài quá 100 ký tự.');
      err.statusCode = 400;
      err.code = 'INVALID_CODE';
      throw err;
    }
    const key = codeKey(code);
    if (!seen.has(key)) {
      seen.add(key);
      codes.push({ code, key });
    }
  });
  return codes;
}

/**
 * @param {Object} [deps]
 * @param {{query: Function}} [deps.pool] pool Postgres — tiem pool gia trong test
 *   (xem pattern debtCollectionStatusRepository.js), mac dinh dung getPool() that.
 */
function createInvoiceStatusService({ pool = getPool() } = {}) {
  // Cache theo CO SO: hai co so co du lieu invoices rieng (cot `branch`).
  // Cache nam TRONG closure cua tung instance — 1 instance test tao qua
  // createInvoiceStatusService({pool}) co cache rieng, khong ro ri sang
  // instance khac hay sang singleton module-level ben duoi.
  let invoiceCacheByBranch = new Map();

  function invoiceCacheFor(branch) {
    const key = branch || BRANCHES.HANOI;
    if (!invoiceCacheByBranch.has(key)) {
      invoiceCacheByBranch.set(key, { rows: null, expiresAt: 0, loading: null });
    }
    return invoiceCacheByBranch.get(key);
  }

  async function getInvoiceRows(branch) {
    const cache = invoiceCacheFor(branch);
    if (cache.rows && Date.now() < cache.expiresAt) return cache.rows;
    if (cache.loading) return cache.loading;

    const branchCode = branchLabelToCode(branch || BRANCHES.HANOI);
    if (!branchCode) {
      const error = new Error(`Cơ sở không hợp lệ: ${branch}`);
      error.code = 'INVALID_BRANCH';
      error.statusCode = 400;
      throw error;
    }

    const loading = pool.query(INVOICE_STATUS_SQL, [branchCode])
      .then(result => {
        // Giu dung shape [header, ...rows] nhu truoc (doc tu Sheets) de phan
        // con lai cua ham nay khong phai sua.
        const rows = [
          ['Mã hóa đơn', 'Trạng thái'],
          ...result.rows.map(row => [row.code, row.status])
        ];
        cache.rows = rows;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return rows;
      })
      .finally(() => {
        if (cache.loading === loading) cache.loading = null;
      });
    cache.loading = loading;
    return loading;
  }

  async function lookupInvoiceStatuses(rawCodes, branch) {
    const codes = validateCodes(rawCodes);
    if (!codes.length) return [];

    const rows = await getInvoiceRows(branch);
    const headers = rows[0] || [];
    const codeIndex = headers.findIndex(header => normalizeCode(header) === 'Mã hóa đơn');
    const statusIndex = headers.findIndex(header => normalizeCode(header) === 'Trạng thái');
    if (codeIndex < 0 || statusIndex < 0) {
      const err = new Error('Không đọc được cột Mã hóa đơn hoặc Trạng thái.');
      err.statusCode = 500;
      err.code = 'INVOICE_SCHEMA_INVALID';
      throw err;
    }

    const statusByCode = new Map();
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const sourceCode = normalizeCode(row[codeIndex]);
      if (!sourceCode) continue;
      const key = codeKey(sourceCode);
      if (!statusByCode.has(key)) statusByCode.set(key, normalizeCode(row[statusIndex]));
    }

    return codes.map(({ code, key }) => {
      if (!statusByCode.has(key)) return { code, found: false, status: '' };
      return { code, found: true, status: statusByCode.get(key) };
    });
  }

  return {
    lookupInvoiceStatuses,
    __test__: {
      resetCache() {
        invoiceCacheByBranch = new Map();
      }
    }
  };
}

const service = createInvoiceStatusService();

module.exports = {
  createInvoiceStatusService,
  lookupInvoiceStatuses: (...args) => service.lookupInvoiceStatuses(...args),
  MAX_CODES,
  __test__: {
    resetCache() {
      service.__test__.resetCache();
    }
  }
};
