// ==========================================
// CO SO (branch) — Ha Noi / Sai Gon. Day la chieu chon NGUON DU LIEU (bo loc
// xem): moi request du lieu deu chay qua branchMiddleware de biet dang xem co
// so nao. Khong con phan quyen theo co so — ai cung xem duoc ca hai.
//
// KHONG lien quan den ten KHO ('An Khanh'/'Tan Phu') trong
// Ten kho trong nghiep vu KiotViet la khai niem khac va giu nguyen.
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
 * Co so chi la BO LOC XEM: moi tai khoan deu duoc xem ca hai co so (giong quyen
 * "Cả hai" truoc day). Cot coSo cua tai khoan la thong tin phu trach,
 * khong quyet dinh bo loc mac dinh hay ranh gioi doc/ghi du lieu.
 */
function allowedBranches() {
  return [BRANCHES.HANOI, BRANCHES.SAIGON];
}

/**
 * Danh sach gia tri co the chon tren giao dien: 2 co so + "Cả hai". Tuyet doi
 * khong dung no lam gia tri branch nghiep vu (xem resolveBranchScope).
 */
function selectableBranches() {
  return [BRANCHES.HANOI, BRANCHES.SAIGON, BRANCH_BOTH];
}

function isBranchAllowed(user, branch) {
  return allowedBranches(user).includes(branch);
}

function isBranchSelectable(user, branch) {
  return selectableBranches(user).includes(branch);
}

/**
 * Chuyen lua chon UI thanh pham vi co so vat ly de cac lop truy van du lieu
 * khong bao gio nhan "Cả hai" nhu mot gia tri branch nghiep vu.
 */
function resolveBranchScope(branch) {
  if (branch === BRANCH_BOTH) return [BRANCHES.HANOI, BRANCHES.SAIGON];
  if (branch === BRANCHES.HANOI || branch === BRANCHES.SAIGON) return [branch];
  return [];
}

// Moi tai khoan deu bat dau voi bo loc "Cả hai" khi dang nhap.
function defaultBranch() {
  return BRANCH_BOTH;
}

// Anh xa 2 chieu giua dinh danh noi bo cua Postgres ('hanoi'/'saigon' — xem
// server/db/SCHEMA.md) va nhan hien thi BRANCHES ('Hà Nội'/'Sài Gòn'). Dung
// boi appUsersRepository.js/hrEmployeesRepository.js khi doc/ghi cot `branch`
// (KHONG co gia tri 'both' — khac voi co_so 3 trang thai cua app_users).
const BRANCH_CODE_TO_LABEL = Object.freeze({ hanoi: BRANCHES.HANOI, saigon: BRANCHES.SAIGON });
const BRANCH_LABEL_TO_CODE = Object.freeze({ [BRANCHES.HANOI]: 'hanoi', [BRANCHES.SAIGON]: 'saigon' });

function branchCodeToLabel(code) {
  return BRANCH_CODE_TO_LABEL[code] || '';
}

function branchLabelToCode(label) {
  return BRANCH_LABEL_TO_CODE[normalizeCoSo(label)] || '';
}

module.exports = {
  BRANCHES,
  BRANCH_BOTH,
  BRANCH_VALUES,
  normalizeCoSo,
  allowedBranches,
  selectableBranches,
  isBranchAllowed,
  isBranchSelectable,
  resolveBranchScope,
  defaultBranch,
  branchCodeToLabel,
  branchLabelToCode
};
