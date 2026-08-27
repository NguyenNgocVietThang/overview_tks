// ==========================================
// CO SO (branch) — Ha Noi / Sai Gon. Day la chieu PHAN QUYEN + chon NGUON
// DU LIEU: moi request du lieu deu chay qua branchMiddleware de biet dang
// xem co so nao, roi doc dung spreadsheet cua co so do.
//
// KHONG lien quan den ten KHO ('An Khanh'/'Tan Phu') trong
// server/shipment/orderStateMachine.js — ten kho la khai niem khac va giu nguyen.
// ==========================================
const BRANCHES = Object.freeze({ HANOI: 'Hà Nội', SAIGON: 'Sài Gòn' });
const BRANCH_BOTH = 'Cả hai';
const BRANCH_VALUES = Object.freeze([BRANCHES.HANOI, BRANCHES.SAIGON, BRANCH_BOTH]);

// Du lieu users.json cu dung TEN KHO lam gia tri co so ('An Khanh'/'Tan Phu')
// — map lai de tai khoan cu khong bi khoa ra ngoai sau khi doi ten hien thi.
const LEGACY_ALIASES = Object.freeze({
  'an khánh': BRANCHES.HANOI,
  'tân phú': BRANCHES.SAIGON,
  'hà nội': BRANCHES.HANOI,
  'sài gòn': BRANCHES.SAIGON,
  'cả hai': BRANCH_BOTH
});

/**
 * Chuan hoa gia tri "Co so phu trach" ve dung 1 trong 4 gia tri:
 * 'Hà Nội' | 'Sài Gòn' | 'Cả hai' | '' (chua gan / khong hop le).
 */
function normalizeCoSo(raw) {
  const key = String(raw == null ? '' : raw).trim().toLowerCase();
  return LEGACY_ALIASES[key] || '';
}

/**
 * Danh sach co so mot tai khoan duoc phep xem. Rong = chua duoc gan co so
 * (Quan ly phai gan truoc khi tai khoan xem duoc bat ky du lieu nao).
 */
function allowedBranches(user) {
  const coSo = normalizeCoSo(user && user.coSo);
  if (coSo === BRANCH_BOTH) return [BRANCHES.HANOI, BRANCHES.SAIGON];
  if (coSo) return [coSo];
  return [];
}

function isBranchAllowed(user, branch) {
  return allowedBranches(user).includes(branch);
}

function defaultBranch(user) {
  return allowedBranches(user)[0] || null;
}

module.exports = {
  BRANCHES,
  BRANCH_BOTH,
  BRANCH_VALUES,
  normalizeCoSo,
  allowedBranches,
  isBranchAllowed,
  defaultBranch
};
